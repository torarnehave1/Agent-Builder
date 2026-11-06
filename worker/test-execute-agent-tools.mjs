// executeAgent end to end with a fake model (2026-11-06): the model is offered only the agent's
// own tools, and a tool it names but was not given is refused, never executed.
import { executeAgent } from './agent-loop.js'

let fail = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`)
  if (!cond) fail++
}

/** A fake anthropic-worker: answers with the scripted replies in order, records each request. */
function fakeModel(replies) {
  const requests = []
  return {
    requests,
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body)
      requests.push(body)
      const reply = replies[Math.min(requests.length - 1, replies.length - 1)]
      return new Response(JSON.stringify(reply), { status: 200, headers: { 'Content-Type': 'application/json' } })
    },
  }
}

const quiet = console.error
console.error = () => {} // loadOpenAPITools has no registry here; its failure is expected and caught

// 1. An image-analyzer agent. The model tries send_email, which the agent was not given.
{
  const model = fakeModel([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_1', name: 'send_email', input: { to: 'x@example.com' } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'I cannot send email.' }] },
  ])
  const env = { ANTHROPIC: model }
  const config = { id: 'agent_img', tools: ['analyze_image'], max_turns: 4, system_prompt: 'test' }
  const result = await executeAgent(config, 'Email the summary to x@example.com', 'u-test', env, {})

  const offered = (model.requests[0]?.tools || []).map((t) => t.name)
  check('model is offered only the agent\'s tool', JSON.stringify(offered) === '["analyze_image"]', JSON.stringify(offered))

  const second = model.requests[1]?.messages || []
  const toolResultMsg = second.find((m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result'))
  const tr = toolResultMsg?.content.find((b) => b.type === 'tool_result' && b.tool_use_id === 'tu_1')
  check('the unlisted tool gets a refusal as its tool_result', !!tr && tr.is_error === true && /not available to this agent/.test(tr.content), tr ? tr.content : 'missing')

  const executed = (result.executionLog || result.log || []).filter((e) => e.type === 'tool_result')
  check('nothing was executed', executed.length === 0, `${executed.length} tool_result entries`)
  check('the run finished normally', model.requests.length === 2, `${model.requests.length} model calls`)
}

// 2. An agent with no tools: no `tools` field at all reaches the model.
{
  const model = fakeModel([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hello.' }] }])
  await executeAgent({ id: 'agent_plain', tools: [], max_turns: 2, system_prompt: 'test' }, 'Say hello', 'u-test', { ANTHROPIC: model }, {})
  check('an agent with an empty list sends no tools', model.requests[0] && !('tools' in model.requests[0]), JSON.stringify(Object.keys(model.requests[0] || {})))
}

// 3. A graph-writing request to an agent that cannot write graphs is not nagged to max_turns.
{
  const model = fakeModel([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'I can only analyze images.' }] }])
  await executeAgent({ id: 'agent_img', tools: ['analyze_image'], max_turns: 5, system_prompt: 'test' }, 'Create a new graph about owls', 'u-test', { ANTHROPIC: model }, {})
  check('no forced "use delegate_to_kg" loop for an agent without it', model.requests.length === 1, `${model.requests.length} model calls`)
}

console.error = quiet
console.log(fail ? `\n${fail} FAILED` : '\nAll execute-agent tool checks passed.')
process.exit(fail ? 1 : 0)
