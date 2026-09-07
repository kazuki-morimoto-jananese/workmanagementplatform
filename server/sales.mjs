import { id, now, auditContext } from "./store.mjs";
import { seedSalesDemo, demoPeriods } from "./sales-demo.mjs";
import { createMinuteService } from "./minutes.mjs";
import { orgReference, orgPath } from "./workspace.mjs";
import { syncTime, scheduledSyncDue } from "./sales-schedule.mjs";
import { buildPreview, emptyMedia, numeric, csvCell } from "./sales-import.mjs";
import {
  integrationStatus,
  readGoogleSheet,
  summarizeMinutes,
} from "./sales-integrations.mjs";
const check = (yes, message, status = 400) => {
  if (!yes) throw Object.assign(new Error(message), { status });
};
const text = (v, max = 6000) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
export const jstToday = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
export const monday = (v = jstToday()) => {
  const d = new Date(v + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
const monthValue = (v) => {
  check(
    typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v),
    "対象月をYYYY-MMで指定してください。",
  );
  return v;
};
const dateValue = (v, required = false) => {
  const s = text(v, 10);
  check(!required || s, "日付を入力してください。");
  check(
    !s ||
      (/^\d{4}-\d{2}-\d{2}$/.test(s) &&
        Number.isFinite(Date.parse(s)) &&
        new Date(s).toISOString().slice(0, 10) === s),
    "日付を確認してください。",
  );
  return s;
};
const key = (...v) => JSON.stringify(v);
const version = (old, b) => {
  if (old)
    check(
      b.version === old.version,
      "他のメンバーが更新しました。再読み込みしてから編集してください。",
      409,
    );
};
function mediaValue(raw = {}) {
  const m = emptyMedia();
  for (const medium of ["stanby", "indeed", "box"])
    for (const metric of Object.keys(m[medium])) {
      m[medium][metric] = numeric(
        raw?.[medium]?.[metric],
        `${medium} ${metric}`,
      );
      if (["cv", "hires", "months"].includes(metric))
        check(
          m[medium][metric] === null || Number.isInteger(m[medium][metric]),
          "件数は整数で入力してください。",
        );
    }
  m.acceptableCpa = numeric(raw?.acceptableCpa, "許容CPA");
  return m;
}
export function createSalesService({
  store,
  saveTask,
  activity,
  minuteAdapters = {},
  sheetReader = readGoogleSheet,
}) {
  let timer = null,
    stopped = false,
    syncing = false,
    working = false;
  const queue = [];
  const account = (aid) => {
    const a = store.get("salesAccounts", aid);
    check(a, "アカウントが見つかりません。", 404);
    return a;
  };
  const member = (uid) =>
    check(!uid || store.user(uid)?.active, "有効な担当者を選んでください。");
  const project = (pid) =>
    check(!pid || store.get("projects", pid), "プロジェクトが見つかりません。");
  const history = (kind, item, user) =>
    store.put("salesHistory", {
      id: id(),
      kind,
      accountId: item.accountId || item.id,
      month: item.month,
      weekOf: item.weekOf,
      forecast: item.forecast ?? null,
      reason: item.reason || "",
      updatedAt: now(),
      updatedBy: user.id,
      record: item,
    });
  const changeContact = (aid, date) => {
    const a = account(aid);
    if (date && date > (a.lastContactAt || ""))
      store.put("salesAccounts", {
        ...a,
        lastContactAt: date,
        version: a.version + 1,
      });
  };
  const saveAccount = (body, user, old = null) => {
    version(old, body);
    const input = { ...(old || {}), ...body };
    const aid = old?.id || text(input.id, 200) || id();
    check(
      !old ? !store.get("salesAccounts", aid) : true,
      "このアカウントIDは登録済みです。",
      409,
    );
    check(text(input.name, 200), "アカウント名が必要です。");
    member(input.ownerId);
    project(input.projectId);
    const item = {
      id: aid,
      name: text(input.name, 200),
      status: text(input.status, 60) || "利用中",
      ownerId: text(input.ownerId, 100),
      ownerName: text(input.ownerName, 100),
      group: text(input.group, 100),
      orgUnitId: orgReference(store, input.orgUnitId),
      category: text(input.category, 80),
      agency: text(input.agency, 200),
      projectId: text(input.projectId, 100),
      customerGoal: text(input.customerGoal),
      customerIssues: text(input.customerIssues),
      lastContactAt: dateValue(input.lastContactAt),
      importedAt: old?.importedAt || "",
      ...(old?.isDemo ? { isDemo: true, demoSet: old.demoSet } : {}),
      version: (old?.version || 0) + 1,
    };
    store.put("salesAccounts", item);
    history("account", item, user);
    return item;
  };
  const saveReview = (body, user, allowMissingReason = false) => {
    account(body.accountId);
    const month = monthValue(body.month),
      weekOf = dateValue(body.weekOf, true);
    check(weekOf === monday(weekOf), "週の基準日は月曜日を指定してください。");
    const rid = key(body.accountId, month, weekOf),
      old = store.get("salesReviews", rid);
    version(old, body);
    const forecast = numeric(body.forecast, "ヨミ"),
      aggressive = numeric(body.aggressive, "アグレッシブ"),
      probability = numeric(body.probability, "確度");
    check(probability === null || probability <= 100, "確度は0〜100%です。");
    check(
      aggressive === null || forecast === null || aggressive >= forecast,
      "アグレッシブはヨミ以上の金額を入力してください。",
    );
    const reason = text(body.reason);
    check(
      allowMissingReason || forecast === null || reason,
      "ヨミの根拠を入力してください。",
    );
    const item = {
      id: rid,
      accountId: body.accountId,
      month,
      weekOf,
      forecast,
      aggressive,
      probability,
      reason,
      nextAction: text(body.nextAction),
      customerGoal: text(body.customerGoal),
      customerIssues: text(body.customerIssues),
      funnel: text(body.funnel, 100),
      effectiveProposal: ["yes", "no"].includes(body.effectiveProposal)
        ? body.effectiveProposal
        : "unknown",
      budgetTrend: text(body.budgetTrend),
      observedAt: dateValue(body.observedAt),
      media: mediaValue(body.media),
      version: (old?.version || 0) + 1,
      updatedAt: now(),
      updatedBy: user.id,
    };
    store.put("salesReviews", item);
    history("review", item, user);
    return item;
  };
  function commitImport(input, user) {
    const month = monthValue(input.month),
      preview = buildPreview(input);
    check(!preview.errors.length, preview.errors.join("\n"));
    check(preview.rows.length, "取込対象がありません。");
    let created = 0,
      updated = 0;
    const sourceName = text(input.sourceName, 150) || "CSV/TSV";
    store.transaction(() => {
      for (const row of preview.rows) {
        const old = store.get("salesAccounts", row.accountId);
        const matches = store
          .users()
          .filter(
            (u) =>
              u.active &&
              (u.name === row.ownerName || u.email === row.ownerName),
          );
        const base = old || {
          id: row.accountId,
          name: row.name,
          status: "利用中",
          ownerId: matches.length === 1 ? matches[0].id : "",
          ownerName: "",
          group: "",
          category: "",
          agency: "",
          projectId: "",
          customerGoal: "",
          customerIssues: "",
          lastContactAt: "",
          version: 0,
        };
        if (
          row.ownerName !== undefined &&
          (!old || row.ownerName !== old.ownerName)
        )
          base.ownerId = matches.length === 1 ? matches[0].id : "";
        const importedContact = row.lastContactAt;
        if (
          importedContact &&
          Number.isFinite(Date.parse(importedContact)) &&
          new Date(importedContact).toISOString().slice(0, 10) ===
            importedContact &&
          importedContact > (base.lastContactAt || "")
        )
          base.lastContactAt = importedContact;
        for (const k of [
          "name",
          "status",
          "ownerName",
          "group",
          "category",
          "agency",
          "customerGoal",
          "customerIssues",
        ])
          if (row[k] !== undefined) base[k] = row[k];
        const a = { ...base, importedAt: now(), version: base.version + 1 };
        store.put("salesAccounts", a);
        if (old) updated++;
        else created++;
        const mid = key(a.id, month),
          oldMaster = store.get("salesMasters", mid);
        if (oldMaster)
          store.put("salesMasterHistory", {
            ...oldMaster,
            id: id(),
            snapshotAt: now(),
          });
        const master = {
          id: mid,
          accountId: a.id,
          month,
          previousActual: null,
          previousGTrend: null,
          gTrend: null,
          target: null,
          nextTarget: null,
          ...oldMaster,
          media: structuredClone(oldMaster?.media || emptyMedia()),
          raw: { ...(oldMaster?.raw || {}), ...row.raw },
          importedAt: now(),
          sourceName,
        };
        for (const k of [
          "previousActual",
          "previousGTrend",
          "gTrend",
          "target",
          "nextTarget",
        ])
          if (row[k] !== undefined) master[k] = row[k];
        for (const k of Object.keys(preview.mapping)) {
          if (k.includes(".")) {
            const [m, f] = k.split(".");
            master.media[m][f] = row.media[m][f];
          }
          if (k === "acceptableCpa")
            master.media.acceptableCpa = row.media.acceptableCpa;
        }
        store.put("salesMasters", master);
        if (
          input.seedReviews &&
          !store.get("salesReviews", key(a.id, month, monday()))
        ) {
          saveReview(
            {
              ...row,
              accountId: a.id,
              month,
              weekOf: monday(),
              observedAt: "",
              media: master.media,
            },
            user,
            true,
          );
        }
      }
      const log = {
        id: id(),
        sourceName,
        createdAt: now(),
        status: "success",
        created,
        updated,
        errors: [],
        warnings: preview.warnings,
      };
      store.put("salesImports", log);
    });
    activity(
      user,
      `${sourceName}から営業マスタ${created + updated}件を取り込みました`,
    );
    return { created, updated, skipped: 0, warnings: preview.warnings };
  }
  async function drain() {
    if (working || stopped) return;
    working = true;
    try {
      while (queue.length && !stopped) {
        const minuteId = queue.shift();
        const minute = store.get("salesMinutes", minuteId);
        if (!minute) continue;
        store.put("salesMinutes", {
          ...minute,
          status: "processing",
          summaryError: "",
        });
        try {
          if (integrationStatus().geminiConfigured) {
            const usageId = "summary:" + jstToday();
            const usage = store.get("aiUsage", usageId) || {
              id: usageId,
              count: 0,
            };
            check(
              usage.count <
                Math.max(
                  1,
                  Math.min(
                    1000,
                    Number(process.env.GEMINI_DAILY_SUMMARIES) || 20,
                  ),
                ),
              "本日のGemini要約上限に達しました。翌日以降に再試行してください。",
              429,
            );
            store.put("aiUsage", { ...usage, count: usage.count + 1 });
          }
          const result = await summarizeMinutes(minute);
          if (stopped) break;
          const fresh = store.get("salesMinutes", minuteId);
          store.put("salesMinutes", {
            ...fresh,
            summary: result.summary,
            summaryProvider: result.provider,
            status: "completed",
            summaryError: "",
            version: fresh.version + 1,
          });
        } catch (e) {
          if (!stopped) {
            const fresh = store.get("salesMinutes", minuteId);
            store.put("salesMinutes", {
              ...fresh,
              status: "failed",
              summaryError: e.status
                ? e.message
                : "要約を作成できませんでした。再試行してください。",
              version: fresh.version + 1,
            });
          }
        }
      }
    } finally {
      working = false;
    }
  }
  function enqueue(minute) {
    check(
      !["pending", "processing"].includes(minute.status),
      "この議事録は要約中です。",
      409,
    );
    check(
      !minute.taskLinks.length,
      "タスク化済みの要約は再生成できません。新しい議事録として追記してください。",
      409,
    );
    const item = {
      ...minute,
      status: "pending",
      summaryError: "",
      version: minute.version + 1,
    };
    store.put("salesMinutes", item);
    queue.push(item.id);
    void auditContext.run({ actorId: "system" }, () => drain());
    return item;
  }
  const minuteService = createMinuteService({
    store,
    saveReview,
    enqueueSummary: enqueue,
    ...minuteAdapters,
  });
  async function sync(user, scheduled = false) {
    check(!syncing, "同期処理が実行中です。", 409);
    const source = store.get("salesSettings", "source");
    check(source, "接続先を設定してください。");
    syncing = true;
    const attempt = now();
    store.put("salesSettings", {
      ...source,
      lastAttemptAt: attempt,
      ...(scheduled ? { lastScheduledAttemptAt: attempt } : {}),
      lastError: "",
    });
    try {
      const { values } = await sheetReader(source);
      check(!stopped, "サーバー停止中です。", 503);
      const currentUser = store.user(user.id);
      check(
        currentUser?.active && currentUser.role === "admin",
        "有効な管理者による同期が必要です。",
        403,
      );
      const effectiveMonth = source.rollingMonth
        ? jstToday().slice(0, 7)
        : source.month;
      const result = commitImport(
        {
          values,
          month: effectiveMonth,
          mapping: source.mapping,
          sourceName: source.name,
        },
        user,
      );
      const fresh = store.get("salesSettings", "source");
      store.put("salesSettings", {
        ...fresh,
        lastSuccessAt: now(),
        lastError: "",
      });
      return result;
    } catch (e) {
      if (!stopped) {
        store.put("salesSettings", {
          ...store.get("salesSettings", "source"),
          lastError: e.status ? e.message : "同期に失敗しました。",
        });
        store.put("salesImports", {
          id: id(),
          sourceName: source.name,
          createdAt: now(),
          status: "failed",
          created: 0,
          updated: 0,
          errors: [e.status ? e.message : "同期に失敗しました。"],
          warnings: [],
        });
      }
      throw e;
    } finally {
      syncing = false;
    }
  }
  function tick() {
    const source = store.get("salesSettings", "source");
    if (!source?.enabled || syncing || stopped) return;
    if (scheduledSyncDue(source)) {
      const admin = store.users().find((u) => u.active && u.role === "admin");
      if (admin) void sync(admin, true).catch(() => {});
    }
  }
  async function handle({ path, method, body, user, send, url }) {
    const p = path.replace(/^\/api/, "");
    if (!p.startsWith("/sales/")) return false;
    const reply = (status, result) => {
      send(status, result);
      return true;
    };
    const admin = () =>
      check(user.role === "admin", "管理者のみ操作できます。", 403);
    if (await minuteService.handle({ p, method, body, user, reply }))
      return true;
    if (p === "/sales/bootstrap" && method === "GET") {
      const month = monthValue(
        url.searchParams.get("month") || jstToday().slice(0, 7),
      );
      const source = store.get("salesSettings", "source");
      return reply(200, {
        accounts: store.all("salesAccounts").map((a) => ({
          ...a,
          group: a.orgUnitId ? orgPath(store, a.orgUnitId) : a.group,
        })),
        demoPeriods: demoPeriods(jstToday()),
        masters: store.all("salesMasters").filter((m) => m.month === month),
        reviews: store.all("salesReviews").filter((r) => r.month === month),
        opportunities: store.all("salesOpportunities"),
        minutes: store.all("salesMinutes").reverse(),
        activities: store.all("salesActivities").reverse(),
        imports: store.all("salesImports").slice(-50).reverse(),
        connections: { ...integrationStatus(), source },
        history: store
          .all("salesHistory")
          .filter((h) => h.kind === "review" && h.month === month)
          .slice(-300)
          .reverse(),
      });
    }
    const am = p.match(/^\/sales\/accounts(?:\/([^/]+))?$/);
    if (am && ["POST", "PATCH"].includes(method)) {
      check(method === "POST" ? !am[1] : !!am[1], "操作を確認してください。");
      return reply(
        method === "POST" ? 201 : 200,
        saveAccount(
          body,
          user,
          am[1] ? account(decodeURIComponent(am[1])) : null,
        ),
      );
    }
    if (p === "/sales/reviews" && method === "POST")
      return reply(
        200,
        store.transaction(() => saveReview(body, user)),
      );
    const om = p.match(/^\/sales\/opportunities(?:\/([^/]+))?$/);
    if (om && ["POST", "PATCH"].includes(method)) {
      const old = om[1] ? store.get("salesOpportunities", om[1]) : null;
      check(method === "POST" ? !om[1] : old, "商談が見つかりません。", 404);
      version(old, body);
      const b = { ...old, ...body };
      account(b.accountId);
      member(b.ownerId);
      check(text(b.title, 200), "商談名が必要です。");
      check(
        ["discovery", "proposal", "negotiation", "won", "lost"].includes(
          b.stage,
        ),
        "商談フェーズを選択してください。",
      );
      const amount = numeric(b.amount, "商談金額"),
        probability =
          b.stage === "won"
            ? 100
            : b.stage === "lost"
              ? 0
              : numeric(b.probability, "受注確度");
      check(
        amount !== null && probability !== null && probability <= 100,
        "金額と0〜100%の受注確度を入力してください。",
      );
      const item = {
        id: old?.id || id(),
        accountId: b.accountId,
        title: text(b.title, 200),
        amount,
        probability,
        stage: b.stage,
        expectedCloseDate: dateValue(b.expectedCloseDate, true),
        ownerId: text(b.ownerId, 100),
        nextAction: text(b.nextAction),
        lastActivityAt: dateValue(b.lastActivityAt) || jstToday(),
        version: (old?.version || 0) + 1,
        updatedAt: now(),
      };
      store.put("salesOpportunities", item);
      history("opportunity", item, user);
      return reply(old ? 200 : 201, item);
    }
    if (p === "/sales/activities" && method === "POST") {
      account(body.accountId);
      check(
        ["call", "meeting", "proposal"].includes(body.type),
        "行動の種類を確認してください。",
      );
      const item = {
        id: id(),
        accountId: body.accountId,
        type: body.type,
        date: dateValue(body.date, true),
        notes: text(body.notes),
        userId: user.id,
        createdAt: now(),
      };
      store.put("salesActivities", item);
      changeContact(item.accountId, item.date);
      return reply(201, item);
    }
    if (p === "/sales/minutes" && method === "POST") {
      account(body.accountId);
      const document = await minuteService.document(body);
      check(store.user(user.id)?.active, "ログインし直してください。", 401);
      if (document) {
        check(
          !store
            .all("salesMinutes")
            .some(
              (m) =>
                m.googleFileId === document.fileId &&
                m.accountId === body.accountId &&
                !m.supersededBy,
            ),
          "登録済みです。既存議事録から更新してください。",
          409,
        );
        body = {
          ...body,
          text: document.text,
          title: body.title || document.title,
          sourceUrl: document.sourceUrl,
        };
      }
      if (body.opportunityId)
        check(
          store.get("salesOpportunities", body.opportunityId)?.accountId ===
            body.accountId,
          "商談のアカウントが一致しません。",
        );
      check(
        typeof body.text === "string" &&
          body.text.trim() &&
          body.text.length <= 80000,
        "議事録本文は1〜80,000文字で入力してください。",
      );
      check(text(body.title, 200), "議事録タイトルが必要です。");
      const sourceUrl = text(body.sourceUrl, 2000);
      if (sourceUrl) {
        let u;
        try {
          u = new URL(sourceUrl);
        } catch {}
        check(u?.protocol === "https:", "資料のURLはhttpsで指定してください。");
      }
      const item = {
        id: id(),
        accountId: body.accountId,
        opportunityId: text(body.opportunityId, 100),
        title: text(body.title, 200),
        meetingDate: dateValue(body.meetingDate, true),
        targetMonth: monthValue(
          body.targetMonth || body.meetingDate?.slice(0, 7),
        ),
        reviewWeek: body.reviewWeek
          ? dateValue(body.reviewWeek, true)
          : monday(),
        autoExtract: body.autoExtract === true,
        autoApplyNumbers: body.autoApplyNumbers === true,
        autoSummarize: body.autoSummarize === true,
        ...(document
          ? {
              googleFileId: document.fileId,
              googleModifiedTime: document.modifiedTime,
              lastSyncedAt: now(),
            }
          : {}),
        text: body.text.trim(),
        sourceUrl,
        createdAt: now(),
        createdBy: user.id,
        status: "saved",
        summary: null,
        summaryProvider: null,
        summaryError: "",
        taskLinks: [],
        version: 1,
      };
      check(
        item.reviewWeek === monday(item.reviewWeek),
        "反映先の会議週には月曜日を指定してください。",
      );
      store.put("salesMinutes", item);
      changeContact(item.accountId, item.meetingDate);
      if (body.autoSummarize === true || integrationStatus().autoSummaryEnabled)
        enqueue(item);
      if (item.autoExtract && integrationStatus().geminiConfigured)
        minuteService.enqueue(store.get("salesMinutes", item.id), user);
      return reply(201, store.get("salesMinutes", item.id));
    }
    const mm = p.match(/^\/sales\/minutes\/([^/]+)\/(summarize|tasks)$/);
    if (mm && method === "POST") {
      const minute = store.get("salesMinutes", mm[1]);
      check(minute, "議事録が見つかりません。", 404);
      if (mm[2] === "summarize") return reply(202, enqueue(minute));
      check(
        minute.status === "completed",
        "要約の完了後に内容を確認してタスク化してください。",
        409,
      );
      check(
        Number.isInteger(body.actionIndex) && body.actionIndex >= 0,
        "アクションを選んでください。",
      );
      const action = minute.summary?.actions[body.actionIndex];
      check(action, "アクション案が見つかりません。");
      const existing = store
        .all("tasks")
        .find(
          (t) =>
            t.minuteId === minute.id &&
            t.minuteActionIndex === body.actionIndex,
        );
      if (existing) {
        if (!minute.taskLinks.some((l) => l.actionIndex === body.actionIndex))
          store.put("salesMinutes", {
            ...minute,
            taskLinks: [
              ...minute.taskLinks,
              { actionIndex: body.actionIndex, taskId: existing.id },
            ],
            version: minute.version + 1,
          });
        return reply(200, existing);
      }
      version(minute, body);
      check(
        !minute.taskLinks.some((l) => l.actionIndex === body.actionIndex),
        "このアクションはタスク化済みです（タスク削除後も再作成しません）。",
        409,
      );
      const task = createLinkedTask(
        {
          ...body,
          title: action.title,
          description: `議事録: ${minute.title}\n原文の根拠: ${action.evidence}`,
          minuteId: minute.id,
          minuteActionIndex: body.actionIndex,
        },
        minute.accountId,
        user,
      );
      store.put("salesMinutes", {
        ...minute,
        taskLinks: [
          ...minute.taskLinks,
          { actionIndex: body.actionIndex, taskId: task.id },
        ],
        version: minute.version + 1,
      });
      return reply(201, task);
    }
    const tm = p.match(/^\/sales\/accounts\/([^/]+)\/tasks$/);
    if (tm && method === "POST") {
      check(
        !body.minuteId && body.minuteActionIndex == null,
        "議事録のアクションは議事録画面からタスク化してください。",
      );
      return reply(
        201,
        createLinkedTask(body, decodeURIComponent(tm[1]), user),
      );
    }
    if (p === "/sales/imports/preview" && method === "POST") {
      monthValue(body.month);
      return reply(200, buildPreview(body));
    }
    if (p === "/sales/imports/commit" && method === "POST") {
      admin();
      return reply(200, commitImport(body, user));
    }
    if (p === "/sales/connections" && method === "POST") {
      admin();
      check(!syncing, "同期終了後に接続設定を変更してください。", 409);
      check(
        /^[a-zA-Z0-9_-]{15,180}$/.test(body.spreadsheetId || ""),
        "スプレッドシートIDを確認してください。",
      );
      check(
        text(body.range, 250),
        "見出し行を含む取得範囲を指定してください。",
      );
      const previous = store.get("salesSettings", "source");
      const sameSource =
        previous?.spreadsheetId === body.spreadsheetId &&
        previous?.range === text(body.range, 250) &&
        previous?.month === body.month &&
        previous?.rollingMonth === (body.rollingMonth === true) &&
        JSON.stringify(previous?.mapping || {}) ===
          JSON.stringify(body.mapping || {});
      const item = {
        id: "source",
        name: text(body.name, 150) || "Google Sheets",
        spreadsheetId: body.spreadsheetId,
        range: text(body.range, 250),
        month: monthValue(body.month),
        rollingMonth: body.rollingMonth === true,
        enabled: body.enabled === true,
        syncTime: syncTime(body.syncTime ?? previous?.syncTime ?? "06:00"),
        mapping:
          body.mapping &&
          typeof body.mapping === "object" &&
          !Array.isArray(body.mapping)
            ? body.mapping
            : {},
        lastAttemptAt: sameSource ? previous?.lastAttemptAt || "" : "",
        lastScheduledAttemptAt: sameSource
          ? previous?.lastScheduledAttemptAt || ""
          : "",
        lastSuccessAt: sameSource ? previous?.lastSuccessAt || "" : "",
        lastError: sameSource ? previous?.lastError || "" : "",
      };
      store.put("salesSettings", item);
      return reply(200, item);
    }
    if (p === "/sales/connections/preview" && method === "POST") {
      admin();
      const source = store.get("salesSettings", "source");
      check(source, "先に接続設定を保存してください。");
      const { values } = await sheetReader(source);
      check(
        store.user(user.id)?.active && store.user(user.id)?.role === "admin",
        "有効な管理者による操作が必要です。",
        403,
      );
      return reply(200, {
        ...buildPreview({
          values,
          month: source.rollingMonth ? jstToday().slice(0, 7) : source.month,
          mapping: source.mapping,
        }),
        sourceName: source.name,
        range: source.range,
        checkedAt: now(),
      });
    }
    if (p === "/sales/connections/sync" && method === "POST") {
      admin();
      return reply(200, await sync(user));
    }
    if (p === "/sales/export" && method === "GET") {
      const month = monthValue(
          url.searchParams.get("month") || jstToday().slice(0, 7),
        ),
        week = dateValue(url.searchParams.get("weekOf") || monday(), true);
      const all = store.all("salesReviews");
      const scope = url.searchParams.get("scope") || "real";
      check(
        ["real", "demo"].includes(scope),
        "データの種別を指定してください。",
      );
      const records = store
        .all("salesAccounts")
        .filter((a) => (scope === "demo" ? a.isDemo : !a.isDemo))
        .map((a) => {
          const r = all
            .filter(
              (r) =>
                r.accountId === a.id && r.month === month && r.weekOf <= week,
            )
            .sort((a, b) => b.weekOf.localeCompare(a.weekOf))[0];
          const m = store.get("salesMasters", key(a.id, month));
          return [
            a.id,
            a.name,
            a.ownerName,
            month,
            r?.weekOf,
            m?.target,
            m?.gTrend,
            r?.forecast,
            r?.aggressive,
            r?.reason,
            r?.nextAction,
          ];
        });
      const csv =
        "\uFEFF" +
        [
          [
            "アカウントID",
            "アカウント名",
            "当月担当者",
            "対象月",
            "入力週",
            "目標",
            "Gトレ",
            "ヨミ",
            "アグレッシブ",
            "ヨミ根拠",
            "今週やること",
          ],
          ...records,
        ]
          .map((row) => row.map(csvCell).join(","))
          .join("\r\n");
      return reply(200, {
        csv,
        filename: `worknest-sales-${scope}-${month}.csv`,
      });
    }
    if (p === "/sales/demo" && method === "POST") {
      admin();
      return reply(201, seedSalesDemo(store, user));
    }
    check(false, "営業管理のAPIが見つかりません。", 404);
  }
  function createLinkedTask(body, aid, user) {
    const a = account(aid);
    const pid = body.projectId || a.projectId;
    check(pid, "タスクの所属プロジェクトを選択してください。");
    project(pid);
    member(body.assigneeId);
    return saveTask(
      {
        title: body.title,
        description: text(body.description, 9000),
        projectIds: [pid],
        status: "todo",
        priority: "medium",
        assigneeId: body.assigneeId || "",
        startDate: "",
        dueDate: dateValue(body.dueDate),
        tags: ["営業"],
        accountId: aid,
        minuteId: body.minuteId || "",
        minuteActionIndex: body.minuteActionIndex ?? null,
      },
      user,
    );
  }
  return {
    handle,
    commitImport,
    start() {
      if (timer) return;
      stopped = false;
      minuteService.start();
      for (const m of store.all("salesMinutes"))
        if (["processing", "pending"].includes(m.status)) {
          store.put("salesMinutes", { ...m, status: "pending" });
          queue.push(m.id);
        }
      void auditContext.run({ actorId: "system" }, () => drain());
      timer = setInterval(tick, 60000);
      timer.unref();
      tick();
    },
    stop() {
      stopped = true;
      minuteService.stop();
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
