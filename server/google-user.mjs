import {
  randomBytes,
  createHash,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { digest, now } from "./store.mjs";
import { jsonRequest, googleCredentials } from "./sales-integrations.mjs";
import {
  googleDocumentId,
  readGoogleDocument,
} from "./minute-integrations.mjs";
const scope = "openid email https://www.googleapis.com/auth/documents.readonly";
const calendarScope =
  "https://www.googleapis.com/auth/calendar.events.readonly";
const fail = (ok, message, status = 400) => {
  if (!ok) throw Object.assign(new Error(message), { status });
};
const configured = () =>
  !!process.env.GOOGLE_OAUTH_CLIENT_ID &&
  !!process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
  !!process.env.GOOGLE_OAUTH_REDIRECT_URI;
const key = () =>
  createHash("sha256")
    .update(process.env.GOOGLE_OAUTH_CLIENT_SECRET || "")
    .digest();
function seal(value) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}
function unseal(value) {
  try {
    const bytes = Buffer.from(value, "base64"),
      cipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([
        cipher.update(bytes.subarray(28)),
        cipher.final(),
      ]).toString("utf8"),
    );
  } catch {
    fail(false, "Googleアカウントに再接続してください。", 503);
  }
}
const tokenRequest = (values, fetchImpl) =>
  jsonRequest(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        ...values,
      }).toString(),
    },
    fetchImpl,
  );
export function googleUserStatus(store, user) {
  let serviceAccount = "";
  try {
    serviceAccount = googleCredentials().client_email;
  } catch {}
  const connection = store.get("googleConnections", user.id);
  return {
    configured: configured(),
    connected: configured() && !!connection,
    email: connection?.email || "",
    calendar: configured() && !!connection?.scopes?.includes(calendarScope),
    serviceAccount,
    redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI || "",
  };
}
export function createGoogleUserService(store, { fetchImpl = fetch } = {}) {
  async function access(user) {
    fail(
      configured(),
      "Google本人認証の初期設定が必要です。管理者はGoogle接続手順を確認してください。",
      503,
    );
    const connection = store.get("googleConnections", user.id);
    fail(connection, "データ連携でGoogleアカウントに接続してください。", 403);
    let credentials = unseal(connection.secret);
    if (credentials.expiresAt > Date.now() + 60000)
      return credentials.accessToken;
    let result;
    try {
      result = await tokenRequest(
        {
          grant_type: "refresh_token",
          refresh_token: credentials.refreshToken,
        },
        fetchImpl,
      );
    } catch {
      fail(
        false,
        "Googleの認証が失効したか、利用が制限されています。Googleアカウントに再接続してください。",
        503,
      );
    }
    fail(
      typeof result.access_token === "string",
      "Google認証の応答を確認できません。",
      503,
    );
    fail(
      store.user(user.id)?.active &&
        store.get("googleConnections", user.id)?.secret === connection.secret,
      "Google接続が変更されました。再試行してください。",
      409,
    );
    credentials = {
      ...credentials,
      accessToken: result.access_token,
      expiresAt:
        Date.now() + Math.min(Number(result.expires_in) || 3600, 3600) * 1000,
    };
    store.put("googleConnections", {
      ...connection,
      secret: seal(credentials),
    });
    return credentials.accessToken;
  }
  async function readDocument(sourceUrl, user) {
    if (!store.get("googleConnections", user.id)) {
      try {
        return await readGoogleDocument(sourceUrl, { fetchImpl });
      } catch (e) {
        if (/HTTP (403|404)/.test(e.message))
          throw Object.assign(
            new Error(
              "この文書をWorknestのサービスアカウントで取得できません。URL・閲覧権限を確認してください。外部共有が禁止されている場合は「データ連携 → Google本人認証」を利用します。",
            ),
            { status: 403 },
          );
        throw e;
      }
    }
    const fileId = googleDocumentId(sourceUrl),
      token = await access(user);
    let document;
    try {
      document = await jsonRequest(
        "https://docs.googleapis.com/v1/documents/" +
          fileId +
          "?includeTabsContent=true",
        { headers: { Authorization: "Bearer " + token } },
        fetchImpl,
      );
    } catch (e) {
      if (/HTTP (403|404)/.test(e.message))
        throw Object.assign(
          new Error(
            "接続したGoogleアカウントに、この文書の閲覧権限がないか、会社のAPI利用制限があります。文書のURLと管理者の許可を確認してください。",
          ),
          { status: 403 },
        );
      throw e;
    }
    const lines = [];
    function content(elements = []) {
      for (const el of elements) {
        if (el.paragraph)
          for (const part of el.paragraph.elements || [])
            if (part.textRun?.content) lines.push(part.textRun.content);
        if (el.table)
          for (const row of el.table.tableRows || [])
            for (const cell of row.tableCells || []) content(cell.content);
        if (el.sectionBreak) lines.push("\n");
      }
    }
    function tabs(list = []) {
      for (const tab of list) {
        content(tab.documentTab?.body?.content);
        tabs(tab.childTabs);
      }
    }
    if (document.tabs?.length) tabs(document.tabs);
    else content(document.body?.content);
    const text = lines.join("").trim();
    fail(
      text && text.length <= 80000,
      "Googleドキュメント本文は1〜80,000文字にしてください。",
    );
    return {
      fileId,
      text,
      title: document.title || "Googleドキュメント",
      modifiedTime: document.revisionId || digest(text),
      sourceUrl: "https://docs.google.com/document/d/" + fileId + "/edit",
    };
  }
  async function handle({ path, method, user, url, send, body = {} }) {
    if (!path.startsWith("/api/google/")) return false;
    if (path === "/api/google/status" && method === "GET") {
      send(200, googleUserStatus(store, user));
      return true;
    }
    if (path === "/api/google/disconnect" && method === "POST") {
      store.remove("googleConnections", user.id);
      store.audit("auth", user.id, { event: "google_disconnected" });
      send(200, { ok: true });
      return true;
    }
    fail(
      configured(),
      "Google本人認証の初期設定が未完了です。管理者はconnect-google.cmdを実行してください。",
      503,
    );
    const redirect = process.env.GOOGLE_OAUTH_REDIRECT_URI;
    if (path === "/api/google/calendar" && method === "GET") {
      fail(
        googleUserStatus(store, user).calendar,
        "カレンダー閲覧の追加許可が必要です。データ連携でカレンダーを接続してください。",
        403,
      );
      const start = new Date(),
        end = new Date(start.getTime() + 14 * 86400000);
      const params = new URLSearchParams({
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "100",
      });
      let result;
      try {
        result = await jsonRequest(
          "https://www.googleapis.com/calendar/v3/calendars/primary/events?" +
            params,
          { headers: { Authorization: "Bearer " + (await access(user)) } },
          fetchImpl,
        );
      } catch (e) {
        if (/HTTP (403|404)/.test(e.message))
          fail(
            false,
            "Google Calendar APIの有効化、会社のAPI利用許可、カレンダー閲覧の許可を確認してください。",
            403,
          );
        throw e;
      }
      send(200, {
        events: (result.items || [])
          .filter((e) => e.status !== "cancelled")
          .map((e) => ({
            id: e.id,
            title: e.summary || "予定",
            start: e.start?.dateTime || e.start?.date,
            end: e.end?.dateTime || e.end?.date,
            url: /^https:\/\/([a-z]+\.)?google\.com\//.test(e.htmlLink || "")
              ? e.htmlLink
              : "",
          })),
        truncated: !!result.nextPageToken,
      });
      return true;
    }
    if (path === "/api/google/start" && method === "POST") {
      const state = randomBytes(32).toString("base64url"),
        verifier = randomBytes(48).toString("base64url");
      for (const old of store.all("googleOAuthStates"))
        if (old.expiresAt < Date.now() || old.userId === user.id)
          store.remove("googleOAuthStates", old.id);
      store.put("googleOAuthStates", {
        id: digest(state),
        userId: user.id,
        verifier,
        expiresAt: Date.now() + 600000,
      });
      const params = new URLSearchParams({
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
        redirect_uri: redirect,
        response_type: "code",
        scope:
          scope +
          (body.calendar === true || googleUserStatus(store, user).calendar
            ? " " + calendarScope
            : ""),
        include_granted_scopes: "true",
        state,
        access_type: "offline",
        prompt: "consent",
        login_hint: user.email,
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
      });
      send(200, {
        url: "https://accounts.google.com/o/oauth2/v2/auth?" + params,
      });
      return true;
    }
    if (path === "/api/google/callback" && method === "GET") {
      const state = store.get(
        "googleOAuthStates",
        digest(url.searchParams.get("state") || ""),
      );
      fail(
        state && state.userId === user.id && state.expiresAt > Date.now(),
        "Google認証の有効期限が切れたか、ログインユーザーが異なります。再接続してください。",
        403,
      );
      store.remove("googleOAuthStates", state.id);
      fail(
        !url.searchParams.has("error"),
        "Google認証が許可されませんでした。会社のAPI利用制限はWorkspace管理者に確認してください。",
        403,
      );
      const code = url.searchParams.get("code");
      fail(code, "認証コードがありません。");
      const result = await tokenRequest(
        {
          grant_type: "authorization_code",
          code,
          redirect_uri: redirect,
          code_verifier: state.verifier,
        },
        fetchImpl,
      );
      fail(
        typeof result.access_token === "string" &&
          typeof result.refresh_token === "string",
        "Googleの継続利用許可がありません。再接続してください。",
        503,
      );
      const profile = await jsonRequest(
        "https://openidconnect.googleapis.com/v1/userinfo",
        { headers: { Authorization: "Bearer " + result.access_token } },
        fetchImpl,
      );
      fail(
        profile.email_verified === true &&
          profile.email?.toLowerCase() === user.email.toLowerCase(),
        "Worknestにログインしているメールアドレスと同じGoogleアカウントを選択してください。",
        403,
      );
      fail(store.user(user.id)?.active, "ログインし直してください。", 401);
      store.put("googleConnections", {
        id: user.id,
        email: profile.email,
        scopes:
          typeof result.scope === "string"
            ? result.scope.split(" ")
            : scope.split(" "),
        connectedAt: now(),
        secret: seal({
          accessToken: result.access_token,
          refreshToken: result.refresh_token,
          expiresAt:
            Date.now() +
            Math.min(Number(result.expires_in) || 3600, 3600) * 1000,
        }),
      });
      store.audit("auth", user.id, { event: "google_connected" });
      send(302, { ok: true }, { Location: "/?google=connected" });
      return true;
    }
    fail(false, "Google接続のAPIが見つかりません。", 404);
  }
  return { handle, readDocument };
}
