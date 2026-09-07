import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openStore } from "../server/store.mjs";

export function restoreExport(source, target) {
  const destination = resolve(target);
  if (existsSync(destination))
    throw new Error(
      "復元先はまだ存在しない新しいフォルダーを指定してください。",
    );
  const snapshot = JSON.parse(readFileSync(resolve(source), "utf8"));
  if (
    snapshot.format !== "worknest-export-v1" ||
    ![snapshot.users, snapshot.records, snapshot.audit].every(Array.isArray)
  )
    throw new Error("Worknestの全データ書き出しファイルではありません。");
  for (const row of [...snapshot.users, ...snapshot.records]) {
    if (
      typeof row.id !== "string" ||
      !row.id ||
      typeof row.data !== "string" ||
      JSON.parse(row.data).id !== row.id
    )
      throw new Error("書き出しデータに不正なレコードがあります。");
  }
  const store = openStore(destination);
  try {
    store.transaction(() => {
      for (const row of snapshot.users)
        store.db
          .prepare("INSERT INTO users(id,email,data) VALUES (?,?,?)")
          .run(row.id, row.email, row.data);
      for (const row of snapshot.records)
        store.db
          .prepare("INSERT INTO records(kind,id,data) VALUES (?,?,?)")
          .run(row.kind, row.id, row.data);
      for (const row of snapshot.audit)
        store.db
          .prepare(
            "INSERT INTO audit_log(seq,kind,record_id,action,actor_id,created_at,before_data,after_data) VALUES (?,?,?,?,?,?,?,?)",
          )
          .run(
            row.seq,
            row.kind,
            row.record_id,
            row.action,
            row.actor_id,
            row.created_at,
            row.before_data,
            row.after_data,
          );
    });
    const result = store.db.prepare("PRAGMA integrity_check").get();
    if (Object.values(result)[0] !== "ok")
      throw new Error("復元後の整合性を確認できませんでした。");
    return {
      path: destination,
      users: snapshot.users.length,
      records: snapshot.records.length,
      audit: snapshot.audit.length,
    };
  } finally {
    store.db.close();
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.length !== 4)
      throw new Error(
        "使い方: npm run restore:export -- 書き出し.json 新しい復元先フォルダー",
      );
    const result = restoreExport(process.argv[2], process.argv[3]);
    console.log(
      `復元しました: ${result.path} / ${result.records}レコード・${result.users}メンバー・${result.audit}履歴。ログインセッションは復元しません。`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
