import { expect } from "@playwright/test";
import assert from "node:assert/strict";

export async function runCustomerHubChecks(page) {
  const selectAccount = async (label) => {
    await page.getByLabel(label, { exact: true }).fill("account-browser");
    await page
      .getByRole("listbox", { name: "アカウント候補" })
      .getByRole("option")
      .first()
      .click();
  };
  await page.getByRole("button", { name: "顧客カルテ", exact: true }).click();
  await expect(page.getByLabel("カルテの担当者")).toHaveValue("me");
  await page.getByLabel("カルテの担当者").selectOption("all");
  await selectAccount("カルテの対象アカウント");
  await page.getByRole("button", { name: "カルテを編集", exact: true }).click();
  const editor = page.locator(".customer-editor");
  await editor.getByLabel("法人名", { exact: true }).fill("テスト法人");
  await editor.getByLabel("ブランド", { exact: true }).fill("採用事業");
  await editor
    .getByLabel("引継ぎメモ", { exact: true })
    .fill("予算決裁は部長。次回はLINE面の検証結果を確認。");
  await editor
    .getByLabel("次に進めること", { exact: true })
    .fill("次回提案の条件を確認する");
  await editor
    .getByLabel("更新・契約確認日", { exact: true })
    .fill("2026-10-01");
  await editor
    .getByRole("button", { name: "カルテを保存", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await expect(
    page.getByText("予算決裁は部長。次回はLINE面の検証結果を確認。", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "カルテの変更履歴", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "変更履歴", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "カルテの変更履歴", exact: true })
    .click();
  await page
    .getByRole("button", { name: "この顧客の関係者を登録", exact: true })
    .click();
  const contact = page.locator("#crm-contact-editor");
  await expect(
    contact.getByLabel("顧客担当者のアカウント", { exact: true }),
  ).toHaveValue(/テスト営業アカウント（account-browser）/);
  await contact.getByLabel("氏名", { exact: true }).fill("カルテの決裁者");
  await contact.getByLabel("部署", { exact: true }).fill("事業部");
  await contact.getByLabel("役職", { exact: true }).fill("部長");
  await contact
    .getByLabel("顧客内の役割", { exact: true })
    .selectOption("decision");
  await contact
    .getByRole("button", { name: "顧客担当者を保存", exact: true })
    .click();
  await expect(contact).toHaveCount(0);
  await page.getByRole("button", { name: "顧客カルテ", exact: true }).click();
  await page.getByLabel("カルテの担当者").selectOption("all");
  await selectAccount("カルテの対象アカウント");
  await expect(page.locator(".customer-contact")).toContainText(
    "カルテの決裁者",
  );
  await expect(page.locator(".customer-contact")).toContainText("決裁者");
  await page.getByLabel("カルテの記録の種類").selectOption("kwAnalyses");
  await page
    .locator(".customer-events")
    .getByRole("button", { name: "詳細を開く", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("region", { name: "カルテの記録詳細" }),
  ).toContainText("消化額（円）");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "customer hub fits mobile",
  );
  await page.screenshot({
    path: "artifacts/customer-hub-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.screenshot({
    path: "artifacts/customer-hub-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "商談準備・分析", exact: true })
    .click();
  await selectAccount("商談準備の対象アカウント");
  const agenda = page.getByLabel("今回の議題", { exact: true });
  await expect(agenda).toBeEnabled();
  const original = await agenda.inputValue();
  await page.getByLabel("商談準備テンプレート").selectOption("builtin-review");
  await page
    .getByRole("button", { name: "議題・確認項目に追加して保存", exact: true })
    .click();
  await expect.poll(() => agenda.inputValue()).toContain(original);
  await expect(agenda).toHaveValue(/運用定例・改善提案/);
  await expect(
    page.getByRole("button", {
      name: "議題・確認項目に追加して保存",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByLabel("前回の決定事項と未完了タスクを確認する", { exact: true })
    .check();
  await page
    .getByLabel("前回の決定事項と未完了タスクを確認するの確認メモ", {
      exact: true,
    })
    .fill("担当者から確認済み");
  await page
    .getByRole("button", { name: "議題・チェックリストを保存", exact: true })
    .click();
  await expect(
    page.getByText("議題を保存しました", { exact: true }),
  ).toBeVisible();
  await page
    .getByText("チーム共通のテンプレートを管理", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "共通テンプレートを作成", exact: true })
    .click();
  const templateEditor = page.locator(".prep-template-editor");
  await templateEditor
    .getByLabel("テンプレート名", { exact: true })
    .fill("更新商談の確認");
  await templateEditor
    .getByLabel("議題のひな形", { exact: true })
    .fill("更新時期と提案方針を確認");
  await templateEditor
    .getByLabel("共通の確認項目（1行1項目・20項目まで）", { exact: true })
    .fill("決裁者の出席確認");
  await templateEditor
    .getByRole("button", { name: "共通テンプレートを保存", exact: true })
    .click();
  await expect(templateEditor).toHaveCount(0);
  await page
    .getByLabel("商談準備テンプレート")
    .selectOption({ label: "更新商談の確認 · 全社共通 · v1" });
  await page
    .getByRole("button", { name: "議題・確認項目に追加して保存", exact: true })
    .click();
  await expect(agenda).toHaveValue(/更新時期と提案方針を確認/);
  await expect(
    page.getByLabel("前回の決定事項と未完了タスクを確認する", { exact: true }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "選択したテンプレートを編集", exact: true })
    .click();
  await templateEditor
    .getByLabel("議題のひな形", { exact: true })
    .fill("新しい共通議題");
  await templateEditor
    .getByRole("button", { name: "共通テンプレートを保存", exact: true })
    .click();
  await expect(templateEditor).toHaveCount(0);
  await expect(agenda).not.toHaveValue(/新しい共通議題/);
  await page.reload();
  await page
    .getByRole("button", { name: "営業・数字管理", exact: true })
    .click();
  await page
    .getByRole("button", { name: "商談準備・分析", exact: true })
    .click();
  await selectAccount("商談準備の対象アカウント");
  await expect(agenda).toHaveValue(/更新時期と提案方針を確認/);
  await expect(
    page.getByLabel("前回の決定事項と未完了タスクを確認する", { exact: true }),
  ).toBeChecked();
  await expect(
    page.getByLabel("前回の決定事項と未完了タスクを確認するの確認メモ", {
      exact: true,
    }),
  ).toHaveValue("担当者から確認済み");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "preparation templates fit mobile",
  );
  await page.screenshot({
    path: "artifacts/preparation-templates-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.screenshot({
    path: "artifacts/preparation-templates-desktop.png",
    fullPage: true,
  });
  console.log(
    "Customer hub and templates passed: saved profile, linked decision maker, analysis detail, mobile, template snapshots, checked evidence persistence.",
  );
}
