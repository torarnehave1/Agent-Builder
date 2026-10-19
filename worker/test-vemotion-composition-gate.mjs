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
const { checkVemotionComposition, VOCABULARY, FORMULA_SAFE, FORMULA_ARGS } = await import(path.join(tmp, 'vemotion-composition-gate.js'))
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
    // letterSpacing is in em (2026-10-19): the post's 8 meant 8px.
    if (typeof p.letterSpacing === 'number' && p.letterSpacing > 1) p.letterSpacing = p.letterSpacing / (p.fontSize ?? 48)
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
  'layer "title" (text): `letterSpacing` is 8, but letterSpacing is in em',
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

// letterSpacing in em, animatable (decision-vemotion-letterspacing-em, 2026-10-19).
const spaced = (props, animation) => ({
  width: 1080, height: 1920, duration: 4, fps: 30,
  layers: [{ id: 't', type: 'text', position: { x: 90, y: 860 }, size: { width: 900, height: 200 },
    properties: { text: 'NAMAHA', fontSize: 96, color: '#ffffff', align: 'center', ...props }, ...(animation ? { animation } : {}) }],
})
expectClean('letterSpacing in em passes', spaced({ letterSpacing: 0.05 }))
expectClean('a tracking-in (animated letterSpacing) passes',
  spaced({ letterSpacing: 0.02 }, { property: 'letterSpacing', keyframes: [{ time: 0, value: 0.4 }, { time: 1.2, value: 0.02 }] }))
expectProblems('letterSpacing written in pixels is refused with the em to use', spaced({ letterSpacing: 8 }),
  ['layer "t" (text): `letterSpacing` is 8, but letterSpacing is in em (a fraction of fontSize), not pixels — 8px at fontSize 96 is 0.08'])
expectProblems('an animated letterSpacing in pixels is refused', spaced({}, { property: 'letterSpacing', keyframes: [{ time: 0, value: 20 }, { time: 1, value: 2 }] }),
  ['layer "t" (text): a letterSpacing keyframe value is 20, but letterSpacing is in em'])

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

// Pixel grids (knitting-chart), 2026-10-19: an empty grid with a drawProgress animation saved.
{
  const grid = (props, anims) => ({ width: 1080, height: 1920, duration: 5, layers: [{ id: 'g', type: 'knitting-chart', position: { x: 0, y: 0 }, size: { width: 400, height: 400 }, properties: props, ...(anims ? { animations: anims } : {}) }] })
  const ok = { cols: 3, rows: 2, palette: ['#ffffff', '#000000'], cells: ['010', '101'] }
  const reveal = [{ kind: 'pixel-reveal', keyframes: [{ time: 0, value: 0 }, { time: 1, value: 1 }], easing: 'linear' }]
  expectClean('a complete knitting-chart passes', grid(ok))
  expectClean('a knitting-chart with drawOrder + pixel-reveal passes', grid({ ...ok, drawOrder: [5, 4, 3, 0, 1, 2] }, reveal))
  expectProblems('an empty knitting-chart is refused', grid({ drawOrder: [0, 1] }, [{ property: 'drawProgress', keyframes: [{ time: 0, value: 0 }, { time: 5, value: 1 }] }]), ['cols and rows must be whole numbers'])
  expectProblems('drawProgress on a knitting-chart is refused with the pixel-reveal fix', grid({ ...ok, drawOrder: [0] }, [{ property: 'drawProgress', keyframes: [{ time: 0, value: 0 }, { time: 5, value: 1 }] }]), ['drawProgress does not animate a knitting-chart'])
  expectProblems('a cell outside the palette is refused', grid({ ...ok, cells: ['012', '101'] }), ['cells[0] uses "2"'])
  expectProblems('a short row is refused', grid({ ...ok, cells: ['01', '101'] }), ['cells[0] must be a string of 3 characters'])
  expectProblems('a pixel-reveal without drawOrder is refused', grid(ok, reveal), ['a pixel-reveal needs properties.drawOrder'])
  expectProblems('a drawOrder index past the grid is refused', grid({ ...ok, drawOrder: [6] }, reveal), ['drawOrder contains 6'])
}

// Fields outside `properties` (2026-10-19, "Hello autumn": src and text on the layer drew blank).
expectProblems('src and text written on the layer are refused', { width: 1080, height: 1920, layers: [
  { id: 'bg-image', type: 'image', src: 'https://x/y.png', position: { x: 0, y: 0 }, size: { width: 1080, height: 1920 } },
  { id: 't', type: 'text', text: 'Hello', color: '#fff', position: { x: 0, y: 800 }, size: { width: 1080, height: 200 }, properties: {} },
] }, ['layer "bg-image" (image): `src` is not a layer field', 'layer "t" (text): `text`, `color` are not layer fields'])

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

// 11. Formulas (2026-10-19). renderer.ts evaluateFormula returns null for a formula its safety regex
//     refuses, that uses a name it does not pass in, or that is never finite — the math-shape draws
//     nothing and a motion scene is ignored, silently. Cookbook curves shipped with `^`.
{
  const curve = (xFormula, yFormula, extra = {}) => ({
    width: 1080, height: 1080, duration: 4,
    layers: [{ id: 'heart', type: 'math-shape', position: { x: 140, y: 140 }, size: { width: 800, height: 800 }, startTime: 0, layerDuration: 4,
      properties: { mathKind: 'parametric', xFormula, yFormula, stroke: '#e11d48', strokeWidth: 6, tStart: 0, tEnd: 6.283, samples: 240, ...extra } }],
  })
  const HEART_Y = 'y0 + h/2 - (13*cos(t) - 5*cos(2*t) - 2*cos(3*t) - cos(4*t)) * h/40'
  expectProblems('a math-shape with `^` is refused with the pow() fix', curve('x0 + w/2 + 16*sin(t)^3 * w/40', HEART_Y),
    ['layer "heart" (math-shape): xFormula "x0 + w/2 + 16*sin(t)^3 * w/40" contains `^`', 'write pow(a, b)', 'the curve draws nothing'])
  expectClean('the same heart written with pow() passes', curve('x0 + w/2 + 16*pow(sin(t), 3) * w/40', HEART_Y))
  expectClean('`**` (which the renderer evaluates) passes', curve('x0 + w/2 + 16*sin(t)**3 * w/40', HEART_Y))
  expectProblems('exp / log / Math.* are named with their fix', curve('x0 + w/2 + exp(-t)*cos(t)*w/2', 'y0 + h/2 + Math.sin(t)*log(2)*h/2'), [
    'xFormula "x0 + w/2 + exp(-t)*cos(t)*w/2" uses `exp`, which the renderer does not provide — use pow(2.71828, x)',
    'yFormula "y0 + h/2 + Math.sin(t)*log(2)*h/2" uses `Math.`, which is outside the formula vocabulary — drop the `Math.` prefix',
  ])
  expectProblems('log is named', curve('x0 + w/2', 'y0 + log(t+1)*h'), ['uses `log`, which the renderer does not provide — the only functions are sin, cos, tan, abs, min, max, pow, sqrt'])
  expectProblems('implicit multiplication is a syntax error', curve('x0 + 2t', 'y0'), ['`2t` is not valid — write the multiplication: 2*t'])
  expectProblems('a curve with no finite sample is refused', curve('x0 + w/2 + sqrt(-1 - t)*w', 'y0 + h/2'),
    ['xFormula "x0 + w/2 + sqrt(-1 - t)*w" gives no finite number over t = 0…6.28 (241 samples)'])
  expectClean('a curve finite only once the clock moves passes', curve('x0 + w/2 + w/4*cos(t) * time/time', 'y0 + h/2 + h/4*sin(t)'))
  expectClean('a curve finite only with audio passes', curve('x0 + w/2 + w/4*cos(t) * amp/amp', 'y0 + h/2 + h/4*sin(t)'))
  expectClean('pi, min, max, abs, tan, % and comma args pass', curve('x0 + w/2 + min(w, h)*0.4*cos(t + pi/2) % w', 'y0 + h/2 + max(abs(tan(t/4)), 0)*0 + h/3*sin(t)'))

  const scene = (scene) => ({ width: 1080, height: 1080, duration: 4,
    layers: [{ id: 'dot', type: 'shape', position: { x: 500, y: 500 }, size: { width: 80, height: 80 }, properties: { shape: 'circle', color: '#fff', motionScenes: [scene] } }] })
  expectProblems('a motion scene formula with `^` is refused', scene({ start: 0, end: 2, xFormula: 'x0 + 200*p^2', yFormula: 'y0' }),
    ['layer "dot" (shape): motionScenes[0].xFormula "x0 + 200*p^2" contains `^`', 'the layer keeps its own x during this scene'])
  expectProblems('a never-finite scaleFormula is refused', scene({ start: 0, end: 2, scaleFormula: '1/(t - t)' }),
    ['motionScenes[0].scaleFormula "1/(t - t)" gives no finite number for t = 0…2s — the layer keeps its own scale'])
  expectClean('a valid motion scene passes', scene({ start: 0, end: 2, xFormula: 'x0 + 200*pow(p, 2)', yFormula: 'y0 - 100*sin(pi*p)', scaleFormula: '1 + 0.2*sin(t*4)' }))
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
  // The formula evaluator's safety regex and argument list must be the renderer's.
  {
    const src = body('evaluateFormula')
    const t1 = 'FORMULA_SAFE matches renderer.ts evaluateFormula'
    const re = src.match(/if \(!(\/\^.*\$\/)\.test\(safe\)\)/)
    if (!re) fail(t1, 'evaluateFormula has no `if (!/^…$/.test(safe))` — update the drift check')
    else if (re[1] !== String(FORMULA_SAFE)) fail(t1, `renderer ${re[1]} vs gate ${FORMULA_SAFE}`)
    else pass(t1)
    const t2 = 'FORMULA_ARGS match renderer.ts evaluateFormula new Function(...) parameters'
    const fnArgs = src.match(/new Function\(([\s\S]*?)`"use strict"/)
    const args = fnArgs ? [...fnArgs[1].matchAll(/'(\w+)'/g)].map((m) => m[1]) : []
    if (!args.length) fail(t2, 'evaluateFormula has no new Function(\'t\', …) — update the drift check')
    else if (args.join(',') !== FORMULA_ARGS.join(',')) fail(t2, `renderer [${args.join(', ')}] vs gate [${FORMULA_ARGS.join(', ')}]`)
    else pass(t2)
  }
}

fs.unlinkSync(path.join(tmp, 'node_modules'))
fs.rmSync(tmp, { recursive: true, force: true })

if (failures > 0) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log('\nAll Vemotion composition gate checks passed.')
