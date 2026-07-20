/**
 * Automation execution engine (Phase 1 — synchronous, run-now).
 *
 * Walks an automation graph (nodes of type 'automation-step', metadata.stepType in
 * start|action|delay|loop|notify|note) starting from the Start node, following edges,
 * and produces a structured step-by-step run log.
 *
 * Scope of this phase:
 *   - action  → executes a real agent tool via executeTool() (unless dryRun).
 *   - loop     → repeats its downstream steps `times` times (bounded by MAX_STEPS).
 *   - delay    → SIMULATED (Workers can't sleep for minutes) — logged, never actually waits.
 *   - notify   → SIMULATED for now (config carries no recipient yet) — logged.
 *   - start/note → no-ops (notes are documentation and usually have no edges).
 *
 * No Durable Object / cron is involved; everything runs in the request.
 */

import { executeTool } from './tool-executors.js'

// Hard cap so a cyclic graph (loop back-edge) can never run away in-request.
const MAX_STEPS = 200

const DEFAULT_NOTIFY_FROM = 'noreply@vegr.ai'

// --- Step-to-step data passing -------------------------------------------------
// Templates in a step's config reference an earlier step's output:
//   {{stepId.result}}          → that step's whole tool result (object)
//   {{stepId.result.<field>}}  → a nested field (e.g. {{a1.result.content}})
//   {{stepId.summary}}         → the step's one-line summary
// Unknown refs resolve to '' (e.g. when testing a step in isolation).

function getByPath(root, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), root)
}

function resolveRef(ref, outputs) {
  const dot = ref.indexOf('.')
  const stepId = dot === -1 ? ref : ref.slice(0, dot)
  const rest = dot === -1 ? '' : ref.slice(dot + 1)
  const entry = outputs[stepId]
  if (entry === undefined) return undefined
  return rest ? getByPath(entry, rest) : entry
}

function applyFilter(value, filter) {
  if (filter === 'html') return markdownToHtml(typeof value === 'string' ? value : String(value ?? ''))
  return value
}

function resolveString(s, outputs) {
  // A whole-string single ref (no filter) returns the RAW value (keeps objects intact).
  const whole = s.match(/^\{\{\s*([\w.]+)\s*\}\}$/)
  if (whole) {
    const v = resolveRef(whole[1], outputs)
    return v === undefined ? '' : v
  }
  // Embedded refs — support an optional filter: {{ref | html}}.
  return s.replace(/\{\{\s*([\w.]+)\s*(?:\|\s*(\w+)\s*)?\}\}/g, (_, ref, filter) => {
    let v = resolveRef(ref, outputs)
    if (v === undefined) return ''
    if (filter) return applyFilter(v, filter)
    return typeof v === 'string' ? v : JSON.stringify(v)
  })
}

// Lightweight markdown → HTML, enough for perplexity output in an email body.
function markdownToHtml(md) {
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = (t) =>
    esc(t)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
  const lines = String(md).replace(/\r\n/g, '\n').split('\n')
  const html = []
  let inList = false
  const closeList = () => { if (inList) { html.push('</ul>'); inList = false } }
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) { closeList(); continue }
    let m
    if ((m = line.match(/^###\s+(.*)/))) { closeList(); html.push(`<h3>${inline(m[1])}</h3>`) }
    else if ((m = line.match(/^##\s+(.*)/))) { closeList(); html.push(`<h2>${inline(m[1])}</h2>`) }
    else if ((m = line.match(/^#\s+(.*)/))) { closeList(); html.push(`<h1>${inline(m[1])}</h1>`) }
    else if ((m = line.match(/^[-*]\s+(.*)/))) { if (!inList) { html.push('<ul>'); inList = true } html.push(`<li>${inline(m[1])}</li>`) }
    else { closeList(); html.push(`<p>${inline(line)}</p>`) }
  }
  closeList()
  return html.join('\n')
}

const hasHtmlTags = (s) => /<(p|div|h[1-6]|ul|ol|li|br|table|html|body|a|strong|em)\b/i.test(s || '')

function resolveTemplates(value, outputs) {
  if (typeof value === 'string') return resolveString(value, outputs)
  if (Array.isArray(value)) return value.map((v) => resolveTemplates(v, outputs))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = resolveTemplates(v, outputs)
    return out
  }
  return value
}

/** Return a copy of the node with its config's {{refs}} resolved against prior outputs. */
function withResolvedConfig(node, outputs) {
  const cfg = node?.metadata?.config || {}
  return { ...node, metadata: { ...node.metadata, config: resolveTemplates(cfg, outputs) } }
}

/**
 * Execute a single step's OWN effect (no graph traversal). Shared by the full-graph
 * runner and the single-step "Test" path. Returns { status, detail, extra? }.
 *   status: 'ok' | 'simulated' | 'skipped' | 'error'
 */
async function executeStepEffect(node, ctx) {
  const type = node?.metadata?.stepType || 'note'
  const cfg = node?.metadata?.config || {}
  switch (type) {
    case 'start':
      return { status: 'ok', detail: 'Automation start' }
    case 'note':
      return { status: 'skipped', detail: 'Note (not executed)' }
    case 'delay':
      // Never actually pauses in this phase.
      return { status: 'simulated', detail: `Would wait ${cfg.amount ?? '?'} ${cfg.unit ?? ''}`.trim() }
    case 'loop': {
      const times = Math.max(1, Number(cfg.times) || 1)
      return { status: ctx.dryRun ? 'simulated' : 'ok', detail: `Loop ${times}×${cfg.over ? ` over ${cfg.over}` : ''}` }
    }
    case 'notify':
      return await runNotify(cfg, ctx)
    case 'action':
      return await runAction(cfg, ctx)
    default:
      return { status: 'skipped', detail: `Unknown step type: ${type}` }
  }
}

async function runAction(cfg, ctx) {
  const toolName = cfg.toolName
  const params = cfg.params || {}
  if (!toolName) return { status: 'error', detail: 'Action has no toolName configured' }
  if (ctx.dryRun) return { status: 'simulated', detail: `Would call ${toolName}`, extra: { toolName, params } }
  try {
    const result = await executeTool(toolName, { ...params, userId: ctx.userId, authContext: ctx.authContext }, ctx.env, ctx.operationMap)
    const ok = !result || result.success !== false
    return {
      status: ok ? 'ok' : 'error',
      detail: result?.message || (ok ? `Ran ${toolName}` : 'Tool reported failure'),
      extra: { toolName, params, result },
    }
  } catch (err) {
    return { status: 'error', detail: `${toolName} threw: ${err.message}`, extra: { toolName, params, error: err.message } }
  }
}

// "me"/empty recipient means "send to whoever runs this automation".
const SELF_REFS = new Set(['me', 'myself', 'self', 'my email', 'the user', 'my inbox', 'user'])
export function resolveRecipient(rawTo, callerEmail) {
  const to = (rawTo || '').trim()
  // Empty, a self-word, or an RFC-2606 placeholder domain → the caller's own address.
  if (!to || SELF_REFS.has(to.toLowerCase()) || /@example\.(com|org|net)$/i.test(to)) {
    return callerEmail || ''
  }
  return to
}

async function runNotify(cfg, ctx) {
  const channel = cfg.channel || 'email'
  const message = cfg.message || ''
  if (ctx.dryRun) return { status: 'simulated', detail: `Would notify via ${channel}: ${message}` }
  if (channel === 'email') {
    const to = resolveRecipient(cfg.to, ctx.callerEmail)
    if (!to) return { status: 'error', detail: 'Notify (email) has no recipient (and no caller email to default to)' }
    const fromEmail = cfg.fromEmail || DEFAULT_NOTIFY_FROM
    const subject = cfg.subject || 'Automation notification'
    // Plain-text / markdown bodies (e.g. a pasted perplexity summary) render as raw text in an
    // HTML email — convert them. Bodies the agent already wrote as HTML are left as-is.
    const html = hasHtmlTags(message) ? message : markdownToHtml(message || subject)
    try {
      const result = await executeTool('send_email', {
        fromEmail, to, subject, html,
        userId: ctx.userId, authContext: ctx.authContext,
      }, ctx.env, ctx.operationMap)
      const ok = !result || result.success !== false
      return { status: ok ? 'ok' : 'error', detail: result?.message || `Emailed ${to}`, extra: { result } }
    } catch (err) {
      return { status: 'error', detail: `Email failed: ${err.message}`, extra: { error: err.message } }
    }
  }
  // chat/webhook not wired yet — simulate.
  return { status: 'simulated', detail: `Would notify via ${channel}: ${message}` }
}

/**
 * @param {{nodes:Array, edges:Array, metadata:Object}} graph  KG graphData
 * @param {{dryRun:boolean, userId:string, authContext:any, env:any, operationMap:any}} opts
 * @returns run result: { success, dryRun, steps, summary }
 */
export async function runAutomation(graph, opts) {
  const { dryRun = true, userId = null, authContext = null, env, operationMap = {}, callerEmail = null } = opts || {}

  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []
  // Only automation-step nodes participate; run-history / other nodes are ignored.
  const steps = nodes.filter((n) => n.type === 'automation-step')
  const byId = new Map(steps.map((n) => [n.id, n]))

  // Adjacency: source -> ordered [targetId]
  const children = new Map()
  for (const e of graph?.edges || []) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue
    if (!children.has(e.source)) children.set(e.source, [])
    children.get(e.source).push(e.target)
  }

  const stepTypeOf = (node) => node?.metadata?.stepType || 'note'
  const configOf = (node) => node?.metadata?.config || {}

  // Entry point: the (first) 'start' step, else the first step.
  const startNode = steps.find((n) => stepTypeOf(n) === 'start') || steps[0]

  const log = []
  let executed = 0
  let simulated = 0
  let errors = 0

  const record = (node, status, detail, extra = {}) => {
    log.push({
      nodeId: node.id,
      stepType: stepTypeOf(node),
      label: node.label || stepTypeOf(node),
      status, // 'ok' | 'simulated' | 'skipped' | 'error'
      detail,
      ...extra,
    })
    if (status === 'ok') executed += 1
    else if (status === 'simulated') simulated += 1
    else if (status === 'error') errors += 1
  }

  const ctx = { dryRun, userId, authContext, env, operationMap, callerEmail }
  // Per-step outputs, so downstream {{stepId.result...}} refs resolve to live data.
  const outputs = {}

  const runStep = async (node) => {
    if (log.length >= MAX_STEPS) return
    const eff = await executeStepEffect(withResolvedConfig(node, outputs), ctx)
    record(node, eff.status, eff.detail, eff.extra || {})
    outputs[node.id] = { result: eff.extra?.result ?? null, summary: eff.detail }

    // Loop repeats its downstream subtree `times` times; everything else walks children once.
    if (stepTypeOf(node) === 'loop') {
      const times = Math.max(1, Number(configOf(node).times) || 1)
      const kids = children.get(node.id) || []
      for (let i = 0; i < times; i += 1) {
        for (const childId of kids) await walk(childId)
      }
      return
    }
    for (const childId of children.get(node.id) || []) await walk(childId)
  }

  const walk = async (nodeId) => {
    if (log.length >= MAX_STEPS) return
    const node = byId.get(nodeId)
    if (!node) return
    await runStep(node)
  }

  if (!startNode) {
    return {
      success: true,
      dryRun,
      steps: [],
      summary: { total: 0, executed: 0, simulated: 0, errors: 0, capped: false },
      note: 'No automation-step nodes to run.',
    }
  }

  await walk(startNode.id)

  // Report step nodes that were never reached from Start.
  const reached = new Set(log.map((l) => l.nodeId))
  for (const s of steps) {
    if (!reached.has(s.id) && stepTypeOf(s) !== 'note') {
      record(s, 'skipped', 'Not reachable from Start')
    }
  }

  const capped = log.length >= MAX_STEPS
  return {
    success: errors === 0,
    dryRun,
    steps: log,
    summary: { total: log.length, executed, simulated, errors, capped },
  }
}

/**
 * Run ONE step in isolation, for real (Zapier-style "Test this step"). No graph traversal,
 * no upstream data threading yet — validates that this step's tool/config works on its own.
 * @returns {{success:boolean, step:object|null, error?:string}}
 */
export async function runSingleStep(graph, stepId, opts = {}) {
  const { userId = null, authContext = null, env, operationMap = {}, callerEmail = null } = opts
  const node = (graph?.nodes || []).find((n) => n.id === stepId && n.type === 'automation-step')
  if (!node) return { success: false, step: null, error: 'Step not found' }
  // Isolated test: no upstream outputs, so {{refs}} resolve to '' rather than leak literally.
  const eff = await executeStepEffect(withResolvedConfig(node, {}), { dryRun: false, userId, authContext, env, operationMap, callerEmail })
  const step = {
    nodeId: node.id,
    stepType: node?.metadata?.stepType || 'note',
    label: node.label || 'step',
    status: eff.status,
    detail: eff.detail,
    ...(eff.extra || {}),
  }
  return { success: eff.status !== 'error', step }
}
