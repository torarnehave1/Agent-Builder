/**
 * NL → automation builder (unified path).
 *
 * Instead of asking Claude to hand-write JSON params (which made it GUESS param names),
 * this PLANS the automation with native tool-use — the SAME mechanism the chat agent uses.
 * Claude "calls" the real tools; the Anthropic API validates each call's arguments against
 * that tool's input_schema, so params come out correct (create_node → label + nodeType, not
 * title + type). We never execute the calls — we record each as an automation step and hand
 * Claude back the step's id so later steps can reference earlier outputs ({{aN.result.field}}).
 *
 * Authoring only. The runner (automation-runner.js) executes the saved automation later.
 */
import { MODELS } from './models.js'
import { resolveRecipient } from './automation-runner.js'
import { TOOL_DEFINITIONS } from './tool-definitions.js'

const DEF_BY_NAME = new Map(TOOL_DEFINITIONS.map((t) => [t.name, t]))
const MAX_TURNS = 12
const MAX_STEPS = 24

// Flow-control steps modeled as tools, so Claude plans them the same way (schema-validated).
const FLOW_TOOLS = [
  {
    name: 'flow_notify',
    description: 'Send a notification to the user (usually email). Use this to "email me / notify me" steps.',
    input_schema: {
      type: 'object',
      properties: {
        channel: { type: 'string', enum: ['email', 'chat', 'webhook'] },
        to: { type: 'string', description: 'Recipient. Use exactly "me" for the user themselves.' },
        subject: { type: 'string' },
        message: { type: 'string', description: 'Body. For markdown from an earlier step use the html filter, e.g. {{a1.result.content | html}}.' },
      },
      required: ['channel', 'message'],
    },
  },
  {
    name: 'flow_delay',
    description: 'Wait before the next step runs.',
    input_schema: {
      type: 'object',
      properties: { amount: { type: 'number' }, unit: { type: 'string', enum: ['seconds', 'minutes', 'hours'] } },
      required: ['amount', 'unit'],
    },
  },
  {
    name: 'flow_loop',
    description: 'Repeat the following steps a number of times.',
    input_schema: {
      type: 'object',
      properties: { times: { type: 'number' }, over: { type: 'string' } },
      required: ['times'],
    },
  },
  {
    name: 'flow_note',
    description: 'A non-executing note documenting the flow.',
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  {
    name: 'set_automation_meta',
    description: 'Set the automation title and description. Call this FIRST, once.',
    input_schema: {
      type: 'object',
      properties: { title: { type: 'string' }, description: { type: 'string' } },
      required: ['title'],
    },
  },
]
const FLOW_MAP = { flow_notify: 'notify', flow_delay: 'delay', flow_loop: 'loop', flow_note: 'note' }

const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

const PLAN_SYSTEM = `You PLAN a reusable automation for the Vegvisr platform by CALLING TOOLS in the exact order the steps should run — one tool call per step. Do NOT write prose; only call tools.

CRITICAL — you are building a TEMPLATE that runs LATER, not doing the work now:
- Do NOT write real/factual content from your own knowledge into any argument. The live data comes from the tool steps AT RUN TIME.
- When a step needs another step's output (e.g. a node's content should be the search findings), set that argument to a reference like {{a1.result.content}} — NEVER type the actual findings yourself.
- Keep the plan MINIMAL: for "summarize findings into a graph", that's usually ONE create_node whose content is "{{a1.result.content}}" — not one node per item. Only add more steps if the user explicitly asks.

- First call set_automation_meta once (a short title + description).
- Then call the real action tools (perplexity_search, create_graph, create_node, ...) to do the work. Their arguments are enforced by each tool's schema — fill them correctly.
- Use flow_notify / flow_delay / flow_loop / flow_note for control steps. For "email me / notify me", call flow_notify with channel:"email" and to:"me".
- You are PLANNING, not executing — you will NOT see real results. To pass an earlier ACTION step's output into a later argument, write a template string {{aN.result.FIELD}}, where aN is the step id I report back after each action call. Common fields: perplexity_search → result.content (markdown) ; create_graph → result.graphId ; create_node → result.nodeId.
- When you put markdown (like a perplexity summary) inside an email body, use the html filter: {{a1.result.content | html}}.
- To link to a graph a step created, the ONLY correct URL is: https://www.vegvisr.org/gnew-viewer?graphId={{aN.result.graphId}}  (never vegvisr.app or other paths).
- Keep it minimal — only the steps the description implies. When the plan is complete, stop calling tools.`

/**
 * @param {{prompt:string, tools:Array<{name:string,description:string}>, userId:string, callerEmail?:string, env:any}} opts
 * @returns {Promise<{title:string, description:string, steps:Array, edges:Array}>}
 */
export async function buildAutomationSpec({ prompt, tools, userId, callerEmail, env }) {
  const allowed = new Set((tools || []).map((t) => t.name))
  // Real action tools (full input_schema) that this automation may use.
  const actionTools = (tools || [])
    .map((t) => DEF_BY_NAME.get(t.name))
    .filter(Boolean)
    .map((d) => ({ name: d.name, description: d.description, input_schema: d.input_schema }))
  const claudeTools = [...FLOW_TOOLS, ...actionTools]

  const messages = [{ role: 'user', content: prompt }]
  const steps = []
  const counters = { action: 0, delay: 0, notify: 0, loop: 0, note: 0 }
  let title = ''
  let description = ''

  for (let turn = 0; turn < MAX_TURNS && steps.length < MAX_STEPS; turn += 1) {
    const res = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        apiKey: env.ANTHROPIC_API_KEY || undefined,
        system: PLAN_SYSTEM,
        messages,
        model: MODELS.SONNET,
        max_tokens: 2000,
        temperature: 0.2,
        tools: claudeTools,
        tool_choice: turn === 0 ? { type: 'any' } : { type: 'auto' },
      }),
    })
    if (!res.ok) throw new Error(`Planning call failed (${res.status}): ${await res.text()}`)
    const data = await res.json()
    const toolUses = (data.content || []).filter((c) => c.type === 'tool_use')
    if (!toolUses.length) break

    messages.push({ role: 'assistant', content: data.content })
    const results = []
    for (const tu of toolUses) {
      const input = tu.input || {}
      if (tu.name === 'set_automation_meta') {
        title = title || String(input.title || '')
        description = description || String(input.description || '')
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: 'ok' })
        continue
      }
      let id
      let stepType
      let config
      if (FLOW_MAP[tu.name]) {
        stepType = FLOW_MAP[tu.name]
        if (stepType === 'notify') {
          id = `n${(counters.notify += 1)}`
          config = {
            label: 'Notify',
            channel: input.channel || 'email',
            to: input.to,
            subject: input.subject,
            message: input.message,
            fromEmail: 'noreply@vegr.ai',
          }
        } else if (stepType === 'delay') {
          id = `d${(counters.delay += 1)}`
          config = { label: 'Delay', amount: Number(input.amount) || 5, unit: input.unit || 'minutes' }
        } else if (stepType === 'loop') {
          id = `l${(counters.loop += 1)}`
          config = { label: 'Loop', times: Number(input.times) || 2, over: input.over || '' }
        } else {
          id = `c${(counters.note += 1)}`
          config = { text: input.text || '' }
        }
      } else if (allowed.has(tu.name)) {
        stepType = 'action'
        id = `a${(counters.action += 1)}`
        config = { label: titleCase(tu.name), toolName: tu.name, params: input }
      } else {
        // Unknown tool — acknowledge and skip (don't create a broken step).
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Unknown tool "${tu.name}" — skipped.` })
        continue
      }
      steps.push({ id, stepType, config })
      const hint = stepType === 'action'
        ? `Recorded as step ${id}. Reference its output later as {{${id}.result.<field>}}.`
        : `Recorded as step ${id}.`
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: hint })
    }
    messages.push({ role: 'user', content: results })
  }

  return assembleSpec(steps, { title, description, prompt, callerEmail })
}

/** Turn recorded steps into a canvas-ready spec (start anchor, positions, linear edges, fixups). */
function assembleSpec(recorded, { title, description, prompt, callerEmail }) {
  // Default a "me"/placeholder notify recipient to the caller's real email.
  for (const s of recorded) {
    if (s.stepType === 'notify' && (s.config.channel || 'email') === 'email' && callerEmail) {
      s.config.to = resolveRecipient(s.config.to, callerEmail)
    }
  }

  // Deterministic graphId rewire: any step after a create_graph whose graphId is a literal
  // must reference that step's output (create_graph assigns its own UUID).
  const cgIndex = recorded.findIndex((s) => s.stepType === 'action' && s.config.toolName === 'create_graph')
  if (cgIndex !== -1) {
    const gref = `{{${recorded[cgIndex].id}.result.graphId}}`
    recorded.forEach((s, i) => {
      const g = s.config?.params?.graphId
      if (i > cgIndex && typeof g === 'string' && !/\{\{[\s\S]*\}\}/.test(g)) {
        s.config.params.graphId = gref
      }
    })
  }

  const start = { id: 's0', stepType: 'start', label: 'Start', config: { label: 'Start' } }
  const ordered = [start, ...recorded].map((s, i) => ({
    ...s,
    label: s.config.label || s.label || titleCase(s.stepType),
    position: { x: 320, y: 80 + i * 150 },
  }))

  // Linear edges through the executable chain (notes are floating docs — not connected).
  const chain = ordered.filter((s) => s.stepType !== 'note')
  const edges = []
  for (let i = 0; i < chain.length - 1; i += 1) {
    edges.push({ source: chain[i].id, target: chain[i + 1].id })
  }

  return {
    title: title || deriveTitle(prompt),
    description: description || '',
    steps: ordered.map(({ id, stepType, label, config, position }) => ({ id, stepType, label, config, position })),
    edges,
  }
}

function deriveTitle(prompt) {
  const words = String(prompt || 'New automation').trim().split(/\s+/).slice(0, 6).join(' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
