// The /converse loop for the models that are not Claude: GPT, Grok, Gemini, Kimi (2026-11-24).
//
// Claude gets the MCP tools through the API's own MCP connector (converse.js). These providers
// have no such thing, so this file does the same job by hand, on the same principles:
//   tools    the MCP server's tools are handed to the model as real function tools with their
//            schemas. Not all 144 at once (OpenAI takes at most 128): `search_tools` finds them,
//            and a tool stays loaded for the rest of the conversation once found or used.
//   history  the same server-side transcript as Claude's, replayed whole. A tool result is never
//            shortened behind the model's back; one over the size limit says so in its own text.
//   switch   a conversation can change model family: each turn is stored in the shape its model
//            produced and translated when the other family reads it.
import { resolveChatProvider } from './chat-providers.js'
import { sanitizeOpenAIJsonSchema, parseOpenAIToolArgs } from './agent-loop.js'

const MCP_URL = 'https://knowledge.vegvisr.org/mcp'
const MAX_ROUNDS = 20
const MAX_LOADED = 100
const MAX_RESULT_CHARS = 60000
const SEARCH_HITS = 8

const SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'search_tools',
    description:
      'Find tools of the VEGR.AI MCP server by what they do (e-mail, SMS, knowledge graphs, contacts, calendar, chat groups, images, video, Realtime meeting rooms). Returns the best matches with a one-line description; those tools can then be called directly, with their full input schema. Search before saying something cannot be done.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'What the tool should do, in a few words.' } }, required: ['query'] },
  },
}

function parseRpc(text) {
  const t = text.trimStart()
  const body = t.startsWith('{') ? t : t.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('')
  return JSON.parse(body)
}
// Through the KG_WORKER binding: a plain fetch to the same zone is answered 522.
export async function mcp(env, token, method, params) {
  const fetcher = env.KG_WORKER?.fetch ? env.KG_WORKER.fetch.bind(env.KG_WORKER) : fetch
  const res = await fetcher(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || {} }),
    signal: AbortSignal.timeout(60000),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`MCP ${method} failed (${res.status}): ${text.slice(0, 300)}`)
  const json = parseRpc(text)
  if (json.error) throw new Error(`MCP ${method} error: ${json.error.message || JSON.stringify(json.error)}`)
  return json.result
}

const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9æøå]+/).filter((w) => w.length > 1)
function rank(tools, query) {
  const q = words(query)
  return tools
    .map((t) => {
      const name = words(t.name)
      const desc = words(t.description)
      let score = 0
      for (const w of q) {
        if (name.includes(w)) score += 5
        else if (name.some((n) => n.startsWith(w) || w.startsWith(n))) score += 3
        if (desc.includes(w)) score += 1
      }
      return { t, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, SEARCH_HITS)
    .map((x) => x.t)
}
const firstSentence = (d) => {
  const s = String(d || '').split(/(?<=[.!?])\s/)[0]
  return s.length > 200 ? s.slice(0, 197) + '…' : s
}

const textOfBlocks = (content) =>
  typeof content === 'string'
    ? content
    : (Array.isArray(content) ? content : []).filter((b) => b && b.type === 'text').map((b) => b.text).join('\n')
export const resultText = (content) =>
  typeof content === 'string' ? content : (Array.isArray(content) ? content : []).map((c) => (c && typeof c.text === 'string' ? c.text : '')).filter(Boolean).join('\n\n')

/** True for a turn this file wrote. */
export const isCompatTurn = (turn) => !!turn && turn.content && typeof turn.content === 'object' && !Array.isArray(turn.content) && turn.content.fmt === 'openai'

/** Stored turns, as the messages an OpenAI-compatible model reads. */
export function toCompatMessages(turns, { images }) {
  const out = []
  for (const turn of turns) {
    if (isCompatTurn(turn)) {
      out.push(turn.content.msg)
    } else if (turn.role === 'user') {
      if (typeof turn.content === 'string') out.push({ role: 'user', content: turn.content })
      else {
        const parts = []
        for (const b of turn.content || []) {
          if (b.type === 'text') parts.push({ type: 'text', text: b.text })
          else if (b.type === 'image' && b.source?.type === 'url' && images) parts.push({ type: 'image_url', image_url: { url: b.source.url } })
          else if (b.type === 'document') parts.push({ type: 'text', text: '[A PDF was attached here. This model cannot read PDF files; say so if the answer depends on it.]' })
          else if (b.type === 'tool_result') parts.push({ type: 'text', text: `[Result of a tool call${b.is_error ? ' — FAILED' : ''}]\n${resultText(b.content)}` })
        }
        out.push({ role: 'user', content: parts.every((p) => p.type === 'text') ? parts.map((p) => p.text).join('\n\n') : parts })
      }
    } else {
      // A turn Claude made: its text, and what its tools returned, written out in full.
      const lines = []
      const names = new Map()
      for (const b of Array.isArray(turn.content) ? turn.content : []) {
        if (b.type === 'text' && b.text) lines.push(b.text)
        else if (b.type === 'mcp_tool_use' || b.type === 'tool_use') {
          names.set(b.id, b.name)
          lines.push(`[Tool call: ${b.name}(${JSON.stringify(b.input || {})})]`)
        } else if (b.type === 'mcp_tool_result') lines.push(`[Result of ${names.get(b.tool_use_id) || 'tool'}${b.is_error ? ' — FAILED' : ''}]\n${resultText(b.content)}`)
      }
      if (lines.length) out.push({ role: 'assistant', content: lines.join('\n\n') })
    }
  }
  return out
}

/** Stored turns, as the messages Claude reads: this file's turns become text, in full. */
export function toClaudeMessages(turns) {
  const out = []
  const callNames = new Map()
  for (const turn of turns) {
    if (!isCompatTurn(turn)) {
      out.push({ role: turn.role, content: turn.content })
      continue
    }
    const m = turn.content.msg
    const lines = []
    if (m.role === 'assistant') {
      if (typeof m.content === 'string' && m.content.trim()) lines.push(m.content.trim())
      for (const c of m.tool_calls || []) {
        callNames.set(c.id, c.function?.name)
        lines.push(`[Tool call: ${c.function?.name}(${c.function?.arguments || '{}'})]`)
      }
    } else if (m.role === 'tool') {
      lines.push(`[Result of ${callNames.get(m.tool_call_id) || 'tool'}]\n${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
    }
    if (lines.length) out.push({ role: 'assistant', content: lines.join('\n\n').trimEnd() })
  }
  return out
}

/** Tool names this conversation has already found or used: they stay loaded. */
function loadedNames(turns) {
  const names = []
  const add = (n) => { if (n && n !== 'search_tools' && !names.includes(n)) names.push(n) }
  for (const turn of turns) {
    if (isCompatTurn(turn)) {
      const m = turn.content.msg
      for (const c of m.tool_calls || []) add(c.function?.name)
      for (const n of turn.content.found || []) add(n)
    } else if (turn.role === 'assistant' && Array.isArray(turn.content)) {
      for (const b of turn.content) if (b.type === 'mcp_tool_use' || b.type === 'tool_use') add(String(b.name || '').replace(/^vegr_/, ''))
    }
  }
  return names
}

export async function runCompat({ env, auth, token, model, turns, save, send, system }) {
  const provider = resolveChatProvider(model, env)
  if (!provider) throw new Error(`Unknown model "${model}".`)
  if (!provider.configured) throw new Error(provider.missing)
  send('model_choice', { model })

  const listed = await mcp(env, token, 'tools/list', {})
  const catalog = Array.isArray(listed?.tools) ? listed.tools : []
  const byName = new Map(catalog.map((t) => [t.name, t]))
  const loaded = loadedNames(turns).filter((n) => byName.has(n)).slice(-MAX_LOADED)
  const toolDefs = () => [
    SEARCH_TOOL,
    ...loaded.map((n) => {
      const t = byName.get(n)
      return { type: 'function', function: { name: t.name, description: t.description || t.name, parameters: sanitizeOpenAIJsonSchema(t.inputSchema || { type: 'object', properties: {} }) } }
    }),
  ]

  const messages = [{ role: 'system', content: system }, ...toCompatMessages(turns, { images: provider.name === 'openai' })]
  const usage = { input: 0, output: 0 }
  const keep = async (msg, extra) => {
    messages.push(msg)
    await save({ role: msg.role, content: { fmt: 'openai', msg, ...(extra || {}) } })
  }

  let said = false
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const { ok, status, data } = await provider.send({ userId: auth.userId, messages, tools: toolDefs() })
    if (data?.usage) {
      usage.input += data.usage.prompt_tokens || data.usage.input_tokens || 0
      usage.output += data.usage.completion_tokens || data.usage.output_tokens || 0
    }
    if (!ok) {
      const detail = typeof data?.error === 'string' ? data.error : JSON.stringify(data?.error || data || {})
      throw new Error(`${provider.label} answered an error${status ? ` (HTTP ${status})` : ''}: ${detail.slice(0, 600)}`)
    }
    const message = data.choices?.[0]?.message || {}
    const text = typeof message.content === 'string' ? message.content : ''
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : []
    if (text.trim()) {
      send('delta', { text: (said ? '\n\n' : '') + text.trim() })
      said = true
    }
    await keep({
      role: 'assistant',
      content: text || null,
      ...(calls.length ? { tool_calls: calls } : {}),
      ...(provider.keepReasoning && calls.length && typeof message.reasoning_content === 'string' && message.reasoning_content
        ? { reasoning_content: message.reasoning_content } : {}),
    })
    if (!calls.length) return { usage, stopReason: 'end_turn' }

    for (const call of calls) {
      const name = call.function?.name
      const input = parseOpenAIToolArgs(call.function?.arguments)
      send('tool_call', { callId: call.id, tool: name === 'search_tools' ? 'tool_search' : name, input })
      let content
      let found
      let success = true
      try {
        if (name === 'search_tools') {
          const hits = rank(catalog, input?.query)
          found = hits.map((t) => t.name)
          for (const n of found) {
            if (!loaded.includes(n)) loaded.push(n)
          }
          while (loaded.length > MAX_LOADED) loaded.shift()
          content = hits.length
            ? JSON.stringify({ tools: hits.map((t) => ({ name: t.name, description: firstSentence(t.description) })), note: 'These tools are now available to call directly.' })
            : JSON.stringify({ tools: [], note: `Nothing matched "${input?.query || ''}". Try other words. The server has ${catalog.length} tools.` })
          send('tool_result', { callId: call.id, tool: 'tool_search', success: true, summary: found.join(', ') })
        } else if (!byName.has(name)) {
          success = false
          content = JSON.stringify({ error: `No tool "${name}" on the VEGR.AI MCP server. Use search_tools to find the right one.` })
          send('tool_result', { callId: call.id, tool: name, success: false, summary: `No tool "${name}"` })
        } else {
          const r = await mcp(env, token, 'tools/call', { name, arguments: input && typeof input === 'object' ? input : {} })
          let out = resultText(r?.content) || (r?.structuredContent ? JSON.stringify(r.structuredContent) : '')
          success = !r?.isError
          // Never shortened silently: over the limit, the text says what is missing and how to get it.
          if (out.length > MAX_RESULT_CHARS) {
            out = out.slice(0, MAX_RESULT_CHARS) + `\n\n[THE RESULT WAS CUT HERE: ${out.length - MAX_RESULT_CHARS} more characters were not delivered. Do not guess what they contain. Call the tool again with a narrower request (a filter, a limit, one id).]`
          }
          content = out || '(the tool returned no text)'
          const first = content.split('\n')[0]
          send('tool_result', { callId: call.id, tool: name, success, summary: first.length > 240 ? first.slice(0, 240) + '…' : first })
        }
      } catch (err) {
        success = false
        content = JSON.stringify({ error: err?.message || String(err) })
        send('tool_result', { callId: call.id, tool: name, success: false, summary: err?.message || String(err) })
      }
      await keep({ role: 'tool', tool_call_id: call.id, content }, found ? { found } : null)
    }
  }
  return { usage, stopReason: 'pause_turn' }
}
