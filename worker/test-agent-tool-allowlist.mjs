// executeAgent offers and executes only the agent's own tools (agent_configs.tools), 2026-11-06.
// Checked against the real tool catalogue and the real agent rows as they stood that day.
import { TOOL_DEFINITIONS, PROFF_TOOLS } from './tool-definitions.js'
import { restrictToolsToAgent, allowedToolNames, refusedToolResult } from './agent-tool-allowlist.js'

// Same blocked set as loadAllTools (copied to test against the real catalogue offline).
const BLOCKED = new Set([
  'create_graph', 'create_node', 'patch_node', 'add_edge', 'patch_graph_metadata',
  'list_chat_groups', 'create_chat_group', 'update_chat_group', 'delete_chat_group', 'restore_chat_group',
  'add_user_to_chat_group', 'get_group_members', 'get_group_messages', 'get_group_stats', 'send_group_message',
  'create_poll', 'close_poll', 'get_poll_results', 'chat_db_list_tables', 'chat_db_query',
  'register_chat_bot', 'remove_chat_bot', 'trigger_bot_response', 'list_bots', 'get_bot', 'update_chat_bot',
  'list_agents', 'get_agent', 'create_agent', 'update_agent', 'deactivate_agent', 'upload_agent_avatar',
  'list_contacts', 'search_contacts', 'get_contact_logs', 'add_contact_log', 'create_contact',
])
const allTools = [...TOOL_DEFINITIONS.filter((t) => !BLOCKED.has(t.name)), ...PROFF_TOOLS]

// The real agent_configs rows (D1, 6 Nov 2026).
const agents = {
  agent_kg_html_builder: ['get_contract', 'create_graph', 'create_html_node', 'create_node', 'add_edge', 'web_search', 'read_graph', 'read_node', 'edit_html_node', 'patch_node', 'read_graph_content', 'create_html_from_template', 'list_meta_areas', 'list_graphs', 'search_graphs', 'perplexity_search', 'patch_graph_metadata'],
  image_analyzer: ['analyze_image'],
  sound: ['list_recordings', 'transcribe_audio'],
  creative: ['create_graph', 'create_node', 'read_graph', 'read_node', 'add_edge', 'delegate_to_kg', 'perplexity_search'],
  avahana: ['send_group_message'],
  claude_empty: [],
}

let fail = 0
const check = (name, cond, extra = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); if (!cond) fail++ }

console.log(`catalogue: ${allTools.length} tools offered to the orchestrator today\n`)
for (const [id, list] of Object.entries(agents)) {
  const offered = restrictToolsToAgent(allTools, list).map((t) => t.name)
  const missing = list.filter((n) => !offered.includes(n) && !['create_graph', 'create_node', 'patch_node', 'add_edge', 'patch_graph_metadata'].includes(n))
  console.log(`${id}: ${offered.length} offered [${offered.join(', ')}]${missing.length ? `  — not in today's catalogue: ${missing.join(', ')}` : ''}`)
}
console.log('')

const html = restrictToolsToAgent(allTools, agents.agent_kg_html_builder).map((t) => t.name)
check('html builder keeps delegate_to_kg (it lists KG write tools)', html.includes('delegate_to_kg'))
check('html builder keeps edit_html_node and read_graph', html.includes('edit_html_node') && html.includes('read_graph'))
check('html builder does NOT get send_email / publish_html_node', !html.includes('send_email') && !html.includes('publish_html_node'))
check('html builder offered fewer tools than before', html.length < allTools.length, `${html.length} < ${allTools.length}`)

const img = restrictToolsToAgent(allTools, agents.image_analyzer).map((t) => t.name)
check('image analyzer gets only analyze_image', img.length === 1 && img[0] === 'analyze_image', JSON.stringify(img))
check('image analyzer gets no delegate_to_kg', !allowedToolNames(agents.image_analyzer).has('delegate_to_kg'))

check('empty list → no tools', restrictToolsToAgent(allTools, []).length === 0)
check('unreadable list → no tools (fail closed)', restrictToolsToAgent(allTools, 'oops').length === 0 && restrictToolsToAgent(allTools, null).length === 0)
check('send_group_message → delegate_to_chat', JSON.stringify(restrictToolsToAgent(allTools, agents.avahana).map(t=>t.name)) === '["delegate_to_chat"]')
check('refusal message names the tool', /send_email/.test(refusedToolResult('send_email').error))

process.exit(fail ? 1 : 0)
