import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import { kwExcelFixture } from "./kw-excel-fixture.mjs";
export async function runMeetingPrepBrowserChecks(page) {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page
    .getByRole("button", { name: "営業・数字管理", exact: true })
    .click();
  await page.getByLabel("表示データ", { exact: true }).selectOption("real");
  await page
    .getByRole("button", { name: "商談準備・分析", exact: true })
    .click();
  await page
    .getByLabel("商談準備の対象アカウント")
    .selectOption("account-browser");
  await page
    .getByLabel("今回の議題")
    .fill("KWの消化増とCVゼロについて確認する");
  await page.getByRole("button", { name: "議題を保存", exact: true }).click();
  await expect(
    page.getByText("議題を保存しました", { exact: true }),
  ).toBeVisible();
  const header = "keyword,company_key,cost,click,cv,impression\n";
  const a =
    header +
    "派遣,OWN,1000,100,10,1000\n軽作業,OWN,1000,100,10,1000\n派遣,COMP,1000000,1000,100,10000";
  const b =
    header +
    "派遣,OWN,2000,100,0,1000\n軽作業,OWN,1000,100,10,1000\n派遣,COMP,2000000,1000,100,10000";
  await page.getByLabel("期間Aファイル", { exact: true }).setInputFiles({
    name: "before.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: kwExcelFixture(),
  });
  await page
    .getByLabel("期間Aシート", { exact: true })
    .selectOption({ label: "KW実績" });
  await page.getByLabel("期間A見出し行", { exact: true }).fill("2");
  await expect(page.getByLabel("期間Aキーワード", { exact: true })).toHaveValue(
    "0",
  );
  await page.getByLabel("期間Bファイル", { exact: true }).setInputFiles({
    name: "after.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(b),
  });
  await expect(page.getByLabel("期間Bキーワード", { exact: true })).toHaveValue(
    "0",
  );
  await page.getByLabel("期間A開始日").fill("2026-07-01");
  await page.getByLabel("期間A終了日").fill("2026-07-31");
  await page.getByLabel("期間B開始日").fill("2026-08-01");
  await page.getByLabel("期間B終了日").fill("2026-08-31");
  await page.getByLabel("分析の自社", { exact: true }).selectOption("OWN");
  await page.getByRole("checkbox", { name: /選択した自社は/ }).check();
  await page
    .getByRole("button", { name: "期間比較を実行", exact: true })
    .click();
  await expect(
    page.getByText("期間B：CVゼロのKWへの消化額 ¥2,000", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("提案文", { exact: true })
    .first()
    .fill("計測を確認し、次回の配信テストを相談する。");
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/sales/preparation/analyses") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "分析・提案を共有保存", exact: true })
    .click();
  const saved = await (await response).json();
  assert(saved.id);
  assert.equal(saved.report.after.cost, 3000);
  assert.equal(saved.report.sources[0].mapping.keyword, 0);
  await expect(
    page.getByRole("button", { name: "分析・提案を保存済み", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("分析タスクのプロジェクト", { exact: true })
    .selectOption({ index: 1 });
  await page
    .getByRole("button", { name: "根拠付きでタスク化", exact: true })
    .first()
    .click();
  await expect(page.getByText(/根拠付きタスクを作成しました/)).toBeVisible();
  await page
    .getByRole("button", { name: "根拠付きでタスク化", exact: true })
    .first()
    .click();
  const count = await page.evaluate(async (id) => {
    const data = await (await fetch("/api/bootstrap")).json();
    return data.tasks.filter((t) => t.description.includes(id)).length;
  }, saved.id);
  assert.equal(count, 1);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.evaluate(() => {
    window.print = () => {};
  });
  await page
    .getByRole("button", { name: "印刷・PDF保存", exact: true })
    .click();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("#worknest-printout")).toBeVisible();
  await expect(page.locator(".app-shell")).toBeHidden();
  const pdf = await page.pdf({ format: "A4" });
  assert(pdf.length > 2000);
  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => dispatchEvent(new Event("afterprint")));
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.reload();
  await page
    .getByRole("button", { name: "営業・数字管理", exact: true })
    .click();
  await page
    .getByRole("button", { name: "商談準備・分析", exact: true })
    .click();
  await page
    .getByLabel("商談準備の対象アカウント")
    .selectOption("account-browser");
  await expect(page.getByLabel("今回の議題")).toHaveValue(
    "KWの消化増とCVゼロについて確認する",
  );
  await page.getByRole("button", { name: /^KW期間比較 · / }).click();
  await expect(
    page.getByText("期間B：CVゼロのKWへの消化額 ¥2,000", { exact: true }),
  ).toBeVisible();
  console.log(
    "Meeting preparation passed: agenda persistence, CSV mapping, deterministic own/competitor analysis, edited proposal, snapshot history, idempotent linked task, mobile and PDF isolation.",
  );
}
