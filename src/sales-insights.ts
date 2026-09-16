import type { Data } from "./types";
import type { SalesAccount, SalesData, SalesReview } from "./sales-types";
import { importedReview } from "./sales-planning.ts";
import type { Totals } from "./kw-analysis";

export type PriorityAction = {
  accountId: string;
  kind: string;
  referenceId: string;
  title: string;
  evidence: string;
  priority: number;
  amount: number;
  dueDate: string;
  fingerprint: string;
};
export type ActionState = {
  id: string;
  accountId: string;
  month: string;
  week: string;
  kind: string;
  referenceId: string;
  fingerprint: string;
  status: "open" | "done" | "snoozed";
  until: string;
  note: string;
  version: number;
};
export type AnalysisSource = {
  id: string;
  accountId: string;
  title: string;
  calculationVersion: string;
  own: string;
  periods: { from: string; to: string }[];
  before: Totals;
  after: Totals;
};
export type Initiative = {
  id: string;
  accountId: string;
  title: string;
  proposal: string;
  ownerId: string;
  status: "proposed" | "agreed" | "running" | "reviewed" | "stopped";
  implementedAt: string;
  reviewAt: string;
  expectation: string;
  conclusion: string;
  factors: string;
  definition: string;
  comparable: boolean;
  baselineId: string;
  baselineSide: number;
  followupId: string;
  followupSide: number;
  taskId: string;
  version: number;
  baseline: null | {
    analysisId: string;
    title: string;
    period: { from: string; to: string };
    totals: Totals;
  };
  followup: Initiative["baseline"];
};
const age = (date: string, today: string) =>
  (Date.parse(today) - Date.parse(date.slice(0, 10))) / 86400000;
const money = (v: number) => "¥" + Math.round(v).toLocaleString("ja-JP");
const cpa = (r: SalesReview | undefined) => {
  const m = r?.media?.stanby;
  return m?.spend != null && m.cv != null && m.cv > 0
    ? m.spend / m.cv
    : (m?.cpa ?? null);
};
export function priorityActions(
  accounts: SalesAccount[],
  sales: SalesData,
  data: Data,
  month: string,
  week: string,
  today: string,
): PriorityAction[] {
  const masters = new Map(
    sales.masters.filter((m) => m.month === month).map((m) => [m.accountId, m]),
  );
  const reviews = new Map<string, SalesReview[]>();
  for (const r of sales.reviews)
    if (r.month === month && r.weekOf <= week) {
      if (!reviews.has(r.accountId)) reviews.set(r.accountId, []);
      reviews.get(r.accountId)!.push(r);
    }
  for (const rs of reviews.values())
    rs.sort((a, b) => b.weekOf.localeCompare(a.weekOf));
  const tasks = new Map<string, typeof data.tasks>();
  for (const t of data.tasks)
    if (t.accountId && t.status !== "done") {
      if (!tasks.has(t.accountId)) tasks.set(t.accountId, []);
      tasks.get(t.accountId)!.push(t);
    }
  const result: PriorityAction[] = [];
  for (const a of accounts) {
    const m = masters.get(a.id),
      rs = reviews.get(a.id) || [],
      r = rs[0] || importedReview(m);
    const paused = /停止|休止|解約|配信終了/.test(a.status);
    const add = (
      kind: string,
      title: string,
      evidence: string,
      priority: number,
      amount = 0,
      dueDate = "",
      referenceId = "",
    ) => {
      result.push({
        accountId: a.id,
        kind,
        referenceId,
        title,
        evidence,
        priority,
        amount,
        dueDate,
        fingerprint: JSON.stringify([kind, referenceId, evidence, dueDate]),
      });
    };
    if (!a.ownerId || !data.members.some((u) => u.id === a.ownerId && u.active))
      add(
        "owner",
        "担当者の紐付けを確認",
        `マスタの担当者：${a.ownerName || "未設定"}。メンバーとの紐付けを確認してください。`,
        1,
      );
    if (
      !paused &&
      (m?.gTrend ?? r?.forecast ?? 0) > 0 &&
      week <= today &&
      month <= today.slice(0, 7) &&
      (!r || r.weekOf !== week || r.forecast == null)
    )
      add(
        "forecast",
        "当週のヨミを確認",
        `${week}週の手入力ヨミが未登録です。Gトレ0円・停止中の追加入力を求めるものではありません。`,
        1,
        r?.forecast ?? m?.gTrend ?? 0,
      );
    if (!paused && a.lastContactAt && age(a.lastContactAt, today) > 14)
      add(
        "contact",
        "次の接点を確認",
        `最終接点：${a.lastContactAt}。接点の記録漏れも確認してください。`,
        1,
      );
    const current = cpa(r),
      prior = cpa(rs[1]);
    const fresh =
      !!r?.observedAt &&
      age(r.observedAt, today) >= 0 &&
      age(r.observedAt, today) <= 14;
    if (
      !paused &&
      fresh &&
      current != null &&
      prior != null &&
      prior > 0 &&
      current >= prior * 1.2
    )
      add(
        "cpa",
        "CPAの上昇を確認",
        `スタンバイCPA ${money(prior)} → ${money(current)}。観測日：${r!.observedAt}。抽出条件・CV定義も確認。`,
        2,
        r?.media.stanby.spend ?? 0,
      );
    const freshMaster =
      !!m?.importedAt &&
      age(m.importedAt, today) >= 0 &&
      age(m.importedAt, today) <= 3;
    if (
      !paused &&
      freshMaster &&
      m!.gTrend != null &&
      m!.gTrend > 0 &&
      m!.previousGTrend != null &&
      m!.previousGTrend > 0 &&
      m!.gTrend < m!.previousGTrend * 0.8
    )
      add(
        "trend",
        "Gトレの減少を確認",
        `前週 ${money(m!.previousGTrend)} → 今週 ${money(m!.gTrend)}。取得日：${m!.importedAt.slice(0, 10)}。予測の変化です。`,
        2,
        m!.previousGTrend - m!.gTrend,
      );
    for (const t of tasks.get(a.id) || [])
      if (t.dueDate && t.dueDate < today)
        add(
          "task",
          "期限を過ぎたタスク",
          `${t.title} · 期限 ${t.dueDate}`,
          3,
          0,
          t.dueDate,
          t.id,
        );
  }
  return result.sort(
    (a, b) =>
      b.priority - a.priority ||
      (a.dueDate || "9999").localeCompare(b.dueDate || "9999") ||
      b.amount - a.amount ||
      a.accountId.localeCompare(b.accountId),
  );
}
export const matchingState = (
  a: PriorityAction,
  states: ActionState[],
  month: string,
  week: string,
) =>
  states.find(
    (s) =>
      s.accountId === a.accountId &&
      s.kind === a.kind &&
      s.referenceId === a.referenceId &&
      s.month === month &&
      s.week === week,
  );
export function effectiveActionStatus(
  a: PriorityAction,
  state: ActionState | undefined,
  today: string,
) {
  if (!state || state.fingerprint !== a.fingerprint) return "open";
  if (state.status === "snoozed" && state.until <= today) return "open";
  return state.status;
}
