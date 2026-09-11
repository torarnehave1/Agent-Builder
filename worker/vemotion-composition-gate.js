// Vemotion composition gate (2026-09-11).
//
// Two Instagram posts saved by the agent rendered as blank white canvases in Vemotion. The agent
// wrote `fillColor` / `shapeType` where the renderer reads `color` / `shape` (a missing `color`
// draws white, a missing `shape` draws a rectangle), put keyframe times on the video's clock where
// the renderer uses the layer's own clock, and treated a text box's `position` as the text centre.
// `/vemotion/composition/save` accepts any `properties`, so both saves — and the agent's retry,
// which changed colours instead of field names — reported success.
//
// checkVemotionComposition() lists what the renderer would draw wrong, each with its fix, so the
// executor can refuse the save and the model corrects it in the same turn. Before shipping, every
// rule was run against all 176 stored compositions: the vocabulary rule matched only keys the
// renderer never reads, the timing rule only the two broken posts, the text rule only text that
// renders off-canvas.
//
// VOCABULARY mirrors video-generator/src/lib/renderer.ts — the keys read from `values` in
// resolveLayerValues, computeLayerBounds, drawLayer and the layer type's draw method.
// test-vemotion-composition-gate.mjs re-derives it from renderer.ts when that file is on disk and
// fails on drift.

export const VOCABULARY = {
  text: ['align', 'anchors', 'closed', 'color', 'fill', 'fillFit', 'fillMode', 'fillSource', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'motionScenes', 'offsetX', 'offsetY', 'opacity', 'rotation', 'scale', 'shadow', 'shape', 'strokeWidth', 'text', 'textAlign'],
  shape: ['anchors', 'borderRadius', 'closed', 'color', 'fill', 'fillMode', 'filled', 'motionScenes', 'offsetX', 'offsetY', 'opacity', 'rotation', 'scale', 'shape', 'strokeColor', 'strokeWidth'],
  'math-shape': ['anchors', 'closePath', 'closed', 'color', 'drawProgress', 'fill', 'mathKind', 'motionScenes', 'offsetX', 'offsetY', 'opacity', 'samples', 'scale', 'shape', 'stroke', 'strokeWidth', 'tEnd', 'tStart', 'xFormula', 'yFormula'],
}

// Names models reach for (canvas / CSS / other editors) mapped to what the renderer reads.
// Every entry on the first lines of each type was observed in stored compositions.
const HINTS = {
  text: {
    fillColor: 'use `color`',
    verticalAlign: 'not supported — text is always centred vertically in its box; place the box with position.y and size.height',
    letterSpacing: 'not supported by the renderer — remove it',
    textColor: 'use `color`',
    fontColor: 'use `color`',
    font: 'use `fontFamily`',
    size: 'use `fontSize`',
  },
  shape: {
    fillColor: 'use `color`',
    shapeType: 'use `shape` ("rect" or "circle"; a circle in a non-square box draws an ellipse)',
    cornerRadius: 'use `borderRadius`',
    stroke: 'use `strokeColor` together with `strokeWidth`',
    backgroundColor: 'use `color`',
    lineWidth: 'use `strokeWidth`',
  },
  'math-shape': {
    shapeType: 'not used — a math-shape is drawn from `xFormula` and `yFormula`',
    formula: 'use `xFormula` and `yFormula` — two separate expressions in t',
    fillColor: 'use `fill` (null for an outline)',
    strokeColor: 'use `stroke`',
    lineWidth: 'use `strokeWidth`',
  },
}

const SHAPES = ['rect', 'rectangle', 'circle', 'ellipse']

const ANIMATABLE = {
  text: ['opacity', 'offsetX', 'offsetY', 'scale', 'rotation', 'fontSize'],
  shape: ['opacity', 'offsetX', 'offsetY', 'scale', 'rotation', 'borderRadius', 'strokeWidth'],
  'math-shape': ['opacity', 'offsetX', 'offsetY', 'scale', 'drawProgress', 'strokeWidth'],
}

// Narrow per-character width estimate (fraction of fontSize). Deliberately small, so a text
// layer is only flagged when even a narrow rendering of it would leave the canvas.
const CHAR_WIDTH = 0.5
const MIN_VISIBLE = 0.9
const EPS = 1e-6
const MAX_LISTED = 30

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const round = (v) => Math.round(v * 100) / 100

export function checkVemotionComposition(composition) {
  const problems = []
  const layers = Array.isArray(composition?.layers) ? composition.layers : []
  const canvasW = isNum(composition?.width) ? composition.width : 1280
  const canvasH = isNum(composition?.height) ? composition.height : 720
  const compDuration = isNum(composition?.duration) ? composition.duration : null

  layers.forEach((layer, index) => {
    if (!layer || typeof layer !== 'object' || Array.isArray(layer)) {
      problems.push(`layer #${index + 1} is not an object`)
      return
    }
    const where = `layer "${layer.id ?? `#${index + 1}`}" (${layer.type})`
    const props = layer.properties && typeof layer.properties === 'object' ? layer.properties : {}
    const vocab = VOCABULARY[layer.type]

    if (vocab) {
      for (const key of Object.keys(props)) {
        if (vocab.includes(key)) continue
        const hint = HINTS[layer.type]?.[key] || `remove it (a ${layer.type} layer reads: ${vocab.join(', ')})`
        problems.push(`${where}: property \`${key}\` is not read by the renderer — ${hint}`)
      }
    }

    if (layer.type === 'shape' && props.shape !== undefined && !SHAPES.includes(props.shape)) {
      problems.push(`${where}: shape "${props.shape}" is not drawn (it renders as a rectangle) — use "rect" or "circle", or a \`path\` layer with corner anchors / a \`math-shape\` for any other outline`)
    }

    if (layer.animation != null && (typeof layer.animation !== 'object' || Array.isArray(layer.animation))) {
      problems.push(`${where}: \`animation\` must be ONE animation object — the renderer ignores an array here; put several animations in \`animations: [...]\``)
    }
    if (layer.animations !== undefined && !Array.isArray(layer.animations)) {
      problems.push(`${where}: \`animations\` must be an array of animation objects`)
    }

    const anims = [layer.animation, ...(Array.isArray(layer.animations) ? layer.animations : [])]
      .filter((a) => a && typeof a === 'object' && !Array.isArray(a))
    const start = isNum(layer.startTime) ? layer.startTime : 0
    const duration = isNum(layer.layerDuration) ? layer.layerDuration : (compDuration !== null ? compDuration - start : null)
    let timingReported = false

    for (const anim of anims) {
      const kind = anim.kind ?? 'layer'
      if (vocab && (kind === 'layer' || kind === 'char-stagger') && anim.property !== undefined && !vocab.includes(anim.property)) {
        problems.push(`${where}: animation property \`${anim.property}\` is not read for ${layer.type} layers — animate one of: ${ANIMATABLE[layer.type].join(', ')}`)
      }
      const times = (Array.isArray(anim.keyframes) ? anim.keyframes : []).map((k) => k?.time).filter(isNum)
      if (timingReported || times.length === 0 || duration === null) continue
      const first = Math.min(...times)
      const last = Math.max(...times)
      if (start > EPS && first >= start - EPS && last > duration + EPS) {
        timingReported = true
        problems.push(`${where}: keyframe times run ${round(first)}–${round(last)}s, but they are measured from this layer's own start (startTime ${round(start)}s), not from the start of the video, and the layer only lives ${round(duration)}s — so the animation begins ${round(start)}s late and is cut off. Subtract ${round(start)} from every keyframe time.`)
      }
    }

    if (layer.type === 'text') {
      const problem = checkTextPlacement(layer, props, anims, where, canvasW, canvasH)
      if (problem) problems.push(problem)
    }
  })

  return problems
}

// Text is drawn centred vertically in its box, horizontally by `align` against the box — and
// `position` is the box's top-left. A layer that moves (offset animation, motion scene) may start
// off-canvas on purpose, so only static text is checked.
function checkTextPlacement(layer, props, anims, where, canvasW, canvasH) {
  const text = typeof props.text === 'string' ? props.text : ''
  if (!text.trim()) return null
  const moving = anims.some((a) => a.property === 'offsetX' || a.property === 'offsetY')
    || (Array.isArray(props.motionScenes) && props.motionScenes.length > 0)
    || isNum(props.offsetX) || isNum(props.offsetY)
  if (moving) return null

  const x = isNum(layer.position?.x) ? layer.position.x : 0
  const y = isNum(layer.position?.y) ? layer.position.y : 0
  const w = isNum(layer.size?.width) ? layer.size.width : 0
  const h = isNum(layer.size?.height) ? layer.size.height : 0
  const fontSize = isNum(props.fontSize) ? props.fontSize : 48
  const align = props.align ?? props.textAlign ?? 'left'

  // Word-wrap to the box width the way the renderer does, with estimated glyph widths.
  const charW = CHAR_WIDTH * fontSize
  const lines = []
  let current = ''
  for (const word of text.split(' ')) {
    const test = current ? `${current} ${word}` : word
    if (test.length * charW <= w) current = test
    else {
      if (current) lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  const lineW = Math.min(Math.max(...lines.map((l) => l.length)) * charW, Math.max(w, 1))
  if (lineW <= 0) return null

  const left = align === 'center' ? x + w / 2 - lineW / 2 : align === 'right' ? x + w - lineW : x
  const right = left + lineW
  const visible = Math.max(0, Math.min(right, canvasW) - Math.max(left, 0)) / lineW
  const centreY = y + h / 2

  if (visible < MIN_VISIBLE) {
    const side = left < 0 ? 'left' : 'right'
    if (align === 'center') {
      return `${where}: \`position\` is the TOP-LEFT of the text box, not the text's centre. With x=${round(x)} and width ${round(w)}, align "center" puts the text's centre at x=${round(x + w / 2)} on a ${canvasW}px-wide canvas, so the text runs off the ${side} edge. To centre it on the canvas use x = ${round((canvasW - w) / 2)}.`
    }
    return `${where}: \`position\` is the TOP-LEFT of the text box. With x=${round(x)}, width ${round(w)} and align "${align}", the text spans about x=${round(left)}–${round(right)} on a ${canvasW}px-wide canvas, so it runs off the ${side} edge. Move the box inside 0–${canvasW}.`
  }
  if (centreY < 0 || centreY > canvasH) {
    return `${where}: \`position.y\` is the TOP of the text box. With y=${round(y)} and height ${round(h)} the text is drawn at y=${round(centreY)}, outside the ${canvasH}px-tall canvas.`
  }
  return null
}

export function formatVemotionGateError(problems, toolName) {
  const shown = problems.slice(0, MAX_LISTED)
  const more = problems.length - shown.length
  return [
    `Vemotion would draw this composition wrong, so ${toolName} did NOT save it. Fix ${problems.length === 1 ? 'this problem' : `these ${problems.length} problems`} and call ${toolName} again with the corrected composition:`,
    ...shown.map((p, i) => `${i + 1}. ${p}`),
    ...(more > 0 ? [`…and ${more} more of the same kinds.`] : []),
    'Renderer vocabulary — text: text, fontSize, fontFamily, fontWeight, color, align, lineHeight. shape: shape ("rect" | "circle"), color, borderRadius, strokeColor + strokeWidth, filled. math-shape: xFormula, yFormula, stroke, strokeWidth, fill, tStart, tEnd, samples, closePath. Keyframe times are relative to the layer\'s startTime. `position` is the top-left of the layer box.',
  ].join('\n')
}
