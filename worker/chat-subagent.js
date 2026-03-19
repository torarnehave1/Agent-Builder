/**
 * Chat Groups Subagent
 *
 * A focused subagent for managing Hallo Vegvisr chat groups, members, bots,
 * and polls. Handles group CRUD, member/bot management, messaging, polls,
 * and group analytics. Follows the same delegation pattern as the HTML Builder
 * and KG subagents.
 */

import { TOOL_DEFINITIONS } from './tool-definitions.js'

// ---------------------------------------------------------------------------
// System Prompt — focused on chat group operations only
// ---------------------------------------------------------------------------

const CHAT_SUBAGENT_SYSTEM_PROMPT = `You are a Hallo Vegvisr Chat Groups specialist. You manage chat groups, members, messages, and polls. For bot management (create/update/delete bots), use the Bot Management subagent instead.

## Group Management
1. \`list_chat_groups\` — list all groups (IDs, names, member counts)
2. \`create_chat_group\` — create a new group (requires email + name)
3. \`update_chat_group\` — rename a group or change its image (owner/admin only)
4. \`delete_chat_group\` — archive a group (superadmin only, reversible)
5. \`restore_chat_group\` — restore an archived group (superadmin only)
6. \`get_group_stats\` — activity statistics for all groups

## Members
7. \`add_user_to_chat_group\` — add a vegvisr.org user by email
8. \`get_group_members\` — list members with roles, emails, bot flags

## Messages
9. \`get_group_messages\` — read recent messages from a group
10. \`send_group_message\` — send a text or voice message on behalf of a user

## Polls
11. \`create_poll\` — create a poll in a group (question + options)
12. \`close_poll\` — close a poll so voting stops
13. \`get_poll_results\` — get current vote counts and voter details

## Direct Database Access (read-only)
14. \`chat_db_list_tables\` — list all tables and columns in the chat database
15. \`chat_db_query\` — run SELECT queries directly on the chat database (groups, group_messages, group_members, chat_bots, polls, poll_votes, message_reactions). Use this for counts, date lookups, and any analysis that needs exact data.

## Release Notes
16. \`add_whats_new\` — add a feature entry to a What's New page. Requires \`app\` parameter — always use \`app: "chat"\` since you are the chat subagent. Use this after a new chat feature is deployed.
17. \`add_user_suggestion\` — add a user suggestion to the Suggestions board. Requires \`app\` (always use \`app: "chat"\`), \`title\`, \`description\`, and optional \`category\` (feature, bug, ux, integration, other).
18. \`update_suggestion_status\` — change the status of a suggestion (new → reviewed → planned → shipped). Requires \`app\` (always use \`app: "chat"\`), \`suggestionId\` (the node ID), and \`status\`.

## Workflows

### Setting up a new group:
1. \`create_chat_group\` with creator email + group name
2. \`add_user_to_chat_group\` for each member

### Running a poll:
1. \`create_poll\` with question and options array
2. Share with users (poll appears as a message in the group)
3. \`get_poll_results\` to check votes
4. \`close_poll\` when voting should end

### Analyzing group activity:
1. \`chat_db_query\` for exact counts, date ranges, and SQL analysis (preferred for data questions)
2. \`get_group_messages\` to read message content for sentiment/topic analysis
3. \`get_group_members\` to see who is in a group
4. \`get_group_stats\` for a quick overview of all groups

## Rules
- Use groupName when you have a name but not a UUID — tools resolve it automatically
- email must be a registered vegvisr.org user for member operations
- Archive (delete) is reversible — use delete_chat_group, not a permanent delete
- When creating polls, provide 2-6 clear, distinct options
- **ALWAYS use \`chat_db_query\` for counting, date lookups, and data analysis** — it gives exact results via SQL. Use \`chat_db_list_tables\` first if you need to discover the schema.
- Examples: "how many messages" → \`SELECT COUNT(*) FROM group_messages WHERE group_id = ?\`, "last message" → \`SELECT * FROM group_messages WHERE group_id = ? ORDER BY id DESC LIMIT 1\`
- First resolve the group ID with \`list_chat_groups\` or \`chat_db_query\`, then query group_messages.

After completing your task, provide a brief summary of what you did.`

// ---------------------------------------------------------------------------
// Subagent tool set — only chat-related tools
// ---------------------------------------------------------------------------

const CHAT_SUBAGENT_TOOL_NAMES = new Set([
  'list_chat_groups',
  'create_chat_group',
  'update_chat_group',
  'delete_chat_group',
  'restore_chat_group',
  'add_user_to_chat_group',
  'get_group_members',
  'get_group_messages',
  'get_group_stats',
  'send_group_message',
  'create_poll',
  'close_poll',
  'get_poll_results',
  'chat_db_list_tables',
  'chat_db_query',
  'add_whats_new',
  'add_user_suggestion',
  'update_suggestion_status',
])

function getChatSubagentTools() {
  return TOOL_DEFINITIONS.filter(t => CHAT_SUBAGENT_TOOL_NAMES.has(t.name))
}

// ---------------------------------------------------------------------------
// Inner agent loop
// ---------------------------------------------------------------------------

async function runChatSubagent(input, env, onProgress, executeTool) {
  const { task, groupId, groupName, userId } = input
  const maxTurns = 15
  const model = env.SUBAGENT_MODEL || 'claude-haiku-4-5-20251001'
  let inputTokens = 0
  let outputTokens = 0

  const log = (msg) => console.log(`[chat-subagent] ${msg}`)
  const progress = typeof onProgress === 'function' ? onProgress : () => {}

  // Progress messages
  const thinkingMessages = [
    'Opening the chat dashboard...',
    'Scanning group channels...',
    'Members coming into view...',
    'Reading the conversation...',
    'Processing group data...',
    'Checking permissions...',
    'Updating the roster...',
    'Tallying the votes...',
    'Connecting the pieces...',
    'Almost there...',
    'Wrapping up...',
    'Finalizing changes...',
    'One more step...',
    'Verifying results...',
    'Done.',
  ]
  const toolMessages = {
    list_chat_groups: ['Listing all groups...', 'Scanning the channels...'],
    create_chat_group: ['Creating a new group...', 'A new channel opens...'],
    update_chat_group: ['Updating group settings...', 'Renaming the channel...'],
    delete_chat_group: ['Archiving the group...', 'The channel fades...'],
    restore_chat_group: ['Restoring the group...', 'The channel returns...'],
    add_user_to_chat_group: ['Adding a member...', 'A new voice joins...'],
    get_group_members: ['Checking the roster...', 'Who is here...'],
    get_group_messages: ['Reading messages...', 'Scrolling through history...'],
    get_group_stats: ['Crunching the numbers...', 'Analyzing activity...'],
    send_group_message: ['Sending a message...', 'Words take flight...'],
    create_poll: ['Creating a poll...', 'The question is posed...'],
    close_poll: ['Closing the poll...', 'Voting has ended...'],
    get_poll_results: ['Counting votes...', 'The results emerge...'],
    add_whats_new: ['Publishing release notes...', 'Announcing the feature...'],
    add_user_suggestion: ['Recording the suggestion...', 'Your idea has been noted...'],
    update_suggestion_status: ['Updating suggestion status...', 'Changing the roadmap...'],
  }

  // Build initial user message with context
  let userMessage = `## Task\n${task}`
  if (groupId) userMessage += `\n\n## Context\n- groupId: ${groupId}`
  if (groupName) userMessage += `\n- groupName: ${groupName}`

  const messages = [{ role: 'user', content: userMessage }]
  const tools = getChatSubagentTools()
  let turn = 0
  const actions = []

  log(`started | groupId=${groupId || 'none'} groupName=${groupName || 'none'} task="${task.slice(0, 100)}"`)
  progress('Opening the chat dashboard...')

  while (turn < maxTurns) {
    turn++
    log(`turn ${turn}/${maxTurns}`)
    progress(thinkingMessages[turn - 1] || `Still working... (${turn})`)

    const response = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userId || 'chat-subagent',
        apiKey: env.ANTHROPIC_API_KEY || undefined,
        messages,
        model,
        max_tokens: 8192,
        temperature: 0.2,
        system: CHAT_SUBAGENT_SYSTEM_PROMPT,
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
        groupId: groupId || actions.find(a => a.groupId)?.groupId,
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
            groupId: toolUse.input.groupId || result.groupId || result.group_id,
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
    summary: `Chat subagent completed ${actions.length} actions in ${turn} turns (max turns reached).`,
    turns: turn,
    actions,
    model,
    groupId: groupId || actions.find(a => a.groupId)?.groupId,
    inputTokens,
    outputTokens,
    maxTurnsReached: true,
  }
}

export { runChatSubagent }
