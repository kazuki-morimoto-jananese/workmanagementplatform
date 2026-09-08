import { useEffect, useState, type ReactNode } from "react";
type Column = { label: string; index: number };
type Block = {
  labelRange?: string;
  id: string;
  title: string;
  range: string;
  spreadsheetId?: string;
  fixed?: boolean;
  groups: string[];
  columns: Column[];
  rows?: { group: string; cells: string[] }[];
};
type Settings = {
  month: string;
  version: number;
  spreadsheetId: string;
  enabled: boolean;
  syncTime: string;
  blocks: Block[];
  lastError?: string;
  lastSuccessAt?: string;
  useMyGoogle?: boolean;
};
type Snapshot = { readAt: string; month: string; blocks: Block[] };
type Payload = {
  settings: Settings;
  snapshot: Snapshot | null;
  history: { id: string; readAt: string }[];
};
const groups = ["総合企画EPG", "総合企画G", "CSG", "RDG", "RAG"];
function DashboardContent({
  api,
  month,
  admin,
  children,
  directory,
}: {
  api: <T = any>(path: string, method?: string, body?: unknown) => Promise<T>;
  month: string;
  admin: boolean;
  children: ReactNode;
  directory?: ReactNode;
}) {
  const [payload, setPayload] = useState<Payload | null>(null),
    [draft, setDraft] = useState<Settings | null>(null);
  const [group, setGroup] = useState("legacy"),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [preview, setPreview] = useState<Snapshot | null>(null);
  const load = async () => {
    const p = await api<Payload>("/sales/dashboard?month=" + month);
    setPayload(p);
    setDraft(p.settings);
  };
  useEffect(() => {
    let active = true;
    setPayload(null);
    setDraft(null);
    setPreview(null);
    setError("");
    api<Payload>("/sales/dashboard?month=" + month)
      .then((p) => {
        if (active) {
          setPayload(p);
          setDraft(p.settings);
          if (p.snapshot) setGroup(groups[0]);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [month]);
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
  const changeBlock = (index: number, patch: Partial<Block>) => {
    if (draft) {
      setDraft({
        ...draft,
        blocks: draft.blocks.map((b, i) =>
          i === index ? { ...b, ...patch } : b,
        ),
      });
      setPreview(null);
    }
  };
  const table = (block?: Block, filter = "") => {
    const rows =
      block?.rows?.filter((r) => !filter || r.group === filter) || [];
    return rows.length ? (
      <div className="sales-table-scroll">
        <table className="sales-table">
          <thead>
            <tr>
              {block!.columns.map((c, i) => (
                <th key={i}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={i}
                className={
                  block?.fixed && /合計|平均/.test(r.cells[0])
                    ? "dashboard-total"
                    : undefined
                }
              >
                {r.cells.map((v, j) =>
                  j === 0 ? (
                    <th key={j}>{v || "—"}</th>
                  ) : (
                    <td
                      key={j}
                      className={
                        block?.columns[j]?.label === "昨日時点実績"
                          ? "dashboard-key-number"
                          : block?.columns[j]?.label === "Gトレンド"
                            ? "dashboard-trend"
                            : undefined
                      }
                    >
                      {v || "—"}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <p className="sales-muted">
        この月・グループのデータはまだ取得されていません。
      </p>
    );
  };
  const snapshot = payload?.snapshot;
  return (
    <>
      <section
        className="panel sales-organization"
        aria-label="固定KGIサマリー"
      >
        <div className="section-heading">
          <h2>組織別営業サマリー · {month}</h2>
          {admin && (
            <button className="button" onClick={() => setEditing(!editing)}>
              ダッシュボードを設定
            </button>
          )}
        </div>
        <p>
          全組織の固定サマリーです。下のグループViewを切り替えても表示は変わりません。合計・社単・前月比はスプシの計算済み数値です。
        </p>
        {table(snapshot?.blocks.find((b) => b.fixed))}
        <p className="sales-muted">
          {snapshot
            ? `取得日時：${new Date(snapshot.readAt).toLocaleString("ja-JP")}（実績の基準日は元シートに従います）`
            : "サマリー専用のスプシ接続を設定すると表示されます。既存のヨミ連携とは独立しています。"}
        </p>
        {payload?.settings.lastError && (
          <p role="alert" className="form-error">
            最新の同期に失敗：{payload.settings.lastError}{" "}
            最後に成功した値を表示しています。
          </p>
        )}
      </section>
      {directory}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {editing && draft && admin && (
        <section
          className="panel sales-organization"
          aria-label="ダッシュボード設定"
        >
          <h2>{month} の接続・表示設定</h2>
          <p>
            対象月ごとに保存します。取得範囲は見出し行を含めます。行名を別範囲にする場合、固定表は1列、その他は担当・グループの2列を指定し、数値と同じ開始・終了行にします。列位置は行名＋数値を連結した左端から1です。
          </p>
          <fieldset disabled={busy} className="dashboard-settings">
            <label>
              共通のスプレッドシートURL / ID
              <input
                value={draft.spreadsheetId}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    spreadsheetId:
                      e.target.value.match(/\/d\/([\w-]+)/)?.[1] ||
                      e.target.value.trim(),
                  })
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={!!draft.useMyGoogle}
                onChange={(e) =>
                  setDraft({ ...draft, useMyGoogle: e.target.checked })
                }
              />
              接続者を自分のGoogleアカウントに変更する
            </label>
            <p>
              初回は設定した管理者の本人認証で読み取ります。取得結果は社内メンバーで共有されます。
            </p>
            <label>
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) =>
                  setDraft({ ...draft, enabled: e.target.checked })
                }
              />
              日次同期を有効にする（この月の取得範囲を継続して同期）
            </label>
            <label>
              同期時刻（日本時間）
              <input
                type="time"
                value={draft.syncTime}
                onChange={(e) =>
                  setDraft({ ...draft, syncTime: e.target.value })
                }
              />
            </label>
            {draft.blocks.map((b, i) => (
              <details
                key={b.id}
                open={i === 0}
                className="dashboard-block-settings"
              >
                <summary>
                  {b.title}
                  {b.fixed ? " · 固定" : ""}
                </summary>
                {!b.fixed && (
                  <label>
                    指標名
                    <input
                      value={b.title}
                      onChange={(e) =>
                        changeBlock(i, { title: e.target.value })
                      }
                    />
                  </label>
                )}
                <label>
                  数値の取得範囲（空欄は取得しない）
                  <input
                    placeholder="'★サマリ（上期）'!A138:ZZ171"
                    value={b.range}
                    onChange={(e) => changeBlock(i, { range: e.target.value })}
                  />
                </label>
                <label>
                  行名の別範囲（任意）
                  <input
                    value={b.labelRange || ""}
                    onChange={(e) =>
                      changeBlock(i, { labelRange: e.target.value })
                    }
                    placeholder="'★サマリ（上期）'!A138:B171"
                  />
                </label>
                <label>
                  この指標だけ別のスプレッドシートURL / ID（任意）
                  <input
                    value={b.spreadsheetId || ""}
                    onChange={(e) =>
                      changeBlock(i, {
                        spreadsheetId:
                          e.target.value.match(/\/d\/([\w-]+)/)?.[1] ||
                          e.target.value.trim(),
                      })
                    }
                  />
                </label>
                {!b.fixed && (
                  <div>
                    <p>表示するグループ</p>
                    {groups.map((g) => (
                      <label key={g}>
                        <input
                          type="checkbox"
                          checked={b.groups.includes(g)}
                          onChange={(e) =>
                            changeBlock(i, {
                              groups: e.target.checked
                                ? [...b.groups, g]
                                : b.groups.filter((x) => x !== g),
                            })
                          }
                        />
                        {g}
                      </label>
                    ))}
                  </div>
                )}
                <div className="dashboard-column-settings">
                  {b.columns.map((c, j) => (
                    <label key={j}>
                      {b.fixed || j < 2 ? (
                        c.label
                      ) : (
                        <input
                          aria-label="表示項目名"
                          value={c.label}
                          onChange={(e) =>
                            changeBlock(i, {
                              columns: b.columns.map((x, n) =>
                                n === j ? { ...x, label: e.target.value } : x,
                              ),
                            })
                          }
                        />
                      )}
                      <input
                        type="number"
                        aria-label={`${b.title} ${c.label}の列位置`}
                        min={1}
                        max={1001}
                        value={c.index + 1}
                        onChange={(e) =>
                          changeBlock(i, {
                            columns: b.columns.map((x, n) =>
                              n === j
                                ? { ...x, index: Number(e.target.value) - 1 }
                                : x,
                            ),
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
                {!b.fixed && (
                  <>
                    <button
                      className="button"
                      onClick={() =>
                        changeBlock(i, {
                          columns: [
                            ...b.columns,
                            {
                              label: "追加指標",
                              index:
                                Math.max(...b.columns.map((c) => c.index)) + 1,
                            },
                          ],
                        })
                      }
                    >
                      表示列を追加
                    </button>
                    <button
                      className="button"
                      disabled={b.columns.length <= 3}
                      onClick={() =>
                        changeBlock(i, { columns: b.columns.slice(0, -1) })
                      }
                    >
                      末尾の表示列を削除
                    </button>
                    <button
                      className="button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          blocks: draft.blocks.filter((_, n) => n !== i),
                        })
                      }
                    >
                      この指標を削除
                    </button>
                    {i > 1 && (
                      <button
                        className="button"
                        onClick={() => {
                          const blocks = [...draft.blocks];
                          [blocks[i - 1], blocks[i]] = [
                            blocks[i],
                            blocks[i - 1],
                          ];
                          setDraft({ ...draft, blocks });
                        }}
                      >
                        上へ移動
                      </button>
                    )}
                  </>
                )}
              </details>
            ))}
            <button
              className="button"
              onClick={() =>
                setDraft({
                  ...draft,
                  blocks: [
                    ...draft.blocks,
                    {
                      id: crypto.randomUUID(),
                      title: "新しいKPI",
                      range: "",
                      groups: [group === "legacy" ? groups[0] : group],
                      columns: [
                        "担当",
                        "グループ",
                        "目標",
                        "実績",
                        "達成率",
                      ].map((label, index) => ({ label, index })),
                    },
                  ],
                })
              }
            >
              指標を追加
            </button>
            <button
              className="button primary"
              onClick={() =>
                run(async () => {
                  await api("/sales/dashboard/settings", "POST", draft);
                  await load();
                  setPreview(null);
                  setMessage(
                    "設定を保存しました。プレビューで列と対象月を確認してください。",
                  );
                })
              }
            >
              設定を保存
            </button>
            <button
              className="button"
              onClick={() =>
                run(async () => {
                  setPreview(
                    await api("/sales/dashboard/preview", "POST", { month }),
                  );
                  setMessage(
                    "保存済み設定でプレビューしました。数値はまだ保存していません。",
                  );
                })
              }
            >
              保存済み設定をプレビュー
            </button>
            <button
              className="button"
              onClick={() =>
                run(async () => {
                  await api("/sales/dashboard/sync", "POST", { month });
                  await load();
                  setPreview(null);
                  setMessage(
                    "ダッシュボードを同期しました。ヨミ・個人目標は変更していません。",
                  );
                })
              }
            >
              今すぐ同期
            </button>
          </fieldset>
          {preview && (
            <div>
              <h3>取込プレビュー · {preview.month}</h3>
              {preview.blocks.map((b) => (
                <section key={b.id}>
                  <h4>
                    {b.title} · {b.rows?.length}行
                  </h4>
                  {table(b)}
                </section>
              ))}
            </div>
          )}
          <details>
            <summary>同期履歴（直近30回）</summary>
            {payload?.history.map((h) => (
              <p key={h.id}>{new Date(h.readAt).toLocaleString("ja-JP")}</p>
            ))}
          </details>
        </section>
      )}
      <section className="panel sales-organization" aria-label="グループView">
        <label>
          グループView
          <select value={group} onChange={(e) => setGroup(e.target.value)}>
            {groups.map((g) => (
              <option key={g}>{g}</option>
            ))}
            <option value="legacy">従来の個人目標・ヨミ・タスク</option>
          </select>
        </label>
        <p>
          この下の指標をグループ別に切り替えます。表示設定は管理者が保存し、メンバー全員で共有します。
        </p>
      </section>
      {group === "legacy" ? (
        children
      ) : (
        <div>
          {(payload?.settings.blocks || [])
            .filter((b) => !b.fixed && b.groups.includes(group))
            .map((b) => (
              <section className="panel sales-organization" key={b.id}>
                <h2>
                  {b.title} · {group} · {month}
                </h2>
                {table(
                  snapshot?.blocks.find((x) => x.id === b.id),
                  group,
                )}
              </section>
            ))}
        </div>
      )}
    </>
  );
}
export function GroupDashboard(
  props: Parameters<typeof DashboardContent>[0] & { demo?: boolean },
) {
  return props.demo ? <>{props.children}</> : <DashboardContent {...props} />;
}
