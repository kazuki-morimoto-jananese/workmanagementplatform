import { id, now, digest, auditContext } from "./store.mjs";
import { randomBytes } from "node:crypto";
import { canReadTask, visibleTask } from "./task-options.mjs";
const fail = (ok, message, status = 400) => {
  if (!ok) throw Object.assign(new Error(message), { status });
};
const text = (v, max = 500) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
export const lifecycle = [
  "new",
  "qualified",
  "negotiating",
  "customer",
  "lost",
];
export function contactInput(store, body, previous = {}) {
  previous ||= {};
  const value = { ...previous };
  for (const key of [
    "name",
    "email",
    "company",
    "source",
    "campaign",
    "notes",
    "accountId",
    "ownerId",
    "nextContact",
    "stage",
    "consent",
  ])
    value[key] = Object.hasOwn(body, key)
      ? text(body[key], key === "notes" ? 3000 : 200)
      : previous[key] || "";
  value.stage ||= "new";
  value.consent ||= "unknown";
  fail(value.name, "顧客担当者名が必要です。");
  fail(
    !value.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email),
    "メールアドレスを確認してください。",
  );
  fail(lifecycle.includes(value.stage), "営業段階を確認してください。");
  fail(
    ["unknown", "allowed", "denied"].includes(value.consent),
    "連絡許可を確認してください。",
  );
  fail(
    !value.accountId || store.get("salesAccounts", value.accountId),
    "アカウントが見つかりません。",
  );
  fail(
    !value.ownerId || store.user(value.ownerId)?.active,
    "担当者を確認してください。",
  );
  fail(
    !value.nextContact ||
      (/^\d{4}-\d{2}-\d{2}$/.test(value.nextContact) &&
        Number.isFinite(Date.parse(value.nextContact)) &&
        new Date(value.nextContact).toISOString().slice(0, 10) ===
          value.nextContact),
    "次回連絡日を確認してください。",
  );
  return value;
}
export function createCrmService(store, saveTask) {
  const safeToken = ({ hash, ...token }) => token;
  async function external({ path, method, body, authorization, send }) {
    if (!path.startsWith("/api/integrations/v1/")) return false;
    const secret = /^Bearer (wn_[a-zA-Z0-9_-]+)$/.exec(
      authorization || "",
    )?.[1];
    const token =
      secret &&
      store.all("integrationTokens").find((t) => t.hash === digest(secret));
    fail(
      token &&
        token.scope === "contacts:stage" &&
        !token.revokedAt &&
        token.expiresAt > now() &&
        store.user(token.ownerId)?.active &&
        !store.user(token.ownerId)?.mustChangePassword &&
        store.user(token.ownerId)?.role === "admin",
      "連携トークンが無効または期限切れです。",
      401,
    );
    auditContext.getStore().actorId = token.ownerId;
    fail(
      path === "/api/integrations/v1/contacts" && method === "POST",
      "未対応の連携APIです。",
      404,
    );
    const key = text(body.requestId, 100);
    fail(
      key &&
        Array.isArray(body.contacts) &&
        body.contacts.length > 0 &&
        body.contacts.length <= 50,
      "requestId と contacts（1〜50件）が必要です。",
    );
    const batchId = digest((token.sourceId || token.id) + ":" + key),
      old = store.get("integrationBatches", batchId);
    const payloadHash = digest(JSON.stringify(body.contacts));
    if (old) {
      fail(
        old.payloadHash === payloadHash,
        "同じrequestIdに異なるデータが送られました。新しいrequestIdを指定してください。",
        409,
      );
      send(200, { id: old.id, status: old.status, duplicate: true });
      return true;
    }
    fail(
      store
        .all("integrationBatches")
        .filter(
          (b) =>
            b.tokenId === token.id &&
            b.createdAt.slice(0, 10) === now().slice(0, 10),
        ).length < 100,
      "本日の受付上限（100回）に達しました。",
      429,
    );
    const seen = new Set();
    const contacts = body.contacts.map((row) => {
      fail(row && typeof row === "object", "顧客の形式を確認してください。");
      const externalId = text(row.externalId, 200);
      fail(
        externalId && !seen.has(externalId),
        "外部IDは必須で、同じ送信内で重複できません。",
      );
      seen.add(externalId);
      const contactId = digest((token.sourceId || token.id) + ":" + externalId),
        previous = store.get("crmContacts", contactId);
      return {
        ...contactInput(store, row, previous),
        id: contactId,
        externalId,
        source: token.name,
        version: previous?.version || 0,
      };
    });
    const batch = {
      id: batchId,
      tokenId: token.id,
      source: token.name,
      contacts,
      payloadHash,
      status: "pending",
      createdAt: now(),
    };
    store.put("integrationBatches", batch);
    store.put("integrationTokens", { ...token, lastUsedAt: now() });
    send(202, { id: batch.id, status: batch.status });
    return true;
  }
  async function handle({ path, method, body, user, send }) {
    if (!path.startsWith("/api/crm/")) return false;
    if (path === "/api/crm/bootstrap" && method === "GET") {
      send(200, {
        contacts: store.all("crmContacts"),
        tokens:
          user.role === "admin"
            ? store.all("integrationTokens").map(safeToken)
            : [],
        batches:
          user.role === "admin"
            ? store
                .all("integrationBatches")
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .slice(0, 100)
            : [],
        readiness: {
          organization: store.all("orgUnits").some((u) => u.level === "team"),
          members: store.users().filter((u) => u.active).length > 1,
          accounts: store.all("salesAccounts").some((a) => !a.isDemo),
          targets: store
            .all("salesPersonalTargets")
            .some((t) => t.scope === "real" && t.amount != null),
          google: !!store.get("googleConnections", user.id),
          gemini: !!process.env.GEMINI_API_KEY,
        },
      });
      return true;
    }
    if (path === "/api/crm/contacts" && method === "POST") {
      const previous = body.id ? store.get("crmContacts", body.id) : null;
      fail(!body.id || previous, "顧客が見つかりません。", 404);
      fail(
        (previous?.version || 0) === (body.version || 0),
        "他のメンバーが更新しました。再読み込みしてください。",
        409,
      );
      const value = {
        ...contactInput(store, body, previous || {}),
        id: previous?.id || id(),
        version: (previous?.version || 0) + 1,
        updatedAt: now(),
        updatedBy: user.id,
      };
      store.put("crmContacts", value);
      send(200, value);
      return true;
    }
    if (path === "/api/crm/followup" && method === "POST") {
      const contact = store.get("crmContacts", body.id);
      fail(contact, "顧客が見つかりません。", 404);
      fail(
        contact.consent !== "denied",
        "連絡不可の顧客にはフォロータスクを作成できません。",
      );
      fail(contact.nextContact, "次回連絡日を保存してください。");
      const previous = store
        .all("tasks")
        .find(
          (t) =>
            t.crmContactId === contact.id &&
            t.status !== "done" &&
            canReadTask(t, user),
        );
      if (previous) {
        send(200, visibleTask(previous, user, store));
        return true;
      }
      const task = saveTask(
        {
          title: contact.name + "へのフォロー",
          description: contact.notes,
          projectIds: [body.projectId],
          status: "todo",
          priority: "medium",
          dueDate: contact.nextContact,
          assigneeIds: [contact.ownerId || user.id],
          accountId: contact.accountId,
          visibility: "workspace",
        },
        user,
      );
      store.put("tasks", { ...task, crmContactId: contact.id });
      send(201, task);
      return true;
    }
    fail(user.role === "admin", "管理者のみ操作できます。", 403);
    if (
      ["/api/crm/tokens", "/api/crm/tokens/rotate"].includes(path) &&
      method === "POST"
    ) {
      const previous = path.endsWith("/rotate")
        ? store.get("integrationTokens", body.id)
        : null;
      fail(
        !path.endsWith("/rotate") || previous,
        "連携元が見つかりません。",
        404,
      );
      fail(
        previous ||
          store
            .all("integrationTokens")
            .filter((t) => !t.revokedAt && t.expiresAt > now()).length < 20,
        "有効なトークンは20個までです。",
      );
      const name = previous?.name || text(body.name, 80);
      fail(name, "連携元の名前が必要です。");
      const secret = "wn_" + randomBytes(32).toString("base64url");
      const token = {
        id: id(),
        sourceId: previous?.sourceId || previous?.id || id(),
        name,
        hash: digest(secret),
        ownerId: user.id,
        scope: "contacts:stage",
        createdAt: now(),
        expiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
      };
      store.transaction(() => {
        if (previous)
          store.put("integrationTokens", { ...previous, revokedAt: now() });
        store.put("integrationTokens", token);
      });
      store.audit("integrations", token.id, { event: "token_created", name });
      send(201, { ...safeToken(token), secret });
      return true;
    }
    if (path === "/api/crm/tokens/revoke" && method === "POST") {
      const token = store.get("integrationTokens", body.id);
      fail(token, "トークンが見つかりません。", 404);
      store.put("integrationTokens", { ...token, revokedAt: now() });
      store.audit("integrations", token.id, { event: "token_revoked" });
      send(200, { ok: true });
      return true;
    }
    if (path === "/api/crm/batches/apply" && method === "POST") {
      const batch = store.get("integrationBatches", body.id);
      fail(batch, "受付データが見つかりません。", 404);
      if (batch.status !== "pending") {
        send(200, { status: batch.status });
        return true;
      }
      fail(
        ["apply", "reject"].includes(body.action),
        "操作を選択してください。",
      );
      store.transaction(() => {
        if (body.action === "apply")
          for (const row of batch.contacts) {
            fail(
              (store.get("crmContacts", row.id)?.version || 0) === row.version,
              "受付後に顧客が更新されました。この受付を却下し、新しいrequestIdで再送してください。",
              409,
            );
            const value = contactInput(store, row);
            store.put("crmContacts", {
              ...value,
              id: row.id,
              externalId: row.externalId,
              version: row.version + 1,
              updatedAt: now(),
              updatedBy: user.id,
            });
          }
        store.put("integrationBatches", {
          ...batch,
          status: body.action === "apply" ? "applied" : "rejected",
          reviewedAt: now(),
          reviewedBy: user.id,
        });
      });
      send(200, { ok: true });
      return true;
    }
    fail(false, "CRM APIが見つかりません。", 404);
  }
  return { handle, external };
}
