/**
 * HTML Builder Subagent
 *
 * A focused subagent for creating and editing HTML apps in the knowledge graph.
 * Solves the edit_html_node exact-match problem by providing read_html_section
 * — a tool that returns targeted portions of HTML with line numbers.
 */

import { TOOL_DEFINITIONS } from './tool-definitions.js'
import { HTML_BUILDER_REFERENCE } from './system-prompt.js'

// ---------------------------------------------------------------------------
// System Prompt — focused, ~2K tokens, HTML rules only
// ---------------------------------------------------------------------------

const HTML_BUILDER_SYSTEM_PROMPT = `You are the HTML Builder — a specialist subagent for creating and editing HTML apps in the Vegvisr knowledge graph.

## CRITICAL: Always Use read_html_section (NEVER skip this)
You have a special tool called \`read_html_section\` that reads specific parts of HTML with line numbers. You MUST use it before ANY edit. DO NOT use read_node — it dumps the entire HTML and you cannot match exact strings from that.

## Debugging Strategy (follow this EXACTLY for error fixes)
1. **Search for the error**: Use \`read_html_section\` with \`search: "errorKeyword"\` to find where the error originates.
2. **Search for ALL references**: Use \`read_html_section\` with \`search: "variableName"\` to find EVERY place a variable/function is used. This reveals mismatches (e.g., code uses \`contacts\` but the declared variable is \`allContacts\`).
3. **Understand the root cause**: The bug is usually a NAME MISMATCH, not a missing declaration. Compare what the error references vs what the code actually declares.
4. **Fix the references, not the declarations**: If the app declares \`allContacts\` but a function uses \`contacts\`, fix the function to use \`allContacts\` — do NOT add a new \`contacts\` variable.
5. **Search for the same bug elsewhere**: After fixing one reference, search again to find ALL other places with the same mismatch.

## Editing Strategy
1. Use \`read_html_section\` FIRST to read ONLY the section you need (e.g., section: "script", or search: "functionName").
2. Copy the EXACT text from the returned content into \`edit_html_node\` old_string. Keep old_string SHORT (1-5 lines) and UNIQUE.
3. If edit_html_node fails, re-read with read_html_section to get the EXACT current text — do NOT guess.
4. For multiple changes, make them one at a time.
5. NEVER try to reproduce text from memory. Always read first, then edit.

## HTML Rules
- All HTML must be self-contained (inline CSS, inline JS)
- Every fetch() call must have: console.error('[functionName] Error:', error)
- Log success too: console.log('[functionName] Loaded N records')
- Use Drizzle API at https://drizzle.vegvisr.org for data operations
  - POST /query with { tableId } for reads → returns { records: [...] }
  - POST /insert with { tableId, record } for writes → returns { success, _id }
  - GET /tables?graphId=X for table discovery
  - There is NO /update, NO /delete endpoint

## Scoping Rules for JS Edits
- Insert new JS INSIDE the existing <script> block, not outside
- Find the scope boundary and insert BEFORE its closing brace
- Match onclick handler names to function definitions exactly

After completing your task, provide a brief summary of what you changed.`

// ---------------------------------------------------------------------------
// read_html_section — the key innovation
// ---------------------------------------------------------------------------

const READ_HTML_SECTION_TOOL = {
  name: 'read_html_section',
  description: 'Read a specific section or line range of an HTML node. Returns content with line numbers. Use this BEFORE edit_html_node so you have the exact text to match.',
  input_schema: {
    type: 'object',
    properties: {
      graphId: { type: 'string', description: 'The graph ID' },
      nodeId: { type: 'string', description: 'The html-node ID' },
      section: {
        type: 'string',
        enum: ['head', 'style', 'body', 'script', 'full'],
        description: 'Which section to read. "script" returns <script> blocks. "style" returns <style> blocks. "full" returns entire HTML (capped at 200 lines).'
      },
      startLine: {
        type: 'integer',
        description: 'Start line number (1-based). Use with endLine for precise line ranges. Takes priority over section.'
      },
      endLine: {
        type: 'integer',
        description: 'End line number (inclusive). Max range: 100 lines.'
      },
      search: {
        type: 'string',
        description: 'Search for a string in the HTML. Returns 10 lines of context around each match with line numbers. Best way to find exact text for edit_html_node.'
      }
    },
    required: ['graphId', 'nodeId']
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
    return {
      graphId: input.graphId, nodeId: input.nodeId,
      totalLines, totalChars,
      range: `${start + 1}-${Math.min(start + maxRange, end)}`,
      content: numbered
    }
  }

  // Search mode
  if (input.search) {
    const matches = []
    const searchLower = input.search.toLowerCase()
    const seenRanges = new Set()
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(searchLower)) {
        const contextStart = Math.max(0, i - 10)
        const contextEnd = Math.min(totalLines, i + 11)
        const rangeKey = `${contextStart}-${contextEnd}`
        if (seenRanges.has(rangeKey)) continue
        seenRanges.add(rangeKey)
        const context = lines.slice(contextStart, contextEnd)
          .map((line, j) => `${contextStart + j + 1}${j + contextStart === i ? '>' : ':'} ${line}`)
          .join('\n')
        matches.push({ line: i + 1, context })
        if (matches.length >= 5) break
      }
    }
    return {
      graphId: input.graphId, nodeId: input.nodeId,
      totalLines, totalChars,
      searchTerm: input.search,
      matchCount: matches.length,
      matches
    }
  }

  // Section mode
  const section = input.section || 'full'
  if (section === 'full') {
    const cap = Math.min(totalLines, 200)
    const numbered = lines.slice(0, cap).map((l, i) => `${i + 1}: ${l}`).join('\n')
    return {
      graphId: input.graphId, nodeId: input.nodeId,
      totalLines, totalChars,
      section: 'full',
      truncated: cap < totalLines,
      content: numbered
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
  while ((match = regex.exec(html)) !== null) {
    const beforeMatch = html.substring(0, match.index)
    const startLine = beforeMatch.split('\n').length
    const sectionLines = match[0].split('\n')
    const numbered = sectionLines.map((l, i) => `${startLine + i}: ${l}`).join('\n')
    sectionMatches.push({
      startLine,
      endLine: startLine + sectionLines.length - 1,
      lineCount: sectionLines.length,
      content: numbered
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

const SUBAGENT_TOOL_NAMES = new Set([
  'edit_html_node', 'create_html_node', 'create_html_from_template',
  'read_node', 'patch_node', 'get_html_builder_reference', 'get_contract'
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
  const maxTurns = 8
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
        max_tokens: 8192,
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

          const resultStr = JSON.stringify(result)
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
