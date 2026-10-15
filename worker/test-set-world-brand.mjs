// set_world_brand writes a World host's look into the World's own BRAND_CONFIG (G8, 2026-10-15).
//
// Drives the REAL executor with in-memory SQLite and a fake Cloudflare API: the namespace must be
// the one bound to the World's brand proxy (found by the worker serving me.<domain>), the value
// must carry theme.editor in the shape the Knowledge-Editor reads, and bad input must be refused
// before anything is written.
//
// Run:  node worker/test-set-world-brand.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { DatabaseSync } from 'node:sqlite'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'set-world-brand-'))
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

function makeEnv() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE config (user_id TEXT, email TEXT, Role TEXT, bio TEXT, profileimage TEXT, phone TEXT, phone_verified_at TEXT, data TEXT, cf_account_id TEXT, cf_api_token TEXT);
    CREATE TABLE world_founders (id TEXT, founder_email TEXT, account_holder_email TEXT, hosting_model TEXT, cf_account_id TEXT, domain TEXT, created_at TEXT);
  `)
  db.prepare(`INSERT INTO config (user_id, email, Role) VALUES ('owner-uuid', 'owner@example.com', 'Superadmin')`).run()
  db.prepare(`INSERT INTO config (user_id, email, Role) VALUES ('admin-uuid', 'admin@example.com', 'Admin')`).run()
  db.prepare(`INSERT INTO config (user_id, email, Role, cf_account_id, cf_api_token) VALUES ('s', 'stine.oksvold@gmail.com', 'Admin', ?, 'tok-stine')`).run(ACCOUNT)
  db.prepare(`INSERT INTO world_founders VALUES ('wf', 'stine.oksvold@gmail.com', 'stineoksvolddesign@gmail.com', 'own_account', ?, 'sodesign.no', '2026-10-15')`).run(ACCOUNT)
  const DB = { prepare(sql) { let a = []; const st = { bind(...x) { a = x; return st }, async first() { return db.prepare(sql).get(...a) ?? null }, async all() { return { results: db.prepare(sql).all(...a) } }, async run() { db.prepare(sql).run(...a); return { success: true } } }; return st } }
  const kv = new Map()
  const ok = (result) => new Response(JSON.stringify({ success: true, result }), { status: 200 })
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    const p = url.pathname.replace('/client/v4', '')
    const method = (init.method || 'GET').toUpperCase()
    if (p === `/accounts/${ACCOUNT}/workers/domains`) return ok([{ hostname: 'me.sodesign.no', service: 'sodesign-brand-proxy' }])
    if (p === `/accounts/${ACCOUNT}/workers/scripts/sodesign-brand-proxy/settings`) return ok({ bindings: [{ type: 'kv_namespace', name: 'HTML_PAGES', namespace_id: 'ns-pages' }, { type: 'kv_namespace', name: 'BRAND_CONFIG', namespace_id: 'ns-brand' }] })
    if (p === `/accounts/${ACCOUNT}/workers/scripts/sodesign-brand-proxy`) return new Response('export default {}', { status: 200 })
    if (p.startsWith(`/accounts/${ACCOUNT}/workers/scripts/`)) return new Response(JSON.stringify({ success: false }), { status: 404 })
    const m = p.match(new RegExp(`^/accounts/${ACCOUNT}/storage/kv/namespaces/([^/]+)/values/(.+)$`))
    if (m && method === 'PUT') { kv.set(`${m[1]}|${decodeURIComponent(m[2])}`, init.body); return ok({}) }
    if (m) return new Response(kv.get(`${m[1]}|${decodeURIComponent(m[2])}`) ?? '', { status: 200 })
    if (p.endsWith('/tokens/verify')) return ok({ id: 't', status: 'active' })
    return new Response(JSON.stringify({ success: false, errors: [{ message: `unexpected ${method} ${p}` }] }), { status: 404 })
  }
  return { env: { DB }, kv }
}

const STINE = {
  domain: 'sodesign.no', host: 'editor.sodesign.no', name: 'Stine Oksvold Design', slogan: 'Kunnskapsgrafer',
  logo_url: 'https://favicons.vegvisr.org/x.png', target_app: 'editor',
  editor: { fontsCssUrl: 'https://fonts.googleapis.com/css2?family=Alegreya&family=Alegreya+Sans&display=swap', fontSans: "'Alegreya Sans', sans-serif", fontDisplay: 'Alegreya, serif', accent: '#a3386b', ink: '#2b3445', surface: '#eadce2', scheme: 'light', lang: 'no' },
}

{
  const { env, kv } = makeEnv()
  const r = await executeTool('set_world_brand', { userId: 'owner-uuid', ...STINE }, env)
  check('writes and reads back', r.success === true, JSON.stringify(r).slice(0, 400))
  const stored = JSON.parse(kv.get('ns-brand|brand:editor.sodesign.no') || '{}')
  check('into the BRAND_CONFIG bound to the World proxy, never HTML_PAGES', kv.has('ns-brand|brand:editor.sodesign.no') && ![...kv.keys()].some((k) => k.startsWith('ns-pages|')), JSON.stringify([...kv.keys()]))
  check('in the shape the editor reads (branding.theme.editor)', stored.branding?.theme?.editor?.accent === '#a3386b' && stored.branding?.theme?.editor?.fontSans === "'Alegreya Sans', sans-serif" && stored.branding?.brand?.name === 'Stine Oksvold Design' && stored.targetApp === 'editor', JSON.stringify(stored))
  check('title defaults to the name', stored.branding?.meta?.title === 'Stine Oksvold Design', JSON.stringify(stored.branding?.meta))
  const ed = stored.branding?.theme?.editor || {}
  check('surface, scheme, lang and heading font are kept', ed.surface === '#eadce2' && ed.scheme === 'light' && ed.lang === 'no' && ed.fontDisplay === 'Alegreya, serif', JSON.stringify(ed))
}
{
  const { env, kv } = makeEnv()
  const r = await executeTool('set_world_brand', { userId: 'owner-uuid', ...STINE, host: 'editor.example.com' }, env)
  check('a host outside the World is refused, nothing written', r.success === false && kv.size === 0, JSON.stringify(r))
}
{
  const { env, kv } = makeEnv()
  const r = await executeTool('set_world_brand', { userId: 'owner-uuid', ...STINE, editor: { ...STINE.editor, fontsCssUrl: 'https://evil.example/x.css' } }, env)
  check('a non-Google-Fonts stylesheet is refused, nothing written', r.success === false && kv.size === 0, JSON.stringify(r))
}
{
  const { env, kv } = makeEnv()
  const r = await executeTool('set_world_brand', { userId: 'owner-uuid', ...STINE, editor: { accent: 'red; background:url(x)', scheme: 'neon', lang: 'xx' } }, env)
  const stored = JSON.parse(kv.get('ns-brand|brand:editor.sodesign.no') || '{}')
  check('a colour that is not hex is dropped, not written', r.success === true && stored.branding?.theme?.editor === undefined, JSON.stringify(stored))
}
{
  const { env, kv } = makeEnv()
  const r = await executeTool('set_world_brand', { userId: 'admin-uuid', ...STINE }, env)
  check('a non-Superadmin is refused', r.success === false && kv.size === 0, JSON.stringify(r))
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nall set_world_brand checks pass')
