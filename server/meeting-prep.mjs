import { now, digest } from "./store.mjs";
import { canReadTask } from "./task-options.mjs";
const check = (v, m, status = 400) => {
  if (!v) throw Object.assign(new Error(m), { status });
};
const short = (v, max = 4000) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
export function createMeetingPrepService({ store, createLinkedTask }) {
  return async ({ p, method, body, user, reply, url }) => {
    if (!p.startsWith("/sales/preparation")) return false;
    const accountId =
      method === "GET" ? url.searchParams.get("accountId") : body.accountId;
    check(
      store.get("salesAccounts", accountId),
      "アカウントが見つかりません。",
      404,
    );
    if (p === "/sales/preparation" && method === "GET")
      return reply(200, {
        draft: store.get("meetingPrepDrafts", accountId) || {
          agenda: "",
          version: 0,
        },
        analyses: store.db
          .prepare(
            "SELECT id, json_extract(data, '$.title') AS title, json_extract(data, '$.createdAt') AS createdAt FROM records WHERE kind='kwAnalyses' AND json_extract(data, '$.accountId')=? ORDER BY createdAt DESC",
          )
          .all(accountId),
      });
    if (p === "/sales/preparation/draft" && method === "POST") {
      const previous = store.get("meetingPrepDrafts", accountId);
      check(
        body.version === (previous?.version || 0),
        "他のメンバーが議題を更新しました。再読み込みしてください。",
        409,
      );
      const draft = {
        id: accountId,
        accountId,
        agenda: short(body.agenda),
        version: (previous?.version || 0) + 1,
        updatedAt: now(),
        updatedBy: user.id,
      };
      store.put("meetingPrepDrafts", draft);
      return reply(200, draft);
    }
    if (p === "/sales/preparation/analyses" && method === "POST") {
      check(
        /^[\w-]{8,100}$/.test(body.requestId || ""),
        "保存リクエストIDが必要です。",
      );
      const raw = JSON.stringify(body.report);
      check(
        typeof raw === "string" && Buffer.byteLength(raw) <= 120000,
        "分析結果は120KBまでです。対象を絞ってください。",
      );
      const r = body.report;
      const metric = (v) =>
        v === null ||
        (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e19);
      const validTotals = (t) =>
        t &&
        ["cost", "click", "cv", "impression", "cpc", "cvr", "cpa"].every((k) =>
          metric(t[k]),
        );
      check(
        r &&
          r.schemaVersion === 1 &&
          r.calculationVersion === "kw-v1" &&
          typeof r.own === "string" &&
          Array.isArray(r.rows) &&
          r.rows.length <= 100 &&
          Array.isArray(r.findings) &&
          r.findings.length <= 30 &&
          Array.isArray(r.sources) &&
          r.sources.length === 2 &&
          Array.isArray(r.periods) &&
          r.periods.length === 2 &&
          Array.isArray(r.warnings),
        "分析結果の形式が不正です。",
      );
      check(
        validTotals(r.before) &&
          validTotals(r.after) &&
          metric(r.zeroCvCost) &&
          Number.isInteger(r.entityCount) &&
          r.entityCount >= r.rows.length &&
          r.entityCount <= 20000 &&
          r.warnings.length <= 30 &&
          r.warnings.every((w) => typeof w === "string" && w.length <= 1000),
        "指標または注意事項の形式が不正です。",
      );
      check(
        r.rows.every(
          (row) =>
            row &&
            typeof row.keyword === "string" &&
            row.keyword.length <= 200 &&
            typeof row.state === "string" &&
            validTotals(row.before) &&
            validTotals(row.after) &&
            metric(row.share) &&
            Array.isArray(row.index) &&
            row.index.length <= 4 &&
            row.index.every(
              (c) =>
                c &&
                typeof c.company === "string" &&
                ["cost", "cpc", "cvr", "cpa"].every((k) => metric(c[k])),
            ),
        ),
        "KW比較表の形式が不正です。",
      );
      check(
        r.findings.every(
          (f) =>
            f &&
            typeof f.title === "string" &&
            typeof f.evidence === "string" &&
            typeof f.proposal === "string" &&
            f.title.length <= 400 &&
            f.evidence.length <= 2000 &&
            f.proposal.length <= 3000,
        ),
        "施策候補の形式が不正です。",
      );
      check(
        r.sources.every(
          (s) =>
            s &&
            /^[a-f0-9]{64}$/.test(s.hash) &&
            typeof s.name === "string" &&
            typeof s.sheet === "string" &&
            Number.isInteger(s.count) &&
            s.count > 0 &&
            s.count <= 10000,
        ),
        "元データの識別情報が不正です。",
      );
      check(
        r.periods.every(
          (v) =>
            v &&
            /^\d{4}-\d{2}-\d{2}$/.test(v.from) &&
            /^\d{4}-\d{2}-\d{2}$/.test(v.to) &&
            [v.from, v.to].every(
              (d) =>
                !isNaN(Date.parse(d)) &&
                new Date(d).toISOString().slice(0, 10) === d,
            ) &&
            v.from <= v.to,
        ) && r.periods[0].to < r.periods[1].from,
        "対象期間が不正です。",
      );
      const hash = digest(
        JSON.stringify([accountId, r, short(body.title, 200)]),
      );
      const requestKey = digest(user.id + ":" + body.requestId),
        old = store.get("kwAnalyses", requestKey);
      if (old) {
        check(old.hash === hash, "同じ保存IDの内容が変更されています。", 409);
        return reply(200, old);
      }
      const usage = store.db
        .prepare(
          "SELECT COUNT(*) AS count, COALESCE(SUM(length(CAST(data AS BLOB))),0) AS bytes FROM records WHERE kind='kwAnalyses'",
        )
        .get();
      check(
        usage.count < 500 && usage.bytes + Buffer.byteLength(raw) < 40_000_000,
        "無料運用の分析保存上限（500件または40MB）です。管理者に保存容量の確認を依頼してください。",
        409,
      );
      const record = {
        id: requestKey,
        accountId,
        title: short(body.title, 200) || "KW期間比較",
        report: r,
        hash,
        createdAt: now(),
        createdBy: user.id,
        provenance: "browser-calculated",
      };
      store.put("kwAnalyses", record);
      return reply(201, record);
    }
    const match = p.match(
      /^\/sales\/preparation\/analyses\/([\w-]+)(?:\/(task))?$/,
    );
    if (match) {
      const analysis = store.get("kwAnalyses", match[1]);
      check(analysis?.accountId === accountId, "分析が見つかりません。", 404);
      if (method === "GET" && !match[2]) return reply(200, analysis);
      if (method === "POST" && match[2]) {
        const index = body.index;
        check(
          Number.isInteger(index) &&
            index >= 0 &&
            index < analysis.report.findings.length,
          "施策候補を選択してください。",
        );
        const key = analysis.id + ":" + index,
          existing = store.get("kwTaskLinks", key);
        if (existing) {
          const task = store.get("tasks", existing.taskId);
          check(
            task && canReadTask(task, user),
            "タスク化済みです。削除済みまたは閲覧できません。",
            409,
          );
          return reply(200, task);
        }
        const f = analysis.report.findings[index];
        const task = store.transaction(() => {
          const task = createLinkedTask(
            {
              projectId: body.projectId,
              assigneeId: body.assigneeId,
              dueDate: body.dueDate,
              title: short(f.title, 200),
              description: `分析: ${analysis.title}\n分析ID: ${analysis.id}\n根拠: ${f.evidence}\n提案: ${f.proposal}\n対象期間: ${analysis.report.periods.map((p) => p.from + "〜" + p.to).join(" → ")}\n計算: ${analysis.report.calculationVersion}`,
              visibility: "workspace",
            },
            accountId,
            user,
          );
          store.put("kwTaskLinks", {
            id: key,
            accountId,
            analysisId: analysis.id,
            index,
            taskId: task.id,
            createdAt: now(),
            createdBy: user.id,
          });
          return task;
        });
        return reply(201, task);
      }
    }
    return false;
  };
}
