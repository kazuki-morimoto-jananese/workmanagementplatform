import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDriveCollection,
  accountMatch,
} from "../server/drive-collection.mjs";
test("Drive collection matches normalized names and never empty names", () => {
  assert.equal(
    accountMatch(["株式会社 ＡＢＣ"], "営業 / ABC / 定例"),
    "株式会社 ＡＢＣ",
  );
  assert.equal(accountMatch(["株式会社"], "会社 / 定例"), "");
  assert.equal(accountMatch(["別会社"], "ABC / 定例"), "");
});
test("Drive collection scopes settings and scans to user, traverses pages, reports denied folders and deduplicates documents", async () => {
  const records = new Map();
  const store = {
    get: (kind, id) => records.get(kind + id),
    put: (kind, v) => records.set(kind + v.id, v),
    all: (kind) =>
      [...records].filter(([k]) => k.startsWith(kind)).map(([, v]) => v),
  };
  store.put("salesAccounts", { id: "account", name: "株式会社ABC" });
  store.put("googleConnections", { id: "u", connectedAt: "one" });
  store.put("salesMinutes", {
    id: "existing",
    accountId: "account",
    googleFileId: "doc",
    supersededBy: "",
  });
  const mime = (name) => "application/vnd.google-apps." + name;
  const requests = [];
  const handler = createDriveCollection({
    store,
    requireScope: () => {},
    request: async (user, raw) => {
      const u = new URL(raw);
      requests.push(u);
      if (u.pathname.endsWith("/root"))
        return { name: "営業", mimeType: mime("folder"), driveId: "shared" };
      const q = u.searchParams.get("q");
      assert.equal(u.searchParams.get("driveId"), "shared");
      assert.equal(u.searchParams.get("corpora"), "drive");
      if (q.startsWith("'root'"))
        return {
          files: [
            { id: "child", name: "ABC", mimeType: mime("folder") },
            { id: "denied", name: "拒否", mimeType: mime("folder") },
          ],
        };
      if (q.startsWith("'denied'")) throw new Error("HTTP 403");
      if (u.searchParams.get("pageToken"))
        return {
          files: [
            { id: "doc", name: "定例", mimeType: mime("document") },
            { id: "root", name: "循環", mimeType: mime("folder") },
            { id: "shortcut", name: "リンク", mimeType: mime("shortcut") },
          ],
        };
      return {
        files: [{ id: "doc", name: "定例", mimeType: mime("document") }],
        nextPageToken: "next",
      };
    },
  });
  async function call(route, body = {}, user = "u", method = "POST") {
    let output;
    await handler({
      path: "/api/google/collection/" + route,
      method,
      user: { id: user },
      body,
      send: (_, v) => (output = v),
    });
    return output;
  }
  await assert.rejects(call("settings", { roots: ["bad'ID"] }));
  await call("settings", { roots: ["root"] });
  assert.deepEqual((await call("settings", {}, "other", "GET")).roots, []);
  const { scanId } = await call("start", { accountId: "account" });
  await assert.rejects(call("next", { scanId }, "other"), { status: 409 });
  assert.equal((await call("next", { scanId })).pending, 2);
  const second = await call("next", { scanId });
  assert.equal(second.files.length, 1);
  assert.equal(second.files[0].existingId, "existing");
  assert.equal(second.files[0].path, "営業 / ABC / 定例");
  const third = await call("next", { scanId });
  assert.equal(third.files.length, 0);
  const last = await call("next", { scanId });
  assert.equal(last.done, true);
  assert.equal(last.warnings.length, 2);
  assert(requests.every((u) => u.hostname === "www.googleapis.com"));
  store.put("googleConnections", { id: "u", connectedAt: "two" });
  await assert.rejects(call("next", { scanId }), { status: 409 });
});
