// Input adapters (files now, API later) produce this same normalized dataset.
export type KwRow = {
  keyword: string;
  company: string;
  cost: number | null;
  click: number | null;
  cv: number | null;
  impression: number | null;
};
export type Totals = {
  cost: number | null;
  click: number | null;
  cv: number | null;
  impression: number | null;
  cpc: number | null;
  cvr: number | null;
  cpa: number | null;
};
export type KwReport = {
  schemaVersion: 1;
  calculationVersion: string;
  own: string;
  periods: { from: string; to: string }[];
  sources: {
    name: string;
    hash: string;
    sheet: string;
    count: number;
    headerRow?: number;
    mapping?: Mapping;
    adapter?: "file" | "api";
  }[];
  before: Totals;
  after: Totals;
  zeroCvCost: number | null;
  rows: {
    keyword: string;
    before: Totals;
    after: Totals;
    share: number | null;
    state: string;
    index: {
      company: string;
      cost: number | null;
      cpc: number | null;
      cvr: number | null;
      cpa: number | null;
    }[];
  }[];
  findings: { title: string; evidence: string; proposal: string }[];
  warnings: string[];
  entityCount: number;
};
const divide = (a: number | null, b: number | null) =>
  a !== null && b !== null && b > 0 ? a / b : null;
const empty = (): Totals => ({
  cost: null,
  click: null,
  cv: null,
  impression: null,
  cpc: null,
  cvr: null,
  cpa: null,
});
export function totals(rows: KwRow[]): Totals {
  const result = empty();
  for (const k of ["cost", "click", "cv", "impression"] as const)
    result[k] =
      !rows.length || rows.some((r) => r[k] === null)
        ? null
        : rows.reduce((s, r) => s + r[k]!, 0);
  result.cpc = divide(result.cost, result.click);
  result.cvr = divide(result.cv, result.click);
  result.cpa = divide(result.cost, result.cv);
  return result;
}
export function parseDelimited(text: string): string[][] {
  const first = text.split(/\r?\n/)[0];
  const separator = first.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [],
    value = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === separator || c === "\n" || c === "\r")) {
      row.push(value);
      value = "";
      if (c !== separator) {
        if (c === "\r" && text[i + 1] === "\n") i++;
        if (row.some((v) => v.trim())) rows.push(row);
        row = [];
      }
    } else value += c;
  }
  if (quoted) throw new Error("CSVの引用符が閉じていません。");
  row.push(value);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}
export const fields = [
  "keyword",
  "company",
  "cost",
  "click",
  "cv",
  "impression",
] as const;
export type Mapping = Record<(typeof fields)[number], number>;
const aliases: Record<string, string[]> = {
  keyword: ["keyword", "normalized_keyword", "キーワード", "kw"],
  company: [
    "company_key",
    "company",
    "広告主",
    "会社",
    "advertiser_id",
    "account_id",
  ],
  cost: ["cost", "消化額", "費用", "コスト"],
  click: ["click", "clicks", "クリック", "クリック数"],
  cv: ["cv", "conversion", "conversions", "獲得数", "cv数"],
  impression: ["impression", "impressions", "imp", "表示回数"],
};
export function suggestMapping(headers: string[]): Mapping {
  return Object.fromEntries(
    fields.map((k) => [
      k,
      headers.findIndex((h) =>
        aliases[k].includes(h.normalize("NFKC").trim().toLowerCase()),
      ),
    ]),
  ) as Mapping;
}
export function normalizeRows(
  table: string[][],
  mapping: Mapping,
  header: number,
): KwRow[] {
  for (const k of ["keyword", "cost", "click", "cv"])
    if (mapping[k as keyof Mapping] < 0)
      throw new Error(
        "キーワード・消化額・クリック・CVの列を指定してください。",
      );
  const chosen = Object.values(mapping).filter((i) => i >= 0);
  if (new Set(chosen).size !== chosen.length)
    throw new Error("同じ列を複数項目へ割り当てられません。");
  const rows = table.slice(header + 1).filter((r) => r.some((v) => v.trim()));
  if (rows.length > 10000)
    throw new Error("1ファイル1万行以内に分けてください。");
  const seen = new Set<string>();
  return rows.map((r, n) => {
    const key = JSON.stringify(r);
    if (seen.has(key))
      throw new Error(
        `${n + header + 2}行目：完全に同じ行が重複しています。重複・集計粒度を確認してください。`,
      );
    seen.add(key);
    const keyword = String(r[mapping.keyword] || "")
      .normalize("NFKC")
      .trim();
    if (!keyword || keyword.length > 200)
      throw new Error(`${n + header + 2}行目：キーワードを確認してください。`);
    const company =
      mapping.company < 0 ? "自社" : String(r[mapping.company] || "").trim();
    if (!company || company.length > 200)
      throw new Error(
        `${n + header + 2}行目：会社識別子が空または長すぎます。`,
      );
    if (/^(合計|総計|total|grand total)$/i.test(keyword))
      throw new Error(
        `${n + header + 2}行目：合計行を除いて、同じ集計粒度の明細だけを選択してください。`,
      );
    const number = (k: keyof Mapping) => {
      const v = (r[mapping[k]] || "")
        .normalize("NFKC")
        .replace(/[¥￥,\s]/g, "");
      if (!v || v === "—" || v === "-") return null;
      const num = Number(v);
      if (
        !/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(v) ||
        !Number.isFinite(num) ||
        num > 1e14
      )
        throw new Error(
          `${n + header + 2}行目：${k}は0以上の数値（円・件）で指定してください。`,
        );
      return num;
    };
    return {
      keyword,
      company,
      cost: number("cost"),
      click: number("click"),
      cv: number("cv"),
      impression: number("impression"),
    };
  });
}
export function analyzeKw(input: {
  before: KwRow[];
  after: KwRow[];
  own: string;
  periods: KwReport["periods"];
  sources: KwReport["sources"];
}): KwReport {
  const { before, after, own, periods, sources } = input;
  if (
    periods.length !== 2 ||
    periods.some(
      (p) =>
        ![p.from, p.to].every(
          (d) =>
            /^\d{4}-\d{2}-\d{2}$/.test(d) &&
            !isNaN(Date.parse(d)) &&
            new Date(d).toISOString().slice(0, 10) === d,
        ) || p.from > p.to,
    ) ||
    periods[0].to >= periods[1].from
  )
    throw new Error("期間A・Bは重複しない日付を古い順に指定してください。");
  const companies = [...new Set([...before, ...after].map((r) => r.company))];
  if (companies.length > 5)
    throw new Error("自社1社と競合4社までのデータに絞ってください。");
  const a = before.filter((r) => r.company === own),
    b = after.filter((r) => r.company === own);
  if (!a.length || !b.length)
    throw new Error(
      "両期間に自社データが必要です。会社識別子と対象ファイルを確認してください。",
    );
  const totalA = totals(a),
    totalB = totals(b);
  function group(rows: KwRow[]) {
    const result = new Map<string, KwRow[]>();
    for (const r of rows) {
      const k = JSON.stringify([r.company, r.keyword]);
      if (!result.has(k)) result.set(k, []);
      result.get(k)!.push(r);
    }
    return new Map([...result].map(([k, v]) => [k, totals(v)]));
  }
  const ga = group(before),
    gb = group(after);
  const get = (g: Map<string, Totals>, company: string, kw: string) =>
    g.get(JSON.stringify([company, kw]));
  const rows: KwReport["rows"] = [
    ...new Set([...a, ...b].map((r) => r.keyword)),
  ]
    .map((keyword) => {
      const av = get(ga, own, keyword),
        bv = get(gb, own, keyword);
      const index = companies
        .filter((c) => c !== own)
        .map((company) => {
          const c = get(gb, company, keyword);
          const ratio = (k: keyof Totals) => {
            const x = divide(c?.[k] ?? null, bv?.[k] ?? null);
            return x === null ? null : x * 100;
          };
          return {
            company,
            cost: ratio("cost"),
            cpc: ratio("cpc"),
            cvr: ratio("cvr"),
            cpa: ratio("cpa"),
          };
        });
      return {
        keyword,
        before: av || empty(),
        after: bv || empty(),
        share: divide(bv?.cost ?? null, totalB.cost),
        state: !av
          ? "今回の抽出に出現"
          : !bv
            ? "今回の抽出では不在"
            : "両期間あり",
        index,
      };
    })
    .sort(
      (x, y) =>
        (y.after.cost ?? y.before.cost ?? 0) -
          (x.after.cost ?? x.before.cost ?? 0) ||
        x.keyword.localeCompare(y.keyword),
    );
  const yen = (v: number | null) =>
    v === null ? "不明" : v.toLocaleString("ja-JP") + "円";
  const findings: KwReport["findings"] = [];
  for (const row of rows) {
    const share = row.share ?? divide(row.before.cost, totalA.cost);
    if (share === null || share < 0.005) continue;
    if (row.after.cv === 0 && (row.after.cost || 0) > 0)
      findings.push({
        title: row.keyword + "：CVゼロの消化を確認",
        evidence: `期間B：消化額 ${yen(row.after.cost)}、CV 0件。自社消化額の${(share * 100).toFixed(1)}%。`,
        proposal:
          "計測の遅延・欠損と求人内容を確認し、配信条件の見直しを検討する。",
      });
    const ratio = divide(row.after.cpa, row.before.cpa);
    if (ratio !== null && (ratio >= 1.25 || ratio <= 0.8))
      findings.push({
        title:
          row.keyword + (ratio >= 1.25 ? "：CPA悪化を確認" : "：CPA改善を確認"),
        evidence: `CPA ${yen(row.before.cpa)} → ${yen(row.after.cpa)}（${(ratio * 100).toFixed(1)}%）。`,
        proposal:
          "CV定義と期間条件を確認し、変化の要因を調べて次回商談で施策を相談する。",
      });
    if (row.state !== "両期間あり")
      findings.push({
        title: row.keyword + "：" + row.state,
        evidence: `期間A ${yen(row.before.cost)}、期間B ${yen(row.after.cost)}。`,
        proposal:
          "配信開始・停止と断定せず、抽出の足切り・期間・名称変更を確認する。",
      });
    const costRatio = divide(row.after.cost, row.before.cost);
    if (costRatio !== null && (costRatio >= 1.25 || costRatio <= 0.8))
      findings.push({
        title:
          row.keyword +
          (costRatio >= 1.25 ? "：消化額が増加" : "：消化額が減少"),
        evidence: `消化額 ${yen(row.before.cost)} → ${yen(row.after.cost)}（${(costRatio * 100).toFixed(1)}%）。`,
        proposal:
          "期間日数と配信条件の違いを確認し、獲得への影響と合わせて増減の妥当性を確認する。",
      });
    const previousShare = divide(row.before.cost, totalA.cost);
    if (
      previousShare !== null &&
      row.share !== null &&
      Math.abs(row.share - previousShare) >= 0.05
    )
      findings.push({
        title: row.keyword + "：自社内の消化構成が変化",
        evidence: `自社内の消化シェア ${(previousShare * 100).toFixed(1)}% → ${(row.share * 100).toFixed(1)}%。`,
        proposal:
          "予算配分が変わった背景を確認し、CPAや採用への影響を次回商談で検証する。",
      });
  }
  const warnings = [
    "対象期間と計測条件は入力者の指定です。原本と照合してください。",
    "広告主間の比較です。媒体別（Indeed等）の比較ではありません。",
    "抽出外の行は0ではありません。出現・不在は配信開始・停止を意味しません。",
    "因果関係は断定していません。提案は担当者が確認してください。",
    "KW集計の対象範囲は営業売上・管理画面の合計と一致するとは限りません。総額の照合には元データの集計定義が必要です。",
  ];
  if (
    [...before, ...after].some(
      (r) => r.cost === null || r.cv === null || r.click === null,
    )
  )
    warnings.push("欠損値があります。関連する合計・率は不明として表示します。");
  if (
    Date.parse(periods[0].to) - Date.parse(periods[0].from) !==
    Date.parse(periods[1].to) - Date.parse(periods[1].from)
  )
    warnings.push(
      "比較期間の日数が異なります。合計値の単純比較には注意してください。",
    );
  if (rows.length > 100)
    warnings.push(
      `全${rows.length}KWから消化額順の100件を表示・保存します。合計は全KWから計算しています。`,
    );
  if (findings.length > 30)
    warnings.push("施策候補は自社の消化額順に30件まで表示・保存します。");
  return {
    schemaVersion: 1,
    calculationVersion: "kw-v1",
    own,
    periods,
    sources,
    before: totalA,
    after: totalB,
    zeroCvCost: rows.some((r) => r.after.cv === 0 && r.after.cost === null)
      ? null
      : rows
          .filter((r) => r.after.cv === 0)
          .reduce((s, r) => s + (r.after.cost || 0), 0),
    rows: rows.slice(0, 100),
    findings: findings.slice(0, 30),
    warnings,
    entityCount: rows.length,
  };
}
