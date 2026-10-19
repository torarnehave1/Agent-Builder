// Drift guard for the VEmotion catalog (get_vemotion_catalog, 2026-10-19).
//
// The catalog is only worth having if it is what the renderer draws. This test fails when:
//   - a gated layer type's properties differ from the gate's VOCABULARY, or its animatable flags
//     from the gate's ANIMATABLE (the gate's own test pins VOCABULARY to renderer.ts);
//   - an ungated layer type's properties differ from what its draw method in renderer.ts reads
//     (plus what exporter.ts reads for sound);
//   - the app's canvas-size or font menu differs from CANVAS_PRESETS / FONTS;
//   - api.ts gains a layer type, animation kind or easing the catalog does not list.
// The source checks are skipped when video-generator is not on disk.
//
// Run:  node worker/test-vemotion-catalog.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const APP = '/Volumes/T7/video-generator/src'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vemotion-catalog-'))
for (const f of ['vemotion-catalog.js', 'vemotion-composition-gate.js']) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')
const { buildVemotionCatalog, LAYER_TYPES, ANIMATION_KINDS, EASINGS, CANVAS_PRESETS, FONTS } = await import(path.join(tmp, 'vemotion-catalog.js'))
const { VOCABULARY, ANIMATABLE } = await import(path.join(tmp, 'vemotion-composition-gate.js'))
fs.rmSync(tmp, { recursive: true, force: true })

let failures = 0
const fail = (name, msg) => { failures++; console.error(`FAIL  ${name}\n      ${msg}`) }
const pass = (name) => console.log(`ok    ${name}`)
const sameSet = (name, actual, expected) => {
  const a = new Set(actual), e = new Set(expected)
  if (e.size === 0) return fail(name, 'the source list came back empty — the parser no longer matches the source')
  const extra = [...a].filter((k) => !e.has(k)), missing = [...e].filter((k) => !a.has(k))
  if (extra.length || missing.length) fail(name, `catalog lists [${extra.join(', ')}] not in the source; source has [${missing.join(', ')}] missing from the catalog`)
  else pass(name)
}

// 1. The catalog is plain JSON (it goes over the wire) and every property has a type.
{
  const t = 'buildVemotionCatalog() is JSON-serialisable and every property has a type'
  const c = JSON.parse(JSON.stringify(buildVemotionCatalog()))
  const untyped = Object.entries(c.layerTypes).flatMap(([type, s]) => Object.entries(s.properties).filter(([, p]) => !p.type).map(([k]) => `${type}.${k}`))
  if (untyped.length) fail(t, `untyped: ${untyped.join(', ')}`)
  else pass(t)
}

// 2. Gated types = the gate.
for (const type of Object.keys(VOCABULARY)) {
  sameSet(`${type}: properties = gate VOCABULARY`, Object.keys(LAYER_TYPES[type].properties), VOCABULARY[type])
  sameSet(`${type}: animatable = gate ANIMATABLE`, Object.entries(LAYER_TYPES[type].properties).filter(([, p]) => p.animatable).map(([k]) => k), ANIMATABLE[type])
}

if (!fs.existsSync(`${APP}/lib/renderer.ts`)) {
  console.log(`skip  source checks — ${APP} is not on disk`)
} else {
  const renderer = fs.readFileSync(`${APP}/lib/renderer.ts`, 'utf8')
  const lines = renderer.split('\n')
  const starts = []
  lines.forEach((line, i) => {
    const m = line.match(/^(?:export )?function (\w+)\(/) || line.match(/^  private (\w+)\(/) || line.match(/^  (\w+)\(.*\): .* \{$/)
    if (m) starts.push({ name: m[1], line: i })
  })
  const body = (name) => {
    const i = starts.findIndex((s) => s.name === name)
    if (i < 0) throw new Error(`renderer.ts has no ${name}() — update test-vemotion-catalog.mjs`)
    return lines.slice(starts[i].line, starts[i + 1]?.line ?? lines.length).join('\n')
  }
  const readsOf = (src) => {
    const keys = new Set()
    for (const m of src.matchAll(/values\.([A-Za-z_]\w*)|values\[['"]([A-Za-z_]\w*)['"]\]|layer\.properties\.([A-Za-z_]\w*)/g)) keys.add(m[1] || m[2] || m[3])
    return [...keys].filter((k) => k && !k.startsWith('__'))
  }

  // 3. Ungated types = what their draw method reads, + opacity/scale (drawLayer), + motionScenes
  //    when the method reads offsets (motion scenes move a layer by setting offsetX/offsetY).
  const DRAW = { image: 'drawImage', video: 'drawVideo', 'kg-shape': 'drawKgShape', card: 'drawCard', path: 'drawPath', 'knitting-chart': 'drawKnittingChart', 'telemetry-track': 'drawTelemetryTrack' }
  const exporter = fs.readFileSync(`${APP}/lib/exporter.ts`, 'utf8')
  const exporterReads = { video: ['audioEnabled', 'volume'], audio: [] }
  for (const m of exporter.matchAll(/props\.(\w+)/g)) exporterReads.audio.push(m[1])
  for (const [type, method] of Object.entries(DRAW)) {
    const reads = readsOf(body(method))
    const expected = new Set([...reads, 'opacity', 'scale', ...(exporterReads[type] || [])])
    if (reads.includes('offsetX')) expected.add('motionScenes')
    sameSet(`${type}: properties = what ${method} reads`, Object.keys(LAYER_TYPES[type].properties), expected)
  }
  sameSet('audio: properties = what exporter.ts reads', Object.keys(LAYER_TYPES.audio.properties), exporterReads.audio)

  // 4. Every layer type, animation kind and easing in api.ts is in the catalog.
  const api = fs.readFileSync(`${APP}/lib/api.ts`, 'utf8')
  const union = (re) => [...(api.match(re)?.[1] ?? '').matchAll(/'([\w-]+)'/g)].map((m) => m[1])
  sameSet('layer types = api.ts Layer.type', Object.keys(LAYER_TYPES), union(/^\s*type: ('text'[^;]+);/m))
  sameSet('animation kinds = api.ts Animation.kind', Object.keys(ANIMATION_KINDS), union(/kind\?: ('layer'[^;]+);/))
  sameSet('easings = api.ts Animation.easing', Object.keys(EASINGS), union(/easing\?: ('linear'[^;]+);/))

  // 5. Canvas presets and fonts = the app's menus.
  const editor = fs.readFileSync(`${APP}/components/CompositionEditor.tsx`, 'utf8')
  const sizes = [...editor.matchAll(/label: '([^']+?) — \d+×\d+', w: (\d+), h: (\d+)/g)].map((m) => `${m[1]} ${m[2]}x${m[3]}`)
  sameSet('canvas presets = CompositionEditor.tsx', CANVAS_PRESETS.map((c) => `${c.label} ${c.width}x${c.height}`), sizes)
  const fonts = [...editor.matchAll(/\{ label: '[^']*', +value: '([^']+)' \}/g)].map((m) => m[1])
  sameSet('fonts = CompositionEditor.tsx', FONTS, fonts)
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log('\nAll Vemotion catalog checks passed.')
