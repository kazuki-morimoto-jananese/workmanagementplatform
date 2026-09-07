import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncTime, scheduledSyncDue } from "../server/sales-schedule.mjs";
import { prepareCompany } from "../scripts/prepare-company.mjs";
import { createApp } from "../server/index.mjs";
import { jstToday, monday } from "../server/sales.mjs";

test("daily sheet schedule follows JST and manual sync does not cancel scheduled sync", () => {
  const source = {
    enabled: true,
    syncTime: "09:30",
    lastAttemptAt: "2026-09-06T00:00:00Z",
  };
  assert.equal(syncTime(), "06:00");
  for (const value of ["24:00", "09:60", "9:30", null, "09:00\nBAD=1"])
    assert.throws(() => syncTime(value));
  assert.equal(
    scheduledSyncDue(source, new Date("2026-09-06T00:29:00Z")),
    false,
  );
  assert.equal(
    scheduledSyncDue(source, new Date("2026-09-06T00:30:00Z")),
    true,
  );
  assert.equal(
    scheduledSyncDue(
      { ...source, lastScheduledAttemptAt: "2026-09-06T00:30:00Z" },
      new Date("2026-09-06T08:00:00Z"),
    ),
    false,
  );
  assert.equal(
    scheduledSyncDue(
      { ...source, lastScheduledAttemptAt: "2026-09-05T00:30:00Z" },
      new Date("2026-09-06T08:00:00Z"),
    ),
    true,
  );
  assert.equal(
    scheduledSyncDue(
      { ...source, enabled: false },
      new Date("2026-09-06T08:00:00Z"),
    ),
    false,
  );
  assert.equal(
    scheduledSyncDue(
      {
        enabled: true,
        syncTime: "00:00",
        lastScheduledAttemptAt: "2026-09-30T14:59:00Z",
      },
      new Date("2026-09-30T15:00:00Z"),
    ),
    true,
  );
});
test("company config generates a private setup secret and refuses to overwrite configuration", () => {
  const directory = mkdtempSync(join(tmpdir(), "worknest-company-config-"));
  try {
    for (const domain of [
      "https://worknest.example.com",
      "example.com\nBAD=1",
      "localhost",
      "a.example.com:443",
    ])
      assert.throws(() =>
        prepareCompany({ domain, emailDomain: "example.com", directory }),
      );
    const output = prepareCompany({
      domain: "worknest.example.com",
      emailDomain: "example.com",
      directory,
    });
    const text = readFileSync(output.path, "utf8");
    assert.match(text, /APP_DOMAIN=worknest.example.com/);
    assert.match(text, /ALLOWED_EMAIL_DOMAIN=example.com/);
    assert.match(text, /SETUP_TOKEN=[0-9a-f]{64}/);
    assert.match(text, /GEMINI_API_KEY=\n/);
    assert.ok(!("token" in output));
    assert.throws(
      () =>
        prepareCompany({
          domain: "another.example.com",
          emailDomain: "example.com",
          directory,
        }),
      { code: "EEXIST" },
    );
    assert.equal(readFileSync(output.path, "utf8"), text);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test("private Sheets preview is read-only and repeated manual sync preserves forecasts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "worknest-sheet-preview-"));
  let amount = 500000,
    failing = false;
  const app = createApp({
    dataDir: directory,
    sheetReader: async () => {
      if (failing)
        throw Object.assign(new Error("Google接続を確認してください。"), {
          status: 503,
        });
      return {
        values: [
          ["アカウントID", "アカウント名", "今週Gトレ"],
          ["pilot-account", "取込確認", amount],
        ],
      };
    },
  });
  let cookie = "";
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  const req = async (path, method = "GET", body) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        "X-Worknest": "1",
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      body: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  };
  try {
    assert.equal(
      (await req("/sales/connections/preview", "POST", {})).status,
      401,
    );
    await req("/auth/setup", "POST", {
      name: "会社管理者",
      workspace: "会社用",
      email: "admin@example.com",
      password: "Pilot-strong-password",
      samples: false,
    });
    cookie = (
      await req("/auth/login", "POST", {
        email: "admin@example.com",
        password: "Pilot-strong-password",
      })
    ).cookie;
    const month = jstToday().slice(0, 7);
    const connection = {
      spreadsheetId: "privateSpreadsheetId123",
      range: "連携用!A1:AZ1000",
      month,
      enabled: false,
      rollingMonth: true,
      syncTime: "09:30",
    };
    assert.equal(
      (
        await req("/sales/connections", "POST", {
          ...connection,
          syncTime: "25:00",
        })
      ).status,
      400,
    );
    assert.equal(
      (await req("/sales/connections", "POST", connection)).status,
      200,
    );
    const preview = await req("/sales/connections/preview", "POST", {});
    assert.equal(preview.status, 200);
    assert.equal(preview.body.rows[0].accountId, "pilot-account");
    assert.equal(app.store.all("salesAccounts").length, 0);
    assert.equal(
      (await req("/sales/connections/sync", "POST", {})).status,
      200,
    );
    assert.equal(app.store.all("salesMasters")[0].gTrend, 500000);
    const review = await req("/sales/reviews", "POST", {
      accountId: "pilot-account",
      month,
      weekOf: monday(),
      forecast: 600000,
      reason: "上司と確認済み",
    });
    amount = 550000;
    assert.equal(
      (await req("/sales/connections/sync", "POST", {})).status,
      200,
    );
    assert.equal(app.store.all("salesMasters")[0].gTrend, 550000);
    assert.equal(
      app.store.get("salesReviews", review.body.id).forecast,
      600000,
    );
    assert.ok(!app.store.get("salesSettings", "source").lastScheduledAttemptAt);
    failing = true;
    assert.equal(
      (await req("/sales/connections/sync", "POST", {})).status,
      503,
    );
    assert.equal(app.store.all("salesMasters")[0].gTrend, 550000);
    assert.ok(app.store.get("salesSettings", "source").lastSuccessAt);
    assert.match(app.store.get("salesSettings", "source").lastError, /Google/);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
