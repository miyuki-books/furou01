#!/usr/bin/env node
// 30日目の中間判定レポートを作って Slack に投げる。
//
// 指標の集計は AI社員にやらせない。自分の成績を自分で報告させると、
// 「順調です」と書いて終わる余地が残る。ここはコードで数えて、判断だけ人間に渡す。
//
// 判定日を過ぎていて、まだ報告していないときだけ動く。それ以外は何もしない。
//
//   node scripts/midterm.mjs
//   node scripts/midterm.mjs --force   # 日付に関係なく1回出す（動作確認用）

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const CONFIG_PATH = join(ROOT, 'state/config.json')
const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
const health = JSON.parse(readFileSync(join(ROOT, 'state/health.json'), 'utf8'))

const force = process.argv.includes('--force')
const review = config.midtermReview
// startedAt は JST の日付で入れているので、比較も JST に揃える。
// UTC で比較すると日付が1日ずれ、判定日や集計範囲が静かに狂う。
const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)

if (!review) {
  console.log('midtermReview が設定されていません。')
  process.exit(0)
}
if (!force && (review.reported || today < review.date)) {
  console.log(`中間判定は ${review.date}（報告済み: ${review.reported}）。今日は何もしません。`)
  process.exit(0)
}

const since = config.startedAt
const days = Math.max(1, Math.round((Date.parse(today) - Date.parse(since)) / 86400000) || 1)
const weeks = days / 7

// --- 人間の介入回数：ai-staff[bot] 以外のコミット数で数える -------------------
//
// 日付ではなく開始時点のコミットを基準にする。--since は実行環境のタイムゾーンに
// 依存するので、JST で入れた startedAt と突き合わせると境界で1日ぶん取りこぼす。
let humanCommits = null
let humanCommitList = []
try {
  const range = config.startCommit ? [`${config.startCommit}..HEAD`] : [`--since=${since}`]
  const log = execFileSync(
    'git',
    ['log', ...range, '--pretty=format:%an\t%s', '--no-merges'],
    { cwd: ROOT, encoding: 'utf8' }
  )
  const rows = log.split('\n').filter(Boolean).map((l) => l.split('\t'))
  humanCommitList = rows.filter(([author]) => author !== 'ai-staff[bot]')
  humanCommits = humanCommitList.length
} catch (e) {
  console.warn(`git log を読めませんでした（${e.message}）。介入回数は計測不能として報告します。`)
}

// --- ワークフローの失敗回数 ---------------------------------------------------
let failedRuns = null
const repo = process.env.GITHUB_REPOSITORY
const token = process.env.GITHUB_TOKEN
if (repo && token) {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/actions/runs?status=failure&created=%3E%3D${since}&per_page=100`,
      { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' } }
    )
    if (res.ok) failedRuns = (await res.json()).total_count
  } catch {
    // 取得できなくても本体は続ける
  }
}

// --- 記事と破棄 ---------------------------------------------------------------
const articles = existsSync(join(ROOT, 'content'))
  ? readdirSync(join(ROOT, 'content')).filter((f) => f.endsWith('.md')).length
  : 0
// セットアップ中に破棄したものは実験の成績ではない。開始日以降だけを数える。
const discarded = (health.discarded || []).filter((d) => !d.at || d.at.slice(0, 10) >= since).length
const discardRate = articles + discarded === 0 ? 0 : discarded / (articles + discarded)

// --- 決定履歴 -----------------------------------------------------------------
const decisionLines = existsSync(join(ROOT, 'state/decisions.jsonl'))
  ? readFileSync(join(ROOT, 'state/decisions.jsonl'), 'utf8').trim().split('\n').filter(Boolean)
  : []
// 指標4はAI社員の自己改善サイクル数なので、人間が書いた行は数えない。
// 混ぜると、人間が設計変更するたびにAIの成績が上がってしまう。
let decisions = 0
let variableChanges = 0
let humanDecisions = 0
for (const l of decisionLines) {
  try {
    const d = JSON.parse(l)
    if (d.by === 'human') {
      humanDecisions++
      continue
    }
    decisions++
    if (d.change) variableChanges++
  } catch {
    // 壊れた行は数えない
  }
}

// --- クリック -----------------------------------------------------------------
let clicks = null
const base = config.links.redirectorBase.replace(/\/$/, '')
if (base && !base.includes('REPLACE-ME')) {
  try {
    const res = await fetch(`${base}/stats.json`)
    if (res.ok) clicks = (await res.json()).totalClicks
  } catch {
    // 取得できなければ計測不能として報告する
  }
}

// --- 判定 ---------------------------------------------------------------------
const c = review.criteria
const mark = (ok) => (ok === null ? '?' : ok ? 'PASS' : 'FAIL')

const results = [
  {
    name: '計画外介入（人間のコミット）',
    value: humanCommits === null ? '計測不能' : `${humanCommits} 回 / ${days}日（週あたり ${(humanCommits / weeks).toFixed(1)}）`,
    ok: humanCommits === null ? null : humanCommits / weeks <= c.maxHumanCommitsPerWeek,
  },
  {
    name: 'ワークフロー失敗',
    value: failedRuns === null ? '計測不能' : `${failedRuns} 回`,
    ok: null,
  },
  {
    name: '削除率（事実誤認・規約違反）',
    value: `${discarded} / ${articles + discarded} 本（${(discardRate * 100).toFixed(0)}%）`,
    ok: discardRate <= c.maxDiscardRate,
  },
  {
    name: '決定履歴（AI社員のみ）',
    value: `${decisions} 行（うち変数を動かした回 ${variableChanges}）${humanDecisions ? ` ／ 人間の決定 ${humanDecisions} 行は除外` : ''}`,
    ok: decisions >= c.minDecisions && variableChanges >= c.minVariableChanges,
  },
  {
    name: '外への到達（クリック）',
    value: clicks === null ? '計測不能' : `${clicks} 件`,
    ok: clicks === null ? null : clicks >= c.minClicks,
  },
]

const judged = results.filter((r) => r.ok !== null)
const failed = judged.filter((r) => !r.ok)

let verdict
if (humanCommits !== null && humanCommits / weeks > c.maxHumanCommitsPerWeek) {
  verdict = `打ち切りを推奨。${review.actions.tooManyInterventions}`
} else if (clicks !== null && clicks < c.minClicks && failed.length === 1) {
  verdict = `方針転換の判断が必要。${review.actions.worksButNoClicks}`
} else if (failed.length === 0) {
  verdict = `継続を推奨。${review.actions.allPass}`
} else {
  verdict = '基準を複数満たしていません。個別に原因を見てください。'
}

const report = [
  `【中間判定】実験開始から ${days} 日（${since} 〜 ${today}）`,
  '',
  ...results.map((r) => `${mark(r.ok).padEnd(4)} ${r.name}: ${r.value}`),
  '',
  `記事数: ${articles} 本`,
  '',
  `判定: ${verdict}`,
  '',
  '※ この集計はコードで行っています（AI社員の自己申告ではありません）。',
  '※ 継続・打ち切り・方針転換の判断は人間が行ってください。実験は判断があるまで動き続けます。',
  humanCommitList.length
    ? `\n人間のコミット:\n${humanCommitList.map(([a, s]) => `  - ${s}`).join('\n')}`
    : '',
]
  .filter((l) => l !== '')
  .join('\n')

console.log(report)

try {
  execFileSync(process.execPath, [join(ROOT, 'scripts/notify.mjs'), report], { stdio: 'inherit' })
} catch (e) {
  console.error(`Slack への通知に失敗しました: ${e.message}`)
}

if (!force) {
  config.midtermReview.reported = true
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8')
  console.log('\n報告済みとして記録しました。次回以降は何もしません。')
}
