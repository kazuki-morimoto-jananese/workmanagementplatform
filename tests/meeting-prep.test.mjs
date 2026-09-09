import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { openStoreDatabase } from "../server/store.mjs";
import { createMeetingPrepService } from "../server/meeting-prep.mjs";
import { analyzeKw } from "../src/kw-analysis.ts";
test("meeting preparation version conflicts, immutable snapshots, account isolation and duplicate task protection", async () => {
  const store = openStoreDatabase(new DatabaseSync(":memory:"));
  store.put("salesAccounts", { id: "a" });
  store.put("salesAccounts", { id: "b" });
  let created = 0;
  const service = createMeetingPrepService({
    store,
    createLinkedTask: (body, accountId, user) => {
      const t = { ...body, id: "t" + ++created, accountId, createdBy: user.id };
      store.put("tasks", t);
      return t;
    },
  });
  const user = {
    id: "u",
    email: "test@example.test",
    active: true,
    role: "admin",
  };
  store.saveUser(user);
  async function call(p, body = {}, method = "POST", accountId = "a") {
    let result;
    await service({
      p: "/sales/preparation" + p,
      method,
      body: { accountId, ...body },
      user,
      url: new URL("http://local?accountId=" + accountId),
      reply: (s, r) => {
        result = { status: s, value: r };
        return true;
      },
    });
    return result;
  }
  await call("/draft", { version: 0, agenda: "商談で確認" });
  await assert.rejects(call("/draft", { version: 0, agenda: "上書き" }), {
    status: 409,
  });
  assert.equal((await call("", {}, "GET")).value.draft.agenda, "商談で確認");
  const own = {
    keyword: "kw",
    company: "OWN",
    cost: 100,
    click: 10,
    cv: 0,
    impression: 100,
  };
  const report = analyzeKw({
    own: "OWN",
    before: [own],
    after: [own],
    periods: [
      { from: "2026-07-01", to: "2026-07-31" },
      { from: "2026-08-01", to: "2026-08-31" },
    ],
    sources: ["a", "b"].map((s) => ({
      name: s,
      hash: s.repeat(64),
      sheet: "CSV",
      count: 1,
    })),
  });
  const body = { requestId: "request-one", title: "比較", report };
  const saved = (await call("/analyses", body)).value;
  assert.equal((await call("/analyses", body)).value.id, saved.id);
  assert.equal(store.all("kwAnalyses").length, 1);
  await assert.rejects(call("/analyses", { ...body, title: "異なる内容" }), {
    status: 409,
  });
  await assert.rejects(call("/analyses/" + saved.id, {}, "GET", "b"), {
    status: 404,
  });
  await call("/analyses/" + saved.id + "/task", { index: 0, projectId: "p" });
  await call("/analyses/" + saved.id + "/task", { index: 0, projectId: "p" });
  assert.equal(created, 1);
  assert(store.get("tasks", "t1").description.includes(saved.id));
  await assert.rejects(
    call("/analyses", {
      requestId: "invalid-one",
      report: { ...report, before: { cost: "bad" } },
    }),
    { status: 400 },
  );
  assert.equal(store.get("kwAnalyses", saved.id).report.after.cost, 100);
});
