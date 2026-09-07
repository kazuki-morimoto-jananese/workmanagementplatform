import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowRight,
  BarChart3,
  Bell,
  CalendarDays,
  ChartNoAxesGantt,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  ExternalLink,
  FileText,
  Flag,
  FolderKanban,
  Globe2,
  GripVertical,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  Link2,
  List,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Megaphone,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  X,
  Zap,
} from "lucide-react";
import type {
  Data,
  Field,
  Member,
  Priority,
  Project,
  Rule,
  Status,
  Task,
} from "./types";
import SalesWorkspace from "./SalesWorkspace";
import { taskAssignees, organizationName, type OrgUnit } from "./types";
import {
  OrganizationPanel,
  OrganizationSelect,
  OperationsPanel,
  AuditHistory,
} from "./WorkspaceAdmin";

const STATUS: Record<Status, { label: string; color: string }> = {
  todo: { label: "未着手", color: "neutral" },
  progress: { label: "進行中", color: "blue" },
  review: { label: "レビュー待ち", color: "peach" },
  done: { label: "完了", color: "sage" },
};
const PRIORITY: Record<Priority, string> = {
  high: "高",
  medium: "中",
  low: "低",
};
const statusKeys = Object.keys(STATUS) as Status[];
const today = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
const fmtDate = (date: string) =>
  date
    ? new Date(date + "T00:00:00").toLocaleDateString("ja-JP", {
        month: "numeric",
        day: "numeric",
      })
    : "期日なし";
const relative = (date: string) => {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(date).getTime()) / 60000),
  );
  return minutes < 1
    ? "たった今"
    : minutes < 60
      ? `${minutes}分前`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}時間前`
        : `${Math.floor(minutes / 1440)}日前`;
};
const overdue = (task: Task) =>
  task.status !== "done" && !!task.dueDate && task.dueDate < today();
async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch("/api" + path, {
    method,
    headers:
      method === "GET"
        ? {}
        : { "Content-Type": "application/json", "X-Worknest": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== "/auth/login")
      window.dispatchEvent(new Event("session-expired"));
    throw new Error(result.error || "通信に失敗しました。");
  }
  return result;
}
function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand ${small ? "small" : ""}`}>
      <span className="brand-symbol">
        <svg viewBox="0 0 40 40" aria-hidden="true">
          <path d="m7 13 6 15 7-12 7 12 6-15" />
        </svg>
      </span>
      {!small && (
        <span>
          worknest<span className="brand-dot">.</span>
        </span>
      )}
    </span>
  );
}
function Avatar({ member, size = "sm" }: { member?: Member; size?: string }) {
  return (
    <span
      title={member?.name || "未割り当て"}
      className={`avatar avatar-${size} tone-${member ? member.name.charCodeAt(0) % 4 : 0}`}
    >
      {member ? member.name.slice(0, 1) : <Users size={13} />}
    </span>
  );
}
function ProjectIcon({ project }: { project: Partial<Project> }) {
  const Icon =
    project.icon === "globe"
      ? Globe2
      : project.icon === "megaphone"
        ? Megaphone
        : project.icon === "sparkles"
          ? Sparkles
          : project.icon === "inbox"
            ? Inbox
            : FolderKanban;
  return (
    <span className={`project-icon ${project.color || "sage"}`}>
      <Icon size={21} />
    </span>
  );
}
function Empty({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <CheckCheck size={30} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const items = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]',
          ) || [],
        ).filter((element) => element.getClientRects().length > 0);
        if (!items?.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-button" aria-label="閉じる" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
function Auth({ onLogin }: { onLogin: () => void }) {
  const [info, setInfo] = useState<{
    needsSetup: boolean;
    requiresSetupToken: boolean;
    allowedDomain: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api("/auth/status")
      .then(setInfo)
      .catch((e) => setError(e.message));
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const data = Object.fromEntries(form);
    setBusy(true);
    setError("");
    try {
      if (info?.needsSetup) {
        if (data.password !== data.confirm)
          throw new Error("パスワードが一致しません。");
        await api("/auth/setup", "POST", {
          ...data,
          samples: form.has("samples"),
        });
      }
      await api("/auth/login", "POST", {
        email: data.email,
        password: data.password,
      });
      onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <section className="auth-story">
        <Logo />
        <div className="auth-copy">
          <span className="eyebrow light">A LITTLE MORE TOGETHER</span>
          <h1>
            いいチームに、
            <br />
            いい仕事の流れを。
          </h1>
          <p>
            タスクも、アイデアも、次の一歩も。
            <br />
            チームの仕事が、ひとつにつながる場所。
          </p>
          <div className="auth-art">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="floating-card float-one">
              <span className="mini-check">
                <Check size={16} />
              </span>
              <div>
                新しいプロジェクトを始めよう
                <small>チームでつくる、次のカタチ</small>
              </div>
              <span className="tiny-avatar">W</span>
            </div>
            <div className="floating-card float-two">
              <span className="project-icon peach">
                <Flag size={20} />
              </span>
              <div>
                一歩ずつ、着実に。<small>プロジェクトは順調です</small>
              </div>
              <span className="pill sage">進行中</span>
            </div>
            <span className="art-spark">✳</span>
          </div>
        </div>
        <footer>
          WORK BETTER. TOGETHER.
          <span>© {new Date().getFullYear()} Worknest</span>
        </footer>
      </section>
      <section className="auth-form-side">
        <div className="auth-form-wrap">
          <span className="pill sage">
            <LockKeyhole size={13} /> 社内メンバー専用
          </span>
          <h2>
            {info?.needsSetup
              ? "チームの、新しいはじまり。"
              : "おかえりなさい。"}
          </h2>
          <p>
            {info?.needsSetup
              ? "最初の管理者アカウントを作成して、はじめましょう。"
              : "ログインして、今日の仕事をはじめましょう。"}
          </p>
          {!info && !error ? (
            <LoaderCircle className="spin" />
          ) : (
            <form onSubmit={submit}>
              {info?.needsSetup && (
                <>
                  <label>
                    ワークスペース名
                    <input
                      name="workspace"
                      placeholder="例：株式会社ワークネスト"
                      required
                      maxLength={80}
                    />
                  </label>
                  <label>
                    お名前
                    <input
                      name="name"
                      placeholder="例：山田 太郎"
                      required
                      autoComplete="name"
                      maxLength={80}
                    />
                  </label>
                </>
              )}
              <label>
                メールアドレス
                <input
                  name="email"
                  type="email"
                  placeholder={
                    info?.allowedDomain
                      ? `you@${info.allowedDomain}`
                      : "you@company.co.jp"
                  }
                  autoComplete="username"
                  required
                />
              </label>
              <label>
                パスワード
                <input
                  name="password"
                  type="password"
                  placeholder={
                    info?.needsSetup ? "12文字以上で入力" : "パスワードを入力"
                  }
                  autoComplete={
                    info?.needsSetup ? "new-password" : "current-password"
                  }
                  minLength={info?.needsSetup ? 12 : 1}
                  maxLength={256}
                  required
                />
              </label>
              {info?.needsSetup && (
                <>
                  <label>
                    パスワード（確認）
                    <input
                      name="confirm"
                      type="password"
                      required
                      minLength={12}
                      maxLength={256}
                      autoComplete="new-password"
                    />
                  </label>
                  {info.requiresSetupToken && (
                    <label>
                      初期設定トークン
                      <input name="setupToken" type="password" required />
                    </label>
                  )}
                  <label className="check-label">
                    <input type="checkbox" name="samples" defaultChecked />
                    使い方がわかるサンプルプロジェクトを追加
                  </label>
                </>
              )}
              {error && (
                <div role="alert" className="form-error">
                  {error}
                </div>
              )}
              <button
                className="button primary auth-submit"
                disabled={busy || !info}
              >
                {busy ? (
                  <LoaderCircle size={18} className="spin" />
                ) : info?.needsSetup ? (
                  "ワークスペースを作成"
                ) : (
                  "ログイン"
                )}
                <ArrowRight size={17} />
              </button>
            </form>
          )}
          <div className="auth-note">
            <ShieldCheck size={17} />
            <span>
              {info?.needsSetup
                ? "登録後、管理画面から社内メンバーを追加できます。"
                : "アカウントの発行・再設定は社内の管理者にご連絡ください。"}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [logged, setLogged] = useState(false);
  const [data, setData] = useState<Data | null>(null);
  const [user, setUser] = useState<Member | null>(null);
  const [route, setRoute] = useState("home");
  const [view, setView] = useState("list");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [projectScope, setProjectScope] = useState("all");
  const [priority, setPriority] = useState("all");
  const [dueFilter, setDueFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [taskSort, setTaskSort] = useState("due");
  const [selected, setSelected] = useState<Task | null>(null);
  const [newTask, setNewTask] = useState(false);
  const [newProject, setNewProject] = useState(false);
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [memberModal, setMemberModal] = useState(false);
  const [memberRoleBusy, setMemberRoleBusy] = useState("");
  const [passwordModal, setPasswordModal] = useState(false);
  const [toast, setToast] = useState("");
  const [mobile, setMobile] = useState(false);
  const [help, setHelp] = useState(false);
  const [loadError, setLoadError] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const flash = (text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4500);
  };
  async function refresh() {
    try {
      const result = await api<Data>("/bootstrap");
      setData(result);
      setUser(result.user);
      setLoadError("");
      return result;
    } catch (e) {
      setLoadError((e as Error).message);
      throw e;
    }
  }
  async function check() {
    try {
      const auth = await api("/auth/status");
      setUser(auth.user);
      setLogged(!!auth.user);
      if (auth.user && !auth.user.mustChangePassword) await refresh();
    } finally {
      setReady(true);
    }
  }
  useEffect(() => {
    check().catch((e) => setLoadError(e.message));
    const expired = () => {
      setLogged(false);
      setData(null);
      setUser(null);
      setSelected(null);
      setNewTask(false);
      setPasswordModal(false);
    };
    window.addEventListener("session-expired", expired);
    const keys = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (document.querySelector('[role="dialog"]')) return;
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", keys);
    return () => {
      window.removeEventListener("session-expired", expired);
      window.removeEventListener("keydown", keys);
    };
  }, []);
  useEffect(() => {
    if (!logged || user?.mustChangePassword) return;
    const timer = setInterval(() => {
      if (!document.hidden) refresh().catch(() => {});
    }, 15000);
    return () => clearInterval(timer);
  }, [logged, user?.mustChangePassword]);
  const go = (next: string) => {
    setRoute(next);
    setSearch("");
    setFilter("all");
    setPriority("all");
    setDueFilter("all");
    setStatusFilter("all");
    setMobile(false);
  };
  async function mutate(
    path: string,
    method: string,
    body?: unknown,
    message = "保存しました",
  ) {
    try {
      const result = await api(path, method, body);
      await refresh();
      flash(message);
      return result;
    } catch (e) {
      flash((e as Error).message);
      throw e;
    }
  }
  if (!ready)
    return (
      <div className="loading-screen">
        <Logo />
        <LoaderCircle className="spin" />
        <p>ワークスペースを準備しています</p>
      </div>
    );
  if (!logged)
    return (
      <Auth onLogin={() => check().catch((e) => setLoadError(e.message))} />
    );
  if (user?.mustChangePassword)
    return (
      <div className="password-page">
        <Logo />
        <PasswordForm
          required
          onSave={async (body) => {
            await api("/auth/password", "POST", body);
            await check();
          }}
        />
      </div>
    );
  if (!data)
    return (
      <div className="loading-screen">
        <Logo />
        <p>{loadError || "読み込み中…"}</p>
        <button className="button" onClick={() => check().catch(() => {})}>
          再読み込み
        </button>
      </div>
    );
  const activeMembers = data.members.filter((m) => m.active);
  const member = (id: string) => data.members.find((m) => m.id === id);
  const project = data.projects.find((p) => route === `project:${p.id}`);
  const mine = data.tasks.filter((t) =>
    taskAssignees(t).includes(data.user.id),
  );
  const myProjects = data.projects.filter(
    (p) =>
      p.ownerId === data.user.id ||
      p.memberIds?.includes(data.user.id) ||
      mine.some((t) => t.projectIds.includes(p.id)),
  );
  const unread = data.notifications.filter((n) => !n.read).length;
  const baseTasks = project
    ? data.tasks.filter((t) => t.projectIds.includes(project.id))
    : route === "mytasks"
      ? mine
      : data.tasks;
  const currentDay = today();
  const endOfWeek = new Date(`${currentDay}T00:00:00Z`);
  endOfWeek.setUTCDate(endOfWeek.getUTCDate() + 6);
  const nextSevenDays = endOfWeek.toISOString().slice(0, 10);
  const normalizeSearch = (value: string) =>
    value.normalize("NFKC").toLocaleLowerCase("ja-JP");
  const searchTerms = normalizeSearch(search)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const matchedTasks = baseTasks.filter(
    (t) =>
      searchTerms.every((term) =>
        normalizeSearch(
          [
            t.title,
            t.description,
            ...t.tags,
            ...taskAssignees(t).map((uid) => member(uid)?.name || ""),
            data.salesAccounts?.find((a) => a.id === t.accountId)?.name || "",
            ...data.projects
              .filter((p) => t.projectIds.includes(p.id))
              .map((p) => p.name),
          ].join(" "),
        ).includes(term),
      ) &&
      (filter === "all" ||
        (filter === "me"
          ? taskAssignees(t).includes(data.user.id)
          : filter === "unassigned"
            ? !taskAssignees(t).length
            : taskAssignees(t).includes(filter))) &&
      (priority === "all" || t.priority === priority),
  );
  const visibleTasks = matchedTasks
    .filter(
      (t) =>
        (statusFilter === "all" ||
          (statusFilter === "open"
            ? t.status !== "done"
            : t.status === statusFilter)) &&
        (dueFilter === "all" ||
          (dueFilter === "overdue"
            ? overdue(t)
            : dueFilter === "today"
              ? t.dueDate === currentDay
              : dueFilter === "upcoming"
                ? t.dueDate >= currentDay && t.dueDate <= nextSevenDays
                : !t.dueDate)),
    )
    .sort((a, b) => {
      if (taskSort === "updated") return b.updatedAt.localeCompare(a.updatedAt);
      if (taskSort === "priority") {
        const rank = { high: 0, medium: 1, low: 2 };
        const difference = rank[a.priority] - rank[b.priority];
        if (difference) return difference;
      }
      return (
        (a.dueDate || "9999").localeCompare(b.dueDate || "9999") ||
        a.title.localeCompare(b.title, "ja")
      );
    });
  const hasTaskFilters =
    filter !== "all" ||
    priority !== "all" ||
    statusFilter !== "all" ||
    dueFilter !== "all" ||
    !!search;
  const clearTaskFilters = () => {
    setFilter("all");
    setPriority("all");
    setDueFilter("all");
    setStatusFilter("all");
    setSearch("");
  };
  const taskShortcuts = [
    { label: "すべて", due: "all", status: "all", count: matchedTasks.length },
    {
      label: "未完了",
      due: "all",
      status: "open",
      count: matchedTasks.filter((t) => t.status !== "done").length,
    },
    {
      label: "今日",
      due: "today",
      status: "open",
      count: matchedTasks.filter(
        (t) => t.status !== "done" && t.dueDate === currentDay,
      ).length,
    },
    {
      label: "期限切れ",
      due: "overdue",
      status: "open",
      count: matchedTasks.filter(overdue).length,
    },
    {
      label: "7日以内",
      due: "upcoming",
      status: "open",
      count: matchedTasks.filter(
        (t) =>
          t.status !== "done" &&
          t.dueDate >= currentDay &&
          t.dueDate <= nextSevenDays,
      ).length,
    },
    {
      label: "期日なし",
      due: "none",
      status: "open",
      count: matchedTasks.filter((t) => t.status !== "done" && !t.dueDate)
        .length,
    },
  ];
  const complete = data.tasks.filter((t) => t.status === "done").length;
  const taskScope = project
    ? project.name
    : route === "mytasks"
      ? "マイタスク"
      : route === "search"
        ? "タスクを検索"
        : "すべてのタスク";
  const openNew = () => {
    setSelected(null);
    setNewTask(true);
  };
  const openTask = (task: Task) => {
    setNewTask(false);
    setSelected(task);
  };
  const changeStatus = async (task: Task, status: Status) => {
    try {
      await mutate(
        `/tasks/${task.id}`,
        "PATCH",
        { version: task.version, status },
        status === "done" ? "タスクを完了しました" : "ステータスを更新しました",
      );
    } catch {
      await refresh().catch(() => {});
    }
  };
  const latestSelected = selected
    ? data.tasks.find((t) => t.id === selected.id)
    : null;
  const projectCard = (p: Project) => {
    const tasks = data.tasks.filter((t) => t.projectIds.includes(p.id));
    const done = tasks.filter((t) => t.status === "done").length;
    const percent = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
    return (
      <button
        key={p.id}
        className="project-card"
        onClick={() => {
          go(`project:${p.id}`);
          setView("list");
        }}
      >
        <div className="project-card-top">
          <ProjectIcon project={p} />
          <span
            className={`project-state ${p.status === "atrisk" ? "risk" : ""}`}
          >
            <i />
            {p.status === "complete"
              ? "完了"
              : p.status === "atrisk"
                ? "要確認"
                : "順調"}
          </span>
        </div>
        <h3>{p.name}</h3>
        <p>{p.description || "チームの次の一歩を、ここから。"}</p>
        <div className="progress-caption">
          <span>進捗</span>
          <strong>
            {percent}
            <small>%</small>
          </strong>
        </div>
        <div className="progress-track">
          <span className={p.color} style={{ width: `${percent}%` }} />
        </div>
        <div className="project-card-bottom">
          <span>
            <CheckCircle2 size={14} />
            {done} / {tasks.length} タスク
          </span>
          <span className="avatar-stack">
            {[...new Set(tasks.flatMap(taskAssignees))]
              .slice(0, 3)
              .map((uid) => (
                <Avatar key={uid} member={member(uid)} />
              ))}
            {!tasks.some((t) => t.assigneeId) && (
              <Avatar member={member(p.ownerId)} />
            )}
          </span>
        </div>
      </button>
    );
  };
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? "is-open" : ""}`}>
        <div className="sidebar-brand">
          <Logo />
          <button
            className="icon-button mobile-only"
            aria-label="メニューを閉じる"
            onClick={() => setMobile(false)}
          >
            <X size={18} />
          </button>
        </div>
        <button className="workspace-switch" onClick={() => go("members")}>
          <span className="workspace-letter">
            {data.workspace.name.slice(0, 1)}
          </span>
          <span>
            <strong>{data.workspace.name}</strong>
            <small>チームワークスペース</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <nav aria-label="メインメニュー">
          <button
            className={route === "home" ? "active" : ""}
            onClick={() => go("home")}
          >
            <LayoutDashboard size={18} />
            ホーム
          </button>
          <button
            className={route === "mytasks" ? "active" : ""}
            onClick={() => {
              go("mytasks");
              setView("list");
            }}
          >
            <CheckCircle2 size={18} />
            マイタスク
            <span className="nav-count">
              {mine.filter((t) => t.status !== "done").length}
            </span>
          </button>
          <button
            className={route === "inbox" ? "active" : ""}
            onClick={() => go("inbox")}
          >
            <Inbox size={18} />
            受信トレイ
            {unread > 0 && <span className="unread-badge">{unread}</span>}
          </button>
        </nav>
        <div className="nav-section-title">
          <span>ワークスペース</span>
        </div>
        <nav>
          <button
            className={route === "sales" ? "active" : ""}
            onClick={() => go("sales")}
          >
            <BarChart3 size={18} />
            営業・数字管理
          </button>
          <button
            className={route === "projects" ? "active" : ""}
            onClick={() => go("projects")}
          >
            <FolderKanban size={18} />
            プロジェクト
          </button>
          <button
            className={route === "requests" ? "active" : ""}
            onClick={() => go("requests")}
          >
            <FileText size={18} />
            社内リクエスト
          </button>
          <button
            className={route === "members" ? "active" : ""}
            onClick={() => go("members")}
          >
            <Users size={18} />
            メンバー
          </button>
        </nav>
        <div className="nav-section-title">
          <span>プロジェクトのショートカット</span>
          <button
            className="icon-button"
            aria-label="プロジェクトを作成"
            onClick={() => setNewProject(true)}
          >
            <Plus size={15} />
          </button>
        </div>
        <nav className="project-nav">
          {[
            ...myProjects,
            ...data.projects.filter((p) => !myProjects.includes(p)),
          ].map((p) => (
            <button
              key={p.id}
              className={project?.id === p.id ? "active" : ""}
              onClick={() => {
                go(`project:${p.id}`);
                setView("list");
              }}
            >
              <i className={`project-dot ${p.color}`} />
              <span>{p.name}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="team-note">
            <span className="team-note-icon">✳</span>
            <strong>小さな一歩を、大きな成果に。</strong>
            <p>チームの仕事を、もっと心地よく。</p>
            <button onClick={() => setHelp(true)}>
              Worknestの使い方 <ArrowUpRightIcon />
            </button>
          </div>
          <button
            className={`sidebar-setting ${route === "settings" ? "active" : ""}`}
            onClick={() => go("settings")}
          >
            <Settings2 size={17} />
            設定・連携
          </button>
          <div className="sidebar-user">
            <Avatar member={data.user} size="md" />
            <span>
              <strong>{data.user.name}</strong>
              <small>
                {data.user.role === "admin"
                  ? "ワークスペース管理者"
                  : "チームメンバー"}
              </small>
            </span>
            <button
              className="icon-button"
              title="ログアウト"
              aria-label="ログアウト"
              onClick={async () => {
                try {
                  await api("/auth/logout", "POST", {});
                  setLogged(false);
                  setData(null);
                  setSelected(null);
                  setNewTask(false);
                  setMemberModal(false);
                  setPasswordModal(false);
                  setNewProject(false);
                  setEditProject(null);
                  go("home");
                } catch (e) {
                  flash((e as Error).message);
                }
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      {mobile && (
        <div className="sidebar-scrim" onClick={() => setMobile(false)} />
      )}
      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-only"
              aria-label="メニューを開く"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <span>ワークスペース</span>
            <ChevronRight size={14} />
            <strong>
              {project
                ? project.name
                : (
                    {
                      home: "ホーム",
                      mytasks: "マイタスク",
                      inbox: "受信トレイ",
                      projects: "プロジェクト",
                      requests: "社内リクエスト",
                      members: "メンバー",
                      settings: "設定・連携",
                      sales: "営業・数字管理",
                      search: "検索",
                    } as Record<string, string>
                  )[route]}
            </strong>
          </div>
          <div className="topbar-actions">
            <div className="global-search">
              <Search size={16} />
              <input
                ref={searchRef}
                aria-label="タスクを検索"
                aria-describedby="task-search-description"
                placeholder={
                  project
                    ? "このプロジェクトのタスクを検索"
                    : route === "mytasks"
                      ? "マイタスクを検索"
                      : "すべてのタスクを検索"
                }
                value={search}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setSearch("");
                    e.currentTarget.blur();
                  }
                }}
                onChange={(e) => {
                  setSearch(e.target.value);
                  if (!project && route !== "mytasks")
                    setRoute(e.target.value ? "search" : "home");
                }}
              />
              {search ? (
                <button
                  className="search-clear"
                  aria-label="検索語をクリア"
                  onClick={() => {
                    setSearch("");
                    searchRef.current?.focus();
                  }}
                >
                  <X size={14} />
                </button>
              ) : (
                <kbd>Ctrl / ⌘ K</kbd>
              )}
              <span id="task-search-description" className="visually-hidden">
                {project
                  ? "このプロジェクト"
                  : route === "mytasks"
                    ? "自分が担当するタスク"
                    : "すべてのタスク"}
                を、タスク名・説明・タグ・担当者名・プロジェクト名で検索します。空白で区切るとすべての語を含むタスクに絞り込みます。
              </span>
            </div>
            <button
              className="icon-button notification-bell"
              aria-label="通知を表示"
              onClick={() => go("inbox")}
            >
              <Bell size={19} />
              {unread > 0 && <i />}
            </button>
            <span className="topbar-separator" />
            <button className="button primary compact" onClick={openNew}>
              <Plus size={16} />
              <span>作成</span>
            </button>
          </div>
        </header>
        <main className={`page page-${route.split(":")[0]}`}>
          {loadError && (
            <div className="connection-error" role="alert">
              {loadError}{" "}
              <button onClick={() => refresh().catch(() => {})}>再接続</button>
            </div>
          )}
          {route === "sales" && (
            <SalesWorkspace
              data={data}
              api={api}
              onOpenTask={openTask}
              onTasksChanged={refresh}
            />
          )}
          {route === "home" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="date-line">
                    {new Date().toLocaleDateString("ja-JP", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                      weekday: "long",
                      timeZone: "Asia/Tokyo",
                    })}
                  </div>
                  <h1>
                    おかえりなさい、{data.user.name.split(/[ 　]/)[0]}さん{" "}
                    <span className="greeting-sun">☀</span>
                  </h1>
                  <p>今日も、チームと一緒に一歩ずつ。</p>
                </div>
                <button className="button" onClick={() => setNewProject(true)}>
                  <Plus size={16} />
                  プロジェクトを作成
                </button>
              </div>
              <section className="welcome-banner">
                <div>
                  <span className="eyebrow light">
                    MAKE ROOM FOR GREAT WORK
                  </span>
                  <h2>
                    チームの「いま」がわかる。
                    <br />
                    次の一歩が、見えてくる。
                  </h2>
                  <p>アイデアから実行まで、すべての仕事をひとつの場所に。</p>
                  <button onClick={() => go("mytasks")}>
                    今日のタスクを確認する <ArrowRight size={16} />
                  </button>
                </div>
                <div className="banner-art" aria-hidden="true">
                  <div className="banner-orbit" />
                  <span className="banner-star">✳</span>
                  <div className="art-checkcard">
                    <div className="art-card-line">
                      <span className="art-circle checked">
                        <Check size={13} />
                      </span>
                      <span className="art-line long" />
                    </div>
                    <div className="art-card-line">
                      <span className="art-circle checked">
                        <Check size={13} />
                      </span>
                      <span className="art-line" />
                    </div>
                    <div className="art-card-line">
                      <span className="art-circle" />
                      <span className="art-line long" />
                    </div>
                    <div className="art-card-bottom">
                      <span />
                      <span />
                      <i>チームで、前へ。</i>
                    </div>
                  </div>
                  <div className="art-progress">
                    <span>
                      <CheckCheck size={18} />
                    </span>
                    <div>
                      <strong>いい流れが、できている。</strong>
                      <small>ひとつのチーム、ひとつのゴール。</small>
                    </div>
                  </div>
                </div>
              </section>
              <section className="stats-grid" aria-label="ワークスペースの概要">
                {[
                  {
                    label: "進行中のプロジェクト",
                    value: data.projects.filter((p) => p.status !== "complete")
                      .length,
                    icon: FolderKanban,
                    note: "チームで取り組んでいます",
                    color: "sage",
                    action: () => go("projects"),
                  },
                  {
                    label: "あなたの未完了タスク",
                    value: mine.filter((t) => t.status !== "done").length,
                    icon: CheckCircle2,
                    note: "次の一歩を進めましょう",
                    color: "blue",
                    action: () => {
                      go("mytasks");
                      setStatusFilter("open");
                    },
                  },
                  {
                    label: "期限を過ぎたタスク",
                    value: data.tasks.filter(overdue).length,
                    icon: Clock3,
                    note: "スケジュールを確認しましょう",
                    color: "peach",
                    action: () => {
                      go("search");
                      setDueFilter("overdue");
                    },
                  },
                  {
                    label: "完了したタスク",
                    value: complete,
                    icon: CheckCheck,
                    note: "チームの積み重ねた成果",
                    color: "lavender",
                    action: () => {
                      go("search");
                      setView("list");
                      setStatusFilter("done");
                    },
                  },
                ].map((s) => (
                  <button
                    className="stat-card"
                    key={s.label}
                    onClick={s.action}
                  >
                    <div>
                      <span className={`stat-icon ${s.color}`}>
                        <s.icon size={18} />
                      </span>
                      <span>{s.label}</span>
                      <MoreHorizontal size={17} />
                    </div>
                    <strong>
                      {s.value}
                      <small>
                        {s.label.includes("プロジェクト") ? "件" : "件"}
                      </small>
                    </strong>
                    <p>{s.note}</p>
                  </button>
                ))}
              </section>
              <section className="dashboard-projects">
                <div className="section-heading">
                  <h2>
                    プロジェクト <span>{data.projects.length}</span>
                  </h2>
                  <button
                    className="text-button"
                    onClick={() => go("projects")}
                  >
                    すべて見る <ArrowRight size={15} />
                  </button>
                </div>
                {data.projects.length ? (
                  <div className="project-grid">
                    {data.projects.slice(0, 3).map(projectCard)}
                  </div>
                ) : (
                  <Empty
                    title="最初のプロジェクトをつくりましょう"
                    text="チームの仕事をまとめる場所を作成します。"
                    action={
                      <button
                        className="button primary"
                        onClick={() => setNewProject(true)}
                      >
                        <Plus size={16} />
                        プロジェクトを作成
                      </button>
                    }
                  />
                )}
              </section>
              <div className="dashboard-bottom">
                <section className="panel my-task-panel">
                  <div className="section-heading">
                    <h2>
                      マイタスク{" "}
                      <span className="pill neutral">
                        {mine.filter((t) => t.status !== "done").length}
                      </span>
                    </h2>
                    <button
                      className="text-button"
                      onClick={() => go("mytasks")}
                    >
                      すべて見る <ArrowRight size={14} />
                    </button>
                  </div>
                  <div className="mini-tabs">
                    <span className="selected">これからのタスク</span>
                    <span>{today().slice(5).replace("-", " / ")} 時点</span>
                  </div>
                  {mine.filter((t) => t.status !== "done").length ? (
                    mine
                      .filter((t) => t.status !== "done")
                      .sort((a, b) =>
                        (a.dueDate || "9999").localeCompare(
                          b.dueDate || "9999",
                        ),
                      )
                      .slice(0, 5)
                      .map((t) => (
                        <div key={t.id} className="mini-task">
                          <button
                            className="complete-button"
                            aria-label={`${t.title}を完了`}
                            onClick={() => changeStatus(t, "done")}
                          >
                            <Circle size={19} />
                          </button>
                          <button
                            className="mini-task-name"
                            onClick={() => openTask(t)}
                          >
                            <strong>{t.title}</strong>
                            <small>
                              {
                                data.projects.find(
                                  (p) => p.id === t.projectIds[0],
                                )?.name
                              }
                            </small>
                          </button>
                          <span
                            className={`due ${overdue(t) ? "overdue" : ""}`}
                          >
                            {t.dueDate === today()
                              ? "今日"
                              : fmtDate(t.dueDate)}
                          </span>
                        </div>
                      ))
                  ) : (
                    <Empty
                      title="すっきり、すべて完了。"
                      text="担当タスクが追加されるとここに表示されます。"
                    />
                  )}
                  <button className="add-inline" onClick={openNew}>
                    <Plus size={15} />
                    タスクを追加
                  </button>
                </section>
                <section className="panel activity-panel">
                  <div className="section-heading">
                    <h2>チームのアクティビティ</h2>
                    <span className="live-tag">
                      <i />
                      最新の動き
                    </span>
                  </div>
                  {data.activity.length ? (
                    <div className="activity-list">
                      {data.activity.slice(0, 5).map((a) => (
                        <div className="activity-item" key={a.id}>
                          <Avatar member={member(a.userId)} />
                          <div>
                            <p>
                              <strong>
                                {member(a.userId)?.name || "メンバー"}
                              </strong>
                            </p>
                            <button
                              disabled={
                                !data.tasks.some((t) => t.id === a.taskId)
                              }
                              onClick={() => {
                                const t = data.tasks.find(
                                  (t) => t.id === a.taskId,
                                );
                                if (t) openTask(t);
                              }}
                            >
                              {a.text}
                            </button>
                            <small>{relative(a.createdAt)}</small>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="activity-welcome">
                      <span className="project-icon sage">
                        <Sparkles size={22} />
                      </span>
                      <h3>ここから、チームの物語がはじまります。</h3>
                      <p>
                        タスクの更新やコメントなど、
                        <br />
                        チームの動きがここに集まります。
                      </p>
                      <small>さっそく最初のタスクを進めてみましょう。</small>
                    </div>
                  )}
                </section>
              </div>
              <footer className="page-footer">
                <span>ひとつずつ、チームとともに。</span>
                <Logo small />
              </footer>
            </>
          )}
          {route === "projects" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">YOUR TEAM'S WORK</span>
                  <h1>プロジェクト</h1>
                  <p>チームの取り組みと、その先のゴール。</p>
                </div>
                <button
                  className="button primary"
                  onClick={() => setNewProject(true)}
                >
                  <Plus size={16} />
                  新規プロジェクト
                </button>
              </div>
              <div className="admin-actions">
                <label>
                  表示するプロジェクト
                  <select
                    aria-label="表示するプロジェクト"
                    value={projectScope}
                    onChange={(e) => setProjectScope(e.target.value)}
                  >
                    <option value="all">ワークスペース全体</option>
                    <option value="mine">
                      自分が参加・担当するプロジェクト
                    </option>
                  </select>
                </label>
                <p className="sales-muted">
                  部署に関係なく、参加者または担当タスクがあるプロジェクトを表示します。
                </p>
              </div>
              <div className="project-grid all-projects">
                {(projectScope === "mine" ? myProjects : data.projects).map(
                  projectCard,
                )}
                <button
                  className="new-project-card"
                  onClick={() => setNewProject(true)}
                >
                  <Plus size={27} />
                  <strong>新しいプロジェクト</strong>
                  <span>次のアイデアを、カタチに。</span>
                </button>
              </div>
            </>
          )}
          {(project || route === "mytasks" || route === "search") && (
            <>
              <div className="page-heading project-heading">
                <div>
                  {project && <ProjectIcon project={project} />}
                  <div>
                    <h1>{taskScope}</h1>
                    <p>
                      {project?.description ||
                        (route === "mytasks"
                          ? "自分の仕事に、心地よい見通しを。"
                          : "ワークスペースのタスクを横断して確認できます。")}
                    </p>
                  </div>
                </div>
                {project ? (
                  <button
                    className="button"
                    onClick={() => setEditProject(project)}
                  >
                    <Settings2 size={16} />
                    プロジェクト設定
                  </button>
                ) : (
                  <button className="button primary" onClick={openNew}>
                    <Plus size={16} />
                    タスクを追加
                  </button>
                )}
              </div>
              <div className="view-tabs">
                {[
                  { key: "list", label: "リスト", icon: List },
                  { key: "board", label: "ボード", icon: LayoutGrid },
                  {
                    key: "timeline",
                    label: "タイムライン",
                    icon: ChartNoAxesGantt,
                  },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    className={view === tab.key ? "active" : ""}
                    onClick={() => setView(tab.key)}
                  >
                    <tab.icon size={16} />
                    {tab.label}
                  </button>
                ))}
                <div className="view-tabs-right">
                  <span>
                    {baseTasks.filter((t) => t.status === "done").length} /{" "}
                    {baseTasks.length} 完了
                  </span>
                  <div className="small-progress">
                    <span
                      style={{
                        width: `${baseTasks.length ? (baseTasks.filter((t) => t.status === "done").length / baseTasks.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
              <div
                className="task-shortcuts"
                role="group"
                aria-label="タスクのクイック絞り込み"
              >
                {taskShortcuts.map((shortcut) => (
                  <button
                    key={shortcut.label}
                    className={`${statusFilter === shortcut.status && dueFilter === shortcut.due ? "active" : ""} ${shortcut.due === "overdue" && shortcut.count ? "has-overdue" : ""}`}
                    aria-pressed={
                      statusFilter === shortcut.status &&
                      dueFilter === shortcut.due
                    }
                    onClick={() => {
                      setStatusFilter(shortcut.status);
                      setDueFilter(shortcut.due);
                    }}
                    title={
                      shortcut.due === "upcoming"
                        ? "今日から7日間が期日の未完了タスク"
                        : `${shortcut.label}のタスクに絞り込む`
                    }
                  >
                    {shortcut.due === "overdue" && <Clock3 size={13} />}
                    {shortcut.label}
                    <span>{shortcut.count}</span>
                  </button>
                ))}
              </div>
              <div className="task-toolbar">
                <div>
                  <select
                    aria-label="担当者で絞り込み"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="all">すべての担当者</option>
                    <option value="me">自分のタスク</option>
                    <option value="unassigned">未割り当て</option>
                    {activeMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="優先度で絞り込み"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                  >
                    <option value="all">優先度</option>
                    {Object.entries(PRIORITY).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="期日で絞り込み"
                    value={dueFilter}
                    onChange={(e) => setDueFilter(e.target.value)}
                  >
                    <option value="all">すべての期日</option>
                    <option value="today">今日が期日</option>
                    <option value="upcoming">7日以内が期日</option>
                    <option value="overdue">期限切れ</option>
                    <option value="none">期日なし</option>
                  </select>
                  <select
                    aria-label="ステータスで絞り込み"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="all">全ステータス</option>
                    <option value="open">未完了</option>
                    {statusKeys.map((s) => (
                      <option key={s} value={s}>
                        {STATUS[s].label}
                      </option>
                    ))}
                  </select>
                  {hasTaskFilters && (
                    <button className="text-button" onClick={clearTaskFilters}>
                      クリア
                    </button>
                  )}
                </div>
                <button className="button primary compact" onClick={openNew}>
                  <Plus size={16} />
                  タスクを追加
                </button>
              </div>
              <div className="task-filter-summary">
                <span role="status">
                  {visibleTasks.length} 件を表示
                  {hasTaskFilters ? ` / ${baseTasks.length} 件` : ""}
                  {search.trim() ? ` · 「${search.trim()}」の検索結果` : ""}
                </span>
                <label>
                  並び順
                  <select
                    aria-label="タスクの並び順"
                    value={taskSort}
                    onChange={(e) => setTaskSort(e.target.value)}
                  >
                    <option value="due">期日が近い順</option>
                    <option value="priority">優先度が高い順</option>
                    <option value="updated">更新が新しい順</option>
                  </select>
                </label>
              </div>
              {view === "list" && (
                <div className="task-list panel">
                  <div className="task-list-head">
                    <span>タスク名</span>
                    <span>担当者</span>
                    <span>
                      期日 {taskSort === "due" && <ArrowDown size={12} />}
                    </span>
                    <span>
                      優先度{" "}
                      {taskSort === "priority" && <ArrowDown size={12} />}
                    </span>
                    <span>ステータス</span>
                  </div>
                  {visibleTasks.length ? (
                    statusKeys.map((status) => {
                      const tasks = visibleTasks.filter(
                        (t) => t.status === status,
                      );
                      return (
                        tasks.length > 0 && (
                          <section key={status}>
                            <div className="task-group-title">
                              <ChevronDown size={14} />
                              <i
                                className={`status-dot ${STATUS[status].color}`}
                              />
                              {STATUS[status].label}
                              <span>{tasks.length}</span>
                            </div>
                            {tasks.map((t) => (
                              <div
                                key={t.id}
                                className={`task-row ${t.status === "done" ? "is-done" : ""}`}
                              >
                                <div className="task-title-cell">
                                  <button
                                    className="complete-button"
                                    aria-label={`${t.title}を${t.status === "done" ? "未着手に戻す" : "完了"}`}
                                    onClick={() =>
                                      changeStatus(
                                        t,
                                        t.status === "done" ? "todo" : "done",
                                      )
                                    }
                                  >
                                    {t.status === "done" ? (
                                      <CheckCircle2 size={19} />
                                    ) : (
                                      <Circle size={19} />
                                    )}
                                  </button>
                                  <button onClick={() => openTask(t)}>
                                    {t.title}
                                  </button>
                                  {t.comments.length > 0 && (
                                    <span className="comment-count">
                                      <MessageCircle size={12} />
                                      {t.comments.length}
                                    </span>
                                  )}
                                  {t.visibility === "private" && (
                                    <span
                                      title="非公開：作成者・担当者・管理者"
                                      aria-label="非公開タスク"
                                    >
                                      <LockKeyhole size={13} />
                                    </span>
                                  )}
                                  {t.recurrence && (
                                    <span className="pill neutral">
                                      繰り返し
                                    </span>
                                  )}
                                </div>
                                <div>
                                  <span
                                    className="task-assignees"
                                    title={taskAssignees(t)
                                      .map((uid) => member(uid)?.name)
                                      .join("?")}
                                  >
                                    <Avatar member={member(t.assigneeId)} />
                                    {taskAssignees(t).length > 1 && (
                                      <small>
                                        +{taskAssignees(t).length - 1}
                                      </small>
                                    )}
                                  </span>
                                  <span className="assignee-name">
                                    {member(t.assigneeId)?.name.split(
                                      /[ 　]/,
                                    )[0] || "未割り当て"}
                                  </span>
                                </div>
                                <span
                                  className={`due ${overdue(t) ? "overdue" : ""}`}
                                >
                                  {fmtDate(t.dueDate)}
                                </span>
                                <span>
                                  <span
                                    className={`priority priority-${t.priority}`}
                                  >
                                    <Flag size={11} />
                                    {PRIORITY[t.priority]}
                                  </span>
                                </span>
                                <span>
                                  <select
                                    className={`status-select ${STATUS[t.status].color}`}
                                    aria-label={`${t.title}のステータス`}
                                    value={t.status}
                                    onChange={(e) =>
                                      changeStatus(t, e.target.value as Status)
                                    }
                                  >
                                    {statusKeys.map((s) => (
                                      <option key={s} value={s}>
                                        {STATUS[s].label}
                                      </option>
                                    ))}
                                  </select>
                                </span>
                              </div>
                            ))}
                          </section>
                        )
                      );
                    })
                  ) : (
                    <Empty
                      title={
                        baseTasks.length
                          ? "条件に一致するタスクがありません"
                          : route === "mytasks"
                            ? "担当するタスクはまだありません"
                            : "最初のタスクを追加しましょう"
                      }
                      text={
                        baseTasks.length
                          ? "検索語や絞り込み条件を変更すると、ほかのタスクを確認できます。"
                          : route === "mytasks"
                            ? "自分を担当者に設定すると、ここで期日と進捗をまとめて確認できます。"
                            : "担当者と期日を決めると、チームが次にやることを確認できます。"
                      }
                      action={
                        hasTaskFilters ? (
                          <button className="button" onClick={clearTaskFilters}>
                            すべての絞り込みを解除
                          </button>
                        ) : undefined
                      }
                    />
                  )}
                  <button className="add-inline" onClick={openNew}>
                    <Plus size={15} />
                    タスクを追加
                  </button>
                </div>
              )}
              {view !== "list" && !visibleTasks.length && hasTaskFilters && (
                <Empty
                  title="条件に一致するタスクがありません"
                  text="検索語や絞り込み条件を変更して、タスクを確認してください。"
                  action={
                    <button className="button" onClick={clearTaskFilters}>
                      すべての絞り込みを解除
                    </button>
                  }
                />
              )}
              {view === "board" &&
                (!!visibleTasks.length || !hasTaskFilters) && (
                  <div className="board">
                    {statusKeys.map((status) => (
                      <section
                        className="board-column"
                        key={status}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.currentTarget.classList.add("drag-over");
                        }}
                        onDragLeave={(e) =>
                          e.currentTarget.classList.remove("drag-over")
                        }
                        onDrop={(e) => {
                          e.preventDefault();
                          e.currentTarget.classList.remove("drag-over");
                          const task = data.tasks.find(
                            (t) =>
                              t.id === e.dataTransfer.getData("text/plain"),
                          );
                          if (task && task.status !== status)
                            changeStatus(task, status);
                        }}
                      >
                        <div className="board-column-heading">
                          <span>
                            <i
                              className={`status-dot ${STATUS[status].color}`}
                            />
                            {STATUS[status].label}
                            <small>
                              {
                                visibleTasks.filter((t) => t.status === status)
                                  .length
                              }
                            </small>
                          </span>
                          <button
                            className="icon-button"
                            aria-label="タスクを追加"
                            onClick={openNew}
                          >
                            <Plus size={16} />
                          </button>
                        </div>
                        <div className="board-cards">
                          {visibleTasks
                            .filter((t) => t.status === status)
                            .map((t) => (
                              <article
                                key={t.id}
                                className="board-card"
                                draggable
                                onDragStart={(e) => {
                                  e.dataTransfer.setData("text/plain", t.id);
                                  e.dataTransfer.effectAllowed = "move";
                                }}
                              >
                                <div className="board-card-top">
                                  <span
                                    className={`priority priority-${t.priority}`}
                                  >
                                    <Flag size={11} />
                                    {PRIORITY[t.priority]}優先度
                                  </span>
                                  <GripVertical size={15} />
                                </div>
                                <button
                                  className="board-title"
                                  onClick={() => openTask(t)}
                                >
                                  {t.title}
                                </button>
                                <div className="tags">
                                  {t.tags.map((tag) => (
                                    <span key={tag} className="tag">
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                                <div className="board-card-bottom">
                                  <span
                                    className={`due ${overdue(t) ? "overdue" : ""}`}
                                  >
                                    <CalendarDays size={13} />
                                    {fmtDate(t.dueDate)}
                                  </span>
                                  <span>
                                    {t.comments.length > 0 && (
                                      <span className="comment-count">
                                        <MessageCircle size={12} />
                                        {t.comments.length}
                                      </span>
                                    )}
                                    <span
                                      className="task-assignees"
                                      title={taskAssignees(t)
                                        .map((uid) => member(uid)?.name)
                                        .join("?")}
                                    >
                                      <Avatar member={member(t.assigneeId)} />
                                      {taskAssignees(t).length > 1 && (
                                        <small>
                                          +{taskAssignees(t).length - 1}
                                        </small>
                                      )}
                                    </span>
                                  </span>
                                </div>
                                <select
                                  className="board-status-access"
                                  aria-label={`${t.title}のステータス`}
                                  value={t.status}
                                  onChange={(e) =>
                                    changeStatus(t, e.target.value as Status)
                                  }
                                >
                                  {statusKeys.map((s) => (
                                    <option key={s} value={s}>
                                      {STATUS[s].label}
                                    </option>
                                  ))}
                                </select>
                              </article>
                            ))}
                          <button className="board-add" onClick={openNew}>
                            <Plus size={15} />
                            タスクを追加
                          </button>
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              {view === "timeline" &&
                (!!visibleTasks.length || !hasTaskFilters) && (
                  <Timeline tasks={visibleTasks} openTask={openTask} />
                )}
            </>
          )}
          {route === "inbox" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">STAY IN THE LOOP</span>
                  <h1>受信トレイ</h1>
                  <p>あなたへの依頼と、チームからのお知らせ。</p>
                </div>
                <button
                  className="button"
                  disabled={!unread}
                  onClick={() =>
                    mutate(
                      "/notifications/read",
                      "POST",
                      {},
                      "すべて既読にしました",
                    ).catch(() => {})
                  }
                >
                  <CheckCheck size={16} />
                  すべて既読にする
                </button>
              </div>
              <div className="panel notification-list">
                {data.notifications.length ? (
                  data.notifications.map((n) => (
                    <button
                      key={n.id}
                      className={`notification-row ${!n.read ? "unread" : ""}`}
                      onClick={() => {
                        const t = data.tasks.find((t) => t.id === n.taskId);
                        if (t) openTask(t);
                        else flash("このタスクは削除されています。");
                      }}
                    >
                      <span className="project-icon sage">
                        <Bell size={18} />
                      </span>
                      <span>
                        <strong>{n.text}</strong>
                        <small>{relative(n.createdAt)}</small>
                      </span>
                      {!n.read && <i className="notification-dot" />}
                      <ChevronRight size={17} />
                    </button>
                  ))
                ) : (
                  <Empty
                    title="今のところ、お知らせはありません"
                    text="タスクの割り当て、コメント、承認依頼がここに届きます。"
                  />
                )}
              </div>
            </>
          )}
          {route === "requests" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">ONE PLACE FOR EVERY REQUEST</span>
                  <h1>社内リクエスト</h1>
                  <p>ちょっとしたお願いも、正式な依頼も。ここからチームへ。</p>
                </div>
                <span className="pill sage">
                  <LockKeyhole size={13} />
                  社内限定フォーム
                </span>
              </div>
              <div className="request-layout">
                <section className="panel request-form">
                  <div className="section-heading">
                    <h2>
                      <FileText size={20} />
                      新しい依頼を送る
                    </h2>
                  </div>
                  <RequestForm
                    projects={data.projects}
                    onSubmit={async (body) => {
                      await mutate(
                        "/requests",
                        "POST",
                        body,
                        "依頼をタスクとして登録しました",
                      );
                    }}
                  />
                </section>
                <section className="request-guide">
                  <span className="eyebrow">HOW IT WORKS</span>
                  <h2>依頼を、迷子にしない。</h2>
                  <p>
                    送信した内容は、選んだプロジェクトに
                    <br />
                    タスクとして登録されます。
                  </p>
                  {[
                    {
                      title: "届け先を選ぶ",
                      text: "依頼を管理するプロジェクトを選択します。",
                    },
                    {
                      title: "お願いしたいことを書く",
                      text: "背景や希望する期日を添えて伝えましょう。",
                    },
                    {
                      title: "チームで進める",
                      text: "タスクのコメントで、やり取りをひとつに。",
                    },
                  ].map((s, i) => (
                    <div className="request-step" key={s.title}>
                      <span>0{i + 1}</span>
                      <div>
                        <h3>{s.title}</h3>
                        <p>{s.text}</p>
                      </div>
                    </div>
                  ))}
                  <div className="private-note">
                    <ShieldCheck size={19} />
                    <p>
                      このフォームはログインした社内メンバーのみ利用できます。
                    </p>
                  </div>
                </section>
              </div>
            </>
          )}
          {route === "members" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">BETTER, TOGETHER</span>
                  <h1>
                    チームメンバー{" "}
                    <span className="heading-count">
                      {activeMembers.length}
                    </span>
                  </h1>
                  <p>一緒に、いい仕事をつくる仲間たち。</p>
                </div>
                {data.user.role === "admin" && (
                  <button
                    className="button primary"
                    onClick={() => setMemberModal(true)}
                  >
                    <Plus size={16} />
                    メンバーを追加
                  </button>
                )}
              </div>
              <OrganizationPanel data={data} request={api} refresh={refresh} />
              <div className="panel members-panel">
                <div className="members-head">
                  <span>メンバー</span>
                  <span>権限</span>
                  <span>状態</span>
                  <span />
                </div>
                {data.members.map((m) => (
                  <div className="member-row" key={m.id}>
                    <div>
                      <Avatar member={m} size="md" />
                      <span>
                        <strong>
                          {m.name}
                          {m.id === data.user.id && <small>あなた</small>}
                        </strong>
                        <small>{m.email}</small>
                        <small>
                          {organizationName(data.orgUnits || [], m.orgUnitId) ||
                            "所属未設定"}
                        </small>
                      </span>
                    </div>
                    <span>
                      {data.user.role === "admin" && m.id !== data.user.id ? (
                        <select
                          aria-label={`${m.name}さんの権限`}
                          value={m.role}
                          disabled={memberRoleBusy === m.id}
                          onChange={async (e) => {
                            const role = e.target.value;
                            setMemberRoleBusy(m.id);
                            try {
                              await mutate(
                                `/members/${m.id}`,
                                "PATCH",
                                { role },
                                `${m.name}さんの権限を変更しました`,
                              );
                            } catch {
                            } finally {
                              setMemberRoleBusy("");
                            }
                          }}
                        >
                          <option value="member">メンバー</option>
                          <option value="admin">管理者</option>
                        </select>
                      ) : m.role === "admin" ? (
                        <>
                          <ShieldCheck size={14} />
                          管理者
                        </>
                      ) : (
                        "メンバー"
                      )}
                    </span>
                    <span className={`pill ${m.active ? "sage" : "neutral"}`}>
                      {m.active ? "有効" : "停止中"}
                    </span>
                    {data.user.role === "admin" && m.id !== data.user.id ? (
                      <button
                        className="text-button"
                        onClick={() =>
                          mutate(
                            `/members/${m.id}`,
                            "PATCH",
                            { active: !m.active },
                            m.active
                              ? "利用を停止しました"
                              : "利用を再開しました",
                          ).catch(() => {})
                        }
                      >
                        {m.active ? "利用を停止" : "再開する"}
                      </button>
                    ) : (
                      <span />
                    )}
                  </div>
                ))}
              </div>
              <p className="subtle-note">
                <LockKeyhole size={14} />
                アカウントは管理者だけが発行できます。全メンバーがワークスペース内のプロジェクトを共有します。
              </p>
              <p className="subtle-note">
                管理者はメンバー発行・組織登録・スプシ接続・全社監査を操作できます。タスクの承認担当は、管理者権限がなくても指定できます。
              </p>
            </>
          )}
          {route === "settings" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">MAKE IT YOUR WORKSPACE</span>
                  <h1>設定・連携</h1>
                  <p>いつものツールとつながる、あなたのワークスペース。</p>
                </div>
              </div>
              {data.user.role === "admin" && (
                <OperationsPanel request={api} members={data.members} />
              )}
              <section className="panel settings-section">
                <h2>アカウント</h2>
                <div className="setting-row">
                  <div>
                    <strong>{data.user.name}</strong>
                    <p>{data.user.email}</p>
                  </div>
                  <button
                    className="button"
                    onClick={() => setPasswordModal(true)}
                  >
                    <LockKeyhole size={15} />
                    パスワードを変更
                  </button>
                </div>
              </section>
              <section className="panel settings-section">
                <h2>Google Workspace</h2>
                <p>
                  Googleアカウントの認証設定なしで、普段のツールと一緒に使えます。
                </p>
                <div className="integration-row">
                  <span className="integration-icon calendar-logo">31</span>
                  <div>
                    <h3>Google Calendar</h3>
                    <p>
                      タスク詳細から予定作成画面を開き、期日をカレンダーに保存できます。
                    </p>
                    <small>
                      手動で予定を追加します。変更の自動同期は行いません。
                    </small>
                  </div>
                  <span className="pill sage">利用可能</span>
                </div>
                <div className="integration-row">
                  <span className="integration-icon drive-logo">△</span>
                  <div>
                    <h3>Google Drive</h3>
                    <p>
                      ドキュメント・スプレッドシートなどの共有リンクをタスクに追加できます。
                    </p>
                    <small>
                      ファイルのアクセス権限はGoogle Drive側で管理されます。
                    </small>
                  </div>
                  <span className="pill sage">利用可能</span>
                </div>
                <div className="integration-row">
                  <span className="integration-icon">
                    <CalendarDays size={25} />
                  </span>
                  <div>
                    <h3>カレンダーファイル</h3>
                    <p>
                      ICS形式でダウンロードし、Google
                      CalendarやOutlookに読み込めます。
                    </p>
                  </div>
                  <span className="pill sage">利用可能</span>
                </div>
              </section>
              <section className="panel settings-section">
                <h2>ワークスペースについて</h2>
                <div className="setting-row">
                  <div>
                    <strong>{data.workspace.name}</strong>
                    <p>
                      Worknest v2.8.0 · タスクと営業数字の共通ワークスペース
                    </p>
                  </div>
                  <span className="pill neutral">
                    <ShieldCheck size={13} />
                    メンバー限定
                  </span>
                </div>
                <p className="subtle-note">
                  スプシの日次取得と議事録のGemini要約は「営業・数字管理」→「データ連携」で設定状況を確認できます。Slack通知・Google
                  SSOは対象外です。
                </p>
              </section>
            </>
          )}
        </main>
      </div>
      {(selected || newTask) && (
        <TaskDialog
          key={selected?.id || "new"}
          task={selected}
          latest={latestSelected || null}
          data={data}
          defaultProjectId={project?.id || data.projects[0]?.id || ""}
          onClose={() => {
            setSelected(null);
            setNewTask(false);
          }}
          onSave={async (body) => {
            if (selected) await mutate(`/tasks/${selected.id}`, "PATCH", body);
            else await mutate("/tasks", "POST", body, "タスクを作成しました");
            setSelected(null);
            setNewTask(false);
          }}
          onAction={async (path, body) => {
            const result = await mutate(path, "POST", body);
            if (selected && result.version === selected.version + 1)
              setSelected(result);
          }}
          onDelete={async () => {
            if (selected) {
              await mutate(
                `/tasks/${selected.id}`,
                "DELETE",
                { version: selected.version },
                "タスクを削除しました",
              );
              setSelected(null);
            }
          }}
          onReload={() => {
            if (latestSelected) setSelected({ ...latestSelected });
          }}
        />
      )}
      {(newProject || editProject) && (
        <ProjectDialog
          key={editProject?.id || "new"}
          project={editProject}
          members={activeMembers}
          orgUnits={data.orgUnits || []}
          onClose={() => {
            setNewProject(false);
            setEditProject(null);
          }}
          onSave={async (body) => {
            const p = await mutate(
              editProject ? `/projects/${editProject.id}` : "/projects",
              editProject ? "PATCH" : "POST",
              body,
              editProject
                ? "プロジェクトを更新しました"
                : "プロジェクトを作成しました",
            );
            setNewProject(false);
            setEditProject(null);
            go(`project:${p.id}`);
          }}
        />
      )}
      {memberModal && (
        <Modal title="メンバーを追加" onClose={() => setMemberModal(false)}>
          <MemberForm
            onSave={async (body) => {
              await mutate("/members", "POST", body, "メンバーを追加しました");
              setMemberModal(false);
            }}
          />
        </Modal>
      )}
      {passwordModal && (
        <Modal title="パスワードを変更" onClose={() => setPasswordModal(false)}>
          <PasswordForm
            onSave={async (body) => {
              await mutate(
                "/auth/password",
                "POST",
                body,
                "パスワードを変更しました",
              );
              setPasswordModal(false);
            }}
          />
        </Modal>
      )}
      {help && (
        <Modal title="Worknestの使い方" onClose={() => setHelp(false)}>
          <div className="help-content">
            <p>チームの仕事を、次の4ステップで始めましょう。</p>
            <ol>
              <li>
                <strong>プロジェクトを作成</strong>
                <p>目的ごとに仕事をまとめる場所をつくります。</p>
              </li>
              <li>
                <strong>メンバーを追加</strong>
                <p>
                  管理者がメールアドレスと仮パスワードを登録し、本人に共有します。
                </p>
              </li>
              <li>
                <strong>タスクを割り当て</strong>
                <p>担当者・期日を決め、リストやボードで進捗を確認します。</p>
              </li>
              <li>
                <strong>コメントでつながる</strong>
                <p>
                  タスクを開いて相談や承認依頼、資料リンクを追加しましょう。
                </p>
              </li>
            </ol>
            <div className="info-box">
              自動化とカスタムフィールドは、各プロジェクトの「プロジェクト設定」から追加できます。
            </div>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {toast}
          <button aria-label="通知を閉じる" onClick={() => setToast("")}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
function ArrowUpRightIcon() {
  return <ExternalLink size={12} />;
}

function Timeline({
  tasks,
  openTask,
}: {
  tasks: Task[];
  openTask: (t: Task) => void;
}) {
  const [offset, setOffset] = useState(0);
  const beginning = new Date(today() + "T00:00:00Z");
  beginning.setUTCDate(beginning.getUTCDate() - 3 + offset);
  const start = beginning.toISOString().slice(0, 10);
  const days = Array.from({ length: 28 }, (_, i) => {
    const d = new Date(beginning);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const dayIndex = (date: string) =>
    Math.round(
      (new Date(date + "T00:00:00Z").getTime() - beginning.getTime()) /
        86400000,
    );
  const scheduled = tasks.filter((t) => t.dueDate);
  const width = 28 * 38;
  return (
    <section className="panel timeline">
      <div className="timeline-toolbar">
        <strong>
          {new Date(start).toLocaleDateString("ja-JP", {
            year: "numeric",
            month: "long",
            timeZone: "UTC",
          })}
        </strong>
        <span>依存タスク → 後続タスク</span>
        <div>
          <button
            className="icon-button"
            aria-label="前の2週間"
            onClick={() => setOffset(offset - 14)}
          >
            <ChevronLeft size={17} />
          </button>
          <button className="text-button" onClick={() => setOffset(0)}>
            今日
          </button>
          <button
            className="icon-button"
            aria-label="次の2週間"
            onClick={() => setOffset(offset + 14)}
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </div>
      {scheduled.length ? (
        <div className="timeline-scroll">
          <div className="timeline-inner" style={{ minWidth: width + 240 }}>
            <div className="timeline-labels">
              <div>タスク名</div>
              {scheduled.map((t) => (
                <button key={t.id} onClick={() => openTask(t)} title={t.title}>
                  {t.title}
                </button>
              ))}
            </div>
            <div className="timeline-chart" style={{ width }}>
              <div className="timeline-dates">
                {days.map((d) => (
                  <span
                    key={d}
                    className={
                      d === today()
                        ? "today"
                        : new Date(d).getUTCDay() % 6 === 0
                          ? "weekend"
                          : ""
                    }
                  >
                    <small>
                      {
                        ["日", "月", "火", "水", "木", "金", "土"][
                          new Date(d).getUTCDay()
                        ]
                      }
                    </small>
                    {Number(d.slice(-2))}
                  </span>
                ))}
              </div>
              <div
                className="timeline-body"
                style={{ height: scheduled.length * 52 }}
              >
                {days.map((d, i) => (
                  <div
                    className={`timeline-grid-line ${d === today() ? "today-line" : ""}`}
                    key={d}
                    style={{ left: i * 38, height: "100%" }}
                  />
                ))}
                <svg
                  className="dependency-lines"
                  width={width}
                  height={scheduled.length * 52}
                  aria-label="タスクの依存関係"
                >
                  <defs>
                    <marker
                      id="arrow"
                      markerWidth="6"
                      markerHeight="6"
                      refX="5"
                      refY="3"
                      orient="auto"
                    >
                      <path d="M0 0 L6 3 L0 6" fill="#9cae9e" />
                    </marker>
                  </defs>
                  {scheduled.flatMap((t, i) =>
                    t.dependencies.map((dep) => {
                      const j = scheduled.findIndex((x) => x.id === dep);
                      if (j < 0) return null;
                      const x1 = (dayIndex(scheduled[j].dueDate) + 1) * 38 - 4;
                      const x2 = dayIndex(t.startDate || t.dueDate) * 38 + 4;
                      if (x1 < 0 || x1 > width || x2 < 0 || x2 > width)
                        return null;
                      return (
                        <path
                          key={`${t.id}-${dep}`}
                          d={`M${x1} ${j * 52 + 26} H${x1 + 12} V${i * 52 + 26} H${x2}`}
                          fill="none"
                          stroke="#9cae9e"
                          strokeWidth="1.5"
                          markerEnd="url(#arrow)"
                        />
                      );
                    }),
                  )}
                </svg>
                {scheduled.map((t, i) => {
                  const left = Math.max(0, dayIndex(t.startDate || t.dueDate)),
                    right = Math.min(28, dayIndex(t.dueDate) + 1);
                  return (
                    right > left && (
                      <button
                        className={`timeline-bar ${STATUS[t.status].color}`}
                        key={t.id}
                        style={{
                          left: left * 38 + 4,
                          top: i * 52 + 12,
                          width: (right - left) * 38 - 8,
                        }}
                        title={`${t.title} · ${fmtDate(t.startDate || t.dueDate)}〜${fmtDate(t.dueDate)}`}
                        onClick={() => openTask(t)}
                      >
                        {t.status === "done" && <Check size={12} />}
                        <span>{t.title}</span>
                      </button>
                    )
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <Empty
          title="スケジュールを描きましょう"
          text="タスクに期日を設定すると、ここに表示されます。"
        />
      )}
      {tasks.some((t) => !t.dueDate) && (
        <div className="unscheduled">
          <strong>
            期日未設定（{tasks.filter((t) => !t.dueDate).length}）
          </strong>
          {tasks
            .filter((t) => !t.dueDate)
            .map((t) => (
              <button className="tag" key={t.id} onClick={() => openTask(t)}>
                {t.title}
              </button>
            ))}
        </div>
      )}
    </section>
  );
}

function TaskDialog({
  task,
  latest,
  data,
  defaultProjectId,
  onClose,
  onSave,
  onAction,
  onDelete,
  onReload,
}: {
  task: Task | null;
  latest: Task | null;
  data: Data;
  defaultProjectId: string;
  onClose: () => void;
  onSave: (body: unknown) => Promise<void>;
  onAction: (path: string, body: unknown) => Promise<void>;
  onDelete: () => Promise<void>;
  onReload: () => void;
}) {
  const blank: Pick<
    Task,
    | "title"
    | "description"
    | "status"
    | "priority"
    | "assigneeId"
    | "assigneeIds"
    | "accountId"
    | "startDate"
    | "dueDate"
    | "projectIds"
    | "tags"
    | "dependencies"
    | "custom"
    | "links"
    | "visibility"
    | "recurrence"
  > = {
    title: "",
    visibility: "workspace",
    recurrence: null,
    description: "",
    status: "todo",
    priority: "medium",
    assigneeId: "",
    assigneeIds: [],
    accountId: "",
    startDate: today(),
    dueDate: "",
    projectIds: defaultProjectId ? [defaultProjectId] : [],
    tags: [],
    dependencies: [],
    custom: {},
    links: [],
  };
  const [draft, setDraft] = useState<typeof blank | Task>(task || blank);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  useEffect(() => {
    if (task)
      setDraft((d) => ({
        ...d,
        version: task.version,
        comments: task.comments,
        approval: task.approval,
      }));
  }, [task]);
  const update = (key: string, value: unknown) =>
    setDraft((d) => ({ ...d, [key]: value }));
  async function run(fn: () => Promise<void>) {
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
  const fields = data.projects
    .filter((p) => draft.projectIds.includes(p.id))
    .flatMap((p) => p.fields);
  const current = latest || task;
  const calendarUrl = () => {
    const source = task || draft;
    const end = new Date(source.dueDate + "T00:00:00Z");
    end.setUTCDate(end.getUTCDate() + 1);
    return (
      "https://calendar.google.com/calendar/render?" +
      new URLSearchParams({
        action: "TEMPLATE",
        text: source.title,
        details: source.description,
        dates: `${(source.startDate || source.dueDate).replace(/-/g, "")}/${end.toISOString().slice(0, 10).replace(/-/g, "")}`,
      }).toString()
    );
  };
  return (
    <Modal
      title={task ? "タスクの詳細" : "新しいタスク"}
      onClose={onClose}
      wide
    >
      <form
        className="task-detail-form"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => onSave({ ...draft, version: task?.version }));
        }}
      >
        {task && latest && task.version !== latest.version && (
          <div className="conflict-notice">
            このタスクは更新されています。
            <button
              type="button"
              onClick={() => {
                if (latest) setDraft(latest);
                onReload();
              }}
            >
              最新の内容を読み込む
            </button>
          </div>
        )}
        <label className="task-title-label">
          タスク名
          <input
            name="title"
            className="task-title-input"
            placeholder="何に取り組みますか？"
            required
            maxLength={200}
            value={draft.title}
            onChange={(e) => update("title", e.target.value)}
          />
        </label>
        <label>
          対象の営業アカウント
          <select
            aria-label="対象の営業アカウント"
            value={draft.accountId || ""}
            disabled={!!task?.minuteId}
            onChange={(e) => update("accountId", e.target.value)}
          >
            <option value="">紐づけなし</option>
            {data.salesAccounts?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}（{a.id}）
              </option>
            ))}
          </select>
        </label>
        <fieldset className="assignee-choices">
          <legend>担当者を複数選択</legend>
          {data.members
            .filter((m) => m.active || taskAssignees(draft).includes(m.id))
            .map((m) => (
              <label className="check-label" key={m.id}>
                <input
                  type="checkbox"
                  checked={taskAssignees(draft).includes(m.id)}
                  onChange={(e) => {
                    const ids = e.target.checked
                      ? [...taskAssignees(draft), m.id]
                      : taskAssignees(draft).filter((uid) => uid !== m.id);
                    setDraft((d) => ({
                      ...d,
                      assigneeIds: ids,
                      assigneeId: ids[0] || "",
                    }));
                  }}
                />
                {m.name}
              </label>
            ))}
        </fieldset>
        <div className="form-grid">
          <label>
            ステータス
            <select
              aria-label="ステータス"
              value={draft.status}
              onChange={(e) => update("status", e.target.value)}
            >
              {statusKeys.map((s) => (
                <option key={s} value={s}>
                  {STATUS[s].label}
                </option>
              ))}
            </select>
          </label>
          <label>
            担当者
            <select
              aria-label="担当者"
              value={draft.assigneeId}
              onChange={(e) => {
                const uid = e.target.value;
                setDraft((d) => ({
                  ...d,
                  assigneeId: uid,
                  assigneeIds: uid
                    ? [
                        uid,
                        ...taskAssignees(d).filter(
                          (x) => x !== uid && x !== d.assigneeId,
                        ),
                      ]
                    : [],
                }));
              }}
            >
              <option value="">未割り当て</option>
              {data.members
                .filter((m) => m.active || m.id === draft.assigneeId)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {!m.active ? "（利用停止）" : ""}
                  </option>
                ))}
            </select>
          </label>
          <label>
            公開範囲
            <select
              aria-label="公開範囲"
              value={draft.visibility || "workspace"}
              disabled={
                !!task &&
                data.user.role !== "admin" &&
                task.createdBy !== data.user.id
              }
              onChange={(e) => update("visibility", e.target.value)}
            >
              <option value="workspace">社内公開（メンバー全員）</option>
              <option value="private">非公開（作成者・担当者・管理者）</option>
            </select>
          </label>
          <label>
            繰り返し
            <select
              aria-label="繰り返し"
              value={draft.recurrence?.frequency || "none"}
              onChange={(e) =>
                update(
                  "recurrence",
                  e.target.value === "none"
                    ? null
                    : { frequency: e.target.value, interval: 1 },
                )
              }
            >
              <option value="none">繰り返さない</option>
              <option value="daily">日次</option>
              <option value="weekly">週次</option>
              <option value="monthly">月次</option>
            </select>
          </label>
          {draft.recurrence && (
            <label>
              繰り返し間隔
              <input
                aria-label="繰り返し間隔"
                type="number"
                min="1"
                max="12"
                value={draft.recurrence.interval}
                onChange={(e) =>
                  update("recurrence", {
                    ...draft.recurrence,
                    interval: Number(e.target.value),
                  })
                }
              />
              <small>
                完了時に次回を作成します。月末日は短い月の末日に調整します。
              </small>
            </label>
          )}
          <label>
            開始日
            <input
              type="date"
              value={draft.startDate}
              onChange={(e) => update("startDate", e.target.value)}
            />
          </label>
          <label>
            期日
            <input
              type="date"
              min={draft.startDate || undefined}
              value={draft.dueDate}
              onChange={(e) => update("dueDate", e.target.value)}
            />
          </label>
          <label>
            優先度
            <select
              aria-label="優先度"
              value={draft.priority}
              onChange={(e) => update("priority", e.target.value)}
            >
              {Object.entries(PRIORITY).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            タグ（カンマ区切り）
            <input
              value={draft.tags.join(",")}
              onChange={(e) =>
                update("tags", e.target.value.split(",").slice(0, 8))
              }
              placeholder="企画, デザイン"
            />
          </label>
        </div>
        <fieldset className="project-picker">
          <legend>
            プロジェクト <small>複数選択すると、同じタスクを共有できます</small>
          </legend>
          <div>
            {data.projects.map((p) => (
              <label
                key={p.id}
                className={`project-choice ${draft.projectIds.includes(p.id) ? "checked" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={draft.projectIds.includes(p.id)}
                  onChange={(e) =>
                    update(
                      "projectIds",
                      e.target.checked
                        ? [...draft.projectIds, p.id]
                        : draft.projectIds.filter((id) => id !== p.id),
                    )
                  }
                />
                <i className={`project-dot ${p.color}`} />
                {p.name}
              </label>
            ))}
          </div>
          {!data.projects.length && (
            <p className="form-error">先にプロジェクトを作成してください。</p>
          )}
        </fieldset>
        <label>
          説明
          <textarea
            aria-label="説明"
            rows={4}
            value={draft.description}
            onChange={(e) => update("description", e.target.value)}
            placeholder="目的や進め方、チームに伝えたいことを書きましょう。"
          />
        </label>
        {fields.length > 0 && (
          <div className="custom-fields">
            <h3>カスタムフィールド</h3>
            <div className="form-grid">
              {fields.map((f) => (
                <label key={f.id}>
                  {f.name}
                  {f.type === "select" ? (
                    <select
                      aria-label={f.name}
                      value={draft.custom[f.id] ?? ""}
                      onChange={(e) =>
                        update("custom", {
                          ...draft.custom,
                          [f.id]: e.target.value,
                        })
                      }
                    >
                      <option value="">選択してください</option>
                      {f.options.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={f.type === "number" ? "number" : "text"}
                      step={f.type === "number" ? "any" : undefined}
                      value={draft.custom[f.id] ?? ""}
                      onChange={(e) =>
                        update("custom", {
                          ...draft.custom,
                          [f.id]: e.target.value,
                        })
                      }
                    />
                  )}
                </label>
              ))}
            </div>
          </div>
        )}
        <details className="task-extra">
          <summary>
            <Link2 size={15} />
            依存関係・資料リンク <ChevronDown size={14} />
          </summary>
          <label>
            このタスクの前に完了するタスク
            <select
              value=""
              onChange={(e) => {
                if (
                  e.target.value &&
                  !draft.dependencies.includes(e.target.value)
                )
                  update("dependencies", [
                    ...draft.dependencies,
                    e.target.value,
                  ]);
              }}
            >
              <option value="">依存タスクを追加…</option>
              {data.tasks
                .filter(
                  (t) =>
                    t.id !== task?.id && !draft.dependencies.includes(t.id),
                )
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
            </select>
          </label>
          <div className="dependency-tags">
            {draft.dependencies.map((tid) => (
              <span key={tid} className="tag">
                {data.tasks.find((t) => t.id === tid)?.title}
                <button
                  type="button"
                  aria-label="依存関係を解除"
                  onClick={() =>
                    update(
                      "dependencies",
                      draft.dependencies.filter((id) => id !== tid),
                    )
                  }
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
          <h4>Google Drive・資料リンク</h4>
          {draft.links.map((l, i) => (
            <div className="link-row" key={i}>
              <Link2 size={14} />
              <a href={l.url} target="_blank" rel="noreferrer">
                {l.name}
                <ExternalLink size={12} />
              </a>
              <button
                type="button"
                className="icon-button"
                aria-label="資料リンクを削除"
                onClick={() =>
                  update(
                    "links",
                    draft.links.filter((_, j) => i !== j),
                  )
                }
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <div className="link-inputs">
            <input
              aria-label="資料名"
              placeholder="資料名"
              value={linkName}
              onChange={(e) => setLinkName(e.target.value)}
            />
            <input
              aria-label="資料URL"
              placeholder="https://docs.google.com/…"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
            />
            <button
              type="button"
              className="button"
              disabled={!linkUrl}
              onClick={() => {
                try {
                  const u = new URL(linkUrl);
                  if (u.protocol !== "https:") throw Error();
                  update("links", [
                    ...draft.links,
                    { name: linkName || "資料", url: u.href },
                  ]);
                  setLinkName("");
                  setLinkUrl("");
                  setError("");
                } catch {
                  setError("httpsで始まる有効なURLを入力してください。");
                }
              }}
            >
              追加
            </button>
          </div>
        </details>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <span>
            {task
              ? "変更は保存すると反映されます"
              : "作成後にコメント・承認を利用できます"}
          </span>
          <button type="button" className="button" onClick={onClose}>
            キャンセル
          </button>
          <button
            className="button primary"
            disabled={busy || !draft.projectIds.length}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Check size={16} />
            )}{" "}
            {task ? "変更を保存" : "タスクを作成"}
          </button>
        </div>
      </form>
      {task && (
        <div className="task-collaboration">
          <section className="approval-section">
            <h3>
              <ShieldCheck size={17} />
              承認
            </h3>
            {current?.approval && (
              <p className={`approval-status ${current.approval.status}`}>
                {current.approval.status === "pending"
                  ? `${data.members.find((m) => m.id === current.approval?.reviewerId)?.name}さんの承認待ち`
                  : current.approval.status === "approved"
                    ? "このタスクは承認されました"
                    : "差し戻されました。内容を見直して再申請できます。"}
              </p>
            )}
            {current?.approval?.status === "pending" ? (
              (current.approval.reviewerId === data.user.id ||
                data.user.role === "admin") && (
                <div className="inline-actions">
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        onAction(`/tasks/${task.id}/approval`, {
                          action: "approve",
                        }),
                      )
                    }
                  >
                    <Check size={15} />
                    承認する
                  </button>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        onAction(`/tasks/${task.id}/approval`, {
                          action: "reject",
                        }),
                      )
                    }
                  >
                    差し戻す
                  </button>
                </div>
              )
            ) : (
              <div className="inline-actions">
                <select
                  aria-label="承認担当者"
                  value={reviewer}
                  onChange={(e) => setReviewer(e.target.value)}
                >
                  <option value="">承認担当者を選択</option>
                  {data.members
                    .filter((m) => m.active)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
                <button
                  className="button"
                  disabled={!reviewer || busy}
                  onClick={() =>
                    run(() =>
                      onAction(`/tasks/${task.id}/approval`, {
                        action: "request",
                        reviewerId: reviewer,
                      }),
                    )
                  }
                >
                  承認を申請
                </button>
              </div>
            )}
          </section>
          <section className="comments-section">
            <h3>
              <MessageCircle size={17} />
              コメント <span>{current?.comments.length || 0}</span>
            </h3>
            {current?.comments.map((c) => (
              <div className="comment-item" key={c.id}>
                <Avatar member={data.members.find((m) => m.id === c.userId)} />
                <div>
                  <strong>
                    {data.members.find((m) => m.id === c.userId)?.name}
                  </strong>
                  <small>{relative(c.createdAt)}</small>
                  <p>{c.text}</p>
                </div>
              </div>
            ))}
            <form
              className="comment-form"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await onAction(`/tasks/${task.id}/comments`, {
                    text: comment,
                  });
                  setComment("");
                });
              }}
            >
              <textarea
                aria-label="コメント"
                placeholder="チームにコメントを送る…"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                maxLength={5000}
              />
              <button
                className="button primary compact"
                disabled={!comment.trim() || busy}
              >
                <Send size={15} />
                送信
              </button>
            </form>
          </section>
          <AuditHistory
            request={api}
            kind="tasks"
            recordId={task.id}
            members={data.members}
          />
          <div className="task-bottom-actions">
            {task.dueDate && (
              <>
                <a
                  className="text-button"
                  href={calendarUrl()}
                  target="_blank"
                  rel="noreferrer"
                >
                  <CalendarDays size={14} />
                  Google Calendarに追加
                  <ExternalLink size={12} />
                </a>
                <a
                  className="text-button"
                  href={`/api/tasks/${task.id}/calendar`}
                >
                  ICSを保存
                </a>
              </>
            )}
            {confirmDelete ? (
              <div className="delete-confirm">
                <span>このタスクを削除しますか？</span>
                <button
                  className="button danger"
                  disabled={busy}
                  onClick={() => run(onDelete)}
                >
                  削除する
                </button>
                <button
                  className="text-button"
                  onClick={() => setConfirmDelete(false)}
                >
                  戻る
                </button>
              </div>
            ) : (
              <button
                className="text-button danger-text"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={14} />
                削除
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function ProjectDialog({
  project,
  members,
  orgUnits,
  onClose,
  onSave,
}: {
  project: Project | null;
  members: Member[];
  orgUnits: OrgUnit[];
  onClose: () => void;
  onSave: (body: unknown) => Promise<void>;
}) {
  const [fields, setFields] = useState<Field[]>(project?.fields || []);
  const [rules, setRules] = useState<Rule[]>(project?.rules || []);
  const [color, setColor] = useState(project?.color || "sage");
  const [memberIds, setMemberIds] = useState<string[]>(
    project?.memberIds || [],
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setError("");
    try {
      await onSave({ ...body, color, fields, rules, memberIds });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={project ? "プロジェクト設定" : "新しいプロジェクト"}
      onClose={onClose}
      wide
    >
      <form className="standard-form" onSubmit={submit}>
        <label>
          プロジェクト名
          <input
            name="name"
            defaultValue={project?.name}
            placeholder="例：新サービスのリリース"
            required
            maxLength={120}
          />
        </label>
        <label>
          説明
          <textarea
            name="description"
            aria-label="説明"
            defaultValue={project?.description}
            placeholder="プロジェクトの目的をチームに共有しましょう。"
            rows={3}
          />
        </label>
        <div className="form-grid">
          <label>
            目標期日
            <input name="dueDate" type="date" defaultValue={project?.dueDate} />
          </label>
          <label>
            進行状況
            <select
              aria-label="進行状況"
              name="status"
              defaultValue={project?.status || "ontrack"}
            >
              <option value="ontrack">順調</option>
              <option value="atrisk">要確認</option>
              <option value="complete">完了</option>
            </select>
          </label>
        </div>
        <label>
          担当組織
          <OrganizationSelect
            units={orgUnits}
            name="orgUnitId"
            defaultValue={project?.orgUnitId || ""}
          />
        </label>
        <fieldset className="assignee-choices">
          <legend>参加メンバー（部署をまたいで選択可能）</legend>
          {members.map((m) => (
            <label className="check-label" key={m.id}>
              <input
                type="checkbox"
                checked={memberIds.includes(m.id)}
                onChange={(e) =>
                  setMemberIds(
                    e.target.checked
                      ? [...memberIds, m.id]
                      : memberIds.filter((uid) => uid !== m.id),
                  )
                }
              />
              {m.name}
            </label>
          ))}
        </fieldset>
        <label>プロジェクトカラー</label>
        <div className="color-picker">
          {["sage", "peach", "lavender", "blue", "rose"].map((c) => (
            <button
              type="button"
              key={c}
              className={c}
              aria-label={`${c}を選択`}
              aria-pressed={c === color}
              onClick={() => setColor(c)}
            >
              {c === color && <Check size={18} />}
            </button>
          ))}
        </div>
        <input type="hidden" name="icon" value={project?.icon || "folder"} />
        <section className="config-section">
          <div className="section-heading">
            <h3>
              <List size={17} />
              カスタムフィールド
            </h3>
            <button
              className="text-button"
              type="button"
              onClick={() =>
                setFields([
                  ...fields,
                  {
                    id: crypto.randomUUID(),
                    name: "",
                    type: "text",
                    options: [],
                  },
                ])
              }
            >
              <Plus size={14} />
              追加
            </button>
          </div>
          <p>予算、対象ターゲットなど、チーム独自の項目を追加できます。</p>
          {fields.map((f, i) => (
            <div className="config-item" key={f.id}>
              <div className="inline-actions">
                <input
                  aria-label="フィールド名"
                  placeholder="項目名（例：予算）"
                  value={f.name}
                  required
                  onChange={(e) =>
                    setFields(
                      fields.map((x, j) =>
                        j === i ? { ...x, name: e.target.value } : x,
                      ),
                    )
                  }
                />
                <select
                  aria-label="フィールドの種類"
                  value={f.type}
                  onChange={(e) =>
                    setFields(
                      fields.map((x, j) =>
                        j === i
                          ? { ...x, type: e.target.value as Field["type"] }
                          : x,
                      ),
                    )
                  }
                >
                  <option value="text">テキスト</option>
                  <option value="number">数値</option>
                  <option value="select">選択肢</option>
                </select>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="フィールドを削除"
                  onClick={() => setFields(fields.filter((_, j) => j !== i))}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              {f.type === "select" && (
                <input
                  aria-label="選択肢"
                  placeholder="選択肢をカンマ区切りで入力"
                  required
                  value={f.options.join(",")}
                  onChange={(e) =>
                    setFields(
                      fields.map((x, j) =>
                        j === i
                          ? { ...x, options: e.target.value.split(",") }
                          : x,
                      ),
                    )
                  }
                />
              )}
            </div>
          ))}
        </section>
        <section className="config-section">
          <div className="section-heading">
            <h3>
              <Zap size={17} />
              自動化ルール
            </h3>
            <button
              className="text-button"
              type="button"
              onClick={() =>
                setRules([
                  ...rules,
                  {
                    id: crypto.randomUUID(),
                    status: "review",
                    assigneeId: "",
                    dueDays: 3,
                    enabled: true,
                  },
                ])
              }
            >
              <Plus size={14} />
              追加
            </button>
          </div>
          <p>ステータスが変わったとき、担当者や期日を自動で更新します。</p>
          {rules.map((r, i) => (
            <div className="rule-item" key={r.id}>
              <div>
                <label>
                  変更後のステータス
                  <select
                    value={r.status}
                    onChange={(e) =>
                      setRules(
                        rules.map((x, j) =>
                          j === i
                            ? { ...x, status: e.target.value as Status }
                            : x,
                        ),
                      )
                    }
                  >
                    {statusKeys.map((s) => (
                      <option key={s} value={s}>
                        {STATUS[s].label}
                      </option>
                    ))}
                  </select>
                </label>
                <ArrowRight size={18} />
                <label>
                  担当者に設定
                  <select
                    value={r.assigneeId}
                    onChange={(e) =>
                      setRules(
                        rules.map((x, j) =>
                          j === i ? { ...x, assigneeId: e.target.value } : x,
                        ),
                      )
                    }
                  >
                    <option value="">変更しない</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  期日：何日後？
                  <input
                    type="number"
                    min="0"
                    max="365"
                    placeholder="変更なし"
                    value={r.dueDays ?? ""}
                    onChange={(e) =>
                      setRules(
                        rules.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                dueDays:
                                  e.target.value === ""
                                    ? null
                                    : Number(e.target.value),
                              }
                            : x,
                        ),
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="ルールを削除"
                  onClick={() => setRules(rules.filter((_, j) => j !== i))}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={(e) =>
                    setRules(
                      rules.map((x, j) =>
                        j === i ? { ...x, enabled: e.target.checked } : x,
                      ),
                    )
                  }
                />
                ルールを有効にする
              </label>
            </div>
          ))}
        </section>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="button" onClick={onClose}>
            キャンセル
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Check size={16} />
            )}{" "}
            {project ? "設定を保存" : "プロジェクトを作成"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function MemberForm({ onSave }: { onSave: (body: unknown) => Promise<void> }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="standard-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(e.currentTarget));
        setBusy(true);
        try {
          await onSave(body);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="info-box">
        <ShieldCheck size={19} />
        <span>
          追加後、メールアドレスと仮パスワードを本人に共有してください。初回ログイン時にパスワード変更が必要です。
        </span>
      </div>
      <label>
        名前
        <input name="name" required maxLength={80} placeholder="山田 太郎" />
      </label>
      <label>
        社内メールアドレス
        <input
          name="email"
          type="email"
          required
          placeholder="member@company.co.jp"
          autoComplete="off"
        />
      </label>
      <label>
        仮パスワード
        <input
          name="password"
          type="password"
          required
          minLength={12}
          maxLength={256}
          placeholder="12文字以上"
          autoComplete="new-password"
        />
      </label>
      <label>
        権限
        <select aria-label="権限" name="role">
          <option value="member">メンバー</option>
          <option value="admin">管理者</option>
        </select>
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button className="button primary" disabled={busy}>
          <Plus size={16} />
          メンバーを追加
        </button>
      </div>
    </form>
  );
}
function PasswordForm({
  onSave,
  required = false,
}: {
  onSave: (body: unknown) => Promise<void>;
  required?: boolean;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="standard-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(e.currentTarget));
        setBusy(true);
        setError("");
        try {
          if (body.password !== body.confirm)
            throw new Error("新しいパスワードが一致しません。");
          await onSave(body);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {required && (
        <>
          <h2>はじめに、パスワードを変更しましょう。</h2>
          <p>
            管理者から受け取った仮パスワードを、あなただけのパスワードに変更してください。
          </p>
        </>
      )}
      <label>
        現在のパスワード
        <input
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          maxLength={256}
        />
      </label>
      <label>
        新しいパスワード
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={256}
          placeholder="12文字以上"
          required
        />
      </label>
      <label>
        新しいパスワード（確認）
        <input
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={256}
          required
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button className="button primary" disabled={busy}>
          <LockKeyhole size={16} />
          パスワードを変更
        </button>
      </div>
    </form>
  );
}
function RequestForm({
  projects,
  onSubmit,
}: {
  projects: Project[];
  onSubmit: (body: unknown) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="standard-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fields = Object.fromEntries(new FormData(form));
        setBusy(true);
        setError("");
        setSuccess(false);
        try {
          await onSubmit({ ...fields, projectIds: [fields.projectId] });
          form.reset();
          setSuccess(true);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        届け先のプロジェクト
        <select
          name="projectId"
          required
          defaultValue={projects.find((p) => p.icon === "inbox")?.id || ""}
        >
          <option value="" disabled>
            プロジェクトを選択
          </option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        依頼のタイトル
        <input
          name="title"
          placeholder="例：新入社員のアカウント発行"
          required
          maxLength={200}
        />
      </label>
      <label>
        依頼の内容
        <textarea
          name="description"
          placeholder="お願いしたいこと、背景、必要な情報などを記入してください。"
          rows={6}
          required
        />
      </label>
      <div className="form-grid">
        <label>
          希望期日
          <input type="date" name="dueDate" />
        </label>
        <label>
          優先度
          <select name="priority" defaultValue="medium">
            <option value="low">低 — 急ぎではありません</option>
            <option value="medium">中 — 通常の依頼です</option>
            <option value="high">高 — 優先的にお願いします</option>
          </select>
        </label>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <div className="success-box" role="status">
          <CheckCircle2 size={18} />
          依頼を送信しました。プロジェクトから進捗を確認できます。
        </div>
      )}
      <div className="form-actions">
        <button className="button primary" disabled={busy || !projects.length}>
          <Send size={16} />
          依頼を送信する
        </button>
      </div>
    </form>
  );
}
