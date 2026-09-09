import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { openStoreDatabase } from "../server/store.mjs";
import {
  buildSalesPresentation,
  createGoogleWorkflows,
  presentationRequests,
} from "../server/google-workflows.mjs";
import { createMinuteService } from "../server/minutes.mjs";
function fixture() {
  const store = openStoreDatabase(new DatabaseSync(":memory:"));
  const user = {
    id: "owner",
    email: "owner@example.test",
    active: true,
    role: "admin",
  };
  store.saveUser(user);
  store.put("googleConnections", { id: user.id, connectedAt: "test" });
  store.put("salesAccounts", {
    id: "a",
    name: "Example",
    group: "総合企画EPG",
  });
  store.put("salesAccounts", {
    id: "demo",
    name: "DEMO",
    group: "総合企画EPG",
    isDemo: true,
  });
  store.put("salesAccounts", { id: "b", name: "Other", group: "CSG" });
  store.put("salesDashboardSnapshots", {
    id: "snapshot",
    month: "2026-09",
    readAt: "2026-09-09T00:00:00Z",
    blocks: [
      {
        title: "売上",
        fixed: true,
        groups: [],
        columns: [{ label: "グループ" }, { label: "目標" }, { label: "実績" }],
        rows: [
          { group: "", cells: ["総合企画EPG", "100", "0"] },
          { group: "", cells: ["CSG", "999", "888"] },
        ],
      },
    ],
  });
  store.put("salesReviews", {
    id: "old",
    accountId: "a",
    month: "2026-09",
    weekOf: "2026-08-31",
    forecast: 5,
    version: 1,
  });
  store.put("salesReviews", {
    id: "current",
    accountId: "a",
    month: "2026-09",
    weekOf: "2026-09-07",
    forecast: 0,
    aggressive: 20,
    nextAction: "次回提案",
    media: { stanby: { budget: 0, cpa: null }, indeed: { spend: 200, cpa: 2 } },
    version: 1,
  });
  store.put("salesReviews", {
    id: "future",
    accountId: "a",
    month: "2026-09",
    weekOf: "2026-09-14",
    forecast: 99999,
    version: 1,
  });
  return { store, user };
}
test("Docs creation attaches only to an unchanged minute and daily source checks stop for disconnected users", async () => {
  const { store, user } = fixture();
  let docs = 0,
    reads = 0;
  store.put("salesMinutes", {
    id: "m",
    accountId: "a",
    title: "Template",
    text: "本文",
    version: 1,
    status: "saved",
    taskLinks: [],
  });
  const service = createGoogleWorkflows({
    store,
    access: async () => "fake",
    status: () => ({ documentsWrite: true }),
    fetchImpl: async (url) => {
      if (url.endsWith("/documents")) {
        docs++;
        return Response.json({ documentId: "new_doc" });
      }
      return Response.json({});
    },
  });
  async function create(version) {
    let result;
    await service.handle({
      path: "/api/google/minutes/m/create-document",
      method: "POST",
      user,
      url: new URL("https://example.test"),
      body: { version, requestId: "document-one" },
      send: (status, value) => {
        result = value;
      },
    });
    return result;
  }
  try {
    await assert.rejects(create(0), /更新/);
    assert.equal(docs, 0);
    const created = await create(1);
    assert.equal(created.minute.googleFileId, "new_doc");
    assert.equal(created.minute.text, "本文");
    await assert.rejects(create(2), /既にGoogle/);
    assert.equal(docs, 1);
    store.put("salesMinutes", {
      ...created.minute,
      watchEnabled: true,
      watchUserId: user.id,
    });
    const minutes = createMinuteService({
      store,
      saveReview: () => {},
      enqueueSummary: () => {},
      readDocument: async () => {
        reads++;
        return { text: "更新本文" };
      },
    });
    await minutes.tick();
    assert.equal(reads, 1);
    assert.equal(store.get("salesMinutes", "m").sourceChanged, true);
    assert.equal(store.get("salesMinutes", "m").text, "本文");
    await minutes.tick();
    assert.equal(reads, 1);
    store.remove("googleConnections", user.id);
    store.put("salesMinutes", {
      ...store.get("salesMinutes", "m"),
      sourceCheckAttemptAt: "2000-01-01T00:00:00Z",
    });
    await minutes.tick();
    assert.equal(reads, 1);
    assert.match(store.get("salesMinutes", "m").sourceCheckError, /無効/);
  } finally {
    store.db.close();
  }
});
test("imported forecasts are used only when no weekly review exists", () => {
  const { store } = fixture();
  try {
    store.put("salesMasters", {
      id: "master",
      accountId: "a",
      month: "2026-09",
      raw: { 今月ヨミ: "1234", アグレッシブ数字: "2000" },
      importedAt: "2026-09-09T00:00:00Z",
    });
    const input = {
      month: "2026-09",
      week: "2026-09-07",
      group: "総合企画EPG",
    };
    assert.match(
      buildSalesPresentation(store, input)
        .pages.map((p) => p.text)
        .join("\n"),
      /合計：0円/,
    );
    for (const r of store.all("salesReviews"))
      store.remove("salesReviews", r.id);
    assert.match(
      buildSalesPresentation(store, input)
        .pages.map((p) => p.text)
        .join("\n"),
      /合計：1,234円/,
    );
    assert.ok(
      buildSalesPresentation(store, input).sources.some(
        (s) => s.kind === "salesMasters",
      ),
    );
  } finally {
    store.db.close();
  }
});
test("sales slide preview keeps month/week/group boundaries, zero/missing, provenance and excludes demo", () => {
  const { store } = fixture();
  try {
    const r = buildSalesPresentation(store, {
      month: "2026-09",
      week: "2026-09-07",
      group: "総合企画EPG",
    });
    const text = r.pages.map((p) => p.text).join("\n");
    assert.match(text, /入力済み 1 \/ 対象 1/);
    assert.match(text, /合計：0円/);
    assert.match(text, /CPA 未入力/);
    assert.doesNotMatch(text, /99999|888|DEMO/);
    assert.match(text, /次回提案/);
    assert.ok(r.sources.some((s) => s.id === "current"));
    assert.throws(
      () =>
        buildSalesPresentation(store, {
          month: "2026-10",
          week: "2026-09-07",
          group: "総合企画EPG",
        }),
      /対象月/,
    );
    const requests = presentationRequests(r.pages);
    assert.equal(requests.filter((r) => r.createSlide).length, r.pages.length);
    assert.ok(requests.some((r) => r.insertText?.text.includes("0円")));
  } finally {
    store.db.close();
  }
});
test("Drive search requires explicit scope; Google generation is audited, private and idempotent", async () => {
  const { store, user } = fixture();
  let allowed = false,
    creates = 0,
    failFill = false,
    callUrl = "";
  const svc = createGoogleWorkflows({
    store,
    access: async () => "fake-token",
    status: () => ({
      driveSearch: allowed,
      documentsWrite: allowed,
      calendar: allowed,
    }),
    fetchImpl: async (url, init) => {
      assert.equal(init.redirect, "manual");
      assert.equal(init.headers.Authorization, "Bearer fake-token");
      callUrl = url;
      if (url.includes("drive/v3/files?"))
        return Response.json({
          files: [
            { id: "doc", name: "議事録", modifiedTime: "2026-09-09T00:00:00Z" },
          ],
          nextPageToken: "more",
        });
      if (url.endsWith("/presentations")) {
        creates++;
        return Response.json({ presentationId: "slides_" + creates });
      }
      if (url.includes(":batchUpdate"))
        return Response.json(failFill ? { error: { message: "fail" } } : {}, {
          status: failFill ? 403 : 200,
        });
      if (url.includes("calendar/v3"))
        return Response.json({
          summary: "商談",
          start: { dateTime: "2026-09-08T23:00:00Z" },
        });
      throw Error("unexpected mock url");
    },
  });
  async function call(path, method = "GET", body = {}, actor = user) {
    let result;
    await svc.handle({
      path: path.split("?")[0],
      url: new URL("https://example.test" + path),
      method,
      body,
      user: actor,
      send: (status, value) => {
        result = { status, value };
      },
    });
    return result;
  }
  try {
    await assert.rejects(call("/api/google/files?type=document"), /追加/);
    allowed = true;
    const files = await call("/api/google/files?type=document&q=O%27Brien");
    assert.equal(
      files.value.files[0].url,
      "https://docs.google.com/document/d/doc/edit",
    );
    assert.match(new URL(callUrl).searchParams.get("q"), /O\\'Brien/);
    const input = {
        month: "2026-09",
        week: "2026-09-07",
        group: "総合企画EPG",
      },
      preview = (await call("/api/google/reports/preview", "POST", input))
        .value;
    await assert.rejects(
      call("/api/google/reports/create", "POST", {
        ...input,
        fingerprint: "bad",
        requestId: "request-1",
      }),
      /再確認/,
    );
    assert.equal(creates, 0);
    const body = {
      ...input,
      fingerprint: preview.fingerprint,
      requestId: "request-1",
    };
    await call("/api/google/reports/create", "POST", body);
    await call("/api/google/reports/create", "POST", body);
    assert.equal(creates, 1);
    assert.equal(
      (await call("/api/google/artifacts", "GET", {}, { id: "other" })).value
        .items.length,
      0,
    );
    assert.equal(
      (await call("/api/google/artifacts")).value.items[0].status,
      "completed",
    );
    failFill = true;
    await assert.rejects(
      call("/api/google/reports/create", "POST", {
        ...body,
        requestId: "request-2",
      }),
      /Google側/,
    );
    await assert.rejects(
      call("/api/google/reports/create", "POST", {
        ...body,
        requestId: "request-2",
      }),
      /前回/,
    );
    assert.equal(creates, 2);
    const failed = (await call("/api/google/artifacts")).value.items[0];
    assert.equal(failed.status, "failed");
    assert.ok(failed.url);
    assert.equal(failed.inputHash, undefined);
    assert.ok(
      store.db
        .prepare(
          "SELECT count(*) AS n FROM audit_log WHERE kind='googleArtifacts'",
        )
        .get().n >= 5,
    );
    const event = await call("/api/google/calendar/prepare", "POST", {
      accountId: "a",
      eventId: "evt",
    });
    assert.equal(event.value.meetingDate, "2026-09-09");
  } finally {
    store.db.close();
  }
});
test("checking Google minute updates preserves originals, refresh creates a revision, unchanged refresh is idempotent", async () => {
  const { store, user } = fixture();
  let source = "変更後",
    summaries = 0;
  store.put("salesMinutes", {
    id: "m",
    accountId: "a",
    googleFileId: "doc",
    sourceUrl: "https://docs.google.com/document/d/doc/edit",
    text: "変更前",
    title: "議事録",
    version: 1,
    status: "saved",
    taskLinks: [{ actionIndex: 0, taskId: "t" }],
    autoSummarize: true,
  });
  const svc = createMinuteService({
    store,
    saveReview: () => {},
    enqueueSummary: () => {
      summaries++;
    },
    readDocument: async () => ({
      text: source,
      title: "議事録",
      modifiedTime: "revision",
    }),
  });
  async function call(mid, op, version) {
    let result;
    await svc.handle({
      p: `/sales/minutes/${mid}/${op}`,
      method: "POST",
      body: { version },
      user,
      reply: (status, value) => {
        result = value;
        return true;
      },
    });
    return result;
  }
  try {
    const checked = await call("m", "check-source", 1);
    assert.equal(checked.changed, true);
    assert.equal(store.get("salesMinutes", "m").text, "変更前");
    assert.equal(summaries, 0);
    const refreshed = await call("m", "refresh", 2);
    assert.equal(refreshed.minute.previousMinuteId, "m");
    assert.equal(refreshed.minute.sourceChanged, false);
    assert.equal(summaries, 1);
    assert.deepEqual(store.get("salesMinutes", "m").taskLinks, [
      { actionIndex: 0, taskId: "t" },
    ]);
    assert.deepEqual(refreshed.minute.taskLinks, []);
    await assert.rejects(call("m", "refresh", 3), /最新版/);
    const same = await call(refreshed.minute.id, "refresh", 1);
    assert.equal(same.unchanged, true);
    assert.equal(store.all("salesMinutes").length, 2);
  } finally {
    store.db.close();
  }
});
