import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { backupDatabase } from "../scripts/backup.mjs";
import { inspectPublicFile } from "../scripts/check-publish.mjs";
import { createApp } from "../server/index.mjs";

test("online backup includes committed WAL data and creates an independent restorable snapshot", async () => {
  const directory = mkdtempSync(join(tmpdir(), "worknest-backup-test-"));
  const source = new DatabaseSync(join(directory, "worknest.sqlite"));
  try {
    source.exec(
      "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE items(id INTEGER PRIMARY KEY, note TEXT); INSERT INTO items VALUES(1,'保存済みの議事録');",
    );
    assert.ok(existsSync(join(directory, "worknest.sqlite-wal")));
    const result = await backupDatabase({ dataDir: directory });
    assert.ok(result.bytes > 0);
    source.exec("INSERT INTO items VALUES(2,'バックアップ後の更新');");
    const restored = new DatabaseSync(result.path, { readOnly: true });
    try {
      assert.equal(
        restored.prepare("SELECT count(*) AS n FROM items").get().n,
        1,
      );
      assert.equal(
        restored.prepare("SELECT note FROM items").get().note,
        "保存済みの議事録",
      );
      assert.equal(
        source.prepare("SELECT count(*) AS n FROM items").get().n,
        2,
      );
    } finally {
      restored.close();
    }
    const second = await backupDatabase({ dataDir: directory });
    assert.notEqual(second.path, result.path);
  } finally {
    source.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("publication preflight rejects databases, env variants and common credential formats without rejecting templates", () => {
  for (const path of [
    "data/sales.json",
    ".env.production",
    "backup.sqlite",
    "credentials/key.pem",
    "artifacts/release.zip",
  ])
    assert.ok(inspectPublicFile(path).length, path);
  assert.deepEqual(inspectPublicFile(".env.example", "GEMINI_API_KEY=\n"), []);
  assert.ok(inspectPublicFile("config.json", "AIza" + "a".repeat(35)).length);
  assert.ok(
    inspectPublicFile("key.txt", "-----BEGIN " + "PRIVATE KEY-----").length,
  );
});

test("Japanese JSON input is preserved when network chunks split inside a UTF-8 character", async () => {
  const directory = mkdtempSync(join(tmpdir(), "worknest-utf8-test-"));
  const app = createApp({
    dataDir: directory,
    production: false,
    allowedDomain: "",
  });
  try {
    await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
    const payload = Buffer.from(
      JSON.stringify({
        name: "山田 花子",
        workspace: "営業の共有",
        email: "unicode@example.test",
        password: "Unicode-test-password!",
        samples: false,
      }),
    );
    const split = payload.indexOf(Buffer.from("山")) + 1;
    const status = await new Promise((resolve, reject) => {
      const request = http.request(
        {
          host: "127.0.0.1",
          port: app.server.address().port,
          path: "/api/auth/setup",
          method: "POST",
          headers: {
            "X-Worknest": "1",
            "Content-Type": "application/json",
            "Content-Length": payload.length,
          },
        },
        (response) => {
          response.resume();
          response.on("end", () => resolve(response.statusCode));
        },
      );
      request.on("error", reject);
      request.write(payload.subarray(0, split));
      setTimeout(() => request.end(payload.subarray(split)), 25);
    });
    assert.equal(status, 201);
    assert.equal(app.store.users()[0].name, "山田 花子");
    const health = await fetch(
      `http://127.0.0.1:${app.server.address().port}/api/health`,
    );
    assert.deepEqual(await health.json(), { status: "ok" });
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
