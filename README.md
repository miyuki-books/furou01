# furou01 — 自律AI社員の90日実験

AI社員が90日間、**計画外の人間介入なしに**「観測 → 仮説 → 変更 → 再観測」を回し続けられるかを検証する。

売上は主目的ではない。アフィリエイト報酬が1件でも自動発生すればボーナス判定として達成、
という位置づけになっている。理由は [docs/DESIGN.md](docs/DESIGN.md) にある。

## 最初に読む順序

| ファイル | 誰が読むか | 内容 |
|---|---|---|
| [SETUP.md](SETUP.md) | **人間（最初にここ）** | 初期セットアップの手順。2〜3時間 |
| [CLAUDE.md](CLAUDE.md) | AI社員 | 職務規程。何を書き、何をしてはいけないか |
| [docs/DESIGN.md](docs/DESIGN.md) | 人間 | なぜそう決めたか。確認済みの事実と残るリスク |

## 動き方

```
毎日 07:00 JST   日次ジョブ（Haiku）
  記事を1本書く → ガードレール → サイト生成 → GitHub Pages → X へ自動投稿

毎週土 07:00 JST 週次ジョブ（Sonnet）
  クリック統計を読む → 判断を1つ下す → decisions.jsonl へ追記
  → note投稿キットを生成 → Slack へ週次サマリ

人間             週1回、note投稿キットを開いてボタン3つ（2分）
```

## 構成

```
CLAUDE.md              AI社員の職務規程
SETUP.md               人間のセットアップ手順
prompts/               日次・週次の指示書
content/               記事の Markdown
site/                  生成物（gitignore、Actions が生成）
scripts/
  check.mjs            ガードレール。違反は exit 1 で公開をブロック
  build.mjs            content/*.md → site/
  note-kit.mjs         note投稿キット（コピー2回・クリック1回）を生成
  post-x.mjs           X 公式API へ投稿（OAuth 1.0a）
  notify.mjs           Slack Incoming Webhook へ通知
  discard.mjs          通せなかった下書きを理由付きで破棄
worker/                Cloudflare Workers のクリック計測リダイレクタ
state/
  config.json          操作変数と閾値
  links.json           アフィリエイトリンクの定義
  decisions.jsonl      1行1決定。実験の本当の成果物
  health.json          連続失敗・停止フラグ・破棄記録
```

## コマンド

```bash
npm run check     # ガードレール（公開前に必ず通す）
npm run build     # content/*.md → site/
npm run note-kit  # note投稿キットを生成
```

## 設計上の要点

**ガードレールはプロンプトではなくコードで強制する。** プロンプトの指示は確率的に破られる。
PR表記の欠落は景品表示法第5条第3号の直撃なので、「AIが忘れないこと」に賭けていない。

**クリック計測は自前で持つ。** GA4 も楽天のレポート画面も認証が必要で、無人のAI社員は数字を取れない。
自前リダイレクタの `/stats.json` が無いと、自己改善ループは閉じない。

**自律を意図的に切る場所がある。** Amazon アソシエイトの登録判断、ジャンル追加、凍結後の復旧。
目的関数を「利益」だけにすると、規約違反やスパムが最短経路になるため。

**撤退条件を設計に埋めてある。** `startedAt` から90日、または連続3回の失敗で自動停止する。
「安定して利益が出るまで動き続ける」は、裏返すと永久に赤字を垂れ流す条件になり得る。
