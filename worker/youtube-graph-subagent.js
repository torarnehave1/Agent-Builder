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
// Tool implementations
// ---------------------------------------------------------------------------

function formatErrorValue(value, fallback = 'Unknown error') {
  if (!value) return fallback
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message || fallback
  if (typeof value === 'object') {
    if (typeof value.message === 'string') return value.message
    if (typeof value.error === 'string') return value.error
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

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
    throw new Error(formatErrorValue(data.error, `Transcript IO failed (status ${res.status})`))
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
  if (!transcriptText) {
    throw new Error(`Transcript IO returned no transcript text for videoId "${videoId}"`)
  }
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
    throw new Error(formatErrorValue(data.error, `process-transcript failed (status ${res.status})`))
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
    throw new Error(formatErrorValue(data.error, `saveGraphWithHistory failed (status ${res.status})`))
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
// Deterministic pipeline
// ---------------------------------------------------------------------------

async function runYoutubeGraphSubagent(input, env, onProgress, _executeTool) {
  const { url, youtubeUrl, task, userId } = input
  const sourceUrl = url || youtubeUrl || ''

  const log = (msg) => console.log(`[youtube-graph-subagent] ${msg}`)
  const progress = typeof onProgress === 'function' ? onProgress : () => {}

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

  const actions = []
  let currentTool = 'delegate_to_youtube_graph'
  let resultGraphId = null
  let resultViewUrl = null

  log(`started | url="${sourceUrl}" task="${(task || '').slice(0, 100)}"`)
  progress('Extracting video ID...')

  // This workflow is a fixed pipeline, so run it deterministically instead of
  // asking a second model to shuttle a large transcript between tools. The old
  // inner loop could fail after transcript fetch when the transcript made the
  // next Anthropic request too large, and object-shaped API errors surfaced in
  // the UI as "[object Object]".
  try {
    const sourceLanguage = /sourceLanguage\s*=\s*([A-Za-z-]+)/i.exec(task || '')?.[1] || 'auto'
    const targetLanguage = /targetLanguage\s*=\s*([A-Za-z-]+)/i.exec(task || '')?.[1] || 'norwegian'

    currentTool = 'extract_video_id'
    progress('Extracting video ID from URL...')
    const idResult = await executeYoutubeTool('extract_video_id', { url: sourceUrl }, env, userId, progress)
    actions.push({ tool: 'extract_video_id', success: true, summary: 'extract_video_id ok' })

    currentTool = 'fetch_youtube_transcript'
    progress('Fetching YouTube transcript...')
    const transcriptResult = await withHeartbeat(progress, fetchHeartbeats, 3000,
      () => executeYoutubeTool('fetch_youtube_transcript', { videoId: idResult.videoId }, env, userId, progress))
    actions.push({ tool: 'fetch_youtube_transcript', success: true, summary: 'fetch_youtube_transcript ok' })

    currentTool = 'process_transcript_to_graph'
    progress('Processing transcript with Grok...')
    const graphResult = await withHeartbeat(progress, grokHeartbeats, 3000,
      () => executeYoutubeTool('process_transcript_to_graph', {
        transcript: transcriptResult.transcriptText,
        sourceLanguage,
        targetLanguage,
      }, env, userId, progress))
    if (!graphResult.nodes.length) {
      throw new Error('process_transcript_to_graph returned zero nodes')
    }
    actions.push({
      tool: 'process_transcript_to_graph',
      success: true,
      summary: `Generated ${graphResult.nodes.length} nodes and ${graphResult.edges.length} edges`,
    })

    const videoTitle = transcriptResult.title || `YouTube Video ${idResult.videoId}`
    const title = `🎬 ${videoTitle} (${graphResult.nodes.length} deler)`
    const description = targetLanguage === 'norwegian'
      ? `Norsk kunnskapsgraf fra YouTube-video "${videoTitle}"${transcriptResult.channelTitle ? ` (${transcriptResult.channelTitle})` : ''}. Inneholder ${graphResult.nodes.length} tekstdeler.`
      : `Knowledge graph from YouTube video "${videoTitle}"${transcriptResult.channelTitle ? ` (${transcriptResult.channelTitle})` : ''}. Contains ${graphResult.nodes.length} text sections.`

    currentTool = 'save_generated_graph'
    progress('Saving new knowledge graph...')
    const saveResult = await withHeartbeat(progress, saveHeartbeats, 3000,
      () => executeYoutubeTool('save_generated_graph', {
        title,
        description,
        nodes: graphResult.nodes,
        edges: graphResult.edges,
        videoId: idResult.videoId,
        videoTitle,
        channelTitle: transcriptResult.channelTitle,
        lengthSeconds: transcriptResult.lengthSeconds,
        publishDate: transcriptResult.publishDate,
        videoDescription: transcriptResult.description,
      }, env, userId, progress))
    actions.push({
      tool: 'save_generated_graph',
      success: true,
      summary: `Saved graph ${saveResult.graphId}`,
    })

    resultGraphId = saveResult.graphId
    resultViewUrl = saveResult.viewUrl
    progress('Complete.')

    return {
      success: true,
      summary: `Created graph ${resultGraphId} from "${videoTitle}" with ${saveResult.nodeCount} nodes.`,
      turns: 4,
      actions,
      graphId: resultGraphId,
      viewUrl: resultViewUrl,
      videoTitle,
      nodeCount: saveResult.nodeCount,
      edgeCount: saveResult.edgeCount,
      sourceLanguage,
      targetLanguage,
    }
  } catch (error) {
    const message = formatErrorValue(error)
    log(`pipeline FAILED: ${message}`)
    if (actions.length === 0 || actions[actions.length - 1].success) {
      actions.push({ tool: currentTool, success: false, error: message })
    }
    return {
      success: false,
      error: message,
      summary: `YouTube graph pipeline failed: ${message}`,
      turns: Math.max(actions.length, 1),
      actions,
      graphId: resultGraphId,
      viewUrl: resultViewUrl,
    }
  }
}

export { runYoutubeGraphSubagent, extractVideoId }
