import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { openStoreDatabase } from "../server/store.mjs";
import { buildPreview } from "../server/sales-import.mjs";
import {
  importQuality,
  saveMapping,
  mappingId,
} from "../server/import-quality.mjs";
import { createSalesService } from "../server/sales.mjs";

test("import checks distinguish zero/missing, retain ignored columns, prevent stale commits and link unique owners", () => {
  const store = openStoreDatabase(new DatabaseSync(":memory:"));
  try {
    const user = {
      id: "u",
      name: "森本 一輝",
      email: "u@example.test",
      active: true,
      role: "admin",
    };
    store.saveUser(user);
    const service = createSalesService({ store, activity: () => {} });
    const month = "2026-09";
    const values = [
      [
        "アカウントID",
        "アカウント名",
        "当月担当者",
        "今週Gトレ",
        "今月ヨミ",
        "前月実績",
      ],
      ["a", "Same", "森本一輝", 100, 200, 100],
      ["b", "Same", "未登録", 0, "", ""],
    ];
    service.commitImport({ values, month }, user);
    assert.equal(store.get("salesAccounts", "a").ownerId, "u");
    const preview = buildPreview({ values });
    let q = importQuality(store, preview, month);
    assert.equal(q.unchanged, 2);
    assert.equal(q.duplicateNames, 2);
    assert.equal(q.unlinked, 1);
    assert.equal(q.totals.find((t) => t.field === "gTrend").incoming.zero, 1);
    assert.equal(
      q.totals.find((t) => t.field === "forecast").incoming.missing,
      1,
    );
    values[1][3] = 0;
    const mapped = buildPreview({ values, mapping: { forecast: "" } });
    q = importQuality(store, mapped, month);
    const forecast = q.totals.find((t) => t.field === "forecast");
    assert.equal(forecast.mapped, false);
    assert.equal(forecast.after.total, 200);
    assert.equal(q.changed, 1);
    saveMapping(
      store,
      { headers: mapped.headers, mapping: mapped.mapping },
      user,
    );
    const preset = store.get("salesImportMappings", mappingId(mapped.headers));
    assert.equal(preset.mapping.forecast, "");
    assert.equal(
      buildPreview({ values, mapping: preset.mapping }).mapping.forecast,
      undefined,
    );
    service.commitImport(
      { values, mapping: preset.mapping, month, qualityToken: q.token },
      user,
    );
    assert.equal(
      store.get("salesMasters", JSON.stringify(["a", month])).importedForecast,
      200,
    );
    assert.throws(
      () =>
        service.commitImport(
          { values, mapping: preset.mapping, month, qualityToken: q.token },
          user,
        ),
      { status: 409 },
    );
    assert.equal(
      store.get("salesMasters", JSON.stringify(["a", month])).gTrend,
      0,
    );
    const old = store.get("salesAccounts", "b");
    store.saveUser({
      id: "v",
      name: "未登録",
      email: "v@example.test",
      active: true,
    });
    service.commitImport({ values, month }, user);
    assert.equal(old.ownerId, "");
    assert.equal(
      store.get("salesAccounts", "b").ownerId,
      "v",
      "newly registered member can be linked on next import",
    );
    assert(
      store.db
        .prepare("SELECT * FROM audit_log WHERE kind='salesImportMappings'")
        .all().length,
    );
  } finally {
    store.db.close();
  }
});
