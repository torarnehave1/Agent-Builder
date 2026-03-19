/**
 * Contact Management Subagent
 *
 * Handles contact lookup, interaction logging (text + voice transcription),
 * and contact creation. Works with two Drizzle tables:
 *   - Contacts: 8daf6422-f738-4d24-aa52-7c23abf53d1b
 *   - Contact Log: 96ff306a-45ad-4163-a3e3-362610d35106
 */

import { TOOL_DEFINITIONS } from './tool-definitions.js'

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

const CONTACT_SUBAGENT_SYSTEM_PROMPT = `You are a Contact Management specialist for the Vegvisr ContactHub. You manage contacts and their interaction logs.

## Your Tools
1. \`search_contacts\` — search contacts by name, company, email, or phone
2. \`list_contacts\` — list all contacts (optionally filtered by label)
3. \`get_contact_logs\` — get interaction history for a specific contact (requires contactId)
4. \`add_contact_log\` — add a new interaction log entry for a contact
5. \`create_contact\` — create a new contact record

## Workflows

### Logging an interaction:
1. \`search_contacts\` with the contact's name to get their contactId (_id field)
2. \`add_contact_log\` with contactId, contactName, contact_type, notes, and logged_at
3. Confirm the log was saved

### Viewing interaction history:
1. \`search_contacts\` to find the contactId
2. \`get_contact_logs\` with the contactId

### Creating a contact:
1. \`create_contact\` with at minimum a name
2. Confirm the new contact ID

## Contact Log Types
- **Møte** — in-person meeting
- **Telefon** — phone call
- **E-post** — email exchange
- **Melding** — text/chat message
- **Annet** — other

## Rules
- contactId is the \`_id\` field from the contacts table
- Always search for the contact first if you only have a name, never guess an ID
- logged_at should be ISO 8601 (e.g. "2026-03-19T10:30:00.000Z") — default to now if not specified
- When logging voice transcriptions, set contact_type to the appropriate type and put the full transcribed text in notes

After completing your task, provide a brief summary of what you did.`

// ---------------------------------------------------------------------------
// Tool set
// ---------------------------------------------------------------------------

const CONTACT_SUBAGENT_TOOL_NAMES = new Set([
  'search_contacts',
  'list_contacts',
  'get_contact_logs',
  'add_contact_log',
  'create_contact',
])

function getContactSubagentTools() {
  return TOOL_DEFINITIONS.filter(t => CONTACT_SUBAGENT_TOOL_NAMES.has(t.name))
}

// ---------------------------------------------------------------------------
// Inner agent loop
// ---------------------------------------------------------------------------

async function runContactSubagent(input, env, onProgress, executeTool) {
  const { task, contactId, contactName, userId } = input
  const maxTurns = 10
  const model = env.SUBAGENT_MODEL || 'claude-haiku-4-5-20251001'
  let inputTokens = 0
  let outputTokens = 0

  const log = (msg) => console.log(`[contact-subagent] ${msg}`)
  const progress = typeof onProgress === 'function' ? onProgress : () => {}

  const thinkingMessages = [
    'Opening the contact book...',
    'Searching for the contact...',
    'Reading interaction history...',
    'Preparing log entry...',
    'Saving to contact log...',
    'Verifying the record...',
    'Almost done...',
    'Wrapping up...',
    'Finalizing...',
    'Complete.',
  ]

  const toolMessages = {
    search_contacts:  ['Searching contacts...', 'Looking up the contact...'],
    list_contacts:    ['Listing contacts...', 'Opening the contact book...'],
    get_contact_logs: ['Loading interaction history...', 'Reading the log...'],
    add_contact_log:  ['Saving log entry...', 'Recording the interaction...'],
    create_contact:   ['Creating new contact...', 'Adding to the contact book...'],
  }

  // Build initial user message
  let userMessage = `## Task\n${task}`
  if (contactId) userMessage += `\n\n## Context\n- contactId: ${contactId}`
  if (contactName) userMessage += `\n- contactName: ${contactName}`

  const messages = [{ role: 'user', content: userMessage }]
  const tools = getContactSubagentTools()
  let turn = 0
  const actions = []

  log(`started | contactId=${contactId || 'none'} task="${task.slice(0, 100)}"`)
  progress('Opening the contact book...')

  while (turn < maxTurns) {
    turn++
    log(`turn ${turn}/${maxTurns}`)
    progress(thinkingMessages[turn - 1] || `Still working... (${turn})`)

    const response = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userId || 'contact-subagent',
        apiKey: env.ANTHROPIC_API_KEY || undefined,
        messages,
        model,
        max_tokens: 4096,
        temperature: 0.2,
        system: CONTACT_SUBAGENT_SYSTEM_PROMPT,
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

    if (data.stop_reason === 'end_turn') {
      const text = (data.content || []).filter(c => c.type === 'text').map(b => b.text).join('\n')
      log(`end_turn — summary: ${text.slice(0, 200)} | tokens in=${inputTokens} out=${outputTokens}`)
      return {
        success: true,
        summary: text,
        turns: turn,
        actions,
        model,
        contactId: contactId || actions.find(a => a.contactId)?.contactId,
        inputTokens,
        outputTokens,
      }
    }

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
            contactId: toolUse.input.contactId || result.contactId,
            summary: result.message || `${toolUse.name} ok`,
          })

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
    summary: `Contact subagent completed ${actions.length} actions in ${turn} turns (max turns reached).`,
    turns: turn,
    actions,
    model,
    contactId: contactId || actions.find(a => a.contactId)?.contactId,
    inputTokens,
    outputTokens,
    maxTurnsReached: true,
  }
}

export { runContactSubagent }
