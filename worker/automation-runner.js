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

  const runStep = async (node) => {
    if (log.length >= MAX_STEPS) return
    const type = stepTypeOf(node)
    const cfg = configOf(node)

    switch (type) {
      case 'start':
        record(node, 'ok', 'Automation start')
        break

      case 'note':
        // Documentation — not executed.
        record(node, 'skipped', 'Note (not executed)')
        break

      case 'delay':
        // Simulated: never actually pauses in this phase.
        record(node, 'simulated', `Would wait ${cfg.amount ?? '?'} ${cfg.unit ?? ''}`.trim())
        break

      case 'notify':
        // Simulated: config has no recipient yet (real send is a later phase).
        record(node, 'simulated', `Would notify via ${cfg.channel || '?'}: ${cfg.message || ''}`)
        break

      case 'action': {
        const toolName = cfg.toolName
        const params = cfg.params || {}
        if (!toolName) {
          record(node, 'error', 'Action has no toolName configured')
          break
        }
        if (dryRun) {
          record(node, 'simulated', `Would call ${toolName}`, { toolName, params })
          break
        }
        try {
          const result = await executeTool(
            toolName,
            { ...params, userId, authContext },
            env,
            operationMap
          )
          const ok = !result || result.success !== false
          record(node, ok ? 'ok' : 'error', result?.message || (ok ? `Ran ${toolName}` : 'Tool reported failure'), {
            toolName,
            params,
            result,
          })
        } catch (err) {
          record(node, 'error', `${toolName} threw: ${err.message}`, { toolName, params, error: err.message })
        }
        break
      }

      case 'loop': {
        const times = Math.max(1, Number(cfg.times) || 1)
        record(node, dryRun ? 'simulated' : 'ok', `Loop ${times}×${cfg.over ? ` over ${cfg.over}` : ''}`)
        // Repeat the loop's downstream subtree `times` times.
        const kids = children.get(node.id) || []
        for (let i = 0; i < times; i += 1) {
          for (const childId of kids) {
            await walk(childId)
          }
        }
        return // children already walked; don't fall through to default child-walk
      }

      default:
        record(node, 'skipped', `Unknown step type: ${type}`)
    }

    // Default: continue to children (loop handles its own above).
    for (const childId of children.get(node.id) || []) {
      await walk(childId)
    }
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
