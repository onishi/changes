# changes

GitHub のコミット履歴を、日次・週次・月次の changelog として閲覧できる Web アプリケーションです。公開ページでは public リポジトリの活動だけを掲載し、認証が必要な `all` ページでは private リポジトリを含むすべての活動を確認できます。

本番環境は Cloudflare Workers 上で動作させ、[https://changes.wagaya.org](https://changes.wagaya.org) で公開します。

## 目的

- GitHub 上で「いつ、どのリポジトリに、どのような変更を加えたか」を振り返りやすくする
- 個々のコミットを並べるだけでなく、AI 要約によって期間内の成果を短時間で把握できるようにする
- 公開可能な活動と private な活動を、同じ操作感を保ちながら安全に分離する

## 想定する利用形態

初期バージョンは、設定された1人の GitHub owner（サイト所有者）の活動を表示する個人用 changelog とします。同期対象は、その owner 配下のリポジトリだけです。

- `public`: 誰でも閲覧可能。public リポジトリのコミットだけを表示する
- `all`: GitHub 認証済みかつ許可されたユーザーだけが閲覧可能。public/private 両方を表示する
- コミットの author email だけに依存せず、GitHub API が返すユーザーとの関連情報を使って所有者のコミットを判定する
- owner はアプリ設定で1つだけ指定し、別 owner や Organization 配下のリポジトリは対象にしない

複数ユーザーがそれぞれ自分の changelog を持つ SaaS 形式は、初期スコープには含めません。

## 主要機能

### 公開範囲

| モード | URL                  | 認証 | 対象リポジトリ | キャッシュ・ログ上の扱い                   |
| ------ | -------------------- | ---- | -------------- | ------------------------------------------ |
| Public | `/` または `/public` | 不要 | public のみ    | CDN キャッシュ可能                         |
| All    | `/all`               | 必須 | public/private | private キャッシュ禁止、検索エンジン非公開 |

公開範囲は表示時の絞り込みだけでなく、データ取得・API レスポンス・AI 要約・キャッシュの各層で分離します。public 向けレスポンスに private リポジトリの名前、コミットメッセージ、要約、件数を含めません。

### 期間別 changelog

以下の3つの粒度で表示します。

- Daily: 1日単位
- Weekly: 日曜日から土曜日までの1週間単位
- Monthly: 暦月単位

日付境界は設定したタイムゾーンを基準とし、初期値は `Asia/Tokyo` とします。画面上には対象期間を明記します。

各期間ページには次の情報を表示します。

- コミット数、活動したリポジトリ数
- リポジトリごとの変更レコード
- 各変更レコードの AI 要約、コミット数、コミット一覧
- 前後の期間へ移動するページャ

期間切り替えは URL で状態を表現し、共有や再読み込みが可能な構造にします。

```text
/daily/2026-08-20
/weekly/2026-08-16
/monthly/2026-08
/all/daily/2026-08-20
/all/weekly/2026-08-16
/all/monthly/2026-08
```

weekly の URL には、その週の日曜日の日付を使用します。週の開始曜日は設定では変更せず、日曜日に固定します。

### 変更レコードの単位

画面と API で扱う1レコードは、期間種別（daily / weekly / monthly）、対象期間、リポジトリの組み合わせです。同じリポジトリに同じ期間内のコミットが複数ある場合も、コミットごとにレコードを分けず、1つの変更レコードにまとめます。

たとえば `changes` リポジトリに2026年8月20日のコミットが5件ある場合、daily ビューでは「2026年8月20日 × changes」の1レコードとして表示し、その中に5件のコミットと、それらをまとめた AI 要約を持たせます。同じコミット群でも weekly と monthly は、それぞれの対象期間に対応する別の変更レコードとして集約します。

変更レコードには次の情報を含めます。

- 期間種別と開始・終了日時
- リポジトリ
- AI による変更概要
- コミット数
- 期間内の最初・最後のコミット日時
- 元コミットの一覧（日時、メッセージ、SHA、GitHub へのリンク）
- 対象期間で絞り込んだ GitHub コミットログへのリンク

public / all は表示範囲です。public では public リポジトリの変更レコードだけを返し、all では認証後に public/private 両方を返します。

### GitHub コミットログへのリンク

各変更レコードに「GitHub でコミットログを見る」リンクを表示します。リンク先は対象リポジトリの default branch のコミット履歴とし、owner と期間で絞り込みます。

```text
https://github.com/:owner/:repo/commits?author=:owner&since=:since&until=:until
```

- `author`: アプリに設定された単一 owner の GitHub login
- `since`: 対象期間の開始日時
- `until`: 対象期間の終了日時
- `since` / `until`: `Asia/Tokyo` で求めた期間境界を UTC の ISO 8601 へ変換した値

2026年8月を例にした期間指定は次のとおりです。

| 期間    | アプリ上の範囲（Asia/Tokyo）             | `since`                | `until`                |
| ------- | ---------------------------------------- | ---------------------- | ---------------------- |
| Daily   | 2026-08-20 00:00:00〜23:59:59            | `2026-08-19T15:00:00Z` | `2026-08-20T14:59:59Z` |
| Weekly  | 2026-08-16 00:00:00〜2026-08-22 23:59:59 | `2026-08-15T15:00:00Z` | `2026-08-22T14:59:59Z` |
| Monthly | 2026-08-01 00:00:00〜2026-08-31 23:59:59 | `2026-07-31T15:00:00Z` | `2026-08-31T14:59:59Z` |

実際の URL では query parameter を URL encode します。各コミットの SHA リンクは、従来どおり GitHub の個別コミットページへ遷移します。

期間指定 URL の形式は [GitHub Docs: Viewing commit details from your timeline](https://docs.github.com/en/account-and-profile/how-tos/contribution-settings/viewing-commit-details-from-your-timeline) に準拠します。

public ページでは public リポジトリへのリンクだけを生成します。private リポジトリのコミットログ URL は認証済みの `/all` の HTML/API にだけ含め、public 側にはリポジトリの存在を示す URL 自体を返しません。GitHub 側で対象リポジトリを閲覧できない場合は、GitHub の認証・認可結果に従います。

### ビュー

#### トップサマリ

`/`（`/public` も同じ表示）は、特定の日付ページへリダイレクトせず、現在の Daily / Weekly / Monthly を横断する公開サマリを表示します。各期間についてコミット数、活動したリポジトリ数、直近3リポジトリの AI 要約を掲載し、期間ページとリポジトリページへ移動できるようにします。対象は public リポジトリだけで、private の名称・件数・要約は含めません。

#### 日付ごとのビュー

選択期間に活動したリポジトリを、1リポジトリ1変更レコードで表示します。複数リポジトリを横断して、その日・週・月に何を行ったかを把握するための基本ビューです。

#### リポジトリごとのビュー

選択したリポジトリの変更レコードを期間順に表示します。リポジトリ内でも daily / weekly / monthly を切り替えられるようにし、同じ期間の複数コミットは1レコードにまとめます。

```text
/repo/:repo/daily/2026-08-20
/repo/:repo/weekly/2026-08-16
/repo/:repo/monthly/2026-08
/all/repo/:repo/daily/2026-08-20
```

public 側で private リポジトリの URL を指定した場合は、存在を推測できないよう `404` を返します。

対象 owner は1つに固定されるため、URL では owner 名を省略し、リポジトリ名だけを使用します。対象 owner 配下ではリポジトリ名が一意であることを前提とします。

### AI 要約

AI 要約は変更レコード単位で、その期間・リポジトリに含まれるすべてのコミットメッセージを中心に生成します。

- 事実を補完・推測せず、入力されたコミット情報の範囲だけを要約する
- 単なるコミット列挙ではなく、機能追加、修正、保守、ドキュメントなどのまとまりを優先する
- merge commit や機械的な変更を識別し、要約のノイズを抑える
- 対象コミットが少ない場合は簡潔にし、活動がない期間は要約を生成しない
- 要約には生成日時と対象コミット集合の fingerprint を持たせ、入力が変わった場合だけ再生成する
- public 用要約は public コミットだけ、all 用要約は認証された処理内ですべてのコミットを入力にする

AI プロバイダーに private コードそのものは送信しません。初期版で送る情報はリポジトリ名、コミットメッセージ、日時など必要最小限のメタデータに限定します。private データを外部 AI に送ることは設定とプライバシーポリシーに明記します。

要約生成に失敗した場合もコミット一覧は閲覧可能にし、「要約を生成できませんでした」と表示します。

### ページャ

ページャには2種類あります。

- 期間ページャ: 前の日/週/月、次の日/週/月へ移動する
- 変更レコードページャ: 対象期間またはリポジトリの変更レコードが多い場合に一覧を分割する

変更レコード一覧は安定した並び順を保つため、最新コミット日時、期間開始日時、リポジトリ ID を使った cursor pagination を採用します。初期表示件数は50件とし、URL の `cursor` クエリで続きの状態を保持します。未来期間への「次へ」は無効化します。各変更レコード内のコミット一覧は、そのレコードにまとめられた元データとして表示します。

## 画面構成

### 共通ヘッダー

- Public / All のモード表示と切り替え
- Daily / Weekly / Monthly の切り替え
- 日付選択
- リポジトリ選択
- All へのサインイン、サインアウト

### 期間ページ

1. 対象期間と公開範囲
2. コミット数・リポジトリ数
3. リポジトリごとの変更レコード
4. 各変更レコードの AI サマリとコミット一覧
5. 期間ページャと変更レコードページャ

### 空状態・エラー

- 活動なし: 対象期間にコミットがないことを表示する
- 同期中: 最終同期時刻と、情報が更新中であることを表示する
- API 制限: 古いキャッシュを表示しつつ、更新が遅れていることを表示する
- 要約失敗: コミット一覧は維持し、要約部分だけ再試行可能にする
- 権限不足: all では再認証を案内し、public では private 情報を示さない

## 認証・認可

- GitHub OAuth または GitHub App を使用する
- `/all` と `/api/all/*` はサーバー側で必ず認証・認可する
- 許可ユーザーは環境変数などで GitHub user ID を明示し、login 名の一致だけに依存しない
- private リポジトリへアクセスできる最小権限だけを要求する
- OAuth token、AI API key、Webhook secret、session secret は Cloudflare Workers Secrets に保存し、ブラウザへ返さない
- セッション Cookie は `HttpOnly`、`Secure`、`SameSite=Lax` を基本とする
- all ページは `Cache-Control: private, no-store` とし、`noindex` を付与する
- Static Assets のレスポンスヘッダーは `public/_headers`、API と Worker 経由のレスポンスヘッダーは middleware で設定する
- Web フォントは `public/fonts/` に self-host し、外部へのリクエストを発生させない。訪問者の IP が第三者へ渡らず、CSP も外部ホストの許可なしで閉じられる
- Content-Security-Policy はリクエストごとの nonce を発行し、middleware でヘッダーへ、HTMLRewriter で shell 内の script へ付与する。bootstrap JSON はインライン script として埋め込むため、`'unsafe-inline'` ではなく nonce で許可する。asset 側の nonce なしポリシーは Worker 経由のレスポンスから削除し、ブラウザが複数の CSP を同時に適用しないようにする
- 認証切れ、権限変更、リポジトリの public/private 変更を次回同期時に反映する

## データ同期

GitHub API から毎回すべてを読み込むのではなく、バックグラウンド同期したデータをアプリのデータベースから表示します。同期・保存対象は `2026-05-01 00:00:00 Asia/Tokyo` 以降のコミットです。

Web ページの初期表示では Worker が D1 binding を直接読み、表示用データを HTML に bootstrap JSON として埋め込みます。React 起動後の API 待ちは発生させず、API は再読み込みと外部利用向けに維持します。public HTML は短時間キャッシュ可能、all HTML は `private, no-store` とします。

1. 初回同期で対象リポジトリと一定期間のコミットを取得する
2. 定期ジョブで直近の履歴を差分同期する
3. 必要に応じて GitHub Webhook で更新を早める
4. force-push、削除、公開範囲変更に備えて定期的に再検証する
5. コミット集合が変化した期間の AI 要約だけを無効化・再生成する

同じコミットが複数ブランチから見える場合に重複しないよう、リポジトリ ID と commit OID の組を一意にします。初期版は default branch に到達可能なコミットを対象とし、対象ブランチの拡張は将来対応とします。

同期時にはコミットを個別に保存し、表示・要約用の変更レコードを期間種別、対象期間、リポジトリごとに集約します。追加・削除されたコミットの影響を受ける daily / weekly / monthly の変更レコードだけを更新します。

## Cloudflare 構成

本番アプリケーションは次の Cloudflare サービスで構成します。

| 役割            | Cloudflare サービス   | 用途                                                      |
| --------------- | --------------------- | --------------------------------------------------------- |
| Web / API       | Workers               | React アプリ、API、GitHub OAuth callback、認証・認可      |
| Frontend assets | Workers Static Assets | HTML、JavaScript、CSS、画像の配信                         |
| Database        | D1                    | repository、commit、変更レコード、同期状態、認証データ    |
| 定期実行        | Cron Triggers         | GitHub 差分同期の開始。Cron は UTC で設定する             |
| 非同期処理      | Queues                | リポジトリ同期、変更レコード更新、AI 要約生成、retry      |
| AI              | Workers AI を第一候補 | 変更レコード単位の日本語要約。provider adapter は維持する |
| Secrets         | Workers Secrets       | GitHub App と session の秘密情報                          |
| Monitoring      | Workers Observability | request、scheduled、queue consumer のログと障害確認       |

Web、API、Static Assets は1つの Worker としてデプロイします。Cron Trigger は同期ジョブを Queue へ投入し、Queue consumer が GitHub API 取得・D1 更新・要約生成を実行します。Queue は再配信されても壊れないよう、すべての consumer を idempotent にします。繰り返し失敗した job は dead-letter queue に移し、原因を確認して再実行できるようにします。

### 本番ドメイン

- Production URL: `https://changes.wagaya.org`
- Cloudflare zone: `wagaya.org`
- Routing: Worker Custom Domain
- TLS / DNS: Custom Domain の作成時に Cloudflare が管理する
- Preview: production の D1、Queue、Secrets と分離した preview 環境を使用する

`wrangler.jsonc` では Custom Domain を次の形で管理します。

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "changes",
  "main": "./worker/index.ts",
  "compatibility_date": "2026-08-18",
  "routes": [
    {
      "pattern": "changes.wagaya.org",
      "custom_domain": true,
    },
  ],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "changes-production",
      "database_id": "<D1_DATABASE_ID>",
    },
  ],
  "queues": {
    "producers": [
      {
        "binding": "JOBS",
        "queue": "changes-jobs",
      },
    ],
    "consumers": [
      {
        "queue": "changes-jobs",
        "dead_letter_queue": "changes-jobs-dlq",
      },
    ],
  },
  "triggers": {
    "crons": ["<SYNC_CRON_IN_UTC>"],
  },
  "observability": {
    "enabled": true,
  },
}
```

D1 database ID や Cron の頻度は環境作成時に確定します。秘密値は `wrangler.jsonc` や Git に書かず、環境ごとの Workers Secrets として登録します。`wagaya.org` が対象 Cloudflare account の active zone であり、`changes.wagaya.org` に競合する既存 DNS record / Worker route がないことを、Custom Domain 作成前に読み取り確認します。

## 開発

Node.js 24 と npm を使用します。

```bash
npm install
cp .dev.vars.example .dev.vars
npm run d1:migrate:local
npm run dev
```

`.dev.vars` に GitHub App の installation / user authorization 用の値を設定します。このファイルは Git 管理しません。ローカル画面は `http://localhost:5173`、health check は `/api/health` です。`all` の callback は GitHub 側にもローカル用 URL を登録するか、本番 URL で確認します。

品質確認は次のコマンドでまとめて実行できます。

```bash
npm run check
```

個別には `npm run format:check`、`npm run lint`、`npm run typecheck`、`npm test`、`npm run build` を使用します。テストは Cloudflare Workers runtime 上で動き、test ごとに分離された D1 に migration を適用します。

### 本番リソース

- Worker: `changes-production`
- D1: `changes-production`
- Queue: `changes-jobs`
- Dead-letter Queue: `changes-jobs-dlq`
- Custom Domain: `changes.wagaya.org`

初回デプロイ前に、GitHub App、許可ユーザー、セッション用の値を `.prod.vars` に設定します。このファイルは Git 管理されず、初回デプロイ時に Worker と Secrets を同時作成するためだけに使います。

```bash
cp .prod.vars.example .prod.vars
# .prod.vars を編集する。SESSION_SECRET は `openssl rand -base64 48` などで生成する
npm run d1:migrate:production
npm run deploy:first
```

初回デプロイ後は `.prod.vars` を読み込まない `npm run deploy` を使います。secret を更新するときは `npx wrangler secret put <NAME> --name changes-production` を使い、値を対話入力します。秘密値を shell history、Git、issue、チャットへ貼り付けません。

GitHub App は対象 owner `onishi` のリポジトリだけにインストールし、Contents の read-only 権限を付与します。同じ GitHub App の user authorization を All へのログインにも使うため、別の OAuth App は不要です。Redirect URI は `https://changes.wagaya.org/api/auth/callback` とし、Webhook は初期版では無効にします。`ALLOWED_GITHUB_USER_ID` は login 名ではなく数値 user ID を設定します。

GitHub App 作成時の値は次のとおりです。

| 設定                                           | 値                                             |
| ---------------------------------------------- | ---------------------------------------------- |
| GitHub App name                                | `changes-wagaya` など一意の名前                |
| Homepage URL                                   | `https://changes.wagaya.org`                   |
| Redirect URI                                   | `https://changes.wagaya.org/api/auth/callback` |
| Request user authorization during installation | Off                                            |
| Webhook active                                 | Off                                            |
| Repository permissions → Contents              | Read-only                                      |
| Where can this GitHub App be installed?        | Only on this account                           |

作成後に private key と client secret を1つずつ生成し、App ID、Client ID、Client secret、private key を Secrets へ登録します。App を `onishi` にインストールし、installation URL の数値 ID を `GITHUB_INSTALLATION_ID` に設定します。初期同期対象を限定したい場合は、インストール時に `Only select repositories` を選びます。

### デプロイ方針

1. Pull Request ごとに lint、typecheck、unit / integration / E2E test、Worker build を実行する
2. preview 用 Worker と D1 で migration と smoke test を実行する
3. production D1 migration を適用する
4. Worker code と Static Assets を同じ release としてデプロイする
5. `https://changes.wagaya.org` で public、認証、API、Cron、Queue の smoke test を行う
6. 問題がある場合は Worker version を rollback し、DB migration は backward-compatible な手順で戻す

main branch から production へのデプロイには Cloudflare Workers Builds または GitHub Actions + Wrangler を使用します。production への反映は、CI が成功し、D1 migration と secret / binding の準備が完了した場合だけ行います。

### 運用監視

本番ログは `npx wrangler tail changes-production` または Workers Observability で確認します。主な構造化ログ event は次のとおりです。

- `github_rate_limit`: owner 同期開始時の GitHub API `limit`、`remaining`、`used`、`resetAt`。endpoint は種別だけを記録し、リポジトリ名や token は含めない
- `github_api_rate_limited`: primary / secondary rate limit 到達時の status、`Retry-After`、rate-limit snapshot
- `summary_refreshes_enqueued`: prompt version が古い ready / failed 要約を Cron から再投入した件数。1回最大25件
- `queue_message_failed`: Queue message の種別、attempt、retryable 判定、秘密値を含まないエラー概要

AI 要約は prompt で100文字程度・2〜3文を目安として指示し、schema は40〜300文字と余裕を持たせます。schema を目標値ぎりぎりに設定すると、JSON Mode の制約付き生成が上限で文字列を打ち切り、文が途中で終わった要約が生成されるためです。schema は文章量を制御する手段ではなく、異常な出力だけを弾く安全網として扱います。リポジトリ名・期間・コミット件数は変更レコードの他のフィールドとして画面に表示するため、モデルにも渡さず、要約には変更内容だけを記述します。それでも『〜の要約です』のような前置きが出力された場合は、保存前に先頭のメタ文だけを機械的に取り除き、前置きしか残らない出力は failed として扱います。JSON の途中切れなどで失敗したレコードは failed のままコミット一覧を表示し、prompt version を更新したリリース後の Cron で古い ready / failed 要約を新しい version に限って再投入します。

### Cloudflare 公式リファレンス

- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Cloudflare Queues](https://developers.cloudflare.com/queues/configuration/configure-queues/)
- [Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

## データモデル（案）

### repositories

- GitHub repository ID
- owner / name
- visibility
- URL
- default branch
- archived / fork
- last synced at

### commits

- repository ID
- commit OID / abbreviated SHA
- message headline / body（body の保存は任意）
- committed at
- author GitHub user ID
- URL
- is merge commit

### change_records

- scope (`public` / `all`)
- period type (`daily` / `weekly` / `monthly`)
- period start / end
- repository ID
- commit count
- first / last committed at
- summary text
- source fingerprint
- model / prompt version
- generated at / status / error

`scope`、`period type`、`period start`、`repository ID` の組み合わせを一意にします。元コミットとの関連を保持し、1期間・1リポジトリの複数コミットを1つの変更レコードとして返します。

GitHub コミットログ URL は永続化せず、owner、repository、period start / end から API レスポンス生成時に組み立てます。

### sessions / accounts

認証ライブラリの標準モデルに従い、GitHub user ID とセッションを保持します。アクセストークンを永続化する場合は暗号化します。

## API（案）

```text
GET  /api/public/periods/:period/:date
GET  /api/public/latest-daily
GET  /api/public/repositories
GET  /api/public/repositories/:repo/periods/:period/:date

GET  /api/all/periods/:period/:date
GET  /api/all/repositories
GET  /api/all/repositories/:repo/periods/:period/:date

POST /api/internal/sync
POST /api/internal/summaries/generate
POST /api/webhooks/github
```

`all` と internal API は認証または署名検証が必須です。API はリポジトリごとに集約された変更レコード配列と、次ページの cursor を返します。各変更レコードには AI 要約の状態、元コミット配列、期間指定済みの GitHub コミットログ URL を含めます。

## 非機能要件

- public ページはキャッシュを利用し、通常アクセスで高速に表示できること
- all ページから private 情報が CDN、アクセスログ、エラー追跡、分析ツールへ漏れないこと
- 同期と要約生成は再実行しても結果が壊れないこと
- GitHub API の rate limit と AI API の失敗に対して retry/backoff を行うこと
- キーボード操作、十分なコントラスト、見出し構造など基本的なアクセシビリティを満たすこと
- モバイルとデスクトップの両方で日付・リポジトリ・コミットを読みやすいこと
- 日付計算はタイムゾーンと夏時間を考慮し、テストで境界値を確認すること

開発の進め方とマイルストーンは [PLAN.md](./PLAN.md) を参照してください。

## セキュリティ

脆弱性の報告方法と対象範囲は [SECURITY.md](./SECURITY.md) を参照してください。public issue ではなく GitHub の Private vulnerability reporting からご報告ください。

## ライセンス

[MIT License](./LICENSE) で公開しています。
