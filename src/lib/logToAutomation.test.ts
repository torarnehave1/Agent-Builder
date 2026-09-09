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

// ─── scenario 3: the same session, converted three ways ──────────────────────────────
// Same input list as scenario 1 (the real Kim André session). What must differ is only
// what the user asked for in the Make Automation dialog.
const PROMPT = 'Transkriber og bygg graf for Kim André';

const pinned = logToAutomation(calls, { prompt: PROMPT, graphTarget: 'pin', contextGraphId: G });
const asked = logToAutomation(calls, { prompt: PROMPT, graphTarget: 'ask', contextGraphId: G });
const fresh = logToAutomation(calls, { prompt: PROMPT, graphTarget: 'new', contextGraphId: G, contextGraphTitle: 'KAM – 1-1 Samtale' });
const params = logToAutomation(calls, { prompt: PROMPT, graphTarget: 'ask', contextGraphId: G, parameterize: true });

const actionsOf = (d: typeof pinned) => d.steps.filter((s) => s.stepType === 'action');
const jsonOf = (d: typeof pinned) => JSON.stringify(actionsOf(d).map((s) => s.config.params));

console.log('\n── scenario 3: graph target ──');
for (const [name, d] of [['pin', pinned], ['ask', asked], ['new', fresh], ['ask+params', params]] as const) {
  console.log(`  ${name.padEnd(11)} inputs=[${d.inputs.map((i) => i.key).join(', ')}]`);
  for (const s of actionsOf(d)) console.log(`      ${String(s.config.toolName).padEnd(22)} ${JSON.stringify(s.config.params)}`);
}

// pin = unchanged behaviour: the graph stays frozen.
if (!jsonOf(pinned).includes(G)) fail.push('s3 pin: graphId should stay literal');
if (pinned.inputs.length !== 0) fail.push('s3 pin: no run parameters should be declared');

// ask = one declared parameter, no literal graphId left anywhere.
if (jsonOf(asked).includes(G)) fail.push('s3 ask: a literal graphId survived');
if (!jsonOf(asked).includes('{{input.graphId}}')) fail.push('s3 ask: graphId was not parameterised');
const gi = asked.inputs.find((i) => i.key === 'graphId');
if (gi?.default !== G) fail.push('s3 ask: default must be the graph from the chat');
if (asked.steps[0].stepType !== 'start') fail.push('s3 ask: step 0 must be Start');
if (JSON.stringify((asked.steps[0].config as Record<string, unknown>).inputs) !== JSON.stringify(asked.inputs)) {
  fail.push('s3 ask: inputs are not mirrored onto the Start step (the runner reads them there)');
}

// new = a create_graph step is prepended and every graphId points at ITS output.
const first = actionsOf(fresh)[0];
if (first?.config.toolName !== 'create_graph') fail.push('s3 new: no create_graph step was prepended');
if (jsonOf(fresh).includes(G)) fail.push('s3 new: a literal graphId survived');
if (!jsonOf(fresh).includes('{{g0.result.graphId}}')) fail.push('s3 new: steps do not use the created graph');
if ((first?.config.params as Record<string, string>)?.title !== '{{input.graphTitle}}') fail.push('s3 new: title is not a parameter');
if (fresh.inputs.find((i) => i.key === 'graphTitle')?.default !== 'KAM – 1-1 Samtale') fail.push('s3 new: title default is not the chat graph title');
if (!fresh.edges.some((e) => e.source === 's0' && e.target === 'g0')) fail.push('s3 new: create_graph is not wired after Start');

// A session that already creates its own graph must NOT get a second create_graph.
const doubled = logToAutomation(chainCalls, { prompt: 'Lag ukesrapport', graphTarget: 'new' });
if (doubled.steps.filter((s) => s.config.toolName === 'create_graph').length !== 1) {
  fail.push('s3 new: a session that already creates a graph got a second create_graph');
}

// parameterize = the subject and the media URL become parameters, defaults intact.
const pj = jsonOf(params);
if (!/\{\{input\.\w+\}\}/.test(pj)) fail.push('s3 params: nothing was parameterised');
if (pj.includes(AUDIO)) fail.push('s3 params: the recording URL stayed frozen');
if (!params.inputs.some((i) => i.default === AUDIO)) fail.push('s3 params: the URL parameter lost its default');
if (!params.inputs.some((i) => i.default === 'Kim André')) fail.push('s3 params: the run subject was not detected');
// Mode-selecting params must survive untouched, or the step breaks when the value varies.
if (!pj.includes('"nodeType":"audio"')) fail.push('s3 params: nodeType was wrongly parameterised');
if (!pj.includes('"conversationType":"1-1"')) fail.push('s3 params: conversationType was wrongly parameterised');
// Every parameter must carry the observed value, so a no-argument run repeats the chat.
for (const i of params.inputs) if (!i.default) fail.push(`s3 params: input "${i.key}" has no default`);

// keepReads leaves the "let me look first" calls in place.
const withReads = logToAutomation(calls, { prompt: PROMPT, keepReads: true });
if (actionsOf(withReads).length <= actionsOf(pinned).length) fail.push('s3 keepReads: reads were still dropped');

console.log(fail.length ? `\nFAIL\n${fail.map((f) => '  - ' + f).join('\n')}` : '\nPASS — all assertions hold (incl. graph target + parameters)');
if (fail.length) process.exit(1);

// A parameter must be referenced by a step. The browser-only transcribe_audio call carries an
// audioUrl, but it becomes a NOTE with no params — declaring it would prompt for a value that
// changes nothing.
const paramJson = JSON.stringify(params.steps.map((s) => s.config.params));
for (const i of params.inputs) {
  if (!paramJson.includes(`{{input.${i.key}}}`)) fail.push(`s3 params: "${i.key}" is declared but no step reads it`);
}
if (params.inputs.some((i) => i.key === 'audiourl')) fail.push('s3 params: camelCase key was mangled to lowercase');
console.log(fail.length ? `\nFAIL\n${fail.map((f) => '  - ' + f).join('\n')}` : 'PASS — parameters are all referenced');
if (fail.length) process.exit(1);

// ─── scenario 4: a delegated step is expanded into the calls it really made ───────────
// The `actions` array is exactly what agent-loop's replayableActions() forwards on the
// tool_result of a delegate_to_* call: tool + the arguments used + the ids produced.
const DG = 'dddddddd-1111-2222-3333-444444444444';
const delegated: LoggedCall[] = [
  { tool: 'read_graph', input: { graphId: DG }, status: 'success', result: ok('read_graph', { graphId: DG }) },
  {
    tool: 'delegate_to_kg',
    input: { task: 'Legg inn lydopptaket som audio-node', graphId: DG },
    status: 'success',
    result: ok('delegate_to_kg', {
      graphId: DG,
      actions: [
        { tool: 'read_graph', input: { graphId: DG }, graphId: DG },
        { tool: 'create_node', input: { graphId: DG, nodeId: 'node-audio-kim', label: 'Lydopptak', nodeType: 'audio', path: AUDIO }, graphId: DG, nodeId: 'node-audio-kim' },
        { tool: 'add_edge', input: { graphId: DG, source: 'node-audio-kim', target: 'node-sum' }, graphId: DG },
      ],
    }),
  },
];

const flat = logToAutomation(delegated, { prompt: 'Legg inn lydopptaket', contextGraphId: DG });
const kept2 = logToAutomation(delegated, { prompt: 'Legg inn lydopptaket', contextGraphId: DG, flattenDelegates: false });

console.log('\n── scenario 4: delegated subagent ──');
console.log('  flattened:', flat.steps.filter((s) => s.stepType === 'action').map((s) => s.config.toolName).join(' → '));
console.log('  kept:     ', kept2.steps.filter((s) => s.stepType === 'action').map((s) => s.config.toolName).join(' → '));

const flatTools = flat.steps.filter((s) => s.stepType === 'action').map((s) => String(s.config.toolName));
if (flatTools.includes('delegate_to_kg')) fail.push('s4: the delegation survived instead of being expanded');
if (!flatTools.includes('create_node')) fail.push('s4: the inner create_node did not become a step');
if (!flatTools.includes('add_edge')) fail.push('s4: the inner add_edge did not become a step');
// The subagent's own "read first" call is still a read nothing used — same pruning applies.
if (flatTools.includes('read_graph')) fail.push('s4: an unused inner read was not pruned');
// The step params must be the arguments the subagent actually used.
const cn = flat.steps.find((s) => s.config.toolName === 'create_node');
if ((cn?.config.params as Record<string, string>)?.nodeId !== 'node-audio-kim') fail.push('s4: inner arguments were lost');
if (!flat.notes.some((n) => /expanded into 3 steps/.test(n))) fail.push('s4: the expansion was not reported');

// Opting out keeps the single delegated step (adaptive, but a subagent runs every time).
if (!kept2.steps.some((s) => s.config.toolName === 'delegate_to_kg')) fail.push('s4: flattenDelegates:false still expanded');

// A session recorded before this existed has no `actions` — the step must survive untouched.
const legacy = logToAutomation(
  [{ tool: 'delegate_to_kg', input: { task: 'gjør noe', graphId: DG }, status: 'success', result: ok('delegate_to_kg', { graphId: DG }) }],
  { prompt: 'gjør noe' },
);
if (!legacy.steps.some((s) => s.config.toolName === 'delegate_to_kg')) fail.push('s4: a legacy delegation without actions was dropped');
if (!legacy.notes.some((n) => /could not be expanded/.test(n))) fail.push('s4: the un-expandable delegation was not flagged');

console.log(fail.length ? `\nFAIL\n${fail.map((f) => '  - ' + f).join('\n')}` : 'PASS — delegations expand into the calls they really made');
if (fail.length) process.exit(1);
