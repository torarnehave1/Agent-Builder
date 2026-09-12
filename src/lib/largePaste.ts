/**
 * A wall of text pasted into the chat must not travel through the model.
 *
 * 2026-09-12: an 80 KB meeting transcript pasted into one turn blew past Cloudflare's ~100 s
 * origin timeout; the user saw "Unexpected token 'e', "error code: 524" is not valid JSON" twice and
 * the text never reached a node. Transcriptions produced in-app already solve this: the body stays in
 * the browser under a `tx_N` handle, the model sees a stand-in, and `save_transcript_to_graph` asks
 * the browser to write its own copy into the graph. A paste is the same problem with a different
 * source, so it reuses that machinery rather than growing a second one (L57).
 *
 * This module is pure so it can be tested (largePaste.test.ts).
 */

/** Anything at or above this many characters is held back. ~6 000 chars ≈ 1 500 tokens. */
export const LARGE_PASTE_CHARS = 6000

/** How much of the text the model is allowed to see, so it can tell what the paste IS. */
export const PASTE_PREVIEW_CHARS = 600

export interface HeldPaste {
  /** The handle the model sees and passes to save_transcript_to_graph, e.g. "tx_3". */
  handle: string
  /** A short title derived from the text — used as the node label when none is given. */
  title: string
  /** What the model receives instead of the body. */
  standIn: string
  /** The full text, kept in the browser. */
  text: string
}

export function isLargePaste(text: string, limit: number = LARGE_PASTE_CHARS): boolean {
  return typeof text === 'string' && text.length >= limit
}

/** First meaningful line, trimmed to something usable as a node label. */
export function derivePasteTitle(text: string): string {
  const line = String(text || '')
    .split('\n')
    .map(l => l.replace(/^\s*\[[^\]]*\]\s*/, '').trim()) // drop a leading [0:00 – 2:00] timestamp
    .find(l => l.length > 3)
  const raw = (line || 'Innlimt tekst').replace(/\s+/g, ' ').trim()
  return raw.length > 60 ? `${raw.slice(0, 57)}…` : raw
}

/**
 * Build the stand-in the model receives. It states plainly that the body is NOT here, carries the
 * handle, and names the tool that places it — the same three things the transcription stand-in
 * carries, for the same reason: without the tool name the agent asks the user to paste it again.
 */
export function buildPasteStandIn(handle: string, title: string, text: string): string {
  const preview = String(text).slice(0, PASTE_PREVIEW_CHARS).replace(/\s+$/, '')
  const chars = String(text).length
  return [
    `**Long pasted text** [transcript:${handle}] — "${title}" (${chars.toLocaleString('en-US')} characters, held in the user's browser)`,
    '',
    `First ${Math.min(PASTE_PREVIEW_CHARS, chars)} characters, for identification only:`,
    preview,
    '',
    `(The full text is NOT in this conversation — it stayed in the browser so this turn could not time out. To put it in a node, call save_transcript_to_graph with transcriptId "${handle}" and the target graphId. NEVER ask the user to paste it again, and never try to retype it.)`,
  ].join('\n')
}

/**
 * Decide what to do with a user message. Returns null when the text is small enough to send as is.
 */
export function holdLargePaste(text: string, nextHandle: string, limit: number = LARGE_PASTE_CHARS): HeldPaste | null {
  if (!isLargePaste(text, limit)) return null
  const title = derivePasteTitle(text)
  return { handle: nextHandle, title, standIn: buildPasteStandIn(nextHandle, title, text), text }
}
