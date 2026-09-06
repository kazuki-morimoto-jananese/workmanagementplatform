import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./server/index.mjs";
import { runSalesBrowserChecks } from "./tests/sales-browser.mjs";
import { runTaskUxBrowserChecks } from "./tests/task-ux-browser.mjs";
import { runSalesDemoBrowserChecks } from "./tests/sales-demo-browser.mjs";
import { runWorkspaceBrowserChecks } from "./tests/workspace-browser.mjs";

const directory = mkdtempSync(join(tmpdir(), "worknest-browser-"));
const { server, store } = createApp({
  dataDir: directory,
  production: false,
  allowedDomain: "",
});
let browser;
const errors = [];
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const localChrome =
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  browser = await chromium.launch({
    executablePath:
      process.env.BROWSER_EXECUTABLE_PATH ||
      (!process.env.CI && existsSync(localChrome) ? localChrome : undefined),
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
    reducedMotion: "reduce",
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page
    .getByRole("heading", { name: "チームの、新しいはじまり。" })
    .waitFor();
  await page.screenshot({ path: ".browser-check-setup.png", fullPage: true });
  await page
    .getByLabel("ワークスペース名", { exact: true })
    .fill("つむぎデザイン");
  await page.getByLabel("お名前", { exact: true }).fill("森本 一輝");
  await page
    .getByLabel("メールアドレス", { exact: true })
    .fill("admin@company.test");
  await page
    .getByLabel("パスワード", { exact: true })
    .fill("Browser-test-password!");
  await page
    .getByLabel("パスワード（確認）", { exact: true })
    .fill("Browser-test-password!");
  await page
    .getByRole("button", { name: "ワークスペースを作成", exact: true })
    .click();
  await page
    .getByRole("heading", { name: /おかえりなさい、森本さん/ })
    .waitFor();
  await page.screenshot({
    path: ".browser-check-dashboard.png",
    fullPage: true,
  });
  assert.equal(await page.locator(".project-card").count(), 3);
  await page.locator(".project-card").first().click();
  await page.getByRole("button", { name: "ボード", exact: true }).click();
  await page.screenshot({ path: ".browser-check-board.png", fullPage: true });
  const firstCard = page
    .locator(".board-column")
    .first()
    .locator(".board-card")
    .first();
  const cardTitle = await firstCard.locator(".board-title").textContent();
  await firstCard.dragTo(page.locator(".board-column").nth(1));
  await page
    .locator(".board-column")
    .nth(1)
    .getByRole("button", { name: cardTitle, exact: true })
    .waitFor();
  await page.getByRole("button", { name: "タイムライン", exact: true }).click();
  await page.screenshot({
    path: ".browser-check-timeline.png",
    fullPage: true,
  });
  assert.ok((await page.locator(".timeline-bar").count()) > 0);
  await page.getByRole("button", { name: "リスト", exact: true }).click();
  await page
    .locator(".task-toolbar")
    .getByRole("button", { name: "タスクを追加", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await modal
    .getByLabel("タスク名", { exact: true })
    .fill("ブラウザーから作成したタスク");
  await page.screenshot({ path: ".browser-check-form.png", fullPage: true });
  await modal
    .getByLabel("担当者", { exact: true })
    .selectOption({ label: "森本 一輝" });
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 30);
  await modal
    .getByLabel("期日", { exact: true })
    .fill(futureDate.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }));
  await modal
    .getByLabel("説明", { exact: true })
    .fill("永続化と操作の確認です。");
  await modal
    .getByRole("button", { name: "タスクを作成", exact: true })
    .click();
  await modal.waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "ブラウザーから作成したタスク", exact: true })
    .click();
  await modal
    .getByLabel("コメント", { exact: true })
    .fill("レビューをお願いします。");
  await modal
    .getByLabel("説明", { exact: true })
    .fill("コメント送信時も編集中の説明を保持します。");
  await modal.getByRole("button", { name: "送信", exact: true }).click();
  await modal.getByText("レビューをお願いします。", { exact: true }).waitFor();
  assert.equal(
    await modal.getByLabel("説明", { exact: true }).inputValue(),
    "コメント送信時も編集中の説明を保持します。",
  );
  await modal
    .getByLabel("承認担当者", { exact: true })
    .selectOption({ label: "森本 一輝" });
  await modal.getByRole("button", { name: "承認を申請", exact: true }).click();
  await modal.getByRole("button", { name: "承認する", exact: true }).click();
  await modal
    .getByText("このタスクは承認されました", { exact: true })
    .waitFor();
  await page.screenshot({ path: ".browser-check-task.png", fullPage: true });
  await modal.getByRole("button", { name: "閉じる", exact: true }).click();
  await page
    .getByRole("button", { name: "プロジェクト設定", exact: true })
    .click();
  await modal
    .locator(".config-section")
    .first()
    .getByRole("button", { name: "追加", exact: true })
    .click();
  await modal.getByLabel("フィールド名", { exact: true }).fill("予算");
  await modal
    .getByLabel("フィールドの種類", { exact: true })
    .selectOption("number");
  await modal.getByRole("button", { name: "設定を保存", exact: true }).click();
  await modal.waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "社内リクエスト", exact: true })
    .first()
    .click();
  await page
    .getByLabel("依頼のタイトル", { exact: true })
    .fill("ブラウザーからの備品依頼");
  await page
    .getByLabel("依頼の内容", { exact: true })
    .fill("会議室のモニターを追加してください。");
  await page
    .getByRole("button", { name: "依頼を送信する", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "依頼を送信しました" })
    .waitFor();
  await page.getByRole("button", { name: "メンバー", exact: true }).click();
  await page
    .getByRole("button", { name: "メンバーを追加", exact: true })
    .click();
  await modal.getByLabel("名前", { exact: true }).fill("田中 花");
  await modal
    .getByLabel("社内メールアドレス", { exact: true })
    .fill("hana@company.test");
  await modal
    .getByLabel("仮パスワード", { exact: true })
    .fill("Temporary-password-123");
  await modal
    .getByRole("button", { name: "メンバーを追加", exact: true })
    .click();
  await modal.waitFor({ state: "hidden" });
  await page.getByText("hana@company.test", { exact: true }).waitFor();
  await runTaskUxBrowserChecks(page);
  if (
    process.argv.includes("--sales") ||
    process.argv.includes("--workspace-only")
  ) {
    await runSalesBrowserChecks(page);
    if (!process.argv.includes("--workspace-only"))
      await runSalesDemoBrowserChecks(page);
    await runWorkspaceBrowserChecks(page);
  }
  await page.getByRole("button", { name: "ホーム", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".browser-check-mobile.png", fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
    "Mobile dashboard must not overflow horizontally",
  );
  await page
    .getByRole("button", { name: "メニューを開く", exact: true })
    .click();
  await page
    .getByRole("button", { name: "マイタスク", exact: false })
    .first()
    .click();
  await page
    .getByRole("heading", { name: "マイタスク", exact: true })
    .waitFor();
  await page.reload();
  await page
    .getByRole("heading", { name: /おかえりなさい、森本さん/ })
    .waitFor();
  await page
    .getByRole("button", { name: "メニューを開く", exact: true })
    .click();
  await page.getByRole("button", { name: "ログアウト", exact: true }).click();
  await page
    .getByRole("heading", { name: "おかえりなさい。", exact: true })
    .waitFor();
  await page
    .getByLabel("メールアドレス", { exact: true })
    .fill("hana@company.test");
  await page
    .getByLabel("パスワード", { exact: true })
    .fill("Temporary-password-123");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await page
    .getByRole("heading", {
      name: "はじめに、パスワードを変更しましょう。",
      exact: true,
    })
    .waitFor();
  await page
    .getByLabel("現在のパスワード", { exact: true })
    .fill("Temporary-password-123");
  await page
    .getByLabel("新しいパスワード", { exact: true })
    .fill("Hana-new-password-123");
  await page
    .getByLabel("新しいパスワード（確認）", { exact: true })
    .fill("Hana-new-password-123");
  await page
    .getByRole("button", { name: "パスワードを変更", exact: true })
    .click();
  await page
    .getByRole("heading", { name: /おかえりなさい、田中さん/ })
    .waitFor();
  assert.deepEqual(errors, [], "No uncaught browser errors");
  console.log(
    "Browser checks passed: setup, login, dashboard, board drag, timeline, task creation, comments, approvals, custom fields, request form, members, mobile, persistence, logout and first password change.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  store.db.close();
  rmSync(directory, { recursive: true, force: true });
}
