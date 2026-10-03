export type AssignmentColumn =
  "accountId" | "name" | "beforeGroup" | "beforeOwner" | "group" | "owner";
export type AssignmentRow = Record<AssignmentColumn, string> & {
  rowNumber: number;
};
export const assignmentColumns: Record<AssignmentColumn, string>;
export function normalizeAssignmentName(value: unknown): string;
export function assignmentMapping(
  headers: string[],
): Record<AssignmentColumn, number>;
export function parseAssignmentTable(
  values: string[][],
  mapping?: Record<AssignmentColumn, number>,
): { rows: AssignmentRow[]; mapping: Record<AssignmentColumn, number> };
