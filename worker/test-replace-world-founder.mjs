// Regression guard: register_world_founder can REPLACE a founder, not only add one (2026-09-15).
//
// nibi.no was registered with torarnehave@gmail.com standing in as founder until post@nibi.no
// existed. register_world_founder could only ADD a second row, and every domain-keyed resolver
// (`WHERE domain = ? ORDER BY created_at LIMIT 1`) keeps picking the oldest row, so the stand-in
// stayed the World's founder. replace_founder_email re-points the existing row instead.
//
// Drives the REAL executor through executeTool against an in-memory SQLite (node:sqlite) built
// from the live world_founders / domains / config schemas, behind a minimal D1-shaped wrapper.
//
// Run:  node worker/test-replace-world-founder.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { DatabaseSync } from 'node:sqlite'

const dir = path.dirname(fileURLToPath(import.meta.url))

// worker/package.json has no "type": "module", so copy the real sources into a module-typed temp
// dir and import THOSE — still the actual code.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'replace-founder-'))
for (const f of fs.readdirSync(dir)) {
  if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
}
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')
fs.symlinkSync(path.join(dir, 'node_modules'), path.join(tmp, 'node_modules'))
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))

let failures = 0
const check = (name, cond, detail) => {
  if (cond) console.log(`ok    ${name}`)
  else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) }
}

function makeEnv() {
  const db = new DatabaseSync(':memory:')
  // world_founders is the live schema (sqlite_master, 2026-09-15). domains/config: only the
  // columns the executor touches.
  db.exec(`
    CREATE TABLE world_founders (
      id TEXT PRIMARY KEY, founder_email TEXT NOT NULL, world_name TEXT, domain TEXT NOT NULL,
      cf_account_id TEXT, meta_area_tag TEXT, account_holder_email TEXT, notes TEXT,
      created_at TEXT DEFAULT (datetime('now')), hosting_model TEXT,
      founder_role TEXT DEFAULT 'World Founder', status TEXT DEFAULT 'active', founder_org_id TEXT);
    CREATE TABLE domains (id TEXT PRIMARY KEY, domain TEXT, cf_account_id TEXT, hosting_model TEXT, kind TEXT, status TEXT);
    CREATE TABLE config (user_id TEXT, email TEXT, Role TEXT);
  `)
  const DB = {
    prepare(sql) {
      let args = []
      const stmt = {
        bind(...a) { args = a; return stmt },
        async first() { return db.prepare(sql).get(...args) ?? null },
        async all() { return { results: db.prepare(sql).all(...args) } },
        async run() { db.prepare(sql).run(...args); return { success: true } },
      }
      return stmt
    },
  }
  return { db, env: { DB } }
}

function seedNibi(db) {
  db.prepare(`INSERT INTO world_founders (id, founder_email, world_name, domain, cf_account_id, meta_area_tag, account_holder_email, hosting_model, created_at)
              VALUES ('wf-nibi', 'torarnehave@gmail.com', 'Nibi', 'nibi.no', NULL, '#NIBI', 'torarnehave@gmail.com', 'own_account', '2026-09-13 17:35:39')`).run()
  db.prepare(`INSERT INTO domains (id, domain, hosting_model, kind, status) VALUES ('d-nibi', 'nibi.no', 'own_account', 'world', 'active')`).run()
  db.prepare(`INSERT INTO config (user_id, email, Role) VALUES ('b8e7b844', 'post@nibi.no', 'Admin')`).run()
}

const AUTH = { authContext: { role: 'Superadmin' }, userId: 'owner' }
const rows = (db) => db.prepare("SELECT id, founder_email, world_name, account_holder_email, hosting_model, meta_area_tag, created_at FROM world_founders WHERE domain = 'nibi.no' ORDER BY created_at").all()

// 1. Replace: the same row moves to the new founder; everything else is kept.
{
  const { db, env } = makeEnv(); seedNibi(db)
  const r = await executeTool('register_world_founder', { ...AUTH, founder_email: 'post@nibi.no', domain: 'nibi.no', replace_founder_email: 'torarnehave@gmail.com' }, env)
  const after = rows(db)
  check('replace succeeds', r.success === true, JSON.stringify(r))
  check('replace leaves exactly one row', after.length === 1, JSON.stringify(after))
  check('the row now names post@nibi.no', after[0]?.founder_email === 'post@nibi.no', JSON.stringify(after))
  check('row id, world_name, tag, hosting_model, created_at kept',
    after[0]?.id === 'wf-nibi' && after[0]?.world_name === 'Nibi' && after[0]?.meta_area_tag === '#NIBI' &&
    after[0]?.hosting_model === 'own_account' && after[0]?.created_at === '2026-09-13 17:35:39', JSON.stringify(after))
  check('account holder is not silently moved', after[0]?.account_holder_email === 'torarnehave@gmail.com', JSON.stringify(after))
  check('result says what was replaced and that the holder stayed',
    r.replaced_founder_email === 'torarnehave@gmail.com' && /account holder is still torarnehave@gmail\.com/.test(r.message || ''), JSON.stringify(r))
  const oldest = db.prepare("SELECT founder_email FROM world_founders WHERE domain = 'nibi.no' ORDER BY created_at LIMIT 1").get()
  check('domain-keyed resolver now returns post@nibi.no', oldest?.founder_email === 'post@nibi.no', JSON.stringify(oldest))
}

// 2. Replace + account_holder_email in the same call moves the holder too.
{
  const { db, env } = makeEnv(); seedNibi(db)
  const r = await executeTool('register_world_founder', { ...AUTH, founder_email: 'post@nibi.no', domain: 'nibi.no', replace_founder_email: 'torarnehave@gmail.com', account_holder_email: 'post@nibi.no' }, env)
  const after = rows(db)
  check('replace + holder succeeds', r.success === true && after.length === 1, JSON.stringify(r))
  check('holder moved when explicitly given', after[0]?.account_holder_email === 'post@nibi.no', JSON.stringify(after))
  check('no stale-holder note when holder was changed', !/account holder is still/.test(r.message || ''), JSON.stringify(r))
}

// 3. Refusals change nothing.
for (const [name, input, pattern] of [
  ['unknown old founder', { founder_email: 'post@nibi.no', replace_founder_email: 'nobody@example.com' }, /not a founder of nibi\.no.*torarnehave@gmail\.com/],
  ['new founder has no account', { founder_email: 'ghost@nibi.no', replace_founder_email: 'torarnehave@gmail.com' }, /no Vegvisr account/],
]) {
  const { db, env } = makeEnv(); seedNibi(db)
  const before = JSON.stringify(rows(db))
  const r = await executeTool('register_world_founder', { ...AUTH, domain: 'nibi.no', ...input }, env)
  check(`refuses: ${name}`, r.success === false && pattern.test(r.error || ''), JSON.stringify(r))
  check(`refusal leaves the registry untouched: ${name}`, JSON.stringify(rows(db)) === before, JSON.stringify(rows(db)))
}
{
  const { db, env } = makeEnv(); seedNibi(db)
  db.prepare(`INSERT INTO world_founders (id, founder_email, world_name, domain, created_at) VALUES ('wf-2', 'post@nibi.no', 'Nibi', 'nibi.no', '2026-09-15 10:00:00')`).run()
  const before = JSON.stringify(rows(db))
  const r = await executeTool('register_world_founder', { ...AUTH, founder_email: 'post@nibi.no', domain: 'nibi.no', replace_founder_email: 'torarnehave@gmail.com' }, env)
  check('refuses: new founder already on the domain', r.success === false && /already a founder/.test(r.error || ''), JSON.stringify(r))
  check('refusal leaves the registry untouched: already a founder', JSON.stringify(rows(db)) === before, JSON.stringify(rows(db)))
}

// 3b. Re-running a replacement that already happened is idempotent (nibi.no, 2026-09-15: the second
//     run errored with no stored state, and the Grok agent described the account holder anyway).
{
  const { db, env } = makeEnv(); seedNibi(db)
  const input = { ...AUTH, founder_email: 'post@nibi.no', replace_founder_email: 'torarnehave@gmail.com', domain: 'nibi.no', account_holder_email: 'post@nibi.no' }
  const first = await executeTool('register_world_founder', input, env)
  const afterFirst = JSON.stringify(rows(db))
  const again = await executeTool('register_world_founder', input, env)
  const after = rows(db)
  check('first run replaces', first.success === true && first.replaced_founder_email === 'torarnehave@gmail.com', JSON.stringify(first))
  check('re-run succeeds instead of erroring', again.success === true && again.replacement_already_applied === true, JSON.stringify(again))
  check('re-run leaves the registry as the first run did', JSON.stringify(after) === afterFirst && after.length === 1, JSON.stringify(after))
  check('re-run returns the STORED holder and hosting',
    again.account_holder_email === 'post@nibi.no' && /Stored account holder: post@nibi\.no, hosting: own_account/.test(again.message || ''), JSON.stringify(again))
  check('re-run does not claim a replacement happened', !again.replaced_founder_email, JSON.stringify(again))
}
{
  // Already replaced earlier WITHOUT moving the holder; a re-run that passes the holder applies it.
  const { db, env } = makeEnv(); seedNibi(db)
  await executeTool('register_world_founder', { ...AUTH, founder_email: 'post@nibi.no', replace_founder_email: 'torarnehave@gmail.com', domain: 'nibi.no' }, env)
  const r = await executeTool('register_world_founder', { ...AUTH, founder_email: 'post@nibi.no', replace_founder_email: 'torarnehave@gmail.com', domain: 'nibi.no', account_holder_email: 'post@nibi.no' }, env)
  check('re-run applies a newly supplied holder', r.success === true && rows(db)[0].account_holder_email === 'post@nibi.no' && r.account_holder_email === 'post@nibi.no', JSON.stringify({ r, rows: rows(db) }))
}

// 4. Without replace_founder_email the old behaviour holds: a second row is added.
{
  const { db, env } = makeEnv(); seedNibi(db)
  const r = await executeTool('register_world_founder', { ...AUTH, founder_email: 'post@nibi.no', domain: 'nibi.no' }, env)
  const after = rows(db)
  check('add (no replace) still adds a second row', r.success === true && after.length === 2 && r.world_founders === 'created', JSON.stringify({ r, after }))
}

// 5. Non-Superadmin cannot replace.
{
  const { db, env } = makeEnv(); seedNibi(db)
  const r = await executeTool('register_world_founder', { authContext: { role: 'Admin' }, userId: 'x', founder_email: 'post@nibi.no', domain: 'nibi.no', replace_founder_email: 'torarnehave@gmail.com' }, env)
  check('non-Superadmin refused', r.success === false && /Superadmin/.test(r.error || '') && rows(db)[0].founder_email === 'torarnehave@gmail.com', JSON.stringify(r))
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(failures ? `\n${failures} FAILED` : '\nPASS — register_world_founder replaces a founder in place and refuses unsafe replacements.')
process.exit(failures ? 1 : 0)
