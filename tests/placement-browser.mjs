import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import { kwExcelFixture } from "./kw-excel-fixture.mjs";
export async function runPlacementBrowserChecks(page) {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page
    .getByLabel("分析するデータ", { exact: true })
    .selectOption("placement");
  await expect(
    page.getByRole("heading", {
      name: "LINEバイト・配信面データから分析・提案を作成",
      exact: true,
    }),
  ).toBeVisible();
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
  const row = (publisher, cost, cv) => [
    "2026-07-01",
    "OWN",
    "9000000000000000001",
    "採用キャンペーン",
    publisher,
    1000,
    100,
    cost,
    cv,
  ];
  await page
    .getByLabel("期間Aファイル", { exact: true })
    .setInputFiles({
      name: "placement-before.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: kwExcelFixture(
        [
          ["配信面レポート"],
          header,
          row("LINE", 100, 1),
          row("non-LINE", 300, 3),
          row("UNKNOWN", 100, 1),
        ],
        "配信面実績",
      ),
    });
  await page
    .getByLabel("期間Aシート", { exact: true })
    .selectOption({ label: "配信面実績" });
  await page.getByLabel("期間A見出し行", { exact: true }).fill("2");
  await expect(page.getByLabel("期間A配信面", { exact: true })).toHaveValue(
    "4",
  );
  await expect(
    page.getByLabel("期間A日付（period_date）", { exact: true }),
  ).toHaveValue("0");
  const after =
    "publisher_category,cost,cv,click,impression,account_id,period_date,campaign_id,campaign_name\nLINEバイト,400,1,100,1000,OWN,2026-08-01,9000000000000000001,採用キャンペーン\nnon-LINE,200,4,100,1000,OWN,2026-08-01,9000000000000000001,採用キャンペーン\nUNKNOWN,400,0,100,1000,OWN,2026-08-01,9000000000000000001,採用キャンペーン\nLINE,9000,9,900,9000,OWN,2026-09-01,9000000000000000001,採用キャンペーン";
  await page
    .getByLabel("期間Bファイル", { exact: true })
    .setInputFiles({
      name: "placement-after.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(after),
    });
  await expect(page.getByLabel("期間B配信面", { exact: true })).toHaveValue(
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
    page.getByRole("table", { name: "配信面別の期間比較" }),
  ).toContainText("UNKNOWN");
  await expect(
    page.getByRole("table", { name: "キャンペーン別の配信面比較" }),
  ).toContainText("9000000000000000001");
  await expect(page.locator(".placement-report")).toContainText(
    "期間B 4行中3行",
  );
  await expect(
    page.getByRole("heading", {
      name: "LINE構成比上昇とCPA差を確認",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByLabel("提案文", { exact: true })
    .first()
    .fill("LINEの配信構成とCV計測を確認してからテスト条件を相談する。");
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/sales/preparation/analyses") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "分析・提案を共有保存", exact: true })
    .click();
  const result = await response;
  assert.equal(result.status(), 201);
  const saved = await result.json();
  assert.equal(saved.report.calculationVersion, "placement-v1");
  assert.equal(saved.report.after.cost, 1000);
  assert.equal(saved.report.after.cpa, 200);
  assert.deepEqual(saved.report.placement.usedCounts, [3, 3]);
  await page
    .getByLabel("分析タスクのプロジェクト", { exact: true })
    .selectOption({ index: 1 });
  await page
    .getByRole("button", { name: "根拠付きでタスク化", exact: true })
    .first()
    .click();
  await expect(
    page.getByText(
      "根拠付きタスクを作成しました（作成済みの場合は再作成しません）。",
      { exact: true },
    ),
  ).toBeVisible();
  await page.evaluate(() => {
    window.print = () => {};
  });
  await page
    .getByRole("button", { name: "印刷・PDF保存", exact: true })
    .click();
  await expect(page.locator("#worknest-printout")).toContainText(
    "LINE構成比上昇とCPA差",
  );
  await page.emulateMedia({ media: "print" });
  assert((await page.pdf({ format: "A4" })).length > 2000);
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await page.emulateMedia({ media: "screen" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.reload();
  await page
    .getByRole("button", { name: "営業・数字管理", exact: true })
    .click();
  await page
    .getByRole("button", { name: "商談準備・分析", exact: true })
    .click();
  await page.getByLabel("商談準備の対象アカウント").fill("account-browser");
  await page
    .getByRole("listbox", { name: "アカウント候補" })
    .getByRole("option")
    .first()
    .click();
  await page
    .getByRole("button", { name: /^LINEバイト・配信面期間比較 · / })
    .click();
  await expect(
    page.getByRole("table", { name: "配信面別の期間比較" }),
  ).toBeVisible();
  await expect(page.locator(".kw-report")).toContainText(
    "LINEの配信構成とCV計測を確認",
  );
  console.log(
    "Placement browser passed: XLSX/CSV reordered mapping, dates, LINE/non-LINE/UNKNOWN, own totals, campaign IDs, edited proposal, saved history, linked task, PDF, mobile.",
  );
}
