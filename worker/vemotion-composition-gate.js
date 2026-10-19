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
  text: ['align', 'anchors', 'closed', 'color', 'fill', 'fillFit', 'fillMode', 'fillSource', 'fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight', 'motionScenes', 'offsetX', 'offsetY', 'opacity', 'rotation', 'scale', 'shadow', 'shape', 'strokeWidth', 'text', 'textAlign'],
  shape: ['anchors', 'borderRadius', 'closed', 'color', 'fill', 'fillMode', 'filled', 'motionScenes', 'offsetX', 'offsetY', 'opacity', 'rotation', 'scale', 'shape', 'strokeColor', 'strokeWidth'],
  'math-shape': ['anchors', 'closePath', 'closed', 'color', 'drawProgress', 'fill', 'mathKind', 'motionScenes', 'offsetX', 'offsetY', 'opacity', 'samples', 'scale', 'shape', 'stroke', 'strokeWidth', 'tEnd', 'tStart', 'xFormula', 'yFormula'],
}

// Names models reach for (canvas / CSS / other editors) mapped to what the renderer reads.
// Every entry on the first lines of each type was observed in stored compositions.
const HINTS = {
  text: {
    fillColor: 'use `color`',
    verticalAlign: 'not supported — text is always centred vertically in its box; place the box with position.y and size.height',
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

// The fields of a Layer itself (video-generator src/lib/api.ts `Layer`).
export const LAYER_FIELDS = ['id', 'type', 'name', 'groupId', 'position', 'size', 'visible', 'startTime', 'layerDuration', 'animation', 'animations', 'properties']

export const ANIMATABLE = {
  text: ['opacity', 'offsetX', 'offsetY', 'scale', 'rotation', 'fontSize', 'letterSpacing'],
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

// letterSpacing is in em — a fraction of fontSize (decision-vemotion-letterspacing-em,
// 2026-10-19). Models write CSS/canvas pixels by habit (`8` meaning 8px), which in em is eight
// font-sizes between letters. Anything outside this range is refused with the em value to use.
const LETTER_SPACING_MIN = -0.2
const LETTER_SPACING_MAX = 1
function letterSpacingProblem(where, value, fontSize, label = '`letterSpacing`') {
  if (!isNum(value)) return `${where}: ${label} must be a number in em (a fraction of fontSize), e.g. 0.05`
  if (value >= LETTER_SPACING_MIN && value <= LETTER_SPACING_MAX) return null
  const asEm = round(value / (fontSize || 48))
  return `${where}: ${label} is ${value}, but letterSpacing is in em (a fraction of fontSize), not pixels — ${value}px at fontSize ${fontSize || 48} is ${asEm}. Use a value between ${LETTER_SPACING_MIN} and ${LETTER_SPACING_MAX}.`
}
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

    // A layer's own fields are few; everything the renderer draws lives in `properties`. An agent
    // wrote src/text/color straight on the layer (2026-10-19, "Hello autumn"): it saved, and the
    // photo and title drew blank.
    const stray = Object.keys(layer).filter((k) => !LAYER_FIELDS.includes(k))
    if (stray.length) {
      const one = stray.length === 1
      problems.push(`${where}: ${stray.map((k) => `\`${k}\``).join(', ')} ${one ? 'is not a layer field' : 'are not layer fields'} and ${one ? 'is' : 'are'} ignored — what the renderer draws goes inside \`properties\` (e.g. properties.src, properties.text, properties.color); remove anything that is not a property. A layer itself has only ${LAYER_FIELDS.join(', ')}.`)
    }
    const vocab = VOCABULARY[layer.type]

    if (vocab) {
      for (const key of Object.keys(props)) {
        if (vocab.includes(key)) continue
        const hint = HINTS[layer.type]?.[key] || `remove it (a ${layer.type} layer reads: ${vocab.join(', ')})`
        problems.push(`${where}: property \`${key}\` is not read by the renderer — ${hint}`)
      }
    }

    if (layer.type === 'text') {
      const fs = isNum(props.fontSize) ? props.fontSize : 48
      if (props.letterSpacing !== undefined) {
        const p = letterSpacingProblem(where, props.letterSpacing, fs)
        if (p) problems.push(p)
      }
      for (const a of [layer.animation, ...(Array.isArray(layer.animations) ? layer.animations : [])]) {
        if (!a || a.property !== 'letterSpacing' || !Array.isArray(a.keyframes)) continue
        const bad = a.keyframes.find((k) => isNum(k?.value) && (k.value < LETTER_SPACING_MIN || k.value > LETTER_SPACING_MAX))
        if (bad) problems.push(letterSpacingProblem(where, bad.value, fs, 'a letterSpacing keyframe value'))
      }
    }
    if (layer.type === 'knitting-chart') {
      const p = knittingChartProblem(where, props, layer)
      if (p) problems.push(p)
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

    problems.push(...checkFormulas(layer, props, where, duration))
  })

  return problems
}

// ── Formulas (2026-10-19) ───────────────────────────────────────────────────────────────────────
//
// math-shape xFormula/yFormula and motionScenes x/y/scaleFormula are evaluated by renderer.ts
// evaluateFormula(): a safety regex, then `new Function(<FORMULA_ARGS>, "return (<formula>)")`, and
// any formula that fails the regex, throws or returns a non-finite number yields null — the layer
// silently draws nothing (math-shape) or ignores the scene (motionScenes). Several cookbook curves
// used `^`, which the regex rejects. This rule evaluates every formula the way the renderer does and
// names the layer, the formula and the fix.
//
// Workers forbid `new Function`, so the formula is parsed here with JavaScript's own grammar for the
// subset the regex admits (numbers, identifiers, + - * / % **, parentheses, calls, commas) and
// evaluated with the same Math functions. FORMULA_SAFE and FORMULA_ARGS mirror renderer.ts;
// test-vemotion-composition-gate.mjs fails if they drift.

export const FORMULA_SAFE = /^[0-9+\-*/%().,\s_a-zA-Z]+$/
export const FORMULA_VARIABLES = ['t', 'p', 'start', 'end', 'duration', 'x0', 'y0', 'w', 'h', 'amp', 'ampL', 'ampR', 'time']
const FORMULA_FUNCTIONS = { sin: Math.sin, cos: Math.cos, tan: Math.tan, abs: Math.abs, min: Math.min, max: Math.max, pow: Math.pow, sqrt: Math.sqrt }
const FORMULA_CONSTANTS = { pi: Math.PI }
export const FORMULA_ARGS = [...FORMULA_VARIABLES, ...Object.keys(FORMULA_FUNCTIONS), ...Object.keys(FORMULA_CONSTANTS)]

const VOCAB_LINE = `variables ${FORMULA_VARIABLES.join(', ')}, pi; functions ${Object.keys(FORMULA_FUNCTIONS).join(', ')}; operators + - * / % ( )`
const MISSING_FUNCTION = 'the only functions are sin, cos, tan, abs, min, max, pow, sqrt'
const IDENTIFIER_HINTS = {
  Math: 'drop the `Math.` prefix — write sin(t), pi, pow(a, b)',
  PI: 'use `pi` (lower case)',
  exp: 'use pow(2.71828, x)',
  e: 'use 2.71828',
  E: 'use 2.71828',
  log: MISSING_FUNCTION, ln: MISSING_FUNCTION, log10: MISSING_FUNCTION, log2: MISSING_FUNCTION,
  asin: MISSING_FUNCTION, acos: MISSING_FUNCTION, atan: MISSING_FUNCTION, atan2: MISSING_FUNCTION,
  sinh: MISSING_FUNCTION, cosh: MISSING_FUNCTION, tanh: MISSING_FUNCTION,
  floor: MISSING_FUNCTION, ceil: MISSING_FUNCTION, round: MISSING_FUNCTION, sign: MISSING_FUNCTION,
  sq: 'use pow(x, 2)', cube: 'use pow(x, 3)', cbrt: 'use pow(x, 1/3) (x ≥ 0)',
  x: 'use x0 (layer position.x) — a formula returns the absolute canvas coordinate',
  y: 'use y0 (layer position.y)',
  width: 'use w', height: 'use h', progress: 'use p', tau: 'use 2*pi',
}

// Tokens: numbers, identifiers, `**`, `++`/`--` (JavaScript update operators — a syntax error in a
// formula), single-character operators. Throws on a number glued to a name (`2t`), as JS does.
function tokenizeFormula(src) {
  const tokens = []
  let i = 0
  while (i < src.length) {
    const rest = src.slice(i)
    const ws = rest.match(/^\s+/)
    if (ws) { i += ws[0].length; continue }
    const num = rest.match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/)
    if (num) {
      if (/^[A-Za-z_]/.test(rest.slice(num[0].length))) {
        const glued = rest.match(/^[\w.]+/)[0]
        throw new Error(`\`${glued}\` is not valid — write the multiplication: ${num[0]}*${rest.slice(num[0].length).match(/^\w+/)[0]}`)
      }
      tokens.push({ type: 'num', value: Number(num[0]) }); i += num[0].length; continue
    }
    const id = rest.match(/^[A-Za-z_]\w*/)
    if (id) { tokens.push({ type: 'id', value: id[0] }); i += id[0].length; continue }
    const op = rest.match(/^(\*\*|\+\+|--|[+\-*/%(),.])/)
    if (op) { tokens.push({ type: 'op', value: op[0] }); i += op[0].length; continue }
    throw new Error(`unexpected \`${rest[0]}\``)
  }
  return tokens
}

// Recursive descent with JavaScript precedence: comma < additive < multiplicative < unary < ** (right-
// associative; `-a ** b` is a SyntaxError in JS and here) < call / primary.
function parseFormula(src) {
  const tokens = tokenizeFormula(src)
  let pos = 0
  const peek = () => tokens[pos]
  const isOp = (v) => tokens[pos]?.type === 'op' && tokens[pos].value === v
  const expect = (v) => {
    if (!isOp(v)) throw new Error(peek() ? `expected \`${v}\` before \`${peek().value}\`` : `missing \`${v}\``)
    pos++
  }
  const sequence = () => {
    const items = [additive()]
    while (isOp(',')) { pos++; items.push(additive()) }
    return items.length === 1 ? items[0] : { type: 'seq', items }
  }
  const additive = () => {
    let left = multiplicative()
    while (isOp('+') || isOp('-')) { const op = tokens[pos++].value; left = { type: 'bin', op, left, right: multiplicative() } }
    return left
  }
  const multiplicative = () => {
    let left = exponent()
    while (isOp('*') || isOp('/') || isOp('%')) { const op = tokens[pos++].value; left = { type: 'bin', op, left, right: exponent() } }
    return left
  }
  const unaryOnly = () => {
    if (isOp('+') || isOp('-')) { const op = tokens[pos++].value; return { type: 'neg', op, arg: unaryOnly() } }
    return call()
  }
  const exponent = () => {
    if (isOp('+') || isOp('-')) {
      const node = unaryOnly()
      if (isOp('**')) throw new Error('`-a ** b` is ambiguous in JavaScript — write (-a) ** b or -(a ** b), or use pow')
      return node
    }
    const base = call()
    if (isOp('**')) { pos++; return { type: 'bin', op: '**', left: base, right: exponent() } }
    return base
  }
  const call = () => {
    const node = primary()
    if (isOp('(')) {
      if (node.type !== 'id') throw new Error('a value followed by `(` — write the multiplication: a*(b)')
      pos++
      const args = []
      if (!isOp(')')) {
        args.push(additive())
        while (isOp(',')) { pos++; args.push(additive()) }
      }
      expect(')')
      return { type: 'call', name: node.name, args }
    }
    if (isOp('.')) {
      if (node.type === 'id' && node.name === 'Math') throw Object.assign(new Error(`\`Math.\`, which is outside the formula vocabulary — ${IDENTIFIER_HINTS.Math}`), { leaksGlobal: true })
      throw new Error('property access (`a.b`) is not supported')
    }
    return node
  }
  const primary = () => {
    const tok = tokens[pos++]
    if (!tok) throw new Error('the formula ends where a value is expected')
    if (tok.type === 'num') return { type: 'num', value: tok.value }
    if (tok.type === 'id') return { type: 'id', name: tok.value }
    if (tok.value === '(') { const inner = sequence(); expect(')'); return inner }
    if (tok.value === '++' || tok.value === '--') throw new Error(`\`${tok.value}\` is JavaScript's increment/decrement — put a space or parentheses between the two signs`)
    throw new Error(`unexpected \`${tok.value}\``)
  }
  if (!tokens.length) throw new Error('empty')
  const ast = sequence()
  if (pos < tokens.length) {
    const tok = tokens[pos]
    if (tok.value === '++' || tok.value === '--') throw new Error(`\`${tok.value}\` is JavaScript's increment/decrement — put a space or parentheses between the two signs`)
    throw new Error(`unexpected \`${tok.value}\` — is an operator missing?`)
  }
  return ast
}

// Names the formula uses that the renderer does not pass in, and misuse of the ones it does.
function formulaNameProblems(ast) {
  const unknown = new Set()
  const misuse = new Set()
  const walk = (n, asCallee = false) => {
    if (!n) return
    if (n.type === 'id') {
      if (FORMULA_FUNCTIONS[n.name] && !asCallee) misuse.add(`uses \`${n.name}\` as a value — it is a function; call it, e.g. ${n.name}(t)`)
      else if (!FORMULA_FUNCTIONS[n.name] && !FORMULA_ARGS.includes(n.name)) unknown.add(n.name)
      return
    }
    if (n.type === 'call') {
      if (FORMULA_FUNCTIONS[n.name]) { /* ok */ } else if (FORMULA_ARGS.includes(n.name)) misuse.add(`calls \`${n.name}(…)\` — ${n.name} is a value, not a function, so the call throws; write ${n.name}*(…)`)
      else unknown.add(n.name)
      n.args.forEach((a) => walk(a))
      return
    }
    if (n.type === 'bin') { walk(n.left); walk(n.right) }
    if (n.type === 'neg') walk(n.arg)
    if (n.type === 'seq') n.items.forEach((a) => walk(a))
  }
  walk(ast)
  return [
    ...[...unknown].map((name) => `uses \`${name}\`, which the renderer does not provide — ${IDENTIFIER_HINTS[name] || 'use only the formula vocabulary'}`),
    ...misuse,
  ]
}

function evalFormulaAst(n, ctx) {
  switch (n.type) {
    case 'num': return n.value
    case 'id': return n.name in FORMULA_CONSTANTS ? FORMULA_CONSTANTS[n.name] : ctx[n.name]
    case 'neg': { const v = evalFormulaAst(n.arg, ctx); return n.op === '-' ? -v : +v }
    case 'seq': { let v; for (const item of n.items) v = evalFormulaAst(item, ctx); return v }
    case 'call': return FORMULA_FUNCTIONS[n.name](...n.args.map((a) => evalFormulaAst(a, ctx)))
    case 'bin': {
      const a = evalFormulaAst(n.left, ctx)
      const b = evalFormulaAst(n.right, ctx)
      switch (n.op) {
        case '+': return a + b
        case '-': return a - b
        case '*': return a * b
        case '/': return a / b
        case '%': return a % b
        case '**': return a ** b
      }
    }
  }
  return NaN
}

// Compile one formula the way the renderer would see it. Returns { evaluate } or { problem }.
function compileFormula(formula) {
  if (typeof formula !== 'string') return { problem: `must be a string, got ${JSON.stringify(formula)}` }
  const safe = formula.trim()
  if (!FORMULA_SAFE.test(safe)) {
    const bad = [...new Set(safe.replace(/[0-9+\-*/%().,\s_a-zA-Z]/g, ''))]
    const fixes = bad.map((c) => c === '^' ? '`^` is not a power — write pow(a, b), e.g. sin(t)^3 → pow(sin(t), 3)'
      : c === '[' || c === ']' ? '`[ ]` are not brackets — use ( )'
      : c === 'π' ? '`π` — write pi'
      : c === '·' || c === '×' ? `\`${c}\` — write *`
      : `\`${c}\` is not allowed`)
    return { problem: `contains ${bad.map((c) => `\`${c}\``).join(' ')}, which the renderer's safety check refuses: ${fixes.join('; ')}` }
  }
  let ast
  try { ast = parseFormula(safe) } catch (err) {
    // Math.* draws today: renderer.ts runs the formula through `new Function`, which still sees the
    // browser's globals. It is refused because the vocabulary (and anything that evaluates formulas
    // without a browser) does not include it — the message says so instead of claiming a blank layer.
    if (err.leaksGlobal) return { problem: `uses ${err.message}. It renders today only because the browser's global Math leaks into the evaluator`, renders: true }
    return { problem: `is not a valid expression: ${err.message}` }
  }
  const names = formulaNameProblems(ast)
  if (names.length) return { problem: `${names.join('; ')}. Formula vocabulary: ${VOCAB_LINE}` }
  return {
    evaluate: (ctx) => {
      try {
        const v = evalFormulaAst(ast, ctx)
        return Number.isFinite(v) ? v : null
      } catch { return null }
    },
  }
}

const NON_FINITE_FIX = 'look for division by zero, sqrt of a negative number, or pow of a negative base with a fractional exponent'
// Time and audio are probed at a few values, so a formula that is only finite once the clock or the
// audio moves is not refused.
function probeContexts(base, layerDuration) {
  const times = [0, 1, isNum(layerDuration) && layerDuration > 0 ? layerDuration / 2 : 2]
  const out = []
  for (const time of times) for (const amp of [0, 0.5]) out.push({ ...base, time, amp, ampL: amp, ampR: amp })
  return out
}

function checkFormulas(layer, props, where, layerDuration) {
  const problems = []
  const x0 = (isNum(layer.position?.x) ? layer.position.x : 0) + (isNum(props.offsetX) ? props.offsetX : 0)
  const y0 = (isNum(layer.position?.y) ? layer.position.y : 0) + (isNum(props.offsetY) ? props.offsetY : 0)
  const w = isNum(layer.size?.width) ? layer.size.width : 0
  const h = isNum(layer.size?.height) ? layer.size.height : 0
  const quote = (f) => typeof f === 'string' ? `"${f.length > 120 ? `${f.slice(0, 117)}…` : f}"` : ''

  // math-shape: renderer.ts drawMathShape — `samples` + 1 points over tStart..tEnd; fewer than two
  // points where BOTH formulas are finite draws nothing.
  if (layer.type === 'math-shape' && (props.mathKind ?? 'parametric') === 'parametric'
      && typeof props.xFormula === 'string' && props.xFormula && typeof props.yFormula === 'string' && props.yFormula) {
    const fx = compileFormula(props.xFormula)
    const fy = compileFormula(props.yFormula)
    if (fx.problem) problems.push(`${where}: xFormula ${quote(props.xFormula)} ${fx.problem}${fx.renders ? '.' : ' — the curve draws nothing.'}`)
    if (fy.problem) problems.push(`${where}: yFormula ${quote(props.yFormula)} ${fy.problem}${fy.renders ? '.' : ' — the curve draws nothing.'}`)
    if (!fx.problem && !fy.problem) {
      const samples = Math.max(12, Math.min(720, Number(props.samples) || 180))
      const tStart = Number(props.tStart) || 0
      const tEnd = Number(props.tEnd) || Math.PI * 2
      let best = { both: 0, x: 0, y: 0 }
      for (const ctx of probeContexts({ start: tStart, end: tEnd, duration: tEnd - tStart, x0, y0, w, h }, layerDuration)) {
        let both = 0, xs = 0, ys = 0
        for (let i = 0; i <= samples; i += 1) {
          const p = i / samples
          const c = { ...ctx, p, t: tStart + (tEnd - tStart) * p }
          const px = fx.evaluate(c)
          const py = fy.evaluate(c)
          if (px !== null) xs++
          if (py !== null) ys++
          if (px !== null && py !== null) both++
        }
        if (both > best.both || (best.both === 0 && xs + ys > best.x + best.y)) best = { both, x: xs, y: ys }
        if (both >= 2) break
      }
      if (best.both < 2) {
        const range = `t = ${round(tStart)}…${round(tEnd)} (${samples + 1} samples)`
        const which = best.x === 0 && best.y === 0 ? `neither xFormula ${quote(props.xFormula)} nor yFormula ${quote(props.yFormula)} gives a finite number`
          : best.x === 0 ? `xFormula ${quote(props.xFormula)} gives no finite number`
          : best.y === 0 ? `yFormula ${quote(props.yFormula)} gives no finite number`
          : `xFormula ${quote(props.xFormula)} and yFormula ${quote(props.yFormula)} are finite together at fewer than 2 points`
        problems.push(`${where}: ${which} over ${range}, so the curve draws nothing — ${NON_FINITE_FIX}.`)
      }
    }
  }

  // motionScenes: renderer.ts resolveLayerValues — t runs 0…(end − start) inside the scene; a null
  // result leaves offset / scale untouched for the whole scene.
  if (Array.isArray(props.motionScenes)) {
    props.motionScenes.forEach((scene, i) => {
      if (!scene || typeof scene !== 'object') return
      const start = isNum(scene.start) ? scene.start : 0
      const end = isNum(scene.end) ? scene.end : start
      const duration = Math.max(0, end - start)
      for (const [key, effect] of [['xFormula', 'the layer keeps its own x'], ['yFormula', 'the layer keeps its own y'], ['scaleFormula', 'the layer keeps its own scale']]) {
        const formula = scene[key]
        if (formula === undefined || formula === null || formula === '') continue
        if (typeof formula === 'string' && !formula.trim()) continue
        const label = `${where}: motionScenes[${i}].${key} ${quote(formula)}`
        const f = compileFormula(formula)
        if (f.problem) { problems.push(`${label} ${f.problem}${f.renders ? '.' : ` — ${effect} during this scene.`}`); continue }
        let finite = false
        const n = 60
        for (const ctx of probeContexts({ start, end, duration, x0: isNum(layer.position?.x) ? layer.position.x : 0, y0: isNum(layer.position?.y) ? layer.position.y : 0, w, h }, layerDuration)) {
          for (let k = 0; k <= n && !finite; k += 1) {
            const p = k / n
            if (f.evaluate({ ...ctx, t: duration * p, p: end > start ? p : 0 }) !== null) finite = true
          }
          if (finite) break
        }
        if (!finite) problems.push(`${label} gives no finite number for t = 0…${round(duration)}s — ${effect} during this scene; ${NON_FINITE_FIX}.`)
      }
    })
  }
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
  // letterSpacing (em) widens every glyph advance; negative spacing never makes a glyph narrower than 0.
  const spacing = isNum(props.letterSpacing) ? props.letterSpacing * fontSize : 0
  const charW = Math.max(0, CHAR_WIDTH * fontSize + spacing)
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

// A knitting-chart (pixel grid) draws nothing without its grid, and only a pixel-reveal animates it
// (2026-10-19: an agent saved a "pixel-art cat" with no cells and a drawProgress animation — the
// save passed and the layer was empty). The renderer reads cols, rows, palette and cells (one
// base-36 index per column per row) and, for the reveal, drawOrder (flat indices r*cols + c).
function knittingChartProblem(where, props, layer) {
  const { cols, rows, palette, cells, drawOrder } = props
  const fix = 'A knitting-chart needs cols, rows, palette (hex colours, at most 36) and cells (rows strings, each cols characters; each character a base-36 index into palette, 0-9 then a-z). get_vemotion_catalog → layerTypes["knitting-chart"].'
  if (!Number.isInteger(cols) || cols < 1 || !Number.isInteger(rows) || rows < 1) return `${where}: cols and rows must be whole numbers above 0. ${fix}`
  if (!Array.isArray(palette) || palette.length === 0 || palette.length > 36) return `${where}: palette must list 1-36 colours. ${fix}`
  if (!Array.isArray(cells) || cells.length !== rows) return `${where}: cells must have one string per row (${rows}), got ${Array.isArray(cells) ? cells.length : 'none'}. ${fix}`
  for (let r = 0; r < cells.length; r++) {
    const row = cells[r]
    if (typeof row !== 'string' || row.length !== cols) return `${where}: cells[${r}] must be a string of ${cols} characters, got ${typeof row === 'string' ? row.length : typeof row}. ${fix}`
    for (const ch of row) {
      const idx = parseInt(ch, 36)
      if (!(idx >= 0 && idx < palette.length)) return `${where}: cells[${r}] uses "${ch}", which is not an index into the ${palette.length}-colour palette. ${fix}`
    }
  }
  const anims = [layer.animation, ...(Array.isArray(layer.animations) ? layer.animations : [])].filter((a) => a && typeof a === 'object')
  const wrong = anims.find((a) => (a.kind ?? 'layer') === 'layer' && a.property === 'drawProgress')
  if (wrong) return `${where}: drawProgress does not animate a knitting-chart (it is a math-shape property). To draw the grid stitch by stitch use { kind: "pixel-reveal", keyframes: [{time:0,value:0},{time:T,value:1}], easing: "linear" } with properties.drawOrder — and vemotion_set_drawing_pace to set its speed.`
  const reveal = anims.find((a) => a.kind === 'pixel-reveal')
  if (reveal || drawOrder !== undefined) {
    const max = cols * rows
    if (!Array.isArray(drawOrder) || drawOrder.length === 0) return `${where}: a pixel-reveal needs properties.drawOrder — the flat cell indices (r*cols + c) in the order the stitches appear; list every stitch that should be drawn.`
    const bad = drawOrder.find((i) => !Number.isInteger(i) || i < 0 || i >= max)
    if (bad !== undefined) return `${where}: drawOrder contains ${bad}, but cell indices run 0-${max - 1} (r*cols + c).`
    if (!reveal) return `${where}: drawOrder is set but no animation uses it — add { kind: "pixel-reveal", keyframes: [{time:0,value:0},{time:T,value:1}], easing: "linear" }.`
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
    'Renderer vocabulary — text: text, fontSize, fontFamily, fontWeight, color, align, lineHeight, letterSpacing (em: a fraction of fontSize, e.g. 0.05). shape: shape ("rect" | "circle"), color, borderRadius, strokeColor + strokeWidth, filled. math-shape: xFormula, yFormula, stroke, strokeWidth, fill, tStart, tEnd, samples, closePath. Formulas (xFormula, yFormula, scaleFormula) use only t, p, start, end, duration, x0, y0, w, h, amp, ampL, ampR, time, pi and sin, cos, tan, abs, min, max, pow, sqrt — powers are pow(a, b), never `^`. Keyframe times are relative to the layer\'s startTime. `position` is the top-left of the layer box.',
  ].join('\n')
}
