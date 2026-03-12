/**
 * Chatbot Subagent
 *
 * A focused subagent that powers AI chat bots in Hallo Vegvisr groups.
 * When a user @mentions a bot, the message router triggers this subagent
 * with the bot's config, recent conversation, and available tools.
 * The subagent generates a response and posts it back as the bot.
 */

// ---------------------------------------------------------------------------
// System Prompt — built dynamically per bot
// ---------------------------------------------------------------------------

function buildBotSystemPrompt(bot, groupName, personality) {
  return `You are ${bot.name} (@${bot.username}), a chat bot in the Hallo Vegvisr group "${groupName}".

${bot.system_prompt || ''}

${personality ? `## Your Knowledge & Personality\n${personality}` : ''}

## Rules
- Respond naturally as a group chat participant
- Keep responses concise unless asked for detail
- Do not prefix your response with your name or any label
- Do not repeat what others said
- If you don't know something, say so honestly
- Be helpful, friendly, and on-topic`
}

// ---------------------------------------------------------------------------
// Tool definitions for bots — subset of available tools
// ---------------------------------------------------------------------------

const BOT_TOOL_CATALOG = {
  search_knowledge: {
    name: 'search_knowledge',
    description: 'Search knowledge graphs for information. Returns matching graphs and nodes.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query text' },
        nodeType: { type: 'string', description: 'Filter by node type (fulltext, html-node, etc.)' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      required: ['query'],
    },
  },
  read_node: {
    name: 'read_node',
    description: 'Read the full content of a specific node in a knowledge graph.',
    input_schema: {
      type: 'object',
      properties: {
        graphId: { type: 'string', description: 'Graph ID' },
        nodeId: { type: 'string', description: 'Node ID' },
      },
      required: ['graphId', 'nodeId'],
    },
  },
  web_search: {
    name: 'perplexity_search',
    description: 'Search the web for current information using Perplexity AI.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
  },
  translate: {
    name: 'translate',
    description: 'Translate text between languages.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to translate' },
        target_language: { type: 'string', description: 'Target language (en, no, is, nl)' },
        source_language: { type: 'string', description: 'Source language (auto-detected if omitted)' },
      },
      required: ['text', 'target_language'],
    },
  },
}

function getBotTools(enabledToolNames) {
  if (!enabledToolNames || enabledToolNames.length === 0) return []
  return enabledToolNames
    .map(name => BOT_TOOL_CATALOG[name])
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// Format conversation context
// ---------------------------------------------------------------------------

function formatMessages(messages) {
  const now = Date.now()
  return messages
    .map(m => {
      const ago = Math.round((now - m.created_at) / 60000)
      const timeStr = ago < 1 ? 'just now' : ago < 60 ? `${ago}m ago` : `${Math.round(ago / 60)}h ago`
      const isBotMsg = m.user_id && m.user_id.startsWith('bot:')
      const sender = isBotMsg ? `[BOT ${m.user_id}]` : (m.user_id || 'unknown')

      let content = m.body || ''
      if (m.message_type === 'voice' && m.transcript_text) {
        content = `[voice message] ${m.transcript_text}`
      } else if (m.message_type === 'image') {
        content = content ? `[image] ${content}` : '[image]'
      } else if (m.message_type === 'video') {
        content = content ? `[video] ${content}` : '[video]'
      }

      return `[${sender}, ${timeStr}]: ${content}`
    })
    .join('\n')
}

// ---------------------------------------------------------------------------
// Inner agent loop
// ---------------------------------------------------------------------------

async function runChatbotSubagent(input, env, executeTool) {
  const {
    bot,          // { id, name, username, system_prompt, graph_id, tools, model, max_turns, temperature }
    groupId,
    groupName,
    triggerMessage, // The message that triggered this bot
    recentMessages, // Array of recent messages for context
  } = input

  const maxTurns = Math.min(bot.max_turns || 10, 20)
  const model = bot.model || 'claude-haiku-4-5-20251001'
  const temperature = bot.temperature ?? 0.7

  const log = (msg) => console.log(`[chatbot-subagent:@${bot.username}] ${msg}`)

  // Load personality from knowledge graph if configured
  let personality = ''
  if (bot.graph_id) {
    try {
      const kgRes = await env.KG_WORKER.fetch(
        `https://knowledge-graph-worker/getknowgraph?id=${bot.graph_id}`
      )
      const kgData = await kgRes.json()
      if (kgRes.ok && kgData.nodes) {
        const fulltextNodes = (kgData.nodes || []).filter(n => n.type === 'fulltext' && n.info)
        personality = fulltextNodes.map(n => n.info).join('\n\n---\n\n')
        log(`loaded personality from graph ${bot.graph_id}: ${fulltextNodes.length} nodes`)
      }
    } catch (err) {
      log(`failed to load graph ${bot.graph_id}: ${err.message}`)
    }
  }

  const systemPrompt = buildBotSystemPrompt(bot, groupName, personality)
  const tools = getBotTools(JSON.parse(typeof bot.tools === 'string' ? bot.tools : JSON.stringify(bot.tools || [])))
  const formattedContext = formatMessages(recentMessages || [])

  const userMessage = triggerMessage
    ? `Recent conversation in the group:\n\n${formattedContext}\n\nYou were mentioned or triggered by this message. Please respond.`
    : `Recent conversation in the group:\n\n${formattedContext}\n\nPlease respond to the conversation.`

  const messages = [{ role: 'user', content: userMessage }]
  let turn = 0

  log(`started | group=${groupName} model=${model} tools=${tools.length} maxTurns=${maxTurns}`)

  while (turn < maxTurns) {
    turn++
    log(`turn ${turn}/${maxTurns}`)

    const apiPayload = {
      userId: `bot:${bot.id}`,
      messages,
      model,
      max_tokens: 1024,
      temperature,
      system: systemPrompt,
    }
    if (tools.length > 0) apiPayload.tools = tools

    const response = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(apiPayload),
    })

    const data = await response.json()
    if (!response.ok) {
      log(`ERROR: ${JSON.stringify(data.error)}`)
      return { success: false, error: data.error || 'Anthropic API error', turns: turn }
    }

    // End turn — extract response text
    if (data.stop_reason === 'end_turn') {
      const text = (data.content || [])
        .filter(c => c.type === 'text')
        .map(b => b.text)
        .join('\n')
      log(`end_turn — response: ${text.slice(0, 200)}`)
      return { success: true, response: text, turns: turn }
    }

    // Tool use
    if (data.stop_reason === 'tool_use') {
      const toolUses = (data.content || []).filter(c => c.type === 'tool_use')
      log(`tool_use — ${toolUses.length} tools: [${toolUses.map(t => t.name).join(', ')}]`)

      const toolResults = []
      for (const toolUse of toolUses) {
        try {
          const result = await executeTool(toolUse.name, toolUse.input, env, {})
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
      // Unknown stop reason — push forward
      messages.push(
        { role: 'assistant', content: data.content },
        { role: 'user', content: 'Continue. You have more turns available.' },
      )
    }
  }

  log(`max turns reached (${maxTurns})`)
  // Extract any text from the last response
  const lastAssistant = messages.filter(m => m.role === 'assistant').pop()
  const fallbackText = lastAssistant?.content
    ?.filter?.(c => c.type === 'text')
    ?.map(b => b.text)
    ?.join('\n') || ''

  return {
    success: !!fallbackText,
    response: fallbackText || 'I ran out of processing steps. Please try again.',
    turns: turn,
    maxTurnsReached: true,
  }
}

export { runChatbotSubagent }
