/**
 * Meeting / podcast transcript → structured knowledge graph.
 *
 * Slice 1 (`transcribe_audio` with saveToGraph) already turns a recording into a
 * graph, but it produces ONE flat fulltext node holding the whole transcript —
 * searchable, not navigable. This subagent takes the same transcript and emits a
 * structured graph instead: an overview, the participants, one node per theme,
 * decisions, action points, and pull quotes, with the raw transcript preserved
 * as a final node so nothing is lost.
 *
 * Shape follows youtube-graph-subagent.js deliberately: a fixed, deterministic
 * pipeline rather than an inner agent loop, because shuttling a large transcript
 * between tools through a second model is exactly what made the YouTube version
 * fail on long inputs.
 *
 * Fulltext element syntax below is copied verbatim from the canonical contract at
 * GET https://knowledge.vegvisr.org/plugin/fulltext-elements (fetched 2026-08-11):
 *   [FANCY | font-size: …; color: …; text-align: …] … [END FANCY]
 *   [SECTION | background-color: '…'; color: '…'; text-align: '…'; font-size: '…'] … [END SECTION]
 *   [QUOTE | Cited='Author'] … [END QUOTE]
 * Do NOT invent parameters — re-query that endpoint before changing any of these.
 */

const STRUCTURE_MODEL = 'claude-sonnet-4-6'
// A long podcast can exceed a sane single request; clip and say so rather than
// silently truncating mid-sentence or blowing the context.
const MAX_TRANSCRIPT_CHARS = 60000

function formatErrorValue(value, fallback = 'Unknown error') {
  if (!value) return fallback
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message || fallback
  if (typeof value === 'object') {
    if (typeof value.message === 'string') return value.message
    try { return JSON.stringify(value) } catch { return fallback }
  }
  return String(value)
}

const esc = (s) => String(s == null ? '' : s).trim()

/**
 * Ask Claude for the meeting's structure as raw JSON. Kept to one call: the
 * transcript is the expensive part of the payload, so re-sending it per section
 * would multiply cost for no quality gain.
 */
async function extractStructure(transcript, opts, env, userId) {
  const language = opts.targetLanguage || 'same language as the transcript'
  const system = [
    'You analyse meeting, interview and podcast transcripts and return STRUCTURE ONLY.',
    'Respond with a RAW JSON object — no markdown, no code fences, no prose before or after.',
    'Shape exactly:',
    '{',
    '  "title": string,                       // short, specific; no filler like "Meeting Recording"',
    '  "summary": string,                     // 3-5 sentences, what was actually discussed and concluded',
    '  "participants": [{"name": string, "role": string}],  // role "" when unknown; [] if undeterminable',
    '  "themes": [{"heading": string, "body": string}],     // 3-8 themes, body 2-6 sentences each',
    '  "decisions": [string],                 // explicit decisions reached; [] if none',
    '  "actions": [{"what": string, "who": string}],        // who "" when unassigned; [] if none',
    '  "quotes": [{"text": string, "speaker": string}]      // 2-5 verbatim quotes worth surfacing',
    '}',
    `Write all human-readable text in ${language}.`,
    'Speaker labels are often absent from transcripts — infer participants only when the text supports it, and return [] rather than guessing names.',
    'Never invent decisions, actions or quotes that are not in the transcript. Empty arrays are correct answers.',
  ].join('\n')

  const clipped = transcript.length > MAX_TRANSCRIPT_CHARS
    ? transcript.slice(0, MAX_TRANSCRIPT_CHARS)
    : transcript

  const userMsg = [
    opts.title ? `Recording title: ${opts.title}` : null,
    transcript.length > MAX_TRANSCRIPT_CHARS
      ? `NOTE: transcript truncated to the first ${MAX_TRANSCRIPT_CHARS} characters of ${transcript.length}.`
      : null,
    '',
    'Transcript:',
    clipped,
  ].filter(Boolean).join('\n')

  const res = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: userId || 'meeting-graph-subagent',
      model: STRUCTURE_MODEL,
      max_tokens: 4000,
      temperature: 0.2,
      system,
      messages: [{ role: 'user', content: userMsg }],
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(formatErrorValue(data.error, `Claude structuring failed (status ${res.status})`))
  }
  const textBlock = (data.content || []).find(b => b?.type === 'text')
  let raw = esc(textBlock?.text)
  if (!raw) throw new Error('Claude returned no text when structuring the transcript')
  // Models still fence JSON occasionally despite the instruction.
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`Claude did not return valid JSON when structuring the transcript. First 200 chars: ${raw.slice(0, 200)}`)
  }
  return {
    title: esc(parsed.title),
    summary: esc(parsed.summary),
    participants: Array.isArray(parsed.participants) ? parsed.participants : [],
    themes: Array.isArray(parsed.themes) ? parsed.themes : [],
    decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
    actions: Array.isArray(parsed.actions) ? parsed.actions : [],
    quotes: Array.isArray(parsed.quotes) ? parsed.quotes : [],
    truncated: transcript.length > MAX_TRANSCRIPT_CHARS,
  }
}

/** Build the node/edge set. Pure — no I/O — so it is easy to reason about and test. */
function buildGraph(structure, ctx) {
  const nodes = []
  const edges = []
  const stamp = Date.now()
  let i = 0
  const nid = (kind) => `${kind}_${stamp}_${i++}`

  const add = (label, info, type = 'fulltext', color = '#0f2a43') => {
    const id = nid(type === 'fulltext' ? 'fulltext' : type)
    nodes.push({
      id,
      label,
      type,
      info,
      color,
      bibl: [],
      position: { x: 100 + (nodes.length % 3) * 300, y: 100 + Math.floor(nodes.length / 3) * 250 },
      visible: true,
    })
    return id
  }

  // ── Overview ──────────────────────────────────────────────────────────────
  const overviewInfo = [
    `[FANCY | font-size: 3em; color: #2c3e50; text-align: center]`,
    structure.title || 'Meeting',
    `[END FANCY]`,
    '',
    `[SECTION | background-color: 'lightblue'; color: 'black'; text-align: 'left'; font-size: '1.1em']`,
    structure.summary || 'No summary produced.',
    `[END SECTION]`,
    '',
    // Bullets, not bare lines: two adjacent markdown lines merge into one
    // paragraph, which ran "Recording:" and "Listen:" together.
    ctx.recordingName ? `- **Recording:** ${ctx.recordingName}` : null,
    ctx.playUrl ? `- **Listen:** ${ctx.playUrl}` : null,
    structure.truncated
      ? `\n_Note: the transcript exceeded ${MAX_TRANSCRIPT_CHARS} characters and was truncated for structuring. The full transcript node below is complete._`
      : null,
    // Keep '' separators — they are the blank lines between blocks. Only drop
    // the null placeholders for absent optional lines.
  ].filter(v => v !== null && v !== undefined).join('\n')
  const overviewId = add(structure.title || 'Meeting overview', overviewInfo)

  // ── Participants ──────────────────────────────────────────────────────────
  // A nameless entry is the model guessing rather than identifying — drop it,
  // otherwise the node renders a list of "Unknown".
  const namedParticipants = structure.participants.filter(p => esc(p?.name))
  if (namedParticipants.length) {
    const rows = namedParticipants
      .map(p => `- **${esc(p.name)}**${esc(p?.role) ? ` — ${esc(p.role)}` : ''}`)
      .join('\n')
    const id = add('Participants', [
      `[SECTION | background-color: '#f5f5f5'; color: 'black'; text-align: 'left'; font-size: '1em']`,
      rows,
      `[END SECTION]`,
    ].join('\n'))
    edges.push({ source: overviewId, target: id, label: 'Deltakere', type: 'info' })
  }

  // ── Themes ────────────────────────────────────────────────────────────────
  structure.themes.forEach((t) => {
    const heading = esc(t?.heading)
    const body = esc(t?.body)
    if (!heading && !body) return
    const id = add(heading || 'Theme', body)
    edges.push({ source: overviewId, target: id, label: 'Tema', type: 'next' })
  })

  // ── Decisions ─────────────────────────────────────────────────────────────
  if (structure.decisions.length) {
    const list = structure.decisions.map(d => `- ${esc(d)}`).filter(l => l !== '- ').join('\n')
    if (list) {
      const id = add('Decisions', [
        `[SECTION | background-color: '#e8f5e9'; color: 'black'; text-align: 'left'; font-size: '1em']`,
        list,
        `[END SECTION]`,
      ].join('\n'))
      edges.push({ source: overviewId, target: id, label: 'Beslutninger', type: 'info' })
    }
  }

  // ── Action points ─────────────────────────────────────────────────────────
  if (structure.actions.length) {
    const list = structure.actions
      .map(a => {
        const what = esc(a?.what)
        if (!what) return null
        const who = esc(a?.who)
        return `- [ ] ${what}${who ? ` — **${who}**` : ''}`
      })
      .filter(Boolean).join('\n')
    if (list) {
      const id = add('Action points', [
        `[SECTION | background-color: '#fff8e1'; color: 'black'; text-align: 'left'; font-size: '1em']`,
        list,
        `[END SECTION]`,
      ].join('\n'))
      edges.push({ source: overviewId, target: id, label: 'Oppgaver', type: 'info' })
    }
  }

  // ── Quotes ────────────────────────────────────────────────────────────────
  const quoteBlocks = structure.quotes
    .map(q => {
      const text = esc(q?.text)
      if (!text) return null
      const speaker = esc(q?.speaker)
      // Contract: [QUOTE | Cited='Author'] … [END QUOTE]
      return `[QUOTE | Cited='${(speaker || 'Ukjent').replace(/'/g, '')}']\n${text}\n[END QUOTE]`
    })
    .filter(Boolean)
  if (quoteBlocks.length) {
    const id = add('Quotes', quoteBlocks.join('\n\n'))
    edges.push({ source: overviewId, target: id, label: 'Sitater', type: 'info' })
  }

  // ── Full transcript (always last, always complete) ────────────────────────
  const id = add('Full transcript', ctx.transcript)
  edges.push({ source: overviewId, target: id, label: 'Transkripsjon', type: 'info' })

  return { nodes, edges }
}

async function saveGraph({ title, description, nodes, edges, metaArea }, env, userId) {
  if (!nodes.length) throw new Error('Cannot save a graph with zero nodes')
  const nowIso = new Date().toISOString()
  const graphId = `graph_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const createdByEmail = (userId && String(userId).includes('@')) ? userId : 'agent@vegvisr.org'

  const graphData = {
    metadata: {
      title,
      description: description || '',
      createdBy: createdByEmail,
      metaArea: metaArea || '#MEETING',
      category: 'Meeting',
      version: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    nodes,
    edges,
  }

  const res = await env.KG_WORKER.fetch('https://knowledge-graph-worker/saveGraphWithHistory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: graphId, graphData, override: true }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(formatErrorValue(data.error, `saveGraphWithHistory failed (status ${res.status})`))
  }
  const finalId = data.id || data.graphId || graphId
  return {
    graphId: finalId,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    viewUrl: `https://www.vegvisr.org/gnew-viewer?graphId=${finalId}`,
  }
}

async function withHeartbeat(progress, messages, intervalMs, task) {
  let idx = 0
  const iv = setInterval(() => {
    progress(messages[idx % messages.length])
    idx++
  }, intervalMs)
  try {
    return await task()
  } finally {
    clearInterval(iv)
  }
}

async function runMeetingGraphSubagent(input, env, onProgress) {
  const progress = typeof onProgress === 'function' ? onProgress : () => {}
  const log = (m) => console.log(`[meeting-graph-subagent] ${m}`)
  const actions = []
  let currentStep = 'validate'

  try {
    const transcript = esc(input.transcript)
    if (!transcript) {
      throw new Error('transcript is required — run transcribe_audio first and pass its text here')
    }
    if (transcript.length < 200) {
      throw new Error(`Transcript is only ${transcript.length} characters — too short to structure into a graph`)
    }

    const ctx = {
      transcript,
      recordingName: esc(input.recordingName) || esc(input.title) || null,
      playUrl: esc(input.playUrl) || null,
    }

    currentStep = 'extract_structure'
    progress('Reading the transcript...')
    const structure = await withHeartbeat(progress, [
      'Identifying participants...',
      'Grouping the conversation into themes...',
      'Pulling out decisions and action points...',
      'Selecting quotes...',
      'Still structuring — a long recording takes 30-60s...',
    ], 3000, () => extractStructure(transcript, {
      title: ctx.recordingName,
      targetLanguage: input.targetLanguage,
    }, env, input.userId))
    actions.push({
      tool: 'extract_structure',
      success: true,
      summary: `${structure.themes.length} themes, ${structure.participants.length} participants, ${structure.decisions.length} decisions, ${structure.actions.length} actions, ${structure.quotes.length} quotes`,
    })

    currentStep = 'build_graph'
    const { nodes, edges } = buildGraph(structure, ctx)
    actions.push({ tool: 'build_graph', success: true, summary: `${nodes.length} nodes, ${edges.length} edges` })

    currentStep = 'save_graph'
    progress('Saving the knowledge graph...')
    const title = structure.title || ctx.recordingName || 'Meeting'
    const saved = await saveGraph({
      title: `🎙 ${title}`,
      description: structure.summary,
      nodes,
      edges,
      metaArea: esc(input.metaArea) || '#MEETING',
    }, env, input.userId)
    actions.push({ tool: 'save_graph', success: true, summary: `Saved graph ${saved.graphId}` })

    progress('Complete.')
    log(`done | graph=${saved.graphId} nodes=${saved.nodeCount}`)
    return {
      success: true,
      summary: `Created graph ${saved.graphId} from "${title}" — ${saved.nodeCount} nodes (${structure.themes.length} themes, ${structure.decisions.length} decisions, ${structure.actions.length} action points).`,
      graphId: saved.graphId,
      viewUrl: saved.viewUrl,
      title,
      nodeCount: saved.nodeCount,
      edgeCount: saved.edgeCount,
      themeCount: structure.themes.length,
      participantCount: structure.participants.length,
      decisionCount: structure.decisions.length,
      actionCount: structure.actions.length,
      quoteCount: structure.quotes.length,
      truncated: structure.truncated,
      turns: actions.length,
      actions,
    }
  } catch (error) {
    const message = formatErrorValue(error)
    log(`FAILED at ${currentStep}: ${message}`)
    if (actions.length === 0 || actions[actions.length - 1].success) {
      actions.push({ tool: currentStep, success: false, error: message })
    }
    return {
      success: false,
      error: message,
      summary: `Meeting graph pipeline failed at ${currentStep}: ${message}`,
      turns: Math.max(actions.length, 1),
      actions,
    }
  }
}

export { runMeetingGraphSubagent, buildGraph }
