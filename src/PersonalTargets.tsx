import { useState } from "react";
import type { PlanningRow } from "./sales-planning";
import { personKey } from "./sales-planning";
import type { TargetSettings } from "./sales-types";
const yen = (n: number | null) =>
  n == null ? "—" : "¥" + n.toLocaleString("ja-JP");
export function PersonalTargets({
  rows,
  settings,
  month,
  scope,
  admin,
  save,
}: {
  rows: PlanningRow[];
  settings?: TargetSettings;
  month: string;
  scope: string;
  admin: boolean;
  save: (body: unknown) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false),
    [team, setTeam] = useState(settings?.teamName || "チーム"),
    [draft, setDraft] = useState<Record<string, string>>(() =>
      Object.fromEntries(rows.map((r) => [r.key, r.target?.toString() ?? ""])),
    ),
    [extra, setExtra] = useState(""),
    [added, setAdded] = useState<PlanningRow[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const displayed = [...rows, ...added];
  const amount = (r: PlanningRow) =>
    editing ? (draft[r.key]?.trim() ? Number(draft[r.key]) : null) : r.target;
  const sum = (v: (number | null)[]) =>
    v.some((n) => n !== null)
      ? v.reduce<number>((s, n) => s + (n ?? 0), 0)
      : null;
  const totalTarget = sum(displayed.map(amount)),
    totalTrend = sum(rows.map((r) => r.trend)),
    totalForecast = sum(rows.map((r) => r.forecast));
  const cells = (
    target: number | null,
    trend: number | null,
    forecast: number | null,
  ) => (
    <>
      <td>{yen(trend)}</td>
      <td>{yen(forecast)}</td>
      <td>
        {target != null && forecast != null ? yen(forecast - target) : "—"}
      </td>
      <td>
        {target != null && target > 0 && trend != null
          ? ((trend / target) * 100).toFixed(1) + "%"
          : "—"}
      </td>
    </>
  );
  return (
    <section
      className="panel sales-personal-targets"
      aria-label="個人目標と予実"
    >
      <div className="section-heading">
        <h2>個人目標と予実 · {month}</h2>
        {admin && !editing && (
          <button className="button" onClick={() => setEditing(true)}>
            個人目標を編集
          </button>
        )}
      </div>
      <p>
        個人目標は担当者ごとの月間目標です。アカウント別目標は合算しません。この表は表示データ内の担当者全体を集計します。
      </p>
      {editing && (
        <label>
          合計行のチーム名
          <input
            aria-label="合計行のチーム名"
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            maxLength={80}
          />
        </label>
      )}
      <div className="sales-table-scroll">
        <table className="sales-table" aria-label="個人目標の一覧">
          <thead>
            <tr>
              <th>【今月】</th>
              <th>個人目標</th>
              <th>今週Gトレ合計</th>
              <th>ヨミ</th>
              <th>差分（ヨミ-目標）</th>
              <th>達成率（Gトレ）</th>
            </tr>
          </thead>
          <tbody>
            <tr className="sales-target-total">
              <th>{team}合計</th>
              <td>{yen(totalTarget)}</td>
              {cells(totalTarget, totalTrend, totalForecast)}
            </tr>
            {displayed.map((r) => (
              <tr key={r.key}>
                <th>{r.ownerName}</th>
                <td>
                  {editing ? (
                    <input
                      aria-label={`${r.ownerName}の個人目標`}
                      type="number"
                      min="0"
                      max="9000000000000"
                      value={draft[r.key] ?? ""}
                      onChange={(e) =>
                        setDraft({ ...draft, [r.key]: e.target.value })
                      }
                      placeholder="未設定"
                    />
                  ) : (
                    yen(r.target)
                  )}
                </td>
                {cells(amount(r), r.trend, r.forecast)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.some((r) => r.target === null) && (
        <p>目標未設定の担当者がいます。合計は設定済みの目標の小計です。</p>
      )}
      {rows.some((r) => r.missing > 0) && (
        <p>
          ヨミ未入力のアカウントを含みます。ヨミは数値があるアカウントの小計です。
        </p>
      )}
      {editing && (
        <>
          <div className="sales-import-actions">
            <input
              aria-label="追加する目標担当者"
              placeholder="アカウント未登録の担当者も追加可能"
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              maxLength={80}
            />
            <button
              className="button"
              onClick={() => {
                const name = extra.trim(),
                  key = personKey(name);
                if (!key || displayed.some((r) => r.key === key)) {
                  setError("担当者名が未入力、または重複しています。");
                  return;
                }
                setAdded([
                  ...added,
                  {
                    key,
                    ownerName: name,
                    target: null,
                    trend: 0,
                    forecast: 0,
                    accounts: 0,
                    missing: 0,
                  },
                ]);
                setExtra("");
                setError("");
              }}
            >
              担当者を追加
            </button>
          </div>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <div className="sales-import-actions">
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await save({
                    month,
                    scope,
                    teamName: team,
                    version: settings?.version || 0,
                    rows: displayed.map((r) => ({
                      ownerName: r.ownerName,
                      amount: draft[r.key] ?? "",
                    })),
                  });
                  setEditing(false);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              個人目標を保存
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => {
                setDraft(
                  Object.fromEntries(
                    rows.map((r) => [r.key, r.target?.toString() ?? ""]),
                  ),
                );
                setAdded([]);
                setTeam(settings?.teamName || "チーム");
                setEditing(false);
                setError("");
              }}
            >
              キャンセル
            </button>
          </div>
        </>
      )}
    </section>
  );
}
