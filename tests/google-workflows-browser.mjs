import { expect } from "@playwright/test";
import assert from "node:assert/strict";
export async function runGoogleWorkflowBrowserChecks(page) {
  await page.setViewportSize({ width: 1440, height: 1050 });
  const routes = [];
  async function mock(pattern, body) {
    const handler = (route) =>
      route.fulfill({ json: typeof body === "function" ? body(route) : body });
    routes.push([pattern, handler]);
    await page.route(pattern, handler);
  }
  try {
    await mock("**/api/google/status", {
      configured: true,
      connected: true,
      calendar: true,
      driveSearch: true,
      documentsWrite: true,
    });
    await mock("**/api/google/calendar", {
      events: [
        { id: "gws-event", title: "Google連携テスト商談", start: "2026-09-09" },
      ],
    });
    await mock("**/api/google/calendar/prepare", {
      title: "Google連携テスト議事録",
      text: "決定事項：提案を準備する。\n次のアクション：提案資料を作成。",
      meetingDate: "2026-09-09",
      calendarEventId: "gws-event",
    });
    await mock("**/api/google/files?*", {
      files: [
        {
          id: "gws-test-sheet",
          name: "選択テスト営業マスタ",
          modifiedTime: "2026-09-09T00:00:00Z",
          url: "https://docs.google.com/spreadsheets/d/gws-test-sheet/edit",
        },
      ],
      nextPageToken: "",
    });
    let created = false,
      createCount = 0;
    const artifact = {
      id: "artifact",
      title: "テスト営業会議",
      status: "completed",
      kind: "slides",
      fileId: "mock-slides",
      url: "https://docs.google.com/presentation/d/mock-slides/edit",
    };
    await mock("**/api/google/artifacts", () => ({
      items: created ? [artifact] : [],
    }));
    await mock("**/api/google/reports/preview", (route) => ({
      ...route.request().postDataJSON(),
      pages: [
        { title: "予実とヨミ", text: "目標 100円 / 実績 0円 / ヨミ 未入力" },
      ],
      warnings: [],
      fingerprint: "mock-fingerprint",
    }));
    await mock("**/api/google/reports/create", (route) => {
      assert.equal(
        route.request().postDataJSON().fingerprint,
        "mock-fingerprint",
      );
      created = true;
      createCount++;
      return artifact;
    });
    await page
      .getByRole("button", { name: "営業・数字管理", exact: true })
      .click();
    await page.getByLabel("表示データ", { exact: true }).selectOption("real");
    await page.getByLabel("対象月", { exact: true }).fill("2026-09");
    await page.getByLabel("週次会議の週", { exact: true }).fill("2026-09-07");
    await page
      .getByRole("button", { name: "営業サマリー", exact: true })
      .click();
    await page
      .locator("summary")
      .filter({ hasText: "営業会議資料を作成" })
      .click();
    await page
      .getByRole("button", { name: "資料の内容を確認", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Googleスライドを作成", exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: "PowerPoint", exact: true }),
    ).toHaveAttribute("href", /export\/pptx$/);
    assert.equal(createCount, 1);
    await page.getByRole("button", { name: "データ連携", exact: true }).click();
    await page
      .getByRole("button", { name: "Driveからスプシを選択", exact: true })
      .click();
    await page.getByRole("button", { name: /選択テスト営業マスタ/ }).click();
    await expect(
      page.getByLabel("スプレッドシートID", { exact: true }),
    ).toHaveValue("gws-test-sheet");
    await page.getByRole("button", { name: "議事録", exact: true }).click();
    await mock("**/api/google/collection/settings", { roots: ["test-root"] });
    await mock("**/api/google/collection/start", { scanId: "scan" });
    await mock("**/api/google/collection/next", {
      files: [
        {
          id: "doc-candidate",
          name: "定例",
          path: "顧客 / 定例",
          match: "顧客",
          modifiedTime: "2026-09-09T00:00:00Z",
          existingId: "",
          url: "https://docs.google.com/document/d/doc-candidate/edit",
        },
      ],
      done: true,
      visited: 1,
      pending: 0,
      warnings: [],
    });
    const collection = page.locator("details").filter({
      has: page.locator("summary", {
        hasText: "顧客のフォルダーから議事録を収集",
      }),
    });
    await collection.locator("summary").click();
    await expect(
      collection.getByLabel("検索元フォルダー（1行に1URL・10件まで）"),
    ).toHaveValue("https://drive.google.com/drive/folders/test-root");
    await collection
      .getByLabel("議事録を収集するアカウント", { exact: true })
      .selectOption("account-browser");
    await collection
      .getByRole("button", { name: "保存して候補を検索" })
      .click();
    await collection.getByLabel("取り込む議事録").selectOption("doc-candidate");
    await expect(
      collection.getByRole("button", {
        name: "選択した議事録を全員に共有して取り込む",
      }),
    ).toBeDisabled();
    await collection
      .getByLabel("会議日（原文を確認して指定）")
      .fill("2026-09-08");
    await expect(
      collection.getByRole("button", {
        name: "選択した議事録を全員に共有して取り込む",
      }),
    ).toBeEnabled();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.setViewportSize({ width: 1440, height: 1050 });
    await collection.locator("summary").click();
    await page
      .locator("summary")
      .filter({ hasText: "商談予定から議事録を作成" })
      .click();
    await page
      .getByRole("button", { name: "商談予定を取得", exact: true })
      .click();
    await page
      .getByLabel("商談予定", { exact: true })
      .selectOption("gws-event");
    await page
      .getByLabel("紐付けるアカウント", { exact: true })
      .selectOption("account-browser");
    await page
      .getByRole("button", { name: "ひな形を確認", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Worknestにひな形を保存", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Google連携テスト議事録",
        exact: true,
        level: 2,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "この議事録をGoogle Docsに作成",
        exact: true,
      }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: ".browser-check-google-workflows-mobile.png",
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    let deferred = false;
    await mock("**/api/google/status", () => ({
      configured: true,
      onboardingPending: !deferred,
    }));
    await mock("**/api/google/onboarding/defer", () => {
      deferred = true;
      return { ok: true };
    });
    await page.reload();
    const onboarding = page.getByRole("dialog", {
      name: "仕事で使うGoogleアカウントを接続",
    });
    await expect(onboarding).toBeVisible();
    await expect(
      onboarding.getByRole("button", {
        name: "Googleに接続して必要な権限を許可",
      }),
    ).toBeEnabled();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await onboarding
      .getByRole("button", { name: "後で設定してWorknestを使う" })
      .click();
    await expect(onboarding).toHaveCount(0);
    assert.equal(deferred, true);
    await page.reload();
    await page.getByRole("heading", { name: /おかえりなさい、/ }).waitFor();
    await expect(onboarding).toHaveCount(0);
    console.log(
      "Google workflow browser passed: Drive selection, calendar minute save, report preview/create/history links and mobile. External Google APIs mocked.",
    );
  } finally {
    for (const [p, h] of routes) await page.unroute(p, h);
    await page.setViewportSize({ width: 1440, height: 1050 });
  }
}
