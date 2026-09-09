const folderType = "application/vnd.google-apps.folder";
const docType = "application/vnd.google-apps.document";
const validId = (v) => typeof v === "string" && /^[\w-]{1,250}$/.test(v);
const check = (ok, message, status = 400) => {
  if (!ok) throw Object.assign(new Error(message), { status });
};
export const normalizeAccountName = (v) =>
  String(v || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/株式会社|有限会社|\(株\)|\(有\)/g, "")
    .replace(/[\s\p{P}\p{S}]/gu, "");
export function accountMatch(names, path) {
  const normalized = normalizeAccountName(path);
  return (
    names.find(
      (n) =>
        normalizeAccountName(n).length >= 2 &&
        normalized.includes(normalizeAccountName(n)),
    ) || ""
  );
}
// Per-user ephemeral scans: metadata is never broadcast to the workspace.
export function createDriveCollection({ store, request, requireScope }) {
  const scans = new Map();
  return async ({ path, method, user, body, send }) => {
    if (!path.startsWith("/api/google/collection")) return false;
    requireScope(user, "driveSearch");
    if (path === "/api/google/collection/settings") {
      if (method === "GET") {
        send(
          200,
          store.get("driveCollectionSettings", user.id) || { roots: [] },
        );
        return true;
      }
      if (method === "POST") {
        check(
          Array.isArray(body.roots) &&
            body.roots.length <= 10 &&
            body.roots.every(validId),
          "検索元はフォルダーIDを10件以内で指定してください。",
        );
        const settings = { id: user.id, roots: [...new Set(body.roots)] };
        store.put("driveCollectionSettings", settings);
        send(200, settings);
        return true;
      }
    }
    if (path === "/api/google/collection/start" && method === "POST") {
      for (const [key, value] of scans)
        if (value.expires < Date.now()) scans.delete(key);
      check(
        !scans.get(user.id)?.busy,
        "検索処理中です。完了後に再検索してください。",
        409,
      );
      const account = store.get("salesAccounts", body.accountId);
      check(account, "アカウントを選択してください。");
      const roots = store.get("driveCollectionSettings", user.id)?.roots || [];
      check(roots.length, "検索元フォルダーを登録してください。");
      const aliases = String(body.aliases || "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      check(
        aliases.length <= 10 && aliases.every((s) => s.length <= 200),
        "別名は200文字以内、10件までです。",
      );
      const scan = {
        id: crypto.randomUUID(),
        accountId: account.id,
        names: [account.name, ...aliases],
        queue: roots.map((id) => ({ id, path: "", depth: 0 })),
        seen: [],
        docs: [],
        visited: 0,
        warnings: [],
        expires: Date.now() + 3600000,
        connection: store.get("googleConnections", user.id)?.connectedAt,
      };
      scans.set(user.id, scan);
      send(200, { scanId: scan.id });
      return true;
    }
    if (path === "/api/google/collection/next" && method === "POST") {
      const s = scans.get(user.id);
      check(
        s &&
          s.id === body.scanId &&
          s.expires > Date.now() &&
          s.connection === store.get("googleConnections", user.id)?.connectedAt,
        "検索が終了または接続が変更されました。検索を開始し直してください。",
        409,
      );
      check(!s.busy, "検索処理中です。", 409);
      s.busy = true;
      const files = [];
      try {
        // One folder page per call keeps requests bounded and permits cancellation.
        const item = s.queue[0];
        if (item) {
          try {
            if (!item.path) {
              const meta = await request(
                user,
                `https://www.googleapis.com/drive/v3/files/${item.id}?fields=id,name,mimeType,driveId&supportsAllDrives=true`,
              );
              check(
                meta.mimeType === folderType,
                "指定先はフォルダーではありません。",
              );
              item.path = meta.name;
              item.driveId = meta.driveId;
            }
            const p = new URLSearchParams({
              q: `'${item.id}' in parents and trashed = false`,
              pageSize: "100",
              fields:
                "nextPageToken,incompleteSearch,files(id,name,mimeType,modifiedTime)",
              supportsAllDrives: "true",
              includeItemsFromAllDrives: "true",
            });
            if (item.driveId) {
              p.set("corpora", "drive");
              p.set("driveId", item.driveId);
            }
            if (item.pageToken) p.set("pageToken", item.pageToken);
            const result = await request(
              user,
              "https://www.googleapis.com/drive/v3/files?" + p,
            );
            if (result.incompleteSearch)
              s.warnings.push("Googleが検索の一部を省略しました。");
            for (const f of result.files || []) {
              if (!validId(f.id)) continue;
              const fullPath = item.path + " / " + f.name;
              if (
                f.mimeType === folderType &&
                !s.seen.includes(f.id) &&
                !s.queue.some((q) => q.id === f.id)
              ) {
                if (item.depth < 20 && s.seen.length + s.queue.length < 3000)
                  s.queue.push({
                    id: f.id,
                    path: fullPath,
                    depth: item.depth + 1,
                    driveId: item.driveId,
                  });
                else
                  s.warnings.push(
                    "深さ20階層・3,000フォルダーの上限に達しました。検索元を絞ってください。",
                  );
              }
              if (f.mimeType === "application/vnd.google-apps.shortcut")
                s.warnings.push(
                  "ショートカットは検索対象外です。リンク先フォルダーを検索元に追加してください。",
                );
              const match =
                f.mimeType === docType && accountMatch(s.names, fullPath);
              if (match && !s.docs.includes(f.id)) {
                s.docs.push(f.id);
                const existing = store
                  .all("salesMinutes")
                  .find(
                    (m) =>
                      m.googleFileId === f.id &&
                      m.accountId === s.accountId &&
                      !m.supersededBy,
                  );
                files.push({
                  id: f.id,
                  name: f.name,
                  path: fullPath,
                  match,
                  modifiedTime: f.modifiedTime,
                  existingId: existing?.id || "",
                  url: `https://docs.google.com/document/d/${f.id}/edit`,
                });
              }
            }
            s.visited++;
            if (result.nextPageToken) item.pageToken = result.nextPageToken;
            else {
              s.seen.push(item.id);
              s.queue.shift();
            }
          } catch (e) {
            if ([401, 409].includes(e.status)) throw e;
            s.warnings.push(`${item.path || item.id}: ${e.message}`);
            s.queue.shift();
          }
        }
        if (s.visited >= 5000 || s.docs.length >= 2000) {
          s.warnings.push(
            "検索上限に達しました。検索元を絞って再検索してください。",
          );
          s.queue = [];
        }
        s.warnings = [...new Set(s.warnings)].slice(0, 30);
        send(200, {
          files,
          done: !s.queue.length,
          visited: s.visited,
          pending: s.queue.length,
          warnings: s.warnings,
        });
      } finally {
        s.busy = false;
      }
      return true;
    }
    return false;
  };
}
