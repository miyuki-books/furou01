#!/usr/bin/env node
// X（Twitter）公式APIへの投稿。
//
// 公式APIを使うのは、規約がクリアで無人実行できるため。
// ブラウザ自動操作や非公式APIは使わない（職務規程 8.）。
//
// 認証は OAuth 1.0a（静的なキー4つ）。OAuth 2.0 のユーザーコンテキストは
// リフレッシュトークンの更新が要るため、無人運用には向かない。
//
//   node scripts/post-x.mjs "投稿本文"
//   node scripts/post-x.mjs --dry-run "投稿本文"

import { createHmac, randomBytes } from 'node:crypto'

const ENDPOINT = 'https://api.x.com/2/tweets'
const MAX_LEN = 280

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const text = args.filter((a) => !a.startsWith('--')).join(' ').trim()

if (!text) {
  console.error('投稿本文が空です。')
  process.exit(1)
}

// URLは t.co で23文字に短縮されるため、その前提で概算する
const weighted = text.replace(/https?:\/\/\S+/g, 'x'.repeat(23)).length
if (weighted > MAX_LEN) {
  console.error(`本文が長すぎます（換算 ${weighted} 文字 / 上限 ${MAX_LEN}）。`)
  process.exit(1)
}

const creds = {
  key: process.env.X_API_KEY,
  secret: process.env.X_API_SECRET,
  token: process.env.X_ACCESS_TOKEN,
  tokenSecret: process.env.X_ACCESS_SECRET,
}

if (dryRun || Object.values(creds).some((v) => !v)) {
  if (!dryRun) console.warn('X の認証情報が未設定のため、投稿せず内容だけ表示します:')
  console.log(`--- X 投稿内容（${weighted}/${MAX_LEN}）---`)
  console.log(text)
  process.exit(0)
}

const enc = (s) =>
  encodeURIComponent(s).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())

const oauth = {
  oauth_consumer_key: creds.key,
  oauth_nonce: randomBytes(16).toString('hex'),
  oauth_signature_method: 'HMAC-SHA1',
  oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
  oauth_token: creds.token,
  oauth_version: '1.0',
}

// 署名ベース文字列。JSONボディは署名対象に含めない（oauth_* とクエリのみ）。
const paramString = Object.keys(oauth)
  .sort()
  .map((k) => `${enc(k)}=${enc(oauth[k])}`)
  .join('&')
const baseString = ['POST', enc(ENDPOINT), enc(paramString)].join('&')
const signingKey = `${enc(creds.secret)}&${enc(creds.tokenSecret)}`
oauth.oauth_signature = createHmac('sha1', signingKey).update(baseString).digest('base64')

const authHeader =
  'OAuth ' +
  Object.keys(oauth)
    .sort()
    .map((k) => `${enc(k)}="${enc(oauth[k])}"`)
    .join(', ')

const res = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { authorization: authHeader, 'content-type': 'application/json' },
  body: JSON.stringify({ text }),
})

const bodyText = await res.text()

if (!res.ok) {
  console.error(`X への投稿に失敗しました: ${res.status}`)
  console.error(bodyText)
  process.exit(1)
}

const data = JSON.parse(bodyText)
console.log(`X へ投稿しました: id=${data?.data?.id ?? '(unknown)'}`)
