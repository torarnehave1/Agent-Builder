/**
 * The delegate→steps forwarding guard. This decides whether "Make Automation" can turn a
 * delegation into concrete steps or has to leave a subagent call in the automation.
 *
 * Run: node worker/test-replayable-actions.mjs
 */
import { replayableActions } from './agent-loop.js'

const fail = []
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail.push(`${msg} — got ${JSON.stringify(a)}`) }

// A subagent's record, as the subagents now write it.
const actions = [
  { tool: 'create_graph', input: { graphId: 'llm-invented', title: 'X' }, success: true, graphId: 'server-assigned', summary: 'ok' },
  { tool: 'create_node', input: { graphId: 'server-assigned', nodeId: 'n1', label: 'L' }, success: true, graphId: 'server-assigned', nodeId: 'n1', summary: 'ok' },
  { tool: 'patch_node', input: { graphId: 'server-assigned', nodeId: 'n1' }, success: false, error: 'boom' },
]

const out = replayableActions('delegate_to_kg', { actions })
eq(out?.length, 2, 'failed calls must not be forwarded')
eq(out?.[0], { tool: 'create_graph', input: { graphId: 'llm-invented', title: 'X' }, graphId: 'server-assigned' },
  'the arguments used AND the id produced must both survive')
eq(out?.[1].nodeId, 'n1', 'nodeId must ride along so a later step can reference it')

// Non-delegations are untouched — this only exists for subagent calls.
eq(replayableActions('create_node', { actions }), null, 'a plain tool must not forward actions')
// Old shapes / nothing usable.
eq(replayableActions('delegate_to_kg', { graphId: 'g' }), null, 'a result without actions must forward nothing')
eq(replayableActions('delegate_to_kg', { actions: [{ tool: 'x', success: true }] }), null, 'an action with no input is not replayable')

// Size budget: an html-builder delegation can carry a whole page per call. Over budget the
// client must keep the delegate step rather than receive a truncated, unreplayable list.
const huge = Array.from({ length: 4 }, (_, i) => ({
  tool: 'edit_html_node', success: true, input: { html: 'x'.repeat(30 * 1024), nodeId: `n${i}` },
}))
eq(replayableActions('delegate_to_html_builder', { actions: huge }), null, 'an oversized payload must not be forwarded')

// The count cap holds for many small calls.
const many = Array.from({ length: 60 }, (_, i) => ({ tool: 'add_edge', success: true, input: { source: `a${i}`, target: `b${i}` } }))
eq(replayableActions('delegate_to_kg', { actions: many })?.length, 40, 'the count cap must apply')

console.log(fail.length ? `FAIL\n${fail.map((f) => '  - ' + f).join('\n')}` : 'PASS — only replayable, in-budget subagent calls are forwarded')
if (fail.length) process.exit(1)
