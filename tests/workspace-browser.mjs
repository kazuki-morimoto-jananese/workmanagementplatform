import assert from "node:assert/strict";
import { expect } from "@playwright/test";
export async function runWorkspaceBrowserChecks(page) {
  const request = async (path, method = "GET", body) => {
    const result = await page.evaluate(
      async ({ path, method, body }) => {
        const response = await fetch("/api" + path, {
          method,
          headers: { "X-Worknest": "1", "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
      },
      { path, method, body },
    );
    assert.ok(result.status < 300, JSON.stringify(result));
    return result.body;
  };
  await page.getByRole("button", { name: "メンバー", exact: true }).click();
  const panel = page.locator(".organization-panel");
  await panel.getByLabel("会社名", { exact: true }).fill("テスト株式会社");
  await panel.getByRole("button", { name: "保存", exact: true }).click();
  await expect(panel.locator(".organization-list")).toContainText(
    "テスト株式会社",
  );
  await panel
    .getByLabel("親組織", { exact: true })
    .selectOption({ label: "テスト株式会社" });
  await panel.getByLabel("事業部名", { exact: true }).fill("人材事業部");
  await panel.getByRole("button", { name: "保存", exact: true }).click();
  await expect(panel.locator(".organization-list")).toContainText("人材事業部");
  await panel
    .getByLabel("親組織", { exact: true })
    .selectOption({ label: "テスト株式会社 / 人材事業部" });
  await panel.getByLabel("部署名", { exact: true }).fill("営業第一部");
  await panel.getByRole("button", { name: "保存", exact: true }).click();
  await expect(panel.locator(".organization-list")).toContainText("営業第一部");
  await panel
    .getByLabel("自分の所属", { exact: true })
    .selectOption({ label: "テスト株式会社 / 人材事業部 / 営業第一部" });
  await expect(page.locator(".member-row").first()).toContainText("営業第一部");
  await page.screenshot({
    path: ".browser-check-organizations.png",
    fullPage: true,
  });
  let data = await request("/bootstrap");
  const other = await request("/members", "POST", {
    name: "他部署の企画担当",
    email: "planning@company.test",
    password: "Temporary-planning-password",
  });
  const context = await page
    .context()
    .browser()
    .newContext({ extraHTTPHeaders: { "X-Worknest": "1" } });
  let project;
  try {
    const base = new URL(page.url()).origin;
    assert.equal(
      (
        await context.request.post(base + "/api/auth/login", {
          data: { email: other.email, password: "Temporary-planning-password" },
        })
      ).status(),
      200,
    );
    assert.equal(
      (
        await context.request.post(base + "/api/auth/password", {
          data: {
            currentPassword: "Temporary-planning-password",
            password: "Planning-new-password",
          },
        })
      ).status(),
      200,
    );
    const response = await context.request.post(base + "/api/projects", {
      data: { name: "他部署からの共同プロジェクト", memberIds: [data.user.id] },
    });
    assert.equal(response.status(), 201);
    project = await response.json();
    assert.equal(project.ownerId, other.id);
  } finally {
    await context.close();
  }
  await page.reload();
  await page.getByRole("button", { name: "プロジェクト", exact: true }).click();
  await page
    .getByLabel("表示するプロジェクト", { exact: true })
    .selectOption("mine");
  await expect(page.locator(".project-grid.all-projects")).toContainText(
    project.name,
  );
  await page
    .locator(".project-grid.all-projects")
    .getByRole("button", { name: new RegExp(project.name) })
    .click();
  await page
    .locator(".task-toolbar")
    .getByRole("button", { name: "タスクを追加", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await modal
    .getByLabel("タスク名", { exact: true })
    .fill("顧客・複数担当者の横断タスク");
  await modal
    .getByLabel("対象の営業アカウント", { exact: true })
    .selectOption("account-browser");
  await modal
    .getByRole("group", { name: "担当者を複数選択" })
    .getByLabel(data.user.name, { exact: true })
    .check();
  await modal
    .getByRole("group", { name: "担当者を複数選択" })
    .getByLabel(other.name, { exact: true })
    .check();
  await modal
    .getByRole("button", { name: "タスクを作成", exact: true })
    .click();
  await expect(modal).toBeHidden();
  data = await request("/bootstrap");
  const task = data.tasks.find(
    (t) => t.title === "顧客・複数担当者の横断タスク",
  );
  assert.deepEqual(task.assigneeIds, [data.user.id, other.id]);
  assert.equal(task.accountId, "account-browser");
  await page.getByRole("button", { name: task.title, exact: true }).click();
  await expect(modal.locator(".audit-history")).toContainText("作成");
  await page.screenshot({
    path: ".browser-check-task-history.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "設定・連携", exact: true }).click();
  await page
    .getByRole("button", { name: "今すぐバックアップ", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "今すぐバックアップ", exact: true }),
  ).toBeEnabled();
  await expect(page.getByText(/最終バックアップ：/)).not.toContainText(
    "未実行",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: ".browser-check-operations-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  console.log(
    "Workspace browser passed: organization master, self department, cross-department projects, multiple task owners, account linkage, audit and backup.",
  );
}
