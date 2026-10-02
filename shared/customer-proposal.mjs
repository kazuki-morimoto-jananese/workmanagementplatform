// Pure, deterministic model shared by the server, preview and PPTX exporter.
const fail = (ok, message) => {
  if (!ok) throw Object.assign(new Error(message), { status: 400 });
};
const clean = (v, max, label, required = false) => {
  fail(
    typeof v === "string" && v.length <= max,
    `${label}は${max}文字以内で入力してください。`,
  );
  const s = v
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  fail(!required || s.length > 0, `${label}を入力してください。`);
  return s;
};
export function proposalDefaults(report, recipient = "", presenter = "") {
  return {
    title: report.placement
      ? "配信面の振り返りと改善提案"
      : "キーワード分析と改善提案",
    recipient: recipient.slice(0, 120),
    issuer: "",
    presenter: presenter.slice(0, 80),
    issuedOn: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10),
    overview: "",
    cvDefinition: "",
    conditions: "",
    nextSteps: "",
    rowIndices: report.rows.slice(0, 3).map((_, i) => i),
    findings: report.findings
      .slice(0, 3)
      .map((f, index) => ({ index, proposal: f.proposal })),
    includeCompetition: false,
    includeCompetitorNames: false,
    includeSourceNames: false,
  };
}
export function validateProposalOptions(input, report) {
  fail(input && typeof input === "object", "提案資料の設定が必要です。");
  const out = {};
  for (const [key, max, label, required] of [
    ["title", 100, "資料タイトル", true],
    ["recipient", 120, "提出先", true],
    ["issuer", 80, "提出元"],
    ["presenter", 80, "作成者"],
    ["issuedOn", 10, "資料日付", true],
    ["overview", 2000, "提案サマリー"],
    ["cvDefinition", 300, "CVの定義"],
    ["conditions", 1000, "比較条件"],
    ["nextSteps", 2000, "次のアクション"],
  ])
    out[key] = clean(input[key], max, label, required);
  fail(
    /^\d{4}-\d{2}-\d{2}$/.test(out.issuedOn) &&
      Number.isFinite(Date.parse(out.issuedOn)) &&
      new Date(out.issuedOn).toISOString().slice(0, 10) === out.issuedOn,
    "資料日付を確認してください。",
  );
  fail(
    Array.isArray(input.rowIndices) &&
      input.rowIndices.length <= 8 &&
      new Set(input.rowIndices).size === input.rowIndices.length &&
      input.rowIndices.every(
        (i) => Number.isInteger(i) && i >= 0 && i < report.rows.length,
      ),
    "注目する明細は重複なしで8件まで選択できます。",
  );
  out.rowIndices = [...input.rowIndices];
  fail(
    Array.isArray(input.findings) &&
      input.findings.length <= 6 &&
      new Set(input.findings.map((f) => f?.index)).size ===
        input.findings.length,
    "提案候補は重複なしで6件まで選択できます。",
  );
  out.findings = input.findings.map((f) => {
    fail(
      f &&
        Number.isInteger(f.index) &&
        f.index >= 0 &&
        f.index < report.findings.length,
      "提案候補が元の分析と一致しません。",
    );
    return {
      index: f.index,
      proposal: clean(f.proposal, 3000, "提案文", true),
    };
  });
  for (const key of [
    "includeCompetition",
    "includeCompetitorNames",
    "includeSourceNames",
  ]) {
    fail(typeof input[key] === "boolean", "掲載設定を確認してください。");
    out[key] = input[key];
  }
  out.includeCompetition = !report.placement && out.includeCompetition;
  out.includeCompetitorNames =
    out.includeCompetition && out.includeCompetitorNames;
  return out;
}
// East Asian characters occupy roughly twice the width of Latin characters.
// Explicit lines keep long Japanese paragraphs bounded in preview and PowerPoint.
export function wrapProposalText(value, units = 78) {
  const lines = [];
  for (const paragraph of String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .split(/\r?\n/)) {
    let line = "",
      width = 0;
    for (const c of paragraph) {
      const n = c.codePointAt(0) > 255 ? 2 : 1;
      if (width + n > units) {
        lines.push(line);
        line = "";
        width = 0;
      }
      line += c;
      width += n;
    }
    lines.push(line);
  }
  return lines;
}
const number = (v) =>
  v == null ? "—" : v.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
const metric = (k, v) =>
  v == null
    ? "—"
    : number(k === "cvr" ? v * 100 : v) +
      (k === "cvr" ? "%" : ["cost", "cpc", "cpa"].includes(k) ? " 円" : "");
const labels = {
  cost: "消化額",
  impression: "表示回数",
  click: "クリック",
  cv: "CV",
  cpc: "CPC",
  cvr: "CVR",
  cpa: "CPA",
};
export function buildCustomerProposal(report, input) {
  const options = validateProposalOptions(input, report);
  const slides = [];
  const textPages = (title, paragraphs, kind = "text") => {
    const lines = paragraphs.flatMap((p) => [...wrapProposalText(p), ""]);
    while (lines.at(-1) === "") lines.pop();
    for (let i = 0; i < lines.length; i += 11)
      slides.push({
        kind,
        title: title + (i ? "（続き）" : ""),
        lines: lines.slice(i, i + 11),
      });
  };
  const period = report.periods.map(
    (p, i) => `期間${i ? "B" : "A"}：${p.from} ～ ${p.to}`,
  );
  textPages(
    "分析と改善のご提案",
    [
      options.title,
      `${options.recipient} 御中`,
      [options.issuer, options.presenter].filter(Boolean).join(" / "),
      options.issuedOn,
      ...period,
    ].filter(Boolean),
    "cover",
  );
  if (options.overview) textPages("提案サマリー", [options.overview]);
  textPages("比較条件とデータの範囲", [
    ...period,
    `対象：${report.placement ? "LINEバイト・配信面" : "キーワード"}の自社実績`,
    `CVの定義：${options.cvDefinition || "未確認（元データの計測定義を確認してください）"}`,
    options.conditions ||
      "比較条件：元データの抽出条件・計測条件の一致を確認してください。",
    "合計は分析に含まれる全対象の集計です。以下の注目明細・提案は選択した一部のみを掲載します。",
  ]);
  slides.push({
    kind: "table",
    title: "実績比較 · 全対象の合計",
    headers: ["指標", "期間A", "期間B", "差分（B−A）"],
    rows: Object.keys(labels).map((k) => {
      const a = report.before[k],
        b = report.after[k];
      const delta =
        a == null || b == null
          ? "—"
          : (b - a > 0 ? "+" : "") +
            (k === "cvr" ? number((b - a) * 100) + " pt" : metric(k, b - a));
      return [labels[k], metric(k, a), metric(k, b), delta];
    }),
    caption:
      "— は未計測・未提供または分母0で算出不可。CVRの差分はパーセントポイントです。",
  });
  slides.push({
    kind: "bars",
    title: "消化額・CV・CPAの変化",
    series: ["cost", "cv", "cpa"].map((k) => ({
      label: labels[k],
      values: [report.before[k], report.after[k]],
      formatted: [metric(k, report.before[k]), metric(k, report.after[k])],
    })),
    caption:
      "各指標で軸のスケールが異なります。期間の日数・計測条件も合わせて確認してください。",
  });
  options.rowIndices.forEach((index, i) => {
    const row = report.rows[index];
    textPages(`注目${report.placement ? "配信面" : "KW"} · ${i + 1}`, [
      row.keyword,
      ...["cost", "click", "cv", "cpa", "cvr"].map(
        (k) =>
          `${labels[k]}：${metric(k, row.before[k])} → ${metric(k, row.after[k])}`,
      ),
      `抽出状態：${row.state}`,
      "抽出外は0ではありません。出現・不在から配信開始・停止を断定しません。",
    ]);
  });
  if (options.includeCompetition) {
    const names = [
      ...new Set(report.rows.flatMap((r) => r.index.map((c) => c.company))),
    ].sort();
    const rows = options.rowIndices.flatMap((idx, i) =>
      report.rows[idx].index.map((c) => [
        `注目KW ${i + 1}`,
        `競合${names.indexOf(c.company) + 1}`,
        ...["cost", "cpc", "cvr", "cpa"].map((k) => number(c[k])),
      ]),
    );
    for (let i = 0; i < rows.length; i += 6)
      slides.push({
        kind: "table",
        title: "競合広告主比較 · 自社＝100",
        headers: ["対象", "広告主", "COST", "CPC", "CVR", "CPA"],
        rows: rows.slice(i, i + 6),
        caption:
          "期間Bの指数。— は算出不可。広告主間の比較であり、競合媒体の比較や因果関係の証明ではありません。",
      });
    if (options.includeCompetitorNames) {
      const selected = new Set(
        options.rowIndices.flatMap((idx) =>
          report.rows[idx].index.map((c) => c.company),
        ),
      );
      textPages(
        "競合広告主の表記",
        names
          .filter((n) => selected.has(n))
          .map((n) => `競合${names.indexOf(n) + 1}：${n}`),
      );
    }
  }
  options.findings.forEach((f, i) => {
    const source = report.findings[f.index];
    textPages(`改善提案 · ${i + 1}`, [
      source.title,
      `【根拠】${source.evidence}`,
      `【提案】${f.proposal}`,
    ]);
  });
  if (options.nextSteps) textPages("次のアクション", [options.nextSteps]);
  textPages("データの出典・留意事項", [
    `Excel／CSVから保存した分析結果を使用。計算版：${report.calculationVersion}。資料版：proposal-v1。`,
    ...report.sources.map(
      (s, i) =>
        `${period[i]} / 集計元 ${s.count}行${options.includeSourceNames ? ` / ${s.name}` : ""}`,
    ),
    `分析対象 ${report.entityCount}${report.placement ? "配信面" : "KW"}。保存明細 ${report.rows.length}件のうち注目明細 ${options.rowIndices.length}件、提案候補 ${options.findings.length}件を掲載。`,
    "CPC＝消化額÷クリック、CVR＝CV÷クリック、CPA＝消化額÷CV。率は合計から算出し、行ごとの率の平均は使いません。0と不明を区別し、分母0は算出不可とします。",
    ...report.warnings,
  ]);
  fail(
    slides.length <= 60,
    "資料は60ページまでです。文章・掲載候補を絞ってください。",
  );
  return {
    schemaVersion: 1,
    templateVersion: "proposal-v1",
    title: options.title,
    recipient: options.recipient,
    issuedOn: options.issuedOn,
    options,
    slides,
  };
}
