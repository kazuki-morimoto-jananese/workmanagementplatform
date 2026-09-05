import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../server/store.mjs";
import { seedSalesDemo, demoPeriods } from "../server/sales-demo.mjs";

test("three-month demo handles year boundaries, preserves real data and edited demo records", () => {
  const directory = mkdtempSync(join(tmpdir(), "worknest-demo-"));
  const store = openStore(directory);
  const admin = {
    id: "admin",
    name: "デモ管理者",
    email: "demo@example.test",
    active: true,
    role: "admin",
  };
  try {
    store.saveUser(admin);
    const real = { id: "real-account", name: "既存アカウント", version: 7 };
    store.put("salesAccounts", real);
    const result = seedSalesDemo(store, admin, { today: "2026-01-06" });
    assert.deepEqual(
      result.periods.map((p) => p.month),
      ["2025-12", "2026-01", "2026-02"],
    );
    assert.equal(store.all("salesAccounts").length, 7);
    assert.equal(store.all("salesMasters").length, 18);
    assert.equal(store.all("salesReviews").length, 53);
    assert.equal(store.all("salesOpportunities").length, 18);
    assert.equal(store.all("salesMinutes").length, 18);
    assert.equal(store.all("tasks").length, 18);
    assert.deepEqual(store.get("salesAccounts", real.id), real);
    const masters = store.all("salesMasters");
    for (const future of masters.filter((m) => m.month === "2026-02")) {
      assert.equal(future.media.stanby.spend, null);
      assert.equal(future.media.indeed.cv, null);
      assert.ok(future.target > 0);
    }
    for (const current of masters.filter((m) => m.month === "2026-01"))
      assert.equal(
        current.previousActual,
        masters.find(
          (m) => m.month === "2025-12" && m.accountId === current.accountId,
        ).media.stanby.spend,
      );
    const current = result.periods[1];
    assert.equal(
      store
        .all("salesReviews")
        .filter(
          (r) => r.month === current.month && r.weekOf === current.reportWeek,
        ).length,
      5,
    );
    for (const minute of store.all("salesMinutes")) {
      assert.equal(
        store.get("tasks", minute.taskLinks[0].taskId).minuteId,
        minute.id,
      );
      assert.ok(minute.text.includes(minute.summary.actions[0].evidence));
    }
    const edited = store.all("salesReviews")[0];
    delete edited.demoSet;
    edited.forecast = 123;
    store.put("salesReviews", edited);
    const again = seedSalesDemo(store, admin, { today: "2026-01-06" });
    assert.equal(again.totalCreated, 0);
    assert.equal(store.get("salesReviews", edited.id).forecast, 123);
    assert.throws(
      () => seedSalesDemo(store, { ...admin, role: "member" }),
      /管理者/,
    );
    assert.deepEqual(
      demoPeriods("2026-12-31").map((p) => p.month),
      ["2026-11", "2026-12", "2027-01"],
    );
  } finally {
    store.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("demo ID collision rolls back all additions", () => {
  const directory = mkdtempSync(join(tmpdir(), "worknest-demo-collision-"));
  const store = openStore(directory);
  const admin = {
    id: "admin",
    name: "管理者",
    email: "demo@example.test",
    active: true,
    role: "admin",
  };
  try {
    store.saveUser(admin);
    store.put("salesAccounts", { id: "demo-sfa-v1-02", name: "既存ID" });
    assert.throws(() => seedSalesDemo(store, admin), /競合/);
    assert.equal(store.all("salesAccounts").length, 1);
    assert.equal(store.all("projects").length, 0);
    assert.equal(store.all("salesMasters").length, 0);
  } finally {
    store.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
