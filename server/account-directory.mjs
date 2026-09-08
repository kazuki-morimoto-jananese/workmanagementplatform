import { id, now } from "./store.mjs";
import { normalizeHeader, numeric } from "./sales-import.mjs";
import { scheduledSyncDue, syncTime } from "./sales-schedule.mjs";
const check = (ok, message, status = 400) => {
  if (!ok) throw Object.assign(new Error(message), { status });
};
const person = (v) => normalizeHeader(v);
const fields = {
  accountId: "アカウントID",
  name: "アカウント名",
  agency: "代理店名",
  channel: "商流経路",
  mediaFlag: "個社・求人メディアフラグ",
  industryMajor: "スタンバイ業種_大分類",
  industryMinor: "スタンバイ業種_中分類",
  category: "カテゴリ",
  group: "当月担当Ｇ",
  ownerName: "当月担当者",
  status: "アカウントステータス",
  openedAt: "開設日",
};
const metrics = {
  monthActual: "当月累計実績（1日～前日まで）",
  yesterdayActual: "前日実績",
  gTrend: "Gトレンド",
  budget: "アカウント月予算",
};
export function directoryPreview(labels, numbers) {
  check(
    labels.length > 1 && labels.length <= 20001,
    "アカウント情報は見出しを含め20,001行以内で取得してください。",
  );
  const map = (values, wanted) =>
    Object.fromEntries(
      Object.entries(wanted).map(([key, name]) => {
        const positions = values[0].flatMap((v, i) =>
          normalizeHeader(v) === normalizeHeader(name) ? [i] : [],
        );
        check(
          positions.length === 1,
          `${name}の見出しを一意に指定してください。`,
        );
        return [key, positions[0]];
      }),
    );
  const info = map(labels, fields),
    nums = map(numbers, metrics),
    rows = [],
    errors = [],
    seen = new Set();
  for (let i = 1; i < labels.length; i++) {
    const raw = labels[i] || [],
      accountId = String(raw[info.accountId] ?? "").trim();
    if (!accountId && !String(raw[info.name] ?? "").trim()) continue;
    if (!accountId || !String(raw[info.name] ?? "").trim()) {
      errors.push(`${i + 1}行: アカウントIDと名前が必要です。`);
      continue;
    }
    if (seen.has(accountId)) {
      errors.push(`${i + 1}行: アカウントIDが重複しています。`);
      continue;
    }
    seen.add(accountId);
    const row = Object.fromEntries(
      Object.entries(info).map(([k, j]) => [k, String(raw[j] ?? "").trim()]),
    );
    for (const [k, j] of Object.entries(nums)) {
      try {
        row[k] = numeric(numbers[i]?.[j], metrics[k]);
      } catch (e) {
        errors.push(`${i + 1}行 ${e.message}`);
      }
    }
    rows.push(row);
  }
  check(rows.length, "アカウントのデータ行がありません。");
  return { rows, errors, count: rows.length };
}
export function createDirectoryService({ store, sheetReader }) {
  let running = false;
  const source = () => store.get("salesDirectorySettings", "source");
  const monthOK = (m) =>
    check(
      /^\d{4}-(0[1-9]|1[0-2])$/.test(m || ""),
      "対象月を指定してください。",
    );
  const activeAdmin = (uid) => {
    const u = store.user(uid);
    check(
      u?.active && u.role === "admin",
      "接続した管理者の本人認証を確認してください。",
      403,
    );
  };
  async function preview(config) {
    check(config, "先にアカウントマスタの接続設定を保存してください。");
    activeAdmin(config.authUserId);
    const base = {
      spreadsheetId: config.spreadsheetId,
      authMode: "user",
      authUserId: config.authUserId,
    };
    const m = config.monthRange.match(/^(.*)!([A-Z]+)(\d+):([A-Z]+)$/i);
    const header = await sheetReader({
      ...base,
      range: `${m[1]}!${m[2]}${Number(m[3]) - 1}:${m[4]}${m[3]}`,
    });
    const expected = String(Number(config.month.slice(5))) + "月";
    check(
      header.values[0].some(
        (v) =>
          String(v).trim() === expected ||
          String(v).trim() === config.month.replace("-", "年") + "月",
      ),
      "対象月と数値列の月見出しが一致しません。",
    );
    const labels = await sheetReader({ ...base, range: config.infoRange });
    const numbers = await sheetReader({
      ...base,
      range: config.monthRange,
      allowHeaderOnly: true,
    });
    const result = directoryPreview(labels.values, numbers.values);
    activeAdmin(config.authUserId);
    check(
      source()?.version === config.version,
      "設定が変わりました。再実行してください。",
      409,
    );
    return result;
  }
  const resolveOwner = (row, config) => {
    const alias = Object.hasOwn(config.ownerLinks || {}, row.ownerName)
      ? config.ownerLinks[row.ownerName]
      : "";
    if (alias && store.user(alias)?.active) return alias;
    const matches = store
      .users()
      .filter((u) => u.active && person(u.name) === person(row.ownerName));
    return matches.length === 1 ? matches[0].id : "";
  };
  async function sync(config, scheduled = false) {
    check(!running, "アカウントマスタを同期中です。", 409);
    running = true;
    try {
      if (scheduled)
        store.put("salesDirectorySettings", {
          ...config,
          lastScheduledAttemptAt: now(),
        });
      const result = await preview(config);
      check(!result.errors.length, result.errors.slice(0, 12).join("\n"));
      let created = 0,
        changed = 0;
      const stamp = now(),
        present = new Set(result.rows.map((r) => r.accountId));
      store.transaction(() => {
        for (const row of result.rows) {
          const rid = JSON.stringify([config.month, row.accountId]);
          const old = store.get("salesDirectoryAccounts", rid);
          const record = {
            ...row,
            id: rid,
            month: config.month,
            ownerId: resolveOwner(row, config),
            present: true,
          };
          const { updatedAt: oldAt, ...prior } = old || {};
          if (JSON.stringify(prior) !== JSON.stringify(record)) {
            store.put("salesDirectoryAccounts", {
              ...record,
              updatedAt: stamp,
            });
            changed++;
          }
          if (!store.get("salesAccounts", row.accountId)) {
            store.put("salesAccounts", {
              id: row.accountId,
              name: row.name,
              status: row.status || "利用中",
              ownerId: record.ownerId,
              ownerName: row.ownerName,
              group: row.group,
              category: row.category,
              agency: row.agency,
              projectId: "",
              orgUnitId: "",
              customerGoal: "",
              customerIssues: "",
              lastContactAt: "",
              importedAt: stamp,
              version: 1,
            });
            created++;
          }
        }
        for (const old of store
          .all("salesDirectoryAccounts")
          .filter(
            (r) =>
              r.month === config.month &&
              r.present &&
              !present.has(r.accountId),
          ))
          store.put("salesDirectoryAccounts", {
            ...old,
            present: false,
            updatedAt: stamp,
          });
        store.put("salesDirectorySettings", {
          ...source(),
          lastSuccessAt: stamp,
          lastError: "",
          count: result.count,
        });
        store.put("salesDirectoryRuns", {
          id: id(),
          month: config.month,
          createdAt: stamp,
          count: result.count,
          created,
          changed,
          status: "success",
        });
      });
      return { count: result.count, created, changed };
    } catch (e) {
      if (config) {
        store.put("salesDirectorySettings", {
          ...source(),
          lastError: e.status
            ? e.message
            : "同期できませんでした。接続を確認してください。",
        });
        store.put("salesDirectoryRuns", {
          id: id(),
          month: config.month,
          createdAt: now(),
          status: "failed",
        });
      }
      throw e;
    } finally {
      running = false;
    }
  }
  return {
    async tick() {
      const c = source();
      if (!running && scheduledSyncDue(c)) {
        try {
          await sync(c, true);
        } catch {}
      }
    },
    async handle({ p, method, body, user, reply, url }) {
      if (!p.startsWith("/sales/directory")) return false;
      if (p === "/sales/directory" && method === "GET") {
        const month = url.searchParams.get("month");
        monthOK(month);
        const all = store
          .all("salesDirectoryAccounts")
          .filter((r) => r.month === month && r.present);
        const owner = url.searchParams.get("owner") || "me",
          q = person(url.searchParams.get("search") || "");
        const filtered = all.filter(
          (r) =>
            (owner === "all" ||
              (owner === "me"
                ? r.ownerId === user.id
                : person(r.ownerName) === person(owner))) &&
            (!q ||
              person(
                [
                  r.accountId,
                  r.name,
                  r.agency,
                  r.category,
                  r.group,
                  r.ownerName,
                  r.channel,
                  r.industryMajor,
                  r.industryMinor,
                ].join(" "),
              ).includes(q)),
        );
        const size = 50,
          totalPages = Math.max(1, Math.ceil(filtered.length / size)),
          page = Math.min(
            totalPages,
            Math.max(1, Math.floor(Number(url.searchParams.get("page"))) || 1),
          );
        const c = source();
        return reply(200, {
          rows: filtered.slice((page - 1) * size, page * size),
          count: filtered.length,
          total: all.length,
          mine: all.filter((r) => r.ownerId === user.id).length,
          page,
          totalPages,
          owners: [
            ...new Set(all.map((r) => r.ownerName).filter(Boolean)),
          ].sort((a, b) => a.localeCompare(b, "ja")),
          source: c,
          history: store.all("salesDirectoryRuns").slice(-15).reverse(),
        });
      }
      check(user.role === "admin", "設定・同期は管理者のみ操作できます。", 403);
      if (p === "/sales/directory/settings" && method === "POST") {
        check(!running, "同期終了後に設定してください。", 409);
        const old = source();
        check(
          body.version === (old?.version || 0),
          "設定が更新されました。再読み込みしてください。",
          409,
        );
        monthOK(body.month);
        check(
          /^[\w-]{15,180}$/.test(body.spreadsheetId || ""),
          "スプレッドシートIDを確認してください。",
        );
        const parse = (r) =>
          typeof r === "string" &&
          r.length <= 250 &&
          r.match(/^(.*)![A-Z]+(\d+):[A-Z]+$/i);
        const a = parse(body.infoRange),
          b = parse(body.monthRange);
        check(
          a && b && a[1] === b[1] && a[2] === b[2] && Number(b[2]) >= 2,
          "同じシート・見出し行の範囲を指定してください。末尾行は指定せず、新規行を含めます。",
        );
        const links = body.ownerLinks || {};
        check(
          typeof links === "object" &&
            !Array.isArray(links) &&
            Object.keys(links).length <= 500,
          "担当者の紐付けを確認してください。",
        );
        for (const [name, uid] of Object.entries(links))
          check(
            name.length <= 150 && store.user(uid)?.active,
            "紐付け先には有効なメンバーを選んでください。",
          );
        const c = {
          ...old,
          id: "source",
          version: (old?.version || 0) + 1,
          month: body.month,
          spreadsheetId: body.spreadsheetId,
          infoRange: body.infoRange,
          monthRange: body.monthRange,
          ownerLinks: links,
          authMode: "user",
          authUserId: body.useMyGoogle || !old ? user.id : old.authUserId,
          enabled: body.enabled === true,
          syncTime: syncTime(body.syncTime),
          lastError: "",
        };
        store.put("salesDirectorySettings", c);
        return reply(200, c);
      }
      if (p === "/sales/directory/preview" && method === "POST") {
        const r = await preview(source());
        return reply(200, {
          count: r.count,
          errors: r.errors.slice(0, 20),
          errorCount: r.errors.length,
          owners: [...new Set(r.rows.map((x) => x.ownerName))].filter(Boolean),
          sample: r.rows.slice(0, 5),
        });
      }
      if (p === "/sales/directory/sync" && method === "POST")
        return reply(200, await sync(source()));
      return false;
    },
  };
}
