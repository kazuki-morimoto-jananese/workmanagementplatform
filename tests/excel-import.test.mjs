import { test } from "node:test";
import assert from "node:assert/strict";
import readExcelFile from "read-excel-file/node";
import { excelFixture } from "./excel-fixture.mjs";
import { headerRow, sheetText } from "../src/excel-import.ts";
import { buildPreview, numeric } from "../server/sales-import.mjs";

test("Excel scientific notation is an amount; zero and missing metrics remain optional", () => {
  assert.equal(numeric("1.2345678E7"), 12345678);
  assert.equal(numeric("6.2e+5"), 620000);
  assert.equal(numeric("1.25e-2"), 0.0125);
  assert.equal(numeric("０"), 0);
  for (const v of [null, "", "-", "—"]) assert.equal(numeric(v), null);
  for (const v of ["-1E7", "1E999", "1E", "NaN", "Infinity", "12円です"])
    assert.throws(() => numeric(v));
  const p = buildPreview({
    values: [
      ["アカウントID", "アカウント名", "前月実績", "今週Gトレ", "今月ヨミ"],
      ["0001", "架空の停止アカウント", "0", "0", ""],
      ["0002", "架空の未反映アカウント", "", "", ""],
      ["0003", "架空の指数表記アカウント", "1.2345678E7", "6.2e+5", "7e5"],
    ],
  });
  assert.deepEqual(p.errors, []);
  assert.equal(p.rows[0].gTrend, 0);
  assert.equal(p.rows[1].gTrend, null);
  assert.equal(p.rows[2].forecast, 700000);
});

test("Excel sheets preserve cached amounts, zero, blank, quoted names and text IDs", async () => {
  const workbook = await readExcelFile(excelFixture(), {
    parseNumber: (v) => v,
  });
  assert.deepEqual(
    workbook.map((s) => s.sheet),
    ["説明", "営業マスタ"],
  );
  const sheet = {
    name: workbook[1].sheet,
    rows: workbook[1].data.map((r) => r.map((v) => String(v ?? ""))),
  };
  assert.equal(headerRow(sheet.rows), 2);
  const preview = buildPreview({ text: sheetText(sheet, 2) });
  assert.deepEqual(preview.errors, []);
  assert.equal(preview.rows[0].gTrend, 620000);
  assert.equal(preview.rows[1].accountId, "0007");
  assert.equal(preview.rows[1].name, '架空の"Excel"社\nテスト部');
  assert.equal(preview.rows[1].gTrend, 0);
  assert.equal(preview.rows[1].forecast, null);
  assert.throws(() => sheetText(sheet, 0), /見出し行/);
  assert.throws(
    () =>
      sheetText(
        { name: "大規模", rows: Array.from({ length: 5002 }, () => ["a"]) },
        1,
      ),
    /5,000/,
  );
});
