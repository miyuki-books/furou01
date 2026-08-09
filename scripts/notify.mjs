#!/usr/bin/env node
// Slack への通知。
//
// claude.ai の Slack コネクタは無人実行では使えない（CLAUDE_CODE_OAUTH_TOKEN による実行では
// claude.ai connectors を取得できないため）。したがって Incoming Webhook を使う。
//
//   node scripts/notify.mjs "メッセージ"
//   echo "メッセージ" | node scripts/notify.mjs

const url = process.env.SLACK_WEBHOOK_URL

async function readStdin() {
  if (process.stdin.isTTY) return ''
  const chunks = []
  for await (const c of process.stdin) chunks.push(c)
  return Buffer.concat(chunks).toString('utf8')
}

const text = (process.argv.slice(2).join(' ') || (await readStdin())).trim()

if (!text) {
  console.error('メッセージが空です。')
  process.exit(1)
}

if (!url) {
  // ローカル実行やセットアップ前に落とさない。ただし黙って捨てない。
  console.warn('SLACK_WEBHOOK_URL が未設定のため、通知せず標準出力に流します:')
  console.log(text)
  process.exit(0)
}

const res = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ text }),
})

if (!res.ok) {
  console.error(`Slack への通知に失敗しました: ${res.status} ${await res.text()}`)
  process.exit(1)
}

console.log('Slack へ通知しました。')
