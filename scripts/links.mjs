#!/usr/bin/env node
// content/*.md の frontmatter にある ISBN から、楽天アフィリエイトURLを機械生成して
// state/links.json を更新する。
//
// AI社員にURLを組み立てさせない。組み立てさせれば必ず捏造が混じるし、
// 手で作って貼るなら毎日人間の作業が発生して「人間の手間ほぼゼロ」が崩れる。
//
// 楽天ウェブサービスのAPIは使わない。2026年の仕様変更で Referer 必須になり、
// サーバーからの呼び出しは 403 REQUEST_CONTEXT_BODY_HTTP_REFERRER_MISSING で弾かれる。
// Referer を偽装すれば通るが、それはアクセス制御の回避なので行わない。
// 代わりに、楽天アフィリエイトの「URLを入力してリンクを作成」が生成するのと
// 同じ形式のURLを組み立てる。書名は openBD から取る。
//
//   node scripts/links.mjs

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const LINKS_PATH = join(ROOT, 'state/links.json')
const CONFIG_PATH = join(ROOT, 'state/config.json')

const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
const affiliateId = process.env.RAKUTEN_AFFILIATE_ID || config.links.rakutenAffiliateId

// 楽天アフィリエイトが「URLを入力してリンクを作成」で生成する形式に合わせる。
// ut は Base64 で {"page":"url","type":"hybrid_url","col":1} を表す固定値。
const UT = 'eyJwYWdlIjoidXJsIiwidHlwZSI6Imh5YnJpZF91cmwiLCJjb2wiOjF9'
const bookUrl = (isbn) => `https://books.rakuten.co.jp/search?sitem=${isbn}&g=001`
const affiliateUrl = (isbn) =>
  `https://hb.afl.rakuten.co.jp/hgc/${affiliateId}/?pc=${encodeURIComponent(bookUrl(isbn))}` +
  `&link_type=hybrid_url&ut=${UT}`

function collectIsbns() {
  const dir = join(ROOT, 'content')
  if (!existsSync(dir)) return []
  const found = new Set()
  for (const f of readdirSync(dir).filter((n) => extname(n) === '.md')) {
    const raw = readFileSync(join(dir, f), 'utf8').replace(/^﻿/, '')
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
    if (!m) continue
    const line = m[1].match(/^books:\s*\[(.*)\]\s*$/m)
    if (!line) continue
    for (const part of line[1].split(',')) {
      const isbn = part.trim().replace(/^["']|["']$/g, '').replace(/[-\s]/g, '')
      if (/^97[89]\d{10}$/.test(isbn)) found.add(isbn)
    }
  }
  return [...found]
}

const links = existsSync(LINKS_PATH) ? JSON.parse(readFileSync(LINKS_PATH, 'utf8')) : {}
const isbns = collectIsbns()
const missing = isbns.filter((i) => !links[i])

console.log(`記事が参照する ISBN: ${isbns.length} 件 / 未登録: ${missing.length} 件`)

if (missing.length === 0) {
  console.log('追加するリンクはありません。')
  process.exit(0)
}

if (!affiliateId || affiliateId.includes('REPLACE-ME')) {
  // 未設定でも落とさない。アフィリエイトリンクの無い記事として公開されるだけで、
  // 規約違反にも事実誤認にもならない。ただし黙って進めない。
  console.warn('アフィリエイトIDが未設定のため、リンクを生成せず終了します。')
  console.warn('state/config.json の links.rakutenAffiliateId を設定してください。')
  console.warn(`未登録のまま: ${missing.join(', ')}`)
  process.exit(0)
}

// 書名は openBD から取る（無料・認証不要）。取れなくてもリンク自体は作れる。
let labels = {}
try {
  const res = await fetch(`https://api.openbd.jp/v1/get?isbn=${missing.join(',')}`)
  if (res.ok) {
    const records = await res.json()
    missing.forEach((isbn, i) => {
      const s = records[i]?.summary
      if (s) labels[isbn] = { title: s.title, author: s.author || '', publisher: s.publisher || '' }
    })
  }
} catch (e) {
  console.warn(`openBD から書名を取得できませんでした（${e.message}）。ラベルなしで続行します。`)
}

for (const isbn of missing) {
  links[isbn] = {
    url: affiliateUrl(isbn),
    label: labels[isbn]?.title || isbn,
    author: labels[isbn]?.author || '',
    publisher: labels[isbn]?.publisher || '',
    addedAt: new Date().toISOString().slice(0, 10),
  }
  console.log(`  + ${isbn}  ${links[isbn].label}`)
}

writeFileSync(LINKS_PATH, JSON.stringify(links, null, 2) + '\n', 'utf8')
console.log(`\nstate/links.json に ${missing.length} 件を追加しました。`)
