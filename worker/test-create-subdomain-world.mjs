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

// Central Worlds must never create or attach a domain to a guessed per-World proxy.
// The production path uses the platform account's existing shared brand-worker.
{
  const { env, platformCalls } = makeEnv()
  const centralDb = new DatabaseSync(':memory:')
  centralDb.exec(`
    CREATE TABLE config (user_id TEXT, email TEXT, Role TEXT, bio TEXT, profileimage TEXT, phone TEXT, phone_verified_at TEXT, data TEXT, cf_account_id TEXT, cf_api_token TEXT);
    CREATE TABLE world_founders (id TEXT, founder_email TEXT, account_holder_email TEXT, hosting_model TEXT, cf_account_id TEXT, domain TEXT, created_at TEXT);
  `)
  centralDb.prepare("INSERT INTO config (user_id,email,Role) VALUES ('owner-uuid','owner@example.com','Superadmin')").run()
  centralDb.prepare("INSERT INTO world_founders VALUES ('wf','msneeggen@gmail.com','torarnehave@gmail.com','central',?,'movemetime.com','2026-09-19')").run(ACCOUNT)
  env.DB = { prepare(sql) { let args=[]; const stmt={ bind(...values){args=values;return stmt}, async first(){return centralDb.prepare(sql).get(...args) ?? null}, async all(){return {results:centralDb.prepare(sql).all(...args)}}, async run(){centralDb.prepare(sql).run(...args);return {success:true}}}; return stmt } }
  env.CF_ACCOUNT_ID = ACCOUNT
  env.CF_API_TOKEN = 'platform-token'
  const cf = fakeCloudflare({ proxyExists: true, token: 'platform-token', host: 'me.movemetime.com', worker: 'brand-worker', root: 'movemetime.com' })
  const routed = await executeTool('create_subdomain', { userId: 'owner-uuid', subdomain: 'minside', root_domain: 'movemetime.com' }, env)
  check('central World uses shared brand-worker', routed.success === true && routed.worker_name === 'brand-worker' && cf.puts.at(-1)?.service === 'brand-worker', JSON.stringify({ routed, puts: cf.puts }))
  const deploy = await executeTool('deploy_world_proxy', { userId: 'owner-uuid', domain: 'movemetime.com' }, env)
  check('central World blocks deploy_world_proxy', deploy.success === false && /central World/.test(deploy.error || ''), JSON.stringify(deploy))
  const provision = await executeTool('provision_world_kv', { userId: 'owner-uuid', domain: 'movemetime.com' }, env)
  check('central World blocks provision_world_kv', provision.success === false && /central World/.test(provision.error || ''), JSON.stringify(provision))
  check('central World does not call platform custom-domain API', platformCalls.length === 0, JSON.stringify(platformCalls))
}

// token: the one token Cloudflare accepts (string) or several (array); any other bearer gets 403.
// zoneAccount: when set, /zones returns the zone with account.id, as the real API does.
function fakeCloudflare({ proxyExists = true, account = ACCOUNT, token = 'tok-nibi', host = 'me.nibi.no', worker = 'nibi-brand-proxy', root = 'nibi.no', zoneAccount = null } = {}) {
  const puts = []
  const writes = []
  const accepted = [].concat(token).map((t) => `Bearer ${t}`)
  const domains = [{ hostname: host, service: worker }]
  const json = (result, status = 200) => new Response(JSON.stringify({ success: status < 300, errors: status < 300 ? [] : [{ message: status === 403 ? 'Authentication error' : 'not found' }], result }), { status })
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url)
    const p = u.pathname.replace('/client/v4', '')
    const method = (init.method || 'GET').toUpperCase()
    if (!accepted.includes(init.headers?.Authorization)) return json(null, 403)
    if (method !== 'GET') writes.push(p)
    if (p === `/accounts/${account}/workers/domains` && method === 'GET') {
      const h = u.searchParams.get('hostname')
      return json(h ? domains.filter((d) => d.hostname === h) : domains)
    }
    if (p === `/accounts/${account}/workers/domains` && method === 'PUT') {
      const b = JSON.parse(init.body); puts.push({ ...b, auth: init.headers.Authorization }); domains.push({ hostname: b.hostname, service: b.service }); return json(b)
    }
    if (p === `/accounts/${account}/workers/scripts/${worker}/settings`) return proxyExists ? json({ bindings: [] }) : json(null, 404)
    if (p === `/accounts/${account}/workers/scripts/${worker}`) return proxyExists ? new Response('export default {}', { status: 200 }) : json(null, 404)
    if (p === '/zones' && u.searchParams.get('name') === root) return json([{ id: root === 'nibi.no' ? 'zone-nibi' : `zone-${root}`, name: root, ...(zoneAccount ? { account: { id: zoneAccount } } : {}) }])
    return json(null, 404)
  }
  return { puts, writes }
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

// 6. The 2026-09-21 log: the stored World token cannot read Workers (403). It used to come back as
//    "nibi.no has no brand proxy worker yet" while nibi-brand-proxy served six hosts. With the
//    platform token bound (option B), the tool retries inside the World's account and attaches.
{
  const { env, platformCalls } = makeEnv()
  env.CF_API_TOKEN = 'platform-token'
  const cf = fakeCloudflare({ token: 'platform-token' })
  const r = await executeTool('create_subdomain', { ...OWNER, subdomain: 'test', root_domain: 'nibi.no' }, env)
  check('refused World token → platform fallback attaches to the existing proxy', r.success === true && r.worker_name === 'nibi-brand-proxy' && cf.puts.length === 1 && cf.puts[0].hostname === 'test.nibi.no' && cf.puts[0].service === 'nibi-brand-proxy' && cf.puts[0].auth === 'Bearer platform-token', JSON.stringify({ r, puts: cf.puts }))
  check('fallback is reported, not hidden', /platform CF_API_TOKEN/.test(r.credential_source || '') && /refused \(403\)/.test(r.world_token_refused || '') && /Credentials: platform/.test(r.message || ''), JSON.stringify(r))
  check('fallback never touches the platform custom-domain API', platformCalls.length === 0, JSON.stringify(platformCalls))
}

// 7. Same refusal, no platform token bound → a truthful permissions error, never "no brand proxy".
{
  const { env } = makeEnv()
  const cf = fakeCloudflare({ token: 'some-other-token' })
  const r = await executeTool('create_subdomain', { ...OWNER, subdomain: 'test', root_domain: 'nibi.no' }, env)
  check('refusal without fallback is reported as a refusal', r.success === false && /refused \(403\)/.test(r.error || '') && /NOT a missing brand proxy/.test(r.error || '') && !/has no brand proxy/.test(r.error || '') && cf.puts.length === 0, JSON.stringify(r))
}

// 8. World token reads fine but may not attach (403 on the PUT) → retry the attach with the platform token.
{
  const { env } = makeEnv()
  env.CF_API_TOKEN = 'platform-token'
  const cf = fakeCloudflare({ token: ['tok-nibi', 'platform-token'] })
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    if ((init.method || 'GET').toUpperCase() === 'PUT' && init.headers?.Authorization === 'Bearer tok-nibi') {
      return new Response(JSON.stringify({ success: false, errors: [{ message: 'Authentication error' }], result: null }), { status: 403 })
    }
    return realFetch(url, init)
  }
  const r = await executeTool('create_subdomain', { ...OWNER, subdomain: 'test', root_domain: 'nibi.no' }, env)
  check('refused attach retried with the platform token', r.success === true && cf.puts.length === 1 && cf.puts[0].auth === 'Bearer platform-token' && /attach test\.nibi\.no/.test(r.world_token_refused || ''), JSON.stringify({ r, puts: cf.puts }))
}

// 9. A central World whose zone is in ANOTHER account cannot use brand-worker → refused with the reason.
{
  const { env } = makeEnv()
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE config (user_id TEXT, email TEXT, Role TEXT, bio TEXT, profileimage TEXT, phone TEXT, phone_verified_at TEXT, data TEXT, cf_account_id TEXT, cf_api_token TEXT);
    CREATE TABLE world_founders (id TEXT, founder_email TEXT, account_holder_email TEXT, hosting_model TEXT, cf_account_id TEXT, domain TEXT, created_at TEXT);
  `)
  db.prepare("INSERT INTO config (user_id,email,Role) VALUES ('owner-uuid','owner@example.com','Superadmin')").run()
  db.prepare("INSERT INTO world_founders VALUES ('wf','post@nibi.no','torarnehave@gmail.com','central','zone-acct-nibi','nibi.no','2026-09-13')").run()
  env.DB = { prepare(sql) { let args = []; const stmt = { bind(...v) { args = v; return stmt }, async first() { return db.prepare(sql).get(...args) ?? null }, async all() { return { results: db.prepare(sql).all(...args) } }, async run() { db.prepare(sql).run(...args); return { success: true } } }; return stmt } }
  env.CF_ACCOUNT_ID = ACCOUNT
  env.CF_API_TOKEN = 'platform-token'
  const cf = fakeCloudflare({ token: 'platform-token', worker: 'brand-worker', host: 'x.vegvisr.org', zoneAccount: 'zone-acct-nibi' })
  const r = await executeTool('create_subdomain', { ...OWNER, subdomain: 'test', root_domain: 'nibi.no' }, env)
  check('central World with zone in another account is refused with the reason', r.success === false && /zone is in Cloudflare account zone-acct-nibi/.test(r.error || '') && cf.puts.length === 0, JSON.stringify(r))
}

// 10. deploy_world_proxy on a refused read must not fall through to a blind upload.
{
  const { env } = makeEnv()
  env.WORLD_TEMPLATES = { async get() { return 'export default { fetch() {} } // DEFAULT_ORIGIN || env.TARGET_ORIGIN' } }
  env.HTML_PUBLISH_SECRET = 'secret'
  const cf = fakeCloudflare({ token: 'some-other-token' })
  const r = await executeTool('deploy_world_proxy', { ...OWNER, domain: 'nibi.no' }, env)
  check('deploy_world_proxy refuses when it cannot see what is live', r.success === false && /refused \(403\)/.test(r.error || '') && /Nothing was deployed/.test(r.error || '') && cf.writes.length === 0, JSON.stringify({ r, writes: cf.writes }))
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(failures ? `\n${failures} FAILED` : '\nPASS — create_subdomain attaches World subdomains to the World brand proxy, no Zone ID asked.')
process.exit(failures ? 1 : 0)
