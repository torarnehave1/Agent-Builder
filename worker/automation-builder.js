/**
 * NL → automation builder. Turns a plain-language description into an automation spec
 * (steps + edges) using a one-shot Claude call. The frontend renders the spec onto the
 * canvas so the user can refine it before saving/running.
 *
 * Scope: this only AUTHORS the graph — it never runs anything. The runner (automation-runner.js)
 * executes it later, on demand.
 */
import { MODELS } from './models.js'
import { resolveRecipient } from './automation-runner.js'

const STEP_VOCAB = `Step types and their "config" shape:
- start   → config: {}                                   (exactly ONE; the entry point)
- action  → config: { toolName, params }                 (toolName MUST be one of the AVAILABLE TOOLS below; params is a best-effort object of that tool's arguments)
- delay   → config: { amount: number, unit: "seconds"|"minutes"|"hours" }
- loop    → config: { times: number, over?: string }     (repeats its downstream steps)
- notify  → config: { channel: "email"|"chat"|"webhook", message: string, to?: string, subject?: string, fromEmail?: string }  (for channel "email": set "to" to the recipient address ONLY if the description gives a real one. If it means the user themselves ("email me", "notify me"), set "to" to exactly "me" — the platform fills in their real address. NEVER invent an address like me@example.com. Add a short "subject"; leave fromEmail unset to default to noreply@vegr.ai)
- note    → config: { text: string }                     (documentation only, not executed)`

/**
 * @param {{prompt:string, tools:Array<{name:string,description:string}>, userId:string, env:any}} opts
 * @returns {Promise<{title:string, description:string, steps:Array, edges:Array}>}
 */
export async function buildAutomationSpec({ prompt, tools, userId, callerEmail, env }) {
  const toolList = (tools || [])
    .map((t) => `- ${t.name} — ${t.description}`)
    .join('\n')

  const system = `You design AUTOMATIONS as a directed graph of steps for the Vegvisr platform.
Given a user's plain-language description, output an automation as STRICT JSON — no markdown, no prose, no code fences.

${STEP_VOCAB}

DATA PASSING — reference an earlier step's output inside a later step's config with {{stepId.result...}}:
- {{a1.result.<field>}}  → a SPECIFIC field. Common fields: perplexity_search → result.content (answer text, markdown); create_graph → result.graphId; create_node → result.nodeId. NEVER put a whole {{a1.result}} into human-facing text — it's a JSON object and dumps ugly. Always name the field.
- {{a1.summary}}         → step a1's one-line summary
- {{a1.result.content | html}} → same value, converted from markdown to HTML. USE THE "| html" FILTER whenever you insert markdown (like perplexity content) into an email "message".
Use these so steps chain — e.g. a "create_node" after a "perplexity_search" sets params.content to "{{a1.result.content}}".

LINKS — to link to a knowledge graph a step created, the ONLY correct viewer URL is:
  https://www.vegvisr.org/gnew-viewer?graphId={{<the create_graph step id>.result.graphId}}
Never invent other hosts/paths (no vegvisr.app, no /graph/...).

EMAIL BODIES — for a notify email "message", write a short plain-text OR simple-HTML body. Insert dynamic markdown (e.g. the search summary) with the "| html" filter: e.g.
  "Here is the summary:\n\n{{a1.result.content | html}}\n\nView the graph: https://www.vegvisr.org/gnew-viewer?graphId={{a2.result.graphId}}"

RULES:
- Start with exactly one "start" step.
- Order steps by connecting them with edges (source → target) in the intended flow. The flow begins at the start step.
- For "action" steps, choose the single best toolName from AVAILABLE TOOLS. Fill "params" with your best guess of the tool's arguments from the description; use {} if unsure.
- Use short ids: s1 (start), a1/a2 (actions), d1 (delay), l1 (loop), n1 (notify), c1 (note).
- Keep it minimal — only the steps the description actually implies.
- "label" is a short human title for the step.

AVAILABLE TOOLS (use ONLY these toolNames for action steps):
${toolList}

OUTPUT FORMAT (exactly this shape):
{"title":"...","description":"...","steps":[{"id":"s1","stepType":"start","label":"Start","config":{}},{"id":"a1","stepType":"action","label":"...","config":{"toolName":"...","params":{}}}],"edges":[{"source":"s1","target":"a1"}]}`

  const res = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      apiKey: env.ANTHROPIC_API_KEY || undefined,
      system,
      messages: [{ role: 'user', content: prompt }],
      model: MODELS.SONNET,
      max_tokens: 1800,
      temperature: 0.2,
    }),
  })
  if (!res.ok) throw new Error(`Claude call failed (${res.status}): ${await res.text()}`)
  const data = await res.json()
  const text = (data.content || []).find((c) => c.type === 'text')?.text || ''

  const spec = parseSpec(text)
  return normalizeSpec(spec, tools, callerEmail)
}

function parseSpec(text) {
  // Grab the first {...} block (tolerate stray prose / fences the model may add).
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Model did not return JSON')
  try {
    return JSON.parse(match[0])
  } catch (e) {
    throw new Error(`Could not parse automation JSON: ${e.message}`)
  }
}

const VALID_STEP_TYPES = new Set(['start', 'action', 'delay', 'loop', 'notify', 'note'])

/** Validate/repair the model output and assign canvas positions. */
function normalizeSpec(spec, tools, callerEmail = null) {
  const allowed = new Set((tools || []).map((t) => t.name))
  const rawSteps = Array.isArray(spec?.steps) ? spec.steps : []

  const steps = rawSteps
    .filter((s) => s && VALID_STEP_TYPES.has(s.stepType))
    .map((s, i) => {
      const config = s.config && typeof s.config === 'object' ? s.config : {}
      // Drop action toolNames the platform doesn't support.
      if (s.stepType === 'action' && config.toolName && allowed.size && !allowed.has(config.toolName)) {
        config.toolName = ''
      }
      // Default a "me"/empty email recipient to the caller's own address, so the saved value is real.
      if (s.stepType === 'notify' && (config.channel || 'email') === 'email' && callerEmail) {
        config.to = resolveRecipient(config.to, callerEmail)
      }
      return {
        id: String(s.id || `${s.stepType}-${i}`),
        stepType: s.stepType,
        label: String(s.label || s.stepType),
        config,
        position: { x: 320, y: 80 + i * 150 },
      }
    })

  // Ensure exactly one start step at the front.
  if (!steps.some((s) => s.stepType === 'start')) {
    steps.unshift({ id: 's0', stepType: 'start', label: 'Start', config: {}, position: { x: 320, y: 80 } })
  }

  const stepIds = new Set(steps.map((s) => s.id))
  const edges = (Array.isArray(spec?.edges) ? spec.edges : [])
    .filter((e) => e && stepIds.has(e.source) && stepIds.has(e.target))
    .map((e) => ({ source: String(e.source), target: String(e.target) }))

  return {
    title: String(spec?.title || 'New automation'),
    description: String(spec?.description || ''),
    steps,
    edges,
  }
}
