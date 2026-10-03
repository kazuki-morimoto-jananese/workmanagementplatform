import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRightLeft,
  CheckCircle2,
  FileSpreadsheet,
  History,
} from "lucide-react";
import type { Data } from "./types";
import type { SalesAccount } from "./sales-types";
import { headerRow, type ExcelSheet } from "./excel-import";
import { parseDelimited } from "./kw-analysis";
import {
  assignmentColumns,
  assignmentMapping,
  normalizeAssignmentName,
  parseAssignmentTable,
  type AssignmentColumn,
  type AssignmentRow,
} from "../shared/account-assignments.mjs";
import { AuditHistory } from "./WorkspaceAdmin";
import { AccountSearch } from "./AccountSearch";
import "./account-assignments.css";

type Api = <T = any>(
  path: string,
  method?: string,
  body?: unknown,
) => Promise<T>;
type Links = {
  ownerLinks: Record<string, string>;
  groupLinks: Record<string, string>;
  ownerGroups: Record<string, string>;
};
type Source = Links & {
  version: number;
  spreadsheetId: string;
  tabName: string;
  headerRow: number;
  lastColumn: string;
  authUserId?: string;
  useMyGoogle?: boolean;
};
type Owner = {
  ownerId: string;
  ownerName: string;
  group: string;
  orgUnitId: string;
};
type Change = {
  accountId: string;
  name: string;
  before: Owner;
  after: Owner;
  ready: boolean;
  status: string;
  issues: string[];
  warnings: string[];
  baseline: { effectiveFrom: string } | null;
};
type Preview = { token: string; effectiveFrom: string; rows: Change[] };
type Run = {
  id: string;
  effectiveFrom: string;
  accountIds: string[];
  assignmentIds: string[];
  count: number;
  createdAt: string;
  createdBy: string;
};
type Batch = {
  input: Links & { rows: AssignmentRow[]; effectiveFrom: string };
  preview: Preview;
  requestId: string;
};
type WorkItem = { kind: string; id: string; title: string; version: number };
type Work = {
  assignment: Owner & {
    id: string;
    accountId: string;
    before: Owner;
    version: number;
  };
  items: WorkItem[];
  more: boolean;
  current: boolean;
};
const blank: Source = {
  version: 0,
  spreadsheetId: "",
  tabName: "00_メイン情報",
  headerRow: 6,
  lastColumn: "R",
  ownerLinks: {},
  groupLinks: {},
  ownerGroups: {},
};
const meaningful = (s: string) => s && !["-", "ー", "―", "—"].includes(s);
const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : "処理に失敗しました。";

export function AccountAssignments({
  api,
  data,
  accounts,
  onRefresh,
}: {
  api: Api;
  data: Data;
  accounts: SalesAccount[];
  onRefresh: () => Promise<unknown>;
}) {
  const [source, setSource] = useState<Source>(blank);
  const [history, setHistory] = useState<Run[]>([]);
  const [historyNext, setHistoryNext] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [sheets, setSheets] = useState<ExcelSheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [firstRow, setFirstRow] = useState(1);
  const [mapping, setMapping] = useState(assignmentMapping([]));
  const [rows, setRows] = useState<AssignmentRow[]>([]);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [onlyReady, setOnlyReady] = useState(false);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [runId, setRunId] = useState("");
  const [work, setWork] = useState<Work | null>(null);
  const [workSelected, setWorkSelected] = useState<Set<string>>(new Set());
  const [audit, setAudit] = useState(false);
  const alive = useRef(true),
    running = useRef(false),
    worker = useRef<Worker | null>(null);
  const table = sheets[sheetIndex]?.rows.slice(firstRow - 1) || [];
  const real = useMemo(
    () => new Map(accounts.filter((a) => !a.isDemo).map((a) => [a.id, a])),
    [accounts],
  );
  const matched = rows.filter((r) => real.has(r.accountId));
  const owners = [
    ...new Set(
      matched.flatMap((r) => [r.beforeOwner, r.owner]).filter(meaningful),
    ),
  ].sort();
  const groups = [
    ...new Set(
      matched.flatMap((r) => [r.beforeGroup, r.group]).filter(meaningful),
    ),
  ].sort();
  const changes = batches.flatMap((b) => b.preview.rows);
  const filtered = changes.filter(
    (r) =>
      (!onlyReady || r.ready) &&
      (!ownerFilter || r.after.ownerName === ownerFilter) &&
      normalizeAssignmentName(
        [
          r.accountId,
          r.name,
          r.before.ownerName,
          r.after.ownerName,
          r.after.group,
        ].join(" "),
      ).includes(normalizeAssignmentName(search)),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 50));
  const visible = filtered.slice(
    Math.min(page, pages - 1) * 50,
    (Math.min(page, pages - 1) + 1) * 50,
  );
  const activeRun = history.find((r) => r.id === runId);
  const invalidate = () => {
    setBatches([]);
    setSelected(new Set());
    setPage(0);
  };
  useEffect(() => {
    alive.current = true;
    api<{ settings: Source | null; history: Run[]; next: string | null }>(
      "/sales/assignments",
    )
      .then((r) => {
        if (alive.current) {
          setSource(r.settings || blank);
          setHistory(r.history);
          setHistoryNext(r.next);
          setReady(true);
        }
      })
      .catch((e) => {
        if (alive.current) setError(errorMessage(e));
      });
    return () => {
      alive.current = false;
      worker.current?.terminate();
    };
  }, []);
  async function refreshHistory(cursor?: string) {
    const r = await api<{ history: Run[]; next: string | null }>(
      "/sales/assignments" +
        (cursor ? "?" + new URLSearchParams({ before: cursor }) : ""),
    );
    if (alive.current) {
      setHistory((old) => (cursor ? [...old, ...r.history] : r.history));
      setHistoryNext(r.next);
    }
  }
  async function run(f: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await f();
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      running.current = false;
      if (alive.current) {
        setBusy(false);
        setProgress("");
      }
    }
  }
  function takeSheets(next: ExcelSheet[]) {
    if (!next.length) throw new Error("シートがありません。");
    const i = Math.max(
      0,
      next.findIndex((s) => s.name === source.tabName),
    );
    const first = headerRow(next[i].rows);
    setSheets(next);
    setSheetIndex(i);
    setFirstRow(first);
    setMapping(assignmentMapping(next[i].rows[first - 1] || []));
    setRows([]);
    invalidate();
  }
  async function openFile(file: File) {
    setRows([]);
    setSheets([]);
    invalidate();
    if (file.size > 10_000_000 || !/\.(xlsx|csv|tsv)$/i.test(file.name))
      throw new Error(
        "10MB以内の.xlsx / .csv / .tsvを選択してください。Excelは必要なシートだけに絞ってください。",
      );
    if (!/\.xlsx$/i.test(file.name)) {
      const text = await file.text();
      if (alive.current)
        takeSheets([{ name: file.name, rows: parseDelimited(text) }]);
      return;
    }
    const buffer = await file.arrayBuffer();
    if (!alive.current) return;
    const loaded = await new Promise<ExcelSheet[]>((resolve, reject) => {
      const w = new Worker(new URL("./excel.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.current = w;
      const timer = setTimeout(() => {
        w.terminate();
        reject(
          new Error(
            "Excelの読み取りが時間切れです。必要なシート・列に絞ってください。",
          ),
        );
      }, 30000);
      w.onmessage = (e) => {
        clearTimeout(timer);
        w.terminate();
        e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.sheets);
      };
      w.onerror = () => {
        clearTimeout(timer);
        w.terminate();
        reject(new Error("Excelを読み取れませんでした。"));
      };
      w.postMessage(buffer, [buffer]);
    });
    if (alive.current) takeSheets(loaded);
  }
  function setLink(kind: keyof Links, name: string, value: string) {
    const next = { ...source[kind] };
    if (value) next[name] = value;
    else delete next[name];
    setSource({ ...source, [kind]: next });
    invalidate();
  }
  async function readGoogle() {
    setRows([]);
    setSheets([]);
    invalidate();
    const saved = await api<Source>("/sales/assignments/settings", "POST", {
      ...source,
      spreadsheetId:
        source.spreadsheetId.match(/\/d\/([\w-]+)/)?.[1] ||
        source.spreadsheetId.trim(),
    });
    if (!alive.current) return;
    setSource(saved);
    const values: string[][] = [];
    // Read the entire bounded range. Short/blank chunks may precede more accounts.
    for (let offset = 0; offset <= 20000; offset += 500) {
      if (!alive.current) return;
      setProgress(`スプシを読み込み中：${offset.toLocaleString()} / 20,000行`);
      const r = await api<{ values: string[][] }>(
        "/sales/assignments/read",
        "POST",
        { version: saved.version, offset },
      );
      if (
        offset === 20000 &&
        r.values.slice(1).some((row) => row.some((v) => String(v).trim()))
      )
        throw new Error(
          "読取上限20,000行を超えています。対象シートを分けてください。",
        );
      values.push(
        ...Array.from(
          { length: offset === 20000 ? 1 : 500 },
          (_, i) => r.values[i] || [],
        ),
      );
    }
    while (values.length > 1 && !values.at(-1)?.some((v) => String(v).trim()))
      values.pop();
    if (alive.current) {
      setSheets([{ name: saved.tabName, rows: values }]);
      setSheetIndex(0);
      setFirstRow(1);
      setMapping(assignmentMapping(values[0] || []));
      setMessage(
        "スプシを取得しました。列を確認してください。担当変更はまだ保存していません。",
      );
    }
  }
  async function preview() {
    invalidate();
    if (!effectiveFrom) throw new Error("適用日を指定してください。");
    if (!matched.length)
      throw new Error("Worknestに登録済みのアカウントがありません。");
    const next: Batch[] = [];
    for (let i = 0; i < matched.length; i += 100) {
      if (!alive.current) return;
      setProgress(`差分を確認中：${i} / ${matched.length}件`);
      const input = {
        rows: matched.slice(i, i + 100),
        effectiveFrom,
        ownerLinks: source.ownerLinks,
        groupLinks: source.groupLinks,
        ownerGroups: source.ownerGroups,
      };
      next.push({
        input,
        preview: await api<Preview>(
          "/sales/assignments/preview",
          "POST",
          input,
        ),
        requestId: crypto.randomUUID(),
      });
    }
    if (alive.current) setBatches(next);
  }
  async function apply() {
    let count = 0;
    try {
      for (const b of batches) {
        if (!alive.current) return;
        const selectedIds = b.preview.rows
          .filter((r) => r.ready && selected.has(r.accountId))
          .map((r) => r.accountId);
        if (!selectedIds.length) continue;
        setProgress(
          `担当変更を保存中：${count} / ${selected.size}件。完了した分は保持されます。`,
        );
        const input = {
          ...b.input,
          selectedIds,
          token: b.preview.token,
          requestId: b.requestId,
        };
        await api("/sales/assignments/apply", "POST", input);
        count += selectedIds.length;
      }
      if (alive.current)
        setMessage(
          `${count}件の担当履歴を保存しました。仕事の引き継ぎは下の履歴から選択できます。`,
        );
    } catch (e) {
      throw new Error(
        `${errorMessage(e)} 確認済みの保存は${count}件です。通信が切れた直前の処理は完了している可能性があります。履歴を確認し、差分を再取得してください。`,
      );
    } finally {
      if (alive.current) {
        invalidate();
        await refreshHistory();
        await onRefresh();
      }
    }
  }
  async function loadWork(assignmentId: string) {
    setWork(null);
    setWorkSelected(new Set());
    setAudit(false);
    const w = await api<Work>(
      "/sales/assignments/work?" + new URLSearchParams({ assignmentId }),
    );
    if (alive.current) setWork(w);
  }
  return (
    <section className="account-assignments" aria-label="担当・引き継ぎ">
      <div className="assignment-intro panel">
        <ArrowRightLeft size={24} />
        <div>
          <h2>担当が変わっても、顧客の履歴はつながる。</h2>
          <p>
            ① 前任・後任の表を読む → ② 適用日と差分を確認 → ③
            選んで反映。数字・議事録の作成者や個人目標は保持します。
          </p>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {(progress || message) && (
        <p className="sales-notice" role="status">
          {progress || message}
        </p>
      )}
      {!ready && !error && <p role="status">設定を読み込み中…</p>}
      <fieldset disabled={busy || !ready} className="assignment-controls">
        <div className="assignment-source-grid">
          <section className="panel">
            <h3>
              <FileSpreadsheet size={18} /> 1. 担当変更の表を読み込む
            </h3>
            <p>
              売上・ヨミの同期とは別の接続です。Google本人認証の閲覧権限を使い、見出しから最大20,000行を取得します。自動反映はしません。
            </p>
            <label>
              スプレッドシートURL・ID
              <input
                value={source.spreadsheetId}
                onChange={(e) =>
                  setSource({ ...source, spreadsheetId: e.target.value })
                }
              />
            </label>
            <label>
              タブ名
              <input
                value={source.tabName}
                onChange={(e) =>
                  setSource({ ...source, tabName: e.target.value })
                }
              />
            </label>
            <div className="assignment-fields">
              <label>
                スプシの見出し行
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={source.headerRow}
                  onChange={(e) =>
                    setSource({ ...source, headerRow: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                取得する最終列
                <input
                  value={source.lastColumn}
                  onChange={(e) =>
                    setSource({
                      ...source,
                      lastColumn: e.target.value.toUpperCase(),
                    })
                  }
                />
              </label>
            </div>
            <label className="assignment-check">
              <input
                type="checkbox"
                checked={!!source.useMyGoogle}
                onChange={(e) =>
                  setSource({ ...source, useMyGoogle: e.target.checked })
                }
              />
              自分のGoogle接続を使う（未設定の場合は自分）
            </label>
            {source.authUserId && (
              <small>
                接続者：
                {data.members.find((m) => m.id === source.authUserId)?.name ||
                  "設定済み"}
              </small>
            )}
            <button
              className="button primary"
              onClick={() => void run(readGoogle)}
            >
              接続設定を保存して読み込む
            </button>
          </section>
          <section className="panel">
            <h3>Excel / CSVでも取り込めます</h3>
            <p>
              6列（ID・名前・前月担当Ｇ・前月担当者・当月担当Ｇ・当月担当者）を使います。ファイルはブラウザー内で読み取り、差分確認時に登録済みアカウントの担当情報だけを送信します。
            </p>
            <label>
              担当変更ファイル
              <input
                type="file"
                accept=".xlsx,.csv,.tsv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void run(() => openFile(file));
                }}
              />
            </label>
            <p>
              アカウントIDは文字列形式で保存してください。数値として丸められたIDは復元できません。
            </p>
            <p>
              社員の所属部署は「メンバー」で登録します。この画面で変更するのはアカウントの担当者・管理グループです。
            </p>
          </section>
        </div>
        {sheets.length > 0 && (
          <section className="panel">
            <h3>読み取り列を確認</h3>
            <div className="assignment-fields">
              <label>
                担当変更の対象シート
                <select
                  value={sheetIndex}
                  aria-label="担当変更の対象シート"
                  onChange={(e) => {
                    const i = Number(e.target.value),
                      first = headerRow(sheets[i].rows);
                    setSheetIndex(i);
                    setFirstRow(first);
                    setMapping(
                      assignmentMapping(sheets[i].rows[first - 1] || []),
                    );
                    setRows([]);
                    invalidate();
                  }}
                >
                  {sheets.map((s, i) => (
                    <option key={i} value={i}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                取得した表の見出し行
                <input
                  type="number"
                  min={1}
                  max={sheets[sheetIndex]?.rows.length}
                  value={firstRow}
                  onChange={(e) => {
                    const first = Number(e.target.value);
                    setFirstRow(first);
                    setMapping(
                      assignmentMapping(
                        sheets[sheetIndex]?.rows[first - 1] || [],
                      ),
                    );
                    setRows([]);
                    invalidate();
                  }}
                />
              </label>
              {(Object.keys(assignmentColumns) as AssignmentColumn[]).map(
                (k) => (
                  <label key={k}>
                    {assignmentColumns[k]}の列
                    <select
                      value={mapping[k]}
                      onChange={(e) => {
                        setMapping({ ...mapping, [k]: Number(e.target.value) });
                        setRows([]);
                        invalidate();
                      }}
                    >
                      <option value={-1}>選択してください</option>
                      {table[0]?.map((h, i) => (
                        <option key={i} value={i}>
                          {i + 1}列：{h || "空欄"}
                        </option>
                      ))}
                    </select>
                  </label>
                ),
              )}
            </div>
            <button
              className="button"
              onClick={() =>
                void run(async () => {
                  const result = parseAssignmentTable(table, mapping);
                  setRows(result.rows);
                  invalidate();
                  setMessage(
                    `${result.rows.length.toLocaleString()}アカウントを読み取りました。適用日・紐付けを確認してください。`,
                  );
                })
              }
            >
              この列で担当情報を読み取る
            </button>
          </section>
        )}
        {rows.length > 0 && (
          <section className="panel">
            <h3>2. 適用日と紐付けを確認</h3>
            <div className="assignment-totals">
              <span>
                表全体 <strong>{rows.length.toLocaleString()}</strong>
              </span>
              <span>
                既存アカウント{" "}
                <strong>{matched.length.toLocaleString()}</strong>
              </span>
              <span>
                未登録・デモ（対象外）{" "}
                <strong>
                  {(rows.length - matched.length).toLocaleString()}
                </strong>
              </span>
            </div>
            <label>
              担当変更の適用日
              <input
                type="date"
                value={effectiveFrom}
                onChange={(e) => {
                  setEffectiveFrom(e.target.value);
                  invalidate();
                }}
              />
            </label>
            <p>
              将来日も指定できます。当月は本日時点、過去・未来の月は月末時点の担当で表示します。月初変更の初回登録では、前月担当を前月1日からの履歴として保存します。それ以前の担当は推測しません。
            </p>
            <details open>
              <summary>担当者名をメンバーに紐付ける</summary>
              <p>
                同名の有効メンバーが1人なら自動で紐付きます。未登録者は名前を保持し、後から同じ適用日で修正できます。
              </p>
              <div className="assignment-fields">
                {owners.map((name) => {
                  const matches = data.members.filter(
                    (m) =>
                      m.active &&
                      normalizeAssignmentName(m.name) ===
                        normalizeAssignmentName(name),
                  );
                  return (
                    <label key={name}>
                      {name}
                      <select
                        aria-label={`${name}のメンバー紐付け`}
                        value={source.ownerLinks[name] || ""}
                        onChange={(e) =>
                          setLink("ownerLinks", name, e.target.value)
                        }
                      >
                        <option value="">
                          {matches.length === 1
                            ? `自動：${matches[0].name}`
                            : "メンバー紐付け待ち"}
                        </option>
                        {data.members
                          .filter((m) => m.active)
                          .map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}（{m.email}）
                            </option>
                          ))}
                      </select>
                    </label>
                  );
                })}
              </div>
            </details>
            <details>
              <summary>グループを組織マスタに紐付ける・空欄を補う</summary>
              <p>
                当月担当Ｇが空欄なら変更前のグループを保持します。必要な場合だけ、後任名ごとにグループを指定してください。社員の所属は変更しません。
              </p>
              <div className="assignment-fields">
                {groups.map((name) => (
                  <label key={name}>
                    表のグループ：{name}
                    <select
                      value={source.groupLinks[name] || ""}
                      onChange={(e) =>
                        setLink("groupLinks", name, e.target.value)
                      }
                    >
                      <option value="">組織名の完全一致で紐付け</option>
                      {data.orgUnits?.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                {[
                  ...new Set(
                    matched
                      .filter((r) => !meaningful(r.group))
                      .map((r) => r.owner)
                      .filter(meaningful),
                  ),
                ]
                  .sort()
                  .map((name) => (
                    <label key={name}>
                      {name}：当月担当Ｇが空欄の場合
                      <select
                        value={source.ownerGroups[name] || ""}
                        onChange={(e) =>
                          setLink("ownerGroups", name, e.target.value)
                        }
                      >
                        <option value="">変更前を保持</option>
                        {data.orgUnits?.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
              </div>
            </details>
            <button
              className="button primary"
              onClick={() => void run(preview)}
            >
              担当変更の差分を確認
            </button>
          </section>
        )}
        {changes.length > 0 && (
          <section className="panel">
            <h3>3. 反映するアカウントを選ぶ</h3>
            <p>
              適用日：<strong>{effectiveFrom}</strong> ／ 反映可能{" "}
              {changes.filter((r) => r.ready).length}件 ／ 選択 {selected.size}
              件。後任の空欄は担当解除として扱いません。
            </p>
            <div className="assignment-fields">
              <label>
                変更アカウントを検索
                <input
                  type="search"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(0);
                  }}
                  placeholder="ID・名前・前任・後任・グループ"
                />
              </label>
              <label>
                後任で絞り込み
                <select
                  value={ownerFilter}
                  onChange={(e) => {
                    setOwnerFilter(e.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">全員</option>
                  {[
                    ...new Set(
                      changes.map((r) => r.after.ownerName).filter(Boolean),
                    ),
                  ]
                    .sort()
                    .map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                </select>
              </label>
            </div>
            <label className="assignment-check">
              <input
                type="checkbox"
                checked={onlyReady}
                onChange={(e) => {
                  setOnlyReady(e.target.checked);
                  setPage(0);
                }}
              />
              反映可能なアカウントだけ表示
            </label>
            <div className="assignment-actions">
              <button
                className="button"
                onClick={() =>
                  setSelected(
                    new Set([
                      ...selected,
                      ...filtered
                        .filter((r) => r.ready)
                        .map((r) => r.accountId),
                    ]),
                  )
                }
              >
                絞り込み結果を選択
              </button>
              <button className="button" onClick={() => setSelected(new Set())}>
                選択を解除
              </button>
            </div>
            <div className="assignment-table">
              <table>
                <thead>
                  <tr>
                    <th>選択</th>
                    <th>アカウント</th>
                    <th>変更前</th>
                    <th>変更後</th>
                    <th>確認事項</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <tr key={r.accountId}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`${r.name}を反映対象にする`}
                          disabled={!r.ready}
                          checked={selected.has(r.accountId)}
                          onChange={(e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(r.accountId);
                            else next.delete(r.accountId);
                            setSelected(next);
                          }}
                        />
                      </td>
                      <td>
                        <strong>{r.name}</strong>
                        <small>{r.accountId}</small>
                      </td>
                      <td>
                        {r.before.ownerName || "未設定"}
                        <small>{r.before.group || "グループ不明"}</small>
                      </td>
                      <td>
                        <strong>{r.after.ownerName || "未設定"}</strong>
                        <small>{r.after.group || "グループ未設定"}</small>
                        {r.after.ownerName && !r.after.ownerId && (
                          <small>メンバー紐付け待ち</small>
                        )}
                      </td>
                      <td>
                        <strong>{r.status}</strong>
                        {[...r.issues, ...r.warnings].map((w, i) => (
                          <small key={i}>{w}</small>
                        ))}
                        {r.baseline && (
                          <small>
                            前月担当履歴：{r.baseline.effectiveFrom}から
                          </small>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="assignment-actions">
              <button
                className="button"
                disabled={page <= 0}
                onClick={() => setPage(page - 1)}
              >
                前へ
              </button>
              <span>
                {Math.min(page, pages - 1) + 1} / {pages}ページ（
                {filtered.length}件）
              </span>
              <button
                className="button"
                disabled={page >= pages - 1}
                onClick={() => setPage(page + 1)}
              >
                次へ
              </button>
            </div>
            <p>
              100件ずつ保存します。途中で失敗しても保存済みの履歴は保持されます。タスク・商談の担当は、下の引き継ぎ画面で選択するまで変わりません。
            </p>
            <button
              className="button primary"
              disabled={!selected.size}
              onClick={() => void run(apply)}
            >
              <CheckCircle2 size={16} />
              選択した{selected.size}件に担当変更を反映
            </button>
          </section>
        )}
      </fieldset>
      <section className="panel">
        <h3>
          <History size={18} /> 保存履歴・仕事の引き継ぎ
        </h3>
        <p>
          保存履歴を30回ずつ表示します。適用日を迎えた現在の担当変更から、公開の未完了タスク・進行中商談を選んで引き継げます。議事録は同じアカウントに残ります。
        </p>
        <button
          className="button"
          disabled={busy}
          onClick={() => void run(refreshHistory)}
        >
          担当変更の履歴を更新
        </button>
        {historyNext && (
          <button
            className="button"
            disabled={busy}
            onClick={() => void run(() => refreshHistory(historyNext))}
          >
            以前の担当変更履歴を読み込む
          </button>
        )}
        <label>
          保存した担当変更
          <select
            value={runId}
            aria-label="保存した担当変更"
            disabled={busy}
            onChange={(e) => {
              setRunId(e.target.value);
              setWork(null);
              setAudit(false);
            }}
          >
            <option value="">選択してください</option>
            {history.map((r) => (
              <option key={r.id} value={r.id}>
                {r.effectiveFrom}適用 · {r.count}件 ·{" "}
                {new Date(r.createdAt).toLocaleString("ja-JP")}
              </option>
            ))}
          </select>
        </label>
        {activeRun && (
          <AccountSearch
            label="引き継ぐアカウント"
            accounts={activeRun.accountIds.map((id) => ({
              id,
              name: real.get(id)?.name || id,
            }))}
            value={work?.assignment.accountId || ""}
            disabled={busy}
            onChange={(id) => {
              if (id)
                void run(() =>
                  loadWork(
                    activeRun.assignmentIds[activeRun.accountIds.indexOf(id)],
                  ),
                );
              else setWork(null);
            }}
          />
        )}
        {work && (
          <div className="assignment-work">
            <h4>
              {work.assignment.before.ownerName || "前任不明"} →{" "}
              {work.assignment.ownerName}
            </h4>
            <p>
              複数担当タスクは前任だけを後任に置き換え、共同担当者を保持します。完了済み・非公開タスクは変更しません。Drive原本の閲覧権限はGoogle側で確認してください。
              同日の担当を修正した場合、修正前の担当者の仕事も候補に含みます。
            </p>
            {!work.assignment.ownerId && (
              <p className="form-error">
                後任がメンバーに紐付いていません。同じ適用日で紐付けを修正してから引き継いでください。
              </p>
            )}
            {!work.current ? (
              <p>
                現在有効な担当変更ではありません。仕事の引き継ぎは、適用日を迎えた最新の担当変更を選択してください。
              </p>
            ) : (
              !work.items.length && <p>引き継ぎ対象の仕事はありません。</p>
            )}
            {work.more && (
              <p>
                対象が500件を超えています。表示中の仕事を引き継ぎ後、残りを再取得できます。
              </p>
            )}
            {work.items.map((i) => (
              <label className="assignment-check" key={i.kind + i.id}>
                <input
                  type="checkbox"
                  disabled={busy || !work.assignment.ownerId}
                  checked={workSelected.has(i.kind + i.id)}
                  onChange={(e) => {
                    const next = new Set(workSelected);
                    if (e.target.checked) next.add(i.kind + i.id);
                    else next.delete(i.kind + i.id);
                    setWorkSelected(next);
                  }}
                />
                {i.kind === "tasks" ? "タスク" : "商談"}：{i.title}
              </label>
            ))}
            <button
              className="button primary"
              disabled={
                busy ||
                !workSelected.size ||
                workSelected.size > 50 ||
                !work.assignment.ownerId
              }
              onClick={() =>
                void run(async () => {
                  const id = work.assignment.id;
                  await api("/sales/assignments/work", "POST", {
                    assignmentId: id,
                    version: work.assignment.version,
                    items: work.items.filter((i) =>
                      workSelected.has(i.kind + i.id),
                    ),
                  });
                  await loadWork(id);
                  await onRefresh();
                  setMessage("選択した仕事を後任に引き継ぎました。");
                })
              }
            >
              選択した仕事を引き継ぐ（最大50件）
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => setAudit(!audit)}
            >
              担当履歴の変更記録
            </button>
            {audit && (
              <AuditHistory
                request={api}
                kind="accountAssignments"
                recordId={work.assignment.id}
                members={data.members}
              />
            )}
          </div>
        )}
      </section>
    </section>
  );
}
