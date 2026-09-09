import { useEffect, useState } from "react";
import { DriveFilePicker } from "./GoogleWorkflows";
type Api = <T = any>(
  path: string,
  method?: string,
  body?: unknown,
) => Promise<T>;
type Member = { id: string; name: string };
type Source = {
  version: number;
  month: string;
  spreadsheetId: string;
  infoRange: string;
  monthRange: string;
  enabled: boolean;
  syncTime: string;
  ownerLinks: Record<string, string>;
  useMyGoogle?: boolean;
  lastSuccessAt?: string;
  lastError?: string;
};
type Row = {
  accountId: string;
  name: string;
  [key: string]: string | number | boolean | null;
};
type Result = {
  rows: Row[];
  count: number;
  total: number;
  mine: number;
  owners: string[];
  page: number;
  totalPages: number;
  source: Source | null;
  history: { id: string; createdAt: string; status: string; count?: number }[];
};
const columns = [
  ["accountId", "アカウントID"],
  ["name", "アカウント名"],
  ["agency", "代理店名"],
  ["channel", "商流経路"],
  ["mediaFlag", "個社・求人メディア"],
  ["industryMajor", "業種・大分類"],
  ["industryMinor", "業種・中分類"],
  ["category", "カテゴリ"],
  ["group", "当月担当Ｇ"],
  ["ownerName", "当月担当者"],
  ["monthActual", "当月累計実績（前日まで）"],
  ["yesterdayActual", "前日実績"],
  ["gTrend", "Gトレンド"],
  ["budget", "アカウント月予算"],
];
const blank = (month: string): Source => ({
  version: 0,
  month,
  spreadsheetId: "",
  infoRange: "",
  monthRange: "",
  enabled: false,
  syncTime: "06:00",
  ownerLinks: {},
});
export function AccountDirectory({
  api,
  month,
  admin,
  members,
}: {
  api: Api;
  month: string;
  admin: boolean;
  members: Member[];
}) {
  const [result, setResult] = useState<Result | null>(null),
    [owner, setOwner] = useState("me"),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0);
  const [draft, setDraft] = useState<Source | null>(null),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [preview, setPreview] = useState<{
      count: number;
      errors: string[];
      errorCount: number;
      owners: string[];
    } | null>(null);
  useEffect(() => {
    setPage(1);
  }, [month, owner, search]);
  useEffect(() => {
    let current = true;
    setLoading(true);
    const timer = setTimeout(() => {
      api<Result>(
        "/sales/directory?" +
          new URLSearchParams({ month, owner, search, page: String(page) }),
      )
        .then((r) => {
          if (current) {
            setResult(r);
            setDraft((d) =>
              d && d.version === (r.source?.version || 0)
                ? d
                : r.source || blank(month),
            );
            setError("");
          }
        })
        .catch((e) => {
          if (current) setError(e.message);
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    }, 180);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [month, owner, search, page, revision]);
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await f();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const refresh = () => setRevision((v) => v + 1);
  const change = (patch: Partial<Source>) => {
    if (draft) {
      setDraft({ ...draft, ...patch });
      setPreview(null);
    }
  };
  return (
    <section
      className="panel sales-organization account-directory"
      aria-label="アカウントマスタ"
    >
      <div className="section-heading">
        <h2>担当アカウント · {month}</h2>
        <div>
          <button className="button" onClick={refresh} disabled={loading}>
            表示を更新
          </button>
          {admin && (
            <button className="button" onClick={() => setEditing(!editing)}>
              マスタ連携を設定
            </button>
          )}
        </div>
      </div>
      <p>
        初期表示は自分の担当です。他の担当者・全件にも切り替えられます。金額は円単位で、選択月のスプシ実績です。空欄は「—」、0円は「0」で表示します。
      </p>
      <div className="directory-filters">
        <label>
          表示する担当者
          <select value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="me">自分の担当（{result?.mine ?? 0}件）</option>
            <option value="all">すべての担当者</option>
            {result?.owners.map((o) => (
              <option value={o} key={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        <label>
          アカウントを検索
          <input
            type="search"
            placeholder="ID・名前・代理店・業種"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <span aria-live="polite">
          {loading
            ? "読み込み中…"
            : `${result?.count ?? 0}件 / 当月マスタ ${result?.total ?? 0}件`}
        </span>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {result?.source?.lastError && (
        <p className="form-error">
          最新の同期エラー：{result.source.lastError}{" "}
          前回の成功データを保持しています。
        </p>
      )}
      {result?.source?.lastSuccessAt && (
        <p className="sales-muted">
          最終同期：
          {new Date(result.source.lastSuccessAt).toLocaleString("ja-JP")} ·
          日次同期{" "}
          {result.source.enabled
            ? result.source.syncTime + "（日本時間）"
            : "無効"}{" "}
          · 接続の対象月 {result.source.month}
        </p>
      )}
      <div
        className="directory-table-scroll"
        tabIndex={0}
        aria-label="担当アカウント一覧・横スクロール可能"
        aria-busy={loading}
      >
        <table className="directory-table">
          <thead>
            <tr>
              {columns.map(([k, label]) => (
                <th scope="col" key={k}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result?.rows.map((r) => (
              <tr key={r.accountId}>
                {columns.map(([k]) => (
                  <td key={k} title={r[k] == null ? "未入力" : String(r[k])}>
                    {typeof r[k] === "number"
                      ? Number(r[k]).toLocaleString("ja-JP", {
                          maximumFractionDigits: 2,
                        })
                      : r[k] == null || r[k] === ""
                        ? "—"
                        : String(r[k])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && !result?.rows.length && (
        <p className="sales-muted">
          {owner === "me"
            ? "自分に紐づいたアカウントがありません。担当者を選択するか、管理者が担当者名とメンバーを紐づけてください。"
            : "この条件に該当するアカウントはありません。"}
        </p>
      )}
      <div className="directory-pagination">
        <button
          className="button"
          disabled={loading || !result || result.page <= 1}
          onClick={() => setPage(Math.max(1, (result?.page || 1) - 1))}
        >
          前へ
        </button>
        <span>
          {result?.page || 1} / {result?.totalPages || 1} ページ · 50件ずつ表示
        </span>
        <button
          className="button"
          disabled={loading || !result || result.page >= result.totalPages}
          onClick={() => setPage((result?.page || 1) + 1)}
        >
          次へ
        </button>
      </div>
      {editing && admin && draft && (
        <div className="directory-connection">
          <h3>アカウントマスタ専用の接続</h3>
          <p>
            基本情報と月別金額を別範囲で取得します。見出し行を含め、終わりの行番号は空欄にしてください。新規行も取得します。対象月と元シートの月見出しを検証します。
          </p>
          <fieldset className="dashboard-settings" disabled={busy}>
            <DriveFilePicker
              api={api}
              type="spreadsheet"
              onSelect={(f) => {
                setDraft({ ...draft, spreadsheetId: f.id });
                setPreview(null);
              }}
            />
            <label>
              対象月
              <input
                type="month"
                value={draft.month}
                onChange={(e) => change({ month: e.target.value })}
              />
            </label>
            <label>
              スプレッドシートURL / ID
              <input
                value={draft.spreadsheetId}
                onChange={(e) =>
                  change({
                    spreadsheetId:
                      e.target.value.match(/\/d\/([\w-]+)/)?.[1] ||
                      e.target.value.trim(),
                  })
                }
              />
            </label>
            <label>
              基本情報の範囲
              <input
                placeholder="'ヨミ表（売上）'!A4:M"
                value={draft.infoRange}
                onChange={(e) => change({ infoRange: e.target.value })}
              />
            </label>
            <label>
              対象月の金額の範囲
              <input
                placeholder="'ヨミ表（売上）'!AW4:AZ"
                value={draft.monthRange}
                onChange={(e) => change({ monthRange: e.target.value })}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={!!draft.useMyGoogle}
                onChange={(e) => change({ useMyGoogle: e.target.checked })}
              />
              接続者を自分のGoogleアカウントに変更
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => change({ enabled: e.target.checked })}
              />
              日次同期を有効にする
            </label>
            <label>
              同期時刻（日本時間）
              <input
                type="time"
                value={draft.syncTime}
                onChange={(e) => change({ syncTime: e.target.value })}
              />
            </label>
            <details>
              <summary>担当者名とWorknestメンバーの紐付け</summary>
              <p>
                同じ氏名は空白を除いて照合します。略称などで一致しない場合だけ指定してください。複数の同姓同名は自動照合しません。
              </p>
              {[
                ...new Set([
                  ...(preview?.owners || result?.owners || []),
                  ...Object.keys(draft.ownerLinks),
                ]),
              ]
                .sort()
                .map((o) => (
                  <label key={o}>
                    {o}
                    <select
                      value={draft.ownerLinks[o] || ""}
                      onChange={(e) => {
                        const links = { ...draft.ownerLinks };
                        if (e.target.value) links[o] = e.target.value;
                        else delete links[o];
                        change({ ownerLinks: links });
                      }}
                    >
                      <option value="">氏名による自動照合</option>
                      {members.map((m) => (
                        <option value={m.id} key={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
            </details>
            <button
              className="button primary"
              onClick={() =>
                run(async () => {
                  const s = await api<Source>(
                    "/sales/directory/settings",
                    "POST",
                    draft,
                  );
                  setDraft(s);
                  setPreview(null);
                  refresh();
                  setMessage(
                    "設定を保存しました。プレビューで件数と列を確認できます。",
                  );
                })
              }
            >
              マスタ接続を保存
            </button>
            <button
              className="button"
              onClick={() =>
                run(async () => {
                  const p = await api("/sales/directory/preview", "POST", {});
                  setPreview(p);
                  setMessage(
                    `${p.count}件を確認しました。まだ取り込んでいません。`,
                  );
                })
              }
            >
              マスタをプレビュー
            </button>
            <button
              className="button"
              onClick={() =>
                run(async () => {
                  const r = await api("/sales/directory/sync", "POST", {});
                  refresh();
                  setMessage(
                    `${r.count}件を同期しました。ヨミ・議事録は保持しています。`,
                  );
                })
              }
            >
              マスタを今すぐ同期
            </button>
          </fieldset>
          {preview && (
            <p role="status">
              {preview.count}件・エラー{preview.errorCount}件
              {preview.errors.length > 0 && (
                <span className="form-error">{preview.errors.join(" / ")}</span>
              )}
            </p>
          )}
          <details>
            <summary>同期履歴</summary>
            {result?.history.map((h) => (
              <p key={h.id}>
                {new Date(h.createdAt).toLocaleString("ja-JP")} ·{" "}
                {h.status === "success" ? `${h.count}件を同期` : "失敗"}
              </p>
            ))}
          </details>
        </div>
      )}
    </section>
  );
}
