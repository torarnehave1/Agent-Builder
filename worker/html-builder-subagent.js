/**
 * HTML Builder Subagent
 *
 * A focused subagent for creating and editing HTML apps in the knowledge graph.
 * Solves the edit_html_node exact-match problem by providing read_html_section
 * — a tool that returns targeted portions of HTML with line numbers.
 */

import { TOOL_DEFINITIONS } from './tool-definitions.js'

// ---------------------------------------------------------------------------
// System Prompt — focused, ~2K tokens, HTML rules only
// ---------------------------------------------------------------------------

const HTML_BUILDER_SYSTEM_PROMPT = `You are an HTML app specialist. You fix bugs, add features, create new apps, and answer questions about HTML app code. You have these tools:

1. \`read_html_section\` — search for text in the HTML. Returns "matchedLine" for each match.
2. \`edit_html_node\` — find-and-replace exact text. Use "matchedLine" from search as old_string.
3. \`create_html_node\` / \`create_html_from_template\` — create new HTML apps.
4. \`get_app_table_schema\` — get column names, types, and labels for a data table. Use when you find a TABLE_ID in the HTML and need to know the actual data structure.

## Code analysis workflow (for questions about the code):
1. Search for the relevant keywords (table, fetch, function names, variable names, etc.)
2. Read the matched lines to understand the code
3. Answer the question based on what you ACTUALLY found in the code — NEVER guess or make up code that isn't there
4. Quote the actual code you found to support your answer

## Bug fixing workflow (STRICT):
1. Search for the error keyword (1 search)
2. Search for the correct variable/function name (1 search)
3. IMMEDIATELY call edit_html_node to fix the bug. Do NOT do more than 2 searches before your first edit.
4. After fixing, search for the same bug pattern in OTHER functions and fix those too.
5. Do NOT stop until ALL occurrences are fixed.

## Feature addition workflow:
1. Search for the relevant function or UI element (1-2 searches max)
2. Plan your edit — what code to add or change
3. Use edit_html_node to make the change. For adding new code, use an existing line as old_string and include the new code in new_string.
4. Test by searching for your new code to verify it was added correctly.

## Rules:
- NEVER add new variable declarations for bug fixes. Fix references to use existing variables.
- old_string must be a single line copied from matchedLine. Keep it short.
- Make one edit per tool call. Do multiple calls for multiple fixes.
- CRITICAL: Do NOT do more than 2 searches before your first edit_html_node call. Search, then EDIT.
- After fixing one function, search for the same bug pattern in OTHER functions.
- NEVER guess or hallucinate code. Only report what you find via read_html_section.

## HTML creation rules:
- All HTML must be self-contained (inline CSS, inline JS)
- Every fetch() call must have: console.error('[functionName] Error:', error)
- Use Drizzle API at https://drizzle.vegvisr.org for data operations
  - POST /query with { tableId } for reads
  - POST /insert with { tableId, record } for writes
  - There is NO /update, NO /delete endpoint

After completing your task, provide a brief summary of what you found or changed.`

// ---------------------------------------------------------------------------
// read_html_section — the key innovation
// ---------------------------------------------------------------------------

const READ_HTML_SECTION_TOOL = {
  name: 'read_html_section',
  description: 'Search for text in an HTML node. Returns matches with "matchedLine" (use as edit_html_node old_string). ALWAYS search before editing.',
  input_schema: {
    type: 'object',
    properties: {
      graphId: { type: 'string', description: 'The graph ID' },
      nodeId: { type: 'string', description: 'The html-node ID' },
      search: {
        type: 'string',
        description: 'Search string. Returns up to 10 matches with context. Each match has "matchedLine" — use this as edit_html_node old_string.'
      },
      section: {
        type: 'string',
        enum: ['head', 'style', 'body', 'script', 'full'],
        description: 'Optional: read a specific section. Prefer search instead.'
      },
      startLine: { type: 'integer', description: 'Optional: start line (1-based). Use with endLine.' },
      endLine: { type: 'integer', description: 'Optional: end line (inclusive). Max 100 lines.' }
    },
    required: ['graphId', 'nodeId', 'search']
  }
}

async function executeReadHtmlSection(input, env) {
  const res = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(input.graphId)}`
  )
  const graphData = await res.json()
  if (!res.ok) throw new Error(graphData.error || 'Graph not found')

  const node = graphData.nodes?.find(n => n.id === input.nodeId)
  if (!node) throw new Error(`Node "${input.nodeId}" not found`)

  const html = (node.info || '').replace(/\r\n/g, '\n')
  const lines = html.split('\n')
  const totalLines = lines.length
  const totalChars = html.length

  // Line-number mode
  if (input.startLine && input.endLine) {
    const start = Math.max(1, input.startLine) - 1
    const end = Math.min(totalLines, input.endLine)
    const maxRange = 100
    const slice = lines.slice(start, Math.min(start + maxRange, end))
    const numbered = slice.map((line, i) => `${start + i + 1}: ${line}`).join('\n')
    const raw = slice.join('\n')
    return {
      graphId: input.graphId, nodeId: input.nodeId,
      totalLines, totalChars,
      range: `${start + 1}-${Math.min(start + maxRange, end)}`,
      display: numbered,
      raw,
      hint: 'Use text from "raw" field (no line numbers) when building edit_html_node old_string.'
    }
  }

  // Search mode
  if (input.search) {
    const matches = []
    const searchLower = input.search.toLowerCase()
    const seenRanges = new Set()
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(searchLower)) {
        const contextStart = Math.max(0, i - 5)
        const contextEnd = Math.min(totalLines, i + 6)
        const rangeKey = `${contextStart}-${contextEnd}`
        if (seenRanges.has(rangeKey)) continue
        seenRanges.add(rangeKey)
        const display = lines.slice(contextStart, contextEnd)
          .map((line, j) => `${contextStart + j + 1}${j + contextStart === i ? '>' : ':'} ${line}`)
          .join('\n')
        const raw = lines.slice(contextStart, contextEnd).join('\n')
        const matchedLine = lines[i]
        matches.push({ line: i + 1, display, raw, matchedLine })
        if (matches.length >= 10) break
      }
    }
    return {
      graphId: input.graphId, nodeId: input.nodeId,
      totalLines, totalChars,
      searchTerm: input.search,
      matchCount: matches.length,
      matches,
      hint: 'Use text from "raw" or "matchedLine" fields (no line numbers) when building edit_html_node old_string.'
    }
  }

  // Section mode
  const section = input.section || 'full'
  if (section === 'full') {
    const cap = Math.min(totalLines, 200)
    const numbered = lines.slice(0, cap).map((l, i) => `${i + 1}: ${l}`).join('\n')
    const raw = lines.slice(0, cap).join('\n')
    return {
      graphId: input.graphId, nodeId: input.nodeId,
      totalLines, totalChars,
      section: 'full',
      truncated: cap < totalLines,
      display: numbered,
      raw,
      hint: 'Use text from "raw" field (no line numbers) when building edit_html_node old_string.'
    }
  }

  // Extract section by regex
  const sectionRegexes = {
    style: /<style[^>]*>([\s\S]*?)<\/style>/gi,
    script: /<script[^>]*>([\s\S]*?)<\/script>/gi,
    head: /<head[^>]*>([\s\S]*?)<\/head>/i,
    body: /<body[^>]*>([\s\S]*?)<\/body>/i,
  }

  const regex = sectionRegexes[section]
  if (!regex) throw new Error(`Unknown section: ${section}`)

  const sectionMatches = []
  let match
  const MAX_SECTION_LINES = 100
  while ((match = regex.exec(html)) !== null) {
    const beforeMatch = html.substring(0, match.index)
    const startLine = beforeMatch.split('\n').length
    const sectionLines = match[0].split('\n')
    const truncated = sectionLines.length > MAX_SECTION_LINES
    const cappedLines = truncated ? sectionLines.slice(0, MAX_SECTION_LINES) : sectionLines
    const numbered = cappedLines.map((l, i) => `${startLine + i}: ${l}`).join('\n')
    const raw = cappedLines.join('\n')
    sectionMatches.push({
      startLine,
      endLine: startLine + cappedLines.length - 1,
      lineCount: sectionLines.length,
      display: numbered,
      raw,
      truncated,
      truncatedMessage: truncated ? `Section has ${sectionLines.length} lines, showing first ${MAX_SECTION_LINES}. Use search mode to find specific code.` : undefined,
    })
  }

  return {
    graphId: input.graphId, nodeId: input.nodeId,
    totalLines, totalChars,
    section,
    blocks: sectionMatches,
    message: sectionMatches.length === 0
      ? `No <${section}> blocks found`
      : `Found ${sectionMatches.length} <${section}> block(s)`
  }
}

// ---------------------------------------------------------------------------
// Subagent tool set — only the tools this subagent needs
// ---------------------------------------------------------------------------

// ONLY these tools — no read_node (forces read_html_section), no patch_node, no get_html_builder_reference
const SUBAGENT_TOOL_NAMES = new Set([
  'edit_html_node', 'create_html_node', 'create_html_from_template', 'get_contract', 'get_app_table_schema', 'add_app_table_column'
])

function getSubagentTools() {
  const tools = TOOL_DEFINITIONS.filter(t => SUBAGENT_TOOL_NAMES.has(t.name))
  tools.push(READ_HTML_SECTION_TOOL)
  return tools
}

// ---------------------------------------------------------------------------
// Inner agent loop
// ---------------------------------------------------------------------------

async function runHtmlBuilderSubagent(input, env, onProgress, executeTool) {
  const { graphId, nodeId, task, consoleErrors, userId } = input
  const maxTurns = 20
  const model = 'claude-sonnet-4-20250514'

  const log = (msg) => console.log(`[html-builder-subagent] ${msg}`)
  const progress = typeof onProgress === 'function' ? onProgress : () => {}

  // Build initial user message with full context
  let userMessage = `## Task\n${task}\n\n## Context\n- graphId: ${graphId}`
  if (nodeId) userMessage += `\n- nodeId: ${nodeId}`
  if (consoleErrors && consoleErrors.length > 0) {
    userMessage += `\n\n## Console Errors\n${consoleErrors.map(e => `- ${e}`).join('\n')}`
  }
  userMessage += `\n\nRemember: use read_html_section FIRST to read the relevant section before editing.`

  const messages = [{ role: 'user', content: userMessage }]
  const tools = getSubagentTools()
  let turn = 0
  const actions = []

  log(`started | graphId=${graphId} nodeId=${nodeId || 'none'} task="${task.slice(0, 100)}"`)
  progress('HTML Builder started...')

  while (turn < maxTurns) {
    turn++
    log(`turn ${turn}/${maxTurns}`)
    progress(`HTML Builder thinking (turn ${turn}/${maxTurns})...`)

    const response = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userId || 'html-builder-subagent',
        messages,
        model,
        max_tokens: 16384,
        temperature: 0.2,
        system: HTML_BUILDER_SYSTEM_PROMPT,
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
        graphId,
        nodeId: nodeId || actions.find(a => a.nodeId)?.nodeId,
      }
    }

    // Tool use — execute sequentially
    if (data.stop_reason === 'tool_use') {
      const toolUses = (data.content || []).filter(c => c.type === 'tool_use')
      log(`tool_use — ${toolUses.length} tools: [${toolUses.map(t => t.name).join(', ')}]`)

      const toolResults = []
      for (const toolUse of toolUses) {
        progress(`HTML Builder: ${toolUse.name}...`)
        try {
          let result
          if (toolUse.name === 'read_html_section') {
            result = await executeReadHtmlSection(toolUse.input, env)
          } else {
            result = await executeTool(toolUse.name, { ...toolUse.input, userId }, env, {})
          }

          // Strip updatedHtml to avoid 52K bloat in subagent context
          const cleanResult = { ...result }
          delete cleanResult.updatedHtml

          const resultStr = JSON.stringify(cleanResult)
          actions.push({
            tool: toolUse.name,
            success: true,
            nodeId: toolUse.input.nodeId || result.nodeId,
            summary: result.message || `${toolUse.name} ok`,
          })

          // Truncate large results to keep subagent context manageable
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
      // max_tokens or unexpected — continue
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
    summary: `HTML Builder completed ${actions.length} actions in ${turn} turns (max turns reached).`,
    turns: turn,
    actions,
    graphId,
    nodeId: nodeId || actions.find(a => a.nodeId)?.nodeId,
    maxTurnsReached: true,
  }
}

export { runHtmlBuilderSubagent }
