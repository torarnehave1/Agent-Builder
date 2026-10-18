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

fs.rmSync(tmp, { recursive: true, force: true })
console.log(failures ? `\n${failures} failure(s)` : '\nall passed')
process.exit(failures ? 1 : 0)
