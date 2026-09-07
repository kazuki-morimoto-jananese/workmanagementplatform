import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2] || "all";
if (!["all", "cloudflare", "google"].includes(target)) {
  console.error(
    "Usage: node scripts/connect-cloud.mjs [cloudflare|google|all]",
  );
  process.exit(1);
}
mkdirSync(resolve(root, ".secrets"), { recursive: true, mode: 0o700 });
console.log(
  "Worknest: クラウド認証を開始します。これは認証だけで、有料サービスは作成しません。",
);
console.log(
  "ブラウザーに表示されたアカウントを確認して許可してください。認証情報はこのPCの.secretsに保存します。\n",
);
const env = {
  ...process.env,
  XDG_CONFIG_HOME: resolve(root, ".secrets/cloudflare"),
  WRANGLER_SEND_METRICS: "false",
  WRANGLER_LOG_PATH: resolve(root, "artifacts/cloud-auth/logs"),
  CLOUDSDK_CONFIG: resolve(root, ".secrets/gcloud"),
  CLOUDSDK_CORE_DISABLE_USAGE_REPORTING: "true",
  CLOUDSDK_COMPONENT_MANAGER_DISABLE_UPDATE_CHECK: "true",
};
let failed = false;
function run(executable, args, label) {
  if (!existsSync(executable)) {
    console.error(
      `${label}の公式CLIが未配置です。ツールの準備を依頼してください。`,
    );
    failed = true;
    return;
  }
  console.log(`--- ${label} ---`);
  const result = spawnSync(executable, args, {
    cwd: root,
    env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error(`${label}は未完了です。再実行できます。`);
    failed = true;
  } else console.log(`${label}の認証が完了しました。\n`);
}
if (target !== "google")
  run(
    process.execPath,
    [
      resolve(root, "node_modules/wrangler/bin/wrangler.js"),
      "login",
      "--scopes",
      "account:read",
      "user:read",
      "workers:write",
      "workers_scripts:write",
    ],
    "Cloudflare（Freeプラン）",
  );
if (target !== "cloudflare") {
  const sdk = resolve(root, "artifacts/tools/google/google-cloud-sdk");
  env.CLOUDSDK_PYTHON = resolve(sdk, "platform/bundledpython/python.exe");
  run(
    env.CLOUDSDK_PYTHON,
    [resolve(sdk, "lib/gcloud.py"), "auth", "login", "--brief"],
    "Google Cloud（会社アカウントを選択）",
  );
}
console.log(
  failed
    ? "未完了の認証があります。表示された内容を確認してください。"
    : "認証が完了しました。Codexへ「認証完了」と伝えてください。設定と公開作業を引き継ぎます。",
);
process.exitCode = failed ? 1 : 0;
