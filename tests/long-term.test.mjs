import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/index.mjs";
import { digest } from "../server/store.mjs";
import { monday, jstToday } from "../server/sales.mjs";
import { restoreDatabase } from "../scripts/restore.mjs";
import { DatabaseSync } from "node:sqlite";

test("long-term audit, organization, multiple owners and document revisions preserve provenance", async () => {
  const directory = mkdtempSync(join(tmpdir(), "worknest-longterm-"));
  const priorKey = process.env.GEMINI_API_KEY,
    priorModel = process.env.GEMINI_MODEL;
  process.env.GEMINI_API_KEY = "test-key-not-real";
  process.env.GEMINI_MODEL = "test-model";
  let documentText = "当月ヨミは300万円。Indeed予算は500万円。CPAは1500円。";
  let documentFailure = false;
  let extractionCalls = 0;
  const adapters = {
    readDocument: async () => {
      if (documentFailure)
        throw Object.assign(new Error("Googleの権限エラー"), { status: 503 });
      return {
        text: documentText,
        title: "Google営業定例",
        fileId: "documentTestId123456",
        modifiedTime: "2026-09-06T00:00:00Z",
        sourceUrl:
          "https://docs.google.com/document/d/documentTestId123456/edit",
      };
    },
    extractNumbers: async (minute) => {
      extractionCalls++;
      return {
        month: minute.targetMonth,
        fields: [
          {
            path: "forecast",
            value: 3000000,
            evidence: "当月ヨミは300万円。",
            literal: "300万円",
          },
          {
            path: "indeed.budget",
            value: 5000000,
            evidence: "Indeed予算は500万円。",
            literal: "500万円",
          },
        ],
      };
    },
  };
  let app = createApp({ dataDir: directory, minuteAdapters: adapters });
  let base,
    cookie = "";
  async function start() {
    await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${app.server.address().port}/api`;
  }
  async function req(path, method = "GET", body, auth = cookie) {
    const res = await fetch(base + path, {
      method,
      headers: {
        "X-Worknest": "1",
        "Content-Type": "application/json",
        Cookie: auth,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: res.status,
      body: await res.json(),
      cookie: res.headers.get("set-cookie")?.split(";")[0],
    };
  }
  async function ok(path, method, body, status = 200) {
    const r = await req(path, method, body);
    assert.equal(r.status, status, JSON.stringify(r.body));
    return r.body;
  }
  async function waitFor(fn) {
    for (let i = 0; i < 150; i++) {
      if (fn()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.fail("Background job timed out");
  }
  try {
    await start();
    await ok(
      "/auth/setup",
      "POST",
      {
        email: "admin@company.test",
        password: "longterm-test-password",
        name: "管理者",
        workspace: "全社",
        samples: false,
      },
      201,
    );
    cookie = (
      await req("/auth/login", "POST", {
        email: "admin@company.test",
        password: "longterm-test-password",
      })
    ).cookie;
    const admin = (await ok("/bootstrap")).user;
    const member = await ok(
      "/members",
      "POST",
      {
        email: "sales@company.test",
        password: "member-test-password",
        name: "営業担当",
      },
      201,
    );
    let memberCookie = (
      await req("/auth/login", "POST", {
        email: member.email,
        password: "member-test-password",
      })
    ).cookie;
    assert.equal(
      (
        await req(
          "/auth/password",
          "POST",
          {
            currentPassword: "member-test-password",
            password: "member-new-password",
          },
          memberCookie,
        )
      ).status,
      200,
    );
    const company = await ok(
      "/org-units",
      "POST",
      { name: "全社", level: "company" },
      201,
    );
    const division = await ok(
      "/org-units",
      "POST",
      { name: "事業部", level: "division", parentId: company.id },
      201,
    );
    const department = await ok(
      "/org-units",
      "POST",
      { name: "営業部", level: "department", parentId: division.id },
      201,
    );
    const team = await ok(
      "/org-units",
      "POST",
      { name: "第一チーム", level: "team", parentId: department.id },
      201,
    );
    assert.equal(
      (
        await req("/org-units", "POST", {
          name: "営業部",
          level: "department",
          parentId: division.id,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await req("/org-units", "POST", {
          name: "飛び越し",
          level: "team",
          parentId: company.id,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await req(
          "/org-units",
          "POST",
          { name: "偽", level: "company" },
          memberCookie,
        )
      ).status,
      403,
    );
    await ok(`/members/${member.id}/organization`, "POST", {
      orgUnitId: team.id,
    });
    const project = await ok(
      "/projects",
      "POST",
      {
        name: "他部署起点のプロジェクト",
        orgUnitId: division.id,
        memberIds: [member.id],
      },
      201,
    );
    const account = await ok(
      "/sales/accounts",
      "POST",
      { id: "customer-1", name: "顧客", orgUnitId: department.id },
      201,
    );
    let task = await ok(
      "/tasks",
      "POST",
      {
        title: "複数人で顧客対応",
        projectIds: [project.id],
        accountId: account.id,
        assigneeIds: [admin.id, member.id],
      },
      201,
    );
    assert.deepEqual(task.assigneeIds, [admin.id, member.id]);
    const memberData = (await req("/bootstrap", "GET", undefined, memberCookie))
      .body;
    assert.ok(memberData.projects.some((p) => p.id === project.id));
    assert.ok(memberData.notifications.some((n) => n.taskId === task.id));
    task = await ok(`/tasks/${task.id}`, "PATCH", {
      version: task.version,
      status: "progress",
    });
    assert.deepEqual(task.assigneeIds, [admin.id, member.id]);
    await ok(`/tasks/${task.id}`, "DELETE", { version: task.version });
    const logs = await ok(`/audit?kind=tasks&recordId=${task.id}`);
    assert.equal(logs.entries[0].action, "delete");
    assert.equal(logs.entries[0].before_data.accountId, account.id);
    assert.equal(logs.entries[0].actor_id, admin.id);
    assert.equal(
      (await req("/audit", "GET", undefined, memberCookie)).status,
      403,
    );
    assert.equal(
      (
        await req(
          `/audit?kind=tasks&recordId=${task.id}`,
          "GET",
          undefined,
          memberCookie,
        )
      ).status,
      200,
    );
    for (let i = 0; i < 510; i++)
      app.store.put("activity", { id: "old-" + i, text: "過去の履歴" });
    await ok("/projects", "POST", { name: "履歴上限の確認" }, 201);
    assert.ok(app.store.all("activity").length > 500);
    const today = jstToday(),
      month = today.slice(0, 7),
      weekOf = monday(today);
    const originalReview = await ok("/sales/reviews", "POST", {
      accountId: account.id,
      month,
      weekOf,
      forecast: 0,
      reason: "手入力の0円を守る",
    });
    const minute = await ok(
      "/sales/minutes",
      "POST",
      {
        accountId: account.id,
        importGoogle: true,
        sourceUrl:
          "https://docs.google.com/document/d/documentTestId123456/edit",
        targetMonth: month,
        reviewWeek: weekOf,
        meetingDate: today,
        autoExtract: true,
        autoApplyNumbers: true,
      },
      201,
    );
    await waitFor(
      () => app.store.get("salesMinutes", minute.id).extraction?.appliedAt,
    );
    const review = app.store.get("salesReviews", originalReview.id);
    assert.equal(review.forecast, 0);
    assert.equal(review.media.indeed.budget, 5000000);
    const savedMinute = app.store.get("salesMinutes", minute.id);
    assert.deepEqual(savedMinute.extraction.skipped, ["forecast"]);
    assert.equal(
      (
        await req(`/sales/minutes/${minute.id}/apply-numbers`, "POST", {
          version: savedMinute.version,
          reviewVersion: review.version,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await req("/sales/minutes", "POST", {
          accountId: account.id,
          importGoogle: true,
          sourceUrl: minute.sourceUrl,
        })
      ).status,
      409,
    );
    const noChange = await ok(`/sales/minutes/${minute.id}/refresh`, "POST", {
      version: savedMinute.version,
    });
    assert.equal(noChange.unchanged, true);
    documentFailure = true;
    assert.equal(
      (
        await req(`/sales/minutes/${minute.id}/refresh`, "POST", {
          version: noChange.minute.version,
        })
      ).status,
      503,
    );
    assert.equal(app.store.get("salesMinutes", minute.id).text, minute.text);
    documentFailure = false;
    documentText += "更新後の追記。";
    const revision = await ok(
      `/sales/minutes/${minute.id}/refresh`,
      "POST",
      { version: noChange.minute.version },
      201,
    );
    assert.notEqual(revision.minute.id, minute.id);
    assert.equal(app.store.get("salesMinutes", minute.id).text, minute.text);
    await waitFor(
      () =>
        app.store.get("salesMinutes", revision.minute.id).extraction?.appliedAt,
    );
    assert.equal(app.store.get("salesReviews", originalReview.id).forecast, 0);
    assert.ok(
      (
        await ok(
          `/audit?kind=salesReviews&recordId=${encodeURIComponent(originalReview.id)}`,
        )
      ).entries.length >= 2,
    );
    const latestMinute = app.store.get("salesMinutes", revision.minute.id);
    app.store.put("salesMinutes", {
      ...latestMinute,
      autoApplyNumbers: false,
      extraction: {
        status: "pending",
        requestedBy: member.id,
        sourceHash: digest(latestMinute.text),
        fields: [],
      },
    });
    const calls = extractionCalls;
    await new Promise((r) => app.server.close(r));
    app.store.db.close();
    app = createApp({ dataDir: directory, minuteAdapters: adapters });
    await start();
    await waitFor(
      () =>
        app.store.get("salesMinutes", latestMinute.id).extraction?.status ===
        "completed",
    );
    assert.equal(extractionCalls, calls + 1);
    const pendingReview = app.store.get("salesReviews", originalReview.id);
    const conflict = await req(
      `/sales/minutes/${latestMinute.id}/apply-numbers`,
      "POST",
      {
        version: app.store.get("salesMinutes", latestMinute.id).version,
        reviewVersion: pendingReview.version - 1,
      },
    );
    assert.equal(conflict.status, 409);
    assert.equal(
      (await ok(`/audit?kind=tasks&recordId=${task.id}`)).entries[0].action,
      "delete",
    );
    const auditJson = JSON.stringify(await ok("/audit"));
    assert.ok(
      !auditJson.includes("longterm-test-password") &&
        !auditJson.includes('"password"'),
    );
    const ops = await ok("/operations");
    if (!ops.backingUp) await ok("/operations/backup", "POST", {}, 201);
    await waitFor(() => app.store.get("operations", "backup")?.lastSuccessAt);
    assert.ok(
      readdirSync(join(directory, "backups")).some((f) =>
        f.endsWith(".sqlite"),
      ),
    );
    const backupFile = readdirSync(join(directory, "backups"))
      .filter((f) => f.endsWith(".sqlite"))
      .sort()
      .at(-1);
    const restoredFile = await restoreDatabase(
      join(directory, "backups", backupFile),
      join(directory, "restore-check"),
    );
    const restored = new DatabaseSync(restoredFile.path);
    assert.ok(
      restored.prepare("SELECT COUNT(*) AS n FROM audit_log").get().n > 0,
    );
    assert.equal(
      restored.prepare("SELECT COUNT(*) AS n FROM sessions").get().n,
      0,
    );
    restored.close();
    await assert.rejects(
      restoreDatabase(join(directory, "backups", backupFile), directory),
      /空のフォルダー/,
    );
  } finally {
    await new Promise((r) => app.server.close(r));
    app.store.db.close();
    rmSync(directory, { recursive: true, force: true });
    if (priorKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = priorKey;
    if (priorModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = priorModel;
  }
});
