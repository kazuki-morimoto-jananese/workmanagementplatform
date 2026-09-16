import { expect } from "@playwright/test";
import assert from "node:assert/strict";

export async function runSalesImprovementChecks(page, cloud) {
  await page.getByRole("button", { name: "施策・成果", exact: true }).click();
  await expect(
    page.getByText("記録を読み込み中…", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "施策を登録", exact: true }).click();
  const editor = page.locator(".improvement-editor");
  await editor.getByLabel("施策の対象アカウント").fill("account-browser");
  await page
    .getByRole("listbox", { name: "アカウント候補" })
    .getByRole("option")
    .first()
    .click();
  await editor.getByLabel("施策名", { exact: true }).fill("配信面の改善検証");
  await editor
    .getByLabel("提案・実施内容", { exact: true })
    .fill("LINE構成比を確認し、配信条件を調整する。");
  await editor
    .getByLabel("期待する成果", { exact: true })
    .fill("CVを維持してCPAを改善");
  const before = editor.getByLabel("実施前の分析・期間", { exact: true });
  await expect(before).toBeVisible();
  const option = await before
    .locator("option")
    .filter({ hasText: /LINEバイト.*2026-07-01/ })
    .first()
    .getAttribute("value");
  assert(option);
  const aid = option.split("|")[0];
  await before.selectOption(option);
  await editor
    .getByLabel("実施後の分析・期間", { exact: true })
    .selectOption(aid + "|1");
  await editor.getByLabel("実施日", { exact: true }).fill("2026-08-01");
  await editor.getByLabel("検証予定日", { exact: true }).fill("2026-09-01");
  await editor
    .getByLabel("施策の状態", { exact: true })
    .selectOption("reviewed");
  await editor.getByRole("button", { name: "施策を保存", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("CV");
  await editor
    .getByLabel("CV定義・比較条件", { exact: true })
    .fill("応募完了CV、全配信面、同じ抽出条件");
  await editor
    .getByLabel("期間・抽出条件・CV定義を確認した", { exact: true })
    .check();
  await editor
    .getByLabel("検証結果・次の判断", { exact: true })
    .fill("CPA上昇。計測と予算変更の影響を確認して継続検証。");
  await editor.getByRole("button", { name: "施策を保存", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.getByLabel("改善の担当者", { exact: true }).selectOption("all");
  const card = page
    .locator(".improvement-initiative")
    .filter({ hasText: "配信面の改善検証" });
  await expect(card).toContainText("検証済み");
  await expect(card).toContainText("応募完了CV");
  await expect(
    card.getByRole("row").filter({ hasText: "消化額（円）" }),
  ).toContainText("1,000");
  await card
    .getByLabel("施策「配信面の改善検証」のプロジェクト")
    .selectOption({ index: 1 });
  await card
    .getByRole("button", { name: "施策をタスク化", exact: true })
    .click();
  await expect(
    card.getByRole("button", { name: "施策タスクを開く", exact: true }),
  ).toBeVisible();
  await card
    .getByRole("button", { name: "変更履歴を表示", exact: true })
    .click();
  await expect(
    card.getByRole("heading", { name: "変更履歴", exact: true }),
  ).toBeVisible();
  await card
    .getByRole("button", { name: "変更履歴を閉じる", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "outcome cards fit mobile",
  );
  await page.screenshot({
    path: "artifacts/improvements-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.screenshot({
    path: "artifacts/improvements-desktop.png",
    fullPage: true,
  });
  await page.reload();
  await page
    .getByRole("button", { name: "営業・数字管理", exact: true })
    .click();
  await page.getByRole("button", { name: "施策・成果", exact: true }).click();
  await page.getByLabel("改善の担当者", { exact: true }).selectOption("all");
  await expect(card).toContainText("CPA上昇。");
  await page
    .getByRole("button", { name: "優先アクション", exact: true })
    .click();
  await page.getByLabel("改善の担当者", { exact: true }).selectOption("all");
  const action = page
    .locator(".improvement-action")
    .filter({ hasText: "配信面の改善検証" });
  await expect(action).toHaveCount(1);
  await action.getByLabel("対応", { exact: true }).selectOption("done");
  await action.getByLabel("対応メモ", { exact: true }).fill("会議で確認済み");
  await action.getByRole("button", { name: "対応を保存", exact: true }).click();
  await expect(action).toHaveCount(0);
  await page
    .getByLabel("優先アクションの状態", { exact: true })
    .selectOption("done");
  await expect(action).toContainText("会議で確認済み");
  await page
    .getByRole("button", { name: "対応・施策の記録を再読み込み", exact: true })
    .click();
  await expect(action).toContainText("会議で確認済み");
  await page.getByRole("button", { name: "データ連携", exact: true }).click();
  const usage = page.locator(".improvement-usage");
  await usage
    .getByRole("button", { name: "使用状況を確認・更新", exact: true })
    .click();
  await expect(usage).toContainText("無料枠の残量ではありません");
  if (cloud) await expect(usage).toContainText("SQL読込行数（観測分）");
  console.log(
    "Sales improvements browser passed: condition validation, snapshots, linked task, persisted action state, mobile, observed SQL usage.",
  );
}
