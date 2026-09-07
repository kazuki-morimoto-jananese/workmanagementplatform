import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/index.mjs";

test("authentication, authorization, persistence and collaborative workflows", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "worknest-api-"));
  let app = createApp({
    dataDir: directory,
    production: false,
    allowedDomain: "company.test",
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  let base = `http://127.0.0.1:${app.server.address().port}`;
  let cookie = "";
  async function request(
    path,
    method = "GET",
    body,
    auth = cookie,
    extraHeaders = {},
  ) {
    const response = await fetch(base + "/api" + path, {
      method,
      headers: {
        "X-Worknest": "1",
        "Content-Type": "application/json",
        ...(auth ? { Cookie: auth } : {}),
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      result = text;
    }
    return { status: response.status, body: result, headers: response.headers };
  }
  const password = "A-strong-admin-password!";
  let first, second, task, admin, employee, employeeCookie;
  try {
    await t.test("private API and one-time setup", async () => {
      assert.equal((await request("/bootstrap")).status, 401);
      assert.equal((await request("/auth/status")).body.needsSetup, true);
      assert.equal(
        (
          await request("/auth/setup", "POST", {
            email: "admin@outside.test",
            name: "管理者",
            workspace: "テストチーム",
            password,
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request("/auth/setup", "POST", {
            email: "admin@company.test",
            name: "管理者",
            workspace: "テストチーム",
            password,
            samples: false,
          })
        ).status,
        201,
      );
      assert.equal((await request("/auth/setup", "POST", {})).status, 403);
      assert.equal(
        (
          await request("/auth/login", "POST", {
            email: "admin@company.test",
            password: "wrong",
          })
        ).status,
        401,
      );
      const login = await request("/auth/login", "POST", {
        email: "admin@company.test",
        password,
      });
      assert.equal(login.status, 200);
      cookie = login.headers.get("set-cookie").split(";")[0];
      assert.match(login.headers.get("set-cookie"), /HttpOnly/);
      assert.match(login.headers.get("set-cookie"), /SameSite=Lax/);
      const bootstrap = await request("/bootstrap");
      admin = bootstrap.body.user;
      assert.equal(bootstrap.body.workspace.name, "テストチーム");
      assert.equal("password" in admin, false);
      assert.equal(
        (
          await request("/projects", "POST", { name: "forged" }, cookie, {
            Origin: "https://evil.example",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/projects", "POST", { name: "forged" }, cookie, {
            "X-Worknest": "",
          })
        ).status,
        403,
      );
    });
    await t.test("member onboarding and role boundaries", async () => {
      const response = await request("/members", "POST", {
        name: "チームメンバー",
        email: "member@company.test",
        password: "temporary-password-123",
      });
      assert.equal(response.status, 201);
      employee = response.body;
      employeeCookie = (
        await request("/auth/login", "POST", {
          email: employee.email,
          password: "temporary-password-123",
        })
      ).headers
        .get("set-cookie")
        .split(";")[0];
      assert.equal(
        (await request("/bootstrap", "GET", undefined, employeeCookie)).status,
        403,
      );
      assert.equal(
        (
          await request(
            "/auth/password",
            "POST",
            {
              currentPassword: "temporary-password-123",
              password: "Member-personal-password!",
            },
            employeeCookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (await request("/bootstrap", "GET", undefined, employeeCookie)).status,
        200,
      );
      assert.equal(
        (
          await request(
            "/members",
            "POST",
            { name: "No", email: "no@company.test", password },
            employeeCookie,
          )
        ).status,
        403,
      );
      assert.equal(
        (await request(`/members/${admin.id}`, "PATCH", { active: false }))
          .status,
        400,
      );
      assert.equal(
        (await request(`/members/${employee.id}`, "PATCH", { role: "admin" }))
          .status,
        200,
      );
      assert.equal(
        (await request("/operations", "GET", undefined, employeeCookie)).status,
        200,
      );
      assert.equal(
        (await request(`/members/${employee.id}`, "PATCH", { role: "member" }))
          .status,
        200,
      );
      assert.equal(
        (await request("/operations", "GET", undefined, employeeCookie)).status,
        403,
      );
    });
    await t.test(
      "projects, multi-home, custom fields and automation",
      async () => {
        first = (
          await request("/projects", "POST", {
            name: "制作",
            fields: [{ name: "予算", type: "number", options: [] }],
            rules: [
              {
                status: "review",
                assigneeId: employee.id,
                dueDays: 3,
                enabled: true,
              },
            ],
          })
        ).body;
        second = (await request("/projects", "POST", { name: "営業" })).body;
        const response = await request("/tasks", "POST", {
          title: "提案書を作成",
          projectIds: [first.id, second.id],
          custom: { [first.fields[0].id]: 12000 },
          priority: "high",
          assigneeId: admin.id,
        });
        assert.equal(response.status, 201);
        task = response.body;
        assert.equal(task.projectIds.length, 2);
        assert.equal(task.custom[first.fields[0].id], 12000);
        const bad = await request(`/tasks/${task.id}`, "PATCH", {
          version: task.version,
          custom: { [first.fields[0].id]: "not a number" },
        });
        assert.equal(bad.status, 400);
        const next = await request(`/tasks/${task.id}`, "PATCH", {
          version: task.version,
          status: "review",
        });
        assert.equal(next.status, 200);
        assert.equal(next.body.assigneeId, employee.id);
        assert.ok(next.body.dueDate);
        task = next.body;
        assert.equal(
          (
            await request(`/tasks/${task.id}`, "PATCH", {
              version: 1,
              title: "stale update",
            })
          ).status,
          409,
        );
        const notifications = (
          await request("/bootstrap", "GET", undefined, employeeCookie)
        ).body.notifications;
        assert.equal(notifications.length, 1);
        assert.equal(
          (
            await request(`/tasks/${task.id}`, "PATCH", {
              version: task.version,
              startDate: "2026-10-10",
              dueDate: "2026-10-09",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request(`/tasks/${task.id}`, "PATCH", {
              version: task.version,
              links: [{ name: "unsafe", url: "javascript:alert(1)" }],
            })
          ).status,
          400,
        );
      },
    );
    await t.test("comments, approvals and calendar export", async () => {
      const response = await request(`/tasks/${task.id}/comments`, "POST", {
        text: "レビューをお願いします。",
      });
      assert.equal(response.status, 201);
      assert.equal(response.body.comments[0].text, "レビューをお願いします。");
      task = response.body;
      assert.equal(
        (
          await request(
            `/tasks/${task.id}/approval`,
            "POST",
            { action: "request", reviewerId: admin.id },
            employeeCookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await request(
            `/tasks/${task.id}/approval`,
            "POST",
            { action: "approve" },
            employeeCookie,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(`/tasks/${task.id}/approval`, "POST", {
            action: "approve",
          })
        ).body.approval.status,
        "approved",
      );
      const calendar = await request(`/tasks/${task.id}/calendar`);
      assert.equal(calendar.status, 200);
      assert.match(calendar.body, /BEGIN:VCALENDAR/);
      assert.match(calendar.body, /SUMMARY:提案書を作成/);
      assert.equal(
        (await request("/notifications/read", "POST", {}, employeeCookie))
          .status,
        200,
      );
      assert.equal(
        (
          await request("/bootstrap", "GET", undefined, employeeCookie)
        ).body.notifications.every((n) => n.read),
        true,
      );
    });
    await t.test(
      "internal requests, dependencies and cycle prevention",
      async () => {
        const response = await request(
          "/requests",
          "POST",
          {
            title: "PCアカウント発行",
            description: "社内の新規アカウントを依頼",
            projectIds: [first.id],
          },
          employeeCookie,
        );
        assert.equal(response.status, 201);
        assert.deepEqual(response.body.tags, ["社内依頼"]);
        const dependent = await request(`/tasks/${response.body.id}`, "PATCH", {
          version: response.body.version,
          dependencies: [task.id],
        });
        assert.equal(dependent.status, 200);
        task = (await request("/bootstrap")).body.tasks.find(
          (t) => t.id === task.id,
        );
        assert.equal(
          (
            await request(`/tasks/${task.id}`, "PATCH", {
              version: task.version,
              dependencies: [dependent.body.id],
            })
          ).status,
          400,
        );
        assert.equal(
          (await request("/requests", "POST", { title: "anonymous" }, ""))
            .status,
          401,
        );
      },
    );
    await t.test(
      "disabling members immediately invalidates their sessions",
      async () => {
        assert.equal(
          (await request(`/members/${employee.id}`, "PATCH", { active: false }))
            .status,
          200,
        );
        assert.equal(
          (await request("/bootstrap", "GET", undefined, employeeCookie))
            .status,
          401,
        );
        assert.equal(
          (
            await request("/auth/login", "POST", {
              email: employee.email,
              password: "Member-personal-password!",
            })
          ).status,
          401,
        );
        assert.equal(
          (await request(`/members/${employee.id}`, "PATCH", { active: true }))
            .status,
          200,
        );
      },
    );
    await t.test("database and session survive a server restart", async () => {
      await app.close();
      app = createApp({
        dataDir: directory,
        production: false,
        allowedDomain: "company.test",
      });
      await new Promise((resolve) =>
        app.server.listen(0, "127.0.0.1", resolve),
      );
      base = `http://127.0.0.1:${app.server.address().port}`;
      const result = await request("/bootstrap");
      assert.equal(result.status, 200);
      assert.equal(result.body.projects.length, 2);
      const saved = result.body.tasks.find((t) => t.id === task.id);
      assert.equal(saved.title, "提案書を作成");
      assert.equal(saved.comments.length, 1);
      assert.equal(saved.approval.status, "approved");
      assert.equal(
        (
          await request(`/tasks/${saved.id}`, "DELETE", {
            version: saved.version,
          })
        ).status,
        200,
      );
      const after = await request("/bootstrap");
      assert.equal(
        after.body.tasks.some((t) => t.id === saved.id),
        false,
      );
      assert.deepEqual(after.body.tasks[0].dependencies, []);
      assert.equal((await request("/auth/logout", "POST", {})).status, 200);
      assert.equal((await request("/bootstrap")).status, 401);
    });
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("production setup requires a configured secret token", async () => {
  const directory = mkdtempSync(join(tmpdir(), "worknest-production-"));
  const app = createApp({ dataDir: directory, production: true });
  try {
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    const response = await fetch(
      `http://127.0.0.1:${app.server.address().port}/api/auth/setup`,
      {
        method: "POST",
        headers: { "X-Worknest": "1", "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "test@company.test",
          password: "strong-password-here",
          name: "Test",
          workspace: "Test",
          setupToken: "incorrect",
        }),
      },
    );
    assert.equal(response.status, 403);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
