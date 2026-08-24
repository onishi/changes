# Development Plan

## 方針

最初に public / all のデータ境界を確立し、その上に期間別表示、同期、AI 要約を順に追加します。private データの漏えいを防ぐ仕組みを後付けにしないことを最優先とします。

## 採用構成

本番環境は Cloudflare 上に構築し、`https://changes.wagaya.org` へデプロイします。

- Frontend / Backend: TypeScript + React ベースの Cloudflare Workers 対応 framework
- Runtime: Cloudflare Workers
- Frontend assets: Workers Static Assets
- Database: Cloudflare D1
- Authentication: GitHub 認証 + GitHub user ID allowlist
- GitHub integration: GitHub App を第一候補とし、repository contents の read-only 権限でコミット情報を取得
- Scheduler: Cloudflare Cron Triggers（UTC）
- Background jobs: Cloudflare Queues + dead-letter queue
- AI: Workers AI を第一候補とし、provider を交換できる薄い adapter を維持
- Secrets: Cloudflare Workers Secrets
- Observability: Workers Observability
- Test: unit / integration / browser E2E
- Deployment: Workers Builds または GitHub Actions + Wrangler
- Production domain: Worker Custom Domain `changes.wagaya.org`

preview と production の Worker、D1、Queue、Secrets は分離します。AI provider と GitHub client はアプリ本体から interface で分離します。

## 現在の進捗（2026-08-24）

- React + Hono + Cloudflare Workers Static Assets のアプリ基盤を実装済み
- D1 migration、GitHub App 同期、日・週・月の変更レコード集約、public / all API を実装済み
- GitHub OAuth + 数値 user ID allowlist、HMAC 化した session、server-side guard を実装済み
- Workers AI の JSON Mode サマリと Queue retry / dead-letter Queue を実装済み
- 日付別 / リポジトリ別 UI、期間ページャ、50件 cursor、GitHub 期間ログリンクを実装済み
- Workers runtime 上の unit / integration test 25件と GitHub Actions CI を追加済み
- Cloudflare 本番 D1 `changes-production`、Queue `changes-jobs`、DLQ `changes-jobs-dlq` を作成し、初期 migration を適用済み
- GitHub App を owner `onishi` にインストールし、Contents read-only で public 44件 / private 33件の取得を確認済み
- Worker、Static Assets、D1、Queues、Workers AI、Cron を `https://changes.wagaya.org` へ本番デプロイ済み
- 初回同期で 1,935 commits、641 change records を作成し、AI 要約は 641件すべて ready であることを確認済み
- JSON が途中で切れた AI 要約1件を prompt version 更新時の自動再投入で回復し、古い成功済み要約を再生成しないことを本番確認済み
- GitHub API の rate-limit snapshot と制限到達を、private リポジトリ名や token を含めない構造化ログで確認可能
- 残件は実 rate-limit 残量 / 初回同期完了時間の計測、認証後の `/all` を含む browser E2E、運用 runbook の整備

## マイルストーン

### Phase 0: 技術選定とデータ境界の検証

目的: 実装前に GitHub から必要なデータを安全かつ現実的な API コストで取得できることを確認する。

- [x] 対象とする単一 GitHub owner、default branch、同期対象外条件を確定する
- [x] 1つの GitHub App を installation token と user authorization の両方に使う方式を決める
- [x] public/private を含むテスト用リポジトリで必要権限を検証する
- [x] REST API で repository、commit、author、visibility を取得する client を作る
- [ ] rate limit と初回同期時間を計測する
- [x] `wagaya.org` が対象 Cloudflare account の active zone であることを確認する
- [x] `changes.wagaya.org` に競合する DNS record、Custom Domain、Worker route がないことを確認する
- [ ] Workers AI の日本語要約品質とコストを検証し、初期 AI provider を確定する
- [ ] タイムゾーン、同期対象期間、fork/archive の扱いを設定値として確定する（週は日曜日始まりに固定）
- [ ] private メタデータを外部 AI へ送信する運用について確認する

完了条件:

- 必要な API 権限、概算 API コール数、同期方法が文書化されている
- 同期対象が設定された単一 owner 配下だけであることを検証できている
- `Asia/Tokyo`、日曜日始まりの週境界、default branch を共通設定として固定できている
- `changes.wagaya.org` を Worker Custom Domain として利用できる
- private リポジトリを public レスポンスへ含めない query 方針が決まっている
- Cloudflare resource 構成とローカル開発手順が決まっている

### Phase 1: アプリケーション基盤

目的: deploy 可能な最小構成と、継続的に品質を確認できる基盤を用意する。

- [x] TypeScript project、formatter、linter、typecheck をセットアップする
- [x] Cloudflare Workers 対応の React project と Workers Static Assets をセットアップする
- [ ] `wrangler.jsonc` に production / preview の bindings と環境差分を定義する
- [x] 環境変数の schema validation と `.dev.vars.example` を用意する
- [ ] production / preview 用 D1 database と migration 手順を用意する
- [ ] production / preview 用 Queue と dead-letter queue を用意する
- [x] Cron Trigger の `scheduled()` handler を用意する
- [x] Queue の producer / consumer handler を用意する
- [x] GitHub App user authorization、installation、session の必須 secret 名を定義する
- [x] `wrangler types` で binding の TypeScript 型を生成する
- [x] test runner と CI をセットアップする
- [ ] Workers Builds または GitHub Actions + Wrangler で preview / production pipeline を用意する
- [x] health check、構造化ログ、Workers Observability の基盤を追加する
- [x] ログを event / ID / status 中心に限定し、token・secret・本文を出力しない

完了条件:

- 空のアプリを `wrangler dev`、CI、preview Worker で起動できる
- D1 migration、lint、typecheck、test、Worker build が CI で成功する
- scheduled handler と Queue consumer をローカルまたは preview で実行できる

### Phase 2: 認証・認可と公開範囲

目的: private データを扱う前に public / all のアクセス境界を完成させる。

- [x] GitHub sign-in / sign-out を実装する
- [x] 許可する GitHub user ID の allowlist を実装する
- [x] `/all` と `/api/all/*` に server-side guard を追加する
- [x] 未認証・未許可・期限切れの挙動を定義する
- [x] all ページへ `noindex` と `private, no-store` を設定する
- [x] public / all 用 query と変更レコードを scope で分離する
- [x] private repository を指定した public URL が `404` になることをテストする
- [x] public API に private の識別情報がないことを integration test で検証する

完了条件:

- 未認証では public API だけにアクセスできる
- 許可された GitHub user ID だけが all API にアクセスできる
- private 情報の混入を検出する integration test がある

### Phase 3: GitHub 同期とデータモデル

目的: GitHub のコミット履歴を再現可能かつ差分更新可能な形で保存する。

- [x] `repositories`、`commits`、`change_records`、`sync_runs` の migration を作る
- [x] GitHub client と rate-limit handling を実装する
- [x] リポジトリ一覧の同期を実装する
- [x] default branch のコミット初回同期を実装する
- [x] repository ID + commit OID による upsert / deduplication を実装する
- [x] 差分同期と overlap window を実装する
- [x] visibility 変更、rename、archive、削除を repository metadata と query に反映する
- [x] Queue retry/backoff と dead-letter Queue を実装する
- [x] 30分間隔の Cron Trigger を設定する
- [ ] 必要であれば GitHub Webhook と署名検証を追加する
- [x] 最終成功時刻、同期状態、rate-limit を運用画面またはログで確認可能にする

完了条件:

- 同じ同期を再実行しても重複コミットが作られない
- 新規コミットと visibility 変更が次回同期で反映される
- GitHub API の一時失敗後に同期を再開できる

### Phase 4: changelog API

目的: UI に依存せず、期間別・リポジトリ別に安定したデータを取得できるようにする。

- [x] daily / weekly / monthly の期間計算 utility を実装する
- [x] `Asia/Tokyo` と UTC の境界値テストを追加する
- [x] 期間種別 × 対象期間 × repository ごとにコミットを1変更レコードへ集約する
- [x] 同じリポジトリ・期間の複数コミットを重複なく関連付ける
- [x] 期間境界を UTC の `since` / `until` に変換し、owner と期間で絞った GitHub コミットログ URL を生成する
- [x] public / all の期間 API を実装する
- [x] public / all のリポジトリ一覧 API を実装する
- [x] リポジトリ別期間 API を実装する
- [x] 変更レコード単位の安定した cursor pagination を実装する
- [x] 不正な日付、未来の日付、不正な cursor の validation を実装する
- [x] repository alias を保存し、rename 前の URL を canonical name へ置き換える
- [ ] API response schema とエラー形式を固定する

完了条件:

- 3つの期間粒度 × 2つの公開範囲 × 2つのビューを API で取得できる
- 同一期間・同一リポジトリの複数コミットが1変更レコードにまとまる
- ページを送っても変更レコードの欠落・重複・順序の揺れがない
- 各変更レコードが正しい `author`、`since`、`until` を持つ GitHub コミットログ URL を返す
- public query が DB レベルで private row を除外している
- public API が private リポジトリのコミットログ URL を返さない

### Phase 5: Web UI

目的: 日付とリポジトリの2つの軸で活動を快適に閲覧できるようにする。

- [x] 共通レイアウトとレスポンシブ navigation を作る
- [x] Public / All のモード表示と切り替えを作る
- [x] Daily / Weekly / Monthly の切り替えを作る
- [x] 日付 picker と repository selector を作る
- [x] 期間ページの stats と repository ごとの変更レコード一覧を作る
- [x] 変更レコード内に AI summary、commit count、元 commit list を表示する
- [x] 各変更レコードに「GitHub でコミットログを見る」外部リンクを表示する
- [x] repository ページを作る
- [x] 前後期間ページャを作る
- [x] 変更レコードの cursor pager を作る
- [x] loading / empty / stale / syncing / error / unauthorized 状態を作る
- [x] GitHub commit / repository への外部リンクを追加する
- [ ] keyboard、focus、screen reader、contrast を確認する
- [ ] mobile / desktop の browser E2E を追加する

完了条件:

- README に定義した主要 URL を直接開ける
- URL を共有・再読み込みしても選択期間とリポジトリが維持される
- 各変更レコードから対象期間の GitHub コミットログを開ける
- 活動なし、同期遅延、認証切れを画面上で判別できる

### Phase 6: AI 要約

目的: private 境界を維持したまま、コミット群を読みやすい changelog に変換する。

- [x] `change_records` の summary fields と source fingerprint を実装する
- [x] Workers AI JSON Mode と Zod の structured output schema を作る
- [x] public / all で別の change record ID と fingerprint を使用する
- [x] 期間種別 × repository の変更レコード要約 prompt を version 管理する
- [ ] 長い期間を chunk → reduce する処理を実装する
- [x] commit 集合が変わった daily / weekly / monthly の変更レコードだけ invalidation する
- [x] Queue による非同期生成、進行状態、retry/backoff を実装する
- [x] prompt version 更新時に古い failed 要約だけを再投入し、投入失敗時は状態を復元する
- [ ] rate limit、token budget、月次コスト上限を設定する
- [x] prompt injection を想定し、commit message を命令ではなくデータとして扱う
- [ ] hallucination、private 混入、空期間、日本語品質の fixture test を追加する
- [x] provider 障害時の fallback UI を実装する

完了条件:

- AI が失敗・停止していてもコミット一覧を利用できる
- 同じ入力から不要な再生成が発生しない
- public 要約の生成入力・出力に private 情報が含まれないことをテストできる

### Phase 7: セキュリティ・性能・リリース

目的: 実データを安全に扱い、継続運用できる状態で初回リリースする。

- [ ] threat model とデータフロー図をレビューする
- [ ] OAuth state / CSRF、session fixation、open redirect を確認する
- [ ] secret rotation と access revocation の手順を作る
- [ ] dependency / secret scan を CI に追加する
- [ ] public response の cache key と invalidation を確認する
- [ ] all response が CDN/ブラウザ共有 cache に保存されないことを確認する
- [ ] DB index と期間 query を計測・調整する
- [ ] GitHub/AI API の障害訓練を行う
- [ ] backup / restore とデータ削除手順を用意する
- [ ] privacy notice と運用 runbook を用意する
- [ ] リリース判定チェックリストに基づく acceptance test を実行する

完了条件:

- この文書のリリース判定チェックリストが production 相当環境で確認済み
- private data leak の自動テストと手動チェックが完了済み
- 同期、要約、認証の障害対応手順がある

## テスト戦略

### Unit test

- daily / weekly / monthly の開始・終了日時
- 日曜日 00:00 から土曜日 23:59:59 までの weekly 境界
- タイムゾーン、月末、年末、うるう年、夏時間
- daily / weekly / monthly の期間境界から生成する GitHub `since` / `until` query
- cursor の encode/decode と安定ソート
- 同一期間・同一 repository の複数 commit の集約
- source fingerprint と要約 invalidation
- GitHub API response の normalization

### Integration test

- public query が public repository の commit だけを返す
- all query が認証・allowlist を要求する
- 同じ日の同じ repository に複数 commit があっても1変更レコードを返す
- 同じ期間でも repository が異なれば別の変更レコードを返す
- 同じ commit が daily / weekly / monthly の各対象レコードへ正しく関連付く
- repository の visibility 変更後に public データと要約が消える
- sync の再実行で重複しない
- rate limit / timeout / partial failure から回復する
- private repository の slug を public API へ渡しても存在が分からない
- private repository のコミットログ URL が public HTML/API に含まれない

### E2E test

- 未認証で public の daily / weekly / monthly を閲覧する
- GitHub 認証後に all を閲覧し、sign-out 後にアクセスできなくなる
- 日付ビューとリポジトリビューを往復する
- 前後期間と変更レコード cursor のページャを操作する
- 変更レコードから期間指定済みの GitHub コミットログを開く
- empty / stale / AI error の各状態を確認する
- private の名前やコミット文言が public HTML に存在しないことを確認する

## 初期リリースの優先順位

### Must

- public / all の分離
- GitHub 認証と allowlist
- GitHub の差分同期
- daily / weekly / monthly
- 日付別 / リポジトリ別ビュー
- 期間種別 × 対象期間 × repository の変更レコード集約
- 期間ページャ / 変更レコード cursor pagination
- 期間と owner で絞り込んだ GitHub コミットログリンク
- AI 要約と失敗時 fallback
- private leak を防ぐ自動テスト

### Should

- GitHub Webhook
- stale data の表示
- AI コスト上限と利用量の可視化
- repository rename の redirect
- 基本的な運用 dashboard

### Later

- issue / pull request / release の統合
- 複数ユーザー対応
- 要約の再編集・公開承認 workflow
- RSS / Atom feed
- 検索とタグ

## 主なリスクと対策

| リスク                                          | 対策                                                                                               |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| private 情報が public に混ざる                  | data-access 層、要約、cache namespace を scope ごとに分離し、canary private fixture で自動検査する |
| GitHub API rate limit                           | 差分同期、ETag/conditional request、backoff、最終成功データの継続表示を行う                        |
| force-push や visibility 変更でデータが古くなる | overlap を持つ定期再同期と、定期的な repository metadata 再検証を行う                              |
| AI が事実と異なる内容を生成する                 | 入力限定、structured output、元コミットへの導線、fixture 評価を用意する                            |
| AI コストが増える                               | fingerprint cache、非同期生成、chunk 上限、予算上限を設ける                                        |
| 日付集計がずれる                                | UTC 保存、表示時の設定タイムゾーン変換、境界値テストを徹底する                                     |
| commit author の判定を誤る                      | GitHub user ID を優先し、関連付け不能な commit の扱いを明示する                                    |

## リリース判定チェックリスト

- [ ] 未認証状態で private repository の存在・件数・名称・commit・要約を推測できない
- [ ] `/all` の HTML/API に `no-store` が付き、検索 index の対象外である
- [ ] allowlist 外の GitHub ユーザーが all にアクセスできない
- [ ] 3つの期間粒度と2つのビューが直接 URL から開ける
- [ ] 同一期間・同一リポジトリの複数コミットが1変更レコードにまとまる
- [ ] daily / weekly / monthly の GitHub コミットログリンクに正しい `author`、`since`、`until` が付く
- [ ] 前後期間と50件超の変更レコード pagination が正しく動く
- [ ] 同期の再実行、途中失敗、rate limit から回復できる
- [ ] AI 停止中でも changelog を閲覧できる
- [ ] mobile / desktop の主要導線が E2E test を通過する
- [ ] backup、secret rotation、権限取り消し、障害対応の手順が確認済み
