import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
function domainValue(value, label) {
  const domain = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    domain.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(
      domain,
    )
  )
    throw new Error(
      `${label}はURLや@を含まないドメイン名で指定してください（例: example.com）。`,
    );
  return domain;
}
export function prepareCompany({
  domain,
  emailDomain,
  directory = process.cwd(),
}) {
  const host = domainValue(domain, "公開ドメイン"),
    company = domainValue(emailDomain, "会社メールドメイン");
  const path = resolve(directory, ".env.company");
  const content = [
    "# Company deployment. Keep this file private; never commit it.",
    `APP_DOMAIN=${host}`,
    `ALLOWED_EMAIL_DOMAIN=${company}`,
    `SETUP_TOKEN=${randomBytes(32).toString("hex")}`,
    "# Leave Gemini disabled until company data handling is agreed.",
    "GEMINI_API_KEY=",
    "GEMINI_MODEL=gemini-3.1-flash-lite",
    "GEMINI_AUTO_SUMMARY=false",
    "GEMINI_DAILY_EXTRACTIONS=20",
    "GEMINI_DAILY_SUMMARIES=20",
    "",
  ].join("\n");
  // Exclusive creation preserves an existing configuration and setup secret.
  writeFileSync(path, content, { flag: "wx", mode: 0o600 });
  mkdirSync(resolve(directory, ".secrets"), { recursive: true, mode: 0o700 });
  return { path, domain: host, emailDomain: company };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.length !== 4)
      throw new Error(
        "使い方: npm run prepare:company -- 公開ドメイン 会社メールドメイン",
      );
    const result = prepareCompany({
      domain: process.argv[2],
      emailDomain: process.argv[3],
    });
    console.log(
      `会社用設定を保存しました: ${result.path}\n公開先: https://${result.domain}\n秘密の初期設定トークンはファイル内に保存しました。既存のDBや環境は変更していません。`,
    );
  } catch (e) {
    console.error(
      e.code === "EEXIST"
        ? ".env.companyは作成済みです。既存設定を保持しました。"
        : e.message,
    );
    process.exitCode = 1;
  }
}
