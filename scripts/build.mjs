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
const SITE_INTRO =
  '「何を読むか」ではなく「何のために読むか」から始めます。目次構成・著者の経歴・版元の位置づけを突き合わせ、いま自分が取るべき一冊を絞り込むための地図です。'

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
  color-scheme: light dark;
  --bg: #fbfaf7;
  --surface: #ffffff;
  --surface-2: #f5f2eb;
  --fg: #1d1c1a;
  --muted: #6a665e;
  --faint: #928d84;
  --rule: #e4e0d7;
  --rule-strong: #cec9bd;
  --accent: #8a3324;
  --accent-fg: #ffffff;
  --link: #1f5f8b;
  --maxw: 44rem;
  --radius: 10px;
  --serif: "Hiragino Mincho ProN", "Yu Mincho", YuMincho, "Noto Serif JP", "Source Han Serif JP", "MS PMincho", serif;
  --sans: "Hiragino Kaku Gothic ProN", "Yu Gothic", YuGothic, "Noto Sans JP", system-ui, -apple-system, "Segoe UI", sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #171613;
    --surface: #1e1d19;
    --surface-2: #24231e;
    --fg: #e9e6df;
    --muted: #a5a096;
    --faint: #837e75;
    --rule: #33312b;
    --rule-strong: #454239;
    --accent: #d98576;
    --accent-fg: #171613;
    --link: #86bcdf;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  padding: 0 1.25rem 6rem;
  background: var(--bg);
  color: var(--fg);
  font-family: var(--sans);
  font-feature-settings: "palt" 1;
  line-height: 1.9;
  font-size: 1rem;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}
main, .site-header > div, .site-footer > div { max-width: var(--maxw); margin: 0 auto; }
img { max-width: 100%; height: auto; }

/* ------------------------------------------------------------ 共通 */
a { color: var(--link); text-decoration-thickness: 1px; text-underline-offset: .22em; }
a:hover { text-decoration-thickness: 2px; }
a:focus-visible, button:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 3px;
}
.skip {
  position: absolute; left: -9999px; top: 0;
  background: var(--accent); color: var(--accent-fg);
  padding: .6rem 1rem; border-radius: 0 0 var(--radius) 0; z-index: 10;
}
.skip:focus { left: 0; }
hr { border: 0; border-top: 1px solid var(--rule); margin: 3rem 0; }

/* ------------------------------------------------------------ ヘッダ / フッタ */
.site-header { border-bottom: 1px solid var(--rule); margin-bottom: 3rem; }
.site-header > div {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: 1rem; flex-wrap: wrap; padding: 1.9rem 0 1.4rem;
}
.brand { text-decoration: none; color: var(--fg); display: flex; align-items: center; gap: .7rem; }
.brand:hover { text-decoration: none; }
.brand img { border-radius: 7px; flex: 0 0 auto; }
.site-name {
  font-family: var(--serif); font-size: 1.35rem; font-weight: 600; letter-spacing: .06em;
}
.brand:hover .site-name { color: var(--accent); }
.tagline { color: var(--muted); font-size: .8rem; letter-spacing: .04em; margin-top: .25rem; }
.site-nav { display: flex; gap: 1.25rem; font-size: .85rem; }
.site-nav a { color: var(--muted); text-decoration: none; }
.site-nav a:hover { color: var(--accent); text-decoration: underline; }
.site-footer { margin-top: 5rem; border-top: 1px solid var(--rule); }
.site-footer > div {
  padding-top: 1.5rem; color: var(--faint); font-size: .78rem;
  display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap;
}
.site-footer a { color: var(--muted); }

/* ------------------------------------------------------------ 本文 */
h1 {
  font-family: var(--serif); font-weight: 600;
  font-size: clamp(1.6rem, 1.25rem + 1.6vw, 2.1rem);
  line-height: 1.5; letter-spacing: .01em; margin: 0 0 .7rem; text-wrap: balance;
}
h2 {
  font-family: var(--serif); font-weight: 600; font-size: 1.28rem; line-height: 1.6;
  margin: 3.4rem 0 1rem; padding-top: 1.1rem; border-top: 1px solid var(--rule);
  scroll-margin-top: 1.5rem; text-wrap: balance; position: relative;
}
h2::before {
  content: ""; position: absolute; top: -1px; left: 0; width: 2.5rem;
  border-top: 2px solid var(--accent);
}
h3 { font-family: var(--serif); font-size: 1.08rem; margin: 2.2rem 0 .6rem; scroll-margin-top: 1.5rem; }
p { margin: 1.3rem 0; text-wrap: pretty; }
/* リード段落。:first-of-type だと直前の日付行に当たってしまう */
.article-meta + p { font-size: 1.06rem; }
ul, ol { padding-left: 1.5rem; }
li { margin: .5rem 0; }
strong { font-weight: 700; }
strong a { color: var(--accent); text-decoration-color: color-mix(in srgb, var(--accent) 45%, transparent); }
blockquote {
  margin: 1.8rem 0; padding: .2rem 0 .2rem 1.2rem;
  border-left: 3px solid var(--rule-strong); color: var(--muted);
}
.meta {
  color: var(--faint); font-size: .8rem; letter-spacing: .04em;
  font-variant-numeric: tabular-nums;
}
.article-meta { margin: 0 0 2.6rem; display: flex; align-items: center; gap: .8rem; flex-wrap: wrap; }
.pr {
  display: inline-block; font-size: .68rem; line-height: 1.6; letter-spacing: .1em;
  color: var(--muted); border: 1px solid var(--rule-strong);
  border-radius: 3px; padding: 0 .45rem;
}

/* ------------------------------------------------------------ トップページ */
.intro { margin: 0 0 3.2rem; }
.intro h1 { font-size: clamp(1.5rem, 1.2rem + 1.3vw, 1.85rem); }
.intro p { color: var(--muted); font-size: .95rem; margin: 0; }
.list-label {
  font-size: .74rem; letter-spacing: .18em; color: var(--faint);
  border-bottom: 1px solid var(--rule); padding-bottom: .6rem; margin-bottom: 1.6rem;
}
.cards { list-style: none; padding: 0; margin: 0; display: grid; gap: 1.1rem; }
.card {
  background: var(--surface); border: 1px solid var(--rule); border-radius: var(--radius);
  padding: 1.5rem 1.6rem 1.35rem;
  transition: border-color .18s ease, transform .18s ease, box-shadow .18s ease;
}
.card:hover {
  border-color: var(--rule-strong); transform: translateY(-2px);
  box-shadow: 0 6px 20px -12px rgba(0, 0, 0, .35);
}
.card h2 {
  font-size: 1.22rem; margin: 0 0 .55rem; padding: 0; border: 0; line-height: 1.55;
}
.card h2::before { content: none; }
.card h2 a { color: var(--fg); text-decoration: none; }
.card:hover h2 a { color: var(--accent); }
.card-excerpt { color: var(--muted); font-size: .9rem; line-height: 1.8; margin: 0 0 1rem; }
.empty {
  border: 1px dashed var(--rule-strong); border-radius: var(--radius);
  padding: 2.5rem 1.5rem; text-align: center; color: var(--faint); font-size: .9rem;
}
.card-foot { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.spines { display: flex; gap: 3px; }
.spines span { display: block; width: 9px; height: 30px; border-radius: 1px; opacity: .85; }

/* ------------------------------------------------------------ 書籍カード */
.books { margin-top: 4rem; }
.books > h2 {
  font-size: 1.05rem; letter-spacing: .04em; margin: 0 0 1.4rem;
}
.books ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 1rem; }
.books li {
  display: flex; gap: 1.3rem; align-items: flex-start;
  background: var(--surface-2); border: 1px solid var(--rule);
  border-radius: var(--radius); padding: 1.4rem;
  transition: border-color .18s ease, box-shadow .18s ease;
}
.books li:hover { border-color: var(--rule-strong); box-shadow: 0 6px 20px -14px rgba(0, 0, 0, .4); }
.books .cover { flex: 0 0 auto; line-height: 0; }
.books .cover img { border-radius: 3px; box-shadow: 0 3px 10px -4px rgba(0, 0, 0, .45); }
.books .body { flex: 1; min-width: 0; }
.books .ord {
  font-family: var(--serif); font-size: .72rem; letter-spacing: .16em;
  color: var(--accent); display: block; margin-bottom: .3rem;
}
.books .bt { font-family: var(--serif); font-size: 1.02rem; font-weight: 600; line-height: 1.6; }
.books .bt a { color: var(--fg); text-decoration: none; }
.books .bt a:hover { color: var(--accent); text-decoration: underline; }
.books .bm { color: var(--muted); font-size: .8rem; margin-top: .35rem; overflow-wrap: anywhere; }
.books .buy {
  display: inline-block; margin-top: .9rem; font-size: .82rem; letter-spacing: .03em;
  background: var(--accent); color: var(--accent-fg); border: 1px solid var(--accent);
  border-radius: 6px; padding: .38rem .95rem; text-decoration: none;
  transition: opacity .18s ease;
}
.books .buy:hover { opacity: .82; text-decoration: none; }
.books .credit { color: var(--faint); font-size: .74rem; margin-top: 1.3rem; }
.books .credit a { color: var(--faint); }

@media (max-width: 30rem) {
  .books li { gap: 1rem; padding: 1.1rem; }
  .site-header > div { padding: 1.4rem 0 1.1rem; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition-duration: .01ms !important; animation-duration: .01ms !important; }
  .card:hover { transform: none; }
}
`

// assets/ の中身は scripts/og-image.mjs がローカルで生成してコミットしたもの。
// 日次ビルドは生成せず、site/ へコピーするだけにしてある（理由は og-image.mjs の冒頭）。
function layout({ title, description, body, canonical, ogType = 'website' }) {
  const siteBase = config.links.siteBase.includes('REPLACE-ME')
    ? ''
    : config.links.siteBase.replace(/\/$/, '')
  const ogImage = siteBase ? `${siteBase}/og-default.png` : ''
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${description ? `<meta name="description" content="${esc(description)}">` : ''}
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<meta property="og:site_name" content="${esc(SITE_NAME)}">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${esc(title)}">
${description ? `<meta property="og:description" content="${esc(description)}">` : ''}
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ''}
<meta property="og:locale" content="ja_JP">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ''}
${ogImage ? '<meta property="og:image:width" content="1200">' : ''}
${ogImage ? '<meta property="og:image:height" content="630">' : ''}
${ogImage ? `<meta property="og:image:alt" content="${esc(SITE_NAME)} — ${esc(SITE_TAGLINE)}">` : ''}
<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">
${ogImage ? `<meta name="twitter:image" content="${esc(ogImage)}">` : ''}
<meta name="theme-color" content="#fbfaf7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#171613" media="(prefers-color-scheme: dark)">
<link rel="icon" href="./mark.svg" type="image/svg+xml">
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">本文へスキップ</a>
<header class="site-header">
  <div>
    <a class="brand" href="./">
      <img src="./mark.svg" alt="" width="34" height="34" decoding="async">
      <div>
        <div class="site-name">${SITE_NAME}</div>
        <div class="tagline">${SITE_TAGLINE}</div>
      </div>
    </a>
    <nav class="site-nav" aria-label="サイト">
      <a href="./">記事一覧</a>
      <a href="./about.html">このサイトについて</a>
    </nav>
  </div>
</header>
${body}
<footer class="site-footer">
  <div>
    <span>${SITE_NAME}</span>
    <span><a href="./about.html">このサイトについて</a>${siteBase ? ' ／ 記事の生成と更新は自動化されています' : ''}</span>
  </div>
</footer>
</body>
</html>
`
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// ---------------------------------------------------------------- 書影の代替

// 書影は手に入らない。openBD は登録済みの全冊で cover が空、国立国会図書館サーチの
// サムネイルは 403、楽天ウェブサービスは Referer 必須で呼べない（scripts/links.mjs 参照）。
// 実物の表紙を生成AIで描かせると偽の書影になり、指標3（事実誤認）を直撃するので、
// 書名を組んだ活字パネルを ISBN から決定的に生成して代わりに置く。
const PANEL_COLORS = ['#6b7f6e', '#7a6a5f', '#5f6f85', '#8a6a6a', '#6e6a85', '#857a5f']

// FNV-1a + 最後に撹拌。
// h*31+c だと 31 ≡ 1 (mod 6) なので、色数で割った余りが「文字コードの総和 mod 6」に
// 潰れてしまう。ISBN は 978 始まりで桁の並びが似ているため、12冊中9冊が同じ色になった。
function hashOf(s) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  h ^= h >>> 15
  h = Math.imul(h, 2246822507) >>> 0
  h ^= h >>> 13
  return h >>> 0
}

// 色は ISBN のハッシュで決める（同じ本はどの記事でも同じ色になる）。
// ただし同一記事の中でぶつかると、並んだパネルが見分けられない。6色・3冊なら4割強で衝突する。
// 第一希望が埋まっていたら次の色へずらし、記事内では必ず別色にする。
function assignColors(isbns) {
  const used = new Set()
  const out = {}
  for (const isbn of isbns) {
    const start = hashOf(isbn) % PANEL_COLORS.length
    let k = 0
    while (k < PANEL_COLORS.length && used.has((start + k) % PANEL_COLORS.length)) k += 1
    const idx = (start + k) % PANEL_COLORS.length
    used.add(idx)
    out[isbn] = PANEL_COLORS[idx]
  }
  return out
}

const escXml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]))

// 和欧混植の行分割。幅は半角1・全角2で数える。
// 単純に N 文字ずつ切ると "Clean Ar / chitectu / re" のように英単語が割れる。
// 和文はどこで折っても読めるが、欧文は語の途中で折ると読めなくなるので、
// 行内に空白があればそこまで戻す。
function wrapMixed(text, budget, maxLines) {
  const wide = (c) => (/[　-鿿＀-｠￠-￦]/.test(c) ? 2 : 1)
  const lines = []
  let line = ''
  let width = 0

  for (const ch of text) {
    if (width + wide(ch) > budget && line) {
      // 欧文の途中なら直前の空白まで巻き戻す
      const cut = /[A-Za-z0-9]$/.test(line) && /[A-Za-z0-9]/.test(ch) ? line.lastIndexOf(' ') : -1
      if (cut > 0) {
        lines.push(line.slice(0, cut))
        line = line.slice(cut + 1)
        width = [...line].reduce((a, c) => a + wide(c), 0)
      } else {
        lines.push(line)
        line = ''
        width = 0
      }
      if (lines.length >= maxLines) return lines
    }
    line += ch
    width += wide(ch)
  }
  if (line && lines.length < maxLines) lines.push(line)

  // 入りきらなかったぶんは最終行を省略記号で締める
  if (lines.length === maxLines) {
    const consumed = lines.join('').replace(/ /g, '').length
    if (consumed < text.replace(/ /g, '').length) lines[maxLines - 1] = lines[maxLines - 1].replace(/.$/, '…')
  }
  return lines
}

function coverPanel(isbn, title, author, color, w = 112) {
  const h = Math.round(w * 1.42)
  // 副題を落として主書名だけ組む。長い副題まで入れると字が潰れて読めない。
  const main = String(title).split(/[:：（(]/)[0].trim() || String(title)
  const lines = wrapMixed(main, 16, 7)

  const fs = w * 0.098
  const lead = fs * 1.5
  const top = h * 0.17
  const text = lines
    .map((l, i) => `<text x="${(w * 0.16).toFixed(1)}" y="${(top + lead * i).toFixed(1)}" fill="#fff" font-size="${fs.toFixed(1)}" font-family="serif" letter-spacing="0.5">${escXml(l)}</text>`)
    .join('')
  // openBD の著者欄は「JoséHaroPeralta 元内柊也 小栁斉 …」のように複数人が詰まっている。
  // 途中で切ると "JoseHaroP" のような読めない断片になるので、収まらないなら出さない。
  const first = String(author).split(/[,、／/\s]/).filter(Boolean)[0] || ''
  const by =
    first && first.length <= 8
      ? `<text x="${(w * 0.16).toFixed(1)}" y="${(h - h * 0.09).toFixed(1)}" fill="#fff" fill-opacity=".72" font-size="${(fs * 0.78).toFixed(1)}" font-family="serif">${escXml(first)}</text>`
      : ''

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    `<rect width="${w}" height="${h}" fill="${color}"/>` +
    `<rect width="${(w * 0.055).toFixed(1)}" height="${h}" fill="#000" fill-opacity=".22"/>` +
    `<rect x="${(w * 0.16).toFixed(1)}" y="${(h * 0.09).toFixed(1)}" width="${(w * 0.28).toFixed(1)}" height="1" fill="#fff" fill-opacity=".55"/>` +
    `<rect x="${(w * 0.16).toFixed(1)}" y="${(h - h * 0.145).toFixed(1)}" width="${(w * 0.68).toFixed(1)}" height="1" fill="#fff" fill-opacity=".3"/>` +
    text +
    by +
    `</svg>`

  return { src: `data:image/svg+xml,${encodeURIComponent(svg)}`, w, h }
}

// ---------------------------------------------------------------- 生成

function rewriteGoLinks(html) {
  const base = config.links.redirectorBase.replace(/\/$/, '')
  if (!base || base.includes('REPLACE-ME')) return html
  // アフィリエイトリンクは rel="sponsored nofollow" を付ける
  return html.replace(/href="\/go\/([^"]+)"/g, `href="${base}/go/$1" rel="sponsored nofollow noopener" target="_blank"`)
}

const isbnsOf = (meta) =>
  (Array.isArray(meta.books) ? meta.books : meta.books ? [meta.books] : []).map((s) =>
    String(s).replace(/[-\s]/g, '')
  )

// frontmatter の books: から、記事末尾の書籍カードを組み立てる。
//
// 本文中のリンクはAI社員の書き方次第で入ったり入らなかったりする（実際に0本の記事が出た）。
// 書誌は frontmatter で必ず申告させているので、そこから機械的に作れば取りこぼしがない。
// 書影は openBD のもの。利用規約により「本を紹介する目的」で無償・許諾不要、ただし改変禁止。
// cover が空のときだけ、上の coverPanel で代替パネルを出す。
function renderBookCards(meta) {
  const items = isbnsOf(meta)
    .map((i) => [i, allLinks[i]])
    .filter(([, v]) => v)
  if (items.length === 0) return ''

  const base = config.links.redirectorBase.replace(/\/$/, '')
  const go = (isbn) => (base && !base.includes('REPLACE-ME') ? `${base}/go/${isbn}` : `/go/${isbn}`)
  const ord = (n) => String(n + 1).padStart(2, '0')
  const colors = assignColors(items.map(([isbn]) => isbn))

  return `
  <section class="books" aria-labelledby="books-heading">
    <h2 id="books-heading">この記事で取り上げた本</h2>
    <ul>
${items
  .map(([isbn, b], i) => {
    const panel = coverPanel(isbn, b.label, b.author, colors[isbn])
    const img = b.cover
      ? `<img src="${esc(b.cover)}" alt="" width="${panel.w}" height="${panel.h}" loading="lazy" decoding="async">`
      : `<img src="${panel.src}" alt="" width="${panel.w}" height="${panel.h}" loading="lazy" decoding="async">`
    return `      <li>
        <a class="cover" href="${esc(go(isbn))}" rel="sponsored nofollow noopener" target="_blank" tabindex="-1" aria-hidden="true">${img}</a>
        <div class="body">
          <span class="ord">${ord(i)}</span>
          <div class="bt"><a href="${esc(go(isbn))}" rel="sponsored nofollow noopener" target="_blank">${esc(b.label)}</a></div>
          <div class="bm">${esc([b.author, b.publisher].filter(Boolean).join(' ／ '))}</div>
          <a class="buy" href="${esc(go(isbn))}" rel="sponsored nofollow noopener" target="_blank">楽天ブックスで見る</a>
        </div>
      </li>`
  })
  .join('\n')}
    </ul>
    <p class="credit">書誌データ: openBD ／ 表紙画像が取得できない書籍は書名を組んだ代替パネルを表示しています ／ 上記リンクは楽天アフィリエイトを利用しています</p>
  </section>`
}

mkdirSync(OUT, { recursive: true })

const allLinks = existsSync(join(ROOT, 'state/links.json'))
  ? JSON.parse(readFileSync(join(ROOT, 'state/links.json'), 'utf8'))
  : {}

const contentDir = join(ROOT, 'content')
const files = existsSync(contentDir) ? readdirSync(contentDir).filter((f) => extname(f) === '.md') : []

const articles = []

// 見出し・PR表記・記法を落として、最初のまとまった段落を抜き出す。
// 全文から記号を削るやり方だと、リンクの角括弧が潰れて読めない断片になっていた。
function excerptOf(body, len) {
  const para = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !/^#{1,6}\s/.test(p) && !/^\[PR\]$/.test(p) && !/^[-*+]\s/.test(p) && !/^-{3,}$/.test(p))
  if (!para) return ''
  const plain = para
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > len ? plain.slice(0, len) + '…' : plain
}

const jpDate = (iso) => {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : String(iso)
}

for (const file of files) {
  const raw = readFileSync(join(contentDir, file), 'utf8')
  const { meta, body } = parseFrontmatter(raw)
  const slug = meta.slug || file.replace(/\.md$/, '')
  const title = meta.title || slug
  const date = meta.date || file.slice(0, 10)

  // frontmatter の title から <h1> を出しているので、本文の H1 は重複になる。
  // タイトルと同じ見出しは削除し、それ以外の H1 は H2 に格下げする。
  // こうすると本文を失わずに H1 が必ず1つになる（実際に3本とも二重になっていた）。
  const norm = (s) => s.replace(/[\s　]/g, '').toLowerCase()
  const cleaned = body
    .replace(/^#\s+(.+?)\s*$/gm, (line, heading) => (norm(heading) === norm(title) ? '' : `## ${heading}`))
    // 単独行の [PR] は、日付の隣に出す PR バッジと二重になるので本文からは外す。
    // check.mjs が要求しているのは Markdown 原稿側の表記なので、そちらは触らない。
    // 表示上の開示はバッジ（見出し直下）と文末のアフィリエイト注記で担保する。
    .replace(/^\s*\[PR\]\s*$/gm, '')
  const rendered = rewriteGoLinks(md.render(cleaned))
  const description = excerptOf(body, 110)
  const isbns = isbnsOf(meta).filter((i) => allLinks[i])

  const canonical = config.links.siteBase.includes('REPLACE-ME')
    ? null
    : `${config.links.siteBase.replace(/\/$/, '')}/${slug}.html`

  const hasPr = /\[PR\]/.test(body) || /アフィリエイト/.test(body)

  const html = layout({
    title: `${title} | ${SITE_NAME}`,
    description,
    canonical,
    ogType: 'article',
    body: `<main id="main">
  <article>
    <h1>${esc(title)}</h1>
    <p class="article-meta meta">
      <time datetime="${esc(date)}">${esc(jpDate(date))}</time>
      ${isbns.length ? `<span>${isbns.length}冊</span>` : ''}
      ${hasPr ? '<span class="pr">PR</span>' : ''}
    </p>
    ${rendered}
  </article>
${renderBookCards(meta)}
</main>`,
  })

  writeFileSync(join(OUT, `${slug}.html`), html, 'utf8')
  articles.push({ slug, title, date, description, isbns })
}

articles.sort((a, b) => String(b.date).localeCompare(String(a.date)))

writeFileSync(
  join(OUT, 'index.html'),
  layout({
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_INTRO.slice(0, 110),
    canonical: config.links.siteBase.includes('REPLACE-ME')
      ? null
      : `${config.links.siteBase.replace(/\/$/, '')}/`,
    body: `<main id="main">
  <div class="intro">
    <h1>${SITE_TAGLINE}</h1>
    <p>${SITE_INTRO}</p>
  </div>
  <div class="list-label">記事 ${articles.length} 本</div>
${articles.length === 0 ? '  <p class="empty">まだ記事がありません。</p>' : ''}
  <ul class="cards">
${articles
  .map(
    (a) => `    <li class="card">
      <h2><a href="./${esc(a.slug)}.html">${esc(a.title)}</a></h2>
      <p class="card-excerpt">${esc(a.description)}</p>
      <div class="card-foot">
        <span class="meta"><time datetime="${esc(a.date)}">${esc(jpDate(a.date))}</time>${a.isbns.length ? ` ／ ${a.isbns.length}冊` : ''}</span>
        <span class="spines" aria-hidden="true">${(() => {
          const c = assignColors(a.isbns)
          return a.isbns.map((i) => `<span style="background:${c[i]}"></span>`).join('')
        })()}</span>
      </div>
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
    description: `${SITE_NAME}の運営方針、記事の作り方、広告の扱いについて。`,
    canonical: config.links.siteBase.includes('REPLACE-ME')
      ? null
      : `${config.links.siteBase.replace(/\/$/, '')}/about.html`,
    body: `<main id="main">
  <article>
    <h1>このサイトについて</h1>
    <p>${SITE_NAME}は、目的から逆算して技術書・ビジネス書を選ぶための案内をまとめています。</p>

    <h2>記事の作り方</h2>
    <p>記事は公開情報（目次、著者情報、版元の紹介文、書誌情報）をもとに構成しています。書評ではなく選書ガイドという形式を取っているのは、読了体験を語る記事ではないからです。「読んで感動した」といった一次体験の記述は行いません。</p>
    <p>記事の生成と更新は自動化されています。</p>

    <h2>表紙画像について</h2>
    <p>書影は openBD から取得していますが、データが登録されていない書籍が多数あります。取得できない場合は、書名と著者名を組んだ代替パネルを表示しています。実際の表紙とは異なります。生成AIで表紙を描き起こすことはしていません。</p>

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

// ロゴと OGP 画像。scripts/og-image.mjs がローカルで生成したものをそのまま置く。
// texture.jpg は OGP を組み立てるための素材で、サイトからは参照しないので配らない。
const assetsDir = join(ROOT, 'assets')
for (const name of ['mark.svg', 'og-default.png']) {
  const src = join(assetsDir, name)
  if (existsSync(src)) copyFileSync(src, join(OUT, name))
}

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
