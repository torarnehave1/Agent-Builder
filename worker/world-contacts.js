// World contacts (2026-10-26): a World's contact list — the people the founder knows (Kajabi contacts
// with their tags, Google contacts), kept in the World's OWN customer database (table `contacts`,
// schema 2 of provision_world_commerce) in the founder's Cloudflare account. The platform stores no
// contact: every call reads or writes the founder's database through the D1 API (world-customer.js).
//
// The Contacts app (contacts.vegvisr.org) uses this when a World is chosen instead of «Mine».
// Columns match the app's own contacts table, so the app sends the same records either way.
//
//   GET  /world-contacts/worlds                         the Worlds this caller may work in
//   GET  /world-contacts/list?world=&offset=&limit=     a page of contacts (limit ≤ 2000)
//   POST /world-contacts/import {world, contacts, source}   ≤ 250 per call; merged on e-mail
//   POST /world-contacts/update {world, id, record}
//   POST /world-contacts/delete {world, id}
//
// Who may: the World's founder or account holder, a Superadmin, or a system owner (mayBuildIn — the
// same rule as /world-photos/token and /world-course/*).
// Auth: Authorization: Bearer <emailVerificationToken> or X-API-Token.

import { commerceContext, commerceQuery } from './world-customer.js'
import { mayBuildIn } from './world-course.js'

export const CONTACT_COLUMNS = ['full_name', 'first_name', 'middle_name', 'last_name', 'nickname', 'birthday',
  'notes', 'photo', 'labels', 'emails', 'phones', 'addresses', 'websites', 'organization']
const JSON_ARRAYS = ['labels', 'emails', 'phones', 'addresses', 'websites']
const MAX_IMPORT = 250
const MAX_PAGE = 2000
const MAX_SQL = 90_000 // D1 refuses a statement over 100 KB

const json = (body, status, cors) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const nowIso = () => new Date().toISOString()
const uuid = () => crypto.randomUUID()

// A value as a SQLite literal. Only strings, finite numbers and null reach here.
function lit(v) {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  return `'${String(v).replace(/\u0000/g, '').replace(/'/g, "''")}'`
}

const parseArr = (v) => {
  if (Array.isArray(v)) return v
  try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : [] } catch { return [] }
}
const parseObj = (v) => {
  if (v && typeof v === 'object') return v
  try { const o = JSON.parse(v || '{}'); return o && typeof o === 'object' ? o : {} } catch { return {} }
}
const str = (v) => (v === null || v === undefined ? '' : String(v)).trim()
const primaryEmail = (emails) => {
  const first = parseArr(emails).map((e) => str(e && e.value).toLowerCase()).find((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
  return first || null
}

// The app's Contact object (camelCase) → a row in the World's table.
export function contactToRow(c) {
  const org = c.organization || {}
  return {
    full_name: str(c.fullName) || [c.firstName, c.middleName, c.lastName].map(str).filter(Boolean).join(' ') || 'Unnamed Contact',
    first_name: str(c.firstName), middle_name: str(c.middleName), last_name: str(c.lastName),
    nickname: str(c.nickname), birthday: str(c.birthday), notes: str(c.notes), photo: str(c.photo),
    labels: [...new Set((c.labels || []).map(str).filter(Boolean))],
    emails: (c.emails || []).filter((e) => e && str(e.value)).map((e) => ({ label: str(e.label) || 'Other', value: str(e.value) })),
    phones: (c.phones || []).filter((p) => p && str(p.value)).map((p) => ({ label: str(p.label) || 'Mobile', value: str(p.value) })),
    addresses: (c.addresses || []).filter((a) => a && (str(a.formatted) || str(a.street))),
    websites: (c.websites || []).filter((w) => w && str(w.value)),
    organization: { name: str(org.name), title: str(org.title), department: str(org.department) },
  }
}

// Merge an incoming row into an existing one: nothing a person wrote is lost. Labels, e-mails, phones,
// addresses and websites are unions; a blank field takes the incoming value; notes are kept and the
// incoming notes appended only when they are new.
export function mergeRows(have, add) {
  const out = { ...have }
  for (const k of ['full_name', 'first_name', 'middle_name', 'last_name', 'nickname', 'birthday', 'photo']) {
    if (!str(out[k]) || (k === 'full_name' && out[k] === 'Unnamed Contact')) out[k] = add[k] || out[k] || ''
  }
  const hn = str(have.notes), an = str(add.notes)
  out.notes = !hn ? an : (an && !hn.includes(an) ? `${hn}\n${an}` : hn)
  const union = (a, b, key) => {
    const seen = new Set(); const res = []
    for (const x of [...parseArr(a), ...parseArr(b)]) {
      const id = key(x); if (!id || seen.has(id)) continue
      seen.add(id); res.push(x)
    }
    return res
  }
  out.labels = union(have.labels, add.labels, (x) => str(x))
  out.emails = union(have.emails, add.emails, (x) => str(x && x.value).toLowerCase())
  out.phones = union(have.phones, add.phones, (x) => str(x && x.value).replace(/[\s-]/g, ''))
  out.addresses = union(have.addresses, add.addresses, (x) => str(x && (x.formatted || x.street)).toLowerCase())
  out.websites = union(have.websites, add.websites, (x) => str(x && x.value).toLowerCase())
  const ho = parseObj(have.organization), ao = parseObj(add.organization)
  out.organization = { name: ho.name || ao.name || '', title: ho.title || ao.title || '', department: ho.department || ao.department || '' }
  return out
}

// A row as the app reads it (drizzle shape: JSON columns as strings, `_id` as the id).
function rowOut(r) {
  const o = { _id: r.id }
  for (const k of CONTACT_COLUMNS) o[k] = r[k] ?? ''
  o.source = r.source || ''
  o.created_at = r.created_at; o.updated_at = r.updated_at
  return o
}

async function hasContactsTable(ctx) {
  const r = await commerceQuery(ctx, `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'contacts'`)
  return r.length > 0
}

// Write rows (already merged) in as few statements as fit under the size limit.
async function upsertRows(ctx, rows) {
  const cols = ['id', 'email', ...CONTACT_COLUMNS, 'source', 'created_at', 'updated_at']
  const updates = ['email', ...CONTACT_COLUMNS, 'updated_at'].map((c) => `${c} = excluded.${c}`).join(', ')
  const head = `INSERT INTO contacts (${cols.join(', ')}) VALUES `
  const tail = ` ON CONFLICT(id) DO UPDATE SET ${updates}`
  let batch = []
  let size = head.length + tail.length
  const flush = async () => {
    if (!batch.length) return
    await commerceQuery(ctx, head + batch.join(', ') + tail)
    batch = []; size = head.length + tail.length
  }
  for (const r of rows) {
    const values = `(${cols.map((c) => {
      const v = r[c]
      return lit(JSON_ARRAYS.includes(c) || c === 'organization' ? JSON.stringify(v ?? (c === 'organization' ? {} : [])) : v)
    }).join(', ')})`
    if (values.length + head.length + tail.length > MAX_SQL) throw new Error(`one contact is larger than ${MAX_SQL} bytes`)
    if (size + values.length + 2 > MAX_SQL) await flush()
    batch.push(values); size += values.length + 2
  }
  await flush()
}

async function importContacts(ctx, list, source) {
  const now = nowIso()
  const incoming = list.map((c) => {
    const row = contactToRow(c)
    return { row, email: primaryEmail(row.emails) }
  })
  // Existing rows for the e-mails in this batch (IN lists under D1's 100-parameter limit).
  const emails = [...new Set(incoming.map((x) => x.email).filter(Boolean))]
  const existing = new Map()
  for (let i = 0; i < emails.length; i += 90) {
    const part = emails.slice(i, i + 90)
    const rows = await commerceQuery(ctx, `SELECT * FROM contacts WHERE email IN (${part.map(() => '?').join(', ')})`, part)
    for (const r of rows) existing.set(r.email, r)
  }
  const pending = new Map() // email → row to write (merged with the database and with earlier rows of this batch)
  const writes = []
  const ids = []
  let inserted = 0, merged = 0
  for (const { row, email } of incoming) {
    if (email && pending.has(email)) {
      const p = pending.get(email)
      Object.assign(p, mergeRows(p, row), { id: p.id, email, source: p.source, created_at: p.created_at, updated_at: now })
      merged++; ids.push(p.id); continue
    }
    if (email && existing.has(email)) {
      const h = existing.get(email)
      const m = { ...mergeRows(h, row), id: h.id, email, source: h.source, created_at: h.created_at, updated_at: now }
      pending.set(email, m); writes.push(m); merged++; ids.push(h.id); continue
    }
    const r = { ...row, id: uuid(), email, source: source || 'import', created_at: now, updated_at: now }
    if (email) pending.set(email, r)
    writes.push(r); inserted++; ids.push(r.id)
  }
  await upsertRows(ctx, writes)
  return { inserted, merged, ids }
}

export async function handleWorldContacts(request, env, url, cors, resolveCaller) {
  // The Contacts app sends X-API-Token; the shared resolver reads Authorization.
  // Only the headers are copied: building a Request from `request` would take its body, and the
  // import's {world, contacts} would then read as empty (bug found live 2026-10-26).
  let req = request
  const xTok = request.headers.get('X-API-Token')
  if (xTok && !request.headers.get('Authorization')) {
    const h = new Headers(request.headers); h.set('Authorization', `Bearer ${xTok}`)
    req = new Request(request.url, { method: 'GET', headers: h })
  }
  const caller = await resolveCaller(req, env).catch(() => null)
  if (!caller || !caller.authenticated || !caller.email) return json({ success: false, error: 'not signed in' }, 401, cors)
  const who = { email: String(caller.email).toLowerCase(), role: caller.role || '' }

  if (url.pathname === '/world-contacts/worlds' && request.method === 'GET') {
    const stores = await env.DB.prepare('SELECT domain FROM world_commerce_stores ORDER BY domain').all().catch(() => ({ results: [] }))
    const worlds = []
    for (const s of stores.results || []) {
      const gate = await mayBuildIn(env, who, s.domain)
      if (!gate.ok) continue
      const wf = await env.DB.prepare('SELECT world_name FROM world_founders WHERE LOWER(domain) = ? ORDER BY created_at LIMIT 1').bind(s.domain).first().catch(() => null)
      worlds.push({ domain: s.domain, name: (wf && wf.world_name) || s.domain })
    }
    return json({ success: true, worlds }, 200, cors)
  }

  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {}
  const world = url.searchParams.get('world') || body.world
  const gate = await mayBuildIn(env, who, world)
  if (!gate.ok) return json({ success: false, error: gate.error }, gate.status, cors)
  const ctx = await commerceContext(env, gate.domain)
  if (ctx.error) return json({ success: false, error: `${ctx.error}. Run provision_world_commerce for ${gate.domain}.` }, ctx.status, cors)

  try {
    if (!(await hasContactsTable(ctx))) {
      return json({ success: false, error: `${gate.domain}'s customer database has no contacts table yet. Run provision_world_commerce for ${gate.domain} (schema 2).` }, 409, cors)
    }

    if (url.pathname === '/world-contacts/list' && request.method === 'GET') {
      const offset = Math.max(0, parseInt(url.searchParams.get('offset')) || 0)
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit')) || 500, 1), MAX_PAGE)
      const [{ n }] = await commerceQuery(ctx, 'SELECT COUNT(*) AS n FROM contacts')
      const rows = await commerceQuery(ctx, 'SELECT * FROM contacts ORDER BY full_name COLLATE NOCASE, id LIMIT ? OFFSET ?', [limit, offset])
      return json({ success: true, world: gate.domain, total: Number(n), offset, limit, records: rows.map(rowOut) }, 200, cors)
    }

    if (url.pathname === '/world-contacts/import' && request.method === 'POST') {
      const list = Array.isArray(body.contacts) ? body.contacts : null
      if (!list || !list.length) return json({ success: false, error: 'contacts must be a non-empty array' }, 400, cors)
      if (list.length > MAX_IMPORT) return json({ success: false, error: `at most ${MAX_IMPORT} contacts per call; send the rest in further calls` }, 400, cors)
      const r = await importContacts(ctx, list, String(body.source || 'import').slice(0, 40))
      const [{ n }] = await commerceQuery(ctx, 'SELECT COUNT(*) AS n FROM contacts')
      return json({ success: true, world: gate.domain, ...r, total: Number(n) }, 200, cors)
    }

    if (url.pathname === '/world-contacts/update' && request.method === 'POST') {
      const id = str(body.id)
      const rec = body.record && typeof body.record === 'object' ? body.record : null
      if (!id || !rec) return json({ success: false, error: 'id and record are required' }, 400, cors)
      const keys = Object.keys(rec).filter((k) => CONTACT_COLUMNS.includes(k))
      if (!keys.length) return json({ success: false, error: `record has no known field (${CONTACT_COLUMNS.join(', ')})` }, 400, cors)
      const vals = keys.map((k) => (typeof rec[k] === 'string' ? rec[k] : JSON.stringify(rec[k] ?? null)))
      const sets = keys.map((k) => `${k} = ?`)
      if (keys.includes('emails')) { sets.push('email = ?'); vals.push(primaryEmail(rec.emails)) }
      sets.push('updated_at = ?'); vals.push(nowIso())
      await commerceQuery(ctx, `UPDATE contacts SET ${sets.join(', ')} WHERE id = ?`, [...vals, id])
      const back = await commerceQuery(ctx, 'SELECT * FROM contacts WHERE id = ?', [id])
      if (!back.length) return json({ success: false, error: 'no such contact' }, 404, cors)
      return json({ success: true, record: rowOut(back[0]) }, 200, cors)
    }

    if (url.pathname === '/world-contacts/delete' && request.method === 'POST') {
      const id = str(body.id)
      if (!id) return json({ success: false, error: 'id is required' }, 400, cors)
      await commerceQuery(ctx, 'DELETE FROM contacts WHERE id = ?', [id])
      return json({ success: true, id }, 200, cors)
    }

    return json({ success: false, error: 'not found' }, 404, cors)
  } catch (e) {
    return json({ success: false, error: e.message }, 502, cors)
  }
}
