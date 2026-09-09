import { useEffect, useRef, useState } from "react";
import type { GoogleApi } from "./GoogleWorkflows";
import type { SalesAccount, SalesMinute } from "./sales-types";
type Candidate = {
  id: string;
  name: string;
  path: string;
  match: string;
  modifiedTime: string;
  existingId: string;
  url: string;
};
export function DriveCollection({
  api,
  accounts,
  onSaved,
}: {
  api: GoogleApi;
  accounts: SalesAccount[];
  onSaved: (m: SalesMinute) => Promise<void>;
}) {
  const [roots, setRoots] = useState(""),
    [accountId, setAccountId] = useState(""),
    [aliases, setAliases] = useState("");
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
      accountId,
      aliases,
    });
    setFiles([]);
    setSelected("");
    setWarnings([]);
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
        <p className="sales-muted">
          文書名と親フォルダー名を照合します。同じ会社の別サービスが混在する場合は、取り込み前に元資料を確認してください。本文内だけにある名称とショートカットは対象外です。
        </p>
        <button
          type="button"
          className="button primary"
          disabled={!accountId || !roots.trim()}
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
          検索を中断
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
      {files.length > 0 && (
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
