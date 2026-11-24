// POST /converse — the conversation loop built the way Claude's own tools are (2026-11-24).
//
// What differs from /chat (agent-loop.js), each a cause of a wrong or wasteful answer there:
//   tools    the VEGR.AI MCP server is connected by the API itself (MCP connector), so the model
//            gets every tool natively with its schema — no mcp_call proxy, no list-then-describe.
//            Tool search loads only the schemas a turn needs, and they stay loaded.
//   history  the whole conversation — tool calls, tool results and thinking included — is kept
//            here on the server and replayed unchanged on every turn. Nothing is cut to 400
//            characters, and the browser sends only the new message.
//   model    one model with adaptive thinking for the whole conversation; no per-message routing.
//   cost     prompt caching: what was sent before is read back at about a tenth of the price.
//
// The model acts as the signed-in person: their login token is the MCP server's bearer token.
// NOTE: that token is passed to Anthropic, which makes the MCP connection on our behalf.
import Anthropic from '@anthropic-ai/sdk'
import { resolveAuthorizedCaller, resolveAuthorizedCallerWithCredentials } from './auth.js'

const MCP_URL = 'https://knowledge.vegvisr.org/mcp'
const MCP_NAME = 'vegr'
const CHAT_HISTORY_API = 'https://api.vegvisr.org/chat-history'
const MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'])
export const CONVERSE_DEFAULT_MODEL = 'claude-opus-5-5'
const MAX_TOKENS = 32000
const MAX_RESUMES = 6 // pause_turn: the API's own tool loop stops after 10 steps and is resumed
const MAX_ROW_BYTES = 1_500_000 // a D1 value holds 2 MB

const SYSTEM = `You are the VEGR.AI assistant. You work for the signed-in person through the tools of the VEGR.AI MCP server ("${MCP_NAME}"), which act as that person: their knowledge graphs, e-mail, SMS, chat groups, contacts, calendar, images, video and Realtime meeting rooms.

How to work:
- Find tools with the tool search. Their schemas arrive with them, so call a tool directly once it is loaded.
- Answer from tool results that are in this conversation. When a fact is not there, call the tool again; never fill in from memory or from what seems likely. If a tool result does not contain what was asked for, say so.
- Names, addresses, links, dates and numbers in your answer are copied from the tool result, not retyped from recollection.
- Before anything that sends, publishes, deletes or changes something (an e-mail, an SMS, a post, a graph, a calendar event, a member list), say exactly what will happen and wait for the person's yes in a new message. Use the preview tool first where one exists. Reading needs no permission.
- Report a tool's error in its own words.
- Write to the person in the language they write in. Be brief: the answer first, then what it rests on.`

let tableReady = false
async function ensureTable(db) {
  if (tableReady) return
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS converse_turns (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       session_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL,
       iv TEXT NOT NULL, ciphertext TEXT NOT NULL,
       created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  ).run()
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_converse_turns_session ON converse_turns (session_id, id)').run()
  tableReady = true
}

// Turns hold what tools returned (e-mail bodies, contacts), so they are encrypted at rest with a
// key derived for this purpose only from the worker's own secret.
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
function b64big(buf) {
  const bytes = new Uint8Array(buf)
  let out = ''
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(out)
}
async function turnKey(env) {
  if (!env.INTERNAL_SHARED_SECRET) throw new Error('INTERNAL_SHARED_SECRET is not configured.')
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.INTERNAL_SHARED_SECRET), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode('converse-transcript-v1') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
}
async function seal(key, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)))
  return { iv: b64(iv), ciphertext: b64big(data) }
}
async function unseal(key, row) {
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(row.iv) }, key, unb64(row.ciphertext))
  return JSON.parse(new TextDecoder().decode(data))
}

async function loadTurns(env, key, sessionId, userId) {
  const { results } = await env.DB.prepare(
    'SELECT role, iv, ciphertext FROM converse_turns WHERE session_id = ? AND user_id = ? ORDER BY id',
  ).bind(sessionId, userId).all()
  const out = []
  for (const r of results || []) out.push({ role: r.role, content: await unseal(key, r) })
  return out
}
async function saveTurn(env, key, sessionId, userId, turn) {
  const s = await seal(key, turn.content)
  if (s.ciphertext.length > MAX_ROW_BYTES) throw new Error('This turn is too large to keep (over 1.5 MB). Attach a smaller file.')
  await env.DB.prepare('INSERT INTO converse_turns (session_id, user_id, role, iv, ciphertext) VALUES (?, ?, ?, ?, ?)')
    .bind(sessionId, userId, turn.role, s.iv, s.ciphertext).run()
}

// A conversation begun in the old chat has only its text in chat-history: it becomes the start
// of the transcript, so the person can go on where they were.
async function seedFromChatHistory(env, token, sessionId) {
  try {
    const res = await env.API_WORKER.fetch(new Request(
      `${CHAT_HISTORY_API}/messages?sessionId=${encodeURIComponent(sessionId)}&decrypt=1&limit=200`,
      { headers: { 'X-API-Token': token, 'Content-Type': 'application/json' } },
    ))
    if (!res.ok) return []
    const data = await res.json().catch(() => ({}))
    return (Array.isArray(data?.messages) ? data.messages : [])
      .slice().reverse()
      .filter((m) => typeof m.content === 'string' && m.content.trim())
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
  } catch {
    return []
  }
}

const textOf = (content) =>
  typeof content === 'string'
    ? content
    : (Array.isArray(content) ? content : []).filter((b) => b && b.type === 'text').map((b) => b.text).join('\n')

export async function handleConverse(request, env, ctx, corsHeaders) {
  const json = (body, status) => new Response(JSON.stringify(body), { status, headers: corsHeaders })
  const body = await request.json().catch(() => ({}))
  const { sessionId, message, model: askedModel, authToken, seeded } = body
  const auth = authToken
    ? await resolveAuthorizedCallerWithCredentials({ authToken }, env)
    : await resolveAuthorizedCaller(request, env)
  if (!auth?.authenticated || !auth.userId) return json({ error: 'Unauthorized — sign in, or send authToken (your emailVerificationToken).' }, 401)
  // The MCP server takes the person's own login token; a cookie session carries none.
  const token = typeof authToken === 'string' && authToken.trim() ? authToken.trim() : (auth.profile?.emailVerificationToken || '')
  if (!token) return json({ error: 'A login token is needed to reach the VEGR.AI MCP server — send authToken.' }, 401)
  if (!sessionId || typeof sessionId !== 'string') return json({ error: 'sessionId is required' }, 400)
  const userContent = typeof message === 'string' ? message.trim() : Array.isArray(message) ? message : null
  if (!userContent || (Array.isArray(userContent) && !userContent.length)) return json({ error: 'message is required' }, 400)
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY is not configured.' }, 500)
  const model = MODELS.has(askedModel) ? askedModel : CONVERSE_DEFAULT_MODEL

  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const enc = new TextEncoder()
  const send = (event, data) => writer.write(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)).catch(() => {})

  ctx.waitUntil((async () => {
    const started = Date.now()
    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    try {
      await ensureTable(env.DB)
      const key = await turnKey(env)
      let history = await loadTurns(env, key, sessionId, auth.userId)
      if (!history.length && seeded !== false) {
        // The browser saved this very message to chat-history before calling: leave it out.
        let old = await seedFromChatHistory(env, token, sessionId)
        const last = old[old.length - 1]
        if (last && last.role === 'user' && last.content.trim() === textOf(userContent).trim()) old = old.slice(0, -1)
        while (old.length && old[0].role !== 'user') old.shift()
        for (const t of old) await saveTurn(env, key, sessionId, auth.userId, t)
        history = old
      }
      const userTurn = { role: 'user', content: userContent }
      await saveTurn(env, key, sessionId, auth.userId, userTurn)
      const messages = [...history, userTurn]

      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
      const today = new Date().toISOString().slice(0, 10)
      let stopReason = null
      for (let round = 0; round <= MAX_RESUMES; round++) {
        const stream = client.beta.messages.stream({
          model,
          max_tokens: MAX_TOKENS,
          betas: ['mcp-client-2025-11-20'],
          thinking: { type: 'adaptive', display: 'summarized' },
          output_config: { effort: 'medium' },
          cache_control: { type: 'ephemeral' },
          system: [
            { type: 'text', text: SYSTEM },
            { type: 'text', text: `Today is ${today} (UTC). The signed-in person is ${auth.email || auth.userId}.` },
          ],
          mcp_servers: [{ type: 'url', url: MCP_URL, name: MCP_NAME, authorization_token: token }],
          tools: [
            { type: 'tool_search_tool_bm25_20251119', name: 'tool_search_tool_bm25' },
            { type: 'mcp_toolset', mcp_server_name: MCP_NAME, default_config: { defer_loading: true } },
          ],
          messages,
        })

        // Blocks by index: a tool call is announced when its input is complete.
        const open = new Map()
        const names = new Map()
        for await (const ev of stream) {
          if (ev.type === 'message_start') {
            send('model_choice', { model: ev.message?.model || model })
          } else if (ev.type === 'content_block_start') {
            const b = ev.content_block
            if (b.type === 'thinking') send('thinking', {})
            else if (b.type === 'mcp_tool_use' || b.type === 'server_tool_use') {
              open.set(ev.index, { id: b.id, name: b.name, json: '', input: b.input })
              names.set(b.id, b.name)
            } else if (b.type === 'mcp_tool_result') {
              const text = textOf(b.content)
              send('tool_result', {
                callId: b.tool_use_id, tool: names.get(b.tool_use_id) || 'tool', success: !b.is_error,
                summary: text.length > 240 ? text.slice(0, 240) + '…' : text,
              })
            } else if (b.type === 'tool_search_tool_result') {
              const refs = Array.isArray(b.content?.tool_references) ? b.content.tool_references.map((r) => r.tool_name).filter(Boolean) : []
              send('tool_result', {
                callId: b.tool_use_id, tool: 'tool_search', success: b.content?.type !== 'tool_search_tool_result_error',
                summary: refs.length ? refs.join(', ') : (b.content?.error_code || ''),
              })
            }
          } else if (ev.type === 'content_block_delta') {
            const d = ev.delta
            if (d.type === 'text_delta') send('delta', { text: d.text })
            else if (d.type === 'thinking_delta') send('thinking_delta', { text: d.thinking })
            else if (d.type === 'input_json_delta') {
              const o = open.get(ev.index)
              if (o) o.json += d.partial_json
            }
          } else if (ev.type === 'content_block_stop') {
            const o = open.get(ev.index)
            if (o) {
              let input = o.input || {}
              try { if (o.json) input = JSON.parse(o.json) } catch { /* shown without its input */ }
              send('tool_call', { callId: o.id, tool: o.name === 'tool_search_tool_bm25' ? 'tool_search' : o.name, input })
              open.delete(ev.index)
            }
          }
        }
        const final = await stream.finalMessage()
        usage.input += final.usage?.input_tokens || 0
        usage.output += final.usage?.output_tokens || 0
        usage.cacheRead += final.usage?.cache_read_input_tokens || 0
        usage.cacheWrite += final.usage?.cache_creation_input_tokens || 0
        stopReason = final.stop_reason
        // The whole content goes back unchanged on the next request: thinking blocks, tool calls
        // and tool results included. That is what the model's next answer rests on.
        const turn = { role: 'assistant', content: final.content }
        messages.push(turn)
        await saveTurn(env, key, sessionId, auth.userId, turn)
        if (stopReason !== 'pause_turn') break
        send('delta', { text: '' })
      }
      if (stopReason === 'refusal') send('error', { error: 'The model declined this request.' })
      else if (stopReason === 'max_tokens') send('error', { error: 'The answer was cut off at the length limit. Ask it to continue.' })
      else if (stopReason === 'pause_turn') send('error', { error: 'The work is not finished: it stopped after many tool steps. Ask it to continue.' })
      send('usage', { ...usage, model, ms: Date.now() - started })
      send('done', { stopReason })
    } catch (err) {
      console.error('[converse] failed', err)
      const status = err?.status ? ` (HTTP ${err.status})` : ''
      send('error', { error: `${err?.message || String(err)}${status}` })
      send('usage', { ...usage, model, ms: Date.now() - started })
      send('done', { error: true })
    } finally {
      await writer.close().catch(() => {})
    }
  })())

  return new Response(readable, {
    headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  })
}
