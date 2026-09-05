import { execFileSync } from "node:child_process";
import { readFileSync, lstatSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function inspectPublicFile(path, content = "") {
  const errors = [];
  const normalized = path.replaceAll("\\", "/");
  if (
    /(^|\/)(data|backups|artifacts|attachments|\.secrets|\.codex|\.agents)(\/|$)/i.test(
      normalized,
    ) ||
    (/(^|\/)\.env(?:\..+)?$/i.test(normalized) &&
      !normalized.endsWith(".env.example")) ||
    /\.(?:sqlite(?:-.*)?|db(?:-.*)?|pem|key|p12|pfx)$/i.test(normalized) ||
    /(^|\/)\.browser-check-.*\.png$/i.test(normalized)
  )
    errors.push("社内データ・資格情報・ローカル成果物の可能性があるファイル名");
  const signatures = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bAIza[\w-]{35}\b/,
    /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
    /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
    /"private_key"\s*:\s*"[^"\n]{30,}/,
  ];
  if (signatures.some((pattern) => pattern.test(content)))
    errors.push("秘密鍵またはアクセストークンに一致する文字列");
  return errors;
}

export function checkPublication({ cwd = process.cwd(), staged = false } = {}) {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 12 * 1024 * 1024,
    });
  const files = [
    ...new Set(
      git(
        "ls-files",
        "-z",
        "--cached",
        ...(!staged ? ["--others", "--exclude-standard"] : []),
      )
        .split("\0")
        .filter(Boolean),
    ),
  ];
  if (!files.length)
    throw new Error(
      "公開対象のソースがありません。Gitリポジトリを初期化してください。",
    );
  const findings = [];
  for (const file of files) {
    let content;
    try {
      if (staged) content = git("show", `:${file}`);
      else {
        const stat = lstatSync(resolve(cwd, file));
        if (stat.isSymbolicLink()) {
          findings.push(`${file}: シンボリックリンクを含めないでください`);
          continue;
        }
        if (stat.size > 2 * 1024 * 1024) {
          findings.push(`${file}: 2MB超のファイルを確認してください`);
          continue;
        }
        content = readFileSync(resolve(cwd, file), "utf8");
      }
    } catch {
      findings.push(`${file}: ファイルの読取に失敗しました`);
      continue;
    }
    for (const issue of inspectPublicFile(file, content))
      findings.push(`${file}: ${issue}`);
  }
  if (findings.length) throw new Error(findings.join("\n"));
  return files.length;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(
      `公開対象 ${checkPublication({ staged: process.argv.includes("--staged") })} ファイル: 既知の秘密鍵形式・除外対象ファイルは検出されませんでした。`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
