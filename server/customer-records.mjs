export const customerKinds = [
  "salesMinutes",
  "salesOpportunities",
  "salesActivities",
  "tasks",
  "kwAnalyses",
  "salesInitiatives",
  "salesReviews",
  "crmContacts",
];
const kindsSql = customerKinds.map((s) => `'${s}'`).join(",");
export const customerStamp =
  "coalesce(nullif(json_extract(data,'$.updatedAt'),''),nullif(json_extract(data,'$.createdAt'),''),nullif(json_extract(data,'$.importedAt'),''),'')";
export const customerIndexSql = `CREATE INDEX IF NOT EXISTS records_customer_recent ON records(kind,json_extract(data,'$.accountId'),${customerStamp},id) WHERE kind IN (${kindsSql});`;

// The partial index excludes master snapshots and unrelated records. The same
// literal predicate is retained in queries so SQLite can choose that index.
export function accountRecords(
  store,
  { kind, accountId, user, limit = 26, cursor, full = false },
) {
  if (
    !customerKinds.includes(kind) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 501
  )
    throw new Error("Invalid account query");
  const args = [kind, accountId];
  let where = `kind IN (${kindsSql}) AND kind=? AND json_extract(data,'$.accountId')=?`;
  if (kind === "tasks" && user.role !== "admin") {
    where += ` AND (coalesce(json_extract(data,'$.visibility'),'workspace')!='private' OR json_extract(data,'$.createdBy')=? OR CASE WHEN json_type(data,'$.assigneeIds')='array' THEN EXISTS(SELECT 1 FROM json_each(data,'$.assigneeIds') WHERE value=?) ELSE json_extract(data,'$.assigneeId')=? END)`;
    args.push(user.id, user.id, user.id);
  }
  if (kind === "salesMinutes")
    where += " AND coalesce(json_extract(data,'$.supersededBy'),'')=''";
  if (cursor) {
    where += ` AND (${customerStamp},kind,id)<(?,?,?)`;
    args.push(cursor.stamp, cursor.kind, cursor.id);
  }
  const projection = full
    ? "data"
    : `id, kind, ${customerStamp} AS stamp,
    coalesce(json_extract(data,'$.title'),json_extract(data,'$.name'),json_extract(data,'$.type'),'') AS title,
    substr(coalesce(nullif(json_extract(data,'$.summary.overview'),''),nullif(json_extract(data,'$.nextAction'),''),nullif(json_extract(data,'$.proposal'),''),nullif(json_extract(data,'$.description'),''),nullif(json_extract(data,'$.notes'),''),json_extract(data,'$.reason'),''),1,450) AS excerpt,
    coalesce(json_extract(data,'$.status'),json_extract(data,'$.stage'),'') AS status,
    coalesce(json_extract(data,'$.meetingDate'),json_extract(data,'$.date'),json_extract(data,'$.weekOf'),json_extract(data,'$.implementedAt'),'') AS eventDate`;
  return store.db
    .prepare(
      `SELECT ${projection} FROM records WHERE ${where} ORDER BY ${customerStamp} DESC,kind DESC,id DESC LIMIT ?`,
    )
    .all(...args, limit)
    .map((r) => (full ? JSON.parse(r.data) : r));
}
