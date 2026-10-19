// VEmotion catalog (2026-10-19) — what VEmotion can draw, as data, for get_vemotion_catalog.
//
// Claude composed from a 28 KB prose cookbook and could not ask "which properties does a card
// layer read, in which unit, with which default, and which of them animate?". This module answers
// that for every layer type the renderer draws.
//
// It cannot drift silently:
//   - text / shape / math-shape: the property names must equal the composition gate's VOCABULARY
//     (which test-vemotion-composition-gate.mjs re-derives from renderer.ts) and the animatable
//     ones must equal the gate's ANIMATABLE — test-vemotion-catalog.mjs fails otherwise.
//   - every other layer type: test-vemotion-catalog.mjs re-derives the keys its draw method reads
//     from renderer.ts (and exporter.ts for sound) and fails on a difference.
//   - canvas presets and fonts: the same test reads them from the app's CompositionEditor.tsx.
//
// `gated: true` means vemotion_save_composition / check_vemotion_composition refuse an unknown
// property on that layer type; on the other types an unknown key is stored and ignored.

import { VOCABULARY, ANIMATABLE } from './vemotion-composition-gate.js'

const p = (type, extra = {}) => ({ type, ...extra })

// Keys every visual layer type reads through drawLayer / resolveLayerValues.
const COMMON = {
  opacity: p('number', { range: [0, 1], default: 1, animatable: true, note: '0 = invisible.' }),
  offsetX: p('number', { unit: 'px', default: 0, animatable: true, note: 'Moves the layer from `position` without changing it — what slide-ins animate.' }),
  offsetY: p('number', { unit: 'px', default: 0, animatable: true }),
  scale: p('number', { default: 1, animatable: true, note: 'Around the layer box centre. 0.05 → 1 is a pop-in.' }),
  motionScenes: p('MotionScene[]', { note: 'Procedural motion: [{ start, end, xFormula?, yFormula?, scaleFormula?, pathLayerId? }] in seconds on the layer clock. x/yFormula return ABSOLUTE canvas coordinates (prepend x0 / y0). Overrides offsetX/offsetY/scale while the scene runs.' }),
}

// Keys the shared code reads for EVERY layer (path bounds, the fill→color alias, the shape-name
// alias). They have no visible effect on the types listed with `alsoAccepted`; the gate accepts
// them, so the catalog says what they do instead of hiding them.
const NO_EFFECT = {
  anchors: 'path-layer key — no effect on this layer type',
  closed: 'path-layer key — no effect on this layer type',
  shape: 'shape-layer key — no effect on this layer type',
  strokeWidth: 'no effect on this layer type',
  fill: 'alias: copied to `color` when `color` is absent',
}

export const LAYER_TYPES = {
  text: {
    summary: 'Text in a box. Word-wrapped to size.width, centred vertically in the box, aligned horizontally by `align`.',
    gated: true,
    properties: {
      ...COMMON,
      text: p('string', { default: '', note: 'The words. Wraps at size.width.' }),
      fontSize: p('number', { unit: 'px', default: 48, animatable: true }),
      fontFamily: p('string', { default: 'the composition fontFamily', note: 'One of `fonts`.' }),
      fontWeight: p('string', { default: '600', values: ['300', '400', '500', '600', '700', '800', '900'] }),
      color: p('color', { default: '#ffffff' }),
      align: p('enum', { values: ['left', 'center', 'right'], default: 'left', note: 'Horizontal alignment inside the box. `position` is still the box top-left.' }),
      textAlign: p('enum', { values: ['left', 'center', 'right'], note: 'Alias of `align` (used when align is absent).' }),
      lineHeight: p('number', { default: 1.25, note: 'Multiplier of fontSize.' }),
      letterSpacing: p('number', { unit: 'em', range: [-0.2, 1], default: 0, animatable: true, note: 'A fraction of fontSize, never pixels: 0.05 = 5% of the font size between letters. Animate it for a tracking-in.' }),
      shadow: p('boolean', { default: true, note: 'Soft drop shadow under solid text. false turns it off.' }),
      rotation: p('number', { unit: 'deg', default: 0, animatable: true }),
      fillMode: p('enum', { values: ['solid', 'image'], default: 'solid', note: '"image" shows `fillSource` through the letter shapes.' }),
      fillSource: p('url', { note: 'Image URL for fillMode "image". Must be CORS-open, or the text falls back to solid.' }),
      fillFit: p('enum', { values: ['cover', 'contain', 'fill'], default: 'cover' }),
    },
    alsoAccepted: ['anchors', 'closed', 'shape', 'strokeWidth', 'fill'],
  },
  shape: {
    summary: 'A rectangle, rounded rectangle or circle/ellipse — filled by default, with an optional outline. No polygons: use `path` or `math-shape` for other outlines.',
    gated: true,
    properties: {
      ...COMMON,
      shape: p('enum', { values: ['rect', 'circle'], default: 'rect', note: '"rectangle" and "ellipse" are accepted aliases. A circle in a non-square box is an ellipse.' }),
      color: p('color', { default: '#ffffff', note: 'Fill colour.' }),
      fill: p('color', { note: 'Alias of `color` (used when color is absent).' }),
      filled: p('boolean', { default: true, note: 'false = outline only (needs strokeColor + strokeWidth).' }),
      fillMode: p('string', { note: '"none" also turns the fill off, like filled:false.' }),
      borderRadius: p('number', { unit: 'px', default: 0, animatable: true, note: 'Rounded corners on rect.' }),
      strokeColor: p('color', { note: 'Outline colour; drawn only with strokeWidth > 0.' }),
      strokeWidth: p('number', { unit: 'px', default: 0, animatable: true, note: 'Centred on the box edge — half sits outside.' }),
      rotation: p('number', { unit: 'deg', default: 0, animatable: true }),
    },
    alsoAccepted: ['anchors', 'closed'],
  },
  'math-shape': {
    summary: 'A stroked parametric curve: x and y are formulas of t, swept from tStart to tEnd. Line art, roses, stars, spirals — and it can trace itself in with drawProgress. Ready-made curves: list_vemotion_library { kind: "curves" }.',
    gated: true,
    properties: {
      ...COMMON,
      xFormula: p('formula', { note: 'Returns the ABSOLUTE canvas x. Write it in the layer box: x0 + w/2 + min(w,h)*0.45*cos(t). See `formula`.' }),
      yFormula: p('formula', { note: 'Returns the ABSOLUTE canvas y.' }),
      tStart: p('number', { default: 0 }),
      tEnd: p('number', { default: 6.283185, note: '2π for a closed curve.' }),
      samples: p('number', { range: [12, 720], default: 180, note: 'Points along the curve. 480–720 for cusps and petals.' }),
      closePath: p('boolean', { default: true, note: 'false for open curves (spirals, waves).' }),
      stroke: p('color', { default: '#38bdf8 (or `color`)', note: 'Line colour.' }),
      color: p('color', { note: 'Fallback line colour when `stroke` is absent.' }),
      strokeWidth: p('number', { unit: 'px', default: 3, animatable: true }),
      fill: p('color | null', { default: null, note: 'null = outline only.' }),
      drawProgress: p('number', { range: [0, 1], default: 1, animatable: true, note: 'Animate 0 → 1 to trace the curve in.' }),
      mathKind: p('enum', { values: ['parametric'], default: 'parametric' }),
    },
    alsoAccepted: ['anchors', 'closed', 'shape'],
  },
  image: {
    summary: 'A picture from a URL, fitted into the box. Can be clipped to an outline (mask), framed (border) and repaired (patches).',
    gated: false,
    properties: {
      ...COMMON,
      src: p('url', { note: 'HTTPS image URL (album images, Unsplash, …).' }),
      fit: p('enum', { values: ['cover', 'contain', 'fill'], default: 'cover' }),
      rotation: p('number', { unit: 'deg', default: 0, animatable: true }),
      borderWidth: p('number', { unit: 'px', default: 0, animatable: true }),
      borderColor: p('color', { note: 'Drawn only with borderWidth > 0.' }),
      mask: p('PathMask', { note: '{ type: "path", anchors: [{x,y,in?,out?}] in 0..1 of the box, invert?, feather? (px) } — clips the image to a closed outline.' }),
      patches: p('ImagePatch[]', { note: 'Clone repairs: [{ outline: anchors 0..1, source: { dx, dy } 0..1, feather? }].' }),
    },
    storedOnly: { name: 'Display name in the editor.' },
  },
  video: {
    summary: 'A video clip from a URL, fitted into the box, playing on the layer clock.',
    gated: false,
    properties: {
      ...COMMON,
      src: p('url', { note: 'HTTPS video URL.' }),
      fit: p('enum', { values: ['cover', 'contain', 'fill'], default: 'cover' }),
      audioEnabled: p('boolean', { default: false, note: 'true mixes the clip\'s own sound into the MP4.' }),
      volume: p('number', { range: [0, 1], default: 1 }),
    },
    storedOnly: { name: 'Display name in the editor.' },
  },
  audio: {
    summary: 'A sound track — not drawn. Mixed into the MP4 from startTime for layerDuration. position/size are kept for a uniform schema but unused.',
    gated: false,
    drawn: false,
    properties: {
      r2Url: p('url', { note: 'The audio file URL.' }),
      volume: p('number', { range: [0, 1], default: 1 }),
    },
    storedOnly: { name: 'Display name in the editor.' },
  },
  'kg-shape': {
    summary: 'An SVG shape snapshotted from the graph vemotion-shapes (list_vemotion_library { kind: "shapes" }), scaled into the box.',
    gated: false,
    properties: {
      ...COMMON,
      svgPath: p('string', { note: 'SVG path data (the `d` attribute).' }),
      viewBox: p('string', { default: '0 0 24 24' }),
      color: p('color', { default: '#ffffff' }),
      filled: p('boolean', { default: true }),
      strokeColor: p('color', { default: '' }),
      strokeWidth: p('number', { unit: 'px', default: 0, animatable: true }),
      rotation: p('number', { unit: 'deg', default: 0, animatable: true }),
    },
    storedOnly: { kgNodeId: 'The library node it came from.', kgGraphId: 'The library graph it came from.' },
  },
  card: {
    summary: 'A title + body card (a rounded panel with two text blocks), styled from the graph vemotion-cards (list_vemotion_library { kind: "cards" }).',
    gated: false,
    properties: {
      ...COMMON,
      title: p('string', { default: 'Title' }),
      body: p('string', { default: '' }),
      backgroundColor: p('color', { default: '#1e293b' }),
      borderRadius: p('number', { unit: 'px', default: 12, animatable: true }),
      padding: p('number', { unit: 'px', default: 24 }),
      gap: p('number', { unit: 'px', default: 12, note: 'Between title and body.' }),
      titleFontSize: p('number', { unit: 'px', default: 32 }),
      titleColor: p('color', { default: '#ffffff' }),
      titleFontWeight: p('string', { default: '700' }),
      bodyFontSize: p('number', { unit: 'px', default: 22 }),
      bodyColor: p('color', { default: '#cbd5e1' }),
      fontFamily: p('string', { default: 'the composition fontFamily' }),
    },
    storedOnly: { kgNodeId: 'The library node it came from.', kgGraphId: 'The library graph it came from.' },
  },
  path: {
    summary: 'A pen-tool path: anchors in ABSOLUTE canvas pixels, straight corners or cubic Bézier segments. Use it for polygons, star polygons, logos and motion paths (a motionScene can follow it via pathLayerId).',
    gated: false,
    properties: {
      anchors: p('PathAnchor[]', { note: '[{ x, y, in?: {x,y}, out?: {x,y} }] — handles are offsets from the anchor; no handles = corner.' }),
      closed: p('boolean', { default: false }),
      strokeColor: p('color', { default: '#94a3b8' }),
      strokeWidth: p('number', { unit: 'px', default: 2, animatable: true }),
      rotation: p('number', { unit: 'deg', default: 0, animatable: true }),
      showInPreview: p('boolean', { default: true, note: 'false hides the line (a path used only as a motion path).' }),
      showLabels: p('boolean', { default: true, note: 'Anchor letters and segment lengths (editor measurement aid).' }),
      measurements: p('PathMeasurements', { note: '{ mmPerPx, refSegment, refLengthMm } — real-world scale for the labels.' }),
      opacity: COMMON.opacity,
      scale: COMMON.scale,
    },
    note: 'A path is drawn at its anchors: offsetX/offsetY and motionScenes do not move it — edit the anchors, or animate opacity/scale/rotation.',
  },
  'knitting-chart': {
    summary: 'A stitch grid (cells of palette colours) with optional grid lines, row/column numbers and a legend. Animate it with kind "pixel-reveal".',
    gated: false,
    properties: {
      ...COMMON,
      cols: p('number'),
      rows: p('number'),
      palette: p('color[]'),
      cells: p('string[]', { note: 'rows × cols entries, each a palette colour.' }),
      drawOrder: p('number[]', { note: 'Paint order of the cells for the pixel-reveal animation.' }),
      background: p('color', { default: '#ffffff' }),
      gridColor: p('color', { default: '#999999' }),
      showGrid: p('boolean', { default: true }),
      showNumbers: p('boolean', { default: true }),
      showLegend: p('boolean', { default: true }),
    },
  },
  'telemetry-track': {
    summary: 'A meeting timeline: one lane per participant with present / speaking / muted / video-off spans, revealed by an animatable play-head.',
    gated: false,
    note: 'Drawn in its box: offsetX/offsetY and motionScenes do not move it.',
    properties: {
      opacity: COMMON.opacity,
      scale: COMMON.scale,
      meetingDurationMs: p('number', { unit: 'ms' }),
      participants: p('Participant[]', { note: '[{ pid, name, host?, talkPct?, segments: [{ type: "present"|"speaking"|"muted"|"videoOff", startMs, endMs }] }]' }),
      progress: p('number', { range: [0, 1], default: 1, animatable: true, note: 'The play-head. Animate 0 → 1.' }),
      laneHeight: p('number', { unit: 'px' }),
      laneGap: p('number', { unit: 'px' }),
      cornerRadius: p('number', { unit: 'px' }),
      labelWidth: p('number', { unit: 'px' }),
      statWidth: p('number', { unit: 'px' }),
      colors: p('object', { note: '{ present, speaking, muted, videoOff } colours.' }),
      legendLabels: p('object', { note: 'Legend text per segment type.' }),
      label: p('object', { note: '{ color, font, size } for lane names.' }),
      laneBg: p('color', { default: 'rgba(148,148,148,0.12)' }),
      showPlayhead: p('boolean', { default: true }),
      playheadColor: p('color', { default: '#111827' }),
      highlightActive: p('boolean', { default: true }),
      showLegend: p('boolean', { default: true }),
    },
  },
}

// Fill in `alsoAccepted` descriptions and the gate's animatable list for the gated types.
for (const [type, spec] of Object.entries(LAYER_TYPES)) {
  if (!spec.gated) continue
  for (const key of spec.alsoAccepted || []) {
    if (!spec.properties[key]) spec.properties[key] = { type: 'any', note: NO_EFFECT[key] }
  }
  for (const [key, prop] of Object.entries(spec.properties)) prop.animatable = ANIMATABLE[type].includes(key)
}

export const LAYER_FIELDS = {
  id: 'string — unique in the composition',
  type: `one of: ${Object.keys(LAYER_TYPES).join(', ')}`,
  name: 'string — display name in the editor (optional)',
  groupId: 'string — a composition `groups[]` id (optional)',
  position: '{ x, y } — the TOP-LEFT of the layer box in canvas px, for every type (a circle\'s centre is position + size/2)',
  size: '{ width, height } in canvas px',
  visible: 'boolean, default true',
  startTime: 'seconds on the composition clock, default 0',
  layerDuration: 'seconds, default = composition duration − startTime',
  animation: 'ONE Animation (legacy)',
  animations: 'Animation[] — preferred; several animations stack on independent properties',
  properties: 'per layer type — see layerTypes',
}

export const COMPOSITION_FIELDS = {
  duration: 'seconds',
  fps: 'frames per second, typically 30',
  width: 'canvas px',
  height: 'canvas px',
  fontFamily: 'default font for text and cards — one of `fonts`',
  groups: '[{ id, name, collapsed?, visible? }]',
  layers: 'Layer[] — array order is z-order: first is at the back',
  meta: 'carousel slide markers, audioTrack, description/tags, guides, markers, scale — keep it unchanged when editing',
}

export const ANIMATION_KINDS = {
  layer: { appliesTo: 'every type', fields: ['property', 'keyframes', 'easing'], note: 'Default kind. Interpolates `property` (a number) between keyframes. Keyframe times are seconds on the LAYER clock (0 = the layer\'s startTime).' },
  'char-stagger': { appliesTo: ['text'], fields: ['property', 'keyframes', 'easing', 'stagger'], properties: ['opacity', 'offsetX', 'offsetY', 'scale'], note: 'Runs the keyframes per character, each `stagger` seconds after the previous — opacity = type-on.' },
  'mask-wipe': { appliesTo: 'every type', fields: ['direction', 'keyframes', 'easing'], directions: ['ltr', 'rtl', 'ttb', 'btt', 'radial'], note: 'Keyframes drive a 0 → 1 reveal; radial = iris. Reverse the values to wipe out. `property` is unused.' },
  'char-scramble': { appliesTo: ['text'], fields: ['stagger', 'settleDuration'], note: 'Each character shows random letters until it settles at i·stagger + settleDuration. keyframes may be [].' },
  'pixel-reveal': { appliesTo: ['knitting-chart'], fields: ['keyframes'], note: 'Keyframes drive 0 → 1; cells appear in drawOrder.' },
}

export const EASINGS = {
  linear: 'constant speed',
  easeIn: 'starts slow (t²)',
  easeOut: 'arrives and settles (1 − (1 − t)²) — the usual choice for entrances',
  easeInOut: 'slow–fast–slow; the default when easing is absent',
}

export const FORMULA = {
  usedBy: ['math-shape xFormula / yFormula', 'motionScenes xFormula / yFormula / scaleFormula'],
  variables: {
    t: 'math-shape: swept tStart → tEnd. motionScene: seconds since the scene started',
    p: 'progress 0 → 1 across the sweep / scene',
    start: 'tStart / scene start', end: 'tEnd / scene end', duration: 'end − start',
    x0: 'layer position.x', y0: 'layer position.y', w: 'layer size.width', h: 'layer size.height',
    amp: 'audio amplitude 0..1 at this moment (needs meta.audioTrack)', ampL: 'left channel', ampR: 'right channel',
    time: 'layer-clock seconds',
  },
  functions: ['sin', 'cos', 'tan', 'abs', 'min', 'max', 'pow', 'sqrt', 'pi'],
  operators: ['+', '-', '*', '/', '%', '(', ')'],
  notAllowed: '`^` (use pow(a, b)), exp (use pow(2.71828, x)), log, asin/acos/atan, Math.* — a formula outside the vocabulary draws NOTHING, silently.',
  rule: 'Formulas return ABSOLUTE canvas coordinates: start with x0 + … / y0 + …, and size with w / h / min(w,h) so the curve follows the box and refit scales it.',
}

// The app's canvas-size menu and font menu (CompositionEditor.tsx) — test-vemotion-catalog.mjs
// fails when they differ.
export const CANVAS_PRESETS = [
  { label: 'YouTube / Landscape HD', width: 1920, height: 1080 },
  { label: 'YouTube Short / Reels / TikTok', width: 1080, height: 1920 },
  { label: 'Instagram Square', width: 1080, height: 1080 },
  { label: 'Instagram Landscape', width: 1280, height: 720 },
]

export const FONTS = ['Inter', 'Poppins', 'Caveat', 'Montserrat', 'DM Sans', 'Plus Jakarta Sans', 'Space Grotesk', 'Playfair Display', 'Lora', 'Anek Devanagari', 'Noto Sans Devanagari', 'Tiro Devanagari Sanskrit']

// One graph per library kind — the graphs the app's own pickers read. Adding an item = adding a
// node. Recipes: the graph is being built (2026-10-19); its id goes here when it exists.
export const LIBRARY_GRAPHS = {
  curves: { graphId: 'fa779347-85f1-4bac-8e4b-26e26e97ad9f', title: 'vemotion-curves', use: 'math-shape presets — copy metadata.curve into a math-shape layer\'s properties' },
  shapes: { graphId: 'vemotion-shapes', use: 'kg-shape layers — svgPath + viewBox' },
  cards: { graphId: 'vemotion-cards', use: 'card layers — the style fields' },
  animations: { graphId: 'vemotion-animations', use: 'the app\'s animation previews (editor Animations tab)' },
  recipes: { graphId: null, use: 'worked examples: goal, steps, why it looks good, and a full example composition' },
}

export function buildVemotionCatalog() {
  return {
    about: 'What VEmotion can draw, generated from the composition gate and the renderer — the same rules vemotion_save_composition enforces. Technique and worked examples: get_vemotion_reference. Ready-made parts: list_vemotion_library. Check a draft without saving: check_vemotion_composition. See frames: preview_vemotion_frames.',
    composition: COMPOSITION_FIELDS,
    layer: LAYER_FIELDS,
    layerTypes: LAYER_TYPES,
    animationKinds: ANIMATION_KINDS,
    easings: EASINGS,
    formula: FORMULA,
    canvasPresets: CANVAS_PRESETS,
    fonts: FONTS,
    libraries: Object.fromEntries(Object.entries(LIBRARY_GRAPHS).map(([k, v]) => [k, { use: v.use, available: Boolean(v.graphId) }])),
    gated: Object.keys(VOCABULARY),
  }
}
