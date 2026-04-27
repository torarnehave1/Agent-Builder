/**
 * Agent Worker — HTTP Router
 *
 * Thin routing layer. All logic lives in:
 *   - tool-executors.js   (tool runtime functions)
 *   - tool-definitions.js (tool schemas)
 *   - system-prompt.js    (system prompt + reference docs)
 *   - agent-loop.js       (streaming + non-streaming agent loops)
 *   - openapi-tools.js    (dynamic OpenAPI-to-tool converter)
 *   - template-registry.js (HTML template management)
 */

import { getTemplate, getTemplateVersion, extractTemplateId, listTemplates, DEFAULT_TEMPLATE_ID } from './template-registry.js'
import { loadOpenAPITools } from './openapi-tools.js'
import { TOOL_DEFINITIONS, WEB_SEARCH_TOOL } from './tool-definitions.js'
import { executeTool, executeCreateHtmlFromTemplate, executeAnalyzeNode, executeAnalyzeGraph } from './tool-executors.js'
import { streamingAgentLoop, executeAgent } from './agent-loop.js'
import { CHAT_SYSTEM_PROMPT } from './system-prompt.js'
import { runChatbotSubagent } from './chatbot-subagent.js'
import { routeAgentRequest } from 'agents'
import { VegvisrAgent } from './agent.js'

// ---------------------------------------------------------------------------
// Agent version — bump this string when deploying an improvement.
// Every session in the stats DB will be tagged with this version so you can
// compare metrics before/after each change.
// Format: v<number>-<short-description>
// ---------------------------------------------------------------------------
const AGENT_VERSION = 'v5-stats-db'
const AGENT_VERSION_NOTE = 'KG fast-path, history cap, self-check, tool result trimming, KG subagent max turns 10, stats DB'

// ---------------------------------------------------------------------------
// KG Fast-path — bypass Claude for simple read operations
// Saves an entire Anthropic API call for unambiguous KG read queries.
// ---------------------------------------------------------------------------

function detectKgFastPath(message) {
  const m = message.toLowerCase().trim()

  // "list meta areas" / "what meta areas exist" / "show meta areas"
  // Require meta areas to be the primary subject — not just a qualifier like "with meta area X"
  if (/(?:list|show|what|get)\s+(all\s+)?meta.?areas?\b/.test(m)) {
    return { action: 'list_meta_areas', params: {} }
  }

  // Only match clearly plural / bulk-list intents — e.g. "list graphs", "show all graphs", "what graphs do I have"
  // Do NOT match: "list the last graph", "find this graph", "the graph" — those need the agent
  if (/(?:list|show|get|find)\s+(all\s+)?graphs\b/.test(m) || /\bgraphs\b.{0,15}(?:do i have|exist|available)/.test(m)) {
    // Bail out if the message contains intent for a specific/recent/single graph
    if (/\b(last|latest|recent|first|specific|that|this|the)\b/.test(m)) return null
    const metaMatch = message.match(/meta.?area[:\s]+([A-Z][A-Z0-9 _-]+)/i)
                   || message.match(/\barea[:\s]+([A-Z][A-Z0-9 _-]+)/i)
    const metaArea = metaMatch ? metaMatch[1].trim().toUpperCase() : null
    return { action: 'list_graphs', params: metaArea ? { metaArea } : {} }
  }

  return null
}

async function executeKgFastPath({ action, params }, writer, encoder, env, userId) {
  const write = (event, data) =>
    writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
  const startTime = Date.now()

  try {
    if (action === 'list_meta_areas') {
      const res = await env.KG_WORKER.fetch('https://knowledge-graph-worker/listMetaAreas')
      const data = res.ok ? await res.json() : null
      const areas = data?.metaAreas || data?.areas || []
      if (areas.length === 0) {
        write('text', { content: 'No meta areas found.' })
      } else {
        const lines = areas.map(a => `- **${a.metaArea || a}** (${a.count || ''} graphs)`).join('\n')
        write('text', { content: `## Meta Areas\n\n${lines}` })
      }
    }

    if (action === 'list_graphs') {
      const qs = params.metaArea ? `?metaArea=${encodeURIComponent(params.metaArea)}&limit=80` : '?limit=80'
      const res = await env.KG_WORKER.fetch(`https://knowledge-graph-worker/getknowgraphsummaries${qs}`, { headers: { 'x-user-role': 'Superadmin' } })
      const data = res.ok ? await res.json() : null
      const graphs = data?.graphs || data || []
      if (!Array.isArray(graphs) || graphs.length === 0) {
        const label = params.metaArea ? ` with meta area **${params.metaArea}**` : ''
        write('text', { content: `No graphs found${label}.` })
      } else {
        const label = params.metaArea ? ` (meta area: ${params.metaArea})` : ''
        const lines = graphs.map(g =>
          `- [${g.title || g.id}](https://www.vegvisr.org/gnew-viewer?graphId=${g.id})${g.metaArea ? ` — ${g.metaArea}` : ''}`
        ).join('\n')
        write('text', { content: `## Graphs${label}\n\n${lines}` })
      }
    }

    write('done', { turns: 0, fastPath: true })

    if (env.STATS_DB) {
      const now = new Date().toISOString()
      await env.STATS_DB.prepare(
        `INSERT INTO sessions (id, user_id, started_at, ended_at, duration_ms, turns, fast_path, fast_path_action, model, success, version, version_note, cost_usd)
         VALUES (?, ?, ?, ?, ?, 0, 1, ?, 'fast-path', 1, ?, ?, 0)`
      ).bind(
        crypto.randomUUID(), userId || 'unknown',
        new Date(startTime).toISOString(), now, Date.now() - startTime,
        action, AGENT_VERSION, AGENT_VERSION_NOTE
      ).run()
    }
  } catch (err) {
    write('error', { error: `Fast-path failed: ${err.message}` })
  }
}

/**
 * Load dynamic behavior rules from graph_system_prompt.
 * Falls back gracefully if the graph is unavailable.
 */
async function loadDynamicPrompt(env) {
  try {
    const res = await env.KG_WORKER.fetch('https://knowledge-graph-worker/getknowgraph?id=graph_system_prompt')
    if (!res.ok) return ''
    const data = await res.json()
    const nodes = data.nodes || []

    const rules = nodes.filter(n => n.type === 'system-rule').sort((a, b) => (a.metadata?.priority || 99) - (b.metadata?.priority || 99))
    const routing = nodes.filter(n => n.type === 'system-routing')
    const learnings = nodes.filter(n => n.type === 'system-learning')

    if (rules.length === 0 && routing.length === 0 && learnings.length === 0) return ''

    let prompt = '\n\n## Dynamic Behavior Rules (from graph_system_prompt)\n'

    if (rules.length > 0) {
      prompt += '\n### Rules\n'
      for (const r of rules) {
        prompt += `- **${r.label}**: ${r.info}\n`
      }
    }

    if (routing.length > 0) {
      prompt += '\n### Routing\n'
      for (const r of routing) {
        prompt += `- **${r.label}**: ${r.info}\n`
      }
    }

    if (learnings.length > 0) {
      const selfKnowledge = learnings.filter(l => l.metadata?.category === 'architecture' || l.metadata?.category === 'self-knowledge')
      const behaviorLearnings = learnings.filter(l => l.metadata?.category !== 'architecture' && l.metadata?.category !== 'self-knowledge')

      if (selfKnowledge.length > 0) {
        prompt += '\n### Self-Knowledge (about your own system)\n'
        for (const l of selfKnowledge) {
          prompt += `- **${l.label}**: ${l.info}\n`
        }
      }

      if (behaviorLearnings.length > 0) {
        prompt += '\n### Learned Behaviors\n'
        for (const l of behaviorLearnings) {
          prompt += `- **${l.label}**: ${l.info}\n`
        }
      }
    }

    return prompt
  } catch (e) {
    console.error('[loadDynamicPrompt] Failed to load graph_system_prompt:', e.message)
    return ''
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const pathname = url.pathname

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Content-Type': 'application/json'
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    // Route WebSocket + agent requests to VegvisrAgent Durable Object
    const agentResponse = await routeAgentRequest(request, env)
    if (agentResponse) {
      // WebSocket upgrade responses (101) must not be modified
      if (agentResponse.status === 101 || request.headers.get('Upgrade') === 'websocket') {
        return agentResponse
      }
      // Add CORS headers to HTTP responses from agent routes (e.g. /get-messages)
      const newHeaders = new Headers(agentResponse.headers)
      newHeaders.set('Access-Control-Allow-Origin', '*')
      newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
      newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      return new Response(agentResponse.body, {
        status: agentResponse.status,
        statusText: agentResponse.statusText,
        headers: newHeaders,
      })
    }

    try {
      // GET /bots — List all registered chat bots (for @mention in AgentChat)
      if (pathname === '/bots' && request.method === 'GET') {
        // Query bots directly from CHAT_DB — bots are global, not per-user
        const { results } = await env.CHAT_DB.prepare(
          'SELECT id, name, username, avatar_url, is_active FROM chat_bots WHERE is_active = 1 ORDER BY name'
        ).all()
        const bots = (results || []).map(b => ({ id: b.id, name: b.name, username: b.username, avatar_url: b.avatar_url }))
        return new Response(JSON.stringify({ bots }), { headers: corsHeaders })
      }

      // POST /api/data-node/submit — Public form submission endpoint
      // Landing pages POST here to append records to data-nodes (no auth required)
      if (pathname === '/api/data-node/submit' && request.method === 'POST') {
        const body = await request.json()
        const { graphId, nodeId, record } = body

        if (!graphId || !nodeId || !record || typeof record !== 'object') {
          return new Response(JSON.stringify({ error: 'graphId, nodeId, and record are required' }), { status: 400, headers: corsHeaders })
        }

        // Add metadata to record
        record._id = crypto.randomUUID()
        record._ts = new Date().toISOString()

        // Fetch graph via service binding (no auth needed)
        const getRes = await env.KG_WORKER.fetch(
          `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(graphId)}&nodeId=${encodeURIComponent(nodeId)}`
        )
        if (!getRes.ok) {
          return new Response(JSON.stringify({ error: 'Graph or node not found' }), { status: 404, headers: corsHeaders })
        }
        const graphData = await getRes.json()
        const node = (graphData.nodes || []).find(n => n.id === nodeId)
        if (!node || node.type !== 'data-node') {
          return new Response(JSON.stringify({ error: 'data-node not found' }), { status: 404, headers: corsHeaders })
        }
        const expectedVersion = Number(graphData?.metadata?.version || 0)

        // Parse existing records, append new one
        let records = []
        try { records = JSON.parse(node.info || '[]') } catch { records = [] }
        if (!Array.isArray(records)) records = []
        records.push(record)

        // Patch node via service binding (KG worker encrypts automatically)
        const patchRes = await env.KG_WORKER.fetch('https://knowledge-graph-worker/patchNode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ graphId, nodeId, fields: { info: JSON.stringify(records) }, expectedVersion })
        })
        if (!patchRes.ok) {
          const err = await patchRes.json().catch(() => ({}))
          return new Response(JSON.stringify({ error: err.error || 'Failed to save' }), { status: 500, headers: corsHeaders })
        }

        return new Response(JSON.stringify({ success: true, recordId: record._id, recordCount: records.length }), { headers: corsHeaders })
      }

      // POST /test-youtube — Hypothesis B v7 test:
      // Harvests REAL youtube-video nodes from existing graphs (no fabrication).
      // Gemma picks the best fit for the topic, then we build ONE graph with
      // BOTH grammars demonstrated:
      //   Node A: standalone youtube-video node (path = original URL)
      //   Node B: fulltext node embedding the same video via [YOUTUBE src=...] grammar
      // Body: { topic: string, sampleSize?: number (default 12) }
      if (pathname === '/test-youtube' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}))
        const topic = (body.topic || '').toString().trim()
        const sampleSize = Math.min(Math.max(parseInt(body.sampleSize, 10) || 12, 3), 25)
        if (!topic) {
          return new Response(JSON.stringify({ error: 'topic is required' }), { status: 400, headers: corsHeaders })
        }

        async function askSlot(systemPrompt, userPrompt, maxTokens = 1500) {
          const resp = await env.AI.run('@cf/google/gemma-4-26b-a4b-it', {
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user',   content: userPrompt },
            ],
            max_tokens: maxTokens,
          })
          const choice = resp?.choices?.[0]?.message || {}
          const finishReason = resp?.choices?.[0]?.finish_reason || null
          const value = (choice.content || resp?.response || '').toString().trim()
          return { value, finishReason }
        }

        // 1. Search graphs for youtube-video nodes.
        const searchRes = await env.KG_WORKER.fetch(
          'https://knowledge.vegvisr.org/searchGraphs?q=youtube&nodeType=youtube-video&limit=20',
        )
        if (!searchRes.ok) {
          return new Response(JSON.stringify({ error: 'searchGraphs failed', status: searchRes.status }), { status: 502, headers: corsHeaders })
        }
        const searchData = await searchRes.json()
        const graphIds = (searchData.results || []).map((r) => r.id).filter(Boolean)
        if (!graphIds.length) {
          return new Response(JSON.stringify({ error: 'No graphs with youtube-video nodes found' }), { status: 404, headers: corsHeaders })
        }

        // 2. Harvest real youtube-video nodes from those graphs (parallel fetch).
        const fetched = await Promise.all(graphIds.slice(0, 8).map(async (gid) => {
          try {
            const r = await env.KG_WORKER.fetch(`https://knowledge.vegvisr.org/getknowgraph?id=${encodeURIComponent(gid)}`)
            if (!r.ok) return []
            const g = await r.json()
            return (g.nodes || [])
              .filter((n) => n.type === 'youtube-video' && n.path)
              .map((n) => ({ graphId: gid, label: (n.label || '').toString().trim(), path: n.path }))
          } catch { return [] }
        }))
        const allVideos = fetched.flat()

        // Extract a videoId from a URL. Returns null if it doesn't look like a YouTube URL.
        function extractVideoId(url) {
          if (!url) return null
          const patterns = [
            /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
            /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
            /youtu\.be\/([a-zA-Z0-9_-]{11})/,
          ]
          for (const re of patterns) {
            const m = url.match(re)
            if (m) return m[1]
          }
          return null
        }

        // Filter to videos with a clean label and a real videoId.
        const candidates = allVideos
          .map((v) => ({ ...v, videoId: extractVideoId(v.path) }))
          .filter((v) => v.videoId && v.label && v.label.length >= 3 && !/^YouTube Video Node$/i.test(v.label))
          // De-dupe by videoId.
          .reduce((acc, v) => {
            if (!acc.find((x) => x.videoId === v.videoId)) acc.push(v)
            return acc
          }, [])

        if (candidates.length < 2) {
          return new Response(JSON.stringify({
            error: 'Not enough real videos with extractable IDs',
            harvested: allVideos.length,
            usable: candidates.length,
          }), { status: 502, headers: corsHeaders })
        }

        // Take a sample for Gemma to choose from.
        const sample = candidates.slice(0, sampleSize)

        // 3. Ask Gemma to pick the best-fitting video by INDEX.
        const numbered = sample.map((v, i) => `${i + 1}. ${v.label}`).join('\n')
        const pickPrompt =
          `Choose the ONE video that best fits the topic. Reply with ONLY the number (1-${sample.length}), nothing else.\n\n` +
          `Topic: ${topic}\n\nVideos:\n${numbered}`
        const [pickSlot, descSlot, headSlot] = await Promise.all([
          askSlot(
            `You select the most relevant item from a numbered list. Reply with EXACTLY one integer between 1 and ${sample.length}, nothing else.`,
            pickPrompt,
          ),
          askSlot(
            'You write concise prose. Reply with exactly ONE plain paragraph (3-4 sentences), plain text, no headings, no quotes, no tags.',
            `Write one paragraph introducing why this topic might interest a viewer: ${topic}`,
          ),
          askSlot(
            'You write very short section headings (max 6 words). Reply with heading text only — no #, no quotes, no extra text.',
            `Section heading for an article about: ${topic}`,
          ),
        ])

        // Parse pick. Reasoning model may include extra words; grab the first integer.
        const pickMatch = pickSlot.value.match(/\b(\d{1,2})\b/)
        const pickedIndex = pickMatch ? Math.max(1, Math.min(sample.length, parseInt(pickMatch[1], 10))) - 1 : 0
        const chosen = sample[pickedIndex]

        const slotReport = {
          pick:    { v: pickSlot.value, f: pickSlot.finishReason, parsed: pickedIndex + 1 },
          desc:    { v: descSlot.value, f: descSlot.finishReason },
          heading: { v: headSlot.value, f: headSlot.finishReason },
        }
        const missing = []
        if (!descSlot.value) missing.push('desc')
        if (!headSlot.value) missing.push('heading')
        if (missing.length) {
          return new Response(JSON.stringify({ error: 'Some slots came back empty', missing, slotReport }), { status: 502, headers: corsHeaders })
        }

        const heading = (headSlot.value || '').replace(/^#+\s*/, '').replace(/^["“”']+|["“”']+$/g, '').split('\n')[0].trim().slice(0, 80)

        // 4. Build BOTH nodes from the SAME real video.
        const ts = Date.now()
        const mkId = (kind) => `node-${kind}-${ts}-${Math.random().toString(36).slice(2, 8)}`

        // Node A: standalone youtube-video node (uses node template grammar).
        const standaloneNode = {
          id: mkId('yt-standalone'),
          label: chosen.label,
          type: 'youtube-video',
          color: '#FF0000',
          info: `[SECTION | background-color:'#FFF'; color:'#333']${descSlot.value}[END SECTION]`,
          path: chosen.path,
          bibl: [chosen.path],
          imageWidth: '100%',
          imageHeight: '100%',
          visible: true,
          position: { x: 0, y: 0 },
        }

        // Node B: fulltext with embedded YOUTUBE element grammar.
        const embedInfo = [
          `# ${heading}`,
          '',
          descSlot.value,
          '',
          `![YOUTUBE src=https://www.youtube.com/embed/${chosen.videoId}]${chosen.label}[END YOUTUBE]`,
        ].join('\n')
        const fulltextNode = {
          id: mkId('yt-embed'),
          label: `Fulltext + YOUTUBE embed`,
          type: 'fulltext',
          color: '#fecaca',
          info: embedInfo,
          imageWidth: '100%',
          imageHeight: '100%',
          visible: true,
          position: { x: 0, y: 250 },
        }

        const graphId = `graph_test_yt_${ts}`
        const graphData = {
          nodes: [standaloneNode, fulltextNode],
          edges: [],
          metadata: {
            title: `YouTube test: ${topic}`,
            description: 'Hypothesis B v7 — youtube-video standalone + fulltext [YOUTUBE] embed grammars on the same real video.',
            category: '#test #hybrid-llm #youtube',
            metaArea: 'TEST',
            version: 1,
            createdBy: 'test-youtube endpoint',
          },
        }

        const saveResp = await env.KG_WORKER.fetch('https://knowledge.vegvisr.org/saveGraphWithHistory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin' },
          body: JSON.stringify({ id: graphId, graphData, override: true }),
        })
        const saveText = await saveResp.text()
        if (!saveResp.ok) {
          return new Response(JSON.stringify({
            error: 'saveGraphWithHistory failed',
            status: saveResp.status,
            saveResponse: saveText,
            slotReport,
          }), { status: 502, headers: corsHeaders })
        }

        return new Response(JSON.stringify({
          success: true,
          graphId,
          chosen: { label: chosen.label, videoId: chosen.videoId, path: chosen.path, sourceGraphId: chosen.graphId },
          candidatePool: sample.map((v, i) => ({ idx: i + 1, label: v.label, videoId: v.videoId })),
          nodes: [
            { id: standaloneNode.id, label: standaloneNode.label, type: standaloneNode.type, path: standaloneNode.path, info: standaloneNode.info },
            { id: fulltextNode.id,   label: fulltextNode.label,   type: fulltextNode.type,   info: fulltextNode.info },
          ],
          slotReport,
          viewUrl: `https://www.vegvisr.org/gnew-viewer?graphId=${graphId}`,
        }), { headers: corsHeaders })
      }

      // POST /test-image-elements — Hypothesis B v6 test:
      // ONE topic → 3 fulltext nodes, each embedding a different image position:
      //   Node 1: ![Header|...](url) + intro paragraph
      //   Node 2: ![Leftside-Medium|...](url) + body paragraph (text wraps right of image)
      //   Node 3: ![Rightside-Medium|...](url) + body paragraph (text wraps left of image)
      // Images picked at random from the user's album.
      // Body: { topic: string, userId: string, albumName?: string }
      if (pathname === '/test-image-elements' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}))
        const topic = (body.topic || '').toString().trim()
        const userId = (body.userId || '').toString().trim()
        const albumName = (body.albumName || 'agent-generated').toString().trim()
        if (!topic) {
          return new Response(JSON.stringify({ error: 'topic is required' }), { status: 400, headers: corsHeaders })
        }
        if (!userId) {
          return new Response(JSON.stringify({ error: 'userId is required for album access' }), { status: 400, headers: corsHeaders })
        }

        async function askSlot(systemPrompt, userPrompt, maxTokens = 1500) {
          const resp = await env.AI.run('@cf/google/gemma-4-26b-a4b-it', {
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user',   content: userPrompt },
            ],
            max_tokens: maxTokens,
          })
          const choice = resp?.choices?.[0]?.message || {}
          const finishReason = resp?.choices?.[0]?.finish_reason || null
          const value = (choice.content || resp?.response || '').toString().trim()
          return { value, finishReason }
        }
        function cleanLine(s, max = 100) {
          return (s || '').replace(/^#+\s*/, '').replace(/^["“”']+|["“”']+$/g, '').split('\n')[0].trim().slice(0, max)
        }

        // Pull the 3 image grammars from D1 + fetch album in parallel with Gemma calls.
        const tplPromise = env.DB.prepare(
          "SELECT id, ai_instructions FROM graphTemplates WHERE id IN ('elt-image-header','elt-image-leftside-medium','elt-image-rightside-medium')"
        ).all()

        const albumPromise = (async () => {
          const userRecord = await env.DB.prepare(
            'SELECT emailVerificationToken FROM config WHERE user_id = ?'
          ).bind(userId).first()
          if (!userRecord?.emailVerificationToken) {
            throw new Error('No API token found for user')
          }
          const res = await env.ALBUMS_WORKER.fetch(
            `https://vegvisr-albums-worker/photo-album?name=${encodeURIComponent(albumName)}`,
            { headers: { 'X-API-Token': userRecord.emailVerificationToken } }
          )
          const data = await res.json()
          if (!res.ok) throw new Error(data.error || `Albums API error (${res.status})`)
          return data.images || []
        })()

        // 6 Gemma slot fills in parallel: heading + paragraph for each of 3 nodes.
        const [
          headerHeadSlot, headerParaSlot,
          leftHeadSlot, leftParaSlot,
          rightHeadSlot, rightParaSlot,
          tplResult, albumImages,
        ] = await Promise.all([
          askSlot('You write very short section headings (max 6 words). Reply with heading text only — no #, no quotes, no extra text.',
            `Section heading for the hero/intro section of an article about: ${topic}`),
          askSlot('You write concise prose. Reply with exactly ONE plain paragraph, plain text, no headings, no quotes, no tags.',
            `Write one short opening paragraph introducing: ${topic}`),

          askSlot('You write very short section headings (max 6 words). Reply with heading text only — no #, no quotes, no extra text.',
            `Section heading for a section presenting one key aspect of: ${topic}`),
          askSlot('You write concise prose. Reply with exactly ONE plain paragraph (about 4-5 sentences) suitable for body text that flows beside a left-aligned image. Plain text, no headings, no quotes, no tags.',
            `Write one body paragraph (4-5 sentences) covering one key aspect of: ${topic}`),

          askSlot('You write very short section headings (max 6 words). Reply with heading text only — no #, no quotes, no extra text.',
            `Section heading for a section presenting another key aspect of: ${topic}`),
          askSlot('You write concise prose. Reply with exactly ONE plain paragraph (about 4-5 sentences) suitable for body text that flows beside a right-aligned image. Plain text, no headings, no quotes, no tags.',
            `Write one body paragraph (4-5 sentences) covering a contrasting key aspect of: ${topic}`),

          tplPromise,
          albumPromise.catch((e) => { return { __error: e.message } }),
        ])

        // Validate templates loaded.
        const tplRows = (tplResult.results || [])
        const tpl = {}
        for (const row of tplRows) {
          try { tpl[row.id] = JSON.parse(row.ai_instructions) } catch { tpl[row.id] = null }
        }
        const tplMissing = ['elt-image-header','elt-image-leftside-medium','elt-image-rightside-medium'].filter((id) => !tpl[id])
        if (tplMissing.length) {
          return new Response(JSON.stringify({ error: 'Image templates missing from D1', missing: tplMissing }), { status: 500, headers: corsHeaders })
        }

        // Validate album.
        if (albumImages?.__error) {
          return new Response(JSON.stringify({ error: 'Album fetch failed', detail: albumImages.__error }), { status: 502, headers: corsHeaders })
        }
        if (!albumImages || albumImages.length < 3) {
          return new Response(JSON.stringify({ error: 'Album needs at least 3 images', count: albumImages?.length || 0 }), { status: 502, headers: corsHeaders })
        }

        // Pick 3 distinct random images.
        const shuffled = [...albumImages].sort(() => Math.random() - 0.5)
        const [keyHeader, keyLeft, keyRight] = shuffled.slice(0, 3)
        const urlOf = (key, w, h) => `https://vegvisr.imgix.net/${key}?w=${w}&h=${h}&fit=crop`

        // Slot validation.
        const slotReport = {
          headerHeading: { v: headerHeadSlot.value, f: headerHeadSlot.finishReason },
          headerPara:    { v: headerParaSlot.value, f: headerParaSlot.finishReason },
          leftHeading:   { v: leftHeadSlot.value,   f: leftHeadSlot.finishReason },
          leftPara:      { v: leftParaSlot.value,   f: leftParaSlot.finishReason },
          rightHeading:  { v: rightHeadSlot.value,  f: rightHeadSlot.finishReason },
          rightPara:     { v: rightParaSlot.value,  f: rightParaSlot.finishReason },
        }
        const missing = []
        for (const [k, s] of Object.entries(slotReport)) if (!s.v) missing.push(k)
        if (missing.length) {
          return new Response(JSON.stringify({
            error: 'Some slots came back empty',
            missing,
            slotReport,
          }), { status: 502, headers: corsHeaders })
        }

        const headerHead = cleanLine(headerHeadSlot.value, 80)
        const leftHead   = cleanLine(leftHeadSlot.value, 80)
        const rightHead  = cleanLine(rightHeadSlot.value, 80)

        // Assemble bodies using the grammars from D1.
        // Node 1 — Header image at top, then heading + paragraph.
        const node1Info = [
          `![Header|height: 200px; object-fit: 'cover'; object-position: 'center'](${urlOf(keyHeader, 1600, 600)})`,
          '',
          `# ${headerHead}`,
          '',
          headerParaSlot.value,
        ].join('\n')

        // Node 2 — heading, then Leftside-Medium image inline with paragraph.
        const node2Info = [
          `# ${leftHead}`,
          '',
          `![Leftside-1|width: 200px; height: 200px; object-fit: 'cover'; object-position: 'center'; margin: '0 20px 15px 0'](${urlOf(keyLeft, 600, 600)}) ${leftParaSlot.value}`,
        ].join('\n')

        // Node 3 — heading, then Rightside-Medium image inline with paragraph.
        const node3Info = [
          `# ${rightHead}`,
          '',
          `![Rightside-1|width: 200px; height: 200px; object-fit: 'cover'; object-position: 'center'; margin: '0 0 15px 20px'](${urlOf(keyRight, 600, 600)}) ${rightParaSlot.value}`,
        ].join('\n')

        const ts = Date.now()
        const mkId = (kind) => `node-${kind}-${ts}-${Math.random().toString(36).slice(2, 8)}`
        const nodes = [
          { id: mkId('header'),    label: `Header — ${headerHead}`,  type: 'fulltext', color: '#dbeafe', info: node1Info, imageWidth: '100%', imageHeight: '100%', visible: true, position: { x: 0, y: 0 } },
          { id: mkId('leftside'),  label: `Leftside — ${leftHead}`,  type: 'fulltext', color: '#dcfce7', info: node2Info, imageWidth: '100%', imageHeight: '100%', visible: true, position: { x: 0, y: 200 } },
          { id: mkId('rightside'), label: `Rightside — ${rightHead}`,type: 'fulltext', color: '#fce7f3', info: node3Info, imageWidth: '100%', imageHeight: '100%', visible: true, position: { x: 0, y: 400 } },
        ]

        const graphId = `graph_test_imgelt_${ts}`
        const graphData = {
          nodes,
          edges: [],
          metadata: {
            title: `Image-element test: ${topic}`,
            description: 'Hypothesis B v6 — Header / Leftside / Rightside image positions inside fulltext nodes.',
            category: '#test #hybrid-llm #image-elements',
            metaArea: 'TEST',
            version: 1,
            createdBy: 'test-image-elements endpoint',
          },
        }

        const saveResp = await env.KG_WORKER.fetch('https://knowledge.vegvisr.org/saveGraphWithHistory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin' },
          body: JSON.stringify({ id: graphId, graphData, override: true }),
        })
        const saveText = await saveResp.text()
        if (!saveResp.ok) {
          return new Response(JSON.stringify({
            error: 'saveGraphWithHistory failed',
            status: saveResp.status,
            saveResponse: saveText,
            slotReport,
            nodesPreview: nodes.map((n) => ({ id: n.id, label: n.label, info: n.info })),
          }), { status: 502, headers: corsHeaders })
        }

        return new Response(JSON.stringify({
          success: true,
          graphId,
          nodes: nodes.map((n) => ({ id: n.id, label: n.label, info: n.info })),
          images: { header: keyHeader, leftside: keyLeft, rightside: keyRight, available: albumImages.length },
          slotReport,
          viewUrl: `https://www.vegvisr.org/gnew-viewer?graphId=${graphId}`,
        }), { headers: corsHeaders })
      }

      // POST /test-multi-node — Hypothesis B v5 test:
      // ONE topic → 4 fulltext nodes + 1 image node from the agent-generated album.
      // Node 1: [FANCY] hero title  | Node 2: [SECTION] intro
      // Node 3: [QUOTE] with author | Node 4: [WNOTE] with author
      // Node 5: markdown-image picked at random from album.
      // Body: { topic: string, userId: string, albumName?: string }
      if (pathname === '/test-multi-node' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}))
        const topic = (body.topic || '').toString().trim()
        const userId = (body.userId || '').toString().trim()
        const albumName = (body.albumName || 'agent-generated').toString().trim()
        if (!topic) {
          return new Response(JSON.stringify({ error: 'topic is required' }), { status: 400, headers: corsHeaders })
        }
        if (!userId) {
          return new Response(JSON.stringify({ error: 'userId is required for album access' }), { status: 400, headers: corsHeaders })
        }

        // Fetch album images upfront (parallel with Gemma calls below).
        const albumPromise = (async () => {
          const userRecord = await env.DB.prepare(
            'SELECT emailVerificationToken FROM config WHERE user_id = ?'
          ).bind(userId).first()
          if (!userRecord?.emailVerificationToken) {
            throw new Error('No API token found for user — please log in again')
          }
          const res = await env.ALBUMS_WORKER.fetch(
            `https://vegvisr-albums-worker/photo-album?name=${encodeURIComponent(albumName)}`,
            { headers: { 'X-API-Token': userRecord.emailVerificationToken } }
          )
          const data = await res.json()
          if (!res.ok) throw new Error(data.error || `Albums API error (${res.status})`)
          return (data.images || [])
        })()

        const FONT_SIZES = ['2.5em', '3em', '3.5em', '4em', '4.5em', '5em']
        const FANCY_COLORS = ['#2c3e50', '#c0392b', '#16a085', '#d4a017', '#8e44ad', '#d35400']
        const ALIGNS = ['left', 'center', 'right']
        const SECTION_BG = [
          'lightblue', 'lightyellow', 'lavender', 'mistyrose', 'mintcream',
          'peachpuff', 'beige', 'lightgray', 'thistle', 'palegoldenrod',
          'honeydew', 'aliceblue',
        ]

        async function askSlot(systemPrompt, userPrompt, maxTokens = 1500) {
          const resp = await env.AI.run('@cf/google/gemma-4-26b-a4b-it', {
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user',   content: userPrompt },
            ],
            max_tokens: maxTokens,
          })
          const choice = resp?.choices?.[0]?.message || {}
          const finishReason = resp?.choices?.[0]?.finish_reason || null
          const value = (choice.content || resp?.response || '').toString().trim()
          return { value, finishReason }
        }
        function pickFromAllowlist(text, allowlist) {
          const lower = (text || '').toLowerCase()
          const hits = allowlist.filter((w) => lower.includes(w.toLowerCase()))
          return { match: hits[0] || null, ambiguous: hits.length > 1, hits }
        }
        function cleanLine(s, max = 100) {
          return (s || '')
            .replace(/^#+\s*/, '')
            .replace(/^["“”']+|["“”']+$/g, '')
            .split('\n')[0]
            .trim()
            .slice(0, max)
        }
        function cleanAuthor(s) {
          return (s || '')
            .replace(/^by\s+/i, '')
            .replace(/^["“”']+|["“”']+$/g, '')
            .replace(/[.,;]+$/, '')
            .replace(/'/g, '')
            .trim()
            .slice(0, 80)
        }
        function cleanQuoteBody(s) {
          return (s || '').replace(/^["“”']+|["“”']+$/g, '').trim()
        }

        // Run ALL slot fills in parallel — 11 calls in one burst.
        const [
          fancyTitleSlot, fancyHeadingSlot, fontSlot, colorSlot, alignSlot,
          sectionHeadingSlot, sectionBodySlot, sectionBgSlot,
          quoteHeadingSlot, quoteBodySlot, quoteAuthorSlot,
          wnoteHeadingSlot, wnoteBodySlot, wnoteAuthorSlot,
        ] = await Promise.all([
          askSlot('You write very short hero titles (max 8 words). Reply with the title text only — no quotes, no markdown, no extra text.',
            `Hero title for: ${topic}`),
          askSlot('You write very short section headings (max 6 words). Reply with heading text only — no #, no quotes, no extra text.',
            `Section heading for the hero block of an article about: ${topic}`),
          askSlot(`You pick the most fitting font size for a hero title. Reply with EXACTLY ONE value from this list, nothing else: ${FONT_SIZES.join(', ')}.`,
            `Font size for a hero title about: ${topic}`),
          askSlot(`You pick the most fitting hex color for a hero title. Reply with EXACTLY ONE value from this list, nothing else: ${FANCY_COLORS.join(', ')}.`,
            `Color for a hero title about: ${topic}`),
          askSlot(`You pick the most fitting text alignment for a hero title. Reply with EXACTLY ONE value from this list, nothing else: ${ALIGNS.join(', ')}.`,
            `Text alignment for a hero title about: ${topic}`),

          askSlot('You write very short section headings (max 6 words). Reply with heading text only — no #, no quotes, no extra text.',
            `Section heading for the introduction section of an article about: ${topic}`),
          askSlot('You write concise prose. Reply with exactly ONE plain paragraph, plain text, no headings, no quotes, no tags.',
            `Write one short introduction paragraph about: ${topic}`),
          askSlot(`You pick the most fitting background color for an intro section. Reply with EXACTLY ONE value from this list, nothing else: ${SECTION_BG.join(', ')}.`,
            `Background color for an intro section about: ${topic}`),

          askSlot('You write very short section headings (max 6 words). Reply with heading text only — no #, no quotes, no extra text.',
            `Section heading for a quote-block section of an article about: ${topic}`),
          askSlot('You produce one short, evocative quoted sentence relevant to a topic. Reply with the sentence text only — no surrounding quote marks, no attribution, no extra text.',
            `One quote relevant to: ${topic}`),
          askSlot('You name a plausible author for a quote. Reply with just the name, no quotes, no titles, no extra text.',
            `Pick a fitting author name for a quote about: ${topic}`),

          askSlot('You write very short section headings (max 6 words). Reply with heading text only — no #, no quotes, no extra text.',
            `Section heading for a practical-tip section of an article about: ${topic}`),
          askSlot('You write short professional work notes — practical observations, not quotes. Reply with exactly ONE paragraph, plain text, no quotes, no headings, no tags.',
            `Write one short work note (a practical observation) about: ${topic}`),
          askSlot('You name a plausible professional author for a work note. Reply with just the name, no quotes, no titles, no extra text.',
            `Pick a fitting author name for a professional work note about: ${topic}`),
        ])

        const fontPick  = pickFromAllowlist(fontSlot.value, FONT_SIZES)
        const colorPick = pickFromAllowlist(colorSlot.value, FANCY_COLORS)
        const alignPick = pickFromAllowlist(alignSlot.value, ALIGNS)
        const bgPick    = pickFromAllowlist(sectionBgSlot.value, SECTION_BG)

        const slotReport = {
          fancyTitle:    { v: fancyTitleSlot.value,    f: fancyTitleSlot.finishReason },
          fancyHeading:  { v: fancyHeadingSlot.value,  f: fancyHeadingSlot.finishReason },
          font:          { v: fontSlot.value,          f: fontSlot.finishReason,  pick: fontPick },
          color:         { v: colorSlot.value,         f: colorSlot.finishReason, pick: colorPick },
          align:         { v: alignSlot.value,         f: alignSlot.finishReason, pick: alignPick },
          sectionHeading:{ v: sectionHeadingSlot.value,f: sectionHeadingSlot.finishReason },
          sectionBody:   { v: sectionBodySlot.value,   f: sectionBodySlot.finishReason },
          sectionBg:     { v: sectionBgSlot.value,     f: sectionBgSlot.finishReason, pick: bgPick },
          quoteHeading:  { v: quoteHeadingSlot.value,  f: quoteHeadingSlot.finishReason },
          quoteBody:     { v: quoteBodySlot.value,     f: quoteBodySlot.finishReason },
          quoteAuthor:   { v: quoteAuthorSlot.value,   f: quoteAuthorSlot.finishReason },
          wnoteHeading:  { v: wnoteHeadingSlot.value,  f: wnoteHeadingSlot.finishReason },
          wnoteBody:     { v: wnoteBodySlot.value,     f: wnoteBodySlot.finishReason },
          wnoteAuthor:   { v: wnoteAuthorSlot.value,   f: wnoteAuthorSlot.finishReason },
        }
        const missing = []
        if (!fancyTitleSlot.value)    missing.push('fancyTitle')
        if (!fancyHeadingSlot.value)  missing.push('fancyHeading')
        if (!fontPick.match)          missing.push('font')
        if (!colorPick.match)         missing.push('color')
        if (!alignPick.match)         missing.push('align')
        if (!sectionHeadingSlot.value)missing.push('sectionHeading')
        if (!sectionBodySlot.value)   missing.push('sectionBody')
        if (!bgPick.match)            missing.push('sectionBg')
        if (!quoteHeadingSlot.value)  missing.push('quoteHeading')
        if (!quoteBodySlot.value)     missing.push('quoteBody')
        if (!quoteAuthorSlot.value)   missing.push('quoteAuthor')
        if (!wnoteHeadingSlot.value)  missing.push('wnoteHeading')
        if (!wnoteBodySlot.value)     missing.push('wnoteBody')
        if (!wnoteAuthorSlot.value)   missing.push('wnoteAuthor')
        if (missing.length) {
          return new Response(JSON.stringify({
            error: 'Some slots came back empty or unmatched',
            missing,
            slotReport,
          }), { status: 502, headers: corsHeaders })
        }

        // Sanitize
        const fancyTitle    = cleanLine(fancyTitleSlot.value)
        const fancyHeading  = cleanLine(fancyHeadingSlot.value, 80)
        const sectionHead   = cleanLine(sectionHeadingSlot.value, 80)
        const quoteHead     = cleanLine(quoteHeadingSlot.value, 80)
        const wnoteHead     = cleanLine(wnoteHeadingSlot.value, 80)
        const quoteAuthor   = cleanAuthor(quoteAuthorSlot.value)
        const wnoteAuthor   = cleanAuthor(wnoteAuthorSlot.value)
        const quoteBody     = cleanQuoteBody(quoteBodySlot.value)

        // Assemble each node's body
        const fancyStyle = `font-size: ${fontPick.match}; color: ${colorPick.match}; text-align: ${alignPick.match}`
        const sectionStyle = `background-color: '${bgPick.match}'; color: 'black'; text-align: 'left'; font-size: '1.05em'`

        const node1Info = [
          `# ${fancyHeading}`,
          '',
          `[FANCY | ${fancyStyle}]`,
          fancyTitle,
          '[END FANCY]',
        ].join('\n')

        const node2Info = [
          `# ${sectionHead}`,
          '',
          `[SECTION | ${sectionStyle}]`,
          sectionBodySlot.value,
          '[END SECTION]',
        ].join('\n')

        const node3Info = [
          `# ${quoteHead}`,
          '',
          `[QUOTE | Cited='${quoteAuthor}']`,
          quoteBody,
          '[END QUOTE]',
        ].join('\n')

        const node4Info = [
          `# ${wnoteHead}`,
          '',
          `[WNOTE | Cited='${wnoteAuthor}']`,
          wnoteBodySlot.value,
          '[END WNOTE]',
        ].join('\n')

        // Pick a random image from the album (resolve in parallel with Gemma).
        let albumImages = []
        let albumError = null
        try { albumImages = await albumPromise } catch (e) { albumError = e.message }
        const chosenKey = albumImages.length
          ? albumImages[Math.floor(Math.random() * albumImages.length)]
          : null
        const chosenUrl = chosenKey
          ? `https://vegvisr.imgix.net/${chosenKey}?w=1200&h=800&fit=crop`
          : null

        const ts = Date.now()
        const mkId = (kind) => `node-${kind}-${ts}-${Math.random().toString(36).slice(2, 8)}`
        const nodes = [
          { id: mkId('fancy'),   label: `Hero — ${fancyHeading}`,    type: 'fulltext', color: '#fef3c7', info: node1Info, imageWidth: '100%', imageHeight: '100%', visible: true, position: { x: 0,   y: 0 } },
          { id: mkId('section'), label: `Intro — ${sectionHead}`,    type: 'fulltext', color: '#e0f2fe', info: node2Info, imageWidth: '100%', imageHeight: '100%', visible: true, position: { x: 0,   y: 200 } },
          { id: mkId('quote'),   label: `Quote — ${quoteHead}`,      type: 'fulltext', color: '#fce7f3', info: node3Info, imageWidth: '100%', imageHeight: '100%', visible: true, position: { x: 0,   y: 400 } },
          { id: mkId('wnote'),   label: `Note — ${wnoteHead}`,       type: 'fulltext', color: '#fef9c3', info: node4Info, imageWidth: '100%', imageHeight: '100%', visible: true, position: { x: 0,   y: 600 } },
        ]
        if (chosenUrl) {
          nodes.push({
            id: mkId('image'),
            label: `Image — from ${albumName}`,
            type: 'markdown-image',
            color: '#ddd6fe',
            info: `Image from album "${albumName}"`,
            path: chosenUrl,
            imageWidth: '100%',
            imageHeight: '100%',
            visible: true,
            position: { x: 0, y: 800 },
          })
        }

        const graphId = `graph_test_multi_${ts}`
        const graphData = {
          nodes,
          edges: [],
          metadata: {
            title: `Multi-node test: ${topic}`,
            description: 'Hypothesis B v5 — 4 standalone fulltext nodes, one element each.',
            category: '#test #hybrid-llm #multi-node',
            metaArea: 'TEST',
            version: 1,
            createdBy: 'test-multi-node endpoint',
          },
        }

        const saveResp = await env.KG_WORKER.fetch('https://knowledge.vegvisr.org/saveGraphWithHistory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin' },
          body: JSON.stringify({ id: graphId, graphData, override: true }),
        })
        const saveText = await saveResp.text()
        if (!saveResp.ok) {
          return new Response(JSON.stringify({
            error: 'saveGraphWithHistory failed',
            status: saveResp.status,
            saveResponse: saveText,
            slotReport,
            nodesPreview: nodes.map((n) => ({ id: n.id, label: n.label, info: n.info })),
          }), { status: 502, headers: corsHeaders })
        }

        return new Response(JSON.stringify({
          success: true,
          graphId,
          nodes: nodes.map((n) => ({ id: n.id, label: n.label, type: n.type, info: n.info, path: n.path })),
          slotReport,
          album: {
            name: albumName,
            available: albumImages.length,
            chosenKey,
            chosenUrl,
            error: albumError,
          },
          viewUrl: `https://www.vegvisr.org/gnew-viewer?graphId=${graphId}`,
        }), { headers: corsHeaders })
      }

      // POST /test-wnote — Hypothesis B v4 test:
      // Confirms QUOTE pattern works for the structurally identical WNOTE element.
      // Slots: body paragraph + author. Code wraps with [WNOTE | Cited='...'] grammar.
      // Body: { topic: string }
      if (pathname === '/test-wnote' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}))
        const topic = (body.topic || '').toString().trim()
        if (!topic) {
          return new Response(JSON.stringify({ error: 'topic is required' }), { status: 400, headers: corsHeaders })
        }

        async function askSlot(systemPrompt, userPrompt, maxTokens = 1500) {
          const resp = await env.AI.run('@cf/google/gemma-4-26b-a4b-it', {
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user',   content: userPrompt },
            ],
            max_tokens: maxTokens,
          })
          const choice = resp?.choices?.[0]?.message || {}
          const finishReason = resp?.choices?.[0]?.finish_reason || null
          const value = (choice.content || resp?.response || '').toString().trim()
          return { value, finishReason, raw: choice }
        }

        const tplRow = await env.DB.prepare(
          "SELECT ai_instructions FROM graphTemplates WHERE id = 'elt-wnote'"
        ).first()
        if (!tplRow) {
          return new Response(JSON.stringify({ error: 'WNOTE template missing from D1' }), { status: 500, headers: corsHeaders })
        }

        const [noteSlot, authorSlot] = await Promise.all([
          askSlot(
            'You write short professional work notes — practical observations, not quotes. Reply with exactly ONE paragraph, plain text, no quotes, no headings, no tags.',
            `Write one short work note (a practical observation or reminder) about: ${topic}`,
          ),
          askSlot(
            'You name a plausible professional author for a work note. Reply with just the name, no quotes, no titles, no extra text.',
            `Pick a fitting author name for a professional work note about: ${topic}`,
          ),
        ])

        const slotReport = {
          note:   { value: noteSlot.value,   finishReason: noteSlot.finishReason },
          author: { value: authorSlot.value, finishReason: authorSlot.finishReason },
        }
        const missing = []
        if (!noteSlot.value)   missing.push('note')
        if (!authorSlot.value) missing.push('author')
        if (missing.length) {
          return new Response(JSON.stringify({
            error: 'Some slots came back empty',
            missing,
            slotReport,
          }), { status: 502, headers: corsHeaders })
        }

        // Sanitize
        let author = authorSlot.value
          .replace(/^by\s+/i, '')
          .replace(/^["“”']+|["“”']+$/g, '')
          .replace(/[.,;]+$/, '')
          .replace(/'/g, '')
          .trim()
          .slice(0, 80)
        let noteBody = noteSlot.value
          .replace(/^["“”']+|["“”']+$/g, '')
          .trim()

        // Assemble using WNOTE grammar from D1
        const fulltextInfo = [
          `[WNOTE | Cited='${author}']`,
          noteBody,
          '[END WNOTE]',
        ].join('\n')

        const graphId = `graph_test_wnote_${Date.now()}`
        const node = {
          id: `node-wnote-${Math.random().toString(36).slice(2, 10)}`,
          label: `WNote: ${topic.slice(0, 60)}`,
          type: 'fulltext',
          color: '#fef9c3',
          info: fulltextInfo,
          imageWidth: '100%',
          imageHeight: '100%',
          visible: true,
          position: { x: 0, y: 0 },
        }
        const graphData = {
          nodes: [node],
          edges: [],
          metadata: {
            title: `WNote test: ${topic}`,
            description: 'Hypothesis B v4 — [WNOTE] block with body + author slots.',
            category: '#test #hybrid-llm #wnote',
            metaArea: 'TEST',
            version: 1,
            createdBy: 'test-wnote endpoint',
          },
        }

        const saveResp = await env.KG_WORKER.fetch('https://knowledge.vegvisr.org/saveGraphWithHistory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin' },
          body: JSON.stringify({ id: graphId, graphData, override: true }),
        })
        const saveText = await saveResp.text()
        if (!saveResp.ok) {
          return new Response(JSON.stringify({
            error: 'saveGraphWithHistory failed',
            status: saveResp.status,
            saveResponse: saveText,
            generatedInfo: fulltextInfo,
            slotReport,
          }), { status: 502, headers: corsHeaders })
        }

        return new Response(JSON.stringify({
          success: true,
          graphId,
          nodeId: node.id,
          info: fulltextInfo,
          slots: { note: noteBody, author },
          slotReport,
          viewUrl: `https://www.vegvisr.org/gnew-viewer?graphId=${graphId}`,
        }), { headers: corsHeaders })
      }

      // POST /test-fancy — Hypothesis B v3 test:
      // Stress-tests 3-parameter allowlist slots. Gemma fills 5 slots:
      // title, font-size (allowlist), color (hex allowlist), text-align (allowlist),
      // body paragraph. Code assembles markdown + [FANCY] block.
      // Body: { topic: string }
      if (pathname === '/test-fancy' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}))
        const topic = (body.topic || '').toString().trim()
        if (!topic) {
          return new Response(JSON.stringify({ error: 'topic is required' }), { status: 400, headers: corsHeaders })
        }

        // Allowlists. Code REJECTS anything Gemma returns outside these.
        const FONT_SIZES = ['2.5em', '3em', '3.5em', '4em', '4.5em', '5em']
        const COLORS = ['#2c3e50', '#c0392b', '#16a085', '#d4a017', '#8e44ad', '#d35400']
        const ALIGNS = ['left', 'center', 'right']

        async function askSlot(systemPrompt, userPrompt, maxTokens = 1500) {
          const resp = await env.AI.run('@cf/google/gemma-4-26b-a4b-it', {
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user',   content: userPrompt },
            ],
            max_tokens: maxTokens,
          })
          const choice = resp?.choices?.[0]?.message || {}
          const finishReason = resp?.choices?.[0]?.finish_reason || null
          const value = (choice.content || resp?.response || '').toString().trim()
          return { value, finishReason, raw: choice }
        }

        // Pick first allowlist token that appears in content.
        // Returns { match, ambiguous: boolean, hits: string[] }.
        function pickFromAllowlist(text, allowlist) {
          const lower = (text || '').toLowerCase()
          const hits = allowlist.filter((w) => lower.includes(w.toLowerCase()))
          return { match: hits[0] || null, ambiguous: hits.length > 1, hits }
        }

        // Pull FANCY template from D1 — verifies it still exists and gives us notes.
        const tplRow = await env.DB.prepare(
          "SELECT ai_instructions FROM graphTemplates WHERE id = 'elt-fancy'"
        ).first()
        if (!tplRow) {
          return new Response(JSON.stringify({ error: 'FANCY template missing from D1' }), { status: 500, headers: corsHeaders })
        }

        // Run all 5 slot fills in parallel.
        const [titleSlot, fontSlot, colorSlot, alignSlot, paraSlot] = await Promise.all([
          askSlot(
            'You write very short article titles. Reply with ONE plain title line (max 8 words), no quotes, no markdown, no extra text.',
            `Title for an article about: ${topic}`,
          ),
          askSlot(
            `You pick the most fitting font size for a hero title. Reply with EXACTLY ONE value from this list, nothing else: ${FONT_SIZES.join(', ')}.`,
            `Font size for a hero title about: ${topic}`,
          ),
          askSlot(
            `You pick the most fitting hex color for a hero title. Reply with EXACTLY ONE value from this list, nothing else: ${COLORS.join(', ')}.`,
            `Color for a hero title about: ${topic}`,
          ),
          askSlot(
            `You pick the most fitting text alignment for a hero title. Reply with EXACTLY ONE value from this list, nothing else: ${ALIGNS.join(', ')}.`,
            `Text alignment for a hero title about: ${topic}`,
          ),
          askSlot(
            'You write concise prose. Reply with exactly ONE plain paragraph, plain text, no markdown headings, no quotes, no tags.',
            `Write one short opening paragraph introducing: ${topic}`,
          ),
        ])

        // Resolve allowlist matches.
        const fontPick  = pickFromAllowlist(fontSlot.value, FONT_SIZES)
        const colorPick = pickFromAllowlist(colorSlot.value, COLORS)
        const alignPick = pickFromAllowlist(alignSlot.value, ALIGNS)

        const slotReport = {
          title:  { value: titleSlot.value,  finishReason: titleSlot.finishReason },
          font:   { value: fontSlot.value,   finishReason: fontSlot.finishReason,  pick: fontPick },
          color:  { value: colorSlot.value,  finishReason: colorSlot.finishReason, pick: colorPick },
          align:  { value: alignSlot.value,  finishReason: alignSlot.finishReason, pick: alignPick },
          paragraph: { value: paraSlot.value, finishReason: paraSlot.finishReason },
        }
        const missing = []
        if (!titleSlot.value) missing.push('title')
        if (!paraSlot.value)  missing.push('paragraph')
        if (!fontPick.match)  missing.push('font')
        if (!colorPick.match) missing.push('color')
        if (!alignPick.match) missing.push('align')
        if (missing.length) {
          return new Response(JSON.stringify({
            error: 'Some slots came back empty or unmatched',
            missing,
            slotReport,
          }), { status: 502, headers: corsHeaders })
        }

        // Sanitize title: strip leading hashes, surrounding quotes.
        const title = titleSlot.value
          .replace(/^#+\s*/, '')
          .replace(/^["“”']+|["“”']+$/g, '')
          .split('\n')[0]
          .trim()
          .slice(0, 100)

        // Deterministic assembly using FANCY grammar from D1.
        const fancyStyle = `font-size: ${fontPick.match}; color: ${colorPick.match}; text-align: ${alignPick.match}`
        const fulltextInfo = [
          `[FANCY | ${fancyStyle}]`,
          title,
          '[END FANCY]',
          '',
          paraSlot.value,
        ].join('\n')

        // Build graph
        const graphId = `graph_test_fancy_${Date.now()}`
        const node = {
          id: `node-fancy-${Math.random().toString(36).slice(2, 10)}`,
          label: `Fancy: ${topic.slice(0, 60)}`,
          type: 'fulltext',
          color: '#fef3c7',
          info: fulltextInfo,
          imageWidth: '100%',
          imageHeight: '100%',
          visible: true,
          position: { x: 0, y: 0 },
        }
        const graphData = {
          nodes: [node],
          edges: [],
          metadata: {
            title: `Fancy test: ${topic}`,
            description: 'Hypothesis B v3 — [FANCY] block with 3 allowlist parameter slots.',
            category: '#test #hybrid-llm #fancy',
            metaArea: 'TEST',
            version: 1,
            createdBy: 'test-fancy endpoint',
          },
        }

        const saveResp = await env.KG_WORKER.fetch('https://knowledge.vegvisr.org/saveGraphWithHistory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin' },
          body: JSON.stringify({ id: graphId, graphData, override: true }),
        })
        const saveText = await saveResp.text()
        if (!saveResp.ok) {
          return new Response(JSON.stringify({
            error: 'saveGraphWithHistory failed',
            status: saveResp.status,
            saveResponse: saveText,
            generatedInfo: fulltextInfo,
            slotReport,
          }), { status: 502, headers: corsHeaders })
        }

        return new Response(JSON.stringify({
          success: true,
          graphId,
          nodeId: node.id,
          info: fulltextInfo,
          slots: {
            title,
            font: fontPick.match,
            color: colorPick.match,
            align: alignPick.match,
            paragraph: paraSlot.value,
          },
          slotReport,
          viewUrl: `https://www.vegvisr.org/gnew-viewer?graphId=${graphId}`,
        }), { headers: corsHeaders })
      }

      // POST /test-mixed-section — Hypothesis B v2 test:
      // Gemma fills MULTIPLE slots independently (title, paragraph, SECTION body,
      // QUOTE body, QUOTE author). Code assembles the final fulltext body from
      // pure markdown + [SECTION] + [QUOTE] grammars pulled from D1.
      // Body: { topic: string }
      if (pathname === '/test-mixed-section' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}))
        const topic = (body.topic || '').toString().trim()
        if (!topic) {
          return new Response(JSON.stringify({ error: 'topic is required' }), { status: 400, headers: corsHeaders })
        }

        // Helper: ask Gemma for one slot, return clean message.content only.
        // Returns { value, finishReason, raw } — never reads chain-of-thought text.
        async function askSlot(systemPrompt, userPrompt, maxTokens = 1500) {
          const resp = await env.AI.run('@cf/google/gemma-4-26b-a4b-it', {
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user',   content: userPrompt },
            ],
            max_tokens: maxTokens,
          })
          const choice = resp?.choices?.[0]?.message || {}
          const finishReason = resp?.choices?.[0]?.finish_reason || null
          const value = (choice.content || resp?.response || '').toString().trim()
          return { value, finishReason, raw: choice }
        }

        // 1. Pull SECTION + QUOTE templates from D1 (single query).
        const tplRows = await env.DB.prepare(
          "SELECT id, ai_instructions FROM graphTemplates WHERE id IN ('elt-section','elt-quote')"
        ).all()
        const templates = {}
        for (const row of (tplRows.results || [])) {
          try { templates[row.id] = JSON.parse(row.ai_instructions) } catch { templates[row.id] = null }
        }
        if (!templates['elt-section'] || !templates['elt-quote']) {
          return new Response(JSON.stringify({ error: 'SECTION or QUOTE template missing' }), { status: 500, headers: corsHeaders })
        }

        // 2. Run the four Gemma slot fills in PARALLEL — they're independent.
        const [titleSlot, paraSlot, sectionSlot, quoteSlot, authorSlot] = await Promise.all([
          askSlot(
            'You write very short article titles. Reply with ONE markdown heading line, no quotes, no extra text.',
            `Title for an article about: ${topic}`,
          ),
          askSlot(
            'You write concise prose. Reply with exactly ONE plain paragraph, plain text, no markdown headings, no quotes, no tags.',
            `Write one short opening paragraph introducing: ${topic}`,
          ),
          askSlot(
            'You write concise prose. Reply with exactly ONE short paragraph, plain text, no headings, no quotes, no tags.',
            `Write one paragraph that goes deeper into a key aspect of: ${topic}`,
          ),
          askSlot(
            'You produce one short, evocative quoted sentence relevant to a topic. Reply with the sentence text only — no surrounding quote marks, no attribution, no extra text.',
            `One quote relevant to: ${topic}`,
          ),
          askSlot(
            'You name a plausible author for a quote. Reply with just the name, no quotes, no titles, no extra text.',
            `Pick a fitting author name for a quote about: ${topic}`,
          ),
        ])

        // 3. Validate slot fills. Bail loudly if any slot is empty so we can see WHY.
        const slotReport = {
          title:   { value: titleSlot.value,   finishReason: titleSlot.finishReason },
          paragraph:{ value: paraSlot.value,   finishReason: paraSlot.finishReason },
          section: { value: sectionSlot.value, finishReason: sectionSlot.finishReason },
          quote:   { value: quoteSlot.value,   finishReason: quoteSlot.finishReason },
          author:  { value: authorSlot.value,  finishReason: authorSlot.finishReason },
        }
        const missing = Object.entries(slotReport).filter(([, s]) => !s.value).map(([k]) => k)
        if (missing.length) {
          return new Response(JSON.stringify({
            error: 'Some slots came back empty',
            missing,
            slotReport,
          }), { status: 502, headers: corsHeaders })
        }

        // 4. Sanitize:
        //  - Title: ensure it starts with a "# " heading. Strip any leading hashes Gemma added.
        //  - Author: strip leading "by ", surrounding quotes, trailing periods.
        //  - Quote body: strip wrapping quotes (single, double, smart).
        let title = titleSlot.value.replace(/^#+\s*/, '').replace(/^["“”']+|["“”']+$/g, '').trim()
        let author = authorSlot.value.replace(/^by\s+/i, '').replace(/^["“”']+|["“”']+$/g, '').replace(/[.,;]+$/, '').trim()
        let quoteBody = quoteSlot.value.replace(/^["“”']+|["“”']+$/g, '').trim()
        // Author safety: must not contain a single quote (it would break Cited='...').
        author = author.replace(/'/g, '').slice(0, 80)

        // 5. Deterministic assembly using the grammars from D1.
        const sectionStyle = "background-color: 'lightblue'; color: 'black'; text-align: 'center'; font-size: '1.1em'"
        const fulltextInfo = [
          `# ${title}`,
          '',
          paraSlot.value,
          '',
          `[SECTION | ${sectionStyle}]`,
          sectionSlot.value,
          '[END SECTION]',
          '',
          `[QUOTE | Cited='${author}']`,
          quoteBody,
          '[END QUOTE]',
        ].join('\n')

        // 6. Build graph
        const graphId = `graph_test_mixed_${Date.now()}`
        const node = {
          id: `node-mixed-${Math.random().toString(36).slice(2, 10)}`,
          label: `Mixed: ${topic.slice(0, 60)}`,
          type: 'fulltext',
          color: '#e0f2fe',
          info: fulltextInfo,
          imageWidth: '100%',
          imageHeight: '100%',
          visible: true,
          position: { x: 0, y: 0 },
        }
        const graphData = {
          nodes: [node],
          edges: [],
          metadata: {
            title: `Mixed test: ${topic}`,
            description: 'Hypothesis B v2 — markdown + [SECTION] + [QUOTE] from per-slot Gemma calls.',
            category: '#test #hybrid-llm #mixed',
            metaArea: 'TEST',
            version: 1,
            createdBy: 'test-mixed-section endpoint',
          },
        }

        const saveResp = await env.KG_WORKER.fetch('https://knowledge.vegvisr.org/saveGraphWithHistory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin' },
          body: JSON.stringify({ id: graphId, graphData, override: true }),
        })
        const saveText = await saveResp.text()
        if (!saveResp.ok) {
          return new Response(JSON.stringify({
            error: 'saveGraphWithHistory failed',
            status: saveResp.status,
            saveResponse: saveText,
            generatedInfo: fulltextInfo,
            slotReport,
          }), { status: 502, headers: corsHeaders })
        }

        return new Response(JSON.stringify({
          success: true,
          graphId,
          nodeId: node.id,
          info: fulltextInfo,
          slots: { title, paragraph: paraSlot.value, sectionBody: sectionSlot.value, quote: quoteBody, author },
          slotReport,
          viewUrl: `https://www.vegvisr.org/gnew-viewer?graphId=${graphId}`,
        }), { headers: corsHeaders })
      }

      // POST /test-section — Hypothesis B test:
      // Gemma writes prose only; we wrap it deterministically with the
      // [SECTION] grammar from graphTemplates → create fulltext node → save graph.
      // Body: { topic: string, paragraphs?: number, style?: object, aiStyle?: boolean }
      if (pathname === '/test-section' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}))
        const topic = (body.topic || '').toString().trim()
        if (!topic) {
          return new Response(JSON.stringify({ error: 'topic is required' }), { status: 400, headers: corsHeaders })
        }
        const paragraphs = Math.min(Math.max(parseInt(body.paragraphs, 10) || 2, 1), 5)
        const aiStyle = body.aiStyle === true

        // Allowlist of background-colors Gemma may choose from.
        // Constrains the slot so the model can never produce invalid CSS.
        const COLOR_ALLOWLIST = [
          'lightblue', 'lightyellow', 'lavender', 'mistyrose',
          'mintcream', 'peachpuff', 'beige', 'lightgray', 'thistle',
          'palegoldenrod', 'honeydew', 'aliceblue',
        ]

        let chosenBg = body?.style?.['background-color'] || 'lightblue'
        let colorReason = null
        let colorRaw = null

        if (aiStyle) {
          // Gemma 4 is a reasoning model: it always emits chain-of-thought first,
          // THEN puts the actual answer in message.content. We give enough budget
          // for CoT to finish (~1500 tokens) and ONLY accept message.content.
          // We never scrape reasoning text — that biases toward whichever color
          // appears first in the prompt's allowlist.
          const colorResp = await env.AI.run('@cf/google/gemma-4-26b-a4b-it', {
            messages: [
              { role: 'system', content: `Pick the most fitting CSS background color for a topic. Reply with ONE word from this list, exactly as written, nothing else: ${COLOR_ALLOWLIST.join(', ')}.` },
              { role: 'user',   content: `Topic: ${topic}` },
            ],
            max_tokens: 1500,
          })
          const cChoice = colorResp?.choices?.[0]?.message || {}
          // Strict: only accept message.content (the post-reasoning answer).
          colorRaw = (cChoice.content || colorResp?.response || '').toString().trim()
          if (colorRaw && colorRaw.length <= 40) {
            const lc = colorRaw.toLowerCase()
            const hits = COLOR_ALLOWLIST.filter(c => new RegExp(`\\b${c}\\b`, 'i').test(lc))
            if (hits.length === 1) {
              chosenBg = hits[0]
              colorReason = 'matched allowlist (clean content answer)'
            } else if (hits.length > 1) {
              colorReason = `ambiguous (matched ${hits.length}); fell back to default '${chosenBg}'`
            } else {
              colorReason = `no allowlist match in content; fell back to default '${chosenBg}'`
            }
          } else {
            colorReason = `content empty or too long (finish_reason=${colorResp?.choices?.[0]?.finish_reason || 'unknown'}); fell back to default '${chosenBg}'`
          }
        }

        const style = {
          'background-color': chosenBg,
          'color':            body?.style?.color            || 'black',
          'text-align':       body?.style?.['text-align']   || 'center',
          'font-size':        body?.style?.['font-size']    || '1.1em',
        }

        // 1. Gemma — prose only, no markup grammar exposed
        const aiResp = await env.AI.run('@cf/google/gemma-4-26b-a4b-it', {
          messages: [
            { role: 'system', content: 'You are a concise prose writer. Reply with plain markdown only — no HTML, no code fences, no headings, no special tags. Just paragraphs. Do not show your reasoning. Output the final text only.' },
            { role: 'user',   content: `Write exactly ${paragraphs} short paragraphs about: ${topic}` },
          ],
          max_tokens: 2000,
        })
        // Gemma's OpenAI-shaped output: prefer message.content; fall back to extracting
        // the final prose from message.reasoning (chain-of-thought) if content is empty.
        const choice = aiResp?.choices?.[0]?.message || {}
        let prose = (aiResp?.response || choice.content || '').toString().trim()
        if (!prose && choice.reasoning) {
          // Strip CoT scaffolding: take the LAST run of plain paragraphs (no leading "*" or "-")
          const blocks = choice.reasoning.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean)
          const proseBlocks = blocks.filter(b => !/^[*\-\d]/.test(b) && b.length > 60)
          prose = proseBlocks.slice(-paragraphs).join('\n\n').trim()
        }
        if (!prose) {
          return new Response(JSON.stringify({ error: 'Gemma returned empty response', raw: aiResp }), { status: 502, headers: corsHeaders })
        }

        // 2. Read SECTION template from D1
        const tplRow = await env.DB.prepare(
          'SELECT ai_instructions FROM graphTemplates WHERE id = ?'
        ).bind('elt-section').first()
        if (!tplRow) {
          return new Response(JSON.stringify({ error: 'elt-section template not found' }), { status: 500, headers: corsHeaders })
        }
        let tpl
        try { tpl = JSON.parse(tplRow.ai_instructions) } catch { tpl = null }

        // 3. Wrap deterministically using the documented format
        const styleStr = Object.entries(style).map(([k, v]) => `${k}: '${v}'`).join('; ')
        const sectionMarkup = `[SECTION | ${styleStr}]\n${prose}\n[END SECTION]`

        // 4. Build graph with one fulltext node
        const graphId = `graph_test_section_${Date.now()}`
        const node = {
          id: `node-section-${Math.random().toString(36).slice(2, 10)}`,
          label: `Section: ${topic.slice(0, 60)}`,
          type: 'fulltext',
          color: '#e0f2fe',
          info: sectionMarkup,
          imageWidth: '100%',
          imageHeight: '100%',
          visible: true,
          position: { x: 0, y: 0 },
        }
        const graphData = {
          nodes: [node],
          edges: [],
          metadata: {
            title: `Test SECTION: ${topic}`,
            description: `Hypothesis B test — Gemma prose wrapped in [SECTION].`,
            category: '#test #hybrid-llm',
            metaArea: 'TEST',
            version: 1,
            createdBy: 'test-section endpoint',
          },
        }

        // 5. Save via knowledge worker (service binding — avoids public DNS timeout)
        const saveResp = await env.KG_WORKER.fetch('https://knowledge.vegvisr.org/saveGraphWithHistory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin' },
          body: JSON.stringify({ id: graphId, graphData, override: true }),
        })
        const saveText = await saveResp.text()
        if (!saveResp.ok) {
          return new Response(JSON.stringify({
            error: 'saveGraphWithHistory failed',
            status: saveResp.status,
            saveResponse: saveText,
            generatedInfo: sectionMarkup,
          }), { status: 502, headers: corsHeaders })
        }

        return new Response(JSON.stringify({
          success: true,
          graphId,
          nodeId: node.id,
          info: sectionMarkup,
          gemmaProse: prose,
          chosenBackgroundColor: chosenBg,
          colorPickedByAI: aiStyle,
          colorReason,
          colorRaw,
          templateFormat: tpl?.format || null,
          viewUrl: `https://www.vegvisr.org/gnew-viewer?graphId=${graphId}`,
        }), { headers: corsHeaders })
      }

      // POST /execute - Execute an agent
      if (pathname === '/execute' && request.method === 'POST') {
        const body = await request.json()
        const { agentId, task, userId, contractId, graphId } = body

        if (!agentId || !task || !userId) {
          return new Response(JSON.stringify({
            error: 'agentId, task, and userId are required'
          }), { status: 400, headers: corsHeaders })
        }

        const agentConfig = await env.DB.prepare(`
          SELECT * FROM agent_configs WHERE id = ?1 AND is_active = 1
        `).bind(agentId).first()

        if (!agentConfig) {
          return new Response(JSON.stringify({
            error: 'Agent not found or inactive'
          }), { status: 404, headers: corsHeaders })
        }

        const config = {
          ...agentConfig,
          tools: JSON.parse(agentConfig.tools || '[]'),
          metadata: JSON.parse(agentConfig.metadata || '{}'),
          default_contract_id: contractId || agentConfig.default_contract_id
        }

        const targetGraphId = graphId || crypto.randomUUID()
        let enrichedTask = `${task}\n\n[Target graph ID: ${targetGraphId}] — Use this exact graphId when calling create_graph and create_html_from_template.`

        const result = await executeAgent(config, enrichedTask, userId, env)

        return new Response(JSON.stringify(result), { headers: corsHeaders })
      }

      // POST /bot-chat - Direct bot conversation (SSE)
      // Used by AgentChat when user types @botname message
      // Uses runChatbotSubagent for full tool execution (same as group chat bots)
      if (pathname === '/bot-chat' && request.method === 'POST') {
        const body = await request.json()
        const { userId, botId, message, conversationHistory } = body
        if (!userId || !botId || !message) {
          return new Response(JSON.stringify({ error: 'userId, botId, and message required' }), { status: 400, headers: corsHeaders })
        }

        // Load bot config directly from CHAT_DB (avoids auth issues with Clerk userIds)
        const bot = await env.CHAT_DB.prepare(
          'SELECT id, name, username, avatar_url, system_prompt, graph_id, model, temperature, tools, max_turns, is_active FROM chat_bots WHERE id = ? AND is_active = 1'
        ).bind(botId).first()
        if (!bot) {
          return new Response(JSON.stringify({ error: 'Bot not found' }), { status: 404, headers: corsHeaders })
        }

        // Stream response via SSE
        const { readable, writable } = new TransformStream()
        const writer = writable.getWriter()
        const encoder = new TextEncoder()

        ctx.waitUntil((async () => {
          try {
            // Send bot info
            if (bot.avatar_url) {
              await writer.write(encoder.encode(`event: agent_info\ndata: ${JSON.stringify({ avatarUrl: bot.avatar_url, botName: bot.name, botUsername: bot.username })}\n\n`))
            }

            // Build recent messages as the subagent expects (with user_id, body, created_at)
            const recentMessages = (conversationHistory || []).map((m, i) => ({
              user_id: m.role === 'assistant' ? `bot:${bot.id}` : userId,
              body: m.content,
              created_at: Date.now() - (conversationHistory.length - i) * 60000,
            }))
            // Add the trigger message
            recentMessages.push({
              user_id: userId,
              body: message,
              created_at: Date.now(),
            })

            // Run the chatbot subagent with full tool execution
            const result = await runChatbotSubagent(
              {
                bot,
                groupId: 'agent-chat-direct',
                groupName: 'Agent Chat',
                triggerMessage: message,
                recentMessages,
              },
              env,
              executeTool
            )

            if (result.success && result.response) {
              await writer.write(encoder.encode(`event: text\ndata: ${JSON.stringify({ content: result.response })}\n\n`))
              await writer.write(encoder.encode(`event: done\ndata: ${JSON.stringify({ turns: result.turns })}\n\n`))
            } else {
              await writer.write(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: result.error || 'Bot failed to respond' })}\n\n`))
            }
          } catch (err) {
            await writer.write(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`))
          } finally {
            await writer.close()
          }
        })())

        return new Response(readable, {
          headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        })
      }

      // POST /chat - Streaming conversational agent chat (SSE)
      if (pathname === '/chat' && request.method === 'POST') {
        const body = await request.json()
        const { userId, messages: userMessages, graphId, model, maxTurns, agentId, activeHtmlNodeId } = body
        console.log(`[/chat] graphId=${graphId} activeHtmlNodeId=${activeHtmlNodeId} agentId=${agentId}`)

        if (!userId || !userMessages || !Array.isArray(userMessages)) {
          return new Response(JSON.stringify({
            error: 'userId and messages[] are required'
          }), { status: 400, headers: corsHeaders })
        }

        let systemPrompt = CHAT_SYSTEM_PROMPT
        let toolFilter = null
        let agentAvatarUrl = null
        let agentModel = model || 'claude-haiku-4-5-20251001'

        // Load dynamic behavior rules from graph_system_prompt
        const dynamicRules = await loadDynamicPrompt(env)
        if (dynamicRules) systemPrompt += dynamicRules

        // Load per-agent config if agentId provided
        if (agentId) {
          const agentConfig = await env.DB.prepare(
            'SELECT * FROM agent_configs WHERE id = ?1 AND is_active = 1'
          ).bind(agentId).first()
          if (agentConfig) {
            // Prepend custom agent prompt but KEEP base prompt + dynamic rules.
            // Previously this replaced systemPrompt entirely, losing all learned behaviors.
            if (agentConfig.system_prompt) {
              systemPrompt = agentConfig.system_prompt + '\n\n' + systemPrompt
            }
            agentAvatarUrl = agentConfig.avatar_url || null
            if (agentConfig.model) agentModel = agentConfig.model
            const tools = JSON.parse(agentConfig.tools || '[]')
            if (tools.length > 0) toolFilter = tools
          }
        }

        // Inject current graph context from the UI.
        // This is not a forced KG target, but it gives the agent a stable reference when
        // the user says "this graph", "the current graph", or asks what is in context now.
        if (graphId) {
          systemPrompt += `\n\n## Current Graph Context\nThe currently selected graph in the UI is "${graphId}". When the user refers to this graph/current graph/context, they mean this graph. Before creating a new graph on a related topic, check whether this selected graph or another existing graph already contains the relevant work.`
        }

        // Only inject HTML node context as a concrete editing target.
        if (activeHtmlNodeId) {
          systemPrompt += `\n\n## Active HTML App\nThe active HTML node is "${activeHtmlNodeId}" in graph "${graphId}". Use this nodeId when reading or editing the HTML app — do NOT guess node IDs.`
        }

        const chatMessages = userMessages.map(m => ({ role: m.role, content: m.content }))

        // Inject current UI context into the last user message so the model doesn't miss it.
        if (graphId && chatMessages.length > 0) {
          const last = chatMessages[chatMessages.length - 1]
          if (last.role === 'user' && typeof last.content === 'string' && !last.content.includes(graphId)) {
            const htmlContext = activeHtmlNodeId ? `, activeHtmlNodeId="${activeHtmlNodeId}"` : ''
            last.content += `\n\n[Current UI context: graphId="${graphId}"${htmlContext}]`
          }
        }

        // --- Fast-path: bypass Claude for simple KG read operations ---
        // Detects unambiguous read intents and calls KG worker directly.
        // Saves entire Anthropic API call + multiple turns for trivial queries.
        const lastUserMsg = chatMessages.filter(m => m.role === 'user').pop()
        const fastPath = lastUserMsg ? detectKgFastPath(typeof lastUserMsg.content === 'string' ? lastUserMsg.content : '') : null
        if (fastPath && !agentId && !toolFilter) {
          const { readable, writable } = new TransformStream()
          const writer = writable.getWriter()
          const encoder = new TextEncoder()
          ctx.waitUntil((async () => {
            try {
              await executeKgFastPath(fastPath, writer, encoder, env, userId)
            } finally {
              await writer.close()
            }
          })())
          return new Response(readable, {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
              'Access-Control-Allow-Origin': '*',
            },
          })
        }
        // --- End fast-path ---

        const { readable, writable } = new TransformStream()
        const writer = writable.getWriter()
        const encoder = new TextEncoder()

        ctx.waitUntil(
          streamingAgentLoop(writer, encoder, chatMessages, systemPrompt, userId, env, {
            model: agentModel,
            maxTurns: maxTurns || 8,
            toolFilter,
            avatarUrl: agentAvatarUrl,
            graphId: graphId || null,
            activeHtmlNodeId: activeHtmlNodeId || null,
            agentId: agentId || null,
            version: AGENT_VERSION,
            versionNote: AGENT_VERSION_NOTE,
          })
        )

        return new Response(readable, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          },
        })
      }

      // GET /api/usage - Usage & cost dashboard data
      if (pathname === '/api/usage' && request.method === 'GET') {
        const params = url.searchParams
        const days = Math.min(parseInt(params.get('days') || '30', 10), 90)
        const userId = params.get('userId')

        if (!env.STATS_DB) {
          return new Response(JSON.stringify({ error: 'Stats DB not configured' }), { status: 503, headers: corsHeaders })
        }

        const since = new Date(Date.now() - days * 86400_000).toISOString()

        // Totals
        const totals = await env.STATS_DB.prepare(
          `SELECT
            COUNT(*) AS sessions,
            SUM(input_tokens) AS input_tokens,
            SUM(output_tokens) AS output_tokens,
            SUM(cost_usd) AS cost_usd,
            SUM(turns) AS turns,
            AVG(duration_ms) AS avg_duration_ms,
            SUM(fast_path) AS fast_path_sessions
           FROM sessions WHERE started_at >= ? ${userId ? 'AND user_id = ?' : ''}`
        ).bind(...(userId ? [since, userId] : [since])).first()

        // By model
        const byModel = await env.STATS_DB.prepare(
          `SELECT model,
            COUNT(*) AS sessions,
            SUM(input_tokens) AS input_tokens,
            SUM(output_tokens) AS output_tokens,
            SUM(cost_usd) AS cost_usd
           FROM sessions WHERE started_at >= ? ${userId ? 'AND user_id = ?' : ''}
           GROUP BY model ORDER BY cost_usd DESC`
        ).bind(...(userId ? [since, userId] : [since])).all()

        // Daily cost (last N days)
        const dailyCost = await env.STATS_DB.prepare(
          `SELECT substr(started_at, 1, 10) AS day,
            COUNT(*) AS sessions,
            SUM(cost_usd) AS cost_usd,
            SUM(input_tokens) AS input_tokens,
            SUM(output_tokens) AS output_tokens
           FROM sessions WHERE started_at >= ? ${userId ? 'AND user_id = ?' : ''}
           GROUP BY day ORDER BY day ASC`
        ).bind(...(userId ? [since, userId] : [since])).all()

        // Per-day model breakdown (for drill-down)
        const dailyByModel = await env.STATS_DB.prepare(
          `SELECT substr(started_at, 1, 10) AS day, model,
            COUNT(*) AS sessions,
            SUM(cost_usd) AS cost_usd
           FROM sessions WHERE started_at >= ? ${userId ? 'AND user_id = ?' : ''}
           GROUP BY day, model ORDER BY day ASC, cost_usd DESC`
        ).bind(...(userId ? [since, userId] : [since])).all()

        // Top tool calls
        const topTools = await env.STATS_DB.prepare(
          `SELECT tool_name, COUNT(*) AS calls, SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) AS successes
           FROM session_tools WHERE occurred_at >= ?
           GROUP BY tool_name ORDER BY calls DESC LIMIT 20`
        ).bind(since).all()

        // Recent sessions (last 20)
        const recent = await env.STATS_DB.prepare(
          `SELECT id, user_id, started_at, model, turns, input_tokens, output_tokens,
            cost_usd, success, duration_ms, agent_id, max_turns_reached
           FROM sessions WHERE started_at >= ? ${userId ? 'AND user_id = ?' : ''}
           ORDER BY started_at DESC LIMIT 20`
        ).bind(...(userId ? [since, userId] : [since])).all()

        return new Response(JSON.stringify({
          period: { days, since },
          totals,
          byModel: byModel.results || [],
          dailyCost: dailyCost.results || [],
          dailyByModel: dailyByModel.results || [],
          topTools: topTools.results || [],
          recentSessions: recent.results || [],
        }), { headers: corsHeaders })
      }

      // GET /api/cf-billing - Fetch real neuron usage from Cloudflare GraphQL Analytics API
      if (pathname === '/api/cf-billing' && request.method === 'GET') {
        const cfToken = env.CF_API_TOKEN
        const cfAccount = env.CF_ACCOUNT_ID
        if (!cfToken || !cfAccount) {
          return new Response(JSON.stringify({ error: 'CF_API_TOKEN or CF_ACCOUNT_ID not configured' }), { status: 503, headers: corsHeaders })
        }
        const days = Math.min(parseInt(url.searchParams.get('days') || '7', 10), 30)
        const dateFrom = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)
        const dateTo = new Date().toISOString().slice(0, 10)

        const query = `{
          viewer {
            accounts(filter: { accountTag: "${cfAccount}" }) {
              aiInferenceAdaptiveGroups(
                filter: { date_geq: "${dateFrom}", date_leq: "${dateTo}" }
                limit: 1000
              ) {
                sum { totalNeurons totalInputTokens totalOutputTokens }
                dimensions { modelId date }
              }
            }
          }
        }`

        const cfRes = await fetch('https://api.cloudflare.com/client/v4/graphql', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cfToken}`,
          },
          body: JSON.stringify({ query }),
        })

        if (!cfRes.ok) {
          const errText = await cfRes.text()
          return new Response(JSON.stringify({ error: `Cloudflare API error: ${cfRes.status}`, detail: errText }), { status: 502, headers: corsHeaders })
        }

        const cfData = await cfRes.json()
        if (cfData.errors) {
          return new Response(JSON.stringify({ error: 'CF GraphQL error', detail: cfData.errors }), { status: 502, headers: corsHeaders })
        }
        const groups = cfData?.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups || []

        // Aggregate by model
        const byModel = {}
        let totalNeurons = 0
        let totalInputTokens = 0
        let totalOutputTokens = 0
        for (const g of groups) {
          const modelId = g.dimensions?.modelId || 'unknown'
          const neurons = g.sum?.totalNeurons || 0
          const inTok = g.sum?.totalInputTokens || 0
          const outTok = g.sum?.totalOutputTokens || 0
          if (!byModel[modelId]) byModel[modelId] = { modelId, neurons: 0, inputTokens: 0, outputTokens: 0, days: {} }
          byModel[modelId].neurons += neurons
          byModel[modelId].inputTokens += inTok
          byModel[modelId].outputTokens += outTok
          const day = g.dimensions?.date
          if (day) byModel[modelId].days[day] = (byModel[modelId].days[day] || 0) + neurons
          totalNeurons += neurons
          totalInputTokens += inTok
          totalOutputTokens += outTok
        }

        // Neurons pricing: 10,000 free per day, then $0.011 per 1,000 neurons
        // We can't precisely split free vs paid per model, so show raw neurons + cost estimate
        const FREE_NEURONS_PER_DAY = 10_000
        const totalFreeNeurons = FREE_NEURONS_PER_DAY * days
        const billableNeurons = Math.max(0, totalNeurons - totalFreeNeurons)
        const estimatedCostUsd = (billableNeurons / 1_000) * 0.011

        const byModelArr = Object.values(byModel)
          .sort((a, b) => b.neurons - a.neurons)
          .map(m => ({ ...m, days: Object.entries(m.days).map(([date, neurons]) => ({ date, neurons })).sort((a, b) => a.date.localeCompare(b.date)) }))

        return new Response(JSON.stringify({
          period: { days, dateFrom, dateTo },
          totalNeurons,
          totalInputTokens,
          totalOutputTokens,
          freeNeurons: Math.min(totalNeurons, totalFreeNeurons),
          billableNeurons,
          estimatedCostUsd,
          byModel: byModelArr,
        }), { headers: corsHeaders })
      }

      // POST /upload-image - Upload base64 image to photos API, return imgix URL
      if (pathname === '/upload-image' && request.method === 'POST') {
        const body = await request.json()
        const { userId, base64, mediaType, filename } = body

        if (!userId || !base64) {
          return new Response(JSON.stringify({ error: 'userId and base64 are required' }), {
            status: 400, headers: corsHeaders
          })
        }

        // Look up user email from D1
        let userEmail = null
        try {
          const profile = await env.DB.prepare(
            'SELECT email FROM config WHERE user_id = ?'
          ).bind(userId).first()
          if (!profile) {
            const profileByEmail = await env.DB.prepare(
              'SELECT email FROM config WHERE email = ?'
            ).bind(userId).first()
            userEmail = profileByEmail?.email || userId
          } else {
            userEmail = profile.email
          }
        } catch { userEmail = userId }

        // Convert base64 to binary and build FormData
        const binaryData = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
        const blob = new Blob([binaryData], { type: mediaType || 'image/png' })
        const uploadName = filename || `agent-upload-${Date.now()}.${(mediaType || 'image/png').split('/')[1] || 'png'}`

        const formData = new FormData()
        formData.append('file', blob, uploadName)
        if (userEmail) formData.append('userEmail', userEmail)

        // Use service binding (avoids 522 worker-to-worker via public URL)
        const uploadRes = await env.PHOTOS_WORKER.fetch('https://photos-api.vegvisr.org/upload', {
          method: 'POST',
          body: formData
        })

        if (!uploadRes.ok) {
          const errText = await uploadRes.text()
          return new Response(JSON.stringify({ error: `Upload failed: ${errText}` }), {
            status: uploadRes.status, headers: corsHeaders
          })
        }

        const uploadData = await uploadRes.json()
        // photos-worker returns { urls: [...], keys: [...] } or { key, r2Key }
        const key = uploadData.keys?.[0] || uploadData.key || uploadData.r2Key || uploadName
        const url = uploadData.urls?.[0] || `https://vegvisr.imgix.net/${key}`

        return new Response(JSON.stringify({ key, url }), { headers: corsHeaders })
      }

      // POST /analyze - Direct semantic analysis (no agent loop)
      if (pathname === '/analyze' && request.method === 'POST') {
        const body = await request.json()
        const { graphId, nodeId } = body

        if (!graphId) {
          return new Response(JSON.stringify({ error: 'graphId is required' }), {
            status: 400, headers: corsHeaders
          })
        }

        try {
          let result
          if (nodeId) {
            result = await executeAnalyzeNode({ graphId, nodeId, analysisType: 'all', store: false, userId: 'viewer' }, env)
          } else {
            result = await executeAnalyzeGraph({ graphId, store: false, userId: 'viewer' }, env)
          }
          return new Response(JSON.stringify(result), { headers: corsHeaders })
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500, headers: corsHeaders
          })
        }
      }

      // GET /layout?contractId=xxx - Get saved node layout
      if (pathname === '/layout' && request.method === 'GET') {
        const contractId = url.searchParams.get('contractId')
        if (!contractId) {
          return new Response(JSON.stringify({ error: 'contractId required' }), {
            status: 400, headers: corsHeaders
          })
        }
        const row = await env.DB.prepare(
          'SELECT layout FROM agent_contracts WHERE id = ?1'
        ).bind(contractId).first()
        return new Response(JSON.stringify({
          contractId,
          layout: row?.layout ? JSON.parse(row.layout) : null
        }), { headers: corsHeaders })
      }

      // PUT /layout - Save node layout positions
      if (pathname === '/layout' && request.method === 'PUT') {
        const body = await request.json()
        const { contractId, layout } = body
        if (!contractId || !layout) {
          return new Response(JSON.stringify({ error: 'contractId and layout required' }), {
            status: 400, headers: corsHeaders
          })
        }
        await env.DB.prepare(
          'UPDATE agent_contracts SET layout = ?1, updated_at = datetime(\'now\') WHERE id = ?2'
        ).bind(JSON.stringify(layout), contractId).run()
        return new Response(JSON.stringify({
          contractId, saved: true
        }), { headers: corsHeaders })
      }

      // POST /build-html-page — Create html-node directly (no agent needed)
      if (pathname === '/build-html-page' && request.method === 'POST') {
        const body = await request.json()
        const { graphId, title, userId } = body

        if (!graphId || !title || !userId) {
          return new Response(JSON.stringify({ error: 'graphId, title, and userId required' }), {
            status: 400, headers: corsHeaders
          })
        }

        try {
          const result = await executeCreateHtmlFromTemplate({
            graphId,
            title,
            templateId: body.templateId || DEFAULT_TEMPLATE_ID,
            description: body.description || '',
            footerText: body.footerText || '',
            sections: body.sections || [],
            headerImage: body.headerImage || null,
          }, env)

          return new Response(JSON.stringify(result), { headers: corsHeaders })
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500, headers: corsHeaders
          })
        }
      }

      // GET /template-version — Return current template version(s)
      if (pathname === '/template-version' && request.method === 'GET') {
        const templateId = url.searchParams.get('templateId')
        if (templateId) {
          return new Response(JSON.stringify({
            templateId,
            version: getTemplateVersion(templateId),
          }), { headers: corsHeaders })
        }
        return new Response(JSON.stringify({
          version: getTemplateVersion(DEFAULT_TEMPLATE_ID),
          templates: listTemplates(),
        }), { headers: corsHeaders })
      }

      // GET /templates — List all available templates
      if (pathname === '/templates' && request.method === 'GET') {
        return new Response(JSON.stringify({
          templates: listTemplates(),
        }), { headers: corsHeaders })
      }

      // POST /upgrade-html-node — Upgrade existing html-node to latest template
      if (pathname === '/upgrade-html-node' && request.method === 'POST') {
        const body = await request.json()
        const { graphId, nodeId } = body

        if (!graphId || !nodeId) {
          return new Response(JSON.stringify({ error: 'graphId and nodeId required' }), {
            status: 400, headers: corsHeaders
          })
        }

        try {
          const getRes = await env.KG_WORKER.fetch(
            `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(graphId)}`
          )
          if (!getRes.ok) throw new Error(`Graph not found (${graphId}, status ${getRes.status})`)
          const graphData = await getRes.json()

          if (!graphData.nodes || !Array.isArray(graphData.nodes)) {
            throw new Error(`Invalid graph data: nodes missing or not array (keys: ${Object.keys(graphData).join(',')})`)
          }

          const nodeIndex = graphData.nodes.findIndex(n => String(n.id) === String(nodeId))
          if (nodeIndex === -1) {
            const nodeIds = graphData.nodes.filter(n => n.type === 'html-node').map(n => n.id)
            throw new Error(`Node ${nodeId} not found in graph ${graphId}. Html-nodes: [${nodeIds.join(', ')}]`)
          }
          const oldNode = graphData.nodes[nodeIndex]
          if (oldNode.type !== 'html-node') throw new Error('Node is not an html-node')

          const oldHtml = oldNode.info || ''
          const titleMatch = oldHtml.match(/<title>([^<]*)<\/title>/)
          const descMatch = oldHtml.match(/<p\s+class="muted[^"]*"[^>]*>([^<]*)<\/p>/)
          const footerMatch = oldHtml.match(/footer-text[^>]*>([^<]*)</)
          const oldVersionMatch = oldHtml.match(/<meta\s+name="template-version"\s+content="([^"]+)"/)

          const title = titleMatch ? titleMatch[1] : oldNode.label || 'Untitled'
          const description = descMatch ? descMatch[1] : ''
          const footerText = footerMatch ? footerMatch[1] : ''
          const oldVersion = oldVersionMatch ? oldVersionMatch[1] : 'none'

          const templateId = extractTemplateId(oldHtml)
          const entry = getTemplate(templateId)

          const headerImgMatch = oldHtml.match(/class="header-image"[^>]*style="[^"]*url\('([^']+)'\)/)
          const headerImage = headerImgMatch ? headerImgMatch[1] : null

          const themeStyleMatch = oldHtml.match(/<style data-vegvisr-theme="[^"]*">[^<]*<\/style>/)
          const savedThemeStyle = themeStyleMatch ? themeStyleMatch[0] : null

          let newHtml = entry.template
          newHtml = newHtml.replaceAll('{{TITLE}}', title)
          newHtml = newHtml.replaceAll('{{DESCRIPTION}}', description)
          newHtml = newHtml.replaceAll('{{FOOTER_TEXT}}', footerText)
          newHtml = newHtml.replaceAll('{{GRAPH_ID_DEFAULT}}', graphId)
          newHtml = newHtml.replaceAll('{{NODE_ID}}', nodeId)

          if (savedThemeStyle) {
            newHtml = newHtml.replace('</head>', savedThemeStyle + '\n</head>')
          }

          if (headerImage) {
            newHtml = newHtml.replace(
              /class="header-image"[^>]*>/,
              `class="header-image" style="background-image:url('${headerImage}');background-size:cover;background-position:center;height:200px;">`
            )
          }

          const newVersion = getTemplateVersion(templateId)

          const currentRes = await env.KG_WORKER.fetch(
            `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(graphId)}`
          )
          const currentData = await currentRes.json()
          if (!currentRes.ok) {
            throw new Error(currentData.error || 'Failed to fetch current graph version')
          }

          const saveRes = await env.KG_WORKER.fetch('https://knowledge-graph-worker/patchNode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              graphId,
              nodeId,
              fields: { info: newHtml },
              expectedVersion: Number(currentData?.metadata?.version || 0)
            })
          })

          if (!saveRes.ok) {
            const errData = await saveRes.text()
            throw new Error('Failed to save upgraded graph: ' + errData)
          }

          return new Response(JSON.stringify({
            success: true,
            nodeId,
            templateId,
            oldVersion,
            newVersion,
            title,
            htmlSize: newHtml.length,
            message: `Upgraded ${templateId} from v${oldVersion} to v${newVersion}`
          }), { headers: corsHeaders })
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500, headers: corsHeaders
          })
        }
      }

      // GET /tools — List all available tools (hardcoded + dynamic OpenAPI)
      if (pathname === '/tools' && request.method === 'GET') {
        let openAPITools = []
        try {
          const loaded = await loadOpenAPITools(env)
          openAPITools = loaded.tools
        } catch (err) {
          // ignore
        }
        const hardcodedNames = new Set(TOOL_DEFINITIONS.map(t => t.name))
        const dynamicTools = openAPITools.filter(t => !hardcodedNames.has(t.name))
        return new Response(JSON.stringify({
          hardcoded: TOOL_DEFINITIONS.map(t => ({ name: t.name, description: t.description })),
          dynamic: dynamicTools.map(t => ({ name: t.name, description: t.description })),
          total: TOOL_DEFINITIONS.length + dynamicTools.length + 1, // +1 for web_search
        }), { headers: corsHeaders })
      }

      // GET /agents — List all active agents
      if (pathname === '/agents' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          `SELECT id, name, description, avatar_url, model, tools, is_active
           FROM agent_configs WHERE is_active = 1 ORDER BY name`
        ).all()
        return new Response(JSON.stringify({ agents: results || [] }), { headers: corsHeaders })
      }

      // POST /agents — Create a new agent
      if (pathname === '/agents' && request.method === 'POST') {
        const body = await request.json()
        const { name, description, system_prompt, model, max_tokens, temperature, tools, metadata, avatar_url } = body
        if (!name) {
          return new Response(JSON.stringify({ error: 'name is required' }), { status: 400, headers: corsHeaders })
        }
        const id = `agent_${crypto.randomUUID().slice(0, 8)}`
        await env.DB.prepare(
          `INSERT INTO agent_configs (id, name, description, system_prompt, model, max_tokens, temperature, tools, metadata, is_active, avatar_url)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10)`
        ).bind(
          id,
          name,
          description || '',
          system_prompt || '',
          model || 'claude-haiku-4-5-20251001',
          max_tokens || 4096,
          temperature ?? 0.3,
          JSON.stringify(tools || []),
          JSON.stringify(metadata || {}),
          avatar_url || null
        ).run()
        return new Response(JSON.stringify({ id, name, created: true }), { status: 201, headers: corsHeaders })
      }

      // GET /agent?id=xxx — Get single agent details
      if (pathname === '/agent' && request.method === 'GET') {
        const agentId = url.searchParams.get('id')
        if (!agentId) {
          return new Response(JSON.stringify({ error: 'id query param required' }), { status: 400, headers: corsHeaders })
        }
        const agent = await env.DB.prepare(
          'SELECT * FROM agent_configs WHERE id = ?1'
        ).bind(agentId).first()
        if (!agent) {
          return new Response(JSON.stringify({ error: 'Agent not found' }), { status: 404, headers: corsHeaders })
        }
        return new Response(JSON.stringify({ agent }), { headers: corsHeaders })
      }

      // PUT /agent — Update agent fields
      if (pathname === '/agent' && request.method === 'PUT') {
        const body = await request.json()
        const { id: agentId } = body
        if (!agentId) {
          return new Response(JSON.stringify({ error: 'id is required' }), { status: 400, headers: corsHeaders })
        }
        const allowedFields = ['name', 'description', 'system_prompt', 'model', 'max_tokens', 'temperature', 'avatar_url', 'is_active']
        const sets = []
        const values = []
        for (const key of allowedFields) {
          if (body[key] !== undefined) {
            sets.push(`${key} = ?`)
            values.push(body[key])
          }
        }
        if (body.tools !== undefined) { sets.push('tools = ?'); values.push(JSON.stringify(body.tools)) }
        if (body.metadata !== undefined) { sets.push('metadata = ?'); values.push(JSON.stringify(body.metadata)) }
        if (sets.length === 0) {
          return new Response(JSON.stringify({ error: 'No fields to update' }), { status: 400, headers: corsHeaders })
        }
        values.push(agentId)
        await env.DB.prepare(
          `UPDATE agent_configs SET ${sets.join(', ')} WHERE id = ?`
        ).bind(...values).run()
        return new Response(JSON.stringify({ id: agentId, updated: true }), { headers: corsHeaders })
      }

      // DELETE /agent — Soft-delete agent (set is_active = 0)
      if (pathname === '/agent' && request.method === 'DELETE') {
        const body = await request.json()
        const { id: agentId } = body
        if (!agentId) {
          return new Response(JSON.stringify({ error: 'id is required' }), { status: 400, headers: corsHeaders })
        }
        await env.DB.prepare(
          'UPDATE agent_configs SET is_active = 0 WHERE id = ?1'
        ).bind(agentId).run()
        return new Response(JSON.stringify({ id: agentId, deleted: true }), { headers: corsHeaders })
      }

      // ── Chat Bot management proxies (via CHAT_WORKER) ──

      // Helper: resolve user profile for CHAT_WORKER auth
      async function resolveProfileForProxy(userId) {
        if (!userId) return null
        try {
          // Try by user_id first, then by email
          let row = await env.DB.prepare('SELECT user_id, email, phone FROM config WHERE user_id = ?').bind(userId).first()
          if (!row) row = await env.DB.prepare('SELECT user_id, email, phone FROM config WHERE email = ?').bind(userId).first()
          if (!row) {
            // Try smsgway profile API as fallback
            const profileRes = await fetch(`https://smsgway.vegvisr.org/api/auth/profile?userId=${encodeURIComponent(userId)}`)
            if (profileRes.ok) {
              const p = await profileRes.json()
              if (p.phone) return { user_id: p.user_id || userId, email: p.email || userId, phone: p.phone }
            }
            return null
          }
          return { user_id: row.user_id || userId, email: row.email || userId, phone: row.phone }
        } catch { return null }
      }

      // GET /chat-groups — list groups via CHAT_WORKER
      if (pathname === '/chat-groups' && request.method === 'GET') {
        const userId = url.searchParams.get('userId')
        const profile = userId ? await resolveProfileForProxy(userId) : null
        if (!profile) {
          return new Response(JSON.stringify({ error: 'Could not resolve user profile. Pass ?userId=<email>' }), { status: 400, headers: corsHeaders })
        }
        const qs = `user_id=${encodeURIComponent(profile.user_id)}&phone=${encodeURIComponent(profile.phone)}&email=${encodeURIComponent(profile.email)}`
        const res = await env.CHAT_WORKER.fetch(`https://group-chat-worker/groups?${qs}`)
        const data = await res.text()
        return new Response(data, { status: res.status, headers: corsHeaders })
      }

      // GET /agent-bot-groups?agentId=X — get groups where agent's bot is registered
      if (pathname === '/agent-bot-groups' && request.method === 'GET') {
        const agentId = url.searchParams.get('agentId')
        const userId = url.searchParams.get('userId')
        if (!agentId) return new Response(JSON.stringify({ error: 'agentId required' }), { status: 400, headers: corsHeaders })

        // Look up the agent's chat_bot_id from metadata
        const agent = await env.DB.prepare('SELECT metadata FROM agent_configs WHERE id = ?').bind(agentId).first()
        const meta = agent?.metadata ? JSON.parse(agent.metadata) : {}
        const chatBotId = meta.chatBotId

        if (!chatBotId) {
          // No bot registered yet — return empty
          return new Response(JSON.stringify({ groups: [] }), { headers: corsHeaders })
        }

        // Get bot details (includes groups) from CHAT_WORKER
        const profile = userId ? await resolveProfileForProxy(userId) : null
        if (!profile) {
          return new Response(JSON.stringify({ error: 'Could not resolve user profile. Pass ?userId=<email>' }), { status: 400, headers: corsHeaders })
        }
        const qs = `user_id=${encodeURIComponent(profile.user_id)}&phone=${encodeURIComponent(profile.phone)}&email=${encodeURIComponent(profile.email)}`
        const res = await env.CHAT_WORKER.fetch(`https://group-chat-worker/bots/${chatBotId}?${qs}`)
        const data = await res.json()
        if (!res.ok) {
          return new Response(JSON.stringify({ groups: [] }), { headers: corsHeaders })
        }
        const groups = (data.groups || []).map(g => ({ groupId: g.id, groupName: g.name }))
        return new Response(JSON.stringify({ groups }), { headers: corsHeaders })
      }

      // POST /register-agent-bot — create bot via CHAT_WORKER and add to group
      if (pathname === '/register-agent-bot' && request.method === 'POST') {
        const body = await request.json()
        const { agentId, groupId, botName, graphId, userId } = body
        if (!agentId) return new Response(JSON.stringify({ error: 'agentId required' }), { status: 400, headers: corsHeaders })

        const profile = userId ? await resolveProfileForProxy(userId) : null
        if (!profile) {
          return new Response(JSON.stringify({ error: 'Could not resolve user profile. Include userId in request.' }), { status: 400, headers: corsHeaders })
        }

        // Check if agent already has a bot
        const agent = await env.DB.prepare('SELECT metadata FROM agent_configs WHERE id = ?').bind(agentId).first()
        const meta = agent?.metadata ? JSON.parse(agent.metadata) : {}
        let chatBotId = meta.chatBotId

        if (!chatBotId) {
          // Create the bot via CHAT_WORKER
          const agentConfig = await env.DB.prepare('SELECT name, avatar_url FROM agent_configs WHERE id = ?').bind(agentId).first()
          const username = (botName || agentConfig?.name || 'agent').toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 30)

          const createRes = await env.CHAT_WORKER.fetch('https://group-chat-worker/bots', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user_id: profile.user_id,
              phone: profile.phone,
              email: profile.email,
              name: botName || agentConfig?.name || 'Agent Bot',
              username,
              graph_id: graphId || undefined,
              avatar_url: agentConfig?.avatar_url || undefined,
              tools: [],
            })
          })
          const createData = await createRes.json()
          if (!createRes.ok) {
            return new Response(JSON.stringify({ error: createData.error || 'Failed to create bot' }), { status: 500, headers: corsHeaders })
          }
          chatBotId = createData.bot.id

          // Store chatBotId in agent metadata
          meta.chatBotId = chatBotId
          if (graphId) meta.botGraphId = graphId
          await env.DB.prepare('UPDATE agent_configs SET metadata = ? WHERE id = ?')
            .bind(JSON.stringify(meta), agentId).run()
        }

        // Add bot to group if groupId provided
        if (groupId) {
          const addRes = await env.CHAT_WORKER.fetch(`https://group-chat-worker/groups/${groupId}/bots`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user_id: profile.user_id,
              phone: profile.phone,
              email: profile.email,
              bot_id: chatBotId,
            })
          })
          const addData = await addRes.json()
          if (!addRes.ok) {
            return new Response(JSON.stringify({ error: addData.error || 'Bot created but failed to add to group', chatBotId }), { status: 500, headers: corsHeaders })
          }
        }

        return new Response(JSON.stringify({ success: true, chatBotId, agentId, groupId }), { headers: corsHeaders })
      }

      // POST /unregister-agent-bot — remove bot from a group
      if (pathname === '/unregister-agent-bot' && request.method === 'POST') {
        const body = await request.json()
        const { agentId, groupId, userId } = body
        if (!agentId || !groupId) return new Response(JSON.stringify({ error: 'agentId and groupId required' }), { status: 400, headers: corsHeaders })

        const profile = userId ? await resolveProfileForProxy(userId) : null
        if (!profile) {
          return new Response(JSON.stringify({ error: 'Could not resolve user profile. Include userId in request.' }), { status: 400, headers: corsHeaders })
        }

        // Get chatBotId from agent metadata
        const agent = await env.DB.prepare('SELECT metadata FROM agent_configs WHERE id = ?').bind(agentId).first()
        const meta = agent?.metadata ? JSON.parse(agent.metadata) : {}
        const chatBotId = meta.chatBotId
        if (!chatBotId) {
          return new Response(JSON.stringify({ error: 'Agent has no registered bot' }), { status: 400, headers: corsHeaders })
        }

        const qs = `user_id=${encodeURIComponent(profile.user_id)}&phone=${encodeURIComponent(profile.phone)}&email=${encodeURIComponent(profile.email)}`
        const res = await env.CHAT_WORKER.fetch(`https://group-chat-worker/groups/${groupId}/bots/${chatBotId}?${qs}`, {
          method: 'DELETE'
        })
        const data = await res.json()
        if (!res.ok) {
          return new Response(JSON.stringify({ error: data.error || 'Failed to remove bot from group' }), { status: 500, headers: corsHeaders })
        }

        return new Response(JSON.stringify({ success: true, agentId, groupId, chatBotId }), { headers: corsHeaders })
      }

      // POST /bot-respond — Chatbot subagent: generate and post bot response
      if (pathname === '/bot-respond' && request.method === 'POST') {
        const body = await request.json()
        const { bot, group_id, group_name, trigger_message, recent_messages } = body

        if (!bot || !group_id) {
          return new Response(JSON.stringify({ error: 'bot and group_id are required' }), {
            status: 400, headers: corsHeaders
          })
        }

        try {
          const result = await runChatbotSubagent(
            {
              bot,
              groupId: group_id,
              groupName: group_name || 'Unknown Group',
              triggerMessage: trigger_message,
              recentMessages: recent_messages || [],
            },
            env,
            executeTool
          )

          if (!result.success || !result.response) {
            return new Response(JSON.stringify({
              success: false,
              error: result.error || 'Bot generated no response',
              turns: result.turns,
            }), { status: 500, headers: corsHeaders })
          }

          // Post the bot's response back to the group via CHAT_WORKER
          if (env.CHAT_WORKER) {
            const postRes = await env.CHAT_WORKER.fetch('https://group-chat-worker/bot-message', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                bot_id: bot.id,
                group_id,
                body: result.response,
              }),
            })
            const postData = await postRes.json()
            if (!postRes.ok) {
              return new Response(JSON.stringify({
                success: false,
                error: postData.error || 'Failed to post bot message',
                response: result.response,
                turns: result.turns,
              }), { status: 500, headers: corsHeaders })
            }

            return new Response(JSON.stringify({
              success: true,
              message_id: postData.message?.id,
              bot_name: bot.name,
              bot_username: bot.username,
              response: result.response,
              turns: result.turns,
            }), { headers: corsHeaders })
          }

          // No CHAT_WORKER binding — return response for caller to post
          return new Response(JSON.stringify({
            success: true,
            response: result.response,
            turns: result.turns,
            bot_name: bot.name,
            note: 'CHAT_WORKER not bound — response not posted automatically',
          }), { headers: corsHeaders })
        } catch (err) {
          console.error('[bot-respond] Error:', err)
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500, headers: corsHeaders
          })
        }
      }

      // GET /openapi.json - OpenAPI 3.0 specification
      if (pathname === '/openapi.json' && request.method === 'GET') {
        const spec = {
          openapi: '3.0.3',
          info: {
            title: 'Agent Worker API',
            version: '1.0.0',
            description: 'HTTP API for the Vegvisr Agent Worker — agent execution, streaming chat, image upload, semantic analysis, HTML building, template management, agent CRUD, chat-bot management, and health checks.',
          },
          servers: [{ url: '/' }],
          paths: {
            '/api/data-node/submit': {
              post: {
                summary: 'Submit a record to a data-node',
                description: 'Public form submission endpoint. Landing pages POST here to append records to data-nodes (no auth required).',
                requestBody: {
                  required: true,
                  content: { 'application/json': { schema: {
                    type: 'object',
                    required: ['graphId', 'nodeId', 'record'],
                    properties: {
                      graphId: { type: 'string' },
                      nodeId: { type: 'string' },
                      record: { type: 'object', description: 'Arbitrary key-value record to append' },
                    },
                  } } },
                },
                responses: {
                  '200': { description: 'Record saved', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, recordId: { type: 'string' }, recordCount: { type: 'integer' } } } } } },
                  '400': { description: 'Missing required fields' },
                  '404': { description: 'Graph or data-node not found' },
                  '500': { description: 'Failed to save record' },
                },
              },
            },
            '/execute': {
              post: {
                summary: 'Execute an agent',
                description: 'Run a configured agent with a given task. Returns the agent execution result.',
                requestBody: {
                  required: true,
                  content: { 'application/json': { schema: {
                    type: 'object',
                    required: ['agentId', 'task', 'userId'],
                    properties: {
                      agentId: { type: 'string' },
                      task: { type: 'string' },
                      userId: { type: 'string' },
                      contractId: { type: 'string', description: 'Optional contract ID override' },
                      graphId: { type: 'string', description: 'Optional target graph ID (auto-generated if omitted)' },
                    },
                  } } },
                },
                responses: {
                  '200': { description: 'Agent execution result', content: { 'application/json': { schema: { type: 'object' } } } },
                  '400': { description: 'Missing required fields' },
                  '404': { description: 'Agent not found or inactive' },
                },
              },
            },
            '/chat': {
              post: {
                summary: 'Streaming conversational agent chat (SSE)',
                description: 'Send messages and receive a Server-Sent Events stream with agent responses and tool calls.',
                requestBody: {
                  required: true,
                  content: { 'application/json': { schema: {
                    type: 'object',
                    required: ['userId', 'messages'],
                    properties: {
                      userId: { type: 'string' },
                      messages: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, content: { type: 'string' } } } },
                      graphId: { type: 'string' },
                      model: { type: 'string', description: 'Model ID override' },
                      maxTurns: { type: 'integer', description: 'Max agent turns (default 8)' },
                      agentId: { type: 'string', description: 'Load per-agent config (system prompt, tools, model)' },
                      activeHtmlNodeId: { type: 'string', description: 'Active HTML node context' },
                    },
                  } } },
                },
                responses: {
                  '200': { description: 'SSE stream', content: { 'text/event-stream': { schema: { type: 'string' } } } },
                  '400': { description: 'Missing required fields' },
                },
              },
            },
            '/upload-image': {
              post: {
                summary: 'Upload a base64 image',
                description: 'Upload a base64-encoded image to the photos API and return an imgix URL.',
                requestBody: {
                  required: true,
                  content: { 'application/json': { schema: {
                    type: 'object',
                    required: ['userId', 'base64'],
                    properties: {
                      userId: { type: 'string' },
                      base64: { type: 'string', description: 'Base64-encoded image data' },
                      mediaType: { type: 'string', description: 'MIME type (default image/png)' },
                      filename: { type: 'string' },
                    },
                  } } },
                },
                responses: {
                  '200': { description: 'Upload result', content: { 'application/json': { schema: { type: 'object', properties: { key: { type: 'string' }, url: { type: 'string' } } } } } },
                  '400': { description: 'Missing required fields' },
                },
              },
            },
            '/analyze': {
              post: {
                summary: 'Direct semantic analysis',
                description: 'Run semantic analysis on a graph or a specific node (no agent loop).',
                requestBody: {
                  required: true,
                  content: { 'application/json': { schema: {
                    type: 'object',
                    required: ['graphId'],
                    properties: {
                      graphId: { type: 'string' },
                      nodeId: { type: 'string', description: 'If provided, analyze a single node; otherwise analyze the whole graph' },
                    },
                  } } },
                },
                responses: {
                  '200': { description: 'Analysis result', content: { 'application/json': { schema: { type: 'object' } } } },
                  '400': { description: 'Missing graphId' },
                  '500': { description: 'Analysis error' },
                },
              },
            },
            '/layout': {
              get: {
                summary: 'Get saved node layout',
                description: 'Retrieve saved node layout positions for an agent contract.',
                parameters: [
                  { name: 'contractId', in: 'query', required: true, schema: { type: 'string' } },
                ],
                responses: {
                  '200': { description: 'Layout data', content: { 'application/json': { schema: { type: 'object', properties: { contractId: { type: 'string' }, layout: { type: 'object', nullable: true } } } } } },
                  '400': { description: 'Missing contractId' },
                },
              },
              put: {
                summary: 'Save node layout positions',
                requestBody: {
                  required: true,
                  content: { 'application/json': { schema: {
                    type: 'object',
                    required: ['contractId', 'layout'],
                    properties: {
                      contractId: { type: 'string' },
                      layout: { type: 'object', description: 'Node position data' },
                    },
                  } } },
                },
                responses: {
                  '200': { description: 'Layout saved', content: { 'application/json': { schema: { type: 'object', properties: { contractId: { type: 'string' }, saved: { type: 'boolean' } } } } } },
                  '400': { description: 'Missing required fields' },
                },
              },
            },
            '/build-html-page': {
              post: {
                summary: 'Create an html-node directly (no agent needed)',
                requestBody: {
                  required: true,
                  content: { 'application/json': { schema: {
                    type: 'object',
                    required: ['graphId', 'title', 'userId'],
                    properties: {
                      graphId: { type: 'string' },
                      title: { type: 'string' },
                      userId: { type: 'string' },
                      templateId: { type: 'string', description: 'Template to use (uses default if omitted)' },
                      description: { type: 'string' },
                      footerText: { type: 'string' },
                      sections: { type: 'array', items: { type: 'object' } },
                      headerImage: { type: 'string', nullable: true },
                    },
                  } } },
                },
                responses: {
                  '200': { description: 'HTML node created', content: { 'application/json': { schema: { type: 'object' } } } },
                  '400': { description: 'Missing required fields' },
                  '500': { description: 'Creation error' },
                },
              },
            },
            '/template-version': {
              get: {
                summary: 'Get current template version(s)',
                parameters: [
                  { name: 'templateId', in: 'query', required: false, schema: { type: 'string' }, description: 'Specific template ID. If omitted, returns default template version and all template listings.' },
                ],
                responses: {
                  '200': { description: 'Template version info', content: { 'application/json': { schema: { type: 'object', properties: { templateId: { type: 'string' }, version: { type: 'string' }, templates: { type: 'array', items: { type: 'object' } } } } } } },
                },
              },
            },
            '/templates': {
              get: {
                summary: 'List all available templates',
                responses: {
                  '200': { description: 'Template list', content: { 'application/json': { schema: { type: 'object', properties: { templates: { type: 'array', items: { type: 'object' } } } } } } },
                },
              },
            },
            '/upgrade-html-node': {
              post: {
                summary: 'Upgrade existing html-node to latest template',
                requestBody: {
                  required: true,
                  content: { 'application/json': { schema: {
                    type: 'object',
                    required: ['graphId', 'nodeId'],
                    properties: {
                      graphId: { type: 'string' },
                      nodeId: { type: 'string' },
                    },
                  } } },
                },
                responses: {
                  '200': { description: 'Upgrade result', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, nodeId: { type: 'string' }, templateId: { type: 'string' }, oldVersion: { type: 'string' }, newVersion: { type: 'string' }, title: { type: 'string' }, htmlSize: { type: 'integer' }, message: { type: 'string' } } } } } },
                  '500': { description: 'Upgrade error' },
                },
              },
            },
            '/tools': {
              get: {
                summary: 'List all available tools',
                description: 'Returns hardcoded tool definitions and dynamically loaded OpenAPI tools.',
                responses: {
                  '200': { description: 'Tool listing', content: { 'application/json': { schema: { type: 'object', properties: { hardcoded: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } } } }, dynamic: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } } } }, total: { type: 'integer' } } } } } },
                },
              },
            },
            '/agents': {
              get: {
                summary: 'List all active agents',
                responses: {
                  '200': { description: 'Agent list', content: { 'application/json': { schema: { type: 'object', properties: { agents: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, avatar_url: { type: 'string', nullable: true }, model: { type: 'string' }, tools: { type: 'string' }, is_active: { type: 'integer' } } } } } } } } },
                },
              },
              post: {
                summary: 'Create a new agent',
                requestBody: {
                  required: true,
                  content: { 'application/json': { schema: {
                    type: 'object',
                    required: ['name'],
                    properties: {
                      name: { type: 'string' },
                      description: { type: 'string' },
                      system_prompt: { type: 'string' },
                      model: { type: 'string', description: 'Default: claude-haiku-4-5-20251001' },
                      max_tokens: { type: 'integer', description: 'Default: 4096' },
                      temperature: { type: 'number', description: 'Default: 0.3' },
                      tools: { type: 'array', items: { type: 'string' } },
                      metadata: { type: 'object' },
                      avatar_url: { type: 'string', nullable: true },
                    },
                  } } },
                },
                responses: {
                  '201': { description: 'Agent created', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, created: { type: 'boolean' } } } } } },
                  '400': { description: 'Missing name' },
                },
              },
            },
            '/agent': {
              get: {
                summary: 'Get single agent details',
                parameters: [
                  { name: 'id', in: 'query', required: true, schema: { type: 'string' } },
                ],
                responses: {
                  '200': { description: 'Agent details', content: { 'application/json': { schema: { type: 'object', properties: { agent: { type: 'object' } } } } } },
                  '400': { description: 'Missing id' },
                  '404': { description: 'Agent not found' },
                },
              },
              put: {
                summary: 'Update agent fields',
                requestBody: {
                  required: true,
                  content: { 'application/json': { schema: {
                    type: 'object',
                    required: ['id'],
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                      description: { type: 'string' },
                      system_prompt: { type: 'string' },
                      model: { type: 'string' },
                      max_tokens: { type: 'integer' },
                      temperature: { type: 'number' },
                      avatar_url: { type: 'string' },
                      is_active: { type: 'integer' },
                      tools: { type: 'array', items: { type: 'string' } },
                      metadata: { type: 'object' },
                    },
                  } } },
                },
                responses: {
                  '200': { description: 'Agent updated', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' }, updated: { type: 'boolean' } } } } } },
                  '400': { description: 'Missing id or no fields' },
                },
              },
              delete: {
                summary: 'Soft-delete agent (set is_active = 0)',
                requestBody: {
                  required: true,
                  content: { 'application/json': { schema: {
                    type: 'object',
                    required: ['id'],
                    properties: {
                      id: { type: 'string' },
                    },
                  } } },
                },
                responses: {
                  '200': { description: 'Agent deleted', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' }, deleted: { type: 'boolean' } } } } } },
                  '400': { description: 'Missing id' },
                },
              },
            },
            '/chat-groups': {
              get: {
                summary: 'List chat groups for a user',
                description: 'Proxy to CHAT_WORKER to list groups the user belongs to.',
                parameters: [
                  { name: 'userId', in: 'query', required: true, schema: { type: 'string' }, description: 'User email or ID' },
                ],
                responses: {
                  '200': { description: 'Group list from CHAT_WORKER' },
                  '400': { description: 'Could not resolve user profile' },
                },
              },
            },
            '/agent-bot-groups': {
              get: {
                summary: 'Get groups where agent bot is registered',
                parameters: [
                  { name: 'agentId', in: 'query', required: true, schema: { type: 'string' } },
                  { name: 'userId', in: 'query', required: true, schema: { type: 'string' } },
                ],
                responses: {
                  '200': { description: 'Group list', content: { 'application/json': { schema: { type: 'object', properties: { groups: { type: 'array', items: { type: 'object', properties: { groupId: { type: 'string' }, groupName: { type: 'string' } } } } } } } } },
                  '400': { description: 'Missing agentId or user profile' },
                },
              },
            },
            '/register-agent-bot': {
              post: {
                summary: 'Create bot via CHAT_WORKER and add to group',
                requestBody: {
                  required: true,
                  content: { 'application/json': { schema: {
                    type: 'object',
                    required: ['agentId'],
                    properties: {
                      agentId: { type: 'string' },
                      groupId: { type: 'string', description: 'Optional group to add bot to' },
                      botName: { type: 'string' },
                      graphId: { type: 'string' },
                      userId: { type: 'string' },
                    },
                  } } },
                },
                responses: {
                  '200': { description: 'Bot registered', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, chatBotId: { type: 'string' }, agentId: { type: 'string' }, groupId: { type: 'string' } } } } } },
                  '400': { description: 'Missing agentId or user profile' },
                  '500': { description: 'Registration error' },
                },
              },
            },
            '/unregister-agent-bot': {
              post: {
                summary: 'Remove bot from a group',
                requestBody: {
                  required: true,
                  content: { 'application/json': { schema: {
                    type: 'object',
                    required: ['agentId', 'groupId'],
                    properties: {
                      agentId: { type: 'string' },
                      groupId: { type: 'string' },
                      userId: { type: 'string' },
                    },
                  } } },
                },
                responses: {
                  '200': { description: 'Bot removed from group', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, agentId: { type: 'string' }, groupId: { type: 'string' }, chatBotId: { type: 'string' } } } } } },
                  '400': { description: 'Missing required fields or no bot registered' },
                  '500': { description: 'Removal error' },
                },
              },
            },
            '/bot-respond': {
              post: {
                summary: 'Generate and post bot response via chatbot subagent',
                requestBody: {
                  required: true,
                  content: { 'application/json': { schema: {
                    type: 'object',
                    required: ['bot', 'group_id'],
                    properties: {
                      bot: { type: 'object', description: 'Bot config (id, name, username, etc.)' },
                      group_id: { type: 'string' },
                      group_name: { type: 'string' },
                      trigger_message: { type: 'object', description: 'Message that triggered the bot' },
                      recent_messages: { type: 'array', items: { type: 'object' }, description: 'Recent conversation context' },
                    },
                  } } },
                },
                responses: {
                  '200': { description: 'Bot response generated and posted', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, message_id: { type: 'string' }, bot_name: { type: 'string' }, bot_username: { type: 'string' }, response: { type: 'string' }, turns: { type: 'integer' } } } } } },
                  '400': { description: 'Missing bot or group_id' },
                  '500': { description: 'Bot response error' },
                },
              },
            },
            '/introspect': {
              get: {
                summary: 'Full agent self-knowledge and introspection',
                description: 'Returns the agent complete internal configuration: all workers (with live health), subagents (with system prompts, tools, models), tool definitions, databases, frontend apps, credentials, node types, and templates. All data read dynamically from graph_system_registry + live service bindings.',
                responses: {
                  '200': { description: 'Agent introspection data', content: { 'application/json': { schema: {
                    type: 'object',
                    properties: {
                      agent: { type: 'object', properties: { name: { type: 'string' }, version: { type: 'string' }, registrySource: { type: 'string' }, selfModifiable: { type: 'boolean' } } },
                      workers: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, binding: { type: 'string' }, domain: { type: 'string', nullable: true }, status: { type: 'string' }, endpointCount: { type: 'integer' } } } },
                      subagents: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, delegationTool: { type: 'string' }, model: { type: 'string' }, tools: { type: 'array', items: { type: 'string' } }, source: { type: 'string', enum: ['graph', 'code'] } } } },
                      tools: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, parameters: { type: 'array', items: { type: 'string' } } } } },
                      databases: { type: 'array', items: { type: 'object' } },
                      apps: { type: 'array', items: { type: 'object' } },
                      credentials: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, configured: { type: 'boolean' }, usedBy: { type: 'string' } } } },
                      summary: { type: 'object' },
                      message: { type: 'string' },
                    },
                  } } } },
                  '500': { description: 'Introspection failed' },
                },
              },
            },
            '/health': {
              get: {
                summary: 'Health check',
                responses: {
                  '200': { description: 'Worker is healthy', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string' }, worker: { type: 'string' }, timestamp: { type: 'string', format: 'date-time' } } } } } },
                },
              },
            },
            '/openapi.json': {
              get: {
                summary: 'OpenAPI 3.0 specification',
                responses: {
                  '200': { description: 'This OpenAPI spec', content: { 'application/json': { schema: { type: 'object' } } } },
                },
              },
            },
          },
        }
        return new Response(JSON.stringify(spec, null, 2), { headers: corsHeaders })
      }

      // GET /introspect - Full agent self-knowledge (reads from graph_system_registry)
      if (pathname === '/introspect' && request.method === 'GET') {
        try {
          // 1. Fetch registry graph
          let registryNodes = []
          try {
            const regRes = await env.KG_WORKER.fetch('https://knowledge-graph-worker/getknowgraph?id=graph_system_registry')
            if (regRes.ok) {
              const regData = await regRes.json()
              registryNodes = regData.nodes || []
            }
          } catch {}

          const byType = (type) => registryNodes.filter(n => n.type === type)

          // 2. Workers — from graph + live health
          const workerNodes = byType('system-worker')
          const workers = await Promise.all(workerNodes.map(async (node) => {
            const meta = node.metadata || {}
            const binding = meta.binding
            if (!binding || binding === 'self') return { id: node.id, name: meta.name || node.label, binding, status: 'self', endpointCount: 0 }
            const fetcher = env[binding]
            if (!fetcher) return { id: node.id, name: meta.name || node.label, binding, status: 'no-binding', endpointCount: 0 }
            const workerName = meta.name || node.label
            try {
              let hRes = await fetcher.fetch(`https://${workerName}/health`)
              if (!hRes.ok) hRes = await fetcher.fetch(`https://${workerName}/api/health`)
              const hData = hRes.ok ? await hRes.json() : {}
              const healthy = hData.status === 'healthy' || hData.status === 'ok' || hData.ok === true || hData.endpoints
              let endpointCount = 0
              try {
                const specRes = await fetcher.fetch(`https://${workerName}/openapi.json`)
                if (specRes.ok) {
                  const spec = await specRes.json()
                  if (spec.paths) {
                    for (const methods of Object.values(spec.paths)) {
                      endpointCount += Object.keys(methods).length
                    }
                  }
                }
              } catch {}
              return { id: node.id, name: workerName, binding, domain: meta.domain || null, status: healthy ? 'healthy' : 'unhealthy', endpointCount }
            } catch {
              return { id: node.id, name: workerName, binding, status: 'unreachable', endpointCount: 0 }
            }
          }))

          // 3. Subagents — from graph (full config)
          const subagentNodes = byType('system-subagent')
          const subagents = subagentNodes.map(n => ({
            id: n.id,
            name: n.label,
            description: n.info,
            delegationTool: n.metadata?.delegationTool,
            model: n.metadata?.model,
            maxTurns: n.metadata?.maxTurns,
            tools: n.metadata?.tools || [],
            triggerPatterns: n.metadata?.triggerPatterns || [],
            file: n.metadata?.file,
            source: (n.info && n.info.length > 200) ? 'graph' : 'code',
          }))

          // 4. Tools — from code (TOOL_DEFINITIONS)
          const { TOOL_DEFINITIONS } = await import('./tool-definitions.js')
          const tools = TOOL_DEFINITIONS.map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.input_schema?.properties ? Object.keys(t.input_schema.properties) : [],
          }))

          // 5. Databases, apps, credentials from graph
          const databases = byType('system-database').map(n => ({
            id: n.id, name: n.metadata?.name || n.label, binding: n.metadata?.binding, purpose: n.info,
          }))
          const apps = byType('system-app').map(n => ({
            id: n.id, name: n.label, url: n.metadata?.url, repo: n.metadata?.repo, framework: n.metadata?.framework,
          }))
          const credentials = byType('system-credential').map(n => ({
            name: n.label, envName: n.metadata?.envName, configured: !!(n.metadata?.envName && env[n.metadata.envName]), usedBy: n.metadata?.usedBy,
          }))
          const nodeTypes = byType('system-nodetype').map(n => n.label)
          const templates = byType('system-template').map(n => ({ id: n.id, name: n.label, description: n.info }))

          const healthyCount = workers.filter(w => w.status === 'healthy').length
          const totalEndpoints = workers.reduce((sum, w) => sum + (w.endpointCount || 0), 0)

          return new Response(JSON.stringify({
            agent: {
              name: 'agent-worker',
              version: '2.0.0',
              registrySource: 'graph_system_registry',
              selfModifiable: true,
            },
            workers,
            subagents,
            tools,
            databases,
            nodeTypes,
            templates,
            apps,
            credentials,
            summary: {
              workers: workers.length,
              workersHealthy: healthyCount,
              totalEndpoints,
              subagents: subagents.length,
              tools: tools.length,
              databases: databases.length,
              nodeTypes: nodeTypes.length,
              templates: templates.length,
              apps: apps.length,
              credentialsConfigured: credentials.filter(c => c.configured).length,
              credentialsTotal: credentials.length,
            },
            message: `Agent introspection: ${workers.length} workers (${healthyCount} healthy, ${totalEndpoints} endpoints), ${subagents.length} subagents, ${tools.length} tools, ${databases.length} databases, ${apps.length} frontend apps. Config source: graph_system_registry.`,
          }, null, 2), { headers: corsHeaders })
        } catch (error) {
          return new Response(JSON.stringify({ error: 'Introspection failed', details: error.message }), { status: 500, headers: corsHeaders })
        }
      }

      // GET /health - Health check
      if (pathname === '/health' && request.method === 'GET') {
        return new Response(JSON.stringify({
          status: 'healthy',
          worker: 'agent-worker',
          timestamp: new Date().toISOString()
        }), { headers: corsHeaders })
      }

      // POST /generate-image — direct SDXL Lightning call, no AI SDK involved
      if (pathname === '/generate-image' && request.method === 'POST') {
        // Helper: parse --ar W:H from prompt, compute dimensions at same pixel area as default
        function parseAspectRatio(rawPrompt, baseSize = 1120) {
          const match = rawPrompt.match(/--ar\s+(\d+)\s*:\s*(\d+)/i)
          if (!match) return { cleanPrompt: rawPrompt, width: baseSize, height: baseSize }
          const ratioW = parseInt(match[1], 10)
          const ratioH = parseInt(match[2], 10)
          if (!ratioW || !ratioH) return { cleanPrompt: rawPrompt, width: baseSize, height: baseSize }
          const baseArea = baseSize * baseSize
          // width = sqrt(area * ratioW/ratioH), round to nearest multiple of 8
          const w = Math.round(Math.sqrt(baseArea * ratioW / ratioH) / 8) * 8
          const h = Math.round(Math.sqrt(baseArea * ratioH / ratioW) / 8) * 8
          const cleanPrompt = rawPrompt.replace(/--ar\s+\d+\s*:\s*\d+/i, '').trim()
          return { cleanPrompt, width: w, height: h }
        }

        const body = await request.json()
        const rawPrompt = body.prompt
        const userId = body.userId || 'unknown'
        if (!rawPrompt) return new Response(JSON.stringify({ error: 'prompt is required' }), { status: 400, headers: corsHeaders })

        const startTime = Date.now()
        const imageModel = body.model || '@cf/bytedance/stable-diffusion-xl-lightning'

        // Parse --ar from prompt; caller can still override width/height explicitly
        const { cleanPrompt, width: arWidth, height: arHeight } = parseAspectRatio(rawPrompt)
        const prompt = cleanPrompt

        const imageInput = { prompt }
        imageInput.width = body.width || arWidth
        imageInput.height = body.height || arHeight
        if (body.guidance) imageInput.guidance = body.guidance
        if (body.seed) imageInput.seed = body.seed
        const imageResponse = await env.AI.run(imageModel, imageInput)

        // SDXL returns a ReadableStream of raw JPEG bytes
        // Lucid Origin returns { image: '<base64 string>' }
        let buffer
        if (imageResponse && typeof imageResponse === 'object' && 'image' in imageResponse) {
          // Base64 response (Lucid Origin)
          const base64 = imageResponse.image
          const binaryStr = atob(base64)
          buffer = new Uint8Array(binaryStr.length)
          for (let i = 0; i < binaryStr.length; i++) buffer[i] = binaryStr.charCodeAt(i)
        } else {
          // Stream response (SDXL Lightning)
          const arrayBuffer = await new Response(imageResponse).arrayBuffer()
          buffer = new Uint8Array(arrayBuffer)
        }

        const filename = `sdxl-${Date.now()}.jpg`
        const formData = new FormData()
        formData.append('file', new File([buffer], filename, { type: 'image/jpeg' }))
        formData.append('filename', `sdxl-${Date.now()}`)
        formData.append('album', 'agent-generated')

        const uploadRes = await env.PHOTOS_WORKER.fetch('https://vegvisr-photos-worker/upload', { method: 'POST', body: formData })
        const uploadData = await uploadRes.json()
        if (!uploadRes.ok) return new Response(JSON.stringify({ error: uploadData.error || 'Upload failed' }), { status: 500, headers: corsHeaders })

        const url = uploadData.urls?.[0]
        if (!url) return new Response(JSON.stringify({ error: 'No URL returned from upload' }), { status: 500, headers: corsHeaders })

        // Track usage in STATS_DB
        if (env.STATS_DB) {
          const now = new Date().toISOString()
          env.STATS_DB.prepare(
            `INSERT INTO sessions (id, user_id, started_at, ended_at, duration_ms,
              turns, fast_path, model, input_tokens, output_tokens, tool_calls, success,
              agent_id, version, version_note, cost_usd)
             VALUES (?, ?, ?, ?, ?, 1, 1, ?, 0, 0, '[]', 1, 'workers-ai', 'v-wai-1', 'Image generation', 0)`
          ).bind(
            crypto.randomUUID(), userId,
            new Date(startTime).toISOString(), now, Date.now() - startTime,
            imageModel
          ).run().catch(e => console.error('[stats] image gen insert failed:', e.message))
        }

        return new Response(JSON.stringify({ url, prompt, width: imageInput.width, height: imageInput.height }), { headers: corsHeaders })
      }

      return new Response(JSON.stringify({
        error: 'Not found',
        available_endpoints: ['/execute', '/chat', '/agents', '/agent', '/layout', '/build-html-page', '/template-version', '/templates', '/tools', '/upgrade-html-node', '/bot-respond', '/introspect', '/health', '/openapi.json']
      }), { status: 404, headers: corsHeaders })

    } catch (error) {
      return new Response(JSON.stringify({
        error: error.message,
        stack: error.stack
      }), { status: 500, headers: corsHeaders })
    }
  }
}

// Durable Object export — required for Cloudflare Workers to instantiate VegvisrAgent
export { VegvisrAgent }
