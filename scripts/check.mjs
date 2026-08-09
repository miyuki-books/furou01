#!/usr/bin/env node
// 公開前ガードレール。違反があれば exit 1 で公開をブロックする。
//
// このスクリプトの条件を緩めることは職務規程で禁止されている（CLAUDE.md 参照）。
// プロンプトの指示は確率的に破られるため、法令・規約に関わる担保はここに置いている。
//
//   node scripts/check.mjs                  # content/**/*.md を検査
//   node scripts/check.mjs path/to/file.md  # 個別に検査
//   node scripts/check.mjs --note outbox/note/2026-08-16.txt

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, extname, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const config = JSON.parse(readFileSync(join(ROOT, 'state/config.json'), 'utf8'))

// ---------------------------------------------------------------- ルール定義

// PR表記として認める書き方。どれか1つが本文にあればよい。
const PR_DISCLOSURES = [
  /\[PR\]/,
  /#PR(\s|$)/m,
  /※?\s*本記事(に)?は?アフィリエイトリンクを含みます/,
  /※?\s*(この記事|本記事)は?プロモーションを含み(ます|ます。)/,
  /広告を含みます/,
]

// 一次体験を騙る表現。AI社員は本を読んでいないので、これらは事実に反する。
const FALSE_EXPERIENCE = [
  { re: /読ん(で|だ)(みて)?(とても|本当に)?(感動|感銘|衝撃)/, why: '読了体験の主張' },
  { re: /実際に(読ん|試し|使っ|手に取っ)/, why: '一次体験の主張' },
  { re: /読了(し|した)/, why: '読了の主張' },
  { re: /読み(終え|返し)/, why: '読了の主張' },
  { re: /通読し(た|まし)/, why: '読了の主張' },
  { re: /(この|本)書を手に取(っ|り)/, why: '一次体験の主張' },
  { re: /人生が変わ(っ|り)/, why: '体験に基づく効果の主張' },
  { re: /(私|筆者)(は|が)(この|本)(本|書)(を)?(読|試|使)/, why: '一次体験の主張' },
  { re: /(私|自分|筆者)の?(本棚|積読)/, why: '所有の主張' },
  { re: /座右の書/, why: '一次体験の主張' },
  { re: /何度も(読|見)返/, why: '反復読了の主張' },
]

// AI特有の定型句。1つにつき +2 点。
const AI_CLICHES = [
  /いかがでしたか/,
  /いかがだったでしょうか/,
  /ではないでしょうか/,
  /ではないだろうか/,
  /まとめると[、，]/,
  /重要な(ポイント|点)は\s*[0-9０-９一二三四五六七八九]+\s*つ/,
  /ぜひ参考にして/,
  /最後まで(お)?読ん(で|でいただき)/,
  /この記事では[、，]?.{0,20}を(解説|紹介)します/,
  /と言え(る|ます)でしょう/,
  /してみてはいかがでしょうか/,
  /皆さんも/,
  /〜?を(徹底|完全)(解説|網羅|比較)/,
]

// アフィリエイトネットワークとして扱うホスト。許可リストに無ければブロック。
const AFFILIATE_HOSTS = [
  'hb.afl.rakuten.co.jp',
  'af.moshimo.com',
  'px.a8.net',
  'ck.jp.ap.valuecommerce.com',
  'click.linksynergy.com',
  'ad.jp.ap.valuecommerce.com',
]

const AI_SMELL_THRESHOLD = 5

// 書誌検証に使う。無料・認証不要・日本の書誌データ。
const OPENBD_ENDPOINT = 'https://api.openbd.jp/v1/get?isbn='

// ---------------------------------------------------------------- ユーティリティ

function collectMarkdown(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...collectMarkdown(p))
    else if (extname(p) === '.md') out.push(p)
  }
  return out
}

function stripFrontmatter(raw) {
  // BOM が付いていると frontmatter を丸ごと見落とし、書誌の申告が無いのに素通りしかねない
  const text = raw.replace(/^﻿/, '')
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
  if (!m) return { body: text, meta: {} }

  const meta = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/)
    if (!kv) continue
    let value = kv[2].trim()
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
    }
    meta[kv[1]] = value
  }
  return { body: text.slice(m[0].length), meta }
}

function lineOf(body, index) {
  return body.slice(0, index).split('\n').length
}

// ---------------------------------------------------------------- 各ルール

function checkPrDisclosure(body, violations, { noteMode } = {}) {
  const base = config.links.redirectorBase.replace(/\/$/, '')
  const hasAffiliate =
    /\]\(\/go\//.test(body) ||
    (base && !base.includes('REPLACE-ME') && body.includes(base)) ||
    AFFILIATE_HOSTS.some((h) => body.includes(h))

  // note 側はアフィリエイトリンクを貼らないが、アフィリエイト記事へ誘導する行為自体が
  // ステマ規制の対象になるため、PR表記は無条件で必須にする。
  if (!hasAffiliate && !noteMode) return
  if (PR_DISCLOSURES.some((re) => re.test(body))) return

  violations.push({
    line: 1,
    rule: 'PR表記の欠落',
    detail: noteMode
      ? 'note用出力にPR表記がない。アフィリエイト記事へ誘導する投稿は、リンクを貼らなくてもPR表記が必要（景品表示法第5条第3号）。'
      : 'アフィリエイトリンクを含むのにPR表記がない。景品表示法第5条第3号（令和5年10月1日施行）に違反する。' +
        '「[PR]」または「※本記事はアフィリエイトリンクを含みます」を本文に入れること。',
  })
}

function checkFalseExperience(body, violations) {
  for (const { re, why } of FALSE_EXPERIENCE) {
    const m = body.match(re)
    if (!m) continue
    violations.push({
      line: lineOf(body, m.index),
      rule: '体験詐称表現',
      detail: `「${m[0]}」— ${why}。AI社員は本を読んでいない。選書ガイドの型に書き直すこと（表現を直す。チェックを緩めない）。`,
    })
  }
}

function checkLinks(body, violations) {
  const allowed = new Set(config.links.allowedAffiliateHosts)
  const urlRe = /https?:\/\/([^\s)\]"'<>]+)/g
  let m
  while ((m = urlRe.exec(body)) !== null) {
    let host
    try {
      host = new URL(m[0]).hostname
    } catch {
      continue
    }
    if (AFFILIATE_HOSTS.includes(host) && !allowed.has(host)) {
      violations.push({
        line: lineOf(body, m.index),
        rule: '許可リスト外のアフィリエイトリンク',
        detail: `${host} は state/config.json の allowedAffiliateHosts に無い。`,
      })
    }
    if (/(^|\.)amazon\.(co\.jp|com)$/.test(host) && /[?&]tag=/.test(m[0])) {
      violations.push({
        line: lineOf(body, m.index),
        rule: 'Amazonアソシエイトのタグ付きリンク',
        detail:
          'Amazonアソシエイトは未登録。登録すると180日以内に適格販売3件が必要になるため、登録判断はAI社員が行ってはいけない。',
      })
    }
  }

  // 楽天リンクは必ず自前リダイレクタ経由にする（直リンクだとクリックを計測できない）
  if (body.includes('hb.afl.rakuten.co.jp') && !/\]\(\/go\//.test(body)) {
    violations.push({
      line: lineOf(body, body.indexOf('hb.afl.rakuten.co.jp')),
      rule: 'リダイレクタを経由していない',
      detail: 'アフィリエイトリンクは /go/:id 経由にすること。直リンクではクリックを自分で計測できず、自己改善ループが閉じない。',
    })
  }
}

function checkNoteFormat(body, violations) {
  const lines = body.split('\n')
  lines.forEach((line, i) => {
    if (/^\s*\|.*\|\s*$/.test(line)) {
      violations.push({
        line: i + 1,
        rule: 'note用出力に表が含まれている',
        detail: 'note のエディタは表を解釈できず崩れる。地の文か箇条書きに直すこと。',
      })
    }
    if (/^\s*```/.test(line)) {
      violations.push({
        line: i + 1,
        rule: 'note用出力にコードブロックが含まれている',
        detail: 'note のエディタはコードブロックの貼り付けで崩れる。',
      })
    }
    if (/^\s*\[\^/.test(line)) {
      violations.push({
        line: i + 1,
        rule: 'note用出力に脚注が含まれている',
        detail: 'note は脚注記法を解釈しない。',
      })
    }
  })
}

// 書誌の実在確認。
//
// 文体チェックは事実誤認を検出できない。実際に、実在しない邦題を書いた記事が
// 他の全ルールを通過して公開された。指標3（事実誤認による削除率）は主判定のひとつなので、
// ここもコードで担保する。
//
// frontmatter の books: に ISBN13 を並べさせ、openBD に実在を問い合わせ、
// 返ってきた正式書名が本文に現れているかを照合する。
async function checkBibliography(meta, body, violations) {
  const isbns = (Array.isArray(meta.books) ? meta.books : meta.books ? [meta.books] : [])
    .map((s) => String(s).replace(/[-\s]/g, ''))
    .filter(Boolean)

  if (isbns.length === 0) {
    violations.push({
      line: 1,
      rule: '書誌の申告がない',
      detail:
        'frontmatter に books: [ISBN13, ...] が必要。扱う本の ISBN を並べること。' +
        '実在確認ができない本は扱わない（職務規程 3.）。',
    })
    return
  }

  const bad = isbns.filter((i) => !/^97[89]\d{10}$/.test(i))
  if (bad.length) {
    violations.push({
      line: 1,
      rule: 'ISBN13の形式が不正',
      detail: `${bad.join(', ')} — 978/979 で始まる13桁で書くこと。`,
    })
    return
  }

  let records
  try {
    const res = await fetch(OPENBD_ENDPOINT + isbns.join(','))
    if (!res.ok) throw new Error(`openBD ${res.status}`)
    records = await res.json()
  } catch (e) {
    // 確認できないなら出さない。ネットワーク不通は「たぶん合っている」の根拠にならない。
    violations.push({
      line: 1,
      rule: '書誌を確認できなかった',
      detail: `openBD への問い合わせに失敗（${e.message}）。確認できない以上、公開はブロックする。`,
    })
    return
  }

  isbns.forEach((isbn, i) => {
    const summary = records[i]?.summary
    if (!summary) {
      violations.push({
        line: 1,
        rule: '実在しないISBN',
        detail: `${isbn} は openBD に存在しない。書名・版・出版社を確認し直すこと。`,
      })
      return
    }
    // 「リファクタリング : 既存のコードを安全に改善する」→ 「リファクタリング」で照合する
    const main = String(summary.title || '').split(/[:：]/)[0].trim()
    if (main && !body.includes(main)) {
      violations.push({
        line: 1,
        rule: '本文の書名が書誌と一致しない',
        detail: `${isbn} の正式書名は「${summary.title}」（${summary.publisher} ${summary.pubdate}）だが、本文に「${main}」が出てこない。邦題を捏造していないか確認すること。`,
      })
    }
  })
}

function scoreAiSmell(body) {
  const reasons = []
  let score = 0

  for (const re of AI_CLICHES) {
    const m = body.match(re)
    if (m) {
      score += 2
      reasons.push(`定型句「${m[0]}」`)
    }
  }

  const lines = body.split('\n')
  const contentLines = lines.filter((l) => l.trim() && !/^#{1,6}\s/.test(l))
  const bulletLines = contentLines.filter((l) => /^\s*([-*+]|\d+\.)\s/.test(l))
  if (contentLines.length >= 10) {
    const ratio = bulletLines.length / contentLines.length
    if (ratio > 0.35) {
      score += 3
      reasons.push(`箇条書き比率が高い（${Math.round(ratio * 100)}%）— 地の文で書けるものを箇条書きに逃がしている`)
    }
  }

  const paragraphs = body
    .replace(/^---[\s\S]*?---/, '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !/^#{1,6}\s/.test(p) && !/^\s*([-*+]|\d+\.)\s/.test(p))
  if (paragraphs.length >= 5) {
    const lens = paragraphs.map((p) => p.length)
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length
    const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length)
    const cv = mean === 0 ? 0 : sd / mean
    if (cv < 0.25) {
      score += 2
      reasons.push(`段落長が均一すぎる（変動係数 ${cv.toFixed(2)}）— 人の書き方は揺れる`)
    }
  }

  const firstHeading = body.search(/^#{1,6}\s/m)
  const intro = firstHeading > 0 ? firstHeading : 0
  if (intro > 400) {
    score += 2
    reasons.push(`前置きが長い（最初の見出しまで ${intro} 文字）`)
  }

  return { score, reasons }
}

// ---------------------------------------------------------------- 実行

const args = process.argv.slice(2)
const noteMode = args.includes('--note')
const targets = args.filter((a) => !a.startsWith('--'))
const files = targets.length ? targets : collectMarkdown(join(ROOT, 'content'))

if (files.length === 0) {
  console.log('検査対象のファイルがありません。')
  process.exit(0)
}

let total = 0

for (const file of files) {
  const raw = readFileSync(file, 'utf8')
  const { body, meta } = stripFrontmatter(raw)
  const violations = []

  checkPrDisclosure(body, violations, { noteMode })
  checkFalseExperience(body, violations)
  checkLinks(body, violations)
  if (noteMode) checkNoteFormat(body, violations)
  // note用出力は本文の要約なので、書誌の申告は記事本体（content/）にだけ求める
  else await checkBibliography(meta, body, violations)

  const smell = scoreAiSmell(body)
  if (smell.score >= AI_SMELL_THRESHOLD) {
    violations.push({
      line: 1,
      rule: `AI臭スコア ${smell.score}（閾値 ${AI_SMELL_THRESHOLD}）`,
      detail: smell.reasons.join(' / '),
    })
  }

  const rel = relative(ROOT, file) || file
  if (violations.length === 0) {
    console.log(`OK   ${rel}${smell.score > 0 ? `  (AI臭 ${smell.score})` : ''}`)
    continue
  }

  total += violations.length
  console.log(`\nNG   ${rel}`)
  for (const v of violations.sort((a, b) => a.line - b.line)) {
    console.log(`  ${rel}:${v.line}  [${v.rule}]`)
    console.log(`      ${v.detail}`)
  }
}

if (total > 0) {
  console.log(`\n${total} 件の違反により公開をブロックしました。`)
  console.log('表現を直してください。このスクリプトの条件を緩めることは職務規程で禁止されています。')
  // process.exit() を使わない。openBD への fetch の接続が残った状態で即時終了すると
  // Windows の Node が libuv のアサーションで落ち、終了コードが違反件数と無関係になる。
  process.exitCode = 1
} else {
  console.log(`\n${files.length} ファイル、違反なし。`)
}
