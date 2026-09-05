import { DatabaseSync, backup } from "node:sqlite";
import {
  mkdirSync,
  existsSync,
  renameSync,
  rmSync,
  statSync,
  chmodSync,
} from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export async function backupDatabase({
  dataDir = process.env.DATA_DIR || "./data",
  outputDir,
} = {}) {
  const source = resolve(dataDir, "worknest.sqlite");
  if (!existsSync(source))
    throw new Error(
      "データベースがありません。先にアプリを初期設定してください。",
    );
  const directory = resolve(outputDir || resolve(dataDir, "backups"));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = resolve(
    directory,
    `worknest-${stamp}-${randomUUID().slice(0, 8)}.sqlite`,
  );
  const partial = destination + ".partial";
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(db, partial);
    chmodSync(partial, 0o600);
    const copy = new DatabaseSync(partial, { readOnly: true });
    try {
      const checks = copy.prepare("PRAGMA integrity_check").all();
      if (checks.length !== 1 || Object.values(checks[0])[0] !== "ok")
        throw new Error("バックアップの整合性確認に失敗しました。");
    } finally {
      copy.close();
    }
    renameSync(partial, destination);
    return { path: destination, bytes: statSync(destination).size };
  } finally {
    db.close();
    rmSync(partial, { force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.length > 3)
      throw new Error("使い方: npm run backup -- [保存先フォルダー]");
    const result = await backupDatabase({ outputDir: process.argv[2] });
    console.log(
      `バックアップを保存しました: ${result.path} (${result.bytes} bytes)`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
