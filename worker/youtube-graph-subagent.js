/**
 * YouTube → Knowledge Graph Subagent
 *
 * Specialized subagent that turns a YouTube URL into a brand-new knowledge graph.
 *
 * Flow:
 *   1. Extract videoId from the URL
 *   2. Fetch transcript from api.vegvisr.org/youtube-transcript-io/{videoId}
 *      (via API_WORKER service binding)
 *   3. Post transcript to grok.vegvisr.org/process-transcript
 *      (via GROK_WORKER service binding) → returns {knowledgeGraph: {nodes, edges}, stats}
 *   4. Save the new graph via KG_WORKER/saveGraphWithHistory
 *
 * This subagent does NOT merge into existing graphs — every run produces a
 * fresh graph. Language defaults match the vegvisr-frontend composable:
 * sourceLanguage='auto', targetLanguage='norwegian'.
 */

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

const YOUTUBE_GRAPH_SYSTEM_PROMPT = `You are a Vegvisr YouTube-to-Graph specialist. Your job is to turn a YouTube URL into a brand-new knowledge graph.

## The Pipeline (ALWAYS in this order)

1. \`extract_video_id\` — Extract the 11-character YouTube videoId from the URL the user gave you.
2. \`fetch_youtube_transcript\` — Fetch the transcript via Transcript IO.
3. \`process_transcript_to_graph\` — Send transcript text to the grok-worker. It returns a knowledge graph (nodes + edges).
4. \`save_generated_graph\` — Save the returned graph under a new graph ID. This creates the graph and returns viewUrl.

## Rules

- Always create a NEW graph. Never merge into an existing graphId.
- Use defaults: sourceLanguage='auto', targetLanguage='norwegian'. Only override if the user explicitly requested a different language.
- Pass the FULL transcript text to process_transcript_to_graph (the text concatenated across all transcript segments — fetch_youtube_transcript returns this ready-to-use as \`transcriptText\`).
- When calling save_generated_graph, ALWAYS forward EVERY metadata field returned by fetch_youtube_transcript: \`videoId\`, \`videoTitle\` (= title), \`channelTitle\`, \`lengthSeconds\`, \`publishDate\`, AND \`videoDescription\` (= description). The save step uses them to build the canonical youtube-video node with the rich info block. Do not drop fields.
- When saving, build a sensible title using the video title returned by fetch_youtube_transcript, e.g. "🎬 {videoTitle} ({nodeCount} deler)". If the title is missing, fall back to "📝 Transkript {date} ({nodeCount} deler)".
- Description should mention the video title, channel, and node count, in Norwegian if targetLanguage is norwegian, otherwise English.
- If fetch_youtube_transcript fails, stop and report the error. Do not retry indefinitely.
- If process_transcript_to_graph returns an empty nodes array, stop and report the error.

## After Completion

Respond with a short summary:
- The new graphId
- The viewUrl (https://www.vegvisr.org/gnew-viewer?graphId=...)
- The video title and number of nodes
- Source and target language`

// ---------------------------------------------------------------------------
// YouTube-specific tool definitions
// ---------------------------------------------------------------------------

const YOUTUBE_GRAPH_TOOLS = [
  {
    name: 'extract_video_id',
    description: 'Extract the 11-character YouTube videoId from a YouTube URL or bare ID. Accepts youtu.be/VIDEOID, youtube.com/watch?v=VIDEOID, or a bare ID.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'YouTube URL or bare 11-char videoId' }
      },
      required: ['url']
    }
  },
  {
    name: 'fetch_youtube_transcript',
    description: 'Fetch the transcript for a YouTube video via Transcript IO (api.vegvisr.org/youtube-transcript-io/{videoId}). Returns {videoId, title, channelTitle, transcriptText, segmentCount}. transcriptText is the full concatenated transcript ready to pass to process_transcript_to_graph.',
    input_schema: {
      type: 'object',
      properties: {
        videoId: { type: 'string', description: '11-character YouTube videoId' }
      },
      required: ['videoId']
    }
  },
  {
    name: 'process_transcript_to_graph',
    description: 'Send a transcript to the grok-worker to generate a knowledge graph. Returns {nodes, edges, stats}. Defaults: sourceLanguage=auto, targetLanguage=norwegian.',
    input_schema: {
      type: 'object',
      properties: {
        transcript: { type: 'string', description: 'Full transcript text' },
        sourceLanguage: { type: 'string', description: 'auto|english|norwegian|... (default: auto)' },
        targetLanguage: { type: 'string', description: 'norwegian|original (default: norwegian)' }
      },
      required: ['transcript']
    }
  },
  {
    name: 'save_generated_graph',
    description: 'Save a generated knowledge graph to a new graph ID via KG_WORKER/saveGraphWithHistory. Generates a fresh graph ID server-side. Returns {graphId, viewUrl}.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Graph title (shown in UI lists)' },
        description: { type: 'string', description: 'Graph description' },
        nodes: { type: 'array', description: 'Array of nodes from process_transcript_to_graph' },
        edges: { type: 'array', description: 'Array of edges from process_transcript_to_graph (may be empty)' },
        videoTitle: { type: 'string', description: 'REQUIRED if video source: title returned by fetch_youtube_transcript' },
        videoId: { type: 'string', description: 'REQUIRED if video source: 11-char videoId returned by fetch_youtube_transcript' },
        channelTitle: { type: 'string', description: 'Optional: channel name returned by fetch_youtube_transcript (used to enrich the youtube-video node info block)' },
        lengthSeconds: { type: 'number', description: 'Optional: video duration in seconds returned by fetch_youtube_transcript' },
        publishDate: { type: 'string', description: 'Optional: publish date returned by fetch_youtube_transcript' },
        videoDescription: { type: 'string', description: 'Optional but recommended: the `description` string returned by fetch_youtube_transcript. Included in the youtube-video node info block so the saved graph matches the frontend transcript-processor output.' }
      },
      required: ['title', 'nodes']
    }
  }
]

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

function extractVideoId(urlOrId) {
  const s = String(urlOrId || '').trim()
  if (!s) return null

  // Bare 11-char ID
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s

  // youtu.be/VIDEOID[?...]
  const short = s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/)
  if (short) return short[1]

  // youtube.com/watch?v=VIDEOID
  const watch = s.match(/[?&]v=([A-Za-z0-9_-]{11})/)
  if (watch) return watch[1]

  // youtube.com/embed/VIDEOID or /shorts/VIDEOID
  const embed = s.match(/youtube\.com\/(?:embed|shorts)\/([A-Za-z0-9_-]{11})/)
  if (embed) return embed[1]

  return null
}

async function callFetchTranscript(videoId, env) {
  const res = await env.API_WORKER.fetch(
    `https://vegvisr-api-worker/youtube-transcript-io/${encodeURIComponent(videoId)}`,
    { method: 'GET', headers: { 'Content-Type': 'application/json' } }
  )
  const data = await res.json()
  if (!res.ok || !data.success) {
    throw new Error(data.error || `Transcript IO failed (status ${res.status})`)
  }
  // Response shape: { success, videoId, transcript: [ { text, title, microformat, tracks: [...] } ] }
  // We also prefer building transcriptText from tracks[0].transcript segments
  // (matches the frontend's fetchYouTubeTranscriptIO at TranscriptProcessorModal.vue:664).
  const outer = Array.isArray(data.transcript) ? (data.transcript[0] || {}) : {}
  const micro = outer.microformat?.playerMicroformatRenderer || {}
  const tracks = Array.isArray(outer.tracks) ? outer.tracks : []
  const track0 = tracks[0] || {}
  const segs = Array.isArray(track0.transcript) ? track0.transcript : []
  const transcriptText = segs.length
    ? segs.map((s) => s.text).join(' ').trim()
    : String(outer.text || '').trim()
  return {
    videoId: data.videoId || videoId,
    title: micro.title?.simpleText || outer.title || '',
    description: String(micro.description?.simpleText || '').trim(),
    channelTitle: micro.ownerChannelName || '',
    lengthSeconds: micro.lengthSeconds ? Number(micro.lengthSeconds) : undefined,
    publishDate: micro.publishDate || undefined,
    transcriptText,
    segmentCount: segs.length,
  }
}

async function callProcessTranscript(input, env, userId) {
  const body = {
    transcript: input.transcript,
    sourceLanguage: input.sourceLanguage || 'auto',
    targetLanguage: input.targetLanguage || 'norwegian',
    userId: userId || undefined,
  }
  const res = await env.GROK_WORKER.fetch('https://grok-worker/process-transcript', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) {
    // data.error may be a string OR an object — Error(obj) stringifies to
    // "[object Object]" which hides the real failure. Normalize here.
    const errMsg = typeof data.error === 'string'
      ? data.error
      : (data.error && (data.error.message || JSON.stringify(data.error))) ||
        `process-transcript failed (status ${res.status})`
    throw new Error(errMsg)
  }
  const kg = data.knowledgeGraph || {}
  return {
    nodes: Array.isArray(kg.nodes) ? kg.nodes : [],
    edges: Array.isArray(kg.edges) ? kg.edges : [],
    stats: data.stats || {},
  }
}

async function callSaveGraph(input, env, userId) {
  const contentNodes = Array.isArray(input.nodes) ? input.nodes : []
  const inputEdges = Array.isArray(input.edges) ? input.edges : []
  if (contentNodes.length === 0) {
    throw new Error('Cannot save a graph with zero nodes')
  }

  const nowIso = new Date().toISOString()
  const graphId = `graph_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  // Lay out content nodes on a 3-column grid (same as frontend importer).
  const hasVideo = !!input.videoId
  const positionedContent = contentNodes
    // Drop any youtube-video nodes the LLM/grok-worker may have emitted — we
    // always rebuild the video node deterministically below so there can be
    // no duplicates or format drift.
    .filter((n) => n.type !== 'youtube-video')
    .map((n, i) => ({
      ...n,
      id: n.id || `fulltext_${Date.now()}_${i}`,
      visible: n.visible !== false,
      position: n.position || { x: 100 + (i % 3) * 300, y: 100 + Math.floor(i / 3) * 250 },
    }))

  // Build the canonical youtube-video node using the EXACT recipe the
  // frontend uses in createYouTubeNode() at TranscriptProcessorModal.vue:1685.
  // Ground-truth reference graph: graph_1776861344585.
  //
  // Rules (do NOT change without comparing to that graph):
  //   - path: null                            (renderer reads videoId from the label macro)
  //   - label: "![YOUTUBE src=<embedUrl>]<title>[END YOUTUBE]"
  //   - bibl: [watchUrl]
  //   - info: [SECTION | ...] block with Channel / Duration / Published / Description / Source
  //   - APPENDED to the end of nodes (not prepended, no synthetic edges)
  let positioned = positionedContent
  let edges = inputEdges
  if (hasVideo) {
    const vid = input.videoId
    const vtitle = (input.videoTitle || '').trim() || `YouTube Video ${vid}`
    const channel = (input.channelTitle || '').trim() || 'Unknown Channel'
    const lengthSec = Number(input.lengthSeconds) || 0
    const publish = (input.publishDate || '').trim()
    const descriptionRaw = String(input.videoDescription || '').trim()
    const embedUrl = `https://www.youtube.com/embed/${vid}`
    const watchUrl = `https://www.youtube.com/watch?v=${vid}`

    // Duration mm:ss (formatDuration in the frontend)
    const mins = Math.floor(lengthSec / 60)
    const secs = lengthSec % 60
    const durationText = lengthSec
      ? `${mins}:${secs.toString().padStart(2, '0')}`
      : 'Unknown duration'

    // Date M/D/YYYY (matches frontend formatDate en-US output seen in graph_1776861344585)
    let publishText = 'Unknown date'
    if (publish) {
      const d = new Date(publish)
      if (!Number.isNaN(d.getTime())) {
        publishText = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
      } else {
        publishText = publish
      }
    }

    // Truncate description to 500 chars + "..." (matches frontend)
    const descriptionBlock = descriptionRaw
      ? `**Description:**\n${descriptionRaw.length > 500 ? descriptionRaw.substring(0, 500) + '...' : descriptionRaw}`
      : ''

    const info = `[SECTION | background-color:'#FFF'; color:'#333']\n**${vtitle}**\n\n**Channel:** ${channel}\n**Duration:** ${durationText}\n**Published:** ${publishText}\n\n${descriptionBlock}\n\n**Source:** [Watch on YouTube](${watchUrl})\n[END SECTION]`

    const ytNode = {
      id: `youtube_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      label: `![YOUTUBE src=${embedUrl}]${vtitle}[END YOUTUBE]`,
      color: '#FF0000',
      type: 'youtube-video',
      info,
      bibl: [watchUrl],
      imageWidth: '100%',
      imageHeight: '100%',
      visible: true,
      path: null,
    }

    positioned = [...positionedContent, ytNode]
    // No synthetic edges — frontend importer saves with edges: [] too.
  }

  const createdByEmail = (userId && String(userId).includes('@')) ? userId : 'agent@vegvisr.org'

  const graphData = {
    metadata: {
      title: input.title,
      description: input.description || '',
      createdBy: createdByEmail,
      version: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
      source: input.videoId
        ? { type: 'youtube', videoId: input.videoId, videoTitle: input.videoTitle || '' }
        : undefined,
    },
    nodes: positioned,
    edges,
  }

  const res = await env.KG_WORKER.fetch('https://knowledge-graph-worker/saveGraphWithHistory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: graphId, graphData, override: true }),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.error || `saveGraphWithHistory failed (status ${res.status})`)
  }
  const finalId = data.id || data.graphId || graphId
  return {
    graphId: finalId,
    nodeCount: positioned.length,
    edgeCount: edges.length,
    viewUrl: `https://www.vegvisr.org/gnew-viewer?graphId=${finalId}`,
  }
}

async function executeYoutubeTool(toolName, toolInput, env, userId, progress) {
  const noop = () => {}
  const emit = typeof progress === 'function' ? progress : noop
  switch (toolName) {
    case 'extract_video_id': {
      const videoId = extractVideoId(toolInput.url)
      if (!videoId) throw new Error(`Could not extract videoId from "${toolInput.url}"`)
      return { videoId }
    }
    case 'fetch_youtube_transcript': {
      return await callFetchTranscript(toolInput.videoId, env)
    }
    case 'process_transcript_to_graph': {
      const result = await callProcessTranscript(toolInput, env, userId)
      // Stream each node title back so the user can watch the graph taking shape
      for (const node of result.nodes) {
        if (node.label) emit(`📝 ${node.label}`)
      }
      return result
    }
    case 'save_generated_graph': {
      return await callSaveGraph(toolInput, env, userId)
    }
    default:
      return null
  }
}

// Run an async task while ticking a progress callback every `intervalMs` with
// rotating messages. Clears automatically on completion or error.
async function withHeartbeat(progress, messages, intervalMs, task) {
  let i = 0
  const tick = () => {
    try { progress(messages[i % messages.length]) } catch {}
    i++
  }
  // First beat fires immediately so the UI gets an update at tool-start.
  tick()
  const handle = setInterval(tick, intervalMs)
  try {
    return await task()
  } finally {
    clearInterval(handle)
  }
}

// ---------------------------------------------------------------------------
// Inner agent loop
// ---------------------------------------------------------------------------

async function runYoutubeGraphSubagent(input, env, onProgress, _executeTool) {
  const { url, youtubeUrl, task, userId } = input
  const sourceUrl = url || youtubeUrl || ''
  const maxTurns = 10
  const model = 'claude-sonnet-4-20250514'

  const log = (msg) => console.log(`[youtube-graph-subagent] ${msg}`)
  const progress = typeof onProgress === 'function' ? onProgress : () => {}

  const thinkingMessages = [
    'Extracting video ID...',
    'Fetching YouTube transcript...',
    'Reading captions...',
    'Processing transcript with Grok...',
    'Translating to Norwegian...',
    'Building knowledge graph...',
    'Saving new graph...',
    'Almost done...',
    'Finalizing...',
    'Complete.',
  ]
  const toolMessages = {
    extract_video_id: ['Extracting video ID from URL...'],
    fetch_youtube_transcript: ['Fetching YouTube transcript...', 'Reading captions from YouTube...'],
    process_transcript_to_graph: ['Processing transcript with Grok...', 'Building knowledge graph sections...'],
    save_generated_graph: ['Saving new knowledge graph...', 'Creating graph in Vegvisr...'],
  }
  // Rotated every 3s during long-running tool calls to keep the UI alive.
  const grokHeartbeats = [
    'Grok is reading the transcript...',
    'Translating to Norwegian...',
    'Grouping content into themes...',
    'Generating chapter nodes...',
    'Polishing the knowledge graph...',
    'Still working on the graph — Grok takes 30-60s for long videos...',
    'Almost there...',
  ]
  const fetchHeartbeats = [
    'Fetching YouTube transcript...',
    'Reading captions...',
    'Waiting on Transcript IO...',
  ]
  const saveHeartbeats = [
    'Saving new knowledge graph...',
    'Creating graph in Vegvisr...',
  ]

  let userMessage = `## Task\n${task || 'Create a new knowledge graph from a YouTube URL.'}`
  if (sourceUrl) userMessage += `\n\n## YouTube URL\n${sourceUrl}`
  userMessage += `\n\n## Defaults\nsourceLanguage=auto, targetLanguage=norwegian`

  const messages = [{ role: 'user', content: userMessage }]
  const tools = YOUTUBE_GRAPH_TOOLS
  let turn = 0
  const actions = []
  let resultGraphId = null
  let resultViewUrl = null

  log(`started | url="${sourceUrl}" task="${(task || '').slice(0, 100)}"`)
  progress('Extracting video ID...')

  while (turn < maxTurns) {
    turn++
    log(`turn ${turn}/${maxTurns}`)
    progress(thinkingMessages[turn - 1] || `Still working... (${turn})`)

    const response = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userId || 'youtube-graph-subagent',
        messages,
        model,
        max_tokens: 4096,
        temperature: 0.2,
        system: YOUTUBE_GRAPH_SYSTEM_PROMPT,
        tools,
      }),
    })

    const data = await response.json()
    if (!response.ok) {
      log(`ERROR: ${JSON.stringify(data.error)}`)
      return { success: false, error: data.error || 'Anthropic API error', turns: turn, actions }
    }

    if (data.stop_reason === 'end_turn') {
      const text = (data.content || []).filter(c => c.type === 'text').map(b => b.text).join('\n')
      log(`end_turn — summary: ${text.slice(0, 200)}`)
      return {
        success: !!resultGraphId,
        summary: text,
        turns: turn,
        actions,
        graphId: resultGraphId,
        viewUrl: resultViewUrl,
      }
    }

    if (data.stop_reason === 'tool_use') {
      const toolUses = (data.content || []).filter(c => c.type === 'tool_use')
      log(`tool_use — ${toolUses.length} tools: [${toolUses.map(t => t.name).join(', ')}]`)

      const toolResults = []
      for (const toolUse of toolUses) {
        const msgs = toolMessages[toolUse.name] || [`Working on ${toolUse.name}...`]
        progress(msgs[Math.floor(Math.random() * msgs.length)])

        // Heartbeat messages for tool calls that can take > 5s
        const heartbeatMsgs = toolUse.name === 'process_transcript_to_graph' ? grokHeartbeats
          : toolUse.name === 'fetch_youtube_transcript' ? fetchHeartbeats
          : toolUse.name === 'save_generated_graph' ? saveHeartbeats
          : null

        try {
          const result = heartbeatMsgs
            ? await withHeartbeat(progress, heartbeatMsgs, 3000,
                () => executeYoutubeTool(toolUse.name, toolUse.input, env, userId, progress))
            : await executeYoutubeTool(toolUse.name, toolUse.input, env, userId, progress)
          if (result === null) throw new Error(`Unknown tool: ${toolUse.name}`)

          if (toolUse.name === 'save_generated_graph' && result.graphId) {
            resultGraphId = result.graphId
            resultViewUrl = result.viewUrl
          }

          actions.push({
            tool: toolUse.name,
            success: true,
            summary: result.message || `${toolUse.name} ok`,
          })

          // Transcript text can be very large — strip from tool_result payload
          // sent back to the LLM to avoid context bloat. The LLM only needs to
          // know we have it; the full text stays in our local variable.
          let resultForLlm = result
          if (toolUse.name === 'fetch_youtube_transcript') {
            const preview = (result.transcriptText || '').slice(0, 300)
            resultForLlm = {
              videoId: result.videoId,
              title: result.title,
              channelTitle: result.channelTitle,
              lengthSeconds: result.lengthSeconds,
              publishDate: result.publishDate,
              segmentCount: result.segmentCount,
              transcriptLength: (result.transcriptText || '').length,
              transcriptPreview: preview + (result.transcriptText.length > 300 ? '...' : ''),
              transcriptText: result.transcriptText, // LLM needs to pass it to next tool
            }
          }
          if (toolUse.name === 'process_transcript_to_graph') {
            resultForLlm = {
              nodeCount: result.nodes.length,
              edgeCount: result.edges.length,
              stats: result.stats,
              nodes: result.nodes,
              edges: result.edges,
            }
          }

          const resultStr = JSON.stringify(resultForLlm)
          const truncated = resultStr.length > 60000
            ? resultStr.slice(0, 60000) + '... [truncated]'
            : resultStr

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: truncated,
          })
        } catch (error) {
          log(`${toolUse.name} FAILED: ${error.message}`)
          actions.push({ tool: toolUse.name, success: false, error: error.message })
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({ error: error.message }),
            is_error: true,
          })
        }
      }

      messages.push(
        { role: 'assistant', content: data.content },
        { role: 'user', content: toolResults },
      )
    } else {
      log(`stop_reason: ${data.stop_reason}`)
      messages.push(
        { role: 'assistant', content: data.content },
        { role: 'user', content: 'Continue. You have more turns available.' },
      )
    }
  }

  log(`max turns reached (${maxTurns})`)
  return {
    success: !!resultGraphId,
    summary: resultGraphId
      ? `Graph created: ${resultGraphId}`
      : `YouTube graph subagent hit max turns (${maxTurns}) before saving.`,
    turns: turn,
    actions,
    graphId: resultGraphId,
    viewUrl: resultViewUrl,
    maxTurnsReached: true,
  }
}

export { runYoutubeGraphSubagent, extractVideoId }
