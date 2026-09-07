import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { openStoreDatabase } from "../server/store.mjs";
import {
  savePersonalTargets,
  withImportedForecast,
} from "../server/sales-targets.mjs";
import { personalPlan, importedReview } from "../src/sales-planning.ts";
import { createApp } from "../server/index.mjs";

test("personal monthly targets are separate from account budgets, versioned and audited", () => {
  const store = openStoreDatabase(new DatabaseSync(":memory:")),
    user = { id: "admin", role: "admin" };
  const body = {
    month: "2026-09",
    scope: "real",
    teamName: "営業",
    rows: [
      { ownerName: "営業 A", amount: 100 },
      { ownerName: "営業 B", amount: 200 },
    ],
  };
  const result = savePersonalTargets(store, body, user);
  assert.equal(result.version, 1);
  assert.throws(
    () => savePersonalTargets(store, body, { id: "member", role: "member" }),
    (e) => e.status === 403,
  );
  assert.throws(
    () => savePersonalTargets(store, body, user),
    (e) => e.status === 409,
  );
  assert.throws(() =>
    savePersonalTargets(
      store,
      {
        ...body,
        version: 1,
        rows: [
          { ownerName: "営業 A", amount: 1 },
          { ownerName: "営業Ａ", amount: 2 },
        ],
      },
      user,
    ),
  );
  const targets = store.all("salesPersonalTargets");
  const accounts = [
    { id: "a", ownerName: "営業Ａ" },
    { id: "b", ownerName: "営業 B" },
  ];
  const masters = {
    a: { target: 99999, gTrend: 0 },
    b: { target: 99999, gTrend: 150 },
  };
  const rows = personalPlan(
    accounts,
    targets,
    (a) => a.ownerName,
    (id) => masters[id],
    (id) => ({ forecast: id === "a" ? 80 : 190 }),
  );
  assert.equal(
    rows.reduce((s, r) => s + r.target, 0),
    300,
  );
  assert.equal(
    rows.reduce((s, r) => s + r.forecast, 0),
    270,
  );
  assert.equal(rows[0].trend, 0);
  savePersonalTargets(
    store,
    { ...body, scope: "demo", rows: [{ ownerName: "営業 A", amount: 0 }] },
    user,
  );
  savePersonalTargets(
    store,
    { ...body, month: "2026-10", rows: [{ ownerName: "営業 A", amount: "" }] },
    user,
  );
  assert.equal(store.all("salesPersonalTargets").length, 4);
  assert.ok(
    store.db
      .prepare(
        "SELECT count(*) AS n FROM audit_log WHERE kind='salesPersonalTargets'",
      )
      .get().n >= 4,
  );
  store.db.close();
});

test("old imported raw forecast and confidence are readable, including zero and missing values", () => {
  const m = withImportedForecast({
    id: "m",
    raw: {
      今月ヨミ: "1.5E5",
      アグレッシブ数字: "200000",
      "アグレッシブ：確度": "C",
    },
  });
  assert.equal(importedReview(m).forecast, 150000);
  assert.equal(importedReview(m).aggressiveConfidence, "C");
  assert.equal(importedReview(m).probability, null);
  assert.equal(
    withImportedForecast({ ...m, importedForecast: 0 }).importedForecast,
    0,
  );
  assert.equal(
    withImportedForecast({ ...m, importedForecast: null }).importedForecast,
    null,
  );
});

test("Excel forecasts display without seeding; explicit confidence saves preserve a weekly snapshot", async () => {
  const app = createApp({
    store: openStoreDatabase(new DatabaseSync(":memory:")),
    production: false,
    allowedDomain: "",
    timers: false,
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  let cookie = "";
  const base = "http://127.0.0.1:" + app.server.address().port;
  const call = async (path, body) => {
    const r = await fetch(base + "/api" + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Worknest": "1",
        Cookie: cookie,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json(), headers: r.headers };
  };
  try {
    const user = {
      email: "admin@example.test",
      password: "Testing-123456!",
      name: "Admin",
      workspace: "Test",
    };
    await call("/auth/setup", user);
    const login = await call("/auth/login", user);
    cookie = login.headers.get("set-cookie").split(";")[0];
    const values = [
      [
        "アカウントID",
        "アカウント名",
        "今月ヨミ",
        "アグレッシブ数字",
        "アグレッシブ：確度",
      ],
      ["001", "テスト社", "100", "200", "C"],
    ];
    assert.equal(
      (
        await call("/sales/imports/commit", {
          values,
          month: "2026-09",
          seedReviews: false,
        })
      ).status,
      200,
    );
    let state = (await call("/sales/bootstrap?month=2026-09")).data;
    assert.equal(state.reviews.length, 0);
    assert.equal(state.masters[0].importedForecast, 100);
    const change = {
      accountId: "001",
      month: "2026-09",
      weekOf: "2026-09-07",
      aggressiveConfidence: "A",
    };
    const saved = await call("/sales/reviews/confidence", change);
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.forecast, 100);
    assert.equal(
      (await call("/sales/reviews/confidence", { ...change, version: 0 }))
        .status,
      409,
    );
    values[1][2] = "150";
    await call("/sales/imports/commit", {
      values,
      month: "2026-09",
      seedReviews: false,
    });
    state = (await call("/sales/bootstrap?month=2026-09")).data;
    assert.equal(state.masters[0].importedForecast, 150);
    assert.equal(state.reviews[0].forecast, 100);
    assert.equal(state.reviews[0].aggressiveConfidence, "A");
  } finally {
    await app.close();
  }
});
