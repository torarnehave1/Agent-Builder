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

async function runNotify(cfg, ctx) {
  const channel = cfg.channel || 'email'
  const message = cfg.message || ''
  if (ctx.dryRun) return { status: 'simulated', detail: `Would notify via ${channel}: ${message}` }
  if (channel === 'email') {
    const to = cfg.to
    if (!to) return { status: 'error', detail: 'Notify (email) has no "to" recipient configured' }
    const fromEmail = cfg.fromEmail || DEFAULT_NOTIFY_FROM
    const subject = cfg.subject || 'Automation notification'
    try {
      const result = await executeTool('send_email', {
        fromEmail, to, subject, html: message || subject,
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
  const { dryRun = true, userId = null, authContext = null, env, operationMap = {} } = opts || {}

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

  const ctx = { dryRun, userId, authContext, env, operationMap }

  const runStep = async (node) => {
    if (log.length >= MAX_STEPS) return
    const eff = await executeStepEffect(node, ctx)
    record(node, eff.status, eff.detail, eff.extra || {})

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
  const { userId = null, authContext = null, env, operationMap = {} } = opts
  const node = (graph?.nodes || []).find((n) => n.id === stepId && n.type === 'automation-step')
  if (!node) return { success: false, step: null, error: 'Step not found' }
  const eff = await executeStepEffect(node, { dryRun: false, userId, authContext, env, operationMap })
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
