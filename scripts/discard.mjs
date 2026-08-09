#!/usr/bin/env node
// ガードレールを通せなかった下書きを破棄する。
//
// AI社員に汎用の rm を渡さないための、用途を絞った削除口。
// content/ と outbox/note/ の直下しか消せない。
//
//   node scripts/discard.mjs content/2026-08-10-foo.md "3回直しても check を通せなかった"

import { unlinkSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join, relative, sep } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const ALLOWED_DIRS = ['content', join('outbox', 'note')]

const [target, ...reasonParts] = process.argv.slice(2)
const reason = reasonParts.join(' ').trim()

if (!target) {
  console.error('使い方: node scripts/discard.mjs <ファイル> "<理由>"')
  process.exit(1)
}
if (!reason) {
  console.error('理由は必須です。何を捨てたかだけ残っても、なぜ捨てたかが分からないと後で読めません。')
  process.exit(1)
}

const abs = resolve(ROOT, target)
const rel = relative(ROOT, abs)

if (rel.startsWith('..') || !ALLOWED_DIRS.some((d) => rel.startsWith(d + sep))) {
  console.error(`${rel} は破棄できません。content/ と outbox/note/ の中のファイルだけが対象です。`)
  process.exit(1)
}
if (!existsSync(abs)) {
  console.error(`${rel} が見つかりません。`)
  process.exit(1)
}

unlinkSync(abs)

// 何を捨てたかは health.json に残す。黙って消えると原因を追えなくなる。
const healthPath = join(ROOT, 'state/health.json')
const health = JSON.parse(readFileSync(healthPath, 'utf8'))
health.discarded = health.discarded || []
health.discarded.push({ file: rel.split(sep).join('/'), reason, at: new Date().toISOString() })
writeFileSync(healthPath, JSON.stringify(health, null, 2) + '\n', 'utf8')

console.log(`破棄しました: ${rel}`)
console.log(`理由: ${reason}`)
