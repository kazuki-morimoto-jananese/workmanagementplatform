import { id, now, safeUser } from "./store.mjs";
import { backupDatabase } from "../scripts/backup.mjs";
import { canReadTask, redactTaskReferences } from "./task-options.mjs";
const fail = (ok, message, status = 400) => {
  if (!ok) throw Object.assign(new Error(message), { status });
};
export const assignees = (task) =>
  task.assigneeIds || (task.assigneeId ? [task.assigneeId] : []);
export function orgReference(store, value) {
  const uid = typeof value === "string" ? value : "";
  fail(
    !uid || store.get("orgUnits", uid),
    "組織マスタから所属を選択してください。",
  );
  return uid;
}
export function orgPath(store, uid) {
  const names = [];
  for (
    let unit = store.get("orgUnits", uid);
    unit;
    unit = store.get("orgUnits", unit.parentId)
  )
    names.unshift(unit.name);
  return names.join(" / ");
}
export function createWorkspaceService({
  store,
  dataDir,
  backupProvider = backupDatabase,
  storageInfo = null,
}) {
  let backingUp = false,
    timer,
    stopped = false;
  let backupSettled = Promise.resolve();
  async function runBackup(userId = "system") {
    fail(!backingUp, "バックアップを実行中です。", 409);
    backingUp = true;
    let settle;
    backupSettled = new Promise((resolve) => {
      settle = resolve;
    });
    try {
      const result = await backupProvider({ dataDir });
      const value = {
        id: "backup",
        lastSuccessAt: now(),
        bytes: result.bytes,
        lastError: "",
        requestedBy: userId,
        ...(result.recoveryPoint
          ? { recoveryPoint: result.recoveryPoint }
          : {}),
      };
      if (!stopped) store.put("operations", value);
      return value;
    } catch (e) {
      if (!stopped)
        store.put("operations", {
          ...store.get("operations", "backup"),
          id: "backup",
          lastError:
            "バックアップに失敗しました。保存先と空き容量を確認してください。",
          lastAttemptAt: now(),
        });
      throw Object.assign(
        new Error(
          "バックアップに失敗しました。保存先と空き容量を確認してください。",
        ),
        { status: 503 },
      );
    } finally {
      backingUp = false;
      settle();
    }
  }
  function tick() {
    const last = store.get("operations", "backup");
    const stamp = [last?.lastAttemptAt, last?.lastSuccessAt]
      .filter(Boolean)
      .sort()
      .at(-1);
    if (
      store.users().length &&
      (!stamp || Date.now() - Date.parse(stamp) >= 86400000)
    )
      return runBackup().catch(() => {});
  }
  return {
    waitForBackup: () => backupSettled,
    tick,
    start({ timers = true } = {}) {
      if (timers) {
        timer = setInterval(tick, 60000);
        timer.unref();
        void tick();
      }
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    async handle({ path, method, body, user, send, url }) {
      const admin = () =>
        fail(user.role === "admin", "管理者のみ操作できます。", 403);
      const match = path.match(/^\/api\/org-units(?:\/([^/]+))?$/);
      if (match && ["POST", "PATCH"].includes(method)) {
        admin();
        const old = match[1] ? store.get("orgUnits", match[1]) : null;
        fail(
          method === "POST" ? !match[1] : old,
          "組織が見つかりません。",
          404,
        );
        if (old)
          fail(
            body.version === old.version,
            "組織が更新されました。再読み込みしてください。",
            409,
          );
        const name =
          typeof body.name === "string"
            ? body.name.trim().normalize("NFKC")
            : "";
        fail(
          name && name.length <= 80,
          "組織名を80文字以内で入力してください。",
        );
        const levels = ["company", "division", "department", "team"];
        const level = old?.level || body.level;
        fail(levels.includes(level), "組織の粒度を選択してください。");
        const parentId = old?.parentId ?? orgReference(store, body.parentId);
        const parent = store.get("orgUnits", parentId);
        fail(
          level === "company"
            ? !parentId
            : parent?.level === levels[levels.indexOf(level) - 1],
          "会社→事業部→部署→チームの順に親組織を選んでください。",
        );
        fail(
          !store
            .all("orgUnits")
            .some(
              (u) =>
                u.id !== old?.id &&
                u.parentId === parentId &&
                (u.name === name || level === "company"),
            ),
          "同じ親組織に同名の組織があります。会社は1つ登録できます。",
          409,
        );
        const unit = {
          id: old?.id || id(),
          name,
          level,
          parentId,
          version: (old?.version || 0) + 1,
        };
        store.put("orgUnits", unit);
        send(old ? 200 : 201, unit);
        return true;
      }
      const membership = path.match(/^\/api\/members\/([^/]+)\/organization$/);
      if (membership && method === "POST") {
        fail(
          user.role === "admin" || user.id === membership[1],
          "本人または管理者のみ設定できます。",
          403,
        );
        const member = store.user(membership[1]);
        fail(member, "メンバーが見つかりません。", 404);
        const updated = {
          ...member,
          orgUnitId: orgReference(store, body.orgUnitId),
        };
        store.saveUser(updated);
        send(200, safeUser(updated));
        return true;
      }
      if (path === "/api/audit" && method === "GET") {
        const kind = url.searchParams.get("kind") || "";
        const recordId = url.searchParams.get("recordId") || "";
        if (user.role !== "admin")
          fail(
            kind &&
              recordId &&
              !["members", "settings", "salesSettings", "auth"].includes(kind),
            "全社監査ログは管理者のみ閲覧できます。",
            403,
          );
        const before = Number(
          url.searchParams.get("before") || Number.MAX_SAFE_INTEGER,
        );
        fail(
          Number.isSafeInteger(before) && before > 0,
          "ページ指定が正しくありません。",
        );
        const rows = store.db
          .prepare(
            "SELECT * FROM audit_log WHERE seq<? AND (?='' OR kind=?) AND (?='' OR record_id=?) ORDER BY seq DESC LIMIT 100",
          )
          .all(before, kind, kind, recordId, recordId);
        send(200, {
          entries: rows
            .filter((r) => {
              if (r.kind !== "tasks")
                return !["googleConnections", "googleOAuthStates"].includes(
                  r.kind,
                );
              const current = store.get("tasks", r.record_id);
              const last =
                current ||
                (() => {
                  const last = store.db
                    .prepare(
                      "SELECT before_data,after_data FROM audit_log WHERE kind='tasks' AND record_id=? ORDER BY seq DESC LIMIT 1",
                    )
                    .get(r.record_id);
                  return last
                    ? JSON.parse(last.after_data || last.before_data || "null")
                    : null;
                })();
              if (!canReadTask(last, user)) return false;
              return [r.before_data, r.after_data]
                .filter(Boolean)
                .every((raw) => canReadTask(JSON.parse(raw), user));
            })
            .map((r) => ({
              ...r,
              before_data: r.before_data
                ? redactTaskReferences(JSON.parse(r.before_data), user, store)
                : null,
              after_data: r.after_data
                ? redactTaskReferences(JSON.parse(r.after_data), user, store)
                : null,
            })),
          next: rows.length === 100 ? rows.at(-1).seq : null,
        });
        return true;
      }
      if (path === "/api/operations" && method === "GET") {
        admin();
        send(200, {
          backup: store.get("operations", "backup"),
          auditCount: store.db
            .prepare("SELECT COUNT(*) AS count FROM audit_log")
            .get().count,
          retention: "自動削除なし",
          backingUp,
          storage: storageInfo,
        });
        return true;
      }
      if (path === "/api/operations/backup" && method === "POST") {
        admin();
        send(201, await runBackup(user.id));
        return true;
      }
      if (path === "/api/operations/export-data" && method === "POST") {
        admin();
        const snapshot = store.transaction(() => ({
          format: "worknest-export-v1",
          exportedAt: now(),
          users: store.db.prepare("SELECT * FROM users ORDER BY id").all(),
          records: store.db
            .prepare("SELECT * FROM records ORDER BY kind,id")
            .all(),
          audit: store.db.prepare("SELECT * FROM audit_log ORDER BY seq").all(),
        }));
        send(200, snapshot);
        return true;
      }
      return false;
    },
  };
}
