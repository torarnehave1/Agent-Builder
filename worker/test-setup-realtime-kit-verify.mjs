// setup_realtime_kit verifies the RealtimeKit app + token against Cloudflare before writing (2026-10-26).
//
// realtime-worker moves a founder onto their own RealtimeKit app as soon as cf_rtk_app_id AND
// cf_rtk_token are both set, so a wrong pair breaks every room that founder opens. This drives the
// REAL executor against a fake Cloudflare API: a refused pair writes nothing, an accepted pair is
// stored, and the main World token (cf_api_token) is never touched.
//
// Run:  node worker/test-setup-realtime-kit-verify.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { DatabaseSync } from 'node:sqlite'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-rtk-verify-'))
for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')
fs.symlinkSync(path.join(dir, 'node_modules'), path.join(tmp, 'node_modules'))
const { executeTool, verifyRealtimeKit } = await import(path.join(tmp, 'tool-executors.js'))

let failures = 0
const check = (name, cond, detail) => {
  if (cond) console.log(`ok    ${name}`)
  else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) }
}

const ACCOUNT = '02058bbc18d35ea67d908c637441d414'
const APP = 'b5e92368-8d5d-4fca-9177-beeb48cca96c'
const GOOD = 'good-realtime-token'
const calls = []

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  calls.push(url.pathname)
  if (url.pathname === `/client/v4/accounts/${ACCOUNT}/realtime/kit/${APP}/meetings`) {
    const auth = (init.headers && (init.headers.Authorization || init.headers.authorization)) || ''
    if (auth === `Bearer ${GOOD}`) return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 })
    return new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }), { status: 403 })
  }
  if (url.pathname.includes('/realtime/kit/')) return new Response(JSON.stringify({ success: false, errors: [{ message: 'not found' }] }), { status: 404 })
  return new Response('{}', { status: 200 })
}

function makeEnv() {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE config (user_id TEXT, email TEXT, Role TEXT, bio TEXT, profileimage TEXT, phone TEXT, phone_verified_at TEXT, data TEXT,
    cf_account_id TEXT, cf_api_token TEXT, cf_rtk_app_id TEXT, cf_rtk_token TEXT, cf_r2_bucket TEXT, cf_r2_public_base TEXT);`)
  db.prepare(`INSERT INTO config (user_id, email, Role) VALUES ('owner-uuid', 'owner@example.com', 'Superadmin')`).run()
  db.prepare(`INSERT INTO config (user_id, email, Role, cf_account_id, cf_api_token) VALUES ('v', 'post@vegr.ai', 'Admin', ?, 'main-world-token')`).run(ACCOUNT)
  const DB = { prepare(sql) { let a = []; const st = { bind(...x) { a = x; return st }, async first() { return db.prepare(sql).get(...a) ?? null }, async all() { return { results: db.prepare(sql).all(...a) } }, async run() { db.prepare(sql).run(...a); return { success: true } } }; return st } }
  return { env: { DB }, db }
}
const row = (db) => db.prepare(`SELECT cf_api_token, cf_rtk_app_id, cf_rtk_token FROM config WHERE email = 'post@vegr.ai'`).get()

// 1. verifyRealtimeKit alone
check('verify accepts the right pair', (await verifyRealtimeKit(ACCOUNT, APP, GOOD)).ok === true, 'expected ok')
const bad = await verifyRealtimeKit(ACCOUNT, APP, 'wrong')
check('verify refuses a wrong token', bad.ok === false && bad.status === 403 && /refused the token/.test(bad.error), JSON.stringify(bad))
check('verify never echoes the token', !JSON.stringify(bad).includes('wrong'), JSON.stringify(bad))
const missingAcct = await verifyRealtimeKit('', APP, GOOD)
check('verify refuses without an account id', missingAcct.ok === false, JSON.stringify(missingAcct))

// 2. a refused pair writes nothing
{
  const { env, db } = makeEnv()
  const r = await executeTool('setup_realtime_kit', { userId: 'owner-uuid', founder_email: 'post@vegr.ai', app_id: APP, rtk_token: 'wrong' }, env)
  const after = row(db)
  check('refused pair → success false, stored false', r.success === false && r.stored === false, JSON.stringify(r))
  check('refused pair → nothing written', after.cf_rtk_app_id === null && after.cf_rtk_token === null, JSON.stringify(after))
}

// 3. an accepted pair is stored; the main World token is untouched
{
  const { env, db } = makeEnv()
  const r = await executeTool('setup_realtime_kit', { userId: 'owner-uuid', founder_email: 'post@vegr.ai', app_id: APP, rtk_token: GOOD }, env)
  const after = row(db)
  check('accepted pair → stored', after.cf_rtk_app_id === APP && after.cf_rtk_token === GOOD, JSON.stringify(after))
  check('main World token untouched', after.cf_api_token === 'main-world-token', JSON.stringify(after))
  check('result reports configured, not the token', r.configured && r.configured.rtk_token === true && !JSON.stringify(r).includes(GOOD), JSON.stringify(r))
  check('missing bucket reported, not a failure of the pair', Array.isArray(r.missing) && r.missing.includes('bucket') && r.stored !== false, JSON.stringify(r))
}

// 4. bucket-only update (no new app/token) does not call Cloudflare
{
  const { env } = makeEnv()
  calls.length = 0
  await executeTool('setup_realtime_kit', { userId: 'owner-uuid', founder_email: 'post@vegr.ai', bucket: 'vegr-meeting-recordings' }, env)
  check('bucket-only update makes no RealtimeKit call', !calls.some((p) => p.includes('/realtime/kit/')), JSON.stringify(calls))
}

// 5. non-Superadmin refused
{
  const { env } = makeEnv()
  const r = await executeTool('setup_realtime_kit', { userId: 'v', founder_email: 'post@vegr.ai', app_id: APP, rtk_token: GOOD }, env)
  check('non-Superadmin refused', r.success === false && /Superadmin/.test(r.error || ''), JSON.stringify(r))
}

process.exit(failures ? 1 : 0)
