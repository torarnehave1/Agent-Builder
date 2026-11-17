// Which provider answers a chat on the OpenAI-format loop, and how it is asked (chat-providers.js),
// plus one full run of the REAL loop on a Gemini model and one on a Kimi model with fake providers.
//
// Run:  node worker/test-chat-providers.mjs   (exit 0 = pass, 1 = fail)
import { resolveChatProvider, isOpenAICompatibleModel } from './chat-providers.js'
import { streamingAgentLoop } from './agent-loop.js'

let failures = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`ok    ${name}`)
  else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) }
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status })

// ── routing by prefix ──
check('openai/, grok/, gemini/ and kimi/ ids are routed here',
  ['openai/gpt-5.6-luna', 'grok/grok-4.5', 'gemini/gemini-2.5-flash', 'kimi/kimi-k3.1-pro'].every(isOpenAICompatibleModel))
check('claude, @cf and auto ids are not',
  !['claude-sonnet-5-5', '@cf/meta/llama-4-scout-17b-16e-instruct', 'auto', '', null].some(isOpenAICompatibleModel))
check('an id without a known prefix has no provider', resolveChatProvider('claude-haiku-5-5', {}) === null)

// ── worker-backed providers: body and binding ──
for (const [model, binding, url, tokenField, tokens, bare] of [
  ['openai/gpt-5.6-luna', 'OPENAI_WORKER', 'https://openai.vegvisr.org/chat', 'max_completion_tokens', 4096, 'gpt-5.6-luna'],
  ['grok/grok-4.5', 'GROK_WORKER', 'https://grok.vegvisr.org/chat', 'max_tokens', 4096, 'grok-4.5'],
  ['gemini/gemini-2.5-pro', 'GEMINI_WORKER', 'https://gemini.vegvisr.org/chat', 'max_tokens', 8192, 'gemini-2.5-pro'],
]) {
  let seen = null
  const env = { [binding]: { fetch: async (u, init) => { seen = { u, body: JSON.parse(init.body) }; return json({ choices: [{ message: { content: 'hei' } }] }) } } }
  const p = resolveChatProvider(model, env)
  const r = await p.send({ userId: 'u1', messages: [{ role: 'user', content: 'x' }], tools: [{ type: 'function' }], temperature: 0.3 })
  check(`${model}: goes to ${binding}`, p.configured && seen?.u === url, JSON.stringify(seen))
  check(`${model}: sends the bare model id, userId, tools and ${tokenField} ${tokens}`,
    seen.body.model === bare && seen.body.userId === 'u1' && seen.body.tools.length === 1 && seen.body.tool_choice === 'auto' && seen.body[tokenField] === tokens,
    JSON.stringify(seen.body))
  check(`${model}: returns ok + data`, r.ok === true && r.data.choices[0].message.content === 'hei')
  const unbound = resolveChatProvider(model, {})
  check(`${model}: a missing binding is named`, unbound.configured === false && unbound.missing.includes(binding), unbound.missing)
}

// ── Kimi: Cloudflare model catalog through env.AI.run ──
{
  let seen = null
  const env = { AI: { run: async (id, input, opts) => { seen = { id, input, opts }; return { choices: [{ message: { content: 'hei' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2 } } } } }
  const p = resolveChatProvider('kimi/kimi-k3.1-pro', env)
  const r = await p.send({ userId: 'u1', messages: [{ role: 'user', content: 'x' }], tools: [{ type: 'function' }], temperature: 0.3 })
  check('kimi: runs moonshotai/kimi-k3.1-pro through the default gateway', seen?.id === 'moonshotai/kimi-k3.1-pro' && seen.opts?.gateway?.id === 'default', JSON.stringify(seen))
  check('kimi: sends only the model\'s own fields (no userId, no model)', !('userId' in seen.input) && !('model' in seen.input) && seen.input.max_tokens === 8192 && seen.input.tool_choice === 'auto', JSON.stringify(Object.keys(seen.input)))
  check('kimi: sends no temperature (K3.1 Pro allows only 1)', !('temperature' in seen.input), JSON.stringify(seen.input))
  check('kimi: returns ok + data and asks for its reasoning back', r.ok === true && p.keepReasoning === true)
  const named = resolveChatProvider('kimi/kimi-k3.1-pro', { ...env, AI_GATEWAY_ID: 'vegr' })
  await named.send({ messages: [], tools: [], temperature: 0.3 })
  check('kimi: AI_GATEWAY_ID picks another gateway', seen.opts.gateway.id === 'vegr')
  const thrown = await resolveChatProvider('kimi/kimi-k3.1-pro', { AI: { run: async () => { throw new Error('insufficient credits') } } }).send({ messages: [], tools: [], temperature: 0.3 })
  check('kimi: a thrown run becomes a readable provider error', thrown.ok === false && /insufficient credits/.test(thrown.data.error) && /moonshotai\/kimi-k3\.1-pro/.test(thrown.data.error), JSON.stringify(thrown))
  const odd = await resolveChatProvider('kimi/kimi-k3.1-pro', { AI: { run: async () => ({ response: 'text only' }) } }).send({ messages: [], tools: [], temperature: 0.3 })
  check('kimi: an answer that is not chat-completion format is refused, not read as empty', odd.ok === false && /unexpected format/.test(odd.data.error))
  check('kimi: a missing AI binding is named', resolveChatProvider('kimi/kimi-k3.1-pro', {}).configured === false)
}

// ── the real loop, one tool step then an answer ──
const stmt = { bind() { return stmt }, first: async () => null, all: async () => ({ results: [] }), run: async () => ({}) }
async function runLoop(model, env) {
  const out = []
  const writer = { write: (b) => out.push(new TextDecoder().decode(b)), close: () => {} }
  await streamingAgentLoop(writer, new TextEncoder(), [{ role: 'user', content: 'list my graphs' }], 'sys', 'u1',
    { DB: { prepare: () => stmt, batch: async () => [] }, ...env }, { maxTurns: 3, model })
  return out.join('').split('\n\n').filter(Boolean).map((e) => {
    const type = (e.match(/^event: (\S+)/) || [])[1]
    let data = null; try { data = JSON.parse((e.match(/\ndata: (.*)$/s) || [])[1]) } catch {}
    return { type, data }
  })
}
const toolTurn = (extra = {}) => ({ choices: [{ message: { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_meta_areas', arguments: '{}' }, ...extra.call }], ...extra.message }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 2 } })
const answer = { choices: [{ message: { content: 'Ferdig.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2 } }

{
  const bodies = []
  const SIG = { google: { thought_signature: 'sig-A' } }
  const env = { GEMINI_WORKER: { fetch: async (_u, init) => { bodies.push(JSON.parse(init.body)); return json(bodies.length === 1 ? toolTurn({ call: { extra_content: SIG } }) : answer) } } }
  const events = await runLoop('gemini/gemini-2.5-flash', env)
  check('gemini loop: the tool ran and the answer came', events.some((e) => e.type === 'tool_result') && events.some((e) => e.type === 'text' && e.data?.content === 'Ferdig.'), events.map((e) => e.type).join(','))
  const back = bodies[1]?.messages?.find((m) => m.role === 'assistant' && m.tool_calls)
  check('gemini loop: the thought signature on the tool call is sent back unchanged', back?.tool_calls?.[0]?.extra_content?.google?.thought_signature === 'sig-A', JSON.stringify(back))
  check('gemini loop: the tool result follows with the call id', bodies[1]?.messages?.some((m) => m.role === 'tool' && m.tool_call_id === 'c1'))
}
{
  const inputs = []
  const env = { AI: { run: async (_id, input) => { inputs.push(JSON.parse(JSON.stringify(input))); return inputs.length === 1 ? toolTurn({ message: { reasoning_content: 'tenker' } }) : answer } } }
  const events = await runLoop('kimi/kimi-k3.1-pro', env)
  check('kimi loop: the tool ran and the answer came', events.some((e) => e.type === 'tool_result') && events.some((e) => e.type === 'text' && e.data?.content === 'Ferdig.'), events.map((e) => e.type).join(','))
  const back = inputs[1]?.messages?.find((m) => m.role === 'assistant' && m.tool_calls)
  check('kimi loop: reasoning_content goes back with the tool calls', back?.reasoning_content === 'tenker', JSON.stringify(back))
}
{
  const events = await runLoop('kimi/kimi-k3.1-pro', { AI: { run: async () => { throw new Error('insufficient credits') } } })
  const text = events.filter((e) => e.type === 'text').map((e) => e.data?.content || '').join('')
  check('kimi loop: a provider error is shown to the user with its reason', /Kimi provider returned an error/.test(text) && /insufficient credits/.test(text), text)
}
{
  const events = await runLoop('gemini/gemini-2.5-flash', {})
  check('gemini loop: a missing binding ends the run with its name', events.some((e) => e.type === 'error' && /GEMINI_WORKER/.test(e.data?.error || '')), JSON.stringify(events.slice(-2)))
}

if (failures) { console.error(`\n${failures} failed`); process.exit(1) }
console.log('\nall passed')
