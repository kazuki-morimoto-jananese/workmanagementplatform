import assert from "node:assert/strict";
export async function runSalesBrowserChecks(page) {
  await page
    .getByRole("button", { name: "営業・数字管理", exact: true })
    .click();
  await page.getByRole("heading", { name: /営業・数字管理/ }).waitFor();
  await page.getByRole("button", { name: "データ連携", exact: true }).click();
  const source =
    "アカウントID\tアカウント名\t当月担当者\t今月目標\t今週Gトレ\tスタンバイ消化額\tスタンバイ実測CV\tIndeed消化額\t求人BOX消化額\naccount-browser\tテスト営業アカウント\t森本 一輝\t600000\t480000\t220000\t40\t800000\t400000";
  await page.getByLabel("営業マスタ貼り付け", { exact: true }).fill(source);
  await page
    .getByRole("button", { name: "取込内容を確認", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "1 件のプレビュー", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "この内容で取り込む", exact: true })
    .click();
  await page
    .getByText("マスタを取り込みました。入力済みのヨミは保持しています。", {
      exact: true,
    })
    .waitFor();
  await page.getByRole("button", { name: "週次ヨミ", exact: true }).click();
  await page.locator(".sales-account-button").first().click();
  let modal = page.getByRole("dialog");
  await modal.getByLabel("今月ヨミ（円）", { exact: true }).fill("500000");
  await page.keyboard.press("Escape");
  await modal
    .getByText("保存していない変更があります", { exact: true })
    .waitFor();
  await modal
    .getByRole("button", { name: "入力を続ける", exact: true })
    .click();
  assert.equal(
    await modal.getByLabel("今月ヨミ（円）", { exact: true }).inputValue(),
    "500000",
    "Canceling close must retain the forecast draft",
  );
  await modal.getByLabel("アグレッシブ（円）", { exact: true }).fill("650000");
  await modal.getByLabel("アグレッシブの確度（%）", { exact: true }).fill("65");
  await modal
    .getByLabel("ヨミ根拠", { exact: true })
    .fill("継続予算を合意済み。増額の社内稟議が進行中。");
  await modal
    .getByLabel("今週やること", { exact: true })
    .fill("CPA改善提案を提出する");
  await modal
    .getByLabel("情報の取得日", { exact: true })
    .fill(new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }));
  await modal.getByLabel("indeed 実測CPA", { exact: true }).fill("15000");
  await modal.getByLabel("Indeed 継続月数", { exact: true }).fill("8");
  await modal.getByLabel("許容CPA（円）", { exact: true }).fill("10000");
  const calculatedCpa = modal
    .getByLabel("stanby 計算CPA", { exact: true })
    .locator("output");
  const calculatedHireCost = modal
    .getByLabel("stanby 計算採用単価", { exact: true })
    .locator("output");
  assert.ok((await calculatedCpa.textContent()).includes("5,500"));
  await modal.getByLabel("stanby 採用数", { exact: true }).fill("4");
  assert.ok(
    (await calculatedHireCost.textContent()).includes("55,000"),
    "Hire cost must update before saving",
  );
  await modal.getByLabel("stanby CV数", { exact: true }).fill("0");
  assert.equal(
    await calculatedCpa.textContent(),
    "—",
    "Zero conversions cannot yield a CPA",
  );
  await modal.getByLabel("stanby 消化額", { exact: true }).fill("0");
  await modal.getByLabel("stanby CV数", { exact: true }).fill("40");
  assert.match(
    await calculatedCpa.textContent(),
    /0$/,
    "Known zero spend yields zero CPA",
  );
  await modal.getByLabel("stanby 消化額", { exact: true }).fill("");
  assert.equal(
    await calculatedCpa.textContent(),
    "—",
    "Missing spend must remain unknown",
  );
  await modal.getByLabel("stanby 消化額", { exact: true }).fill("220000");
  await page.screenshot({
    path: ".browser-check-sales-review.png",
    fullPage: true,
  });
  await modal
    .getByRole("button", { name: "この週のヨミを保存", exact: true })
    .click();
  await modal.waitFor({ state: "hidden" });
  assert.ok(
    (await page.locator(".sales-table").textContent()).includes("500,000"),
  );
  await page.locator(".sales-account-button").first().click();
  modal = page.getByRole("dialog");
  assert.equal(
    await modal.getByLabel("Indeed 継続月数", { exact: true }).inputValue(),
    "8",
  );
  await modal.getByLabel("今月ヨミ（円）", { exact: true }).fill("510000");
  await modal
    .getByRole("button", { name: "アカウント・担当者設定", exact: true })
    .click();
  await modal
    .getByText("保存していない変更があります", { exact: true })
    .waitFor();
  await modal
    .getByRole("button", { name: "変更を破棄して移動", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "アカウント設定", exact: true })
    .waitFor();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "閉じる", exact: true })
    .click();
  await page.locator(".sales-account-button").first().click();
  modal = page.getByRole("dialog");
  assert.equal(
    await modal.getByLabel("今月ヨミ（円）", { exact: true }).inputValue(),
    "500000",
    "Discarding a draft must not change saved data",
  );
  await modal.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.getByRole("button", { name: "営業サマリー", exact: true }).click();
  await page.screenshot({
    path: ".browser-check-sales-summary.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "商談", exact: true }).click();
  await page.getByRole("button", { name: "商談を登録", exact: true }).click();
  modal = page.getByRole("dialog");
  await modal
    .getByLabel("アカウント", { exact: true })
    .selectOption("account-browser");
  await modal.getByLabel("商談名", { exact: true }).fill("秋の追加予算提案");
  await modal.getByLabel("商談金額（円）", { exact: true }).fill("150000");
  await modal.getByLabel("受注確度（%）", { exact: true }).fill("60");
  await modal.getByLabel("フェーズ", { exact: true }).selectOption("proposal");
  await modal
    .getByLabel("商談の次のアクション", { exact: true })
    .fill("顧客の承認を確認する");
  await modal.getByRole("button", { name: "保存する", exact: true }).click();
  await modal.waitFor({ state: "hidden" });
  await page
    .locator(".sales-deal")
    .filter({ hasText: "秋の追加予算提案" })
    .waitFor();
  await page.getByRole("button", { name: "議事録", exact: true }).click();
  await page.getByRole("button", { name: "議事録を保存", exact: true }).click();
  modal = page.getByRole("dialog");
  await modal
    .getByLabel("アカウント", { exact: true })
    .selectOption("account-browser");
  await modal
    .getByLabel("議事録タイトル", { exact: true })
    .fill("9月の週次定例");
  await modal
    .getByLabel("議事録の原文", { exact: true })
    .fill(
      "決定事項：現行予算を継続する\n課題：CPAの改善が必要\n次のアクション：改善提案を提出する",
    );
  await modal.getByRole("button", { name: "閉じる", exact: true }).click();
  await modal
    .getByText("保存していない変更があります", { exact: true })
    .waitFor();
  await modal
    .getByRole("button", { name: "入力を続ける", exact: true })
    .click();
  assert.ok(
    (
      await modal.getByLabel("議事録の原文", { exact: true }).inputValue()
    ).includes("現行予算を継続"),
    "Minutes text must survive a canceled close",
  );
  await modal.getByRole("button", { name: "原文を保存", exact: true }).click();
  await modal.waitFor({ state: "hidden" });
  await page
    .getByLabel("議事録を検索", { exact: true })
    .fill("一致しない議事録");
  await page
    .getByRole("heading", { name: "一致する議事録がありません", exact: true })
    .waitFor();
  for (const query of ["9月の週次定例", "現行予算", "テスト営業アカウント"]) {
    await page.getByLabel("議事録を検索", { exact: true }).fill(query);
    await page.locator(".sales-minute-card").first().waitFor();
    assert.equal(
      await page.locator(".sales-minute-card").count(),
      1,
      "Minutes should match title, body, or account name",
    );
  }
  await page.getByRole("button", { name: "検索を解除", exact: true }).click();
  await page
    .locator(".sales-minute-card")
    .filter({ hasText: "9月の週次定例" })
    .click();
  modal = page.getByRole("dialog");
  await modal.getByText("ローカル要点抽出", { exact: true }).waitFor();
  await modal
    .getByRole("button", { name: "タスク化", exact: true })
    .first()
    .click();
  modal = page.getByRole("dialog");
  await modal
    .getByRole("button", { name: "タスクを作成", exact: true })
    .click();
  await modal.waitFor({ state: "hidden" });
  await page
    .locator(".sales-minute-card")
    .filter({ hasText: "9月の週次定例" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "タスクを開く", exact: true })
    .waitFor();
  await page.screenshot({
    path: ".browser-check-sales-minutes.png",
    fullPage: true,
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "タスクを開く", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("タスク名", { exact: true })
    .waitFor();
  assert.ok(
    (
      await page
        .getByRole("dialog")
        .getByLabel("タスク名", { exact: true })
        .inputValue()
    ).includes("改善提案"),
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "閉じる", exact: true })
    .click();
  await page.getByRole("button", { name: "営業サマリー", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".browser-check-sales-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "Sales mobile must not overflow",
  );
  await page.getByRole("button", { name: "週次ヨミ", exact: true }).click();
  const weeklyScroll = page.getByRole("region", {
    name: "週次ヨミの一覧。横スクロールできます",
    exact: true,
  });
  assert.ok(
    await weeklyScroll.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    ),
    "Wide numeric tables should scroll inside the mobile layout",
  );
  const firstCell = weeklyScroll.locator("tbody tr td").first();
  const firstCellLeft = (await firstCell.boundingBox()).x;
  await weeklyScroll.evaluate((element) => {
    element.scrollLeft = 250;
  });
  assert.ok(
    Math.abs((await firstCell.boundingBox()).x - firstCellLeft) <= 1,
    "Account names should remain visible while numeric columns scroll",
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "Weekly table must not create horizontal page overflow",
  );
  await page.setViewportSize({ width: 1440, height: 1050 });
  console.log(
    "Sales browser passed: import preview/commit, weekly forecast, draft protection, live media calculations, opportunity, minutes search, local summary, linked task, mobile.",
  );
}
