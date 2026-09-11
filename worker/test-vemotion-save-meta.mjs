// Regression guard: a Vemotion save must not drop composition `meta` (2026-09-11).
//
// executeVemotionSaveComposition rebuilt the composition from five named fields
// (duration/fps/width/height/layers + fontFamily/groups), so every agent save threw away `meta`:
// a carousel's `meta.carousel` slide markers (what "Export slides" and "Post as Instagram carousel"
// capture), `audioTrack`, description/tags/category/metaArea, editor guides, mm scale and the
// project graph link — 70 of 176 stored compositions carry some of it. And because the tool schema
// never mentioned `meta`, a model editing a composition would not send it back even if it were
// kept. The executor now spreads what it is given and, on an update, merges the STORED meta under
// the incoming one (omitted keys kept, null removes a key).
//
// Drives the REAL executor through executeTool with a fake VEMOTION_WORKER binding that serves the
// stored composition on GET and records the body that goes out on POST.
//
// Run:  node worker/test-vemotion-save-meta.mjs   (exit 0 = pass, 1 = fail)

import assert from 'assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))

// worker/package.json has no "type": "module", so copy the real sources into a module-typed temp
// dir and import THOSE — still the actual code.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vemotion-meta-'))
for (const f of fs.readdirSync(dir)) {
  if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
}
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')
fs.symlinkSync(path.join(dir, 'node_modules'), path.join(tmp, 'node_modules'))
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))

let failures = 0
const fail = (name, msg) => { failures++; console.error(`FAIL  ${name}\n      ${msg}`) }
const pass = (name) => console.log(`ok    ${name}`)
const clone = (v) => JSON.parse(JSON.stringify(v))

// A composition that passes the vocabulary gate. The meta.carousel shape is the one
// vemotion-worker's carousel builder writes (slideTimes + fileBase).
const BASE = {
  duration: 3,
  fps: 30,
  width: 1080,
  height: 1350,
  layers: [
    { id: 'bg', type: 'shape', position: { x: 0, y: 0 }, size: { width: 1080, height: 1350 }, properties: { shape: 'rect', color: '#f4ecdf' } },
    { id: 'heading', type: 'text', position: { x: 90, y: 600 }, size: { width: 900, height: 150 }, properties: { text: 'Slide one', fontSize: 72, color: '#1f1a17', align: 'center' } },
  ],
}
const STORED_META = {
  description: 'Instagram carousel (3 slides).',
  tags: ['carousel'],
  carousel: { slideTimes: [0.5, 1.5, 2.5], fileBase: 'meta-test' },
  futureKey: { kept: true },
}
const STORED = { ...clone(BASE), meta: clone(STORED_META), groups: [{ id: 'g1', name: 'Slides', layerIds: ['heading'] }] }

function fakeVemotion({ getStatus = 200 } = {}) {
  const calls = []
  const respond = (status, payload) => ({ status, ok: status < 400, json: async () => payload, text: async () => JSON.stringify(payload) })
  return {
    calls,
    env: {
      VEMOTION_WORKER: {
        fetch: async (url, opts = {}) => {
          const method = (opts.method || 'GET').toUpperCase()
          calls.push({ method, url, body: opts.body ? JSON.parse(opts.body) : null })
          if (method === 'GET' && url.includes('/vemotion/composition?id=')) {
            if (getStatus !== 200) return respond(getStatus, { error: `status ${getStatus}` })
            return respond(200, { ok: true, id: 'comp_meta', name: 'stored', version: 3, composition: clone(STORED) })
          }
          const isUpdate = !!(opts.body && JSON.parse(opts.body).id)
          return respond(isUpdate ? 200 : 201, { ok: true, id: 'comp_meta', summary: { id: 'comp_meta', name: 'saved', layerCount: 2 } })
        },
      },
    },
  }
}

async function save(input, env) {
  try {
    const result = await executeTool('vemotion_save_composition', { authToken: 'test-token', name: 'meta test', ...input }, env)
    if (result && result.success === false) return { refused: String(result.error || result.message || '') }
    return { result }
  } catch (err) {
    return { refused: err.message }
  }
}

const posts = (calls) => calls.filter((c) => c.method === 'POST')
const gets = (calls) => calls.filter((c) => c.method === 'GET')

async function check(name, fn) {
  try { await fn(); pass(name) } catch (err) { fail(name, err.message) }
}

// 1. Create: everything the agent sends reaches the worker — meta, groups, unknown future keys.
await check('create keeps meta, groups and unknown top-level fields', async () => {
  const { env, calls } = fakeVemotion()
  const out = await save({ composition: { ...clone(BASE), meta: clone(STORED_META), groups: clone(STORED.groups), background: 'kept' } }, env)
  assert.ok(!out.refused, `refused: ${out.refused}`)
  assert.strictEqual(gets(calls).length, 0, 'a create must not read a stored version')
  const body = posts(calls)[0]?.body?.composition
  assert.deepStrictEqual(body.meta, STORED_META)
  assert.deepStrictEqual(body.groups, STORED.groups)
  assert.strictEqual(body.background, 'kept')
})

// 2. Update without meta — what a model following the old schema sends — keeps the stored meta.
await check('update without meta carries the stored meta forward (carousel markers intact)', async () => {
  const { env, calls } = fakeVemotion()
  const out = await save({ compositionId: 'comp_meta', composition: clone(BASE) }, env)
  assert.ok(!out.refused, `refused: ${out.refused}`)
  assert.strictEqual(gets(calls).length, 1, 'expected one read of the stored version')
  assert.strictEqual(posts(calls).length, 1)
  assert.deepStrictEqual(posts(calls)[0].body.composition.meta, STORED_META)
  assert.deepStrictEqual([...(out.result.metaKeys || [])].sort(), Object.keys(STORED_META).sort())
})

// 3. Update with a partial meta — keys the model changed win, keys it omitted survive.
await check('update with partial meta merges over the stored meta', async () => {
  const { env, calls } = fakeVemotion()
  const out = await save({ compositionId: 'comp_meta', composition: { ...clone(BASE), meta: { description: 'Edited.' } } }, env)
  assert.ok(!out.refused, `refused: ${out.refused}`)
  assert.deepStrictEqual(posts(calls)[0].body.composition.meta, { ...STORED_META, description: 'Edited.' })
})

// 4. An explicit null removes a key; nothing else is lost.
await check('update with meta.carousel = null removes only the carousel marker', async () => {
  const { env, calls } = fakeVemotion()
  const out = await save({ compositionId: 'comp_meta', composition: { ...clone(BASE), meta: { carousel: null } } }, env)
  assert.ok(!out.refused, `refused: ${out.refused}`)
  const { carousel, ...rest } = STORED_META
  assert.deepStrictEqual(posts(calls)[0].body.composition.meta, rest)
})

// 5. Stored version unreadable — refuse rather than save and silently drop its meta.
await check('update refuses when the stored version cannot be read, and sends no save', async () => {
  const { env, calls } = fakeVemotion({ getStatus: 500 })
  const out = await save({ compositionId: 'comp_meta', composition: clone(BASE) }, env)
  assert.ok(out.refused, 'expected a refusal')
  assert.ok(out.refused.includes('NOT saved'), `refusal should say it was not saved: ${out.refused}`)
  assert.strictEqual(posts(calls).length, 0, 'a save reached the worker')
})

// 6. No stored version (404) — nothing to carry forward, the save proceeds.
await check('update of an id with no stored version saves without inventing meta', async () => {
  const { env, calls } = fakeVemotion({ getStatus: 404 })
  const out = await save({ compositionId: 'comp_new', composition: clone(BASE) }, env)
  assert.ok(!out.refused, `refused: ${out.refused}`)
  assert.strictEqual(posts(calls).length, 1)
  assert.strictEqual(posts(calls)[0].body.composition.meta, undefined)
})

// 7. A composition the gate refuses costs no read and no save.
await check('a gate-refused update performs no read and no save', async () => {
  const { env, calls } = fakeVemotion()
  const bad = clone(BASE)
  bad.layers[0].properties = { shapeType: 'rect', fillColor: '#000' }
  const out = await save({ compositionId: 'comp_meta', composition: bad }, env)
  assert.ok(out.refused, 'expected the gate to refuse')
  assert.strictEqual(calls.length, 0, `${calls.length} request(s) reached the worker`)
})

fs.unlinkSync(path.join(tmp, 'node_modules'))
fs.rmSync(tmp, { recursive: true, force: true })

if (failures > 0) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log('\nAll Vemotion save-meta checks passed.')
