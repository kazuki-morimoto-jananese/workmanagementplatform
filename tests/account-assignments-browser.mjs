import { expect } from "@playwright/test";
import assert from "node:assert/strict";

export async function runAccountAssignmentChecks(page) {
  const req = (path, body) =>
    page.evaluate(
      async ({ path, body }) => {
        const res = await fetch("/api" + path, {
          method: body ? "POST" : "GET",
          headers: { "Content-Type": "application/json", "X-Worknest": "1" },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(JSON.stringify(result));
        return result;
      },
      { path, body },
    );
  const data = await req("/bootstrap");
  const next = data.members.find((m) => m.id !== data.user.id && m.active);
  assert(next);
  await req("/sales/accounts", {
    id: "assignment-browser",
    name: "引き継ぎ確認アカウント",
    ownerId: data.user.id,
    ownerName: data.user.name,
  });
  const task = await req("/tasks", {
    title: "引き継ぐ対応タスク",
    accountId: "assignment-browser",
    projectIds: [data.projects[0].id],
    assigneeIds: [data.user.id],
    status: "todo",
    priority: "medium",
    visibility: "workspace",
  });
  await page.reload();
  await page
    .getByRole("button", { name: "営業・数字管理", exact: true })
    .click();
  await page
    .getByRole("button", { name: "担当・引き継ぎ", exact: true })
    .click();
  const screen = page.getByRole("region", {
    name: "担当・引き継ぎ",
    exact: true,
  });
  const today = new Date().toLocaleDateString("sv-SE", {
    timeZone: "Asia/Tokyo",
  });
  const csv = `アカウントID,アカウント名,前月担当Ｇ,前月担当者,当月担当Ｇ,当月担当者\nassignment-browser,引き継ぎ確認アカウント,,${data.user.name},,${next.name}\nnot-registered,対象外,,前任,,未登録担当`;
  await screen
    .getByLabel("担当変更ファイル", { exact: true })
    .setInputFiles({
      name: "handover.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
  await screen
    .getByRole("button", { name: "この列で担当情報を読み取る", exact: true })
    .click();
  await screen.getByLabel("担当変更の適用日", { exact: true }).fill(today);
  await screen
    .getByRole("button", { name: "担当変更の差分を確認", exact: true })
    .click();
  await expect(
    screen.getByRole("heading", { name: "3. 反映するアカウントを選ぶ" }),
  ).toBeVisible();
  await expect(
    screen.getByRole("button", {
      name: "選択した0件に担当変更を反映",
      exact: true,
    }),
  ).toBeDisabled();
  assert.equal(
    (await req("/sales/bootstrap")).accounts.find(
      (a) => a.id === "assignment-browser",
    ).ownerId,
    data.user.id,
  );
  await screen
    .getByLabel("引き継ぎ確認アカウントを反映対象にする", { exact: true })
    .check();
  await screen
    .getByRole("button", { name: "選択した1件に担当変更を反映", exact: true })
    .click();
  await expect(screen.getByRole("status")).toContainText(
    "1件の担当履歴を保存しました",
  );
  const sales = await req("/sales/bootstrap");
  assert.equal(
    sales.accounts.find((a) => a.id === "assignment-browser").ownerId,
    next.id,
  );
  assert(!sales.accounts.some((a) => a.id === "not-registered"));
  assert.equal(
    (await req("/bootstrap")).tasks.find((t) => t.id === task.id).assigneeId,
    data.user.id,
  );
  const history = await req("/sales/assignments");
  await screen
    .getByLabel("保存した担当変更", { exact: true })
    .selectOption(history.history[0].id);
  await screen
    .getByLabel("引き継ぐアカウント", { exact: true })
    .fill("assignment-browser");
  await screen
    .getByRole("option")
    .filter({ hasText: "引き継ぎ確認アカウント" })
    .click();
  await screen
    .getByLabel("タスク：引き継ぐ対応タスク", { exact: true })
    .check();
  await screen
    .getByRole("button", {
      name: "選択した仕事を引き継ぐ（最大50件）",
      exact: true,
    })
    .click();
  await expect(screen.getByRole("status")).toContainText(
    "選択した仕事を後任に引き継ぎました",
  );
  assert.equal(
    (await req("/bootstrap")).tasks.find((t) => t.id === task.id).assigneeId,
    next.id,
  );
  await screen
    .getByRole("button", { name: "担当履歴の変更記録", exact: true })
    .click();
  await expect(
    screen.getByRole("heading", { name: "変更履歴", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: ".browser-check-assignments.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "Assignment screen fits mobile viewport",
  );
  await page.setViewportSize({ width: 1440, height: 1050 });
}
