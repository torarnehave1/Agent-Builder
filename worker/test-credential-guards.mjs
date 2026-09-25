// A tool that writes credentials must refuse what is obviously not a credential.
//
// On 2026-09-25 the architect asked for set_contact_route, which was missing from the Grok path.
// The model reached for set_email_password instead and called it twice with the literal string
// "app password" and an account id of 3f3c8e2c5f0e0e0e0e0e0e0e0e0e0e0e, overwriting the sender of
// universi.no — a World that had nothing to do with the request.
//
//     node test-credential-guards.mjs
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cred-guards-'))
for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
fs.cpSync(path.join(dir, 'templates'), path.join(tmp, 'templates'), { recursive: true })
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))

let failures = 0
const check = (name, cond, detail) => { if (cond) console.log(`ok    ${name}`); else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) } }

const writes = []
function makeEnv() {
  const ROW = { user_id: 'owner', email: 'owner@example.com', Role: 'Superadmin', role: 'Superadmin', data: '{}' }
  const DB = { prepare(sql) { return { bind() { return {
    async first() { return ROW },
    async all() { return { results: [ROW] } },
    async run() { writes.push(sql); return { success: true } },
  } } } } }
  return { DB }
}
const CALLER = { userId: 'owner', authContext: { role: 'Superadmin', email: 'owner@example.com' } }

// 1. Every placeholder a model is likely to invent.
for (const fake of ['app password', 'App Password', 'password', 'your app password', 'changeme', 'placeholder']) {
  writes.length = 0
  const r = await executeTool('set_email_password', { ...CALLER, email: 'post@universi.no', appPassword: fake }, makeEnv())
  check(`"${fake}" is refused as a credential`, r.success === false && /placeholder/i.test(r.error || ''), JSON.stringify(r).slice(0, 180))
  check(`  and nothing was written for "${fake}"`, writes.length === 0, JSON.stringify(writes))
}

// 2. The fabricated account id from that run, and the shape rule behind it.
for (const fake of ['3f3c8e2c5f0e0e0e0e0e0e0e0e0e0e0e-x', 'not-an-id', '1234', 'e91711ab7a5bf10ef92e1b2a91d5214']) {
  writes.length = 0
  const r = await executeTool('set_email_password', { ...CALLER, email: 'post@universi.no', appPassword: 'S3cr3t-real-value-42', cfAccountId: fake }, makeEnv())
  check(`account id "${fake}" is refused`, r.success === false && /32 hex/i.test(r.error || ''), JSON.stringify(r).slice(0, 180))
  check(`  and nothing was written for "${fake}"`, writes.length === 0, JSON.stringify(writes))
}

// 3. A real-shaped id is NOT refused by the shape check — the guard must not block real work.
{
  // With real-shaped values the guards step aside and the tool goes on to do its actual work, which
  // needs bindings this harness does not stub. Reaching that point IS the assertion.
  let err = ''
  try {
    const r = await executeTool('set_email_password', { ...CALLER, email: 'post@universi.no', appPassword: 'S3cr3t-real-value-42', cfAccountId: 'e91711ab7a5bf10ef92e1b2a91d52148' }, makeEnv())
    err = String(r.error || '')
  } catch (e) { err = String(e.message || e) }
  check('a real secret and a real 32-hex id are not refused by the guards',
    !/32 hex/i.test(err) && !/placeholder/i.test(err), err.slice(0, 200))
}

// 4. The gate that caused it: set_contact_route must be reachable on the Grok/OpenAI path.
{
  const loop = fs.readFileSync(path.join(dir, 'agent-loop.js'), 'utf8')
  const block = loop.slice(loop.indexOf('const OPENAI_AGENT_TOOL_NAMES = ['), loop.indexOf('const OPENAI_AGENT_TOOLS'))
  const names = new Set([...block.matchAll(/'([a-zA-Z_0-9]+)'/g)].map(m => m[1]))
  check('set_contact_route is on the Grok path', names.has('set_contact_route'), `${names.size} tools listed`)
  check('and so is the contact form\'s publish path', names.has('publish_html_node') && names.has('create_subdomain'), '')
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(failures ? `\n${failures} FAILED` : '\nPASS — invented secrets and invented account ids are refused, and set_contact_route is reachable.')
process.exit(failures ? 1 : 0)
