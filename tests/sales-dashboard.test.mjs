import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { openStoreDatabase } from "../server/store.mjs";
import {
  createDashboardService,
  defaultDashboard,
  dashboardRows,
} from "../server/sales-dashboard.mjs";
test("split label and monthly numeric ranges retain blank KPI rows and atomically reject partial failure", async () => {
  const store = openStoreDatabase(new DatabaseSync(":memory:"));
  const user = { id: "a", active: true, role: "admin", email: "a@test.local" };
  store.saveUser(user);
  const config = defaultDashboard("2026-09");
  config.authUserId = "a";
  config.version = 1;
  config.blocks = config.blocks
    .slice(0, 2)
    .map((b, i) => ({
      ...b,
      range: `Tab!AQ${i * 10 + 1}:AX${i * 10 + 3}`,
      labelRange: `Tab!A${i * 10 + 1}:${i ? "B" : "A"}${i * 10 + 3}`,
    }));
  store.put("salesDashboardSettings", config);
  let fail = false;
  const service = createDashboardService({
    store,
    sheetReader: async (c) => {
      if (fail && c.range.includes("11"))
        throw Object.assign(new Error("second block failed"), { status: 503 });
      if (c.range === "Tab!A1:A3")
        return { values: [["label"], ["group"], ["total"]] };
      if (c.range === "Tab!A11:B13")
        return {
          values: [
            ["担当", "グループ"],
            ["person", "RAG"],
            ["person2", "RDG"],
          ],
        };
      assert.equal(c.allowHeaderOnly, true);
      return { values: [["目標", "実績"]] };
    },
  });
  const call = async () => {
    let result;
    await service.handle({
      p: "/sales/dashboard/sync",
      method: "POST",
      body: { month: "2026-09" },
      user,
      reply: (_, v) => {
        result = v;
        return true;
      },
    });
    return result;
  };
  try {
    const result = await call();
    assert.equal(result.blocks[1].rows.length, 2);
    assert.equal(result.blocks[1].rows[0].cells[2], "");
    fail = true;
    await assert.rejects(call(), /second block/);
    assert.equal(store.all("salesDashboardSnapshots").length, 1);
  } finally {
    store.db.close();
  }
});
test("dashboard preserves formatted zero, ratios and source totals; group membership is source based", () => {
  const d = defaultDashboard("2026-09");
  const rows = dashboardRows(
    [[], ["全体", "0", "", "", "1,200", "120%", "60", "-20", "49%"]],
    d.blocks[0],
  );
  assert.equal(rows[0].cells[1], "0");
  assert.equal(rows[0].cells[7], "-20");
  const kpi = d.blocks[2];
  const grouped = dashboardRows(
    [
      [],
      ["人A", "総合企画", "10", "0", "0%"],
      ["人B", "RDG", "10", "4", "40%"],
      ["合計", "", 20, 4],
    ],
    kpi,
  );
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].group, "総合企画G");
  assert.throws(
    () => dashboardRows([[], ["人A", "RDG"], ["人A", "RDG"]], kpi),
    /重複/,
  );
});
test("independent dashboard connections enforce ownership, permissions, atomic snapshots and versioning", async () => {
  const store = openStoreDatabase(new DatabaseSync(":memory:"));
  const user = {
    id: "admin",
    active: true,
    role: "admin",
    email: "a@example.test",
  };
  store.saveUser(user);
  store.put("salesSettings", {
    id: "source",
    spreadsheetId: "original-source",
    enabled: true,
  });
  store.put("salesReviews", { id: "manual", forecast: 120 });
  let failure = false,
    reads = [];
  const service = createDashboardService({
    store,
    sheetReader: async (c) => {
      reads.push(c);
      if (failure) throw Object.assign(new Error("denied"), { status: 403 });
      return {
        values: [
          [],
          ["EPG", "0", "20", "10%", "200", "100%", "20", "-30", "50%"],
        ],
      };
    },
  });
  const call = async (path, body = {}, who = user, method = "POST") => {
    let result;
    await service.handle({
      p: "/sales/dashboard" + path,
      method,
      body,
      user: who,
      url: new URL("http://test?month=2026-09"),
      reply: (status, value) => {
        result = value;
        return true;
      },
    });
    return result;
  };
  try {
    const d = defaultDashboard("2026-09");
    d.spreadsheetId = "independent-sheet-id";
    d.blocks[0].range = "Tab!A1:I10";
    await assert.rejects(call("/settings", d, { role: "member" }), /管理者/);
    const saved = await call("/settings", { ...d, authUserId: "forged" });
    assert.equal(saved.authUserId, user.id);
    await assert.rejects(call("/settings", d), /更新/);
    await call("/preview", { month: d.month });
    assert.equal(store.all("salesDashboardSnapshots").length, 0);
    await call("/sync", { month: d.month });
    assert.equal(reads.at(-1).authMode, "user");
    assert.equal(reads.at(-1).spreadsheetId, d.spreadsheetId);
    assert.equal(store.get("salesReviews", "manual").forecast, 120);
    assert.equal(
      store.get("salesSettings", "source").spreadsheetId,
      "original-source",
    );
    failure = true;
    await assert.rejects(call("/sync", { month: d.month }), /denied/);
    assert.equal(store.all("salesDashboardSnapshots").length, 1);
    const response = await call("", {}, { role: "member" }, "GET");
    assert(response.snapshot);
    assert.equal(response.settings.lastError, "denied");
    failure = false;
    await call("/settings", {
      ...response.settings,
      enabled: true,
      syncTime: "00:00",
    });
    await service.tick();
    await service.tick();
    assert.equal(store.all("salesDashboardSnapshots").length, 2);
    store.saveUser({ ...user, active: false });
    await assert.rejects(call("/sync", { month: d.month }), /無効/);
  } finally {
    store.db.close();
  }
});
