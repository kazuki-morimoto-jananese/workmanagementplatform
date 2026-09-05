import assert from "node:assert/strict";
export async function runSalesDemoBrowserChecks(page) {
  await page
    .getByRole("button", { name: "営業・数字管理", exact: true })
    .click();
  await page
    .getByRole("button", { name: "3か月デモを追加", exact: true })
    .click();
  await page.getByText("架空の営業データを表示中", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("表示データ", { exact: true }).inputValue(),
    "demo",
  );
  const periods = await page.evaluate(
    async () =>
      (await (await fetch("/api/sales/bootstrap")).json()).demoPeriods,
  );
  for (const period of periods) {
    const label =
      period.offset < 0 ? "前月" : period.offset > 0 ? "翌月" : "当月";
    await page
      .getByRole("button", { name: `${label} · ${period.month}`, exact: true })
      .click();
    await page.locator(".sales-loading").waitFor({ state: "hidden" });
    assert.equal(
      await page.getByLabel("対象月", { exact: true }).inputValue(),
      period.month,
    );
    assert.equal(
      await page.getByLabel("週次会議の週", { exact: true }).inputValue(),
      period.reportWeek,
    );
    assert.equal(await page.locator(".sales-account-button").count(), 6);
    await page
      .getByRole("button", { name: "営業サマリー", exact: true })
      .click();
    const kpis = await page.locator(".sales-kpis").textContent();
    assert.ok(
      kpis.includes(
        period.offset < 0
          ? "29,700,000"
          : period.offset > 0
            ? "37,950,000"
            : "33,000,000",
      ),
    );
    assert.ok(
      !kpis.includes("600,000"),
      "Real-account target must not be included in demo totals",
    );
    await page.screenshot({
      path: `.browser-check-demo-${period.month}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "商談", exact: true }).click();
    assert.equal(await page.locator(".sales-deal").count(), 6);
    await page.getByRole("button", { name: "議事録", exact: true }).click();
    assert.equal(await page.locator(".sales-minute-card").count(), 6);
    assert.ok(
      (await page.locator(".sales-minute-card").first().textContent()).includes(
        period.month,
      ),
    );
    await page
      .getByRole("button", { name: "営業サマリー", exact: true })
      .click();
  }
  await page.getByLabel("表示データ", { exact: true }).selectOption("real");
  await page.getByLabel("対象月", { exact: true }).fill(periods[1].month);
  await page.locator(".sales-loading").waitFor({ state: "hidden" });
  assert.equal(await page.locator(".sales-account-button").count(), 1);
  assert.ok(
    (await page.locator(".sales-kpis").textContent()).includes("600,000"),
  );
  await page.getByLabel("表示データ", { exact: true }).selectOption("demo");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".browser-check-demo-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.setViewportSize({ width: 1440, height: 1050 });
  console.log(
    "Three-month demo browser passed: month/week navigation, six accounts, isolated totals, deals, minutes, real-data switch, mobile.",
  );
}
