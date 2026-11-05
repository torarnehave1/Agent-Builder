// World reports (2026-11-05): numbers a founder must see but the world must not — e.g. the sales
// dashboard on dashboard.sodesign.no. The published page carries NO numbers; it fetches them here
// after sign-in. A report is one JSON document per key, stored in the World's OWN customer database
// (table `reports`, in the founder's Cloudflare account). Not in a graph: a World graph can be read
// by any Superadmin through the KG worker.
//
//   GET  /world-reports/get?world=<domain>&key=<key>      the report, for founder/holder/system owner
//   POST /world-reports/save {world, key, data}            replace it (same people)
//
// Who may: the World's founder, its account holder or the system owner (mayHoldContacts) — the same
// rule as the World's contacts (decided 2026-11-05, «A»). A Superadmin as such may not.
// Auth: Authorization: Bearer <emailVerificationToken> or X-API-Token.

import { commerceContext, commerceQuery } from './world-customer.js'
import { mayHoldContacts } from './world-contacts.js'

export const MAX_REPORT_BYTES = 200_000
const KEY_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/

const json = (body, status, cors) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

async function ensureReportsTable(ctx) {
  await commerceQuery(ctx, 'CREATE TABLE IF NOT EXISTS reports (key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT)')
}

export async function readReport(env, who, world, key) {
  const gate = await mayHoldContacts(env, who, world)
  if (!gate.ok) return { status: gate.status, body: { success: false, error: gate.error } }
  if (!KEY_RE.test(String(key || ''))) return { status: 400, body: { success: false, error: 'key must be a short name like "dashboard"' } }
  const ctx = await commerceContext(env, gate.domain)
  if (ctx.error) return { status: ctx.status, body: { success: false, error: ctx.error } }
  const has = await commerceQuery(ctx, "SELECT name FROM sqlite_master WHERE type='table' AND name='reports'")
  if (!has.length) return { status: 404, body: { success: false, error: `${gate.domain} has no report "${key}" yet` } }
  const rows = await commerceQuery(ctx, 'SELECT data, updated_at FROM reports WHERE key = ?', [key])
  if (!rows.length) return { status: 404, body: { success: false, error: `${gate.domain} has no report "${key}" yet` } }
  let data = null
  try { data = JSON.parse(rows[0].data) } catch { return { status: 500, body: { success: false, error: 'the stored report is not valid JSON' } } }
  return { status: 200, body: { success: true, world: gate.domain, key, updated_at: rows[0].updated_at, data } }
}

export async function writeReport(env, who, world, key, data) {
  const gate = await mayHoldContacts(env, who, world)
  if (!gate.ok) return { status: gate.status, body: { success: false, error: gate.error } }
  if (!KEY_RE.test(String(key || ''))) return { status: 400, body: { success: false, error: 'key must be a short name like "dashboard"' } }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { status: 400, body: { success: false, error: 'data must be a JSON object' } }
  const text = JSON.stringify(data)
  if (text.length > MAX_REPORT_BYTES) return { status: 400, body: { success: false, error: `the report is ${text.length} bytes; at most ${MAX_REPORT_BYTES}` } }
  const ctx = await commerceContext(env, gate.domain)
  if (ctx.error) return { status: ctx.status, body: { success: false, error: `${ctx.error}. Run provision_world_commerce for ${gate.domain}.` } }
  await ensureReportsTable(ctx)
  const now = new Date().toISOString()
  await commerceQuery(ctx, 'INSERT INTO reports (key, data, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by', [key, text, now, who.email])
  const back = await commerceQuery(ctx, 'SELECT data, updated_at FROM reports WHERE key = ?', [key])
  const same = back.length && back[0].data === text
  return {
    status: same ? 200 : 500,
    body: same
      ? { success: true, world: gate.domain, key, updated_at: back[0].updated_at, bytes: text.length, message: `Saved report "${key}" for ${gate.domain} (${text.length} bytes) in its own database and read it back. Only its founder, account holder and the system owner can read it.` }
      : { success: false, error: 'saved, but reading the report back did not match' },
  }
}

export async function handleWorldReports(request, env, url, cors, resolveCaller) {
  let req = request
  const xTok = request.headers.get('X-API-Token')
  if (xTok && !request.headers.get('Authorization')) {
    const h = new Headers(request.headers); h.set('Authorization', `Bearer ${xTok}`)
    req = new Request(request.url, { method: 'GET', headers: h })
  }
  const caller = await resolveCaller(req, env).catch(() => null)
  if (!caller || !caller.authenticated || !caller.email) return json({ success: false, error: 'not signed in' }, 401, cors)
  const who = { email: String(caller.email).toLowerCase(), role: caller.role || '' }
  try {
    if (url.pathname === '/world-reports/get' && request.method === 'GET') {
      const r = await readReport(env, who, url.searchParams.get('world'), url.searchParams.get('key') || 'dashboard')
      return json(r.body, r.status, cors)
    }
    if (url.pathname === '/world-reports/save' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const r = await writeReport(env, who, body.world, body.key || 'dashboard', body.data)
      return json(r.body, r.status, cors)
    }
    return json({ success: false, error: 'not found' }, 404, cors)
  } catch (e) {
    return json({ success: false, error: e.message }, 502, cors)
  }
}

// Agent tool: save_world_report {domain, key, data}. The caller is the signed-in user (userId).
export async function executeSaveWorldReport(input, env) {
  if (!input.userId) return { success: false, error: 'No user context available — sign in and retry.' }
  const row = await env.DB.prepare('SELECT email, Role FROM config WHERE user_id = ? OR LOWER(email) = LOWER(?) LIMIT 1').bind(input.userId, input.userId).first().catch(() => null)
  if (!row || !row.email) return { success: false, error: 'Could not resolve the signed-in user.' }
  let data = input.data
  if (typeof data === 'string') { try { data = JSON.parse(data) } catch { return { success: false, error: 'data must be a JSON object' } } }
  const r = await writeReport(env, { email: String(row.email).toLowerCase(), role: row.Role }, input.domain, input.key || 'dashboard', data)
  return r.body
}
