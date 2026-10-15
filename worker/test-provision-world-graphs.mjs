// provision_world_graphs — a World's graph store in the founder's own Cloudflare account (G2, 2026-10-15).
//
// Drives the REAL executor through executeTool, with in-memory SQLite for the platform D1, a fake
// Cloudflare API behind globalThis.fetch — and the REAL graph proxy (vegvisr-frontend's built
// world-graphs-proxy bundle) answering graphs.<domain>, over its own in-memory D1. So the migrate
// token agent-worker signs is verified by the proxy's own code: if the two copies of the token
// format drift, this test fails with "bad signature".
//
// Run:  node worker/test-provision-world-graphs.mjs   (exit 0 = pass, 1 = fail)
// Needs: vegvisr-frontend/dev-worker/world-graphs-proxy/build.sh to have produced the bundle.

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { DatabaseSync } from 'node:sqlite'

const dir = path.dirname(fileURLToPath(import.meta.url))
const BUNDLE = process.env.WORLD_GRAPHS_PROXY_BUNDLE || '/Volumes/T7/vegvisr-frontend/dev-worker/world-graphs-proxy/dist/world-graphs-proxy.js'
if (!fs.existsSync(BUNDLE)) {
  console.error(`SKIP  proxy bundle not found at ${BUNDLE} — run world-graphs-proxy/build.sh in vegvisr-frontend first`)
  process.exit(1)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'provision-graphs-'))
for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')
fs.symlinkSync(path.join(dir, 'node_modules'), path.join(tmp, 'node_modules'))
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))
const proxy = (await import(BUNDLE)).default

let failures = 0
const check = (name, cond, detail) => {
  if (cond) console.log(`ok    ${name}`)
  else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) }
}

const ACCOUNT = 'b68bda52e04081f0cbc04df338a44019'
const DOMAIN = 'sodesign.no'

// A D1-shaped wrapper over node:sqlite, with batch() as one transaction.
function d1(db) {
  const wrap = (sql) => {
    let args = []
    const stmt = {
      bind(...a) { args = a.map((v) => (v === undefined ? null : v)); return stmt },
      async first() { return db.prepare(sql).get(...args) ?? null },
      async all() { return { results: db.prepare(sql).all(...args) } },
      async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: r.changes } } },
    }
    return stmt
  }
  return {
    prepare: wrap,
    async batch(stmts) {
      db.exec('BEGIN')
      try { const out = []; for (const s of stmts) out.push(await s.run()); db.exec('COMMIT'); return out } catch (e) { db.exec('ROLLBACK'); throw e }
    },
  }
}

async function makeWorld({ withKey = true, schemaTables = true } = {}) {
  const platform = new DatabaseSync(':memory:')
  platform.exec(`
    CREATE TABLE config (user_id TEXT, email TEXT, Role TEXT, bio TEXT, profileimage TEXT, phone TEXT, phone_verified_at TEXT, data TEXT, cf_account_id TEXT, cf_api_token TEXT);
    CREATE TABLE world_founders (id TEXT, founder_email TEXT, account_holder_email TEXT, hosting_model TEXT, cf_account_id TEXT, domain TEXT, created_at TEXT);
  `)
  if (schemaTables) platform.exec(`
    CREATE TABLE knowledge_graphs (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, created_date DATETIME DEFAULT CURRENT_TIMESTAMP, created_by TEXT NOT NULL, parent_graph_id TEXT, data TEXT, updated_at DATETIME, user_id TEXT, source_app TEXT, ai_instructions TEXT);
    CREATE TABLE knowledge_graph_history (id TEXT PRIMARY KEY, graph_id TEXT NOT NULL, version INTEGER NOT NULL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, data TEXT NOT NULL, user_id TEXT, source_app TEXT);
    CREATE INDEX idx_history_graph ON knowledge_graph_history (graph_id);
    CREATE TABLE graph_trash (id TEXT PRIMARY KEY, graph_id TEXT, title TEXT, graph_data TEXT, graph_history TEXT, deleted_by TEXT, deleted_at DATETIME, expires_at DATETIME);
  `)
  platform.prepare(`INSERT INTO config (user_id, email, Role) VALUES ('owner-uuid', 'owner@example.com', 'Superadmin')`).run()
  platform.prepare(`INSERT INTO config (user_id, email, Role) VALUES ('admin-uuid', 'admin@example.com', 'Admin')`).run()
  platform.prepare(`INSERT INTO config (user_id, email, Role, cf_account_id, cf_api_token) VALUES ('s', 'stine.oksvold@gmail.com', 'Admin', ?, 'tok-stine')`).run(ACCOUNT)
  platform.prepare(`INSERT INTO world_founders VALUES ('wf', 'stine.oksvold@gmail.com', 'stineoksvolddesign@gmail.com', 'own_account', ?, ?, '2026-10-15')`).run(ACCOUNT, DOMAIN)

  const keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const privateJwk = await crypto.subtle.exportKey('jwk', keys.privateKey)
  const templates = new Map([['template:world-graphs-proxy', fs.readFileSync(BUNDLE, 'utf8')]])
  const env = {
    DB: d1(platform),
    WORLD_TEMPLATES: { async get(k) { return templates.get(k) ?? null } },
    ...(withKey ? { WORLD_GRAPH_SIGNING_KEY: JSON.stringify(privateJwk) } : {}),
  }

  // Fake Cloudflare + the real proxy behind graphs.<domain>.
  const state = { databases: [], scripts: new Map(), domains: [], worldDb: new DatabaseSync(':memory:'), uploads: [] }
  const ok = (result) => new Response(JSON.stringify({ success: true, result }), { status: 200 })
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    const method = (init.method || 'GET').toUpperCase()
    if (url.hostname === `graphs.${DOMAIN}`) {
      const binding = state.scripts.get(`${DOMAIN.split('.')[0]}-graphs-proxy`)
      const bindingEnv = {}
      for (const b of binding?.bindings || []) {
        if (b.type === 'd1') bindingEnv[b.name] = d1(state.worldDb)
        if (b.type === 'plain_text') bindingEnv[b.name] = b.text
      }
      return proxy.fetch(new Request(url, { method, headers: init.headers, body: init.body }), bindingEnv)
    }
    if (url.hostname !== 'api.cloudflare.com') return new Response('not found', { status: 404 })
    const p = url.pathname.replace('/client/v4', '')
    if (p === `/accounts/${ACCOUNT}/d1/database` && method === 'GET') return ok(state.databases.filter((d) => d.name === url.searchParams.get('name')))
    if (p === `/accounts/${ACCOUNT}/d1/database` && method === 'POST') {
      const b = JSON.parse(init.body)
      const db = { uuid: `uuid-${state.databases.length + 1}`, name: b.name, jurisdiction: b.jurisdiction }
      state.databases.push(db)
      return ok(db)
    }
    const sm = p.match(new RegExp(`^/accounts/${ACCOUNT}/workers/scripts/([^/]+)$`))
    if (sm && method === 'GET') return state.scripts.has(sm[1]) ? ok({ id: sm[1] }) : new Response(JSON.stringify({ success: false }), { status: 404 })
    if (sm && method === 'PUT') {
      const meta = JSON.parse(await init.body.get('metadata'))
      state.scripts.set(sm[1], meta)
      state.uploads.push({ name: sm[1], bindings: meta.bindings })
      return ok({ id: sm[1] })
    }
    if (p === `/accounts/${ACCOUNT}/workers/domains` && method === 'GET') return ok(state.domains.filter((d) => d.hostname === url.searchParams.get('hostname')))
    if (p === `/accounts/${ACCOUNT}/workers/domains` && method === 'PUT') { const b = JSON.parse(init.body); state.domains.push(b); return ok(b) }
    if (p === '/zones') return ok([{ id: 'zone-sodesign', name: DOMAIN, account: { id: ACCOUNT } }])
    if (p.endsWith('/tokens/verify')) return ok({ id: 'tok-id', status: 'active' })
    return new Response(JSON.stringify({ success: false, errors: [{ message: `unexpected ${method} ${p}` }] }), { status: 404 })
  }
  return { env, state, platform, privateJwk }
}

// 1. Full provisioning against an empty account.
{
  const { env, state, platform } = await makeWorld()
  const r = await executeTool('provision_world_graphs', { userId: 'owner-uuid', domain: DOMAIN }, env)
  check('provisions end to end', r.success === true, JSON.stringify(r).slice(0, 800))
  check('creates the D1 database in the EU', state.databases.length === 1 && state.databases[0].name === 'world-graphs-sodesign' && state.databases[0].jurisdiction === 'eu', JSON.stringify(state.databases))
  const up = state.uploads[0]
  const names = (up?.bindings || []).map((b) => `${b.type}:${b.name}`).sort()
  check('deploys sodesign-graphs-proxy with exactly GRAPH_DB, WORLD_DOMAIN, PLATFORM_PUBLIC_KEY', up?.name === 'sodesign-graphs-proxy' && JSON.stringify(names) === JSON.stringify(['d1:GRAPH_DB', 'plain_text:PLATFORM_PUBLIC_KEY', 'plain_text:WORLD_DOMAIN']), JSON.stringify(up))
  const pub = JSON.parse((up?.bindings || []).find((b) => b.name === 'PLATFORM_PUBLIC_KEY')?.text || '{}')
  check('ships the PUBLIC key only — no private component reaches the founder account', pub.x && !pub.d, JSON.stringify(pub))
  check('attaches graphs.sodesign.no to the proxy', state.domains.some((d) => d.hostname === 'graphs.sodesign.no' && d.service === 'sodesign-graphs-proxy'), JSON.stringify(state.domains))
  const worldTables = state.worldDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name)
  check('creates the three graph tables in the World database', ['knowledge_graphs', 'knowledge_graph_history', 'graph_trash'].every((t) => worldTables.includes(t)), worldTables.join(','))
  const cols = state.worldDb.prepare("PRAGMA table_info(knowledge_graphs)").all().map((c) => c.name)
  check('copies the live platform columns, ai_instructions included', cols.includes('ai_instructions') && cols.includes('source_app'), cols.join(','))
  const idx = state.worldDb.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((i) => i.name)
  check('adds the unique (graph_id, version) index and copies platform indexes', idx.includes('ux_wg_history_graph_version') && idx.includes('idx_history_graph'), idx.join(','))
  const row = platform.prepare('SELECT * FROM world_graph_stores WHERE domain = ?').get(DOMAIN)
  check('records the registry row as provisioned, never active', row && row.status === 'provisioned' && row.endpoint_base === 'https://graphs.sodesign.no' && row.d1_database_id === 'uuid-1' && row.schema_version === r.schema_version, JSON.stringify(row))
  check('says the store is not routed yet', /NOT routed/.test(r.message || ''), r.message)

  // 2. Idempotent re-run: nothing new is created, the row is not flipped.
  platform.prepare("UPDATE world_graph_stores SET status = 'active' WHERE domain = ?").run(DOMAIN)
  const again = await executeTool('provision_world_graphs', { userId: 'owner-uuid', domain: DOMAIN }, env)
  check('re-run succeeds without creating a second database or redeploying', again.success === true && state.databases.length === 1 && state.uploads.length === 1, JSON.stringify(again.steps))
  check('re-run leaves an active store active', platform.prepare('SELECT status FROM world_graph_stores WHERE domain = ?').get(DOMAIN).status === 'active', 'status changed')
}

// 3. Refusals that must leave the founder account untouched.
{
  const { env, state } = await makeWorld({ withKey: false })
  const r = await executeTool('provision_world_graphs', { userId: 'owner-uuid', domain: DOMAIN }, env)
  check('without a signing key: refuses before creating anything', r.success === false && /WORLD_GRAPH_SIGNING_KEY/.test(r.error) && state.databases.length === 0 && state.uploads.length === 0, JSON.stringify(r))
}
{
  const { env, state } = await makeWorld({ schemaTables: false })
  const r = await executeTool('provision_world_graphs', { userId: 'owner-uuid', domain: DOMAIN }, env)
  check('without a readable platform schema: refuses before creating anything', r.success === false && /schema read incomplete/.test(r.error) && state.databases.length === 0, JSON.stringify(r))
}
{
  const { env, state } = await makeWorld()
  const r = await executeTool('provision_world_graphs', { userId: 'admin-uuid', domain: DOMAIN }, env)
  check('a non-Superadmin is refused', r.success === false && state.databases.length === 0, JSON.stringify(r))
}
// 4. A proxy holding a different public key refuses the migrate: the signature check is real.
{
  const { env, state } = await makeWorld()
  // Replace the uploaded public key with an unrelated one right after the upload, so the proxy
  // holds a key that did not sign the migrate.
  const realPut = globalThis.fetch
  let swapped = false
  globalThis.fetch = async (input, init = {}) => {
    const res = await realPut(input, init)
    const u = new URL(typeof input === 'string' ? input : input.url)
    if (!swapped && u.pathname.includes('/workers/scripts/') && (init.method || '').toUpperCase() === 'PUT') {
      const meta = state.scripts.get('sodesign-graphs-proxy')
      meta.bindings = meta.bindings.map((b) => (b.name === 'PLATFORM_PUBLIC_KEY' ? { ...b, text: JSON.stringify({ kty: 'OKP', crv: 'Ed25519', x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }) } : b))
      swapped = true
    }
    return res
  }
  const r = await executeTool('provision_world_graphs', { userId: 'owner-uuid', domain: DOMAIN }, env)
  check('a proxy with another public key rejects the migrate as a bad signature', r.success === false && /bad signature/.test(r.error), JSON.stringify(r).slice(0, 400))
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nall provision_world_graphs checks pass')
