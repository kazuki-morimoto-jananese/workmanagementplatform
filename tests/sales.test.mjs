import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/index.mjs";
import {
  buildPreview,
  parseDelimited,
  csvCell,
} from "../server/sales-import.mjs";
import { monday, jstToday } from "../server/sales.mjs";

test("quoted multiline spreadsheet import, currencies, explicit zero and invalid identifiers", () => {
  const p = buildPreview({
    text: 'アカウントID\tアカウント名\t今週Gトレ\t今月ヨミ\t"ヨミ根拠\n（なぜそのヨミなのか）"\n001\tテスト社\t¥0\t"¥1,000,000"\t"顧客合意\n増額の根拠"\n002\t第二社\t\t0\tゼロ円確認',
  });
  assert.equal(p.errors.length, 0);
  assert.equal(p.rows.length, 2);
  assert.equal(p.rows[0].accountId, "001");
  assert.equal(p.rows[0].forecast, 1000000);
  assert.equal(p.rows[0].reason, "顧客合意\n増額の根拠");
  assert.equal(p.rows[1].gTrend, null);
  assert.equal(p.rows[1].forecast, 0);
  assert.ok(
    buildPreview({
      text: "アカウントID,アカウント名,今週Gトレ\na,社,-1\na,重複,10",
    }).errors.length >= 2,
  );
  assert.throws(() => parseDelimited('ID,Name\n1,"unclosed'));
  assert.equal(csvCell('=HYPERLINK("unsafe")'), '"\'=HYPERLINK(""unsafe"")"');
});

test("sales workflows preserve manual forecasts, history, raw metrics and task links", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "worknest-sales-"));
  const app = createApp({
    dataDir: directory,
    production: false,
    allowedDomain: "",
  });
  const month = jstToday().slice(0, 7),
    week = monday();
  let cookie = "";
  const oldKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  let project, account, review, minute, task;
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (path, method = "GET", body, auth = cookie) => {
    const r = await fetch(base + "/api" + path, {
      method,
      headers: {
        "X-Worknest": "1",
        "Content-Type": "application/json",
        Cookie: auth,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json(), headers: r.headers };
  };
  const bootstrap = async () =>
    (await call(`/sales/bootstrap?month=${month}&weekOf=${week}`)).body;
  try {
    assert.equal((await call("/sales/bootstrap")).status, 401);
    await call("/auth/setup", "POST", {
      workspace: "Sales test",
      name: "営業管理者",
      email: "sales@company.test",
      password: "Password-test-sales!",
      samples: false,
    });
    cookie = (
      await call("/auth/login", "POST", {
        email: "sales@company.test",
        password: "Password-test-sales!",
      })
    ).headers
      .get("set-cookie")
      .split(";")[0];
    project = (await call("/projects", "POST", { name: "営業アクション" }))
      .body;
    await t.test(
      "import previews and commits without unsafe aggregation",
      async () => {
        const input =
          "アカウントID\tアカウント名\t当月担当者\t今月目標\t今週Gトレ\t今月ヨミ\tヨミ根拠\tスタンバイ予算\tスタンバイ消化額\tスタンバイ実測CV\tIndeed消化額\nacct-01\t取引先A\t営業管理者\t1000000\t700000\t800000\t顧客予算確定\t900000\t300000\t30\t2000000";
        assert.equal(
          (await call("/sales/imports/preview", "POST", { text: input, month }))
            .body.errors.length,
          0,
        );
        const imported = await call("/sales/imports/commit", "POST", {
          text: input,
          month,
          seedReviews: true,
        });
        assert.equal(imported.status, 200);
        assert.equal(imported.body.created, 1);
        const d = await bootstrap();
        account = d.accounts[0];
        review = d.reviews[0];
        assert.equal(d.masters[0].media.stanby.spend, 300000);
        assert.equal(d.masters[0].media.stanby.budget, 900000);
        assert.equal(review.forecast, 800000);
        assert.ok(account.ownerId);
        assert.equal(
          (
            await call("/sales/imports/commit", "POST", {
              text: input + "\nacct-01\tDUPLICATE",
              month,
            })
          ).status,
          400,
        );
        assert.equal((await bootstrap()).accounts.length, 1);
        const originalOwnerId = account.ownerId;
        const reassignedMember = await call("/members", "POST", {
          name: "引継ぎ担当",
          email: "handover@company.test",
          password: "Temporary-handover-password!",
        });
        assert.equal(reassignedMember.status, 201);
        const refreshIdentity = async (ownerName, contactDate) => {
          const result = await call("/sales/imports/commit", "POST", {
            text: `アカウントID\tアカウント名\t当月担当者\t最終接点日\nacct-01\t取引先A\t${ownerName}\t${contactDate}`,
            month,
          });
          assert.equal(result.status, 200);
          return (await bootstrap()).accounts[0];
        };
        account = await refreshIdentity("引継ぎ担当", "2026-08-10");
        assert.equal(account.ownerId, reassignedMember.body.id);
        assert.equal(account.ownerName, "引継ぎ担当");
        assert.equal(
          (
            await call("/sales/activities", "POST", {
              accountId: account.id,
              type: "meeting",
              date: "2026-08-20",
            })
          ).status,
          201,
        );
        for (const sourceDate of ["2026-08-10", "", "2026-02-30"]) {
          account = await refreshIdentity("引継ぎ担当", sourceDate);
          assert.equal(
            account.lastContactAt,
            "2026-08-20",
            "A stale, blank or invalid source date must preserve a recorded contact",
          );
        }
        account = await refreshIdentity("引継ぎ担当", "2026-08-25");
        assert.equal(account.lastContactAt, "2026-08-25");
        const manualOwner = await call(
          `/sales/accounts/${account.id}`,
          "PATCH",
          {
            ...account,
            ownerId: originalOwnerId,
          },
        );
        assert.equal(manualOwner.status, 200);
        account = await refreshIdentity("引継ぎ担当", "");
        assert.equal(
          account.ownerId,
          originalOwnerId,
          "An unchanged source owner must preserve manual member mapping",
        );
        account = await refreshIdentity("未登録担当", "");
        assert.equal(account.ownerId, "");
        account = await refreshIdentity("営業管理者", "");
        assert.equal(account.ownerId, originalOwnerId);
      },
    );
    await t.test(
      "weekly snapshots, optimistic concurrency and refresh ownership",
      async () => {
        let saved = await call("/sales/reviews", "POST", {
          ...review,
          forecast: 850000,
          reason: "商談後に更新",
        });
        assert.equal(saved.status, 200);
        review = saved.body;
        assert.equal(
          (
            await call("/sales/reviews", "POST", {
              ...review,
              version: 1,
              forecast: 1,
              reason: "stale",
            })
          ).status,
          409,
        );
        const refresh =
          "アカウントID\tアカウント名\t今週Gトレ\t今月ヨミ\nacct-01\t取引先A\t750000\t1";
        assert.equal(
          (
            await call("/sales/imports/commit", "POST", {
              text: refresh,
              month,
              seedReviews: true,
            })
          ).status,
          200,
        );
        let d = await bootstrap();
        assert.equal(d.reviews[0].forecast, 850000);
        assert.equal(d.masters[0].gTrend, 750000);
        assert.equal(
          d.masters[0].media.indeed.spend,
          2000000,
          "Unmapped metrics survive another sheet import",
        );
        assert.equal(d.masters[0].target, 1000000);
        assert.ok(d.history.length >= 2);
        const next = new Date(week + "T00:00:00Z");
        next.setUTCDate(next.getUTCDate() + 7);
        const newWeek = await call("/sales/reviews", "POST", {
          ...review,
          version: undefined,
          weekOf: next.toISOString().slice(0, 10),
          forecast: 900000,
          reason: "翌週の合意",
        });
        assert.equal(newWeek.status, 200);
        assert.equal((await bootstrap()).reviews.length, 2);
        assert.equal(
          (
            await call("/sales/reviews", "POST", {
              ...review,
              forecast: 100,
              reason: "",
            })
          ).status,
          400,
        );
        assert.equal(
          (await call("/sales/reviews", "POST", { ...review, aggressive: 1 }))
            .status,
          400,
        );
      },
    );
    await t.test(
      "opportunities and activities validate business numbers",
      async () => {
        const o = await call("/sales/opportunities", "POST", {
          accountId: account.id,
          title: "増額提案",
          amount: 200000,
          probability: 40,
          stage: "proposal",
          expectedCloseDate: month + "-28",
          ownerId: account.ownerId,
          nextAction: "条件を確認",
        });
        assert.equal(o.status, 201);
        assert.equal(
          (
            await call("/sales/opportunities/" + o.body.id, "PATCH", {
              version: o.body.version,
              stage: "won",
              probability: 10,
            })
          ).body.probability,
          100,
        );
        assert.equal(
          (
            await call("/sales/activities", "POST", {
              accountId: account.id,
              type: "call",
              date: jstToday(),
              notes: "予算をヒアリング",
            })
          ).status,
          201,
        );
        assert.equal((await bootstrap()).accounts[0].lastContactAt, jstToday());
      },
    );
    await t.test(
      "minutes are preserved, summarized locally and task creation is idempotent",
      async () => {
        const result = await call("/sales/minutes", "POST", {
          accountId: account.id,
          title: "週次定例",
          meetingDate: jstToday(),
          text: "決定事項：現行予算を継続する\n課題：看護師CPAが許容額を超過\n次のアクション：改善提案を提出する",
          autoSummarize: true,
        });
        assert.equal(result.status, 201);
        minute = result.body;
        for (let i = 0; i < 30; i++) {
          minute = (await bootstrap()).minutes.find((m) => m.id === minute.id);
          if (minute.status === "completed") break;
          await new Promise((r) => setTimeout(r, 20));
        }
        assert.equal(minute.status, "completed");
        assert.equal(minute.summaryProvider, "local");
        const audit = await call(
          `/audit?kind=salesMinutes&recordId=${minute.id}`,
        );
        const completed = audit.body.entries.find(
          (entry) => entry.after_data?.status === "completed",
        );
        assert.equal(
          completed.actor_id,
          "system",
          "The summary worker must not inherit another request's actor",
        );
        assert.ok(minute.summary.actions.length > 0);
        assert.ok(minute.text.includes("課題"));
        const taskInput = {
          actionIndex: 0,
          version: minute.version,
          projectId: project.id,
          assigneeId: account.ownerId,
        };
        assert.equal(
          (
            await call(`/sales/accounts/${account.id}/tasks`, "POST", {
              ...taskInput,
              title: "偽装されたアクション",
              minuteId: minute.id,
              minuteActionIndex: 0,
            })
          ).status,
          400,
        );
        app.store.put("salesMinutes", { ...minute, status: "processing" });
        assert.equal(
          (await call(`/sales/minutes/${minute.id}/tasks`, "POST", taskInput))
            .status,
          409,
        );
        app.store.put("salesMinutes", minute);
        assert.equal(
          (
            await call(`/sales/minutes/${minute.id}/tasks`, "POST", {
              ...taskInput,
              version: minute.version - 1,
            })
          ).status,
          409,
        );
        const created = await call(
          `/sales/minutes/${minute.id}/tasks`,
          "POST",
          {
            version: minute.version,
            actionIndex: 0,
            projectId: project.id,
            assigneeId: account.ownerId,
          },
        );
        assert.equal(created.status, 201);
        task = created.body;
        assert.equal(task.accountId, account.id);
        assert.equal(task.minuteId, minute.id);
        assert.equal(task.minuteActionIndex, 0);
        const duplicate = await call(
          `/sales/minutes/${minute.id}/tasks`,
          "POST",
          {
            actionIndex: 0,
            projectId: project.id,
            assigneeId: account.ownerId,
          },
        );
        assert.equal(duplicate.status, 200);
        assert.equal(duplicate.body.id, task.id);
        const revised = {
          ...minute,
          id: "revision-google-test",
          rootMinuteId: minute.id,
          previousMinuteId: minute.id,
          version: 1,
          taskLinks: [],
        };
        app.store.put("salesMinutes", revised);
        const revisedTask = await call(
          `/sales/minutes/${revised.id}/tasks`,
          "POST",
          {
            actionIndex: 0,
            version: 1,
            projectId: project.id,
            assigneeId: account.ownerId,
          },
        );
        assert.equal(revisedTask.status, 200);
        assert.equal(revisedTask.body.id, task.id);
        app.store.remove("salesMinutes", revised.id);
        const updated = await call("/tasks/" + task.id, "PATCH", {
          version: task.version,
          status: "done",
        });
        assert.equal(updated.status, 200);
        assert.equal(updated.body.accountId, account.id);
        assert.equal(updated.body.minuteId, minute.id);
        assert.equal(
          (await call(`/sales/minutes/${minute.id}/summarize`, "POST", {}))
            .status,
          409,
        );
      },
    );
    await t.test(
      "export uses one weekly snapshot and source configuration requires admin",
      async () => {
        const exportResult = await call(
          `/sales/export?month=${month}&weekOf=${week}`,
        );
        assert.equal(exportResult.status, 200);
        assert.match(exportResult.body.csv, /850000/);
        assert.doesNotMatch(exportResult.body.csv, /900000/);
        const employee = await call("/members", "POST", {
          name: "営業メンバー",
          email: "rep@company.test",
          password: "Temporary-sales-password",
        });
        assert.equal(employee.status, 201);
        const empCookie = (
          await call("/auth/login", "POST", {
            email: "rep@company.test",
            password: "Temporary-sales-password",
          })
        ).headers
          .get("set-cookie")
          .split(";")[0];
        await call(
          "/auth/password",
          "POST",
          {
            currentPassword: "Temporary-sales-password",
            password: "Personal-sales-password!",
          },
          empCookie,
        );
        assert.equal(
          (
            await call(
              "/sales/imports/commit",
              "POST",
              { text: "", month },
              empCookie,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await call(
              "/sales/connections",
              "POST",
              {
                spreadsheetId: "testSheet123456789",
                range: "Data!A1:Z100",
                month,
                rollingMonth: true,
                enabled: false,
              },
              empCookie,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await call("/sales/connections", "POST", {
              spreadsheetId: "testSheet123456789",
              range: "Data!A1:Z100",
              month,
              rollingMonth: true,
              enabled: false,
            })
          ).status,
          200,
        );
        const state = await bootstrap();
        assert.equal(state.connections.source.enabled, false);
        assert.equal("GEMINI_API_KEY" in state.connections, false);
        assert.equal(
          (await call("/sales/demo", "POST", {}, empCookie)).status,
          403,
        );
        const seeded = await call("/sales/demo", "POST", {});
        assert.equal(seeded.status, 201);
        assert.equal(seeded.body.created.salesMasters, 18);
        const realExport = await call(
          `/sales/export?month=${month}&weekOf=${week}`,
        );
        assert.doesNotMatch(realExport.body.csv, /demo-sfa/);
        assert.match(realExport.body.csv, /acct-01/);
        const demoExport = await call(
          `/sales/export?month=${month}&weekOf=${week}&scope=demo`,
        );
        assert.match(demoExport.body.csv, /demo-sfa/);
        assert.doesNotMatch(demoExport.body.csv, /acct-01/);
        const demo = (await bootstrap()).accounts.find((a) => a.isDemo);
        const changed = await call(`/sales/accounts/${demo.id}`, "PATCH", {
          version: demo.version,
          name: "デモ：名前を編集",
        });
        assert.equal(changed.body.isDemo, true);
        assert.equal(
          (await call("/sales/demo", "POST", {})).body.totalCreated,
          0,
        );
      },
    );
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = oldKey;
  }
});
