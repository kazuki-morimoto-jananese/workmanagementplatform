import { now } from "./store.mjs";
import { orgReference } from "./workspace.mjs";
import { numeric, IMPORT_FIELDS, normalizeHeader } from "./sales-import.mjs";
export const ownerKey = (value) =>
  String(value || "")
    .normalize("NFKC")
    .replace(/\s/g, "")
    .toLowerCase();
export function withImportedForecast(master) {
  if (!master) return master;
  const read = (key) => {
    const entry = Object.entries(master.raw || {}).find(([header]) =>
      IMPORT_FIELDS[key].some(
        (alias) => normalizeHeader(alias) === normalizeHeader(header),
      ),
    );
    return entry?.[1];
  };
  const number = (key) => {
    try {
      return numeric(read(key));
    } catch {
      return null;
    }
  };
  return {
    ...master,
    importedForecast: Object.hasOwn(master, "importedForecast")
      ? master.importedForecast
      : number("forecast"),
    importedAggressive: Object.hasOwn(master, "importedAggressive")
      ? master.importedAggressive
      : number("aggressive"),
    importedConfidence: Object.hasOwn(master, "importedConfidence")
      ? master.importedConfidence
      : String(read("aggressiveConfidence") || ""),
    importedReason: Object.hasOwn(master, "importedReason")
      ? master.importedReason
      : String(read("reason") || ""),
  };
}
export function savePersonalTargets(store, body, user) {
  const fail = (yes, message, status = 400) => {
    if (!yes) throw Object.assign(new Error(message), { status });
  };
  fail(user.role === "admin", "個人目標は管理者が設定できます。", 403);
  fail(
    /^\d{4}-(0[1-9]|1[0-2])$/.test(body.month || ""),
    "対象月を確認してください。",
  );
  fail(["real", "demo"].includes(body.scope), "表示データを確認してください。");
  fail(
    Array.isArray(body.rows) && body.rows.length <= 200,
    "個人目標は200名までです。",
  );
  const settingsId = JSON.stringify([body.month, body.scope]);
  const settings = store.get("salesTargetSettings", settingsId);
  fail(
    (settings?.version || 0) === (body.version || 0),
    "目標が他のメンバーに更新されました。再読み込みしてください。",
    409,
  );
  const seen = new Set();
  const rows = body.rows.map((row) => {
    fail(row && typeof row === "object", "目標の入力形式を確認してください。");
    const ownerName =
      typeof row.ownerName === "string" ? row.ownerName.trim() : "";
    const owner = ownerKey(ownerName);
    fail(owner && ownerName.length <= 80, "担当者名を入力してください。");
    fail(!seen.has(owner), "同じ担当者の目標が重複しています。");
    seen.add(owner);
    const targetId = JSON.stringify([body.month, body.scope, owner]);
    const orgUnitId = Object.hasOwn(row, "orgUnitId")
      ? orgReference(store, row.orgUnitId)
      : store.get("salesPersonalTargets", targetId)?.orgUnitId;
    return {
      ...(orgUnitId !== undefined ? { orgUnitId } : {}),
      id: JSON.stringify([body.month, body.scope, owner]),
      month: body.month,
      scope: body.scope,
      ownerName,
      ownerKey: owner,
      amount: numeric(row.amount, "個人目標"),
      updatedAt: now(),
      updatedBy: user.id,
    };
  });
  const teamName =
    typeof body.teamName === "string" ? body.teamName.trim() : "";
  fail(
    teamName && teamName.length <= 80,
    "合計行のチーム名を入力してください。",
  );
  return store.transaction(() => {
    for (const row of rows) store.put("salesPersonalTargets", row);
    const value = {
      id: settingsId,
      month: body.month,
      scope: body.scope,
      teamName,
      version: (settings?.version || 0) + 1,
      updatedAt: now(),
      updatedBy: user.id,
    };
    store.put("salesTargetSettings", value);
    return value;
  });
}
