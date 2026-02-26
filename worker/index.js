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
import { executeTool, executeCreateHtmlFromTemplate } from './tool-executors.js'
import { streamingAgentLoop, executeAgent } from './agent-loop.js'
import { CHAT_SYSTEM_PROMPT } from './system-prompt.js'

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

    try {
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

      // POST /chat - Streaming conversational agent chat (SSE)
      if (pathname === '/chat' && request.method === 'POST') {
        const body = await request.json()
        const { userId, messages: userMessages, graphId, model, maxTurns } = body

        if (!userId || !userMessages || !Array.isArray(userMessages)) {
          return new Response(JSON.stringify({
            error: 'userId and messages[] are required'
          }), { status: 400, headers: corsHeaders })
        }

        let systemPrompt = CHAT_SYSTEM_PROMPT
        if (graphId) {
          systemPrompt += `\n\n## Current Context\nThe user has selected graph "${graphId}". Use this graphId for operations unless they specify otherwise.`
        }

        const chatMessages = userMessages.map(m => ({ role: m.role, content: m.content }))

        const { readable, writable } = new TransformStream()
        const writer = writable.getWriter()
        const encoder = new TextEncoder()

        ctx.waitUntil(
          streamingAgentLoop(writer, encoder, chatMessages, systemPrompt, userId, env, {
            model: model || 'claude-haiku-4-5-20251001',
            maxTurns: maxTurns || 8,
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

          const saveRes = await env.KG_WORKER.fetch('https://knowledge-graph-worker/patchNode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              graphId,
              nodeId,
              fields: { info: newHtml }
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

      // GET /health - Health check
      if (pathname === '/health' && request.method === 'GET') {
        return new Response(JSON.stringify({
          status: 'healthy',
          worker: 'agent-worker',
          timestamp: new Date().toISOString()
        }), { headers: corsHeaders })
      }

      return new Response(JSON.stringify({
        error: 'Not found',
        available_endpoints: ['/execute', '/chat', '/layout', '/build-html-page', '/template-version', '/templates', '/tools', '/upgrade-html-node', '/health']
      }), { status: 404, headers: corsHeaders })

    } catch (error) {
      return new Response(JSON.stringify({
        error: error.message,
        stack: error.stack
      }), { status: 500, headers: corsHeaders })
    }
  }
}
