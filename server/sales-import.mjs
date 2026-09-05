export const normalizeHeader = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/[\s\u3000]/g, "")
    .toLowerCase();
export const IMPORT_FIELDS = {
  accountId: ["アカウントID"],
  name: ["アカウント名"],
  status: ["アカウントステータス"],
  ownerName: ["当月担当者"],
  group: ["当月担当G", "当月担当Ｇ"],
  category: ["カテゴリ", "TOP30/D&E"],
  agency: ["代理店名:取引先名", "代理店名"],
  previousActual: ["前月実績"],
  previousGTrend: ["前週Gトレ"],
  gTrend: ["今週Gトレ", "Gトレ"],
  target: ["今月目標"],
  nextTarget: ["目標金額(来月目標)", "来月目標"],
  forecast: ["今月ヨミ"],
  aggressive: ["アグレッシブ数字"],
  reason: ["ヨミ根拠（なぜそのヨミなのか）", "ヨミ根拠"],
  nextAction: ["今週やること"],
  customerGoal: ["顧客目標（取得日付き）", "顧客目標"],
  customerIssues: ["顧客課題"],
  lastContactAt: ["最終接点日"],
  funnel: ["ファネル位置"],
  effectiveProposal: ["有効提案Y/N"],
  budgetTrend: ["予算動向（増減・計画）", "予算動向"],
  nextForecast: ["来月ヨミ"],
  "stanby.budget": ["スタンバイ予算※アカウント別", "スタンバイ予算"],
  "stanby.spend": ["スタンバイ消化額", "スタンバイ実績"],
  "stanby.cv": ["スタンバイ実測CV", "スタンバイCV"],
  "stanby.cpa": ["スタンバイ実測CPA", "スタンバイCPA"],
  "stanby.hires": ["スタンバイ採用数"],
  "indeed.spend": ["indeed消化額"],
  "indeed.budget": ["indeed予算"],
  "indeed.cpa": ["indeedCPA"],
  "indeed.cv": ["indeedCV"],
  "indeed.hires": ["indeed採用数"],
  "indeed.months": ["indeed当月が継続何ヶ月目か"],
  "box.spend": ["求人BOX消化額"],
  "box.budget": ["求人BOX予算"],
  "box.cpa": ["求人BOXCPA"],
  "box.cv": ["求人BOXCV"],
  "box.hires": ["求人BOX採用数"],
  "box.months": ["求人BOX当月が継続何ヶ月目か"],
  acceptableCpa: ["総合企画用許容CPA", "許容CPA"],
};
export const emptyMedia = () => ({
  stanby: { budget: null, spend: null, cv: null, cpa: null, hires: null },
  indeed: {
    budget: null,
    spend: null,
    cv: null,
    cpa: null,
    hires: null,
    months: null,
  },
  box: {
    budget: null,
    spend: null,
    cv: null,
    cpa: null,
    hires: null,
    months: null,
  },
  acceptableCpa: null,
});
export function parseDelimited(text) {
  if (typeof text !== "string" || !text.trim())
    throw Object.assign(new Error("CSV/TSVの内容を入力してください。"), {
      status: 400,
    });
  const input = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  let quoted = false,
    first = "";
  for (let i = 0; i < input.length; i++) {
    if (input[i] === '"') quoted = !quoted;
    if (input[i] === "\n" && !quoted) break;
    first += input[i];
  }
  const delimiter = first.includes("\t") ? "\t" : ",";
  const rows = [];
  let row = [],
    cell = "";
  quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted) quoted = false;
      else if (!cell) quoted = true;
      else cell += c;
    } else if (!quoted && c === delimiter) {
      row.push(cell);
      cell = "";
    } else if (!quoted && c === "\n") {
      row.push(cell);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted)
    throw Object.assign(
      new Error("引用符が閉じていません。元のCSV/TSVを確認してください。"),
      { status: 400 },
    );
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}
export function numeric(value, label = "数値") {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === "" ||
    ["-", "—", "–", "未入力"].includes(String(value).trim())
  )
    return null;
  const normalized = String(value)
    .normalize("NFKC")
    .replace(/[¥￥円,\s]/g, "");
  if (
    !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized) ||
    !Number.isFinite(Number(normalized)) ||
    Number(normalized) > 9e12
  )
    throw Object.assign(
      new Error(`${label}: 0以上の数値（円）を入力してください。`),
      { status: 400 },
    );
  return Number(normalized);
}
export function buildPreview({ text, values, mapping = {} }) {
  const table = values || parseDelimited(text);
  const headers = (table[0] || []).map((h) => String(h ?? "").trim());
  const errors = [],
    warnings = [],
    resolved = {};
  if (table.length < 2) errors.push("見出しの次にデータ行が必要です。");
  if (table.length > 5001)
    errors.push(
      "1回の取込は5,000アカウントまでです。取得範囲を分けてください。",
    );
  for (const [key, aliases] of Object.entries(IMPORT_FIELDS)) {
    const explicit = mapping[key];
    let index = -1;
    if (explicit !== undefined && explicit !== "")
      index =
        typeof explicit === "number" ? explicit : headers.indexOf(explicit);
    else if (explicit !== "")
      index = headers.findIndex((h) =>
        aliases.some((a) => normalizeHeader(a) === normalizeHeader(h)),
      );
    if (index >= 0 && index < headers.length) resolved[key] = index;
  }
  if (resolved.accountId === undefined || resolved.name === undefined)
    errors.push("アカウントID・アカウント名の列を指定してください。");
  if (new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length)
    errors.push(
      "同じ列名が複数あります。元データの見出しを一意にしてください。",
    );
  const seen = new Set(),
    rows = [];
  const numKeys = [
    "previousActual",
    "previousGTrend",
    "gTrend",
    "target",
    "nextTarget",
    "forecast",
    "aggressive",
    "nextForecast",
    "acceptableCpa",
    ...Object.keys(IMPORT_FIELDS).filter((k) => k.includes(".")),
  ];
  for (let i = 1; i < Math.min(table.length, 5002); i++) {
    const row = table[i];
    if (!row.some((c) => String(c ?? "").trim())) continue;
    const cell = (key) =>
      resolved[key] === undefined
        ? undefined
        : String(row[resolved[key]] ?? "").trim();
    const accountId = cell("accountId"),
      name = cell("name");
    if (!accountId || !name) {
      errors.push(`${i + 1}行: アカウントIDまたは名前がありません。`);
      continue;
    }
    if (accountId.length > 200 || name.length > 200) {
      errors.push(`${i + 1}行: IDまたは名前が長すぎます。`);
      continue;
    }
    if (seen.has(accountId)) {
      errors.push(`${i + 1}行: アカウントID「${accountId}」が重複しています。`);
      continue;
    }
    seen.add(accountId);
    if (row.length > headers.length) {
      errors.push(`${i + 1}行: 見出しより列数が多いため取込できません。`);
      continue;
    }
    const record = {
      accountId,
      name,
      media: emptyMedia(),
      raw: Object.fromEntries(headers.map((h, j) => [h, String(row[j] ?? "")])),
    };
    for (const key of Object.keys(resolved)) {
      if (key === "accountId" || key === "name") continue;
      let value = cell(key);
      try {
        if (numKeys.includes(key))
          value = numeric(value, `${i + 1}行 ${headers[resolved[key]]}`);
      } catch (e) {
        errors.push(e.message);
        continue;
      }
      if (key.includes(".")) {
        const [medium, metric] = key.split(".");
        record.media[medium][metric] = value;
      } else if (key === "acceptableCpa") record.media.acceptableCpa = value;
      else record[key] = value;
    }
    if (
      record.lastContactAt &&
      !/^\d{4}-\d{2}-\d{2}$/.test(record.lastContactAt)
    ) {
      warnings.push(
        `${accountId}: 最終接点日はYYYY-MM-DD以外のため原文に保持します。`,
      );
      record.lastContactAt = "";
    }
    if (record.gTrend === 0 && record.forecast > 0)
      warnings.push(
        `${accountId}: Gトレ0円とヨミの差があります。未更新データか確認してください。`,
      );
    if (
      record.forecast !== null &&
      record.forecast !== undefined &&
      !record.reason
    )
      warnings.push(
        `${accountId}: ヨミ根拠が未入力です。初回移行後に入力してください。`,
      );
    rows.push(record);
  }
  warnings.push(
    "マスタ更新は週次ヨミ・商談・議事録を上書きしません。予算は消化額として扱いません。",
  );
  return {
    headers,
    mapping: resolved,
    rows,
    errors: errors.slice(0, 100),
    warnings: [...new Set(warnings)].slice(0, 100),
    count: rows.length,
    fieldOptions: Object.entries(IMPORT_FIELDS).map(([key, names]) => ({
      key,
      label: names[0],
    })),
  };
}
export function csvCell(value) {
  const text = String(value ?? "");
  return (
    '"' +
    (/^[=+\-@\t\r]/.test(text) ? "'" + text : text).replace(/"/g, '""') +
    '"'
  );
}
