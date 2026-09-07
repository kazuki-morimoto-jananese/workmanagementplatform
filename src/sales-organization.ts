import type { OrgUnit, Member } from "./types";
import type { PlanningRow } from "./sales-planning";
import { personKey } from "./sales-planning.ts";

export function belongsTo(
  units: OrgUnit[],
  id: string | undefined,
  selected: string,
): boolean {
  if (selected === "all") return true;
  if (selected === "unassigned") return !id || !units.some((u) => u.id === id);
  const visited = new Set<string>();
  while (id && !visited.has(id)) {
    if (id === selected) return true;
    visited.add(id);
    id = units.find((u) => u.id === id)?.parentId;
  }
  return false;
}
export function assignPlanningOrganizations(
  rows: PlanningRow[],
  members: Member[],
): PlanningRow[] {
  return rows.map((row) => ({
    ...row,
    // An explicit monthly assignment (including unassigned) wins over today's member profile.
    orgUnitId:
      row.orgUnitId ??
      members.find((m) => personKey(m.name) === row.key)?.orgUnitId ??
      "",
  }));
}
