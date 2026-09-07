import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { excelFixture } from "./excel-fixture.mjs";
export async function runExcelBrowserChecks(page) {
  await page
    .getByRole("button", { name: "営業・数字管理", exact: true })
    .click();
  await page.getByRole("button", { name: "データ連携", exact: true }).click();
  const state = () =>
    page.evaluate(async () => (await fetch("/api/sales/bootstrap")).json());
  const before = await state();
  const file = page.getByLabel("営業マスタファイル", { exact: true });
  const payload = {
    name: "週次営業.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: excelFixture(),
  };
  await file.setInputFiles(payload);
  await page
    .getByLabel("Excelの対象シート")
    .selectOption({ label: "営業マスタ" });
  await expect(page.getByLabel("Excelの見出し行")).toHaveValue("2");
  assert.deepEqual(
    (await state()).masters,
    before.masters,
    "File selection must not save data",
  );
  await page
    .getByRole("button", { name: "取込内容を確認", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "2 件のプレビュー", exact: true })
    .waitFor();
  await page.getByLabel("Excelの対象シート").selectOption({ label: "説明" });
  await expect(
    page.getByRole("button", { name: "この内容で取り込む", exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Excelの対象シート")
    .selectOption({ label: "営業マスタ" });
  await page
    .getByRole("button", { name: "取込内容を確認", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "2 件のプレビュー", exact: true })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("region", { name: "ヨミの列対応" }),
  ).toBeVisible();
  await expect(page.getByLabel("対応列 今月ヨミ", { exact: true })).toHaveValue(
    "3",
  );
  await page.getByLabel("対応列 今月ヨミ", { exact: true }).selectOption("");
  await expect(
    page.getByRole("button", { name: "この内容で取り込む", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("対応列 今月ヨミ", { exact: true }).selectOption("3");
  await page
    .getByRole("button", { name: "取込内容を確認", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "この内容で取り込む", exact: true }),
  ).toBeEnabled();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page
    .getByRole("button", { name: "この内容で取り込む", exact: true })
    .click();
  await expect(page.getByLabel("営業マスタ貼り付け")).toHaveValue("");
  const after = await state();
  assert.equal(after.accounts.filter((a) => a.id === "0007").length, 1);
  assert.deepEqual(
    after.reviews,
    before.reviews,
    "Excel update preserves hand-entered forecasts",
  );
  assert.ok(
    after.imports.some((i) =>
      i.sourceName.includes("週次営業.xlsx / 営業マスタ"),
    ),
  );
  await file.setInputFiles({
    name: "破損.xlsx",
    mimeType: payload.mimeType,
    buffer: Buffer.from("not an Excel file"),
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "Excelを読み取れませんでした" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "取込内容を確認", exact: true }),
  ).toBeDisabled();
  await file.setInputFiles(payload);
  await page
    .getByLabel("Excelの対象シート")
    .selectOption({ label: "営業マスタ" });
  await page
    .getByRole("button", { name: "取込内容を確認", exact: true })
    .click();
  await page
    .getByRole("button", { name: "この内容で取り込む", exact: true })
    .click();
  await expect(page.getByLabel("営業マスタ貼り付け")).toHaveValue("");
  assert.equal(
    (await state()).accounts.filter((a) => a.id === "0007").length,
    1,
  );
  console.log(
    "Excel browser passed: multi-sheet, header row, preview invalidation, import history, repeat import, forecast preservation, invalid file and mobile.",
  );
}
