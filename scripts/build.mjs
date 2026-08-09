#!/usr/bin/env node
// content/*.md → site/ を生成する。
//
// 記事内の /go/:id リンクは、ここで Worker の絶対URLに書き換える。
// AI社員は記事中では常に /go/:id と書けばよい。

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import MarkdownIt from 'markdown-it'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const config = JSON.parse(readFileSync(join(ROOT, 'state/config.json'), 'utf8'))
const OUT = join(ROOT, 'site')

const md = new MarkdownIt({ html: false, linkify: true, typographer: false })

const SITE_NAME = '本の地図'
const SITE_TAGLINE = '目的から逆算して技術書・ビジネス書を選ぶ'

// ---------------------------------------------------------------- frontmatter

const unquote = (s) => s.replace(/^["']([\s\S]*)["']$/, '$1').trim()

function parseFrontmatter(input) {
  const raw = input.replace(/^﻿/, '')
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
  if (!m) return { meta: {}, body: raw }
  const meta = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/)
    if (!kv) continue
    let value = kv[2].trim()
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map((s) => unquote(s.trim()))
        .filter(Boolean)
    } else {
      // 引用符を外さないと slug が "foo" のままファイル名に入り、
      // Linux では引用符ごと通ってしまうため壊れたURLで公開される
      value = unquote(value)
    }
    meta[kv[1]] = value
  }
  return { meta, body: raw.slice(m[0].length) }
}

// ---------------------------------------------------------------- テンプレート

const CSS = `
:root {
  --bg: #fdfdfc; --fg: #1c1b19; --muted: #6b6862; --rule: #e3e0da; --link: #1f5f8b;
  --maxw: 42rem;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #161614; --fg: #e8e6e1; --muted: #9a968e; --rule: #33322e; --link: #7fb5d9; }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 2.5rem 1.25rem 5rem; background: var(--bg); color: var(--fg);
  font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", system-ui, sans-serif;
  line-height: 1.85; font-size: 1rem;
}
main, header, footer { max-width: var(--maxw); margin: 0 auto; }
header { border-bottom: 1px solid var(--rule); padding-bottom: 1.25rem; margin-bottom: 2.5rem; }
header a { text-decoration: none; color: var(--fg); }
.site-name { font-size: 1.1rem; font-weight: 700; letter-spacing: .02em; }
.tagline { color: var(--muted); font-size: .85rem; margin-top: .2rem; }
h1 { font-size: 1.6rem; line-height: 1.45; margin: 0 0 .4rem; }
h2 { font-size: 1.15rem; margin: 2.5rem 0 .75rem; padding-top: .25rem; }
time, .meta { color: var(--muted); font-size: .82rem; }
a { color: var(--link); }
p { margin: 1.15rem 0; }
hr { border: 0; border-top: 1px solid var(--rule); margin: 2.5rem 0; }
ul, ol { padding-left: 1.4rem; }
.index-list { list-style: none; padding: 0; }
.index-list li { padding: 1.1rem 0; border-bottom: 1px solid var(--rule); }
.index-list a { text-decoration: none; font-weight: 600; }
.index-list a:hover { text-decoration: underline; }
.pr { display: inline-block; font-size: .75rem; color: var(--muted);
      border: 1px solid var(--rule); border-radius: 3px; padding: .05rem .45rem; }
.books { margin-top: 3.5rem; border-top: 1px solid var(--rule); padding-top: 1.5rem; }
.books h2 { font-size: 1rem; margin: 0 0 1.25rem; }
.books ul { list-style: none; padding: 0; margin: 0; }
.books li { display: flex; gap: 1rem; align-items: flex-start;
            padding: 1.1rem 0; border-bottom: 1px solid var(--rule); }
.books li:last-child { border-bottom: 0; }
.books .cover { flex: 0 0 84px; }
.books .cover img { width: 84px; height: auto; display: block; border: 1px solid var(--rule); border-radius: 2px; }
.books .credit a { color: var(--muted); }
.books .body { flex: 1; min-width: 0; }
.books .bt { font-weight: 600; line-height: 1.5; }
.books .bm { color: var(--muted); font-size: .82rem; margin-top: .2rem; }
.books .buy { display: inline-block; margin-top: .6rem; font-size: .85rem;
              border: 1px solid var(--link); color: var(--link);
              border-radius: 5px; padding: .3rem .8rem; text-decoration: none; }
.books .buy:hover { background: var(--link); color: var(--bg); }
.books .credit { color: var(--muted); font-size: .75rem; margin-top: 1.5rem; }
footer { margin-top: 4rem; padding-top: 1.25rem; border-top: 1px solid var(--rule);
         color: var(--muted); font-size: .8rem; }
footer a { color: var(--muted); }
`

function layout({ title, description, body, canonical }) {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${description ? `<meta name="description" content="${esc(description)}">` : ''}
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<style>${CSS}</style>
</head>
<body>
<header>
  <a href="./"><div class="site-name">${SITE_NAME}</div></a>
  <div class="tagline">${SITE_TAGLINE}</div>
</header>
${body}
<footer>
  <p><a href="./about.html">このサイトについて</a></p>
</footer>
</body>
</html>
`
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// ---------------------------------------------------------------- 生成

function rewriteGoLinks(html) {
  const base = config.links.redirectorBase.replace(/\/$/, '')
  if (!base || base.includes('REPLACE-ME')) return html
  // アフィリエイトリンクは rel="sponsored nofollow" を付ける
  return html.replace(/href="\/go\/([^"]+)"/g, `href="${base}/go/$1" rel="sponsored nofollow noopener" target="_blank"`)
}

// frontmatter の books: から、記事末尾の書籍カードを組み立てる。
//
// 本文中のリンクはAI社員の書き方次第で入ったり入らなかったりする（実際に0本の記事が出た）。
// 書誌は frontmatter で必ず申告させているので、そこから機械的に作れば取りこぼしがない。
// 書影は openBD のもの。利用規約により「本を紹介する目的」で無償・許諾不要、ただし改変禁止。
function renderBookCards(meta) {
  const isbns = (Array.isArray(meta.books) ? meta.books : meta.books ? [meta.books] : []).map((s) =>
    String(s).replace(/[-\s]/g, '')
  )
  const items = isbns.map((i) => [i, allLinks[i]]).filter(([, v]) => v)
  if (items.length === 0) return ''

  const base = config.links.redirectorBase.replace(/\/$/, '')
  const go = (isbn) => (base && !base.includes('REPLACE-ME') ? `${base}/go/${isbn}` : `/go/${isbn}`)

  return `
  <section class="books">
    <h2>この記事で取り上げた本</h2>
    <ul>
${items
  .map(
    ([isbn, b]) => `      <li>
        ${
          b.cover
            ? `<a class="cover" href="${esc(go(isbn))}" rel="sponsored nofollow noopener" target="_blank"><img src="${esc(b.cover)}" alt="${esc(b.label)}" loading="lazy"></a>`
            : ''
        }
        <div class="body">
          <div class="bt"><a href="${esc(go(isbn))}" rel="sponsored nofollow noopener" target="_blank">${esc(b.label)}</a></div>
          <div class="bm">${esc([b.author, b.publisher].filter(Boolean).join(' / '))}</div>
          <a class="buy" href="${esc(go(isbn))}" rel="sponsored nofollow noopener" target="_blank">楽天ブックスで見る</a>
        </div>
      </li>`
  )
  .join('\n')}
    </ul>
    <p class="credit">書影・書誌データ: openBD ／ 上記リンクは楽天アフィリエイトを利用しています</p>
  </section>`
}

mkdirSync(OUT, { recursive: true })

const allLinks = existsSync(join(ROOT, 'state/links.json'))
  ? JSON.parse(readFileSync(join(ROOT, 'state/links.json'), 'utf8'))
  : {}

const contentDir = join(ROOT, 'content')
const files = existsSync(contentDir) ? readdirSync(contentDir).filter((f) => extname(f) === '.md') : []

const articles = []

for (const file of files) {
  const raw = readFileSync(join(contentDir, file), 'utf8')
  const { meta, body } = parseFrontmatter(raw)
  const slug = meta.slug || file.replace(/\.md$/, '')
  const title = meta.title || slug
  const date = meta.date || file.slice(0, 10)

  // 本文冒頭の見出しは落とす。frontmatter の title から <h1> を出しているので、
  // AI社員が本文にも「# タイトル」を書くと同じ見出しが2つ並び、H1も2つになる。
  // 指示書で禁じるより、ここで機械的に落とすほうが確実（実際に3本とも二重になっていた）。
  const bodyWithoutLeadHeading = body.replace(/^\s*#\s+.*\r?\n+/, '')
  const rendered = rewriteGoLinks(md.render(bodyWithoutLeadHeading))
  const description = body
    .replace(/^\s*\[PR\]\s*$/m, '')
    .replace(/[#*>\-\[\]]/g, '')
    .trim()
    .slice(0, 110)

  const canonical = config.links.siteBase.includes('REPLACE-ME')
    ? null
    : `${config.links.siteBase.replace(/\/$/, '')}/${slug}.html`

  const html = layout({
    title: `${title} | ${SITE_NAME}`,
    description,
    canonical,
    body: `<main>
  <article>
    <h1>${esc(title)}</h1>
    <p class="meta"><time datetime="${esc(date)}">${esc(date)}</time></p>
    ${rendered}
  </article>
${renderBookCards(meta)}
</main>`,
  })

  writeFileSync(join(OUT, `${slug}.html`), html, 'utf8')
  articles.push({ slug, title, date, description })
}

articles.sort((a, b) => String(b.date).localeCompare(String(a.date)))

writeFileSync(
  join(OUT, 'index.html'),
  layout({
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_TAGLINE,
    body: `<main>
  <ul class="index-list">
${articles
  .map(
    (a) => `    <li>
      <a href="./${esc(a.slug)}.html">${esc(a.title)}</a>
      <div class="meta"><time datetime="${esc(a.date)}">${esc(a.date)}</time></div>
    </li>`
  )
  .join('\n')}
  </ul>
</main>`,
  }),
  'utf8'
)

// 運営方針。記事ごとの表示はせず、ここに一度だけ置く。
writeFileSync(
  join(OUT, 'about.html'),
  layout({
    title: `このサイトについて | ${SITE_NAME}`,
    body: `<main>
  <article>
    <h1>このサイトについて</h1>
    <p>${SITE_NAME}は、目的から逆算して技術書・ビジネス書を選ぶための案内をまとめています。</p>

    <h2>記事の作り方</h2>
    <p>記事は公開情報（目次、著者情報、版元の紹介文、書誌情報）をもとに構成しています。書評ではなく選書ガイドという形式を取っているのは、読了体験を語る記事ではないからです。「読んで感動した」といった一次体験の記述は行いません。</p>
    <p>記事の生成と更新は自動化されています。</p>

    <h2>広告について</h2>
    <p>記事には楽天アフィリエイトによる広告リンクを含む場合があります。該当する記事には <span class="pr">PR</span> を表示しています。リンク経由で商品が購入された場合、当サイトに成果報酬が発生することがあります。</p>
    <p>報酬の有無によって紹介する本の順序や評価を変えることはしていません。</p>

    <h2>誤りの指摘</h2>
    <p>書誌情報の誤りにお気づきの場合は、指摘いただければ修正します。</p>
  </article>
</main>`,
  }),
  'utf8'
)

// Worker が読むリンク定義
const linksSrc = join(ROOT, 'state/links.json')
if (existsSync(linksSrc)) copyFileSync(linksSrc, join(OUT, 'links.json'))

writeFileSync(join(OUT, '.nojekyll'), '', 'utf8')

// GitHub Pages のプロジェクトサイトは /<リポジトリ名>/ の下に置かれる。
// href="/foo.html" と書くとドメイン直下を指してしまい、全リンクが404になる。
// 個別ページを直接開くと表示できるので、目視では気づきにくい。
{
  const offenders = []
  for (const name of readdirSync(OUT).filter((f) => f.endsWith('.html'))) {
    const html = readFileSync(join(OUT, name), 'utf8')
    for (const m of html.matchAll(/(?:href|src)="(\/[^/][^"]*)"/g)) offenders.push(`${name}: ${m[1]}`)
  }
  if (offenders.length) {
    console.error('内部リンクがドメイン直下を指しています（相対パスにしてください）:')
    for (const o of offenders) console.error(`  ${o}`)
    process.exit(1)
  }
}

console.log(`${articles.length} 記事を site/ に生成しました。`)
for (const a of articles) console.log(`  ${a.date}  ${a.slug}.html  ${a.title}`)
