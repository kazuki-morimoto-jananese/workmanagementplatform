import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { openStoreDatabase } from "../server/store.mjs";
import {
  createGoogleUserService,
  googleUserStatus,
} from "../server/google-user.mjs";
test("Google onboarding skips fully authorized members and defers only the current member", async () => {
  const names = [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
  ];
  const old = names.map((k) => process.env[k]);
  const store = openStoreDatabase(new DatabaseSync(":memory:"));
  try {
    names.forEach((k) => {
      process.env[k] = "test-only";
    });
    const user = {
      id: "new-member",
      role: "member",
      active: true,
      email: "member@example.test",
    };
    store.saveUser(user);
    assert.equal(googleUserStatus(store, user).onboardingPending, true);
    store.put("googleConnections", {
      id: user.id,
      scopes: ["https://www.googleapis.com/auth/documents.readonly"],
    });
    assert.equal(googleUserStatus(store, user).onboardingPending, true);
    const scopes = [
      "documents.readonly",
      "calendar.events.readonly",
      "spreadsheets.readonly",
      "drive.metadata.readonly",
      "drive.file",
    ].map((s) => "https://www.googleapis.com/auth/" + s);
    store.put("googleConnections", { id: user.id, scopes });
    assert.equal(googleUserStatus(store, user).onboardingPending, false);
    store.remove("googleConnections", user.id);
    const service = createGoogleUserService(store, {
      fetchImpl: () => {
        throw new Error("No network expected");
      },
    });
    let status;
    await service.handle({
      path: "/api/google/onboarding/defer",
      method: "POST",
      user,
      body: { userId: "other" },
      send: (s) => {
        status = s;
      },
    });
    assert.equal(status, 200);
    assert.equal(googleUserStatus(store, user).onboardingPending, false);
    assert.equal(
      googleUserStatus(store, { id: "other" }).onboardingPending,
      true,
    );
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    assert.equal(
      googleUserStatus(store, { id: "other" }).onboardingPending,
      false,
    );
  } finally {
    names.forEach((k, i) => {
      if (old[i] === undefined) delete process.env[k];
      else process.env[k] = old[i];
    });
  }
});
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
    role: "admin",
  };
  store.saveUser(user);
  let identity = user.email,
    grantedScopes =
      "openid email https://www.googleapis.com/auth/documents.readonly",
    tokenCalls = 0;
  const calls = [];
  let sheetStatus = 200,
    revokeDuringRead = false,
    headerOnly = false;
  const service = createGoogleUserService(store, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      assert.equal(init.redirect, "manual");
      if (url.startsWith("https://sheets.googleapis.com/v4/spreadsheets/")) {
        assert.equal(init.headers.Authorization, "Bearer fake-access-only");
        assert.equal(
          new URL(url).searchParams.get("valueRenderOption"),
          "FORMATTED_VALUE",
        );
        if (revokeDuringRead) store.remove("googleConnections", user.id);
        return Response.json(
          {
            values: headerOnly
              ? [["アカウントID", "アカウント名"]]
              : [
                  ["アカウントID", "アカウント名", "今週Gトレ"],
                  ["abc", "Example", "0"],
                ],
          },
          { status: sheetStatus },
        );
      }
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
          scope: grantedScopes,
        });
      }
      if (url === "https://openidconnect.googleapis.com/v1/userinfo")
        return Response.json({ email: identity, email_verified: true });
      if (
        url.startsWith(
          "https://www.googleapis.com/calendar/v3/calendars/primary/events?",
        )
      ) {
        const parsed = new URL(url);
        assert.equal(parsed.searchParams.get("singleEvents"), "true");
        return Response.json({
          items: [
            {
              id: "meeting",
              summary: "Meeting",
              start: { date: "2026-09-08" },
              htmlLink:
                "https://calendar.google.com/calendar/event?eid=example",
            },
            { id: "cancelled", status: "cancelled" },
            { id: "bad-link", htmlLink: "javascript:alert(1)" },
          ],
          nextPageToken: "more",
        });
      }
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
  const handle = async (
    path,
    method = "GET",
    who = user,
    query = "",
    body = {},
  ) => {
    let response;
    await service.handle({
      path,
      method,
      body,
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
    await assert.rejects(
      handle("/api/google/calendar"),
      (e) => e.status === 403,
    );
    const calendarConsent = new URL(
      (await handle("/api/google/start", "POST", user, "", { calendar: true }))
        .data.url,
    );
    assert.ok(
      calendarConsent.searchParams
        .get("scope")
        .includes("calendar.events.readonly"),
    );
    grantedScopes +=
      " https://www.googleapis.com/auth/calendar.events.readonly";
    await handle(
      "/api/google/callback",
      "GET",
      user,
      "?state=" + calendarConsent.searchParams.get("state") + "&code=sample",
    );
    assert.equal(googleUserStatus(store, user).calendar, true);
    const agenda = await handle("/api/google/calendar");
    assert.equal(agenda.data.events.length, 2);
    assert.equal(agenda.data.events[1].url, "");
    assert.equal(agenda.data.truncated, true);
    assert.equal(
      googleUserStatus(store, { ...user, id: "other" }).calendar,
      false,
    );
    const source = {
      authMode: "user",
      authUserId: user.id,
      spreadsheetId: "sampleSheet123456",
      range: "'Sales'!A1:C",
    };
    await assert.rejects(service.readSheet(source), (e) => e.status === 403);
    const sheetsConsent = new URL(
      (await handle("/api/google/start", "POST", user, "", { sheets: true }))
        .data.url,
    );
    assert.ok(
      sheetsConsent.searchParams.get("scope").includes("spreadsheets.readonly"),
    );
    assert.ok(
      sheetsConsent.searchParams
        .get("scope")
        .includes("calendar.events.readonly"),
    );
    grantedScopes += " https://www.googleapis.com/auth/spreadsheets.readonly";
    await handle(
      "/api/google/callback",
      "GET",
      user,
      "?state=" + sheetsConsent.searchParams.get("state") + "&code=sample",
    );
    assert.equal(googleUserStatus(store, user).sheets, true);
    assert.equal((await service.readSheet(source)).values[1][2], "0");
    await assert.rejects(
      service.readSheet({ ...source, authUserId: "other" }),
      (e) => e.status === 403,
    );
    store.saveUser({ ...user, active: false });
    await assert.rejects(service.readSheet(source), (e) => e.status === 403);
    store.saveUser(user);
    headerOnly = true;
    await assert.rejects(service.readSheet(source), /データ行/);
    headerOnly = false;
    sheetStatus = 403;
    await assert.rejects(
      service.readSheet(source),
      (e) => e.status === 403 && /原因は確定できません/.test(e.message),
    );
    sheetStatus = 200;
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
    const workflowConsent = new URL(
      (
        await handle("/api/google/start", "POST", user, "", {
          driveSearch: true,
          documentsWrite: true,
          calendar: true,
          sheets: true,
        })
      ).data.url,
    );
    assert.ok(
      workflowConsent.searchParams
        .get("scope")
        .includes("drive.metadata.readonly"),
    );
    assert.ok(
      workflowConsent.searchParams
        .get("scope")
        .includes("https://www.googleapis.com/auth/drive.file"),
    );
    assert.ok(
      workflowConsent.searchParams
        .get("scope")
        .includes("calendar.events.readonly"),
    );
    assert.ok(
      !workflowConsent.searchParams
        .get("scope")
        .split(" ")
        .includes("https://www.googleapis.com/auth/drive"),
    );
    revokeDuringRead = true;
    await assert.rejects(service.readSheet(source), (e) => e.status === 403);
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
