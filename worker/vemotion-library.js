// VEmotion libraries for Claude (2026-10-19): list_vemotion_library / get_vemotion_library_item.
//
// The app's pickers read one graph per kind (Math-Shape presets → vemotion-curves, Shapes tab →
// vemotion-shapes, Cards tab → vemotion-cards, Animations tab → vemotion-animations, Learn panel →
// the recipe graph). These two tools read the SAME graphs, so Claude and the app offer the same
// parts and adding a part is adding a node. An item comes back as a ready layer — the same layer
// the app's picker builds — so it can be dropped into a composition as is.

import { LIBRARY_GRAPHS } from './vemotion-catalog.js'

export const LIBRARY_KINDS = Object.keys(LIBRARY_GRAPHS)

async function readLibraryGraph(kind, env) {
  const lib = LIBRARY_GRAPHS[kind]
  if (!lib) throw new Error(`Unknown library kind "${kind}". Use one of: ${LIBRARY_KINDS.join(', ')}.`)
  if (!lib.graphId) throw new Error(`The ${kind} library has no graph yet — it is being built. Use get_vemotion_reference for worked examples meanwhile.`)
  const res = await env.KG_WORKER.fetch(`https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(lib.graphId)}`)
  const data = await res.json().catch(() => null)
  if (!res.ok || !Array.isArray(data?.nodes)) throw new Error(`Could not read the ${kind} library graph ${lib.graphId} (HTTP ${res.status}).`)
  return { graphId: lib.graphId, nodes: data.nodes }
}

const meta = (node) => (node?.metadata && typeof node.metadata === 'object' ? node.metadata : {})

// Per kind: which nodes are items, the one-line list entry, and the ready-to-use definition.
const KINDS = {
  curves: {
    isItem: (n) => typeof meta(n).curve?.xFormula === 'string' && typeof meta(n).curve?.yFormula === 'string',
    order: (n) => meta(n).curve.order ?? 999,
    entry: (n) => ({ family: meta(n).curve.family, summary: meta(n).curve.summary, use: meta(n).curve.use }),
    item: (n) => {
      const c = meta(n).curve
      return {
        layer: {
          type: 'math-shape',
          position: { x: 90, y: 510 },
          size: { width: 900, height: 900 },
          properties: {
            mathKind: 'parametric', xFormula: c.xFormula, yFormula: c.yFormula, tStart: c.tStart, tEnd: c.tEnd,
            samples: c.samples, closePath: c.closePath, stroke: n.color || '#38bdf8', strokeWidth: 4, fill: null,
          },
          animations: [{ property: 'drawProgress', keyframes: [{ time: 0, value: 0 }, { time: 2, value: 1 }], easing: 'easeInOut' }],
        },
        notes: 'Set position/size to place it — the formulas are written in the layer box, so the curve follows the box. Remove the drawProgress animation for a static curve; change stroke/strokeWidth freely.',
      }
    },
  },
  shapes: {
    isItem: (n) => typeof n.info === 'string' && n.info.trim().length > 0,
    entry: (n) => ({ category: meta(n).category, summary: `SVG shape (viewBox ${meta(n).viewBox || '0 0 24 24'})` }),
    item: (n, graphId) => ({
      layer: {
        type: 'kg-shape',
        position: { x: 440, y: 860 },
        size: { width: 200, height: 200 },
        properties: { svgPath: n.info, viewBox: meta(n).viewBox || '0 0 24 24', color: n.color || '#ffffff', filled: true, kgNodeId: n.id, kgGraphId: graphId },
      },
      notes: 'Scales into size; keep width:height equal to the viewBox ratio. filled:false + strokeColor/strokeWidth for an outline.',
    }),
  },
  cards: {
    isItem: (n) => Object.keys(meta(n)).length > 0,
    entry: (n) => ({ summary: `${n.info || 'Card style'} — ${meta(n).backgroundColor || ''} panel, ${meta(n).titleColor || ''} title` }),
    item: (n, graphId) => {
      const { defaultWidth, defaultHeight, category, ...style } = meta(n)
      const w = defaultWidth || 470, h = defaultHeight || 250
      return {
        layer: {
          type: 'card',
          position: { x: Math.round((1080 - w) / 2), y: 1200 },
          size: { width: w, height: h },
          properties: { ...style, title: 'Card Title', body: 'Edit this text to describe your content here.', kgNodeId: n.id, kgGraphId: graphId },
        },
        notes: 'Replace title/body. The style fields are ordinary card properties — change any of them.',
      }
    },
  },
  animations: {
    isItem: () => true,
    entry: (n) => ({ summary: 'An animation preview from the editor\'s Animations tab' }),
    item: (n) => {
      let definition = n.info
      try { definition = JSON.parse(n.info) } catch { /* keep text */ }
      return {
        definition,
        notes: 'These are the editor\'s animation PREVIEWS (CSS / scene / SVG), not layer animations. To animate a layer, use the animation kinds in get_vemotion_catalog (e.g. { property: "opacity", keyframes: [{time:0,value:0},{time:0.6,value:1}], easing: "easeOut" }).',
      }
    },
  },
  recipes: {
    isItem: (n) => typeof meta(n).recipe === 'object' && meta(n).recipe !== null,
    order: (n) => meta(n).recipe.order ?? 999,
    entry: (n) => {
      const r = meta(n).recipe
      return { summary: r.summary, difficulty: r.difficulty, teaches: r.teaches, format: r.format }
    },
    item: (n) => {
      const block = (n.info || '').match(/##\s*Example[\s\S]*?```json\s*([\s\S]*?)```/i)
      let composition = null
      if (block) { try { composition = JSON.parse(block[1]) } catch { composition = null } }
      return {
        recipe: meta(n).recipe,
        text: (n.info || '').replace(/##\s*Example[\s\S]*$/i, '').trim(),
        composition,
        notes: composition ? 'Save `composition` with vemotion_save_composition to get an editable copy, then change it.' : 'This recipe has no parsable example composition.',
      }
    },
  },
}

export async function listVemotionLibrary(input, env) {
  const kind = String(input?.kind || '').trim()
  if (!kind) {
    return {
      message: `Libraries: ${LIBRARY_KINDS.join(', ')}. Call again with { kind }.`,
      kinds: Object.fromEntries(Object.entries(LIBRARY_GRAPHS).map(([k, v]) => [k, { use: v.use, available: Boolean(v.graphId) }])),
    }
  }
  const spec = KINDS[kind]
  const { graphId, nodes } = await readLibraryGraph(kind, env)
  const items = nodes
    .filter((n) => n && n.visible !== false && spec.isItem(n))
    .sort((a, b) => (spec.order ? spec.order(a) - spec.order(b) : 0))
    .map((n) => ({ id: n.id, name: n.label, ...spec.entry(n) }))
  return {
    message: `${items.length} ${kind} in the VEmotion library — get one with get_vemotion_library_item { kind: "${kind}", id }`,
    kind,
    graphId,
    items,
  }
}

export async function getVemotionLibraryItem(input, env) {
  const kind = String(input?.kind || '').trim()
  const id = String(input?.id || '').trim()
  if (!kind || !id) throw new Error('kind and id are required — list the ids with list_vemotion_library { kind }.')
  const spec = KINDS[kind]
  const { graphId, nodes } = await readLibraryGraph(kind, env)
  const node = nodes.find((n) => n?.id === id && spec.isItem(n))
  if (!node) {
    const ids = nodes.filter((n) => spec.isItem(n)).map((n) => n.id)
    throw new Error(`No ${kind} item "${id}". Ids: ${ids.join(', ')}`)
  }
  return {
    message: `${kind}: ${node.label}`,
    kind,
    id: node.id,
    name: node.label,
    graphId,
    ...spec.item(node, graphId),
  }
}
