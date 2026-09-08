import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { openStoreDatabase } from "../server/store.mjs";
import {
  directoryPreview,
  createDirectoryService,
} from "../server/account-directory.mjs";
const headers = [
  "No.",
  "アカウントID",
  "アカウント名",
  "代理店名",
  "商流経路",
  "個社・求人メディアフラグ",
  "スタンバイ業種_大分類",
  "スタンバイ業種_中分類",
  "開設日",
  "アカウントステータス",
  "カテゴリ",
  "当月担当Ｇ",
  "当月担当者",
];
const nums = [
  "当月累計実績\n（1日～前日まで）",
  "前日実績",
  "Gトレンド",
  "アカウント\n月予算",
];
const row = (aid, owner = "担当 一") => [
  "1",
  aid,
  "顧客" + aid,
  "代理店",
  "直販",
  "個社",
  "業種",
  "中分類",
  "",
  "利用中",
  "TOP30",
  "EPG",
  owner,
];
test("account directory preserves string IDs, zeros, row alignment, blanks and detects duplicates and invalid amounts", () => {
  const p = directoryPreview(
    [headers, row("921560879047114752"), [], row("id2")],
    [nums, ["0", "0", "0", "1,000"], [], ["12", "", "15", ""]],
  );
  assert.equal(p.errors.length, 0);
  assert.equal(p.rows[0].accountId, "921560879047114752");
  assert.equal(p.rows[0].budget, 1000);
  assert.equal(p.rows[0].monthActual, 0);
  assert.equal(p.rows[1].yesterdayActual, null);
  assert.equal(p.rows[1].monthActual, 12);
  assert.match(
    directoryPreview([headers, row("a"), row("a")], [nums]).errors[0],
    /重複/,
  );
  assert(
    directoryPreview([headers, row("a")], [nums, ["#REF!"]]).errors.length,
  );
  assert.throws(
    () => directoryPreview([["アカウントID"], ["x"]], [nums]),
    /見出し/,
  );
});
test("directory sync paginates personal accounts, includes appended rows, isolates monthly history and leaves legacy sales untouched", async () => {
  const store = openStoreDatabase(new DatabaseSync(":memory:"));
  const user = {
    id: "admin",
    name: "担当",
    email: "a@test.local",
    role: "admin",
    active: true,
  };
  store.saveUser(user);
  store.saveUser({
    id: "other",
    name: "担当 二",
    email: "b@test.local",
    role: "member",
    active: true,
  });
  store.put("salesAccounts", {
    id: "existing",
    name: "編集済み",
    projectId: "project",
    version: 7,
  });
  store.put("salesReviews", { id: "review", forecast: 999 });
  store.put("salesSettings", { id: "source", range: "legacy" });
  let rows = [
      row("existing"),
      ...Array.from({ length: 54 }, (_, i) => row("id" + i)),
      row("other", "担当 二"),
    ],
    bad = false,
    monthHeader = "9月";
  const reads = [];
  const service = createDirectoryService({
    store,
    sheetReader: async (c) => {
      reads.push(c);
      if (c.range.includes("AW3")) return { values: [[monthHeader], nums] };
      if (c.range.includes("A4:M")) return { values: [headers, ...rows] };
      return {
        values: [nums, ...rows.map(() => [bad ? "#REF!" : "0", "1", "2", "3"])],
      };
    },
  });
  const call = async (
    path = "",
    body = {},
    actor = user,
    query = "month=2026-09",
  ) => {
    let value;
    await service.handle({
      p: "/sales/directory" + path,
      method: path ? "POST" : "GET",
      body,
      user: actor,
      url: new URL("https://test?" + query),
      reply: (_, r) => {
        value = r;
        return true;
      },
    });
    return value;
  };
  try {
    const config = {
      version: 0,
      month: "2026-09",
      spreadsheetId: "test-spreadsheet-id",
      infoRange: "'Sheet'!A4:M",
      monthRange: "'Sheet'!AW4:AZ",
      enabled: false,
      syncTime: "00:00",
      ownerLinks: { "担当 一": "admin" },
      authUserId: "other",
    };
    await assert.rejects(
      call("/settings", config, { role: "member" }),
      /管理者/,
    );
    const saved = await call("/settings", config);
    assert.equal(saved.authUserId, "admin");
    await assert.rejects(call("/settings", config), /更新/);
    assert.equal((await call("/preview")).count, 56);
    assert.equal(store.all("salesDirectoryAccounts").length, 0);
    const synced = await call("/sync");
    assert.equal(synced.created, 55);
    assert.deepEqual(store.get("salesAccounts", "existing"), {
      id: "existing",
      name: "編集済み",
      projectId: "project",
      version: 7,
    });
    assert.equal(store.get("salesReviews", "review").forecast, 999);
    assert.equal(store.get("salesSettings", "source").range, "legacy");
    const mine = await call();
    assert.equal(mine.count, 55);
    assert.equal(mine.rows.length, 50);
    assert.equal(mine.totalPages, 2);
    assert.equal(
      (await call("", {}, user, "month=2026-09&owner=担当 二")).count,
      1,
    );
    assert.equal(
      (await call("", {}, user, "month=2026-09&owner=all")).count,
      56,
    );
    assert.equal((await call("/sync")).changed, 0);
    rows.push(row("appended"));
    assert.equal((await call("/sync")).created, 1);
    rows = rows.filter((r) => r[1] !== "id0");
    await call("/sync");
    assert.equal(
      store.get("salesDirectoryAccounts", JSON.stringify(["2026-09", "id0"]))
        .present,
      false,
    );
    assert(store.get("salesAccounts", "id0"));
    bad = true;
    await assert.rejects(call("/sync"), /数値/);
    assert.equal((await call()).count, 55);
    bad = false;
    monthHeader = "8月";
    await assert.rejects(call("/preview"), /対象月/);
    monthHeader = "9月";
    await call("/settings", { ...saved, enabled: true });
    await service.tick();
    const n = reads.length;
    await service.tick();
    assert.equal(reads.length, n);
    store.saveUser({ ...user, active: false });
    await assert.rejects(call("/sync"), /管理者/);
  } finally {
    store.db.close();
  }
});
