// set_world_redirect: a World host answers with a redirect (2026-10-15, stineoksvolddesign.no → www).
//
// Drives the REAL executor against a fake Cloudflare API, and runs the redirect script it uploads.
// The properties that matter: the conflicting DNS records are read before they are removed and are
// put back if the attach fails; a host served by another worker is not taken without force; the
// uploaded script keeps path and query.
//
// Run:  node worker/test-set-world-redirect.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { DatabaseSync } from 'node:sqlite'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'set-world-redirect-'))
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
const DOMAIN = 'stineoksvolddesign.no'

function makeEnv({ attachFails = false, hostServedBy = null } = {}) {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE config (user_id TEXT, email TEXT, Role TEXT, bio TEXT, profileimage TEXT, phone TEXT, phone_verified_at TEXT, data TEXT, cf_account_id TEXT, cf_api_token TEXT);
    CREATE TABLE world_founders (id TEXT, founder_email TEXT, account_holder_email TEXT, hosting_model TEXT, cf_account_id TEXT, domain TEXT, created_at TEXT);
  `)
  db.prepare(`INSERT INTO config (user_id, email, Role) VALUES ('owner-uuid', 'owner@example.com', 'Superadmin')`).run()
  db.prepare(`INSERT INTO config (user_id, email, Role) VALUES ('admin-uuid', 'admin@example.com', 'Admin')`).run()
  db.prepare(`INSERT INTO config (user_id, email, Role, cf_account_id, cf_api_token) VALUES ('s', 'stine.oksvold@gmail.com', 'Admin', ?, 'tok')`).run(ACCOUNT)
  db.prepare(`INSERT INTO world_founders VALUES ('wf', 'stine.oksvold@gmail.com', 'stineoksvolddesign@gmail.com', 'own_account', ?, ?, '2026-06-18')`).run(ACCOUNT, DOMAIN)
  const DB = { prepare(sql) { let a = []; const st = { bind(...x) { a = x; return st }, async first() { return db.prepare(sql).get(...a) ?? null }, async all() { return { results: db.prepare(sql).all(...a) } }, async run() { db.prepare(sql).run(...a); return { success: true } } }; return st } }

  const state = {
    dns: [
      { id: 'r1', type: 'A', name: DOMAIN, content: '104.18.42.139', proxied: false, ttl: 1 },
      { id: 'r2', type: 'A', name: DOMAIN, content: '172.64.145.117', proxied: false, ttl: 1 },
      { id: 'r3', type: 'AAAA', name: DOMAIN, content: '2606:4700:4402::6812:2a8b', proxied: false, ttl: 1 },
      { id: 'r4', type: 'CNAME', name: `www.${DOMAIN}`, content: 'ssl.kajabi.com', proxied: false, ttl: 1 },
      { id: 'r5', type: 'MX', name: DOMAIN, content: 'mx.example', proxied: false, ttl: 1 },
    ],
    domains: hostServedBy ? [{ hostname: DOMAIN, service: hostServedBy }] : [],
    script: null, bindings: null,
  }
  const ok = (result) => new Response(JSON.stringify({ success: true, result }), { status: 200 })
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    const method = (init.method || 'GET').toUpperCase()
    if (url.hostname === DOMAIN) {
      // The live check: answer with whatever the uploaded script does.
      if (!state.script) return new Response('no worker', { status: 530 })
      const mod = await import('data:text/javascript;base64,' + Buffer.from(state.script).toString('base64'))
      const envB = Object.fromEntries(state.bindings.map((b) => [b.name, b.text]))
      return mod.default.fetch(new Request(url), envB)
    }
    const p = url.pathname.replace('/client/v4', '')
    if (p === '/zones') return ok([{ id: 'zone1', name: DOMAIN, account: { id: ACCOUNT } }])
    if (p === `/accounts/${ACCOUNT}/workers/domains` && method === 'GET') return ok(state.domains.filter((d) => !url.searchParams.get('hostname') || d.hostname === url.searchParams.get('hostname')))
    if (p === `/accounts/${ACCOUNT}/workers/domains` && method === 'PUT') {
      if (attachFails) return new Response(JSON.stringify({ success: false, errors: [{ message: 'conflict' }] }), { status: 409 })
      const b = JSON.parse(init.body); state.domains = state.domains.filter((d) => d.hostname !== b.hostname).concat([{ hostname: b.hostname, service: b.service }]); return ok(b)
    }
    const sm = p.match(new RegExp(`^/accounts/${ACCOUNT}/workers/scripts/([^/]+)$`))
    if (sm && method === 'PUT') {
      const meta = JSON.parse(await init.body.get('metadata'))
      state.bindings = meta.bindings
      state.script = await init.body.get('index.js').text()
      state.worker = sm[1]
      return ok({ id: sm[1] })
    }
    if (p === '/zones/zone1/dns_records' && method === 'GET') return ok(state.dns.filter((r) => r.name === url.searchParams.get('name')))
    if (p === '/zones/zone1/dns_records' && method === 'POST') { const b = JSON.parse(init.body); state.dns.push({ id: 'n' + state.dns.length, ...b }); return ok(b) }
    const dm = p.match(/^\/zones\/zone1\/dns_records\/(.+)$/)
    if (dm && method === 'DELETE') { state.dns = state.dns.filter((r) => r.id !== dm[1]); return ok({ id: dm[1] }) }
    if (p.endsWith('/tokens/verify')) return ok({ id: 't', status: 'active' })
    return new Response(JSON.stringify({ success: false, errors: [{ message: `unexpected ${method} ${p}` }] }), { status: 404 })
  }
  return { env: { DB }, state }
}

const ARGS = { userId: 'owner-uuid', domain: DOMAIN, host: DOMAIN, target: `https://www.${DOMAIN}/` }

{
  const { env, state } = makeEnv()
  const r = await executeTool('set_world_redirect', ARGS, env)
  check('redirects the apex, verified live', r.success === true && r.verified?.status === 301, JSON.stringify(r).slice(0, 500))
  check('the check kept path and query', r.verified?.location === `https://www.${DOMAIN}/redirect-check?x=1`, r.verified?.location)
  check('removed exactly the apex A/AAAA records, and reported them', r.removed_dns_records.length === 3 && !state.dns.some((d) => d.name === DOMAIN && ['A', 'AAAA'].includes(d.type)), JSON.stringify(r.removed_dns_records))
  check('left www (Kajabi) and MX alone', state.dns.some((d) => d.name === `www.${DOMAIN}` && d.content === 'ssl.kajabi.com') && state.dns.some((d) => d.type === 'MX'), JSON.stringify(state.dns))
  check('attached the apex to the redirect worker', state.domains.some((d) => d.hostname === DOMAIN && d.service === 'stineoksvolddesign-no-redirect'), JSON.stringify(state.domains))
}
{
  const { env, state } = makeEnv({ attachFails: true })
  const r = await executeTool('set_world_redirect', ARGS, env)
  check('a failed attach puts every removed record back', r.success === false && r.restored?.length === 3 && r.restored.every((x) => x.restored) && state.dns.filter((d) => d.name === DOMAIN && ['A', 'AAAA'].includes(d.type)).length === 3, JSON.stringify(r).slice(0, 400))
}
{
  const { env, state } = makeEnv({ hostServedBy: 'stine-brand-proxy' })
  const r = await executeTool('set_world_redirect', ARGS, env)
  check('a host served by another worker is not taken without force, and nothing changes', r.success === false && /stine-brand-proxy/.test(r.error) && state.dns.length === 5 && !state.script, JSON.stringify(r))
}
{
  const { env } = makeEnv()
  const loop = await executeTool('set_world_redirect', { ...ARGS, target: `https://${DOMAIN}/` }, env)
  check('a redirect to itself is refused', loop.success === false, JSON.stringify(loop))
  const http = await executeTool('set_world_redirect', { ...ARGS, target: `http://www.${DOMAIN}/` }, env)
  check('a non-https target is refused', http.success === false, JSON.stringify(http))
  const other = await executeTool('set_world_redirect', { ...ARGS, host: 'example.com' }, env)
  check('a host outside the World is refused', other.success === false, JSON.stringify(other))
}
{
  const { env, state } = makeEnv()
  const r = await executeTool('set_world_redirect', { ...ARGS, userId: 'admin-uuid' }, env)
  check('a non-Superadmin is refused, nothing changes', r.success === false && state.dns.length === 5, JSON.stringify(r))
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nall set_world_redirect checks pass')
