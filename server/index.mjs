import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createSalesService } from "./sales.mjs";
import {
  createWorkspaceService,
  assignees,
  orgReference,
} from "./workspace.mjs";
import {
  openStore,
  id,
  now,
  digest,
  hashPassword,
  verifyPassword,
  safeUser,
  seed,
  auditContext,
} from "./store.mjs";

const root = import.meta.url?.startsWith("file:")
  ? resolve(fileURLToPath(new URL("..", import.meta.url)))
  : process.cwd();
const statuses = ["todo", "progress", "review", "done"];
const priorities = ["low", "medium", "high"];
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (condition, status, message) => {
  if (!condition) throw new HttpError(status, message);
};
const str = (value, max = 5000) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const date = (value) => {
  const v = str(value, 10);
  fail(
    !v ||
      (/^\d{4}-\d{2}-\d{2}$/.test(v) &&
        Number.isFinite(Date.parse(v)) &&
        new Date(v).toISOString().slice(0, 10) === v),
    400,
    "日付が正しくありません。",
  );
  return v;
};
const emailValid = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export function createApp(options = {}) {
  const store =
    options.store ||
    openStore(options.dataDir || process.env.DATA_DIR || resolve(root, "data"));
  const production =
    options.production ?? process.env.NODE_ENV === "production";
  const allowedDomain = (
    options.allowedDomain ??
    process.env.ALLOWED_EMAIL_DOMAIN ??
    ""
  ).toLowerCase();
  const secureCookie = production || process.env.COOKIE_SECURE === "true";
  const limiter = new Map();
  const checkEmail = (raw) => {
    const email = str(raw, 254).toLowerCase();
    fail(emailValid(email), 400, "有効なメールアドレスを入力してください。");
    fail(
      !allowedDomain || email.split("@")[1] === allowedDomain,
      400,
      `社内ドメイン（${allowedDomain}）のメールアドレスを指定してください。`,
    );
    return email;
  };
  const checkPassword = (password) =>
    fail(
      typeof password === "string" &&
        password.length >= 12 &&
        password.length <= 256,
      400,
      "パスワードは12〜256文字で入力してください。",
    );
  const activity = (user, text, taskId = "") => {
    store.put("activity", {
      id: id(),
      userId: user.id,
      text,
      taskId,
      createdAt: now(),
    });
  };
  const notify = (userId, text, taskId) => {
    if (userId)
      store.put("notifications", {
        id: id(),
        userId,
        text,
        taskId,
        read: false,
        createdAt: now(),
      });
  };
  const activeUser = (uid) => !uid || store.user(uid)?.active;
  const taskInput = (body, previous = null) => {
    const t = { ...(previous || {}), ...body };
    const title = str(t.title, 200);
    fail(title, 400, "タスク名を入力してください。");
    const projectIds = [
      ...new Set(
        Array.isArray(t.projectIds)
          ? t.projectIds.filter((x) => typeof x === "string")
          : [],
      ),
    ];
    fail(
      projectIds.length > 0 &&
        projectIds.length <= 20 &&
        projectIds.every((pid) => store.get("projects", pid)),
      400,
      "プロジェクトを選択してください。",
    );
    fail(statuses.includes(t.status), 400, "ステータスが正しくありません。");
    fail(priorities.includes(t.priority), 400, "優先度が正しくありません。");
    const rawAssignees = Object.hasOwn(body, "assigneeIds")
      ? body.assigneeIds
      : Object.hasOwn(body, "assigneeId") &&
          body.assigneeId !== previous?.assigneeId
        ? body.assigneeId
          ? [body.assigneeId]
          : []
        : assignees(t);
    fail(Array.isArray(rawAssignees), 400, "担当者の形式を確認してください。");
    const assigneeIds = [...new Set(rawAssignees)];
    fail(
      assigneeIds.length <= 30 &&
        assigneeIds.every(
          (uid) =>
            typeof uid === "string" &&
            uid &&
            (activeUser(uid) || assignees(previous || {}).includes(uid)),
        ),
      400,
      "有効な担当者を選択してください。",
    );
    const assigneeId = assigneeIds[0] || "";
    const startDate = date(t.startDate),
      dueDate = date(t.dueDate);
    fail(
      !startDate || !dueDate || startDate <= dueDate,
      400,
      "期日は開始日以降を指定してください。",
    );
    const dependencies = [
      ...new Set(Array.isArray(t.dependencies) ? t.dependencies : []),
    ];
    fail(
      dependencies.length <= 30 &&
        dependencies.every(
          (d) =>
            typeof d === "string" &&
            d !== previous?.id &&
            store.get("tasks", d),
        ),
      400,
      "依存タスクが正しくありません。",
    );
    const reaches = (tid, target, seen = new Set()) => {
      if (tid === target) return true;
      if (seen.has(tid)) return false;
      seen.add(tid);
      return (store.get("tasks", tid)?.dependencies || []).some((d) =>
        reaches(d, target, seen),
      );
    };
    fail(
      !previous || !dependencies.some((d) => reaches(d, previous.id)),
      400,
      "依存関係が循環しています。",
    );
    const links = (Array.isArray(t.links) ? t.links : [])
      .slice(0, 10)
      .map((l) => {
        let url;
        try {
          url = new URL(l.url);
        } catch {
          throw new HttpError(400, "資料のURLを確認してください。");
        }
        fail(
          url.protocol === "https:",
          400,
          "資料リンクにはhttpsのURLを指定してください。",
        );
        return { name: str(l.name, 100) || "資料", url: url.href };
      });
    const custom = {};
    for (const pid of projectIds)
      for (const field of store.get("projects", pid).fields || []) {
        const value = t.custom?.[field.id];
        if (value === undefined || value === "") continue;
        if (field.type === "number") {
          fail(
            Number.isFinite(Number(value)),
            400,
            `${field.name}には数値を入力してください。`,
          );
          custom[field.id] = Number(value);
        } else {
          const v = str(value, 500);
          fail(
            field.type !== "select" || field.options.includes(v),
            400,
            `${field.name}の選択肢が正しくありません。`,
          );
          custom[field.id] = v;
        }
      }
    const accountId = str(t.accountId, 200);
    const minuteId = str(t.minuteId, 100);
    if (previous)
      fail(
        minuteId === (previous.minuteId || "") &&
          (t.minuteActionIndex ?? null) ===
            (previous.minuteActionIndex ?? null),
        400,
        "議事録の出典情報は変更できません。",
      );
    fail(
      !accountId || store.get("salesAccounts", accountId),
      400,
      "営業アカウントが見つかりません。",
    );
    fail(
      !minuteId || store.get("salesMinutes", minuteId),
      400,
      "議事録が見つかりません。",
    );
    if (minuteId)
      fail(
        store.get("salesMinutes", minuteId).accountId === accountId,
        400,
        "議事録のアカウントが一致しません。",
      );
    const minuteActionIndex =
      t.minuteActionIndex === undefined || t.minuteActionIndex === null
        ? null
        : t.minuteActionIndex;
    fail(
      minuteActionIndex === null ||
        (minuteId &&
          Number.isInteger(minuteActionIndex) &&
          minuteActionIndex >= 0),
      400,
      "議事録のアクションが正しくありません。",
    );
    return {
      accountId,
      minuteId,
      minuteActionIndex,
      title,
      description: str(t.description, 10000),
      projectIds,
      status: t.status,
      priority: t.priority,
      assigneeId,
      assigneeIds,
      startDate,
      dueDate,
      dependencies,
      links,
      custom,
      tags: (Array.isArray(t.tags) ? t.tags : [])
        .slice(0, 8)
        .map((x) => str(x, 30))
        .filter(Boolean),
    };
  };
  const saveTask = (body, user, previous = null) =>
    store.transaction(() => {
      if (previous)
        fail(
          body.version === previous.version,
          409,
          "他のメンバーが更新しました。最新データを再読み込みしてから編集してください。",
        );
      const fields = taskInput(body, previous);
      if (previous && previous.status !== fields.status)
        for (const pid of fields.projectIds)
          for (const rule of store.get("projects", pid).rules || [])
            if (rule.enabled && rule.status === fields.status) {
              if (rule.assigneeId && activeUser(rule.assigneeId)) {
                fields.assigneeId = rule.assigneeId;
                fields.assigneeIds = [
                  ...new Set([rule.assigneeId, ...fields.assigneeIds]),
                ];
              }
              if (rule.dueDays !== null) {
                const due = new Date();
                due.setDate(due.getDate() + rule.dueDays);
                fields.dueDate = due.toLocaleDateString("sv-SE", {
                  timeZone: "Asia/Tokyo",
                });
                if (fields.startDate > fields.dueDate)
                  fields.startDate = fields.dueDate;
              }
            }
      const task = {
        id: previous?.id || id(),
        ...fields,
        comments: previous?.comments || [],
        approval: previous?.approval || null,
        version: (previous?.version || 0) + 1,
        createdAt: previous?.createdAt || now(),
        createdBy: previous?.createdBy || user.id,
        updatedAt: now(),
      };
      store.put("tasks", task);
      activity(
        user,
        `「${task.title}」を${previous ? "更新" : "作成"}しました`,
        task.id,
      );
      for (const uid of task.assigneeIds.filter(
        (uid) => uid !== user.id && !assignees(previous || {}).includes(uid),
      ))
        notify(uid, `「${task.title}」の担当者に設定されました`, task.id);
      return task;
    });

  const sales = createSalesService({
    store,
    saveTask,
    activity,
    minuteAdapters: options.minuteAdapters,
    sheetReader: options.sheetReader,
    background: options.background,
  });
  const workspaceService = createWorkspaceService({
    store,
    dataDir: options.dataDir || process.env.DATA_DIR || resolve(root, "data"),
    backupProvider: options.backupProvider,
    storageInfo: options.storageInfo,
  });

  async function handler(req, res) {
    const send = (status, body, headers = {}) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ...headers,
      });
      res.end(JSON.stringify(body));
    };
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;
    const method = req.method;
    const cookie = (value) =>
      `worknest_session=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${value ? 43200 : 0}${secureCookie ? "; Secure" : ""}`;
    try {
      if (!path.startsWith("/api/")) {
        fail(method === "GET" || method === "HEAD", 405, "Method not allowed");
        const dist = resolve(root, "dist");
        let target = resolve(dist, "." + decodeURIComponent(path));
        fail(
          target === dist || target.startsWith(dist + sep),
          403,
          "Forbidden",
        );
        if (!existsSync(target) || !statSync(target).isFile())
          target = resolve(dist, "index.html");
        if (!existsSync(target)) {
          res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
          return res.end(
            "Worknest API is running. Development UI: http://localhost:5173 — or run npm.cmd run build.",
          );
        }
        const types = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".woff2": "font/woff2",
        };
        res.writeHead(200, {
          "Content-Type": types[extname(target)] || "application/octet-stream",
          "Cache-Control":
            extname(target) === ".html" ? "no-cache" : "public, max-age=3600",
        });
        return res.end(method === "HEAD" ? undefined : readFileSync(target));
      }
      let body = {};
      if (!["GET", "HEAD"].includes(method)) {
        fail(
          req.headers["x-worknest"] === "1",
          403,
          "リクエストを確認できませんでした。",
        );
        const origins = [
          (typeof options.appOrigin === "function"
            ? options.appOrigin()
            : options.appOrigin) ||
            process.env.APP_ORIGIN ||
            process.env.RENDER_EXTERNAL_URL,
          ...(production
            ? []
            : [
                `http://${req.headers.host}`,
                "http://localhost:5173",
                "http://127.0.0.1:5173",
              ]),
        ].filter(Boolean);
        fail(
          !req.headers.origin || origins.includes(req.headers.origin),
          403,
          "許可されていない接続元です。",
        );
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          fail(
            size <=
              (path.startsWith("/api/sales/") ? 2 * 1024 * 1024 : 128 * 1024),
            413,
            "入力が大きすぎます。",
          );
          chunks.push(chunk);
        }
        const raw = Buffer.concat(chunks).toString("utf8");
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          throw new HttpError(400, "入力形式が正しくありません。");
        }
        fail(
          body && typeof body === "object" && !Array.isArray(body),
          400,
          "入力形式が正しくありません。",
        );
      }
      const token = req.headers.cookie
        ?.split(";")
        .map((c) => c.trim())
        .find((c) => c.startsWith("worknest_session="))
        ?.split("=")[1];
      const session = token
        ? store.db
            .prepare("SELECT * FROM sessions WHERE token=? AND expires>?")
            .get(digest(token), Date.now())
        : null;
      const user = session ? store.user(session.user_id) : null;
      const signedIn = user?.active ? user : null;
      auditContext.getStore().actorId = signedIn?.id || "anonymous";
      if (path === "/api/health" && method === "GET") {
        store.db.prepare("SELECT 1").get();
        return send(200, { status: "ok" });
      }
      if (path === "/api/auth/status" && method === "GET")
        return send(200, {
          needsSetup: store.users().length === 0,
          requiresSetupToken: production,
          allowedDomain,
          user: signedIn ? safeUser(signedIn) : null,
        });
      if (path === "/api/auth/setup" && method === "POST") {
        fail(store.users().length === 0, 403, "初期設定は完了しています。");
        if (production)
          fail(
            process.env.SETUP_TOKEN &&
              body.setupToken === process.env.SETUP_TOKEN,
            403,
            "初期設定トークンが正しくありません。",
          );
        const email = checkEmail(body.email);
        checkPassword(body.password);
        const name = str(body.name, 80),
          workspace = str(body.workspace, 80);
        fail(
          name && workspace,
          400,
          "名前とワークスペース名を入力してください。",
        );
        const password = await hashPassword(body.password);
        store.transaction(() => {
          fail(store.users().length === 0, 403, "初期設定は完了しています。");
          const admin = {
            id: id(),
            email,
            name,
            password,
            role: "admin",
            active: true,
            mustChangePassword: false,
            createdAt: now(),
          };
          auditContext.getStore().actorId = admin.id;
          store.saveUser(admin);
          seed(store, admin, workspace, body.samples === true);
        });
        return send(201, { ok: true });
      }
      if (path === "/api/auth/login" && method === "POST") {
        const key = req.socket.remoteAddress;
        const time = Date.now();
        for (const [k, v] of limiter) if (v.until < time) limiter.delete(k);
        const attempt = limiter.get(key) || {
          count: 0,
          until: time + 15 * 60 * 1000,
        };
        fail(
          attempt.count < 15,
          429,
          "ログイン試行が多すぎます。15分後に再度お試しください。",
        );
        attempt.count++;
        limiter.set(key, attempt);
        const member = store.userByEmail(str(body.email, 254).toLowerCase());
        // A fixed dummy hash keeps non-existent users on the password-verification path.
        const valid =
          typeof body.password === "string" &&
          body.password.length <= 256 &&
          (await verifyPassword(
            body.password,
            member?.password ||
              "00000000000000000000000000000000:" + "00".repeat(64),
          ));
        fail(
          member?.active && valid,
          401,
          "メールアドレスまたはパスワードが正しくありません。",
        );
        limiter.delete(key);
        const fresh = store.user(member.id);
        fail(
          fresh.active && fresh.password === member.password,
          401,
          "アカウントが更新されました。再度ログインしてください。",
        );
        const newToken = randomBytes(32).toString("hex");
        auditContext.getStore().actorId = member.id;
        store.audit("auth", member.id, { event: "login" });
        store.db.prepare("DELETE FROM sessions WHERE expires<?").run(time);
        store.db
          .prepare("INSERT INTO sessions VALUES (?,?,?)")
          .run(digest(newToken), member.id, time + 43200000);
        return send(
          200,
          { user: safeUser(fresh) },
          { "Set-Cookie": cookie(newToken) },
        );
      }
      fail(signedIn, 401, "ログインしてください。");
      if (path === "/api/auth/logout" && method === "POST") {
        store.audit("auth", user.id, { event: "logout" });
        store.db
          .prepare("DELETE FROM sessions WHERE token=?")
          .run(digest(token));
        return send(200, { ok: true }, { "Set-Cookie": cookie("") });
      }
      if (path === "/api/auth/password" && method === "POST") {
        checkPassword(body.password);
        fail(
          body.password !== body.currentPassword,
          400,
          "現在とは異なるパスワードを設定してください。",
        );
        fail(
          typeof body.currentPassword === "string" &&
            body.currentPassword.length <= 256 &&
            (await verifyPassword(body.currentPassword, user.password)),
          400,
          "現在のパスワードが正しくありません。",
        );
        const password = await hashPassword(body.password);
        const current = store.user(user.id);
        fail(
          current.active && current.password === user.password,
          409,
          "アカウントが更新されました。再ログインしてください。",
        );
        store.saveUser({ ...current, password, mustChangePassword: false });
        store.audit("auth", user.id, { event: "password_changed" });
        store.db
          .prepare("DELETE FROM sessions WHERE user_id=? AND token<>?")
          .run(user.id, digest(token));
        return send(200, { ok: true });
      }
      fail(
        !user.mustChangePassword,
        403,
        "最初にパスワードを変更してください。",
      );
      if (
        await workspaceService.handle({
          path,
          method,
          body,
          user: signedIn,
          send,
          url,
        })
      )
        return;
      if (
        path.startsWith("/api/sales/") &&
        (await sales.handle({ path, method, body, user: signedIn, send, url }))
      )
        return;
      if (path === "/api/bootstrap" && method === "GET")
        return send(200, {
          user: safeUser(user),
          members: store.users().map(safeUser),
          projects: store.all("projects"),
          tasks: store.all("tasks"),
          orgUnits: store.all("orgUnits"),
          salesAccounts: store
            .all("salesAccounts")
            .map((a) => ({ id: a.id, name: a.name, isDemo: !!a.isDemo })),
          activity: store.all("activity").slice(-80).reverse(),
          notifications: store
            .all("notifications")
            .filter((n) => n.userId === user.id)
            .slice(-100)
            .reverse(),
          workspace: store.get("settings", "workspace"),
        });
      if (path === "/api/members" && method === "POST") {
        fail(user.role === "admin", 403, "管理者のみ操作できます。");
        const email = checkEmail(body.email);
        checkPassword(body.password);
        fail(
          !store.userByEmail(email),
          409,
          "このメールアドレスは登録済みです。",
        );
        const name = str(body.name, 80);
        fail(name, 400, "名前を入力してください。");
        const password = await hashPassword(body.password);
        fail(
          store.user(user.id)?.active && store.user(user.id)?.role === "admin",
          403,
          "管理者権限を確認してください。",
        );
        const member = {
          id: id(),
          email,
          name,
          password,
          role: body.role === "admin" ? "admin" : "member",
          active: true,
          mustChangePassword: true,
          createdAt: now(),
        };
        fail(
          !store.userByEmail(email),
          409,
          "このメールアドレスは登録済みです。",
        );
        store.saveUser(member);
        activity(user, `${name}さんをメンバーに追加しました`);
        return send(201, safeUser(member));
      }
      const memberMatch = path.match(/^\/api\/members\/([^/]+)$/);
      if (memberMatch && method === "PATCH") {
        fail(user.role === "admin", 403, "管理者のみ操作できます。");
        const member = store.user(memberMatch[1]);
        fail(member, 404, "メンバーが見つかりません。");
        fail(
          member.id !== user.id,
          400,
          "自分自身の権限・利用状態は変更できません。",
        );
        const updated = {
          ...member,
          active:
            typeof body.active === "boolean" ? body.active : member.active,
          role: ["admin", "member"].includes(body.role)
            ? body.role
            : member.role,
        };
        fail(
          !(
            member.role === "admin" &&
            member.active &&
            (!updated.active || updated.role !== "admin")
          ) ||
            store.users().filter((u) => u.active && u.role === "admin").length >
              1,
          400,
          "管理者を1人以上残してください。",
        );
        store.saveUser(updated);
        if (!updated.active)
          store.db
            .prepare("DELETE FROM sessions WHERE user_id=?")
            .run(member.id);
        activity(user, `${member.name}さんの利用設定を変更しました`);
        return send(200, safeUser(updated));
      }
      const projectMatch = path.match(/^\/api\/projects(?:\/([^/]+))?$/);
      if (projectMatch && ["POST", "PATCH"].includes(method)) {
        const previous = projectMatch[1]
          ? store.get("projects", projectMatch[1])
          : null;
        fail(
          method === "POST" ? !projectMatch[1] : previous,
          404,
          "プロジェクトが見つかりません。",
        );
        const merged = { ...(previous || {}), ...body };
        const name = str(merged.name, 120);
        fail(name, 400, "プロジェクト名を入力してください。");
        const fields = (Array.isArray(merged.fields) ? merged.fields : [])
          .slice(0, 15)
          .map((f) => {
            fail(
              ["text", "number", "select"].includes(f.type) && str(f.name, 60),
              400,
              "カスタムフィールドを確認してください。",
            );
            return {
              id: previous?.fields.some((p) => p.id === f.id) ? f.id : id(),
              name: str(f.name, 60),
              type: f.type,
              options: (Array.isArray(f.options) ? f.options : [])
                .slice(0, 30)
                .map((o) => str(o, 80))
                .filter(Boolean),
            };
          });
        const rules = (Array.isArray(merged.rules) ? merged.rules : [])
          .slice(0, 10)
          .map((r) => {
            fail(
              statuses.includes(r.status) && activeUser(r.assigneeId),
              400,
              "自動化ルールを確認してください。",
            );
            const dueDays =
              r.dueDays === null || r.dueDays === "" ? null : Number(r.dueDays);
            fail(
              dueDays === null ||
                (Number.isInteger(dueDays) && dueDays >= 0 && dueDays <= 365),
              400,
              "日数は0〜365を指定してください。",
            );
            return {
              id: r.id || id(),
              status: r.status,
              assigneeId: str(r.assigneeId, 50),
              dueDays,
              enabled: r.enabled !== false,
            };
          });
        const project = {
          id: previous?.id || id(),
          name,
          description: str(merged.description),
          color: ["sage", "peach", "lavender", "blue", "rose"].includes(
            merged.color,
          )
            ? merged.color
            : "sage",
          icon: str(merged.icon, 30) || "folder",
          status: ["ontrack", "atrisk", "complete"].includes(merged.status)
            ? merged.status
            : "ontrack",
          dueDate: date(merged.dueDate),
          fields,
          rules,
          ownerId: previous?.ownerId || user.id,
          orgUnitId: orgReference(store, merged.orgUnitId),
          memberIds: [
            ...new Set(Array.isArray(merged.memberIds) ? merged.memberIds : []),
          ]
            .filter((uid) => typeof uid === "string" && store.user(uid))
            .slice(0, 200),
          createdAt: previous?.createdAt || now(),
        };
        store.put("projects", project);
        activity(
          user,
          `プロジェクト「${name}」を${previous ? "更新" : "作成"}しました`,
        );
        return send(previous ? 200 : 201, project);
      }
      if (
        (path === "/api/tasks" || path === "/api/requests") &&
        method === "POST"
      ) {
        fail(
          !body.minuteId && body.minuteActionIndex == null,
          400,
          "議事録からのタスク作成は営業管理画面から行ってください。",
        );
        const task = saveTask(
          {
            status: "todo",
            priority: "medium",
            assigneeId: "",
            tags: path === "/api/requests" ? ["社内依頼"] : [],
            ...body,
          },
          user,
        );
        return send(201, task);
      }
      const taskMatch = path.match(
        /^\/api\/tasks\/([^/]+)(?:\/(comments|approval|calendar))?$/,
      );
      if (taskMatch) {
        const task = store.get("tasks", taskMatch[1]);
        fail(task, 404, "タスクが見つかりません。");
        if (!taskMatch[2] && method === "PATCH")
          return send(200, saveTask(body, user, task));
        if (!taskMatch[2] && method === "DELETE") {
          store.transaction(() => {
            fail(
              body.version === task.version,
              409,
              "タスクが更新されています。再読み込みしてください。",
            );
            store.remove("tasks", task.id);
            for (const other of store.all("tasks"))
              if (other.dependencies.includes(task.id))
                store.put("tasks", {
                  ...other,
                  dependencies: other.dependencies.filter((d) => d !== task.id),
                  version: other.version + 1,
                  updatedAt: now(),
                });
            activity(user, `「${task.title}」を削除しました`);
          });
          return send(200, { ok: true });
        }
        if (taskMatch[2] === "comments" && method === "POST") {
          const text = str(body.text);
          fail(text, 400, "コメントを入力してください。");
          const updated = {
            ...task,
            comments: [
              ...task.comments,
              { id: id(), userId: user.id, text, createdAt: now() },
            ],
            version: task.version + 1,
            updatedAt: now(),
          };
          store.put("tasks", updated);
          activity(user, `「${task.title}」にコメントしました`, task.id);
          for (const uid of assignees(task).filter((uid) => uid !== user.id))
            notify(uid, `「${task.title}」に新しいコメントがあります`, task.id);
          return send(201, updated);
        }
        if (taskMatch[2] === "approval" && method === "POST") {
          let approval;
          if (body.action === "request") {
            fail(
              body.reviewerId && activeUser(body.reviewerId),
              400,
              "承認担当者を選択してください。",
            );
            fail(
              task.approval?.status !== "pending",
              409,
              "すでに承認を申請しています。",
            );
            approval = {
              status: "pending",
              reviewerId: body.reviewerId,
              requestedBy: user.id,
              requestedAt: now(),
              resolvedAt: null,
            };
            notify(
              body.reviewerId,
              `「${task.title}」の承認依頼が届いています`,
              task.id,
            );
          } else {
            fail(
              ["approve", "reject"].includes(body.action),
              400,
              "承認操作が正しくありません。",
            );
            fail(
              task.approval?.status === "pending",
              409,
              "承認待ちではありません。",
            );
            fail(
              task.approval.reviewerId === user.id || user.role === "admin",
              403,
              "承認担当者のみ操作できます。",
            );
            approval = {
              ...task.approval,
              status: body.action === "approve" ? "approved" : "rejected",
              resolvedAt: now(),
              resolvedBy: user.id,
            };
            notify(
              approval.requestedBy,
              `「${task.title}」が${body.action === "approve" ? "承認" : "差し戻し"}されました`,
              task.id,
            );
          }
          const updated = {
            ...task,
            approval,
            version: task.version + 1,
            updatedAt: now(),
          };
          store.put("tasks", updated);
          activity(user, `「${task.title}」の承認状況を更新しました`, task.id);
          return send(200, updated);
        }
        if (taskMatch[2] === "calendar" && method === "GET") {
          fail(task.dueDate, 400, "先に期日を設定してください。");
          const escape = (v) =>
            v
              .replace(/\\/g, "\\\\")
              .replace(/\n/g, "\\n")
              .replace(/,/g, "\\,")
              .replace(/;/g, "\\;")
              .replace(/\r/g, "");
          const end = new Date(task.dueDate + "T00:00:00Z");
          end.setUTCDate(end.getUTCDate() + 1);
          const lines = [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//Worknest//JA",
            "BEGIN:VEVENT",
            `UID:${task.id}@worknest`,
            `DTSTAMP:${new Date()
              .toISOString()
              .replace(/[-:]/g, "")
              .replace(/\.\d{3}/, "")}`,
            `DTSTART;VALUE=DATE:${(task.startDate || task.dueDate).replace(/-/g, "")}`,
            `DTEND;VALUE=DATE:${end.toISOString().slice(0, 10).replace(/-/g, "")}`,
            `SUMMARY:${escape(task.title)}`,
            `DESCRIPTION:${escape(task.description)}`,
            "END:VEVENT",
            "END:VCALENDAR",
          ];
          const fold = (line) => {
            let result = "",
              count = 0;
            for (const char of line) {
              const length = Buffer.byteLength(char);
              if (count + length > 73) {
                result += "\r\n ";
                count = 1;
              }
              result += char;
              count += length;
            }
            return result;
          };
          res.writeHead(200, {
            "Content-Type": "text/calendar; charset=utf-8",
            "Content-Disposition": 'attachment; filename="worknest-task.ics"',
            "Cache-Control": "no-store",
          });
          return res.end(lines.map(fold).join("\r\n") + "\r\n");
        }
      }
      if (path === "/api/notifications/read" && method === "POST") {
        for (const n of store.all("notifications"))
          if (n.userId === user.id)
            store.put("notifications", { ...n, read: true });
        return send(200, { ok: true });
      }
      throw new HttpError(404, "ページが見つかりません。");
    } catch (error) {
      if (!error.status) console.error(error);
      if (!res.headersSent)
        send(error.status || 500, {
          error: error.status
            ? error.message
            : "サーバーでエラーが発生しました。",
        });
      else res.end();
    }
  }
  const server = http.createServer((req, res) =>
    auditContext.run({ actorId: "anonymous" }, () => handler(req, res)),
  );
  server.requestTimeout = 30000;
  server.on("listening", () => {
    sales.start({ timers: options.timers !== false });
    workspaceService.start({ timers: options.timers !== false });
  });
  server.on("close", () => {
    sales.stop();
    workspaceService.stop();
  });
  let closing;
  const close = () =>
    (closing ??= (async () => {
      sales.stop();
      workspaceService.stop();
      await new Promise((resolve) => server.close(resolve));
      await workspaceService.waitForBackup();
      store.db.close();
    })());
  return {
    server,
    store,
    close,
    tick: async () => {
      await sales.tick();
      await workspaceService.tick();
    },
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { server, close } = createApp();
  const port = Number(process.env.PORT || 3000),
    host = process.env.HOST || "127.0.0.1";
  server.listen(port, host, () =>
    console.log(`Worknest is ready: http://${host}:${port}`),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      void close().then(() => process.exit());
    });
}
