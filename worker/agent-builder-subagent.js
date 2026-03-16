/**
 * Agent Builder Subagent
 *
 * A focused subagent for managing AI agents in the Agent Builder.
 * Handles agent lifecycle: list, create, update, delete, get details,
 * and avatar management. All data stored in agent_configs D1 table.
 */

import { TOOL_DEFINITIONS } from './tool-definitions.js'

// ---------------------------------------------------------------------------
// System Prompt — focused on agent management only
// ---------------------------------------------------------------------------

const AGENT_BUILDER_SYSTEM_PROMPT = `You are a Vegvisr Agent Builder specialist. You manage AI agent configurations — their creation, settings, tools, avatars, and lifecycle. You have these tools:

## Agent Lifecycle
1. \`list_agents\` — list all active agents (names, models, tools, avatars)
2. \`get_agent\` — get detailed info for a specific agent (including system prompt, metadata, bot link)
3. \`create_agent\` — create a new agent (requires name, optionally description, model, tools, system prompt, avatar)
4. \`update_agent\` — update agent config (name, description, system prompt, model, temperature, tools, avatar, metadata)
5. \`deactivate_agent\` — soft-delete an agent (sets is_active = 0)
6. \`upload_agent_avatar\` — upload a base64 image as the agent's avatar (uses photos-worker for R2 storage)

## Workflows

### Creating a new agent:
1. \`create_agent\` with at least a name
2. Optionally set description, system_prompt, model, temperature, tools
3. Optionally upload an avatar via \`upload_agent_avatar\`

### Updating an agent:
1. \`list_agents\` or \`get_agent\` to find the agent ID
2. \`update_agent\` with the fields you want to change

### Changing an agent's avatar:
1. \`upload_agent_avatar\` with agentId + base64 image data
2. The avatar is uploaded to R2 and the URL is stored on the agent

### Deactivating an agent:
1. \`deactivate_agent\` with agentId — soft-deletes (sets is_active = 0)

### Checking agent details:
1. \`list_agents\` for an overview of all active agents
2. \`get_agent\` for detailed info including system prompt, tools, and bot link

## Agent Configuration Fields
- **name**: Display name (required)
- **description**: Short description of what the agent does
- **system_prompt**: The system prompt that defines the agent's behavior and personality
- **model**: LLM model ID. Available: claude-haiku-4-5-20251001 (fast/cheap), claude-sonnet-4-20250514 (balanced), claude-opus-4-20250514 (most capable)
- **temperature**: 0.0 (deterministic) to 1.0 (creative). Default 0.3
- **max_tokens**: Maximum response tokens. Default 4096
- **tools**: Array of tool name strings the agent can use
- **avatar_url**: URL to the agent's avatar image
- **metadata**: JSON object for extra config (e.g. chatBotId linking to a chat bot)

## System Discovery
- \`get_system_registry\` — Read the live system registry to discover all available tools, subagents, workers, node types, and templates. **ALWAYS call this before configuring an agent's tools** so you know what tools actually exist. You can filter by: all, subagents, workers, nodetypes, templates.

## Rules
- Agent IDs follow the pattern "agent_<8chars>" (auto-generated on create)
- Default model is claude-haiku-4-5-20251001
- When listing agents, always mention count and names
- When creating, confirm the ID and settings back to the user
- Deactivation is a soft-delete — the agent can be reactivated by updating is_active
- **ALWAYS call get_system_registry before creating or updating an agent's tools** — never guess tool names

After completing your task, provide a brief summary of what you did.`

// ---------------------------------------------------------------------------
// Subagent tool set — only agent management tools
// ---------------------------------------------------------------------------

const AGENT_BUILDER_TOOL_NAMES = new Set([
  'list_agents',
  'get_agent',
  'create_agent',
  'update_agent',
  'deactivate_agent',
  'upload_agent_avatar',
  'get_system_registry',
])

function getAgentBuilderTools() {
  return TOOL_DEFINITIONS.filter(t => AGENT_BUILDER_TOOL_NAMES.has(t.name))
}

// ---------------------------------------------------------------------------
// Inner agent loop
// ---------------------------------------------------------------------------

async function runAgentBuilderSubagent(input, env, onProgress, executeTool) {
  const { task, agentId, userId } = input
  const maxTurns = 15
  const model = 'claude-sonnet-4-20250514'

  const log = (msg) => console.log(`[agent-builder-subagent] ${msg}`)
  const progress = typeof onProgress === 'function' ? onProgress : () => {}

  const thinkingMessages = [
    'Loading agent registry...',
    'Checking agent configurations...',
    'Processing request...',
    'Reading agent data...',
    'Updating agent settings...',
    'Applying changes...',
    'Verifying configuration...',
    'Almost there...',
    'Wrapping up...',
    'Finalizing...',
    'Complete.',
  ]
  const toolMessages = {
    list_agents: ['Listing all agents...', 'Scanning the agent registry...'],
    get_agent: ['Loading agent details...', 'Reading agent configuration...'],
    create_agent: ['Creating a new agent...', 'Setting up the agent...'],
    update_agent: ['Updating agent config...', 'Applying changes...'],
    deactivate_agent: ['Deactivating agent...', 'The agent steps down...'],
    upload_agent_avatar: ['Uploading avatar...', 'Setting the agent\'s face...'],
  }

  // Build initial user message with context
  let userMessage = `## Task\n${task}`
  if (agentId) userMessage += `\n\n## Context\n- agentId: ${agentId}`

  const messages = [{ role: 'user', content: userMessage }]
  const tools = getAgentBuilderTools()
  let turn = 0
  const actions = []

  log(`started | agentId=${agentId || 'none'} task="${task.slice(0, 100)}"`)
  progress('Loading agent registry...')

  while (turn < maxTurns) {
    turn++
    log(`turn ${turn}/${maxTurns}`)
    progress(thinkingMessages[turn - 1] || `Still working... (${turn})`)

    const response = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userId || 'agent-builder-subagent',
        messages,
        model,
        max_tokens: 8192,
        temperature: 0.2,
        system: AGENT_BUILDER_SYSTEM_PROMPT,
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
        agentId: agentId || actions.find(a => a.agentId)?.agentId,
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
            agentId: toolUse.input.agentId || result.agentId || result.id,
            summary: result.message || `${toolUse.name} ok`,
          })

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

  log(`max turns reached (${maxTurns})`)
  return {
    success: actions.some(a => a.success),
    summary: `Agent builder subagent completed ${actions.length} actions in ${turn} turns (max turns reached).`,
    turns: turn,
    actions,
    agentId: agentId || actions.find(a => a.agentId)?.agentId,
    maxTurnsReached: true,
  }
}

export { runAgentBuilderSubagent }
