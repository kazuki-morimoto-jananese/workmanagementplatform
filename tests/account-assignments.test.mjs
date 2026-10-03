import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { openStoreDatabase, digest } from "../server/store.mjs";
import { createAccountAssignments } from "../server/account-assignments.mjs";
import {
  assignedAccounts,
  assignmentAt,
  assignmentDateForMonth,
  assignmentToday,
} from "../server/account-assignment-records.mjs";
import {
  parseAssignmentTable,
  assignmentColumns,
} from "../shared/account-assignments.mjs";
import { createApp } from "../server/index.mjs";
import { readGoogleSheet } from "../server/sales-integrations.mjs";

function fixture(t, options = {}) {
  const store = openStoreDatabase(new DatabaseSync(":memory:"));
  if (!options.http) t.after(() => store.db.close());
  for (const [id, name] of [
    ["admin", "管理 太郎"],
    ["old", "前任 一郎"],
    ["next", "後任 二郎"],
    ["co", "共同 三郎"],
  ])
    store.saveUser({
      id,
      name,
      email: `${id}@example.test`,
      active: true,
      role: id === "admin" ? "admin" : "member",
      mustChangePassword: false,
    });
  store.put("orgUnits", { id: "old-g", name: "旧グループ", version: 1 });
  store.put("orgUnits", { id: "new-g", name: "新グループ", version: 1 });
  store.put("salesAccounts", {
    id: "00012345678901234567",
    name: "顧客A",
    ownerId: "old",
    ownerName: "前任 一郎",
    group: "旧グループ",
    orgUnitId: "old-g",
    version: 1,
  });
  const row = {
    accountId: "00012345678901234567",
    name: "顧客A",
    beforeOwner: "前任 一郎",
    beforeGroup: "旧グループ",
    owner: "後任 二郎",
    group: "新グループ",
  };
  const input = { rows: [row], effectiveFrom: "2026-10-01" };
  const service = createAccountAssignments({
    store,
    sheetReader: options.sheetReader,
    saveTask: () => {
      throw new Error("Use HTTP test for real task mutation");
    },
  });
  const call = async (
    suffix,
    body,
    user = store.user("admin"),
    params = {},
  ) => {
    let result;
    await service({
      p: "/sales/assignments" + suffix,
      method: body ? "POST" : "GET",
      body,
      user,
      url: new URL("http://local/?" + new URLSearchParams(params)),
      reply: (status, value) => {
        result = { status, value };
        return true;
      },
    });
    return result;
  };
  const apply = async (body = input, requestId = "request-test") => {
    const p = (await call("/preview", body)).value;
    const payload = {
      ...body,
      token: p.token,
      requestId,
      selectedIds: p.rows.filter((r) => r.ready).map((r) => r.accountId),
    };
    return { payload, result: await call("/apply", payload) };
  };
  return { store, input, row, call, apply };
}

test("assignment table reads exact columns, preserves long IDs and rejects duplicates/malformed mapping", () => {
  const header = ["No.", ...Object.values(assignmentColumns), "AP適応日"];
  const row = [
    "1",
    "00012345678901234567",
    "顧客",
    "旧Ｇ",
    "前任",
    "",
    "後任",
    "2020-01-01",
  ];
  const p = parseAssignmentTable([header, row]);
  assert.equal(p.rows[0].accountId, row[1]);
  assert.equal(p.rows[0].group, "");
  assert(!Object.hasOwn(p.rows[0], "effectiveFrom"));
  assert.throws(() => parseAssignmentTable([header, row, row]), /重複/);
  assert.throws(
    () => parseAssignmentTable([header, ["1", "1.23E+17", ...row.slice(2)]]),
    /指数表記/,
  );
  assert.throws(
    () =>
      parseAssignmentTable([header, row], {
        ...p.mapping,
        owner: p.mapping.beforeOwner,
      }),
    /同じ列/,
  );
  assert.throws(() => parseAssignmentTable([header, null]), /表/);
  const many = Array.from({ length: 10756 }, (_, i) => [
    String(i),
    String(i).padStart(18, "0"),
    "顧客",
    "",
    "前任",
    "",
    "後任",
  ]);
  assert.equal(parseAssignmentTable([header, ...many]).rows.length, 10756);
});

test("dated ownership preserves past months, unknown earlier periods, numeric/minute history and idempotence", async (t) => {
  const { store, row, apply, call } = fixture(t);
  store.put("salesMasters", {
    id: "m",
    accountId: row.accountId,
    month: "2026-09",
    gTrend: 100,
  });
  store.put("salesMinutes", {
    id: "minute",
    accountId: row.accountId,
    createdBy: "old",
    text: "original",
  });
  store.put("salesPersonalTargets", {
    id: "goal",
    userId: "old",
    month: "2026-09",
    target: 500,
  });
  const protectedData = [
    "salesMasters",
    "salesMinutes",
    "salesPersonalTargets",
    "salesAccounts",
  ].map((k) => store.all(k));
  const { payload, result } = await apply();
  const accounts = store.all("salesAccounts");
  const at = (d) => assignedAccounts(store, accounts, d)[0];
  assert.equal(at("2026-09-30").ownerId, "old");
  assert.equal(at("2026-10-01").ownerId, "next");
  assert.equal(at("2026-10-31").orgUnitId, "new-g");
  assert.equal(at("2026-08-31").ownerId, "");
  assert.equal(at("2026-08-31").assignmentUnknown, true);
  assert.equal((await call("/apply", payload)).value.id, result.value.id);
  assert.equal(store.all("accountAssignments").length, 2);
  assert.equal(store.all("accountAssignmentRuns").length, 1);
  assert.deepEqual(
    [
      "salesMasters",
      "salesMinutes",
      "salesPersonalTargets",
      "salesAccounts",
    ].map((k) => store.all(k)),
    protectedData,
  );
  assert.equal(
    store.db
      .prepare(
        "SELECT count(*) n FROM audit_log WHERE kind='accountAssignments'",
      )
      .get().n,
    2,
  );
  assert.equal(
    assignmentDateForMonth(assignmentToday().slice(0, 7)),
    assignmentToday(),
  );
  assert.equal(assignmentDateForMonth("2024-02"), "2024-02-29");
  await assert.rejects(call("/apply", { ...payload, selectedIds: [] }), {
    status: 409,
  });
  const plan = store.db
    .prepare(
      "EXPLAIN QUERY PLAN SELECT data FROM records WHERE kind='accountAssignments' AND json_extract(data,'$.accountId')=? AND json_extract(data,'$.effectiveFrom')<=? ORDER BY json_extract(data,'$.effectiveFrom') DESC LIMIT 1",
    )
    .all(row.accountId, "2026-10-01");
  assert(
    plan.some((r) =>
      r.detail.includes("USING INDEX records_account_assignment"),
    ),
  );
});

test("blank groups are preserved; inactive prior owners and explicit aliases remain usable; unknown users do not create members", async (t) => {
  const { store, input, row, call, apply } = fixture(t);
  store.saveUser({ ...store.user("old"), active: false });
  const body = {
    ...input,
    rows: [{ ...row, beforeGroup: "", group: "", owner: "未知の後任" }],
  };
  const p = (await call("/preview", body)).value.rows[0];
  assert.equal(p.before.ownerId, "old");
  assert.equal(p.after.ownerId, "");
  assert.equal(p.after.group, "旧グループ");
  assert.equal(p.after.orgUnitId, "old-g");
  assert(p.warnings.some((w) => w.includes("紐付け待ち")));
  await apply(body);
  const linked = {
    ...body,
    ownerLinks: { 未知の後任: "next" },
    ownerGroups: { 未知の後任: "new-g" },
  };
  const corrected = await apply(linked, "request-correct");
  assert.equal(corrected.result.status, 201);
  assert.equal(
    assignmentAt(store, row.accountId, "2026-10-01").ownerId,
    "next",
  );
  assert.equal(assignmentAt(store, row.accountId, "2026-10-01").version, 2);
  assert.equal(assignmentAt(store, row.accountId, "2026-09-30").ownerId, "old");
  assert.equal(store.users().length, 4);
  assert.equal(store.user("next").orgUnitId, undefined);
});

test("preview rejects unknown accounts, ambiguous group and blank successor; no implicit deletion or account creation", async (t) => {
  const { store, call, input, row } = fixture(t);
  const p = (
    await call("/preview", {
      ...input,
      rows: [
        row,
        { ...row, accountId: "missing" },
        { ...row, accountId: "other", owner: "-" },
      ],
    })
  ).value;
  assert.equal(p.rows[0].ready, true);
  assert.equal(p.rows[1].ready, false);
  assert.equal(p.rows[2].ready, false);
  assert.equal(store.all("accountAssignments").length, 0);
  assert.equal(store.all("salesAccounts").length, 1);
  const unmapped = (
    await call("/preview", {
      ...input,
      rows: [{ ...row, group: "not registered" }],
    })
  ).value;
  assert.equal(unmapped.rows[0].ready, false);
  await assert.rejects(
    call("/preview", { ...input, effectiveFrom: "2026-02-30" }),
    { status: 400 },
  );
  await assert.rejects(call("/preview", { ...input, rows: [null] }), {
    status: 400,
  });
  await assert.rejects(
    call("/preview", { ...input, rows: Array(101).fill(row) }),
    { status: 400 },
  );
});

test("stale previews reject concurrent account edits and same-date changes; future assignment keeps current owner", async (t) => {
  const { store, call, apply, row, input } = fixture(t);
  const p = (await call("/preview", input)).value;
  store.put("salesAccounts", {
    ...store.get("salesAccounts", row.accountId),
    version: 2,
  });
  await assert.rejects(
    call("/apply", {
      ...input,
      token: p.token,
      selectedIds: [row.accountId],
      requestId: "stale-request",
    }),
    { status: 409 },
  );
  const future = {
    ...input,
    rows: [{ ...row, beforeOwner: "" }],
    effectiveFrom: "2099-05-15",
  };
  const r = await apply(future);
  assert.equal(
    assignedAccounts(store, store.all("salesAccounts"))[0].ownerId,
    "old",
  );
  assert.equal(
    assignmentAt(store, row.accountId, "2099-05-15").ownerId,
    "next",
  );
  const work = (
    await call("/work", undefined, undefined, {
      assignmentId: r.result.value.assignmentIds[0],
    })
  ).value;
  assert.equal(work.current, false);
  await assert.rejects(
    call("/work", {
      assignmentId: r.result.value.assignmentIds[0],
      version: 1,
      items: [],
    }),
    { status: 409 },
  );
});

test("Sheets assignment reader paginates with bounded ranges, stale settings protection and empty range handling", async (t) => {
  const calls = [];
  const { call, store } = fixture(t, {
    sheetReader: async (c) => {
      calls.push(c);
      return { values: [] };
    },
  });
  const config = {
    spreadsheetId: "sample-id-12345678",
    tabName: "00_メイン情報",
    headerRow: 6,
    lastColumn: "R",
    version: 0,
  };
  const saved = (await call("/settings", config)).value;
  await call("/read", { offset: 0, version: saved.version });
  await call("/read", { offset: 500, version: saved.version });
  assert.equal(calls[0].range, "'00_メイン情報'!A6:R505");
  assert.equal(calls[1].range, "'00_メイン情報'!A506:R1005");
  assert.equal(calls[0].authUserId, "admin");
  assert.equal(calls[0].authMode, "user");
  await assert.rejects(call("/read", { offset: 1, version: 1 }), {
    status: 409,
  });
  await assert.rejects(call("/read", { offset: 500, version: 0 }), {
    status: 409,
  });
  await assert.rejects(
    call("/read", { offset: 500, version: 1 }, store.user("next")),
    { status: 403 },
  );
  const adapters = {
    getAccessToken: async () => "fake",
    fetchImpl: async () => Response.json({}),
  };
  assert.deepEqual(
    await readGoogleSheet(
      { ...config, range: "A1:R500", allowEmpty: true },
      adapters,
    ),
    { values: [] },
  );
  await assert.rejects(
    readGoogleSheet({ ...config, range: "A1:R500" }, adapters),
    /空/,
  );
});

test("HTTP ownership applies across sales/directory/export, protects legacy imports, selectively hands over public work and audits actor", async (t) => {
  const { store, row, input } = fixture(t, { http: true });
  for (const id of ["admin", "next"])
    store.db
      .prepare("INSERT INTO sessions VALUES (?,?,?)")
      .run(digest(id), id, Date.now() + 60000);
  store.put("projects", { id: "p", name: "Project", fields: [], rules: [] });
  store.put("salesMinutes", {
    id: "minute",
    accountId: row.accountId,
    text: "original",
    createdBy: "old",
  });
  for (const month of ["2026-09", "2026-10"])
    store.put("salesDirectoryAccounts", {
      ...store.get("salesAccounts", row.accountId),
      id: month,
      accountId: row.accountId,
      month,
      present: true,
      monthActual: 999,
    });
  const app = createApp({ store, production: false, timers: false });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  const req = async (path, body, uid = "admin", method) => {
    const r = await fetch(base + path, {
      method: method || (body ? "POST" : "GET"),
      headers: {
        Cookie: `worknest_session=${uid}`,
        "X-Worknest": "1",
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, value: await r.json() };
  };
  assert.equal((await req("/sales/assignments", undefined, "")).status, 401);
  assert.equal(
    (await req("/sales/assignments", undefined, "next")).status,
    403,
  );
  const tasks = [];
  for (const [title, status, visibility] of [
    ["open", "todo", "workspace"],
    ["closed", "done", "workspace"],
    ["secret", "todo", "private"],
  ]) {
    const res = await req("/tasks", {
      title,
      projectIds: ["p"],
      accountId: row.accountId,
      assigneeIds: ["old", "co"],
      status,
      visibility,
      priority: "medium",
      dueDate: "",
      startDate: "",
      description: "original",
    });
    assert.equal(res.status, 201, JSON.stringify(res.value));
    tasks.push(res.value);
  }
  store.put("salesOpportunities", {
    id: "opp",
    accountId: row.accountId,
    title: "進行商談",
    ownerId: "old",
    stage: "proposal",
    version: 1,
  });
  store.put("salesOpportunities", {
    id: "won",
    accountId: row.accountId,
    title: "受注済み",
    ownerId: "old",
    stage: "won",
    version: 1,
  });
  const p = (await req("/sales/assignments/preview", input)).value;
  const saved = await req("/sales/assignments/apply", {
    ...input,
    selectedIds: [row.accountId],
    token: p.token,
    requestId: "http-assignment",
  });
  assert.equal(saved.status, 201, JSON.stringify(saved.value));
  for (const [month, uid] of [
    ["2026-09", "old"],
    ["2026-10", "next"],
  ]) {
    assert.equal(
      (await req(`/sales/bootstrap?month=${month}`)).value.accounts[0].ownerId,
      uid,
    );
    assert.equal(
      (await req(`/sales/directory?month=${month}&owner=all`)).value.rows[0]
        .ownerId,
      uid,
    );
  }
  const imported = await req("/sales/imports/commit", {
    month: "2026-09",
    text: `アカウントID,アカウント名,当月担当者,当月担当Ｇ,今週Gトレ\n${row.accountId},顧客A,共同 三郎,旧データの別組織,42`,
  });
  assert.equal(imported.status, 200, JSON.stringify(imported.value));
  assert.equal(store.get("salesAccounts", row.accountId).ownerId, "old");
  assert.equal(
    (await req("/sales/bootstrap?month=2026-10")).value.accounts[0].ownerId,
    "next",
  );
  assert(
    (await req("/sales/export?month=2026-10")).value.csv.includes("後任 二郎"),
  );
  store.saveUser({ ...store.user("old"), active: false });
  const currentAccount = store.get("salesAccounts", row.accountId);
  const edited = await req(
    `/sales/accounts/${row.accountId}`,
    {
      ...currentAccount,
      ownerId: "co",
      ownerName: "上書き試行",
      orgUnitId: "new-g",
      name: "更新した顧客",
    },
    "admin",
    "PATCH",
  );
  assert.equal(edited.status, 200, JSON.stringify(edited.value));
  assert.equal(store.get("salesAccounts", row.accountId).name, "更新した顧客");
  assert.equal(store.get("salesAccounts", row.accountId).ownerId, "old");
  assert.equal(
    (await req("/sales/bootstrap?month=2026-10")).value.accounts[0].ownerId,
    "next",
  );
  const id = saved.value.assignmentIds[0];
  const work = (await req(`/sales/assignments/work?assignmentId=${id}`)).value;
  assert.equal(work.items.length, 2);
  assert(
    work.items.every(
      (i) => !["secret", "closed", "受注済み"].includes(i.title),
    ),
  );
  assert.equal(
    (
      await req("/sales/assignments/work", {
        assignmentId: id,
        version: 999,
        items: work.items,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await req("/sales/assignments/work", {
        assignmentId: id,
        version: 1,
        items: work.items,
      })
    ).status,
    200,
  );
  const allTasks = store.all("tasks");
  assert.deepEqual(allTasks.find((t) => t.title === "open").assigneeIds, [
    "next",
    "co",
  ]);
  for (const title of ["closed", "secret"])
    assert.deepEqual(allTasks.find((t) => t.title === title).assigneeIds, [
      "old",
      "co",
    ]);
  assert.equal(store.get("salesOpportunities", "opp").ownerId, "next");
  assert.equal(store.get("salesOpportunities", "won").ownerId, "old");
  assert.equal(store.get("salesMinutes", "minute").createdBy, "old");
  // A same-day correction must also find work already moved to the former successor.
  const correctedInput = { ...input, rows: [{ ...row, owner: "管理 太郎" }] };
  const correction = (await req("/sales/assignments/preview", correctedInput))
    .value;
  assert.equal(correction.rows[0].before.ownerId, "next");
  assert.equal(
    (
      await req("/sales/assignments/apply", {
        ...correctedInput,
        token: correction.token,
        selectedIds: [row.accountId],
        requestId: "http-correction",
      })
    ).status,
    201,
  );
  const nextWork = (await req(`/sales/assignments/work?assignmentId=${id}`))
    .value;
  assert.equal(nextWork.items.length, 2);
  assert.equal(
    (
      await req("/sales/assignments/work", {
        assignmentId: id,
        version: 2,
        items: nextWork.items,
      })
    ).status,
    200,
  );
  assert.deepEqual(
    store.all("tasks").find((t) => t.title === "open").assigneeIds,
    ["admin", "co"],
  );
  assert.equal(
    (await req(`/audit?kind=accountAssignments&recordId=${id}`)).value
      .entries[0].actor_id,
    "admin",
  );
  assert.equal(
    (
      await req(
        "/audit?kind=accountAssignmentSettings&recordId=source",
        undefined,
        "next",
      )
    ).status,
    403,
  );
});

test("handover run history pages without omissions at equal timestamps and rejects invalid cursors", async (t) => {
  const { call, store } = fixture(t);
  for (let n = 0; n < 73; n++)
    store.put("accountAssignmentRuns", {
      id: String(n).padStart(3, "0"),
      createdAt: "2026-10-01T00:00:00.000Z",
    });
  const seen = [];
  let before = "";
  do {
    const result = (await call("", undefined, undefined, { before })).value;
    assert(result.history.length <= 30);
    seen.push(...result.history.map((r) => r.id));
    before = result.next;
  } while (before);
  assert.equal(new Set(seen).size, 73);
  await assert.rejects(call("", undefined, undefined, { before: "garbage" }), {
    status: 400,
  });
});

test("mid-month assignments preserve earlier dated owners and source reads recheck the requesting administrator", async (t) => {
  let revoke;
  const { store, call, apply, row, input } = fixture(t, {
    sheetReader: async () => {
      revoke();
      return { values: [] };
    },
  });
  await apply({ ...input, effectiveFrom: "2026-09-01" });
  await apply(
    {
      ...input,
      rows: [{ ...row, beforeOwner: "誤った前任", owner: "共同 三郎" }],
      effectiveFrom: "2026-09-15",
    },
    "middle-month",
  );
  assert.equal(
    assignmentAt(store, row.accountId, "2026-09-14").ownerId,
    "next",
  );
  assert.equal(assignmentAt(store, row.accountId, "2026-09-15").ownerId, "co");
  const c = (
    await call("/settings", {
      version: 0,
      spreadsheetId: "sample-id-12345678",
      tabName: "Sheet",
      headerRow: 6,
      lastColumn: "R",
    })
  ).value;
  revoke = () => store.saveUser({ ...store.user("admin"), role: "member" });
  await assert.rejects(call("/read", { offset: 0, version: c.version }), {
    status: 403,
  });
});
