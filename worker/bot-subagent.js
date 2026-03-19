/**
 * Bot Management Subagent
 *
 * A focused subagent for managing AI chatbots in Hallo Vegvisr.
 * Handles bot lifecycle: create, list, update, delete, add/remove from groups,
 * and trigger bot responses. Unifies UI-based and agent-chat-based bot creation
 * through the group-chat-worker's chat_bots table.
 */

import { TOOL_DEFINITIONS } from './tool-definitions.js'

// ---------------------------------------------------------------------------
// System Prompt — focused on bot management only
// ---------------------------------------------------------------------------

const BOT_SUBAGENT_SYSTEM_PROMPT = `You are a Hallo Vegvisr Bot Management specialist. You manage AI chatbots — their creation, configuration, group assignments, and responses. You have these tools:

## Bot Lifecycle
1. \`list_bots\` — list all active bots (names, usernames, models, graph IDs)
2. \`get_bot\` — get detailed info for a specific bot, including which groups it belongs to
3. \`register_chat_bot\` — create a new bot (requires botName + username, optionally add to group)
4. \`update_chat_bot\` — update bot config (name, system prompt, graph, model, temperature, tools)
5. \`remove_chat_bot\` — remove a bot from a group, or deactivate it entirely

## Bot Interactions
6. \`trigger_bot_response\` — make a bot respond based on recent conversation in its group

## Workflows

### Creating a new bot:
1. \`register_chat_bot\` with botName + username (and optionally graphId, systemPrompt, model, tools)
2. Optionally add to a group by including groupId in the register call
3. Or add to a group later by calling \`register_chat_bot\` with an existing bot ID

### Updating a bot's configuration:
1. \`list_bots\` or \`get_bot\` to find the bot ID
2. \`update_chat_bot\` with the fields you want to change

### Removing or deactivating a bot:
1. \`remove_chat_bot\` with groupId → removes from that specific group only
2. \`remove_chat_bot\` without groupId → deactivates the bot entirely (soft delete)

### Checking bot details:
1. \`list_bots\` for an overview of all active bots
2. \`get_bot\` for detailed info including group memberships

### Making a bot respond:
1. \`trigger_bot_response\` with groupId (and optionally botId for a specific bot)
2. The bot reads recent messages, uses its configured tools (search_knowledge, web_search, etc.)
3. The response is posted back to the group automatically

## Rules
- Bot usernames must be lowercase, alphanumeric with - or _ only (no spaces)
- Bot management requires Superadmin privileges
- When creating bots, suggest meaningful usernames like "simula", "kg-helper", "translator"
- Default model is claude-haiku-4-5-20251001 — mention this to the user
- Available bot tools: search_knowledge, read_node, web_search, translate
- graph_id links a knowledge graph to the bot's personality (fulltext nodes become context)

After completing your task, provide a brief summary of what you did.`

// ---------------------------------------------------------------------------
// Subagent tool set — only bot-related tools
// ---------------------------------------------------------------------------

const BOT_SUBAGENT_TOOL_NAMES = new Set([
  'list_bots',
  'get_bot',
  'register_chat_bot',
  'update_chat_bot',
  'remove_chat_bot',
  'trigger_bot_response',
])

function getBotSubagentTools() {
  return TOOL_DEFINITIONS.filter(t => BOT_SUBAGENT_TOOL_NAMES.has(t.name))
}

// ---------------------------------------------------------------------------
// Inner agent loop
// ---------------------------------------------------------------------------

async function runBotSubagent(input, env, onProgress, executeTool) {
  const { task, botId, groupId, userId } = input
  const maxTurns = 15
  const model = env.SUBAGENT_MODEL || 'claude-haiku-4-5-20251001'
  let inputTokens = 0
  let outputTokens = 0

  const log = (msg) => console.log(`[bot-subagent] ${msg}`)
  const progress = typeof onProgress === 'function' ? onProgress : () => {}

  // Progress messages
  const thinkingMessages = [
    'Scanning the bot registry...',
    'Loading bot configurations...',
    'Checking permissions...',
    'Processing bot data...',
    'Connecting to the group...',
    'Updating the roster...',
    'Verifying bot settings...',
    'Applying changes...',
    'Almost there...',
    'Wrapping up...',
    'Finalizing...',
    'One more step...',
    'Verifying results...',
    'All done...',
    'Complete.',
  ]
  const toolMessages = {
    list_bots: ['Listing all bots...', 'Scanning the bot registry...'],
    get_bot: ['Loading bot details...', 'Reading bot configuration...'],
    register_chat_bot: ['Creating a new bot...', 'A new AI awakens...'],
    update_chat_bot: ['Updating bot config...', 'Tuning the bot...'],
    remove_chat_bot: ['Removing the bot...', 'The bot steps back...'],
    trigger_bot_response: ['Triggering bot response...', 'The bot ponders...'],
  }

  // Build initial user message with context
  let userMessage = `## Task\n${task}`
  if (botId) userMessage += `\n\n## Context\n- botId: ${botId}`
  if (groupId) userMessage += `\n- groupId: ${groupId}`

  const messages = [{ role: 'user', content: userMessage }]
  const tools = getBotSubagentTools()
  let turn = 0
  const actions = []

  log(`started | botId=${botId || 'none'} groupId=${groupId || 'none'} task="${task.slice(0, 100)}"`)
  progress('Scanning the bot registry...')

  while (turn < maxTurns) {
    turn++
    log(`turn ${turn}/${maxTurns}`)
    progress(thinkingMessages[turn - 1] || `Still working... (${turn})`)

    const response = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userId || 'bot-subagent',
        apiKey: env.ANTHROPIC_API_KEY || undefined,
        messages,
        model,
        max_tokens: 8192,
        temperature: 0.2,
        system: BOT_SUBAGENT_SYSTEM_PROMPT,
        tools,
      }),
    })

    const data = await response.json()
    if (!response.ok) {
      log(`ERROR: ${JSON.stringify(data.error)}`)
      return { success: false, error: data.error || 'Anthropic API error', turns: turn, actions, inputTokens, outputTokens }
    }

    if (data.usage) {
      inputTokens += data.usage.input_tokens || 0
      outputTokens += data.usage.output_tokens || 0
    }

    // End turn — return summary
    if (data.stop_reason === 'end_turn') {
      const text = (data.content || []).filter(c => c.type === 'text').map(b => b.text).join('\n')
      log(`end_turn — summary: ${text.slice(0, 200)} | tokens in=${inputTokens} out=${outputTokens}`)
      return {
        success: true,
        summary: text,
        turns: turn,
        actions,
        model,
        botId: botId || actions.find(a => a.botId)?.botId,
        inputTokens,
        outputTokens,
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
          const result = await executeTool(toolUse.name, { ...toolUse.input, userId }, env, {})

          const resultStr = JSON.stringify(result)
          actions.push({
            tool: toolUse.name,
            success: true,
            botId: toolUse.input.botId || result.botId,
            summary: result.message || `${toolUse.name} ok`,
          })

          // Truncate large results to keep subagent context manageable
          const truncated = resultStr.length > 10000
            ? resultStr.slice(0, 10000) + '... [truncated]'
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

  log(`max turns reached (${maxTurns}) | tokens in=${inputTokens} out=${outputTokens}`)
  return {
    success: actions.some(a => a.success),
    summary: `Bot subagent completed ${actions.length} actions in ${turn} turns (max turns reached).`,
    turns: turn,
    actions,
    model,
    botId: botId || actions.find(a => a.botId)?.botId,
    inputTokens,
    outputTokens,
    maxTurnsReached: true,
  }
}

export { runBotSubagent }
