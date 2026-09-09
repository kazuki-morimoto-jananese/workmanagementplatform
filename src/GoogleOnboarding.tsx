import { useEffect, useRef, useState } from "react";
import { GooglePermission, type GoogleApi } from "./GoogleWorkflows";
export function GoogleOnboarding({
  api,
  email,
}: {
  api: GoogleApi;
  email: string;
}) {
  const [pending, setPending] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let active = true;
    api("/google/status")
      .then((s) => {
        if (active) setPending(s.onboardingPending === true);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [api]);
  useEffect(() => {
    if (pending) dialog.current?.showModal();
  }, [pending]);
  async function defer() {
    setBusy(true);
    setError("");
    try {
      await api("/google/onboarding/defer", "POST", {});
      dialog.current?.close();
      setPending(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!pending) return null;
  return (
    <dialog
      ref={dialog}
      className="google-onboarding"
      aria-labelledby="google-onboarding-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) void defer();
      }}
    >
      <p className="eyebrow">初回セットアップ · Google連携</p>
      <h2 id="google-onboarding-title">仕事で使うGoogleアカウントを接続</h2>
      <p>
        Worknestに登録した <strong>{email}</strong>{" "}
        と同じGoogleアカウントで許可してください。すでに接続している場合は、不足している権限を追加します。
      </p>
      <ul>
        <li>Drive・Docs：議事録を検索して取り込み、更新を確認</li>
        <li>スプレッドシート：営業データの読み取り</li>
        <li>カレンダー：商談予定の読み取り</li>
        <li>Docs・Slides：Worknestから議事録や資料を作成</li>
      </ul>
      <p>
        あなたが閲覧できるファイルを利用します。検索だけでは共有されません。Worknestへ取り込んだ議事録はワークスペース全員が閲覧できます。
      </p>
      <div className="google-inline-fields">
        <GooglePermission
          api={api}
          capability="workflows"
          label="Googleに接続して必要な権限を許可"
        />
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => void defer()}
        >
          後で設定してWorknestを使う
        </button>
      </div>
      <p className="sales-muted">
        あとから「営業・数字管理 →
        データ連携」で設定できます。会社の管理者による承認が必要と表示された場合は、管理者にWorknestの利用許可を依頼してください。
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </dialog>
  );
}
