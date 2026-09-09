import { useEffect, useState } from "react";
import { GooglePermission } from "./GoogleWorkflows";
type GoogleStatus = {
  configured: boolean;
  connected: boolean;
  email: string;
  serviceAccount: string;
  redirectUri: string;
  calendar: boolean;
  driveSearch: boolean;
  documentsWrite: boolean;
};
export function IntegrationHealth({
  api,
  admin,
}: {
  api: <T = any>(path: string, method?: string, body?: unknown) => Promise<T>;
  admin: boolean;
}) {
  const [google, setGoogle] = useState<GoogleStatus | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const load = () => api<GoogleStatus>("/google/status").then(setGoogle);
  const [events, setEvents] = useState<
    { id: string; title: string; start: string; url: string }[]
  >([]);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="panel sales-ai-config"
      aria-label="接続の確認とGoogle本人認証"
    >
      <h2>接続の確認とGoogle本人認証</h2>
      <p>
        Geminiはサーバーから実行します。「設定あり」は通信成功を意味しません。接続テストでは架空の固定文のみを送信します。
      </p>
      {admin && (
        <div className="sales-import-actions">
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const r = await api("/sales/connections/test", "POST", {});
                if (!r.ok) throw Error(r.message || "Geminiが未設定です。");
                setMessage("Gemini要約の接続に成功しました。");
              })
            }
          >
            Gemini要約を接続テスト
          </button>
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const r = await api("/sales/connections/test", "POST", {
                  type: "numbers",
                });
                if (!r.ok) throw Error(r.message || "Geminiが未設定です。");
                setMessage("Gemini数値抽出の接続に成功しました。");
              })
            }
          >
            Gemini数値抽出を接続テスト
          </button>
        </div>
      )}
      <h3>Googleドキュメントを本人の権限で読む</h3>
      <p>
        外部共有できない文書は、Worknestと同じメールアドレスのGoogleアカウントで接続します。会社のAPI利用許可が必要な場合があります。
      </p>
      {google?.connected ? (
        <>
          <p>接続済み：{google.email}</p>
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api("/google/disconnect", "POST", {});
                await load();
                setMessage("WorknestのGoogle接続を解除しました。");
              })
            }
          >
            Google接続を解除
          </button>
        </>
      ) : (
        <button
          className="button"
          disabled={busy || !google?.configured}
          onClick={() =>
            void run(async () => {
              const r = await api("/google/start", "POST", {});
              window.location.assign(r.url);
            })
          }
        >
          Googleアカウントに接続
        </button>
      )}
      {google && !google.configured && (
        <p>
          本人認証の初期設定が必要です。管理者はプロジェクトの
          connect-google.cmd
          を実行してください。設定後、このボタンから本人が許可できます。
        </p>
      )}
      <h3>Drive検索・文書と資料の作成</h3>
      <GooglePermission
        api={api}
        capability="workflows"
        label="Google業務連携をまとめて許可"
      />
      <p>
        Drive検索：{google?.driveSearch ? "許可済み" : "未許可"} / Google
        Docs・Slides作成：{google?.documentsWrite ? "許可済み" : "未許可"}
        。追加許可後も会社のAPI制限が適用されます。
      </p>
      <GooglePermission
        api={api}
        capability="driveSearch"
        label="Drive検索を許可して接続"
      />
      <GooglePermission
        api={api}
        capability="documentsWrite"
        label="Googleの利用を許可（文書・資料の作成）"
      />
      <h3>自分のGoogleカレンダー</h3>
      <p>
        今から14日間の予定を最大100件表示します。この一覧は本人だけが閲覧でき、予定一覧は保存しません。議事録タブから選択して保存した商談予定の情報はチーム内で共有されます。Google
        CloudでCalendar APIの有効化が必要です。
      </p>
      <button
        className="button"
        disabled={busy || !google?.configured}
        onClick={() =>
          void run(async () => {
            if (!google?.calendar) {
              const r = await api("/google/start", "POST", { calendar: true });
              window.location.assign(r.url);
            } else {
              const r = await api("/google/calendar");
              setEvents(r.events);
              setMessage(
                r.truncated
                  ? "100件まで表示しています。続きはGoogleカレンダーで確認してください。"
                  : "予定を更新しました。",
              );
            }
          })
        }
      >
        {google?.calendar ? "予定を更新" : "カレンダー閲覧を許可して接続"}
      </button>
      <ul>
        {events.map((e) => (
          <li key={e.id}>
            {e.start} ·{" "}
            {e.url ? (
              <a href={e.url} target="_blank" rel="noreferrer">
                {e.title}
              </a>
            ) : (
              e.title
            )}
          </li>
        ))}
      </ul>
      {google?.serviceAccount && (
        <details>
          <summary>サービスアカウントを使う場合</summary>
          <p>文書の閲覧権限が必要です。共有先：{google.serviceAccount}</p>
          <p>
            外部共有が禁止されている場合は、この共有方法を使わず本人認証を設定してください。
          </p>
        </details>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  );
}
