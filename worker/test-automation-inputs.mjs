/**
 * Run-parameter ({{input.*}}) coverage for automation-runner.
 * Uses dryRun so no tool executes — the assertions are about template resolution,
 * which happens identically in dry and live runs (withResolvedConfig runs before the
 * dryRun branch in runAction).
 *
 * Run: node worker/test-automation-inputs.mjs
 */
import { runAutomation, runSingleStep, resolveAutomationInputs } from './automation-runner.js'

const fail = []
const step = (id, stepType, config) => ({
  id, type: 'automation-step', label: id, metadata: { stepType, config },
})

const graph = {
  nodes: [
    step('s0', 'start', {
      label: 'Start',
      inputs: [
        { key: 'graphId', label: 'Target graph', default: 'graph-from-chat' },
        { key: 'title', label: 'Node title', default: 'Default title' },
        { key: 'must', label: 'Required one', default: '', required: true },
      ],
    }),
    step('a1', 'action', {
      toolName: 'create_node',
      params: { graphId: '{{input.graphId}}', label: '{{input.title}}', note: 'see {{input.graphId}} now' },
    }),
  ],
  edges: [{ source: 's0', target: 'a1' }],
}

// 1. Defaults apply when nothing is supplied — the automation reproduces its source run.
const r1 = await runAutomation(graph, { dryRun: true, env: {} })
const p1 = r1.steps.find((s) => s.nodeId === 'a1')?.params
if (p1?.graphId !== 'graph-from-chat') fail.push(`1: default not applied — got ${JSON.stringify(p1?.graphId)}`)
if (p1?.label !== 'Default title') fail.push(`1: second default not applied — got ${JSON.stringify(p1?.label)}`)
if (p1?.note !== 'see graph-from-chat now') fail.push(`1: embedded ref not resolved — got ${JSON.stringify(p1?.note)}`)

// 2. A supplied value overrides the default — same automation, different target.
const r2 = await runAutomation(graph, { dryRun: true, env: {}, inputs: { graphId: 'graph-B', must: 'x' } })
const p2 = r2.steps.find((s) => s.nodeId === 'a1')?.params
if (p2?.graphId !== 'graph-B') fail.push(`2: supplied value ignored — got ${JSON.stringify(p2?.graphId)}`)
if (p2?.label !== 'Default title') fail.push('2: unsupplied key lost its default')
if (r2.inputs?.graphId !== 'graph-B') fail.push('2: run result did not report the inputs used')

// 3. A live run refuses to start when a required parameter has no value, rather than
//    writing '' into real data.
const r3 = await runAutomation(graph, { dryRun: false, env: {} })
if (r3.success !== false || !/must/.test(r3.error || '')) fail.push(`3: live run did not block on missing required input — ${JSON.stringify(r3.error)}`)
// ...but a dry run still walks, so the flow stays inspectable.
if (r1.steps.length === 0) fail.push('3: dry run blocked on the same missing input')

// 4. An undeclared key still resolves — a hand-typed {{input.x}} needs no declaration row.
const loose = { nodes: [step('s0', 'start', { label: 'Start' }), step('a1', 'action', { toolName: 't', params: { v: '{{input.adhoc}}' } })], edges: [{ source: 's0', target: 'a1' }] }
const r4 = await runAutomation(loose, { dryRun: true, env: {}, inputs: { adhoc: 'ok' } })
if (r4.steps.find((s) => s.nodeId === 'a1')?.params?.v !== 'ok') fail.push('4: undeclared input key did not resolve')

// 5. An unknown ref is still '' — the pre-existing contract must not change.
const r5 = await runAutomation(loose, { dryRun: true, env: {} })
if (r5.steps.find((s) => s.nodeId === 'a1')?.params?.v !== '') fail.push('5: unknown input ref no longer resolves to empty')

// 6. Single-step Test sees the declared defaults (it used to resolve every ref to '').
const r6 = await runSingleStep(graph, 'a1', { env: {}, operationMap: {} })
if (!/create_node/.test(r6.step?.detail || '') && r6.step?.params?.graphId !== 'graph-from-chat') {
  fail.push(`6: single-step test did not see input defaults — ${JSON.stringify(r6.step?.params)}`)
}

// 7. resolveAutomationInputs reports what is missing, for the UI to prompt on.
const { missing } = resolveAutomationInputs(graph, {})
if (missing.join(',') !== 'must') fail.push(`7: missing list wrong — ${missing.join(',')}`)

console.log(fail.length ? `FAIL\n${fail.map((f) => '  - ' + f).join('\n')}` : 'PASS — run parameters resolve, defaults hold, required ones gate a live run')
if (fail.length) process.exit(1)
