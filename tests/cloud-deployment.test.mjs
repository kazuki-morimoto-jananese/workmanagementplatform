import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server/index.mjs";
import { restoreExport } from "../scripts/restore-export.mjs";
import { openStore, verifyPassword } from "../server/store.mjs";
import {
  googleCredentials,
  integrationStatus,
  readGoogleSheet,
} from "../server/sales-integrations.mjs";

function restoreEnv(saved) {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("admin export preserves audit and restores into a new database without sessions", async () => {
  const directory = mkdtempSync(join(tmpdir(), "worknest-export-"));
  const app = createApp({
    dataDir: join(directory, "original"),
    production: false,
    allowedDomain: "",
  });
  let restored;
  try {
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${app.server.address().port}/api`;
    let cookie = "";
    const post = (path, body) =>
      fetch(base + path, {
        method: "POST",
        headers: {
          "X-Worknest": "1",
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: JSON.stringify(body),
      });
    const password = "Export-restore-test-password";
    await post("/auth/setup", {
      workspace: "会社の保存検証",
      name: "管理者",
      email: "export@company.test",
      password,
      samples: false,
    });
    assert.equal((await post("/operations/export-data", {})).status, 401);
    cookie = (
      await post("/auth/login", { email: "export@company.test", password })
    ).headers
      .get("set-cookie")
      .split(";")[0];
    await post("/projects", { name: "長期保存するプロジェクト" });
    const snapshot = await (await post("/operations/export-data", {})).json();
    assert.ok(snapshot.audit.length > 0);
    assert.ok(!("sessions" in snapshot));
    assert.ok(!JSON.stringify(snapshot).includes(password));
    const source = join(directory, "backup.json"),
      destination = join(directory, "restored");
    writeFileSync(source, JSON.stringify(snapshot));
    const result = restoreExport(source, destination);
    assert.equal(result.records, snapshot.records.length);
    assert.throws(() => restoreExport(source, destination), /新しい/);
    restored = openStore(destination);
    assert.deepEqual(
      restored.db.prepare("SELECT * FROM audit_log ORDER BY seq").all().map(row => ({...row})),
      snapshot.audit,
    );
    assert.equal(restored.all("projects")[0].name, "長期保存するプロジェクト");
    assert.equal(
      restored.db.prepare("SELECT count(*) AS count FROM sessions").get().count,
      0,
    );
    assert.equal(
      await verifyPassword(password, restored.users()[0].password),
      true,
    );
  } finally {
    restored?.db.close();
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cloud secret JSON supports private Sheets without exposing credentials in status", async () => {
  const saved = Object.fromEntries(
    ["GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_SERVICE_ACCOUNT_FILE"].map(
      (key) => [key, process.env[key]],
    ),
  );
  try {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = "invalid-private-content";
    assert.equal(integrationStatus().sheetsConfigured, false);
    assert.throws(
      googleCredentials,
      (error) => !error.message.includes("invalid-private-content"),
    );
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = "null";
    assert.equal(integrationStatus().sheetsConfigured, false);
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const credentials = {
      type: "service_account",
      client_email: "test@example.iam.gserviceaccount.com",
      private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    };
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify(credentials);
    assert.equal(integrationStatus().sheetsConfigured, true);
    assert.equal(integrationStatus().driveConfigured, true);
    assert.ok(
      !JSON.stringify(integrationStatus()).includes(credentials.client_email),
    );
    let calls = 0;
    const result = await readGoogleSheet(
      { spreadsheetId: "privateTestSheet12345", range: "Master!A1:C9" },
      {
        fetchImpl: async (url, init) => {
          calls++;
          if (url === "https://oauth2.googleapis.com/token") {
            const assertion = new URLSearchParams(init.body).get("assertion");
            const claims = JSON.parse(
              Buffer.from(assertion.split(".")[1], "base64url"),
            );
            assert.equal(
              claims.scope,
              "https://www.googleapis.com/auth/spreadsheets.readonly",
            );
            return Response.json({
              access_token: "test-only-token",
              expires_in: 3600,
            });
          }
          assert.match(url, /^https:\/\/sheets\.googleapis\.com\//);
          assert.equal(init.headers.Authorization, "Bearer test-only-token");
          return Response.json({
            values: [
              ["アカウントID", "アカウント名"],
              ["a", "確認"],
            ],
          });
        },
      },
    );
    assert.equal(calls, 2);
    assert.equal(result.values[1][0], "a");
    process.env.GOOGLE_SERVICE_ACCOUNT_FILE = "missing-file";
    assert.equal(googleCredentials().client_email, credentials.client_email);
  } finally {
    restoreEnv(saved);
  }
});

test("Render HTTPS origin permits company setup and rejects foreign origins", async () => {
  const saved = Object.fromEntries(
    ["APP_ORIGIN", "RENDER_EXTERNAL_URL", "SETUP_TOKEN"].map((key) => [
      key,
      process.env[key],
    ]),
  );
  const directory = mkdtempSync(join(tmpdir(), "worknest-cloud-"));
  let app;
  try {
    delete process.env.APP_ORIGIN;
    process.env.RENDER_EXTERNAL_URL = "https://worknest-test.onrender.com";
    process.env.SETUP_TOKEN = "test-only-setup-token";
    app = createApp({
      dataDir: directory,
      production: true,
      allowedDomain: "company.test",
    });
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const request = (path, origin, body) =>
      fetch(base + path, {
        method: "POST",
        headers: {
          Origin: origin,
          "X-Worknest": "1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    const body = {
      workspace: "会社用",
      name: "管理者",
      email: "admin@company.test",
      password: "Company-test-password!",
      setupToken: process.env.SETUP_TOKEN,
      samples: false,
    };
    assert.equal(
      (await request("/api/auth/setup", "https://foreign.example", body))
        .status,
      403,
    );
    assert.equal((await request("/api/auth/setup", base, body)).status, 403);
    assert.equal(
      (await request("/api/auth/setup", process.env.RENDER_EXTERNAL_URL, body))
        .status,
      201,
    );
    assert.equal(app.store.get("settings", "workspace").name, "会社用");
    assert.equal(app.store.all("tasks").length, 0);
    const login = await request(
      "/api/auth/login",
      process.env.RENDER_EXTERNAL_URL,
      body,
    );
    assert.equal(login.status, 200);
    assert.match(login.headers.get("set-cookie"), /Secure/);
    assert.equal((await fetch(base + "/api/sales/bootstrap")).status, 401);
    process.env.APP_ORIGIN = "https://work.company.test";
    assert.equal(
      (await request("/api/auth/login", process.env.RENDER_EXTERNAL_URL, body))
        .status,
      403,
    );
    assert.equal(
      (await request("/api/auth/login", process.env.APP_ORIGIN, body)).status,
      200,
    );
  } finally {
    if (app) await app.close();
    rmSync(directory, { recursive: true, force: true });
    restoreEnv(saved);
  }
});
