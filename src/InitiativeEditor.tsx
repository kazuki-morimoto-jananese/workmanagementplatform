import { useEffect, useState } from "react";
import type { Data } from "./types";
import type { SalesAccount } from "./sales-types";
import type { GoogleApi } from "./GoogleWorkflows";
import { AccountSearch } from "./AccountSearch";
import type { Initiative, AnalysisSource } from "./sales-insights";
const statuses = {
  proposed: "提案中",
  agreed: "合意済み",
  running: "実施中",
  reviewed: "検証済み",
  stopped: "中止",
};
export function InitiativeEditor({
  api,
  data,
  accounts,
  analyses,
  value,
  onCancel,
  onSaved,
}: {
  api: GoogleApi;
  data: Data;
  accounts: SalesAccount[];
  analyses: AnalysisSource[];
  value?: Initiative;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [accountId, setAccountId] = useState(value?.accountId || ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (!dirty) return;
    const fn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", fn);
    return () => window.removeEventListener("beforeunload", fn);
  }, [dirty]);
  const sources = analyses.filter((a) => a.accountId === accountId);
  return (
    <form
      className="panel improvement-editor"
      onChange={() => setDirty(true)}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        const f = Object.fromEntries(new FormData(e.currentTarget));
        const [baselineId, baselineSide] = String(f.baseline || "").split("|"),
          [followupId, followupSide] = String(f.followup || "").split("|");
        try {
          await api("/sales/improvements/initiatives", "POST", {
            ...f,
            accountId,
            id: value?.id,
            version: value?.version || 0,
            requestId,
            baselineId,
            baselineSide: Number(baselineSide || 1),
            followupId,
            followupSide: Number(followupSide || 1),
            comparable: f.comparable === "on",
          });
          setDirty(false);
          await onSaved();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>{value ? "施策の更新" : "施策の登録"}</h3>
      {dirty && (
        <p className="sales-muted">
          未保存の変更があります。保存してから画面を切り替えてください。
        </p>
      )}
      {value ? (
        <p>{accounts.find((a) => a.id === accountId)?.name}</p>
      ) : (
        <AccountSearch
          label="施策の対象アカウント"
          value={accountId}
          accounts={accounts}
          onChange={(v) => {
            setAccountId(v);
            setDirty(true);
          }}
        />
      )}
      <div className="form-grid">
        <label>
          施策名
          <input
            name="title"
            required
            maxLength={200}
            defaultValue={value?.title}
          />
        </label>
        <label>
          担当者
          <select
            aria-label="施策の担当者"
            name="ownerId"
            defaultValue={value?.ownerId || data.user.id}
          >
            {data.members
              .filter((m) => m.active)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          施策の状態
          <select
            aria-label="施策の状態"
            name="status"
            defaultValue={value?.status || "proposed"}
          >
            {Object.entries(statuses).map(([k, s]) => (
              <option key={k} value={k}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          実施日
          <input
            type="date"
            name="implementedAt"
            defaultValue={value?.implementedAt}
          />
        </label>
        <label>
          検証予定日
          <input type="date" name="reviewAt" defaultValue={value?.reviewAt} />
        </label>
      </div>
      <label>
        提案・実施内容
        <textarea
          name="proposal"
          maxLength={2000}
          defaultValue={value?.proposal}
        />
      </label>
      <label>
        期待する成果
        <textarea
          name="expectation"
          maxLength={2000}
          defaultValue={value?.expectation}
        />
      </label>
      <div className="form-grid" key={accountId}>
        {(["baseline", "followup"] as const).map((k) => (
          <label key={k}>
            {k === "baseline" ? "実施前の分析・期間" : "実施後の分析・期間"}
            <select
              aria-label={
                k === "baseline" ? "実施前の分析・期間" : "実施後の分析・期間"
              }
              name={k}
              defaultValue={
                value?.[`${k}Id`]
                  ? `${value[`${k}Id`]}|${value[`${k}Side`]}`
                  : ""
              }
            >
              <option value="">未選択</option>
              {sources.flatMap((a) =>
                a.periods.map((p, i) => (
                  <option key={a.id + i} value={a.id + "|" + i}>
                    {a.title} · {p.from}〜{p.to}
                  </option>
                )),
              )}
            </select>
          </label>
        ))}
      </div>
      <p className="sales-muted">
        新しいExcelを商談準備・分析で保存すると実施後の候補に追加されます。分析結果と出典を施策へ保存します。
      </p>
      <label>
        CV定義・比較条件
        <input
          name="definition"
          maxLength={2000}
          placeholder="例：応募完了CV、同じ配信面、月全体。日数・抽出上限も確認"
          defaultValue={value?.definition}
        />
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          name="comparable"
          defaultChecked={value?.comparable}
        />
        期間・抽出条件・CV定義を確認した
      </label>
      <label>
        他の変化・留意点
        <textarea
          name="factors"
          maxLength={2000}
          placeholder="予算変更、季節性、掲載内容の変更など"
          defaultValue={value?.factors}
        />
      </label>
      <label>
        検証結果・次の判断
        <textarea
          name="conclusion"
          maxLength={2000}
          defaultValue={value?.conclusion}
        />
      </label>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="improvement-toolbar">
        <button className="button primary" disabled={busy || !accountId}>
          施策を保存
        </button>
        <button
          className="button"
          type="button"
          disabled={busy}
          onClick={onCancel}
        >
          編集を取り消す
        </button>
      </div>
    </form>
  );
}
