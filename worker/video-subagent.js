/**
 * Video & Streaming Subagent
 *
 * Specialized subagent for managing Cloudflare Stream videos and live inputs.
 * Handles: list/upload/delete videos, create/manage live inputs, create
 * cloudflare-video and cloudflare-live nodes in knowledge graphs.
 *
 * All video operations go through the videostream-worker proxy at
 * videostream.vegvisr.org (or videostream-worker.torarnehave.workers.dev).
 */

import { TOOL_DEFINITIONS } from './tool-definitions.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VIDEOSTREAM_API = 'https://videostream-worker.torarnehave.workers.dev' // fallback if no service binding

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

const VIDEO_SYSTEM_PROMPT = `You are a Vegvisr Video & Streaming specialist. You manage Cloudflare Stream videos and live streams, and create video nodes in knowledge graphs.

## Your Tools

### Video Management (via videostream-worker proxy)
- \`video_list\` — List all uploaded videos
- \`video_details\` — Get video details (playback URLs, status, duration)
- \`video_playback\` — Get playback URLs (HLS, DASH, thumbnail, preview)
- \`video_upload_url\` — Upload a video from a URL
- \`video_direct_upload\` — Get a one-time upload URL for client-side upload
- \`video_delete\` — Delete a video

### Live Stream Management
- \`live_list\` — List all live inputs
- \`live_details\` — Get live input details (RTMP/SRT credentials)
- \`live_create\` — Create a new live input (returns RTMP key + SRT URL)
- \`live_update\` — Update live input configuration
- \`live_delete\` — Delete a live input

### Knowledge Graph Integration
- \`create_node\` — Create cloudflare-video or cloudflare-live nodes in a graph
- \`patch_node\` — Update existing video/live nodes
- \`read_graph\` — Read graph to find existing video nodes
- \`read_node\` — Read a specific node
- \`add_edge\` — Link video nodes to other nodes

## Node Types

### cloudflare-video
- type: "cloudflare-video"
- path: 32-char hex video ID (e.g. "53a48c844fbf810d0a0a92c5109f9e58")
- info: Optional markdown description
- color: "#f48120" (orange)
- metadata: { videoId, duration, readyToStream, hls, thumbnail }

### cloudflare-live
- type: "cloudflare-live"
- path: playback video ID (set when stream starts)
- info: Optional markdown description
- color: "#ef4444" (red)
- metadata: { status: "waiting"|"streaming"|"ended", liveInputId, rtmpsUrl, streamKey, srtUrl }

## Workflows

### Upload video and create node:
1. \`video_upload_url\` with the source URL
2. \`video_details\` to get the video ID and playback info
3. \`create_node\` with type "cloudflare-video", path = videoId

### Create a live stream node:
1. \`live_create\` to get RTMP/SRT credentials
2. \`create_node\` with type "cloudflare-live", metadata = credentials
3. Tell the user the RTMP URL and stream key for OBS

### Add video to existing graph:
1. \`read_graph\` to see existing nodes
2. \`video_list\` or \`video_details\` to find the video
3. \`create_node\` with type "cloudflare-video"
4. \`add_edge\` to link video to related nodes

## Important
- Video IDs are 32-character hex strings
- Customer subdomain: customer-7tiaylt74yxtwkg8.cloudflarestream.com
- Live recordings auto-delete after 30 days by default — warn users about this
- Always include RTMP credentials when creating live nodes so users can stream from OBS
- After uploading, check readyToStream — it may take a moment to process

After completing your task, provide a brief summary including any video IDs, graph IDs, and relevant URLs.`

// ---------------------------------------------------------------------------
// Video-specific tool definitions (proxy calls to videostream-worker)
// ---------------------------------------------------------------------------

const VIDEO_TOOLS = [
  {
    name: 'video_list',
    description: 'List all uploaded Cloudflare Stream videos. Returns video IDs, titles, durations, and status.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'video_details',
    description: 'Get full details for a specific video: playback URLs, duration, status, thumbnail.',
    input_schema: {
      type: 'object',
      properties: {
        videoId: { type: 'string', description: '32-char hex Cloudflare Stream video ID' }
      },
      required: ['videoId']
    }
  },
  {
    name: 'video_playback',
    description: 'Get playback URLs for a video: HLS, DASH, thumbnail, preview, and streaming status.',
    input_schema: {
      type: 'object',
      properties: {
        videoId: { type: 'string', description: '32-char hex Cloudflare Stream video ID' }
      },
      required: ['videoId']
    }
  },
  {
    name: 'video_upload_url',
    description: 'Upload a video to Cloudflare Stream from a URL. Returns the new video ID.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Source video URL to upload from' },
        meta: { type: 'object', description: 'Optional metadata (e.g. { name: "My Video" })' }
      },
      required: ['url']
    }
  },
  {
    name: 'video_direct_upload',
    description: 'Get a one-time upload URL for client-side video upload. Returns uploadURL that the client POSTs the file to.',
    input_schema: {
      type: 'object',
      properties: {
        maxDurationSeconds: { type: 'number', description: 'Max video duration in seconds (default: 3600)' },
        meta: { type: 'object', description: 'Optional metadata' }
      }
    }
  },
  {
    name: 'video_delete',
    description: 'Delete a video from Cloudflare Stream.',
    input_schema: {
      type: 'object',
      properties: {
        videoId: { type: 'string', description: '32-char hex Cloudflare Stream video ID' }
      },
      required: ['videoId']
    }
  },
  {
    name: 'live_list',
    description: 'List all Cloudflare Stream live inputs.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'live_details',
    description: 'Get live input details including RTMP URL, stream key, SRT URL, and recording status.',
    input_schema: {
      type: 'object',
      properties: {
        liveInputId: { type: 'string', description: '32-char hex live input ID' }
      },
      required: ['liveInputId']
    }
  },
  {
    name: 'live_create',
    description: 'Create a new Cloudflare Stream live input. Returns RTMP URL + stream key for OBS.',
    input_schema: {
      type: 'object',
      properties: {
        meta: { type: 'object', description: 'Optional metadata (e.g. { name: "My Stream" })' },
        recording: { type: 'object', description: 'Recording config. E.g. { mode: "automatic", timeoutSeconds: 0 }' },
        deleteRecordingAfterDays: { type: 'number', description: 'Auto-delete recordings after N days. 0 = keep forever. Default: 45' }
      }
    }
  },
  {
    name: 'live_update',
    description: 'Update a live input configuration.',
    input_schema: {
      type: 'object',
      properties: {
        liveInputId: { type: 'string', description: '32-char hex live input ID' },
        meta: { type: 'object', description: 'Updated metadata' },
        recording: { type: 'object', description: 'Updated recording config' },
        deleteRecordingAfterDays: { type: 'number', description: 'Updated auto-delete days' }
      },
      required: ['liveInputId']
    }
  },
  {
    name: 'live_delete',
    description: 'Delete a live input from Cloudflare Stream.',
    input_schema: {
      type: 'object',
      properties: {
        liveInputId: { type: 'string', description: '32-char hex live input ID' }
      },
      required: ['liveInputId']
    }
  },
]

// ---------------------------------------------------------------------------
// KG tools the subagent can use
// ---------------------------------------------------------------------------

const KG_TOOL_NAMES = new Set([
  'create_node',
  'patch_node',
  'read_graph',
  'read_node',
  'add_edge',
  'create_graph',
  'get_node_types_reference',
])

// ---------------------------------------------------------------------------
// Tool getter — video tools + filtered KG tools
// ---------------------------------------------------------------------------

function getVideoSubagentTools() {
  const kgTools = TOOL_DEFINITIONS.filter(t => KG_TOOL_NAMES.has(t.name))
  return [...VIDEO_TOOLS, ...kgTools]
}

// ---------------------------------------------------------------------------
// Video tool executor — calls videostream-worker
// ---------------------------------------------------------------------------

async function executeVideoTool(toolName, toolInput, env) {
  const fetcher = env?.VIDEOSTREAM_WORKER || globalThis
  const api = env?.VIDEOSTREAM_WORKER ? 'https://videostream-worker' : VIDEOSTREAM_API

  const f = fetcher.fetch.bind(fetcher)

  switch (toolName) {
    case 'video_list': {
      const res = await f(`${api}/list`)
      return await res.json()
    }
    case 'video_details': {
      const res = await f(`${api}/video/${toolInput.videoId}`)
      return await res.json()
    }
    case 'video_playback': {
      const res = await f(`${api}/playback/${toolInput.videoId}`)
      return await res.json()
    }
    case 'video_upload_url': {
      const res = await f(`${api}/upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: toolInput.url, meta: toolInput.meta || {} }),
      })
      return await res.json()
    }
    case 'video_direct_upload': {
      const res = await f(`${api}/direct-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxDurationSeconds: toolInput.maxDurationSeconds || 3600,
          meta: toolInput.meta || {},
        }),
      })
      return await res.json()
    }
    case 'video_delete': {
      const res = await f(`${api}/delete/${toolInput.videoId}`, { method: 'DELETE' })
      return await res.json()
    }
    case 'live_list': {
      const res = await f(`${api}/live/list`)
      return await res.json()
    }
    case 'live_details': {
      const res = await f(`${api}/live/${toolInput.liveInputId}`)
      return await res.json()
    }
    case 'live_create': {
      const body = {}
      if (toolInput.meta) body.meta = toolInput.meta
      if (toolInput.recording) body.recording = toolInput.recording
      if (toolInput.deleteRecordingAfterDays !== undefined) {
        body.deleteRecordingAfterDays = toolInput.deleteRecordingAfterDays
      }
      const res = await f(`${api}/live/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return await res.json()
    }
    case 'live_update': {
      const { liveInputId, ...body } = toolInput
      const res = await f(`${api}/live/${liveInputId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return await res.json()
    }
    case 'live_delete': {
      const res = await f(`${api}/live/${toolInput.liveInputId}`, { method: 'DELETE' })
      return await res.json()
    }
    default:
      return null // Not a video tool — pass to KG executor
  }
}

// ---------------------------------------------------------------------------
// Inner agent loop
// ---------------------------------------------------------------------------

async function runVideoSubagent(input, env, onProgress, executeTool) {
  const { graphId, nodeId, task, userId } = input
  const maxTurns = 15
  const model = 'claude-sonnet-4-20250514'

  const log = (msg) => console.log(`[video-subagent] ${msg}`)
  const progress = typeof onProgress === 'function' ? onProgress : () => {}

  const thinkingMessages = [
    'Connecting to video service...',
    'Scanning video library...',
    'Loading stream data...',
    'Processing video request...',
    'Checking playback status...',
    'Preparing video node...',
    'Configuring stream settings...',
    'Verifying video assets...',
    'Building video graph...',
    'Updating metadata...',
    'Linking video nodes...',
    'Checking stream health...',
    'Finalizing video setup...',
    'Almost done...',
    'Complete.',
  ]
  const toolMessages = {
    video_list: ['Listing all videos...', 'Scanning the video library...'],
    video_details: ['Loading video details...', 'Reading video metadata...'],
    video_playback: ['Getting playback URLs...', 'Loading stream endpoints...'],
    video_upload_url: ['Uploading video from URL...', 'Transferring video to Stream...'],
    video_direct_upload: ['Generating upload URL...', 'Preparing upload endpoint...'],
    video_delete: ['Deleting video...', 'Removing from Stream...'],
    live_list: ['Listing live inputs...', 'Scanning live streams...'],
    live_details: ['Loading live input details...', 'Reading RTMP credentials...'],
    live_create: ['Creating live input...', 'Setting up RTMP endpoint...'],
    live_update: ['Updating live input...', 'Applying stream changes...'],
    live_delete: ['Deleting live input...', 'Removing stream endpoint...'],
    create_node: ['Creating video node in graph...', 'Adding to knowledge graph...'],
    patch_node: ['Updating video node...', 'Patching node metadata...'],
    read_graph: ['Reading graph structure...', 'Loading graph data...'],
    read_node: ['Reading node details...'],
    add_edge: ['Linking nodes...', 'Connecting video to graph...'],
    create_graph: ['Creating new graph...'],
  }

  // Build initial user message with context
  let userMessage = `## Task\n${task}`
  if (graphId) userMessage += `\n\n## Context\n- graphId: ${graphId}`
  if (nodeId) userMessage += `\n- nodeId: ${nodeId}`

  const messages = [{ role: 'user', content: userMessage }]
  const tools = getVideoSubagentTools()
  let turn = 0
  const actions = []

  log(`started | graphId=${graphId || 'none'} nodeId=${nodeId || 'none'} task="${task.slice(0, 100)}"`)
  progress('Connecting to video service...')

  while (turn < maxTurns) {
    turn++
    log(`turn ${turn}/${maxTurns}`)
    progress(thinkingMessages[turn - 1] || `Still working... (${turn})`)

    const response = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userId || 'video-subagent',
        messages,
        model,
        max_tokens: 8192,
        temperature: 0.2,
        system: VIDEO_SYSTEM_PROMPT,
        tools,
      }),
    })

    const data = await response.json()
    if (!response.ok) {
      log(`ERROR: ${JSON.stringify(data.error)}`)
      return { success: false, error: data.error || 'Anthropic API error', turns: turn, actions }
    }

    // End turn — return summary
    if (data.stop_reason === 'end_turn') {
      const text = (data.content || []).filter(c => c.type === 'text').map(b => b.text).join('\n')
      log(`end_turn — summary: ${text.slice(0, 200)}`)
      return {
        success: true,
        summary: text,
        turns: turn,
        actions,
        graphId: graphId || actions.find(a => a.graphId)?.graphId,
        nodeId: nodeId || actions.find(a => a.nodeId)?.nodeId,
      }
    }

    // Tool use — execute sequentially
    if (data.stop_reason === 'tool_use') {
      const toolUses = (data.content || []).filter(c => c.type === 'tool_use')
      log(`tool_use — ${toolUses.length} tools: [${toolUses.map(t => t.name).join(', ')}]`)

      const toolResults = []
      for (const toolUse of toolUses) {
        const msgs = toolMessages[toolUse.name] || [`Working on ${toolUse.name}...`]
        progress(msgs[Math.floor(Math.random() * msgs.length)])

        try {
          // Try video tool first, then fall back to KG tool executor
          let result = await executeVideoTool(toolUse.name, toolUse.input, env)
          if (result === null) {
            // KG tool — use the shared executor
            result = await executeTool(toolUse.name, { ...toolUse.input, userId }, env, {})
          }

          actions.push({
            tool: toolUse.name,
            success: true,
            graphId: toolUse.input.graphId || result.graphId,
            nodeId: toolUse.input.nodeId || result.nodeId,
            summary: result.message || `${toolUse.name} ok`,
          })

          const resultStr = JSON.stringify(result)
          const truncated = resultStr.length > 8000
            ? resultStr.slice(0, 8000) + '... [truncated]'
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
    success: actions.some(a => a.success),
    summary: `Video subagent completed ${actions.length} actions in ${turn} turns (max turns reached).`,
    turns: turn,
    actions,
    graphId,
    nodeId,
    maxTurnsReached: true,
  }
}

export { runVideoSubagent }
