import { digest, now } from "./store.mjs";
import { buildCustomerProposal } from "../shared/customer-proposal.mjs";
export const proposalIndexSql = `CREATE INDEX IF NOT EXISTS records_proposal_history ON records(json_extract(data,'$.accountId'),json_extract(data,'$.analysisId'),json_extract(data,'$.createdAt'),id) WHERE kind='customerProposals';`;
const check = (ok, message, status = 400) => {
  if (!ok) throw Object.assign(new Error(message), { status });
};
export function createCustomerProposals({ store }) {
  return async ({ p, method, body, user, reply, url }) => {
    if (!/^\/sales\/customer-proposals(?:\/[^/]+)?$/.test(p)) return false;
    if (!["GET", "POST"].includes(method)) return false;
    const accountId =
      method === "GET" ? url.searchParams.get("accountId") : body.accountId;
    check(
      typeof accountId === "string" &&
        accountId.length > 0 &&
        accountId.length <= 400,
      "対象アカウントを指定してください。",
    );
    check(
      store.get("salesAccounts", accountId),
      "アカウントが見つかりません。",
      404,
    );
    const pathId = p.split("/")[3];
    if (method === "GET" && pathId) {
      const record = store.get("customerProposals", pathId);
      check(record?.accountId === accountId, "提案資料が見つかりません。", 404);
      return reply(200, record);
    }
    const analysisId =
      method === "GET" ? url.searchParams.get("analysisId") : body.analysisId;
    check(
      typeof analysisId === "string" &&
        analysisId.length > 0 &&
        analysisId.length <= 400,
      "保存済みの分析を指定してください。",
    );
    const analysis = store.get("kwAnalyses", analysisId);
    check(
      analysis?.accountId === accountId,
      "保存済みの分析を選んでください。",
      404,
    );
    if (method === "GET") {
      const items = store.db
        .prepare(
          `SELECT id,json_extract(data,'$.title') AS title,json_extract(data,'$.createdAt') AS createdAt,json_extract(data,'$.createdBy') AS createdBy FROM records WHERE kind='customerProposals' AND json_extract(data,'$.accountId')=? AND json_extract(data,'$.analysisId')=? ORDER BY json_extract(data,'$.createdAt') DESC,id DESC LIMIT 501`,
        )
        .all(accountId, analysisId);
      return reply(200, { items });
    }
    if (method !== "POST" || pathId) return false;
    check(
      typeof body.requestId === "string" &&
        /^[\w-]{8,100}$/.test(body.requestId),
      "保存リクエストIDが必要です。",
    );
    check(
      body.parentId === undefined ||
        (typeof body.parentId === "string" && body.parentId.length <= 100),
      "改訂元の指定を確認してください。",
    );
    // Never accept client-provided slides or totals: reconstruct from the saved analysis.
    const deck = buildCustomerProposal(analysis.report, body.options);
    const hash = digest(
      JSON.stringify([accountId, analysisId, body.parentId || "", deck]),
    );
    const id = digest(user.id + ":" + body.requestId);
    const previous = store.get("customerProposals", id);
    if (previous) {
      check(
        previous.hash === hash,
        "同じ保存リクエストで内容が変更されました。",
        409,
      );
      return reply(200, previous);
    }
    if (body.parentId) {
      const parent = store.get("customerProposals", body.parentId);
      check(
        parent?.accountId === accountId && parent.analysisId === analysisId,
        "改訂元の提案資料が一致しません。",
        409,
      );
    }
    const record = {
      id,
      accountId,
      analysisId,
      analysisHash: analysis.hash,
      parentId: body.parentId || "",
      hash,
      title: deck.title,
      deck,
      createdAt: now(),
      createdBy: user.id,
    };
    const size = Buffer.byteLength(JSON.stringify(record));
    check(
      size <= 120000,
      "資料の保存内容は120KBまでです。文章を減らしてください。",
    );
    const usage = store.db
      .prepare(
        "SELECT count(*) AS count,coalesce(sum(length(CAST(data AS BLOB))),0) AS bytes FROM records WHERE kind='customerProposals'",
      )
      .get();
    check(
      usage.count < 500 && usage.bytes + size <= 20000000,
      "提案資料の保存上限（500版・20MB）に達しました。既存資料のダウンロードは継続できます。",
      409,
    );
    store.put("customerProposals", record);
    return reply(201, record);
  };
}
