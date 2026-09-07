import { useEffect, useState } from "react";
import { organizationName, type Data, type OrgUnit } from "./types";
type Request = (path: string, method?: string, body?: unknown) => Promise<any>;
export function OrganizationSelect({
  units,
  ...props
}: { units: OrgUnit[] } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props}>
      <option value="">所属未設定</option>
      {units.map((u) => (
        <option key={u.id} value={u.id}>
          {organizationName(units, u.id)}
        </option>
      ))}
    </select>
  );
}
export function OrganizationPanel({
  data,
  request,
  refresh,
}: {
  data: Data;
  request: Request;
  refresh: () => Promise<unknown>;
}) {
  const units = data.orgUnits || [];
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [parent, setParent] = useState("");
  const [edit, setEdit] = useState<OrgUnit | null>(null);
  const levels = ["company", "division", "department", "team"];
  const labels = ["会社", "事業部", "部署", "チーム"];
  const level = parent
    ? levels[
        levels.indexOf(units.find((u) => u.id === parent)?.level || "company") +
          1
      ]
    : "company";
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel settings-section organization-panel">
      <h2>組織と所属</h2>
      <p>
        同じ部署のチームを増やすときは、親組織に同じ部署を選んでチーム名を登録します。その後「自分の所属」で所属先を選びます。
      </p>
      <p>
        会社 → 事業部 → 部署 →
        チーム。登録した共通名を、メンバー・プロジェクト・営業アカウントで使います。
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <label>
        自分の所属
        <OrganizationSelect
          aria-label="自分の所属"
          units={units}
          value={data.user.orgUnitId || ""}
          disabled={busy}
          onChange={(e) =>
            void run(() =>
              request(`/members/${data.user.id}/organization`, "POST", {
                orgUnitId: e.target.value,
              }),
            )
          }
        />
      </label>
      {data.user.role === "admin" && (
        <>
          <form
            key={edit?.id || "new"}
            className="standard-form"
            onSubmit={(e) => {
              e.preventDefault();
              const fields = Object.fromEntries(new FormData(e.currentTarget));
              void run(async () => {
                await request(
                  edit ? `/org-units/${edit.id}` : "/org-units",
                  edit ? "PATCH" : "POST",
                  {
                    ...fields,
                    level,
                    parentId: parent,
                    version: edit?.version,
                  },
                );
                setEdit(null);
              });
            }}
          >
            <h3>{edit ? "組織名を変更" : "組織を登録"}</h3>
            <div className="form-grid">
              {!edit && (
                <label>
                  親組織
                  <select
                    aria-label="親組織"
                    value={parent}
                    onChange={(e) => setParent(e.target.value)}
                  >
                    <option value="">なし（会社を作成）</option>
                    {units
                      .filter((u) => u.level !== "team")
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {organizationName(units, u.id)}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <label>
                {edit
                  ? labels[levels.indexOf(edit.level)]
                  : labels[levels.indexOf(level)]}
                名
                <input
                  name="name"
                  required
                  maxLength={80}
                  defaultValue={edit?.name}
                  placeholder="例：営業第一部"
                />
              </label>
            </div>
            <div className="admin-actions">
              <button className="button" disabled={busy}>
                保存
              </button>
              {edit && (
                <button
                  type="button"
                  className="button"
                  onClick={() => setEdit(null)}
                >
                  キャンセル
                </button>
              )}
            </div>
          </form>
          <div className="organization-list">
            {units.map((u) => (
              <div key={u.id}>
                <span>{organizationName(units, u.id)}</span>
                <button className="text-button" onClick={() => setEdit(u)}>
                  名称変更
                </button>
              </div>
            ))}
          </div>
          <h3>メンバーの所属</h3>
          {data.members
            .filter((m) => m.active && m.id !== data.user.id)
            .map((m) => (
              <label key={m.id}>
                {m.name}
                <OrganizationSelect
                  units={units}
                  value={m.orgUnitId || ""}
                  disabled={busy}
                  onChange={(e) =>
                    void run(() =>
                      request(`/members/${m.id}/organization`, "POST", {
                        orgUnitId: e.target.value,
                      }),
                    )
                  }
                />
              </label>
            ))}
        </>
      )}
    </section>
  );
}
type AuditEntry = {
  seq: number;
  kind: string;
  record_id: string;
  action: string;
  actor_id: string;
  created_at: string;
  before_data: any;
  after_data: any;
};
export function AuditHistory({
  request,
  kind = "",
  recordId = "",
  members = [],
}: {
  request: Request;
  kind?: string;
  recordId?: string;
  members?: Data["members"];
}) {
  const [entries, setEntries] = useState<AuditEntry[]>([]),
    [next, setNext] = useState<number | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = async (cursor?: number) => {
    setBusy(true);
    setError("");
    try {
      const result = await request(
        `/audit?${new URLSearchParams({ kind, recordId, ...(cursor ? { before: String(cursor) } : {}) })}`,
      );
      setEntries((old) =>
        cursor ? [...old, ...result.entries] : result.entries,
      );
      setNext(result.next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, [kind, recordId]);
  return (
    <div className="audit-history">
      <div className="admin-actions">
        <h3>変更履歴</h3>
        <button className="button" disabled={busy} onClick={() => void load()}>
          履歴を更新
        </button>
        <button
          className="button"
          disabled={!entries.length}
          onClick={() => {
            const href = URL.createObjectURL(
              new Blob([JSON.stringify(entries, null, 2)], {
                type: "application/json",
              }),
            );
            const a = document.createElement("a");
            a.href = href;
            a.download = "worknest-history.json";
            a.click();
            URL.revokeObjectURL(href);
          }}
        >
          表示分をJSON保存
        </button>
      </div>
      <p className="sales-muted">
        更新前後の内容を保存します。導入以前の履歴は、導入時の状態から始まります。
      </p>
      {error && <p className="form-error">{error}</p>}
      {entries.map((r) => (
        <details key={r.seq}>
          <summary>
            {new Date(r.created_at).toLocaleString("ja-JP")} ·{" "}
            {members.find((m) => m.id === r.actor_id)?.name || r.actor_id} ·{" "}
            {
              (
                {
                  create: "作成",
                  update: "更新",
                  delete: "削除",
                  baseline: "保存開始時の状態",
                  event: "操作",
                } as Record<string, string>
              )[r.action]
            }{" "}
            ·{" "}
            {r.after_data?.title ||
              r.after_data?.name ||
              r.before_data?.title ||
              r.kind}
          </summary>
          <div className="form-grid">
            <div>
              <h4>変更前</h4>
              <pre>{JSON.stringify(r.before_data, null, 2)}</pre>
            </div>
            <div>
              <h4>変更後</h4>
              <pre>{JSON.stringify(r.after_data, null, 2)}</pre>
            </div>
          </div>
        </details>
      ))}
      {!entries.length && !busy && <p>履歴はまだありません。</p>}
      {next && (
        <button
          className="button"
          disabled={busy}
          onClick={() => void load(next)}
        >
          さらに過去の履歴
        </button>
      )}
    </div>
  );
}
export function OperationsPanel({
  request,
  members,
}: {
  request: Request;
  members: Data["members"];
}) {
  const [status, setStatus] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const load = () =>
    request("/operations")
      .then(setStatus)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="panel settings-section">
      <h2>保存・バックアップ・監査</h2>
      <p>
        履歴は自動削除しません。サーバー稼働中に24時間ごとにバックアップします。
      </p>
      <p>
        最終バックアップ：
        {status?.backup?.lastSuccessAt
          ? new Date(status.backup.lastSuccessAt).toLocaleString("ja-JP")
          : "未実行"}{" "}
        · 保存履歴 {status?.auditCount ?? "—"} 件
      </p>
      {(error || status?.backup?.lastError) && (
        <p className="form-error">{error || status.backup.lastError}</p>
      )}
      <button
        className="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await request("/operations/backup", "POST", {});
            await load();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "保存中…" : "今すぐバックアップ"}
      </button>
      <p className="sales-muted">
        保存先はサーバーのdata/backupsです。障害対策として別ストレージへの複製も運用してください。
      </p>
      <details onToggle={(e) => setShowAudit(e.currentTarget.open)}>
        <summary>全社の監査履歴を開く</summary>
        {showAudit && <AuditHistory request={request} members={members} />}
      </details>
    </section>
  );
}
