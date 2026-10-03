export const assignmentColumns = {
  accountId: "アカウントID",
  name: "アカウント名",
  beforeGroup: "前月担当Ｇ",
  beforeOwner: "前月担当者",
  group: "当月担当Ｇ",
  owner: "当月担当者",
};
export const normalizeAssignmentName = (v) =>
  String(v ?? "")
    .normalize("NFKC")
    .replace(/[\s\u3000]/g, "")
    .toLowerCase();
const check = (ok, message) => {
  if (!ok) throw Object.assign(new Error(message), { status: 400 });
};
export function assignmentMapping(headers) {
  return Object.fromEntries(
    Object.entries(assignmentColumns).map(([key, label]) => {
      const matches = headers.flatMap((v, i) =>
        normalizeAssignmentName(v) === normalizeAssignmentName(label)
          ? [i]
          : [],
      );
      return [key, matches.length === 1 ? matches[0] : -1];
    }),
  );
}
export function parseAssignmentTable(
  values,
  mapping = assignmentMapping(values?.[0] || []),
) {
  check(
    Array.isArray(values) &&
      values.length > 1 &&
      values.length <= 20001 &&
      values.every(Array.isArray),
    "見出しとデータを含む20,000行以内の表を指定してください。",
  );
  for (const [key, label] of Object.entries(assignmentColumns))
    check(
      Number.isInteger(mapping[key]) &&
        mapping[key] >= 0 &&
        mapping[key] < values[0].length,
      `${label}の列を指定してください。`,
    );
  check(
    new Set(Object.keys(assignmentColumns).map((k) => mapping[k])).size === 6,
    "同じ列を複数の項目に指定できません。",
  );
  const rows = values
    .slice(1)
    .map((r, i) => ({
      ...Object.fromEntries(
        Object.keys(assignmentColumns).map((k) => [
          k,
          String(r[mapping[k]] ?? "").trim(),
        ]),
      ),
      rowNumber: i + 2,
    }))
    .filter((r) => r.accountId || r.name);
  const seen = new Set();
  for (const r of rows) {
    check(
      r.accountId && r.name,
      `${r.rowNumber}行: アカウントIDと名前が必要です。`,
    );
    check(
      !seen.has(r.accountId),
      `${r.rowNumber}行: アカウントIDが重複しています。`,
    );
    check(
      Object.keys(assignmentColumns).every((k) => r[k].length <= 200),
      `${r.rowNumber}行: セルは200文字以内にしてください。`,
    );
    check(
      !/^[\d.]+e[+-]?\d+$/i.test(r.accountId),
      `${r.rowNumber}行: IDが指数表記です。文字列形式のIDを使用してください。`,
    );
    seen.add(r.accountId);
  }
  check(rows.length, "アカウントがありません。");
  return { rows, mapping };
}
