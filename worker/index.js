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
        const { userId, messages: userMessages, graphId, model, maxTurns, agentId } = body

        if (!userId || !userMessages || !Array.isArray(userMessages)) {
          return new Response(JSON.stringify({
            error: 'userId and messages[] are required'
          }), { status: 400, headers: corsHeaders })
        }

        let systemPrompt = CHAT_SYSTEM_PROMPT
        let toolFilter = null
        let agentAvatarUrl = null
        let agentModel = model || 'claude-haiku-4-5-20251001'

        // Load per-agent config if agentId provided
        if (agentId) {
          const agentConfig = await env.DB.prepare(
            'SELECT * FROM agent_configs WHERE id = ?1 AND is_active = 1'
          ).bind(agentId).first()
          if (agentConfig) {
            if (agentConfig.system_prompt) systemPrompt = agentConfig.system_prompt
            agentAvatarUrl = agentConfig.avatar_url || null
            if (agentConfig.model) agentModel = agentConfig.model
            const tools = JSON.parse(agentConfig.tools || '[]')
            if (tools.length > 0) toolFilter = tools
          }
        }

        if (graphId) {
          systemPrompt += `\n\n## Current Context\nThe user has selected graph "${graphId}". Use this graphId for operations unless they specify otherwise.`
        }

        const chatMessages = userMessages.map(m => ({ role: m.role, content: m.content }))

        const { readable, writable } = new TransformStream()
        const writer = writable.getWriter()
        const encoder = new TextEncoder()

        ctx.waitUntil(
          streamingAgentLoop(writer, encoder, chatMessages, systemPrompt, userId, env, {
            model: agentModel,
            maxTurns: maxTurns || 8,
            toolFilter,
            avatarUrl: agentAvatarUrl,
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

        const uploadRes = await fetch('https://photos-api.vegvisr.org/upload', {
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
        const key = uploadData.key || uploadData.r2Key || uploadName
        const url = `https://vegvisr.imgix.net/${key}`

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
        available_endpoints: ['/execute', '/chat', '/agents', '/agent', '/layout', '/build-html-page', '/template-version', '/templates', '/tools', '/upgrade-html-node', '/health']
      }), { status: 404, headers: corsHeaders })

    } catch (error) {
      return new Response(JSON.stringify({
        error: error.message,
        stack: error.stack
      }), { status: 500, headers: corsHeaders })
    }
  }
}
