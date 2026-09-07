import { expect } from "@playwright/test";
import assert from "node:assert/strict";
export async function runCrmBrowserChecks(page) {
  await page
    .getByRole("button", { name: "営業・数字管理", exact: true })
    .click();
  await page.getByRole("button", { name: "顧客・リード", exact: true }).click();
  const panel = page.getByRole("region", {
    name: "顧客・リード管理",
    exact: true,
  });
  await panel
    .getByRole("button", { name: "顧客担当者を追加", exact: true })
    .click();
  await panel.getByLabel("氏名", { exact: true }).fill("テスト顧客担当");
  await panel.getByLabel("会社名", { exact: true }).fill("テスト顧客会社");
  await panel.getByLabel("施策名", { exact: true }).fill("紹介キャンペーン");
  await panel.getByLabel("次回連絡日", { exact: true }).fill("2026-09-15");
  await panel
    .getByRole("button", { name: "顧客担当者を保存", exact: true })
    .click();
  await expect(
    panel.getByRole("cell", { name: "テスト顧客会社", exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "編集・履歴", exact: true }).click();
  await panel
    .getByRole("button", {
      name: "保存済みの内容からフォロータスクを作成",
      exact: true,
    })
    .click();
  await expect(panel.getByRole("status")).toContainText("フォロータスク");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: ".browser-check-crm-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.getByRole("button", { name: "データ連携", exact: true }).click();
  const integrations = page.getByRole("region", {
    name: "汎用連携と導入確認",
    exact: true,
  });
  await expect(
    integrations.getByRole("heading", {
      name: "運用開始チェック",
      exact: true,
    }),
  ).toBeVisible();
  await integrations.getByLabel("連携元の名前").fill("テスト連携元");
  await integrations
    .getByRole("button", { name: "受付専用トークンを発行", exact: true })
    .click();
  await expect(integrations.getByLabel("発行した連携トークン")).toHaveAttribute(
    "type",
    "password",
  );
  await integrations
    .getByRole("button", { name: "表示を閉じる", exact: true })
    .click();
  await integrations
    .getByRole("button", { name: "失効させる", exact: true })
    .click();
  await expect(integrations).toContainText("失効済み");
  await page.getByRole("button", { name: "営業サマリー", exact: true }).click();
  const org = page.getByLabel("営業サマリーの組織", { exact: true });
  await org.selectOption("unassigned");
  await expect(org).toHaveValue("unassigned");
  await org.selectOption("all");
  const targets = page.getByRole("region", {
    name: "個人目標と予実",
    exact: true,
  });
  await targets
    .getByRole("button", { name: "個人目標を編集", exact: true })
    .click();
  await targets
    .getByRole("combobox", { name: /の目標所属/ })
    .first()
    .selectOption({
      label:
        "テスト株式会社 / 人材事業部 / 営業第一部 / 営業グループ / 第一チーム",
    });
  await targets
    .getByRole("button", { name: "個人目標を保存", exact: true })
    .click();
  await expect(
    targets.getByRole("button", { name: "個人目標を編集", exact: true }),
  ).toBeVisible();
  await org.selectOption({
    label: "テスト株式会社 / 人材事業部 / 営業第一部 / 営業グループ",
  });
  await expect(
    page.getByRole("region", { name: "組織別営業サマリー", exact: true }),
  ).toContainText("第一チーム");
  await org.selectOption("all");
  console.log(
    "CRM browser passed: contact, campaign, follow-up task, mobile, integration token and organization filter.",
  );
}
