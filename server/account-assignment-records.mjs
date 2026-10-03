export const assignmentIndexSql = `CREATE INDEX IF NOT EXISTS records_account_assignment ON records(json_extract(data,'$.accountId'),json_extract(data,'$.effectiveFrom')) WHERE kind='accountAssignments';
CREATE INDEX IF NOT EXISTS records_assignment_runs ON records(json_extract(data,'$.createdAt'),id) WHERE kind='accountAssignmentRuns';`;
export const assignmentToday = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
export const assignmentDateForMonth = (month) => {
  const today = assignmentToday();
  return today.startsWith(month)
    ? today
    : new Date(
        Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
      )
        .toISOString()
        .slice(0, 10);
};
export function assignmentAt(store, accountId, date) {
  const row = store.db
    .prepare(
      "SELECT data FROM records WHERE kind='accountAssignments' AND json_extract(data,'$.accountId')=? AND json_extract(data,'$.effectiveFrom')<=? ORDER BY json_extract(data,'$.effectiveFrom') DESC LIMIT 1",
    )
    .get(accountId, date);
  return row ? JSON.parse(row.data) : null;
}
export function managedAccountIds(store) {
  return new Set(
    store.db
      .prepare(
        "SELECT DISTINCT json_extract(data,'$.accountId') AS accountId FROM records WHERE kind='accountAssignments'",
      )
      .all()
      .map((r) => r.accountId),
  );
}
export function assignedAccounts(store, accounts, date = assignmentToday()) {
  const rows = store.db
    .prepare(
      `SELECT r.data FROM records r WHERE r.kind='accountAssignments' AND json_extract(r.data,'$.effectiveFrom')<=? AND NOT EXISTS (SELECT 1 FROM records n WHERE n.kind='accountAssignments' AND json_extract(n.data,'$.accountId')=json_extract(r.data,'$.accountId') AND json_extract(n.data,'$.effectiveFrom')>json_extract(r.data,'$.effectiveFrom') AND json_extract(n.data,'$.effectiveFrom')<=?)`,
    )
    .all(date, date);
  const byId = new Map(
    rows.map((r) => {
      const a = JSON.parse(r.data);
      return [a.accountId, a];
    }),
  );
  const managed = managedAccountIds(store);
  return accounts.map((a) => {
    const k = a.accountId || a.id,
      found = byId.get(k);
    if (!managed.has(k)) return a;
    // Do not assign today's owner to an earlier month whose history is unknown.
    return {
      ...a,
      ownerId: found?.ownerId || "",
      ownerName: found?.ownerName || "",
      group: found?.group || "",
      orgUnitId: found?.orgUnitId || "",
      assignmentManaged: true,
      assignmentAsOf: date,
      assignmentUnknown: !found,
      assignmentId: found?.id || "",
    };
  });
}
