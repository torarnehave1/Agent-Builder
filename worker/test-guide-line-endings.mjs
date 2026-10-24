// A run that stops early still ends with the setup-guide line its tools returned: turn limit,
// provider error, unexpected stop and crash, on the Claude loop and the OpenAI/Grok loop. Drives the
// REAL streamingAgentLoop with a fake model that keeps calling set_world_brand (refused for want of a
// Superadmin, so it returns "Guide: 12 · …") and then ends the way each case needs.
//
// Run:  node worker/test-guide-line-endings.mjs   (exit 0 = pass, 1 = fail)
import { streamingAgentLoop } from './agent-loop.js'

let failures = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`ok    ${name}`)
  else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) }
}
const LINE = 'Guide: 12 · Editoren i World-ens uttrykk — https://www.vegvisr.org/gnew-viewer?graphId=b7f3a1d0-9c52-4e18-a6b4-3f5d8e2c7a91'
const stmt = { bind() { return stmt }, first: async () => null, all: async () => ({ results: [] }), run: async () => ({}) }
const INPUT = { domain: 'example.no', host: 'editor.example.no' }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status })

// Claude-shaped replies: turn 1 calls the tool, turn 2 is whatever `then` returns.
const claudeTool = (n) => json({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't' + n, name: 'set_world_brand', input: INPUT }], usage: { input_tokens: 1, output_tokens: 1 } })
const openaiTool = (n) => json({ choices: [{ message: { content: '', tool_calls: [{ id: 'c' + n, type: 'function', function: { name: 'set_world_brand', arguments: JSON.stringify(INPUT) } }] } }], usage: {} })

async function run({ model, then, maxTurns = 3 }) {
  let n = 0
  const fetchFake = async () => { n++; return n === 1 ? (model.startsWith('openai/') ? openaiTool(n) : claudeTool(n)) : then(n) }
  const env = { DB: { prepare: () => stmt, batch: async () => [] }, ANTHROPIC: { fetch: fetchFake }, OPENAI_WORKER: { fetch: fetchFake } }
  const out = []
  const writer = { write: (b) => out.push(new TextDecoder().decode(b)), close: () => {} }
  await streamingAgentLoop(writer, new TextEncoder(), [{ role: 'user', content: 'set the editor brand for example.no' }], 'sys', 'u1', env, { maxTurns, model })
  const events = out.join('').split('\n\n').filter(Boolean).map(e => {
    const type = (e.match(/^event: (\S+)/) || [])[1]
    let data = null; try { data = JSON.parse((e.match(/\ndata: (.*)$/s) || [])[1]) } catch {}
    return { type, data }
  })
  const text = events.filter(e => e.type === 'text').map(e => e.data?.content || '').join('')
  const toolRan = events.some(e => e.type === 'tool_result' && /Guide: 12/.test(e.data?.summary || e.data?.error || ''))
  const lastTextIdx = events.map(e => e.type).lastIndexOf('text')
  const closingIdx = events.findIndex((e, i) => i > lastTextIdx && (e.type === 'done' || e.type === 'error'))
  return { text, toolRan, events, lineCount: text.split(LINE).length - 1, beforeClose: lastTextIdx >= 0 && (closingIdx === -1 || closingIdx > lastTextIdx) }
}

const cases = [
  ['Claude, turn limit', { model: 'claude-sonnet-4-5', maxTurns: 1, then: (n) => claudeTool(n) }],
  ['Claude, provider error', { model: 'claude-sonnet-4-5', then: () => json({ error: 'overloaded' }, 529) }],
  ['Claude, unexpected stop', { model: 'claude-sonnet-4-5', then: () => json({ stop_reason: 'refusal', content: [], usage: {} }) }],
  ['Claude, crash', { model: 'claude-sonnet-4-5', then: () => { throw new Error('network gone') } }],
  ['OpenAI, turn limit', { model: 'openai/gpt-5.6-luna', maxTurns: 1, then: (n) => openaiTool(n) }],
  ['OpenAI, provider error', { model: 'openai/gpt-5.6-luna', then: () => json({ error: 'rate limited' }, 429) }],
  ['OpenAI, crash', { model: 'openai/gpt-5.6-luna', then: () => { throw new Error('network gone') } }],
]
for (const [name, opts] of cases) {
  const r = await run(opts)
  check(`${name}: the tool returned its guide`, r.toolRan, JSON.stringify(r.events.filter(e => e.type === 'tool_result')).slice(0, 300))
  check(`${name}: the reply ends with the guide line, once`, r.lineCount === 1 && r.text.trimEnd().endsWith(LINE), JSON.stringify(r.text.slice(-300)))
  check(`${name}: the line is written before the run closes`, r.beforeClose, r.events.map(e => e.type).join(','))
}

// The model already wrote the line in an EARLIER turn (here as a markdown link, its usual form),
// then the run stops early: no second copy.
const MD = 'Guide: [12 · Editoren i World-ens uttrykk](https://www.vegvisr.org/gnew-viewer?graphId=b7f3a1d0-9c52-4e18-a6b4-3f5d8e2c7a91)'
const claudeSaysAndCalls = (n) => json({ stop_reason: 'tool_use', content: [{ type: 'text', text: `Refused, retrying.\n${MD}` }, { type: 'tool_use', id: 't' + n, name: 'set_world_brand', input: INPUT }], usage: { input_tokens: 1, output_tokens: 1 } })
const openaiSaysAndCalls = (n) => json({ choices: [{ message: { content: `Refused, retrying.\n${MD}`, tool_calls: [{ id: 'c' + n, type: 'function', function: { name: 'set_world_brand', arguments: JSON.stringify(INPUT) } }] } }], usage: {} })
const earlier = [
  ['Claude, line written earlier, then turn limit', { model: 'claude-sonnet-4-5', maxTurns: 2, then: (n) => claudeSaysAndCalls(n) }],
  ['Claude, line written earlier, then provider error', { model: 'claude-sonnet-4-5', maxTurns: 4, then: (n) => n === 2 ? claudeSaysAndCalls(n) : json({ error: 'overloaded' }, 529) }],
  ['Claude, line written earlier, then crash', { model: 'claude-sonnet-4-5', maxTurns: 4, then: (n) => { if (n === 2) return claudeSaysAndCalls(n); throw new Error('network gone') } }],
  ['OpenAI, line written earlier, then turn limit', { model: 'openai/gpt-5.6-luna', maxTurns: 2, then: (n) => openaiSaysAndCalls(n) }],
  ['OpenAI, line written earlier, then crash', { model: 'openai/gpt-5.6-luna', maxTurns: 4, then: (n) => { if (n === 2) return openaiSaysAndCalls(n); throw new Error('network gone') } }],
]
for (const [name, opts] of earlier) {
  const r = await run(opts)
  check(`${name}: the model's line is in the reply`, r.text.includes(MD), JSON.stringify(r.text.slice(-300)))
  check(`${name}: no second copy appended`, !r.text.includes(LINE), JSON.stringify(r.text.slice(-300)))
}

// The normal ending is unchanged: a reply that already has the line gets no second copy.
{
  const r = await run({ model: 'claude-sonnet-4-5', then: () => json({ stop_reason: 'end_turn', content: [{ type: 'text', text: `Refused.\nGuide: [12 · Editoren i World-ens uttrykk](https://www.vegvisr.org/gnew-viewer?graphId=b7f3a1d0-9c52-4e18-a6b4-3f5d8e2c7a91)` }], usage: {} }) })
  check('normal ending with the line already written: nothing appended', !r.text.includes(LINE), JSON.stringify(r.text.slice(-300)))
}

console.log(failures ? `\n${failures} FAILED` : '\nPASS — every way a run ends keeps the guide line its tools returned.')
process.exit(failures ? 1 : 0)
