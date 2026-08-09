# セットアップ手順

**これは人間がやる作業です。**ここを終えると、以降は AI社員が無人で回ります。

所要時間の目安は2〜3時間。①〜⑤まで終われば記事の自動生成は動き出します。
⑥以降（楽天・X）は後から足せるので、まず動かすことを優先して構いません。

各手順の末尾に、なぜそれが要るのかを書いています。飛ばした場合に何が壊れるかの判断に使ってください。

---

## ① ハンドルネームと専用メールアドレス

- 本業と結びつかないハンドルネームを決める
- そのハンドル用のメールアドレスを新規に取得する（Gmail等）

以降のアカウントは全部これで作ります。

> **なぜ**：SNS運用の自動化はアカウント凍結リスクが常にあり、本業の看板と紐づけると
> 炎上時に延焼します。ただしこれは「表示名の分離」であって「主体の匿名化」ではありません。
> ASP登録・受取口座・確定申告は運営者本人のままです（匿名の事業主体は作れません）。

---

## ② GitHub リポジトリを作って push する

```bash
git init
git add -A
git commit -m "init: 自律AI社員 実験計画 v2"
git branch -M main
git remote add origin https://github.com/<ユーザー名>/furou01.git
git push -u origin main
```

**public にしてください。**GitHub Free では private リポジトリで Pages が使えず、
private で Pages を使うには GitHub Pro（$4/月）が必要になります。追加課金ゼロの原則に反するので public を選びます。

public にする以上、リポジトリの中身は誰でも読めます。**身元に繋がる記述を入れないでください。**
`.gitignore` で `.claude/settings.local.json` を除外済みです（ローカルのユーザー名を含むため）。

---

## ③ GitHub Pages を有効化する

リポジトリの Settings → Pages → Build and deployment → Source を **GitHub Actions** にする。

そのあと、発行される URL（`https://<ユーザー名>.github.io/furou01`）を控えます。

---

## ④ Claude Code の認証トークンを発行する

**手元のPC**で実行します。

```bash
claude setup-token
```

ブラウザが開くので承認すると、ターミナルにトークンが出ます。**どこにも保存されないのでその場でコピー**してください。

これを GitHub の Settings → Secrets and variables → Actions → New repository secret に登録します。

| Name | Value |
|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | 出力されたトークン |

> **なぜ**：これが Team プランのサブスクで無人実行するための公式な方法です。
> 有効期間は1年、APIクレジットは不要です。
> **このトークンでは claude.ai のコネクタ（Slack コネクタ、Chrome 操作）が使えません。**
> だから Slack は次の手順の Webhook を使います。

---

## ⑤ Slack の通知先を作る

1. 通知用の **private チャンネル**を1つ作る（例：`#ai-lab-01`。本業のチャンネルには混ぜない）
2. https://api.slack.com/apps → **Create New App**
3. 「Create new app」ダイアログで **Blank app** を選ぶ（旧「From scratch」。
   上段の AI agent / Starter app はテンプレート入りで、不要な機能とスコープが付いてくる）→ Continue
4. App Name（例：`furou01-notify`）とワークスペースを選んで **Create App**
5. 左メニュー **Incoming Webhooks** → 右上のトグルを **On**
6. ページ最下部の **Add New Webhook to Workspace** → 1. のチャンネルを選んで許可
7. 発行された `https://hooks.slack.com/services/...` をコピー

GitHub Secrets に登録します。**トークン類は本人が入力し、他者に渡さないこと。**

```bash
gh secret set SLACK_WEBHOOK_URL --repo <ユーザー名>/furou01
```

> ワークスペースの設定でアプリのインストールに管理者承認が要る場合があります。
> 承認を待つのが面倒なら、この実験専用の無料ワークスペースを新規に作るほうが早く、
> 本業とも完全に分離できます。

> **注意**：このURLを知っている人は誰でもそのチャンネルに投稿できます。実質パスワードとして扱ってください。
> Slack アプリの作成はワークスペースの管理設定に触れるので、承認が必要な場合があります。

**ここまでで、記事の自動生成とサイト公開は動きます。**一度 ⑩ の動作確認に進んで、
動くことを確かめてから ⑥ 以降に戻るのがおすすめです。

---

## ⑥ Cloudflare Workers でクリック計測を立てる

```bash
cd worker
npx wrangler login
npx wrangler kv namespace create CLICKS
```

出力された `id` を `worker/wrangler.toml` の `[[kv_namespaces]]` に貼り、
`SITE_BASE` を ③ で控えた GitHub Pages のURLに書き換えます。

```bash
npx wrangler deploy
```

初回は workers.dev サブドメインの登録を求められます。ダッシュボードで最初の Worker を作ると
自動で割り当てられるので、それを済ませてから deploy し直してください。

発行された `https://furou01-go.<サブドメイン>.workers.dev` を控えます。

デプロイ後、3つとも応答することを確認してください。

```bash
node -e "['health','stats.json','go/nonexistent'].forEach(p=>fetch('https://<worker>/'+p,{redirect:'manual'}).then(r=>console.log(p,r.status)))"
```

`/health` が 200、`/stats.json` が 200、`/go/nonexistent` が 404 なら正常です。
新しい Worker は DNS の伝播に数分かかることがあるので、繋がらなければ少し待って再試行してください。

> **なぜ**：**これが無いと自己改善ループが閉じません。**
> GA4 も楽天のレポート画面も認証が必要で、無人の AI社員は自力で数字を取れません。
> 自前のリダイレクタを噛ませて `/stats.json` を認証なしで読めるようにすることで、
> 初めて「観測 → 仮説 → 変更 → 再観測」が成立します。

---

## ⑦ 楽天アフィリエイトに登録し、サイトを登録する

1. 楽天会員でログインし、楽天アフィリエイトのパートナー登録をする
2. **掲載サイトを登録する**：https://affiliate.rakuten.co.jp/user/sites/
   に ③ の GitHub Pages のURLを登録

> **なぜ**：楽天の公式ガイドラインで、**未登録サイトへの掲載は禁止**されています。
> HTTPS未対応サイトも掲載禁止ですが、GitHub Pages は HTTPS 標準なので問題ありません。
>
> なお楽天の「自動ツール」規制の対象は**メール・LINE・SNSのDM**への掲載です。
> 本設計は自サイト掲載と公開投稿のみなので、この条項には触れません。
> AI生成コンテンツに関する明文の記載はありません（禁止されていないだけで、黙認の保証ではありません）。

3. サイト情報の「ジャンル」欄も埋める。未登録・虚偽・漏れは利用停止の理由として明記されている

> **楽天アカウントは新規に作らないこと。** 楽天会員規約 第8条の禁止行為に
> 「複数のアカウントを作成しまたは保有する行為」が挙げられています。既存アカウントを使います。
> これは「表示名の分離」であって「主体の匿名化」ではない、という設計（A9）と整合します。

### ⑦-2 アフィリエイトIDを取得する

**これが無いと、AI社員はアフィリエイトリンクを自力で作れません。**
手作業でリンクを貼るなら毎日人間の作業が発生し、「人間の手間ほぼゼロ」が崩れます。

1. 楽天アフィリエイトのページ上部「**URLを入力してリンクを作成**」に、任意の楽天ブックスURLを入れてリンクを1本作る
2. 生成された `https://hb.afl.rakuten.co.jp/hgc/<ここ>/?pc=...` の **`<ここ>`** の部分がアフィリエイトID
3. `state/config.json` の `links.rakutenAffiliateId` に設定する

> **楽天ウェブサービス（webservice.rakuten.co.jp）は使いません。**
> 2026年の仕様変更で Referer が必須になり、サーバーからの呼び出しは
> `403 REQUEST_CONTEXT_BODY_HTTP_REFERRER_MISSING` で弾かれます。
> Referer を偽装すれば通りますが、それはアクセス制御の回避なので行いません。
>
> **管理画面に表示される「Affiliate ID」は、実際のリンクに使われるIDと別物です。**
> 必ず「URLを入力してリンクを作成」が生成した実物から取ってください。
> 推測で組み立てると、報酬が計上されないリンクを量産します。
>
> このIDは公開記事のリンクに必ず含まれるため秘密情報ではありません。
> GitHub Secrets ではなく設定ファイルに置いています。

`npm run links` が、記事の frontmatter にある ISBN からリンクを組み立て、
書名は openBD から取って `state/links.json` を更新します。
**AI社員はURLを組み立てません**（捏造の余地を作らないため）。

**Amazon アソシエイトはまだ登録しないでください。**
登録した瞬間に180日タイマーが走り、期間内に適格販売3件が無いとアカウントが閉じられます。
PVが立ってから判断します。

---

## ⑧ X の API キーを取得する（後回し可）

1. https://developer.x.com で開発者アカウントを作る（①のハンドルで）
2. アプリを作成し、**User authentication settings** で Read and write を有効にする
3. OAuth 1.0a のキー4つを取得する
4. 従量課金なので、プリペイドのチャージが必要です（$5 から。1投稿 $0.01）

GitHub Secrets に4つ登録します。

| Name | 対応するもの |
|---|---|
| `X_API_KEY` | API Key（Consumer Key） |
| `X_API_SECRET` | API Key Secret |
| `X_ACCESS_TOKEN` | Access Token |
| `X_ACCESS_SECRET` | Access Token Secret |

> **なぜ OAuth 1.0a か**：OAuth 2.0 のユーザーコンテキストはリフレッシュトークンの更新が必要で、
> 無人運用だと期限切れで静かに死にます。静的なキー4つで済む 1.0a のほうが90日の実験には向きます。

未設定でも日次ジョブは落ちません（投稿せず内容を出力するだけ）。

---

## ⑨ 設定ファイルの REPLACE-ME を置き換える

`state/config.json` を編集します。

```json
{
  "startedAt": "2026-08-16",
  "links": {
    "redirectorBase": "https://furou01-go.xxxx.workers.dev",
    "siteBase": "https://<ユーザー名>.github.io/furou01"
  }
}
```

`startedAt` を入れた日から90日で実験が自動的に止まります。**ここを空のままにしないでください。**
撤退条件が設計に埋まっていないと、赤字を垂れ流し続ける仕組みになります。

---

## ⑩ 動作確認

GitHub の Actions タブ → 「日次 記事生成」→ Run workflow で手動実行します。

確認すること：

- [ ] AI社員が `content/` に記事を1本作った
- [ ] `npm run check` が通った
- [ ] GitHub Pages にサイトが公開された
- [ ] Slack に通知が来た（失敗時のみ通知される設計なので、成功時は無音が正常）

週次も一度手で回してください。Actions → 「週次 振り返りとnote投稿キット」→ Run workflow。

- [ ] `state/decisions.jsonl` に1行増えた
- [ ] `outbox/note/*.html` が生成された
- [ ] Slack に週次サマリが来た

---

## 継続してやること

| 頻度 | 作業 | 所要 |
|---|---|---|
| 週1 | `outbox/note/*.html` を開いてボタン3つ（コピー2回、クリック1回） | 2分 |
| 月1 | `state/decisions.jsonl` を読む | 30分 |
| 閾値到達時 | ジャンル追加の承認（Slack に通知が来る） | — |
| 初入金時 | **法人 Team シート → 個人契約への移管** | — |
| 年1 | 確定申告（税務の取扱いは税理士にご確認ください） | — |

初入金が発生した日に契約を移管する、というトリガーだけは忘れないでください。
決めずに走ると、法人の設備で発生した個人の売上という整理されていない状態が残ります。

---

## 止まったときに見る場所

| 症状 | 見る場所 |
|---|---|
| 記事が作られない | Actions のログ、`state/health.json` の `halted` と `haltReason` |
| 3回連続で失敗して止まった | `consecutiveFailures` が3以上。原因を直して0に戻す |
| 記事がブロックされ続ける | `blockedArticles`。`npm run check` を手元で回すと理由が出る |
| クリックが0のまま | `<redirectorBase>/health` が応答するか、`state/links.json` にキーがあるか |

`halted` が true になったら、AI社員は**意図的に止まっています**。
エラーではないので、理由を読んでから再開してください。
