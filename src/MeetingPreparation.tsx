import { useEffect, useRef, useState } from "react";
import { AccountSearch } from "./AccountSearch";
import {
  suggestPlacementMapping,
  normalizePlacementRows,
  placementFields,
  placementLabels,
  type PlacementMapping,
} from "./placement-analysis";
import { PlacementTables } from "./PlacementTables";
import "./meeting-preparation.css";
import type { Data } from "./types";
import type { SalesAccount, SalesData } from "./sales-types";
import type { GoogleApi } from "./GoogleWorkflows";
import {
  fields,
  suggestMapping,
  normalizeRows,
  parseDelimited,
  type Mapping,
  type KwReport,
} from "./kw-analysis";
type InputFile = {
  name: string;
  hash: string;
  sheets: { name: string; rows: string[][] }[];
  selected: number;
  header: number;
  mapping: Mapping &
    Partial<Pick<PlacementMapping, "date" | "campaign" | "campaignName">>;
};
const labels: Record<string, string> = {
  keyword: "キーワード",
  company: "会社識別子",
  cost: "消化額（円）",
  click: "クリック",
  cv: "CV",
  impression: "表示回数",
};
const number = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
function download(value: unknown, name: string) {
  const u = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
function FilePanel({
  label,
  value,
  onChange,
  kind = "keyword",
}: {
  label: string;
  value: InputFile | null;
  onChange: (v: InputFile | null) => void;
  kind?: "keyword" | "placement";
}) {
  const columnFields = kind === "placement" ? placementFields : fields;
  const columnLabels = kind === "placement" ? placementLabels : labels;
  const mappingFor =
    kind === "placement" ? suggestPlacementMapping : suggestMapping;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const worker = useRef<Worker | null>(null);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
      worker.current?.terminate();
    },
    [],
  );
  async function read(file: File) {
    const gen = ++generation.current;
    setBusy(true);
    setError("");
    onChange(null);
    try {
      if (file.size > 5_000_000)
        throw new Error("ファイルは5MB以内にしてください。");
      const bytes = await file.arrayBuffer();
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      )
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      let sheets: InputFile["sheets"];
      if (/\.xlsx$/i.test(file.name))
        sheets = await new Promise((resolve, reject) => {
          const w = new Worker(new URL("./excel.worker.ts", import.meta.url), {
            type: "module",
          });
          worker.current = w;
          const timer = setTimeout(() => {
            w.terminate();
            reject(new Error("読み込みがタイムアウトしました。"));
          }, 60000);
          w.onmessage = (e) => {
            clearTimeout(timer);
            w.terminate();
            e.data.error
              ? reject(new Error(e.data.error))
              : resolve(e.data.sheets);
          };
          w.onerror = () => {
            clearTimeout(timer);
            w.terminate();
            reject(new Error("Excelを読み込めません。"));
          };
          w.postMessage(bytes);
        });
      else
        sheets = [
          {
            name: "CSV",
            rows: parseDelimited(
              new TextDecoder("utf-8", { fatal: true }).decode(bytes),
            ),
          },
        ];
      if (!sheets.length || !sheets[0].rows.length)
        throw new Error("データがありません。");
      if (gen === generation.current)
        onChange({
          name: file.name,
          hash,
          sheets,
          selected: 0,
          header: 0,
          mapping: mappingFor(sheets[0].rows[0]),
        });
    } catch (e) {
      if (gen === generation.current)
        setError((e as Error).message + " CSVはUTF-8形式を使用してください。");
    } finally {
      if (gen === generation.current) setBusy(false);
    }
  }
  function reset(selected: number, header: number) {
    if (value)
      onChange({
        ...value,
        selected,
        header,
        mapping: mappingFor(value.sheets[selected].rows[header] || []),
      });
  }
  return (
    <section className="panel">
      <h3>{label}</h3>
      <input
        aria-label={label + "ファイル"}
        type="file"
        accept=".xlsx,.csv,.tsv"
        disabled={busy}
        onChange={(e) => {
          if (e.target.files?.[0]) void read(e.target.files[0]);
          e.target.value = "";
        }}
      />
      {busy && <p role="status">読み込み中…</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {value && (
        <>
          <p>
            {value.name} ·{" "}
            {Math.max(
              0,
              value.sheets[value.selected].rows.length - value.header - 1,
            )}
            行
          </p>
          <label>
            シート
            <select
              aria-label={label + "シート"}
              value={value.selected}
              onChange={(e) => reset(Number(e.target.value), 0)}
            >
              {value.sheets.map((s, i) => (
                <option key={i} value={i}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            見出し行
            <input
              aria-label={label + "見出し行"}
              type="number"
              min={1}
              max={value.sheets[value.selected].rows.length}
              value={value.header + 1}
              onChange={(e) =>
                reset(value.selected, Math.max(0, Number(e.target.value) - 1))
              }
            />
          </label>
          <details open>
            <summary>列の対応を確認</summary>
            <div className="form-grid">
              {columnFields.map((k) => (
                <label key={k}>
                  {columnLabels[k]}
                  <select
                    aria-label={label + columnLabels[k]}
                    value={value.mapping[k] ?? -1}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        mapping: {
                          ...value.mapping,
                          [k]: Number(e.target.value),
                        },
                      })
                    }
                  >
                    <option value={-1}>
                      {k === "company"
                        ? "全行を自社として扱う"
                        : ["impression", "campaign", "campaignName"].includes(k)
                          ? "未提供"
                          : "選択してください"}
                    </option>
                    {(
                      value.sheets[value.selected].rows[value.header] || []
                    ).map((h, i) => (
                      <option key={i} value={i}>
                        {i + 1}: {h || "（空欄）"}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </details>
        </>
      )}
    </section>
  );
}
export function MeetingPreparation({
  api,
  data,
  sales,
  accounts,
  month,
  onRefresh,
}: {
  api: GoogleApi;
  data: Data;
  sales: SalesData;
  accounts: SalesAccount[];
  month: string;
  onRefresh: () => Promise<unknown>;
}) {
  const [accountId, setAccountId] = useState("");
  const account = accounts.find((a) => a.id === accountId);
  return (
    <section className="prep-workspace">
      <div className="panel">
        <h2>商談準備・データ分析</h2>
        <p>前回の商談と今回の数字をつなぎ、次に確認することを整理します。</p>
        <AccountSearch
          label="商談準備の対象アカウント"
          clearLabel="選択を解除"
          accounts={accounts}
          value={accountId}
          onChange={setAccountId}
        />
      </div>
      {account && (
        <PrepAccount
          key={account.id + month}
          {...{ api, data, sales, account, month, onRefresh }}
        />
      )}
    </section>
  );
}
function PrepAccount({
  api,
  data,
  sales,
  account,
  month,
  onRefresh,
}: {
  api: GoogleApi;
  data: Data;
  sales: SalesData;
  account: SalesAccount;
  month: string;
  onRefresh: () => Promise<unknown>;
}) {
  const [analysisKind, setAnalysisKind] = useState<"keyword" | "placement">(
    "keyword",
  );
  const [agenda, setAgenda] = useState(""),
    [version, setVersion] = useState(0),
    [history, setHistory] = useState<
      { id: string; title: string; createdAt: string }[]
    >([]),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [historic, setHistoric] = useState<{
      id: string;
      title: string;
      report: KwReport;
    } | null>(null);
  const query = "?accountId=" + encodeURIComponent(account.id);
  useEffect(() => {
    let active = true;
    api("/sales/preparation" + query)
      .then((r) => {
        if (active) {
          setAgenda(r.draft.agenda);
          setVersion(r.draft.version);
          setHistory(r.analyses);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  const master = sales.masters.find(
      (m) => m.accountId === account.id && m.month === month,
    ),
    review = sales.reviews
      .filter((r) => r.accountId === account.id && r.month === month)
      .sort((a, b) => b.weekOf.localeCompare(a.weekOf))[0];
  const minutes = sales.minutes
    .filter((m) => m.accountId === account.id && !m.supersededBy)
    .sort((a, b) => b.meetingDate.localeCompare(a.meetingDate))
    .slice(0, 3);
  const tasks = data.tasks.filter(
    (t) => t.accountId === account.id && t.status !== "done",
  );
  return (
    <>
      <div className="prep-grid">
        <section className="panel">
          <h3>
            {account.name} · {month}
          </h3>
          <p>
            {account.group} / {account.ownerName} /{" "}
            {account.agency || "代理店未設定"}
          </p>
          <dl className="prep-metrics">
            <div>
              <dt>Gトレ</dt>
              <dd>¥{number(master?.gTrend)}</dd>
            </div>
            <div>
              <dt>着地ヨミ</dt>
              <dd>
                ¥{number(review ? review.forecast : master?.importedForecast)}
              </dd>
            </div>
          </dl>
          <p>顧客の目標：{account.customerGoal || "未登録"}</p>
          <p>課題：{account.customerIssues || "未登録"}</p>
        </section>
        <section className="panel">
          <h3>今回の議題</h3>
          <p>保存した議題はワークスペース内で共有されます。</p>
          <textarea
            aria-label="今回の議題"
            rows={6}
            maxLength={4000}
            disabled={!loaded || busy}
            value={agenda}
            onChange={(e) => {
              setAgenda(e.target.value);
              setMessage("未保存の変更があります");
            }}
          />
          <button
            className="button primary"
            disabled={!loaded || busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const r = await api("/sales/preparation/draft", "POST", {
                  accountId: account.id,
                  version,
                  agenda,
                });
                setVersion(r.version);
                setMessage("議題を保存しました");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            議題を保存
          </button>
          <p role="status">{message}</p>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </section>
      </div>
      <div className="prep-grid">
        <section className="panel">
          <h3>前回までの議事録</h3>
          {!minutes.length && <p>登録済みの議事録はありません。</p>}
          {minutes.map((m) => (
            <article key={m.id}>
              <h4>
                {m.meetingDate} · {m.title}
              </h4>
              <p>
                {m.summary?.overview ||
                  "要約は未作成です。議事録タブで原文を確認できます。"}
              </p>
              {m.summary?.decisions.map((s, i) => (
                <p key={i}>決定：{s}</p>
              ))}
            </article>
          ))}
        </section>
        <section className="panel">
          <h3>未完了タスク（{tasks.length}件）</h3>
          {tasks.length ? (
            tasks.map((t) => (
              <p key={t.id}>
                <strong>{t.title}</strong>
                <br />
                {data.members
                  .filter((m) =>
                    (t.assigneeIds || [t.assigneeId]).includes(m.id),
                  )
                  .map((m) => m.name)
                  .join("、") || "担当未設定"}{" "}
                · {t.dueDate || "期限未設定"}
                {t.visibility === "private" ? " · 非公開タスク" : ""}
              </p>
            ))
          ) : (
            <p>未完了タスクはありません。</p>
          )}
        </section>
      </div>
      <section className="panel">
        <label>
          分析するデータ
          <select
            aria-label="分析するデータ"
            value={analysisKind}
            onChange={(e) => {
              setAnalysisKind(e.target.value as "keyword" | "placement");
              setHistoric(null);
            }}
          >
            <option value="keyword">KWレポート</option>
            <option value="placement">
              LINEバイト・配信面レポート（自社）
            </option>
          </select>
        </label>
        <p>
          切り替えると未保存のファイル・分析はリセットされます。保存済みの分析は下の履歴から開けます。
        </p>
      </section>
      <KwAnalysis
        key={analysisKind}
        kind={analysisKind}
        {...{ api, data, account, onRefresh }}
        onSaved={async () => {
          const r = await api("/sales/preparation" + query);
          setHistory(r.analyses);
        }}
      />
      <section className="panel">
        <h3>保存した分析</h3>
        <p>
          元ファイルは保存しません。再分析時は原本を再選択してください。履歴の結果と根拠は保存されます。
        </p>
        {history.map((h) => (
          <button
            className="button"
            key={h.id}
            onClick={async () => {
              try {
                setHistoric(
                  await api("/sales/preparation/analyses/" + h.id + query),
                );
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            {h.title} · {new Date(h.createdAt).toLocaleString("ja-JP")}
          </button>
        ))}
      </section>
      {historic && (
        <Report
          key={historic.id}
          api={api}
          data={data}
          account={account}
          report={historic.report}
          savedId={historic.id}
          title={historic.title}
          onRefresh={onRefresh}
        />
      )}
    </>
  );
}
function KwAnalysis({
  api,
  data,
  account,
  onSaved,
  onRefresh,
  kind,
}: {
  api: GoogleApi;
  data: Data;
  account: SalesAccount;
  onSaved: () => Promise<void>;
  onRefresh: () => Promise<unknown>;
  kind: "keyword" | "placement";
}) {
  const placement = kind === "placement";
  const [granularity, setGranularity] = useState<"daily" | "monthly">("daily");
  const [a, setA] = useState<InputFile | null>(null),
    [b, setB] = useState<InputFile | null>(null),
    [own, setOwn] = useState(""),
    [periods, setPeriods] = useState([
      { from: "", to: "" },
      { from: "", to: "" },
    ]),
    [confirmed, setConfirmed] = useState(false),
    [report, setReport] = useState<KwReport | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [savedId, setSavedId] = useState(""),
    [title, setTitle] = useState(
      placement ? "LINEバイト・配信面期間比較" : "KW期間比較",
    );
  const worker = useRef<Worker | null>(null);
  const saveRequest = useRef({ payload: "", id: "" });
  useEffect(() => () => worker.current?.terminate(), []);
  const companies = [
    ...new Set(
      [a, b].flatMap((f) =>
        !f
          ? []
          : f.mapping.company < 0
            ? ["自社"]
            : f.sheets[f.selected].rows
                .slice(f.header + 1)
                .map((r) => String(r[f.mapping.company] || "").trim())
                .filter(Boolean),
      ),
    ),
  ];
  function invalidate() {
    setReport(null);
    setSavedId("");
    setConfirmed(false);
  }
  async function analyze() {
    setBusy(true);
    setError("");
    try {
      if (!a || !b) throw new Error("両期間のファイルを選択してください。");
      const normalize = (f: InputFile) =>
        placement
          ? normalizePlacementRows(
              f.sheets[f.selected].rows,
              f.mapping as PlacementMapping,
              f.header,
              granularity,
            )
          : normalizeRows(f.sheets[f.selected].rows, f.mapping, f.header);
      const before = normalize(a),
        after = normalize(b);
      const r = await new Promise<KwReport>((resolve, reject) => {
        const w = new Worker(new URL("./kw.worker.ts", import.meta.url), {
          type: "module",
        });
        worker.current = w;
        const timer = setTimeout(() => {
          w.terminate();
          reject(new Error("分析がタイムアウトしました。"));
        }, 30000);
        w.onmessage = (e) => {
          clearTimeout(timer);
          w.terminate();
          e.data.error
            ? reject(new Error(e.data.error))
            : resolve(e.data.report);
        };
        w.onerror = () => {
          clearTimeout(timer);
          w.terminate();
          reject(new Error("分析処理に失敗しました。"));
        };
        w.postMessage({
          kind,
          granularity,
          before,
          after,
          own,
          periods,
          sources: [a, b].map((f, i) => ({
            name: f.name,
            hash: f.hash,
            sheet: f.sheets[f.selected].name,
            count: i ? after.length : before.length,
            headerRow: f.header + 1,
            mapping: f.mapping,
            adapter: "file",
          })),
        });
      });
      setReport(r);
      setSavedId("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h3>
        {placement
          ? "LINEバイト・配信面データから分析・提案を作成"
          : "KWデータから分析・提案を作成"}
      </h3>
      <p>
        CSV（UTF-8）または.xlsx。1ファイル5MB・1万行まで。
        {placement
          ? "対象アカウント1社の配信面を比較し、他アカウントは除外します。"
          : "自社1社＋競合4社を比較します。"}
        円・件の実数を使用し、元ファイルを外部AIへ送信しません。
      </p>
      <p>
        {placement
          ? "配信面・日付・消化額・クリック・CVの列を指定してください。指定期間とアカウントで絞り込み、日次／月次を混ぜずに比較します。LINEのみのファイルでは全体に対する構成比を確認できないため、non-LINE・不明も含む明細を用意してください。"
          : "各ファイルは指定した期間だけの明細にしてください。ここで日付による行の絞り込みは行いません。"}
        合計行は除いてください。
      </p>
      <fieldset disabled={busy} className="prep-fieldset">
        {placement && (
          <label>
            ファイルの集計粒度
            <select
              aria-label="配信面の集計粒度"
              value={granularity}
              onChange={(e) => {
                setGranularity(e.target.value as "daily" | "monthly");
                invalidate();
              }}
            >
              <option value="daily">日次（日付で期間を絞り込み）</option>
              <option value="monthly">月次（月初〜月末で比較）</option>
            </select>
          </label>
        )}
        <div className="prep-grid">
          <FilePanel
            kind={kind}
            label="期間A"
            value={a}
            onChange={(f) => {
              setA(f);
              invalidate();
            }}
          />
          <FilePanel
            kind={kind}
            label="期間B"
            value={b}
            onChange={(f) => {
              setB(f);
              invalidate();
            }}
          />
        </div>
        <div className="form-grid">
          {periods.map((p, i) => (
            <label key={i}>
              期間{i ? "B" : "A"}
              <input
                aria-label={`期間${i ? "B" : "A"}開始日`}
                type="date"
                value={p.from}
                onChange={(e) => {
                  setPeriods(
                    periods.map((v, j) =>
                      j === i ? { ...v, from: e.target.value } : v,
                    ),
                  );
                  invalidate();
                }}
              />
              <input
                aria-label={`期間${i ? "B" : "A"}終了日`}
                type="date"
                value={p.to}
                onChange={(e) => {
                  setPeriods(
                    periods.map((v, j) =>
                      j === i ? { ...v, to: e.target.value } : v,
                    ),
                  );
                  invalidate();
                }}
              />
            </label>
          ))}
        </div>
        <label>
          自社の会社識別子
          <select
            aria-label="分析の自社"
            value={own}
            onChange={(e) => {
              setOwn(e.target.value);
              invalidate();
            }}
          >
            <option value="">ファイル内の自社を選択</option>
            {companies.slice(0, 50).map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          選択した自社は「{account.name}
          」です。期間・円単位・CV定義・抽出条件を原本と確認しました。
        </label>
        <button
          className="button primary"
          disabled={!a || !b || !own || !confirmed}
          onClick={() => void analyze()}
        >
          期間比較を実行
        </button>
      </fieldset>
      {busy && <p role="status">分析中…</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {report && (
        <>
          <label>
            分析タイトル
            <input
              maxLength={200}
              value={title}
              disabled={!!savedId || busy}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          {!savedId && (
            <p>
              提案文は下の候補ごとに編集できます。保存すると結果が確定し、タスク化できます。
            </p>
          )}
          <Report
            {...{ api, data, account, report, savedId, title, onRefresh }}
            onEdit={!savedId && !busy ? (r) => setReport(r) : undefined}
          />
          <button
            className="button primary"
            disabled={busy || !!savedId}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const payload = JSON.stringify({
                  accountId: account.id,
                  title,
                  report,
                });
                if (saveRequest.current.payload !== payload)
                  saveRequest.current = { payload, id: crypto.randomUUID() };
                const result = await api(
                  "/sales/preparation/analyses",
                  "POST",
                  {
                    accountId: account.id,
                    requestId: saveRequest.current.id,
                    title,
                    report,
                  },
                );
                setSavedId(result.id);
                await onSaved();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {savedId ? "分析・提案を保存済み" : "分析・提案を共有保存"}
          </button>
        </>
      )}
    </section>
  );
}
function Report({
  api,
  data,
  account,
  report: r,
  savedId,
  title,
  onEdit,
  onRefresh,
}: {
  api: GoogleApi;
  data: Data;
  account: SalesAccount;
  report: KwReport;
  savedId: string;
  title: string;
  onEdit?: (r: KwReport) => void;
  onRefresh: () => Promise<unknown>;
}) {
  const [assignee, setAssignee] = useState(data.user.id),
    [due, setDue] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [projectId, setProjectId] = useState(account.projectId || "");
  const ref = useRef<HTMLDivElement>(null);
  function print() {
    document.getElementById("worknest-printout")?.remove();
    const copy = ref.current?.cloneNode(true) as HTMLElement | undefined;
    if (!copy) return;
    copy.id = "worknest-printout";
    document.body.append(copy);
    window.addEventListener("afterprint", () => copy.remove(), { once: true });
    window.print();
  }
  return (
    <div className="kw-report" ref={ref}>
      <h2>{title}</h2>
      <p>
        {account.name} ·{" "}
        {r.periods.map((p) => p.from + "〜" + p.to).join(" → ")}
      </p>
      <p>
        計算版 {r.calculationVersion} · {r.entityCount}
        {r.placement ? "配信面" : "KW"} · 担当者確認用ドラフト
      </p>
      <div className="prep-no-print">
        <button className="button" onClick={print}>
          印刷・PDF保存
        </button>
        <button
          className="button"
          onClick={() =>
            download(
              { accountId: account.id, title, report: r },
              "worknest-analysis.json",
            )
          }
        >
          分析結果をJSON保存
        </button>
      </div>
      <div className="prep-table">
        <table>
          <thead>
            <tr>
              <th>自社指標</th>
              <th>期間A</th>
              <th>期間B</th>
            </tr>
          </thead>
          <tbody>
            {(["cost", "click", "cv", "cpc", "cvr", "cpa"] as const).map(
              (k) => (
                <tr key={k}>
                  <th>
                    {k.toUpperCase()}
                    {k === "cvr"
                      ? "（%）"
                      : ["cost", "cpc", "cpa"].includes(k)
                        ? "（円）"
                        : ""}
                  </th>
                  <td>
                    {number(
                      k === "cvr" && r.before[k] !== null
                        ? r.before[k]! * 100
                        : r.before[k],
                    )}
                  </td>
                  <td>
                    {number(
                      k === "cvr" && r.after[k] !== null
                        ? r.after[k]! * 100
                        : r.after[k],
                    )}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      <p>
        <strong>
          期間B：CVゼロの{r.placement ? "配信面" : "KW"}への消化額 ¥
          {number(r.zeroCvCost)}
        </strong>
      </p>
      <p>
        CV不明の{r.placement ? "配信面" : "KW"}
        はこの合計に含みません。計測状況を確認してください。
      </p>
      {r.placement ? (
        <PlacementTables report={r} />
      ) : (
        <div className="prep-table">
          <table>
            <thead>
              <tr>
                <th>KW</th>
                <th>消化A</th>
                <th>消化B</th>
                <th>CPA A</th>
                <th>CPA B</th>
                <th>抽出状態</th>
              </tr>
            </thead>
            <tbody>
              {r.rows.map((row) => (
                <tr key={row.keyword}>
                  <th>{row.keyword}</th>
                  <td>{number(row.before.cost)}</td>
                  <td>{number(row.after.cost)}</td>
                  <td>{number(row.before.cpa)}</td>
                  <td>{number(row.after.cpa)}</td>
                  <td>{row.state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {r.rows.some((row) => row.index.length > 0) && (
        <>
          <h3>期間Bの競合広告主比較（自社＝100）</h3>
          <p>
            CVRは高いほど、CPAは低いほど効率が良い指標です。指数は優劣の断定ではありません。
          </p>
          <div className="prep-table">
            <table>
              <thead>
                <tr>
                  <th>KW</th>
                  <th>競合</th>
                  <th>COST指数</th>
                  <th>CPC指数</th>
                  <th>CVR指数</th>
                  <th>CPA指数</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.flatMap((row) =>
                  row.index.map((c, i) => (
                    <tr key={row.keyword + ":" + i}>
                      <td>{row.keyword}</td>
                      <td>競合{i + 1}</td>
                      <td>{number(c.cost)}</td>
                      <td>{number(c.cpc)}</td>
                      <td>{number(c.cvr)}</td>
                      <td>{number(c.cpa)}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      <h3>確認事項・提案候補</h3>
      {!r.findings.length && (
        <p>
          条件に該当する候補はありません。問題がないことの証明ではありません。
        </p>
      )}
      <div className="form-grid prep-no-print">
        <label>
          タスクのプロジェクト
          <select
            aria-label="分析タスクのプロジェクト"
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
        <label>
          タスク担当者
          <select
            aria-label="分析タスク担当者"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
          >
            <option value="">未設定</option>
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
          タスク期限
          <input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </label>
      </div>
      {r.findings.map((f, i) => (
        <article className="prep-finding" key={i}>
          <h4>{f.title}</h4>
          <p>
            <strong>根拠：</strong>
            {f.evidence}
          </p>
          {onEdit ? (
            <>
              <label className="prep-no-print">
                提案文
                <textarea
                  aria-label="提案文"
                  maxLength={3000}
                  value={f.proposal}
                  onChange={(e) =>
                    onEdit({
                      ...r,
                      findings: r.findings.map((v, j) =>
                        j === i ? { ...v, proposal: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
              <p className="prep-print-only">{f.proposal}</p>
            </>
          ) : (
            <p>{f.proposal}</p>
          )}
          <button
            className="button prep-no-print"
            disabled={!savedId || busy || !projectId}
            onClick={async () => {
              setBusy(true);
              try {
                await api(
                  "/sales/preparation/analyses/" + savedId + "/task",
                  "POST",
                  {
                    accountId: account.id,
                    index: i,
                    assigneeId: assignee,
                    projectId,
                    dueDate: due,
                  },
                );
                setMessage(
                  "根拠付きタスクを作成しました（作成済みの場合は再作成しません）。",
                );
                await onRefresh();
              } catch (e) {
                setMessage((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            根拠付きでタスク化
          </button>
        </article>
      ))}
      <p role="status" className="prep-no-print">
        {message}
      </p>
      <footer>
        <h4>データと根拠</h4>
        {r.sources.map((s, i) => (
          <p key={i}>
            期間{i ? "B" : "A"}：{s.name} / {s.sheet} / {s.count}行<br />
            SHA-256: {s.hash}
          </p>
        ))}
        {r.warnings.map((w) => (
          <p key={w}>{w}</p>
        ))}
        <p>
          元ファイルはWorknestへ保存していません。営業サマリー・ヨミの数値には加算しません。
        </p>
      </footer>
    </div>
  );
}
