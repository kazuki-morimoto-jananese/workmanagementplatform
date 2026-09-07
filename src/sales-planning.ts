import type {
  SalesMaster,
  SalesReview,
  PersonalTarget,
  SalesAccount,
} from "./sales-types";
export const personKey = (name: string) =>
  name.normalize("NFKC").replace(/\s/g, "").toLowerCase();
export const confidenceOptions = ["確定", "A", "B", "C", "ネタ", "停止"];
export function importedReview(m?: SalesMaster): SalesReview | undefined {
  if (!m) return;
  return {
    id: "import:" + m.id,
    source: "import",
    accountId: m.accountId,
    month: m.month,
    weekOf: "",
    forecast: m.importedForecast ?? null,
    aggressive: m.importedAggressive ?? null,
    aggressiveConfidence: m.importedConfidence || "",
    probability: null,
    reason: m.importedReason || "",
    nextAction: "",
    customerGoal: "",
    customerIssues: "",
    funnel: "",
    effectiveProposal: "unknown",
    budgetTrend: "",
    observedAt: "",
    media: m.media,
    version: 0,
    updatedAt: m.importedAt,
    updatedBy: "",
  };
}
export type PlanningRow = {
  key: string;
  ownerName: string;
  target: number | null;
  trend: number | null;
  forecast: number | null;
  missing: number;
  accounts: number;
};
export function personalPlan(
  accounts: SalesAccount[],
  targets: PersonalTarget[],
  owner: (a: SalesAccount) => string,
  master: (id: string) => SalesMaster | undefined,
  review: (id: string) => SalesReview | undefined,
): PlanningRow[] {
  const names = new Map<string, string>();
  for (const a of accounts) names.set(personKey(owner(a)), owner(a));
  for (const t of targets) names.set(t.ownerKey, t.ownerName);
  const sum = (v: (number | null | undefined)[]) =>
    v.some((x) => x != null)
      ? v.reduce<number>((s, x) => s + (x ?? 0), 0)
      : null;
  return [...names]
    .map(([key, ownerName]) => {
      const assigned = accounts.filter((a) => personKey(owner(a)) === key);
      return {
        key,
        ownerName,
        target: targets.find((t) => t.ownerKey === key)?.amount ?? null,
        trend: assigned.length
          ? sum(assigned.map((a) => master(a.id)?.gTrend))
          : 0,
        forecast: assigned.length
          ? sum(assigned.map((a) => review(a.id)?.forecast))
          : 0,
        missing: assigned.filter((a) => review(a.id)?.forecast == null).length,
        accounts: assigned.length,
      };
    })
    .sort((a, b) => a.ownerName.localeCompare(b.ownerName, "ja"));
}
