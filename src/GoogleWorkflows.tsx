import { useEffect, useRef, useState } from "react";
import type { SalesAccount, SalesMinute } from "./sales-types";
export type GoogleApi = <T = any>(
  path: string,
  method?: string,
  body?: unknown,
) => Promise<T>;
type FileChoice = {
  id: string;
  name: string;
  url: string;
  modifiedTime: string;
};
export function GooglePermission({
  api,
  capability,
  label,
}: {
  api: GoogleApi;
  capability: string;
  label: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        className="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const r = await api(
              "/google/start",
              "POST",
              capability === "workflows"
                ? {
                    driveSearch: true,
                    documentsWrite: true,
                    calendar: true,
                    sheets: true,
                  }
                : { [capability]: true },
            );
            location.assign(r.url);
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        {label}
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
export function DriveFilePicker({
  api,
  type,
  onSelect,
}: {
  api: GoogleApi;
  type: "document" | "spreadsheet";
  onSelect: (file: FileChoice) => void;
}) {
  const [open, setOpen] = useState(false),
    [q, setQ] = useState(""),
    [files, setFiles] = useState<FileChoice[]>([]),
    [next, setNext] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [allowed, setAllowed] = useState<boolean | null>(null),
    [incomplete, setIncomplete] = useState(false);
  const generation = useRef(0);
  async function search(pageToken = "") {
    const gen = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const r = await api(
        "/google/files?" + new URLSearchParams({ type, q, pageToken }),
      );
      if (gen !== generation.current) return;
      setFiles(pageToken ? [...files, ...r.files] : r.files);
      setNext(r.nextPageToken);
      setIncomplete(r.incomplete);
    } catch (e) {
      if (gen === generation.current) setError((e as Error).message);
    } finally {
      if (gen === generation.current) setBusy(false);
    }
  }
  return (
    <div className="google-file-picker">
      <button
        type="button"
        className="button"
        onClick={async () => {
          setOpen(!open);
          if (!open) {
            try {
              const s = await api("/google/status");
              setAllowed(s.driveSearch);
              if (s.driveSearch) await search();
            } catch (e) {
              setError((e as Error).message);
            }
          }
        }}
      >
        Driveから{type === "document" ? "議事録" : "スプシ"}を選択
      </button>
      {open && (
        <section
          className="google-file-results"
          aria-label="Driveのファイル選択"
        >
          <p>
            本人が閲覧できるファイル名を検索します。選択するまで本文は取り込みません。
          </p>
          {allowed === false && (
            <>
              <p>
                ファイル名・更新日時の検索には、Driveメタデータ閲覧の追加許可が必要です。
              </p>
              <GooglePermission
                api={api}
                capability="driveSearch"
                label="Drive検索を許可して接続"
              />
            </>
          )}
          {allowed && (
            <>
              <div className="google-inline-fields">
                <input
                  aria-label="Driveファイル名"
                  value={q}
                  maxLength={100}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="ファイル名で検索"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void search();
                    }
                  }}
                />
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => void search()}
                >
                  検索
                </button>
              </div>
              <ul>
                {files.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(f);
                        setOpen(false);
                      }}
                    >
                      <strong>{f.name}</strong>
                      <small>
                        {new Date(f.modifiedTime).toLocaleString("ja-JP")}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
              {!files.length && !busy && <p>該当ファイルがありません。</p>}
              {next && (
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => void search(next)}
                >
                  さらに表示
                </button>
              )}
              {incomplete && (
                <p>
                  検索結果が一部に限られています。ファイル名を絞るかURLで指定してください。
                </p>
              )}
            </>
          )}
          {busy && <p role="status">検索中…</p>}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

export function CalendarMinuteFlow({
  api,
  accounts,
  onSaved,
}: {
  api: GoogleApi;
  accounts: SalesAccount[];
  onSaved: (m: SalesMinute) => Promise<void>;
}) {
  const [events, setEvents] = useState<
      { id: string; title: string; start: string }[]
    >([]),
    [selected, setSelected] = useState(""),
    [account, setAccount] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [draft, setDraft] = useState<{
      title: string;
      text: string;
      meetingDate: string;
      calendarEventId: string;
    } | null>(null),
    [message, setMessage] = useState("");
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
  return (
    <details className="panel google-workflow-panel">
      <summary>商談予定から議事録を作成</summary>
      <p>
        今後14日間の予定から商談とアカウントを選びます。保存したひな形はチーム内で共有されます。
      </p>
      <div className="google-inline-fields">
        <GooglePermission
          api={api}
          capability="calendar"
          label="カレンダー閲覧を許可して接続"
        />
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const r = await api("/google/calendar");
              setEvents(r.events);
              setDraft(null);
              setMessage(
                r.truncated
                  ? "100件まで表示しています。"
                  : `${r.events.length}件の予定を取得しました。`,
              );
            })
          }
        >
          商談予定を取得
        </button>
      </div>
      <div className="form-grid">
        <label>
          商談予定
          <select
            aria-label="商談予定"
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setDraft(null);
            }}
          >
            <option value="">予定を選択</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.start} · {e.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          紐付けるアカウント
          <select
            aria-label="紐付けるアカウント"
            value={account}
            onChange={(e) => {
              setAccount(e.target.value);
              setDraft(null);
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
      </div>
      <button
        type="button"
        className="button"
        disabled={busy || !selected || !account}
        onClick={() =>
          void run(async () => {
            setDraft(
              await api("/google/calendar/prepare", "POST", {
                eventId: selected,
                accountId: account,
              }),
            );
          })
        }
      >
        ひな形を確認
      </button>
      {draft && (
        <>
          <label>
            議事録タイトル
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              maxLength={200}
            />
          </label>
          <label>
            議事録のひな形
            <textarea
              rows={9}
              value={draft.text}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              maxLength={80000}
            />
          </label>
          <button
            type="button"
            className="button primary"
            disabled={busy || !draft.title.trim()}
            onClick={() =>
              void run(async () => {
                const m = await api<SalesMinute>("/sales/minutes", "POST", {
                  ...draft,
                  accountId: account,
                  autoSummarize: false,
                  autoExtract: false,
                });
                await onSaved(m);
                setDraft(null);
                setMessage(
                  "議事録を保存しました。同じ予定とアカウントの再保存は既存の議事録を開きます。",
                );
              })
            }
          >
            Worknestにひな形を保存
          </button>
          <p>
            保存後の議事録詳細からGoogle
            Docsを作成できます。会議内容の記入後に要約・タスク化してください。
          </p>
        </>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}

export function MinuteGoogleActions({
  api,
  minute,
  onChanged,
}: {
  api: GoogleApi;
  minute: SalesMinute;
  onChanged: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [requestId] = useState(() => crypto.randomUUID());
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (minute.supersededBy) return null;
  return (
    <section
      className="google-minute-actions"
      aria-label="Google議事録の更新確認"
    >
      {minute.googleFileId ? (
        <>
          <button
            type="button"
            className="button"
            disabled={busy || ["pending", "processing"].includes(minute.status)}
            onClick={() =>
              void run(async () => {
                const r = await api(
                  `/sales/minutes/${minute.id}/check-source`,
                  "POST",
                  { version: minute.version },
                );
                setMessage(
                  r.changed
                    ? "原文に更新があります。「Googleから更新」で改訂版を取り込んでください。"
                    : "原文の変更はありません。",
                );
              })
            }
          >
            原文の更新を確認
          </button>
          <span
            className={`pill ${minute.sourceChanged ? "peach" : "neutral"}`}
          >
            {minute.sourceChanged
              ? "Google原文に更新あり"
              : minute.sourceCheckedAt
                ? "確認済み"
                : "更新未確認"}
          </span>
          {minute.sourceCheckedAt && (
            <small>
              確認：{new Date(minute.sourceCheckedAt).toLocaleString("ja-JP")}
            </small>
          )}
          <label className="check-label">
            <input
              type="checkbox"
              checked={!!minute.watchEnabled}
              disabled={busy}
              onChange={(e) => {
                const enabled = e.target.checked;
                void run(async () => {
                  await api(`/sales/minutes/${minute.id}/watch`, "POST", {
                    version: minute.version,
                    enabled,
                  });
                  setMessage(
                    enabled
                      ? "この文書を本人のGoogle権限で1日ごとに確認します。"
                      : "自動確認を停止しました。",
                  );
                });
              }}
            />
            この文書の更新を1日ごとに確認
          </label>
          <p>
            更新があっても原文や要約を自動上書きしません。「Googleから更新」で改訂版を保存します。
          </p>
          {minute.sourceCheckError && (
            <p className="form-error">{minute.sourceCheckError}</p>
          )}
        </>
      ) : (
        <>
          <GooglePermission
            api={api}
            capability="documentsWrite"
            label="Googleの利用を許可（文書・資料の作成）"
          />
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const r = await api(
                  `/google/minutes/${minute.id}/create-document`,
                  "POST",
                  { version: minute.version, requestId },
                );
                setMessage(
                  "Google Docsを作成しました。元資料から開いて編集できます。",
                );
              })
            }
          >
            この議事録をGoogle Docsに作成
          </button>
          <p>
            接続した本人のDriveに作成します。共有範囲はGoogle側で設定できます。
          </p>
        </>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function SalesSlides({
  api,
  month,
  week,
}: {
  api: GoogleApi;
  month: string;
  week: string;
}) {
  const [group, setGroup] = useState("総合企画EPG"),
    [notes, setNotes] = useState(""),
    [preview, setPreview] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [items, setItems] = useState<any[]>([]),
    [requestId, setRequestId] = useState("");
  useEffect(() => {
    setPreview(null);
  }, [month, week, group, notes]);
  async function history() {
    const r = await api("/google/artifacts");
    setItems(r.items);
  }
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
  return (
    <details
      className="panel google-workflow-panel"
      onToggle={(e) => {
        if (e.currentTarget.open)
          void history().catch((e) => setError(e.message));
      }}
    >
      <summary>営業会議資料を作成 · {month}</summary>
      <p>
        対象月 {month} / 会議週 {week}
        。月次サマリーと指定週までのヨミ・媒体情報を、定型のGoogleスライドにまとめます。
      </p>
      <GooglePermission
        api={api}
        capability="documentsWrite"
        label="Googleの利用を許可（文書・資料の作成）"
      />
      <label>
        資料のグループ
        <select
          value={group}
          disabled={busy}
          onChange={(e) => setGroup(e.target.value)}
        >
          {["総合企画EPG", "総合企画G", "CSG", "RDG", "RAG"].map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
      </label>
      <label>
        会議メモ・提案方針（任意）
        <textarea
          maxLength={600}
          rows={3}
          value={notes}
          disabled={busy}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="button"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            setPreview(null);
            const r = await api("/google/reports/preview", "POST", {
              month,
              week,
              group,
              notes,
            });
            setPreview(r);
            setRequestId(crypto.randomUUID());
          })
        }
      >
        資料の内容を確認
      </button>
      {preview && (
        <div className="google-report-preview">
          {preview.warnings.map((w: string) => (
            <p key={w} className="form-error">
              {w}
            </p>
          ))}
          <p>
            {preview.pages.length}ページ · 数字と文章は以下の内容で出力します。
          </p>
          {preview.pages.map((p: any, i: number) => (
            <details key={i}>
              <summary>
                {i + 1}. {p.title}
              </summary>
              <pre>{p.text}</pre>
            </details>
          ))}
          <button
            type="button"
            className="button primary"
            disabled={
              busy ||
              preview.pages.length > 40 ||
              preview.month !== month ||
              preview.week !== week ||
              preview.group !== group
            }
            onClick={() =>
              void run(async () => {
                await api("/google/reports/create", "POST", {
                  month,
                  week,
                  group,
                  notes,
                  fingerprint: preview.fingerprint,
                  requestId,
                });
                await history();
                setPreview(null);
              })
            }
          >
            Googleスライドを作成
          </button>
        </div>
      )}
      {busy && <p role="status">処理中です。画面を閉じずにお待ちください。</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <h3>自分が作成したGoogleファイル</h3>
      <button
        type="button"
        className="button"
        disabled={busy}
        onClick={() => void run(history)}
      >
        作成履歴を更新
      </button>
      <ul className="google-artifact-list">
        {items.map((a) => (
          <li key={a.id}>
            <strong>{a.title}</strong> ·{" "}
            {a.status === "completed" ? "作成済み" : "未完了・要確認"}{" "}
            {a.url && (
              <a href={a.url} target="_blank" rel="noreferrer">
                Googleで開く
              </a>
            )}
            {a.kind === "slides" && a.status === "completed" && (
              <>
                <a
                  href={`https://docs.google.com/presentation/d/${encodeURIComponent(a.fileId)}/export/pdf`}
                  target="_blank"
                  rel="noreferrer"
                >
                  PDF
                </a>
                <a
                  href={`https://docs.google.com/presentation/d/${encodeURIComponent(a.fileId)}/export/pptx`}
                  target="_blank"
                  rel="noreferrer"
                >
                  PowerPoint
                </a>
              </>
            )}
            {a.error && <small>{a.error}</small>}
          </li>
        ))}
      </ul>
      <p>
        ファイルは本人のDriveに作成します。PDF・PowerPointの取得には、そのGoogleアカウントでのログインが必要です。
      </p>
    </details>
  );
}
