/**
 * Replay of the real Kim André session (2026-09-04) through logToAutomation.
 *
 * The `result` objects are the SSE tool_result payloads as the BROWSER receives them —
 * { callId, tool, success, summary } plus nodeId/graphId when present — not the full tool
 * output. Feeding anything richer here would test a conversion that cannot happen in the app.
 *
 * Run:  node_modules/.bin/esbuild src/lib/logToAutomation.test.ts --bundle --platform=node
 *         --format=esm --outfile=<tmp>/t.mjs && node <tmp>/t.mjs
 */
import { logToAutomation, type LoggedCall } from './logToAutomation';

const G = '8f0960a8-3285-41db-83f1-4a41247483b5';
const TX = 'node-tx-1788514473496';
const AUDIO = 'https://audio.vegvisr.org/audio/2026-09-04T08-49-54-745Z-contact-log-1788511769605.webm';

const ok = (tool: string, extra: Record<string, unknown> = {}) => ({
  callId: `call_${tool}`, tool, success: true, summary: `${tool} completed`, ...extra,
});

const calls: LoggedCall[] = [
  { tool: 'list_recordings', input: { limit: 1 }, status: 'success', result: ok('list_recordings') },
  { tool: 'search_graphs', input: { q: 'Enkel Endring', limit: 100 }, status: 'success', result: ok('search_graphs') },
  { tool: 'list_recordings', input: { limit: 20, query: 'Kim Andre' }, status: 'success', result: ok('list_recordings') },
  {
    tool: 'transcribe_audio',
    input: { audioUrl: AUDIO, service: 'openai', language: 'no' },
    status: 'success',
    result: ok('transcribe_audio', { clientSideRequired: true, audioUrl: AUDIO, language: 'no', recordingId: null }),
  },
  { tool: 'read_graph', input: { graphId: G }, status: 'success', result: ok('read_graph', { graphId: G }) },
  {
    tool: 'analyze_transcription',
    input: { graphId: G, nodeId: TX, conversationType: '1-1', saveToGraph: true },
    status: 'success',
    result: ok('analyze_transcription', { nodeId: TX, graphId: G }),
  },
  { tool: 'read_graph_content', input: { graphId: G, nodeTypes: ['fulltext'] }, status: 'success', result: ok('read_graph_content', { graphId: G }) },
  { tool: 'list_recordings', input: { limit: 20, query: 'Kim Andre' }, status: 'success', result: ok('list_recordings') },
  { tool: 'get_node_types_reference', input: {}, status: 'success', result: ok('get_node_types_reference') },
  { tool: 'read_graph', input: { graphId: G }, status: 'success', result: ok('read_graph', { graphId: G }) },
  {
    tool: 'create_node',
    input: { graphId: G, label: '# Lydopptak – Kim André', nodeType: 'audio', path: AUDIO },
    status: 'success',
    result: ok('create_node', { nodeId: 'node-audio-kim-andre-1788511769605', graphId: G }),
  },
  { tool: 'read_node', input: { graphId: G, nodeId: 'node-audio-kim-andre-1788511769605' }, status: 'success', result: ok('read_node', { graphId: G }) },
  { tool: 'read_graph', input: { graphId: G }, status: 'success', result: ok('read_graph', { graphId: G }) },
  {
    tool: 'create_node',
    input: { graphId: G, label: '# Oppsummering – Kim André', nodeType: 'fulltext' },
    status: 'success',
    result: ok('create_node', { nodeId: 'node-summary-kim-andre', graphId: G }),
  },
  { tool: 'read_graph', input: { graphId: G }, status: 'success', result: ok('read_graph', { graphId: G }) },
  { tool: 'patch_node', input: { graphId: G, nodeId: 'node-does-not-exist' }, status: 'error', result: { error: 'nope' } },
];

const draft = logToAutomation(calls, { prompt: 'Transkriber og bygg graf for Kim André' });

console.log(`title: ${draft.title}`);
console.log(`steps: ${draft.steps.length}  edges: ${draft.edges.length}\n`);
for (const s of draft.steps) {
  if (s.stepType === 'action') {
    console.log(`  ${s.id.padEnd(4)} ${String(s.config.toolName).padEnd(24)} ${JSON.stringify(s.config.params)}`);
  } else {
    console.log(`  ${s.id.padEnd(4)} [${s.stepType}] ${s.label} ${s.stepType === 'note' ? `— ${String(s.config.text).slice(0, 60)}…` : ''}`);
  }
}
console.log('\nnotes:');
for (const n of draft.notes) console.log(`  - ${n}`);

// ── assertions ───────────────────────────────────────────────────────────────
const fail: string[] = [];
const actions = draft.steps.filter((s) => s.stepType === 'action');
const byId = Object.fromEntries(actions.map((s) => [s.id, s]));
const has = (pred: (s: typeof actions[number]) => boolean) => actions.some(pred);

if (has((s) => s.config.toolName === 'transcribe_audio')) fail.push('transcribe_audio became an action — it is browser-only');
if (!draft.steps.some((s) => s.stepType === 'note')) fail.push('no note left for the browser-only step');
if (has((s) => s.config.toolName === 'read_graph')) fail.push('unreferenced read_graph survived');
if (has((s) => s.config.toolName === 'get_node_types_reference')) fail.push('unreferenced inspection call survived');
if (has((s) => s.config.toolName === 'patch_node')) fail.push('a failed call became a step');

const secondCreate = actions.filter((s) => s.config.toolName === 'create_node')[1];
if (!secondCreate) fail.push('expected two create_node steps');

// The chain must be linear over the executable steps, in order.
const chainIds = draft.steps.filter((s) => s.stepType !== 'note').map((s) => s.id);
for (let i = 0; i < chainIds.length - 1; i += 1) {
  const e = draft.edges[i];
  if (!e || e.source !== chainIds[i] || e.target !== chainIds[i + 1]) {
    fail.push(`edge ${i} does not chain ${chainIds[i]} → ${chainIds[i + 1]}`);
  }
}
if (draft.edges.length !== chainIds.length - 1) fail.push('edge count does not match the chain');

// Every {{ref}} must point at a step that exists and comes EARLIER.
const order = new Map(draft.steps.map((s, i) => [s.id, i]));
for (const s of actions) {
  const refs = [...JSON.stringify(s.config.params).matchAll(/\{\{(\w+)\./g)].map((m) => m[1]);
  for (const r of refs) {
    if (!byId[r]) fail.push(`${s.id} references ${r}, which is not a step`);
    else if ((order.get(r) ?? 0) >= (order.get(s.id) ?? 0)) fail.push(`${s.id} references ${r}, which is not earlier`);
  }
}
// No ref may point at a wire-only field.
if (/\{\{\w+\.result\.(callId|tool)\b/.test(JSON.stringify(draft.steps))) {
  fail.push('a ref points at a transport-only field');
}

// ── scenario 2: a session that CREATES and then USES what it created ─────────
//
// Scenario 1 yields no {{refs}} at all, and that is correct: its graphId and nodeId were typed
// by the user, so no step produced them. Rewiring only has anything to bite on when a value
// first appears in a RESULT — which is the ordinary automation shape (create_graph → create_node)
// and the case the runner's own docs name. Asserting it here so the claim is exercised, not
// assumed.
const NEWG = 'e7b1c2d3-4444-4f55-8a66-9b0c1d2e3f40';
const chainCalls: LoggedCall[] = [
  { tool: 'list_graphs', input: { limit: 5 }, status: 'success', result: ok('list_graphs') },
  {
    tool: 'create_graph',
    input: { title: 'Ukesrapport', description: 'Automatisk' },
    status: 'success',
    result: ok('create_graph', { graphId: NEWG }),
  },
  {
    tool: 'create_node',
    input: { graphId: NEWG, label: '# Sammendrag', nodeType: 'fulltext' },
    status: 'success',
    result: ok('create_node', { nodeId: 'node-sum-1', graphId: NEWG }),
  },
  {
    tool: 'patch_node',
    input: { graphId: NEWG, nodeId: 'node-sum-1', fields: { info: 'Se https://www.vegvisr.org/gnew-viewer?graphId=' + NEWG } },
    status: 'success',
    result: ok('patch_node', { nodeId: 'node-sum-1', graphId: NEWG }),
  },
];

const chain = logToAutomation(chainCalls, { prompt: 'Lag ukesrapport' });
console.log('\n── scenario 2: create → use ──');
for (const s of chain.steps.filter((x) => x.stepType === 'action')) {
  console.log(`  ${s.id.padEnd(4)} ${String(s.config.toolName).padEnd(14)} ${JSON.stringify(s.config.params)}`);
}

const chainActions = chain.steps.filter((s) => s.stepType === 'action');
const json2 = JSON.stringify(chainActions);
if (chainActions.some((s) => s.config.toolName === 'list_graphs')) fail.push('s2: unreferenced list_graphs survived');
if (!/\{\{a2\.result\.graphId\}\}/.test(json2)) fail.push('s2: created graphId was not rewired to a ref');
if (!/\{\{a3\.result\.nodeId\}\}/.test(json2)) fail.push('s2: created nodeId was not rewired to a ref');
if (json2.includes(NEWG)) fail.push('s2: a literal graphId survived somewhere it should be a ref');
// The embedded case: the id inside the viewer URL must be rewired too, URL text intact.
const patched = chainActions.find((s) => s.config.toolName === 'patch_node');
const info = String((patched?.config.params as Record<string, Record<string, string>>)?.fields?.info || '');
if (!info.includes('gnew-viewer?graphId={{a2.result.graphId}}')) fail.push(`s2: embedded id not rewired — got "${info}"`);

console.log(fail.length ? `\nFAIL\n${fail.map((f) => '  - ' + f).join('\n')}` : '\nPASS — all assertions hold');
if (fail.length) process.exit(1);
