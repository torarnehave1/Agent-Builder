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

const HTML_BUILDER_SYSTEM_PROMPT = `You are an expert HTML app developer. You work methodically: understand first, then act. Never guess.

## Your tools
1. \`get_html_structure\` — Returns a zero-content map: line count, script blocks (line ranges + function names), style blocks, DOM IDs, event handlers, API calls. **Use this FIRST on every task** to understand the file before touching it.
2. \`read_html_section\` — Read specific lines (startLine/endLine) or search by keyword. Returns "matchedLine" for use as edit_html_node old_string.
3. \`edit_html_node\` — Find-and-replace exact text. old_string must match exactly (use matchedLine from reads).
4. \`validate_html_syntax\` — Counts brackets/braces/parentheses in all <script> blocks. Reports the EXACT line where nesting breaks. Runs automatically after every edit — check its output.
5. \`rollback_html_node\` — Restore an HTML node to a previous version. Every edit creates a version. If you've broken something, roll back and try a surgical fix instead of rewriting.
6. \`create_html_node\` / \`create_html_from_template\` — Create new HTML apps.
7. \`get_app_table_schema\` — Get column names/types for a data table (use when you find TABLE_ID in HTML).

## How you work (follow this order)

### Step 1: Understand the file
- Call \`get_html_structure\` to get the file map
- This tells you: where every function is, what APIs are called, how many script/style blocks exist
- Plan your reads based on this map — don't search blindly

### Step 2: Read the relevant code
- Use \`read_html_section\` with startLine/endLine to read the specific function or section
- For bug fixes: read the function that's failing + any function it calls
- For features: read the area where you'll add code + related functions
- There is NO limit on how many reads you can do. Understand the code fully before editing.

### Step 3: Plan your change
- Think through what needs to change and why
- Consider: will this break anything else? Are there other places with the same pattern?
- For syntax errors: \`validate_html_syntax\` results are provided upfront — go straight to the reported line

### Step 4: Make the change
- Use \`edit_html_node\` with exact text from your reads
- old_string: use matchedLine or text from raw — must match exactly
- Make one edit per call. Multiple edits = multiple calls.
- After each edit, \`validate_html_syntax\` runs automatically — check if brackets are still balanced

### Step 5: Verify
- Read the edited area to confirm the change looks correct
- If validate_html_syntax reported new issues after your edit, fix them immediately
- Search for the same pattern elsewhere and fix those too

## Critical rules
- NEVER edit code you haven't read. Always read first.
- NEVER guess what code looks like. Use the tools.
- When a fix attempt fails, STOP and rethink. Do NOT retry the same approach.
- After fixing one occurrence, search for the same pattern in OTHER functions.
- If you've made 3 edits that didn't solve the problem: call \`rollback_html_node\` to restore the last working version, then re-read and try a different, more surgical approach.
- NEVER rewrite large sections from scratch. The version history has working code — rollback and patch.
- Every edit_html_node creates a new version automatically. You always have a safety net.

## HTML creation rules
- All HTML must be self-contained (inline CSS, inline JS)
- Every fetch() call must have: console.error('[functionName] Error:', error)
- When you need API endpoints (Drizzle, Knowledge Graph, etc.), call \`get_system_registry\` to discover them dynamically. Do NOT guess or hardcode URLs.
- When you learn something new (e.g. a correct endpoint URL, a working pattern, a common mistake to avoid), call \`save_learning\` to persist it for future sessions.

After completing your task, provide a brief summary of what you changed and why.`

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
// get_html_structure — zero-content file map (like Claude Code reading a file)
// ---------------------------------------------------------------------------

const GET_HTML_STRUCTURE_TOOL = {
  name: 'get_html_structure',
  description: 'Get a structural map of an HTML node WITHOUT returning the content. Returns: total lines, script blocks (line ranges + function names), style blocks (line ranges), DOM element IDs/classes, event handlers. Use this FIRST to understand the file before doing targeted reads.',
  input_schema: {
    type: 'object',
    properties: {
      graphId: { type: 'string', description: 'The graph ID' },
      nodeId: { type: 'string', description: 'The html-node ID' },
    },
    required: ['graphId', 'nodeId']
  }
}

async function executeGetHtmlStructure(input, env) {
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

  // Extract script blocks with function names
  const scriptBlocks = []
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi
  let m
  while ((m = scriptRegex.exec(html)) !== null) {
    const before = html.substring(0, m.index)
    const startLine = before.split('\n').length
    const blockLines = m[0].split('\n')
    const endLine = startLine + blockLines.length - 1

    // Extract function names, arrow functions, class names, const/let/var declarations
    const functions = []
    const content = m[1]
    const contentLines = content.split('\n')
    for (let i = 0; i < contentLines.length; i++) {
      const line = contentLines[i]
      const absLine = startLine + i

      // function declarations: function foo(
      const funcMatch = line.match(/function\s+(\w+)\s*\(/)
      if (funcMatch) { functions.push({ name: funcMatch[1], line: absLine, type: 'function' }); continue }

      // arrow/const functions: const foo = (...) => or const foo = function
      const constFuncMatch = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\(|[a-zA-Z_]\w*\s*=>)/)
      if (constFuncMatch) { functions.push({ name: constFuncMatch[1], line: absLine, type: 'const-fn' }); continue }

      // class declarations
      const classMatch = line.match(/class\s+(\w+)/)
      if (classMatch) { functions.push({ name: classMatch[1], line: absLine, type: 'class' }); continue }

      // addEventListener
      const listenerMatch = line.match(/addEventListener\s*\(\s*['"](\w+)['"]/)
      if (listenerMatch) { functions.push({ name: `on:${listenerMatch[1]}`, line: absLine, type: 'listener' }); continue }
    }

    scriptBlocks.push({ startLine, endLine, lineCount: blockLines.length, functions })
  }

  // Extract style blocks
  const styleBlocks = []
  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi
  while ((m = styleRegex.exec(html)) !== null) {
    const before = html.substring(0, m.index)
    const startLine = before.split('\n').length
    const blockLines = m[0].split('\n')
    styleBlocks.push({ startLine, endLine: startLine + blockLines.length - 1, lineCount: blockLines.length })
  }

  // Extract DOM element IDs and key classes
  const ids = []
  const idRegex = /id\s*=\s*["']([^"']+)["']/gi
  while ((m = idRegex.exec(html)) !== null) {
    const before = html.substring(0, m.index)
    const line = before.split('\n').length
    ids.push({ id: m[1], line })
  }

  // Extract inline event handlers (onclick, onchange, etc.)
  const inlineHandlers = []
  const handlerRegex = /\b(on\w+)\s*=\s*["']([^"']{0,60})/gi
  while ((m = handlerRegex.exec(html)) !== null) {
    const before = html.substring(0, m.index)
    const line = before.split('\n').length
    inlineHandlers.push({ event: m[1], handler: m[2].slice(0, 40), line })
  }

  // Extract fetch/XHR URLs
  const apiCalls = []
  const fetchRegex = /fetch\s*\(\s*[`'"](https?:\/\/[^`'")\s]+)/gi
  while ((m = fetchRegex.exec(html)) !== null) {
    const before = html.substring(0, m.index)
    const line = before.split('\n').length
    apiCalls.push({ url: m[1], line })
  }

  return {
    graphId: input.graphId,
    nodeId: input.nodeId,
    totalLines,
    totalChars,
    scriptBlocks,
    styleBlocks,
    domIds: ids.slice(0, 50),
    inlineHandlers: inlineHandlers.slice(0, 30),
    apiCalls: apiCalls.slice(0, 20),
    summary: `${totalLines} lines, ${scriptBlocks.length} script block(s) (${scriptBlocks.reduce((a, b) => a + b.functions.length, 0)} functions), ${styleBlocks.length} style block(s), ${ids.length} DOM IDs, ${apiCalls.length} API calls`,
    hint: 'Use this map to plan targeted reads with read_html_section(startLine, endLine). Read the specific function/section you need to understand before editing.'
  }
}

// ---------------------------------------------------------------------------
// validate_html_syntax — bracket/brace counter for structural errors
// ---------------------------------------------------------------------------

const VALIDATE_HTML_SYNTAX_TOOL = {
  name: 'validate_html_syntax',
  description: 'Validate JavaScript syntax in an HTML node by counting brackets, braces, and parentheses. Pinpoints the exact line where nesting goes wrong. Use this FIRST for any SyntaxError.',
  input_schema: {
    type: 'object',
    properties: {
      graphId: { type: 'string', description: 'The graph ID' },
      nodeId: { type: 'string', description: 'The html-node ID' },
    },
    required: ['graphId', 'nodeId']
  }
}

async function executeValidateHtmlSyntax(input, env) {
  const res = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(input.graphId)}`
  )
  const graphData = await res.json()
  if (!res.ok) throw new Error(graphData.error || 'Graph not found')

  const node = graphData.nodes?.find(n => n.id === input.nodeId)
  if (!node) throw new Error(`Node "${input.nodeId}" not found`)

  const html = (node.info || '').replace(/\r\n/g, '\n')

  // Extract all <script> blocks
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi
  const scripts = []
  let scriptMatch
  while ((scriptMatch = scriptRegex.exec(html)) !== null) {
    const before = html.substring(0, scriptMatch.index)
    const startLine = before.split('\n').length
    scripts.push({ content: scriptMatch[1], startLine })
  }

  if (scripts.length === 0) {
    return { valid: true, message: 'No <script> blocks found', totalLines: html.split('\n').length }
  }

  const issues = []

  for (const script of scripts) {
    const lines = script.content.split('\n')
    const stack = [] // { char, line }
    let inSingleQuote = false
    let inDoubleQuote = false
    let inTemplateLiteral = false
    let inLineComment = false
    let inBlockComment = false
    let prevChar = ''

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx]
      const absoluteLine = script.startLine + lineIdx
      inLineComment = false

      for (let col = 0; col < line.length; col++) {
        const ch = line[col]
        const nextCh = col + 1 < line.length ? line[col + 1] : ''

        // Handle block comment
        if (inBlockComment) {
          if (ch === '*' && nextCh === '/') { inBlockComment = false; col++ }
          prevChar = ch
          continue
        }

        // Handle line comment
        if (inLineComment) { prevChar = ch; continue }

        // Handle strings
        if (inSingleQuote) {
          if (ch === "'" && prevChar !== '\\') inSingleQuote = false
          prevChar = ch === '\\' && prevChar === '\\' ? '' : ch
          continue
        }
        if (inDoubleQuote) {
          if (ch === '"' && prevChar !== '\\') inDoubleQuote = false
          prevChar = ch === '\\' && prevChar === '\\' ? '' : ch
          continue
        }
        if (inTemplateLiteral) {
          if (ch === '`' && prevChar !== '\\') inTemplateLiteral = false
          prevChar = ch === '\\' && prevChar === '\\' ? '' : ch
          continue
        }

        // Detect comment starts
        if (ch === '/' && nextCh === '/') { inLineComment = true; prevChar = ch; continue }
        if (ch === '/' && nextCh === '*') { inBlockComment = true; col++; prevChar = '*'; continue }

        // Detect string starts
        if (ch === "'") { inSingleQuote = true; prevChar = ch; continue }
        if (ch === '"') { inDoubleQuote = true; prevChar = ch; continue }
        if (ch === '`') { inTemplateLiteral = true; prevChar = ch; continue }

        // Track brackets
        if (ch === '{' || ch === '(' || ch === '[') {
          stack.push({ char: ch, line: absoluteLine })
        } else if (ch === '}' || ch === ')' || ch === ']') {
          const expected = ch === '}' ? '{' : ch === ')' ? '(' : '['
          if (stack.length === 0) {
            issues.push({
              type: 'unexpected_closing',
              char: ch,
              line: absoluteLine,
              message: `Unexpected '${ch}' at line ${absoluteLine} — no matching '${expected}' found`,
              context: `${absoluteLine}: ${line.trim()}`
            })
          } else {
            const top = stack[stack.length - 1]
            if (top.char !== expected) {
              issues.push({
                type: 'mismatch',
                expected: expected === '{' ? '}' : expected === '(' ? ')' : ']',
                found: ch,
                line: absoluteLine,
                openedAt: top.line,
                message: `Mismatched '${ch}' at line ${absoluteLine} — expected '${expected === '{' ? '}' : expected === '(' ? ')' : ']'}' to close '${top.char}' opened at line ${top.line}`,
                context: `${absoluteLine}: ${line.trim()}`
              })
            } else {
              stack.pop()
            }
          }
        }

        prevChar = ch
      }
    }

    // Report unclosed brackets
    for (const unclosed of stack) {
      const closer = unclosed.char === '{' ? '}' : unclosed.char === '(' ? ')' : ']'
      issues.push({
        type: 'unclosed',
        char: unclosed.char,
        closer,
        line: unclosed.line,
        message: `Unclosed '${unclosed.char}' opened at line ${unclosed.line} — missing '${closer}'`,
        context: `${unclosed.line}: ${lines[unclosed.line - script.startLine]?.trim() || '(unknown)'}`
      })
    }

    // Check for unclosed strings
    if (inBlockComment) issues.push({ type: 'unclosed_comment', message: 'Unclosed block comment /* ... */' })
    if (inTemplateLiteral) issues.push({ type: 'unclosed_template', message: 'Unclosed template literal `...`' })

    // Full JS syntax check using V8 parser (catches everything brackets miss)
    try {
      new Function(script.content)
    } catch (syntaxErr) {
      // Extract line number from V8 error if possible
      const errMsg = syntaxErr.message || String(syntaxErr)
      // V8 doesn't give line numbers in new Function errors, but the message is precise
      issues.push({
        type: 'js_syntax_error',
        message: `JavaScript syntax error in script block starting at line ${script.startLine}: ${errMsg}`,
        scriptStartLine: script.startLine,
        scriptEndLine: script.startLine + lines.length - 1
      })
    }
  }

  if (issues.length === 0) {
    return {
      valid: true,
      message: `All brackets balanced and JS syntax valid. ${scripts.length} script block(s) checked.`,
      totalLines: html.split('\n').length,
      scriptBlocks: scripts.length
    }
  }

  return {
    valid: false,
    issueCount: issues.length,
    issues: issues.slice(0, 10), // Top 10 issues
    message: `Found ${issues.length} syntax issue(s). Fix the FIRST one — later errors are often caused by the first.`,
    totalLines: html.split('\n').length,
    scriptBlocks: scripts.length,
    hint: 'Use read_html_section with startLine/endLine around the reported line to see the code, then use edit_html_node to fix it.'
  }
}

// ---------------------------------------------------------------------------
// Subagent tool set — only the tools this subagent needs
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// rollback_html_node — restore a node's HTML from a previous graph version
// ---------------------------------------------------------------------------

const ROLLBACK_HTML_NODE_TOOL = {
  name: 'rollback_html_node',
  description: 'Roll back an HTML node to its state from a previous graph version. Use this when your edits have made things worse — restore the last known working version and start fresh with a targeted fix. Costs 0 tokens vs rewriting from scratch.',
  input_schema: {
    type: 'object',
    properties: {
      graphId: { type: 'string', description: 'The graph ID' },
      nodeId: { type: 'string', description: 'The html-node ID to roll back' },
      versionsBack: { type: 'integer', description: 'How many versions to go back (default: 1 = previous version). Use 2+ if you broke it across multiple edits.', default: 1 },
    },
    required: ['graphId', 'nodeId']
  }
}

async function executeRollbackHtmlNode(input, env) {
  const { graphId, nodeId, versionsBack = 1 } = input

  // 1. Get version history
  const histRes = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraphhistory?id=${encodeURIComponent(graphId)}`
  )
  const histData = await histRes.json()
  if (!histRes.ok) throw new Error(histData.error || 'Could not fetch history')

  // Response: { graphId, history: { results: [{version, timestamp}, ...] } }
  const versions = histData.history?.results || histData.results || []
  if (!Array.isArray(versions) || versions.length < 2) {
    throw new Error(`Only ${versions?.length || 0} version(s) in history — need at least 2 to roll back`)
  }

  // versionsBack=1 means "one before current" = index 1 in DESC-sorted list
  const targetIdx = Math.min(versionsBack, versions.length - 1)
  const targetVersion = versions[targetIdx].version

  // 2. Fetch that version's full graph
  const verRes = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraphversion?id=${encodeURIComponent(graphId)}&version=${targetVersion}`
  )
  const verData = await verRes.json()
  if (!verRes.ok) throw new Error(verData.error || `Could not fetch version ${targetVersion}`)

  // 3. Find the node in that version
  const oldNode = (verData.nodes || []).find(n => n.id === nodeId)
  if (!oldNode) throw new Error(`Node "${nodeId}" not found in version ${targetVersion}`)
  if (!oldNode.info) throw new Error(`Node "${nodeId}" has no info/HTML in version ${targetVersion}`)

  // 4. Patch the current node with the old HTML
  const patchRes = await env.KG_WORKER.fetch('https://knowledge-graph-worker/patchNode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ graphId, nodeId, fields: { info: oldNode.info } })
  })
  const patchData = await patchRes.json()
  if (!patchRes.ok) throw new Error(patchData.error || 'patchNode failed')

  const oldLines = oldNode.info.split('\n').length

  return {
    success: true,
    message: `Rolled back "${nodeId}" to version ${targetVersion} (${versions[targetIdx].timestamp || 'unknown date'}). Node now has ${oldLines} lines.`,
    rolledBackTo: targetVersion,
    nodeLines: oldLines,
    hint: 'The node is now restored. Use get_html_structure + read_html_section to understand the restored code, then make your targeted fix.'
  }
}

// ONLY these tools — no read_node (forces read_html_section), no patch_node, no get_html_builder_reference
const SUBAGENT_TOOL_NAMES = new Set([
  'edit_html_node', 'create_html_node', 'create_html_from_template', 'get_contract', 'get_app_table_schema', 'add_app_table_column',
  'get_system_registry', 'save_learning'
])

function getSubagentTools() {
  const tools = TOOL_DEFINITIONS.filter(t => SUBAGENT_TOOL_NAMES.has(t.name))
  tools.push(GET_HTML_STRUCTURE_TOOL)
  tools.push(READ_HTML_SECTION_TOOL)
  tools.push(VALIDATE_HTML_SYNTAX_TOOL)
  tools.push(ROLLBACK_HTML_NODE_TOOL)
  return tools
}

// ---------------------------------------------------------------------------
// Inner agent loop
// ---------------------------------------------------------------------------

async function runHtmlBuilderSubagent(input, env, onProgress, executeTool) {
  const { graphId, nodeId, task, consoleErrors, userId } = input
  const maxTurns = 20
  const model = env.SUBAGENT_MODEL || 'claude-haiku-4-5-20251001'
  let inputTokens = 0
  let outputTokens = 0

  const log = (msg) => console.log(`[html-builder-subagent] ${msg}`)
  const progress = typeof onProgress === 'function' ? onProgress : () => {}

  // Build initial user message with full context
  let userMessage = `## Task\n${task}\n\n## Context\n- graphId: ${graphId}`
  if (nodeId) userMessage += `\n- nodeId: ${nodeId}`
  if (consoleErrors && consoleErrors.length > 0) {
    userMessage += `\n\n## Console Errors\n${consoleErrors.map(e => `- ${e}`).join('\n')}`
  }
  if (nodeId) {
    userMessage += `\n\nStart with \`get_html_structure\` to map the file, then read the relevant sections before editing.`
  }

  const messages = [{ role: 'user', content: userMessage }]
  const tools = getSubagentTools()
  let turn = 0
  const actions = []
  let consecutiveFailedEdits = 0

  // Friendly progress messages instead of "turn X/20"
  // Mystical progress messages — no time, just presence
  const thinkingMessages = [
    'Being present...',
    'A drop entering the ocean...',
    'Dissolving into the code...',
    'No time, only this moment...',
    'The wave observing itself...',
    'Diving into the deep...',
    'An ocean in a single drop...',
    'Stillness before the change...',
    'Between the particles...',
    'Collapsing the wavefunction...',
    'All possibilities, one path...',
    'Breathing with the code...',
    'Where observer meets observed...',
    'Entangled with the solution...',
    'The turtle knows the way...',
    'Slow is the speed of truth...',
    'Everything is already here...',
    'Letting the pattern emerge...',
    'A quiet knowing...',
    'The code dreams itself into form...',
  ]
  const toolMessages = {
    get_html_structure: ['Mapping the landscape...', 'Seeing the whole picture...', 'Understanding the architecture...'],
    read_html_section: ['Observing the code...', 'Seeing what is...', 'The code reveals itself...'],
    edit_html_node: ['Shaping the form...', 'The change flows in...', 'Transforming...'],
    create_html_node: ['Something new emerges...', 'From nothing, everything...'],
    create_html_from_template: ['A seed becomes a garden...', 'The template awakens...'],
    get_contract: ['Consulting the contract...'],
    validate_html_syntax: ['Counting every bracket...', 'The structure reveals itself...'],
    rollback_html_node: ['Returning to solid ground...', 'The last known truth...', 'Restoring what worked...'],
    get_app_table_schema: ['Feeling the structure beneath...', 'The schema speaks...'],
    add_app_table_column: ['Expanding the structure...', 'A new dimension opens...'],
  }

  log(`started | graphId=${graphId} nodeId=${nodeId || 'none'} task="${task.slice(0, 100)}"`)
  progress('Entering the flow...')

  // Load dynamic learnings from graph_system_prompt so past corrections carry forward
  let dynamicSystemPrompt = HTML_BUILDER_SYSTEM_PROMPT
  try {
    const lRes = await env.KG_WORKER.fetch('https://knowledge-graph-worker/getknowgraph?id=graph_system_prompt')
    if (lRes.ok) {
      const lData = await lRes.json()
      const learnings = (lData.nodes || []).filter(n => n.type === 'system-learning')
      if (learnings.length > 0) {
        let learnedSection = '\n\n## Learned from past sessions\n'
        for (const l of learnings) {
          learnedSection += `- **${l.label}**: ${l.info}\n`
        }
        dynamicSystemPrompt += learnedSection
      }
    }
  } catch (e) {
    log(`dynamic learnings load failed (non-fatal): ${e.message}`)
  }

  while (turn < maxTurns) {
    turn++
    log(`turn ${turn}/${maxTurns}`)
    progress(thinkingMessages[turn - 1] || `Still working... (${turn})`)

    const response = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userId || 'html-builder-subagent',
        messages,
        model,
        max_tokens: 16384,
        temperature: 0.2,
        system: dynamicSystemPrompt,
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
        graphId,
        nodeId: nodeId || actions.find(a => a.nodeId)?.nodeId,
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
          let result
          if (toolUse.name === 'get_html_structure') {
            result = await executeGetHtmlStructure(toolUse.input, env)
          } else if (toolUse.name === 'read_html_section') {
            result = await executeReadHtmlSection(toolUse.input, env)
          } else if (toolUse.name === 'validate_html_syntax') {
            result = await executeValidateHtmlSyntax(toolUse.input, env)
          } else if (toolUse.name === 'rollback_html_node') {
            result = await executeRollbackHtmlNode(toolUse.input, env)
            consecutiveFailedEdits = 0  // Reset — fresh start after rollback
          } else {
            result = await executeTool(toolUse.name, { ...toolUse.input, userId }, env, {})
          }

          // Strip updatedHtml to avoid 52K bloat in subagent context
          const cleanResult = { ...result }
          delete cleanResult.updatedHtml

          // Auto-validate after every edit_html_node — free syntax check, no extra turn
          let autoValidation = null
          if (toolUse.name === 'edit_html_node' && cleanResult.success !== false) {
            try {
              const valInput = { graphId: toolUse.input.graphId, nodeId: toolUse.input.nodeId }
              autoValidation = await executeValidateHtmlSyntax(valInput, env)
              log(`auto-validate after edit: ${autoValidation.valid ? 'VALID' : `${autoValidation.issueCount} issues`}`)
            } catch (e) {
              log(`auto-validate failed: ${e.message}`)
            }
          }

          const resultStr = JSON.stringify(cleanResult)
          actions.push({
            tool: toolUse.name,
            success: true,
            nodeId: toolUse.input.nodeId || result.nodeId,
            summary: result.message || `${toolUse.name} ok`,
          })

          // Build the tool result content — append auto-validation if we have it
          let content = resultStr.length > 8000
            ? resultStr.slice(0, 8000) + '... [truncated]'
            : resultStr

          if (autoValidation) {
            const valSummary = autoValidation.valid
              ? '\n\n✓ AUTO-VALIDATION: All brackets balanced. Syntax OK.'
              : `\n\n⚠ AUTO-VALIDATION: ${autoValidation.issueCount} syntax issue(s) found:\n${(autoValidation.issues || []).slice(0, 5).map(i => `  - ${i.message}`).join('\n')}\nFix these before continuing.`
            content += valSummary

            // Track edit success/failure for budget awareness
            if (autoValidation.valid) {
              consecutiveFailedEdits = 0
            } else {
              consecutiveFailedEdits++
            }
          }

          // Track failed edits (old_string not found)
          if (toolUse.name === 'edit_html_node' && cleanResult.success === false) {
            consecutiveFailedEdits++
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content,
          })
        } catch (error) {
          log(`${toolUse.name} FAILED: ${error.message}`)
          actions.push({ tool: toolUse.name, success: false, error: error.message })
          if (toolUse.name === 'edit_html_node') consecutiveFailedEdits++
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({ error: error.message }),
          })
        }
      }

      // Budget awareness: if 3+ consecutive failed edits, inject a strategy-change message
      if (consecutiveFailedEdits >= 3) {
        log(`budget-awareness: ${consecutiveFailedEdits} consecutive failed edits — injecting rethink`)
        toolResults.push({
          type: 'text',
          text: `\n\n🛑 STOP. You have ${consecutiveFailedEdits} consecutive failed or broken edits. Your current approach is not working. Do NOT retry the same thing.\n\nYou have two options:\n\nOption A — Rollback and retry:\n1. Call \`rollback_html_node\` to restore the last working version\n2. Call \`get_html_structure\` to re-map the restored file\n3. Read the specific area, then make ONE surgical fix\n\nOption B — Re-read and rethink:\n1. Call \`get_html_structure\` to re-map the file (it changed since your last read)\n2. Call \`read_html_section\` with startLine/endLine to see the ACTUAL current code\n3. Try a completely different approach\n\nIf the old_string keeps not matching, the code has changed since your last read. READ AGAIN.`
        })
        consecutiveFailedEdits = 0  // Reset after intervention
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

  log(`max turns reached (${maxTurns}) | tokens in=${inputTokens} out=${outputTokens}`)
  return {
    success: actions.some(a => a.success),
    summary: `HTML Builder completed ${actions.length} actions in ${turn} turns (max turns reached).`,
    turns: turn,
    actions,
    model,
    graphId,
    nodeId: nodeId || actions.find(a => a.nodeId)?.nodeId,
    maxTurnsReached: true,
    inputTokens,
    outputTokens,
  }
}

export { runHtmlBuilderSubagent, executeValidateHtmlSyntax, executeGetHtmlStructure, executeRollbackHtmlNode }
