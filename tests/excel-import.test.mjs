import { test } from "node:test";
import assert from "node:assert/strict";
import readExcelFile from "read-excel-file/node";
import { excelFixture } from "./excel-fixture.mjs";
import { headerRow, sheetText } from "../src/excel-import.ts";
import { buildPreview } from "../server/sales-import.mjs";

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
