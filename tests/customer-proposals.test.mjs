import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { openStoreDatabase, digest } from "../server/store.mjs";
import { createApp } from "../server/index.mjs";
import { createCustomerProposals } from "../server/customer-proposals.mjs";
import { analyzeKw } from "../src/kw-analysis.ts";
import {
  buildCustomerProposal,
  proposalDefaults,
  wrapProposalText,
} from "../shared/customer-proposal.mjs";

function reportFixture() {
  const row = (keyword, company, cost, click, cv) => ({
    keyword,
    company,
    cost,
    click,
    cv,
    impression: 1000,
  });
  return analyzeKw({
    own: "PRIVATE-ID",
    periods: [
      { from: "2026-08-01", to: "2026-08-31" },
      { from: "2026-09-01", to: "2026-09-30" },
    ],
    sources: ["A", "B"].map((s) => ({
      name: `private-file-${s}.csv`,
      sheet: "private-sheet",
      hash: "a".repeat(64),
      count: 3,
    })),
    before: [
      row("採用", "PRIVATE-ID", 100, 10, 1),
      row("医療", "PRIVATE-ID", 200, 20, 2),
      row("採用", "Secret-Competitor", 900, 10, 1),
    ],
    after: [
      row("採用", "PRIVATE-ID", 200, 10, 0),
      row("医療", "PRIVATE-ID", 100, 20, null),
      row("採用", "Secret-Competitor", 500, 10, 1),
    ],
  });
}
test("customer proposal keeps unknowns, zero CV, periods and provenance without exporting internal identities", () => {
  const report = reportFixture();
  const options = proposalDefaults(report, "顧客テスト", "担当者");
  const deck = buildCustomerProposal(report, options);
  const totals = deck.slides.find((s) => s.kind === "table");
  assert.deepEqual(
    totals.rows.find((r) => r[0] === "消化額"),
    ["消化額", "300 円", "300 円", "0 円"],
  );
  assert.deepEqual(
    totals.rows.find((r) => r[0] === "CV"),
    ["CV", "3", "—", "—"],
  );
  const text = JSON.stringify(deck.slides);
  assert.match(text, /CV：1 → 0/);
  assert.match(text, /CPA：100 円 → —/);
  assert.match(text, /日数が異なります/);
  assert.match(text, /CVの定義：未確認/);
  for (const secret of [
    "PRIVATE-ID",
    "Secret-Competitor",
    "private-file",
    "private-sheet",
    "a".repeat(64),
  ])
    assert(!text.includes(secret));
  const competition = buildCustomerProposal(report, {
    ...options,
    includeCompetition: true,
  });
  assert(JSON.stringify(competition.slides).includes("競合1"));
  assert(!JSON.stringify(competition.slides).includes("Secret-Competitor"));
  const disclosed = buildCustomerProposal(report, {
    ...options,
    includeCompetition: true,
    includeCompetitorNames: true,
    includeSourceNames: true,
  });
  assert.match(JSON.stringify(disclosed.slides), /Secret-Competitor/);
  assert.match(JSON.stringify(disclosed.slides), /private-file-A/);
});
test("proposal selection excludes unselected recommendations; long Japanese text paginates without omission", () => {
  const report = reportFixture();
  const paragraph = "施策の背景と検証条件を確認します。".repeat(80);
  const options = {
    ...proposalDefaults(report, "顧客"),
    overview: paragraph,
    findings: [],
    rowIndices: [],
  };
  const deck = buildCustomerProposal(report, options);
  const summary = deck.slides.filter((s) => s.title.startsWith("提案サマリー"));
  assert(summary.length > 1);
  assert.equal(summary.flatMap((s) => s.lines).join(""), paragraph);
  for (const slide of deck.slides.filter((s) => "lines" in s)) {
    assert(slide.lines.length <= 11);
    assert(
      slide.lines.every(
        (line) =>
          [...line].reduce((n, c) => n + (c.codePointAt(0) > 255 ? 2 : 1), 0) <=
          78,
      ),
    );
  }
  assert(!JSON.stringify(deck.slides).includes("改善提案 ·"));
  assert.equal(wrapProposalText("a\n\nあ").join("\n"), "a\n\nあ");
  assert.equal(wrapProposalText("a\u0001b").join(""), "ab");
  report.findings[0].proposal = "確認事項".repeat(600);
  assert.equal(
    proposalDefaults(report, "顧客").findings[0].proposal,
    report.findings[0].proposal,
  );
  assert.throws(
    () => buildCustomerProposal(report, { ...options, rowIndices: [0, 0] }),
    /重複/,
  );
  assert.throws(
    () =>
      buildCustomerProposal(report, {
        ...options,
        findings: [{ index: 999, proposal: "x" }],
      }),
    /一致/,
  );
  assert.throws(
    () => buildCustomerProposal(report, { ...options, issuedOn: "2026-02-30" }),
    /日付/,
  );
  assert.throws(
    () => buildCustomerProposal(report, { ...options, title: "x".repeat(101) }),
    /100文字/,
  );
});
function fixture(t) {
  const store = openStoreDatabase(new DatabaseSync(":memory:"));
  t.after(() => store.db.close());
  for (const id of ["a", "b"]) store.put("salesAccounts", { id, name: id });
  const report = reportFixture();
  store.put("kwAnalyses", {
    id: "analysis",
    accountId: "a",
    report,
    hash: "original-hash",
  });
  const service = createCustomerProposals({ store });
  const call = async (body, suffix = "", params = {}) => {
    let result;
    await service({
      p: "/sales/customer-proposals" + suffix,
      method: body ? "POST" : "GET",
      body,
      user: { id: "member", role: "member" },
      url: new URL(
        "http://local/?" +
          new URLSearchParams({
            accountId: "a",
            analysisId: "analysis",
            ...params,
          }),
      ),
      reply: (status, value) => {
        result = { status, value };
        return true;
      },
    });
    return result;
  };
  return {
    store,
    call,
    body: {
      accountId: "a",
      analysisId: "analysis",
      requestId: "request-first",
      options: proposalDefaults(report, "顧客"),
    },
  };
}
test("proposal service rebuilds figures, rejects cross-account sources and saves immutable idempotent versions", async (t) => {
  const { store, call, body } = fixture(t);
  await assert.rejects(
    call({ ...body, accountId: "b" }),
    (e) => e.status === 404,
  );
  await assert.rejects(
    call({ ...body, analysisId: {} }),
    (e) => e.status === 400,
  );
  await assert.rejects(
    call({ ...body, parentId: {} }),
    (e) => e.status === 400,
  );
  const r = await call({ ...body, deck: { slides: ["forged values"] } });
  assert.equal(r.status, 201);
  assert.equal(r.value.analysisHash, "original-hash");
  assert(!JSON.stringify(r.value).includes("forged"));
  assert.equal((await call(body)).value.id, r.value.id);
  await assert.rejects(
    call({ ...body, options: { ...body.options, overview: "conflict" } }),
    (e) => e.status === 409,
  );
  await assert.rejects(
    call(undefined, "/" + r.value.id, { accountId: "b" }),
    (e) => e.status === 404,
  );
  const revision = await call({
    ...body,
    parentId: r.value.id,
    requestId: "revision-second",
    options: { ...body.options, overview: "新しい版" },
  });
  assert.equal(revision.value.parentId, r.value.id);
  assert.equal(
    (await call(undefined, "/" + r.value.id)).value.deck.options.overview,
    "",
  );
  const list = (await call()).value.items;
  assert.equal(list.length, 2);
  assert(list.every((r) => !r.deck && !r.options));
  assert.equal(
    store.db
      .prepare(
        "SELECT count(*) AS n FROM audit_log WHERE kind='customerProposals'",
      )
      .get().n,
    2,
  );
  const plan = store.db
    .prepare(
      "EXPLAIN QUERY PLAN SELECT id FROM records WHERE kind='customerProposals' AND json_extract(data,'$.accountId')=? AND json_extract(data,'$.analysisId')=? ORDER BY json_extract(data,'$.createdAt') DESC,id DESC LIMIT 501",
    )
    .all("a", "analysis");
  assert.match(JSON.stringify(plan), /records_proposal_history/);
});
test("proposal storage cap prevents new records but preserves existing downloads and retry", async (t) => {
  const { store, call, body } = fixture(t);
  const r = await call(body);
  for (let i = 0; i < 499; i++)
    store.put("customerProposals", { id: "cap-" + i, accountId: "b" });
  await assert.rejects(call({ ...body, requestId: "limit-new" }), /保存上限/);
  assert.equal((await call(body)).status, 200);
  assert.equal((await call(undefined, "/" + r.value.id)).status, 200);
});
test("proposal HTTP routes require session; member-created decks survive workspace export", async () => {
  const store = openStoreDatabase(new DatabaseSync(":memory:"));
  for (const role of ["admin", "member"]) {
    store.saveUser({
      id: role,
      name: role,
      email: role + "@example.test",
      role,
      active: true,
    });
    store.db
      .prepare("INSERT INTO sessions VALUES (?,?,?)")
      .run(digest(role), role, Date.now() + 60000);
  }
  const report = reportFixture();
  store.put("salesAccounts", { id: "a", name: "a" });
  store.put("kwAnalyses", { id: "analysis", accountId: "a", report });
  const app = createApp({ store, production: false, timers: false });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  const request = (path, role, body) =>
    fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        ...(role ? { Cookie: "worknest_session=" + role } : {}),
        ...(body
          ? { "Content-Type": "application/json", "X-Worknest": "1" }
          : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    assert.equal(
      (
        await request(
          "/sales/customer-proposals?accountId=a&analysisId=analysis",
        )
      ).status,
      401,
    );
    const res = await request("/sales/customer-proposals", "member", {
      accountId: "a",
      analysisId: "analysis",
      requestId: "http-request",
      options: proposalDefaults(report, "顧客"),
    });
    assert.equal(res.status, 201);
    const saved = await res.json();
    assert.equal(saved.createdBy, "member");
    const data = await (
      await request("/operations/export-data", "admin", {})
    ).json();
    assert(JSON.stringify(data.records).includes("customerProposals"));
    assert(JSON.stringify(data.records).includes(saved.id));
  } finally {
    await app.close();
  }
});
