// World customer side (2026-10-23): grant_world_access + /world-customer/* against a fake founder
// database (SQLite behind the D1 API) and a fake KG worker holding a course graph.
// The property that matters: access comes from grants ONLY — a Superadmin without a grant is refused.
//
// Run:  node worker/test-world-customer.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { DatabaseSync } from 'node:sqlite'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'world-customer-'))
for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')
fs.symlinkSync(path.join(dir, 'node_modules'), path.join(tmp, 'node_modules'))
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))
const { handleWorldCustomer } = await import(path.join(tmp, 'world-customer.js'))

let failures = 0
const check = (name, cond, detail) => {
  if (cond) console.log(`ok    ${name}`)
  else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) }
}
const ACCOUNT = 'b68bda52e04081f0cbc04df338a44019'
const COURSE = '27d21ff6-c24e-4717-a818-7792ef562159'

const db = new DatabaseSync(':memory:')
db.exec(`
  CREATE TABLE config (user_id TEXT, email TEXT, Role TEXT, bio TEXT, profileimage TEXT, phone TEXT, phone_verified_at TEXT, data TEXT, cf_account_id TEXT, cf_api_token TEXT);
  CREATE TABLE world_founders (id TEXT, founder_email TEXT, account_holder_email TEXT, hosting_model TEXT, cf_account_id TEXT, domain TEXT, created_at TEXT);
  CREATE TABLE world_commerce_stores (domain TEXT PRIMARY KEY, cf_account_id TEXT, d1_database_id TEXT, d1_database_name TEXT, schema_version INTEGER, status TEXT, provisioned_at TEXT, updated_at TEXT);
`)
db.prepare(`INSERT INTO config (user_id, email, Role) VALUES ('owner-uuid', 'owner@example.com', 'Superadmin')`).run()
db.prepare(`INSERT INTO config (user_id, email, Role, cf_account_id, cf_api_token) VALUES ('s', 'stine.oksvold@gmail.com', 'Admin', ?, 'tok')`).run(ACCOUNT)
db.prepare(`INSERT INTO world_founders VALUES ('wf', 'stine.oksvold@gmail.com', null, 'own_account', ?, 'sodesign.no', '2026-10-15')`).run(ACCOUNT)
db.prepare(`INSERT INTO world_commerce_stores VALUES ('sodesign.no', ?, 'cdb', 'world-commerce-sodesign', 1, 'provisioned', 'x', 'x')`).run(ACCOUNT)
const DB = { prepare(sql) { let a = []; const st = { bind(...x) { a = x; return st }, async first() { return db.prepare(sql).get(...a) ?? null }, async all() { return { results: db.prepare(sql).all(...a) } }, async run() { db.prepare(sql).run(...a); return { success: true } } }; return st } }

const founderDb = new DatabaseSync(':memory:')
founderDb.exec(`
  CREATE TABLE customers (email TEXT PRIMARY KEY, name TEXT, source TEXT, marketing_consent INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE grants (id TEXT PRIMARY KEY, email TEXT NOT NULL, product_ref TEXT NOT NULL, kind TEXT NOT NULL, source TEXT NOT NULL, source_ref TEXT, starts_at TEXT NOT NULL, ends_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL, created_by TEXT, UNIQUE(email, product_ref, source, source_ref));
  CREATE TABLE progress (email TEXT NOT NULL, course_ref TEXT NOT NULL, lesson_ref TEXT NOT NULL, done_at TEXT NOT NULL, PRIMARY KEY (email, course_ref, lesson_ref));
`)
const kgCalls = []
const graph = {
  metadata: { title: 'Enkel hals strikkekurs', description: 'Strikk din første hals' },
  nodes: [
    { id: 'produkt', metadata: { product: { kind: 'course', lessons: 2, duration_s: 315, level: 'nybegynner' } } },
    { id: 'kursbilde', type: 'portfolio-image', path: 'https://cdn.sodesign.no/photos/kurs/enkel-hals/kursbilde.jpg' },
    { id: 'om-kurset', info: 'Om', metadata: { about: { tagline: 'Strikk din første hals, steg for steg' } } },
    { id: 'l01-oppskriften', label: 'Steg 1 av 2 – Oppskriften', info: 'PDF-lenke', metadata: { lesson: { order: 1, type: 'text' } } },
    { id: 'l02-legg-opp', label: 'Steg 2 av 2 – Legg opp', path: 'https://cdn.sodesign.no/photos/kurs/enkel-hals/02-legg-opp.mp4', metadata: { lesson: { order: 2, type: 'video', duration_s: 315 } } },
    { id: 'l02-legg-opp-oppsummering', info: 'Oppsummering' },
    { id: 'l02-legg-opp-transkripsjon', info: 'Transkripsjon' },
  ],
}
const env = {
  DB,
  KG_WORKER: { async fetch(url, init = {}) { kgCalls.push(new Headers(init.headers).get('x-acting-user-email')); return new URL(url).searchParams.get('id') === COURSE ? new Response(JSON.stringify(graph)) : new Response('{}', { status: 404 }) } },
}
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  const p = url.pathname.replace('/client/v4', '')
  if (p === `/accounts/${ACCOUNT}/d1/database/cdb/query`) {
    const b = JSON.parse(init.body); const st = founderDb.prepare(b.sql)
    const results = /^\s*select/i.test(b.sql) ? st.all(...(b.params || [])) : (st.run(...(b.params || [])), [])
    return new Response(JSON.stringify({ success: true, result: [{ results }] }))
  }
  if (p.endsWith('/tokens/verify')) return new Response(JSON.stringify({ success: true, result: { status: 'active' } }))
  return new Response(JSON.stringify({ success: false, errors: [{ message: `unexpected ${p}` }] }), { status: 404 })
}
const as = (email) => async () => ({ authenticated: true, email })
const call = (method, pathq, email, body) => handleWorldCustomer(
  new Request(`https://agent.vegvisr.org${pathq}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }),
  env, new URL(`https://agent.vegvisr.org${pathq}`), {}, as(email))

{
  const me = await (await call('GET', '/world-customer/me?world=sodesign.no', 'torarnehave@gmail.com')).json()
  check('before any grant, Min side is empty — role does not grant anything', Array.isArray(me.products) && me.products.length === 0, JSON.stringify(me))
  const c = await call('GET', `/world-customer/course?world=sodesign.no&graphId=${COURSE}`, 'torarnehave@gmail.com')
  check('a course without a grant is refused (403)', c.status === 403, String(c.status))
}
{
  const r = await executeTool('grant_world_access', { userId: 'owner-uuid', domain: 'sodesign.no', email: 'Torarnehave@gmail.com', product_ref: COURSE, note: 'test customer' }, env)
  check('grant_world_access writes customer + grant and reads it back', r.success === true && r.active === true && founderDb.prepare('SELECT COUNT(*) AS n FROM customers').get().n === 1, JSON.stringify(r).slice(0, 300))
  const nope = await executeTool('grant_world_access', { userId: 's', domain: 'sodesign.no', email: 'x@y.no', product_ref: COURSE }, env)
  check('a non-Superadmin cannot grant', nope.success === false, JSON.stringify(nope))
}
{
  const me = await (await call('GET', '/world-customer/me?world=sodesign.no', 'torarnehave@gmail.com')).json()
  const card = me.products[0] || {}
  check('Min side lists the course card (title, tagline, image, lessons, 0 done)', me.products.length === 1 && card.title === 'Enkel hals strikkekurs' && card.tagline.startsWith('Strikk din') && /kursbilde/.test(card.image) && card.lessons === 2 && card.done === 0, JSON.stringify(me))
  check('the graph is read on the FOUNDER\'s behalf', kgCalls.every((e) => e === 'stine.oksvold@gmail.com'), JSON.stringify(kgCalls))
  const c = await (await call('GET', `/world-customer/course?world=sodesign.no&graphId=${COURSE}`, 'torarnehave@gmail.com')).json()
  check('the course page gets steps in order with video, summary and transcript', c.steps.length === 2 && c.steps[1].video.endsWith('02-legg-opp.mp4') && c.steps[1].summary === 'Oppsummering' && c.steps[1].transcript === 'Transkripsjon', JSON.stringify(c).slice(0, 300))
  const p = await (await call('POST', '/world-customer/progress', 'torarnehave@gmail.com', { world: 'sodesign.no', graphId: COURSE, lesson: 'l02-legg-opp' })).json()
  const me2 = await (await call('GET', '/world-customer/me?world=sodesign.no', 'torarnehave@gmail.com')).json()
  check('«Marker som ferdig» is stored and counted', p.ok === true && me2.products[0].done === 1, JSON.stringify(me2))
  const other = await call('POST', '/world-customer/progress', 'someone@else.no', { world: 'sodesign.no', graphId: COURSE, lesson: 'l02-legg-opp' })
  check('someone without a grant cannot write progress', other.status === 403, String(other.status))
}
{
  await executeTool('grant_world_access', { userId: 'owner-uuid', domain: 'sodesign.no', email: 'torarnehave@gmail.com', product_ref: COURSE, revoke: true }, env)
  const c = await call('GET', `/world-customer/course?world=sodesign.no&graphId=${COURSE}`, 'torarnehave@gmail.com')
  check('a revoked grant closes the course again', c.status === 403, String(c.status))
  const anon = await handleWorldCustomer(new Request('https://a/world-customer/me?world=sodesign.no'), env, new URL('https://a/world-customer/me?world=sodesign.no'), {}, async () => ({ authenticated: false }))
  check('not signed in is 401', anon.status === 401, String(anon.status))
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nall world-customer checks pass')
