import { now } from "./store.mjs";
import { canReadTask } from "./task-options.mjs";
import { accountRecords, customerKinds } from "./customer-records.mjs";
const fail = (ok, message, status = 400) => {
  if (!ok) throw Object.assign(new Error(message), { status });
};
const str = (v, max) => {
  fail(
    typeof v === "string" && v.length <= max,
    "入力の形式・文字数を確認してください。",
  );
  return v.trim();
};
export function createCustomerHub({ store }) {
  return async ({ p, method, body, user, reply, url }) => {
    if (!p.startsWith("/sales/customer-hub")) return false;
    const accountId =
      method === "GET" ? url.searchParams.get("accountId") : body.accountId;
    fail(
      typeof accountId === "string" && accountId.length <= 200,
      "アカウントを選択してください。",
    );
    const account = store.get("salesAccounts", accountId);
    fail(account, "アカウントが見つかりません。", 404);
    if (p === "/sales/customer-hub/profile" && method === "GET") {
      const profile = store.get("customerProfiles", accountId) || {
        id: accountId,
        accountId,
        version: 0,
        company: "",
        brand: "",
        branch: "",
        website: "",
        handover: "",
        nextStep: "",
        renewalDate: "",
        relatedAccountIds: [],
      };
      const contacts = accountRecords(store, {
        kind: "crmContacts",
        accountId,
        user,
        full: true,
        limit: 31,
      });
      return reply(200, {
        profile,
        contacts: contacts.slice(0, 30),
        moreContacts: contacts.length > 30,
        relatedAccounts: (profile.relatedAccountIds || []).flatMap((id) => {
          const a = store.get("salesAccounts", id);
          return a ? [{ id: a.id, name: a.name }] : [];
        }),
      });
    }
    if (p === "/sales/customer-hub/profile" && method === "POST") {
      const previous = store.get("customerProfiles", accountId);
      fail(
        body.version === (previous?.version || 0),
        "他のメンバーがカルテを更新しました。再読み込みして確認してください。",
        409,
      );
      const profile = { id: accountId, accountId };
      for (const [k, max] of Object.entries({
        company: 200,
        brand: 200,
        branch: 200,
        website: 1000,
        handover: 5000,
        nextStep: 2000,
        renewalDate: 10,
      }))
        profile[k] = str(body[k] ?? "", max);
      fail(
        !profile.website || /^https?:\/\//i.test(profile.website),
        "WebサイトはhttpまたはhttpsのURLにしてください。",
      );
      if (profile.website) {
        let parsed;
        try {
          parsed = new URL(profile.website);
        } catch {}
        fail(
          parsed?.hostname && !parsed.username && !parsed.password,
          "WebサイトのURLを確認してください。",
        );
      }
      const d = profile.renewalDate;
      fail(
        !d ||
          (/^\d{4}-\d{2}-\d{2}$/.test(d) &&
            Number.isFinite(Date.parse(d)) &&
            new Date(d).toISOString().slice(0, 10) === d),
        "更新・契約確認日を確認してください。",
      );
      fail(
        Array.isArray(body.relatedAccountIds) &&
          body.relatedAccountIds.length <= 20,
        "関連アカウントは20件までです。",
      );
      const ids = [...new Set(body.relatedAccountIds)];
      fail(
        ids.every(
          (id) =>
            typeof id === "string" &&
            id !== accountId &&
            store.get("salesAccounts", id),
        ),
        "関連アカウントを確認してください。",
      );
      const result = {
        ...profile,
        relatedAccountIds: ids,
        version: (previous?.version || 0) + 1,
        updatedAt: now(),
        updatedBy: user.id,
      };
      store.put("customerProfiles", result);
      return reply(200, result);
    }
    if (p === "/sales/customer-hub/timeline" && method === "GET") {
      const type = url.searchParams.get("type") || "all";
      fail(
        type === "all" || customerKinds.includes(type),
        "記録の種類を確認してください。",
      );
      let cursor;
      const encoded = url.searchParams.get("cursor");
      if (encoded) {
        try {
          if (encoded.length > 2000) throw new Error();
          cursor = JSON.parse(Buffer.from(encoded, "base64url").toString());
        } catch {
          fail(false, "続きの指定が不正です。");
        }
        fail(
          cursor &&
            cursor.accountId === accountId &&
            cursor.type === type &&
            typeof cursor.stamp === "string" &&
            cursor.stamp.length <= 40 &&
            customerKinds.includes(cursor.kind) &&
            typeof cursor.id === "string" &&
            cursor.id.length <= 500,
          "続きの指定が不正です。",
        );
      }
      const rows = (type === "all" ? customerKinds : [type]).flatMap((kind) =>
        accountRecords(store, { kind, accountId, user, cursor }),
      );
      const compare = (a, b) => (a === b ? 0 : a > b ? -1 : 1);
      rows.sort(
        (a, b) =>
          compare(a.stamp, b.stamp) ||
          compare(a.kind, b.kind) ||
          compare(a.id, b.id),
      );
      const items = rows.slice(0, 25),
        last = items.at(-1);
      const next =
        rows.length > 25
          ? Buffer.from(
              JSON.stringify({
                accountId,
                type,
                stamp: last.stamp,
                kind: last.kind,
                id: last.id,
              }),
            ).toString("base64url")
          : null;
      return reply(200, { items, next });
    }
    if (p === "/sales/customer-hub/record" && method === "GET") {
      const kind = url.searchParams.get("kind"),
        id = url.searchParams.get("id");
      fail(
        customerKinds.includes(kind) &&
          typeof id === "string" &&
          id.length <= 500,
        "記録を確認してください。",
      );
      const record = store.get(kind, id);
      fail(
        record?.accountId === accountId &&
          (kind !== "tasks" || canReadTask(record, user)),
        "記録が見つからないか、閲覧できません。",
        404,
      );
      return reply(200, { kind, record });
    }
    return false;
  };
}
