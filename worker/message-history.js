/**
 * Message-history invariants shared by every agent loop.
 *
 * THE INVARIANT (Anthropic Messages API, hard requirement):
 *   Every `tool_use` block in an assistant message MUST be answered by a
 *   `tool_result` block with the same id in the IMMEDIATELY following user
 *   message. Break it once and the API returns 400 for that request AND for
 *   every later request in the same conversation — the history stays poisoned,
 *   so the whole run dies:
 *
 *     messages.8: `tool_use` ids were found without `tool_result` blocks
 *     immediately after: toolu_… (2026-09-02, delegate_to_kg, 3 runs in a row)
 *
 * HOW IT GOT BROKEN: every loop paired tool_use/tool_result correctly on the
 * `stop_reason === 'tool_use'` path — and then a catch-all
 *
 *     } else { messages.push({assistant, data.content}, {user, 'Continue.'}) }
 *
 * pushed the SAME assistant content for any other stop_reason. On `max_tokens`
 * (the model was cut off while writing tool calls — e.g. six long create_node
 * calls in one turn) that content still holds tool_use blocks, and the plain
 * "Continue." user message answers none of them.
 *
 * THE FIX: repairToolPairing() runs immediately before every model call, so no
 * branch — present or future — can send a malformed array. It is idempotent and
 * a no-op on a well-formed history.
 */

// Sent back as the tool_result for a call that never executed. It doubles as the
// instruction the model needs: the write did NOT land, so make a smaller call.
export const UNANSWERED_TOOL_NOTE =
  'This tool call was NEVER EXECUTED — your reply was cut off (output token limit) before the call was complete, so its arguments were truncated. NOTHING was created, changed, or saved by it. Retry with a SMALLER call: one tool at a time, and shorter content per call (e.g. create one node per turn instead of six).'

/**
 * Enforce the tool_use/tool_result invariant on a message array, in place.
 *
 * For every unanswered `tool_use`, a matching `is_error` tool_result is
 * synthesized into the following user message (tool_result blocks are moved to
 * the front, as the API requires), or a new user message is inserted when the
 * assistant turn is last.
 *
 * Only client `tool_use` blocks are considered. `server_tool_use` (web search)
 * is answered inside the same assistant message by the server and is left alone.
 *
 * @param {Array} messages conversation, mutated in place
 * @param {{ note?: string }} [options]
 * @returns {number} how many tool_result blocks had to be synthesized (0 = was well-formed)
 */
export function repairToolPairing(messages, options = {}) {
  if (!Array.isArray(messages)) return 0
  const note = options.note || UNANSWERED_TOOL_NOTE
  let repaired = 0

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) continue

    const ids = message.content
      .filter((b) => b && b.type === 'tool_use' && b.id)
      .map((b) => b.id)
    if (ids.length === 0) continue

    const next = messages[i + 1]
    const answered = new Set()
    if (next && next.role === 'user' && Array.isArray(next.content)) {
      for (const block of next.content) {
        if (block && block.type === 'tool_result' && block.tool_use_id) answered.add(block.tool_use_id)
      }
    }

    const missing = ids.filter((id) => !answered.has(id))
    if (missing.length === 0) continue

    const synthesized = missing.map((id) => ({
      type: 'tool_result',
      tool_use_id: id,
      is_error: true,
      content: note,
    }))
    repaired += synthesized.length

    if (next && next.role === 'user') {
      // Keep whatever the branch wanted to say, but tool_result blocks must lead.
      const blocks = Array.isArray(next.content)
        ? next.content
        : [{ type: 'text', text: String(next.content ?? '') }]
      const existingResults = blocks.filter((b) => b && b.type === 'tool_result')
      const rest = blocks.filter((b) => !(b && b.type === 'tool_result'))
      messages[i + 1] = { ...next, content: [...existingResults, ...synthesized, ...rest] }
    } else {
      messages.splice(i + 1, 0, { role: 'user', content: synthesized })
    }
  }

  return repaired
}

/**
 * The assistant content that is SAFE to keep when we are not supplying
 * tool_results — text blocks only. Used by max_tokens branches that would
 * rather drop a truncated tool call than feed it back.
 */
export function textBlocksOnly(content, fallback = '(reply truncated)') {
  const blocks = (Array.isArray(content) ? content : []).filter((c) => c && c.type === 'text')
  return blocks.length > 0 ? blocks : [{ type: 'text', text: fallback }]
}
