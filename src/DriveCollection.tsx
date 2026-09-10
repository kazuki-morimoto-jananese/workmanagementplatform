import { useEffect, useRef, useState } from "react";
import type { GoogleApi } from "./GoogleWorkflows";
import type { SalesAccount, SalesMinute } from "./sales-types";
import { accountInOwnerFilter } from "./account-ownership";
type Candidate = {
  id: string;
  name: string;
  path: string;
  match: string;
  modifiedTime: string;
  existingId: string;
  url: string;
  accounts?: {
    accountId: string;
    accountName: string;
    match: string;
    existingId: string;
  }[];
};
export function DriveCollection({
  api,
  accounts,
  onSaved,
  onBatchSaved,
  user,
  members,
}: {
  api: GoogleApi;
  accounts: SalesAccount[];
  onSaved: (m: SalesMinute) => Promise<void>;
  onBatchSaved: () => Promise<void>;
  user: { id: string; name: string };
  members: { id: string; name: string }[];
}) {
  const [mode, setMode] = useState("mine");
  const [owner, setOwner] = useState("me");
  const [chosen, setChosen] = useState<string[]>([]);
  const [accountSearch, setAccountSearch] = useState("");
  const [imports, setImports] = useState<
    Record<
      string,
      { checked: boolean; accountId: string; date: string; error?: string }
    >
  >({});
  const clearResults = () => {
    setFiles([]);
    setSelected("");
    setImports({});
    setProgress("");
  };
  const [roots, setRoots] = useState(""),
    [accountId, setAccountId] = useState(""),
    [aliases, setAliases] = useState("");
  const targets =
    mode === "single"
      ? accounts.filter((a) => a.id === accountId)
      : mode === "selected"
        ? accounts.filter((a) => chosen.includes(a.id))
        : accounts.filter((a) =>
            accountInOwnerFilter(
              a,
              mode === "mine" ? "me" : owner,
              user,
              members,
            ),
          );
  const [files, setFiles] = useState<Candidate[]>([]),
    [selected, setSelected] = useState(""),
    [date, setDate] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState(""),
    [warnings, setWarnings] = useState<string[]>([]);
  const stop = useRef(false),
    loaded = useRef(false);
  useEffect(
    () => () => {
      stop.current = true;
    },
    [],
  );
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function search() {
    const ids = roots
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        if (/^[\w-]{1,250}$/.test(s)) return s;
        const u = new URL(s);
        if (u.hostname !== "drive.google.com")
          throw new Error("Google DriveのフォルダーURLを入力してください。");
        const m = u.pathname.match(
          /^\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)\/?$/,
        );
        if (!m) throw new Error("フォルダーURLを確認してください。");
        return m[1];
      });
    await api("/google/collection/settings", "POST", { roots: ids });
    const start = await api("/google/collection/start", "POST", {
      ...(mode === "single"
        ? { accountId }
        : { accountIds: targets.map((a) => a.id) }),
      aliases,
    });
    setFiles([]);
    setSelected("");
    setWarnings([]);
    setImports({});
    stop.current = false;
    let done = false;
    while (!done && !stop.current) {
      const result = await api("/google/collection/next", "POST", {
        scanId: start.scanId,
      });
      setFiles((prev) => {
        const found = new Set(prev.map((f) => f.id));
        return [
          ...prev,
          ...result.files.filter((f: Candidate) => !found.has(f.id)),
        ];
      });
      setImports((prev) => {
        const next = { ...prev };
        for (const f of result.files as Candidate[]) {
          if (next[f.id]) continue;
          const options = f.accounts || [];
          // Dates are proposed only from an explicit date in the document title.
          const match = f.name.match(
            /(20\d{2})[\/年.-](\d{1,2})[\/月.-](\d{1,2})/,
          );
          const date = match
            ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`
            : "";
          next[f.id] = {
            checked: false,
            accountId: options.length === 1 ? options[0].accountId : "",
            date:
              date &&
              Number.isFinite(Date.parse(date)) &&
              new Date(date).toISOString().slice(0, 10) === date
                ? date
                : "",
          };
        }
        return next;
      });
      setWarnings(result.warnings);
      done = result.done;
      setProgress(
        `${result.visited}ページ確認済み · 未確認フォルダー ${result.pending}件${done ? " · 検索終了" : ""}`,
      );
    }
    if (stop.current && !done)
      setProgress((p) => p + " · 中断（再検索できます）");
  }
  return (
    <details
      className="panel google-workflow-panel"
      onToggle={(e) => {
        if (e.currentTarget.open && !loaded.current) {
          loaded.current = true;
          void run(async () => {
            const s = await api("/google/collection/settings");
            setRoots(
              s.roots
                .map(
                  (id: string) =>
                    `https://drive.google.com/drive/folders/${id}`,
                )
                .join("\n"),
            );
          });
        }
      }}
    >
      <summary>顧客のフォルダーから議事録を収集</summary>
      <p>
        検索結果は自分だけに表示します。選んで取り込んだ議事録は、ワークスペース全員が閲覧できます。
      </p>
      <fieldset
        disabled={busy}
        style={{ border: 0, padding: 0, display: "grid", gap: 12, minWidth: 0 }}
      >
        <label>
          収集する範囲
          <select
            aria-label="収集する範囲"
            value={mode}
            onChange={(e) => {
              setMode(e.target.value);
              clearResults();
            }}
          >
            <option value="mine">自分の担当アカウントすべて</option>
            <option value="owner">担当者を指定</option>
            <option value="selected">アカウントを複数選択</option>
            <option value="single">アカウントを個別指定</option>
          </select>
        </label>
        {mode === "owner" && (
          <label>
            収集する担当者
            <select
              aria-label="収集する担当者"
              value={owner}
              onChange={(e) => {
                setOwner(e.target.value);
                clearResults();
              }}
            >
              <option value="me">自分</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
              {[
                ...new Set(
                  accounts
                    .filter((a) => !a.ownerId && a.ownerName)
                    .map((a) => a.ownerName),
                ),
              ].map((name) => (
                <option key={name} value={"name:" + name}>
                  {name}（マスタ担当名）
                </option>
              ))}
            </select>
          </label>
        )}
        {mode === "selected" && (
          <div>
            <label>
              収集アカウントを検索
              <input
                type="search"
                value={accountSearch}
                onChange={(e) => setAccountSearch(e.target.value)}
              />
            </label>
            <div className="collection-account-choices">
              {accounts
                .filter((a) =>
                  (a.name + a.id)
                    .normalize("NFKC")
                    .toLowerCase()
                    .includes(accountSearch.normalize("NFKC").toLowerCase()),
                )
                .map((a) => (
                  <label key={a.id} className="check-label">
                    <input
                      type="checkbox"
                      checked={chosen.includes(a.id)}
                      onChange={(e) => {
                        setChosen((prev) =>
                          e.target.checked
                            ? [...prev, a.id]
                            : prev.filter((id) => id !== a.id),
                        );
                        clearResults();
                      }}
                    />
                    {a.name}
                  </label>
                ))}
            </div>
          </div>
        )}
        <p>
          対象 {targets.length}{" "}
          アカウント（1回500件まで）。担当者は現在のアカウントマスタに基づきます。
        </p>
        <label>
          検索元フォルダー（1行に1URL・10件まで）
          <textarea
            rows={3}
            value={roots}
            onChange={(e) => {
              setRoots(e.target.value);
              setFiles([]);
            }}
          />
        </label>
        {mode === "single" && (
          <label>
            議事録を収集するアカウント
            <select
              aria-label="議事録を収集するアカウント"
              value={accountId}
              onChange={(e) => {
                setAccountId(e.target.value);
                setFiles([]);
                setSelected("");
              }}
            >
              <option value="">アカウントを選択</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {mode === "single" && (
          <label>
            今回の検索で使う別名（任意・1行に1名称）
            <textarea
              rows={2}
              value={aliases}
              onChange={(e) => {
                setAliases(e.target.value);
                setFiles([]);
              }}
              placeholder="フォルダーで使われている会社名・サービス名"
            />
          </label>
        )}
        <p className="sales-muted">
          文書名と親フォルダー名を照合します。同じ会社の別サービスが混在する場合は、取り込み前に元資料を確認してください。本文内だけにある名称とショートカットは対象外です。
        </p>
        <button
          type="button"
          className="button primary"
          disabled={!targets.length || targets.length > 500 || !roots.trim()}
          onClick={() => void run(search)}
        >
          保存して候補を検索
        </button>
      </fieldset>
      {busy && (
        <button
          type="button"
          className="button"
          onClick={() => {
            stop.current = true;
          }}
        >
          処理を中断
        </button>
      )}
      <p role="status">
        {progress}
        {files.length ? ` · 候補 ${files.length}件` : ""}
      </p>
      {warnings.length > 0 && (
        <details>
          <summary>
            確認できなかった範囲・注意事項（{warnings.length}件）
          </summary>
          {warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </details>
      )}
      {mode !== "single" && files.length > 0 && (
        <div className="collection-batch">
          <h3>取り込む議事録を確認</h3>
          <p>
            アカウントと会議日を確認して選択してください。タイトルから読み取れた日付は候補です。登録済みの文書は除外します。要約は取り込み後に実行できます。
          </p>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() =>
              setImports((prev) =>
                Object.fromEntries(
                  Object.entries(prev).map(([id, v]) => [
                    id,
                    {
                      ...v,
                      checked:
                        !!v.accountId &&
                        !!v.date &&
                        !files
                          .find((f) => f.id === id)
                          ?.accounts?.find((a) => a.accountId === v.accountId)
                          ?.existingId,
                    },
                  ]),
                ),
              )
            }
          >
            アカウント・日付がある未登録分をすべて選択
          </button>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() =>
              setImports((prev) =>
                Object.fromEntries(
                  Object.entries(prev).map(([id, v]) => [
                    id,
                    { ...v, checked: false },
                  ]),
                ),
              )
            }
          >
            選択を解除
          </button>
          {files.map((f) => {
            const v = imports[f.id];
            if (!v) return null;
            const existing = f.accounts?.find(
              (a) => a.accountId === v.accountId,
            )?.existingId;
            const update = (patch: Partial<typeof v>) =>
              setImports((prev) => ({
                ...prev,
                [f.id]: { ...prev[f.id], ...patch },
              }));
            return (
              <fieldset
                key={f.id}
                disabled={busy}
                className="collection-candidate"
              >
                <legend>{f.name}</legend>
                <p>{f.path}</p>
                <a href={f.url} target="_blank" rel="noreferrer">
                  元資料
                </a>
                <label>
                  取り込み先アカウント
                  <select
                    aria-label={`取り込み先 ${f.name}`}
                    value={v.accountId}
                    onChange={(e) =>
                      update({ accountId: e.target.value, checked: false })
                    }
                  >
                    <option value="">複数一致：取り込み先を選択</option>
                    {f.accounts?.map((a) => (
                      <option key={a.accountId} value={a.accountId}>
                        {a.accountName}
                        {a.existingId ? "（登録済み）" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  会議日
                  <input
                    aria-label={`会議日 ${f.name}`}
                    type="date"
                    value={v.date}
                    onChange={(e) =>
                      update({ date: e.target.value, checked: false })
                    }
                  />
                </label>
                <label className="check-label">
                  <input
                    type="checkbox"
                    aria-label={`取り込む ${f.name}`}
                    checked={v.checked && !existing}
                    disabled={!!existing || !v.accountId || !v.date}
                    onChange={(e) => update({ checked: e.target.checked })}
                  />
                  {existing
                    ? "登録済み"
                    : "アカウントと会議日を確認して取り込む"}
                </label>
                {v.error && <p className="form-error">{v.error}</p>}
              </fieldset>
            );
          })}
          <button
            className="button primary"
            disabled={busy || !Object.values(imports).some((v) => v.checked)}
            onClick={() =>
              void run(async () => {
                stop.current = false;
                let success = 0,
                  failed = 0;
                const queue = files.filter(
                  (f) =>
                    imports[f.id]?.checked &&
                    !f.accounts?.find(
                      (a) => a.accountId === imports[f.id].accountId,
                    )?.existingId,
                );
                try {
                  for (const f of queue) {
                    if (stop.current) break;
                    const v = imports[f.id];
                    try {
                      const minute = await api<SalesMinute>(
                        "/sales/minutes",
                        "POST",
                        {
                          accountId: v.accountId,
                          title: f.name,
                          sourceUrl: f.url,
                          importGoogle: true,
                          meetingDate: v.date,
                          targetMonth: v.date.slice(0, 7),
                          autoSummarize: false,
                          autoExtract: false,
                          autoApplyNumbers: false,
                        },
                      );
                      success++;
                      setFiles((prev) =>
                        prev.map((p) =>
                          p.id === f.id
                            ? {
                                ...p,
                                accounts: p.accounts?.map((a) =>
                                  a.accountId === v.accountId
                                    ? { ...a, existingId: minute.id }
                                    : a,
                                ),
                              }
                            : p,
                        ),
                      );
                      setImports((prev) => ({
                        ...prev,
                        [f.id]: { ...prev[f.id], checked: false, error: "" },
                      }));
                    } catch (e) {
                      failed++;
                      setImports((prev) => ({
                        ...prev,
                        [f.id]: { ...prev[f.id], error: (e as Error).message },
                      }));
                      // Avoid repeated requests during provider outages or quota exhaustion.
                      break;
                    }
                    setProgress(`取り込み ${success} / ${queue.length}件`);
                  }
                } finally {
                  if (success) await onBatchSaved();
                  setProgress(
                    `取り込み完了 ${success}件・失敗 ${failed}件・未処理 ${queue.length - success - failed}件`,
                  );
                }
              })
            }
          >
            選択した議事録を一括で共有・取り込み
          </button>
        </div>
      )}
      {mode === "single" && files.length > 0 && (
        <div className="google-file-picker">
          <label>
            取り込む議事録
            <select
              disabled={busy}
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setDate("");
              }}
            >
              <option value="">候補を選択</option>
              {files.map((f) => (
                <option key={f.id} value={f.id} disabled={!!f.existingId}>
                  {f.existingId ? "【登録済み】" : ""}
                  {f.path}
                </option>
              ))}
            </select>
          </label>
          {files
            .filter((f) => f.id === selected)
            .map((f) => (
              <div key={f.id}>
                <p>一致した名称：{f.match}</p>
                <p>{f.path}</p>
                <a href={f.url} target="_blank" rel="noreferrer">
                  元のGoogleドキュメントを確認
                </a>
                <p>
                  文書更新日時：
                  {f.modifiedTime
                    ? new Date(f.modifiedTime).toLocaleString("ja-JP")
                    : "不明"}
                  （会議日とは異なります）
                </p>
              </div>
            ))}
          <label>
            会議日（原文を確認して指定）
            <input
              type="date"
              value={date}
              disabled={busy}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="button primary"
            disabled={busy || !selected || !date}
            onClick={() =>
              void run(async () => {
                const f = files.find((v) => v.id === selected)!;
                const minute = await api<SalesMinute>(
                  "/sales/minutes",
                  "POST",
                  {
                    accountId,
                    title: f.name,
                    sourceUrl: f.url,
                    importGoogle: true,
                    meetingDate: date,
                    targetMonth: date.slice(0, 7),
                    autoSummarize: false,
                    autoExtract: false,
                    autoApplyNumbers: false,
                  },
                );
                setFiles((prev) =>
                  prev.map((v) =>
                    v.id === f.id ? { ...v, existingId: minute.id } : v,
                  ),
                );
                setSelected("");
                await onSaved(minute);
              })
            }
          >
            選択した議事録を全員に共有して取り込む
          </button>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}
