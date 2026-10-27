// World brand graph tools (2026-10-27): save_world_brand / get_world_brand / publish_world_brand.
// Drives the real executor against a fake KG worker and a fake set_world_brand.
//
// Run:  node worker/test-world-brand.mjs   (exit 0 = pass, 1 = fail)

import { DatabaseSync } from 'node:sqlite'
import { brandGraphId, mergeBrand, brandToSetWorldBrandInput, executeWorldBrandTool } from './world-brand.js'

let failures = 0
const check = (name, cond, detail) => {
  if (cond) console.log(`ok    ${name}`)
  else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) }
}

// ---- id ----
const id1 = await brandGraphId('sodesign.no')
check('brand graph id is a UUID v4', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id1), id1)
check('brand graph id is stable per domain and differs between domains', id1 === (await brandGraphId('SODESIGN.no')) && id1 !== (await brandGraphId('nibi.no')), id1)

// ---- merge / validation ----
check('name required the first time', /name is required/.test(mergeBrand(null, { colors: { accent: '#a3386b' } }).error || ''), '')
check('bad colour refused', /colors.accent/.test(mergeBrand(null, { name: 'X', colors: { accent: 'pink' } }).error || ''), '')
check('unknown colour key refused', /unknown colour/.test(mergeBrand(null, { name: 'X', colors: { primary: '#fff' } }).error || ''), '')
check('font stylesheet must be Google Fonts', /css_url/.test(mergeBrand(null, { name: 'X', fonts: { css_url: 'https://evil.example/f.css' } }).error || ''), '')
check('font family with markup refused', /fonts.display/.test(mergeBrand(null, { name: 'X', fonts: { display: 'x;}</style>' } }).error || ''), '')
const m1 = mergeBrand({ name: 'Old', colors: { accent: '#111111', ink: '#222222' }, fonts: { body: 'Arial' } }, { colors: { accent: '#A3386B' }, slogan: 'Kontakter' })
check('merge keeps untouched values and lowercases hex', m1.brand && m1.brand.name === 'Old' && m1.brand.colors.accent === '#a3386b' && m1.brand.colors.ink === '#222222' && m1.brand.fonts.body === 'Arial' && m1.brand.slogan === 'Kontakter', JSON.stringify(m1))

// ---- mapping to set_world_brand ----
const mapped = brandToSetWorldBrandInput('sodesign.no', { name: 'S', logoUrl: 'https://l/a.png', logoSquareUrl: 'https://l/sq.png', colors: { accent: '#a3386b', ink: '#2b3445', surface: '#eadce2' }, fonts: { display: 'Alegreya, serif', body: "'Alegreya Sans', sans-serif", cssUrl: 'https://fonts.googleapis.com/css2?family=Alegreya' }, lang: 'no', scheme: 'light' })
check('publish maps to brand:<domain> with editor theme', mapped.host === 'sodesign.no' && mapped.editor.accent === '#a3386b' && mapped.editor.fontDisplay === 'Alegreya, serif' && mapped.editor.fontSans.includes('Alegreya Sans') && mapped.favicon_url === 'https://l/sq.png' && mapped.editor.lang === 'no', JSON.stringify(mapped))

// ---- executor ----
function makeEnv() {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE config (user_id TEXT, email TEXT, Role TEXT); CREATE TABLE world_founders (founder_email TEXT, account_holder_email TEXT, domain TEXT, created_at TEXT); CREATE TABLE system_owners (email TEXT);`)
  db.prepare(`INSERT INTO config VALUES ('super', 'owner@example.com', 'Superadmin'), ('stine', 'stine.oksvold@gmail.com', 'Admin'), ('other', 'other@example.com', 'User')`).run()
  db.prepare(`INSERT INTO world_founders VALUES ('stine.oksvold@gmail.com', 'stineoksvolddesign@gmail.com', 'sodesign.no', '2026-10-15')`).run()
  const DB = { prepare(sql) { let a = []; const st = { bind(...x) { a = x; return st }, async first() { return db.prepare(sql).get(...a) ?? null }, async all() { return { results: db.prepare(sql).all(...a) } }, async run() { db.prepare(sql).run(...a); return { success: true } } }; return st } }
  const graphs = new Map()
  const calls = []
  const KG_WORKER = {
    async fetch(url, init = {}) {
      const u = new URL(url)
      const acting = (init.headers || {})['x-acting-user-email']
      calls.push({ path: u.pathname, acting, body: init.body ? JSON.parse(init.body) : null })
      if (u.pathname === '/getknowgraph') {
        const g = graphs.get(u.searchParams.get('id'))
        if (!g) return new Response(JSON.stringify({ error: 'Graph not found' }), { status: 404 })
        return new Response(JSON.stringify(g.data), { status: 200, headers: { 'X-Graph-World': g.world || '' } })
      }
      if (u.pathname === '/saveGraphWithHistory') {
        const b = JSON.parse(init.body)
        const prev = graphs.get(b.id)
        const cur = prev ? prev.data.metadata.version : 0
        if (prev && b.graphData.metadata.version !== cur) return new Response(JSON.stringify({ error: 'Version mismatch' }), { status: 409 })
        const data = JSON.parse(JSON.stringify(b.graphData)); data.metadata.version = cur + 1
        graphs.set(b.id, { data, world: prev ? prev.world : b.world })
        return new Response(JSON.stringify({ message: 'ok', id: b.id, newVersion: cur + 1 }), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    },
  }
  return { env: { DB, KG_WORKER }, graphs, calls }
}

{
  const { env, graphs, calls } = makeEnv()
  const g0 = await executeWorldBrandTool('get_world_brand', { userId: 'stine', domain: 'sodesign.no' }, env)
  check('get before save says there is no brand yet', g0.success && g0.exists === false, JSON.stringify(g0))

  const s1 = await executeWorldBrandTool('save_world_brand', { userId: 'super', domain: 'sodesign.no', name: 'Stine Oksvold Design', colors: { accent: '#a3386b', ink: '#2b3445' }, fonts: { display: 'Alegreya, serif' } }, env)
  const saveCall = calls.find((c) => c.path === '/saveGraphWithHistory')
  check('first save creates the graph in the World, acting as the founder', s1.success && s1.created && saveCall.body.world === 'sodesign.no' && saveCall.acting === 'stine.oksvold@gmail.com' && graphs.get(id1).world === 'sodesign.no', JSON.stringify({ s1, saveCall }))
  const g = graphs.get(id1).data
  check('graph is tagged #BRAND-<domain> with one world-brand node and an about node', g.metadata.metaArea === '#BRAND-sodesign.no' && g.nodes.filter((n) => n.type === 'world-brand').length === 1 && g.nodes.some((n) => n.id === 'om-merkevaren' && n.type === 'fulltext'), JSON.stringify(g.nodes.map((n) => [n.id, n.type])))

  const s2 = await executeWorldBrandTool('save_world_brand', { userId: 'stine', domain: 'sodesign.no', colors: { surface: '#eadce2' } }, env)
  const b2 = graphs.get(id1).data.nodes.find((n) => n.type === 'world-brand').metadata
  check('founder update merges, keeps one brand node, bumps version', s2.success && !s2.created && b2.colors.accent === '#a3386b' && b2.colors.surface === '#eadce2' && graphs.get(id1).data.nodes.filter((n) => n.type === 'world-brand').length === 1 && graphs.get(id1).data.metadata.version === 2, JSON.stringify({ s2, b2 }))

  const g1 = await executeWorldBrandTool('get_world_brand', { userId: 'stine', domain: 'sodesign.no' }, env)
  check('get returns the stored brand', g1.success && g1.exists && g1.brand.name === 'Stine Oksvold Design' && g1.brand.colors.surface === '#eadce2', JSON.stringify(g1))

  const denied = await executeWorldBrandTool('save_world_brand', { userId: 'other', domain: 'sodesign.no', name: 'Hijack' }, env)
  check('a stranger may not change the brand', !denied.success && /founder may change its brand/.test(denied.error), JSON.stringify(denied))

  let sent = null
  const p = await executeWorldBrandTool('publish_world_brand', { userId: 'super', domain: 'sodesign.no' }, env, { setWorldBrand: async (inp) => { sent = inp; return { success: true, key: 'brand:sodesign.no', brand_proxy: 'sodesign-brand-proxy' } } })
  check('publish writes brand:<domain> from the graph via set_world_brand', p.success && sent && sent.host === 'sodesign.no' && sent.name === 'Stine Oksvold Design' && sent.editor.accent === '#a3386b' && sent.userId === 'super', JSON.stringify({ p, sent }))
  const pf = await executeWorldBrandTool('publish_world_brand', { userId: 'super', domain: 'sodesign.no' }, env, { setWorldBrand: async () => ({ success: false, error: 'Superadmin role required' }) })
  check('a refused publish reports the reason', !pf.success && /Superadmin role required/.test(pf.error), JSON.stringify(pf))
}

process.exit(failures ? 1 : 0)
