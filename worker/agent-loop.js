/**
 * Agent loop — streaming and non-streaming execution loops
 *
 * streamingAgentLoop: SSE-based for /chat endpoint
 * executeAgent: log-based for /execute endpoint
 */

import { TOOL_DEFINITIONS, WEB_SEARCH_TOOL, PROFF_TOOLS } from './tool-definitions.js'
import { loadOpenAPITools } from './openapi-tools.js'
import { executeTool } from './tool-executors.js'

/**
 * Calculate cost in USD for a completed session.
 * Prices per million tokens (as of 2026-03).
 * Cache tokens cost 10% of input price — we don't distinguish here, so this is a conservative estimate.
 */
function calculateCost(model, inputTokens, outputTokens) {
  const PRICES = {
    // Haiku 4.5
    'claude-haiku-4-5-20251001': { in: 0.80, out: 4.00 },
    // Sonnet 4.6
    'claude-sonnet-4-6':         { in: 3.00, out: 15.00 },
    'claude-sonnet-4-20250514':  { in: 3.00, out: 15.00 },
    // Opus 4.6
    'claude-opus-4-6':           { in: 15.00, out: 75.00 },
    'claude-opus-4-20250514':    { in: 15.00, out: 75.00 },
    // Fast path
    'fast-path':                 { in: 0, out: 0 },
  }
  const price = PRICES[model] || PRICES['claude-haiku-4-5-20251001']
  return ((inputTokens / 1_000_000) * price.in) + ((outputTokens / 1_000_000) * price.out)
}

/**
 * Load and merge all tools: hardcoded + OpenAPI dynamic + web_search
 */
async function loadAllTools(env) {
  let openAPITools = []
  let operationMap = {}
  try {
    const loaded = await loadOpenAPITools(env)
    openAPITools = loaded.tools
    operationMap = loaded.operationMap
  } catch (err) {
    console.error('Failed to load OpenAPI tools:', err)
  }

  const hardcodedNames = new Set(TOOL_DEFINITIONS.map(t => t.name))
  const dynamicTools = openAPITools.filter(t => !hardcodedNames.has(t.name))

  // Remove tools that subagents handle — forces orchestrator to delegate
  // edit_html_node → delegate_to_html_builder
  // KG write tools → delegate_to_kg (reads kept for quick lookups)
  // Chat tools → delegate_to_chat (all chat group management)
  const ORCHESTRATOR_BLOCKED_TOOLS = new Set([
    'edit_html_node',
    'create_graph', 'create_node', 'patch_node', 'add_edge',
    'patch_graph_metadata',
    'list_chat_groups', 'create_chat_group', 'update_chat_group',
    'delete_chat_group', 'restore_chat_group',
    'add_user_to_chat_group', 'get_group_members', 'get_group_messages',
    'get_group_stats', 'send_group_message',
    'create_poll', 'close_poll', 'get_poll_results',
    'chat_db_list_tables', 'chat_db_query',
    'register_chat_bot', 'remove_chat_bot', 'trigger_bot_response',
    'list_bots', 'get_bot', 'update_chat_bot',
    'list_agents', 'get_agent', 'create_agent', 'update_agent',
    'deactivate_agent', 'upload_agent_avatar',
    'list_contacts', 'search_contacts', 'get_contact_logs', 'add_contact_log', 'create_contact',
  ])
  const filteredTools = TOOL_DEFINITIONS.filter(t => !ORCHESTRATOR_BLOCKED_TOOLS.has(t.name))
  const allTools = [...filteredTools, ...dynamicTools, WEB_SEARCH_TOOL, ...PROFF_TOOLS]

  return { allTools, operationMap }
}

/**
 * Truncate large tool results to prevent context window overflow
 */
function truncateResult(result) {
  let resultStr = JSON.stringify(result)
  const MAX_RESULT_SIZE = 12000
  if (resultStr.length > MAX_RESULT_SIZE) {
    const truncated = JSON.parse(resultStr)
    if (truncated.nodes) {
      truncated.nodes = truncated.nodes.map(n => ({
        ...n,
        info: n.info && n.info.length > 300 ? n.info.slice(0, 300) + '... [truncated]' : n.info,
      }))
    }
    resultStr = JSON.stringify(truncated)
    if (resultStr.length > MAX_RESULT_SIZE) {
      resultStr = resultStr.slice(0, MAX_RESULT_SIZE) + '... [truncated — result too large]'
    }
  }
  return resultStr
}

function buildCapabilityToolPayload(toolName, result) {
  if (!result || typeof result !== 'object') return null

  if (toolName === 'create_capability_blueprint') {
    return {
      request: result.request || null,
      capabilityType: result.capabilityType || null,
      templateType: result.templateType || null,
      deliveryMode: result.deliveryMode || null,
      targetScope: result.targetScope || null,
      readyToScaffold: result.readyToScaffold === true,
      requiredQuestions: Array.isArray(result.requiredQuestions) ? result.requiredQuestions : [],
      optionalQuestions: Array.isArray(result.optionalQuestions) ? result.optionalQuestions : [],
      scaffoldDefaults: result.scaffoldDefaults || null,
    }
  }

  if (toolName === 'build_capability_worker_scaffold') {
    return {
      workerName: result.workerName || null,
      templateType: result.templateType || null,
      endpointPath: result.endpointPath || null,
      actionType: result.actionType || null,
      capabilitySummary: result.capabilitySummary || null,
    }
  }

  if (toolName === 'deploy_worker') {
    return {
      workerName: result.workerName || null,
      url: result.url || null,
      deploymentId: result.deploymentId || null,
      modifiedOn: result.modifiedOn || null,
    }
  }

  return null
}

function getTextContent(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
  }
  return ''
}

function getLatestUserText(messages) {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === 'user') {
      return getTextContent(messages[index].content)
    }
  }
  return ''
}

function isGraphWriteIntent(userText) {
  const text = String(userText || '').toLowerCase()
  if (!text) return false
  const writeVerb = /(create|build|make|generate|add|write|compose|patch|update|modify)/
  const graphTarget = /(graph|knowledge graph|node|nodes)/
  return writeVerb.test(text) && graphTarget.test(text)
}

function isExplicitCreateGraphIntent(userText) {
  const text = String(userText || '').toLowerCase()
  if (!text) return false
  const createVerb = /(create|build|make|generate)/
  const graphTarget = /(graph|knowledge graph)/
  const discoveryOnly = /(find|search|list|show|browse|explore|retrieve)/
  return createVerb.test(text) && graphTarget.test(text) && !discoveryOnly.test(text)
}

function textMentionsCalendar(text) {
  return /(calendar|calandar|booking|bookings|appointment|appointments|meeting|meetings|schedule|scheduled|availability|available|busy|free time)/.test(String(text || '').toLowerCase())
}

function textMentionsDateOrRelativeTime(text) {
  return /(today|tomorrow|tonight|yesterday|this week|next week|this month|next month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2})/.test(String(text || '').toLowerCase())
}

function hasRecentCalendarContext(messages) {
  const recent = messages.slice(-8)
  for (const message of recent) {
    if (message.role === 'user' && textMentionsCalendar(getTextContent(message.content))) {
      return true
    }
    if (!Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (block?.type === 'tool_use' && typeof block.name === 'string' && block.name.startsWith('calendar_')) {
        return true
      }
    }
  }
  return false
}

function isCalendarQueryIntent(messages) {
  const latest = getLatestUserText(messages)
  if (!latest) return false
  if (textMentionsCalendar(latest)) return true
  if (textMentionsDateOrRelativeTime(latest) && hasRecentCalendarContext(messages.slice(0, -1))) {
    return true
  }
  return false
}

function hasCalendarToolUseSince(messages, startIndex = 0) {
  for (const message of messages.slice(startIndex)) {
    if (!Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (block?.type === 'tool_use' && typeof block.name === 'string' && block.name.startsWith('calendar_')) {
        return true
      }
    }
  }
  return false
}

function countGraphWriteCompletions(messages) {
  let count = 0
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue
    for (const block of m.content) {
      if (!block || block.type !== 'tool_result') continue
      if (typeof block.content !== 'string') continue
      try {
        const parsed = JSON.parse(block.content)
        if (parsed && (parsed.graphId || parsed.nodeId || parsed.viewUrl)) {
          count++
        }
      } catch {
        // ignore malformed tool payloads
      }
    }
  }
  return count
}

function hasGraphWriteVerification(messages, startIndex = 0) {
  const GRAPH_WRITE_TOOLS = new Set([
    'delegate_to_kg',
    'create_graph',
    'create_node',
    'patch_node',
    'add_edge',
    'remove_node',
    'patch_graph_metadata',
    'kg_add_node',
    'kg_patch_node',
    'kg_remove_node',
  ])
  const GRAPH_VERIFY_TOOLS = new Set(['read_graph', 'read_node', 'read_graph_content', 'kg_get_know_graph'])

  let needsVerification = false

  for (const message of messages.slice(startIndex)) {
    if (!Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (!block || block.type !== 'tool_use') continue
      const toolName = block.name
      if (GRAPH_WRITE_TOOLS.has(toolName)) {
        needsVerification = true
        continue
      }
      if (needsVerification && GRAPH_VERIFY_TOOLS.has(toolName)) {
        return true
      }
    }
  }

  return !needsVerification
}

function hasGraphWriteCompletion(messages) {
  return countGraphWriteCompletions(messages) > 0
}

/**
 * Streaming agent loop — writes SSE events to a TransformStream writer
 */
async function streamingAgentLoop(writer, encoder, messages, systemPrompt, userId, env, options) {
  const maxTurns = options.maxTurns || 8
  const model = options.model || 'claude-haiku-4-5-20251001'
  const authContext = options?.authContext || null
  let turn = 0
  const startTime = Date.now()
  const sessionId = crypto.randomUUID()
  const latestUserRequest = getLatestUserText(messages)
  const requiresGraphWrite = isGraphWriteIntent(latestUserRequest)
  const requiresCreateGraph = isExplicitCreateGraphIntent(latestUserRequest)
  const requiresCalendarQuery = isCalendarQueryIntent(messages)
  const graphWriteCompletionBaseline = countGraphWriteCompletions(messages)
  const graphWriteVerificationStartIndex = messages.length
  const calendarQueryStartIndex = messages.length

  // Stats accumulation — written to STATS_DB in finally block
  const stats = { inputTokens: 0, outputTokens: 0, toolCalls: [], success: true, error: null, maxTurnsReached: false }

  const log = (msg) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`[agent-loop +${elapsed}s] ${msg}`)
  }

  let { allTools, operationMap } = await loadAllTools(env)

  // Filter tools per-agent if toolFilter provided
  if (options.toolFilter && options.toolFilter.length > 0) {
    const allowed = new Set(options.toolFilter)
    allTools = allTools.filter(t => allowed.has(t.name))
    log(`tool filter applied: ${options.toolFilter.length} allowed → ${allTools.length} tools`)
  }

  log(`started | model=${model} maxTurns=${maxTurns} tools=${allTools.length} userId=${userId?.slice(0,8)}...`)

  try {
    // Emit agent identity info if available (avatar, etc.)
    if (options.avatarUrl) {
      writer.write(encoder.encode(`event: agent_info\ndata: ${JSON.stringify({ avatarUrl: options.avatarUrl })}\n\n`))
    }

    while (turn < maxTurns) {
      turn++
      log(`turn ${turn}/${maxTurns} — calling Anthropic`)
      writer.write(encoder.encode(`event: thinking\ndata: ${JSON.stringify({ turn })}\n\n`))

      // Cap history: keep first message + last 10 messages to limit input token growth.
      // Tool results from early turns are rarely needed by turn 5+.
      // Always keep messages in assistant/user pairs so tool_use/tool_result stay paired.
      const MAX_HISTORY = 10
      const cappedMessages = messages.length > MAX_HISTORY + 1
        ? [messages[0], ...messages.slice(-(MAX_HISTORY))]
        : [...messages]

      // Self-check at every 3rd turn: inject a progress review instruction.
      // No extra API call — appended to the last user message so the next response includes reflection.
      if (turn > 1 && (turn % 3 === 0 || turn === 2)) {
        const last = cappedMessages[cappedMessages.length - 1]
        const selfCheck = `\n\n[SELF-CHECK turn ${turn}: Review progress against the user's latest unresolved request: "${latestUserRequest.slice(0, 300)}". If you are repeating the same failed pattern, switch approach now. Do not drift back to older questions from earlier in the conversation. Do not narrate internal process like "I have not done anything yet" or "now I will" unless you are blocked. If the task is done, summarize only the completed result.]`
        if (last && last.role === 'user') {
          if (typeof last.content === 'string') {
            cappedMessages[cappedMessages.length - 1] = { ...last, content: last.content + selfCheck }
          } else if (Array.isArray(last.content)) {
            cappedMessages[cappedMessages.length - 1] = { ...last, content: [...last.content, { type: 'text', text: selfCheck }] }
          }
          log(`injected self-check at turn ${turn}`)
        }
      }

      const response = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          apiKey: env.ANTHROPIC_API_KEY || undefined,
          messages: cappedMessages,
          model,
          max_tokens: 16384,
          temperature: 0.3,
          system: systemPrompt,
          tools: allTools,
        }),
      })

      const data = await response.json()
      log(`turn ${turn} response: status=${response.status} stop_reason=${data.stop_reason} content_blocks=${(data.content||[]).length}`)

      // Accumulate token usage across turns
      if (data.usage) {
        stats.inputTokens += data.usage.input_tokens || 0
        stats.outputTokens += data.usage.output_tokens || 0
      }

      if (!response.ok) {
        log(`ERROR: Anthropic API error — ${JSON.stringify(data.error || 'unknown')}`)
        stats.success = false
        stats.error = JSON.stringify(data.error || 'Anthropic API error')
        writer.write(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: data.error || 'Anthropic API error' })}\n\n`))
        break
      }

      if (data.stop_reason === 'end_turn') {
        // Guardrail: if user asked for graph creation/modification but no write was completed,
        // force one continuation turn with a direct tool-routing reminder.
        if (requiresGraphWrite && countGraphWriteCompletions(messages) <= graphWriteCompletionBaseline) {
          log('end_turn blocked: graph write requested but no graph-write completion detected; forcing continuation')
          messages.push(
            { role: 'assistant', content: data.content },
            { role: 'user', content: 'You have not completed the requested graph write yet. Use delegate_to_kg now to perform the creation/update action before ending your turn.' }
          )
          continue
        }

        if (requiresGraphWrite && !hasGraphWriteVerification(messages, graphWriteVerificationStartIndex)) {
          log('end_turn blocked: graph write completed but no verification read detected; forcing continuation')
          messages.push(
            { role: 'assistant', content: data.content },
            { role: 'user', content: 'The graph write is not verified yet. Read the affected graph or node now with read_node, read_graph, or read_graph_content and confirm the exact change before ending your turn.' }
          )
          continue
        }

        if (requiresCalendarQuery && !hasCalendarToolUseSince(messages, calendarQueryStartIndex)) {
          log('end_turn blocked: calendar/date question answered without fresh calendar tool call; forcing continuation')
          messages.push(
            { role: 'assistant', content: data.content },
            { role: 'user', content: 'This calendar answer is not grounded yet. Call the appropriate calendar_ tool now for the requested date or follow-up date and answer from that result only.' }
          )
          continue
        }

        const textBlocks = (data.content || []).filter(c => c.type === 'text')
        const textLen = textBlocks.reduce((sum, b) => sum + b.text.length, 0)
        log(`end_turn — ${textBlocks.length} text blocks (${textLen} chars)`)
        for (const block of textBlocks) {
          writer.write(encoder.encode(`event: text\ndata: ${JSON.stringify({ content: block.text })}\n\n`))
        }

        // Generate follow-up suggestions using a fast Haiku call
        // Skip if no assistant text (pure tool-call turns produce no useful suggestions)
        try {
          const lastAssistantText = textBlocks.map(b => b.text).join('\n')
          if (!lastAssistantText.trim()) throw new Error('no text — skip suggestions')
          const recentContext = messages.slice(-4).map(m => {
            let content
            if (typeof m.content === 'string') {
              content = m.content
            } else if (Array.isArray(m.content)) {
              content = m.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
              const imgCount = m.content.filter(b => b.type === 'image').length
              if (imgCount > 0) content = `[${imgCount} image(s)] ${content}`
            } else {
              content = JSON.stringify(m.content)
            }
            return `${m.role}: ${content.slice(0, 300)}`
          }).join('\n')

          const suggestRes = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId,
              apiKey: env.ANTHROPIC_API_KEY || undefined,
              messages: [{
                role: 'user',
                content: `Based on this conversation context and the assistant's last response, suggest exactly 3 short follow-up prompts the user might want to ask next. Each should be a natural next step, question, or action. Return ONLY a JSON array of 3 strings, no explanation.\n\nRecent conversation:\n${recentContext}\n\nAssistant's response:\n${lastAssistantText.slice(0, 500)}`
              }],
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 256,
              temperature: 0.7,
            }),
          })

          if (suggestRes.ok) {
            const suggestData = await suggestRes.json()
            const suggestText = (suggestData.content || []).find(c => c.type === 'text')?.text || ''
            const jsonMatch = suggestText.match(/\[[\s\S]*\]/)
            if (jsonMatch) {
              const suggestions = JSON.parse(jsonMatch[0])
              if (Array.isArray(suggestions) && suggestions.length > 0) {
                const cleaned = suggestions.slice(0, 3).map(s => String(s).trim()).filter(s => s.length > 0)
                if (cleaned.length > 0) {
                  log(`suggestions generated: ${cleaned.length}`)
                  writer.write(encoder.encode(`event: suggestions\ndata: ${JSON.stringify({ suggestions: cleaned })}\n\n`))
                }
              }
            }
          }
        } catch (sugErr) {
          log(`suggestions generation failed (non-fatal): ${sugErr.message}`)
        }

        writer.write(encoder.encode(`event: done\ndata: ${JSON.stringify({ turns: turn })}\n\n`))
        break
      }

      if (data.stop_reason === 'tool_use') {
        const toolUses = (data.content || []).filter(c => c.type === 'tool_use')
        const textBlocks = (data.content || []).filter(c => c.type === 'text')

        // Accumulate tool calls for stats
        for (const t of toolUses) stats.toolCalls.push(t.name)

        log(`tool_use — ${toolUses.length} tools: [${toolUses.map(t => t.name).join(', ')}]`)

        for (const block of textBlocks) {
          writer.write(encoder.encode(`event: text\ndata: ${JSON.stringify({ content: block.text })}\n\n`))
        }

        // Graph-mutating tools must run sequentially to avoid D1 read-modify-write race conditions
        const SEQUENTIAL_TOOLS = new Set([
          'create_graph', 'create_node', 'create_html_node', 'add_edge',
          'patch_node', 'patch_graph_metadata', 'edit_html_node', 'save_form_data',
          'create_app_table', 'insert_app_record', 'add_user_to_chat_group', 'send_group_message', 'create_chat_group',
          'register_chat_bot', 'trigger_bot_response', 'delegate_to_html_builder', 'delegate_to_kg', 'delegate_to_chat', 'delegate_to_bot', 'delegate_to_agent_builder', 'delegate_to_video', 'delegate_to_contact', 'delegate_to_youtube_graph'
        ])
        const sequentialTools = toolUses.filter(t => SEQUENTIAL_TOOLS.has(t.name))
        const parallelTools = toolUses.filter(t => !SEQUENTIAL_TOOLS.has(t.name))
        let inferredGraphId = null

        const GRAPH_ID_AWARE_TOOLS = new Set([
          'create_node',
          'create_html_node',
          'add_edge',
          'patch_node',
          'patch_graph_metadata',
          'read_graph',
          'read_graph_content',
          'read_node',
          'delegate_to_kg',
        ])

        const executeAndStream = async (toolUse) => {
          const GRAPH_DISCOVERY_TOOLS = new Set(['search_graphs', 'list_graphs'])
          if (
            requiresCreateGraph
            && countGraphWriteCompletions(messages) <= graphWriteCompletionBaseline
            && GRAPH_DISCOVERY_TOOLS.has(toolUse.name)
          ) {
            const message = 'This request is to create a new graph. Call create_graph first, then create_node/add_edge as needed. Do not search existing graphs first.'
            log(`blocked ${toolUse.name} before create_graph for explicit create request`)
            writer.write(encoder.encode(`event: tool_result\ndata: ${JSON.stringify({ tool: toolUse.name, success: false, summary: message })}\n\n`))
            return { type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify({ error: message }) }
          }

          if (!toolUse.input) toolUse.input = {}
          if (!toolUse.input.graphId && inferredGraphId && GRAPH_ID_AWARE_TOOLS.has(toolUse.name)) {
            toolUse.input.graphId = inferredGraphId
            log(`auto-injected graphId=${inferredGraphId} into ${toolUse.name} (same-turn carry-over)`)
          }

          // Auto-inject nodeId into HTML builder delegation (HTML edits always target a specific node)
          const DELEGATION_TOOLS = new Set(['delegate_to_kg', 'delegate_to_html_builder', 'delegate_to_chat', 'delegate_to_bot', 'delegate_to_agent_builder', 'delegate_to_video', 'delegate_to_youtube_graph'])
          if (DELEGATION_TOOLS.has(toolUse.name)) {
            // NOTE: Do NOT auto-inject graphId into delegations. The LLM must explicitly include graphId
            // when it wants the subagent to work on a specific graph. If omitted, the subagent is free to
            // create new graphs. Auto-injection was causing "create new graph" requests to silently
            // add content to the last-used graph instead.
            if (!toolUse.input.nodeId && options.activeHtmlNodeId && toolUse.name === 'delegate_to_html_builder') {
              toolUse.input.nodeId = options.activeHtmlNodeId
              log(`auto-injected nodeId=${options.activeHtmlNodeId} into ${toolUse.name}`)
            }
            // Auto-inject transcription content into delegate_to_kg tasks
            // The KG subagent is stateless and cannot see conversation history,
            // so we must pass transcription text explicitly in the task field.
            if (toolUse.name === 'delegate_to_kg') {
              for (let mi = messages.length - 1; mi >= 0; mi--) {
                const msgContent = getTextContent(messages[mi].content)
                // Match tagged messages (new frontend) OR legacy "**Audio Transcription**" messages
                const hasTag = msgContent.includes('[TRANSCRIPTION_AVAILABLE')
                const hasLegacy = msgContent.includes('**Audio Transcription**')
                if (hasTag || hasLegacy) {
                  let transcriptionText = ''
                  if (hasTag) {
                    const tagEnd = msgContent.indexOf(']\n', msgContent.indexOf('[TRANSCRIPTION_AVAILABLE'))
                    transcriptionText = tagEnd >= 0 ? msgContent.slice(tagEnd + 2).trim() : ''
                  } else {
                    // Legacy format: skip the first line (header) and extract the rest
                    const lines = msgContent.split('\n')
                    const bodyStart = lines.findIndex((l, i) => i > 0 && l.trim().length > 0)
                    transcriptionText = bodyStart >= 0 ? lines.slice(bodyStart).join('\n').trim() : ''
                  }
                  if (transcriptionText.length > 100) {
                    toolUse.input.task += '\n\n## TRANSCRIPTION CONTENT (from conversation — use this as the node info field):\n' + transcriptionText
                    log(`auto-injected ${transcriptionText.length} chars of transcription into delegate_to_kg task`)
                  }
                  break
                }
              }
            }
          }
          const toolStart = Date.now()
          log(`executing ${toolUse.name} (input: ${JSON.stringify(toolUse.input).slice(0, 200)})`)
          writer.write(encoder.encode(`event: tool_call\ndata: ${JSON.stringify({ tool: toolUse.name, input: toolUse.input })}\n\n`))
          // Progress callback for long-running tools
          const onProgress = (msg) => {
            writer.write(encoder.encode(`event: tool_progress\ndata: ${JSON.stringify({ tool: toolUse.name, message: msg })}\n\n`))
          }
          try {
            const result = await executeTool(toolUse.name, { ...toolUse.input, userId, authContext }, env, operationMap, onProgress)
            if (result?.graphId) {
              inferredGraphId = result.graphId
            }
            const summary = result.message || `${toolUse.name} completed`
            const resultLen = JSON.stringify(result).length
            const toolDuration = Date.now() - toolStart
            log(`${toolUse.name} OK (${(toolDuration / 1000).toFixed(1)}s, ${resultLen} chars)`)

            // Roll subagent tokens into parent session totals
            if (result.inputTokens) stats.inputTokens += result.inputTokens
            if (result.outputTokens) stats.outputTokens += result.outputTokens

            // Record tool call in session_tools
            if (env.STATS_DB) {
              const subagent = toolUse.name.startsWith('delegate_to_') ? toolUse.name.replace('delegate_to_', '') : null
              const templateId = toolUse.name === 'create_html_from_template' ? (toolUse.input.templateId || null) : null
              // For delegation tools use the subagent's model; for direct tools use the orchestrator model
              const toolModel = result.model || model
              env.STATS_DB.prepare(
                `INSERT INTO session_tools (id, session_id, tool_name, subagent, template_id, graph_id, node_id, success, duration_ms, occurred_at, model)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
              ).bind(
                crypto.randomUUID(), sessionId, toolUse.name,
                subagent, templateId,
                result.graphId || toolUse.input.graphId || null,
                result.nodeId || toolUse.input.nodeId || null,
                toolDuration, new Date().toISOString(), toolModel
              ).run().catch(e => console.error('[stats] tool insert failed:', e.message))
            }

            const ssePayload = { tool: toolUse.name, success: true, summary }
            const capabilityPayload = buildCapabilityToolPayload(toolUse.name, result)
            if (capabilityPayload) Object.assign(ssePayload, capabilityPayload)
            // Pass nodeId and graphId for tools that create or edit HTML nodes
            if (result.nodeId) ssePayload.nodeId = result.nodeId
            if (result.graphId) ssePayload.graphId = result.graphId
            // Pass updatedHtml for edit_html_node so frontend can auto-preview
            if (toolUse.name === 'edit_html_node' && result.updatedHtml) {
              ssePayload.updatedHtml = result.updatedHtml
            }
            // Pass clientSideRequired data to frontend so it can handle transcription
            if (result.clientSideRequired) {
              ssePayload.clientSideRequired = true
              ssePayload.audioUrl = result.audioUrl
              ssePayload.language = result.language
              ssePayload.recordingId = result.recordingId
              ssePayload.saveToGraph = result.saveToGraph || false
              ssePayload.graphTitle = result.graphTitle || null
            }
            writer.write(encoder.encode(`event: tool_result\ndata: ${JSON.stringify(ssePayload)}\n\n`))
            // Strip large fields that are only for the frontend (not needed by Claude)
            const resultForClaude = { ...result }
            delete resultForClaude.updatedHtml
            const resultStr = truncateResult(resultForClaude)
            return { type: 'tool_result', tool_use_id: toolUse.id, content: resultStr }
          } catch (error) {
            const toolDuration = Date.now() - toolStart
            log(`${toolUse.name} FAILED (${(toolDuration / 1000).toFixed(1)}s): ${error.message}`)
            if (env.STATS_DB) {
              env.STATS_DB.prepare(
                `INSERT INTO session_tools (id, session_id, tool_name, subagent, success, duration_ms, occurred_at, model)
                 VALUES (?, ?, ?, ?, 0, ?, ?, ?)`
              ).bind(
                crypto.randomUUID(), sessionId, toolUse.name,
                toolUse.name.startsWith('delegate_to_') ? toolUse.name.replace('delegate_to_', '') : null,
                toolDuration, new Date().toISOString(), model
              ).run().catch(e => console.error('[stats] tool insert failed:', e.message))
            }
            writer.write(encoder.encode(`event: tool_result\ndata: ${JSON.stringify({ tool: toolUse.name, success: false, error: error.message })}\n\n`))
            return { type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify({ error: error.message }) }
          }
        }

        // Phase 1: Run graph-mutating tools sequentially (one at a time) to prevent race conditions
        const sequentialResults = []
        for (const toolUse of sequentialTools) {
          sequentialResults.push(await executeAndStream(toolUse))
        }
        // Phase 2: Run all other tools in parallel (safe — they don't mutate graph state concurrently)
        const parallelResults = await Promise.all(parallelTools.map(executeAndStream))
        const toolResults = [...sequentialResults, ...parallelResults]

        // Fix 4: Strip large `info` fields from graph read results before storing in history.
        // Graph nodes can be 10-50K chars each; keeping them in history inflates every subsequent turn.
        const trimmedResults = toolResults.map(r => {
          try {
            const parsed = JSON.parse(r.content)
            if (parsed.nodes) {
              parsed.nodes = parsed.nodes.map(n => n.info && n.info.length > 500
                ? { ...n, info: n.info.slice(0, 500) + '… [trimmed from history]' }
                : n)
              return { ...r, content: JSON.stringify(parsed) }
            }
          } catch {}
          return r
        })

        messages.push(
          { role: 'assistant', content: data.content },
          { role: 'user', content: trimmedResults },
        )
      } else if (data.stop_reason === 'max_tokens') {
        log(`max_tokens hit on turn ${turn} — sending continuation`)
        const textBlocks = (data.content || []).filter(c => c.type === 'text')
        for (const block of textBlocks) {
          writer.write(encoder.encode(`event: text\ndata: ${JSON.stringify({ content: block.text })}\n\n`))
        }
        messages.push(
          { role: 'assistant', content: data.content },
          { role: 'user', content: 'Continue. Do not repeat what you already said.' },
        )
      } else {
        log(`unexpected stop_reason: ${data.stop_reason}`)
        writer.write(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: 'Unexpected stop: ' + data.stop_reason })}\n\n`))
        break
      }
    }

    if (turn >= maxTurns) {
      stats.maxTurnsReached = true
      log(`max turns reached (${maxTurns})`)
      writer.write(encoder.encode(`event: done\ndata: ${JSON.stringify({ turns: turn, maxReached: true })}\n\n`))
    }
  } catch (err) {
    stats.success = false
    stats.error = err.message
    log(`FATAL ERROR: ${err.message}\n${err.stack}`)
    writer.write(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`))
  } finally {
    const durationMs = Date.now() - startTime
    log(`stream closed — ${turn} turns, ${(durationMs / 1000).toFixed(1)}s total, tokens in=${stats.inputTokens} out=${stats.outputTokens}`)
    writer.close()

    // Write session stats to STATS_DB — awaited so it completes before waitUntil context closes
    if (env.STATS_DB) {
      const now = new Date().toISOString()
      const costUsd = calculateCost(model, stats.inputTokens, stats.outputTokens)
      await env.STATS_DB.prepare(
        `INSERT INTO sessions (id, user_id, started_at, ended_at, duration_ms, turns, fast_path, model,
          input_tokens, output_tokens, tool_calls, success, error, agent_id, max_turns_reached, version, version_note, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        sessionId, userId || 'unknown',
        new Date(startTime).toISOString(), now, durationMs,
        turn, model,
        stats.inputTokens, stats.outputTokens,
        JSON.stringify(stats.toolCalls),
        stats.success ? 1 : 0,
        stats.error || null,
        options.agentId || null,
        stats.maxTurnsReached ? 1 : 0,
        options.version || null,
        options.versionNote || null,
        costUsd
      ).run()
    }
  }
}

/**
 * Execute agent with task (non-streaming, returns execution log)
 */
async function executeAgent(agentConfig, userTask, userId, env, options = {}) {
  let taskWithContract = userTask
  if (agentConfig.default_contract_id) {
    taskWithContract = `${userTask}\n\n[Default contract: ${agentConfig.default_contract_id}]`
  }

  const messages = [{ role: 'user', content: taskWithContract }]
  const requiresGraphWrite = isGraphWriteIntent(taskWithContract)
  const requiresCreateGraph = isExplicitCreateGraphIntent(taskWithContract)
  const requiresCalendarQuery = isCalendarQueryIntent(messages)
  const graphWriteVerificationStartIndex = messages.length
  const calendarQueryStartIndex = messages.length
  const graphWriteCompletionBaseline = countGraphWriteCompletions(messages)

  const { allTools, operationMap } = await loadAllTools(env)
  const authContext = options?.authContext || null

  const executionLog = []
  let turn = 0
  const maxTurns = agentConfig.max_turns || 5

  while (turn < maxTurns) {
    turn++

    executionLog.push({
      turn,
      type: 'agent_thinking',
      timestamp: new Date().toISOString()
    })

    const response = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userId,
        apiKey: env.ANTHROPIC_API_KEY || undefined,
        messages: messages,
        model: agentConfig.model || 'claude-haiku-4-5-20251001',
        max_tokens: agentConfig.max_tokens || 4096,
        temperature: agentConfig.temperature ?? 0.3,
        system: agentConfig.system_prompt,
        tools: allTools
      })
    })

    const data = await response.json()

    if (!response.ok) {
      executionLog.push({
        turn,
        type: 'error',
        error: data.error || 'Anthropic API error',
        timestamp: new Date().toISOString()
      })
      break
    }

    if (data.stop_reason === 'end_turn') {
      if (requiresGraphWrite && !hasGraphWriteCompletion(messages)) {
        executionLog.push({
          turn,
          type: 'forced_continuation',
          reason: 'Graph-write request not completed before end_turn',
          timestamp: new Date().toISOString(),
        })
        messages.push(
          { role: 'assistant', content: data.content },
          { role: 'user', content: 'You have not completed the requested graph write yet. Use delegate_to_kg now before ending your turn.' }
        )
        continue
      }

      if (requiresGraphWrite && !hasGraphWriteVerification(messages, graphWriteVerificationStartIndex)) {
        executionLog.push({
          turn,
          type: 'forced_continuation',
          reason: 'Graph write completed but was not verified with a read tool',
          timestamp: new Date().toISOString(),
        })
        messages.push(
          { role: 'assistant', content: data.content },
          { role: 'user', content: 'The graph write is not verified yet. Read the affected graph or node now with read_node, read_graph, or read_graph_content and confirm the exact change before ending your turn.' }
        )
        continue
      }

      if (requiresCalendarQuery && !hasCalendarToolUseSince(messages, calendarQueryStartIndex)) {
        executionLog.push({
          turn,
          type: 'forced_continuation',
          reason: 'Calendar/date question answered without a fresh calendar tool call',
          timestamp: new Date().toISOString(),
        })
        messages.push(
          { role: 'assistant', content: data.content },
          { role: 'user', content: 'This calendar answer is not grounded yet. Call the appropriate calendar_ tool now for the requested date or follow-up date and answer from that result only.' }
        )
        continue
      }

      const serverSearches = data.content.filter(c => c.type === 'server_tool_use')
      for (const search of serverSearches) {
        executionLog.push({
          turn,
          type: 'web_search',
          tool: 'web_search',
          query: search.input?.query,
          timestamp: new Date().toISOString()
        })
      }

      const textContent = data.content.find(c => c.type === 'text')
      executionLog.push({
        turn,
        type: 'agent_complete',
        response: textContent ? textContent.text : '',
        timestamp: new Date().toISOString()
      })
      break
    }

    if (data.stop_reason === 'tool_use') {
      const toolUses = data.content.filter(c => c.type === 'tool_use')
      const serverSearches = data.content.filter(c => c.type === 'server_tool_use')

      for (const search of serverSearches) {
        executionLog.push({
          turn,
          type: 'web_search',
          tool: 'web_search',
          query: search.input?.query,
          timestamp: new Date().toISOString()
        })
      }

      if (toolUses.length > 0) {
        executionLog.push({
          turn,
          type: 'tool_calls',
          tools: toolUses.map(t => ({ name: t.name, input: t.input })),
          timestamp: new Date().toISOString()
        })
      }

      // Graph-mutating tools must run sequentially to avoid D1 read-modify-write race conditions
      const SEQUENTIAL_TOOLS = new Set([
        'create_graph', 'create_node', 'create_html_node', 'add_edge',
        'patch_node', 'patch_graph_metadata', 'edit_html_node', 'save_form_data',
        'create_app_table', 'insert_app_record', 'add_user_to_chat_group', 'send_group_message', 'create_chat_group',
        'register_chat_bot', 'trigger_bot_response', 'delegate_to_kg', 'delegate_to_chat', 'delegate_to_bot', 'delegate_to_agent_builder', 'delegate_to_youtube_graph'
      ])
      const sequentialTools = toolUses.filter(t => SEQUENTIAL_TOOLS.has(t.name))
      const parallelTools = toolUses.filter(t => !SEQUENTIAL_TOOLS.has(t.name))
      let inferredGraphId = null

      const GRAPH_ID_AWARE_TOOLS = new Set([
        'create_node',
        'create_html_node',
        'add_edge',
        'patch_node',
        'patch_graph_metadata',
        'read_graph',
        'read_graph_content',
        'read_node',
        'delegate_to_kg',
      ])

      // Phase 1: Run graph-mutating tools sequentially (one at a time)
      const sequentialResults = []
      for (const toolUse of sequentialTools) {
        const GRAPH_DISCOVERY_TOOLS = new Set(['search_graphs', 'list_graphs'])
        if (
          requiresCreateGraph
          && countGraphWriteCompletions(messages) <= graphWriteCompletionBaseline
          && GRAPH_DISCOVERY_TOOLS.has(toolUse.name)
        ) {
          const message = 'This request is to create a new graph. Call create_graph first, then create_node/add_edge as needed. Do not search existing graphs first.'
          executionLog.push({ turn, type: 'tool_error', tool: toolUse.name, error: message, timestamp: new Date().toISOString() })
          sequentialResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify({ error: message }) })
          continue
        }

        if (!toolUse.input) toolUse.input = {}
        if (!toolUse.input.graphId && inferredGraphId && GRAPH_ID_AWARE_TOOLS.has(toolUse.name)) {
          toolUse.input.graphId = inferredGraphId
        }
        try {
          const result = await executeTool(toolUse.name, { ...toolUse.input, userId, authContext }, env, operationMap)
          if (result?.graphId) {
            inferredGraphId = result.graphId
          }
          executionLog.push({ turn, type: 'tool_result', tool: toolUse.name, success: true, result, timestamp: new Date().toISOString() })
          sequentialResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(result) })
        } catch (error) {
          executionLog.push({ turn, type: 'tool_error', tool: toolUse.name, error: error.message, timestamp: new Date().toISOString() })
          sequentialResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify({ error: error.message }) })
        }
      }

      // Phase 2: Run non-mutating tools in parallel
      const parallelResults = await Promise.all(parallelTools.map(async (toolUse) => {
        try {
          const result = await executeTool(toolUse.name, { ...toolUse.input, userId, authContext }, env, operationMap)
          executionLog.push({ turn, type: 'tool_result', tool: toolUse.name, success: true, result, timestamp: new Date().toISOString() })
          return { type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(result) }
        } catch (error) {
          executionLog.push({ turn, type: 'tool_error', tool: toolUse.name, error: error.message, timestamp: new Date().toISOString() })
          return { type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify({ error: error.message }) }
        }
      }))

      const toolResults = [...sequentialResults, ...parallelResults]

      messages.push(
        { role: 'assistant', content: data.content },
        { role: 'user', content: toolResults }
      )
    } else if (data.stop_reason === 'pause_turn') {
      executionLog.push({
        turn,
        type: 'pause_turn',
        timestamp: new Date().toISOString()
      })

      const serverSearches = data.content.filter(c => c.type === 'server_tool_use')
      for (const search of serverSearches) {
        executionLog.push({
          turn,
          type: 'web_search',
          tool: 'web_search',
          query: search.input?.query,
          timestamp: new Date().toISOString()
        })
      }

      messages.push(
        { role: 'assistant', content: data.content },
        { role: 'user', content: 'Continue.' }
      )
    } else if (data.stop_reason === 'max_tokens') {
      executionLog.push({
        turn,
        type: 'max_tokens_continuation',
        timestamp: new Date().toISOString()
      })

      messages.push(
        { role: 'assistant', content: data.content },
        { role: 'user', content: 'You hit the token limit. Do NOT repeat what you already said. Continue by making your next tool call (create_node, add_edge, etc.) to finish the task.' }
      )
    } else {
      executionLog.push({
        turn,
        type: 'unexpected_stop',
        stop_reason: data.stop_reason,
        timestamp: new Date().toISOString()
      })
      break
    }
  }

  if (turn >= maxTurns) {
    executionLog.push({
      type: 'max_turns_reached',
      timestamp: new Date().toISOString()
    })
  }

  return {
    success: turn < maxTurns,
    turns: turn,
    executionLog: executionLog
  }
}

export { streamingAgentLoop, executeAgent }
