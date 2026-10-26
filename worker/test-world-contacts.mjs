// World contacts (2026-10-26): /world-contacts/* against a fake founder database (SQLite behind the
// D1 API). Properties: only the founder / holder / Superadmin / system owner may; contacts with the same
// e-mail merge (labels joined, nothing written by a person lost); quotes in values survive; the platform
// database gets no contact row.
//
// Run:  node worker/test-world-contacts.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { DatabaseSync } from 'node:sqlite'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'world-contacts-'))
for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')
fs.symlinkSync(path.join(dir, 'node_modules'), path.join(tmp, 'node_modules'))
const { handleWorldContacts } = await import(path.join(tmp, 'world-contacts.js'))
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))

let failures = 0
const check = (name, cond, detail) => {
  if (cond) console.log(`ok    ${name}`)
  else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) }
}
const ACCOUNT = 'b68bda52e04081f0cbc04df338a44019'

const db = new DatabaseSync(':memory:')
db.exec(`
  CREATE TABLE config (user_id TEXT, email TEXT, Role TEXT, bio TEXT, profileimage TEXT, phone TEXT, phone_verified_at TEXT, data TEXT, cf_account_id TEXT, cf_api_token TEXT);
  CREATE TABLE world_founders (id TEXT, founder_email TEXT, account_holder_email TEXT, hosting_model TEXT, cf_account_id TEXT, domain TEXT, world_name TEXT, created_at TEXT);
  CREATE TABLE world_commerce_stores (domain TEXT PRIMARY KEY, cf_account_id TEXT, d1_database_id TEXT, d1_database_name TEXT, schema_version INTEGER, status TEXT, provisioned_at TEXT, updated_at TEXT);
  CREATE TABLE system_owners (email TEXT);
`)
db.prepare(`INSERT INTO config (user_id, email, Role, cf_account_id, cf_api_token) VALUES ('s', 'stine.oksvold@gmail.com', 'Admin', ?, 'tok')`).run(ACCOUNT)
db.prepare(`INSERT INTO world_founders VALUES ('wf', 'stine.oksvold@gmail.com', null, 'own_account', ?, 'sodesign.no', 'Stine Oksvold Design', '2026-10-15')`).run(ACCOUNT)
db.prepare(`INSERT INTO world_commerce_stores VALUES ('sodesign.no', ?, 'cdb', 'world-commerce-sodesign', 1, 'provisioned', 'x', 'x')`).run(ACCOUNT)
db.prepare(`INSERT INTO system_owners VALUES ('owner@example.com')`).run()
const DB = { prepare(sql) { let a = []; const st = { bind(...x) { a = x; return st }, async first() { return db.prepare(sql).get(...a) ?? null }, async all() { return { results: db.prepare(sql).all(...a) } }, async run() { db.prepare(sql).run(...a); return { success: true } } }; return st } }

const founderDb = new DatabaseSync(':memory:')
const queries = []
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  const p = url.pathname.replace('/client/v4', '')
  if (p === `/accounts/${ACCOUNT}/d1/database/cdb/query`) {
    const b = JSON.parse(init.body); queries.push(b.sql)
    if (b.sql.length > 100_000) return new Response(JSON.stringify({ success: false, errors: [{ message: 'statement too long' }] }), { status: 400 })
    try {
      const st = founderDb.prepare(b.sql)
      const results = /^\s*select/i.test(b.sql) ? st.all(...(b.params || [])) : (st.run(...(b.params || [])), [])
      return new Response(JSON.stringify({ success: true, result: [{ results }] }))
    } catch (e) { return new Response(JSON.stringify({ success: false, errors: [{ message: e.message }] }), { status: 400 }) }
  }
  if (p === `/accounts/${ACCOUNT}/d1/database` && (init.method || 'GET') === 'GET') return new Response(JSON.stringify({ success: true, result: [{ name: 'world-commerce-sodesign', uuid: 'cdb' }] }))
  if (p === `/accounts/${ACCOUNT}/d1/database/cdb`) return new Response(JSON.stringify({ success: true, result: { jurisdiction: 'eu' } }))
  if (p.endsWith('/tokens/verify')) return new Response(JSON.stringify({ success: true, result: { status: 'active' } }))
  return new Response(JSON.stringify({ success: false, errors: [{ message: `unexpected ${p}` }] }), { status: 404 })
}
const env = { DB }
const as = (email, role = '') => async () => ({ authenticated: true, email, role })
const call = async (method, pathq, who, body) => {
  const res = await handleWorldContacts(
    new Request(`https://agent.vegvisr.org${pathq}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }),
    env, new URL(`https://agent.vegvisr.org${pathq}`), {}, who)
  return { status: res.status, body: await res.json() }
}
const OWNER = as('owner@example.com')
const STRANGER = as('someone@example.com')

// Before schema 2: a clear refusal that names the fix.
founderDb.exec(`CREATE TABLE customers (email TEXT PRIMARY KEY, name TEXT, source TEXT, marketing_consent INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
{
  const r = await call('GET', '/world-contacts/list?world=sodesign.no', OWNER)
  check('no contacts table → 409 naming provision_world_commerce', r.status === 409 && /provision_world_commerce/.test(r.body.error), JSON.stringify(r))
}

// Schema 2 through the real tool (as Superadmin).
db.prepare(`INSERT INTO config (user_id, email, Role) VALUES ('sa', 'super@example.com', 'Superadmin')`).run()
{
  const r = await executeTool('provision_world_commerce', { domain: 'sodesign.no', userId: 'sa' }, env)
  const t = founderDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='contacts'`).get()
  check('provision_world_commerce adds the contacts table (schema 2)', r.success && t && r.schema_version === 2, JSON.stringify(r).slice(0, 400))
}

{
  const r = await call('GET', '/world-contacts/worlds', OWNER)
  check('system owner sees sodesign.no in the World list', r.body.worlds?.length === 1 && r.body.worlds[0].name === 'Stine Oksvold Design', JSON.stringify(r))
  const s = await call('GET', '/world-contacts/worlds', STRANGER)
  check('a stranger sees no World', s.body.worlds?.length === 0, JSON.stringify(s))
  const l = await call('GET', '/world-contacts/list?world=sodesign.no', STRANGER)
  check('a stranger is refused the list (403)', l.status === 403, JSON.stringify(l))
  const f = await call('GET', '/world-contacts/list?world=sodesign.no', as('stine.oksvold@gmail.com'))
  check('the founder may read her list', f.status === 200, JSON.stringify(f))
}

const c = (name, email, labels, extra = {}) => ({ fullName: name, firstName: name.split(' ')[0], lastName: '', emails: email ? [{ label: 'Kajabi', value: email }] : [], labels, phones: [], addresses: [], websites: [], organization: {}, notes: '', ...extra })
{
  const r = await call('POST', '/world-contacts/import', OWNER, { world: 'sodesign.no', source: 'kajabi', contacts: [
    c("Kari O'Hara", 'KARI@example.com', ['Fjellgenseren', 'Samtykke'], { notes: 'Kajabi-kontakt 1' }),
    c('Ola', 'ola@example.com', ['Kurs']),
    c('Uten e-post', '', ['Kurs']),
    c('Kari again', 'kari@example.com', ['Kurs']),
  ] })
  check('import: 3 new, 1 merged within the batch', r.body.inserted === 3 && r.body.merged === 1 && r.body.total === 3, JSON.stringify(r.body))
  const row = founderDb.prepare(`SELECT * FROM contacts WHERE email = 'kari@example.com'`).get()
  check("quote in a name survives, labels joined", row.full_name === "Kari O'Hara" && JSON.parse(row.labels).join('|') === 'Fjellgenseren|Samtykke|Kurs', JSON.stringify(row))
}
{
  // Google import of the same person later: merged into the existing row, notes kept.
  const r = await call('POST', '/world-contacts/import', OWNER, { world: 'sodesign.no', source: 'google', contacts: [
    c('Kari Nordmann', 'kari@example.com', ['Venner'], { phones: [{ label: 'Mobile', value: '+47 900 00 000' }], notes: 'Fra Google' }),
  ] })
  const row = founderDb.prepare(`SELECT * FROM contacts WHERE email = 'kari@example.com'`).get()
  check('second import merges: phone added, label added, notes appended, name kept', r.body.merged === 1 && r.body.inserted === 0
    && JSON.parse(row.phones).length === 1 && JSON.parse(row.labels).includes('Venner') && row.notes === 'Kajabi-kontakt 1\nFra Google' && row.full_name === "Kari O'Hara", JSON.stringify(row))
}
{
  const list = await call('GET', '/world-contacts/list?world=sodesign.no&limit=2', OWNER)
  check('list pages: total 3, page of 2, drizzle shape (_id, JSON strings)', list.body.total === 3 && list.body.records.length === 2 && typeof list.body.records[0]._id === 'string' && typeof list.body.records[0].labels === 'string', JSON.stringify(list.body).slice(0, 300))
  const id = founderDb.prepare(`SELECT id FROM contacts WHERE email = 'ola@example.com'`).get().id
  const u = await call('POST', '/world-contacts/update', OWNER, { world: 'sodesign.no', id, record: { labels: JSON.stringify(['Kurs', 'VIP']), role: 'x' } })
  check('update writes known fields only', u.status === 200 && JSON.parse(u.body.record.labels).includes('VIP'), JSON.stringify(u))
  const d = await call('POST', '/world-contacts/delete', OWNER, { world: 'sodesign.no', id })
  const left = founderDb.prepare('SELECT COUNT(*) AS n FROM contacts').get().n
  check('delete removes one', d.status === 200 && left === 2, `left ${left}`)
}
{
  // Many rows: split into statements under D1's size limit.
  queries.length = 0
  const many = Array.from({ length: 250 }, (_, i) => c(`Person ${i}`, `p${i}@example.com`, ['Kurs', 'Samtykke'], { notes: 'x'.repeat(500) }))
  const r = await call('POST', '/world-contacts/import', OWNER, { world: 'sodesign.no', contacts: many })
  const inserts = queries.filter((q) => /^INSERT INTO contacts/.test(q))
  check('250 contacts in one call → several statements, all under 100 KB', r.body.inserted === 250 && inserts.length > 1 && inserts.every((q) => q.length < 100_000), `${JSON.stringify(r.body).slice(0, 200)} statements ${inserts.length}`)
  const over = await call('POST', '/world-contacts/import', OWNER, { world: 'sodesign.no', contacts: [...many, c('one more', 'x@example.com', [])] })
  check('more than 250 per call → 400', over.status === 400, JSON.stringify(over.body))
}
{
  // The Contacts app sends X-API-Token, not Authorization: the POST body must still arrive.
  let seenAuth = null
  const viaToken = async (req) => { seenAuth = req.headers.get('Authorization'); return { authenticated: true, email: 'owner@example.com' } }
  const res = await handleWorldContacts(
    new Request('https://agent.vegvisr.org/world-contacts/import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Token': 'tok123' },
      body: JSON.stringify({ world: 'sodesign.no', source: 'kajabi', contacts: [c('Via token', 'token@example.com', ['Kurs'])] }) }),
    env, new URL('https://agent.vegvisr.org/world-contacts/import'), {}, viaToken)
  const b = await res.json()
  check('POST with X-API-Token keeps its body (world + contacts arrive)', res.status === 200 && b.inserted === 1 && seenAuth === 'Bearer tok123', `${res.status} ${JSON.stringify(b)} auth=${seenAuth}`)
}
{
  // Feature profile: default, relation rule, and the tool that changes it.
  const w = (await call('GET', '/world-contacts/worlds', OWNER)).body.worlds[0]
  check('operator: default profile, e-mail and rooms off (they would act as the operator)',
    w.relation === 'operator' && w.features.email === false && w.features.rooms === false && w.features.sms === false && w.features.reports === false, JSON.stringify(w))
  const f = (await call('GET', '/world-contacts/worlds', as('stine.oksvold@gmail.com'))).body.worlds[0]
  check('founder: e-mail and rooms on, sms/reports/register_user/photo off',
    f.relation === 'founder' && f.features.email && f.features.rooms && !f.features.sms && !f.features.reports && !f.features.register_user && !f.features.photo, JSON.stringify(f))
  const set = await executeTool('set_world_app_features', { domain: 'sodesign.no', userId: 'sa', features: { photo: true, rooms: false } }, env)
  const f2 = (await call('GET', '/world-contacts/worlds', as('stine.oksvold@gmail.com'))).body.worlds[0]
  check('set_world_app_features changes only the switches passed, read back by the app',
    set.success && f2.features.photo === true && f2.features.rooms === false && f2.features.email === true && f2.features.sms === false, JSON.stringify({ set, f2 }))
  check('photo is on for the founder but off for an operator (it uploads to the caller\'s storage)',
    (await call('GET', '/world-contacts/worlds', OWNER)).body.worlds[0].features.photo === false, 'operator photo not off')
  const notYet = await executeTool('set_world_app_features', { domain: 'sodesign.no', userId: 'sa', features: { logs: true } }, env)
  check('logs cannot be switched on in a World yet', !notYet.success && /cannot be switched on/.test(notYet.error), JSON.stringify(notYet))
  const bad = await executeTool('set_world_app_features', { domain: 'sodesign.no', userId: 'sa', features: { teleport: true } }, env)
  check('unknown switch refused', !bad.success && /unknown feature/.test(bad.error), JSON.stringify(bad))
  const nonSuper = await executeTool('set_world_app_features', { domain: 'sodesign.no', userId: 's', features: { sms: true } }, env)
  check('non-Superadmin refused', !nonSuper.success, JSON.stringify(nonSuper))
}
{
  const { worldOriginCors } = await import(path.join(tmp, 'world-contacts.js'))
  const base = { 'Access-Control-Allow-Origin': '' }
  const o = (origin) => worldOriginCors(new Request('https://agent.vegvisr.org/world-contacts/worlds', { headers: { Origin: origin } }), env, base)
  check('CORS: contacts.sodesign.no is allowed', (await o('https://contacts.sodesign.no'))['Access-Control-Allow-Origin'] === 'https://contacts.sodesign.no', '')
  check('CORS: the apex of a World is allowed', (await o('https://sodesign.no'))['Access-Control-Allow-Origin'] === 'https://sodesign.no', '')
  check('CORS: an unknown domain is not', (await o('https://evil.example.com'))['Access-Control-Allow-Origin'] === '', '')
  check('CORS: a look-alike is not (sodesign.no.evil.com)', (await o('https://sodesign.no.evil.com'))['Access-Control-Allow-Origin'] === '', '')
  check('CORS: http is not', (await o('http://contacts.sodesign.no'))['Access-Control-Allow-Origin'] === '', '')
}
{
  const platformRows = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%contact%'`).all()
  check('platform database has no contacts table', platformRows.length === 0, JSON.stringify(platformRows))
}

console.log(failures ? `\n${failures} failure(s)` : '\nall passed')
process.exit(failures ? 1 : 0)
