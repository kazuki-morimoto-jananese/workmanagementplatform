import type { KwReport, Totals } from "./kw-analysis";
const num = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
const share = (v: number | null, total: number | null) =>
  v !== null && total !== null && total > 0 ? (v / total) * 100 : null;
export function PlacementTables({ report: r }: { report: KwReport }) {
  const p = r.placement!;
  const line = r.rows.find((row) => row.keyword === "LINE");
  const a = share(line?.before.cost ?? null, r.before.cost),
    b = share(line?.after.cost ?? null, r.after.cost);
  const metrics = (t: Totals, total: Totals) => (
    <>
      <td>{num(t.impression)}</td>
      <td>{num(t.cost)}</td>
      <td>{num(share(t.cost, total.cost))}%</td>
      <td>{num(t.click)}</td>
      <td>{num(share(t.click, t.impression))}%</td>
      <td>{num(t.cv)}</td>
      <td>{num(share(t.cv, total.cv))}%</td>
      <td>{num(t.cpc)}</td>
      <td>{num(t.cvr === null ? null : t.cvr * 100)}%</td>
      <td>{num(t.cpa)}</td>
    </>
  );
  return (
    <div className="placement-report">
      <h3>LINE・その他面の構成と効率</h3>
      <p>
        LINEの消化構成比：
        <strong>
          {num(a)}% → {num(b)}%
        </strong>
        （差分 {num(a !== null && b !== null ? b - a : null)}
        pt）。構成比の分母は、ファイル内の対象アカウント・対象期間の全配信面（不明を含む）です。
      </p>
      <p>
        集計粒度：{p.granularity === "daily" ? "日次" : "月次"}。期間A{" "}
        {p.inputCounts[0]}行中{p.usedCounts[0]}行、期間B {p.inputCounts[1]}行中
        {p.usedCounts[1]}
        行を使用。差分は期間外・他アカウントとして除外しました。
      </p>
      <div className="prep-table">
        <table aria-label="配信面別の期間比較">
          <thead>
            <tr>
              <th>配信面</th>
              <th>期間</th>
              <th>IMP</th>
              <th>消化額（円）</th>
              <th>消化構成比</th>
              <th>クリック</th>
              <th>CTR</th>
              <th>CV</th>
              <th>CV構成比</th>
              <th>CPC（円）</th>
              <th>CVR</th>
              <th>CPA（円）</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.flatMap((row) =>
              (["before", "after"] as const).map((k, i) => (
                <tr key={row.keyword + k}>
                  <th>{row.keyword}</th>
                  <td>{i ? "B" : "A"}</td>
                  {metrics(row[k], r[k])}
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
      <h3>キャンペーン別の配信面内訳</h3>
      <p>
        キャンペーン×配信面 {p.campaignCount}
        件。未提供・全キャンペーン合算のデータでは個別の切り分けはできません。
      </p>
      <div className="prep-table">
        <table aria-label="キャンペーン別の配信面比較">
          <thead>
            <tr>
              <th>キャンペーン</th>
              <th>配信面</th>
              <th>消化A（円）</th>
              <th>消化B（円）</th>
              <th>CV A</th>
              <th>CV B</th>
              <th>CPA A（円）</th>
              <th>CPA B（円）</th>
            </tr>
          </thead>
          <tbody>
            {p.campaigns.map((c, i) => (
              <tr key={i}>
                <th>
                  {c.campaignName}
                  <small style={{ display: "block" }}>{c.campaignId}</small>
                </th>
                <td>{c.category}</td>
                <td>{num(c.before.cost)}</td>
                <td>{num(c.after.cost)}</td>
                <td>{num(c.before.cv)}</td>
                <td>{num(c.after.cv)}</td>
                <td>{num(c.before.cpa)}</td>
                <td>{num(c.after.cpa)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>元の配信面名と分類</h3>
      <p>{p.labels.map((v) => `${v.source} → ${v.category}`).join(" ／ ")}</p>
    </div>
  );
}
