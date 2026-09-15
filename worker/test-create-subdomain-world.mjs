// Regression guard: create_subdomain on a World domain attaches to the World's own brand proxy (2026-09-15).
//
// On nibi.no the Grok agent answered "create_subdomain requires the Cloudflare Zone ID … provide it
// and the call will succeed". It could not: create_subdomain forwarded to api-worker's
// /create-custom-domain, which points the host at the PLATFORM brand-worker with the platform token,
// and Cloudflare will not route a zone in one account to a worker in another. For a registered World
// outside the platform zone list the tool now attaches <sub>.<domain> to the worker that serves
// me.<domain>, using the World's stored token — no Zone ID. Platform domains keep the old path.
//
// Drives the REAL executor through executeTool with in-memory SQLite for D1, a fake Cloudflare API
// behind globalThis.fetch, and a fake API_WORKER binding that records platform-path calls.
//
// Run:  node worker/test-create-subdomain-world.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { DatabaseSync } from 'node:sqlite'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'create-subdomain-'))
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

const ACCOUNT = 'e458403763ce460e42d1c87896cfc7e9'

function makeEnv() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE config (user_id TEXT, email TEXT, Role TEXT, bio TEXT, profileimage TEXT, phone TEXT, phone_verified_at TEXT, data TEXT, cf_account_id TEXT, cf_api_token TEXT);
    CREATE TABLE world_founders (id TEXT, founder_email TEXT, account_holder_email TEXT, hosting_model TEXT, cf_account_id TEXT, domain TEXT, created_at TEXT);
  `)
  db.prepare(`INSERT INTO config (user_id, email, Role) VALUES ('owner-uuid', 'owner@example.com', 'Superadmin')`).run()
  db.prepare(`INSERT INTO config (user_id, email, Role) VALUES ('admin-uuid', 'admin@example.com', 'Admin')`).run()
  db.prepare(`INSERT INTO config (user_id, email, Role, cf_account_id, cf_api_token) VALUES ('b8e7', 'post@nibi.no', 'Admin', ?, 'tok-nibi')`).run(ACCOUNT)
  db.prepare(`INSERT INTO world_founders VALUES ('wf', 'post@nibi.no', 'post@nibi.no', 'own_account', ?, 'nibi.no', '2026-09-13 17:35:39')`).run(ACCOUNT)
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
  const platformCalls = []
  const API_WORKER = {
    async fetch(url, init) {
      platformCalls.push(JSON.parse(init.body))
      return new Response(JSON.stringify({ overallSuccess: true, dnsSetup: { success: true, result: { id: 'd1' } }, workerSetup: { result: { id: 'w1', pattern: 'x/*', script: 'brand-worker' } } }), { status: 200 })
    },
  }
  return { env: { DB, API_WORKER }, platformCalls }
}

function fakeCloudflare({ proxyExists = true } = {}) {
  const puts = []
  const domains = [{ hostname: 'me.nibi.no', service: 'nibi-brand-proxy' }]
  const json = (result, status = 200) => new Response(JSON.stringify({ success: status < 300, errors: status < 300 ? [] : [{ message: 'not found' }], result }), { status })
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url)
    const p = u.pathname.replace('/client/v4', '')
    const method = (init.method || 'GET').toUpperCase()
    if (init.headers?.Authorization !== 'Bearer tok-nibi') return json(null, 403)
    if (p === `/accounts/${ACCOUNT}/workers/domains` && method === 'GET') {
      const h = u.searchParams.get('hostname')
      return json(h ? domains.filter((d) => d.hostname === h) : domains)
    }
    if (p === `/accounts/${ACCOUNT}/workers/domains` && method === 'PUT') {
      const b = JSON.parse(init.body); puts.push(b); domains.push({ hostname: b.hostname, service: b.service }); return json(b)
    }
    if (p === `/accounts/${ACCOUNT}/workers/scripts/nibi-brand-proxy/settings`) return proxyExists ? json({ bindings: [] }) : json(null, 404)
    if (p === `/accounts/${ACCOUNT}/workers/scripts/nibi-brand-proxy`) return proxyExists ? new Response('export default {}', { status: 200 }) : json(null, 404)
    if (p === '/zones' && u.searchParams.get('name') === 'nibi.no') return json([{ id: 'zone-nibi', name: 'nibi.no' }])
    return json(null, 404)
  }
  return { puts }
}

const OWNER = { userId: 'owner-uuid' }

// 1. The log case: a subdomain on nibi.no, no zone_id.
{
  const { env, platformCalls } = makeEnv()
  const cf = fakeCloudflare()
  const r = await executeTool('create_subdomain', { ...OWNER, subdomain: 'shop', root_domain: 'nibi.no' }, env)
  check('World subdomain succeeds without zone_id', r.success === true && r.host === 'shop.nibi.no', JSON.stringify(r))
  check('attached to the worker serving me.nibi.no in the World zone', cf.puts.length === 1 && cf.puts[0].hostname === 'shop.nibi.no' && cf.puts[0].service === 'nibi-brand-proxy' && cf.puts[0].zone_id === 'zone-nibi', JSON.stringify(cf.puts))
  check('platform /create-custom-domain NOT called for a World', platformCalls.length === 0, JSON.stringify(platformCalls))
  check('message says no Zone ID needed', /No Zone ID needed/.test(r.message || ''), r.message)

  const again = await executeTool('create_subdomain', { ...OWNER, subdomain: 'shop', root_domain: 'nibi.no' }, env)
  check('re-run reports already attached, no second write', again.success === true && again.already_attached === true && cf.puts.length === 1, JSON.stringify({ again, puts: cf.puts }))
}

// 2. World without a brand proxy → clear next step, nothing attached.
{
  const { env, platformCalls } = makeEnv()
  const cf = fakeCloudflare({ proxyExists: false })
  const r = await executeTool('create_subdomain', { ...OWNER, subdomain: 'shop', root_domain: 'nibi.no' }, env)
  check('missing brand proxy → points to deploy_world_proxy', r.success === false && /deploy_world_proxy/.test(r.error || '') && cf.puts.length === 0 && platformCalls.length === 0, JSON.stringify(r))
}

// 3. Platform domains keep the api-worker path.
{
  const { env, platformCalls } = makeEnv()
  const cf = fakeCloudflare()
  const r = await executeTool('create_subdomain', { ...OWNER, subdomain: 'fonemer', root_domain: 'vegvisr.org' }, env)
  check('vegvisr.org still uses /create-custom-domain', r.success === true && platformCalls.length === 1 && platformCalls[0].rootDomain === 'vegvisr.org' && cf.puts.length === 0, JSON.stringify({ r, platformCalls }))
}

// 4. Unregistered outside domain keeps the old behaviour (api-worker, optional zone_id).
{
  const { env, platformCalls } = makeEnv()
  fakeCloudflare()
  await executeTool('create_subdomain', { ...OWNER, subdomain: 'a', root_domain: 'unknown-domain.com', zone_id: 'z123' }, env)
  check('non-World outside domain still forwards zone_id to api-worker', platformCalls.length === 1 && platformCalls[0].zoneId === 'z123', JSON.stringify(platformCalls))
}

// 5. Non-Superadmin refused before anything happens.
{
  const { env, platformCalls } = makeEnv()
  const cf = fakeCloudflare()
  const r = await executeTool('create_subdomain', { userId: 'admin-uuid', subdomain: 'shop', root_domain: 'nibi.no' }, env)
  check('non-Superadmin refused', r.success === false && /Superadmin/.test(r.error || '') && cf.puts.length === 0 && platformCalls.length === 0, JSON.stringify(r))
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(failures ? `\n${failures} FAILED` : '\nPASS — create_subdomain attaches World subdomains to the World brand proxy, no Zone ID asked.')
process.exit(failures ? 1 : 0)
