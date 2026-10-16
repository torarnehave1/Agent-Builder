// provision_world_photos keeps a World's registered photo storage (2026-10-16).
//
// Stine's World moved its primary domain to sodesign.no. Names derived from the domain would now be
// world-photos-sodesign / sodesign-photos-proxy / PHOTO_ALBUMS-sodesign, so a re-run (to roll out
// the byte-range proxy) would create a new bucket and an EMPTY albums namespace and bind them.
// Drives the REAL executor against a fake Cloudflare API.
//
// Run:  node worker/test-provision-world-photos-keep.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { DatabaseSync } from 'node:sqlite'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'provision-world-photos-keep-'))
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

function makeEnv({ prior }) {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE config (user_id TEXT, email TEXT, Role TEXT, bio TEXT, profileimage TEXT, phone TEXT, phone_verified_at TEXT, data TEXT, cf_account_id TEXT, cf_api_token TEXT,
      photos_bucket_name TEXT, photos_proxy_worker TEXT, photos_delivery_base TEXT, photos_delivery_mode TEXT, photos_albums_kv_id TEXT, photos_status TEXT, photos_provisioned_at TEXT);
    CREATE TABLE world_founders (id TEXT, founder_email TEXT, account_holder_email TEXT, hosting_model TEXT, cf_account_id TEXT, domain TEXT, created_at TEXT);
  `)
  db.prepare(`INSERT INTO config (user_id, email, Role) VALUES ('owner-uuid', 'owner@example.com', 'Superadmin')`).run()
  db.prepare(`INSERT INTO config (user_id, email, Role, cf_account_id, cf_api_token, photos_bucket_name, photos_proxy_worker, photos_delivery_base, photos_albums_kv_id, photos_status) VALUES ('s', 'stine.oksvold@gmail.com', 'Admin', ?, 'tok', ?, ?, ?, ?, ?)`)
    .run(ACCOUNT, prior ? 'world-photos-stineoksvolddesign' : null, prior ? 'stineoksvolddesign-photos-proxy' : null, prior ? 'https://cdn.stineoksvolddesign.no' : null, prior ? 'kv-old' : null, prior ? 'active' : null)
  db.prepare(`INSERT INTO world_founders VALUES ('wf', 'stine.oksvold@gmail.com', 'stineoksvolddesign@gmail.com', 'own_account', ?, 'sodesign.no', '2026-10-15')`).run(ACCOUNT)
  const DB = { prepare(sql) { let a = []; const st = { bind(...x) { a = x; return st }, async first() { return db.prepare(sql).get(...a) ?? null }, async all() { return { results: db.prepare(sql).all(...a) } }, async run() { db.prepare(sql).run(...a); return { success: true } } }; return st } }
  const state = { bucketsCreated: [], kvCreated: [], uploads: [], buckets: prior ? ['world-photos-stineoksvolddesign'] : [], ns: prior ? [{ id: 'kv-old', title: 'PHOTO_ALBUMS-stineoksvolddesign' }] : [] }
  const ok = (result) => new Response(JSON.stringify({ success: true, result }), { status: 200 })
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    const p = url.pathname.replace('/client/v4', '')
    const method = (init.method || 'GET').toUpperCase()
    if (p === `/accounts/${ACCOUNT}/r2/buckets` && method === 'GET') return ok({ buckets: state.buckets.map((name) => ({ name })) })
    if (p === `/accounts/${ACCOUNT}/r2/buckets` && method === 'POST') { const b = JSON.parse(init.body); state.bucketsCreated.push(b.name); state.buckets.push(b.name); return ok(b) }
    if (p === `/accounts/${ACCOUNT}/storage/kv/namespaces` && method === 'GET') return ok(state.ns)
    if (p === `/accounts/${ACCOUNT}/storage/kv/namespaces` && method === 'POST') { const b = JSON.parse(init.body); const n = { id: 'kv-new', title: b.title }; state.kvCreated.push(b.title); state.ns.push(n); return ok(n) }
    const sm = p.match(new RegExp(`^/accounts/${ACCOUNT}/workers/scripts/([^/]+)$`))
    if (sm && method === 'GET') return new Response('x', { status: prior ? 200 : 404 })
    if (sm && method === 'PUT') { const meta = JSON.parse(await init.body.get('metadata')); state.uploads.push({ name: sm[1], bindings: meta.bindings }); return ok({ id: sm[1] }) }
    if (p.includes('/workers/domains')) return ok([])
    if (p.includes('/subdomain')) return ok({ subdomain: 'x' })
    if (p.endsWith('/tokens/verify')) return ok({ id: 't', status: 'active' })
    if (url.hostname.startsWith('cdn.')) return new Response(JSON.stringify({ ok: true, bucket_bound: true, albums_bound: true }), { status: 200 })
    if (p === '/zones') return ok([])
    return ok({})
  }
  const kv = new Map([['template:world-photos-proxy', 'export default { fetch() { return new Response("ok") } }']])
  return { env: { DB, WORLD_TEMPLATES: { async get(k) { return kv.get(k) ?? null } }, HTML_PUBLISH_SECRET: 's' }, state }
}

{
  const { env, state } = makeEnv({ prior: true })
  const r = await executeTool('provision_world_photos', { userId: 'owner-uuid', domain: 'sodesign.no', force: true }, env)
  const up = state.uploads[0] || { bindings: [] }
  const b = Object.fromEntries(up.bindings.map((x) => [x.name, x.bucket_name || x.namespace_id || x.text]))
  check('re-run after the domain change redeploys the SAME worker', up.name === 'stineoksvolddesign-photos-proxy', JSON.stringify(state.uploads.map((u) => u.name)) + ' ' + JSON.stringify(r).slice(0, 300))
  check('bound to the SAME bucket and albums namespace, delivery base unchanged', b.PHOTOS_BUCKET === 'world-photos-stineoksvolddesign' && b.PHOTO_ALBUMS === 'kv-old' && b.DELIVERY_BASE === 'https://cdn.stineoksvolddesign.no', JSON.stringify(b))
  check('creates no new bucket and no new albums namespace', state.bucketsCreated.length === 0 && state.kvCreated.length === 0, JSON.stringify({ b: state.bucketsCreated, k: state.kvCreated }))
}
{
  const { env, state } = makeEnv({ prior: false })
  await executeTool('provision_world_photos', { userId: 'owner-uuid', domain: 'sodesign.no' }, env)
  check('a World without photo storage still gets names from its domain', state.bucketsCreated.includes('world-photos-sodesign') && state.uploads.some((u) => u.name === 'sodesign-photos-proxy'), JSON.stringify(state))
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nall provision_world_photos keep checks pass')
