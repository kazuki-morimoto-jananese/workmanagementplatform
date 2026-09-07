import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  randomUUID,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { AsyncLocalStorage } from "node:async_hooks";
export const auditContext = new AsyncLocalStorage();
const scrypt = promisify(scryptCb);
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export async function hashPassword(value) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${(await scrypt(value, salt, 64)).toString("hex")}`;
}
export async function verifyPassword(value, hash) {
  const [salt, key] = hash.split(":");
  const actual = await scrypt(value, salt, 64);
  return timingSafeEqual(Buffer.from(key, "hex"), actual);
}
export const safeUser = ({ password, ...user }) => user;
export function openStore(directory) {
  mkdirSync(resolve(directory), { recursive: true });
  const db = new DatabaseSync(resolve(directory, "worknest.sqlite"));
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
  );
  return openStoreDatabase(db);
}
export function openStoreDatabase(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id));
    CREATE TABLE IF NOT EXISTS audit_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, record_id TEXT NOT NULL, action TEXT NOT NULL, actor_id TEXT NOT NULL, created_at TEXT NOT NULL, before_data TEXT, after_data TEXT);
    CREATE INDEX IF NOT EXISTS audit_record ON audit_log(kind,record_id,seq);
    CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY);`);
  const tracked = new Set([
    "tasks",
    "projects",
    "salesAccounts",
    "salesMasters",
    "salesReviews",
    "salesMinutes",
    "salesOpportunities",
    "salesActivities",
    "salesSettings",
    "orgUnits",
    "settings",
  ]);
  const audit = (kind, rid, before, after, action) =>
    db
      .prepare(
        "INSERT INTO audit_log(kind,record_id,action,actor_id,created_at,before_data,after_data) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        kind,
        rid,
        action ||
          (after === null ? "delete" : before === null ? "create" : "update"),
        auditContext.getStore()?.actorId || "system",
        now(),
        before,
        after,
      );
  const atomic = (fn) => {
    if (db.isTransaction) return fn();
    if (db.transactionSync) return db.transactionSync(fn);
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  // Existing content becomes the baseline. Earlier overwritten versions cannot be recovered.
  atomic(() => {
    if (!db.prepare("SELECT 1 FROM migrations WHERE id='audit-v1'").get()) {
      for (const row of db.prepare("SELECT * FROM records").all())
        if (tracked.has(row.kind))
          audit(row.kind, row.id, null, row.data, "baseline");
      for (const row of db.prepare("SELECT * FROM users").all())
        audit(
          "members",
          row.id,
          null,
          JSON.stringify(safeUser(JSON.parse(row.data))),
          "baseline",
        );
      db.prepare("INSERT INTO migrations VALUES ('audit-v1')").run();
    }
  });
  return {
    db,
    users: () =>
      db
        .prepare("SELECT data FROM users")
        .all()
        .map((r) => JSON.parse(r.data)),
    user: (uid) => {
      const row = db.prepare("SELECT data FROM users WHERE id=?").get(uid);
      return row ? JSON.parse(row.data) : null;
    },
    userByEmail: (email) => {
      const row = db.prepare("SELECT data FROM users WHERE email=?").get(email);
      return row ? JSON.parse(row.data) : null;
    },
    saveUser: (user) =>
      atomic(() => {
        const old = db
          .prepare("SELECT data FROM users WHERE id=?")
          .get(user.id);
        const before = old
          ? JSON.stringify(safeUser(JSON.parse(old.data)))
          : null;
        const after = JSON.stringify(safeUser(user));
        const result = db
          .prepare(
            "INSERT INTO users VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,data=excluded.data",
          )
          .run(user.id, user.email, JSON.stringify(user));
        if (before !== after) audit("members", user.id, before, after);
        return result;
      }),
    all: (kind) =>
      db
        .prepare("SELECT data FROM records WHERE kind=? ORDER BY rowid")
        .all(kind)
        .map((r) => JSON.parse(r.data)),
    get: (kind, rid) => {
      const row = db
        .prepare("SELECT data FROM records WHERE kind=? AND id=?")
        .get(kind, rid);
      return row ? JSON.parse(row.data) : null;
    },
    put: (kind, record) =>
      atomic(() => {
        const before =
          db
            .prepare("SELECT data FROM records WHERE kind=? AND id=?")
            .get(kind, record.id)?.data ?? null;
        const after = JSON.stringify(record);
        const result = db
          .prepare(
            "INSERT INTO records VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data",
          )
          .run(kind, record.id, after);
        if (tracked.has(kind) && before !== after)
          audit(kind, record.id, before, after);
        return result;
      }),
    remove: (kind, rid) =>
      atomic(() => {
        const before = db
          .prepare("SELECT data FROM records WHERE kind=? AND id=?")
          .get(kind, rid)?.data;
        const result = db
          .prepare("DELETE FROM records WHERE kind=? AND id=?")
          .run(kind, rid);
        if (tracked.has(kind) && before) audit(kind, rid, before, null);
        return result;
      }),
    audit: (kind, rid, after) =>
      audit(kind, rid, null, JSON.stringify(after), "event"),
    transaction(fn) {
      return atomic(fn);
    },
  };
}
export function seed(store, user, workspace, samples) {
  store.put("settings", { id: "workspace", name: workspace });
  if (!samples) return;
  const day = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  };
  const projects = [
    {
      id: id(),
      name: "コーポレートサイト リニューアル",
      description:
        "私たちらしさが伝わる、新しいWebサイトへ。企画から公開まで、チームで一歩ずつ。",
      color: "sage",
      icon: "globe",
      status: "ontrack",
      dueDate: day(25),
      fields: [],
      rules: [],
    },
    {
      id: id(),
      name: "秋のマーケティング施策",
      description: "次の出会いをつくる、秋のコミュニケーション。",
      color: "peach",
      icon: "megaphone",
      status: "ontrack",
      dueDate: day(35),
      fields: [],
      rules: [],
    },
    {
      id: id(),
      name: "チームの業務改善",
      description: "日々の小さな工夫を、チームの大きな力に。",
      color: "lavender",
      icon: "sparkles",
      status: "ontrack",
      dueDate: day(45),
      fields: [],
      rules: [],
    },
    {
      id: id(),
      name: "社内リクエスト",
      description: "備品・アカウント・制作などの社内依頼窓口。",
      color: "blue",
      icon: "inbox",
      status: "ontrack",
      dueDate: "",
      fields: [],
      rules: [],
    },
  ];
  projects.forEach((p) =>
    store.put("projects", { ...p, createdAt: now(), ownerId: user.id }),
  );
  const titles = [
    "現行サイトの課題を洗い出す",
    "サイト構成・ページ一覧の作成",
    "トップページのワイヤーフレーム",
    "デザインの方向性を決める",
    "ブランド写真の撮影準備",
    "トップページのデザイン制作",
    "コンテンツ原稿の作成",
    "開発環境のセットアップ",
    "ファーストビューの実装",
    "公開前の最終チェック",
    "キャンペーンの企画をまとめる",
    "SNS投稿カレンダーの作成",
    "週次ミーティングの見直し",
    "オンボーディング資料の更新",
  ];
  titles.forEach((title, i) => {
    const status =
      i < 2
        ? "done"
        : i === 3
          ? "review"
          : [2, 4, 5, 10, 12].includes(i)
            ? "progress"
            : "todo";
    store.put("tasks", {
      id: id(),
      title,
      description:
        i === 2
          ? "ユーザーの導線を整理し、トップページの構成を作成します。\n・ファーストビュー\n・サービス紹介\n・お問い合わせへの導線\nを中心に、チームでレビューしましょう。"
          : "",
      projectIds: [projects[i < 10 ? 0 : i < 12 ? 1 : 2].id],
      status,
      priority: i % 3 === 0 ? "high" : i % 3 === 1 ? "medium" : "low",
      assigneeId: i % 4 === 3 ? "" : user.id,
      startDate: day(i - 6),
      dueDate: day(i - 2),
      tags:
        i < 10 ? [i < 4 ? "企画" : i < 7 ? "デザイン" : "開発"] : ["チーム"],
      dependencies: [],
      custom: {},
      links: [],
      comments: [],
      approval: null,
      version: 1,
      createdAt: now(),
      updatedAt: now(),
      createdBy: user.id,
    });
  });
}
