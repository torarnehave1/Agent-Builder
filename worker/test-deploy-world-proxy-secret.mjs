// deploy_world_proxy stamps the World's OWN publish secret (2026-10-27).
//
// A forced redeploy of sodesign-brand-proxy stamped agent-worker's global HTML_PUBLISH_SECRET,
// while publish_html_node signs with the per-World secret (world-publish-secret:sodesign.no).
// Every publish to the World then answered "Invalid or missing publish token".
// Drives the REAL executor against a fake Cloudflare API.
//
// Run:  node worker/test-deploy-world-proxy-secret.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { DatabaseSync } from 'node:sqlite'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-world-proxy-secret-'))
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

function makeEnv({ worldSecret }) {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE config (user_id TEXT, email TEXT, Role TEXT, bio TEXT, profileimage TEXT, phone TEXT, phone_verified_at TEXT, data TEXT, cf_account_id TEXT, cf_api_token TEXT, cf_kv_namespace_id TEXT);
    CREATE TABLE world_founders (id TEXT, founder_email TEXT, account_holder_email TEXT, hosting_model TEXT, cf_account_id TEXT, domain TEXT, created_at TEXT);
  `)
  db.prepare(`INSERT INTO config (user_id, email, Role) VALUES ('owner-uuid', 'owner@example.com', 'Superadmin')`).run()
  db.prepare(`INSERT INTO config (user_id, email, Role, cf_account_id, cf_api_token) VALUES ('s', 'stine.oksvold@gmail.com', 'Admin', ?, 'tok')`).run(ACCOUNT)
  db.prepare(`INSERT INTO world_founders VALUES ('wf', 'stine.oksvold@gmail.com', 'stineoksvolddesign@gmail.com', 'own_account', ?, 'sodesign.no', '2026-10-15')`).run(ACCOUNT)
  const DB = { prepare(sql) { let a = []; const st = { bind(...x) { a = x; return st }, async first() { try { return db.prepare(sql).get(...a) ?? null } catch { return null } }, async all() { try { return { results: db.prepare(sql).all(...a) } } catch { return { results: [] } } }, async run() { try { db.prepare(sql).run(...a) } catch {} return { success: true } } }; return st } }
  const state = { uploads: [] }
  const ok = (result) => new Response(JSON.stringify({ success: true, result }), { status: 200 })
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    const p = url.pathname.replace('/client/v4', '')
    const method = (init.method || 'GET').toUpperCase()
    if (p === `/accounts/${ACCOUNT}/storage/kv/namespaces` && method === 'GET') return ok([{ id: 'kv-html', title: 'HTML_PAGES-sodesign' }, { id: 'kv-brand', title: 'BRAND_CONFIG-sodesign' }, { id: 'kv-html', title: 'sodesign-HTML_PAGES' }, { id: 'kv-brand', title: 'sodesign-BRAND_CONFIG' }])
    if (p === `/accounts/${ACCOUNT}/storage/kv/namespaces` && method === 'POST') { const b = JSON.parse(init.body); return ok({ id: 'kv-' + b.title, title: b.title }) }
    const sm = p.match(new RegExp(`^/accounts/${ACCOUNT}/workers/scripts/([^/]+)$`))
    if (sm && method === 'GET') return new Response('not found', { status: 404 })
    if (sm && method === 'PUT') { const meta = JSON.parse(await init.body.get('metadata')); state.uploads.push({ name: sm[1], bindings: meta.bindings }); return ok({ id: sm[1] }) }
    if (p.includes('/workers/domains')) return ok([])
    if (p.includes('/subdomain')) return ok({ subdomain: 'x' })
    if (p.endsWith('/tokens/verify')) return ok({ id: 't', status: 'active' })
    if (p === '/zones') return ok([{ id: 'z', name: 'sodesign.no', account: { id: ACCOUNT } }])
    return ok({})
  }
  const kv = new Map([['template:brand-proxy', 'export default { fetch() { return new Response("ok") } }']])
  if (worldSecret) kv.set('world-publish-secret:sodesign.no', worldSecret)
  return { env: { DB, WORLD_TEMPLATES: { async get(k) { return kv.get(k) ?? null }, async put(k, v) { kv.set(k, v) } }, HTML_PUBLISH_SECRET: 'GLOBAL' }, state }
}

const stamped = (state) => {
  const up = state.uploads.find((u) => u.bindings.some((b) => b.name === 'HTML_PUBLISH_SECRET'))
  return up ? up.bindings.find((b) => b.name === 'HTML_PUBLISH_SECRET').text : null
}

{
  const { env, state } = makeEnv({ worldSecret: 'PER-WORLD' })
  const r = await executeTool('deploy_world_proxy', { userId: 'owner-uuid', domain: 'sodesign.no', force: true }, env)
  check('a World with its own secret gets THAT secret on the proxy', stamped(state) === 'PER-WORLD', `stamped=${stamped(state)} result=${JSON.stringify(r).slice(0, 300)}`)
}
{
  const { env, state } = makeEnv({ worldSecret: null })
  const r = await executeTool('deploy_world_proxy', { userId: 'owner-uuid', domain: 'sodesign.no', force: true }, env)
  check('a World without one still gets the legacy global secret', stamped(state) === 'GLOBAL', `stamped=${stamped(state)} result=${JSON.stringify(r).slice(0, 300)}`)
}

process.exit(failures ? 1 : 0)
