import { expect } from "@playwright/test";
import assert from "node:assert/strict";
export async function runMinuteUxBrowserChecks(page) {
  const bootstrap = await page.evaluate(async () =>
    (await fetch("/api/bootstrap")).json(),
  );
  const own = bootstrap.user,
    other = bootstrap.members.find((m) => m.id !== own.id);
  const routes = [];
  const mock = async (pattern, handler) => {
    await page.route(pattern, handler);
    routes.push([pattern, handler]);
  };
  let starts = [],
    imports = [];
  try {
    await mock("**/api/sales/bootstrap?*", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      const template = data.accounts[0];
      data.accounts = [
        {
          ...template,
          id: "ux-own",
          name: "UX自社アカウント",
          ownerId: own.id,
          isDemo: false,
        },
        {
          ...template,
          id: "ux-other",
          name: "UX別担当アカウント",
          ownerId: other.id,
          isDemo: false,
        },
      ];
      data.minutes = [
        ["ux-1", "ux-own", "2026-09-10"],
        ["ux-2", "ux-other", "2026-09-09"],
        ["ux-3", "ux-own", "2026-08-01"],
      ].map(([id, accountId, meetingDate]) => ({
        id,
        accountId,
        meetingDate,
        title: id,
        text: "原文",
        status: "completed",
        summary: {
          overview: "一覧で確認するサマリー",
          decisions: ["採用テストを継続する"],
        },
        taskLinks: [],
      }));
      await route.fulfill({ json: data });
    });
    await mock("**/api/google/collection/settings", (route) =>
      route.fulfill({ json: { roots: ["ux-root"] } }),
    );
    await mock("**/api/google/collection/start", (route) => {
      starts.push(route.request().postDataJSON());
      return route.fulfill({ json: { scanId: "ux-scan" } });
    });
    await mock("**/api/google/collection/next", (route) =>
      route.fulfill({
        json: {
          done: true,
          visited: 1,
          pending: 0,
          warnings: [],
          files: [
            {
              id: "ux-doc1",
              name: "定例2026/09/10",
              path: "UX/定例",
              url: "https://docs.google.com/document/d/ux-doc1/edit",
              accounts: [
                {
                  accountId: "ux-own",
                  accountName: "UX自社アカウント",
                  existingId: "",
                },
              ],
            },
            {
              id: "ux-doc2",
              name: "日付なし定例",
              path: "UX/定例2",
              url: "https://docs.google.com/document/d/ux-doc2/edit",
              accounts: [
                {
                  accountId: "ux-own",
                  accountName: "UX自社アカウント",
                  existingId: "",
                },
                {
                  accountId: "ux-other",
                  accountName: "UX別担当アカウント",
                  existingId: "",
                },
              ],
            },
          ],
        },
      }),
    );
    await mock("**/api/sales/minutes", (route) => {
      const body = route.request().postDataJSON();
      imports.push(body);
      return route.fulfill({ json: { id: "saved-" + imports.length } });
    });
    await page.reload();
    await page
      .getByRole("button", { name: "営業・数字管理", exact: true })
      .click();
    await page.getByLabel("表示データ", { exact: true }).selectOption("real");
    await page.getByRole("button", { name: "議事録", exact: true }).click();
    await expect(
      page.getByLabel("議事録の担当者", { exact: true }),
    ).toHaveValue("me");
    await expect(page.locator(".minute-account-group")).toHaveCount(1);
    await expect(page.locator(".sales-minute-card")).toHaveCount(2);
    await expect(page.locator(".sales-minute-card").first()).toContainText(
      "ux-1",
    );
    await expect(page.locator(".minute-card-summary").first()).toContainText(
      "採用テストを継続する",
    );
    await page
      .getByLabel("議事録の担当者", { exact: true })
      .selectOption(other.id);
    await expect(page.locator(".sales-minute-card")).toHaveCount(1);
    await page
      .getByLabel("議事録の担当者", { exact: true })
      .selectOption("all");
    await expect(page.locator(".minute-account-group")).toHaveCount(2);
    const collection = page
      .locator("details")
      .filter({
        has: page.locator("summary", {
          hasText: "顧客のフォルダーから議事録を収集",
        }),
      });
    await collection.locator("summary").click();
    await expect(collection.getByLabel("収集する範囲")).toHaveValue("mine");
    await collection
      .getByRole("button", { name: "保存して候補を検索" })
      .click();
    await expect(collection.locator(".collection-candidate")).toHaveCount(2);
    assert.deepEqual(starts[0].accountIds, ["ux-own"]);
    await expect(
      collection.getByLabel("取り込み先 日付なし定例", { exact: true }),
    ).toHaveValue("");
    await collection
      .getByRole("button", {
        name: "アカウント・日付がある未登録分をすべて選択",
      })
      .click();
    await expect(
      collection.getByLabel("取り込む 日付なし定例", { exact: true }),
    ).not.toBeChecked();
    await collection
      .getByLabel("取り込み先 日付なし定例", { exact: true })
      .selectOption("ux-own");
    await collection
      .getByLabel("会議日 日付なし定例", { exact: true })
      .fill("2026-09-09");
    await collection
      .getByLabel("取り込む 日付なし定例", { exact: true })
      .check();
    await collection
      .getByRole("button", { name: "選択した議事録を一括で共有・取り込み" })
      .click();
    await expect(collection.getByRole("status")).toContainText(
      "取り込み完了 2件",
    );
    assert.equal(imports.length, 2);
    assert(imports.every((i) => i.accountId === "ux-own" && !i.autoSummarize));
    await expect(
      collection.getByRole("button", {
        name: "選択した議事録を一括で共有・取り込み",
      }),
    ).toBeDisabled();
    await collection.getByLabel("収集する範囲").selectOption("owner");
    await collection.getByLabel("収集する担当者").selectOption(other.id);
    await collection
      .getByRole("button", { name: "保存して候補を検索" })
      .click();
    await expect(collection.locator(".collection-candidate")).toHaveCount(2);
    assert.deepEqual(starts.at(-1).accountIds, ["ux-other"]);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    console.log(
      "Minute UX passed: own default, owner filter, account grouping, summary/decisions, bulk selection, dates, ambiguous matches, duplicate prevention, mobile.",
    );
  } finally {
    for (const [pattern, handler] of routes)
      await page.unroute(pattern, handler);
    await page.reload();
  }
}
