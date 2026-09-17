import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { openStoreDatabase, digest } from "../server/store.mjs";
import { createApp } from "../server/index.mjs";
import { accountRecords } from "../server/customer-records.mjs";
import { createCustomerHub } from "../server/customer-hub.mjs";
import { canReadTask } from "../server/task-options.mjs";
import { contactInput } from "../server/crm.mjs";

const member = { id: "u", role: "member" },
  admin = { id: "admin", role: "admin" };
function fixture(t) {
  const store = openStoreDatabase(new DatabaseSync(":memory:"));
  t.after(() => store.db.close());
  for (const id of ["a", "b"]) store.put("salesAccounts", { id, name: id });
  const service = createCustomerHub({ store });
  const call = async (route, params = {}, body, user = member) => {
    let result;
    await service({
      p: "/sales/customer-hub/" + route,
      method: body ? "POST" : "GET",
      body,
      url: new URL(
        "http://local/?" + new URLSearchParams({ accountId: "a", ...params }),
      ),
      user,
      reply: (status, value) => {
        result = { status, value };
        return true;
      },
    });
    return result;
  };
  return { store, call };
}
test("customer timeline uses its index, bounded projections and task visibility at query and detail time", async (t) => {
  const { store, call } = fixture(t);
  const tasks = [
    { id: "public" },
    { id: "creator", visibility: "private", createdBy: "u" },
    { id: "legacy", visibility: "private", assigneeId: "u" },
    { id: "array", visibility: "private", assigneeIds: ["u", "v"] },
    {
      id: "empty-array",
      visibility: "private",
      assigneeId: "u",
      assigneeIds: [],
    },
    { id: "hidden", visibility: "private", createdBy: "v", assigneeIds: ["v"] },
  ].map((x) => ({
    ...x,
    accountId: "a",
    title: x.id,
    updatedAt: "2026-09-01T00:00:00.000Z",
    description: "s".repeat(8000),
  }));
  for (const task of tasks) store.put("tasks", task);
  for (const user of [member, admin]) {
    const rows = (await call("timeline", { type: "tasks" }, undefined, user))
      .value.items;
    assert.deepEqual(
      rows.map((r) => r.id).sort(),
      tasks
        .filter((r) => canReadTask(r, user))
        .map((r) => r.id)
        .sort(),
    );
    assert(
      rows.every(
        (r) => r.excerpt.length <= 450 && !Object.hasOwn(r, "description"),
      ),
    );
  }
  await assert.rejects(call("record", { kind: "tasks", id: "hidden" }), {
    status: 404,
  });
  assert.equal(
    (await call("record", { kind: "tasks", id: "creator" })).value.record.id,
    "creator",
  );
  store.put("tasks", { ...tasks[1], createdBy: "v" });
  await assert.rejects(call("record", { kind: "tasks", id: "creator" }), {
    status: 404,
  });
  let plan;
  const proxy = {
    db: {
      prepare(sql) {
        return {
          all(...args) {
            plan = store.db.prepare("EXPLAIN QUERY PLAN " + sql).all(...args);
            return store.db.prepare(sql).all(...args);
          },
        };
      },
    },
  };
  accountRecords(proxy, { kind: "tasks", accountId: "a", user: member });
  assert(
    plan.some((r) => /USING INDEX records_customer_recent/.test(r.detail)),
    JSON.stringify(plan),
  );
  assert(
    !plan.some((r) => /SCAN records/.test(r.detail)),
    JSON.stringify(plan),
  );
});
test("customer timeline paginates equal timestamps across record kinds without duplicates and isolates accounts", async (t) => {
  const { store, call } = fixture(t);
  for (let i = 0; i < 67; i++)
    store.put(i % 2 ? "salesMinutes" : "kwAnalyses", {
      id: "r" + String(i).padStart(3, "0"),
      accountId: "a",
      title: "record" + i,
      updatedAt: "2026-09-01T00:00:00.000Z",
      text: "PRIVATE_RAW_TEXT",
      report: { raw: "HUGE_REPORT" },
    });
  store.put("salesMinutes", {
    id: "old",
    accountId: "a",
    supersededBy: "r001",
  });
  store.put("salesMinutes", { id: "other", accountId: "b" });
  const first = (await call("timeline")).value;
  assert.equal(first.items.length, 25);
  assert(!JSON.stringify(first).includes("PRIVATE_RAW_TEXT"));
  await assert.rejects(
    call("timeline", { accountId: "b", cursor: first.next }),
    { status: 400 },
  );
  await assert.rejects(
    call("timeline", { type: "salesMinutes", cursor: first.next }),
    { status: 400 },
  );
  await assert.rejects(call("record", { kind: "salesMinutes", id: "other" }), {
    status: 404,
  });
  const all = [...first.items];
  let cursor = first.next;
  while (cursor) {
    const page = (await call("timeline", { cursor })).value;
    all.push(...page.items);
    cursor = page.next;
    assert(all.length <= 67);
  }
  assert.equal(all.length, 67);
  assert.equal(new Set(all.map((r) => r.kind + r.id)).size, 67);
  assert(!all.some((r) => ["old", "other"].includes(r.id)));
});
test("customer profiles validate links and dates, reject stale edits, retain audit history and contact roles", async (t) => {
  const { store, call } = fixture(t);
  assert.equal((await call("profile")).value.profile.version, 0);
  const input = {
    accountId: "a",
    version: 0,
    company: "法人",
    brand: "ブランド",
    handover: "引継ぎ",
    relatedAccountIds: ["b"],
    website: "https://example.test",
    renewalDate: "2026-10-01",
  };
  const saved = (await call("profile", {}, input)).value;
  await assert.rejects(call("profile", {}, input), { status: 409 });
  for (const invalid of [
    { website: "javascript:alert(1)" },
    { website: "https://user:pass@example.test" },
    { relatedAccountIds: ["a"] },
    { relatedAccountIds: ["missing"] },
    { renewalDate: "2026-02-30" },
  ]) {
    await assert.rejects(call("profile", {}, { ...saved, ...invalid }), {
      status: 400,
    });
  }
  assert.equal(store.get("customerProfiles", "a").version, 1);
  await call("profile", {}, { ...saved, handover: "追記" });
  assert.equal(
    store.db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit_log WHERE kind='customerProfiles'",
      )
      .get().n,
    2,
  );
  for (let i = 0; i < 31; i++)
    store.put("crmContacts", {
      ...contactInput(store, {
        name: "顧客" + i,
        accountId: "a",
        relationshipRole: "decision",
        department: "営業",
        jobTitle: "部長",
      }),
      id: "c" + i,
    });
  const profile = (await call("profile")).value;
  assert.equal(profile.contacts.length, 30);
  assert(profile.moreContacts);
  assert.equal(profile.contacts[0].relationshipRole, "decision");
  assert.deepEqual(profile.relatedAccounts, [{ id: "b", name: "b" }]);
  assert.throws(
    () => contactInput(store, { name: "bad", relationshipRole: "invalid" }),
    { status: 400 },
  );
  assert.equal(
    contactInput(store, { notes: "new" }, profile.contacts[0]).department,
    "営業",
  );
});

test("customer and template HTTP routes require login, redact task references and export persisted profiles", async () => {
  const store = openStoreDatabase(new DatabaseSync(":memory:"));
  for (const uid of ["admin", "member"]) {
    store.saveUser({
      id: uid,
      name: uid,
      email: uid + "@example.test",
      role: uid,
      active: true,
      mustChangePassword: false,
    });
    store.db
      .prepare("INSERT INTO sessions VALUES (?,?,?)")
      .run(digest(uid), uid, Date.now() + 60000);
  }
  store.put("salesAccounts", { id: "a", name: "Account" });
  store.put("tasks", {
    id: "private",
    accountId: "a",
    visibility: "private",
    createdBy: "admin",
  });
  store.put("salesInitiatives", { id: "i", accountId: "a", taskId: "private" });
  const app = createApp({ store, production: false, timers: false });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  const request = (path, uid, body) =>
    fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        Cookie: uid ? "worknest_session=" + uid : "",
        ...(body
          ? { "Content-Type": "application/json", "X-Worknest": "1" }
          : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    for (const route of [
      "/sales/preparation-templates",
      "/sales/customer-hub/profile?accountId=a",
      "/sales/customer-hub/timeline?accountId=a",
    ])
      assert.equal((await request(route)).status, 401);
    const tmpl = {
      name: "Shared",
      agenda: "Agenda",
      items: ["Check"],
      version: 0,
      requestId: "http-create",
      archived: false,
    };
    assert.equal(
      (await request("/sales/preparation-templates", "member", tmpl)).status,
      403,
    );
    const created = await request(
      "/sales/preparation-templates",
      "admin",
      tmpl,
    );
    assert.equal(created.status, 201);
    const template = await created.json();
    const applied = await request("/sales/preparation/draft", "member", {
      accountId: "a",
      version: 0,
      agenda: "Own agenda",
      applyTemplate: { id: template.id, version: 1 },
    });
    assert.equal(applied.status, 200);
    const detail = await request(
      "/sales/customer-hub/record?accountId=a&kind=salesInitiatives&id=i",
      "member",
    );
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).record.taskId, "");
    const profile = await request("/sales/customer-hub/profile", "member", {
      accountId: "a",
      version: 0,
      company: "Shared company",
      relatedAccountIds: [],
    });
    assert.equal(profile.status, 200);
    const history = await request(
      "/audit?kind=customerProfiles&recordId=a",
      "member",
    );
    assert.equal(history.status, 200);
    assert.equal((await history.json()).entries[0].actor_id, "member");
    const exported = await request("/operations/export-data", "admin", {});
    assert.equal(exported.status, 200);
    const data = await exported.json();
    assert(JSON.stringify(data.records).includes("customerProfiles"));
    assert(JSON.stringify(data.records).includes("meetingPrepTemplates"));
    assert(JSON.stringify(data.records).includes("Own agenda"));
  } finally {
    await app.close();
  }
});
