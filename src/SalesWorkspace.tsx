import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
  type ButtonHTMLAttributes,
} from "react";
import {
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Download,
  FileText,
  FolderSync,
  History,
  Link2,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Upload,
  Users,
  X,
  AlertTriangle,
  Phone,
  MessageSquare,
  ExternalLink,
} from "lucide-react";
import type { Data, Task } from "./types";
import type {
  SalesData,
  SalesAccount,
  SalesReview,
  SalesMaster,
  SalesOpportunity,
  SalesMinute,
  SalesMedia,
  ImportPreview,
} from "./sales-types";
import "./sales.css";
import { OrganizationSelect, AuditHistory } from "./WorkspaceAdmin";
import { MinuteNumbers } from "./MinuteNumbers";

type Props = {
  data: Data;
  api: <T = any>(path: string, method?: string, body?: unknown) => Promise<T>;
  onOpenTask: (task: Task) => void;
  onTasksChanged: () => Promise<unknown>;
};
type Dialog = {
  version?: number;
  type:
    | "account"
    | "review"
    | "opportunity"
    | "minute"
    | "minuteDetail"
    | "task"
    | "activity";
  id?: string;
  accountId?: string;
  actionIndex?: number;
};
const today = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
const weekMonday = (date = today()) => {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
const yen = (v: number | null | undefined) =>
  v === null || v === undefined
    ? "—"
    : new Intl.NumberFormat("ja-JP", {
        style: "currency",
        currency: "JPY",
        maximumFractionDigits: 0,
      }).format(v);
const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${Math.round(v * 10) / 10}%`;
const sum = (values: (number | null | undefined)[]) => {
  const valid = values.filter(
    (v): v is number => v !== null && v !== undefined,
  );
  return valid.length ? valid.reduce((a, b) => a + b, 0) : null;
};
const calcCpa = (m: {
  spend: number | null;
  cv: number | null;
  cpa: number | null;
}) => (m.spend !== null && m.cv !== null && m.cv > 0 ? m.spend / m.cv : m.cpa);
const blankMedia = (): SalesMedia => ({
  stanby: { budget: null, spend: null, cv: null, cpa: null, hires: null },
  indeed: {
    budget: null,
    spend: null,
    cv: null,
    cpa: null,
    hires: null,
    months: null,
  },
  box: {
    budget: null,
    spend: null,
    cv: null,
    cpa: null,
    hires: null,
    months: null,
  },
  acceptableCpa: null,
});
const STAGES = {
  discovery: "課題ヒアリング",
  proposal: "提案・見積",
  negotiation: "条件合意・稟議",
  won: "受注",
  lost: "失注",
};
const emptySales: SalesData = {
  accounts: [],
  masters: [],
  reviews: [],
  opportunities: [],
  minutes: [],
  activities: [],
  imports: [],
  connections: {
    sheetsConfigured: false,
    geminiConfigured: false,
    geminiModel: "",
    autoSummaryEnabled: false,
    source: null,
  },
  history: [],
};

const SalesEditContext = createContext<{
  setDirty: (dirty: boolean) => void;
  setSaving: (saving: boolean) => void;
  navigate: (action: () => void) => void;
} | null>(null);

function GuardedSalesButton({
  onClick,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
  onClick: () => void;
}) {
  const edit = useContext(SalesEditContext);
  return (
    <button
      {...props}
      type="button"
      onClick={() => (edit ? edit.navigate(onClick) : onClick())}
    />
  );
}

function formSnapshot(form: HTMLFormElement | null) {
  return JSON.stringify(
    Array.from(
      form?.querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >("input,textarea,select") || [],
    ).map((field) =>
      field instanceof HTMLInputElement &&
      ["checkbox", "radio"].includes(field.type)
        ? field.checked
        : field.value,
    ),
  );
}

function SalesModal({
  title,
  close,
  children,
  wide = false,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const ref = useRef<HTMLDivElement>(null),
    closeRef = useRef(close);
  const navigate = (action: () => void) => {
    if (saving) return;
    if (dirty) setPendingAction(() => action);
    else action();
  };
  closeRef.current = () =>
    pendingAction ? setPendingAction(null) : navigate(close);
  useEffect(() => {
    if (pendingAction) continueRef.current?.focus();
  }, [pendingAction]);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
      }
      if (e.key === "Tab") {
        const els = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea,a[href]",
          ) || [],
        ).filter((x) => x.getClientRects().length);
        if (!els.length) return;
        if (
          e.shiftKey &&
          (document.activeElement === els[0] ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          els.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === els.at(-1)) {
          e.preventDefault();
          els[0].focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", key);
      prior?.focus();
    };
  }, []);
  return (
    <SalesEditContext.Provider value={{ setDirty, setSaving, navigate }}>
      <div className="overlay sales-overlay">
        <div
          className={`modal sales-modal ${wide ? "wide" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          ref={ref}
          tabIndex={-1}
        >
          <header>
            <h2>{title}</h2>
            <button
              type="button"
              className="icon-button"
              aria-label="閉じる"
              disabled={saving}
              onClick={() => navigate(close)}
            >
              <X size={20} />
            </button>
          </header>
          {pendingAction && (
            <div className="sales-discard-notice" role="alert">
              <div>
                <strong>保存していない変更があります</strong>
                <p>入力を続けるか、変更を破棄して移動してください。</p>
              </div>
              <div>
                <button
                  className="button primary"
                  type="button"
                  ref={continueRef}
                  onClick={() => setPendingAction(null)}
                >
                  入力を続ける
                </button>
                <button
                  className="button"
                  type="button"
                  onClick={() => {
                    const action = pendingAction;
                    setPendingAction(null);
                    action();
                  }}
                >
                  変更を破棄して移動
                </button>
              </div>
            </div>
          )}
          {children}
        </div>
      </div>
    </SalesEditContext.Provider>
  );
}
function SalesForm({
  children,
  submit,
  label = "保存する",
}: {
  children: ReactNode;
  submit: (data: Record<string, FormDataEntryValue>) => Promise<void>;
  label?: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const baseline = useRef("");
  const edit = useContext(SalesEditContext);
  useLayoutEffect(() => {
    baseline.current = formSnapshot(formRef.current);
  }, []);
  useEffect(() => {
    edit?.setDirty(formSnapshot(formRef.current) !== baseline.current);
  });
  return (
    <form
      className="standard-form sales-form"
      ref={formRef}
      aria-busy={busy}
      onChangeCapture={() =>
        edit?.setDirty(formSnapshot(formRef.current) !== baseline.current)
      }
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const body = Object.fromEntries(new FormData(e.currentTarget));
        setBusy(true);
        edit?.setSaving(true);
        setError("");
        try {
          await submit(body);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
          edit?.setSaving(false);
        }
      }}
    >
      {children}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="form-actions">
        <button className="button primary" disabled={busy}>
          {busy ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Check size={16} />
          )}{" "}
          {label}
        </button>
      </div>
    </form>
  );
}
function Num({
  label,
  name,
  value,
}: {
  label: string;
  name: string;
  value?: number | null;
}) {
  return (
    <label>
      {label}
      <input
        aria-label={label}
        name={name}
        type="number"
        min="0"
        step="any"
        defaultValue={value ?? ""}
        placeholder="未入力"
      />
    </label>
  );
}
function AccountSelect({
  accounts,
  selected,
}: {
  accounts: SalesAccount[];
  selected?: string;
}) {
  return (
    <label>
      アカウント
      <select
        name="accountId"
        aria-label="アカウント"
        required
        defaultValue={selected || ""}
      >
        <option value="" disabled>
          選択してください
        </option>
        {accounts.map((a) => (
          <option value={a.id} key={a.id}>
            {a.name} / {a.id}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function SalesWorkspace({
  data,
  api,
  onOpenTask,
  onTasksChanged,
}: Props) {
  const [sales, setSales] = useState<SalesData>(emptySales),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [tab, setTab] = useState("summary");
  const [month, setMonth] = useState(today().slice(0, 7)),
    [week, setWeek] = useState(weekMonday()),
    [search, setSearch] = useState(""),
    [minuteSearch, setMinuteSearch] = useState(""),
    [owner, setOwner] = useState("all"),
    [accountScope, setAccountScope] = useState("active"),
    [dataScope, setDataScope] = useState("auto"),
    [onlyMissing, setOnlyMissing] = useState(false),
    [dialog, setDialog] = useState<Dialog | null>(null);
  const [importText, setImportText] = useState(""),
    [preview, setPreview] = useState<ImportPreview | null>(null),
    [mapping, setMapping] = useState<Record<string, string | number>>({}),
    [mappingDirty, setMappingDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [seedReviews, setSeedReviews] = useState(false);
  const admin = data.user.role === "admin";
  const [connectionPreview, setConnectionPreview] = useState<
    | (ImportPreview & { sourceName: string; range: string; checkedAt: string })
    | null
  >(null);
  const activePeriod = useRef("");
  activePeriod.current = `${month}/${week}`;
  const hasDemo = sales.accounts.some((a) => a.isDemo);
  const effectiveScope =
    dataScope === "auto"
      ? sales.accounts.some((a) => !a.isDemo)
        ? "real"
        : hasDemo
          ? "demo"
          : "real"
      : dataScope;
  const scopedAccounts = sales.accounts.filter((a) =>
    effectiveScope === "demo" ? a.isDemo : !a.isDemo,
  );
  const scopedIds = new Set(scopedAccounts.map((a) => a.id));
  const visibleHistory = sales.history.filter((h) =>
    scopedIds.has(h.accountId),
  );
  const changeMonth = (value: string) => {
    setMonth(value);
    const period = sales.demoPeriods?.find((p) => p.month === value);
    if (effectiveScope === "demo" && period) setWeek(period.reportWeek);
  };
  const load = async () => {
    const requestedPeriod = `${month}/${week}`;
    try {
      const result = await api<SalesData>(
        `/sales/bootstrap?month=${month}&weekOf=${week}`,
      );
      if (activePeriod.current !== requestedPeriod) return result;
      setSales(result);
      setError("");
      return result;
    } catch (e) {
      if (activePeriod.current === requestedPeriod)
        setError((e as Error).message);
      throw e;
    } finally {
      if (activePeriod.current === requestedPeriod) setLoading(false);
    }
  };
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api<SalesData>(`/sales/bootstrap?month=${month}&weekOf=${week}`)
      .then((d) => {
        if (alive) {
          setSales(d);
          setError("");
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    const timer = setInterval(() => {
      if (!document.hidden) load().catch(() => {});
    }, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [month, week]);
  async function perform(
    path: string,
    body: unknown,
    notice = "保存しました",
    method = "POST",
  ) {
    const result = await api("/sales" + path, method, body);
    await load();
    setMessage(notice);
    return result;
  }
  async function action(fn: () => Promise<unknown>) {
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
  const latest = (aid: string, before = week) =>
    sales.reviews
      .filter((r) => r.accountId === aid && r.weekOf <= before)
      .sort((a, b) => b.weekOf.localeCompare(a.weekOf))[0];
  const previousWeek = new Date(week + "T00:00:00Z");
  previousWeek.setUTCDate(previousWeek.getUTCDate() - 7);
  const previous = (aid: string) =>
    latest(aid, previousWeek.toISOString().slice(0, 10));
  const master = (aid: string) =>
    sales.masters.find((m) => m.accountId === aid);
  const ownerName = (a: SalesAccount) =>
    data.members.find((m) => m.id === a.ownerId)?.name ||
    a.ownerName ||
    "未割り当て";
  const accounts = scopedAccounts.filter(
    (a) =>
      (accountScope === "all" ||
        !["解約", "停止", "休止", "利用停止"].includes(a.status)) &&
      (!search ||
        [a.id, a.name, a.category, a.agency, ownerName(a)]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (owner === "all" ||
        (owner === "me"
          ? a.ownerId === data.user.id
          : owner === "unassigned"
            ? !a.ownerId
            : a.ownerId === owner)) &&
      (!onlyMissing ||
        latest(a.id)?.weekOf !== week ||
        latest(a.id)?.forecast == null),
  );
  const forecast = sum(accounts.map((a) => latest(a.id)?.forecast));
  const target = sum(accounts.map((a) => master(a.id)?.target));
  const completeNumbers =
    accounts.length > 0 &&
    accounts.every(
      (a) => master(a.id)?.target != null && latest(a.id)?.forecast != null,
    );
  const trend = sum(accounts.map((a) => master(a.id)?.gTrend));
  const actual = sum(
    accounts.map(
      (a) =>
        master(a.id)?.media.stanby.spend ?? latest(a.id)?.media.stanby.spend,
    ),
  );
  const filled = accounts.filter(
    (a) => latest(a.id)?.weekOf === week && latest(a.id)?.forecast != null,
  ).length;
  const periodOpportunities = sales.opportunities.filter(
    (o) =>
      o.expectedCloseDate.slice(0, 7) === month &&
      accounts.some((a) => a.id === o.accountId),
  );
  const weighted = sum(
    periodOpportunities
      .filter((o) => o.stage !== "lost")
      .map((o) => ((o.amount ?? 0) * (o.probability ?? 0)) / 100),
  );
  const risks = (a: SalesAccount) => {
    const r = latest(a.id),
      m = master(a.id);
    const result: string[] = [];
    if (!r || r.weekOf !== week || r.forecast === null)
      result.push("当週ヨミ未入力");
    if (r?.forecast !== null && r?.forecast !== undefined && !r.reason)
      result.push("ヨミ根拠なし");
    if (
      !a.lastContactAt ||
      Math.round(
        (Date.parse(today()) - Date.parse(a.lastContactAt)) / 86400000,
      ) > 14
    )
      result.push("接点未記録・14日超");
    if (m?.importedAt && Date.now() - Date.parse(m.importedAt) > 36 * 3600000)
      result.push("マスタ36時間超");
    if (m?.target != null && r?.forecast != null && r.forecast < m.target)
      result.push("目標ギャップ");
    if (m?.gTrend === 0 && (r?.forecast ?? 0) > 0) result.push("Gトレ0を確認");
    if (!a.ownerId) result.push("担当者の紐付け待ち");
    const media = r?.media || m?.media;
    if (media) {
      const cpa = calcCpa(media.stanby);
      if (
        cpa !== null &&
        media.acceptableCpa !== null &&
        cpa > media.acceptableCpa
      )
        result.push("許容CPA超過");
    }
    return result;
  };
  const selectedAccount = sales.accounts.find(
    (a) => a.id === dialog?.accountId,
  );
  const selectedMinute = sales.minutes.find((m) => m.id === dialog?.id);
  const normalizedMinuteSearch = minuteSearch
    .trim()
    .normalize("NFKC")
    .toLocaleLowerCase();
  const visibleMinutes = sales.minutes
    .filter(
      (m) =>
        scopedIds.has(m.accountId) &&
        (effectiveScope !== "demo" ||
          (m.targetMonth || m.meetingDate.slice(0, 7)) === month),
    )
    .filter((minute) => {
      const account = sales.accounts.find(
        (item) => item.id === minute.accountId,
      );
      return (
        !normalizedMinuteSearch ||
        [
          minute.title,
          minute.text,
          minute.summary?.overview,
          minute.accountId,
          account?.name,
        ]
          .join(" ")
          .normalize("NFKC")
          .toLocaleLowerCase()
          .includes(normalizedMinuteSearch)
      );
    })
    .sort((a, b) => b.meetingDate.localeCompare(a.meetingDate));
  const selectedOpportunity = sales.opportunities.find(
    (o) => o.id === dialog?.id,
  );
  const close = () => setDialog(null);
  const newTask = (a: SalesAccount, title?: string) =>
    setDialog({ type: "task", accountId: a.id, id: title });
  const openTask = (id: string) => {
    const t = data.tasks.find((t) => t.id === id);
    if (t) {
      close();
      onOpenTask(t);
    } else
      setError(
        "タスク情報を再取得してください。削除されている可能性があります。",
      );
  };
  async function readFile(
    file: File | undefined,
    setter: (text: string) => void,
    max = 1800000,
  ) {
    if (!file) return;
    if (file.size > max) {
      setError("ファイルが大きすぎます。内容を分けてください。");
      return;
    }
    setter(await file.text());
  }
  const exportData = () =>
    action(async () => {
      const result = await api<{ csv: string; filename: string }>(
        `/sales/export?month=${month}&weekOf=${week}&scope=${effectiveScope}`,
      );
      const url = URL.createObjectURL(
        new Blob([result.csv], { type: "text/csv;charset=utf-8" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  const addDemo = () =>
    action(async () => {
      const result = await perform(
        "/demo",
        {},
        "3か月分の架空データを追加しました。実データは変更していません。",
      );
      await onTasksChanged();
      setDataScope("demo");
      setMonth(today().slice(0, 7));
      setWeek(weekMonday());
      setSearch("");
      setMinuteSearch("");
      setOnlyMissing(false);
      setOwner("all");
      setTab("summary");
      if (result.totalCreated === 0)
        setMessage(
          "登録済みのデモを表示しています。編集した内容は保持しています。",
        );
    });
  return (
    <div className="sales-workspace">
      <div className="page-heading">
        <div>
          <span className="eyebrow">REVENUE & RELATIONSHIPS</span>
          <h1>
            営業・数字管理 <span className="sales-beta">STANBY</span>
          </h1>
          <p>数字の変化から、顧客への次の一手まで。</p>
        </div>
        <div className="sales-heading-actions">
          {admin && (
            <button
              className="button"
              disabled={busy || loading}
              onClick={addDemo}
            >
              3か月デモを追加
            </button>
          )}
          <button className="button" onClick={exportData} disabled={busy}>
            <Download size={15} />
            週次CSV
          </button>
          <button
            className="button primary"
            onClick={() => setDialog({ type: "account" })}
          >
            <Plus size={15} />
            アカウント追加
          </button>
        </div>
      </div>
      <div className="sales-period">
        <label>
          表示データ
          <select
            aria-label="表示データ"
            value={effectiveScope}
            onChange={(e) => {
              setDataScope(e.target.value);
              setSearch("");
              setMinuteSearch("");
              setOnlyMissing(false);
              setOwner("all");
              if (e.target.value === "demo")
                setWeek(
                  sales.demoPeriods?.find((p) => p.month === month)
                    ?.reportWeek || weekMonday(),
                );
            }}
          >
            <option value="real">実データ</option>
            <option value="demo" disabled={!hasDemo}>
              デモデータ
            </option>
          </select>
        </label>
        <label>
          対象月
          <input
            aria-label="対象月"
            type="month"
            value={month}
            onChange={(e) => {
              if (e.target.value) changeMonth(e.target.value);
            }}
          />
        </label>
        <label>
          週次会議の週
          <input
            aria-label="週次会議の週"
            type="date"
            value={week}
            onChange={(e) => {
              if (e.target.value) setWeek(weekMonday(e.target.value));
            }}
          />
        </label>
        <span>
          <CalendarDays size={14} />
          月曜日を基準に履歴を比較
        </span>
        <button
          className="icon-button"
          aria-label="営業データを再読み込み"
          onClick={() => load().catch(() => {})}
        >
          <RefreshCw size={17} />
        </button>
      </div>
      {effectiveScope === "demo" && hasDemo && (
        <section className="sales-demo-banner" aria-label="デモデータの案内">
          <div>
            <strong>架空の営業データを表示中</strong>
            <p>
              6アカウントの目標・ヨミ・競合指標を確認できます。前月は締め結果、当月は進捗、翌月は計画です。
            </p>
          </div>
          <div
            className="sales-demo-months"
            role="group"
            aria-label="デモの対象月"
          >
            {sales.demoPeriods?.map((p) => (
              <button
                key={p.month}
                className={`button ${month === p.month ? "primary" : ""}`}
                aria-pressed={month === p.month}
                onClick={() => {
                  setMonth(p.month);
                  setWeek(p.reportWeek);
                }}
              >
                {p.offset < 0 ? "前月" : p.offset > 0 ? "翌月" : "当月"} ·{" "}
                {p.month}
              </button>
            ))}
          </div>
          <small>
            当月は1件の当週未更新、CPA超過、目標未達を含みます。翌月の消化実績は未発生のため空欄です。デモのCSVは実データと分けて出力します。
          </small>
        </section>
      )}
      <nav className="sales-tabs" aria-label="営業管理ビュー">
        {[
          { id: "summary", label: "営業サマリー", icon: BarChart3 },
          { id: "reviews", label: "週次ヨミ", icon: TrendingUp },
          { id: "opportunities", label: "商談", icon: BriefcaseBusiness },
          { id: "minutes", label: "議事録", icon: FileText },
          { id: "connections", label: "データ連携", icon: FolderSync },
        ].map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "active" : ""}
            onClick={() => {
              setTab(t.id);
              setError("");
            }}
          >
            <t.icon size={16} />
            {t.label}
          </button>
        ))}
      </nav>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="sales-notice" role="status">
          <CheckCircle2 size={16} />
          {message}
          <button
            className="icon-button"
            aria-label="メッセージを閉じる"
            onClick={() => setMessage("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {loading ? (
        <div className="sales-loading">
          <LoaderCircle className="spin" />
          営業データを読み込み中…
        </div>
      ) : (
        <>
          {!sales.accounts.length && tab !== "connections" && (
            <section className="sales-empty panel">
              <div className="sales-empty-mark">
                <BarChart3 size={32} />
              </div>
              <span className="eyebrow">ONE ACCOUNT, ONE STORY</span>
              <h2>顧客の数字と、チームの動きをひとつに。</h2>
              <p>
                スプレッドシートを取り込むか、アカウントを登録して始めましょう。
                <br />
                ヨミ・競合指標・商談・議事録が、同じアカウントにつながります。
              </p>
              <div>
                <button
                  className="button primary"
                  onClick={() => setTab("connections")}
                >
                  <Upload size={16} />
                  マスタを取り込む
                </button>
                {admin && (
                  <button className="button" disabled={busy} onClick={addDemo}>
                    サンプルで試す
                  </button>
                )}
              </div>
              <small>
                3か月分の架空データです。実データと切り替えて表示できます。
              </small>
            </section>
          )}
          {sales.accounts.length > 0 &&
            ["summary", "reviews", "opportunities"].includes(tab) && (
              <div className="sales-filter">
                <div className="sales-search">
                  <Search size={15} />
                  <input
                    aria-label="営業アカウントを検索"
                    placeholder="アカウント・担当者・カテゴリを検索"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <select
                  aria-label="営業担当者で絞り込み"
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                >
                  <option value="all">すべての担当者</option>
                  <option value="me">自分の担当</option>
                  <option value="unassigned">紐付け未設定</option>
                  {data.members
                    .filter((m) => m.active)
                    .map((m) => (
                      <option value={m.id} key={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
                <select
                  aria-label="アカウントの状態で絞り込み"
                  value={accountScope}
                  onChange={(e) => setAccountScope(e.target.value)}
                >
                  <option value="active">解約・休止を除く</option>
                  <option value="all">すべての状態</option>
                </select>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={onlyMissing}
                    onChange={(e) => setOnlyMissing(e.target.checked)}
                  />
                  当週未入力のみ
                </label>
                <span>{accounts.length} アカウント</span>
              </div>
            )}
          {tab === "summary" && sales.accounts.length > 0 && (
            <>
              <div className="sales-kpis">
                {[
                  {
                    title: "当月目標",
                    value: yen(target),
                    icon: Target,
                    note: `目標設定 ${accounts.filter((a) => master(a.id)?.target != null).length} / ${accounts.length} 件`,
                  },
                  {
                    title: "担当者の着地ヨミ",
                    value: yen(forecast),
                    icon: TrendingUp,
                    note: `当週入力 ${filled} / ${accounts.length} 件 · 過去入力の引継ぎを含む`,
                  },
                  {
                    title: "目標との差",
                    value:
                      completeNumbers && target !== null && forecast !== null
                        ? yen(forecast - target)
                        : "—",
                    icon: BarChart3,
                    note: completeNumbers
                      ? "ヨミ − 目標（表示対象全件）"
                      : "目標・ヨミが全件揃うと差分を算定します",
                    warn:
                      target !== null && forecast !== null && forecast < target,
                  },
                  {
                    title: "確度加重パイプライン",
                    value: yen(weighted),
                    icon: BriefcaseBusiness,
                    note: "商談金額 × 確度。ヨミには加算しません",
                  },
                ].map((k) => (
                  <div
                    className={`sales-kpi ${k.warn ? "warning" : ""}`}
                    key={k.title}
                  >
                    <span>
                      <k.icon size={17} />
                      {k.title}
                    </span>
                    <strong>{k.value}</strong>
                    <small>{k.note}</small>
                  </div>
                ))}
              </div>
              <div className="sales-summary-grid">
                <section className="panel sales-progress-panel">
                  <div className="section-heading">
                    <h2>当月の着地を見渡す</h2>
                    <span className="pill sage">{month}</span>
                  </div>
                  {[
                    { name: "目標", value: target, color: "target" },
                    { name: "Gトレ", value: trend, color: "trend" },
                    { name: "ヨミ", value: forecast, color: "forecast" },
                    {
                      name: "スタンバイ消化実績",
                      value: actual,
                      color: "actual",
                    },
                  ].map((item) => (
                    <div className="sales-chart-row" key={item.name}>
                      <label>{item.name}</label>
                      <div>
                        <i
                          className={item.color}
                          style={{
                            width: `${Math.min(100, Math.max(0, ((item.value || 0) / Math.max(target || 0, trend || 0, forecast || 0, actual || 0, 1)) * 100))}%`,
                          }}
                        />
                      </div>
                      <strong>{yen(item.value)}</strong>
                    </div>
                  ))}
                  <p>
                    Gトレ＝当月消化額の着地予測。ヨミは担当者判断による月全体の予測です。
                  </p>
                  <div className="sales-coverage">
                    <span>当週のヨミ入力率</span>
                    <strong>
                      {accounts.length
                        ? Math.round((filled / accounts.length) * 100)
                        : 0}
                      %
                    </strong>
                    <div>
                      <i
                        style={{
                          width: `${accounts.length ? (filled / accounts.length) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                </section>
                <section className="panel sales-health-panel">
                  <div className="section-heading">
                    <h2>先に確認したいこと</h2>
                    <AlertTriangle size={17} />
                  </div>
                  {accounts
                    .filter((a) => risks(a).length)
                    .slice(0, 5)
                    .map((a) => (
                      <button
                        className="sales-health-row"
                        key={a.id}
                        onClick={() =>
                          setDialog({ type: "review", accountId: a.id })
                        }
                      >
                        <span>
                          <strong>{a.name}</strong>
                          <small>{risks(a).slice(0, 3).join(" · ")}</small>
                        </span>
                        <ChevronRight size={15} />
                      </button>
                    ))}
                  {!accounts.some((a) => risks(a).length) && (
                    <p className="sales-muted">確認対象はありません。</p>
                  )}
                </section>
              </div>
              <div className="sales-section-title">
                <h2>アカウント別の見通し</h2>
                <button
                  className="text-button"
                  onClick={() => setTab("reviews")}
                >
                  週次ヨミを入力 <ArrowRight size={14} />
                </button>
              </div>
              {accountTable()}
              <section className="panel sales-actions-panel">
                <div className="section-heading">
                  <h2>当月の行動と、次のタスク</h2>
                  <button
                    className="button compact"
                    onClick={() => setDialog({ type: "activity" })}
                  >
                    <Plus size={14} />
                    行動を記録
                  </button>
                </div>
                <div className="sales-activity-kpis">
                  {[
                    { type: "call", label: "架電・接点", icon: Phone },
                    { type: "meeting", label: "商談・訪問", icon: Users },
                    { type: "proposal", label: "提案", icon: FileText },
                  ].map((k) => (
                    <div key={k.type}>
                      <k.icon size={17} />
                      <span>{k.label}</span>
                      <strong>
                        {
                          sales.activities.filter(
                            (a) =>
                              a.type === k.type &&
                              a.date.slice(0, 7) === month &&
                              accounts.some((x) => x.id === a.accountId),
                          ).length
                        }
                        <small>件</small>
                      </strong>
                    </div>
                  ))}
                  <div>
                    <CheckCircle2 size={17} />
                    <span>営業タスク完了</span>
                    <strong>
                      {
                        data.tasks.filter(
                          (t) =>
                            t.accountId &&
                            accounts.some((a) => a.id === t.accountId) &&
                            t.status === "done",
                        ).length
                      }
                      <small>件（累計）</small>
                    </strong>
                  </div>
                </div>
                <div className="sales-next-tasks">
                  {data.tasks
                    .filter(
                      (t) =>
                        t.accountId &&
                        t.status !== "done" &&
                        accounts.some((a) => a.id === t.accountId),
                    )
                    .slice(0, 6)
                    .map((t) => (
                      <button key={t.id} onClick={() => onOpenTask(t)}>
                        <CheckCircle2 size={15} />
                        <span>{t.title}</span>
                        <small>
                          {
                            sales.accounts.find((a) => a.id === t.accountId)
                              ?.name
                          }
                        </small>
                        <ChevronRight size={13} />
                      </button>
                    ))}
                </div>
                <p className="sales-muted">
                  行動記録は自己申告です。商談・議事録の登録件数を架電や提案件数として自動加算しません。
                </p>
              </section>
            </>
          )}
          {tab === "reviews" && sales.accounts.length > 0 && (
            <>
              <div className="sales-week-note">
                <History size={18} />
                <div>
                  <strong>{week} の週次レビュー</strong>
                  <p>
                    未入力のアカウントは直近週を参考表示します。保存するとこの週の履歴として残り、前週は変わりません。
                  </p>
                </div>
                <span className="pill sage">
                  {filled} / {accounts.length} 入力済み
                </span>
              </div>
              {accountTable()}
              <div className="sales-section-title">
                <h2>ヨミの変更履歴</h2>
                <span>根拠と変更者を保存</span>
              </div>
              <div className="panel sales-history">
                {visibleHistory.slice(0, 12).map((h, i) => (
                  <div key={i}>
                    <History size={14} />
                    <span>
                      <strong>
                        {sales.accounts.find((a) => a.id === h.accountId)
                          ?.name || h.accountId}
                      </strong>
                      <small>
                        {h.weekOf} ·{" "}
                        {data.members.find((m) => m.id === h.updatedBy)?.name ||
                          "メンバー"}{" "}
                        · {new Date(h.updatedAt).toLocaleString("ja-JP")}
                      </small>
                    </span>
                    <span>{h.reason || "根拠未入力"}</span>
                    <strong>{yen(h.forecast)}</strong>
                  </div>
                ))}
                {!visibleHistory.length && (
                  <p className="sales-muted">
                    ヨミを保存すると変更履歴が表示されます。
                  </p>
                )}
              </div>
            </>
          )}
          {tab === "opportunities" && (
            <>
              <div className="sales-section-title">
                <div>
                  <h2>商談パイプライン</h2>
                  <p>
                    受注予定月が {month}{" "}
                    の商談。増額・新規案件のプロセスを管理します。
                  </p>
                </div>
                <button
                  className="button primary"
                  disabled={!sales.accounts.length}
                  onClick={() => setDialog({ type: "opportunity" })}
                >
                  <Plus size={15} />
                  商談を登録
                </button>
              </div>
              <div className="sales-pipeline">
                {Object.entries(STAGES).map(([stage, label]) => (
                  <section key={stage}>
                    <header>
                      <i className={`sales-stage-dot ${stage}`} />
                      {label}
                      <span>
                        {
                          periodOpportunities.filter((o) => o.stage === stage)
                            .length
                        }
                      </span>
                    </header>
                    {periodOpportunities
                      .filter((o) => o.stage === stage)
                      .map((o) => (
                        <button
                          className="sales-deal"
                          key={o.id}
                          onClick={() =>
                            setDialog({
                              type: "opportunity",
                              id: o.id,
                              accountId: o.accountId,
                              version: o.version,
                            })
                          }
                        >
                          <small>
                            {
                              sales.accounts.find((a) => a.id === o.accountId)
                                ?.name
                            }
                          </small>
                          <strong>{o.title}</strong>
                          <div>
                            <b>{yen(o.amount)}</b>
                            <span>{pct(o.probability)}</span>
                          </div>
                          <p>{o.nextAction || "次のアクション未入力"}</p>
                          <footer>
                            <CalendarDays size={12} />
                            {o.expectedCloseDate}
                            <span>
                              {data.members.find((m) => m.id === o.ownerId)
                                ?.name || "未割り当て"}
                            </span>
                          </footer>
                        </button>
                      ))}
                    <p className="sales-stage-help">
                      {stage === "discovery"
                        ? "課題・予算・意思決定者を確認"
                        : stage === "proposal"
                          ? "提案書や見積を顧客へ提出済み"
                          : stage === "negotiation"
                            ? "条件確認・決裁プロセスへ"
                            : stage === "won"
                              ? "顧客の発注意思を確認済み"
                              : "見送り理由を次回の学びへ"}
                    </p>
                  </section>
                ))}
              </div>
              <p className="sales-muted">
                フェーズの基準を統一します。確度は0〜100%で入力し、受注は100%、失注は0%です。月次ヨミと案件金額は別集計です。
              </p>
            </>
          )}
          {tab === "minutes" && (
            <>
              <div className="sales-section-title">
                <div>
                  <h2>議事録ライブラリ</h2>
                  <p>原文と要約を並べ、決定事項を次の行動につなげます。</p>
                </div>
                <button
                  className="button primary"
                  disabled={!sales.accounts.length}
                  onClick={() => setDialog({ type: "minute" })}
                >
                  <Plus size={15} />
                  議事録を保存
                </button>
              </div>
              <div className="sales-ai-state">
                <Sparkles size={17} />
                <span>
                  {sales.connections.geminiConfigured
                    ? `Gemini連携設定あり · ${sales.connections.geminiModel}`
                    : "Gemini未設定 · 原文保存とローカル要点抽出を利用可能"}
                </span>
                <small>要約の提案は、確認してからタスク化</small>
              </div>
              <div className="sales-minute-search">
                <label>
                  <Search size={17} />
                  <input
                    type="search"
                    aria-label="議事録を検索"
                    value={minuteSearch}
                    onChange={(event) => setMinuteSearch(event.target.value)}
                    placeholder="タイトル・本文・アカウント名で検索"
                  />
                </label>
                <span aria-live="polite">
                  {visibleMinutes.length} / {sales.minutes.length} 件 ·
                  商談日の新しい順
                </span>
                {minuteSearch && (
                  <button
                    className="text-button"
                    onClick={() => setMinuteSearch("")}
                  >
                    検索を解除
                  </button>
                )}
              </div>
              <div className="sales-minute-grid">
                {visibleMinutes.map((m) => (
                  <button
                    className="panel sales-minute-card"
                    key={m.id}
                    onClick={() =>
                      setDialog({
                        type: "minuteDetail",
                        id: m.id,
                        accountId: m.accountId,
                      })
                    }
                  >
                    <header>
                      <span className="project-icon sage">
                        <FileText size={21} />
                      </span>
                      <span
                        className={`pill ${m.status === "failed" ? "peach" : "neutral"}`}
                      >
                        {
                          (
                            {
                              saved: "原文保存済み",
                              pending: "要約待機中",
                              processing: "要約中",
                              completed: "要約済み",
                              failed: "要約エラー",
                            } as const
                          )[m.status]
                        }
                      </span>
                    </header>
                    <small>
                      {sales.accounts.find((a) => a.id === m.accountId)?.name}
                    </small>
                    <h3>{m.title}</h3>
                    <p>{m.summary?.overview || m.text}</p>
                    <footer>
                      <CalendarDays size={13} />
                      {m.meetingDate}
                      <span>{m.taskLinks.length} タスク化</span>
                    </footer>
                  </button>
                ))}
              </div>
              {sales.minutes.length > 0 && !visibleMinutes.length && (
                <div className="sales-empty panel">
                  <Search size={28} />
                  <h2>一致する議事録がありません</h2>
                  <p>顧客名や本文のキーワードを変えて検索してください。</p>
                </div>
              )}
              {!sales.minutes.length && (
                <div className="sales-empty panel">
                  <FileText size={30} />
                  <h2>商談の記録を、チームの資産に。</h2>
                  <p>
                    テキストの貼り付け、または .txt / .md
                    のファイルから保存できます。
                  </p>
                </div>
              )}
            </>
          )}
          {tab === "connections" && (
            <>
              <section className="sales-connection-top">
                <div>
                  <span className="eyebrow">A RELIABLE SOURCE OF TRUTH</span>
                  <h2>スプシをつなぐ。入力を守る。</h2>
                  <p>
                    マスタは日次で更新。担当者のヨミと議事録は、Worknestに履歴として残ります。
                  </p>
                </div>
                <ShieldCheck size={38} />
              </section>
              <div className="sales-connect-grid">
                <section className="panel sales-import-panel">
                  <div className="section-heading">
                    <h2>
                      <Upload size={18} />
                      CSV・スプシ貼り付け取込
                    </h2>
                    <span className="pill neutral">対象月 {month}</span>
                  </div>
                  <p>
                    見出しを含めてコピーしてください。CSV /
                    TSVの改行入りセルに対応しています。
                  </p>
                  <label className="sales-file-input">
                    <Upload size={15} />
                    CSV / TSV / テキストを選択
                    <input
                      aria-label="営業マスタファイル"
                      type="file"
                      accept=".csv,.tsv,.txt"
                      onChange={(e) =>
                        readFile(e.target.files?.[0], (t) => {
                          setImportText(t);
                          setPreview(null);
                          setMapping({});
                        })
                      }
                    />
                  </label>
                  <textarea
                    aria-label="営業マスタ貼り付け"
                    placeholder={
                      "アカウントID\tアカウント名\t今週Gトレ\t今月ヨミ\n…"
                    }
                    value={importText}
                    onChange={(e) => {
                      setImportText(e.target.value);
                      setPreview(null);
                    }}
                    rows={6}
                  />
                  <div className="sales-import-actions">
                    <button
                      className="button"
                      disabled={!importText || busy}
                      onClick={() =>
                        action(async () => {
                          const p = await api<ImportPreview>(
                            "/sales/imports/preview",
                            "POST",
                            { text: importText, month, mapping },
                          );
                          setPreview(p);
                          setMapping(p.mapping);
                          setMappingDirty(false);
                        })
                      }
                    >
                      <Search size={14} />
                      取込内容を確認
                    </button>
                    <small>この操作ではまだ保存されません。</small>
                  </div>
                  {preview && (
                    <div className="sales-preview">
                      <h3>{preview.count} 件のプレビュー</h3>
                      <details>
                        <summary>列の対応を確認・変更する</summary>
                        <div className="sales-mapping-grid">
                          {(
                            (
                              preview as ImportPreview & {
                                fieldOptions?: { key: string; label: string }[];
                              }
                            ).fieldOptions ||
                            Object.keys(mapping).map((key) => ({
                              key,
                              label: key,
                            }))
                          ).map((f) => (
                            <label key={f.key}>
                              {f.label}
                              <select
                                aria-label={`対応列 ${f.label}`}
                                value={mapping[f.key] ?? ""}
                                onChange={(e) => {
                                  setMappingDirty(true);
                                  setMapping({
                                    ...mapping,
                                    [f.key]:
                                      e.target.value === ""
                                        ? ""
                                        : Number(e.target.value),
                                  });
                                }}
                              >
                                <option value="">取り込まない</option>
                                {preview.headers.map((h, i) => (
                                  <option key={i} value={i}>
                                    {h.replace(/\n/g, " ")}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ))}
                        </div>
                        <p>
                          変更後は「取込内容を確認」をもう一度押してください。
                        </p>
                      </details>
                      {preview.errors.map((e, i) => (
                        <p className="sales-preview-error" key={i}>
                          {e}
                        </p>
                      ))}
                      {preview.warnings.slice(0, 6).map((w, i) => (
                        <p className="sales-preview-warning" key={i}>
                          {w}
                        </p>
                      ))}
                      <div className="sales-preview-rows">
                        {preview.rows.slice(0, 5).map((r) => (
                          <div key={r.accountId}>
                            <code>{r.accountId}</code>
                            <span>{r.name}</span>
                            <small>
                              {yen(r.gTrend as number | null)} Gトレ
                            </small>
                          </div>
                        ))}
                      </div>
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={seedReviews}
                          onChange={(e) => setSeedReviews(e.target.checked)}
                        />
                        初回移行：未登録の当週ヨミだけスプシから補完する
                      </label>
                      <button
                        className="button primary"
                        disabled={
                          !admin ||
                          busy ||
                          mappingDirty ||
                          preview.errors.length > 0
                        }
                        onClick={() =>
                          action(async () => {
                            await perform(
                              "/imports/commit",
                              {
                                text: importText,
                                month,
                                mapping,
                                sourceName: "手動取込",
                                seedReviews,
                              },
                              "マスタを取り込みました。入力済みのヨミは保持しています。",
                            );
                            setPreview(null);
                            setImportText("");
                          })
                        }
                      >
                        <Check size={15} />
                        この内容で取り込む
                      </button>
                    </div>
                  )}
                  {!admin && (
                    <p className="sales-muted">
                      マスタの確定取込は管理者が実行できます。
                    </p>
                  )}
                </section>
                <section className="panel sales-google-panel">
                  <div className="section-heading">
                    <h2>
                      <FolderSync size={18} />
                      Google Sheets 日次同期
                    </h2>
                    <span
                      className={`pill ${sales.connections.sheetsConfigured ? "sage" : "neutral"}`}
                    >
                      {sales.connections.sheetsConfigured
                        ? "資格情報設定あり"
                        : "資格情報未設定"}
                    </span>
                  </div>
                  <p>
                    非公開スプレッドシートを読み取り専用で取得します。スプシの更新完了後になるよう毎日の同期時刻を設定してください。サーバー稼働中に実行し、入力済みのヨミは保持します。
                  </p>
                  <SalesForm
                    key={sales.connections.source?.spreadsheetId || "source"}
                    label="接続設定を保存"
                    submit={async (fields) => {
                      if (!admin) throw Error("管理者のみ設定できます。");
                      await perform(
                        "/connections",
                        {
                          ...fields,
                          month,
                          enabled: fields.enabled === "on",
                          rollingMonth: fields.rollingMonth === "on",
                          mapping:
                            fields.usePreviewMapping === "on" &&
                            preview &&
                            !mappingDirty
                              ? Object.fromEntries(
                                  Object.entries(mapping).map(([k, v]) => [
                                    k,
                                    v === "" ? "" : preview.headers[Number(v)],
                                  ]),
                                )
                              : sales.connections.source?.spreadsheetId ===
                                  fields.spreadsheetId
                                ? sales.connections.source.mapping
                                : {},
                        },
                        "接続設定を保存しました",
                      );
                      setConnectionPreview(null);
                    }}
                  >
                    <label>
                      接続名
                      <input
                        name="name"
                        defaultValue={
                          sales.connections.source?.name || "営業マスタ"
                        }
                        required
                      />
                    </label>
                    <label className="check-label">
                      <input
                        name="usePreviewMapping"
                        type="checkbox"
                        disabled={
                          !preview || mappingDirty || preview.errors.length > 0
                        }
                      />
                      確認済みプレビューの列対応を日次同期にも適用
                    </label>
                    <label>
                      スプレッドシートID
                      <input
                        name="spreadsheetId"
                        aria-label="スプレッドシートID"
                        defaultValue={sales.connections.source?.spreadsheetId}
                        placeholder="URLの /d/ と /edit の間のID"
                        required
                      />
                    </label>
                    <label>
                      取得範囲（見出し行を含む）
                      <input
                        name="range"
                        aria-label="取得範囲"
                        defaultValue={
                          sales.connections.source?.range ||
                          "営業マスタ!A1:AZ5000"
                        }
                        required
                      />
                    </label>
                    <label>
                      毎日の同期時刻（日本時間）
                      <input
                        aria-label="毎日の同期時刻"
                        name="syncTime"
                        type="time"
                        required
                        defaultValue={
                          sales.connections.source?.syncTime || "06:00"
                        }
                      />
                    </label>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        name="rollingMonth"
                        defaultChecked={
                          sales.connections.source?.rollingMonth ?? true
                        }
                      />
                      対象月を毎月自動で切り替える
                    </label>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        name="enabled"
                        defaultChecked={
                          sales.connections.source?.enabled ?? false
                        }
                      />
                      日次同期を有効にする
                    </label>
                  </SalesForm>
                  <button
                    className="button"
                    disabled={
                      !admin ||
                      busy ||
                      !sales.connections.sheetsConfigured ||
                      !sales.connections.source
                    }
                    onClick={() =>
                      action(async () => {
                        setConnectionPreview(
                          await api("/sales/connections/preview", "POST", {}),
                        );
                      })
                    }
                  >
                    保存済み接続をプレビュー
                  </button>
                  {connectionPreview && (
                    <div className="info-box connection-preview">
                      <div>
                        <strong>
                          {connectionPreview.sourceName} ·{" "}
                          {connectionPreview.range} · {connectionPreview.count}
                          件
                        </strong>
                        <p>確認のみで、業務データはまだ更新していません。</p>
                        {connectionPreview.errors.map((e, i) => (
                          <p className="form-error" key={i}>
                            {e}
                          </p>
                        ))}
                        {connectionPreview.warnings.map((w, i) => (
                          <p key={i}>{w}</p>
                        ))}
                        <ul>
                          {connectionPreview.rows.slice(0, 5).map((r) => (
                            <li key={r.accountId}>
                              {r.accountId} / {r.name} / Gトレ{" "}
                              {r.gTrend == null
                                ? "未入力"
                                : Number(r.gTrend).toLocaleString("ja-JP") +
                                  "円"}
                            </li>
                          ))}
                        </ul>
                        <p>
                          先頭5件を表示。列が合わない場合は、取込プレビューで列対応を確認し、接続設定へ適用してください。
                        </p>
                      </div>
                    </div>
                  )}
                  <div className="sales-sync-state">
                    <span>最終成功</span>
                    <strong>
                      {sales.connections.source?.lastSuccessAt
                        ? new Date(
                            sales.connections.source.lastSuccessAt,
                          ).toLocaleString("ja-JP")
                        : "未実行"}
                    </strong>
                    <span>
                      日次同期：
                      {sales.connections.source?.enabled
                        ? `毎日 ${sales.connections.source.syncTime || "06:00"}（日本時間）`
                        : "無効"}
                      。手動同期は日次実行とは別に利用できます。
                    </span>
                    {sales.connections.source?.lastError && (
                      <p className="form-error">
                        {sales.connections.source.lastError}
                      </p>
                    )}
                    <button
                      className="button"
                      disabled={
                        !admin ||
                        !sales.connections.sheetsConfigured ||
                        !sales.connections.source ||
                        busy
                      }
                      onClick={() =>
                        action(() =>
                          perform(
                            "/connections/sync",
                            {},
                            "日次マスタの同期が完了しました",
                          ),
                        )
                      }
                    >
                      <RefreshCw size={15} />
                      今すぐ同期
                    </button>
                  </div>
                  <p className="sales-muted">
                    サービスアカウントのJSONをサーバーに設定し、対象スプシをそのメールアドレスに「閲覧者」で共有してください。キーをこの画面に貼り付ける必要はありません。
                  </p>
                </section>
              </div>
              <section className="panel sales-ai-config">
                <div className="section-heading">
                  <h2>
                    <Sparkles size={19} />
                    Googleドキュメント・Gemini連携
                  </h2>
                  <span
                    className={`pill ${sales.connections.geminiConfigured ? "sage" : "neutral"}`}
                  >
                    {sales.connections.geminiConfigured ? "設定あり" : "未設定"}
                  </span>
                </div>
                <p>
                  サーバー環境変数 <code>GEMINI_API_KEY</code> と{" "}
                  <code>GEMINI_MODEL</code> を設定すると利用できます。
                  <code>GEMINI_AUTO_SUMMARY=true</code>{" "}
                  で保存後の自動要約を有効にできます。
                </p>
                <p>
                  Google Drive
                  APIを有効化し、議事録をサービスアカウントのメールアドレスへ閲覧共有してください。Sheetsと同じ{" "}
                  <code>GOOGLE_SERVICE_ACCOUNT_FILE</code>{" "}
                  を使用します。議事録登録でGoogleドキュメントURLを指定できます。
                </p>
                <p>
                  数値抽出は標準で1日20回までです。
                  <code>GEMINI_DAILY_EXTRACTIONS</code>{" "}
                  で上限を設定できます。無料枠のあるモデルとGoogle側の割当量を確認してください。無料枠の残量取得や課金停止はGoogle側で管理します。
                </p>
                <p>
                  無料枠では入力内容がGoogleの製品改善に利用される条件があります。顧客の機密情報を扱う場合は社内の取扱基準に合わせて設定してください。
                  <a
                    href="https://ai.google.dev/gemini-api/docs/pricing"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Googleの料金・データ利用条件
                  </a>
                </p>
                <div className="sales-ai-detail">
                  <span>
                    現在のモデル{" "}
                    <strong>{sales.connections.geminiModel || "未設定"}</strong>
                  </span>
                  <span>
                    保存後の自動要約{" "}
                    <strong>
                      {sales.connections.autoSummaryEnabled ? "有効" : "無効"}
                    </strong>
                  </span>
                </div>
                <p>
                  Gemini設定時は議事録本文をGoogleへ送信します。未設定時の要点整理はローカルのキーワード抽出です。要約は原文と照合し、担当者・期限を確認してからタスク化してください。
                </p>
              </section>
              <section className="panel sales-import-log">
                <div className="section-heading">
                  <h2>取込・同期履歴</h2>
                  <span className="sales-muted">失敗時は既存マスタを保持</span>
                </div>
                {sales.imports.slice(0, 10).map((log) => (
                  <div key={log.id}>
                    <span
                      className={`pill ${log.status === "success" ? "sage" : "peach"}`}
                    >
                      {log.status === "success" ? "成功" : "失敗"}
                    </span>
                    <strong>{log.sourceName}</strong>
                    <span>
                      {new Date(log.createdAt).toLocaleString("ja-JP")}
                    </span>
                    <small>
                      {log.status === "success"
                        ? `新規 ${log.created} / 更新 ${log.updated}`
                        : log.errors.join(" / ")}
                    </small>
                  </div>
                ))}
              </section>
            </>
          )}
        </>
      )}
      {dialog?.type === "account" && (
        <SalesModal
          title={selectedAccount ? "アカウント設定" : "アカウントを追加"}
          close={close}
        >
          <SalesForm
            submit={async (fields) => {
              await perform(
                selectedAccount
                  ? `/accounts/${encodeURIComponent(selectedAccount.id)}`
                  : "/accounts",
                { ...fields, version: dialog.version },
                "アカウントを保存しました",
                selectedAccount ? "PATCH" : "POST",
              );
              close();
            }}
          >
            <label>
              アカウントID
              <input
                name="id"
                defaultValue={selectedAccount?.id}
                readOnly={!!selectedAccount}
                placeholder="スプシと共通のID"
                required
              />
            </label>
            <label>
              アカウント名
              <input
                name="name"
                defaultValue={selectedAccount?.name}
                required
              />
            </label>
            <div className="form-grid">
              <label>
                ステータス
                <select
                  name="status"
                  aria-label="アカウントステータス"
                  defaultValue={selectedAccount?.status || "利用中"}
                >
                  <option>利用中</option>
                  <option>商談中</option>
                  <option>解約</option>
                  <option>停止中</option>
                </select>
              </label>
              <label>
                カテゴリ
                <input
                  name="category"
                  defaultValue={selectedAccount?.category}
                  placeholder="TOP30 / D&E"
                />
              </label>
            </div>
            <label>
              社内担当者
              <select
                name="ownerId"
                aria-label="社内担当者"
                defaultValue={selectedAccount?.ownerId || ""}
              >
                <option value="">未割り当て</option>
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
              取込元の担当者名
              <input
                name="ownerName"
                defaultValue={selectedAccount?.ownerName}
              />
            </label>
            <label>
              担当組織
              <OrganizationSelect
                units={data.orgUnits || []}
                name="orgUnitId"
                defaultValue={selectedAccount?.orgUnitId || ""}
              />
              <small>
                取込元のグループ：{selectedAccount?.group || "未設定"}
                。組織は「メンバー」で登録できます。
              </small>
            </label>
            <label>
              代理店・取引先
              <input name="agency" defaultValue={selectedAccount?.agency} />
            </label>
            <label>
              タスクの既定プロジェクト
              <select
                name="projectId"
                aria-label="タスクの既定プロジェクト"
                defaultValue={selectedAccount?.projectId || ""}
              >
                <option value="">作成時に選ぶ</option>
                {data.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              最終接点日
              <input
                name="lastContactAt"
                type="date"
                defaultValue={selectedAccount?.lastContactAt}
              />
            </label>
          </SalesForm>
        </SalesModal>
      )}
      {dialog?.type === "review" && selectedAccount && (
        <ReviewDialog
          key={`${selectedAccount.id}:${week}`}
          account={selectedAccount}
          review={latest(selectedAccount.id)}
          previous={previous(selectedAccount.id)}
          master={master(selectedAccount.id)}
          month={month}
          week={week}
          close={close}
          save={async (body) => {
            await perform("/reviews", body, "週次ヨミと競合指標を保存しました");
            close();
          }}
          onSettings={() =>
            setDialog({
              type: "account",
              accountId: selectedAccount.id,
              version: selectedAccount.version,
            })
          }
          onTask={() =>
            newTask(selectedAccount, latest(selectedAccount.id)?.nextAction)
          }
          tasks={data.tasks.filter((t) => t.accountId === selectedAccount.id)}
          openTask={openTask}
        />
      )}
      {dialog?.type === "opportunity" && (
        <SalesModal
          title={selectedOpportunity ? "商談を更新" : "商談を登録"}
          close={close}
        >
          <SalesForm
            submit={async (fields) => {
              await perform(
                selectedOpportunity
                  ? `/opportunities/${selectedOpportunity.id}`
                  : "/opportunities",
                { ...fields, version: dialog.version },
                "商談を保存しました",
                selectedOpportunity ? "PATCH" : "POST",
              );
              close();
            }}
          >
            <AccountSelect
              accounts={scopedAccounts}
              selected={dialog.accountId}
            />
            <label>
              商談名
              <input
                name="title"
                required
                defaultValue={selectedOpportunity?.title}
              />
            </label>
            <div className="form-grid">
              <Num
                name="amount"
                label="商談金額（円）"
                value={selectedOpportunity?.amount}
              />
              <Num
                name="probability"
                label="受注確度（%）"
                value={selectedOpportunity?.probability}
              />
            </div>
            <label>
              フェーズ
              <select
                name="stage"
                aria-label="フェーズ"
                defaultValue={selectedOpportunity?.stage || "discovery"}
              >
                {Object.entries(STAGES).map(([key, value]) => (
                  <option key={key} value={key}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              受注予定日
              <input
                name="expectedCloseDate"
                type="date"
                defaultValue={
                  selectedOpportunity?.expectedCloseDate || `${month}-28`
                }
                required
              />
            </label>
            <label>
              担当者
              <select
                name="ownerId"
                aria-label="商談担当者"
                defaultValue={selectedOpportunity?.ownerId || data.user.id}
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
              次のアクション
              <textarea
                aria-label="商談の次のアクション"
                name="nextAction"
                defaultValue={selectedOpportunity?.nextAction}
              />
            </label>
            <label>
              最終商談日
              <input
                name="lastActivityAt"
                type="date"
                defaultValue={selectedOpportunity?.lastActivityAt || today()}
              />
            </label>
          </SalesForm>
        </SalesModal>
      )}
      {dialog?.type === "activity" && (
        <SalesModal title="営業行動を記録" close={close}>
          <SalesForm
            submit={async (fields) => {
              await perform("/activities", fields, "営業行動を記録しました");
              close();
            }}
          >
            <AccountSelect
              accounts={scopedAccounts}
              selected={dialog.accountId}
            />
            <label>
              行動の種類
              <select name="type" aria-label="行動の種類">
                <option value="call">架電・接点</option>
                <option value="meeting">商談・訪問</option>
                <option value="proposal">提案</option>
              </select>
            </label>
            <label>
              実施日
              <input type="date" name="date" defaultValue={today()} required />
            </label>
            <label>
              メモ
              <textarea name="notes" rows={4} />
            </label>
          </SalesForm>
        </SalesModal>
      )}
      {dialog?.type === "minute" && (
        <MinuteForm
          accounts={scopedAccounts}
          sales={sales}
          selected={dialog.accountId}
          close={close}
          save={async (fields) => {
            await perform("/minutes", fields, "議事録の原文を保存しました");
            close();
          }}
        />
      )}
      {dialog?.type === "minuteDetail" && selectedMinute && (
        <SalesModal title={selectedMinute.title} close={close} wide>
          <div className="sales-minute-detail">
            <div className="sales-minute-meta">
              {selectedMinute.supersededBy && (
                <button
                  className="button"
                  onClick={() =>
                    setDialog({
                      type: "minuteDetail",
                      id: selectedMinute.supersededBy,
                    })
                  }
                >
                  次の改訂版へ
                </button>
              )}
              {selectedMinute.previousMinuteId && (
                <button
                  className="button"
                  onClick={() =>
                    setDialog({
                      type: "minuteDetail",
                      id: selectedMinute.previousMinuteId,
                    })
                  }
                >
                  改訂前の原文・要約へ
                </button>
              )}
              <span>
                {
                  sales.accounts.find((a) => a.id === selectedMinute.accountId)
                    ?.name
                }
              </span>
              <span>{selectedMinute.meetingDate}</span>
              {selectedMinute.sourceUrl && (
                <a
                  href={selectedMinute.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  元資料 <ExternalLink size={12} />
                </a>
              )}
            </div>
            <div className="sales-minute-detail-toolbar">
              {selectedMinute.googleFileId && !selectedMinute.supersededBy && (
                <button
                  className="button"
                  disabled={
                    busy ||
                    ["pending", "processing"].includes(selectedMinute.status) ||
                    ["pending", "processing"].includes(
                      selectedMinute.extraction?.status || "",
                    )
                  }
                  onClick={() =>
                    action(async () => {
                      const result = await perform(
                        `/minutes/${selectedMinute.id}/refresh`,
                        { version: selectedMinute.version },
                        "Googleドキュメントを確認しました。変更があれば改訂版を保存します。",
                      );
                      if (result.minute)
                        setDialog({
                          type: "minuteDetail",
                          id: result.minute.id,
                        });
                    })
                  }
                >
                  Googleから更新
                </button>
              )}
              <span className="pill sage">
                {selectedMinute.summaryProvider === "gemini"
                  ? "Gemini要約"
                  : selectedMinute.summaryProvider === "local"
                    ? "ローカル要点抽出"
                    : "原文保存済み"}
              </span>
              <button
                className="button"
                disabled={
                  busy ||
                  ["processing", "pending"].includes(selectedMinute.status) ||
                  selectedMinute.taskLinks.length > 0
                }
                onClick={() =>
                  action(() =>
                    perform(
                      `/minutes/${selectedMinute.id}/summarize`,
                      {},
                      "要約処理を開始しました",
                    ),
                  )
                }
              >
                <Sparkles size={15} />
                {["processing", "pending"].includes(selectedMinute.status)
                  ? "要約中…"
                  : "要約を作成・再実行"}
              </button>
            </div>
            {selectedMinute.googleFileId && (
              <p className="sales-muted">
                最終取得：
                {selectedMinute.lastSyncedAt
                  ? new Date(selectedMinute.lastSyncedAt).toLocaleString(
                      "ja-JP",
                    )
                  : "—"}
                。変更前の原文・要約・タスクは改訂前の議事録に残ります。
              </p>
            )}
            <MinuteNumbers
              minute={selectedMinute}
              configured={sales.connections.geminiConfigured}
              request={api}
              update={(suffix, body) =>
                perform(
                  `/minutes/${selectedMinute.id}/${suffix}`,
                  body,
                  "数値抽出・反映の状態を更新しました",
                )
              }
            />
            {selectedMinute.summaryError && (
              <div className="form-error">{selectedMinute.summaryError}</div>
            )}
            {selectedMinute.summary && (
              <div className="sales-summary-content">
                <h3>サマリー</h3>
                <p>{selectedMinute.summary.overview}</p>
                <div className="form-grid">
                  <div>
                    <h3>決定事項</h3>
                    <ul>
                      {selectedMinute.summary.decisions.map((d, i) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3>課題・リスク</h3>
                    <ul>
                      {selectedMinute.summary.risks.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                <h3>次のアクション案</h3>
                <p className="sales-muted">
                  原文の根拠を確認し、作成するものだけ選択してください。
                </p>
                {selectedMinute.summary.actions.map((a, i) => {
                  const linked = selectedMinute.taskLinks.find(
                    (l) => l.actionIndex === i,
                  );
                  return (
                    <div className="sales-suggested-action" key={i}>
                      <div>
                        <strong>{a.title}</strong>
                        <blockquote>{a.evidence}</blockquote>
                        <small>
                          担当案: {a.ownerName || "未指定"} · 期限案:{" "}
                          {a.dueDate || "未指定"}
                        </small>
                      </div>
                      {linked ? (
                        <button
                          className="button"
                          onClick={() => openTask(linked.taskId)}
                        >
                          <Check size={14} />
                          タスクを開く
                        </button>
                      ) : (
                        <button
                          className="button"
                          disabled={selectedMinute.status !== "completed"}
                          onClick={() =>
                            setDialog({
                              type: "task",
                              accountId: selectedMinute.accountId,
                              id: selectedMinute.id,
                              actionIndex: i,
                              version: selectedMinute.version,
                            })
                          }
                        >
                          <Plus size={14} />
                          タスク化
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <AuditHistory
              request={api}
              kind="salesMinutes"
              recordId={selectedMinute.id}
              members={data.members}
            />
            <details className="sales-original" open={!selectedMinute.summary}>
              <summary>議事録の原文を読む</summary>
              <pre>{selectedMinute.text}</pre>
            </details>
          </div>
        </SalesModal>
      )}
      {dialog?.type === "task" && selectedAccount && (
        <SalesModal title="営業アクションをタスクにする" close={close}>
          <SalesForm
            label="タスクを作成"
            submit={async (fields) => {
              const fromMinute = dialog.actionIndex !== undefined;
              const result = await perform(
                fromMinute
                  ? `/minutes/${dialog.id}/tasks`
                  : `/accounts/${encodeURIComponent(selectedAccount.id)}/tasks`,
                {
                  ...fields,
                  actionIndex: dialog.actionIndex,
                  version: dialog.version,
                },
                "営業アカウントに紐づくタスクを作成しました",
              );
              await onTasksChanged();
              close();
            }}
          >
            <div className="info-box">
              <Link2 size={17} />
              {selectedAccount.name} に紐づけて管理します。
            </div>
            <label>
              タスク名
              <input
                name="title"
                required
                defaultValue={
                  dialog.actionIndex !== undefined
                    ? sales.minutes.find((m) => m.id === dialog.id)?.summary
                        ?.actions[dialog.actionIndex]?.title
                    : dialog.id || ""
                }
                readOnly={dialog.actionIndex !== undefined}
              />
            </label>
            <label>
              プロジェクト
              <select
                name="projectId"
                aria-label="営業タスクのプロジェクト"
                defaultValue={
                  selectedAccount.projectId || data.projects[0]?.id || ""
                }
                required
              >
                <option value="" disabled>
                  選択してください
                </option>
                {data.projects.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {!data.projects.length && (
              <p className="form-error">
                先にタスク管理側でプロジェクトを作成してください。
              </p>
            )}
            <label>
              担当者
              <select
                name="assigneeId"
                aria-label="営業タスクの担当者"
                defaultValue={selectedAccount.ownerId || data.user.id}
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
              期日
              <input name="dueDate" type="date" />
            </label>
            <label>
              補足
              <textarea name="description" rows={3} />
            </label>
          </SalesForm>
        </SalesModal>
      )}
    </div>
  );
  function accountTable() {
    return (
      <div className="panel sales-table-panel">
        <div className="sales-scroll-hint">
          <ArrowRight size={14} />
          横にスクロールして、ヨミ・前週差・入力状況を確認できます
        </div>
        <div
          className="sales-table-scroll"
          role="region"
          aria-label="週次ヨミの一覧。横スクロールできます"
          tabIndex={0}
        >
          <table className="sales-table">
            <thead>
              <tr>
                <th>アカウント / 担当者</th>
                <th>当月目標</th>
                <th>Gトレ</th>
                <th>着地ヨミ</th>
                <th>前週差</th>
                <th>アグレッシブ</th>
                <th>入力・状況</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const r = latest(a.id),
                  prev = previous(a.id),
                  m = master(a.id);
                return (
                  <tr key={a.id}>
                    <td>
                      <button
                        className="sales-account-button"
                        onClick={() =>
                          setDialog({ type: "review", accountId: a.id })
                        }
                      >
                        <span className="sales-account-monogram">
                          {a.name.replace("サンプル：", "").slice(0, 1)}
                        </span>
                        <span>
                          <strong>{a.name}</strong>
                          <small>
                            {a.id} · {ownerName(a)}
                          </small>
                        </span>
                      </button>
                    </td>
                    <td>{yen(m?.target)}</td>
                    <td>{yen(m?.gTrend)}</td>
                    <td className="sales-forecast-number">
                      {yen(r?.forecast)}
                    </td>
                    <td
                      className={
                        r?.forecast != null &&
                        prev?.forecast != null &&
                        r.forecast < prev.forecast
                          ? "sales-negative"
                          : ""
                      }
                    >
                      {r?.forecast != null && prev?.forecast != null
                        ? yen(r.forecast - prev.forecast)
                        : "—"}
                    </td>
                    <td>{yen(r?.aggressive)}</td>
                    <td>
                      <span
                        className={`pill ${r?.weekOf === week && r.forecast !== null ? "sage" : "peach"}`}
                      >
                        {r?.weekOf === week && r.forecast !== null
                          ? "当週入力済"
                          : r
                            ? "過去週・未入力"
                            : "未入力"}
                      </span>
                      {risks(a).length > 0 && (
                        <small className="sales-risk-caption">
                          {risks(a)[0]}
                        </small>
                      )}
                    </td>
                    <td>
                      <button
                        className="text-button"
                        onClick={() =>
                          setDialog({ type: "review", accountId: a.id })
                        }
                      >
                        入力 <ChevronRight size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!accounts.length && (
                <tr>
                  <td colSpan={8} className="sales-muted">
                    該当するアカウントがありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
}

function ReviewDialog({
  account,
  review,
  previous,
  master,
  month,
  week,
  close,
  save,
  onSettings,
  onTask,
  tasks,
  openTask,
}: {
  account: SalesAccount;
  review?: SalesReview;
  previous?: SalesReview;
  master?: SalesMaster;
  month: string;
  week: string;
  close: () => void;
  save: (body: unknown) => Promise<void>;
  onSettings: () => void;
  onTask: () => void;
  tasks: Task[];
  openTask: (id: string) => void;
}) {
  const baseline = useRef(review).current;
  const m = useRef(baseline?.media || master?.media || blankMedia()).current;
  const fields = ["budget", "spend", "cv", "cpa", "hires"] as const;
  const [mediaInputs, setMediaInputs] = useState(
    () =>
      Object.fromEntries(
        (["stanby", "indeed", "box"] as const).map((medium) => [
          medium,
          Object.fromEntries(
            fields.map((field) => [field, m[medium][field]?.toString() ?? ""]),
          ),
        ]),
      ) as Record<
        "stanby" | "indeed" | "box",
        Record<(typeof fields)[number], string>
      >,
  );
  const numericValue = (value: string) =>
    value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0
      ? Number(value)
      : null;
  const labels = {
    budget: "予算",
    spend: "消化額",
    cv: "CV数",
    cpa: "実測CPA",
    hires: "採用数",
  };
  return (
    <SalesModal
      title={`${account.name} · ${week} の週次入力`}
      close={close}
      wide
    >
      <div className="sales-review-top">
        <span>
          {account.id} · {account.category || "カテゴリ未設定"}
        </span>
        <GuardedSalesButton className="text-button" onClick={onSettings}>
          アカウント・担当者設定 <ChevronRight size={13} />
        </GuardedSalesButton>
      </div>
      <SalesForm
        label="この週のヨミを保存"
        submit={async (body) => {
          const media = blankMedia();
          for (const medium of ["stanby", "indeed", "box"] as const)
            for (const field of fields) {
              const value = body[`${medium}.${field}`];
              media[medium][field] = value === "" ? null : Number(value);
            }
          media.acceptableCpa =
            body.acceptableCpa === "" ? null : Number(body.acceptableCpa);
          for (const medium of ["indeed", "box"] as const)
            media[medium].months =
              body[`${medium}.months`] === ""
                ? null
                : Number(body[`${medium}.months`]);
          await save({
            ...body,
            accountId: account.id,
            month,
            weekOf: week,
            version: baseline?.weekOf === week ? baseline.version : undefined,
            media,
          });
        }}
      >
        {baseline?.version !== review?.version && (
          <div className="form-error">
            他のメンバーが更新しました。編集内容を控え、この画面を閉じて再度開いてください。
          </div>
        )}
        {review && review.weekOf !== week && (
          <div className="info-box">
            <History size={17} />
            {review.weekOf} の入力を引き継いでいます。保存すると {week}{" "}
            の記録になります。
          </div>
        )}
        <div className="sales-review-reference">
          <span>
            当月目標 <strong>{yen(master?.target)}</strong>
          </span>
          <span>
            Gトレ <strong>{yen(master?.gTrend)}</strong>
          </span>
          <span>
            前週ヨミ <strong>{yen(previous?.forecast)}</strong>
          </span>
        </div>
        <div className="form-grid">
          <Num
            name="forecast"
            label="今月ヨミ（円）"
            value={review?.forecast}
          />
          <Num
            name="aggressive"
            label="アグレッシブ（円）"
            value={review?.aggressive}
          />
        </div>
        <Num
          name="probability"
          label="アグレッシブの確度（%）"
          value={review?.probability}
        />
        <label>
          ヨミ根拠
          <textarea
            name="reason"
            aria-label="ヨミ根拠"
            defaultValue={review?.reason}
            rows={3}
            placeholder="顧客の合意状況、増減要因、未確定条件を記録"
          />
        </label>
        <label>
          今週やること
          <textarea
            name="nextAction"
            aria-label="今週やること"
            defaultValue={review?.nextAction}
            rows={2}
          />
        </label>
        <div className="form-grid">
          <label>
            顧客目標
            <textarea
              name="customerGoal"
              aria-label="顧客目標"
              defaultValue={review?.customerGoal || account.customerGoal}
            />
          </label>
          <label>
            顧客課題
            <textarea
              name="customerIssues"
              aria-label="顧客課題"
              defaultValue={review?.customerIssues || account.customerIssues}
            />
          </label>
        </div>
        <div className="form-grid">
          <label>
            ファネル位置
            <input
              name="funnel"
              defaultValue={review?.funnel}
              placeholder="例：2 目標合意・未達"
            />
          </label>
          <label>
            有効提案
            <select
              name="effectiveProposal"
              aria-label="有効提案"
              defaultValue={review?.effectiveProposal || "unknown"}
            >
              <option value="unknown">未確認</option>
              <option value="yes">あり</option>
              <option value="no">なし</option>
            </select>
          </label>
        </div>
        <label>
          予算動向
          <textarea
            name="budgetTrend"
            aria-label="予算動向"
            defaultValue={review?.budgetTrend}
            placeholder="増額・減額・据置の背景"
            rows={2}
          />
        </label>
        <section className="sales-media-section">
          <h3>媒体別の予算・CPA・採用実績</h3>
          <p>
            予算と実消化額を分けて入力。未取得の数字は空欄のまま残してください。
          </p>
          <label>
            情報の取得日
            <input
              name="observedAt"
              type="date"
              defaultValue={review?.observedAt || ""}
            />
          </label>
          <div className="sales-scroll-hint">
            <ArrowRight size={14} />
            横スクロールで媒体ごとの全項目を入力できます
          </div>
          <div
            className="sales-media-table"
            role="region"
            aria-label="媒体別の数値入力。横スクロールできます"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th>媒体</th>
                  {fields.map((f) => (
                    <th key={f}>
                      {labels[f]}
                      {f === "cpa" && <small>手入力</small>}
                    </th>
                  ))}
                  <th>
                    計算CPA<small>消化額 ÷ CV数</small>
                  </th>
                  <th>
                    採用単価<small>消化額 ÷ 採用数</small>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(["stanby", "indeed", "box"] as const).map((medium) => {
                  const spend = numericValue(mediaInputs[medium].spend);
                  const cv = numericValue(mediaInputs[medium].cv);
                  const hires = numericValue(mediaInputs[medium].hires);
                  const enteredCpa = numericValue(mediaInputs[medium].cpa);
                  const calculatedCpa =
                    spend !== null && cv !== null && cv > 0 ? spend / cv : null;
                  const hireCost =
                    spend !== null && hires !== null && hires > 0
                      ? spend / hires
                      : null;
                  return (
                    <tr key={medium}>
                      <th>
                        {medium === "stanby"
                          ? "スタンバイ"
                          : medium === "indeed"
                            ? "Indeed"
                            : "求人BOX"}
                      </th>
                      {fields.map((f) => (
                        <td key={f}>
                          <input
                            aria-label={`${medium} ${labels[f]}`}
                            name={`${medium}.${f}`}
                            type="number"
                            min="0"
                            step={f === "cv" || f === "hires" ? "1" : "any"}
                            value={mediaInputs[medium][f]}
                            onChange={(event) =>
                              setMediaInputs((values) => ({
                                ...values,
                                [medium]: {
                                  ...values[medium],
                                  [f]: event.target.value,
                                },
                              }))
                            }
                            placeholder="—"
                          />
                        </td>
                      ))}
                      <td
                        className="sales-calculated"
                        aria-label={`${medium} 計算CPA`}
                      >
                        <output>{yen(calculatedCpa)}</output>
                        {calculatedCpa !== null &&
                          enteredCpa !== null &&
                          Math.round(calculatedCpa) !==
                            Math.round(enteredCpa) && (
                            <small className="sales-number-difference">
                              手入力CPAと差異あり
                            </small>
                          )}
                        {cv === 0 && <small>CV 0件のため算出不可</small>}
                      </td>
                      <td
                        className="sales-calculated"
                        aria-label={`${medium} 計算採用単価`}
                      >
                        <output>{yen(hireCost)}</output>
                        {hires === 0 && <small>採用0件のため算出不可</small>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Num
            name="acceptableCpa"
            label="許容CPA（円）"
            value={m.acceptableCpa}
          />
          <div className="form-grid">
            <Num
              name="indeed.months"
              label="Indeed 継続月数"
              value={m.indeed.months}
            />
            <Num
              name="box.months"
              label="求人BOX 継続月数"
              value={m.box.months}
            />
          </div>
          <small>
            計算CPA・採用単価は入力中に再計算します。手入力CPAはそのまま保持します。CV・採用数が0または不明の場合は計算せず、消化額0円は0円として扱います。
          </small>
        </section>
      </SalesForm>
      {master?.raw && (
        <details className="sales-source-raw">
          <summary>取込元の補足・原文を確認</summary>
          <dl>
            {Object.entries(master.raw)
              .filter(([, v]) => v !== null && v !== "")
              .map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{String(v)}</dd>
                </div>
              ))}
          </dl>
        </details>
      )}
      <div className="sales-linked-tasks">
        <div className="section-heading">
          <h3>このアカウントのタスク</h3>
          <GuardedSalesButton className="button compact" onClick={onTask}>
            <Plus size={14} />
            次の行動をタスク化
          </GuardedSalesButton>
        </div>
        {tasks.map((t) => (
          <GuardedSalesButton
            className="sales-linked-task"
            key={t.id}
            onClick={() => openTask(t.id)}
          >
            <CheckCircle2 size={15} />
            <span>{t.title}</span>
            <small>
              {t.status === "done" ? "完了" : t.dueDate || "期日未設定"}
            </small>
            <ChevronRight size={13} />
          </GuardedSalesButton>
        ))}
        {!tasks.length && (
          <p className="sales-muted">
            営業タスクはプロジェクトのリスト・ボードにも同じデータで表示されます。
          </p>
        )}
      </div>
    </SalesModal>
  );
}
function MinuteForm({
  accounts,
  sales,
  selected,
  close,
  save,
}: {
  accounts: SalesAccount[];
  sales: SalesData;
  selected?: string;
  close: () => void;
  save: (body: unknown) => Promise<void>;
}) {
  const [body, setBody] = useState(""),
    [fileError, setFileError] = useState("");
  const [importGoogle, setImportGoogle] = useState(false);
  return (
    <SalesModal title="議事録を保存" close={close} wide>
      <SalesForm
        label="原文を保存"
        submit={async (fields) => {
          await save({
            ...fields,
            text: body,
            autoSummarize: fields.autoSummarize === "on",
            importGoogle,
            autoExtract: fields.autoExtract === "on",
            autoApplyNumbers: fields.autoApplyNumbers === "on",
          });
        }}
      >
        <AccountSelect accounts={accounts} selected={selected} />
        <label>
          登録方法
          <select
            aria-label="登録方法"
            value={importGoogle ? "google" : "manual"}
            onChange={(e) => setImportGoogle(e.target.value === "google")}
          >
            <option value="manual">本文を入力・ファイルから追加</option>
            <option
              value="google"
              disabled={!sales.connections.driveConfigured}
            >
              Googleドキュメントを読み込む
              {!sales.connections.driveConfigured ? "（サーバー未設定）" : ""}
            </option>
          </select>
        </label>
        <div className="form-grid">
          <label>
            議事録タイトル
            <input
              name="title"
              required={!importGoogle}
              placeholder={
                importGoogle
                  ? "空欄ならGoogleのタイトルを使用"
                  : "週次定例・予算提案"
              }
            />
          </label>
          <label>
            商談日
            <input
              name="meetingDate"
              type="date"
              required
              defaultValue={today()}
            />
          </label>
        </div>
        <div className="form-grid">
          <label>
            数字の対象月
            <input
              name="targetMonth"
              type="month"
              required
              defaultValue={today().slice(0, 7)}
            />
          </label>
          <label>
            ヨミの反映先の会議週（月曜日）
            <input
              name="reviewWeek"
              type="date"
              required
              defaultValue={weekMonday()}
            />
          </label>
        </div>
        <label>
          {importGoogle ? "GoogleドキュメントURL" : "関連資料URL"}
          <input
            name="sourceUrl"
            type="url"
            required={importGoogle}
            placeholder="https://docs.google.com/…"
          />
        </label>
        {!importGoogle && (
          <>
            <label className="sales-file-input">
              <Upload size={16} />
              テキストファイルから読み込む
              <input
                type="file"
                aria-label="議事録ファイル"
                accept=".txt,.md"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 300000) {
                    setFileError("ファイルは300KB以内にしてください。");
                    return;
                  }
                  const content = await file.text();
                  if (content.length > 80000) {
                    setFileError("本文は80,000文字以内にしてください。");
                    return;
                  }
                  setBody(content);
                  setFileError("");
                }}
              />
            </label>
            <label>
              議事録の原文
              <textarea
                aria-label="議事録の原文"
                value={body}
                required
                onChange={(e) => setBody(e.target.value)}
                maxLength={80000}
                rows={10}
                placeholder={"決定事項：…\n課題：…\n次のアクション：…"}
              />
            </label>
            {fileError && <div className="form-error">{fileError}</div>}
          </>
        )}
        {importGoogle && (
          <p className="sales-muted">
            サービスアカウントへ共有された文書を読み取ります。登録後は議事録詳細の「Googleから更新」で任意のタイミングに更新できます。
          </p>
        )}
        <label className="check-label">
          <input
            name="autoExtract"
            type="checkbox"
            disabled={!sales.connections.geminiConfigured}
            defaultChecked={sales.connections.geminiConfigured}
          />
          保存後にヨミ・競合数値をGeminiで抽出する
        </label>
        <label className="check-label">
          <input
            name="autoApplyNumbers"
            type="checkbox"
            disabled={!sales.connections.geminiConfigured}
          />
          当月の抽出値を未入力欄に自動反映する（入力済みの値は保持）
        </label>
        <label className="check-label">
          <input name="autoSummarize" type="checkbox" defaultChecked />
          保存後に要約・要点抽出を実行する
        </label>
        <div className="info-box">
          <Sparkles size={18} />
          <span>
            {sales.connections.geminiConfigured
              ? "Geminiに本文を送信し、決定事項・リスク・アクション案を作成します。"
              : "Gemini未設定のため、このサーバー内で本文のキーワードに基づく要点抽出を行います。AI要約ではありません。"}
            原文は保存され、提案されたタスクは確認後に作成します。
          </span>
        </div>
      </SalesForm>
    </SalesModal>
  );
}
