// E-mail sender grants (2026-11-03): grant_email_sender / list_email_sender_grants /
// revoke_email_sender_grant. They hold no rule of their own — dev-worker decides — so the
// properties are about wiring: the call goes over KG_WORKER naming the SIGNED-IN user (never a tool
// argument), to the right path and body, and dev-worker's refusal comes back with a Login-as hint.
//
// Run:  node worker/test-email-sender-grants.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sender-grants-'))
for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')
fs.symlinkSync(path.join(dir, 'node_modules'), path.join(tmp, 'node_modules'))
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))
const defs = (await import(path.join(tmp, 'tool-definitions.js')))

let failures = 0
const check = (name, cond, detail) => {
  if (cond) console.log(`ok    ${name}`)
  else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) }
}

const calls = []
let reply = { status: 200, body: { success: true } }
const KG_WORKER = {
  async fetch(url, init = {}) {
    const h = new Headers(init.headers || {})
    calls.push({ url: String(url), method: init.method || 'GET', acting: h.get('x-acting-user-email'), body: init.body ? JSON.parse(init.body) : null })
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } })
  },
}
const env = { KG_WORKER }
const asHolder = { authContext: { email: 'post@nibi.no' } }

// Grant: right path, body, and the acting user is the signed-in one.
reply = { status: 200, body: { success: true, alreadyGranted: false, grantId: 'g1', senderEmail: 'post@nibi.no', granteeEmail: 'giulia@example.com' } }
let r = await executeTool('grant_email_sender', { ...asHolder, senderEmail: 'Post@NIBI.no', granteeEmail: 'Giulia@example.com', note: 'Sekretær' }, env, {})
let c = calls.at(-1)
check('grant posts to /email/sender-grants', c.url === 'https://knowledge-graph-worker/email/sender-grants' && c.method === 'POST', JSON.stringify(c))
check('grant body lower-cased, no granter field', c.body.senderEmail === 'post@nibi.no' && c.body.granteeEmail === 'giulia@example.com' && c.body.note === 'Sekretær' && !('granterEmail' in c.body), JSON.stringify(c.body))
check('acting user is the signed-in user', c.acting === 'post@nibi.no', c.acting)
check('grant result passed through', r.success && r.grantId === 'g1' && r.actingAs === 'post@nibi.no', JSON.stringify(r))

// A tool argument cannot change who grants.
await executeTool('grant_email_sender', { ...asHolder, senderEmail: 'post@nibi.no', granteeEmail: 'x@example.com', userId: 'evil@example.com', actingAs: 'evil@example.com' }, env, {})
check('identity comes from authContext only', calls.at(-1).acting === 'post@nibi.no', calls.at(-1).acting)

// Refusal from dev-worker keeps its message and gains a Login-as hint.
reply = { status: 403, body: { success: false, code: 'FORBIDDEN_GRAPH', error: 'post@nibi.no is not a sending address on your profile, so it is not yours to delegate.' } }
r = await executeTool('grant_email_sender', { authContext: { email: 'boss@example.com' }, senderEmail: 'post@nibi.no', granteeEmail: 'giulia@example.com' }, env, {})
check('non-holder refused with hint', !r.success && /not yours to delegate/.test(r.error) && /Login as post@nibi\.no/.test(r.hint || ''), JSON.stringify(r))

// Missing fields: refused before any call.
let n = calls.length
r = await executeTool('grant_email_sender', { ...asHolder, senderEmail: 'post@nibi.no' }, env, {})
check('missing grantee refused locally', !r.success && calls.length === n, JSON.stringify(r))

// No signed-in user: refused before any call.
r = await executeTool('grant_email_sender', { senderEmail: 'post@nibi.no', granteeEmail: 'giulia@example.com' }, env, {})
check('no user, no call', !r.success && calls.length === n, JSON.stringify(r))

// List and revoke.
reply = { status: 200, body: { success: true, grants: [], count: 0 } }
await executeTool('list_email_sender_grants', { ...asHolder, includeRevoked: true }, env, {})
c = calls.at(-1)
check('list is GET with includeRevoked', c.method === 'GET' && c.url.endsWith('/email/sender-grants?includeRevoked=1') && c.acting === 'post@nibi.no', JSON.stringify(c))
await executeTool('revoke_email_sender_grant', { ...asHolder, grantId: 'a/b' }, env, {})
c = calls.at(-1)
check('revoke encodes the id', c.method === 'POST' && c.url.endsWith('/email/sender-grants/a%2Fb/revoke'), JSON.stringify(c))

// Definitions exist, and the confusable tools point to grant_email_sender.
const all = defs.TOOL_DEFINITIONS || defs.default || Object.values(defs).find(Array.isArray)
const byName = Object.fromEntries((all || []).map((t) => [t.name, t]))
check('three definitions present', ['grant_email_sender', 'list_email_sender_grants', 'revoke_email_sender_grant'].every((x) => byName[x]), Object.keys(defs).join(','))
check('grant_world_access points here', /grant_email_sender/.test(byName.grant_world_access?.description || ''), '')
check('set_world_member_roles points here', /grant_email_sender/.test(byName.set_world_member_roles?.description || ''), '')

if (failures) { console.error(`\n${failures} failing`); process.exit(1) }
console.log('\nall sender-grant checks pass')
