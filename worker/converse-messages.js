// Repairs a stored /converse transcript before it is sent back to the Messages API. Kept apart
// from converse.js so it can be tested in Node (converse.js imports cloudflare: modules).

// A server-run call (mcp_tool_use, server_tool_use) carries its result in the same assistant turn.
// A turn cut off at max_tokens can end with such a call and no result, and the API then refuses
// every later request in the conversation (HTTP 400 "… was found without a corresponding
// mcp_tool_result block", 2026-11-28). The unanswered call is dropped, and a line in its place
// tells the model it was never carried out.
export function dropUnansweredServerCalls(m) {
  if (m.role !== 'assistant' || !Array.isArray(m.content)) return m
  const answered = new Set(m.content.filter((b) => b && b.type !== 'tool_result' && typeof b.tool_use_id === 'string').map((b) => b.tool_use_id))
  const dangling = m.content.filter((b) => b && (b.type === 'mcp_tool_use' || b.type === 'server_tool_use') && !answered.has(b.id))
  if (!dangling.length) return m
  const gone = new Set(dangling.map((b) => b.id))
  const content = m.content.filter((b) => !(b && gone.has(b.id) && (b.type === 'mcp_tool_use' || b.type === 'server_tool_use')))
  const names = dangling.map((b) => b.name || 'tool').join(', ')
  content.push({ type: 'text', text: `[Cut off at the length limit before this call was carried out: ${names}. It was not run. Call it again if it is still needed, with less input in one call.]` })
  return { ...m, content }
}

// A stored assistant turn may end in tool calls that never got their results (the turn was cut
// off, or was made before this worker ran such calls). The API refuses a conversation like that,
// so each one gets a result saying it was not run.
export function closeDanglingCalls(messages) {
  const out = []
  for (let i = 0; i < messages.length; i++) {
    const m = dropUnansweredServerCalls(messages[i])
    out.push(m)
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue
    const calls = m.content.filter((b) => b && b.type === 'tool_use')
    if (!calls.length) continue
    const next = messages[i + 1]
    const answered = new Set(
      next && next.role === 'user' && Array.isArray(next.content) ? next.content.filter((b) => b && b.type === 'tool_result').map((b) => b.tool_use_id) : [],
    )
    const missing = calls.filter((c) => !answered.has(c.id))
    if (missing.length)
      out.push({ role: 'user', content: missing.map((c) => ({ type: 'tool_result', tool_use_id: c.id, is_error: true, content: 'Not run: the turn ended before this tool call was carried out. Call it again if it is still needed.' })) })
  }
  return out
}

// save_message_text (2026-11-28): text the person wrote — a pasted transcript, an article — is put
// into a node word for word by the worker, from the stored conversation. The model names the
// message and the part; it never retypes the text. Retyping ~100k characters into one tool call
// ran past the 32000-token output limit and the node was never made.
const personText = (m) => {
  if (!m || m.role !== 'user') return null
  if (typeof m.content === 'string') return m.content
  if (!Array.isArray(m.content) || m.content.some((b) => b && b.type === 'tool_result')) return null
  const t = m.content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n')
  return t || null
}
export function pickMessageText(messages, { contains, from, to } = {}) {
  const needle = String(contains || '').trim()
  if (!needle) return { error: 'contains is required: a short phrase copied from the message that holds the text.' }
  let text = null
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = personText(messages[i])
    if (t && t.includes(needle)) { text = t; break }
  }
  if (text === null) return { error: `No message from the person contains "${needle.slice(0, 80)}". Copy a phrase exactly as it stands in their message.` }
  let start = 0
  if (from) {
    start = text.indexOf(from)
    if (start < 0) return { error: `The message has no "${String(from).slice(0, 80)}" to start from. Copy the start exactly.` }
  }
  let end = text.length
  if (to) {
    const at = text.indexOf(to, start + (from ? from.length : 0))
    if (at < 0) return { error: `The message has no "${String(to).slice(0, 80)}" after the start. Copy the end exactly, or leave it out to take the rest.` }
    end = at + to.length
  }
  const part = text.slice(start, end).trim()
  if (!part) return { error: 'That part of the message is empty.' }
  return { text: part }
}
