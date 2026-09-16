import { useState } from "react";
import type { ImportPreview } from "./sales-types";
import type { GoogleApi } from "./GoogleWorkflows";
import "./sales-improvements.css";
const num = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
export function ImportQuality({
  preview,
  api,
  admin,
  mapping,
  disabled,
}: {
  preview: ImportPreview;
  api: GoogleApi;
  admin: boolean;
  mapping: Record<string, number | string>;
  disabled: boolean;
}) {
  const q = preview.quality;
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  if (!q) return null;
  const labels: Record<string, string> = {
    previousActual: "前月実績",
    gTrend: "今週Gトレ",
    forecast: "Excel今月ヨミ",
    aggressive: "アグレッシブ",
    name: "名前",
    ownerName: "担当者",
    status: "状態",
    group: "グループ",
    agency: "代理店",
    category: "カテゴリ",
  };
  return (
    <section className="improvement-quality" aria-label="取り込み品質チェック">
      <h4>取り込み前の照合 · {q.month}</h4>
      <p>
        新規 {q.created}件 / 変更あり {q.changed}件 / 比較項目の変更なし{" "}
        {q.unchanged}件
      </p>
      <p>
        担当未紐付け {q.unlinked}件 / 同名・別ID候補 {q.duplicateNames}件 /
        停止・休止・解約 {q.stopped}件
      </p>
      <div className="prep-table">
        <table>
          <thead>
            <tr>
              <th>項目</th>
              <th>取込前</th>
              <th>ファイル</th>
              <th>取込後</th>
              <th>既知値の差</th>
              <th>ファイルの0 / 空欄</th>
            </tr>
          </thead>
          <tbody>
            {q.totals.map((t) => (
              <tr key={t.field}>
                <th>{labels[t.field]}</th>
                <td>
                  {num(t.before.total)}
                  <small>欠損 {t.before.missing}件</small>
                </td>
                <td>{t.mapped ? num(t.incoming.total) : "列未指定"}</td>
                <td>
                  {num(t.after.total)}
                  <small>欠損 {t.after.missing}件</small>
                </td>
                <td>
                  {t.before.total != null && t.after.total != null
                    ? num(t.after.total - t.before.total)
                    : "—"}
                </td>
                <td>
                  {t.mapped
                    ? `${t.incoming.zero} / ${t.incoming.missing}`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="sales-muted">
        今回の取込対象だけの既知値の合計です。欠損のある合計は部分集計です。列未指定は既存値を保持。Excelヨミと手入力ヨミは別で、入力済みの週次ヨミを優先します。
      </p>
      {q.issues.length > 0 && (
        <details>
          <summary>確認候補（最大50件）</summary>
          <ul>
            {q.issues.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </details>
      )}
      {q.changes.length > 0 && (
        <details>
          <summary>変更されるアカウント（最大30件）</summary>
          <ul>
            {q.changes.map((c) => (
              <li key={c.accountId}>
                {c.name}（{c.accountId}） ·{" "}
                {c.created
                  ? "新規"
                  : c.fields.map((k) => labels[k] || k).join("、")}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p>
        {preview.mappingApplied
          ? "同じ見出しの保存済み列対応を適用しました。"
          : "列対応を保存すると、同じ見出し・列順のファイルで再利用できます。"}
      </p>
      {admin && (
        <button
          className="button"
          disabled={busy || disabled || preview.errors.length > 0}
          onClick={async () => {
            setBusy(true);
            setMessage("");
            try {
              await api("/sales/imports/mapping", "POST", {
                headers: preview.headers,
                mapping,
              });
              setMessage("列対応を保存しました。");
            } catch (e) {
              setMessage((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          この列対応を保存
        </button>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
type Usage = {
  startedAt: string;
  cacheHits: number;
  reads: number;
  returnedRows: number;
  database: null | {
    day: string;
    rowsRead: number;
    rowsWritten: number;
    bytes: number;
  };
};
export function StorageUsage({ api }: { api: GoogleApi }) {
  const [usage, setUsage] = useState<Usage | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="panel improvement-usage">
      <h2>DB使用状況</h2>
      <p>表示ボタンで取得します。定期的な全件集計は行いません。</p>
      <button
        className="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            setUsage(await api("/operations/usage"));
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        使用状況を確認・更新
      </button>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {usage && (
        <>
          <dl className="improvement-stats">
            <div>
              <dt>同一処理内で再利用した読込</dt>
              <dd>{num(usage.cacheHits)}回</dd>
            </div>
            <div>
              <dt>ストア読込回数</dt>
              <dd>{num(usage.reads)}回</dd>
            </div>
            <div>
              <dt>読込で返ったレコード</dt>
              <dd>{num(usage.returnedRows)}件</dd>
            </div>
          </dl>
          {usage.database && (
            <dl className="improvement-stats">
              <div>
                <dt>SQL読込行数（観測分）</dt>
                <dd>{num(usage.database.rowsRead)}</dd>
              </div>
              <div>
                <dt>SQL書込行数（観測分）</dt>
                <dd>{num(usage.database.rowsWritten)}</dd>
              </div>
              <div>
                <dt>DB保存容量</dt>
                <dd>{num(usage.database.bytes / 1024 / 1024)} MiB</dd>
              </div>
            </dl>
          )}
          <p className="sales-muted">
            観測開始：{new Date(usage.startedAt).toLocaleString("ja-JP")}
            。再起動でカウンターはリセットされます。CloudflareのSQL行数はこの稼働インスタンスで観測したUTC日付{" "}
            {usage.database?.day || "—"}{" "}
            の分です。起動前・他環境・SQL以外の使用量を含まないため、無料枠の残量ではありません。ストアの返却件数とSQLが走査した行数も異なります。
          </p>
          <a
            href="https://dash.cloudflare.com/"
            target="_blank"
            rel="noreferrer"
          >
            Cloudflare管理画面で契約全体の使用量を確認
          </a>
        </>
      )}
    </section>
  );
}
