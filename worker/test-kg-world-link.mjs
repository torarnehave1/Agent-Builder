// A graph the KG subagent creates in a World must come back with the World's link (editor), the
// World named in the subagent's task, and never the public gnew-viewer link (noahart.studio,
// 2026-11-16: the graph was stored correctly, but the chat handed out a gnew-viewer link that
// refuses World graphs, and the subagent called its own correct write a mistake).
import assert from 'node:assert/strict'
import { runKgSubagent } from './kg-subagent.js'

const GID = '11111111-2222-4333-8444-555555555555'
const EDITOR = `https://editor.vegvisr.org/?graphId=${GID}`
let firstUserMessage = null
let modelTurn = 0

const env = {
  ANTHROPIC: {
    async fetch(_url, init) {
      const body = JSON.parse(init.body)
      if (firstUserMessage === null) firstUserMessage = body.messages[0].content
      modelTurn++
      const reply = modelTurn === 1
        ? { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'create_graph', input: { title: 'X' } }] }
        : modelTurn === 2
          ? { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'create_node', input: { graphId: GID, id: 'n1', label: 'n', type: 'html-node', info: '<p>x</p>' } }] }
          : { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] }
      return new Response(JSON.stringify(reply), { status: 200, headers: { 'Content-Type': 'application/json' } })
    },
  },
  // The platform KG refuses a World graph to an unsigned read, as it does live.
  KG_WORKER: { async fetch() { return new Response(JSON.stringify({ error: 'stored in the World' }), { status: 403 }) } },
}

const seen = []
async function executeTool(name, input) {
  seen.push({ name, input })
  if (name === 'create_graph') {
    assert.equal(input.world, 'noahart.studio', 'world is injected into create_graph')
    return { graphId: GID, world: 'noahart.studio', viewUrl: EDITOR, message: `Graph created, stored in noahart.studio's own storage` }
  }
  return { message: 'node ok', nodeId: input.id }
}

const result = await runKgSubagent({ task: 'Create a graph with one html node', world: 'noahart.studio' }, env, null, executeTool)

assert.match(firstUserMessage, /- world: noahart\.studio/, 'the World is named in the task text')
assert.equal(result.viewUrl, EDITOR, 'subagent returns the editor link create_graph chose')
assert.equal(result.world, 'noahart.studio')
assert.ok(!String(result.viewUrl).includes('gnew-viewer'))

// Platform graph: no world, no viewUrl from the action → the subagent returns none, and the
// executor keeps its gnew-viewer fallback.
firstUserMessage = null; modelTurn = 0
const plain = await runKgSubagent({ task: 'Create a graph with one html node' }, env, null, async (name, input) =>
  name === 'create_graph' ? { graphId: GID, message: 'created' } : { message: 'ok', nodeId: input.id })
assert.ok(!/- world:/.test(firstUserMessage), 'no World line without a world')
assert.equal(plain.viewUrl, undefined)

console.log('test-kg-world-link: ok')
