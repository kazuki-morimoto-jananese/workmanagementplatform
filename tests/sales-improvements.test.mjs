import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { openStoreDatabase, digest } from "../server/store.mjs";
import { createSalesImprovements } from "../server/sales-improvements.mjs";
import { createApp } from "../server/index.mjs";

test("initiative outcomes enforce account/period/definition boundaries, preserve evidence and avoid duplicate tasks", async () => {
  const store = openStoreDatabase(new DatabaseSync(":memory:"));
  try {
    const user = {
      id: "u",
      email: "u@example.test",
      active: true,
      role: "member",
    };
    store.saveUser(user);
    store.put("salesAccounts", { id: "a" });
    store.put("salesAccounts", { id: "b" });
    const totals = (cost, cv) => ({
      cost,
      cv,
      click: 10,
      impression: 100,
      cpa: cv ? cost / cv : null,
    });
    const report = {
      own: "OWN",
      calculationVersion: "kw-v1",
      periods: [
        { from: "2026-07-01", to: "2026-07-31" },
        { from: "2026-08-01", to: "2026-08-31" },
      ],
      before: totals(100, 0),
      after: totals(100, 2),
      sources: [{ hash: "before" }, { hash: "after" }],
    };
    store.put("kwAnalyses", {
      id: "analysis",
      accountId: "a",
      title: "KW comparison",
      report,
    });
    store.put("kwAnalyses", {
      id: "foreign",
      accountId: "b",
      title: "Another customer",
      report,
    });
    store.put("kwAnalyses", {
      id: "placement",
      accountId: "a",
      title: "LINE",
      report: { ...report, calculationVersion: "placement-v1" },
    });
    let created = 0;
    const service = createSalesImprovements({
      store,
      createLinkedTask: (body, accountId) => {
        const task = {
          ...body,
          accountId,
          id: "t" + ++created,
          createdBy: user.id,
        };
        store.put("tasks", task);
        return task;
      },
    });
    async function call(p, body = {}, method = "POST", as = user) {
      let result;
      await service({
        p: "/sales/improvements" + p,
        method,
        body,
        user: as,
        url: new URL("http://local?month=2026-09"),
        reply: (status, value) => {
          result = { status, value };
          return true;
        },
      });
      return result;
    }
    const draft = {
      accountId: "a",
      title: "Improve application flow",
      ownerId: "u",
      status: "proposed",
      requestId: "request",
      baselineId: "analysis",
      baselineSide: 0,
    };
    const first = (await call("/initiatives", draft)).value;
    assert.equal((await call("/initiatives", draft)).value.id, first.id);
    await assert.rejects(call("/initiatives", { ...draft, title: "changed" }), {
      status: 409,
    });
    await assert.rejects(
      call("/initiatives", {
        ...draft,
        requestId: "foreign",
        baselineId: "foreign",
      }),
      { status: 404 },
    );
    const reviewed = {
      ...first,
      status: "reviewed",
      implementedAt: "2026-08-01",
      followupId: "analysis",
      followupSide: 1,
      comparable: true,
      definition: "応募完了CV・全KW",
      conclusion: "CVは増加。予算変更もあり継続検証する。",
    };
    await assert.rejects(
      call("/initiatives", { ...reviewed, comparable: false }),
      { status: 400 },
    );
    await assert.rejects(
      call("/initiatives", { ...reviewed, followupSide: 0 }),
      { status: 400 },
    );
    await assert.rejects(
      call("/initiatives", { ...reviewed, implementedAt: "2026-08-15" }),
      { status: 400 },
    );
    await assert.rejects(
      call("/initiatives", { ...reviewed, followupId: "placement" }),
      { status: 400 },
    );
    await assert.rejects(
      call("/initiatives", { ...reviewed, reviewAt: "2026-02-30" }),
      { status: 400 },
    );
    const saved = (await call("/initiatives", reviewed)).value;
    assert.equal(saved.version, 2);
    assert.equal(saved.baseline.totals.cv, 0);
    assert.equal(saved.baseline.totals.cpa, null);
    assert.equal(saved.followup.totals.cpa, 50);
    assert.equal(saved.baseline.source.hash, "before");
    await assert.rejects(call("/initiatives", reviewed), { status: 409 });
    await call("/task", { id: saved.id, projectId: "p" });
    await call("/task", { id: saved.id, projectId: "p" });
    assert.equal(created, 1);
    const task = store.get("tasks", "t1");
    assert.equal(task.accountId, "a");
    assert(task.description.includes(saved.id));
    const privateTask = {
      ...task,
      visibility: "private",
      createdBy: "other",
      assigneeId: "other",
    };
    store.put("tasks", privateTask);
    assert.equal((await call("", {}, "GET")).value.initiatives[0].taskId, "");
    await assert.rejects(call("/task", { id: saved.id }), { status: 409 });
    assert.equal(created, 1);
    const action = {
      accountId: "a",
      month: "2026-09",
      week: "2026-09-14",
      kind: "task",
      referenceId: "t1",
      fingerprint: "private title",
      status: "done",
    };
    await assert.rejects(call("/action", action), { status: 404 });
    await call("/action", action, "POST", { ...user, id: "other" });
    assert.equal((await call("", {}, "GET")).value.states.length, 0);
    const state = {
      ...action,
      kind: "contact",
      referenceId: "",
      fingerprint: "last contact",
    };
    const recorded = (await call("/action", state)).value;
    await assert.rejects(call("/action", state), { status: 409 });
    await assert.rejects(
      call("/action", { ...recorded, status: "snoozed", until: "2000-01-01" }),
      { status: 400 },
    );
    assert(
      store.db
        .prepare("SELECT * FROM audit_log WHERE kind='salesInitiatives'")
        .all().length >= 3,
    );
    store.remove("kwAnalyses", "analysis");
    assert.equal(
      store.get("salesInitiatives", saved.id).followup.totals.cpa,
      50,
      "saved evidence is independent of source availability",
    );
  } finally {
    store.db.close();
  }
});

test("HTTP usage is admin only and private action evidence stays hidden in audit history", async () => {
  const store = openStoreDatabase(new DatabaseSync(":memory:"));
  for (const id of ["admin", "member"]) {
    store.saveUser({
      id,
      name: id,
      email: id + "@example.test",
      role: id,
      active: true,
      mustChangePassword: false,
    });
    store.db
      .prepare("INSERT INTO sessions VALUES (?,?,?)")
      .run(digest(id), id, Date.now() + 60000);
  }
  store.put("tasks", {
    id: "private",
    visibility: "private",
    createdBy: "admin",
  });
  store.put("salesActionStates", {
    id: "s",
    kind: "task",
    referenceId: "private",
    fingerprint: "CONFIDENTIAL",
    note: "PRIVATE NOTE",
  });
  store.put("salesInitiatives", { id: "i", taskId: "private" });
  const app = createApp({ store, production: false, timers: false });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  const get = (path, uid) =>
    fetch(base + path, {
      headers: { Cookie: uid ? "worknest_session=" + uid : "" },
    });
  try {
    assert.equal((await get("/operations/usage")).status, 401);
    assert.equal((await get("/operations/usage", "member")).status, 403);
    const usage = await get("/operations/usage", "admin");
    assert.equal(usage.status, 200);
    assert.equal(typeof (await usage.json()).reads, "number");
    const audit = await get(
      "/audit?kind=salesActionStates&recordId=s",
      "member",
    );
    assert.equal(audit.status, 200);
    assert.deepEqual((await audit.json()).entries, []);
    const initiativeAudit = await (
      await get("/audit?kind=salesInitiatives&recordId=i", "member")
    ).json();
    assert.equal(initiativeAudit.entries[0].after_data.taskId, "");
  } finally {
    await app.close();
  }
});
