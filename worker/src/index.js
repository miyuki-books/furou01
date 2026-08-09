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

      let links = await loadLinks(env)
      let target = links[id]?.url

      // キャッシュに無いIDなら、404を返す前に取り直す。
      // 新しい記事を公開した直後の数分間は、まさにXから人が来る時間帯であり、
      // キャッシュが古いというだけで取りこぼすのは計測の穴になる。
      if (!target) {
        links = await loadLinks(env, { force: true })
        target = links[id]?.url
      }
      if (!target) return json({ error: 'unknown id', id }, {}, 404)

      // 記録はレスポンスを待たせない。計測のためにユーザーを止めない。
      ctx.waitUntil(recordClick(env, id, request))

      return Response.redirect(target, 302)
    }

    return json({ error: 'not found' }, {}, 404)
  },
}

async function loadLinks(env, { force = false } = {}) {
  const cached = await env.CLICKS.get('cache:links', { type: 'json' })
  if (!force && cached && cached.expiresAt > Date.now()) return cached.links

  try {
    // エッジキャッシュは使わない。KV で自前にキャッシュしているのに二重にすると、
    // TTL がずれて「KVは新しいがエッジが古い」状態が生まれ、新規リンクが404を返し続ける。
    const res = await fetch(`${env.SITE_BASE}/links.json`, { cf: { cacheTtl: 0, cacheEverything: false } })
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

// 1クリック = 1キー。カウンタを読んで+1して書く方式は使わない。
// KV は結果整合性なので、同時クリックが揃って古い値を読み、同じ数字を書き戻して取りこぼす。
// 実測で3クリックが1件になった。キーを分ければ競合しようがなく、集計は件数を数えるだけで済む。
async function recordClick(env, id, request) {
  const day = new Date().toISOString().slice(0, 10)
  const ttl = { expirationTtl: 60 * 60 * 24 * 400 }
  const uid = crypto.randomUUID()
  const encId = encodeURIComponent(id)

  // 実測で、5件同時のとき1件が書き込まれなかった。1度だけ入れ直す。
  // それでも完全ではない。過少計上はありうる前提で読むこと（docs/DESIGN.md 参照）。
  try {
    await env.CLICKS.put(`click:${day}:${encId}:${uid}`, '1', ttl)
  } catch {
    await env.CLICKS.put(`click:${day}:${encId}:${uid}`, '1', ttl)
  }

  // 参照元は記事単位の当たり外れを見るために残す。個人を特定する情報は保存しない。
  const ref = request.headers.get('referer')
  if (ref) {
    try {
      const path = encodeURIComponent(new URL(ref).pathname)
      await env.CLICKS.put(`ref:${day}:${encId}:${path}:${uid}`, '1', ttl)
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

  // キー名を数えるだけ。値を読まないので KV の read も消費しない。
  let cursor
  do {
    const page = await env.CLICKS.list({ prefix: 'click:', cursor })
    for (const k of page.keys) {
      const [, day, encId] = k.name.split(':')
      const id = decodeURIComponent(encId ?? '')
      byDay[day] = (byDay[day] || 0) + 1
      byLink[id] = (byLink[id] || 0) + 1
      total += 1
    }
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)

  let refCursor
  do {
    const page = await env.CLICKS.list({ prefix: 'ref:', cursor: refCursor })
    for (const k of page.keys) {
      const parts = k.name.split(':')
      const path = decodeURIComponent(parts[3] ?? '')
      byReferrer[path] = (byReferrer[path] || 0) + 1
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
