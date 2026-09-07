# Google Workspace・SFA・CRM・MA 調査と実装判断

調査日：2026-09-07。公式の製品説明・開発資料に基づく。API利用可否は契約・管理者設定・認証スコープにも依存する。「APIがある」ことと「現在の会社環境で接続済み」は区別する。以下の優先度はWorknestの営業数字・議事録・タスクを統合する目的からの判断。

## Google Workspaceの機能と利用可能性

| サービス | API等でできること | Worknestとの関連・判断 | 状態 |
| --- | --- | --- | --- |
| [Sheets](https://developers.google.com/workspace/sheets/api/guides/concepts) | セル値の読み書き、表の作成・書式変更 | 営業マスタ・実績の取得。元表を正として手入力ヨミと分離 | 既存：日次・手動同期、Excel代替。現在の会社の外部共有制限は残る |
| [Docs](https://developers.google.com/workspace/docs/api/reference/rest) | 文書の取得・編集 | 議事録原文と改訂履歴を保存してAI抽出 | 既存：本人OAuth、URLから手動取得・更新、コピペ |
| [Drive](https://developers.google.com/workspace/drive/api/guides/about-sdk) | ファイル検索、取得、アップロード、共有、変更監視 | 議事録の選択・検索と更新検知。全ファイル収集より明示選択を優先 | URL指定のみ既存。Picker・フォルダー監視は次期 |
| [Calendar](https://developers.google.com/workspace/calendar/api/v3/reference/events/list) | 予定一覧、期間指定、繰り返し展開 | 次の商談予定の確認 | **今回実装**：本人の今後14日・最大100件、明示更新。閲覧スコープを追加認可。予定をDBに保存しない |
| [Forms](https://developers.google.com/workspace/forms/api/guides) | フォーム作成・編集、回答取得、通知 | 問い合わせ・資料請求をCRMの入口にする | **今回実装**：共通受付API＋回答スプシ用Apps Script例。各社でトリガー配備が必要 |
| [Meet](https://developers.google.com/workspace/meet/api/guides/overview) | 会議情報・参加者・録画・文字起こしの取得 | 商談記録と議事録作成の手間を減らす | 次期。契約上の文字起こし機能、成果物の作成有無、取得権限を先に確認。既存のDocs読取を利用可能 |
| [Gmail](https://developers.google.com/workspace/gmail/api/guides) | メール検索・取得・下書き・送信・ラベル | 顧客接点履歴・提案フォロー | 次期。全メール取り込みや自動送信を今回追加しない。対象ラベル・対象顧客・保存範囲の合意が先 |
| [Chat](https://developers.google.com/workspace/chat/quickstart/webhooks) | スペースへのWebhook通知、アプリ連携 | 期限・承認・取り込み失敗の通知 | 次期。通知先設定・送信条件・重複防止が必要。Webhook登録・実送信は未実施 |
| [Slides](https://developers.google.com/workspace/slides/api/guides/overview) | プレゼンテーション作成・更新 | 週次営業報告資料をテンプレートから作る | 次期。数字の定義とテンプレートが固まってから |
| [Tasks](https://developers.google.com/workspace/tasks/overview) | タスクリスト・タスクの管理 | 個人用タスクとの同期 | 低優先。Worknestの複数担当・組織公開・承認とモデルが異なり、双方向同期は競合設計が必要 |
| [People / Contacts](https://developers.google.com/people) | 連絡先・プロフィール等の取得・管理 | 顧客担当者の入力負担軽減 | 今回は手入力・共通API。個人アドレス帳を会社CRMへ共有する前に対象を選ぶ設計が必要 |
| [Admin Directory](https://developers.google.com/workspace/admin/directory/v1/guides/manage-org-units) | ユーザー・グループ・組織部門管理 | 入退社と組織マスタの同期 | 次期。管理者権限が必要。Googleの管理用OUと営業の部・グループ・チームが一致するとは限らないため対応表を持つ |
| [Workspace Events](https://developers.google.com/workspace/events) | 対象リソースのイベント購読 | Docs/Meet更新を起点に差分取り込み | 次期。Pub/Sub、購読更新、重複排除、障害復旧の運用追加が必要 |
| [Apps Script](https://developers.google.com/apps-script/guides/services/authorization) | Workspace内の処理、トリガー、外部HTTP呼び出し | 会社側で認可したデータのみ受け渡す | **今回サンプル提供**。インストール型トリガーの実行者と権限を明示する |
| [Keep](https://developers.google.com/workspace/keep/api/reference/rest) | ノート等のAPI | 個人メモ集約は可能性あり | 低優先。議事録の共通保存先をDocsに寄せる方が運用が単純 |
| [Sites](https://developers.google.com/workspace/sites) | 公開資料のSites APIはclassic Sites向け | 社内ポータルからWorknestへのリンク | 新Sites編集APIとして流用しない。リンク掲載から始める |
| AppSheet・Workspace Add-ons | 業務アプリやWorkspace画面の拡張 | モバイル入力・Gmail等からの操作導線 | [公式連携案内](https://workspace.google.com/integrations/)を確認。独自UI・配布審査が増えるため次期 |
| Vault・Reports・Cloud Search | 保持・監査・検索領域 | 企業監査・情報統制 | Worknestの監査ログと別の仕組み。今回の直接連携対象外。契約と管理者要件を個別調査してから |
| Vids・Geminiアプリ・NotebookLM等 | 動画・AI支援領域 | 提案資料・ナレッジ利用の候補 | Workspaceで使える製品機能を、そのまま第三者アプリ用APIとして使えるとは扱わない。今回は既存Gemini APIで要約・数値抽出 |

公開アプリの[OAuth審査・制限付きスコープ](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)には追加手続きがあり得る。会社の管理者によるAPI制限も残る。[本番公開の準備](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview)を踏まえ、必要な機能を使うときにだけ権限を追加する。Google OAuthは現在「データ連携」の認証であり、WorknestのSSOログインではない。

## SFA・CRM・MAから採用する機能

[Salesforce Sales Cloud](https://www.salesforce.com/sales/cloud/guide/)はリード・商談・営業プロセス・予測などを扱う。[HubSpot](https://www.hubspot.com/products)はCRMを軸にマーケティング・営業等を組み合わせ、フォーム・顧客情報・施策・営業パイプラインをつなぐ。機能とAPI利用は契約プランによって異なる。製品全体の模倣ではなく、現在の業務でデータの断絶が起きる箇所を優先した。

| 業務 | 課題 | 対応 |
| --- | --- | --- |
| 売上・消化予測 | Gトレ、担当者ヨミ、目標が混同される | 既存の別項目・個人目標・履歴を維持。今回、部→グループ→チームに集計 |
| 商談 | 顧客・担当・期日・確度が分散 | 既存の商談管理・確度加重額・停滞確認を継続 |
| 顧客担当者 | 法人アカウントと実際の相手が結び付かない | **今回**：担当者名・会社・メール・営業担当・アカウント紐付け・メモ・変更履歴 |
| リード管理 | 問い合わせ後の状況が追えない | **今回**：新規／有望／商談中／顧客／失注・対象外、検索 |
| フォロー | 次の行動が議事録や個人メモに埋もれる | **今回**：次回連絡日からアカウント付きタスク作成、未完了タスクの重複防止 |
| MAの入口 | フォーム・展示会・紹介の流入元が不明 | **今回**：流入元・施策名・施策別登録数と営業段階件数、フォーム連携例 |
| 連絡許可 | 連絡不可の相手へのアプローチ | **今回**：未確認／許可あり／連絡不可を記録。連絡不可ならフォロータスク作成を拒否 |
| データ移行 | 不用意な上書き・重複 | **今回**：受信バッチの確認、安定外部ID、再送の冪等性、version競合拒否、トークン更新 |
| ナーチャリング | 自動メールの配信管理が必要 | 次期：送信同意の証跡、配信停止、送信評価、テンプレート、送信事業者契約を整えてから |
| リードスコア | 根拠の薄い点数で営業優先度が歪む | 次期：実際の商談化データを収集して評価。今回、架空のスコアを表示しない |
| 分析 | 数字の合算・対象母集団が曖昧 | 施策表は担当者レコード数であり、売上貢献額・期間別コンバージョン率ではないことを画面に明記 |

推奨する段階の共通定義：新規＝受付、有望＝課題・対象条件を確認、商談中＝具体的案件あり、顧客＝契約確認、失注・対象外＝理由をメモ。これはWorknestでの運用提案であり、各社が自社の定義を決める。

## 各社サービスとの接続方法

| サービス | 公式の接続手段 | Worknestでの対応・残り |
| --- | --- | --- |
| [Slack](https://api.slack.com/messaging/webhooks) | Incoming Webhook、[Messaging API](https://api.slack.com/messaging/overview) | 通知アダプターは次期。勝手なチャネル送信はしない。双方向操作はSlack署名検証と権限確認が必要 |
| [Redash](https://redash.io/help/user-guide/integrations-and-api/) | APIによるクエリー・結果の利用 | 会社側で取得・変換する方式が候補。今回、Redashのクエリー実行・販売数字取得は未実装 |
| [Databricks](https://docs.databricks.com/api/statement-execution/v1) | SQL Statement Execution API | ウェアハウス権限・実行コスト・対象SQLの管理が必要。任意SQL実行機能は追加しない。共通形式への変換は会社側処理が候補 |
| [HRMOS採用](https://hrmos.co/info/news/20260831-2/) | 2026-08-31にAPI提供を発表。選考・応募者参照、選考評価登録を予定 | 発表時点で詳細と提供時期は後日案内。既に一般利用できると断定しない。採用・勤怠等のどの製品か確認が必要。応募者個人情報を営業CRMへ流さない |
| [Salesforce](https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/intro_what_is_rest_api.htm) / [HubSpot](https://developers.hubspot.com/docs/api-reference/overview) | CRMのREST API | ベンダー側の認可とデータ変換が必要。今回、Worknest側の顧客受付APIまで実装。完成済み専用コネクターではない |
| [Zoho CRM](https://www.zoho.com/crm/developer/docs/api/v8/) | CRUD・Bulk・通知・メタデータAPI | 同じ共通受付形式を利用するアダプターを後から追加可能 |
| [kintone](https://kintone.dev/en/docs/kintone/rest-api/) | レコードAPI、アプリ固有フィールド | レコードIDをexternalIdに対応。フィールドコードの変換が必要 |
| [Microsoft 365](https://learn.microsoft.com/en-us/graph/overview) | Microsoft GraphでOutlook・Teams・OneDrive等 | Googleと別のOAuth・管理者同意が必要。専用接続は次期。会社ごとのプラットフォーム選択に対応する設計にする |
| その他CRM・フォーム・社内ETL | HTTPS JSONを送信できれば利用可能 | **今回**：顧客担当者受付APIを提供。APIなしの場合は既存の営業Excel/CSV取込、または個別の変換処理が必要 |

「あらゆる製品との自動連携」を販売上の約束にはしない。対象データ、方向、頻度、認証、契約、変換、障害復旧を一つずつ定義して接続する。共通契約は[integration-contract.md](integration-contract.md)、販売導入手順は[commercial-onboarding.md](commercial-onboarding.md)。
