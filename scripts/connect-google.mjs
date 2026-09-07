import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { execFileSync } from "node:child_process";
const root = resolve(import.meta.dirname, "..");
process.chdir(root);
const input = createInterface({ input: process.stdin, output: process.stdout });
try {
  const company = JSON.parse(
    readFileSync(".secrets/company-login.json", "utf8"),
  );
  const origin = new URL(company.url).origin,
    redirect = origin + "/api/google/callback";
  let project = "";
  try {
    project = JSON.parse(
      readFileSync(".secrets/google-worknest-reader.json", "utf8"),
    ).project_id;
  } catch {}
  const consoleUrl =
    "https://console.cloud.google.com/auth/clients" +
    (project ? "?project=" + encodeURIComponent(project) : "");
  console.log("\nGoogle本人認証の初期設定（Google側で一度だけ必要）\n");
  console.log(
    "1. Google Auth PlatformでOAuth同意画面を設定します。会社組織内のプロジェクトなら「内部」を選びます。",
  );
  console.log(
    "   「外部・テスト」の場合は利用する会社メールをテストユーザーに追加します。会社のAPI許可は別途必要です。",
  );
  console.log(
    "2. OAuthクライアントを「ウェブアプリケーション」で作成してください。",
  );
  console.log(
    "3. 承認済みのリダイレクトURIに次を完全一致で登録してください：\n" +
      redirect,
  );
  console.log(
    "4. 作成したOAuthクライアントのJSONをダウンロードしてください。チャットやGitに貼り付けないでください。",
  );
  console.log("\n設定画面：" + consoleUrl + "\n");
  if (process.platform === "win32" && !process.argv[2])
    execFileSync("rundll32.exe", ["url.dll,FileProtocolHandler", consoleUrl], {
      windowsHide: true,
    });
  const path = (
    process.argv[2] ||
    (await input.question("ダウンロードしたJSONのフルパスを入力："))
  )
    .trim()
    .replace(/^"|"$/g, "");
  const client = JSON.parse(readFileSync(path, "utf8")).web;
  if (
    !client?.client_id?.endsWith(".apps.googleusercontent.com") ||
    typeof client.client_secret !== "string" ||
    !client.client_secret ||
    !client.redirect_uris?.includes(redirect)
  )
    throw Error(
      "ウェブアプリケーションのJSONと、承認済みリダイレクトURIを確認してください。",
    );
  mkdirSync(".secrets", { recursive: true });
  const secrets = {
    GOOGLE_OAUTH_CLIENT_ID: client.client_id,
    GOOGLE_OAUTH_CLIENT_SECRET: client.client_secret,
    GOOGLE_OAUTH_REDIRECT_URI: redirect,
  };
  const file = resolve(".secrets/google-oauth-cloud.json");
  writeFileSync(file, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: resolve(".secrets/cloudflare"),
    WRANGLER_SEND_METRICS: "false",
    WRANGLER_LOG_PATH: resolve("artifacts/cloud-auth/logs"),
  };
  if (!existsSync("node_modules/wrangler/bin/wrangler.js"))
    throw Error("先にnpm installを実行してください。");
  execFileSync(
    process.execPath,
    ["node_modules/wrangler/bin/wrangler.js", "secret", "bulk", file],
    { cwd: root, env, stdio: "inherit", windowsHide: true },
  );
  console.log(
    "\n設定完了。Worknestを再読み込みし「営業・数字管理 → データ連携 → Googleアカウントに接続」を押してください。",
  );
  console.log(
    "Docs APIが未有効の場合は管理者がGoogle CloudのAPIライブラリでGoogle Docs APIを有効にしてください。",
  );
} catch (e) {
  console.error("設定を完了できませんでした：" + e.message);
  process.exitCode = 1;
} finally {
  input.close();
}
