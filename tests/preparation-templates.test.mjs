import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { openStoreDatabase } from "../server/store.mjs";
import { createPreparationTemplates } from "../server/preparation-templates.mjs";
import { createMeetingPrepService } from "../server/meeting-prep.mjs";

test("preparation templates enforce edit permissions, append safely, preserve checked evidence and immutable versions", async (t) => {
  const store = openStoreDatabase(new DatabaseSync(":memory:"));
  t.after(() => store.db.close());
  store.put("salesAccounts", { id: "a" });
  const service = createPreparationTemplates({ store }),
    prep = createMeetingPrepService({ store });
  async function call(p, body, role = "admin") {
    let result;
    const args = {
      p,
      method: body ? "POST" : "GET",
      body,
      user: { id: "u", role },
      url: new URL("http://local?accountId=a"),
      reply: (status, value) => {
        result = { status, value };
        return true;
      },
    };
    await (p === "/sales/preparation-templates" ? service : prep)(args);
    return result.value;
  }
  const base = "/sales/preparation-templates",
    draftRoute = "/sales/preparation/draft";
  const input = {
    name: "定例",
    agenda: "予算確認",
    items: ["確認済み項目", "次の提案"],
    version: 0,
    requestId: "new-template",
    archived: false,
  };
  await assert.rejects(call(base, input, "member"), { status: 403 });
  const template = await call(base, input);
  assert.equal((await call(base, input)).id, template.id);
  await assert.rejects(call(base, { ...input, name: "different" }), {
    status: 409,
  });
  const initial = await call(
    draftRoute,
    {
      accountId: "a",
      version: 0,
      agenda: "入力済みの議題",
      checklist: [
        {
          id: "check",
          label: "確認済み項目",
          done: true,
          note: "担当者確認済み",
        },
      ],
    },
    "member",
  );
  const applied = await call(
    draftRoute,
    {
      ...initial,
      applyTemplate: { id: template.id, version: 1 },
      templateSources: [{ key: "forged" }],
    },
    "member",
  );
  assert.equal(applied.checklist.length, 2);
  assert(applied.checklist[0].done);
  assert.equal(applied.checklist[0].note, "担当者確認済み");
  assert(applied.agenda.startsWith("入力済みの議題\n\n"));
  assert.equal(applied.templateSources.length, 1);
  const twice = await call(draftRoute, {
    ...applied,
    applyTemplate: { id: template.id, version: 1 },
  });
  assert.equal(twice.agenda, applied.agenda);
  assert.deepEqual(twice.checklist, applied.checklist);
  const edited = await call(base, {
    ...template,
    agenda: "更新後の議題",
    items: ["別の項目"],
  });
  assert.equal(
    store.get("meetingPrepDrafts", "a").templateSources[0].agenda,
    "予算確認",
  );
  await assert.rejects(
    call(draftRoute, {
      ...twice,
      applyTemplate: { id: template.id, version: 1 },
    }),
    { status: 409 },
  );
  const legacy = await call(draftRoute, {
    accountId: "a",
    version: twice.version,
    agenda: twice.agenda + "\n追記",
  });
  assert.deepEqual(legacy.checklist, twice.checklist);
  assert.deepEqual(legacy.templateSources, twice.templateSources);
  await assert.rejects(
    call(draftRoute, {
      ...legacy,
      agenda: "x".repeat(3999),
      applyTemplate: { id: template.id, version: 2 },
    }),
    { status: 400 },
  );
  await assert.rejects(
    call(draftRoute, {
      ...legacy,
      checklist: Array.from({ length: 30 }, (_, i) => ({
        id: "c" + i,
        label: "項目" + i,
        done: false,
        note: "",
      })),
      applyTemplate: { id: template.id, version: 2 },
    }),
    { status: 400 },
  );
  assert.deepEqual(store.get("meetingPrepDrafts", "a"), legacy);
  await assert.rejects(call(base, { ...template, name: "古い編集" }), {
    status: 409,
  });
  await call(base, { ...edited, archived: true });
  assert(
    !(await call(base, undefined, "member")).templates.some(
      (r) => r.id === template.id,
    ),
  );
  assert(
    (await call(base)).templates.some(
      (r) => r.id === template.id && r.archived,
    ),
  );
  await assert.rejects(
    call(draftRoute, {
      ...legacy,
      applyTemplate: { id: template.id, version: 3 },
    }),
    { status: 404 },
  );
  assert.equal(
    store.get("meetingPrepDrafts", "a").templateSources[0].agenda,
    "予算確認",
  );
  const audit = store.db
    .prepare(
      "SELECT after_data FROM audit_log WHERE kind='meetingPrepDrafts' ORDER BY seq",
    )
    .all()
    .map((r) => JSON.parse(r.after_data));
  assert(audit.some((r) => r.templateSources[0]?.agenda === "予算確認"));
  await assert.rejects(
    call(draftRoute, {
      ...legacy,
      checklist: [
        { id: "dup", label: "a", done: false },
        { id: "dup", label: "b", done: false },
      ],
    }),
    { status: 400 },
  );
});
