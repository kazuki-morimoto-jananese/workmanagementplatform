import { DatabaseSync, backup } from "node:sqlite";
import { existsSync, mkdirSync, readdirSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Restore to an empty directory. Never replace a running database or its WAL files.
export async function restoreDatabase(sourceFile, targetDir) {
  if (!sourceFile || !targetDir)
    throw new Error(
      "使い方: npm run restore -- バックアップ.sqlite 空の復元先フォルダー",
    );
  const source = resolve(sourceFile),
    directory = resolve(targetDir);
  if (existsSync(directory) && readdirSync(directory).length)
    throw new Error(
      "復元先は空のフォルダーを指定してください。既存データは上書きしません。",
    );
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    if (Object.values(db.prepare("PRAGMA integrity_check").get())[0] !== "ok")
      throw new Error("バックアップの整合性に問題があります。");
    for (const table of ["users", "records", "sessions"])
      if (
        !db
          .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
          .get(table)
      )
        throw new Error("Worknestのバックアップではありません。");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const target = resolve(directory, "worknest.sqlite");
    await backup(db, target);
    chmodSync(target, 0o600);
    const restored = new DatabaseSync(target);
    try {
      // A restored deployment requires fresh authentication.
      restored.exec("DELETE FROM sessions");
      if (
        Object.values(restored.prepare("PRAGMA integrity_check").get())[0] !==
        "ok"
      )
        throw new Error("復元後の整合性確認に失敗しました。");
    } finally {
      restored.close();
    }
    return { path: target };
  } finally {
    db.close();
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const result = await restoreDatabase(process.argv[2], process.argv[3]);
    console.log(
      `復元しました: ${result.path}。サーバーを停止し、DATA_DIRを復元先へ切り替えて起動してください。`,
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
