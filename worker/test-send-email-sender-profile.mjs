// Regression guard: send_email finds a World sender stored in another profile (2026-09-15).
//
// post@nibi.no is configured in post@nibi.no's own profile. In a fresh Grok chat the Superadmin
// asked "Send a test email from post@nibi.no …" without forUserEmail; send_email searched only the
// caller's senders, failed "No configured account matches", and the agent asked for the token again.
// A Superadmin may already send as anyone via forUserEmail, so the executor now locates the holding
// profile itself. Non-Superadmins still see only their own senders.
//
// Drives the REAL executor through executeTool with in-memory SQLite (node:sqlite) for D1 and a fake
// EMAIL_WORKER binding that records the payload instead of sending.
//
// Run:  node worker/test-send-email-sender-profile.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { DatabaseSync } from 'node:sqlite'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'send-email-'))
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

const acct = (id, email, extra = {}) => ({ id, email, accountType: 'cf-email-service', cfAccountId: 'acc', ...extra })
const data = (accounts) => JSON.stringify({ settings: { emailAccounts: accounts } })

function makeEnv({ extraRows = [] } = {}) {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE config (user_id TEXT, email TEXT, Role TEXT, bio TEXT, profileimage TEXT, phone TEXT, phone_verified_at TEXT, data TEXT);
    CREATE TABLE world_founders (founder_email TEXT, account_holder_email TEXT, domain TEXT, created_at TEXT);
  `)
  const add = (uid, email, role, accounts) => db.prepare('INSERT INTO config (user_id, email, Role, data) VALUES (?, ?, ?, ?)').run(uid, email, role, data(accounts))
  add('owner-uuid', 'torarnehave@gmail.com', 'Superadmin', [acct('t1', 'torarnehave@vegvisr.org', { accountType: 'smtp' }), acct('t2', 'post@universi.no')])
  add('b8e7', 'post@nibi.no', 'Admin', [acct('5c34', 'post@nibi.no')])
  add('admin-uuid', 'someone@example.com', 'Admin', [acct('s1', 'someone@example.com', { accountType: 'gmail' })])
  for (const r of extraRows) add(...r)
  db.prepare("INSERT INTO world_founders VALUES ('post@nibi.no', 'post@nibi.no', 'nibi.no', '2026-09-13')").run()
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
  const sent = []
  const EMAIL_WORKER = {
    async fetch(url, init) {
      sent.push({ path: new URL(url).pathname, body: JSON.parse(init.body) })
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    },
  }
  return { env: { DB, EMAIL_WORKER }, sent }
}

const MAIL = { to: 'torarnehave@gmail.com', subject: 'Test email from post@nibi.no', html: '<p>test</p>' }
const run = async (env, input) => { try { return await executeTool('send_email', input, env) } catch (e) { return { thrown: e.message } } }

// 1. The log case: Superadmin, fromEmail post@nibi.no, no forUserEmail.
{
  const { env, sent } = makeEnv()
  const r = await run(env, { ...MAIL, userId: 'owner-uuid', fromEmail: 'post@nibi.no' })
  check('Superadmin send from a World sender succeeds without forUserEmail', r.success === true, JSON.stringify(r))
  check('payload uses post@nibi.no profile and its cf-email-service account', sent.length === 1 && sent[0].path === '/send-cf-email' && sent[0].body.userEmail === 'post@nibi.no' && sent[0].body.accountId === '5c34', JSON.stringify(sent))
  check('result names the profile it sent from', r.sender_profile === 'post@nibi.no' && /stored in post@nibi\.no's profile/.test(r.message || ''), JSON.stringify(r))
}

// 2. Own sender still comes from the caller's own profile.
{
  const { env, sent } = makeEnv()
  const r = await run(env, { ...MAIL, userId: 'owner-uuid', fromEmail: 'post@universi.no' })
  check('own sender unchanged', r.success === true && sent[0].body.userEmail === 'torarnehave@gmail.com' && sent[0].body.accountId === 't2', JSON.stringify({ r, sent }))
}

// 3. Non-Superadmin gets no cross-profile lookup.
{
  const { env, sent } = makeEnv()
  const r = await run(env, { ...MAIL, userId: 'admin-uuid', fromEmail: 'post@nibi.no' })
  check('non-Superadmin cannot send from another profile', !!r.thrown && /No configured account matches/.test(r.thrown) && sent.length === 0, JSON.stringify({ r, sent }))
}

// 4. The World founder wins when the sender sits in two profiles.
{
  const { env, sent } = makeEnv({ extraRows: [['x', 'helper@example.com', 'Admin', [acct('h1', 'post@nibi.no')]]] })
  const r = await run(env, { ...MAIL, userId: 'owner-uuid', fromEmail: 'post@nibi.no' })
  check('login-email / World founder profile preferred over another holder', r.success === true && sent[0].body.userEmail === 'post@nibi.no', JSON.stringify({ r, sent }))
}

// 5. Two unrelated holders → refuse and name them.
{
  const { env, sent } = makeEnv({ extraRows: [
    ['y1', 'a@example.com', 'Admin', [acct('a1', 'shared@other.org')]],
    ['y2', 'b@example.com', 'Admin', [acct('b1', 'shared@other.org')]],
  ] })
  const r = await run(env, { ...MAIL, userId: 'owner-uuid', fromEmail: 'shared@other.org' })
  check('ambiguous holders refused with both named', !!r.thrown && /a@example\.com/.test(r.thrown) && /b@example\.com/.test(r.thrown) && sent.length === 0, JSON.stringify({ r, sent }))
}

// 6. Unknown sender anywhere → clear error, no send.
{
  const { env, sent } = makeEnv()
  const r = await run(env, { ...MAIL, userId: 'owner-uuid', fromEmail: 'nobody@nowhere.no' })
  check('unknown sender: error says it is in no profile', !!r.thrown && /any other profile/.test(r.thrown) && sent.length === 0, JSON.stringify({ r, sent }))
}

// 7. Explicit forUserEmail still works as before.
{
  const { env, sent } = makeEnv()
  const r = await run(env, { ...MAIL, userId: 'owner-uuid', fromEmail: 'post@nibi.no', forUserEmail: 'post@nibi.no' })
  check('explicit forUserEmail path unchanged', r.success === true && sent[0].body.userEmail === 'post@nibi.no', JSON.stringify({ r, sent }))
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(failures ? `\n${failures} FAILED` : '\nPASS — send_email finds a World sender in its own profile for a Superadmin, and nowhere else.')
process.exit(failures ? 1 : 0)
