import { digest, now } from "./store.mjs";
import { jsonRequest } from "./sales-integrations.mjs";
import { dashboardGroups } from "./sales-dashboard.mjs";
import { withImportedForecast } from "./sales-targets.mjs";
import { createDriveCollection } from "./drive-collection.mjs";

export const workflowScopes = {
  driveSearch: "https://www.googleapis.com/auth/drive.metadata.readonly",
  documentsWrite: "https://www.googleapis.com/auth/drive.file",
};
const fail = (ok, message, status = 400) => {
  if (!ok) throw Object.assign(new Error(message), { status });
};
const clean = (v, limit = 200) =>
  String(v ?? "")
    .trim()
    .slice(0, limit);
const groupName = (v) =>
  clean(v)
    .replace(/\s/g, "")
    .replace(/^総合企画$/, "総合企画G");
const money = (v) =>
  v === null || v === undefined || v === ""
    ? "未入力"
    : Number(v).toLocaleString("ja-JP") + "円";
const safeId = (value) => {
  fail(
    typeof value === "string" && /^[a-zA-Z0-9_-]{1,250}$/.test(value),
    "GoogleファイルIDが不正です。",
  );
  return value;
};
const encode = encodeURIComponent;

// The preview is the exact content sent to Google. AI does not invent amounts or conclusions.
export function buildSalesPresentation(store, input) {
  const month = input.month,
    group = input.group,
    week = input.week;
  fail(
    /^\d{4}-(0[1-9]|1[0-2])$/.test(month || ""),
    "対象月を選択してください。",
  );
  fail(dashboardGroups.includes(group), "グループを選択してください。");
  const d = new Date(week + "T00:00:00Z");
  fail(
    /^\d{4}-\d{2}-\d{2}$/.test(week || "") &&
      !isNaN(+d) &&
      d.toISOString().slice(0, 10) === week &&
      d.getUTCDay() === 1,
    "会議週は月曜日を指定してください。",
  );
  const end = new Date(+d + 6 * 86400000).toISOString().slice(0, 10);
  fail(
    week.slice(0, 7) === month || end.slice(0, 7) === month,
    "会議週は対象月と重なる週を選択してください。",
  );
  const snapshot = store
    .all("salesDashboardSnapshots")
    .filter((s) => s.month === month)
    .sort((a, b) => a.readAt.localeCompare(b.readAt))
    .at(-1);
  fail(snapshot, "対象月の営業サマリーを先に取り込んでください。");
  const pages = [],
    sources = [
      {
        kind: "salesDashboardSnapshots",
        id: snapshot.id,
        readAt: snapshot.readAt,
      },
    ],
    warnings = [];
  function section(title, lines) {
    if (!lines.length) lines = ["登録データなし（0とは扱いません）"];
    let part = [],
      size = 0,
      n = 1;
    const chunks = lines.flatMap(
      (raw) => String(raw).match(/[\s\S]{1,400}/g) || [""],
    );
    for (const line of chunks) {
      if (part.length && (size + line.length > 450 || part.length >= 4)) {
        pages.push({
          title: title + (n > 1 ? `（${n}）` : ""),
          text: part.join("\n\n"),
        });
        part = [];
        size = 0;
        n++;
      }
      part.push(line);
      size += line.length;
    }
    if (part.length)
      pages.push({
        title: title + (n > 1 ? `（${n}）` : ""),
        text: part.join("\n\n"),
      });
  }
  section(`${group} 営業会議 · ${month}`, [
    `会議週：${week}〜${end}`,
    `KGI/KPIは月次の最新取込値。取得日時：${snapshot.readAt}`,
    "ヨミ・競合は指定会議週までの最新入力。過去時点のKGIを再現する資料ではありません。",
    "空欄は未入力として表示。金額・比率・合計は保存済みの値を使用します。",
  ]);
  for (const block of snapshot.blocks) {
    if (!block.fixed && !block.groups.includes(group)) continue;
    const rows = block.rows.filter((r) =>
      block.fixed
        ? groupName(r.cells[0]) === group
        : groupName(r.group) === group,
    );
    section(
      block.title,
      rows.map(
        (r) =>
          `${r.cells[0]}\n` +
          block.columns
            .slice(1)
            .map((c, i) => `${c.label}：${r.cells[i + 1] || "未入力"}`)
            .join(" / "),
      ),
    );
  }
  const directory = store
    .all("salesDirectoryAccounts")
    .filter((a) => a.month === month);
  const masters = store
    .all("salesMasters")
    .filter((a) => a.month === month)
    .map(withImportedForecast);
  const accounts = store.all("salesAccounts").filter((a) => {
    if (a.isDemo) return false;
    const current =
      directory.find((r) => r.accountId === a.id) ||
      masters.find((r) => r.accountId === a.id) ||
      a;
    return groupName(current.group ?? a.group) === group;
  });
  const allReviews = store.all("salesReviews");
  const reviews = accounts.map((a) => ({
    a,
    r:
      allReviews
        .filter(
          (r) => r.accountId === a.id && r.month === month && r.weekOf <= week,
        )
        .sort((a, b) => a.weekOf.localeCompare(b.weekOf))
        .at(-1) ||
      (() => {
        const m = masters.find((m) => m.accountId === a.id);
        return m
          ? {
              id: m.id,
              sourceKind: "salesMasters",
              version: m.version,
              forecast: m.importedForecast,
              aggressive: m.importedAggressive,
              media: m.media,
              weekOf: "",
              importedAt: m.importedAt,
            }
          : undefined;
      })(),
  }));
  const details = reviews
    .filter((x) => x.r)
    .sort(
      (a, b) =>
        (b.r.forecast || 0) - (a.r.forecast || 0) ||
        a.a.id.localeCompare(b.a.id),
    )
    .slice(0, 20);
  if (reviews.filter((x) => x.r).length > 20)
    warnings.push(
      "ヨミ・媒体・施策の明細はヨミ額順の上位20アカウントです。ヨミ合計と入力件数は全対象を集計します。",
    );
  const present = reviews.filter((x) => x.r?.forecast != null);
  section("担当者のヨミ", [
    `入力済み ${present.length} / 対象 ${accounts.length} アカウント`,
    `入力済み分の合計：${present.length ? money(present.reduce((s, x) => s + x.r.forecast, 0)) : "未入力"}`,
    "この合計には未入力アカウントの推測値・商談の確度加重金額を加えていません。明細は最大20件です。",
    ...details.map(
      ({ a, r }) =>
        `${a.name}：${money(r.forecast)} / アグレッシブ ${money(r.aggressive)}（${r.weekOf ? "入力週 " + r.weekOf : "最新マスタ取込 " + (r.importedAt || "日時不明")}）`,
    ),
  ]);
  const mediaLines = [],
    actions = [],
    comparisons = [];
  for (const { r } of reviews)
    if (r)
      sources.push({
        kind: r.sourceKind || "salesReviews",
        id: r.id,
        version: r.version,
      });
  for (const { a, r } of details) {
    if (!r) continue;
    if (r.nextAction) actions.push(`${a.name}：${r.nextAction}`);
    for (const [key, label] of [
      ["stanby", "スタンバイ"],
      ["indeed", "Indeed"],
      ["box", "求人BOX"],
    ]) {
      const m = r.media?.[key];
      if (!m || ![m.budget, m.spend, m.cpa].some((v) => v != null)) continue;
      mediaLines.push(
        `${a.name} · ${label}\n予算 ${money(m.budget)} / 消化額 ${money(m.spend)} / CPA ${money(m.cpa)}（観測日 ${r.observedAt || "未記録"}）`,
      );
      if (key !== "stanby" && r.media?.stanby?.cpa != null && m.cpa > 0)
        comparisons.push(
          `${a.name} · スタンバイCPA ÷ ${label}CPA = ${(r.media.stanby.cpa / m.cpa).toLocaleString("ja-JP", { maximumFractionDigits: 2 })}倍`,
        );
    }
  }
  section("媒体別の登録状況", mediaLines);
  if (comparisons.length)
    section("競合とのCPA比較", [
      "登録されたCPAの比率です。対象期間とCV定義の一致は会議で確認してください。低い／高い理由は推測しません。",
      ...comparisons,
    ]);
  section("次の施策・アクション", actions);
  if (input.notes)
    section("会議メモ・提案方針（入力内容）", [clean(input.notes, 600)]);
  if (!accounts.length)
    warnings.push(
      "このグループのアカウント紐付けがありません。ヨミ・競合の集計対象は0件です。",
    );
  if (pages.length > 40) {
    warnings.push(
      "40ページを超えるため資料作成できません。対象アカウントを整理してください。",
    );
  }
  const result = {
    title: `${group} 営業会議 ${month} ${week}`,
    month,
    group,
    week,
    pages,
    sources,
    warnings,
  };
  return { ...result, fingerprint: digest(JSON.stringify(result)) };
}

export function presentationRequests(pages) {
  const requests = [];
  pages.forEach((page, i) => {
    const sid = `wn_slide_${i}`;
    requests.push({
      createSlide: {
        objectId: sid,
        slideLayoutReference: { predefinedLayout: "BLANK" },
      },
    });
    for (const [kind, text, y, height, font, bold, color] of [
      [
        "title",
        page.title,
        24,
        50,
        24,
        true,
        { red: 0.14, green: 0.32, blue: 0.25 },
      ],
      [
        "body",
        page.text,
        87,
        275,
        13,
        false,
        { red: 0.15, green: 0.22, blue: 0.27 },
      ],
      [
        "footer",
        `Worknest · ${i + 1} / ${pages.length} · 社内用`,
        378,
        20,
        9,
        false,
        { red: 0.4, green: 0.45, blue: 0.48 },
      ],
    ]) {
      const oid = `${sid}_${kind}`;
      requests.push(
        {
          createShape: {
            objectId: oid,
            shapeType: "TEXT_BOX",
            elementProperties: {
              pageObjectId: sid,
              size: {
                width: { magnitude: 664, unit: "PT" },
                height: { magnitude: height, unit: "PT" },
              },
              transform: {
                scaleX: 1,
                scaleY: 1,
                translateX: 28,
                translateY: y,
                unit: "PT",
              },
            },
          },
        },
        { insertText: { objectId: oid, text, insertionIndex: 0 } },
        {
          updateTextStyle: {
            objectId: oid,
            textRange: { type: "ALL" },
            style: {
              fontFamily: "Noto Sans JP",
              fontSize: { magnitude: font, unit: "PT" },
              bold,
              foregroundColor: { opaqueColor: { rgbColor: color } },
            },
            fields: "fontFamily,fontSize,bold,foregroundColor",
          },
        },
      );
    }
  });
  return requests;
}

export function createGoogleWorkflows({ store, access, fetchImpl, status }) {
  const busy = new Set();
  async function request(user, url, init = {}) {
    const token = await access(user),
      connection = store.get("googleConnections", user.id)?.connectedAt;
    try {
      const result = await jsonRequest(
        url,
        {
          ...init,
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
        },
        fetchImpl,
      );
      fail(
        store.user(user.id)?.active &&
          store.get("googleConnections", user.id)?.connectedAt === connection,
        "Google接続が変更されました。再接続してください。",
        409,
      );
      return result;
    } catch (e) {
      if (/HTTP (403|404)/.test(e.message))
        fail(
          false,
          "Google側で拒否されました。対象ファイルの権限、Drive／Docs／Slides／Calendar APIの有効化、追加の本人認証を確認してください。",
          403,
        );
      throw e;
    }
  }
  function requireScope(user, name) {
    fail(
      status(store, user)[name],
      "追加のGoogle権限が必要です。画面の「Googleの利用を許可」から接続してください。",
      403,
    );
  }
  async function artifact(user, kind, body, create, fill) {
    fail(
      /^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId || ""),
      "作成リクエストIDが必要です。",
    );
    const key = JSON.stringify([user.id, kind, body.requestId]),
      old = store.get("googleArtifacts", key),
      hash = digest(JSON.stringify(body));
    if (old) {
      fail(
        old.inputHash === hash,
        "同じ作成IDで入力が変更されています。新しくプレビューしてください。",
        409,
      );
      if (old.status === "completed") return old;
      fail(
        false,
        "前回の作成が未完了です。作成履歴のGoogleファイルを確認してください。重複防止のため自動再作成しません。",
        409,
      );
    }
    fail(
      !busy.has(user.id),
      "Googleへの作成処理中です。完了をお待ちください。",
      409,
    );
    busy.add(user.id);
    let record = {
      id: key,
      kind,
      createdBy: user.id,
      createdAt: now(),
      status: "creating",
      inputHash: hash,
      title: body.title,
      month: body.month,
      group: body.group,
      week: body.week,
      minuteId: body.minuteId || "",
    };
    store.put("googleArtifacts", record);
    try {
      const file = await create();
      const fileId = safeId(file.documentId || file.presentationId);
      record = {
        ...record,
        fileId,
        url: `https://docs.google.com/${kind === "slides" ? "presentation" : "document"}/d/${fileId}/edit`,
        status: "filling",
      };
      store.put("googleArtifacts", record);
      await fill(fileId);
      record = { ...record, status: "completed", completedAt: now() };
      store.put("googleArtifacts", record);
      return record;
    } catch (e) {
      store.put("googleArtifacts", {
        ...record,
        status: "failed",
        error: e.status
          ? e.message
          : "Googleファイル作成が完了しませんでした。",
      });
      throw e;
    } finally {
      busy.delete(user.id);
    }
  }
  const collection = createDriveCollection({ store, request, requireScope });
  return {
    async handle({ path, method, user, url, send, body }) {
      if (await collection({ path, method, user, url, send, body }))
        return true;
      if (path === "/api/google/files" && method === "GET") {
        requireScope(user, "driveSearch");
        const type = url.searchParams.get("type");
        fail(
          ["document", "spreadsheet"].includes(type),
          "ファイル種別を選んでください。",
        );
        const query = clean(url.searchParams.get("q"), 100)
          .replace(/\\/g, "\\\\")
          .replace(/'/g, "\\'");
        const params = new URLSearchParams({
          q:
            `trashed = false and mimeType = 'application/vnd.google-apps.${type}'` +
            (query ? ` and name contains '${query}'` : ""),
          pageSize: "30",
          fields: "nextPageToken,incompleteSearch,files(id,name,modifiedTime)",
          orderBy: "modifiedTime desc",
          supportsAllDrives: "true",
          includeItemsFromAllDrives: "true",
        });
        if (url.searchParams.get("pageToken"))
          params.set(
            "pageToken",
            clean(url.searchParams.get("pageToken"), 2000),
          );
        const result = await request(
          user,
          "https://www.googleapis.com/drive/v3/files?" + params,
        );
        send(200, {
          files: (result.files || []).map((f) => ({
            id: safeId(f.id),
            name: clean(f.name),
            modifiedTime: f.modifiedTime,
            url: `https://docs.google.com/${type === "document" ? "document" : "spreadsheets"}/d/${f.id}/edit`,
          })),
          nextPageToken: result.nextPageToken || "",
          incomplete: !!result.incompleteSearch,
        });
        return true;
      }
      if (path === "/api/google/calendar/prepare" && method === "POST") {
        requireScope(user, "calendar");
        fail(
          store.get("salesAccounts", body.accountId),
          "アカウントを選択してください。",
        );
        fail(
          typeof body.eventId === "string" && body.eventId.length <= 1024,
          "予定IDが不正です。",
        );
        const event = await request(
          user,
          "https://www.googleapis.com/calendar/v3/calendars/primary/events/" +
            encode(body.eventId),
        );
        fail(event.status !== "cancelled", "キャンセル済みの予定です。");
        const when =
          event.start?.date ||
          new Date(event.start?.dateTime).toLocaleDateString("sv-SE", {
            timeZone: "Asia/Tokyo",
          });
        const account = store.get("salesAccounts", body.accountId);
        send(200, {
          title: clean(event.summary || "商談議事録"),
          meetingDate: when,
          calendarEventId: body.eventId,
          text: `${account.name} 商談議事録\n商談日：${when}\n\n目的・アジェンダ：\n\n決定事項：\n\nヨミ・予算・競合媒体：\n\n課題：\n\n次のアクション（担当者・期限）：\n`,
        });
        return true;
      }
      const minuteMatch = path.match(
        /^\/api\/google\/minutes\/([^/]+)\/create-document$/,
      );
      if (minuteMatch && method === "POST") {
        requireScope(user, "documentsWrite");
        const minute = store.get("salesMinutes", minuteMatch[1]);
        fail(minute, "議事録が見つかりません。", 404);
        fail(
          !minute.supersededBy && !minute.googleFileId,
          "既にGoogle文書が紐付いているか改訂済みです。",
          409,
        );
        fail(
          minute.version === body.version,
          "議事録が更新されています。再読み込みしてください。",
          409,
        );
        const item = await artifact(
          user,
          "document",
          { ...body, minuteId: minute.id, title: minute.title },
          () =>
            request(user, "https://docs.googleapis.com/v1/documents", {
              method: "POST",
              body: JSON.stringify({ title: minute.title }),
            }),
          (fileId) =>
            request(
              user,
              `https://docs.googleapis.com/v1/documents/${fileId}:batchUpdate`,
              {
                method: "POST",
                body: JSON.stringify({
                  requests: [
                    {
                      insertText: { location: { index: 1 }, text: minute.text },
                    },
                  ],
                }),
              },
            ),
        );
        const fresh = store.get("salesMinutes", minute.id);
        fail(
          fresh?.version === minute.version,
          "文書を作成しましたが議事録が更新されています。作成履歴の文書を確認してください。",
          409,
        );
        const updated = {
          ...fresh,
          googleFileId: item.fileId,
          sourceUrl: item.url,
          lastSyncedAt: now(),
          version: fresh.version + 1,
        };
        store.put("salesMinutes", updated);
        send(201, { artifact: item, minute: updated });
        return true;
      }
      if (path === "/api/google/reports/preview" && method === "POST") {
        send(200, buildSalesPresentation(store, body));
        return true;
      }
      if (path === "/api/google/reports/create" && method === "POST") {
        requireScope(user, "documentsWrite");
        const report = buildSalesPresentation(store, body);
        fail(
          report.fingerprint === body.fingerprint,
          "プレビュー後にデータが更新されました。内容を再確認してください。",
          409,
        );
        fail(report.pages.length <= 40, "40ページを超えています。", 400);
        const item = await artifact(
          user,
          "slides",
          { ...body, title: report.title },
          () =>
            request(user, "https://slides.googleapis.com/v1/presentations", {
              method: "POST",
              body: JSON.stringify({ title: report.title }),
            }),
          (fileId) =>
            request(
              user,
              `https://slides.googleapis.com/v1/presentations/${fileId}:batchUpdate`,
              {
                method: "POST",
                body: JSON.stringify({
                  requests: presentationRequests(report.pages),
                }),
              },
            ),
        );
        store.put("googleArtifacts", { ...item, report });
        send(201, { ...item, report });
        return true;
      }
      if (path === "/api/google/artifacts" && method === "GET") {
        send(200, {
          items: store
            .all("googleArtifacts")
            .filter((a) => a.createdBy === user.id)
            .slice(-30)
            .reverse()
            .map(({ inputHash, report, ...a }) => a),
        });
        return true;
      }
      return false;
    },
  };
}
