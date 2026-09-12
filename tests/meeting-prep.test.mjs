import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { openStoreDatabase } from "../server/store.mjs";
import { createMeetingPrepService } from "../server/meeting-prep.mjs";
import { analyzeKw } from "../src/kw-analysis.ts";
import {
  analyzePlacement,
  normalizePlacementRows,
  suggestPlacementMapping,
} from "../src/placement-analysis.ts";
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
  const header = ["period_date", "publisher_category", "cost", "click", "cv"];
  const mapping = suggestPlacementMapping(header);
  const before = normalizePlacementRows(
    [header, ["2026-07-01", "LINE", "100", "10", "1"]],
    mapping,
    0,
    "daily",
  );
  const placement = analyzePlacement({
    before,
    after: before.map((r) => ({ ...r, date: "2026-08-01", cost: 200 })),
    own: "自社",
    periods: report.periods,
    sources: report.sources,
    granularity: "daily",
  });
  const placed = (
    await call("/analyses", { requestId: "placement-test", report: placement })
  ).value;
  assert.equal(placed.title, "LINEバイト・配信面期間比較");
  assert.equal(
    (await call("/analyses/" + placed.id, {}, "GET")).value.report
      .calculationVersion,
    "placement-v1",
  );
  await call("/analyses/" + placed.id + "/task", { index: 0, projectId: "p" });
  assert(store.get("tasks", "t2").description.includes("placement-v1"));
  const invalid = structuredClone(placement);
  invalid.placement.campaigns[0].after.cost = -1;
  await assert.rejects(
    call("/analyses", { requestId: "bad-placement", report: invalid }),
    { status: 400 },
  );
  await assert.rejects(
    call("/analyses", {
      requestId: "bad-placement-2",
      report: { ...placement, calculationVersion: "kw-v1" },
    }),
    { status: 400 },
  );
});
