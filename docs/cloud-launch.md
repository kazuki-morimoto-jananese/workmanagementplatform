# 無料枠で会社用Worknestを公開する

## 公開先と構成

Cloudflare Workers FreeとSQLite付きDurable Objectsを使います。画面・API・永続DBを同じCloudflareアカウントに配置し、workers.devのHTTPS URLを発行します。独自ドメインの購入、外部DB契約、Renderの登録は不要です。無料枠を超えた場合は処理が制限されます。有料プランへの変更は行いません。[Workers料金](https://developers.cloudflare.com/workers/platform/pricing/)、[Durable Objects料金](https://developers.cloudflare.com/durable-objects/platform/pricing/)。

Vercel Hobbyは個人の非商用利用向けです。今回の会社での営業管理には採用していません。Vercelの一時ファイル領域へSQLiteを保存する構成ではデータを永続化できません。[Vercelの商用利用条件](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage)、[SQLiteについて](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel)。

公開設定は[wrangler.jsonc](../wrangler.jsonc)、クラウド用の入口は[server/cloudflare.mjs](../server/cloudflare.mjs)です。既存の認証・業務処理・監査保存を使い、DBをクラウドの永続SQLiteへ接続します。一時ファイルへ業務データを置きません。1つの配置につき1つの会社ワークスペースです。

## 本人に必要な操作

1. このPCの **connect-cloud.cmd** をダブルクリックします。Cloudflareのブラウザー画面でログイン・許可し、続けてGoogle Cloudは会社で使うアカウントで認証します。これは認証だけで、有料サービスの作成やGoogleの課金設定は行いません。
2. 会社用の管理者メールと対象スプシのURLをCodexへ伝えます。パスワードやAPIキーをチャットへ送る必要はありません。
3. Googleの組織設定で許可されない操作がある場合だけ、管理者への依頼が必要です。スプシ・議事録の共有先は、専用サービスアカウントの作成後に提示します。

認証が時間切れになった場合は同じ起動ファイルから再開できます。個別に認証する場合は npm run connect:cloud -- cloudflare または npm run connect:cloud -- google を実行します。

Cloudflareはnpmに登録した公式Wranglerを使います。Google Cloud SDK 583.0.0は公式のWindows用アーカイブをSHA256検証して、このPCのartifacts/tools/googleに配置しています。別のPCへcloneした場合はGoogle CLIの再配置が必要です。認証情報は.secrets、検証ファイルはartifactsに置き、Git・Dockerの対象外です。[Google公式アーカイブ](https://docs.cloud.google.com/sdk/docs/downloads-versioned-archives)。

## 認証後にこちらで行うこと

- CloudflareアカウントがFreeプランであることと配置先を確認。
- 会社メールのドメインと、ランダムな初期設定トークンを秘密設定へ登録。
- npm run deploy:cloud で配信し、返された実際のURLで画面・認証・未ログインのアクセス拒否を検証。
- 会社用ワークスペースの初期設定と組織・上司の登録を支援。個人PCのデモDBはアップロードしない。
- Googleプロジェクトの確認、Sheets/Drive APIの有効化、専用サービスアカウントとGeminiキーの準備・配置。権限不足の場合は必要な操作だけ案内。
- 対象スプシのプレビュー、初回同期、件数・金額確認、日次同期の設定。

秘密設定はSETUP_TOKEN、ALLOWED_EMAIL_DOMAIN、GOOGLE_SERVICE_ACCOUNT_JSON、GEMINI_API_KEYです。CLIの標準入力または秘密ファイルから設定し、コマンド引数・Git・業務データには含めません。初期設定トークンが未設定なら本番の初期登録は拒否されます。登録メンバーだけがログインでき、部署による閲覧制限はありません。

npm run build:cloud は配信ファイルを作って配置内容を検証するだけで、公開は行いません。GitHubへのpushだけでCloudflareへ配信する設定はまだありません。初回公開後、必要なら会社が管理する認証方法でGit連携を追加します。

## スプシ・議事録・Gemini

サービスアカウントJSONを秘密の環境変数GOOGLE_SERVICE_ACCOUNT_JSONで渡せます。従来のGOOGLE_SERVICE_ACCOUNT_FILEもNodeサーバーで使えます。両方指定した場合はJSONを優先します。スプシ・Googleドキュメントは専用アカウントへ閲覧者として共有し、読み取り専用で取得します。

Cloudflareでは永続アラームを1分ごとに実行し、Worknestに保存された日本時間の同期時刻を判定します。「今すぐ同期」も利用できます。マスタ更新で手入力のヨミ・議事録・タスクは上書きしません。

Geminiの初期設定は自動要約オフ、要約・数値抽出は各20回/日です。これはアプリの試行回数で、Google側の無料枠とは別です。まず架空の議事録で接続確認します。実際の社内議事録を送信する前に、無料枠のデータ利用条件と会社の利用方針を確認してください。[APIキー](https://ai.google.dev/gemini-api/docs/api-key)、[利用規約](https://ai.google.dev/gemini-api/terms)。

## 長期保存と復旧

業務データと変更前後の監査履歴は永続DBへ蓄積し、自動削除しません。Cloudflare版の「復元ポイントを記録」はPITR用ブックマークを保存します。Node版の日次SQLiteファイルとは保存方式が異なります。[復元API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#pitr-point-in-time-recovery-api)。

管理者の「設定・連携 → 全データを書き出す」で、業務データ・メンバー・全監査履歴をJSONへ保存できます。認証用ハッシュを含むため管理者が保管してください。ログインセッションとGoogle/Geminiの秘密設定は含めません。

書き出しファイルは npm run restore:export -- worknest-backup.json restored-company で、未作成の新しいフォルダーへSQLiteとして復元できます。既存DBを上書きせず、以前のセッションは復活しません。復元先をDATA_DIRにしたNodeサーバーで利用できます。CloudflareへのJSONの直接再投入は未実装です。無料枠の容量・リクエスト上限は利用人数と蓄積量に影響するため、最初は本人と上司で使用量を確認します。

## 現在の状態

Cloudflare認証、Google認証、会社メール、対象スプシURLが揃うまで、公開URL発行・会社用の本番DB初期登録・Google実接続は未完了です。ローカルのクラウド実行環境では認証・主要業務・再起動後のデータ保持を検証しています。
