import { digest, now } from "./store.mjs";
import { canReadTask } from "./task-options.mjs";
const fail = (ok, message, status = 400) => {
  if (!ok) throw Object.assign(new Error(message), { status });
};
const text = (v, max = 2000) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const date = (v) => {
  const s = text(v, 10);
  fail(
    !s ||
      (/^\d{4}-\d{2}-\d{2}$/.test(s) &&
        Number.isFinite(Date.parse(s)) &&
        new Date(s).toISOString().slice(0, 10) === s),
    "日付を確認してください。",
  );
  return s;
};
const analysisView = (a) => ({
  id: a.id,
  accountId: a.accountId,
  title: a.title,
  calculationVersion: a.report.calculationVersion,
  own: a.report.own,
  periods: a.report.periods,
  before: a.report.before,
  after: a.report.after,
});
export function createSalesImprovements({ store, createLinkedTask }) {
  const validAccount = (aid) =>
    fail(
      typeof aid === "string" && store.get("salesAccounts", aid),
      "アカウントが見つかりません。",
      404,
    );
  const safeInitiative = (v, user) => ({
    ...v,
    taskId: canReadTask(store.get("tasks", v.taskId), user) ? v.taskId : "",
  });
  return async ({ p, method, body, user, url, reply }) => {
    if (!p.startsWith("/sales/improvements")) return false;
    if (p === "/sales/improvements" && method === "GET") {
      const month = url.searchParams.get("month");
      fail(
        /^\d{4}-(0[1-9]|1[0-2])$/.test(month || ""),
        "対象月を指定してください。",
      );
      return reply(200, {
        states: store
          .all("salesActionStates")
          .filter(
            (s) =>
              s.month === month &&
              (s.kind !== "task" ||
                canReadTask(store.get("tasks", s.referenceId), user)),
          ),
        initiatives:
          url.searchParams.get("mode") === "actions"
            ? []
            : store
                .all("salesInitiatives")
                .map((v) => safeInitiative(v, user))
                .reverse(),
        analyses:
          url.searchParams.get("mode") === "actions"
            ? []
            : store.all("kwAnalyses").map(analysisView).reverse(),
      });
    }
    if (p === "/sales/improvements/action" && method === "POST") {
      validAccount(body.accountId);
      fail(
        /^\d{4}-(0[1-9]|1[0-2])$/.test(body.month || ""),
        "対象月を確認してください。",
      );
      const week = date(body.week),
        until = date(body.until);
      fail(
        week && new Date(week).getUTCDay() === 1,
        "週は月曜日を指定してください。",
      );
      fail(
        ["owner", "forecast", "contact", "cpa", "trend", "task"].includes(
          body.kind,
        ),
        "確認項目が不正です。",
      );
      fail(
        ["open", "done", "snoozed"].includes(body.status),
        "対応状況を確認してください。",
      );
      const referenceId =
        body.kind === "task" ? text(body.referenceId, 100) : "";
      if (body.kind === "task") {
        const task = store.get("tasks", referenceId);
        fail(
          task?.accountId === body.accountId && canReadTask(task, user),
          "タスクが見つかりません。",
          404,
        );
      }
      fail(
        body.status !== "snoozed" ||
          until >
            new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }),
        "保留期限は明日以降にしてください。",
      );
      const stateId = digest(
        JSON.stringify([
          body.accountId,
          body.month,
          week,
          body.kind,
          referenceId,
        ]),
      );
      const previous = store.get("salesActionStates", stateId);
      fail(
        (previous?.version || 0) === (body.version || 0),
        "対応状況が更新されました。再読み込みしてください。",
        409,
      );
      fail(
        typeof body.fingerprint === "string" && body.fingerprint.length <= 3000,
        "根拠の形式を確認してください。",
      );
      if (!previous)
        fail(
          store.all("salesActionStates").length < 5000,
          "対応記録は5,000件までです。管理者にご相談ください。",
          409,
        );
      const value = {
        id: stateId,
        accountId: body.accountId,
        month: body.month,
        week,
        kind: body.kind,
        referenceId,
        fingerprint: body.fingerprint,
        status: body.status,
        until: body.status === "snoozed" ? until : "",
        note: text(body.note),
        version: (previous?.version || 0) + 1,
        updatedBy: user.id,
        updatedAt: now(),
      };
      store.put("salesActionStates", value);
      return reply(200, value);
    }
    if (p === "/sales/improvements/initiatives" && method === "POST") {
      validAccount(body.accountId);
      const previous = body.id ? store.get("salesInitiatives", body.id) : null;
      fail(
        !body.id || previous?.accountId === body.accountId,
        "施策が見つかりません。",
        404,
      );
      fail(
        (previous?.version || 0) === (body.version || 0),
        "施策が更新されました。再読み込みしてください。",
        409,
      );
      fail(text(body.title, 200), "施策名を入力してください。");
      fail(
        ["proposed", "agreed", "running", "reviewed", "stopped"].includes(
          body.status,
        ),
        "施策の状態を確認してください。",
      );
      fail(
        store.user(body.ownerId)?.active,
        "有効な担当者を選択してください。",
      );
      const implementedAt = date(body.implementedAt),
        reviewAt = date(body.reviewAt);
      fail(
        !implementedAt || !reviewAt || reviewAt >= implementedAt,
        "検証予定日は実施日以降にしてください。",
      );
      fail(
        !["running", "reviewed"].includes(body.status) || implementedAt,
        "実施日を入力してください。",
      );
      const snapshot = (aid, side) => {
        if (!aid) return null;
        fail(side === 0 || side === 1, "分析の比較期間を選択してください。");
        const a = store.get("kwAnalyses", aid);
        fail(
          a?.accountId === body.accountId,
          "同じアカウントの分析を選択してください。",
          404,
        );
        return {
          analysisId: a.id,
          title: a.title,
          period: a.report.periods[side],
          totals: a.report[side ? "after" : "before"],
          own: a.report.own,
          calculationVersion: a.report.calculationVersion,
          source: a.report.sources[side],
        };
      };
      const baseline = snapshot(body.baselineId, body.baselineSide),
        followup = snapshot(body.followupId, body.followupSide);
      if (followup) {
        fail(baseline, "実施前の分析を指定してください。");
        fail(
          baseline.calculationVersion === followup.calculationVersion &&
            baseline.own === followup.own,
          "同じ分析種別・会社識別子のデータを選択してください。",
        );
        fail(
          baseline.period.to < followup.period.from,
          "実施前・実施後の期間は重複しない順序で指定してください。",
        );
        fail(
          implementedAt &&
            baseline.period.to < implementedAt &&
            followup.period.from >= implementedAt,
          "実施前は実施日より前、実施後は実施日以降の期間を選択してください。",
        );
      }
      if (body.status === "reviewed")
        fail(
          baseline &&
            followup &&
            body.comparable === true &&
            text(body.definition) &&
            text(body.conclusion),
          "検証済みにするには前後の分析、CV・抽出条件の確認、検証結果を入力してください。",
        );
      const input = {
        accountId: body.accountId,
        title: text(body.title, 200),
        proposal: text(body.proposal),
        ownerId: body.ownerId,
        status: body.status,
        implementedAt,
        reviewAt,
        expectation: text(body.expectation),
        definition: text(body.definition),
        comparable: body.comparable === true,
        conclusion: text(body.conclusion),
        factors: text(body.factors),
        baselineId: baseline?.analysisId || "",
        baselineSide: baseline ? body.baselineSide : 1,
        followupId: followup?.analysisId || "",
        followupSide: followup ? body.followupSide : 1,
        baseline,
        followup,
      };
      const requestId = text(body.requestId, 100);
      fail(previous || requestId, "保存IDが必要です。");
      const rid = previous?.id || digest(user.id + ":initiative:" + requestId);
      const duplicate = !previous && store.get("salesInitiatives", rid);
      if (duplicate) {
        fail(
          duplicate.inputHash === digest(JSON.stringify(input)),
          "同じ保存IDで内容が変更されています。",
          409,
        );
        return reply(200, safeInitiative(duplicate, user));
      }
      if (!previous)
        fail(
          store.all("salesInitiatives").length < 1000,
          "施策は1,000件までです。管理者にご相談ください。",
          409,
        );
      const value = {
        ...input,
        id: rid,
        version: (previous?.version || 0) + 1,
        taskId: previous?.taskId || "",
        createdAt: previous?.createdAt || now(),
        createdBy: previous?.createdBy || user.id,
        updatedAt: now(),
        updatedBy: user.id,
        inputHash: digest(JSON.stringify(input)),
      };
      store.put("salesInitiatives", value);
      return reply(previous ? 200 : 201, safeInitiative(value, user));
    }
    if (p === "/sales/improvements/task" && method === "POST") {
      const v = store.get("salesInitiatives", body.id);
      fail(v, "施策が見つかりません。", 404);
      if (v.taskId) {
        const task = store.get("tasks", v.taskId);
        fail(
          canReadTask(task, user),
          "作成済みタスクは閲覧できないか削除されています。管理者に確認してください。",
          409,
        );
        return reply(200, task);
      }
      const account = store.get("salesAccounts", v.accountId);
      const task = store.transaction(() => {
        const task = createLinkedTask(
          {
            title: v.title,
            projectId: body.projectId || account.projectId,
            assigneeId: v.ownerId,
            dueDate: v.reviewAt,
            visibility: "workspace",
            description: `施策: ${v.proposal}\n期待: ${v.expectation}\n根拠: ${v.baseline?.title || "手動提案"}\n施策ID: ${v.id}`,
          },
          v.accountId,
          user,
        );
        store.put("salesInitiatives", {
          ...v,
          taskId: task.id,
          version: v.version + 1,
          updatedAt: now(),
          updatedBy: user.id,
        });
        return task;
      });
      return reply(201, task);
    }
    return false;
  };
}
