import { id, now } from "./store.mjs";
import { scheduledSyncDue, syncTime } from "./sales-schedule.mjs";
const check = (ok, message, status = 400) => {
  if (!ok) throw Object.assign(new Error(message), { status });
};
export const dashboardGroups = [
  "総合企画EPG",
  "総合企画G",
  "CSG",
  "RDG",
  "RAG",
];
const groupName = (v) =>
  String(v || "")
    .replace(/\s/g, "")
    .replace(/^総合企画$/, "総合企画G");
export const revenueColumns = [
  "KGI（売上）",
  "目標",
  "昨日時点実績",
  "達成率",
  "Gトレンド",
  "達成率（Gトレ）",
  "社単",
  "目標差分",
  "前月比",
];
export function defaultDashboard(month) {
  return {
    id: month,
    month,
    version: 0,
    spreadsheetId: "",
    enabled: false,
    syncTime: "06:00",
    blocks: [
      {
        id: "fixed",
        title: "組織別営業サマリー",
        range: "",
        fixed: true,
        groups: [],
        columns: revenueColumns.map((label, i) => ({ label, index: i })),
      },
      {
        id: "revenue",
        title: "KGI（売上）",
        range: "",
        groups: dashboardGroups,
        columns: ["担当", "グループ", ...revenueColumns.slice(1)].map(
          (label, i) => ({ label, index: i }),
        ),
      },
      {
        id: "starts",
        title: "KPI（当月稼働開始社数）",
        range: "",
        groups: ["RDG", "RAG"],
        columns: ["担当", "グループ", "目標", "実績", "達成率"].map(
          (label, i) => ({ label, index: i }),
        ),
      },
      {
        id: "cpc",
        title: "KPI（入札CPC）",
        range: "",
        groups: dashboardGroups.slice(0, 3),
        columns: ["担当", "グループ", "目標", "実績", "達成率"].map(
          (label, i) => ({ label, index: i }),
        ),
      },
      {
        id: "meetings",
        title: "行動目標（商談実施数）",
        range: "",
        groups: ["RAG"],
        columns: ["担当", "グループ", "目標", "実績", "達成率"].map(
          (label, i) => ({ label, index: i }),
        ),
      },
    ],
  };
}
export function dashboardRows(values, block) {
  check(
    Array.isArray(values) && values.length > 1 && values.length <= 5001,
    "見出し＋データを1〜5,000行の範囲で指定してください。",
  );
  const rows = [],
    seen = new Set();
  for (const row of values.slice(1)) {
    const cells = block.columns.map((c) => String(row[c.index] ?? "").trim());
    if (!cells[0]) continue;
    const group = block.fixed ? "" : groupName(cells[1]);
    if (!block.fixed && !dashboardGroups.includes(group)) continue;
    const key = JSON.stringify([group, cells[0]]);
    check(
      !seen.has(key),
      `${block.title}: 同一グループ内の行名が重複しています。範囲・列を確認してください。`,
    );
    seen.add(key);
    rows.push({ group, cells });
  }
  check(
    rows.length,
    `${block.title}: 対象行がありません。担当・グループ列と取得範囲を確認してください。`,
  );
  return rows;
}
export function createDashboardService({ store, sheetReader }) {
  let running = false;
  const get = (month) =>
    store.get("salesDashboardSettings", month) || defaultDashboard(month);
  const validMonth = (month) =>
    check(
      /^\d{4}-(0[1-9]|1[0-2])$/.test(month || ""),
      "対象月を指定してください。",
    );
  const ownerValid = (config) => {
    const u = store.user(config.authUserId);
    check(
      u?.active && u.role === "admin",
      "接続した管理者が無効です。再接続してください。",
      403,
    );
  };
  async function read(config) {
    ownerValid(config);
    const blocks = [];
    for (const block of config.blocks.filter((b) => b.range)) {
      let { values } = await sheetReader({
        ...config,
        spreadsheetId: block.spreadsheetId || config.spreadsheetId,
        range: block.range,
        authMode: "user",
        allowHeaderOnly: !!block.labelRange,
      });
      if (block.labelRange) {
        const labels = await sheetReader({
          ...config,
          spreadsheetId: block.spreadsheetId || config.spreadsheetId,
          range: block.labelRange,
          authMode: "user",
        });
        const width = block.fixed ? 1 : 2;
        values = Array.from(
          { length: Math.max(labels.values.length, values.length) },
          (_, i) => [
            ...Array.from(
              { length: width },
              (_, j) => labels.values[i]?.[j] ?? "",
            ),
            ...(values[i] || []),
          ],
        );
      }
      blocks.push({ ...block, rows: dashboardRows(values, block) });
    }
    check(blocks.length, "読み取る指標の取得範囲を設定してください。");
    ownerValid(config);
    check(
      get(config.month).version === config.version,
      "設定が更新されました。再実行してください。",
      409,
    );
    return { month: config.month, blocks, readAt: now() };
  }
  async function sync(config, scheduled = false) {
    check(!running, "ダッシュボードの同期中です。", 409);
    running = true;
    try {
      if (scheduled)
        store.put("salesDashboardSettings", {
          ...config,
          lastScheduledAttemptAt: now(),
        });
      const snapshot = await read(config);
      store.transaction(() => {
        store.put("salesDashboardSnapshots", {
          ...snapshot,
          id: id(),
          sourceVersion: config.version,
        });
        store.put("salesDashboardSettings", {
          ...get(config.month),
          lastSuccessAt: snapshot.readAt,
          lastError: "",
        });
      });
      return snapshot;
    } catch (e) {
      store.put("salesDashboardSettings", {
        ...get(config.month),
        lastError: e.status
          ? e.message
          : "取得できませんでした。接続と取得範囲を確認してください。",
      });
      throw e;
    } finally {
      running = false;
    }
  }
  return {
    async tick() {
      if (running) return;
      for (const config of store.all("salesDashboardSettings")) {
        if (scheduledSyncDue(config)) {
          try {
            await sync(config, true);
          } catch {}
        }
      }
    },
    async handle({ p, method, body, user, reply, url }) {
      if (!p.startsWith("/sales/dashboard")) return false;
      const month =
        method === "GET" ? url.searchParams.get("month") : body.month;
      validMonth(month);
      if (p === "/sales/dashboard" && method === "GET") {
        const snapshots = store
          .all("salesDashboardSnapshots")
          .filter((s) => s.month === month);
        return reply(200, {
          settings: get(month),
          snapshot: snapshots.at(-1) || null,
          history: snapshots
            .slice(-30)
            .reverse()
            .map((s) => ({
              id: s.id,
              readAt: s.readAt,
              blocks: s.blocks.length,
            })),
        });
      }
      check(user.role === "admin", "設定・同期は管理者のみ操作できます。", 403);
      if (p === "/sales/dashboard/inspect" && method === "POST") {
        const result = await sheetReader({
          spreadsheetId: body.spreadsheetId,
          range: body.range,
          authMode: "user",
          authUserId: user.id,
        });
        return reply(200, result);
      }
      if (p === "/sales/dashboard/settings" && method === "POST") {
        check(!running, "同期が終わってから設定を変更してください。", 409);
        const old = get(month);
        check(
          body.version === old.version,
          "別の管理者が設定を更新しました。再読み込みしてください。",
          409,
        );
        check(
          /^[\w-]{15,180}$/.test(body.spreadsheetId || ""),
          "スプレッドシートIDを入力してください。",
        );
        check(
          Array.isArray(body.blocks) &&
            body.blocks.length >= 1 &&
            body.blocks.length <= 20,
          "指標は1〜20件にしてください。",
        );
        const ids = new Set();
        const blocks = body.blocks.map((b, i) => {
          check(
            typeof b.id === "string" &&
              /^[\w-]{1,80}$/.test(b.id) &&
              !ids.has(b.id),
            "指標IDが重複しています。",
          );
          ids.add(b.id);
          check(
            typeof b.title === "string" &&
              b.title.trim() &&
              b.title.length <= 100,
            "指標名を入力してください。",
          );
          check(
            typeof b.range === "string" && b.range.length <= 250,
            "取得範囲を確認してください。",
          );
          if (b.labelRange) {
            check(
              typeof b.labelRange === "string" && b.labelRange.length <= 250,
              "行名の範囲を確認してください。",
            );
            const a = b.range.match(/^(.*)![A-Z]+(\d+):[A-Z]+(\d+)$/i),
              l = b.labelRange.match(/^(.*)!([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
            check(
              a && l && a[1] === l[1] && a[2] === l[3] && a[3] === l[5],
              "数値と行名の範囲は同じシート・開始行・終了行にしてください。",
            );
          }
          check(
            !b.spreadsheetId || /^[\w-]{15,180}$/.test(b.spreadsheetId),
            "個別のスプレッドシートIDを確認してください。",
          );
          const fixed = i === 0;
          check(!fixed || b.id === "fixed", "先頭は固定サマリーです。");
          check(
            Array.isArray(b.columns) &&
              b.columns.length >= (fixed ? 9 : 3) &&
              b.columns.length <= 15,
            "列の数を確認してください。",
          );
          if (fixed)
            check(
              b.columns.length === 9 &&
                b.columns.every((c, j) => c.label === revenueColumns[j]),
              "固定サマリーの項目は変更できません。",
            );
          if (!fixed)
            check(
              b.columns[0].label === "担当" &&
                b.columns[1].label === "グループ",
              "先頭2列は担当・グループにしてください。",
            );
          check(
            b.columns.every(
              (c) =>
                typeof c.label === "string" &&
                c.label.trim() &&
                c.label.length <= 80 &&
                Number.isInteger(c.index) &&
                c.index >= 0 &&
                c.index <= 1000,
            ),
            "列名と列位置を確認してください。",
          );
          check(
            new Set(b.columns.map((c) => c.index)).size === b.columns.length,
            "列位置が重複しています。",
          );
          check(
            Array.isArray(b.groups) &&
              b.groups.every((g) => dashboardGroups.includes(g)),
            "表示グループを確認してください。",
          );
          return {
            id: b.id,
            title: b.title.trim(),
            range: b.range.trim(),
            labelRange: b.labelRange || "",
            spreadsheetId: b.spreadsheetId || "",
            fixed,
            groups: fixed ? [] : [...new Set(b.groups)],
            columns: b.columns.map((c) => ({
              label: c.label.trim(),
              index: c.index,
            })),
          };
        });
        const config = {
          ...old,
          id: month,
          month,
          version: old.version + 1,
          spreadsheetId: body.spreadsheetId,
          authUserId:
            body.useMyGoogle || !old.authUserId ? user.id : old.authUserId,
          authMode: "user",
          blocks,
          enabled: body.enabled === true,
          syncTime: syncTime(body.syncTime),
          updatedAt: now(),
          updatedBy: user.id,
          lastError: "",
        };
        if (config.enabled)
          check(
            blocks.some((b) => b.range),
            "日次同期には取得範囲が必要です。",
          );
        store.put("salesDashboardSettings", config);
        return reply(200, config);
      }
      if (p === "/sales/dashboard/preview" && method === "POST")
        return reply(200, await read(get(month)));
      if (p === "/sales/dashboard/sync" && method === "POST")
        return reply(200, await sync(get(month)));
      return false;
    },
  };
}
