import assert from "node:assert/strict";

// Called only by the browser runner against its isolated temporary database.
export async function runTaskUxBrowserChecks(page) {
  await page.evaluate(async () => {
    const request = async (path, data) => {
      const response = await fetch(
        `/api${path}`,
        data
          ? {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Worknest": "1",
              },
              body: JSON.stringify(data),
            }
          : {},
      );
      if (!response.ok)
        throw new Error(`Test fixture request failed: ${response.status}`);
      return response.json();
    };
    const bootstrap = await request("/bootstrap");
    if (bootstrap.user.email !== "admin@company.test")
      throw new Error("Use the isolated browser test account only");
    const project = await request("/projects", { name: "操作確認 QUARTZ" });
    const currentDay = new Date().toLocaleDateString("sv-SE", {
      timeZone: "Asia/Tokyo",
    });
    const offset = (days) => {
      const date = new Date(`${currentDay}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };
    for (const task of [
      {
        title: "UX 期限切れ",
        dueDate: offset(-1),
        priority: "low",
        status: "todo",
      },
      {
        title: "UX 今日の進行中",
        dueDate: currentDay,
        priority: "high",
        status: "progress",
      },
      {
        title: "UX 7日目",
        dueDate: offset(6),
        priority: "medium",
        status: "todo",
      },
      {
        title: "UX 8日目",
        dueDate: offset(7),
        priority: "medium",
        status: "todo",
      },
      { title: "UX 期日なし", dueDate: "", priority: "high", status: "todo" },
      {
        title: "UX 今日の完了",
        dueDate: currentDay,
        priority: "high",
        status: "done",
      },
    ])
      await request("/tasks", {
        ...task,
        projectIds: [project.id],
        assigneeId: bootstrap.user.id,
      });
  });
  await page.reload();
  await page
    .locator(".project-nav")
    .getByRole("button", { name: "操作確認 QUARTZ", exact: true })
    .click();
  const shortcuts = page.getByRole("group", {
    name: "タスクのクイック絞り込み",
  });
  const visibleTitles = () =>
    page.locator(".task-title-cell > button:nth-child(2)").allTextContents();
  await shortcuts.getByRole("button", { name: /^今日\s*1$/ }).click();
  assert.deepEqual(await visibleTitles(), ["UX 今日の進行中"]);
  await shortcuts.getByRole("button", { name: /^期限切れ\s*1$/ }).click();
  assert.deepEqual(await visibleTitles(), ["UX 期限切れ"]);
  await shortcuts.getByRole("button", { name: /^7日以内\s*2$/ }).click();
  assert.deepEqual(
    (await visibleTitles()).sort(),
    ["UX 7日目", "UX 今日の進行中"].sort(),
  );
  await shortcuts.getByRole("button", { name: /^期日なし\s*1$/ }).click();
  assert.deepEqual(await visibleTitles(), ["UX 期日なし"]);
  await shortcuts.getByRole("button", { name: /^未完了\s*5$/ }).click();
  await page
    .getByLabel("タスクの並び順", { exact: true })
    .selectOption("priority");
  assert.equal((await visibleTitles())[0], "UX 期日なし");
  await page.getByLabel("タスクの並び順", { exact: true }).selectOption("due");
  assert.equal((await visibleTitles())[0], "UX 期限切れ");
  await shortcuts.getByRole("button", { name: /^すべて\s*6$/ }).click();
  const search = page.getByLabel("タスクを検索", { exact: true });
  await page.keyboard.press("Control+k");
  assert.equal(
    await search.evaluate((element) => element === document.activeElement),
    true,
  );
  await search.fill("ｑｕａｒｔｚ 森本");
  assert.equal(
    (await visibleTitles()).length,
    6,
    "Search normalizes width and matches project plus owner",
  );
  await page.keyboard.press("Control+k");
  assert.equal(
    await search.evaluate(
      (element) => element.selectionEnd - element.selectionStart,
    ),
    "ｑｕａｒｔｚ 森本".length,
  );
  await search.fill("見つからない検索語");
  await page
    .getByRole("heading", {
      name: "条件に一致するタスクがありません",
      exact: true,
    })
    .waitFor();
  await page
    .getByRole("button", { name: "すべての絞り込みを解除", exact: true })
    .click();
  assert.equal((await visibleTitles()).length, 6);
  await page.screenshot({
    path: ".browser-check-task-filters.png",
    fullPage: true,
  });
  await page
    .locator(".task-toolbar")
    .getByRole("button", { name: "タスクを追加", exact: true })
    .click();
  await page.keyboard.press("Control+k");
  assert.equal(
    await search.evaluate((element) => element === document.activeElement),
    false,
    "Shortcut must preserve modal focus",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "閉じる", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".browser-check-task-filters-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "Quick filters must not overflow the mobile viewport",
  );
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.getByRole("button", { name: "ホーム", exact: true }).click();
}
