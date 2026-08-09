#!/usr/bin/env node
// content/*.md の frontmatter にある ISBN から、楽天アフィリエイトURLを機械生成して
// state/links.json を更新する。
//
// AI社員にURLを組み立てさせない。組み立てさせれば必ず捏造が混じるし、
// 手で作って貼るなら毎日人間の作業が発生して「人間の手間ほぼゼロ」が崩れる。
// 楽天ブックス書籍検索APIは ISBN を渡すと affiliateUrl をそのまま返すので、それを使う。
//
// リンクのキーは ISBN そのもの。記事側は [書名](/go/9784274224546) と書けばよい。
//
//   RAKUTEN_APP_ID=... RAKUTEN_AFFILIATE_ID=... node scripts/links.mjs

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const LINKS_PATH = join(ROOT, 'state/links.json')
const API = 'https://app.rakuten.co.jp/services/api/BooksBook/Search/20170404'

const appId = process.env.RAKUTEN_APP_ID
const affiliateId = process.env.RAKUTEN_AFFILIATE_ID

// frontmatter から books: を集める
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

if (!appId || !affiliateId) {
  // 未設定でも落とさない。アフィリエイトリンクが無い記事として公開されるだけで、
  // 規約違反にも事実誤認にもならない。ただし黙って進めない。
  console.warn('RAKUTEN_APP_ID / RAKUTEN_AFFILIATE_ID が未設定のため、リンクを生成せず終了します。')
  console.warn(`未登録のまま: ${missing.join(', ')}`)
  process.exit(0)
}

let added = 0
const failed = []

for (const isbn of missing) {
  const url = `${API}?format=json&isbn=${isbn}&applicationId=${encodeURIComponent(appId)}&affiliateId=${encodeURIComponent(affiliateId)}`
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const item = data?.Items?.[0]?.Item
    if (!item?.affiliateUrl) throw new Error('affiliateUrl が返らなかった')

    links[isbn] = {
      url: item.affiliateUrl,
      label: item.title,
      author: item.author || '',
      publisher: item.publisherName || '',
      addedAt: new Date().toISOString().slice(0, 10),
    }
    added++
    console.log(`  + ${isbn}  ${item.title}`)
  } catch (e) {
    failed.push(`${isbn}: ${e.message}`)
    console.warn(`  ! ${isbn}  取得できず (${e.message})`)
  }
  // 楽天APIは秒間1リクエストの制限がある
  await new Promise((r) => setTimeout(r, 1200))
}

if (added > 0) {
  writeFileSync(LINKS_PATH, JSON.stringify(links, null, 2) + '\n', 'utf8')
  console.log(`\nstate/links.json に ${added} 件を追加しました。`)
}

if (failed.length) {
  console.warn(`\n取得できなかった ISBN: ${failed.length} 件`)
  for (const f of failed) console.warn(`  ${f}`)
  console.warn('該当の本はアフィリエイトリンクなしで公開されます（記事自体は問題ありません）。')
}
