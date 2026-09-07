import { test } from "node:test";
import assert from "node:assert/strict";
import {
  belongsTo,
  assignPlanningOrganizations,
} from "../src/sales-organization.ts";
import { savePersonalTargets } from "../server/sales-targets.mjs";
import { openStoreDatabase } from "../server/store.mjs";
import { DatabaseSync } from "node:sqlite";
test("organization rollups include descendants once; monthly assignments survive member transfers", () => {
  const units = [
    { id: "department", parentId: "", level: "department" },
    { id: "group", parentId: "department", level: "group" },
    { id: "team", parentId: "group", level: "team" },
  ];
  const rows = assignPlanningOrganizations(
    [
      { key: "a", target: 100, orgUnitId: "team" },
      { key: "b", target: 200, orgUnitId: "group" },
      { key: "c", target: 300, orgUnitId: "" },
    ],
    [
      { name: "a", orgUnitId: "other" },
      { name: "c", orgUnitId: "team" },
    ],
  );
  assert.equal(
    rows
      .filter((r) => belongsTo(units, r.orgUnitId, "department"))
      .reduce((s, r) => s + r.target, 0),
    300,
  );
  assert.equal(
    rows.filter((r) => belongsTo(units, r.orgUnitId, "team")).length,
    1,
  );
  assert.equal(
    rows.filter((r) => belongsTo(units, r.orgUnitId, "unassigned")).length,
    1,
  );
  assert.equal(
    belongsTo([{ id: "loop", parentId: "loop" }], "loop", "absent"),
    false,
  );
  const store = openStoreDatabase(new DatabaseSync(":memory:"));
  try {
    for (const unit of units) store.put("orgUnits", unit);
    const body = {
      month: "2026-09",
      scope: "real",
      teamName: "Dept",
      rows: [{ ownerName: "A", amount: 100, orgUnitId: "team" }],
    };
    savePersonalTargets(store, body, { id: "a", role: "admin" });
    savePersonalTargets(
      store,
      { ...body, version: 1, rows: [{ ownerName: "A", amount: 200 }] },
      { id: "a", role: "admin" },
    );
    assert.equal(store.all("salesPersonalTargets")[0].orgUnitId, "team");
    assert.throws(() =>
      savePersonalTargets(
        store,
        {
          ...body,
          version: 2,
          rows: [{ ownerName: "A", amount: 100, orgUnitId: "missing" }],
        },
        { id: "a", role: "admin" },
      ),
    );
  } finally {
    store.db.close();
  }
});
