// vemotion_set_drawing_pace (2026-10-19): change how fast a pixel grid draws itself, and keep the
// rest of the composition in step.
//
// Asked to "draw the rabbit twice as fast", the agent did the arithmetic itself and got it wrong
// twice on the live path: it multiplied by every cell of the grid instead of the stitches in
// drawOrder, ended the grid layer the moment the drawing ended (the rabbit vanished), and left a
// gap before the title. The arithmetic is deterministic, so it lives here:
//   drawing time   = seconds per stitch × drawOrder.length
//   last stitch    = layer.startTime + first keyframe + drawing time   (composition clock)
//   layers that started at or after the old last stitch move by the same amount (the title)
//   the clip ends  = last stitch + hold (the old hold unless a new one is given)
//   the grid layer, and any layer that ran to the old end, now run to the new end.

const EPS = 1e-3
const r3 = (v) => Math.round(v * 1000) / 1000
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

function revealOf(layer) {
  const anims = [layer.animation, ...(Array.isArray(layer.animations) ? layer.animations : [])].filter(Boolean)
  return anims.find((a) => a.kind === 'pixel-reveal') || null
}

/** Pure: returns { composition, report } or throws with a message the model can act on. */
export function setDrawingPace(composition, input) {
  const c = JSON.parse(JSON.stringify(composition))
  const layers = Array.isArray(c.layers) ? c.layers : []
  const grids = layers.filter((l) => l?.type === 'knitting-chart' && Array.isArray(l.properties?.drawOrder) && l.properties.drawOrder.length > 0 && revealOf(l))
  let layer
  if (input?.layerId) {
    layer = layers.find((l) => l?.id === input.layerId)
    if (!layer) throw new Error(`No layer "${input.layerId}" in this composition.`)
    if (!grids.includes(layer)) throw new Error(`Layer "${input.layerId}" is not a pixel grid that draws itself (it needs properties.drawOrder and a pixel-reveal animation).`)
  } else {
    if (grids.length === 0) throw new Error('This composition has no pixel grid that draws itself (a knitting-chart layer with properties.drawOrder and a pixel-reveal animation).')
    if (grids.length > 1) throw new Error(`Several pixel grids draw themselves here — pass layerId: ${grids.map((g) => g.id).join(', ')}.`)
    layer = grids[0]
  }

  const stitches = layer.properties.drawOrder.length
  const reveal = revealOf(layer)
  const kf = Array.isArray(reveal.keyframes) ? [...reveal.keyframes].sort((a, b) => a.time - b.time) : []
  const t0 = isNum(kf[0]?.time) ? kf[0].time : 0
  const oldDraw = kf.length > 1 ? kf[kf.length - 1].time - t0 : 0
  const start = isNum(layer.startTime) ? layer.startTime : 0
  const oldEnd = start + t0 + oldDraw
  const oldDuration = isNum(c.duration) ? c.duration : oldEnd
  const oldHold = Math.max(0, oldDuration - oldEnd)

  let draw
  if (isNum(input?.secondsPerStitch)) draw = input.secondsPerStitch * stitches
  else if (isNum(input?.totalSeconds)) draw = input.totalSeconds
  else if (isNum(input?.speedFactor)) {
    if (!(oldDraw > 0)) throw new Error('The drawing has no length yet — give secondsPerStitch or totalSeconds instead of speedFactor.')
    draw = oldDraw / input.speedFactor
  } else throw new Error('Give one of: secondsPerStitch (e.g. 0.05), totalSeconds (e.g. 12) or speedFactor (2 = twice as fast).')
  if (!(draw > 0)) throw new Error('The drawing time must be more than 0 seconds.')
  draw = r3(draw)
  const hold = isNum(input?.holdSeconds) ? Math.max(0, input.holdSeconds) : oldHold

  const newEnd = r3(start + t0 + draw)
  const delta = newEnd - oldEnd
  const newDuration = r3(newEnd + hold)

  reveal.keyframes = [{ time: t0, value: 0 }, { time: r3(t0 + draw), value: 1 }]
  reveal.easing = reveal.easing || 'linear'

  const moved = []
  const stretched = []
  for (const l of layers) {
    if (!l || l === layer) continue
    const ls = isNum(l.startTime) ? l.startTime : 0
    const runsToEnd = isNum(l.layerDuration) && Math.abs(ls + l.layerDuration - oldDuration) < EPS
    if (ls >= oldEnd - EPS && ls > 0) {
      l.startTime = r3(Math.max(0, ls + delta))
      if (runsToEnd) l.layerDuration = r3(newDuration - l.startTime)
      moved.push(l.id)
    } else if (runsToEnd) {
      l.layerDuration = r3(newDuration - ls)
      stretched.push(l.id)
    }
  }
  layer.layerDuration = r3(newDuration - start)
  c.duration = newDuration

  return {
    composition: c,
    report: {
      layerId: layer.id,
      stitches,
      secondsPerStitch: r3(draw / stitches),
      drawingSeconds: draw,
      lastStitchAt: newEnd,
      holdSeconds: r3(hold),
      duration: newDuration,
      movedLayers: moved,
      stretchedLayers: stretched,
    },
  }
}
