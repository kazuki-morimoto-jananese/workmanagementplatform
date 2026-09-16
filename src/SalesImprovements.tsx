import { useEffect, useMemo, useState } from "react";
import type { Data, Task } from "./types";
import type { SalesAccount, SalesData } from "./sales-types";
import type { GoogleApi } from "./GoogleWorkflows";
import { accountInOwnerFilter } from "./account-ownership";
import {
  priorityActions,
  matchingState,
  effectiveActionStatus,
  type ActionState,
  type Initiative,
  type AnalysisSource,
} from "./sales-insights";
import { InitiativeEditor } from "./InitiativeEditor";
import { AuditHistory } from "./WorkspaceAdmin";
import "./sales-improvements.css";
const today = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
const num = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
export const initiativeStatuses = {
  proposed: "提案中",
  agreed: "合意済み",
  running: "実施中",
  reviewed: "検証済み",
  stopped: "中止",
};
type Payload = {
  states: ActionState[];
  initiatives: Initiative[];
  analyses: AnalysisSource[];
};
export function SalesImprovements({
  api,
  data,
  sales,
  accounts,
  month,
  week,
  mode,
  onOpenTask,
  onTasksChanged,
}: {
  api: GoogleApi;
  data: Data;
  sales: SalesData;
  accounts: SalesAccount[];
  month: string;
  week: string;
  mode: "actions" | "initiatives";
  onOpenTask: (t: Task) => void;
  onTasksChanged: () => Promise<unknown>;
}) {
  const [payload, setPayload] = useState<Payload>({
    states: [],
    initiatives: [],
    analyses: [],
  });
  const [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [owner, setOwner] = useState("me"),
    [status, setStatus] = useState("open");
  const [editing, setEditing] = useState<Initiative | "new" | null>(null);
  const [historyId, setHistoryId] = useState("");
  async function reload() {
    const p = await api<Payload>(
      `/sales/improvements?month=${month}&mode=${mode}`,
    );
    setPayload(p);
    setLoaded(true);
  }
  useEffect(() => {
    let active = true;
    setLoaded(false);
    api<Payload>(`/sales/improvements?month=${month}&mode=${mode}`)
      .then((p) => {
        if (active) {
          setPayload(p);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [month, mode]);
  const visible = accounts.filter((a) =>
    accountInOwnerFilter(
      a,
      owner,
      data.user,
      data.members.filter((m) => m.active),
    ),
  );
  const ids = new Set(visible.map((a) => a.id));
  const actions = useMemo(
    () => priorityActions(visible, sales, data, month, week, today()),
    [accounts, owner, sales, data, month, week],
  );
  const shown = actions.filter(
    (a) =>
      status === "all" ||
      effectiveActionStatus(
        a,
        matchingState(a, payload.states, month, week),
        today(),
      ) === status,
  );
  async function execute(fn: () => Promise<unknown>) {
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
    <section className="improvement-workspace">
      <div className="panel">
        <h2>{mode === "actions" ? "優先アクション" : "施策の成果追跡"}</h2>
        <p>
          {mode === "actions"
            ? "期限・重要度・金額をもとに、確認したいことを整理します。営業データを再読み込みすると再判定します。"
            : "提案から実施、後日の分析まで同じ施策で追跡します。施策は対象月をまたいで表示します。"}
        </p>
        <div className="improvement-toolbar">
          <label>
            担当者
            <select
              aria-label="改善の担当者"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
            >
              <option value="me">自分の担当アカウント</option>
              <option value="all">すべての担当者</option>
              {data.members
                .filter((m) => m.active)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </label>
          {mode === "actions" && (
            <label>
              対応状況
              <select
                aria-label="優先アクションの状態"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="open">未対応</option>
                <option value="snoozed">保留中</option>
                <option value="done">対応済み</option>
                <option value="all">すべて</option>
              </select>
            </label>
          )}
          <button
            className="button"
            disabled={busy}
            onClick={() => execute(reload)}
          >
            対応・施策の記録を再読み込み
          </button>
          {mode === "initiatives" && (
            <button
              className="button primary"
              disabled={!!editing}
              onClick={() => setEditing("new")}
            >
              施策を登録
            </button>
          )}
        </div>
        {mode === "actions" && (
          <p className="sales-muted">
            対象 {month} / {week}週 ·
            数字の変化は取得日・観測日が新しいデータで判定。0円や欠損を悪化とみなしません。根拠が変わるか保留期限が来ると再表示します。
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!loaded && !error && <p role="status">記録を読み込み中…</p>}
      {loaded && mode === "actions" && (
        <>
          <p>{shown.length}件の確認候補</p>
          {shown.slice(0, 100).map((a) => {
            const state = matchingState(a, payload.states, month, week);
            const key = [a.accountId, a.kind, a.referenceId].join(":");
            const task = data.tasks.find((t) => t.id === a.referenceId);
            return (
              <article
                className={`panel improvement-action level-${a.priority}`}
                key={key + (state?.version || 0) + a.fingerprint}
              >
                <div>
                  <span className="pill neutral">
                    {a.priority >= 3
                      ? "期限超過"
                      : a.priority === 2
                        ? "数字の変化"
                        : "確認"}
                  </span>
                  <small>
                    {visible.find((x) => x.id === a.accountId)?.name}
                  </small>
                  <h3>{a.title}</h3>
                  <p>{a.evidence}</p>
                  {state?.note && <p>前回の対応：{state.note}</p>}
                  {task && (
                    <button className="button" onClick={() => onOpenTask(task)}>
                      対象タスクを開く
                    </button>
                  )}
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    execute(async () => {
                      const saved = await api<ActionState>(
                        "/sales/improvements/action",
                        "POST",
                        {
                          ...a,
                          month,
                          week,
                          status: f.get("status"),
                          until: f.get("until"),
                          note: f.get("note"),
                          version: state?.version || 0,
                        },
                      );
                      setPayload((p) => ({
                        ...p,
                        states: [
                          ...p.states.filter((s) => s.id !== saved.id),
                          saved,
                        ],
                      }));
                    });
                  }}
                >
                  <label>
                    対応
                    <select
                      aria-label="対応"
                      name="status"
                      defaultValue={effectiveActionStatus(a, state, today())}
                    >
                      <option value="open">未対応</option>
                      <option value="done">対応済み</option>
                      <option value="snoozed">保留</option>
                    </select>
                  </label>
                  <label>
                    保留期限
                    <input
                      type="date"
                      name="until"
                      defaultValue={state?.until || ""}
                    />
                  </label>
                  <label>
                    対応メモ
                    <input
                      name="note"
                      maxLength={2000}
                      defaultValue={state?.note || ""}
                    />
                  </label>
                  <button className="button" disabled={busy}>
                    対応を保存
                  </button>
                </form>
              </article>
            );
          })}
          {!shown.length && (
            <div className="panel">
              <p>
                この条件の確認候補はありません。担当者・対応状況を切り替えて確認できます。
              </p>
            </div>
          )}
          {shown.length > 100 && (
            <p>先頭100件を表示しています。担当者で絞り込んでください。</p>
          )}
        </>
      )}
      {loaded && mode === "initiatives" && (
        <>
          {editing && (
            <InitiativeEditor
              key={
                typeof editing === "string"
                  ? "new"
                  : editing.id + editing.version
              }
              api={api}
              data={data}
              accounts={accounts}
              analyses={payload.analyses}
              value={editing === "new" ? undefined : editing}
              onCancel={() => setEditing(null)}
              onSaved={async () => {
                setEditing(null);
                await reload();
              }}
            />
          )}
          {payload.initiatives
            .filter((v) => ids.has(v.accountId))
            .map((v) => (
              <article className="panel improvement-initiative" key={v.id}>
                <span className="pill sage">
                  {initiativeStatuses[v.status]}
                </span>
                <small>
                  {accounts.find((a) => a.id === v.accountId)?.name} ·{" "}
                  {data.members.find((m) => m.id === v.ownerId)?.name}
                </small>
                <h3>{v.title}</h3>
                <p>{v.proposal}</p>
                <p>期待：{v.expectation || "未設定"}</p>
                <p>
                  実施日：{v.implementedAt || "未定"} / 検証予定：
                  {v.reviewAt || "未定"}
                </p>
                {v.baseline && (
                  <p>
                    実施前：{v.baseline.title}（{v.baseline.period.from}〜
                    {v.baseline.period.to}）
                  </p>
                )}
                {v.followup && (
                  <p>
                    実施後：{v.followup.title}（{v.followup.period.from}〜
                    {v.followup.period.to}）
                  </p>
                )}
                {v.baseline && v.followup && (
                  <>
                    <div className="prep-table">
                      <table>
                        <thead>
                          <tr>
                            <th>指標</th>
                            <th>実施前</th>
                            <th>実施後</th>
                            <th>差分</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(["cost", "cv", "cpa"] as const).map((k) => {
                            const a = v.baseline!.totals[k],
                              b = v.followup!.totals[k];
                            return (
                              <tr key={k}>
                                <th>
                                  {
                                    {
                                      cost: "消化額（円）",
                                      cv: "CV",
                                      cpa: "CPA（円）",
                                    }[k]
                                  }
                                </th>
                                <td>{num(a)}</td>
                                <td>{num(b)}</td>
                                <td>
                                  {a != null && b != null ? num(b - a) : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p className="sales-muted">
                      期間・CV定義：{v.definition || "未確認"}
                      。前後差は因果効果を示しません。期間日数・予算・季節性を確認してください。
                    </p>
                  </>
                )}
                <p>検証結果：{v.conclusion || "未検証"}</p>
                {v.factors && <p>他の変化・留意点：{v.factors}</p>}
                <div className="improvement-toolbar">
                  <button
                    className="button"
                    disabled={!!editing}
                    onClick={() => setEditing(v)}
                  >
                    施策・結果を更新
                  </button>
                  <button
                    className="button"
                    onClick={() => setHistoryId(historyId === v.id ? "" : v.id)}
                  >
                    変更履歴を{historyId === v.id ? "閉じる" : "表示"}
                  </button>
                  {v.taskId && data.tasks.some((t) => t.id === v.taskId) ? (
                    <button
                      className="button"
                      onClick={() =>
                        onOpenTask(data.tasks.find((t) => t.id === v.taskId)!)
                      }
                    >
                      施策タスクを開く
                    </button>
                  ) : (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const projectId = new FormData(e.currentTarget).get(
                          "projectId",
                        );
                        execute(async () => {
                          await api("/sales/improvements/task", "POST", {
                            id: v.id,
                            projectId,
                          });
                          await onTasksChanged();
                          await reload();
                        });
                      }}
                    >
                      <select
                        name="projectId"
                        aria-label={`施策「${v.title}」のプロジェクト`}
                        required
                      >
                        <option value="">プロジェクトを選択</option>
                        {data.projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <button className="button" disabled={busy}>
                        施策をタスク化
                      </button>
                    </form>
                  )}
                </div>
                {historyId === v.id && (
                  <AuditHistory
                    request={api}
                    kind="salesInitiatives"
                    recordId={v.id}
                    members={data.members}
                  />
                )}
              </article>
            ))}
          {!payload.initiatives.some((v) => ids.has(v.accountId)) && (
            <div className="panel">
              <p>
                施策はまだありません。「施策を登録」から始められます。分析は商談準備・分析で保存すると選択できます。
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
