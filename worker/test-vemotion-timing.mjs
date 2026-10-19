// vemotion_set_drawing_pace (2026-10-19): the arithmetic the agent got wrong twice on the live
// path (it counted grid cells instead of drawOrder, ended the grid with the drawing, left a gap
// before the title). Pins the result on the "Sweet rabbit" composition's shape.
// Run:  node worker/test-vemotion-timing.mjs
import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url'
const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vemotion-timing-'))
fs.copyFileSync(path.join(dir, 'vemotion-timing.js'), path.join(tmp, 'vemotion-timing.js'))
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')
const { setDrawingPace } = await import(path.join(tmp, 'vemotion-timing.js'))
fs.rmSync(tmp, { recursive: true, force: true })

let failures = 0
const eq = (name, a, b) => { if (JSON.stringify(a) === JSON.stringify(b)) console.log(`ok    ${name}`); else { failures++; console.error(`FAIL  ${name}\n      got ${JSON.stringify(a)}\n      want ${JSON.stringify(b)}`) } }

// 22 × 20 grid (440 cells), 288 stitches in drawOrder, 0.1 s each, title after, 4 s hold.
const rabbit = () => ({
  duration: 33.3, fps: 30, width: 1080, height: 1920,
  layers: [
    { id: 'bg', type: 'shape', position: { x: 0, y: 0 }, size: { width: 1080, height: 1920 }, properties: { shape: 'rect', color: '#fde8ef' } },
    { id: 'bunny', type: 'knitting-chart', startTime: 0.5, layerDuration: 32.8, position: { x: 0, y: 0 }, size: { width: 960, height: 976 },
      properties: { cols: 22, rows: 20, drawOrder: Array.from({ length: 288 }, (_, i) => i) },
      animations: [{ kind: 'pixel-reveal', keyframes: [{ time: 0, value: 0 }, { time: 28.8, value: 1 }], easing: 'linear' }] },
    { id: 'title', type: 'text', startTime: 29.3, layerDuration: 4, position: { x: 0, y: 0 }, size: { width: 960, height: 140 }, properties: { text: 'Sweet rabbit' } },
  ],
})

{
  const { composition: c, report } = setDrawingPace(rabbit(), { speedFactor: 2 })
  const g = c.layers[1], t = c.layers[2]
  eq('twice as fast: drawing 14.4 s from 288 stitches (not 440 cells)', [report.stitches, report.drawingSeconds, g.animations[0].keyframes[1].time], [288, 14.4, 14.4])
  eq('the last stitch is at 14.9 s on the composition clock', report.lastStitchAt, 14.9)
  eq('the title starts at the last stitch', t.startTime, 14.9)
  eq('the 4 s hold is kept: video 18.9 s', c.duration, 18.9)
  eq('the rabbit stays on screen to the end', g.startTime + g.layerDuration, 18.9)
  eq('the title still runs 4 s', t.layerDuration, 4)
}
{
  const { report } = setDrawingPace(rabbit(), { secondsPerStitch: 0.05 })
  eq('0.05 s per stitch = 14.4 s', report.drawingSeconds, 14.4)
}
{
  const { composition: c, report } = setDrawingPace(rabbit(), { totalSeconds: 10, holdSeconds: 2 })
  eq('total 10 s with a 2 s hold: video 12.5 s', [report.lastStitchAt, c.duration], [10.5, 12.5])
}
{
  let msg = ''
  try { setDrawingPace({ layers: [{ id: 'x', type: 'text', properties: {} }] }, { speedFactor: 2 }) } catch (e) { msg = e.message }
  eq('a composition without a drawing grid is refused with the reason', /no pixel grid that draws itself/.test(msg), true)
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nAll drawing-pace checks passed.')
