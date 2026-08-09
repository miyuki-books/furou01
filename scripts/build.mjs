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
  <a href="/"><div class="site-name">${SITE_NAME}</div></a>
  <div class="tagline">${SITE_TAGLINE}</div>
</header>
${body}
<footer>
  <p><a href="/about.html">このサイトについて</a></p>
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

mkdirSync(OUT, { recursive: true })

const contentDir = join(ROOT, 'content')
const files = existsSync(contentDir) ? readdirSync(contentDir).filter((f) => extname(f) === '.md') : []

const articles = []

for (const file of files) {
  const raw = readFileSync(join(contentDir, file), 'utf8')
  const { meta, body } = parseFrontmatter(raw)
  const slug = meta.slug || file.replace(/\.md$/, '')
  const title = meta.title || slug
  const date = meta.date || file.slice(0, 10)

  const rendered = rewriteGoLinks(md.render(body))
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
      <a href="/${esc(a.slug)}.html">${esc(a.title)}</a>
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

console.log(`${articles.length} 記事を site/ に生成しました。`)
for (const a of articles) console.log(`  ${a.date}  ${a.slug}.html  ${a.title}`)
