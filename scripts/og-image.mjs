#!/usr/bin/env node
// サイト共通の OGP 画像（assets/og-default.png）を組み立てる。
//
// これは日次ビルドの一部ではない。ローカルで一度だけ回して、出力を git にコミットする。
// 理由が2つある。
//   1. ラスタライズには @resvg/resvg-js（ネイティブバイナリ）と日本語フォントが要る。
//      無人で回る GitHub Actions にこれを足すと、失敗する経路が1つ増える。
//      日次ジョブが落ちれば人間の介入が発生し、指標1（計画外介入の回数）を悪化させる。
//   2. OGP 画像はサイト共通の静的画像で足りる。記事ごとのタイトルは og:title が運ぶ。
//
// 素材:
//   assets/texture.jpg  地紋。gpt-image で生成した等高線テクスチャ（Codex 経由）。
//   assets/mark.svg     ロゴ。同じく gpt-image の生成画像を下図に、SVG で起こしたもの。
//                       favicon で 16-32px まで縮むので、ラスタではなくベクタで持つ。
//
// 実行:
//   npm i -D @resvg/resvg-js   # 一度だけ。package.json には残さない
//   node scripts/og-image.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const ASSETS = join(ROOT, 'assets')

let Resvg
try {
  ;({ Resvg } = await import('@resvg/resvg-js'))
} catch {
  console.error('@resvg/resvg-js が見つかりません。`npm i -D @resvg/resvg-js` を実行してから再度どうぞ。')
  console.error('（このスクリプトはローカル専用です。CI では実行しません）')
  process.exit(1)
}

const PAPER = '#fbfaf7'
const INK = '#1d1c1a'
const ACCENT = '#8a3324'
const MUTED = '#6a665e'

const SERIF = 'Yu Mincho, YuMincho, Hiragino Mincho ProN, MS PMincho, Noto Serif JP, serif'
const SANS = 'Yu Gothic, YuGothic, Hiragino Kaku Gothic ProN, Noto Sans JP, Meiryo, sans-serif'

// 地紋。resvg は外部ファイル参照を辿らないので base64 で埋め込む。
const texture = readFileSync(join(ASSETS, 'texture.jpg')).toString('base64')

// ロゴ。<svg> の外枠を外して <g> に入れ替え、viewBox の縮尺は自分で scale する
// （<g> にすると viewBox が効かないため）。
const markSrc = readFileSync(join(ASSETS, 'mark.svg'), 'utf8')
const markInner = markSrc.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '')
const mark = (size, x, y) =>
  `<g transform="translate(${x},${y}) scale(${(size / 1024).toFixed(5)})">${markInner}</g>`

const og = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <rect width="1200" height="630" fill="${PAPER}"/>
  <image href="data:image/jpeg;base64,${texture}" x="0" y="0" width="1200" height="630" preserveAspectRatio="xMidYMid slice"/>
  <rect x="0" y="0" width="1200" height="10" fill="${ACCENT}"/>
  ${mark(92, 96, 127)}
  <text x="228" y="200" font-family="${SERIF}" font-size="76" font-weight="600" fill="${INK}" letter-spacing="10">本の地図</text>
  <line x1="96" y1="288" x2="380" y2="288" stroke="${ACCENT}" stroke-width="3"/>
  <text x="96" y="366" font-family="${SERIF}" font-size="40" fill="${INK}" letter-spacing="3">目的から逆算して技術書・ビジネス書を選ぶ</text>
  <text x="96" y="432" font-family="${SANS}" font-size="24" fill="${MUTED}" letter-spacing="1">「何を読むか」ではなく「何のために読むか」から始める選書ガイド</text>
  <text x="96" y="560" font-family="${SANS}" font-size="20" fill="${MUTED}" letter-spacing="4" opacity=".8">miyuki-books.github.io</text>
</svg>`

const png = new Resvg(og, {
  fitTo: { mode: 'width', value: 1200 },
  font: { loadSystemFonts: true, defaultFontFamily: 'Yu Mincho' },
}).render().asPng()
writeFileSync(join(ASSETS, 'og-default.png'), png)

console.log(`assets/og-default.png を生成しました（${(png.length / 1024).toFixed(0)} KB）。`)
