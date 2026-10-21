// provision_world_commerce: a World's customer database in the founder's own account (2026-10-21).
//
// Drives the REAL executor against a fake Cloudflare API whose D1 runs the statements in SQLite, so
// the schema is executed, not just sent. Checks: EU on create, idempotent re-run, read-back, a
// database outside the EU refused, only a register row on the platform, non-Superadmin refused.
//
// Run:  node worker/test-provision-world-commerce.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { DatabaseSync } from 'node:sqlite'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'provision-world-commerce-'))
for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')
fs.symlinkSync(path.join(dir, 'node_modules'), path.join(tmp, 'node_modules'))
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))

let failures = 0
const check = (name, cond, detail) => {
  if (cond) console.log(`ok    ${name}`)
  else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) }
}
const ACCOUNT = 'b68bda52e04081f0cbc04df338a44019'

function makeEnv({ existing = null } = {}) {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE config (user_id TEXT, email TEXT, Role TEXT, bio TEXT, profileimage TEXT, phone TEXT, phone_verified_at TEXT, data TEXT, cf_account_id TEXT, cf_api_token TEXT);
    CREATE TABLE world_founders (id TEXT, founder_email TEXT, account_holder_email TEXT, hosting_model TEXT, cf_account_id TEXT, domain TEXT, created_at TEXT);
  `)
  db.prepare(`INSERT INTO config (user_id, email, Role) VALUES ('owner-uuid', 'owner@example.com', 'Superadmin')`).run()
  db.prepare(`INSERT INTO config (user_id, email, Role) VALUES ('admin-uuid', 'admin@example.com', 'Admin')`).run()
  db.prepare(`INSERT INTO config (user_id, email, Role, cf_account_id, cf_api_token) VALUES ('s', 'stine.oksvold@gmail.com', 'Admin', ?, 'tok')`).run(ACCOUNT)
  db.prepare(`INSERT INTO world_founders VALUES ('wf', 'stine.oksvold@gmail.com', 'stineoksvolddesign@gmail.com', 'own_account', ?, 'sodesign.no', '2026-10-15')`).run(ACCOUNT)
  const DB = { prepare(sql) { let a = []; const st = { bind(...x) { a = x; return st }, async first() { return db.prepare(sql).get(...a) ?? null }, async all() { return { results: db.prepare(sql).all(...a) } }, async run() { db.prepare(sql).run(...a); return { success: true } } }; return st } }

  const founderDbs = new Map() // uuid -> { name, jurisdiction, sqlite }
  if (existing) founderDbs.set('uuid-existing', { name: existing.name, jurisdiction: existing.jurisdiction, sqlite: new DatabaseSync(':memory:') })
  const state = { creates: [], founderDbs }
  const ok = (result) => new Response(JSON.stringify({ success: true, result }), { status: 200 })
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    const p = url.pathname.replace('/client/v4', '')
    const method = (init.method || 'GET').toUpperCase()
    if (p === `/accounts/${ACCOUNT}/d1/database` && method === 'GET') {
      const name = url.searchParams.get('name')
      return ok([...founderDbs.entries()].filter(([, d]) => !name || d.name === name).map(([uuid, d]) => ({ uuid, name: d.name })))
    }
    if (p === `/accounts/${ACCOUNT}/d1/database` && method === 'POST') {
      const b = JSON.parse(init.body); const uuid = `uuid-${founderDbs.size + 1}`
      founderDbs.set(uuid, { name: b.name, jurisdiction: b.jurisdiction || null, sqlite: new DatabaseSync(':memory:') }); state.creates.push(b)
      return ok({ uuid, name: b.name })
    }
    const info = p.match(new RegExp(`^/accounts/${ACCOUNT}/d1/database/([^/]+)$`))
    if (info) { const d = founderDbs.get(info[1]); return ok({ uuid: info[1], name: d.name, jurisdiction: d.jurisdiction }) }
    const q = p.match(new RegExp(`^/accounts/${ACCOUNT}/d1/database/([^/]+)/query$`))
    if (q) {
      const d = founderDbs.get(q[1]); const b = JSON.parse(init.body)
      const st = d.sqlite.prepare(b.sql)
      const results = /^\s*select/i.test(b.sql) ? st.all(...(b.params || [])) : (st.run(...(b.params || [])), [])
      return ok([{ results, success: true }])
    }
    if (p.endsWith('/tokens/verify')) return ok({ id: 't', status: 'active' })
    return new Response(JSON.stringify({ success: false, errors: [{ message: `unexpected ${method} ${p}` }] }), { status: 404 })
  }
  return { env: { DB }, state, db }
}

{
  const { env, state, db } = makeEnv()
  const r = await executeTool('provision_world_commerce', { userId: 'owner-uuid', domain: 'sodesign.no' }, env)
  check('creates world-commerce-sodesign in the founder account, jurisdiction EU', r.success === true && state.creates.length === 1 && state.creates[0].name === 'world-commerce-sodesign' && state.creates[0].jurisdiction === 'eu', JSON.stringify(r).slice(0, 400))
  const t = [...state.founderDbs.values()][0].sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((x) => x.name)
  check('the schema actually exists in the founder database', ['customers', 'orders', 'grants', 'memberships', 'progress', 'schema_version'].every((n) => t.includes(n)), JSON.stringify(t))
  const reg = db.prepare('SELECT * FROM world_commerce_stores').all()
  check('the platform keeps only a register row (domain, account, database, status provisioned)', reg.length === 1 && reg[0].domain === 'sodesign.no' && reg[0].status === 'provisioned' && reg[0].d1_database_name === 'world-commerce-sodesign', JSON.stringify(reg))
  const platformTables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((x) => x.name)
  check('no customer table is created on the platform', !platformTables.some((n) => ['customers', 'orders', 'grants', 'memberships', 'progress'].includes(n)), JSON.stringify(platformTables))
  const again = await executeTool('provision_world_commerce', { userId: 'owner-uuid', domain: 'sodesign.no' }, env)
  const versions = [...state.founderDbs.values()][0].sqlite.prepare('SELECT COUNT(*) AS n FROM schema_version').get().n
  check('a re-run finds the database, creates nothing, records the version once', again.success === true && state.creates.length === 1 && versions === 1 && again.steps.some((s) => s.startsWith('HAD  d1')), JSON.stringify(again.steps))
}
{
  const { env } = makeEnv({ existing: { name: 'world-commerce-sodesign', jurisdiction: 'wnam' } })
  const r = await executeTool('provision_world_commerce', { userId: 'owner-uuid', domain: 'sodesign.no' }, env)
  check('an existing database outside the EU is refused', r.success === false && /EU/.test(r.error), JSON.stringify(r))
}
{
  const { env, state } = makeEnv()
  const r = await executeTool('provision_world_commerce', { userId: 'admin-uuid', domain: 'sodesign.no' }, env)
  check('a non-Superadmin is refused and nothing is created', r.success === false && state.creates.length === 0, JSON.stringify(r))
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nall provision_world_commerce checks pass')
