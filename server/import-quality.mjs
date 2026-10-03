import { digest, now } from "./store.mjs";
import { IMPORT_FIELDS, normalizeHeader } from "./sales-import.mjs";
import {
  assignedAccounts,
  assignmentDateForMonth,
} from "./account-assignment-records.mjs";

export const mappingId = (headers) => digest(JSON.stringify(headers));
export const ownerMatches = (users, name) =>
  name
    ? users.filter(
        (u) =>
          u.active &&
          [u.name, u.email].some(
            (s) => normalizeHeader(s) === normalizeHeader(name),
          ),
      )
    : [];
const metrics = ["previousActual", "gTrend", "forecast", "aggressive"];
const fromMaster = (m, k) =>
  m?.[
    { forecast: "importedForecast", aggressive: "importedAggressive" }[k] || k
  ] ?? null;
const summary = (values) => ({
  total: values.some((v) => v != null)
    ? values.reduce((n, v) => n + (v ?? 0), 0)
    : null,
  missing: values.filter((v) => v == null).length,
  zero: values.filter((v) => v === 0).length,
});
export function importQuality(store, preview, month) {
  const accounts = new Map(
    assignedAccounts(
      store,
      store.all("salesAccounts"),
      assignmentDateForMonth(month),
    ).map((a) => [a.id, a]),
  );
  const masters = new Map(
    store
      .all("salesMasters")
      .filter((m) => m.month === month)
      .map((m) => [m.accountId, m]),
  );
  const users = store.users();
  const names = new Map();
  for (const a of accounts.values()) {
    const key = normalizeHeader(a.name);
    if (!names.has(key)) names.set(key, new Set());
    names.get(key).add(a.id);
  }
  for (const r of preview.rows) {
    const key = normalizeHeader(r.name);
    if (!names.has(key)) names.set(key, new Set());
    names.get(key).add(r.accountId);
  }
  const issues = [],
    changes = [];
  let created = 0,
    changed = 0,
    unchanged = 0,
    stopped = 0,
    unlinked = 0,
    duplicateNames = 0;
  for (const r of preview.rows) {
    const a = accounts.get(r.accountId),
      m = masters.get(r.accountId);
    const fields = [];
    for (const k of [
      "name",
      "status",
      "ownerName",
      "group",
      "category",
      "agency",
    ])
      if (
        !(a?.assignmentManaged && ["ownerName", "group"].includes(k)) &&
        Object.hasOwn(r, k) &&
        (a?.[k] ?? "") !== r[k]
      )
        fields.push(k);
    for (const k of metrics)
      if (Object.hasOwn(r, k) && fromMaster(m, k) !== r[k]) fields.push(k);
    // Every mapped field is considered; a change in a media metric or reason counts too.
    for (const k of Object.keys(preview.mapping)) {
      if (a?.assignmentManaged && ["ownerName", "group"].includes(k)) continue;
      if (fields.includes(k) || ["accountId", "name"].includes(k)) continue;
      const old = k.includes(".")
        ? m?.media?.[k.split(".")[0]]?.[k.split(".")[1]]
        : k === "acceptableCpa"
          ? m?.media?.acceptableCpa
          : k === "reason"
            ? m?.importedReason
            : k === "aggressiveConfidence"
              ? m?.importedConfidence
              : Object.hasOwn(a || {}, k)
                ? a[k]
                : m?.[k];
      const value = k.includes(".")
        ? r.media[k.split(".")[0]][k.split(".")[1]]
        : k === "acceptableCpa"
          ? r.media.acceptableCpa
          : r[k];
      if (!metrics.includes(k) && (old ?? null) !== (value ?? null))
        fields.push(k);
    }
    if (!a) created++;
    else if (fields.length) changed++;
    else unchanged++;
    if (changes.length < 30 && (!a || fields.length))
      changes.push({
        accountId: r.accountId,
        name: r.name,
        created: !a,
        fields,
      });
    const status = r.status ?? a?.status ?? "";
    if (/停止|休止|解約|配信終了/.test(status)) stopped++;
    const owner = a?.assignmentManaged
      ? a.ownerName
      : (r.ownerName ?? a?.ownerName);
    const retained =
      a?.ownerId &&
      (a.assignmentManaged ||
        !Object.hasOwn(r, "ownerName") ||
        r.ownerName === a.ownerName) &&
      users.some((u) => u.id === a.ownerId && u.active);
    if (!retained && ownerMatches(users, owner).length !== 1) {
      unlinked++;
      if (issues.length < 50)
        issues.push(
          `${r.name}：担当者「${owner || "未設定"}」を一意に紐付けできません。`,
        );
    }
    if (names.get(normalizeHeader(r.name))?.size > 1) {
      duplicateNames++;
      if (issues.length < 50)
        issues.push(
          `${r.name}：同じ名前に複数のアカウントIDがあります。別アカウントか確認してください（自動統合しません）。`,
        );
    }
  }
  return {
    month,
    created,
    changed,
    unchanged,
    stopped,
    unlinked,
    duplicateNames,
    issues,
    changes,
    totals: metrics.map((field) => ({
      field,
      mapped: Object.hasOwn(preview.mapping, field),
      before: summary(
        preview.rows.map((r) => fromMaster(masters.get(r.accountId), field)),
      ),
      incoming: summary(preview.rows.map((r) => r[field] ?? null)),
      after: summary(
        preview.rows.map((r) =>
          Object.hasOwn(r, field)
            ? r[field]
            : fromMaster(masters.get(r.accountId), field),
        ),
      ),
    })),
    token: digest(
      JSON.stringify([
        month,
        preview.mapping,
        preview.rows,
        preview.rows.map((r) => [
          accounts.get(r.accountId) || null,
          masters.get(r.accountId) || null,
        ]),
        users.map((u) => [u.id, u.name, u.email, u.active]),
      ]),
    ),
  };
}
export function saveMapping(store, body, user) {
  const headers = body.headers;
  if (
    !Array.isArray(headers) ||
    !headers.length ||
    headers.length > 300 ||
    headers.some((s) => typeof s !== "string" || s.length > 500)
  )
    throw Object.assign(new Error("見出しの形式を確認してください。"), {
      status: 400,
    });
  const mapping = {};
  for (const k of Object.keys(IMPORT_FIELDS)) {
    const index = body.mapping?.[k];
    if (
      index !== undefined &&
      index !== "" &&
      (!Number.isInteger(index) || index < 0 || index >= headers.length)
    )
      throw Object.assign(new Error("列の対応を確認してください。"), {
        status: 400,
      });
    mapping[k] = index ?? "";
  }
  const id = mappingId(headers);
  if (
    !store.get("salesImportMappings", id) &&
    store.all("salesImportMappings").length >= 30
  )
    throw Object.assign(new Error("保存できる列対応は30種類までです。"), {
      status: 409,
    });
  store.put("salesImportMappings", {
    id,
    headers,
    mapping,
    updatedBy: user.id,
    updatedAt: now(),
  });
  return { saved: true };
}
