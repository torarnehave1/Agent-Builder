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
