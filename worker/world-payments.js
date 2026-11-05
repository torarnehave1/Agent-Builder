// World payments (2026-11-05, decided «A»): every payment a World has taken — card (Stripe) and Vipps
// — one row each, with the customer's e-mail, in the World's OWN customer database (table
// `payments`, founder's Cloudflare account). The dashboard computes every figure from these rows at
// request time, so a new question (a month, a product, a period) needs no new hand-made table.
//
//   POST /world-payments/import   {world, payments:[...]}             upsert by id (≤ 500 per call)
//   GET  /world-payments/overview ?world=&today=YYYY-MM-DD             kpis, months, years, cohorts, …
//   GET  /world-payments/products ?world=&from=&to=&source=card|vipps  what was sold in a period
//   GET  /world-payments/status   ?world=                              rows and date range per source
//
// Who may: the World's founder, its account holder or the system owner (mayHoldContacts) — the same
// rule as its contacts and reports. Responses carry aggregates only, never an e-mail address.
// Auth: Authorization: Bearer <emailVerificationToken> or X-API-Token.

import { commerceContext, commerceQuery } from './world-customer.js'
import { mayHoldContacts } from './world-contacts.js'

export const MAX_IMPORT = 500
const MAX_SQL = 90_000
const SOURCES = ['card', 'vipps']
const KINDS = ['one_off', 'subscription']
const DATE_RE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/

const json = (body, status, cors) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

function lit(v) {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  return `'${String(v).replace(/\u0000/g, '').replace(/'/g, "''")}'`
}

export async function ensurePaymentsTable(ctx) {
  await commerceQuery(ctx, `CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY, source TEXT NOT NULL, paid_at TEXT NOT NULL, amount REAL NOT NULL, refunded REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'nok', product TEXT NOT NULL, kind TEXT NOT NULL, email TEXT, imported_at TEXT NOT NULL)`)
  await commerceQuery(ctx, 'CREATE INDEX IF NOT EXISTS ix_payments_paid_at ON payments (paid_at)')
  await commerceQuery(ctx, 'CREATE INDEX IF NOT EXISTS ix_payments_email ON payments (email)')
}

async function hasPayments(ctx) {
  const t = await commerceQuery(ctx, "SELECT name FROM sqlite_master WHERE type='table' AND name='payments'")
  return t.length > 0
}

// One incoming payment → a row, or an error naming what is wrong. amount is what was paid; refunded
// is subtracted in every figure.
export function paymentRow(p) {
  const id = String(p.id || '').trim()
  if (!id || id.length > 120) return { error: 'id is required' }
  const source = String(p.source || '').toLowerCase()
  if (!SOURCES.includes(source)) return { error: `source must be ${SOURCES.join(' or ')}` }
  const paid_at = String(p.paid_at || '').trim()
  if (!DATE_RE.test(paid_at)) return { error: `paid_at must look like 2026-10-31 or 2026-10-31 12:00:00 (got ${JSON.stringify(paid_at).slice(0, 40)})` }
  const amount = Number(p.amount), refunded = Number(p.refunded || 0)
  if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(refunded) || refunded < 0) return { error: 'amount and refunded must be numbers ≥ 0' }
  const kind = String(p.kind || '').toLowerCase()
  if (!KINDS.includes(kind)) return { error: `kind must be ${KINDS.join(' or ')}` }
  const product = String(p.product || '').trim().slice(0, 200)
  if (!product) return { error: 'product is required' }
  const email = p.email ? String(p.email).trim().toLowerCase().slice(0, 200) : null
  return { row: { id, source, paid_at, amount, refunded, currency: String(p.currency || 'nok').toLowerCase().slice(0, 8), product, kind, email } }
}

export async function importPayments(ctx, list) {
  const rows = []
  for (let i = 0; i < list.length; i++) {
    const r = paymentRow(list[i] || {})
    if (r.error) return { error: `payment ${i + 1}: ${r.error}` }
    rows.push(r.row)
  }
  await ensurePaymentsTable(ctx)
  const now = new Date().toISOString()
  const cols = ['id', 'source', 'paid_at', 'amount', 'refunded', 'currency', 'product', 'kind', 'email', 'imported_at']
  const head = `INSERT INTO payments (${cols.join(', ')}) VALUES `
  const tail = ' ON CONFLICT(id) DO UPDATE SET ' + cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')
  let batch = [], size = head.length + tail.length
  const flush = async () => { if (batch.length) { await commerceQuery(ctx, head + batch.join(', ') + tail); batch = []; size = head.length + tail.length } }
  for (const r of rows) {
    const v = `(${cols.map((c) => lit(c === 'imported_at' ? now : r[c])).join(', ')})`
    if (size + v.length + 2 > MAX_SQL) await flush()
    batch.push(v); size += v.length + 2
  }
  await flush()
  const [{ n }] = await commerceQuery(ctx, 'SELECT COUNT(*) AS n FROM payments')
  return { written: rows.length, total: Number(n) }
}

const NET = '(amount - refunded)'
const monthsBack = (today, k) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - k); return d.toISOString().slice(0, 10) }

export async function overview(ctx, today) {
  const t = DATE_RE.test(String(today || '')) ? String(today).slice(0, 10) : new Date().toISOString().slice(0, 10)
  const from12 = monthsBack(t, 12), from24 = monthsBack(t, 24), monthStart = monthsBack(t, 0)
  const q = (sql, p = []) => commerceQuery(ctx, sql, p)
  const [tot] = await q(`SELECT COUNT(*) AS payments, ROUND(SUM(${NET})) AS revenue, COUNT(DISTINCT email) AS customers, MIN(paid_at) AS first, MAX(paid_at) AS last FROM payments WHERE ${NET} > 0`)
  const bySource = await q(`SELECT source, COUNT(*) AS payments, ROUND(SUM(${NET})) AS revenue FROM payments WHERE ${NET} > 0 GROUP BY source`)
  const onlyVipps = await q(`SELECT COUNT(*) AS n FROM (SELECT email FROM payments WHERE ${NET} > 0 AND email IS NOT NULL GROUP BY email HAVING SUM(source = 'card') = 0)`)
  const [last12] = await q(`SELECT ROUND(SUM(${NET})) AS revenue, ROUND(SUM(CASE WHEN source='vipps' THEN ${NET} ELSE 0 END)) AS vipps FROM payments WHERE paid_at >= ? AND paid_at < ?`, [from12, monthStart])
  const [prev12] = await q(`SELECT ROUND(SUM(${NET})) AS revenue FROM payments WHERE paid_at >= ? AND paid_at < ?`, [from24, from12])
  const active = await q(`SELECT source, COUNT(DISTINCT email) AS members, ROUND(SUM(${NET})) AS revenue FROM payments WHERE kind = 'subscription' AND ${NET} > 0 AND paid_at >= date(?, '-35 days') GROUP BY source`, [t])
  const months = await q(`SELECT substr(paid_at, 1, 7) AS month, source, ROUND(SUM(${NET})) AS revenue, COUNT(*) AS payments FROM payments WHERE ${NET} > 0 GROUP BY month, source ORDER BY month`)
  const years = await q(`SELECT substr(paid_at, 1, 4) AS year, kind, ROUND(SUM(${NET})) AS revenue FROM payments WHERE ${NET} > 0 GROUP BY year, kind ORDER BY year`)
  const cohorts = await q(`SELECT substr(first, 1, 4) AS year, COUNT(*) AS customers, ROUND(SUM(total)) AS revenue FROM (SELECT email, MIN(paid_at) AS first, SUM(${NET}) AS total FROM payments WHERE ${NET} > 0 AND email IS NOT NULL GROUP BY email) GROUP BY year ORDER BY year`)
  const buckets = await q(`SELECT CASE WHEN total < 200 THEN 1 WHEN total < 500 THEN 2 WHEN total < 1000 THEN 3 WHEN total < 3000 THEN 4 ELSE 5 END AS b, COUNT(*) AS customers FROM (SELECT email, SUM(${NET}) AS total FROM payments WHERE ${NET} > 0 AND email IS NOT NULL GROUP BY email) GROUP BY b ORDER BY b`)
  const freq = await q(`SELECT CASE WHEN n >= 6 THEN 6 ELSE n END AS times, COUNT(*) AS customers FROM (SELECT email, COUNT(*) AS n FROM payments WHERE ${NET} > 0 AND email IS NOT NULL GROUP BY email) GROUP BY times ORDER BY times`)
  return { today: t, from12, totals: tot, bySource, onlyVipps: Number(onlyVipps[0]?.n || 0), last12, prev12, active, months, years, cohorts, buckets, freq }
}

export async function products(ctx, { from, to, source }) {
  const where = [`${NET} > 0`], p = []
  if (from) { if (!DATE_RE.test(from)) return { error: 'from must be a date like 2020-04-01' }; where.push('paid_at >= ?'); p.push(from) }
  if (to) { if (!DATE_RE.test(to)) return { error: 'to must be a date like 2020-05-01' }; where.push('paid_at < ?'); p.push(to) }
  if (source) { if (!SOURCES.includes(source)) return { error: `source must be ${SOURCES.join(' or ')}` }; where.push('source = ?'); p.push(source) }
  const w = where.join(' AND ')
  const rows = await commerceQuery(ctx, `SELECT product, COUNT(*) AS payments, ROUND(SUM(${NET})) AS revenue, ROUND(AVG(${NET})) AS avg, MIN(${NET}) AS min_price, MAX(${NET}) AS max_price FROM payments WHERE ${w} GROUP BY product ORDER BY revenue DESC LIMIT 60`, p)
  const [tot] = await commerceQuery(ctx, `SELECT COUNT(*) AS payments, ROUND(SUM(${NET})) AS revenue, COUNT(DISTINCT email) AS customers FROM payments WHERE ${w}`, p)
  const days = await commerceQuery(ctx, `SELECT substr(paid_at, 1, 10) AS day, COUNT(*) AS payments FROM payments WHERE ${w} GROUP BY day ORDER BY payments DESC, day LIMIT 1`, p)
  return { from: from || null, to: to || null, source: source || null, totals: tot, busiestDay: days[0] || null, products: rows }
}

export async function handleWorldPayments(request, env, url, cors, resolveCaller) {
  let req = request
  const xTok = request.headers.get('X-API-Token')
  if (xTok && !request.headers.get('Authorization')) {
    const h = new Headers(request.headers); h.set('Authorization', `Bearer ${xTok}`)
    req = new Request(request.url, { method: 'GET', headers: h })
  }
  const caller = await resolveCaller(req, env).catch(() => null)
  if (!caller || !caller.authenticated || !caller.email) return json({ success: false, error: 'not signed in' }, 401, cors)
  const who = { email: String(caller.email).toLowerCase(), role: caller.role || '' }
  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {}
  const gate = await mayHoldContacts(env, who, url.searchParams.get('world') || body.world)
  if (!gate.ok) return json({ success: false, error: gate.error }, gate.status, cors)
  const ctx = await commerceContext(env, gate.domain)
  if (ctx.error) return json({ success: false, error: ctx.error }, ctx.status, cors)
  try {
    if (url.pathname === '/world-payments/import' && request.method === 'POST') {
      const list = Array.isArray(body.payments) ? body.payments : null
      if (!list || !list.length) return json({ success: false, error: 'payments must be a non-empty array' }, 400, cors)
      if (list.length > MAX_IMPORT) return json({ success: false, error: `at most ${MAX_IMPORT} payments per call` }, 400, cors)
      const r = await importPayments(ctx, list)
      if (r.error) return json({ success: false, error: r.error }, 400, cors)
      return json({ success: true, world: gate.domain, ...r }, 200, cors)
    }
    if (request.method !== 'GET') return json({ success: false, error: 'not found' }, 404, cors)
    if (!(await hasPayments(ctx))) return json({ success: false, error: `${gate.domain} has no payments yet` }, 404, cors)
    if (url.pathname === '/world-payments/overview') return json({ success: true, world: gate.domain, ...(await overview(ctx, url.searchParams.get('today'))) }, 200, cors)
    if (url.pathname === '/world-payments/products') {
      const r = await products(ctx, { from: url.searchParams.get('from'), to: url.searchParams.get('to'), source: url.searchParams.get('source') })
      return r.error ? json({ success: false, error: r.error }, 400, cors) : json({ success: true, world: gate.domain, ...r }, 200, cors)
    }
    if (url.pathname === '/world-payments/status') {
      const rows = await commerceQuery(ctx, 'SELECT source, COUNT(*) AS rows, MIN(paid_at) AS first, MAX(paid_at) AS last, ROUND(SUM(amount - refunded)) AS revenue FROM payments GROUP BY source')
      return json({ success: true, world: gate.domain, sources: rows }, 200, cors)
    }
    return json({ success: false, error: 'not found' }, 404, cors)
  } catch (e) {
    return json({ success: false, error: e.message }, 502, cors)
  }
}
