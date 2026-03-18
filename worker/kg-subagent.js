/**
 * Knowledge Graph Subagent
 *
 * A focused subagent for all knowledge graph operations: creating graphs,
 * adding/editing/removing nodes, managing edges, searching, and reading content.
 * Knows the exact KG API conventions, node types, and formatting rules.
 */

import { TOOL_DEFINITIONS } from './tool-definitions.js'

// ---------------------------------------------------------------------------
// System Prompt — focused on KG operations only
// ---------------------------------------------------------------------------

const KG_SUBAGENT_SYSTEM_PROMPT = `You are a Knowledge Graph specialist. You create, read, update, and manage knowledge graphs and their nodes. You have these tools:

## Core Tools
1. \`create_graph\` — create a new graph. Graph IDs MUST be UUIDs (e.g. "550e8400-e29b-41d4-a716-446655440000"). NEVER use human-readable names.
2. \`read_graph\` — read graph structure (truncated content). Use first to see what a graph contains.
3. \`read_graph_content\` — read full content of all nodes (no truncation). Use when you need actual text.
4. \`read_node\` — read a single node's full content.
5. \`create_node\` — add a node to a graph. The graph must already exist.
6. \`patch_node\` — update specific fields on a node (info, label, path, color, etc.). Only provided fields change.
7. \`patch_graph_metadata\` — update graph metadata (title, description, category, metaArea).
8. \`add_edge\` — connect two nodes with a directed edge.
9. \`list_graphs\` — list graphs with summaries. Use metaArea to filter.
10. \`list_meta_areas\` — list all meta areas and categories.
11. \`get_formatting_reference\` — get fulltext formatting syntax (SECTION, FANCY, QUOTE, etc.).
12. \`get_node_types_reference\` — get data format reference for special node types.

## Node Types
- **fulltext**: Markdown content in \`info\` field. Label prefixed with \`#\` for discovery.
- **html-node**: Full HTML page in \`info\` field. Do NOT create html-nodes here — use the HTML Builder subagent.
- **markdown-image**: Image reference. URL in \`path\` field, alt text in \`info\`. Type is \`markdown-image\`, NOT \`image\`.
- **mermaid-diagram**: Mermaid syntax in \`info\` field (raw, NO markdown fencing/backticks).
- **css-node**: CSS in \`info\` field, linked to html-node via \`styles\` edge.
- **video/audio/link**: Media types with URL in \`path\` field.

## Workflows

### Creating a new graph with content:
1. \`create_graph\` with a UUID, title, description, category, metaArea
2. \`create_node\` for each piece of content
3. \`add_edge\` to connect related nodes

### Exporting data to a graph:
1. Create graph (if needed) or use existing graphId
2. Create one node per item — use meaningful nodeIds (kebab-case, e.g. "node-contact-john-doe")
3. For structured data: use fulltext nodes with markdown tables or formatted content
4. Connect related nodes with edges

### Reading and analyzing:
1. \`read_graph\` first for overview
2. \`read_node\` or \`read_graph_content\` for full content
3. Summarize findings

### Updating content:
1. \`read_graph\` or \`read_node\` to see current state
2. \`patch_node\` to update specific fields
3. \`patch_graph_metadata\` for graph-level changes

## Rules
- **CRITICAL**: If a graphId is provided in Context, you MUST use that graph. Do NOT create a new graph. Add content to the existing graph using create_node.
- Graph IDs MUST be UUIDs — NEVER human-readable names. NEVER invent/hallucinate graph IDs.
- Node IDs should be lowercase-kebab-case (e.g. "node-intro", "node-contact-john")
- ALWAYS read before writing to understand current state
- Track node IDs and graph IDs from tool results — use exact IDs, never guess or hallucinate
- When creating from perplexity_search results, include citations in a "## Sources" section and populate bibl array
- Format graph results as markdown links: \`[Title](https://www.vegvisr.org/gnew-viewer?graphId=THE_ID)\`
- metaArea should be ALL CAPS (e.g. "NEUROSCIENCE", "AI TECHNOLOGY")
- category uses hashtags (e.g. "#Health #Neuroscience")

After completing your task, provide a brief summary of what you did.`

// ---------------------------------------------------------------------------
// Subagent tool set — only KG-related tools
// ---------------------------------------------------------------------------

const KG_SUBAGENT_TOOL_NAMES = new Set([
  'create_graph',
  'read_graph',
  'read_graph_content',
  'read_node',
  'create_node',
  'patch_node',
  'patch_graph_metadata',
  'add_edge',
  'list_graphs',
  'list_meta_areas',
  'get_formatting_reference',
  'get_node_types_reference',
])

function getKgSubagentTools() {
  return TOOL_DEFINITIONS.filter(t => KG_SUBAGENT_TOOL_NAMES.has(t.name))
}

// ---------------------------------------------------------------------------
// Inner agent loop
// ---------------------------------------------------------------------------

async function runKgSubagent(input, env, onProgress, executeTool) {
  const { task, nodeId, userId } = input
  // Mutable — tracks the active graphId (from input or from first create_graph)
  let graphId = input.graphId || null
  const maxTurns = 10
  const model = 'claude-sonnet-4-20250514'

  const log = (msg) => console.log(`[kg-subagent] ${msg}`)
  const progress = typeof onProgress === 'function' ? onProgress : () => {}

  // Mystical progress messages
  const thinkingMessages = [
    'Entering the graph...',
    'Nodes appearing from the void...',
    'The knowledge arranges itself...',
    'Connections forming...',
    'A pattern in the constellation...',
    'Tracing the edges...',
    'The graph breathes...',
    'Weaving knowledge together...',
    'Each node a universe...',
    'The web of meaning grows...',
    'Stillness between the nodes...',
    'All paths lead somewhere...',
    'The structure reveals itself...',
    'A map of understanding...',
    'The graph is complete...',
  ]
  const toolMessages = {
    create_graph: ['A new graph emerges...', 'Creating a space for knowledge...'],
    read_graph: ['Reading the structure...', 'Seeing the whole...'],
    read_graph_content: ['Absorbing the content...', 'Every word matters...'],
    read_node: ['Focusing on one node...', 'The detail reveals itself...'],
    create_node: ['A new node crystallizes...', 'Adding to the constellation...'],
    patch_node: ['Refining the node...', 'The content shifts...'],
    patch_graph_metadata: ['Updating the graph...', 'Metadata flows...'],
    add_edge: ['Drawing a connection...', 'Two nodes become linked...'],
    list_graphs: ['Surveying the landscape...', 'Discovering what exists...'],
    list_meta_areas: ['Mapping the territories...'],
    get_formatting_reference: ['Consulting the style guide...'],
    get_node_types_reference: ['Checking the type system...'],
  }

  // Build initial user message
  let userMessage = `## Task\n${task}`
  if (graphId) userMessage += `\n\n## Context\n- graphId: ${graphId}`
  if (nodeId) userMessage += `\n- nodeId: ${nodeId}`

  const messages = [{ role: 'user', content: userMessage }]
  const tools = getKgSubagentTools()
  let turn = 0
  const actions = []

  log(`started | graphId=${graphId || 'none'} nodeId=${nodeId || 'none'} task="${task.slice(0, 100)}"`)
  progress('Entering the graph...')

  while (turn < maxTurns) {
    turn++
    log(`turn ${turn}/${maxTurns}`)
    progress(thinkingMessages[turn - 1] || `Still weaving... (${turn})`)

    const response = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userId || 'kg-subagent',
        messages,
        model,
        max_tokens: 8192,
        temperature: 0.2,
        system: KG_SUBAGENT_SYSTEM_PROMPT,
        tools,
      }),
    })

    const data = await response.json()
    if (!response.ok) {
      log(`ERROR: ${JSON.stringify(data.error)}`)
      return { success: false, error: data.error || 'Anthropic API error', turns: turn, actions }
    }

    // End turn — verify graph has nodes before declaring success
    if (data.stop_reason === 'end_turn') {
      const text = (data.content || []).filter(c => c.type === 'text').map(b => b.text).join('\n')
      const resolvedGraphId = graphId || actions.find(a => a.graphId)?.graphId
      log(`end_turn — summary: ${text.slice(0, 200)}`)
      const verification = await verifyGraphHasNodes(resolvedGraphId, env, log)
      return {
        success: verification.valid,
        summary: verification.valid ? text : `Graph ${resolvedGraphId} was created but has 0 nodes. Task incomplete.`,
        turns: turn,
        actions,
        model,
        graphId: resolvedGraphId,
        nodeId: nodeId || actions.find(a => a.nodeId)?.nodeId,
        ...(verification.valid ? {} : { error: 'Graph created with 0 nodes' }),
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

        // Code-level enforcement: auto-inject graphId into all graph-mutation tools
        // This prevents the LLM from hallucinating IDs or creating duplicate graphs
        const GRAPH_MUTATION_TOOLS = new Set(['create_node', 'patch_node', 'add_edge', 'patch_graph_metadata', 'read_graph', 'read_graph_content', 'read_node'])
        if (graphId && GRAPH_MUTATION_TOOLS.has(toolUse.name) && !toolUse.input.graphId) {
          toolUse.input.graphId = graphId
          log(`auto-injected graphId=${graphId} into ${toolUse.name}`)
        }
        // If graphId is provided and LLM tries to create a NEW graph, block it
        if (graphId && toolUse.name === 'create_graph') {
          log(`BLOCKED create_graph — graphId=${graphId} already provided. Skipping.`)
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({ error: `Graph ${graphId} already exists and is your target. Use create_node to add content to it. Do NOT create a new graph.` }),
          })
          continue
        }

        try {
          const result = await executeTool(toolUse.name, { ...toolUse.input, userId }, env, {})

          const resultStr = JSON.stringify(result)
          // Track graphId from create_graph so subsequent tools auto-inject it
          if (toolUse.name === 'create_graph' && !graphId) {
            const createdId = toolUse.input.graphId || result.graphId
            if (createdId) {
              graphId = createdId
              log(`tracked graphId=${graphId} from create_graph — will auto-inject into future tools`)
            }
          }
          actions.push({
            tool: toolUse.name,
            success: true,
            graphId: toolUse.input.graphId || result.graphId,
            nodeId: toolUse.input.nodeId || result.nodeId,
            summary: result.message || `${toolUse.name} ok`,
          })

          // Truncate large results to keep subagent context manageable
          const truncated = resultStr.length > 12000
            ? resultStr.slice(0, 12000) + '... [truncated]'
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
  const resolvedGraphId = graphId || actions.find(a => a.graphId)?.graphId
  const verification = await verifyGraphHasNodes(resolvedGraphId, env, log)
  return {
    success: verification.valid,
    summary: verification.valid
      ? `KG subagent completed ${actions.length} actions in ${turn} turns (max turns reached).`
      : `Graph ${resolvedGraphId} was created but has 0 nodes after ${turn} turns. Task incomplete.`,
    turns: turn,
    actions,
    model,
    graphId: resolvedGraphId,
    nodeId: nodeId || actions.find(a => a.nodeId)?.nodeId,
    maxTurnsReached: true,
    ...(verification.valid ? {} : { error: 'Graph created with 0 nodes' }),
  }
}

/**
 * Verify a graph exists and has at least 1 node.
 * If no graphId (read-only or no-graph task), treat as valid.
 */
async function verifyGraphHasNodes(graphId, env, log) {
  if (!graphId) return { valid: true }
  try {
    const res = await env.KG_WORKER.fetch(`https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(graphId)}`)
    if (!res.ok) return { valid: true } // can't verify — don't block
    const data = await res.json()
    const nodeCount = (data.nodes || []).length
    log(`verify graph ${graphId}: ${nodeCount} nodes`)
    if (nodeCount === 0) return { valid: false, nodeCount: 0 }
    return { valid: true, nodeCount }
  } catch (err) {
    log(`verify graph failed (non-fatal): ${err.message}`)
    return { valid: true } // network error — don't block
  }
}

export { runKgSubagent }
