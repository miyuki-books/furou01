あなたは今、GitHub Actions 上で無人実行されています。人間はいません。
職務規程（CLAUDE.md）に従って、今日の作業を最後までやり切ってください。

## 手順

### 1. 停止条件を先に確認する

`state/health.json` と `state/config.json` を読み、以下のいずれかに該当したら
**記事を書かずに** `node scripts/notify.mjs "..."` で理由を報告し、
`state/health.json` の `halted` を true にして正常終了してください。

- `halted` が既に true
- `consecutiveFailures` が3以上
- `startedAt` が **null 以外**で、そこから `experimentDays` 日が経過している
  （`startedAt` が null ならセットアップ中なので、**停止せず通常どおり進めてください**）
- 同じ記事が `blockedArticles` で3回以上ブロックされている

### 2. 観測する

`state/config.json` の `links.redirectorBase` が REPLACE-ME でなければ、
`<redirectorBase>/stats.json` を WebFetch して読んでください。
数字は今日の判断材料にするだけで、**変数の変更は週次ジョブの仕事です。今日は変えません。**

REPLACE-ME のままなら未セットアップなので、観測は飛ばして次へ進んでください。

### 3. 今日の1本を決める

**この実行の成果物は「新しい記事1本」です。既に記事が存在することは、今日書かない理由になりません。**
`content/` にあるのは過去の資産であって、今日の成果ではありません。
同じ日付の記事が既にあっても構いません。slug を変えて**必ず新しく1本書いてください。**

`state/config.json` の `operatingVariables.themeStrategy.current` に従ってテーマを決めます。
`content/` の既存記事を確認するのは、**同じ本の組み合わせを繰り返さないため**であって、
書くかどうかを判断するためではありません。

ジャンル外枠は技術書・ビジネス書です。これは変更できません。

### 4. 書く

`content/YYYY-MM-DD-<slug>.md` を作ります。frontmatter は既存記事に合わせてください。

守ること（詳細は CLAUDE.md 3.）:

- **選書ガイド / 比較記事**の型で書く。書評ではない。あなたは本を読んでいない
- 一次体験を騙らない。公開情報（目次、著者情報、版元の紹介文、書誌情報）に基づいて書く
- 書誌情報が確認できない本は扱わない。**WebSearch で著者名・書名・版を確認すること**
- 曖昧なら書かない。埋めるために推測で書くのは、指標3（事実誤認による削除率）を直接悪化させる
- タイトルは `operatingVariables.titlePattern.current` の型に従う
- アフィリエイトリンクを入れるなら `[書名](/go/<キー>)` の形にし、
  `state/links.json` に同じキーで楽天のURLを追加する
- リンクを入れたら PR 表記を必ず入れる

### 5. 検証する

```bash
npm run check
```

落ちたら**表現を直して**通してください。チェックの条件を緩めることは禁止です。

3回直しても通らなければ、`state/health.json` の `blockedArticles` にファイル名と回数を記録し、
下書きを破棄して報告し、終了してください。

```bash
node scripts/discard.mjs content/YYYY-MM-DD-<slug>.md "3回直しても check を通せなかった: <落ちたルール>"
node scripts/notify.mjs "本日は記事を出せませんでした: <理由>"
```

**通らない記事を無理に出すより、今日1本落とすほうが安い。**

### 6. X の投稿文を用意する

**`outbox/x/next.txt`** に1行で書きます。ファイル名は固定です（日付を入れないこと。
ジョブは UTC、あなたの感覚は JST になりがちで、日付を挟むと確実にズレます）。

投稿はワークフローが行い、投稿後に `outbox/x/posted-*.txt` へ退避します。あなたは書くだけです。

- 記事URLは `<siteBase>/<slug>.html`
- 記事の要点を、宣伝文句ではなく**その記事が誰の役に立つか**が分かる形で書く
- アフィリエイトリンクは貼らない
- 「いかがでしたか」等の定型句を使わない
- URL込みで280文字換算に収める（URLは23文字として数える）

### 7. 記録する

`state/health.json` を更新します。`lastSuccessfulRun` を今日の日付に、
`consecutiveFailures` を0に、`lastRunStatus` を "ok" にしてください。

## やってはいけないこと

- Amazon アソシエイトの登録判断
- ジャンルの追加・変更
- `state/config.json` の `operatingVariables` の変更（週次ジョブの仕事）
- 凍結されたアカウントの作り直し
- ブラウザ自動操作による外部サービスへの投稿
- `scripts/check.mjs` の条件を緩めること

判断に詰まったら、勝手に進めず `node scripts/notify.mjs` で報告して終了してください。
**止まることは失敗ではありません。間違ったものを出すことが失敗です。**
