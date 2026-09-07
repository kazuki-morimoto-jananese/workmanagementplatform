# 営業拡張: 実装コントラクト

v2.3: タスクはassigneeIds配列、assigneeIdは代表担当の互換項目。共通組織はorgUnitIdで参照。議事録はtargetMonth・reviewWeekを明示し、Google文書更新時は旧IDを保持して新しい改訂IDへ紐づける。AI数値は原文検証後の未入力欄のみ反映し、原文ハッシュ・実行者・反映項目を保存する。主要データの変更はaudit_logへ同じトランザクションで記録。[運用・連携ガイド](operations-and-integrations.md)を参照。

内部の共通仕様。金額は円、空欄はnull、0は実測0。月はYYYY-MM、週はその週の月曜日YYYY-MM-DD（JST）。アカウントIDはスプレッドシートの文字列IDを維持する。

## 画面とAPI

`SalesWorkspace` props: `{data: Data, api: <T=any>(path:string,method?:string,body?:unknown)=>Promise<T>, onOpenTask:(task:Task)=>void, onTasksChanged:()=>Promise<unknown>}`。自身で`GET /sales/bootstrap?month=YYYY-MM&weekOf=YYYY-MM-DD`取得。画面内のタブで「営業サマリー」「週次ヨミ」「商談」「議事録」「データ連携」。rootがAppのナビに組み込む。UIはsrc/SalesWorkspace.tsx, src/sales.cssを所有。

バックエンド `createSalesService({store,saveTask,activity})` in server/sales.mjs: `handle({path,method,body,user,send,url})` returns boolean (handled), `start()` scheduler, `stop()`. rootが既存認証・初回PW変更チェックの後に呼ぶ。bodyサイズはrootで2MBへ変更。

API（以下すべて`/sales`接頭辞）:

- GET `/bootstrap?month&weekOf` -> `{accounts,masters,reviews,opportunities,minutes,activities,imports,connections,history}`
- POST `/accounts` / PATCH `/accounts/:id`: account fields。PATCHはversion必須。
- POST `/reviews`: `{accountId,month,weekOf,version?,forecast,aggressive,probability,reason,nextAction,customerGoal,customerIssues,funnel,effectiveProposal,budgetTrend,media,observedAt}`。account+month+weekでupsert、既存はversion必須。入力済みのforecastにはreason必須。過去週の履歴を保持。
- POST `/opportunities` / PATCH `/opportunities/:id`: opportunity fields、PATCH version必須。
- POST `/activities`: `{accountId,type:'call'|'meeting'|'proposal',date,notes}`。
- POST `/minutes`: `{accountId,opportunityId?,title,meetingDate,text,sourceUrl?,autoSummarize?:boolean}`。本文はDB保存。AI有効時は保存後バックグラウンド要約。無効時も保存を成功させる。
- POST `/minutes/:id/summarize`: 再要約。要約が走っていれば重複拒否。非同期202。
- POST `/minutes/:id/tasks`: `{actionIndex,version,projectId,assigneeId,dueDate?}` 完了済みの要約のactionからユーザー確認後タスク作成。古い要約バージョンと重複生成を防ぐ。
- POST `/accounts/:id/tasks`: `{title,projectId,assigneeId,dueDate?,description?}`。営業accountIdを既存taskに付け、saveTaskでtask本体作成。task.accountId/minuteIdの保持はroot対応。
- POST `/imports/preview`: `{text,month,sourceName?,mapping?}` -> `{headers,mapping,rows:[{accountId,name,...}],errors:[string],warnings:[string],count}`。TSV/CSV引用符付き複数行対応。全体validate、id重複や数値不正を警告/拒否。
- POST `/imports/commit`: `{text,month,sourceName?,mapping?,seedReviews?:boolean}` -> `{created,updated,skipped,warnings,importId}`。管理者のみ。manual preview内容で再解析。masterとアカウントのみ更新、手入力reviewsを上書きしない。seedReviews trueは未入力の当週レビューだけ初回補完。
- POST `/connections`: `{spreadsheetId,range,name,month,rollingMonth,enabled,syncTime,mapping}` admin only。接続1件を保存。month固定orrollingMonthはJST当月。enabledで日次同期。syncTimeはJSTのHH:mm、既定06:00。lastScheduledAttemptAtを手動同期のlastAttemptAtと分けて保持。
- POST `/connections/preview`: admin only。保存済み接続を読み取り専用で取得・解析し、取込プレビューとsourceName・range・checkedAtを返す。業務データの更新や同期試行の記録はしない。
- POST `/connections/sync`: admin only 手動同期。read-only Sheets API、失敗時DBを変更せず記録。
- GET `/export?month&weekOf`: CSV textダウンロード（サーバーheaders注入等避け安全に、またはJSONでcsv返す）。UI api helperがJSONを期待するため `{csv,filename}` を返す。
- POST `/demo`: admin only、当月±1か月の架空データを6アカウントへ追加。既存の実データとデモの編集を保持。`{periods,created,totalCreated,accounts}` を返す。CSV `/export` は `scope=real|demo`、省略時real。

## 主なレコード

Account: `{id,name,status,ownerId,ownerName,group,category,agency,projectId,customerGoal,customerIssues,lastContactAt,importedAt,version}`。
Master: `{id,accountId,month,previousActual,previousGTrend,gTrend,target,nextTarget,media,raw,importedAt,sourceName}`。
Review: `{id,accountId,month,weekOf,forecast:number|null,aggressive:number|null,probability:number|null,reason,nextAction,customerGoal,customerIssues,funnel,effectiveProposal:'yes'|'no'|'unknown',budgetTrend,observedAt,media,version,updatedAt,updatedBy}`。
Media: `{stanby:{budget,spend,cv,cpa,hires},indeed:{budget,spend,cv,cpa,hires,months},box:{budget,spend,cv,cpa,hires,months},acceptableCpa:number|null}`。数値はnull許可。CPAと採用単価は分母>0のときだけ再計算。予算÷CVは不可、消化額÷CVのみ。
Opportunity: `{id,accountId,title,amount,probability,stage:'discovery'|'proposal'|'negotiation'|'won'|'lost',expectedCloseDate,ownerId,nextAction,lastActivityAt,version,updatedAt}`。
Minute: `{id,accountId,opportunityId,title,meetingDate,text,sourceUrl,createdAt,createdBy,status:'saved'|'pending'|'processing'|'completed'|'failed',summary:null|{overview,decisions:string[],risks:string[],actions:[{title,ownerName,dueDate,evidence}],evidence:string[]},summaryProvider:'gemini'|'local'|null,summaryError,taskLinks:[{actionIndex,taskId}],version}`。
Activity: `{id,accountId,type,date,notes,userId,createdAt}`。
Import: `{id,sourceName,createdAt,status,created,updated,errors,warnings}`。
connections: `{sheetsConfigured,geminiConfigured,geminiModel,autoSummaryEnabled,source:null|{name,spreadsheetId,range,month,rollingMonth,enabled,mapping,lastAttemptAt,lastSuccessAt,lastError,nextRunAt}}`。秘密鍵/APIキーは返さない。
history: reviews変更履歴の要約（accountId,month,weekOf,forecast,reason,updatedAt,updatedBy）。

## integration helpers (server/sales-integrations.mjs)

- `integrationStatus()` -> `{sheetsConfigured,geminiConfigured,geminiModel,autoSummaryEnabled}`（envは呼出時評価）
- `readGoogleSheet(config, {fetchImpl=fetch}={})` -> `{values: (string|number|null)[][]}`。サービスアカウントのJSONをGOOGLE_SERVICE_ACCOUNT_FILEから読み、固定Google endpointへJWT署名交換。Sheets readonly scope。config={spreadsheetId,range}。
- `summarizeMinutes({text,title,meetingDate}, {fetchImpl=fetch}={})` -> `{summary:{overview,decisions,risks,actions,evidence},provider:'gemini'|'local'}`。GEMINI_API_KEYとGEMINI_MODEL設定時だけ外部送信。GEMINI_AUTO_SUMMARY=trueで保存後自動実行。キー未設定は実際の本文から抽出するローカル要点整理を返しAIと偽らない。本文の命令は無視、原文にない数値/期限/担当を捏造しない、出力schemaを検証、外部エラー時throw（ローカルへの黙示fallback不可）。

## 算定原則

1アカウントあたり指定月・指定週以前の最新レビューを1件だけ集計。「当週未入力」は別表示。手入力のヨミは月全体の着地なので、確度加重商談金額やGトレを足さない。商談パイプラインは別カード。競合の消化額を自社売上へ足さない。前週差はレビュー履歴の前週時点の値。CPAのチーム平均は単純平均不可。データ鮮度・未入力・根拠未記載・最終接点14日超・予算ギャップ・CPA超過をUIで明示。マスタ消失でアカウントを勝手に削除しない。
