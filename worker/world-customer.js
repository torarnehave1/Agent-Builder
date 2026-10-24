// World customer side (2026-10-23): what a signed-in customer of a World owns, and the course content
// behind it. Reads the World's OWN customer database (D1 world-commerce-<stem>, provisioned by
// provision_world_commerce) through Cloudflare's D1 API with the founder's stored token. The platform
// keeps no customer data: every answer is read from the World's database at request time.
//
// Access is decided by `grants` ONLY — never by the caller's platform role. A Superadmin testing as a
// customer sees exactly what a customer sees (and is refused a course without a grant).
//
//   GET  /world-customer/me?world=<domain>                       what I own (course cards)
//   GET  /world-customer/course?world=<domain>&graphId=<id>      one course I own, steps + content
//   POST /world-customer/progress {world, graphId, lesson, done}  tick a step done / undone
//
// Auth: Authorization: Bearer <the user's emailVerificationToken> (what vegvisr-auth stores).

const CF_API = 'https://api.cloudflare.com/client/v4'

export async function commerceContext(env, domain) {
  const d = String(domain || '').trim().toLowerCase()
  if (!d) return { error: 'world is required', status: 400 }
  const store = await env.DB.prepare('SELECT cf_account_id, d1_database_id FROM world_commerce_stores WHERE domain = ?').bind(d).first().catch(() => null)
  if (!store) return { error: `${d} has no customer database`, status: 404 }
  const wf = await env.DB.prepare('SELECT founder_email, account_holder_email FROM world_founders WHERE LOWER(domain) = ? ORDER BY created_at LIMIT 1').bind(d).first().catch(() => null)
  if (!wf) return { error: `no World ${d}`, status: 404 }
  // The token whose account matches the store: founder first, then the account holder.
  for (const email of [wf.founder_email, wf.account_holder_email].filter(Boolean)) {
    const row = await env.DB.prepare('SELECT cf_account_id, cf_api_token FROM config WHERE LOWER(email) = ?').bind(String(email).toLowerCase()).first().catch(() => null)
    if (row && row.cf_api_token && String(row.cf_account_id || '').trim() === store.cf_account_id) {
      return { domain: d, founderEmail: String(wf.founder_email).toLowerCase(), account: store.cf_account_id, dbId: store.d1_database_id, token: row.cf_api_token }
    }
  }
  return { error: `no stored Cloudflare token for ${d}'s account`, status: 500 }
}

export async function commerceQuery(ctx, sql, params = []) {
  const r = await fetch(`${CF_API}/accounts/${ctx.account}/d1/database/${ctx.dbId}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ctx.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.success === false) {
    const msg = (j.errors && j.errors[0] && j.errors[0].message) || `HTTP ${r.status}`
    throw new Error(`customer database query failed: ${msg}`)
  }
  return ((j.result || [])[0] || {}).results || []
}

// Active grants of one customer. product_ref is the product graph's id.
export async function activeGrants(ctx, email) {
  const now = new Date().toISOString()
  return commerceQuery(ctx,
    `SELECT product_ref, kind, source, starts_at, ends_at FROM grants
     WHERE LOWER(email) = ? AND revoked_at IS NULL AND starts_at <= ? AND (ends_at IS NULL OR ends_at > ?)`,
    [String(email).toLowerCase(), now, now])
}

// The founder's World graph, read on the founder's behalf (the KG worker honours the acting header
// on the service binding only). The customer never gets KG access; only the fields below leave here.
async function readWorldGraph(env, ctx, graphId) {
  const res = await env.KG_WORKER.fetch(`https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(graphId)}`, {
    headers: { 'x-acting-user-email': ctx.founderEmail },
  })
  if (!res.ok) return null
  return res.json()
}

const node = (g, id) => (g.nodes || []).find((n) => n.id === id)

function courseCard(graphId, g, doneCount) {
  const p = (node(g, 'produkt') || {}).metadata?.product || {}
  const about = (node(g, 'om-kurset') || {}).metadata?.about || {}
  const img = node(g, 'kursbilde')
  const total = p.lessons || 0
  return {
    graphId, title: g.metadata?.title || '', tagline: about.tagline || g.metadata?.description || '',
    image: img ? img.path : null, level: p.level || about.level || null, lessons: total,
    duration_s: p.duration_s || 0, done: doneCount, kind: p.kind || 'course',
  }
}

// The steps of a course, in order, with what the lesson page shows.
function courseContent(graphId, g, doneSet) {
  const steps = (g.nodes || [])
    .filter((n) => n.metadata && n.metadata.lesson && n.visible !== false)
    .sort((a, b) => a.metadata.lesson.order - b.metadata.lesson.order)
    .map((n) => {
      const l = n.metadata.lesson
      const summary = node(g, `${n.id}-oppsummering`)
      const transcript = node(g, `${n.id}-transkripsjon`)
      return {
        id: n.id, order: l.order, title: n.label, type: l.type,
        video: l.type === 'video' ? n.path : null, duration_s: l.duration_s || 0,
        text: l.type === 'video' ? '' : n.info || '',
        summary: summary ? summary.info : '', transcript: transcript ? transcript.info : '',
        done: doneSet.has(n.id),
      }
    })
  return { ...courseCard(graphId, g, steps.filter((s) => s.done).length), about: (node(g, 'om-kurset') || {}).info || '', steps }
}

const json = (body, status, cors) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

export async function handleWorldCustomer(request, env, url, cors, resolveCaller) {
  const caller = await resolveCaller(request, env).catch(() => null)
  if (!caller || !caller.authenticated || !caller.email) return json({ error: 'not signed in' }, 401, cors)
  const email = String(caller.email).toLowerCase()
  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {}
  const world = url.searchParams.get('world') || body.world
  const ctx = await commerceContext(env, world)
  if (ctx.error) return json({ error: ctx.error }, ctx.status, cors)

  try {
    const grants = await activeGrants(ctx, email)
    const owned = new Set(grants.map((g) => g.product_ref))

    if (url.pathname === '/world-customer/me' && request.method === 'GET') {
      const progress = await commerceQuery(ctx, 'SELECT course_ref, COUNT(*) AS n FROM progress WHERE LOWER(email) = ? GROUP BY course_ref', [email])
      const doneBy = Object.fromEntries(progress.map((r) => [r.course_ref, Number(r.n)]))
      const products = []
      for (const ref of owned) {
        const g = await readWorldGraph(env, ctx, ref)
        if (g) products.push(courseCard(ref, g, doneBy[ref] || 0))
      }
      return json({ world: ctx.domain, email, products }, 200, cors)
    }

    const graphId = url.searchParams.get('graphId') || body.graphId
    if (!graphId) return json({ error: 'graphId is required' }, 400, cors)
    // grants only — never role
    if (!owned.has(graphId)) return json({ error: 'no access to this course' }, 403, cors)

    if (url.pathname === '/world-customer/course' && request.method === 'GET') {
      const g = await readWorldGraph(env, ctx, graphId)
      if (!g) return json({ error: 'course not found' }, 404, cors)
      const done = await commerceQuery(ctx, 'SELECT lesson_ref FROM progress WHERE LOWER(email) = ? AND course_ref = ?', [email, graphId])
      return json(courseContent(graphId, g, new Set(done.map((r) => r.lesson_ref))), 200, cors)
    }

    if (url.pathname === '/world-customer/progress' && request.method === 'POST') {
      const lesson = String(body.lesson || '').trim()
      if (!lesson) return json({ error: 'lesson is required' }, 400, cors)
      if (body.done === false) {
        await commerceQuery(ctx, 'DELETE FROM progress WHERE LOWER(email) = ? AND course_ref = ? AND lesson_ref = ?', [email, graphId, lesson])
      } else {
        await commerceQuery(ctx, 'INSERT OR REPLACE INTO progress (email, course_ref, lesson_ref, done_at) VALUES (?, ?, ?, ?)', [email, graphId, lesson, new Date().toISOString()])
      }
      return json({ ok: true, lesson, done: body.done !== false }, 200, cors)
    }
    return json({ error: 'not found' }, 404, cors)
  } catch (e) {
    return json({ error: e.message }, 502, cors)
  }
}
