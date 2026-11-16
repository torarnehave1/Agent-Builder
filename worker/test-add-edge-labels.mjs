// add_edge on a pair that already has an edge must not relabel it: VEGR Flows route on edge
// labels, and a step may have both "next" and "error" to the same target (flow graph Stillerom,
// kalender -> logg). Before 2026-11-16 adding "error" turned the "next" edge into "error".
import assert from 'node:assert/strict'
import { executeTool } from './tool-executors.js'

function makeEnv(edges) {
  const graph = { nodes: [{ id: 'kalender', label: 'Kalender' }, { id: 'logg', label: 'Logg' }], edges }
  const saves = []
  const env = {
    KG_WORKER: {
      async fetch(url, init) {
        if (String(url).includes('/getknowgraph')) return new Response(JSON.stringify(structuredClone(graph)), { status: 200 })
        if (String(url).includes('/saveGraphWithHistory')) {
          const body = JSON.parse(init.body)
          saves.push(body.graphData)
          graph.edges = body.graphData.edges
          return new Response(JSON.stringify({ newVersion: 10 + saves.length }), { status: 200 })
        }
        return new Response('{}', { status: 404 })
      },
    },
  }
  return { env, saves, graph }
}
const add = (env, label) => executeTool('add_edge', { graphId: 'g1', sourceId: 'kalender', targetId: 'logg', label }, env, {})

// 1. "error" next to an existing "next" -> both edges kept, distinct ids.
{
  const { env, saves, graph } = makeEnv([{ id: 'kalender_logg', source: 'kalender', target: 'logg', label: 'next' }])
  const r = await add(env, 'error')
  assert.equal(saves.length, 1)
  assert.deepEqual(graph.edges.map(e => [e.id, e.label]), [['kalender_logg', 'next'], ['kalender_logg_error', 'error']])
  assert.equal(r.edgeId, 'kalender_logg_error')
  assert.match(r.message, /added \("error"\)/)

  // 2. Same label again -> already exists, no save.
  const again = await add(env, 'error')
  assert.equal(again.message, 'Edge already exists')
  assert.equal(again.edgeId, 'kalender_logg_error')
  assert.equal(saves.length, 1)

  // 3. No label asked for -> exists, nothing written.
  assert.equal((await add(env, undefined)).message, 'Edge already exists')
  assert.equal(saves.length, 1)
}

// 4. An unlabelled edge on the pair is relabelled, not duplicated.
{
  const { env, graph } = makeEnv([{ id: 'kalender_logg', source: 'kalender', target: 'logg', label: '' }])
  const r = await add(env, 'next')
  assert.match(r.message, /relabelled/)
  assert.deepEqual(graph.edges.map(e => [e.id, e.label]), [['kalender_logg', 'next']])
}

// 5. Labelled id already taken (by an edge elsewhere) -> counter suffix.
{
  const { env, graph } = makeEnv([
    { id: 'kalender_logg', source: 'kalender', target: 'logg', label: 'next' },
    { id: 'kalender_logg_error', source: 'x', target: 'y', label: 'odd' },
  ])
  const r = await add(env, 'error')
  assert.equal(r.edgeId, 'kalender_logg_error-2')
  assert.equal(graph.edges.length, 3)
}

// 6. First edge on a pair keeps the source_target id.
{
  const { env, graph } = makeEnv([])
  const r = await add(env, 'next')
  assert.equal(r.edgeId, 'kalender_logg')
  assert.deepEqual(graph.edges, [{ id: 'kalender_logg', source: 'kalender', target: 'logg', label: 'next' }])
}

console.log('test-add-edge-labels: ok')
