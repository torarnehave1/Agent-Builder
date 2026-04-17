/**
 * Real end-to-end test of the YouTube → Graph subagent pipeline.
 *
 * Calls the live endpoints directly (bypasses the Anthropic loop) and
 * validates each pipeline step with real data. Mirrors exactly what the
 * subagent's tool executors do in production, so if this passes the
 * subagent logic is correct.
 *
 * Run:
 *   node worker/test-youtube-subagent-real.js
 *
 * Optional env:
 *   TEST_SAVE=1           — actually save the graph (otherwise just log payload)
 *   X_API_TOKEN=...       — required when TEST_SAVE=1
 *   YT_URL=...            — override the default test URL
 */

import { extractVideoId } from './youtube-graph-subagent.js'

const DEFAULT_URL = 'https://youtu.be/Gv8D3SxQ9xU?si=DQevgYOlaGLuH9eQ'
const YT_URL = process.env.YT_URL || DEFAULT_URL
const TEST_SAVE = process.env.TEST_SAVE === '1'
const X_API_TOKEN = process.env.X_API_TOKEN || ''
const USER_ID = process.env.USER_ID || 'torarnehave@gmail.com'

const step = (n, title) => console.log(`\n=== Step ${n}: ${title} ===`)
const ok = (msg) => console.log(`  ✓ ${msg}`)
const fail = (msg) => { console.error(`  ✗ ${msg}`); process.exit(1) }

async function fetchTranscript(videoId) {
  const res = await fetch(`https://api.vegvisr.org/youtube-transcript-io/${encodeURIComponent(videoId)}`)
  const data = await res.json()
  if (!res.ok || !data.success) throw new Error(`Transcript IO failed: ${JSON.stringify(data).slice(0, 200)}`)
  const outer = Array.isArray(data.transcript) ? (data.transcript[0] || {}) : {}
  const micro = outer.microformat?.playerMicroformatRenderer || {}
  const transcriptText = String(outer.text || '').trim()
  const tracks = Array.isArray(outer.tracks) ? outer.tracks : []
  return {
    videoId: data.videoId || videoId,
    title: outer.title || micro.title?.simpleText || '',
    channelTitle: micro.ownerChannelName || '',
    lengthSeconds: micro.lengthSeconds ? Number(micro.lengthSeconds) : undefined,
    publishDate: micro.publishDate || undefined,
    transcriptText,
    segmentCount: tracks[0]?.transcript?.length || 0,
  }
}

async function processTranscript(transcript, opts = {}) {
  const body = {
    transcript,
    sourceLanguage: opts.sourceLanguage || 'auto',
    targetLanguage: opts.targetLanguage || 'norwegian',
    userId: opts.userId || undefined,
  }
  const res = await fetch('https://grok.vegvisr.org/process-transcript', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`process-transcript failed (${res.status}): ${JSON.stringify(data).slice(0, 400)}`)
  const kg = data.knowledgeGraph || {}
  return {
    nodes: Array.isArray(kg.nodes) ? kg.nodes : [],
    edges: Array.isArray(kg.edges) ? kg.edges : [],
    stats: data.stats || {},
  }
}

function buildSavePayload({ title, description, nodes, edges, videoId, videoTitle }) {
  const nowIso = new Date().toISOString()
  const graphId = `graph_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const positioned = nodes.map((n, i) => ({
    ...n,
    id: n.id || `fulltext_${Date.now()}_${i}`,
    visible: n.visible !== false,
    position: n.position || { x: 100 + (i % 3) * 300, y: 100 + Math.floor(i / 3) * 250 },
  }))
  return {
    graphId,
    payload: {
      id: graphId,
      graphData: {
        metadata: {
          title,
          description,
          createdBy: 'agent@vegvisr.org',
          version: 1,
          createdAt: nowIso,
          updatedAt: nowIso,
          source: { type: 'youtube', videoId, videoTitle: videoTitle || '' },
        },
        nodes: positioned,
        edges,
      },
      override: true,
    },
  }
}

async function saveGraph(payload) {
  const headers = { 'Content-Type': 'application/json' }
  if (X_API_TOKEN) headers['X-API-Token'] = X_API_TOKEN
  const res = await fetch('https://knowledge.vegvisr.org/saveGraphWithHistory', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { raw: text } }
  return { ok: res.ok, status: res.status, data }
}

async function main() {
  console.log(`YouTube → Graph subagent pipeline test`)
  console.log(`URL: ${YT_URL}`)

  // Step 1: extract_video_id
  step(1, 'extract_video_id')
  const videoId = extractVideoId(YT_URL)
  if (!videoId) fail(`Could not extract videoId`)
  if (videoId.length !== 11) fail(`Expected 11-char videoId, got "${videoId}"`)
  ok(`videoId = ${videoId}`)

  // Unit: a few extra URL shapes
  const samples = [
    ['https://www.youtube.com/watch?v=Gv8D3SxQ9xU', 'Gv8D3SxQ9xU'],
    ['https://youtu.be/Gv8D3SxQ9xU?si=abc', 'Gv8D3SxQ9xU'],
    ['Gv8D3SxQ9xU', 'Gv8D3SxQ9xU'],
    ['https://www.youtube.com/shorts/Gv8D3SxQ9xU', 'Gv8D3SxQ9xU'],
    ['https://www.youtube.com/embed/Gv8D3SxQ9xU', 'Gv8D3SxQ9xU'],
  ]
  for (const [url, expected] of samples) {
    const got = extractVideoId(url)
    if (got !== expected) fail(`extractVideoId("${url}") = "${got}", expected "${expected}"`)
  }
  ok(`extractVideoId handles all URL shapes`)

  // Step 2: fetch_youtube_transcript
  step(2, 'fetch_youtube_transcript')
  const t = await fetchTranscript(videoId)
  if (!t.transcriptText || t.transcriptText.length < 50) fail(`Transcript too short: ${t.transcriptText?.length || 0} chars`)
  ok(`title = "${t.title}"`)
  ok(`channel = "${t.channelTitle}"`)
  ok(`segments = ${t.segmentCount}, transcript = ${t.transcriptText.length} chars`)

  // Step 3: process_transcript_to_graph
  step(3, 'process_transcript_to_graph (grok-worker)')
  console.log('  … calling grok, can take 15-60s …')
  const started = Date.now()
  const graph = await processTranscript(t.transcriptText, { userId: USER_ID })
  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  if (graph.nodes.length === 0) fail(`process-transcript returned zero nodes`)
  ok(`nodes = ${graph.nodes.length}, edges = ${graph.edges.length}, elapsed = ${elapsed}s`)
  const sample = graph.nodes[0]
  if (!sample.label || !sample.info) fail(`First node is missing label or info: ${JSON.stringify(sample).slice(0, 200)}`)
  ok(`first node: label="${(sample.label || '').slice(0, 60)}", info=${(sample.info || '').length} chars`)
  ok(`stats = ${JSON.stringify(graph.stats)}`)

  // Step 4: save_generated_graph (build payload; only POST if TEST_SAVE=1)
  step(4, 'save_generated_graph')
  const nodeCount = graph.nodes.length
  const titleBase = t.title || 'YouTube-transkript'
  const title = `🎬 ${titleBase.slice(0, 60)}${titleBase.length > 60 ? '...' : ''} (${nodeCount} deler)`
  const description = `Norsk kunnskapsgraf fra YouTube-video "${titleBase}" (${t.channelTitle}). Generert av YouTube-graph-subagent. Inneholder ${nodeCount} tekstdeler.`
  const { graphId, payload } = buildSavePayload({
    title, description,
    nodes: graph.nodes, edges: graph.edges,
    videoId, videoTitle: t.title,
  })
  ok(`generated graphId = ${graphId}`)
  ok(`title = "${title}"`)
  ok(`payload size = ${JSON.stringify(payload).length} bytes`)

  if (TEST_SAVE) {
    if (!X_API_TOKEN) fail(`TEST_SAVE=1 requires X_API_TOKEN env var`)
    console.log('  … saving graph …')
    const { ok: saved, status, data } = await saveGraph(payload)
    if (!saved) fail(`saveGraphWithHistory failed (${status}): ${JSON.stringify(data).slice(0, 400)}`)
    ok(`saved. status=${status} response=${JSON.stringify(data).slice(0, 200)}`)
    console.log(`\n  ▶ View: https://www.vegvisr.org/gnew-viewer?graphId=${graphId}`)
  } else {
    console.log(`  (TEST_SAVE not set — skipping actual save)`)
  }

  console.log(`\n✅ All pipeline steps passed.`)
}

main().catch(err => { console.error('\n❌ Test failed:', err.message); process.exit(1) })
