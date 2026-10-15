// save_world_founder_template refuses a shrink and keeps a rollback copy (2026-10-15).
//
// On 2026-10-15 a model called this tool with html:"test" and replaced the 39 015-byte shared
// console template with 4 bytes. Drives the REAL executor against an in-memory KV.
//
// Run:  node worker/test-save-world-template.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { DatabaseSync } from 'node:sqlite'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'save-world-template-'))
for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')
fs.symlinkSync(path.join(dir, 'node_modules'), path.join(tmp, 'node_modules'))
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))

let failures = 0
const check = (name, cond, detail) => {
  if (cond) console.log(`ok    ${name}`)
  else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) }
}
const KEY = 'template:world-founder-page'
const BIG = '<!doctype html>' + 'x'.repeat(39000)

function makeEnv() {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE config (user_id TEXT, email TEXT, Role TEXT, bio TEXT, profileimage TEXT, phone TEXT, phone_verified_at TEXT, data TEXT, cf_account_id TEXT, cf_api_token TEXT);`)
  db.prepare(`INSERT INTO config (user_id, email, Role) VALUES ('owner-uuid', 'owner@example.com', 'Superadmin')`).run()
  const DB = { prepare(sql) { let a = []; const st = { bind(...x) { a = x; return st }, async first() { return db.prepare(sql).get(...a) ?? null }, async all() { return { results: db.prepare(sql).all(...a) } }, async run() { db.prepare(sql).run(...a); return { success: true } } }; return st } }
  const kv = new Map([[KEY, BIG]])
  const WORLD_TEMPLATES = { async get(k) { return kv.has(k) ? kv.get(k) : null }, async put(k, v) { kv.set(k, v) }, async list() { return { keys: [...kv.keys()].map((name) => ({ name })) } } }
  return { env: { DB, WORLD_TEMPLATES }, kv }
}

{
  const { env, kv } = makeEnv()
  const r = await executeTool('save_world_founder_template', { userId: 'owner-uuid', template_key: KEY, html: 'test' }, env)
  check('the 2026-10-15 call (html:"test") is refused and nothing changes', r.success === false && r.blocked === 'template_shrank' && kv.get(KEY) === BIG && !kv.has(KEY + '.prev'), JSON.stringify(r).slice(0, 300))
}
{
  const { env, kv } = makeEnv()
  const edited = BIG + '<!-- edit -->'
  const r = await executeTool('save_world_founder_template', { userId: 'owner-uuid', template_key: KEY, html: edited }, env)
  check('a full edit saves and keeps the previous value as .prev', r.success === true && kv.get(KEY) === edited && kv.get(KEY + '.prev') === BIG && r.rollbackKey === KEY + '.prev', JSON.stringify(r).slice(0, 300))
}
{
  const { env, kv } = makeEnv()
  const r = await executeTool('save_world_founder_template', { userId: 'owner-uuid', template_key: KEY, html: '<p>small</p>', force: true }, env)
  check('force:true allows an intended shrink, still with a rollback copy', r.success === true && kv.get(KEY) === '<p>small</p>' && kv.get(KEY + '.prev') === BIG, JSON.stringify(r).slice(0, 300))
}
{
  const { env, kv } = makeEnv()
  const r = await executeTool('save_world_founder_template', { userId: 'owner-uuid', template_key: 'template:world-new', html: 'x' }, env)
  check('a new key saves without a rollback copy', r.success === true && kv.get('template:world-new') === 'x' && !kv.has('template:world-new.prev'), JSON.stringify(r))
  const p = await executeTool('save_world_founder_template', { userId: 'owner-uuid', template_key: KEY + '.prev', html: BIG }, env)
  check('the .prev key cannot be written directly', p.success === false, JSON.stringify(p))
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nall save_world_founder_template checks pass')
