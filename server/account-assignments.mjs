import { digest, now } from "./store.mjs";
import { normalizeHeader } from "./sales-import.mjs";
import {
  assignmentAt,
  assignmentToday,
} from "./account-assignment-records.mjs";
import { taskOwners } from "./task-options.mjs";
import {
  assignmentColumns,
  parseAssignmentTable,
} from "../shared/account-assignments.mjs";
import { customerKinds } from "./customer-records.mjs";
const check = (ok, message, status = 400) => {
  if (!ok) throw Object.assign(new Error(message), { status });
};
const text = (v, max = 200) => {
  check(
    typeof v === "string" && v.length <= max,
    "担当・グループの入力値を確認してください。",
  );
  return v.trim();
};
const meaningful = (v) => v && !["-", "ー", "―", "—"].includes(v);
const date = (v) => {
  check(
    typeof v === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "適用日を指定してください。",
  );
  return v;
};
const aid = (accountId, effectiveFrom) =>
  digest(JSON.stringify([accountId, effectiveFrom]));
const snapshot = (a) => ({
  ownerId: a?.ownerId || "",
  ownerName: a?.ownerName || "",
  group: a?.group || "",
  orgUnitId: a?.orgUnitId || "",
});
const lookup = (map, key) => (Object.hasOwn(map, key) ? map[key] : "");
export {
  assignmentColumns,
  parseAssignmentTable,
} from "../shared/account-assignments.mjs";
export function createAccountAssignments({ store, sheetReader, saveTask }) {
  const settings = () => store.get("accountAssignmentSettings", "source");
  const links = (raw, kind) => {
    check(
      raw &&
        typeof raw === "object" &&
        !Array.isArray(raw) &&
        Object.keys(raw).length <= 500,
      "紐付けを確認してください。",
    );
    for (const [name, id] of Object.entries(raw)) {
      text(name);
      text(id);
      check(
        kind === "user" ? store.user(id)?.active : store.get("orgUnits", id),
        "紐付け先が見つかりません。",
      );
    }
    return raw;
  };
  function plan(body) {
    const effectiveFrom = date(body.effectiveFrom);
    check(
      Array.isArray(body.rows) &&
        body.rows.length > 0 &&
        body.rows.length <= 100,
      "1回に確認するアカウントは100件までです。",
    );
    const ownerLinks = links(body.ownerLinks || {}, "user"),
      groupLinks = links(body.groupLinks || {}, "org"),
      ownerGroups = links(body.ownerGroups || {}, "org");
    const users = store.users(),
      orgs = store.all("orgUnits"),
      seen = new Set();
    const resolveOwner = (name, historical = false) => {
      const matches = users.filter(
        (u) =>
          (historical || u.active) &&
          normalizeHeader(u.name) === normalizeHeader(name),
      );
      return (
        lookup(ownerLinks, name) || (matches.length === 1 ? matches[0].id : "")
      );
    };
    const resolveGroup = (name) => {
      const matches = orgs.filter(
        (o) => normalizeHeader(o.name) === normalizeHeader(name),
      );
      return (
        lookup(groupLinks, name) || (matches.length === 1 ? matches[0].id : "")
      );
    };
    const previousDay = new Date(Date.parse(effectiveFrom) - 86400000)
      .toISOString()
      .slice(0, 10);
    const monthStart = effectiveFrom.slice(0, 7) + "-01";
    const previousMonthStart =
      new Date(Date.parse(monthStart) - 86400000).toISOString().slice(0, 7) +
      "-01";
    const rows = body.rows.map((raw) => {
      check(
        raw && typeof raw === "object" && !Array.isArray(raw),
        "担当行の形式が不正です。",
      );
      const r = Object.fromEntries(
        Object.keys(assignmentColumns).map((k) => [k, text(raw[k] ?? "")]),
      );
      check(
        r.accountId && !seen.has(r.accountId),
        "アカウントIDが空欄または重複しています。",
      );
      seen.add(r.accountId);
      const account = store.get("salesAccounts", r.accountId);
      const previous = assignmentAt(store, r.accountId, previousDay);
      const existing = store.get(
        "accountAssignments",
        aid(r.accountId, effectiveFrom),
      );
      const priorGroup = meaningful(r.beforeGroup) ? r.beforeGroup : "";
      const baseline = {
        ownerId: meaningful(r.beforeOwner)
          ? resolveOwner(r.beforeOwner, true)
          : "",
        ownerName: meaningful(r.beforeOwner) ? r.beforeOwner : "",
        group: priorGroup || account?.group || "",
        orgUnitId: priorGroup
          ? resolveGroup(priorGroup)
          : account?.orgUnitId || "",
      };
      const before = snapshot(
        existing ||
          previous ||
          (effectiveFrom.endsWith("-01") && baseline.ownerName
            ? baseline
            : account),
      );
      const retained = previous || account;
      const keptGroup = before.group || retained?.group || "";
      const keptOrg =
        before.orgUnitId || (!before.group ? retained?.orgUnitId : "") || "";
      const group = meaningful(r.group) ? r.group : "";
      const orgUnitId = group
        ? resolveGroup(group)
        : lookup(ownerGroups, r.owner);
      const after = {
        ownerId: meaningful(r.owner) ? resolveOwner(r.owner) : "",
        ownerName: meaningful(r.owner) ? r.owner : "",
        group: orgUnitId
          ? orgs.find((o) => o.id === orgUnitId).name
          : group || keptGroup,
        orgUnitId: orgUnitId || (group ? "" : keptOrg),
      };
      const issues = [];
      if (!account || account.isDemo)
        issues.push("Worknestの実アカウントに未登録");
      if (!after.ownerName) issues.push("後任が空欄（担当解除は個別に確認）");
      if (group && !orgUnitId)
        issues.push("グループを組織マスタに紐付けてください");
      const warnings = [];
      if (after.ownerName && !after.ownerId)
        warnings.push("担当者のメンバー紐付け待ち");
      if (!group && !lookup(ownerGroups, r.owner))
        warnings.push("当月担当Ｇが空欄のため変更前のグループを保持");
      if (
        previous &&
        meaningful(r.beforeOwner) &&
        normalizeHeader(previous.ownerName) !== normalizeHeader(r.beforeOwner)
      )
        warnings.push("前任の記載が保存済み履歴と異なります（保存済みを優先）");
      const same =
        existing &&
        JSON.stringify(snapshot(existing)) === JSON.stringify(after);
      const initial =
        effectiveFrom.endsWith("-01") && baseline.ownerName
          ? {
              ...baseline,
              effectiveFrom: previousMonthStart,
              source: "previous-month-column",
            }
          : effectiveFrom >= assignmentToday() && account
            ? {
                ...snapshot(account),
                effectiveFrom:
                  effectiveFrom > assignmentToday()
                    ? assignmentToday()
                    : previousDay,
                source: "before-change-snapshot",
              }
            : null;
      return {
        accountId: r.accountId,
        name: account?.name || r.name,
        before,
        after,
        issues,
        warnings,
        status: issues.length
          ? "対象外"
          : same
            ? "設定済み"
            : existing
              ? "同日修正"
              : "変更・履歴登録",
        ready: !issues.length && !same,
        existingVersion: existing?.version || 0,
        accountVersion: account?.version || 0,
        previousId: previous?.id || "",
        previousVersion: previous?.version || 0,
        handoverFromIds: [
          ...new Set(
            [
              before.ownerId,
              ...(existing?.handoverFromIds || []),
              existing?.before?.ownerId,
            ].filter(Boolean),
          ),
        ],
        baseline: !previous && !existing ? initial : null,
      };
    });
    const token = digest(
      JSON.stringify({
        effectiveFrom,
        rows,
        users: users.map((u) => [u.id, u.name, u.active]),
        orgs,
      }),
    );
    return { effectiveFrom, rows, token };
  }
  return async ({ p, method, body, user, reply, url }) => {
    if (!p.startsWith("/sales/assignments")) return false;
    check(
      user.role === "admin",
      "担当・グループ変更は管理者が操作してください。",
      403,
    );
    if (p === "/sales/assignments" && method === "GET") {
      const raw = url.searchParams.get("before");
      let cursor = null;
      if (raw) {
        check(raw.length <= 500, "履歴の読取位置が不正です。");
        try {
          cursor = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
        } catch {
          check(false, "履歴の読取位置が不正です。");
        }
        check(
          Array.isArray(cursor) &&
            cursor.length === 2 &&
            cursor.every((v) => typeof v === "string" && v.length <= 100),
          "履歴の読取位置が不正です。",
        );
      }
      const records = store.db
        .prepare(
          `SELECT data FROM records WHERE kind='accountAssignmentRuns' ${cursor ? "AND (json_extract(data,'$.createdAt'),id)<(?,?)" : ""} ORDER BY json_extract(data,'$.createdAt') DESC,id DESC LIMIT 31`,
        )
        .all(...(cursor || []))
        .map((r) => JSON.parse(r.data));
      const history = records.slice(0, 30),
        last = history.at(-1);
      return reply(200, {
        settings: settings(),
        history,
        next:
          records.length > 30
            ? Buffer.from(JSON.stringify([last.createdAt, last.id])).toString(
                "base64url",
              )
            : null,
      });
    }
    if (p === "/sales/assignments/settings" && method === "POST") {
      const old = settings();
      check(
        body.version === (old?.version || 0),
        "接続設定が更新されています。再読み込みしてください。",
        409,
      );
      const spreadsheetId = text(body.spreadsheetId),
        tabName = text(body.tabName);
      check(
        /^[\w-]{15,180}$/.test(spreadsheetId) &&
          tabName &&
          !/[!\[\]]/.test(tabName),
        "スプレッドシートとタブ名を確認してください。",
      );
      check(
        Number.isInteger(body.headerRow) &&
          body.headerRow > 0 &&
          body.headerRow < 1000,
        "見出し行を確認してください。",
      );
      check(
        /^[A-Z]{1,2}$/.test(body.lastColumn),
        "最終列をA〜ZZで指定してください。",
      );
      const item = {
        id: "source",
        version: (old?.version || 0) + 1,
        spreadsheetId,
        tabName,
        headerRow: body.headerRow,
        lastColumn: body.lastColumn,
        authUserId: body.useMyGoogle || !old ? user.id : old.authUserId,
        ownerLinks: links(body.ownerLinks || {}, "user"),
        groupLinks: links(body.groupLinks || {}, "org"),
        ownerGroups: links(body.ownerGroups || {}, "org"),
        updatedAt: now(),
      };
      store.put("accountAssignmentSettings", item);
      return reply(200, item);
    }
    if (p === "/sales/assignments/read" && method === "POST") {
      const c = settings();
      check(c, "接続設定を保存してください。");
      check(
        store.user(c.authUserId)?.active &&
          store.user(c.authUserId)?.role === "admin",
        "接続した管理者のGoogle認証を確認してください。",
        403,
      );
      check(
        Number.isInteger(body.offset) &&
          body.offset >= 0 &&
          body.offset <= 20000 &&
          body.offset % 500 === 0 &&
          body.version === c.version,
        "読取位置または接続設定が変わりました。最初から読み込んでください。",
        409,
      );
      const start = c.headerRow + body.offset;
      const range = `'${c.tabName.replaceAll("'", "''")}'!A${start}:${c.lastColumn}${start + 499}`;
      const result = await sheetReader({
        spreadsheetId: c.spreadsheetId,
        range,
        authMode: "user",
        authUserId: c.authUserId,
        allowHeaderOnly: true,
        allowEmpty: true,
      });
      check(
        settings()?.version === c.version,
        "読込中に接続設定が変更されました。",
        409,
      );
      check(
        store.user(user.id)?.active && store.user(user.id)?.role === "admin",
        "操作権限が変更されました。",
        403,
      );
      return reply(200, {
        values: result.values,
        done: result.values.length < 500,
        nextOffset: body.offset + 500,
        version: c.version,
      });
    }
    if (p === "/sales/assignments/table" && method === "POST")
      return reply(200, parseAssignmentTable(body.values, body.mapping));
    if (p === "/sales/assignments/preview" && method === "POST")
      return reply(200, plan(body));
    if (p === "/sales/assignments/apply" && method === "POST") {
      check(
        typeof body.requestId === "string" &&
          /^[\w-]{8,100}$/.test(body.requestId),
        "保存リクエストIDが必要です。",
      );
      const rid = digest(user.id + ":" + body.requestId),
        hash = digest(JSON.stringify(body));
      const old = store.get("accountAssignmentRuns", rid);
      if (old) {
        check(old.hash === hash, "保存リクエストの内容が変わっています。", 409);
        return reply(200, old);
      }
      const preview = plan(body);
      check(
        body.token === preview.token,
        "確認後に担当・組織情報が変わりました。もう一度差分を確認してください。",
        409,
      );
      check(
        Array.isArray(body.selectedIds) &&
          body.selectedIds.length > 0 &&
          body.selectedIds.length <= 100 &&
          new Set(body.selectedIds).size === body.selectedIds.length,
        "反映する対象を100件以内で指定してください。",
      );
      const selected = body.selectedIds.map((id) =>
        preview.rows.find((r) => r.accountId === id),
      );
      check(
        selected.every((r) => r?.ready),
        "反映できないアカウントが含まれています。",
      );
      const stamp = now(),
        assignmentIds = [];
      store.transaction(() => {
        for (const row of selected) {
          if (row.baseline)
            store.put("accountAssignments", {
              ...row.baseline,
              id: aid(row.accountId, row.baseline.effectiveFrom),
              accountId: row.accountId,
              version: 1,
              baseline: true,
              createdAt: stamp,
              createdBy: user.id,
            });
          const id = aid(row.accountId, preview.effectiveFrom);
          assignmentIds.push(id);
          store.put("accountAssignments", {
            ...row.after,
            id,
            accountId: row.accountId,
            effectiveFrom: preview.effectiveFrom,
            before: row.before,
            handoverFromIds: row.handoverFromIds,
            version: row.existingVersion + 1,
            createdAt: stamp,
            createdBy: user.id,
            runId: rid,
          });
        }
        store.put("accountAssignmentRuns", {
          id: rid,
          hash,
          effectiveFrom: preview.effectiveFrom,
          accountIds: body.selectedIds,
          assignmentIds,
          count: selected.length,
          createdAt: stamp,
          createdBy: user.id,
        });
      });
      return reply(201, store.get("accountAssignmentRuns", rid));
    }
    if (p === "/sales/assignments/work" && ["GET", "POST"].includes(method)) {
      const id =
        method === "GET"
          ? url.searchParams.get("assignmentId")
          : body.assignmentId;
      check(
        typeof id === "string" && id.length <= 200,
        "担当変更を選んでください。",
      );
      const a = store.get("accountAssignments", id);
      check(a && !a.baseline, "担当変更が見つかりません。", 404);
      const current =
        a.effectiveFrom <= assignmentToday() &&
        assignmentAt(store, a.accountId, assignmentToday())?.id === id;
      if (!current) {
        check(method === "GET", "現在有効な担当変更を選んでください。", 409);
        return reply(200, {
          assignment: a,
          items: [],
          more: false,
          current: false,
        });
      }
      // Same partial-index predicate as customer records; no workspace-wide task reads.
      const kinds = customerKinds.map((k) => "'" + k + "'").join(",");
      const formerIds = (a.handoverFromIds || [a.before.ownerId]).filter(
        (id) => id && id !== a.ownerId,
      );
      const formerJson = JSON.stringify(formerIds);
      const candidates = () =>
        store.db
          .prepare(
            `SELECT kind,id,json_extract(data,'$.title') AS title,json_extract(data,'$.version') AS version FROM records WHERE kind IN (${kinds}) AND kind IN ('tasks','salesOpportunities') AND json_extract(data,'$.accountId')=? AND ((kind='tasks' AND coalesce(json_extract(data,'$.status'),'')!='done' AND coalesce(json_extract(data,'$.visibility'),'workspace')!='private' AND CASE WHEN json_type(data,'$.assigneeIds')='array' THEN EXISTS(SELECT 1 FROM json_each(data,'$.assigneeIds') WHERE value IN (SELECT value FROM json_each(?))) ELSE json_extract(data,'$.assigneeId') IN (SELECT value FROM json_each(?)) END) OR (kind='salesOpportunities' AND coalesce(json_extract(data,'$.stage'),'') NOT IN ('won','lost') AND json_extract(data,'$.ownerId') IN (SELECT value FROM json_each(?)))) ORDER BY kind,id LIMIT 501`,
          )
          .all(a.accountId, formerJson, formerJson, formerJson);
      if (method === "GET") {
        const items = candidates();
        return reply(200, {
          assignment: a,
          items: items.slice(0, 500),
          more: items.length > 500,
          current: true,
        });
      }
      check(
        store.user(a.ownerId)?.active,
        "後任を有効なWorknestメンバーに紐付けてください。",
      );
      check(
        Array.isArray(body.items) &&
          body.items.length > 0 &&
          body.items.length <= 50,
        "引き継ぐ仕事は50件以内で指定してください。",
      );
      check(
        body.items.every(
          (i) =>
            i &&
            typeof i.id === "string" &&
            ["tasks", "salesOpportunities"].includes(i.kind) &&
            Number.isInteger(i.version),
        ),
        "仕事の指定を確認してください。",
      );
      check(
        body.version === a.version,
        "担当変更が更新されました。再読み込みしてください。",
        409,
      );
      const eligible = candidates();
      check(
        new Set(body.items.map((i) => i.kind + i.id)).size ===
          body.items.length,
        "仕事が重複しています。",
      );
      check(
        body.items.every((i) =>
          eligible.some(
            (e) =>
              e.kind === i.kind && e.id === i.id && e.version === i.version,
          ),
        ),
        "仕事の状態が変わりました。再読み込みしてください。",
        409,
      );
      store.transaction(() => {
        for (const item of body.items) {
          const record = store.get(item.kind, item.id);
          if (item.kind === "tasks")
            saveTask(
              {
                ...record,
                assigneeIds: [
                  ...new Set(
                    taskOwners(record).map((uid) =>
                      formerIds.includes(uid) ? a.ownerId : uid,
                    ),
                  ),
                ],
              },
              user,
              record,
            );
          else
            store.put(item.kind, {
              ...record,
              ownerId: a.ownerId,
              version: record.version + 1,
              updatedAt: now(),
              updatedBy: user.id,
            });
        }
      });
      return reply(200, { changed: body.items.length });
    }
    return false;
  };
}
