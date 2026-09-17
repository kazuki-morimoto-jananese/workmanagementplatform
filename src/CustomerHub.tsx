import { useEffect, useState } from "react";
import type { Data, Task } from "./types";
import type { SalesAccount, SalesData } from "./sales-types";
import type { GoogleApi } from "./GoogleWorkflows";
import { AccountSearch } from "./AccountSearch";
import { AuditHistory } from "./WorkspaceAdmin";
import { accountInOwnerFilter } from "./account-ownership";
import {
  customerRecordLabels,
  relationshipRoles,
  type CustomerProfile,
  type CustomerContact,
  type TimelineItem,
} from "./customer-hub-types";
import "./customer-hub.css";
const number = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
const timestamp = (s: string) =>
  s ? new Date(s).toLocaleString("ja-JP") : "更新日時未登録";
type Props = {
  api: GoogleApi;
  data: Data;
  sales: SalesData;
  accounts: SalesAccount[];
  month: string;
  onOpenTask: (t: Task) => void;
  onContact: (accountId: string, contactId: string) => void;
};
export function CustomerHub(props: Props) {
  const [owner, setOwner] = useState("me"),
    [accountId, setAccountId] = useState("");
  const accounts = props.accounts.filter((a) =>
    accountInOwnerFilter(
      a,
      owner,
      props.data.user,
      props.data.members.filter((u) => u.active),
    ),
  );
  const account = accounts.find((a) => a.id === accountId);
  return (
    <section className="customer-hub">
      <div className="panel">
        <h2>顧客カルテ</h2>
        <p>
          関係者・引継ぎ事項と、顧客に紐づく商談・議事録・実行の記録をまとめて確認できます。
        </p>
        <div className="customer-grid">
          <label>
            担当者
            <select
              aria-label="カルテの担当者"
              value={owner}
              onChange={(e) => {
                setOwner(e.target.value);
                setAccountId("");
              }}
            >
              <option value="me">自分の担当アカウント</option>
              <option value="all">すべての担当者</option>
              {props.data.members
                .filter((m) => m.active)
                .map((m) => (
                  <option value={m.id} key={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </label>
          <AccountSearch
            label="カルテの対象アカウント"
            accounts={accounts}
            value={accountId}
            onChange={setAccountId}
          />
        </div>
      </div>
      {account ? (
        <AccountHub
          key={account.id}
          {...props}
          account={account}
          onSelectRelated={(id) => {
            setOwner("all");
            setAccountId(id);
          }}
        />
      ) : (
        <div className="panel">
          <p>
            アカウント名・IDを入力して選択してください。担当が未設定の場合は「すべての担当者」から探せます。
          </p>
        </div>
      )}
    </section>
  );
}
function AccountHub({
  api,
  data,
  sales,
  accounts,
  account,
  month,
  onOpenTask,
  onContact,
  onSelectRelated,
}: Props & { account: SalesAccount; onSelectRelated: (id: string) => void }) {
  type ProfileData = {
    profile: CustomerProfile;
    contacts: CustomerContact[];
    moreContacts: boolean;
    relatedAccounts: { id: string; name: string }[];
  };
  const [profile, setProfile] = useState<ProfileData | null>(null),
    [error, setError] = useState(""),
    [editing, setEditing] = useState(false),
    [history, setHistory] = useState(false);
  const query = "?accountId=" + encodeURIComponent(account.id);
  const reload = async () => {
    const result = await api<ProfileData>(
      "/sales/customer-hub/profile" + query,
    );
    setProfile(result);
    setError("");
  };
  useEffect(() => {
    let active = true;
    api<ProfileData>("/sales/customer-hub/profile" + query)
      .then((p) => {
        if (active) setProfile(p);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [account.id]);
  const master = sales.masters.find(
    (m) => m.accountId === account.id && m.month === month,
  );
  const review = sales.reviews
    .filter((r) => r.accountId === account.id && r.month === month)
    .sort((a, b) => b.weekOf.localeCompare(a.weekOf))[0];
  return (
    <>
      <section className="panel customer-overview">
        <div className="customer-toolbar">
          <div>
            <span className="eyebrow">ACCOUNT OVERVIEW</span>
            <h2>{account.name}</h2>
            <p>
              {account.id} · {account.ownerName || "担当未設定"} ·{" "}
              {account.group}
            </p>
          </div>
          <span className="pill sage">{account.status || "状態未設定"}</span>
        </div>
        <dl className="customer-metrics">
          <div>
            <dt>{month} Gトレ（円）</dt>
            <dd>{number(master?.gTrend)}</dd>
          </div>
          <div>
            <dt>着地ヨミ（円）</dt>
            <dd>
              {number(review ? review.forecast : master?.importedForecast)}
            </dd>
          </div>
          <div>
            <dt>最終接点</dt>
            <dd>{account.lastContactAt || "未登録"}</dd>
          </div>
        </dl>
        <div className="customer-grid">
          <div>
            <h3>顧客の目標</h3>
            <p>{account.customerGoal || "未登録"}</p>
          </div>
          <div>
            <h3>顧客の課題</h3>
            <p>{account.customerIssues || "未登録"}</p>
          </div>
        </div>
        <p>
          代理店：{account.agency || "未登録"} / カテゴリ：
          {account.category || "未登録"}
        </p>
      </section>
      {error && (
        <div>
          <p className="form-error" role="alert">
            {error}
          </p>
          <button
            className="button"
            onClick={() => reload().catch((e) => setError(e.message))}
          >
            カルテを再読み込み
          </button>
        </div>
      )}
      {!profile && !error && <p role="status">カルテを読み込み中…</p>}
      {profile && (
        <>
          <section className="panel">
            <div className="customer-toolbar">
              <h3>顧客の構成・引継ぎ</h3>
              <button
                className="button"
                disabled={editing}
                onClick={() => setEditing(true)}
              >
                カルテを編集
              </button>
              <button className="button" onClick={() => setHistory(!history)}>
                カルテの変更履歴
              </button>
            </div>
            <p>
              {profile.profile.company || "法人名未登録"} /{" "}
              {profile.profile.brand || "ブランド未登録"} /{" "}
              {profile.profile.branch || "拠点未登録"}
            </p>
            {profile.profile.website && (
              <a
                href={profile.profile.website}
                target="_blank"
                rel="noreferrer"
              >
                顧客Webサイトを開く
              </a>
            )}
            <p>更新・契約確認日：{profile.profile.renewalDate || "未登録"}</p>
            <div className="customer-grid">
              <div>
                <h4>引継ぎメモ</h4>
                <p className="customer-copy">
                  {profile.profile.handover || "未登録"}
                </p>
              </div>
              <div>
                <h4>次に進めること</h4>
                <p className="customer-copy">
                  {profile.profile.nextStep || "未登録"}
                </p>
              </div>
            </div>
            <h4>関連アカウント</h4>
            <div className="customer-toolbar">
              {profile.relatedAccounts.map((a) => (
                <button
                  className="button"
                  key={a.id}
                  onClick={() => onSelectRelated(a.id)}
                >
                  {a.name}
                </button>
              ))}
              {!profile.relatedAccounts.length && (
                <p>未登録。別ブランド・拠点などを手動で関連付けできます。</p>
              )}
            </div>
            <p className="sales-muted">
              関連付けは参照用です。数字・議事録・アカウントIDは統合しません。カルテはワークスペース内で共有されます。
            </p>
            {editing && (
              <ProfileEditor
                key={profile.profile.version}
                value={profile.profile}
                accounts={accounts}
                api={api}
                onCancel={() => setEditing(false)}
                onSaved={async () => {
                  await reload();
                  setEditing(false);
                }}
              />
            )}
            {history && (
              <AuditHistory
                request={api}
                members={data.members}
                kind="customerProfiles"
                recordId={account.id}
              />
            )}
          </section>
          <section className="panel">
            <div className="customer-toolbar">
              <h3>関係者</h3>
              <button
                className="button"
                onClick={() => onContact(account.id, "new")}
              >
                この顧客の関係者を登録
              </button>
              <button
                className="button"
                onClick={() => reload().catch((e) => setError(e.message))}
              >
                関係者を再読み込み
              </button>
            </div>
            <div className="customer-grid">
              {profile.contacts.map((c) => (
                <article className="customer-contact" key={c.id}>
                  <span className="pill neutral">
                    {relationshipRoles[c.relationshipRole || "unknown"]}
                  </span>
                  <h4>{c.name}</h4>
                  <p>
                    {c.department} {c.jobTitle}
                  </p>
                  <p>{c.email}</p>
                  <p>
                    連絡許可：
                    {
                      {
                        unknown: "未確認",
                        allowed: "許可あり",
                        denied: "連絡不可",
                      }[c.consent]
                    }{" "}
                    / 次回：{c.nextContact || "未定"}
                  </p>
                  <p className="customer-copy">{c.notes}</p>
                  <button
                    className="button"
                    onClick={() => onContact(account.id, c.id)}
                  >
                    関係者を編集
                  </button>
                </article>
              ))}
            </div>
            {!profile.contacts.length && <p>登録済みの関係者はありません。</p>}
            {profile.moreContacts && (
              <p>
                最新30件を表示しています。すべての関係者は「顧客・リード」で確認できます。
              </p>
            )}
          </section>
        </>
      )}
      <CustomerTimeline
        key={account.id}
        api={api}
        accountId={account.id}
        data={data}
        onOpenTask={onOpenTask}
      />
    </>
  );
}
function ProfileEditor({
  api,
  value,
  accounts,
  onSaved,
  onCancel,
}: {
  api: GoogleApi;
  value: CustomerProfile;
  accounts: SalesAccount[];
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [related, setRelated] = useState(value.relatedAccountIds),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="customer-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.currentTarget));
        setBusy(true);
        setError("");
        try {
          await api("/sales/customer-hub/profile", "POST", {
            ...f,
            accountId: value.accountId,
            relatedAccountIds: related,
            version: value.version,
          });
          await onSaved();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h4>カルテを編集</h4>
      <div className="customer-grid">
        {(
          ["company", "brand", "branch", "website", "renewalDate"] as const
        ).map((k) => (
          <label key={k}>
            {
              {
                company: "法人名",
                brand: "ブランド",
                branch: "拠点",
                website: "WebサイトURL",
                renewalDate: "更新・契約確認日",
              }[k]
            }
            <input
              name={k}
              type={
                k === "renewalDate" ? "date" : k === "website" ? "url" : "text"
              }
              maxLength={k === "website" ? 1000 : 200}
              defaultValue={value[k]}
            />
          </label>
        ))}
      </div>
      <label>
        引継ぎメモ
        <textarea
          name="handover"
          aria-label="引継ぎメモ"
          maxLength={5000}
          rows={5}
          defaultValue={value.handover}
        />
      </label>
      <label>
        次に進めること
        <textarea
          name="nextStep"
          aria-label="次に進めること"
          maxLength={2000}
          rows={3}
          defaultValue={value.nextStep}
        />
      </label>
      <AccountSearch
        label="関連アカウントを追加"
        value=""
        accounts={accounts.filter(
          (a) => a.id !== value.accountId && !related.includes(a.id),
        )}
        disabled={related.length >= 20}
        onChange={(id) => {
          if (id) setRelated([...related, id]);
        }}
      />
      <div className="customer-toolbar">
        {related.map((id) => (
          <button
            className="button"
            type="button"
            key={id}
            onClick={() => setRelated(related.filter((x) => x !== id))}
          >
            {accounts.find((a) => a.id === id)?.name || id} の関連を解除
          </button>
        ))}
      </div>
      <p className="sales-muted">
        保存してから別のアカウント・画面に切り替えてください。
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="customer-toolbar">
        <button className="button primary" disabled={busy}>
          カルテを保存
        </button>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={onCancel}
        >
          編集を取り消す
        </button>
      </div>
    </form>
  );
}
function CustomerTimeline({
  api,
  accountId,
  data,
  onOpenTask,
}: {
  api: GoogleApi;
  accountId: string;
  data: Data;
  onOpenTask: (t: Task) => void;
}) {
  const [type, setType] = useState("all"),
    [items, setItems] = useState<TimelineItem[]>([]),
    [next, setNext] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [detail, setDetail] = useState<{ kind: string; record: any } | null>(null),
    [generation, setGeneration] = useState(0);
  const path =
    "/sales/customer-hub/timeline?" + new URLSearchParams({ accountId, type });
  useEffect(() => {
    let active = true;
    setItems([]);
    setNext(null);
    setDetail(null);
    setError("");
    setBusy(true);
    api<{ items: TimelineItem[]; next: string | null }>(path)
      .then((r) => {
        if (active) {
          setItems(r.items);
          setNext(r.next);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [path, generation]);
  return (
    <section className="panel customer-timeline">
      <div className="customer-toolbar">
        <h3>顧客のタイムライン</h3>
        <label>
          記録の種類
          <select
            aria-label="カルテの記録の種類"
            value={type}
            disabled={busy}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="all">すべての記録</option>
            {Object.entries(customerRecordLabels).map(([k, s]) => (
              <option value={k} key={k}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button"
          disabled={busy}
          onClick={() => setGeneration(generation + 1)}
        >
          タイムラインを更新
        </button>
      </div>
      <p className="sales-muted">
        現在の記録を最終更新順に25件ずつ表示します。改訂前・削除前の内容は変更履歴で確認できます。更新中に一覧が変わった場合は再読み込みしてください。
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {busy && <p role="status">記録を読み込み中…</p>}
      <ol className="customer-events">
        {items.map((item) => (
          <li key={item.kind + item.id}>
            <div className="customer-toolbar">
              <span className="pill neutral">
                {customerRecordLabels[item.kind]}
              </span>
              <small>{timestamp(item.stamp)}</small>
            </div>
            <h4>{item.title || customerRecordLabels[item.kind]}</h4>
            {item.eventDate && <p>対象日・週：{item.eventDate}</p>}
            <p className="customer-copy">
              {item.excerpt || "詳細を開いて確認できます。"}
            </p>
            <button
              className="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const result = await api<{ kind: string; record: any }>(
                    "/sales/customer-hub/record?" +
                      new URLSearchParams({
                        accountId,
                        kind: item.kind,
                        id: item.id,
                      }),
                  );
                  if (result.kind === "tasks") onOpenTask(result.record);
                  else setDetail(result);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              詳細を開く
            </button>
          </li>
        ))}
      </ol>
      {!busy && !items.length && <p>この条件の記録はありません。</p>}
      {next && (
        <button
          className="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const r = await api<{
                items: TimelineItem[];
                next: string | null;
              }>(path + "&cursor=" + encodeURIComponent(next));
              setItems((old) => [
                ...old,
                ...r.items.filter(
                  (x) => !old.some((p) => p.kind === x.kind && p.id === x.id),
                ),
              ]);
              setNext(r.next);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          次の25件を表示
        </button>
      )}
      {detail && (
        <RecordDetail
          key={detail.kind + detail.record.id}
          {...detail}
          api={api}
          data={data}
          close={() => setDetail(null)}
        />
      )}
    </section>
  );
}
function RecordDetail({
  kind,
  record: r,
  close,
  api,
  data,
}: {
  kind: string;
  record: any;
  close: () => void;
  api: GoogleApi;
  data: Data;
}) {
  const [history, setHistory] = useState(false);
  useEffect(() => {
    document
      .getElementById("customer-record-detail")
      ?.scrollIntoView({ block: "start" });
  }, []);
  const stateLabels: Record<string, string> = {
    proposed: "提案中",
    agreed: "合意済み",
    running: "実施中",
    reviewed: "検証済み",
    stopped: "中止",
    discovery: "初回接点",
    proposal: "提案",
    negotiation: "交渉",
    won: "受注",
    lost: "失注",
    completed: "要約済み",
    saved: "原文保存済み",
    pending: "処理待ち",
    processing: "処理中",
    failed: "処理失敗",
  };
  return (
    <section
      className="customer-record-detail"
      id="customer-record-detail"
      aria-label="カルテの記録詳細"
    >
      <div className="customer-toolbar">
        <h3>
          {customerRecordLabels[kind]} ·{" "}
          {r.title || r.name || r.weekOf || r.date}
        </h3>
        <button className="button" onClick={close}>
          詳細を閉じる
        </button>
      </div>
      {(r.status || r.stage) && (
        <p>状態：{stateLabels[r.status || r.stage] || r.status || r.stage}</p>
      )}
      {kind === "salesMinutes" && (
        <>
          <p>会議日：{r.meetingDate}</p>
          <h4>サマリー</h4>
          <p>{r.summary?.overview || "要約未作成"}</p>
          <h4>決定事項</h4>
          <ul>
            {r.summary?.decisions?.map((s: string, i: number) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          <details>
            <summary>議事録の原文を読む</summary>
            <pre>{r.text}</pre>
          </details>
        </>
      )}
      {kind === "kwAnalyses" && (
        <>
          <p>
            {r.report.periods
              .map((p: { from: string; to: string }) => p.from + "〜" + p.to)
              .join(" → ")}
          </p>
          <div className="prep-table">
            <table>
              <thead>
                <tr>
                  <th>指標</th>
                  <th>期間A</th>
                  <th>期間B</th>
                </tr>
              </thead>
              <tbody>
                {["cost", "cv", "cpa"].map((k) => (
                  <tr key={k}>
                    <th>
                      {{ cost: "消化額（円）", cv: "CV", cpa: "CPA（円）" }[k]}
                    </th>
                    <td>{number(r.report.before[k])}</td>
                    <td>{number(r.report.after[k])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {r.report.findings.map(
            (
              f: { title: string; evidence: string; proposal: string },
              i: number,
            ) => (
              <article key={i}>
                <h4>{f.title}</h4>
                <p>根拠：{f.evidence}</p>
                <p>提案：{f.proposal}</p>
              </article>
            ),
          )}
          <p>
            出典：
            {r.report.sources.map((s: { name: string }) => s.name).join(" / ")}
          </p>
        </>
      )}
      {kind === "salesReviews" && (
        <>
          <p>
            {r.month} / {r.weekOf}週
          </p>
          <p>
            着地ヨミ：{number(r.forecast)}円 / アグレッシブ：
            {number(r.aggressive)}円
          </p>
          <p className="customer-copy">根拠：{r.reason}</p>
          <p className="customer-copy">次の行動：{r.nextAction}</p>
        </>
      )}
      {kind === "salesOpportunities" && (
        <>
          <p>
            金額：{number(r.amount)}円 / 確度：{number(r.probability)}%
          </p>
          <p>受注予定：{r.expectedCloseDate || "未定"}</p>
          <p className="customer-copy">次の行動：{r.nextAction}</p>
        </>
      )}
      {kind === "salesInitiatives" && (
        <>
          <p className="customer-copy">{r.proposal}</p>
          <p>期待：{r.expectation}</p>
          <p>
            実施日：{r.implementedAt || "未定"} / 検証予定：
            {r.reviewAt || "未定"}
          </p>
          <p className="customer-copy">検証結果：{r.conclusion || "未検証"}</p>
        </>
      )}
      {kind === "salesActivities" && (
        <p className="customer-copy">{r.notes || "メモなし"}</p>
      )}
      {kind === "crmContacts" && (
        <>
          <p>
            {relationshipRoles[r.relationshipRole || "unknown"]} /{" "}
            {r.department} {r.jobTitle}
          </p>
          <p>{r.email}</p>
          <p className="customer-copy">{r.notes}</p>
        </>
      )}
      <button className="button" onClick={() => setHistory(!history)}>
        この記録の変更履歴
      </button>
      {history && (
        <AuditHistory
          request={api}
          members={data.members}
          kind={kind}
          recordId={r.id}
        />
      )}
    </section>
  );
}
