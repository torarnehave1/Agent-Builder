// create_node / patch_node accept a World's own node type only in a graph of that World
// (rendering engine phase 2, 2026-10-18). Drives the REAL executeTool with a fake KG_WORKER:
// graph "w1" lives in test-world.example (X-Graph-World), graph "p1" on the platform.
//
// Run:  node worker/test-world-node-types.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'world-types-'))
for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')
fs.symlinkSync(path.join(dir, 'node_modules'), path.join(tmp, 'node_modules'))
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))

let failures = 0
const check = (name, cond, detail) => {
  if (cond) console.log(`ok    ${name}`)
  else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) }
}

const WORLD = 'test-world.example'
const calls = []
const env = {
  DB: { prepare: () => ({ bind() { return this }, async first() { return null }, async all() { return { results: [] } }, async run() { return {} } }) },
  KG_WORKER: {
    async fetch(input, init = {}) {
      const req = input instanceof Request ? input : new Request(input, init)
      const u = new URL(req.url)
      calls.push(u.pathname + u.search)
      const json = (o, headers = {}) => new Response(JSON.stringify(o), { status: 200, headers })
      if (u.pathname === '/node-types') {
        const all = ['fulltext', 'html-node', 'work-context']
        return u.searchParams.get('world') === WORLD ? json({ all: [...all, 'test-card'], worldTypes: ['test-card'] }) : json({ all })
      }
      if (u.pathname === '/getknowgraph') {
        const id = u.searchParams.get('id')
        return json({ metadata: { version: 3 }, nodes: [{ id: 'n1', label: 'N', type: 'fulltext' }], edges: [] }, id === 'w1' ? { 'X-Graph-World': WORLD } : {})
      }
      if (u.pathname === '/addNode') return json({ newVersion: 4 })
      if (u.pathname === '/patchNode') return json({ newVersion: 4, currentVersion: 3 })
      return json({})
    },
  },
}

const attempt = async (tool, input) => {
  try { return { ok: true, r: await executeTool(tool, input, env) } } catch (e) { return { ok: false, error: e.message } }
}

const inWorld = await attempt('create_node', { graphId: 'w1', label: 'Card', type: 'test-card' })
check('create_node: a World type is accepted in that World\'s graph', inWorld.ok, inWorld.error)
check('the World was learned from X-Graph-World, its list from /node-types?world=', calls.includes(`/node-types?world=${WORLD}`), JSON.stringify(calls))

const onPlatform = await attempt('create_node', { graphId: 'p1', label: 'Card', type: 'test-card' })
check('create_node: the same type is refused in a platform graph', !onPlatform.ok && /not a node type/.test(onPlatform.error), JSON.stringify(onPlatform))

const platformType = await attempt('create_node', { graphId: 'p1', label: 'Ctx', type: 'work-context' })
check('a platform type still passes everywhere', platformType.ok, platformType.error)

const patchWorld = await attempt('patch_node', { graphId: 'w1', nodeId: 'n1', fields: { type: 'test-card' } })
check('patch_node: World type accepted in its World', !(patchWorld.error || '').includes('not a node type'), patchWorld.error)
const patchPlatform = await attempt('patch_node', { graphId: 'p1', nodeId: 'n1', fields: { type: 'test-card' } })
check('patch_node: refused on the platform', !patchPlatform.ok && /not a node type/.test(patchPlatform.error), JSON.stringify(patchPlatform))

// ── Nodetyper tools → /node-types/world/* (2026-10-18) ──
{
  const seen = []
  const t = { type: 'kursmodul', title: 'Kursmodul', description: 'One module.', world: WORLD, fields: [{ key: 'tittel', label: 'Tittel', kind: 'text' }] }
  const nenv = { DB: env.DB, KG_WORKER: { async fetch(input, init = {}) {
    const req = input instanceof Request ? input : new Request(input, init)
    const u = new URL(req.url)
    const body = req.method === 'POST' ? JSON.parse(await req.text()) : null
    seen.push({ path: u.pathname + u.search, method: req.method, body })
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status })
    if (u.pathname === '/node-types/world/create') return json({ success: true, alreadyExisted: false, ...t, look: null })
    if (u.pathname === '/node-types/world/look') return body.type === 'nope' ? json({ success: false, error: '"nope" is not a node type of test-world.example. Create it first.' }, 400) : json({ success: true, ...t, look: { version: 1, status: 'pending', impl: body.impl } })
    if (u.pathname === '/node-types/world/mine') return json({ success: true, world: WORLD, types: [{ ...t, look: { version: 1, status: 'approved', impl: '<p>secret draft code</p>' } }] })
    return json({})
  } } }
  const c = await executeTool('create_node_type', { title: 'Kursmodul', description: 'One module.', fields: [{ label: 'Tittel', kind: 'text' }] }, nenv)
  check('create_node_type posts title/fields, no world when none is given', seen[0].method === 'POST' && seen[0].path === '/node-types/world/create' && !('world' in seen[0].body) && seen[0].body.fields.length === 1, JSON.stringify(seen[0]))
  check('create_node_type returns a card with no look', c.success && c.nodeTypeCard?.type === 'kursmodul' && c.nodeTypeCard.look === null, JSON.stringify(c))
  const l = await executeTool('change_node_type_look', { type: 'kursmodul', impl: "<div>x</div><script>addEventListener('message',e=>{if(e.data.vegvisrNode!=='render')return;m.tittel})</script>", sample: { tittel: 'Stillhet' }, sample_label: 'Modul 1' }, nenv)
  check('change_node_type_look returns a draft card with the code and the sample', l.success && l.nodeTypeCard.look.status === 'pending' && /m\.tittel/.test(l.nodeTypeCard.look.impl) && l.nodeTypeCard.sample.tittel === 'Stillhet', JSON.stringify(l))
  const bad = await executeTool('change_node_type_look', { type: 'nope', impl: "<div>x</div><script>addEventListener('message',e=>{if(e.data.vegvisrNode!=='render')return;m.tittel})</script>" }, nenv)
  check('a refused look is reported, not thrown', bad.success === false && /Create it first/.test(bad.error), JSON.stringify(bad))
  // 2026-10-19 live bug 2: an HTML-escaped look drew its own source as text → decoded before saving.
  const esc = await executeTool('change_node_type_look', { type: 'kursmodul', impl: '<![CDATA[&lt;div id=&quot;t&quot;&gt;&lt;/div&gt;&lt;script&gt;addEventListener(&#39;message&#39;,e=&gt;{if(e.data.vegvisrNode!==&#39;render&#39;)return;t.textContent=e.data.node.metadata.tittel})&lt;/script&gt;]]>' }, nenv)
  check('an escaped, CDATA-wrapped look is decoded to real HTML before it is saved', esc.success && /^<div id="t"><\/div><script>addEventListener\('message'/.test(esc.nodeTypeCard.look.impl), JSON.stringify(esc.nodeTypeCard?.look?.impl))
  const deaf = await executeTool('change_node_type_look', { type: 'kursmodul', impl: '<div>metadata.tittel</div>' }, nenv)
  check('a look that never listens for the render message is refused', deaf.success === false && /addEventListener/.test(deaf.error), JSON.stringify(deaf))
  // 2026-10-19 live bug: the look read the LABEL, not the key → refused before anything is saved.
  const before = seen.length
  const labelLook = await executeTool('change_node_type_look', { type: 'kursmodul', impl: "<script>addEventListener('message',e=>{const d=e.data;if(d.vegvisrNode!=='render')return;x=d.node.metadata['Tittel']})</script>" }, nenv)
  check('a look that never reads a field key is refused, naming the key', labelLook.success === false && /tittel/.test(labelLook.error) && !seen.slice(before).some((c) => c.path === '/node-types/world/look'), JSON.stringify(labelLook))
  const keyed = await executeTool('change_node_type_look', { type: 'kursmodul', impl: "<script>addEventListener('message',e=>{const d=e.data;if(d.vegvisrNode!=='render')return;x=d.node.metadata.tittel})</script>", sample: { Tittel: 'Stillhet' } }, nenv)
  check('sample given under the label is moved to the key', keyed.success && keyed.nodeTypeCard.sample.tittel === 'Stillhet' && !('Tittel' in keyed.nodeTypeCard.sample), JSON.stringify(keyed.nodeTypeCard?.sample))
  const m = await executeTool('list_my_node_types', {}, nenv)
  check('list_my_node_types leaves the code out', m.success && m.types.length === 1 && !JSON.stringify(m).includes('secret draft code') && /in use/.test(m.message), JSON.stringify(m))
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(failures ? `\n${failures} failure(s)` : '\nall passed')
process.exit(failures ? 1 : 0)
