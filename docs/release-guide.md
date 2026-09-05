# Git公開と運用

このリポジトリは、ログインが必要なタスク・営業管理アプリのソース一式です。Node.js 24と永続ディスクで実行します。GitHubへのソース登録と、アプリを社内メンバーが利用できるサーバーへの配置は別の作業です。GitHub Pagesの静的配信では、認証APIとSQLiteの保存処理が動作しません。

## GitHubに登録する

ローカルの `main` ブランチにソースをコミットした状態から、次のコマンドで登録できます。社内利用向けの例は非公開リポジトリです。

```powershell
gh auth login --hostname github.com --git-protocol https --web
npm.cmd run check:publish
gh repo create workmanagementplatform --private --source=. --remote=origin --push
git push origin --tags
```

組織へ作る場合は `workmanagementplatform` を `組織名/workmanagementplatform` に置き換えます。ソースを一般公開する場合は作成時の `--private` を `--public` に変更してください。既存の `origin` がある場合は `git remote -v` で宛先を確認して `git push -u origin main` を使用します。既存リポジトリの履歴を強制上書きする必要はありません。

`gh auth login` は本人のGitHub認証が必要です。認証トークンをチャットやソースへ貼り付けず、CLIの案内に従います。CLIの使用法は [GitHub CLIの公式資料](https://cli.github.com/manual/gh_repo_create) に準拠しています。

## 含めるもの・含めないもの

含めるのは画面、API、テスト、設定例、運用手順です。`.gitignore` と `.dockerignore` でDB、バックアップ、`.env` の各環境設定、秘密鍵、ローカルのスクリーンショットを除外します。GoogleサービスアカウントのJSONは `.secrets/` に配置してください。

`npm run check:publish` は対象ファイル名と代表的な秘密鍵／トークン形式を確認します。最初の公開では `git diff --cached --stat` と `git ls-files` も確認してください。これは既知パターンの検出であり、任意の社内情報やすべての秘密を識別するものではありません。新しい業務データをソースディレクトリへ直接保存しない運用を続けます。

## 自動チェック

GitHub Actionsはpush・pull request時に次を実行します。

- 公開対象ファイルの確認、TypeScript、API・永続化テスト
- 本番ビルド、Chromiumでの操作テスト、依存パッケージ監査
- Dockerイメージのビルド

Actionsの権限は `contents: read`、資格情報はcheckout後に保存しません。実Google／GeminiのキーはCIに不要です。DependabotでnpmとActionsの更新を定期確認します。設定は [checkout](https://github.com/actions/checkout) と [setup-node](https://github.com/actions/setup-node) の公式仕様に基づきます。

## 稼働中のバックアップ

```powershell
npm.cmd run backup
```

`data/backups` へ時刻付きSQLiteを追加します。任意の保存先は `npm.cmd run backup -- D:/WorknestBackups` のように指定します。SQLiteのオンラインバックアップAPIを使用し、WALに入っている確定済み更新も含め、コピー後に整合性を確認します。既存バックアップを削除・上書きしません。単一ファイルの単純コピーとは異なる [Node.jsのbackup API](https://nodejs.org/docs/latest-v24.x/api/sqlite.html) を使用します。

バックアップには社内情報と認証情報が含まれます。アクセスをサーバー管理者に限定し、Gitへ追加しないでください。保存容量と社内保管ルールに応じて別媒体への保管・世代の整理を行います。

復元はアプリを停止し、現在の `data` を別名で保全してから、新しい `data` ディレクトリへバックアップを `worknest.sqlite` として配置します。古いWAL／SHMを復元先に混ぜません。Dockerでも停止した上で永続ボリュームへ同様に復元します。

Dockerでのバックアップ実行は `docker compose exec app node scripts/backup.mjs`。`/api/health` はDBへの接続を確かめる軽量な死活監視です。アカウント・営業数字・設定内容は返しません。

## サーバーへ配置する

[READMEの社内共有・クラウド運用](../README.md#社内共有クラウド運用) と [Google連携ガイド](sales-guide.md) を参照してください。現構成は単一インスタンス、HTTPS、永続SQLite向けです。外部クラウドへの自動デプロイやGitHub Pagesへの自動配信は設定していません。
