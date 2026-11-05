// World reports (2026-11-05): the dashboard's numbers live in the World's own database and are
// handed out only to its founder, account holder or the system owner — never to another Superadmin
// and never without sign-in. Drives the real handler against a fake D1 API.
//
// Run:  node worker/test-world-reports.mjs   (exit 0 = pass, 1 = fail)

import { DatabaseSync } from 'node:sqlite'
import { handleWorldReports, executeSaveWorldReport, MAX_REPORT_BYTES } from './world-reports.js'

let failures = 0
const check = (name, cond, detail) => {
  if (cond) console.log(`ok    ${name}`)
  else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) }
}
const ACCOUNT = 'b68bda52e04081f0cbc04df338a44019'

const db = new DatabaseSync(':memory:')
db.exec(`
  CREATE TABLE config (user_id TEXT, email TEXT, Role TEXT, cf_account_id TEXT, cf_api_token TEXT);
  CREATE TABLE world_founders (id TEXT, founder_email TEXT, account_holder_email TEXT, hosting_model TEXT, cf_account_id TEXT, domain TEXT, world_name TEXT, created_at TEXT);
  CREATE TABLE world_commerce_stores (domain TEXT PRIMARY KEY, cf_account_id TEXT, d1_database_id TEXT);
  CREATE TABLE system_owners (email TEXT);
`)
db.prepare(`INSERT INTO config VALUES ('stine', 'stine.oksvold@gmail.com', 'Admin', ?, 'tok')`).run(ACCOUNT)
db.prepare(`INSERT INTO config VALUES ('owner', 'owner@example.com', 'Superadmin', null, null)`).run()
db.prepare(`INSERT INTO config VALUES ('super', 'super@example.com', 'Superadmin', null, null)`).run()
db.prepare(`INSERT INTO world_founders VALUES ('wf', 'stine.oksvold@gmail.com', 'holder@example.com', 'own_account', ?, 'sodesign.no', 'Stine Oksvold Design', '2026-10-15')`).run(ACCOUNT)
db.prepare(`INSERT INTO world_commerce_stores VALUES ('sodesign.no', ?, 'cdb')`).run(ACCOUNT)
db.prepare(`INSERT INTO system_owners VALUES ('owner@example.com')`).run()
const DB = { prepare(sql) { let a = []; const st = { bind(...x) { a = x; return st }, async first() { return db.prepare(sql).get(...a) ?? null }, async all() { return { results: db.prepare(sql).all(...a) } }, async run() { db.prepare(sql).run(...a); return { success: true } } }; return st } }

const founderDb = new DatabaseSync(':memory:')
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  const p = url.pathname.replace('/client/v4', '')
  if (p === `/accounts/${ACCOUNT}/d1/database/cdb/query`) {
    const b = JSON.parse(init.body)
    try {
      const st = founderDb.prepare(b.sql)
      const results = /^\s*select/i.test(b.sql) ? st.all(...(b.params || [])) : (st.run(...(b.params || [])), [])
      return new Response(JSON.stringify({ success: true, result: [{ results }] }))
    } catch (e) { return new Response(JSON.stringify({ success: false, errors: [{ message: e.message }] }), { status: 400 }) }
  }
  return new Response(JSON.stringify({ success: false, errors: [{ message: `unexpected ${p}` }] }), { status: 404 })
}
const env = { DB }
const as = (email, role = '') => async () => ({ authenticated: true, email, role })
const anon = async () => ({ authenticated: false })
const call = async (method, pathq, who, body) => {
  const res = await handleWorldReports(
    new Request(`https://agent.vegvisr.org${pathq}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }),
    env, new URL(`https://agent.vegvisr.org${pathq}`), {}, who)
  return { status: res.status, body: await res.json(), cache: res.headers.get('Cache-Control') }
}
const REPORT = { kpis: { customers: 3721, revenue: 642777 }, months: { '2026-10': 2953 } }

{
  const r = await call('GET', '/world-reports/get?world=sodesign.no&key=dashboard', as('stine.oksvold@gmail.com', 'Admin'))
  check('no report yet → 404, no table needed', r.status === 404 && /no report/.test(r.body.error), JSON.stringify(r))
}
{
  const r = await executeSaveWorldReport({ userId: 'owner', domain: 'sodesign.no', key: 'dashboard', data: REPORT }, env)
  check('system owner saves through the tool and it reads back', r.success && r.bytes === JSON.stringify(REPORT).length, JSON.stringify(r))
  const t = founderDb.prepare('SELECT key FROM reports').all()
  check('stored in the World\'s own database', t.length === 1 && t[0].key === 'dashboard', JSON.stringify(t))
}
{
  const r = await call('GET', '/world-reports/get?world=sodesign.no&key=dashboard', as('stine.oksvold@gmail.com', 'Admin'))
  check('the founder reads the report', r.status === 200 && r.body.data.kpis.revenue === 642777 && r.cache === 'no-store', JSON.stringify(r))
  const h = await call('GET', '/world-reports/get?world=sodesign.no', as('holder@example.com', 'User'))
  check('the account holder reads it (key defaults to dashboard)', h.status === 200 && h.body.data.kpis.customers === 3721, JSON.stringify(h))
}
{
  const s = await call('GET', '/world-reports/get?world=sodesign.no&key=dashboard', as('super@example.com', 'Superadmin'))
  check('another Superadmin is refused (403) and gets no numbers', s.status === 403 && !s.body.data && !JSON.stringify(s.body).includes('642777'), JSON.stringify(s))
  const u = await call('GET', '/world-reports/get?world=sodesign.no&key=dashboard', as('someone@example.com', 'User'))
  check('a signed-in stranger is refused (403)', u.status === 403 && !u.body.data, JSON.stringify(u))
  const a = await call('GET', '/world-reports/get?world=sodesign.no&key=dashboard', anon)
  check('no sign-in → 401', a.status === 401 && !a.body.data, JSON.stringify(a))
}
{
  const w = await call('POST', '/world-reports/save', as('super@example.com', 'Superadmin'), { world: 'sodesign.no', key: 'dashboard', data: { kpis: { revenue: 1 } } })
  check('another Superadmin may not overwrite it', w.status === 403, JSON.stringify(w))
  const still = await call('GET', '/world-reports/get?world=sodesign.no', as('stine.oksvold@gmail.com'))
  check('… and the report is unchanged', still.body.data.kpis.revenue === 642777, JSON.stringify(still.body))
}
{
  const big = await executeSaveWorldReport({ userId: 'owner', domain: 'sodesign.no', data: { x: 'a'.repeat(MAX_REPORT_BYTES) } }, env)
  check('an oversized report is refused', !big.success && /at most/.test(big.error), JSON.stringify(big).slice(0, 200))
  const bad = await executeSaveWorldReport({ userId: 'owner', domain: 'sodesign.no', key: '../x', data: REPORT }, env)
  check('a bad key is refused', !bad.success, JSON.stringify(bad))
  const arr = await executeSaveWorldReport({ userId: 'owner', domain: 'sodesign.no', data: [1, 2] }, env)
  check('data must be an object', !arr.success, JSON.stringify(arr))
}

console.log(failures ? `\n${failures} failure(s)` : '\nall passed')
process.exit(failures ? 1 : 0)
