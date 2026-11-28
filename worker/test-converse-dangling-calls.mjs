// A turn cut off at max_tokens while the model was writing an MCP call: the stored assistant
// turn holds an answered create_graph call and an unanswered add_nodes call. Sent back as it is,
// the API refuses the conversation (HTTP 400, seen 2026-11-28).
import assert from 'node:assert/strict'
import { closeDanglingCalls } from './converse-messages.js'

const cut = {
  role: 'assistant',
  content: [
    { type: 'thinking', thinking: 'plan', signature: 'sig' },
    { type: 'mcp_tool_use', id: 'mcptoolu_A', name: 'create_graph', server_name: 'vegr', input: {} },
    { type: 'mcp_tool_result', tool_use_id: 'mcptoolu_A', is_error: false, content: [{ type: 'text', text: 'ok' }] },
    { type: 'server_tool_use', id: 'srvtoolu_S', name: 'tool_search_tool_regex', input: { pattern: 'x' } },
    { type: 'tool_search_tool_result', tool_use_id: 'srvtoolu_S', content: { type: 'tool_search_tool_search_result', tool_references: [] } },
    { type: 'mcp_tool_use', id: 'mcptoolu_B', name: 'add_nodes', server_name: 'vegr', input: {} },
  ],
}
const out = closeDanglingCalls([{ role: 'user', content: 'lag grafen' }, cut, { role: 'user', content: 'continue' }])

assert.equal(out.length, 3, 'no message added or removed')
const a = out[1].content
assert.ok(!a.some((b) => b.id === 'mcptoolu_B'), 'unanswered add_nodes call dropped')
assert.ok(a.some((b) => b.id === 'mcptoolu_A'), 'answered create_graph call kept')
assert.ok(a.some((b) => b.tool_use_id === 'mcptoolu_A'), 'its result kept')
assert.ok(a.some((b) => b.id === 'srvtoolu_S') && a.some((b) => b.tool_use_id === 'srvtoolu_S'), 'answered tool search kept')
assert.equal(a[0].type, 'thinking', 'thinking block stays first')
assert.match(a[a.length - 1].text, /add_nodes/, 'a note names the call that was not run')
// Every server call left has its result in the same turn.
const ids = new Set(a.filter((b) => b.tool_use_id).map((b) => b.tool_use_id))
for (const b of a) if (b.type === 'mcp_tool_use' || b.type === 'server_tool_use') assert.ok(ids.has(b.id), `${b.id} answered`)

// A turn with nothing dangling is returned as the same object.
const clean = { role: 'assistant', content: cut.content.slice(0, 5) }
assert.equal(closeDanglingCalls([clean])[0], clean)

// Client tool_use calls are still closed with an error result, as before.
const direct = closeDanglingCalls([{ role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_D', name: 'read_graph', input: {} }] }])
assert.equal(direct.length, 2)
assert.equal(direct[1].content[0].tool_use_id, 'toolu_D')

// Session e1d1a4a4 (2026-11-28): the model called graph_index (MCP) and read_graph (this worker's
// own tool) in one response. The API paused for read_graph and delivered graph_index's result in
// the next assistant turn. The call must be kept: dropping it left the result orphaned and the API
// refused the conversation ("unexpected tool_use_id found in mcp_tool_result blocks", HTTP 400).
const split = [
  { role: 'user', content: 'se på SODESIGN' },
  { role: 'assistant', content: [
    { type: 'thinking', thinking: 'p', signature: 's' },
    { type: 'mcp_tool_use', id: 'mcptoolu_G', name: 'graph_index', server_name: 'vegr', input: {} },
    { type: 'tool_use', id: 'toolu_R1', name: 'read_graph', input: {} },
  ] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_R1', content: 'graph' }] },
  { role: 'assistant', content: [
    { type: 'mcp_tool_result', tool_use_id: 'mcptoolu_G', is_error: true, content: [{ type: 'text', text: 'INVALID_INPUT' }] },
    { type: 'mcp_tool_use', id: 'mcptoolu_H', name: 'graph_index', server_name: 'vegr', input: {} },
    { type: 'tool_use', id: 'toolu_R2', name: 'read_graph', input: {} },
  ] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_R2', content: 'graph' }] },
  { role: 'assistant', content: [
    { type: 'mcp_tool_result', tool_use_id: 'mcptoolu_H', is_error: false, content: [{ type: 'text', text: 'ok' }] },
    { type: 'text', text: 'svar' },
  ] },
  { role: 'user', content: 'A' },
]
const fixed = closeDanglingCalls(split)
assert.equal(fixed.length, split.length, 'no message added or removed')
for (let i = 0; i < split.length; i++) assert.equal(fixed[i], split[i], `turn ${i} left as it was`)

// A result whose call is gone (an older, already-damaged transcript) is dropped, not sent.
const orphan = closeDanglingCalls([
  { role: 'user', content: 'x' },
  { role: 'assistant', content: [{ type: 'mcp_tool_result', tool_use_id: 'mcptoolu_X', content: [] }, { type: 'text', text: 'ok' }] },
])
assert.deepEqual(orphan[1].content, [{ type: 'text', text: 'ok' }], 'orphaned result dropped')

console.log('test-converse-dangling-calls: ok')

// save_message_text picks the person's own words from the transcript, never a tool result.
import { pickMessageText } from './converse-messages.js'
const talk = [
  { role: 'user', content: 'Lag en graf fra denne:\n\n[0:00 – 2:00] happening. So you could say\n[2:00 – 4:00] the end. Transcribed by https://otter.ai' },
  { role: 'assistant', content: [{ type: 'text', text: 'Svar A, B eller C' }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: '[0:00 – 2:00] fake' }] },
  { role: 'user', content: [{ type: 'text', text: 'B' }] },
]
assert.equal(pickMessageText(talk, { contains: '[0:00 – 2:00]', from: '[0:00 – 2:00]' }).text, '[0:00 – 2:00] happening. So you could say\n[2:00 – 4:00] the end. Transcribed by https://otter.ai')
assert.equal(pickMessageText(talk, { contains: 'happening', from: '[2:00', to: 'the end.' }).text, '[2:00 – 4:00] the end.')
assert.equal(pickMessageText(talk, { contains: 'B' }).text, 'B', 'newest matching message wins')
assert.match(pickMessageText(talk, { contains: 'nowhere' }).error, /No message/)
assert.match(pickMessageText(talk, { contains: 'happening', from: 'zzz' }).error, /no "zzz"/)
assert.match(pickMessageText(talk, { contains: 'happening', from: '[2:00', to: 'happening' }).error, /after the start/)
console.log('test-converse-dangling-calls: save_message_text ok')
