import {
  analyzeKw,
  suggestMapping,
  totals,
  type KwReport,
  type KwRow,
  type Mapping,
} from "./kw-analysis.ts";
export type PlacementMapping = Mapping & {
  date: number;
  campaign: number;
  campaignName: number;
};
export type PlacementRow = KwRow & {
  date: string;
  publisher: string;
  campaignId: string;
  campaignName: string;
};
export const placementFields = [
  "keyword",
  "company",
  "date",
  "campaign",
  "campaignName",
  "cost",
  "click",
  "cv",
  "impression",
] as const;
export const placementLabels: Record<string, string> = {
  keyword: "配信面",
  company: "アカウント識別子",
  date: "日付（period_date）",
  campaign: "キャンペーンID",
  campaignName: "キャンペーン名",
  cost: "消化額（円）",
  click: "クリック",
  cv: "CV",
  impression: "表示回数",
};
export function suggestPlacementMapping(headers: string[]): PlacementMapping {
  const find = (values: string[]) =>
    headers.findIndex((h) =>
      values.includes(h.normalize("NFKC").trim().toLowerCase()),
    );
  const base = suggestMapping(headers);
  return {
    ...base,
    keyword: find([
      "publisher_category",
      "publisher category",
      "placement",
      "配信面",
      "媒体カテゴリ",
    ]),
    company: find([
      "account_id",
      "account id",
      "アカウントid",
      "顧客id",
      "advertiser_id",
      "company_key",
      "company",
      "会社",
    ]),
    date: find(["period_date", "date", "period", "日付", "対象日", "年月"]),
    campaign: find(["campaign_id", "campaign id", "キャンペーンid"]),
    campaignName: find(["campaign_name", "campaign name", "キャンペーン名"]),
    cost: find([
      "cost",
      "spend",
      "出稿額",
      "消化額",
      "費用",
      "コスト",
      "広告費",
    ]),
    cv: find([
      "cv",
      "conversion",
      "conversions",
      "応募",
      "応募数",
      "獲得数",
      "cv数",
    ]),
  };
}
export function classifyPlacement(
  value: string,
): "LINE" | "non-LINE" | "UNKNOWN" {
  const key = value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
  if (
    !key ||
    ["unknown", "不明", "未分類", "(not set)", "null", "-", "—"].includes(key)
  )
    return "UNKNOWN";
  return ["line", "lineバイト", "line baito"].includes(key)
    ? "LINE"
    : "non-LINE";
}
const validDate = (d: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(d) &&
  Number.isFinite(Date.parse(d)) &&
  new Date(d).toISOString().slice(0, 10) === d;
export function normalizePlacementRows(
  table: string[][],
  mapping: PlacementMapping,
  header: number,
  granularity: "daily" | "monthly",
): PlacementRow[] {
  if (!Number.isInteger(header) || header < 0 || header >= table.length)
    throw Error("見出し行を確認してください。");
  for (const k of ["keyword", "date", "cost", "click", "cv"] as const)
    if (
      !Number.isInteger(mapping[k]) ||
      mapping[k] < 0 ||
      mapping[k] >= table[header].length
    )
      throw Error("配信面・日付・消化額・クリック・CVの列を指定してください。");
  const selected = Object.values(mapping).filter((i) => i >= 0);
  if (
    selected.some((i) => !Number.isInteger(i) || i >= table[header].length) ||
    new Set(selected).size !== selected.length
  )
    throw Error("列の対応に重複または範囲外の列があります。");
  const rows = table
    .slice(header + 1)
    .map((r, i) => ({ r, line: header + i + 2 }))
    .filter(({ r }) => r.some((v) => v.trim()));
  if (!rows.length || rows.length > 10000)
    throw Error("1ファイル1〜10,000行の明細を指定してください。");
  const seen = new Set<string>();
  const normalized = rows.map(({ r, line }) => {
    const text = (k: keyof PlacementMapping) =>
      String(r[mapping[k]] || "")
        .normalize("NFKC")
        .trim();
    const publisher = text("keyword");
    const company = mapping.company < 0 ? "自社" : text("company");
    const campaignId = text("campaign"),
      campaignName = text("campaignName");
    if (
      !company ||
      [publisher, company, campaignId, campaignName].some((v) => v.length > 200)
    )
      throw Error(`${line}行目：識別子・名称を200文字以内で指定してください。`);
    if (
      [publisher, campaignId, campaignName, company].some((v) =>
        /^(合計|総計|total|grand total)$/i.test(v),
      )
    )
      throw Error(
        `${line}行目：合計行を除き、同じ粒度の明細だけを指定してください。`,
      );
    const rawDate = text("date");
    const m = rawDate.match(
      /^(\d{4})[-/年](\d{1,2})(?:[-/月](\d{1,2})日?)?月?$/,
    );
    const date = m
      ? `${m[1]}-${m[2].padStart(2, "0")}-${(m[3] || "1").padStart(2, "0")}`
      : "";
    if (
      !m ||
      (!m[3] && granularity === "daily") ||
      !validDate(date) ||
      (granularity === "monthly" && !date.endsWith("-01"))
    )
      throw Error(
        `${line}行目：日付を確認してください。日次はYYYY-MM-DD、月次はYYYY-MMまたは月初日を指定します。`,
      );
    const identity = JSON.stringify([
      date,
      company,
      campaignId || campaignName,
      publisher.toLowerCase(),
    ]);
    if (seen.has(identity))
      throw Error(
        `${line}行目：同じ日付・アカウント・キャンペーン・配信面の行が重複しています。集計粒度を確認してください。`,
      );
    seen.add(identity);
    const num = (k: "cost" | "click" | "cv" | "impression") => {
      const v = text(k).replace(/[¥￥,\s]/g, "");
      if (!v || v === "-" || v === "—") return null;
      const n = Number(v);
      if (
        !/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(v) ||
        !Number.isFinite(n) ||
        n > 1e14
      )
        throw Error(
          `${line}行目：${placementLabels[k]}は0以上の実数で指定してください。`,
        );
      return n;
    };
    return {
      keyword: classifyPlacement(publisher),
      publisher,
      company,
      date,
      campaignId,
      campaignName,
      cost: num("cost"),
      click: num("click"),
      cv: num("cv"),
      impression: num("impression"),
    };
  });
  const grain = new Map<string, Set<string>>();
  for (const r of normalized) {
    const key = JSON.stringify([r.company, r.date]);
    if (!grain.has(key)) grain.set(key, new Set());
    grain
      .get(key)!
      .add(
        ["PLACEMENT_TOTAL", "ALL_CAMPAIGNS"].includes(r.campaignId)
          ? "total"
          : "detail",
      );
  }
  if ([...grain.values()].some((g) => g.size > 1))
    throw Error(
      "同じ日付・アカウントに全キャンペーン合算と個別明細が混在しています。二重集計を防ぐため、どちらかに統一してください。",
    );
  return normalized;
}
export function analyzePlacement(input: {
  before: PlacementRow[];
  after: PlacementRow[];
  own: string;
  periods: KwReport["periods"];
  sources: KwReport["sources"];
  granularity: "daily" | "monthly";
}): KwReport {
  if (!["daily", "monthly"].includes(input.granularity))
    throw Error("日次または月次を選択してください。");
  const { periods, own } = input;
  if (
    periods.length !== 2 ||
    periods.some(
      (p) => !validDate(p.from) || !validDate(p.to) || p.from > p.to,
    ) ||
    periods[0].to >= periods[1].from
  )
    throw Error("期間A・Bは重複しない日付を古い順に指定してください。");
  if (
    input.granularity === "monthly" &&
    periods.some(
      (p) =>
        !p.from.endsWith("-01") ||
        new Date(Date.parse(p.to) + 86400000).getUTCDate() !== 1,
    )
  )
    throw Error(
      "月次データは月初〜月末の期間で比較してください。途中の日付への按分は行いません。",
    );
  const raw = [input.before, input.after];
  const filtered = raw.map((rows, i) =>
    rows.filter(
      (r) =>
        r.company === own &&
        r.date >= periods[i].from &&
        r.date <= periods[i].to,
    ),
  );
  const [before, after] = filtered;
  if (!before.length || !after.length)
    throw Error(
      "両期間に対象アカウントのデータが必要です。日付・識別子を確認してください。",
    );
  const report = analyzeKw({
    before,
    after,
    own,
    periods,
    sources: input.sources.map((s, i) => ({ ...s, count: filtered[i].length })),
  });
  const groups = new Map<
    string,
    {
      campaignId: string;
      campaignName: string;
      category: string;
      rows: PlacementRow[][];
    }
  >();
  filtered.forEach((rows, i) =>
    rows.forEach((r) => {
      const id = r.campaignId || r.campaignName;
      const key = JSON.stringify([id, r.keyword]);
      if (!groups.has(key))
        groups.set(key, {
          campaignId: r.campaignId,
          campaignName: r.campaignName || r.campaignId || "キャンペーン未提供",
          category: r.keyword,
          rows: [[], []],
        });
      groups.get(key)!.rows[i].push(r);
    }),
  );
  const campaigns = [...groups.values()]
    .map((g) => ({
      campaignId: g.campaignId,
      campaignName: g.campaignName,
      category: g.category,
      before: totals(g.rows[0]),
      after: totals(g.rows[1]),
    }))
    .sort(
      (a, b) =>
        (b.after.cost ?? b.before.cost ?? 0) -
          (a.after.cost ?? a.before.cost ?? 0) ||
        a.campaignName.localeCompare(b.campaignName) ||
        a.category.localeCompare(b.category),
    );
  const fraction = (a: number | null, b: number | null) =>
    a !== null && b !== null && b > 0 ? a / b : null;
  const line = report.rows.find((r) => r.keyword === "LINE"),
    nonLine = report.rows.find((r) => r.keyword === "non-LINE");
  if (line) {
    const a = fraction(line.before.cost, report.before.cost),
      b = fraction(line.after.cost, report.after.cost);
    if (a !== null && b !== null && b - a >= 0.1) {
      const inefficient =
        line.after.cpa !== null &&
        nonLine?.after.cpa != null &&
        line.after.cpa > nonLine.after.cpa;
      report.findings.unshift({
        title: inefficient
          ? "LINE構成比上昇とCPA差を確認"
          : "LINEの消化構成比が上昇",
        evidence: `LINE消化構成比 ${(a * 100).toFixed(1)}% → ${(b * 100).toFixed(1)}%（+${((b - a) * 100).toFixed(1)}pt）。期間B CPA：LINE ${line.after.cpa?.toLocaleString("ja-JP") ?? "不明"}円、non-LINE ${nonLine?.after.cpa?.toLocaleString("ja-JP") ?? "不明"}円。`,
        proposal: inefficient
          ? "キャンペーン別の配信構成・CV計測・求人内容を確認し、比較条件をそろえた配信テストを検討する。構成変化だけを効率悪化の原因と断定しない。"
          : "構成変化だけで配信を抑制せず、CVやCPAの推移と商談で確認した採用成果を合わせて評価する。",
      });
    }
  }
  report.findings = report.findings.slice(0, 30);
  report.calculationVersion = "placement-v1";
  const labels = [
    ...new Set([...before, ...after].map((r) => r.publisher)),
  ].map((source) => ({
    source: source || "（空欄）",
    category: classifyPlacement(source),
  }));
  report.placement = {
    granularity: input.granularity,
    inputCounts: raw.map((r) => r.length),
    usedCounts: filtered.map((r) => r.length),
    labels: labels.slice(0, 30),
    campaignCount: campaigns.length,
    campaigns: campaigns.slice(0, 80),
  };
  report.warnings = [
    "自社の配信面分析です。LINE／non-LINEは配信面の区分であり、Indeed等の競合媒体との比較ではありません。",
    "LINE・LINEバイト・line baitoの完全一致をLINEに分類します。空欄・UNKNOWN等は不明、その他の提供値はnon-LINEです。分類の内訳を確認してください。",
    "各ファイルを対象アカウントと指定期間で絞り込みました。期間外・他アカウントの行は集計に含みません。",
    "CVはアップロードしたデータの計測値です。管理画面・採用実績と同じ定義とは限りません。",
    "計算は元データの実数合計から行います。行ごとのCPC・CVR・CPAは平均しません。",
    ...report.warnings.filter(
      (w) =>
        !w.includes("KW") &&
        !w.includes("広告主間") &&
        !w.includes("対象期間と計測条件"),
    ),
  ];
  if (report.rows.some((r) => r.keyword === "UNKNOWN"))
    report.warnings.push(
      "配信面が不明な行も総額と構成比の分母に含めています。non-LINEへ推測して振り分けていません。",
    );
  if ([...before, ...after].some((r) => r.impression === null))
    report.warnings.push(
      "表示回数に欠損があります。表示回数とCTRは不明となる場合があります。",
    );
  if (campaigns.length > 80)
    report.warnings.push(
      `全${campaigns.length}件のキャンペーン×配信面から消化額順の80件を表示・保存します。総額と配信面別集計は全件を含みます。`,
    );
  if (labels.length > 30)
    report.warnings.push("元の配信面名称の分類例は先頭30種類まで表示します。");
  if (![...before, ...after].some((r) => r.campaignId || r.campaignName))
    report.warnings.push(
      "キャンペーン列が未提供です。キャンペーンごとの切り分けはできません。",
    );
  if (
    [...before, ...after].some((r) =>
      ["PLACEMENT_TOTAL", "ALL_CAMPAIGNS"].includes(r.campaignId),
    )
  )
    report.warnings.push(
      "全キャンペーン合算の行が含まれます。その行を個別キャンペーンへ分解することはできません。合算と個別明細を混ぜないでください。",
    );
  if (
    !report.rows.some((r) => r.keyword === "non-LINE") ||
    !report.rows.some((r) => r.keyword === "LINE")
  )
    report.warnings.push(
      "片方の配信面が抽出にありません。配信量ゼロとは断定できず、ファイル外も含む構成比は算定できません。",
    );
  return report;
}
