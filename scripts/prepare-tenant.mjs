import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
export function prepareTenant({
  slug,
  origin,
  emailDomain,
  root = process.cwd(),
}) {
  if (!/^[a-z][a-z0-9-]{2,35}$/.test(slug || ""))
    throw Error(
      "企業IDは英小文字で始まる3〜36文字の英数字・ハイフンにしてください。",
    );
  const url = new URL(origin);
  if (
    url.protocol !== "https:" ||
    url.origin !== origin ||
    url.username ||
    url.password
  )
    throw Error("公開URLは https://ホスト名 の形式にしてください。");
  if (
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(
      emailDomain || "",
    )
  )
    throw Error("会社メールドメインを指定してください。");
  const directory = resolve(root, ".secrets", "tenants", slug);
  if (existsSync(directory))
    throw Error("この企業IDの設定は作成済みです。上書きしません。");
  mkdirSync(directory, { recursive: true });
  const config = {
    name: "worknest-" + slug,
    main: relative(
      directory,
      resolve(root, "server/cloudflare.mjs"),
    ).replaceAll("\\", "/"),
    compatibility_date: "2026-09-07",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: true,
    preview_urls: false,
    assets: {
      directory: relative(directory, resolve(root, "dist")).replaceAll(
        "\\",
        "/",
      ),
      binding: "ASSETS",
      not_found_handling: "single-page-application",
      run_worker_first: ["/api/*"],
    },
    durable_objects: {
      bindings: [{ name: "WORKSPACE", class_name: "CompanyWorkspace" }],
    },
    migrations: [{ tag: "v1", new_sqlite_classes: ["CompanyWorkspace"] }],
    vars: {
      NODE_ENV: "production",
      GEMINI_MODEL: "gemini-3.1-flash-lite",
      GEMINI_AUTO_SUMMARY: "false",
      GEMINI_DAILY_EXTRACTIONS: "20",
      GEMINI_DAILY_SUMMARIES: "20",
    },
    observability: { enabled: false },
  };
  writeFileSync(
    resolve(directory, "wrangler.json"),
    JSON.stringify(config, null, 2),
    { flag: "wx" },
  );
  writeFileSync(
    resolve(directory, "secrets.json"),
    JSON.stringify(
      {
        APP_ORIGIN: origin,
        ALLOWED_EMAIL_DOMAIN: emailDomain,
        SETUP_TOKEN: randomBytes(32).toString("hex"),
      },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  );
  return directory;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [slug, origin, emailDomain] = process.argv.slice(2);
    const directory = prepareTenant({ slug, origin, emailDomain });
    console.log(
      "企業別設定を作成しました: " +
        directory +
        "\nまだ公開していません。docs/commercial-onboarding.md を確認してください。",
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
