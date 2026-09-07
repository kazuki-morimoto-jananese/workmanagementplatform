import { useEffect, useState } from "react";
import type { Data } from "./types";
import { AuditHistory } from "./WorkspaceAdmin";
type Contact = {
  id?: string;
  version?: number;
  name: string;
  email: string;
  company: string;
  accountId: string;
  ownerId: string;
  source: string;
  campaign: string;
  stage: string;
  consent: string;
  nextContact: string;
  notes: string;
};
const stages: Record<string, string> = {
  new: "新規",
  qualified: "有望",
  negotiating: "商談中",
  customer: "顧客",
  lost: "失注・対象外",
};
const consents: Record<string, string> = {
  unknown: "未確認",
  allowed: "許可あり",
  denied: "連絡不可",
};
const empty: Contact = {
  name: "",
  email: "",
  company: "",
  accountId: "",
  ownerId: "",
  source: "",
  campaign: "",
  stage: "new",
  consent: "unknown",
  nextContact: "",
  notes: "",
};
export function CrmWorkspace({
  api,
  data,
  integrations = false,
}: {
  api: <T = any>(path: string, method?: string, body?: unknown) => Promise<T>;
  data: Data;
  integrations?: boolean;
}) {
  const [state, setState] = useState<any>(null),
    [draft, setDraft] = useState<Contact | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [source, setSource] = useState(""),
    [secret, setSecret] = useState(""),
    [notice, setNotice] = useState("");
  const load = () => api("/crm/bootstrap").then(setState);
  const [projectId, setProjectId] = useState(data.projects[0]?.id || "");
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const contacts: Contact[] = state?.contacts || [];
  const campaigns = [
    ...new Set(contacts.map((c) => c.campaign || c.source || "流入元未設定")),
  ];
  return (
    <section
      className="panel crm-workspace"
      aria-label={integrations ? "汎用連携と導入確認" : "顧客・リード管理"}
    >
      <h2>{integrations ? "汎用連携と導入確認" : "顧客・リード管理"}</h2>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!state ? (
        <p>読み込み中…</p>
      ) : integrations ? (
        <>
          <h3>運用開始チェック</h3>
          <p>
            設定状況の確認です。接続成功や運用準備の完了を保証するものではありません。
          </p>
          <ul>
            {Object.entries({
              organization: "組織・チーム登録",
              members: "社内メンバー登録",
              accounts: "実アカウント取込",
              targets: "個人目標設定",
              google: "自分のGoogle認証",
              gemini: "Geminiキー設定",
            }).map(([k, v]) => (
              <li key={k}>
                {state.readiness[k] ? "✓" : "未設定"} {v}
              </li>
            ))}
          </ul>
          {data.user.role === "admin" && (
            <>
              <h3>外部サービスから顧客担当者を受け取る</h3>
              <p>
                Googleフォーム・SFA・CRMなどから共通JSONで取り込めます。トークンは顧客情報の受付専用で、他の社内データは読み取れません。有効期限は90日です。
              </p>
              <label>
                連携元の名前{" "}
                <input
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  maxLength={80}
                  placeholder="例：既存SFA"
                />
              </label>
              <button
                className="button"
                disabled={busy || !source.trim()}
                onClick={() =>
                  void run(async () => {
                    const r = await api("/crm/tokens", "POST", {
                      name: source,
                    });
                    setSecret(r.secret);
                    setSource("");
                  })
                }
              >
                受付専用トークンを発行
              </button>
              {secret && (
                <div>
                  <p>
                    この画面で一度だけ表示します。連携先の秘密設定に保存してください。
                  </p>
                  <input
                    aria-label="発行した連携トークン"
                    readOnly
                    value={secret}
                    type="password"
                  />
                  <button
                    className="button"
                    onClick={() =>
                      void run(async () => {
                        await navigator.clipboard.writeText(secret);
                        setNotice("トークンをコピーしました。");
                      })
                    }
                  >
                    コピー
                  </button>
                  <button className="button" onClick={() => setSecret("")}>
                    表示を閉じる
                  </button>
                </div>
              )}
              <p>
                送信先：
                <code>{location.origin}/api/integrations/v1/contacts</code>
              </p>
              <details>
                <summary>共通JSONの形式</summary>
                <pre>
                  {JSON.stringify(
                    {
                      requestId: "source-20260907-001",
                      contacts: [
                        {
                          externalId: "customer-contact-001",
                          name: "サンプル担当者",
                          company: "サンプル企業",
                          source: "展示会",
                          campaign: "秋の展示会",
                          consent: "unknown",
                        },
                      ],
                    },
                    null,
                    2,
                  )}
                </pre>
                <p>
                  POST、Content-Type: application/json、X-Worknest:
                  1、Authorization: Bearer
                  発行したトークン。1回50件まで。再送は同じrequestIdを使用します。
                </p>
              </details>
              <ul>
                {state.tokens.map((t: any) => (
                  <li key={t.id}>
                    {t.name} · 期限 {t.expiresAt.slice(0, 10)} ·{" "}
                    {t.revokedAt ? (
                      "失効済み"
                    ) : (
                      <>
                        <button
                          className="button"
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              api("/crm/tokens/revoke", "POST", { id: t.id }),
                            )
                          }
                        >
                          失効させる
                        </button>
                        <button
                          className="button"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const r = await api(
                                "/crm/tokens/rotate",
                                "POST",
                                { id: t.id },
                              );
                              setSecret(r.secret);
                            })
                          }
                        >
                          トークンを更新
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              <h3>取り込み受付（最新100件）</h3>
              {state.batches.length === 0 && <p>受付データはありません。</p>}
              {state.batches.map((b: any) => (
                <details key={b.id}>
                  <summary>
                    {b.source} · {b.contacts.length}件 · {b.createdAt} ·{" "}
                    {b.status}
                  </summary>
                  <pre
                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                  >
                    {JSON.stringify(b.contacts, null, 2)}
                  </pre>
                  {b.status === "pending" && (
                    <>
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            api("/crm/batches/apply", "POST", {
                              id: b.id,
                              action: "apply",
                            }),
                          )
                        }
                      >
                        確認して反映
                      </button>
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            api("/crm/batches/apply", "POST", {
                              id: b.id,
                              action: "reject",
                            }),
                          )
                        }
                      >
                        却下
                      </button>
                    </>
                  )}
                </details>
              ))}
            </>
          )}
        </>
      ) : (
        <>
          <p>
            顧客担当者をアカウント・担当営業に紐づけます。流入元、営業段階、連絡許可、次回フォロー日を共通の項目で管理します。
          </p>
          <button
            className="button primary"
            onClick={() => setDraft({ ...empty })}
          >
            顧客担当者を追加
          </button>
          <input
            aria-label="顧客を検索"
            placeholder="氏名・会社・流入元で検索"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="sales-table-scroll">
            <table className="sales-table">
              <thead>
                <tr>
                  <th>顧客担当者</th>
                  <th>会社</th>
                  <th>営業段階</th>
                  <th>流入元 / 施策</th>
                  <th>連絡許可</th>
                  <th>次回連絡</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {contacts
                  .filter((c) =>
                    [c.name, c.company, c.email, c.source, c.campaign]
                      .join(" ")
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((c) => (
                    <tr key={c.id}>
                      <th>{c.name}</th>
                      <td>{c.company}</td>
                      <td>{stages[c.stage]}</td>
                      <td>
                        {c.source} / {c.campaign}
                      </td>
                      <td>{consents[c.consent]}</td>
                      <td>{c.nextContact || "未設定"}</td>
                      <td>
                        <button className="button" onClick={() => setDraft(c)}>
                          編集・履歴
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <h3>施策・流入元別の状況</h3>
          <div className="sales-table-scroll">
            <table className="sales-table">
              <thead>
                <tr>
                  <th>施策 / 流入元</th>
                  <th>登録数</th>
                  <th>有望・商談中</th>
                  <th>顧客化</th>
                  <th>連絡不可</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((name) => {
                  const list = contacts.filter(
                    (c) => (c.campaign || c.source || "流入元未設定") === name,
                  );
                  return (
                    <tr key={name}>
                      <th>{name}</th>
                      <td>{list.length}</td>
                      <td>
                        {
                          list.filter((c) =>
                            ["qualified", "negotiating"].includes(c.stage),
                          ).length
                        }
                      </td>
                      <td>
                        {list.filter((c) => c.stage === "customer").length}
                      </td>
                      <td>
                        {list.filter((c) => c.consent === "denied").length}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p>
            件数は顧客担当者単位です。売上への貢献額や、過去の段階遷移率を示すものではありません。連絡不可の相手には送信しない運用にしてください。
          </p>
          {draft && (
            <form
              className="standard-form"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api("/crm/contacts", "POST", draft);
                  setDraft(null);
                  setNotice("顧客担当者を保存しました。");
                });
              }}
            >
              <h3>{draft.id ? "顧客担当者を編集" : "新しい顧客担当者"}</h3>
              <div className="form-grid">
                {Object.entries({
                  name: "氏名",
                  company: "会社名",
                  email: "メール",
                  source: "流入元",
                  campaign: "施策名",
                  nextContact: "次回連絡日",
                }).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      required={key === "name"}
                      maxLength={200}
                      type={
                        key === "nextContact"
                          ? "date"
                          : key === "email"
                            ? "email"
                            : "text"
                      }
                      value={draft[key as keyof Contact] || ""}
                      onChange={(e) =>
                        setDraft({ ...draft, [key]: e.target.value })
                      }
                    />
                  </label>
                ))}
                <label>
                  アカウント
                  <select
                    value={draft.accountId}
                    onChange={(e) =>
                      setDraft({ ...draft, accountId: e.target.value })
                    }
                  >
                    <option value="">未設定</option>
                    {data.salesAccounts?.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  担当営業
                  <select
                    value={draft.ownerId}
                    onChange={(e) =>
                      setDraft({ ...draft, ownerId: e.target.value })
                    }
                  >
                    <option value="">未設定</option>
                    {data.members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  営業段階
                  <select
                    value={draft.stage}
                    onChange={(e) =>
                      setDraft({ ...draft, stage: e.target.value })
                    }
                  >
                    {Object.entries(stages).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  連絡許可
                  <select
                    value={draft.consent}
                    onChange={(e) =>
                      setDraft({ ...draft, consent: e.target.value })
                    }
                  >
                    {Object.entries(consents).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  メモ
                  <textarea
                    value={draft.notes}
                    maxLength={3000}
                    onChange={(e) =>
                      setDraft({ ...draft, notes: e.target.value })
                    }
                  />
                </label>
              </div>
              <button className="button primary" disabled={busy}>
                顧客担当者を保存
              </button>
              <button
                type="button"
                className="button"
                onClick={() => setDraft(null)}
              >
                閉じる
              </button>
              {draft.id && (
                <>
                  <label>
                    フォロータスクのプロジェクト
                    <select
                      value={projectId}
                      onChange={(e) => setProjectId(e.target.value)}
                    >
                      <option value="">選択してください</option>
                      {data.projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="button"
                    disabled={
                      busy ||
                      !projectId ||
                      !draft.nextContact ||
                      draft.consent === "denied"
                    }
                    onClick={() =>
                      void run(async () => {
                        await api("/crm/followup", "POST", {
                          id: draft.id,
                          projectId,
                        });
                        setNotice(
                          "保存済みの次回連絡日でフォロータスクを作成・確認しました。タスク一覧で確認できます。",
                        );
                      })
                    }
                  >
                    保存済みの内容からフォロータスクを作成
                  </button>
                  <AuditHistory
                    kind="crmContacts"
                    recordId={draft.id}
                    request={api}
                    members={data.members}
                  />
                </>
              )}
            </form>
          )}
        </>
      )}
    </section>
  );
}
