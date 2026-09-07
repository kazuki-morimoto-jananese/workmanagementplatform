import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { openStoreDatabase } from "../server/store.mjs";
import {
  createGoogleUserService,
  googleUserStatus,
} from "../server/google-user.mjs";
test("Google user consent uses PKCE, binds state to member, encrypts tokens and reads document tabs", async () => {
  const names = [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
  ];
  const old = Object.fromEntries(names.map((k) => [k, process.env[k]]));
  process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client.apps.googleusercontent.com";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-only-client-secret";
  process.env.GOOGLE_OAUTH_REDIRECT_URI =
    "https://worknest.example/api/google/callback";
  const store = openStoreDatabase(new DatabaseSync(":memory:"));
  const user = {
    id: "one",
    email: "one@company.test",
    active: true,
    role: "member",
  };
  store.saveUser(user);
  let identity = user.email,
    tokenCalls = 0;
  const calls = [];
  const service = createGoogleUserService(store, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      assert.equal(init.redirect, "manual");
      if (url === "https://oauth2.googleapis.com/token") {
        tokenCalls++;
        const body = new URLSearchParams(init.body);
        assert.equal(body.get("client_id"), process.env.GOOGLE_OAUTH_CLIENT_ID);
        if (body.get("grant_type") === "authorization_code")
          assert.ok(body.get("code_verifier"));
        return Response.json({
          access_token: "fake-access-only",
          refresh_token: "fake-refresh-only",
          expires_in: 1,
        });
      }
      if (url === "https://openidconnect.googleapis.com/v1/userinfo")
        return Response.json({ email: identity, email_verified: true });
      if (url.startsWith("https://docs.googleapis.com/v1/documents/"))
        return Response.json({
          title: "Doc",
          tabs: [
            {
              documentTab: {
                body: {
                  content: [
                    {
                      paragraph: {
                        elements: [{ textRun: { content: "第一タブ\n" } }],
                      },
                    },
                  ],
                },
              },
              childTabs: [
                {
                  documentTab: {
                    body: {
                      content: [
                        {
                          table: {
                            tableRows: [
                              {
                                tableCells: [
                                  {
                                    content: [
                                      {
                                        paragraph: {
                                          elements: [
                                            {
                                              textRun: { content: "第二タブ" },
                                            },
                                          ],
                                        },
                                      },
                                    ],
                                  },
                                ],
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                },
              ],
            },
          ],
        });
      throw Error("Unexpected host");
    },
  });
  const handle = async (path, method = "GET", who = user, query = "") => {
    let response;
    await service.handle({
      path,
      method,
      user: who,
      url: new URL("https://worknest.example" + path + query),
      send: (status, data, headers) => {
        response = { status, data, headers };
      },
    });
    return response;
  };
  try {
    const begin = await handle("/api/google/start", "POST");
    const consent = new URL(begin.data.url);
    assert.equal(consent.hostname, "accounts.google.com");
    assert.equal(consent.searchParams.get("code_challenge_method"), "S256");
    assert.ok(consent.searchParams.get("scope").includes("documents.readonly"));
    assert.ok(!consent.searchParams.get("scope").includes("drive"));
    const query =
      "?state=" + consent.searchParams.get("state") + "&code=sample";
    await assert.rejects(
      handle("/api/google/callback", "GET", { ...user, id: "other" }, query),
      (e) => e.status === 403,
    );
    const callback = await handle("/api/google/callback", "GET", user, query);
    assert.equal(callback.status, 302);
    assert.equal(googleUserStatus(store, user).connected, true);
    const encrypted = store.get("googleConnections", user.id);
    assert.ok(!JSON.stringify(encrypted).includes("fake-refresh-only"));
    assert.ok(!JSON.stringify(encrypted).includes("fake-access-only"));
    await assert.rejects(
      handle("/api/google/callback", "GET", user, query),
      (e) => e.status === 403,
    );
    const doc = await service.readDocument(
      "https://docs.google.com/document/d/abcdefghijklmnopqrst/edit",
      user,
    );
    assert.equal(doc.text, "第一タブ\n第二タブ");
    assert.equal(tokenCalls, 2);
    identity = "wrong@company.test";
    const second = new URL(
      (await handle("/api/google/start", "POST")).data.url,
    );
    await assert.rejects(
      handle(
        "/api/google/callback",
        "GET",
        user,
        "?state=" + second.searchParams.get("state") + "&code=sample",
      ),
      (e) => e.status === 403,
    );
    assert.equal(store.get("googleConnections", user.id).email, user.email);
    await handle("/api/google/disconnect", "POST");
    assert.equal(googleUserStatus(store, user).connected, false);
    assert.ok(calls.every((c) => c.url.startsWith("https://")));
  } finally {
    store.db.close();
    for (const k of names)
      if (old[k] === undefined) delete process.env[k];
      else process.env[k] = old[k];
  }
});
