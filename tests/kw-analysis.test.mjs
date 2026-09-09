import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeKw,
  normalizeRows,
  suggestMapping,
  parseDelimited,
  totals,
} from "../src/kw-analysis.ts";
const row = (keyword, company, cost, click, cv) => ({
  keyword,
  company,
  cost,
  click,
  cv,
  impression: 1000,
});
const periods = [
  { from: "2026-07-01", to: "2026-07-31" },
  { from: "2026-08-01", to: "2026-08-31" },
];
const sources = [
  { name: "a.csv", hash: "a".repeat(64), sheet: "CSV", count: 3 },
  { name: "b.csv", hash: "b".repeat(64), sheet: "CSV", count: 3 },
];
export const sampleInput = () => ({
  own: "OWN",
  periods,
  sources,
  before: [
    row("派遣", "OWN", 1000, 100, 10),
    row("軽作業", "OWN", 1000, 100, 10),
    row("派遣", "COMP", 1000000, 1000, 100),
  ],
  after: [
    row("派遣", "OWN", 2000, 100, 0),
    row("軽作業", "OWN", 1000, 100, 10),
    row("派遣", "COMP", 2000000, 1000, 100),
  ],
});
test("KW findings use own spend denominator even with much larger competitors; missing and zero are distinct", () => {
  const r = analyzeKw(sampleInput());
  assert.equal(r.after.cost, 3000);
  assert.equal(r.zeroCvCost, 2000);
  assert.equal(r.after.cpa, 300);
  assert(r.findings.some((f) => f.title.includes("CVゼロ")));
  assert.equal(r.rows.find((x) => x.keyword === "派遣").after.cpa, null);
  assert.equal(r.rows.find((x) => x.keyword === "派遣").index[0].cost, 100000);
  assert.equal(totals([row("x", "o", 100, 0, 0)]).cpc, null);
  assert.equal(totals([row("x", "o", 100, 100, 0)]).cvr, 0);
  assert.equal(totals([row("x", "o", null, 100, 10)]).cost, null);
  const missing = sampleInput();
  missing.after[0].cv = null;
  const m = analyzeKw(missing);
  assert.equal(m.after.cv, null);
  assert.equal(m.after.cpa, null);
  assert.equal(m.zeroCvCost, 0);
  assert.deepEqual(analyzeKw(sampleInput()), r);
});
test("KW file mapping preserves IDs, quoted CSV, validates duplicates, dates and count limits", () => {
  const table = parseDelimited(
    'keyword,company_key,cost,click,cv\r\n"a,b",000123,"1,000",10,0',
  );
  const rows = normalizeRows(table, suggestMapping(table[0]), 0);
  assert.equal(rows[0].keyword, "a,b");
  assert.equal(rows[0].company, "000123");
  assert.equal(rows[0].cost, 1000);
  assert.equal(rows[0].cv, 0);
  assert.throws(
    () => normalizeRows([...table, table[1]], suggestMapping(table[0]), 0),
    /重複/,
  );
  assert.throws(
    () => analyzeKw({ ...sampleInput(), periods: [periods[0], periods[0]] }),
    /重複/,
  );
  assert.throws(
    () =>
      analyzeKw({
        ...sampleInput(),
        periods: [{ from: "2026-02-30", to: "2026-03-01" }, periods[1]],
      }),
    /日付/,
  );
  assert.throws(
    () =>
      normalizeRows(
        [
          table[0],
          ...Array.from({ length: 10001 }, (_, i) => [
            "kw" + i,
            "own",
            "1",
            "1",
            "1",
          ]),
        ],
        suggestMapping(table[0]),
        0,
      ),
    /1万行/,
  );
});
test("KW handles ten thousand rows per period with stable top rows and explicit truncation", () => {
  const a = Array.from({ length: 10000 }, (_, i) =>
    row("kw" + i, "OWN", 100 + i, 10, 1),
  );
  const result = analyzeKw({
    own: "OWN",
    periods,
    sources,
    before: a,
    after: a,
  });
  assert.equal(result.entityCount, 10000);
  assert.equal(result.rows.length, 100);
  assert.equal(
    result.after.cost,
    a.reduce((s, r) => s + r.cost, 0),
  );
  assert(result.warnings.some((w) => w.includes("100件")));
});
