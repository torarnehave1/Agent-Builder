// Read a response from the model gateway without ever throwing a parser error at the user.
//
// A Cloudflare 524 (origin timeout, ~100 s) comes back as an HTML/text error page, and
// `await response.json()` then throws: Unexpected token 'e', "error code: 524" is not valid JSON.
// That string is what reached the architect's chat — twice — instead of "your message was too large
// and the turn timed out" (2026-09-12, an 80 KB transcript pasted into a chat turn).
export async function readModelResponse(response) {
  const raw = await response.text().catch(() => '')
  try {
    return JSON.parse(raw)
  } catch {
    const timedOut = response.status === 524 || /error code: *524|gateway time-?out|timed? out/i.test(raw)
    const detail = raw.replace(/\s+/g, ' ').trim().slice(0, 200)
    return {
      error: {
        type: timedOut ? 'edge_timeout' : 'non_json_response',
        status: response.status,
        message: timedOut
          ? `The model call timed out at the edge (HTTP ${response.status || 524}) after about 100 seconds. A single turn carried too much text — a long transcript pasted straight into the chat is the usual cause. Put the text into a node first (delegate_to_kg with the text as the node's info, or save_transcript_to_graph) or send it in parts; do not retry the same turn unchanged.`
          : `The model service returned a non-JSON response (HTTP ${response.status}): ${detail || '(empty body)'}`,
      },
    }
  }
}
