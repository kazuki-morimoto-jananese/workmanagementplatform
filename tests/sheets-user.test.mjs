import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { openStoreDatabase, digest } from "../server/store.mjs";
import { createApp } from "../server/index.mjs";
test("personal Sheets authorization binds scheduled sync to its owner and preserves manual forecasts", async () => {
  const keys = [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
  ];
  const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
  process.env.GOOGLE_OAUTH_REDIRECT_URI =
    "https://example.test/api/google/callback";
  const store = openStoreDatabase(new DatabaseSync(":memory:"));
  for (const name of ["one", "two", "member"]) {
    store.saveUser({
      id: name,
      name,
      email: name + "@example.test",
      active: true,
      role: name === "member" ? "member" : "admin",
    });
    store.db
      .prepare("INSERT INTO sessions VALUES (?,?,?)")
      .run(digest(name), name, Date.now() + 600000);
  }
  let reads = 0,
    refreshes = 0;
  const app = createApp({
    store,
    production: false,
    allowedDomain: "",
    timers: false,
    googleAdapters: {
      fetchImpl: async (url, init) => {
        if (url === "https://oauth2.googleapis.com/token") {
          const p = new URLSearchParams(init.body);
          if (p.get("grant_type") === "refresh_token") refreshes++;
          const who = p.get("code") || p.get("refresh_token");
          return Response.json({
            access_token: who,
            refresh_token: who,
            expires_in: 1,
            scope:
              "openid email https://www.googleapis.com/auth/spreadsheets.readonly",
          });
        }
        if (url === "https://openidconnect.googleapis.com/v1/userinfo")
          return Response.json({
            email: init.headers.Authorization.slice(7) + "@example.test",
            email_verified: true,
          });
        assert.ok(
          url.startsWith("https://sheets.googleapis.com/v4/spreadsheets/"),
        );
        assert.equal(init.headers.Authorization, "Bearer one");
        reads++;
        return Response.json({
          values: [
            ["アカウントID", "アカウント名", "今週Gトレ"],
            ["account", "Synthetic", "0"],
          ],
        });
      },
    },
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + app.server.address().port;
  const call = async (path, body, who = "one") => {
    const r = await fetch(base + "/api" + path, {
      method: body ? "POST" : "GET",
      redirect: "manual",
      headers: {
        Cookie: "worknest_session=" + who,
        "X-Worknest": "1",
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json() };
  };
  try {
    const input = {
      authMode: "user",
      authUserId: "two",
      name: "Test",
      spreadsheetId: "sampleSheet123456",
      range: "Sales!A1:C",
      month: "2026-09",
      syncTime: "00:00",
      enabled: false,
    };
    assert.equal(
      (await call("/sales/connections", input, "member")).status,
      403,
    );
    assert.equal(
      (await call("/sales/connections", input)).data.authUserId,
      "one",
    );
    assert.equal((await call("/sales/connections/preview", {})).status, 403);
    assert.equal(
      (await call("/sales/connections", { ...input, enabled: true })).status,
      403,
    );
    const consent = new URL(
      (await call("/google/start", { sheets: true })).data.url,
    );
    assert.equal(
      (
        await call(
          "/google/callback?state=" +
            consent.searchParams.get("state") +
            "&code=one",
        )
      ).status,
      302,
    );
    const saved = await call(
      "/sales/connections",
      { ...input, enabled: true },
      "two",
    );
    assert.equal(saved.status, 200);
    assert.equal(saved.data.authUserId, "one");
    const preview = await call("/sales/connections/preview", {}, "two");
    assert.equal(preview.status, 200);
    assert.equal(preview.data.count, 1);
    assert.equal(store.all("salesAccounts").length, 0);
    await call("/sales/connections/sync", {}, "two");
    assert.equal(store.all("salesMasters")[0].gTrend, 0);
    store.put("salesReviews", {
      id: "review",
      accountId: "account",
      month: "2026-09",
      forecast: 123,
    });
    await app.tick();
    assert.equal(reads, 3);
    assert.ok(refreshes >= 3);
    assert.equal(store.get("salesReviews", "review").forecast, 123);
    await call("/google/disconnect", {});
    assert.equal(
      (await call("/sales/connections/sync", {}, "two")).status,
      403,
    );
    assert.equal(reads, 3);
    assert.equal(store.get("salesReviews", "review").forecast, 123);
    assert.equal(
      (await call("/sales/bootstrap", undefined, "two")).data.connections
        .sheetsConfigured,
      false,
    );
  } finally {
    await app.close();
    for (const key of keys)
      if (old[key] === undefined) delete process.env[key];
      else process.env[key] = old[key];
  }
});
