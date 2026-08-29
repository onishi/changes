# Security Policy

## 報告方法

脆弱性を見つけた場合は、**public issue を作成せず**、GitHub の Private
vulnerability reporting からご報告ください。

1. このリポジトリの [Security](https://github.com/onishi/changes/security) タブを開く
2. **Report a vulnerability** を選択する

報告内容は修正されるまで非公開のまま扱われます。public issue に詳細が書かれると、
修正前に攻撃手法が公開されてしまうため避けてください。

## 対象範囲

| 対象                                                   | 範囲   |
| ------------------------------------------------------ | ------ |
| このリポジトリのコード                                 | 対象   |
| `https://changes.wagaya.org`                           | 対象   |
| 依存パッケージの脆弱性（このアプリでの悪用経路を伴う） | 対象   |
| 依存パッケージ自体の問題（上流へ報告すべきもの）       | 対象外 |
| GitHub、Cloudflare など基盤サービス自体の問題          | 対象外 |

特に関心があるのは、このアプリの中心的なセキュリティ境界に関わる問題です。

- 未認証の状態で private リポジトリの存在・名称・コミット・要約・件数が推測できる
- allowlist 外の GitHub ユーザーが `/all` にアクセスできる
- `/all` のレスポンスが CDN やブラウザの共有キャッシュに保存される
- セッションや OAuth state の偽造・固定化・漏えい

## 調査時のお願い

- 自分のアカウントの範囲で検証してください
- サービス拒否を引き起こす負荷試験は行わないでください
- 他者のデータへアクセスできることが分かった場合、内容の取得は最小限にとどめ、
  ただちに報告してください

## 対応について

個人プロジェクトのため、専任の担当者や SLA はありません。ベストエフォートでの対応
となりますが、報告は歓迎します。金銭的な報奨金は用意していません。

- 受領の連絡: 1週間以内を目安
- 修正: 深刻度に応じて対応し、進捗を報告スレッドでお伝えします

---

# Security Policy (English)

## Reporting

Please report vulnerabilities through GitHub's Private vulnerability
reporting rather than opening a public issue: go to the
[Security](https://github.com/onishi/changes/security) tab and choose
**Report a vulnerability**. Reports stay private until a fix ships.

## Scope

In scope: the code in this repository, the deployed site at
`https://changes.wagaya.org`, and dependency vulnerabilities that are
exploitable through this application. Out of scope: issues in dependencies
themselves that belong upstream, and issues in GitHub or Cloudflare.

Findings that touch this application's core security boundary are of
particular interest:

- Inferring the existence, name, commits, summaries, or counts of a private
  repository without authenticating
- Reaching `/all` as a GitHub user outside the allowlist
- `/all` responses being stored in a CDN or shared browser cache
- Forging, fixating, or leaking a session or OAuth state

## Testing

Please stay within your own account, avoid denial-of-service testing, and if
you find you can reach someone else's data, access the minimum needed to
demonstrate it and report it right away.

## Response

This is a personal project with no dedicated security team, no SLA, and no
bug bounty. Reports are handled on a best-effort basis: expect an
acknowledgement within about a week, and a fix prioritized by severity.
