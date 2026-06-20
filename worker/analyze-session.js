/**
 * Session analysis — produces a broad overview of a stored agent chat session
 * and supports follow-up dialog about it.
 *
 * Fetches messages from chat-history (api.vegvisr.org/chat-history) using the
 * user's x-user-id header, condenses them into a transcript, and calls Claude
 * via the ANTHROPIC service binding. No tools — analyzer is text-in / text-out.
 *
 * v1: non-streaming JSON responses. Ephemeral dialog (caller carries history).
 */

// Stable model name — no -YYYYMMDD snapshot, so an Anthropic deprecation of
// an older snapshot can't silently break analysis runs.
const ANALYSIS_MODEL = 'claude-sonnet-4-6'
const CHAT_HISTORY_API = 'https://api.vegvisr.org/chat-history'

const MESSAGE_FETCH_LIMIT = 200
const PER_MESSAGE_CHAR_CAP = 1500
const TRANSCRIPT_CHAR_CAP = 50000

const ANALYST_SYSTEM_PROMPT =
  'You analyze stored agent chat sessions. You have no tools and cannot mutate anything. ' +
  'You see one full transcript per request. Be concrete: name what was attempted, what got done, what stalled. ' +
  'Avoid hedging language. Plain markdown only — no JSON, no code fences around the whole reply.'

const OVERVIEW_INSTRUCTION =
  'Below is the transcript of one agent chat session. Produce a BROAD OVERVIEW of what this session was about. ' +
  'Cover: the user\'s apparent goal, what got accomplished, what tools/topics dominated, and anything left unresolved. ' +
  'Keep it under 250 words. Plain markdown, short sentences. Do not quote the transcript verbatim.'

function condenseToolCalls(toolCalls) {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return ''
  return toolCalls
    .map((t) => {
      const name = t?.tool || t?.name || 'unknown'
      const args = t?.input || t?.arguments || {}
      let argSummary = ''
      try {
        const json = typeof args === 'string' ? args : JSON.stringify(args)
        argSummary = json.length > 120 ? json.slice(0, 117) + '...' : json
      } catch {
        argSummary = ''
      }
      return `[tool_call: ${name}${argSummary ? '(' + argSummary + ')' : ''}]`
    })
    .join(' ')
}

function buildTranscript(messages) {
  const ordered = (messages || []).slice().reverse()
  const lines = []
  let totalChars = 0
  let truncatedCount = 0

  for (const m of ordered) {
    const role = (m?.role || 'unknown').toUpperCase()
    const rawContent = typeof m?.content === 'string' ? m.content : ''
    const toolSummary = condenseToolCalls(m?.proffData?.toolCalls)
    const body = (rawContent + (toolSummary ? ` ${toolSummary}` : '')).trim()
    if (!body) continue

    let snippet = body
    if (snippet.length > PER_MESSAGE_CHAR_CAP) {
      snippet = snippet.slice(0, PER_MESSAGE_CHAR_CAP) + '... [truncated]'
      truncatedCount++
    }

    const line = `${role}: ${snippet}`
    if (totalChars + line.length > TRANSCRIPT_CHAR_CAP) {
      lines.push('... [earlier messages omitted due to length cap]')
      break
    }
    lines.push(line)
    totalChars += line.length + 1
  }

  return {
    text: lines.join('\n\n'),
    messageCount: ordered.length,
    transcriptChars: totalChars,
    truncatedMessages: truncatedCount,
  }
}

async function fetchSessionMessages({ sessionId, userId }) {
  const url = `${CHAT_HISTORY_API}/messages?sessionId=${encodeURIComponent(sessionId)}&decrypt=1&limit=${MESSAGE_FETCH_LIMIT}`
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'x-user-id': userId, 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`chat-history /messages failed: ${res.status} ${text.slice(0, 200)}`)
  }
  const data = await res.json().catch(() => ({}))
  return Array.isArray(data?.messages) ? data.messages : []
}

async function callAnthropic({ env, userId, messages, maxTokens }) {
  const res = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: userId || 'session-analyzer',
      messages,
      model: ANALYSIS_MODEL,
      max_tokens: maxTokens,
      temperature: 0.3,
      system: ANALYST_SYSTEM_PROMPT,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(`anthropic call failed: ${res.status} ${JSON.stringify(data?.error || data).slice(0, 300)}`)
  }
  const block = (data?.content || []).find((b) => b?.type === 'text')
  const text = (block?.text || '').trim()
  if (!text) throw new Error('analyzer returned no text content')
  return text
}

export async function analyzeSession({ sessionId, userId, env }) {
  if (!sessionId) throw new Error('sessionId required')
  if (!userId) throw new Error('userId required')

  const rawMessages = await fetchSessionMessages({ sessionId, userId })
  const { text: transcript, messageCount, transcriptChars, truncatedMessages } = buildTranscript(rawMessages)

  if (!transcript) {
    return {
      sessionId,
      overview: '_This session has no readable messages to analyze._',
      messageCount,
      transcriptChars,
      truncatedMessages,
    }
  }

  const userPrompt = `${OVERVIEW_INSTRUCTION}\n\n--- TRANSCRIPT START ---\n${transcript}\n--- TRANSCRIPT END ---`
  const overview = await callAnthropic({
    env,
    userId,
    messages: [{ role: 'user', content: userPrompt }],
    maxTokens: 1500,
  })

  return { sessionId, overview, messageCount, transcriptChars, truncatedMessages }
}

export async function analyzeSessionDialog({ sessionId, userId, history, message, env }) {
  if (!sessionId) throw new Error('sessionId required')
  if (!userId) throw new Error('userId required')
  if (!message || typeof message !== 'string') throw new Error('message required')

  const rawMessages = await fetchSessionMessages({ sessionId, userId })
  const { text: transcript, messageCount, transcriptChars } = buildTranscript(rawMessages)

  const safeHistory = Array.isArray(history)
    ? history
        .filter((h) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
        .map((h) => ({ role: h.role, content: h.content }))
    : []

  const transcriptBlock = transcript || '_(empty session)_'
  const contextMessage = {
    role: 'user',
    content:
      'Context — full transcript of the agent session under discussion:\n\n' +
      '--- TRANSCRIPT START ---\n' +
      transcriptBlock +
      '\n--- TRANSCRIPT END ---\n\n' +
      'Answer follow-up questions about this session. Stay grounded in the transcript above.',
  }
  const ackMessage = {
    role: 'assistant',
    content: 'Got it — I have the session transcript. Ask away.',
  }

  const messages = [contextMessage, ackMessage, ...safeHistory, { role: 'user', content: message }]

  const reply = await callAnthropic({
    env,
    userId,
    messages,
    maxTokens: 2000,
  })

  return { sessionId, reply, messageCount, transcriptChars }
}
