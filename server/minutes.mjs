import { id, now, digest, auditContext } from "./store.mjs";
import {
  readGoogleDocument,
  extractMinuteNumbers,
  googleDocumentId,
} from "./minute-integrations.mjs";
import { integrationStatus } from "./sales-integrations.mjs";
import { emptyMedia } from "./sales-import.mjs";
const fail = (ok, message, status = 400) => {
  if (!ok) throw Object.assign(new Error(message), { status });
};
const today = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
const week = () => {
  const d = new Date(today() + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
export function createMinuteService({
  store,
  saveReview,
  enqueueSummary,
  readDocument = readGoogleDocument,
  extractNumbers = extractMinuteNumbers,
}) {
  let working = false,
    stopped = false;
  const pending = [];
  function apply(minute, user, reviewVersion, automatic = false) {
    return store.transaction(() => {
      fail(
        minute.extraction?.sourceHash === digest(minute.text),
        "原文が更新されています。数値を再抽出してください。",
        409,
      );
      fail(
        minute.extraction.status === "completed" &&
          !minute.extraction.appliedAt,
        "抽出結果は未完了か、既に反映済みです。",
        409,
      );
      const old = store.get(
        "salesReviews",
        JSON.stringify([
          minute.accountId,
          minute.targetMonth,
          minute.reviewWeek,
        ]),
      );
      if (!automatic)
        fail(
          (old?.version || 0) === reviewVersion,
          "ヨミが更新されています。再読み込みしてから反映してください。",
          409,
        );
      const draft = {
        ...(old || {}),
        accountId: minute.accountId,
        month: minute.targetMonth,
        weekOf: minute.reviewWeek,
        version: old?.version,
        media: structuredClone(old?.media || emptyMedia()),
      };
      const applied = [],
        skipped = [];
      for (const field of minute.extraction.fields) {
        const [medium, metric] = field.path.split(".");
        const object = metric
          ? draft.media[medium]
          : medium === "acceptableCpa"
            ? draft.media
            : draft;
        const key = metric || medium;
        // Existing input (including zero) always wins. No silent overwrite.
        if (
          object[key] !== null &&
          object[key] !== undefined &&
          object[key] !== ""
        ) {
          skipped.push(field.path);
          continue;
        }
        object[key] = field.value;
        applied.push(field.path);
      }
      if (
        draft.forecast != null &&
        draft.aggressive != null &&
        draft.aggressive < draft.forecast
      ) {
        const field = applied.includes("aggressive")
          ? "aggressive"
          : applied.includes("forecast")
            ? "forecast"
            : "";
        if (field) {
          draft[field] = old?.[field] ?? null;
          applied.splice(applied.indexOf(field), 1);
          skipped.push(field);
        }
      }
      let review = old;
      if (applied.length) {
        draft.reason = [
          old?.reason,
          `議事録「${minute.title}」から${automatic ? "自動" : "確認して"}反映`,
          ...minute.extraction.fields
            .filter((f) => applied.includes(f.path))
            .map((f) => f.evidence),
        ]
          .filter(Boolean)
          .join("\n")
          .slice(0, 6000);
        draft.observedAt = old?.observedAt || minute.meetingDate;
        review = saveReview(draft, user);
      }
      const updated = {
        ...minute,
        version: minute.version + 1,
        extraction: {
          ...minute.extraction,
          appliedAt: now(),
          appliedBy: user.id,
          applied,
          skipped,
          reviewId: review?.id || "",
        },
      };
      store.put("salesMinutes", updated);
      return { minute: updated, review, applied, skipped };
    });
  }
  async function drain() {
    if (working || stopped) return;
    working = true;
    try {
      while (pending.length && !stopped) {
        const mid = pending.shift();
        const minute = store.get("salesMinutes", mid);
        if (!minute || minute.extraction?.status !== "pending") continue;
        const actor = store.user(minute.extraction.requestedBy);
        await auditContext.run({ actorId: actor?.id || "system" }, async () => {
          try {
            fail(actor?.active, "抽出を依頼したメンバーが無効です。", 403);
            const usageId = "numbers:" + today();
            const usage = store.get("aiUsage", usageId) || {
              id: usageId,
              count: 0,
            };
            const limit = Math.max(
              1,
              Math.min(
                1000,
                Number(process.env.GEMINI_DAILY_EXTRACTIONS) || 20,
              ),
            );
            fail(
              usage.count < limit,
              "本日の数値抽出上限に達しました。翌日以降に再試行してください。",
              429,
            );
            store.put("aiUsage", { ...usage, count: usage.count + 1 });
            store.put("salesMinutes", {
              ...minute,
              extraction: { ...minute.extraction, status: "processing" },
            });
            const result = await extractNumbers({
              ...minute,
              accountName: store.get("salesAccounts", minute.accountId)?.name,
            });
            if (stopped) return;
            const fresh = store.get("salesMinutes", mid);
            if (digest(fresh.text) !== minute.extraction.sourceHash) return;
            const updated = {
              ...fresh,
              version: fresh.version + 1,
              extraction: {
                ...fresh.extraction,
                ...result,
                status: "completed",
                completedAt: now(),
                error: "",
              },
            };
            store.put("salesMinutes", updated);
            fail(
              store.user(actor.id)?.active,
              "依頼者が無効になったため、自動反映を停止しました。",
              403,
            );
            if (
              minute.autoApplyNumbers &&
              minute.targetMonth === today().slice(0, 7)
            )
              apply(updated, actor, 0, true);
          } catch (e) {
            if (stopped) return;
            const fresh = store.get("salesMinutes", mid);
            if (digest(fresh.text) !== minute.extraction.sourceHash) return;
            store.put("salesMinutes", {
              ...fresh,
              version: fresh.version + 1,
              extraction: {
                ...fresh.extraction,
                status: "failed",
                error: e.status
                  ? e.message
                  : "数値を抽出できませんでした。再試行してください。",
              },
            });
          }
        });
      }
    } finally {
      working = false;
    }
  }
  function enqueue(minute, user) {
    fail(
      integrationStatus().geminiConfigured,
      "Gemini APIキーとモデル名を設定してください。",
      503,
    );
    fail(
      !["pending", "processing"].includes(minute.extraction?.status),
      "数値を抽出中です。",
      409,
    );
    const updated = {
      ...minute,
      targetMonth: minute.targetMonth || minute.meetingDate.slice(0, 7),
      reviewWeek: minute.reviewWeek || week(),
      version: minute.version + 1,
      extraction: {
        status: "pending",
        requestedBy: user.id,
        sourceHash: digest(minute.text),
        fields: [],
        error: "",
      },
    };
    store.put("salesMinutes", updated);
    pending.push(minute.id);
    void drain();
    return updated;
  }
  return {
    enqueue,
    start() {
      stopped = false;
      for (const m of store.all("salesMinutes"))
        if (["pending", "processing"].includes(m.extraction?.status)) {
          store.put("salesMinutes", {
            ...m,
            extraction: { ...m.extraction, status: "pending" },
          });
          pending.push(m.id);
        }
      void drain();
    },
    stop() {
      stopped = true;
    },
    async handle({ p, method, body, user, reply }) {
      const match = p.match(
        /^\/sales\/minutes\/([^/]+)\/(refresh|extract|apply-numbers)$/,
      );
      if (match && method === "POST") {
        const minute = store.get("salesMinutes", match[1]);
        fail(minute, "議事録が見つかりません。", 404);
        fail(
          minute.version === body.version,
          "議事録が更新されています。再読み込みしてください。",
          409,
        );
        if (match[2] === "extract") return reply(202, enqueue(minute, user));
        if (match[2] === "apply-numbers")
          return reply(200, apply(minute, user, body.reviewVersion));
        fail(
          minute.googleFileId,
          "Googleドキュメントから取得した議事録ではありません。",
        );
        fail(!minute.supersededBy, "最新版の議事録から更新してください。", 409);
        fail(
          !["pending", "processing"].includes(minute.status) &&
            !["pending", "processing"].includes(minute.extraction?.status),
          "処理の完了後に更新してください。",
          409,
        );
        const document = await readDocument(minute.sourceUrl);
        fail(store.user(user.id)?.active, "ログインし直してください。", 401);
        const fresh = store.get("salesMinutes", minute.id);
        fail(
          fresh.version === minute.version,
          "取得中に議事録が更新されました。再読み込みしてください。",
          409,
        );
        if (document.text === minute.text) {
          const updated = {
            ...fresh,
            lastSyncedAt: now(),
            googleModifiedTime: document.modifiedTime,
            version: fresh.version + 1,
          };
          store.put("salesMinutes", updated);
          return reply(200, { unchanged: true, minute: updated });
        }
        // A new revision preserves task provenance and earlier numbers, instead of retargeting existing tasks.
        const revision = {
          ...fresh,
          id: id(),
          previousMinuteId: fresh.id,
          rootMinuteId: fresh.rootMinuteId || fresh.id,
          text: document.text,
          title: document.title.slice(0, 200),
          googleModifiedTime: document.modifiedTime,
          lastSyncedAt: now(),
          createdAt: now(),
          createdBy: user.id,
          version: 1,
          status: "saved",
          summary: null,
          summaryProvider: null,
          summaryError: "",
          extraction: null,
          taskLinks: [],
        };
        store.transaction(() => {
          store.put("salesMinutes", {
            ...fresh,
            supersededBy: revision.id,
            version: fresh.version + 1,
          });
          store.put("salesMinutes", revision);
        });
        if (revision.autoSummarize) enqueueSummary(revision);
        if (revision.autoExtract && integrationStatus().geminiConfigured)
          enqueue(store.get("salesMinutes", revision.id), user);
        return reply(201, {
          minute: store.get("salesMinutes", revision.id),
          previousMinuteId: fresh.id,
        });
      }
      return false;
    },
    async document(body) {
      if (!body.importGoogle) return null;
      const fileId = googleDocumentId(body.sourceUrl);
      fail(
        !store
          .all("salesMinutes")
          .some(
            (m) =>
              m.googleFileId === fileId &&
              m.accountId === body.accountId &&
              !m.supersededBy,
          ),
        "登録済みのドキュメントです。議事録詳細の「Googleから更新」を使ってください。",
        409,
      );
      return readDocument(body.sourceUrl);
    },
  };
}
