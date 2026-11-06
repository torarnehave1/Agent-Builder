/**
 * Which tools an agent run by /execute may use (added 2026-11-06, VEGR Flows phase 0).
 *
 * Until then executeAgent ignored agent_configs.tools: every agent was offered every tool the
 * orchestrator has, and any tool the model named was executed. An agent configured with only
 * ["analyze_image"] could send group messages or publish pages.
 *
 * Rule: agent_configs.tools is an allow-list ("Array of tool names the agent can use").
 *   - Only tools on the list are offered to the model, and only those are executed.
 *   - An empty list means no tools — the agent answers in text.
 *   - Some tools are never offered to the orchestrator directly (ORCHESTRATOR_BLOCKED_TOOLS in
 *     agent-loop.js): it reaches them through a delegate — graph writes through delegate_to_kg,
 *     group chat through delegate_to_chat, and so on. An agent that lists such a tool gets that
 *     group's delegate, which is how it could do the job before this change. Its list is the
 *     intent; the delegate is the route.
 *   - A list that is not an array (a config we cannot read) falls back to no tools. Failing
 *     closed costs a text-only answer; failing open would hand an agent every tool.
 */

/** Blocked tool → the delegate the orchestrator uses for it. Mirrors ORCHESTRATOR_BLOCKED_TOOLS. */
const DELEGATE_FOR = {
  delegate_to_kg: ['create_graph', 'create_node', 'patch_node', 'add_edge', 'patch_graph_metadata'],
  delegate_to_chat: [
    'list_chat_groups', 'create_chat_group', 'update_chat_group', 'delete_chat_group',
    'restore_chat_group', 'add_user_to_chat_group', 'get_group_members', 'get_group_messages',
    'get_group_stats', 'send_group_message', 'create_poll', 'close_poll', 'get_poll_results',
    'chat_db_list_tables', 'chat_db_query',
  ],
  delegate_to_bot: [
    'register_chat_bot', 'remove_chat_bot', 'trigger_bot_response', 'list_bots', 'get_bot',
    'update_chat_bot',
  ],
  delegate_to_agent_builder: [
    'list_agents', 'get_agent', 'create_agent', 'update_agent', 'deactivate_agent',
    'upload_agent_avatar',
  ],
  delegate_to_contact: ['list_contacts', 'search_contacts', 'get_contact_logs', 'add_contact_log', 'create_contact'],
}

export const KG_WRITE_TOOLS = new Set(DELEGATE_FOR.delegate_to_kg)

/** The set of tool names this agent may use, from its configured list. */
export function allowedToolNames(agentToolNames) {
  const names = Array.isArray(agentToolNames)
    ? agentToolNames.filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim())
    : []
  const allowed = new Set(names)
  for (const [delegate, tools] of Object.entries(DELEGATE_FOR)) {
    if (names.some((n) => tools.includes(n))) allowed.add(delegate)
  }
  return allowed
}

/** The tool schemas to offer the model: the orchestrator's tools, narrowed to the allow-list. */
export function restrictToolsToAgent(allTools, agentToolNames) {
  const allowed = allowedToolNames(agentToolNames)
  return allTools.filter((t) => allowed.has(t.name))
}

/** The tool_result to return when the model calls a tool it was not given. */
export function refusedToolResult(toolName) {
  return {
    error: `Tool "${toolName}" is not available to this agent. Use only the tools you were given.`,
  }
}
