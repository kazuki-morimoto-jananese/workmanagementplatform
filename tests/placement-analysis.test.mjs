import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyPlacement,
  suggestPlacementMapping,
  normalizePlacementRows,
  analyzePlacement,
} from "../src/placement-analysis.ts";
const header = [
  "period_date",
  "account_id",
  "campaign_id",
  "campaign_name",
  "publisher_category",
  "impression",
  "click",
  "cost",
  "cv",
];
const mapping = suggestPlacementMapping(header);
const periods = [
  { from: "2026-07-01", to: "2026-07-31" },
  { from: "2026-08-01", to: "2026-08-31" },
];
const row = (
  date,
  publisher,
  cost,
  cv,
  company = "OWN",
  campaign = "9000000000000000001",
) => [
  date,
  company,
  campaign,
  "採用",
  publisher,
  "1000",
  "100",
  String(cost),
  String(cv),
];
export function placementFixtureInput() {
  const before = normalizePlacementRows(
    [
      header,
      row("2026-07-01", "LINE", 100, 1),
      row("2026-07-01", "non-LINE", 300, 3),
      row("2026-07-01", "", 100, 1),
      row("2026-07-01", "LINE", 1000000, 100, "OTHER"),
    ],
    mapping,
    0,
    "daily",
  );
  const after = normalizePlacementRows(
    [
      header,
      row("2026-08-01", "LINEバイト", 400, 1),
      row("2026-08-01", "non-LINE", 200, 4),
      row("2026-08-01", "UNKNOWN", 400, 0),
      row("2026-09-01", "LINE", 8000, 80),
    ],
    mapping,
    0,
    "daily",
  );
  return {
    before,
    after,
    own: "OWN",
    periods,
    granularity: "daily",
    sources: ["a", "b"].map((s) => ({
      name: s + ".csv",
      sheet: "CSV",
      hash: s.repeat(64),
      count: 4,
      mapping,
    })),
  };
}
test("Placement uses Hub columns, exact LINE categories and excludes other accounts and dates", () => {
  assert.deepEqual(
    [
      "LINE",
      "ＬＩＮＥ",
      "line baito",
      " LINEバイト ",
      "non-LINE",
      "UNKNOWN",
      "",
      "Line広告",
    ].map(classifyPlacement),
    [
      "LINE",
      "LINE",
      "LINE",
      "LINE",
      "non-LINE",
      "UNKNOWN",
      "UNKNOWN",
      "non-LINE",
    ],
  );
  const input = placementFixtureInput(),
    r = analyzePlacement(input);
  assert.equal(input.before[0].campaignId, "9000000000000000001");
  assert.equal(r.calculationVersion, "placement-v1");
  assert.equal(r.before.cost, 500);
  assert.equal(r.after.cost, 1000);
  assert.equal(r.after.cv, 5);
  assert.equal(r.after.cpa, 200);
  assert.deepEqual(r.placement.usedCounts, [3, 3]);
  assert.deepEqual(r.placement.inputCounts, [4, 4]);
  assert.equal(r.rows.find((r) => r.keyword === "LINE").share, 0.4);
  assert.equal(r.placement.campaignCount, 3);
  assert.equal(r.zeroCvCost, 400);
  assert.match(r.findings[0].title, /LINE構成比上昇とCPA差/);
  assert.match(r.findings[0].evidence, /20.0%.*40.0%/);
  assert(r.rows.every((row) => row.index.length === 0));
  assert.deepEqual(r, analyzePlacement(input));
});
test("Placement preserves missing vs zero, validates date grain, semantic duplicates and required mapping", () => {
  const input = placementFixtureInput();
  input.after[0].cv = null;
  const r = analyzePlacement(input);
  assert.equal(r.after.cv, null);
  assert.equal(r.after.cpa, null);
  assert.equal(r.rows.find((r) => r.keyword === "LINE").after.cpa, null);
  const repeated = row("2026-07-01", "LINE", 100, 0);
  assert.throws(
    () =>
      normalizePlacementRows(
        [header, repeated, [...repeated.slice(0, 7), "200", "0"]],
        mapping,
        0,
        "daily",
      ),
    /重複/,
  );
  assert.throws(
    () =>
      normalizePlacementRows(
        [header, row("2026-02-30", "LINE", 100, 0)],
        mapping,
        0,
        "daily",
      ),
    /日付/,
  );
  assert.throws(
    () =>
      normalizePlacementRows(
        [header, repeated],
        { ...mapping, date: -1 },
        0,
        "daily",
      ),
    /列/,
  );
  assert.throws(
    () =>
      normalizePlacementRows(
        [header, row("2026-07-01", "合計", 100, 0)],
        mapping,
        0,
        "daily",
      ),
    /合計/,
  );
  assert.throws(
    () =>
      analyzePlacement({
        ...placementFixtureInput(),
        granularity: "monthly",
        periods: [{ from: "2026-07-02", to: "2026-07-31" }, periods[1]],
      }),
    /月初/,
  );
  assert.equal(
    normalizePlacementRows(
      [header, row("2026年7月", "LINE", 100, 0)],
      mapping,
      0,
      "monthly",
    )[0].date,
    "2026-07-01",
  );
  assert.throws(
    () =>
      normalizePlacementRows(
        [header, row("2026-07", "LINE", 100, 0)],
        mapping,
        0,
        "daily",
      ),
    /日付/,
  );
  assert.throws(
    () =>
      normalizePlacementRows(
        [
          header,
          row("2026-07-01", "LINE", 100, 0, "OWN", "PLACEMENT_TOTAL"),
          row("2026-07-01", "LINE", 100, 0),
        ],
        mapping,
        0,
        "daily",
      ),
    /混在/,
  );
  assert.throws(
    () =>
      normalizePlacementRows(
        [
          header,
          ...Array.from({ length: 10001 }, (_, i) =>
            row("2026-07-01", "LINE", 1, 0, "OWN", String(i)),
          ),
        ],
        mapping,
        0,
        "daily",
      ),
    /10,000/,
  );
});
test("Large placement files keep total metrics while limiting campaign details", () => {
  const raw = Array.from({ length: 10000 }, (_, i) =>
    row("2026-07-01", i % 2 ? "LINE" : "non-LINE", 1, 0, "OWN", String(i)),
  );
  const before = normalizePlacementRows([header, ...raw], mapping, 0, "daily"),
    after = before.map((r) => ({ ...r, date: "2026-08-01" }));
  const r = analyzePlacement({ ...placementFixtureInput(), before, after });
  assert.equal(r.after.cost, 10000);
  assert.equal(r.placement.campaignCount, 10000);
  assert.equal(r.placement.campaigns.length, 80);
  assert(Buffer.byteLength(JSON.stringify(r)) < 120000);
});
