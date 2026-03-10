/**
 * Real end-to-end test of the HTML Builder subagent flow
 *
 * Fetches the actual kontakt-manager HTML from the knowledge graph,
 * calls the Anthropic API with the subagent's exact prompt and tools,
 * and verifies the LLM produces correct tool calls.
 *
 * Run: ANTHROPIC_API_KEY=sk-... node worker/test-subagent-real.js
 */

const GRAPH_ID = 'a1b2c3d4-e5f6-47g8-h9i0-j1k2l3m4n5o6'
const NODE_ID = 'kontakt-manager-app'

// ---- Subagent system prompt (exact copy from html-builder-subagent.js) ----

const HTML_BUILDER_SYSTEM_PROMPT = `You fix bugs in HTML apps and create new HTML apps. You have these tools:

1. \`read_html_section\` — search for text in the HTML. Returns "matchedLine" for each match.
2. \`edit_html_node\` — find-and-replace exact text. Use "matchedLine" from search as old_string.

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
- After fixing one function, search for the same bug pattern in OTHER functions.`

// ---- Tool definitions (same as subagent gets) ----

const READ_HTML_SECTION_TOOL = {
  name: 'read_html_section',
  description: 'Search for a string in an HTML node. Returns matches with "matchedLine" (exact text to use in edit_html_node old_string). ALWAYS search before editing.',
  input_schema: {
    type: 'object',
    properties: {
      graphId: { type: 'string', description: 'The graph ID' },
      nodeId: { type: 'string', description: 'The html-node ID' },
      search: { type: 'string', description: 'REQUIRED. Search string. Returns up to 10 matches with context. Each match has "matchedLine" — use this as edit_html_node old_string.' }
    },
    required: ['graphId', 'nodeId', 'search']
  }
}

const EDIT_HTML_NODE_TOOL = {
  name: 'edit_html_node',
  description: 'Surgically edit an html-node by finding and replacing an exact string.',
  input_schema: {
    type: 'object',
    properties: {
      graphId: { type: 'string' },
      nodeId: { type: 'string' },
      old_string: { type: 'string', description: 'Exact text to find' },
      new_string: { type: 'string', description: 'Replacement text' },
      replace_all: { type: 'boolean', description: 'Replace all occurrences' }
    },
    required: ['graphId', 'nodeId', 'old_string', 'new_string']
  }
}

const TOOLS = [READ_HTML_SECTION_TOOL, EDIT_HTML_NODE_TOOL]

// ---- Local read_html_section implementation ----

function executeReadHtmlSection(input, html) {
  const lines = html.replace(/\r\n/g, '\n').split('\n')
  const totalLines = lines.length
  const totalChars = html.length

  if (input.startLine && input.endLine) {
    const start = Math.max(1, input.startLine) - 1
    const end = Math.min(totalLines, input.endLine)
    const slice = lines.slice(start, Math.min(start + 100, end))
    const numbered = slice.map((line, i) => `${start + i + 1}: ${line}`).join('\n')
    const raw = slice.join('\n')
    return { totalLines, totalChars, range: `${start + 1}-${end}`, display: numbered, raw, hint: 'Use "raw" for old_string.' }
  }

  if (input.search) {
    const matches = []
    const searchLower = input.search.toLowerCase()
    const seenRanges = new Set()
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(searchLower)) {
        const cs = Math.max(0, i - 5)
        const ce = Math.min(totalLines, i + 6)
        const rk = `${cs}-${ce}`
        if (seenRanges.has(rk)) continue
        seenRanges.add(rk)
        const display = lines.slice(cs, ce).map((l, j) => `${cs+j+1}${j+cs===i?'>':':'} ${l}`).join('\n')
        const raw = lines.slice(cs, ce).join('\n')
        matches.push({ line: i + 1, display, raw, matchedLine: lines[i] })
        if (matches.length >= 10) break
      }
    }
    return { totalLines, totalChars, searchTerm: input.search, matchCount: matches.length, matches, hint: 'Use "raw" or "matchedLine" for old_string.' }
  }

  return { error: 'Specify search, section, or line range' }
}

// ---- Local edit_html_node simulation ----

function executeEditHtmlNode(input, html) {
  const old_string = input.old_string
  const new_string = input.new_string

  if (!html.includes(old_string)) {
    return { error: `old_string not found. First 200 chars: ${html.slice(0, 200)}` }
  }

  const count = html.split(old_string).length - 1
  if (count > 1 && !input.replace_all) {
    return { error: `old_string found ${count} times. Use replace_all: true or provide more context.` }
  }

  const newHtml = input.replace_all
    ? html.split(old_string).join(new_string)
    : html.replace(old_string, new_string)

  return {
    success: true,
    replacements: input.replace_all ? count : 1,
    oldLength: html.length,
    newLength: newHtml.length,
    message: `Replaced ${input.replace_all ? count : 1} occurrence(s).`,
    _newHtml: newHtml  // for our tracking
  }
}

// ---- Main test ----

async function main() {
  // Uses the anthropic.vegvisr.org endpoint (same as the deployed worker)

  // 1. Fetch real HTML
  console.log('Fetching real HTML from knowledge graph...')
  const res = await fetch(`https://knowledge.vegvisr.org/getknowgraph?id=${GRAPH_ID}`)
  const graphData = await res.json()
  const node = graphData.nodes.find(n => n.id === NODE_ID)
  if (!node) { console.error('Node not found'); process.exit(1) }

  let html = node.info
  console.log(`Got ${html.length} chars, ${html.split('\n').length} lines\n`)

  // 2. Build the task message (same as subagent receives)
  const userMessage = `## Task
What data table is connected to this contact list? How does the app store and retrieve data?

## Context
- graphId: ${GRAPH_ID}
- nodeId: ${NODE_ID}

Use read_html_section to search the code and answer based on what you actually find.`

  const messages = [{ role: 'user', content: userMessage }]

  // 3. Run the agent loop (max 8 turns, same as subagent)
  const maxTurns = 12
  let turn = 0
  let editCount = 0
  let editSuccess = 0
  let editFail = 0

  while (turn < maxTurns) {
    turn++
    console.log(`\n=== Turn ${turn}/${maxTurns} ===`)

    const response = await fetch('https://anthropic.vegvisr.org/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'html-builder-test',
        model: 'claude-sonnet-4-20250514',
        max_tokens: 16384,
        temperature: 0.2,
        system: HTML_BUILDER_SYSTEM_PROMPT,
        tools: TOOLS,
        messages
      })
    })

    const data = await response.json()
    if (!response.ok) {
      console.error('API Error:', JSON.stringify(data.error))
      break
    }

    if (data.stop_reason === 'end_turn') {
      const text = data.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
      console.log('\n--- Subagent finished ---')
      console.log(text)
      break
    }

    if (data.stop_reason === 'tool_use') {
      const toolUses = data.content.filter(c => c.type === 'tool_use')
      const toolResults = []

      for (const tu of toolUses) {
        console.log(`  Tool: ${tu.name}`)

        if (tu.name === 'read_html_section') {
          console.log(`    search: "${tu.input.search || ''}" section: "${tu.input.section || ''}" lines: ${tu.input.startLine || ''}-${tu.input.endLine || ''}`)
          const result = executeReadHtmlSection(tu.input, html)
          if (result.matches) {
            console.log(`    Found ${result.matchCount} matches`)
            for (const m of result.matches) {
              console.log(`      L${m.line}: ${m.matchedLine.trim().slice(0, 80)}`)
            }
          }
          const cleanResult = { ...result }
          delete cleanResult._newHtml
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(cleanResult) })
        }
        else if (tu.name === 'edit_html_node') {
          editCount++
          const oldStr = tu.input.old_string
          const newStr = tu.input.new_string
          console.log(`    old_string (${oldStr.length} chars): "${oldStr.slice(0, 100)}"`)
          console.log(`    new_string (${newStr.length} chars): "${newStr.slice(0, 100)}"`)
          console.log(`    old_string exists in HTML: ${html.includes(oldStr)}`)

          const result = executeEditHtmlNode(tu.input, html)
          if (result.success) {
            editSuccess++
            html = result._newHtml  // Apply the edit for subsequent turns
            console.log(`    ✓ SUCCESS — replaced ${result.replacements} occurrence(s)`)
          } else {
            editFail++
            console.log(`    ✗ FAILED — ${result.error?.slice(0, 200)}`)
          }
          const cleanResult = { ...result }
          delete cleanResult._newHtml
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(cleanResult) })
        }
      }

      messages.push(
        { role: 'assistant', content: data.content },
        { role: 'user', content: toolResults }
      )
    }
  }

  // 4. Summary
  console.log('\n\n========== RESULTS ==========')
  console.log(`Turns used: ${turn}/${maxTurns}`)
  console.log(`Edit attempts: ${editCount} (${editSuccess} success, ${editFail} failed)`)

  // Check if the bug is fixed
  const buggyLines = []
  const lines = html.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (/(?<![a-zA-Z])contacts(?![a-zA-Z_])/i.test(lines[i]) &&
        !/allContacts|loadContacts|renderContacts|filterContacts|CONTACTS_TABLE|contacts-|contactsList|console\.(log|error|warn).*contacts/i.test(lines[i]) &&
        !lines[i].trim().startsWith('//')) {
      buggyLines.push(`  L${i+1}: ${lines[i].trim().slice(0, 100)}`)
    }
  }

  if (buggyLines.length === 0) {
    console.log('BUG STATUS: ✓ FIXED — no bare "contacts" references remain')
  } else {
    console.log(`BUG STATUS: ✗ NOT FIXED — ${buggyLines.length} bare "contacts" references remain:`)
    buggyLines.forEach(l => console.log(l))
  }
}

main().catch(e => { console.error(e); process.exit(1) })
