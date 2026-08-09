// クリック計測リダイレクタ
//
// 目的：AI社員が「効いたか」を自分で読めるようにすること。
// GA4 も楽天のレポート画面も認証が必要で、無人のAI社員は自力で数字を取れない。
// 認証なしで読める /stats.json をここで用意することで、自己改善ループが閉じる。
//
//   GET /go/:id      → 楽天アフィリエイトURLへ302。クリックを1件記録する
//   GET /stats.json  → 集計値を返す（公開。クリック数に秘密性はない）
//   GET /health      → 生存確認
//
// リンク定義は site/links.json（GitHub Pages 上の公開ファイル）から読む。
// こうしておくと、AI社員がリンクを増やしてもWorkerを再デプロイしなくてよい。

const LINKS_TTL_SECONDS = 300

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return json({ ok: true })
    }

    if (url.pathname === '/stats.json') {
      return json(await buildStats(env), { 'cache-control': 'public, max-age=60' })
    }

    if (url.pathname.startsWith('/go/')) {
      const id = decodeURIComponent(url.pathname.slice('/go/'.length)).replace(/\/$/, '')
      if (!id) return json({ error: 'missing id' }, {}, 400)

      const links = await loadLinks(env)
      const target = links[id]?.url
      if (!target) return json({ error: 'unknown id', id }, {}, 404)

      // 記録はレスポンスを待たせない。計測のためにユーザーを止めない。
      ctx.waitUntil(recordClick(env, id, request))

      return Response.redirect(target, 302)
    }

    return json({ error: 'not found' }, {}, 404)
  },
}

async function loadLinks(env) {
  const cached = await env.CLICKS.get('cache:links', { type: 'json' })
  if (cached && cached.expiresAt > Date.now()) return cached.links

  try {
    const res = await fetch(`${env.SITE_BASE}/links.json`, {
      cf: { cacheTtl: LINKS_TTL_SECONDS, cacheEverything: true },
    })
    if (!res.ok) throw new Error(`links.json ${res.status}`)
    const links = await res.json()
    await env.CLICKS.put(
      'cache:links',
      JSON.stringify({ links, expiresAt: Date.now() + LINKS_TTL_SECONDS * 1000 }),
      { expirationTtl: 3600 }
    )
    return links
  } catch (e) {
    // 取得に失敗したら、期限切れでも直前のキャッシュを使う。リンク切れよりマシ。
    if (cached) return cached.links
    throw e
  }
}

async function recordClick(env, id, request) {
  const day = new Date().toISOString().slice(0, 10)
  const key = `click:${day}:${id}`
  const current = parseInt((await env.CLICKS.get(key)) || '0', 10)
  await env.CLICKS.put(key, String(current + 1), { expirationTtl: 60 * 60 * 24 * 400 })

  // 参照元は記事単位の当たり外れを見るために残す。個人を特定する情報は保存しない。
  const ref = request.headers.get('referer')
  if (ref) {
    try {
      const path = new URL(ref).pathname
      const refKey = `ref:${day}:${id}:${path}`
      const refCount = parseInt((await env.CLICKS.get(refKey)) || '0', 10)
      await env.CLICKS.put(refKey, String(refCount + 1), { expirationTtl: 60 * 60 * 24 * 400 })
    } catch {
      // 参照元が壊れていても計測本体は落とさない
    }
  }
}

async function buildStats(env) {
  const byDay = {}
  const byLink = {}
  const byReferrer = {}
  let total = 0

  let cursor
  do {
    const page = await env.CLICKS.list({ prefix: 'click:', cursor })
    for (const k of page.keys) {
      const [, day, ...rest] = k.name.split(':')
      const id = rest.join(':')
      const n = parseInt((await env.CLICKS.get(k.name)) || '0', 10)
      byDay[day] = (byDay[day] || 0) + n
      byLink[id] = (byLink[id] || 0) + n
      total += n
    }
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)

  let refCursor
  do {
    const page = await env.CLICKS.list({ prefix: 'ref:', cursor: refCursor })
    for (const k of page.keys) {
      const parts = k.name.split(':')
      const path = parts.slice(3).join(':')
      const n = parseInt((await env.CLICKS.get(k.name)) || '0', 10)
      byReferrer[path] = (byReferrer[path] || 0) + n
    }
    refCursor = page.list_complete ? undefined : page.cursor
  } while (refCursor)

  return {
    generatedAt: new Date().toISOString(),
    totalClicks: total,
    byDay,
    byLink,
    byReferrer,
  }
}

function json(body, headers = {}, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  })
}
