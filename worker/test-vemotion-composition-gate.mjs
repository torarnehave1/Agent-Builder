// Regression guard for the Vemotion composition gate (2026-09-11).
//
// Two Instagram posts the agent saved rendered as blank white canvases: /vemotion/composition/save
// accepted `fillColor` / `shapeType`, keyframe times on the video clock and centre-anchored text,
// and reported success. vemotion-composition-gate.js now refuses those before the save.
//
// This test drives the gate AND the real executors (through executeTool, with a fake
// VEMOTION_WORKER binding that records what would go out on the wire) using the two stored
// compositions, a repaired copy of each, and two real compositions that render correctly. When
// video-generator is on disk it also re-derives the renderer's property vocabulary from
// renderer.ts and fails if the gate's copy has drifted.
//
// Run:  node worker/test-vemotion-composition-gate.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const RENDERER = '/Volumes/T7/video-generator/src/lib/renderer.ts'

// worker/package.json has no "type": "module", so a .js with `export` cannot be imported directly.
// Copy the real sources into a module-typed temp dir and import THOSE — still the actual code.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vemotion-gate-'))
for (const f of fs.readdirSync(dir)) {
  if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
}
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')
fs.symlinkSync(path.join(dir, 'node_modules'), path.join(tmp, 'node_modules'))
const { checkVemotionComposition, VOCABULARY } = await import(path.join(tmp, 'vemotion-composition-gate.js'))
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))

const fixtures = JSON.parse(fs.readFileSync(path.join(dir, 'test-fixtures', 'vemotion-gate-fixtures.json'), 'utf8'))

let failures = 0
const fail = (name, msg) => { failures++; console.error(`FAIL  ${name}\n      ${msg}`) }
const pass = (name) => console.log(`ok    ${name}`)
const clone = (v) => JSON.parse(JSON.stringify(v))

function expectProblems(name, composition, needles) {
  const problems = checkVemotionComposition(composition)
  const missing = needles.filter((n) => !problems.some((p) => p.includes(n)))
  if (missing.length) fail(name, `missing: ${missing.join(' | ')}\n      got:\n        ${problems.join('\n        ')}`)
  else pass(name)
}

function expectClean(name, composition) {
  const problems = checkVemotionComposition(composition)
  if (problems.length) fail(name, `expected no problems, got:\n        ${problems.join('\n        ')}`)
  else pass(name)
}

// What the agent should have written: renderer names, layer-clock keyframes, box-anchored text.
function repair(composition) {
  const c = clone(composition)
  for (const layer of c.layers) {
    const p = layer.properties
    if ('fillColor' in p) { p.color = p.fillColor; delete p.fillColor }
    if ('shapeType' in p) { p.shape = p.shapeType; delete p.shapeType }
    delete p.letterSpacing
    const start = layer.startTime ?? 0
    for (const a of [layer.animation, ...(layer.animations ?? [])].filter(Boolean)) {
      if (start > 0 && Math.min(...a.keyframes.map((k) => k.time)) >= start) {
        a.keyframes = a.keyframes.map((k) => ({ ...k, time: k.time - start }))
      }
    }
    if (layer.type === 'text' && (p.align ?? p.textAlign) === 'center') {
      layer.position.x = (c.width - layer.size.width) / 2
    }
  }
  return c
}

// 1–2. The two stored posts are refused, and each defect is named with its fix.
expectProblems('Sidrat al-Muntaha post (as saved) is refused', fixtures.broken.sidratAlMuntaha, [
  'layer "bg" (shape): property `fillColor` is not read by the renderer — use `color`',
  'layer "bg" (shape): property `shapeType`',
  'layer "tree-canopy-2" (shape): keyframe times run 2.3–3.2s',
  'layer "text-english" (text): keyframe times',
  'layer "text-arabic" (text): `position` is the TOP-LEFT',
])
expectProblems('Bodhi-treet post (as saved) is refused', fixtures.broken.bodhiTreet, [
  'layer "title" (text): property `letterSpacing`',
  'layer "leaf-center" (shape): property `shapeType`',
  'layer "subtitle" (text): keyframe times run 3.2–6s',
  'layer "title" (text): `position` is the TOP-LEFT',
])

// 3. The same posts in the renderer's vocabulary pass.
expectClean('Sidrat al-Muntaha post (repaired) passes', repair(fixtures.broken.sidratAlMuntaha))
expectClean('Bodhi-treet post (repaired) passes', repair(fixtures.broken.bodhiTreet))

// 4. Real compositions that render correctly pass — including static text and a moving text
//    layer that starts above the canvas on purpose.
expectClean('real composition "Venn + dots example" passes', fixtures.clean.vennDots)
expectClean('real composition "Mountain Ridge with Rising Moon" passes', fixtures.clean.mountainRidge)

// 5. Shapes observed in stored compositions that the renderer silently mis-draws.
{
  const c = clone(fixtures.clean.vennDots)
  c.layers[0].properties.shape = 'polygon'
  expectProblems('shape "polygon" is refused', c, ['shape "polygon" is not drawn'])
}
{
  const c = clone(fixtures.clean.vennDots)
  c.layers[3].animation = [{ property: 'opacity', keyframes: [{ time: 0, value: 0 }, { time: 1, value: 1 }] }]
  expectProblems('`animation` given as an array is refused', c, ['`animation` must be ONE animation object'])
}
{
  const c = clone(fixtures.clean.vennDots)
  c.layers[3].animations = [{ property: 'translateY', keyframes: [{ time: 0, value: 0 }, { time: 1, value: 10 }] }]
  expectProblems('an animation property the renderer ignores is refused', c, ['animation property `translateY` is not read'])
}

// 6–9. The real executors: a refused composition never reaches the Vemotion worker.
function fakeVemotion() {
  const calls = []
  const payload = { ok: true, id: 'comp_fake', summary: { id: 'comp_fake', name: 'fake', layerCount: 1 } }
  return {
    calls,
    env: {
      VEMOTION_WORKER: {
        fetch: async (url, opts) => {
          calls.push({ url, body: opts?.body ? JSON.parse(opts.body) : null })
          return { status: 201, ok: true, json: async () => payload, text: async () => JSON.stringify(payload) }
        },
      },
    },
  }
}

async function run(tool, input, env) {
  try {
    const result = await executeTool(tool, input, env)
    if (result && result.success === false) return { refused: String(result.error || result.message || '') }
    return { result }
  } catch (err) {
    return { refused: err.message }
  }
}

const AUTH = { authToken: 'test-token' }

{
  const t = 'vemotion_save_composition refuses the stored post and sends nothing'
  const { env, calls } = fakeVemotion()
  const out = await run('vemotion_save_composition', { ...AUTH, name: 'gate test', composition: fixtures.broken.bodhiTreet }, env)
  if (!out.refused) fail(t, `expected a refusal, got ${JSON.stringify(out.result).slice(0, 200)}`)
  else if (!out.refused.includes('did NOT save')) fail(t, `refusal does not say it was not saved: ${out.refused.slice(0, 200)}`)
  else if (calls.length !== 0) fail(t, `${calls.length} request(s) reached the Vemotion worker`)
  else pass(t)
}
{
  const t = 'vemotion_save_composition saves the repaired post'
  const { env, calls } = fakeVemotion()
  const out = await run('vemotion_save_composition', { ...AUTH, name: 'gate test', composition: repair(fixtures.broken.bodhiTreet) }, env)
  if (out.refused) fail(t, `refused: ${out.refused.slice(0, 300)}`)
  else if (calls.length !== 1 || !calls[0].url.endsWith('/vemotion/composition/save')) fail(t, `expected one POST to /vemotion/composition/save, got ${JSON.stringify(calls.map((c) => c.url))}`)
  else if (out.result?.compositionId !== 'comp_fake') fail(t, `compositionId was ${out.result?.compositionId}`)
  else pass(t)
}
{
  const t = 'vemotion_refit_composition refuses an inline broken composition and sends nothing'
  const { env, calls } = fakeVemotion()
  const out = await run('vemotion_refit_composition', { ...AUTH, composition: fixtures.broken.sidratAlMuntaha, targetWidth: 1080, targetHeight: 1920, mode: 'fill', name: 'gate test' }, env)
  if (!out.refused) fail(t, 'expected a refusal')
  else if (calls.length !== 0) fail(t, `${calls.length} request(s) reached the Vemotion worker`)
  else pass(t)
}
{
  const t = 'vemotion_refit_composition by compositionId is not gated (the stored body is not the model\'s)'
  const { env, calls } = fakeVemotion()
  const out = await run('vemotion_refit_composition', { ...AUTH, compositionId: 'comp_existing', targetWidth: 1080, targetHeight: 1920, mode: 'fill' }, env)
  if (out.refused) fail(t, `refused: ${out.refused.slice(0, 200)}`)
  else if (calls.length !== 1) fail(t, `expected one request, got ${calls.length}`)
  else pass(t)
}

// 10. The gate's vocabulary is the renderer's. A renderer change that adds or drops a property
//     must be mirrored in VOCABULARY, or the gate refuses valid compositions / passes dead fields.
if (!fs.existsSync(RENDERER)) {
  console.log(`skip  vocabulary drift check — ${RENDERER} is not on disk`)
} else {
  const lines = fs.readFileSync(RENDERER, 'utf8').split('\n')
  const starts = []
  lines.forEach((line, i) => {
    const m = line.match(/^(?:export )?function (\w+)\(/) || line.match(/^  private (\w+)\(/) || line.match(/^  (\w+)\(.*\): .* \{$/)
    if (m) starts.push({ name: m[1], line: i })
  })
  const body = (name) => {
    const i = starts.findIndex((s) => s.name === name)
    if (i < 0) throw new Error(`renderer.ts has no ${name}() — update the drift check`)
    return lines.slice(starts[i].line, starts[i + 1]?.line ?? lines.length).join('\n')
  }
  const readsOf = (src) => {
    const keys = new Set()
    for (const m of src.matchAll(/values\.([A-Za-z_]\w*)|values\[['"]([A-Za-z_]\w*)['"]\]/g)) keys.add(m[1] || m[2])
    for (const m of src.matchAll(/const\s*\{([^}]*)\}\s*=\s*values\b/g)) {
      for (const k of m[1].split(',')) keys.add(k.split(':')[0].trim())
    }
    return new Set([...keys].filter((k) => k && !k.startsWith('__')))
  }
  const shared = ['resolveLayerValues', 'computeLayerBounds', 'drawLayer']
  const perType = { text: ['drawText', 'renderTextGlyphs'], shape: ['drawShape'], 'math-shape': ['drawMathShape'] }
  for (const [type, methods] of Object.entries(perType)) {
    const t = `VOCABULARY.${type} matches what renderer.ts reads`
    const derived = readsOf([...shared, ...methods].map(body).join('\n'))
    const listed = new Set(VOCABULARY[type])
    const added = [...derived].filter((k) => !listed.has(k))
    const removed = [...listed].filter((k) => !derived.has(k))
    if (added.length || removed.length) {
      fail(t, `renderer.ts reads [${added.join(', ')}] missing from VOCABULARY; VOCABULARY lists [${removed.join(', ')}] the renderer no longer reads`)
    } else pass(t)
  }
}

fs.unlinkSync(path.join(tmp, 'node_modules'))
fs.rmSync(tmp, { recursive: true, force: true })

if (failures > 0) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log('\nAll Vemotion composition gate checks passed.')
