/**
 * Chat session → automation draft.
 *
 * A successful chat run is already an automation that worked once. Its tool calls carry the
 * same three fields a step needs — name, params, order — and unlike `/automation/build`, which
 * asks Claude to PLAN params against a schema, these params actually executed. Guessed
 * arguments become observed ones.
 *
 * This is authoring only: it produces the same spec shape the worker's assembleSpec() returns,
 * for the canvas to render. Nothing runs here.
 *
 * Extracted as a pure function so the whole conversion can be replayed outside React on a
 * recorded call list — the same reason toolCallPairing.ts exists (L91).
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * The runner resolves `{{stepId.result.field}}` against prior step outputs and NOTHING else —
 * there is no `{{input.*}}` namespace, and an unresolved ref silently becomes ''. So a literal
 * that no earlier step produced (a graphId typed by the user, a person's name inside a label)
 * is left as a literal for the user to edit. Templating it would look clever and write empty
 * strings at run time.
 */

export interface LoggedCall {
  tool: string;
  input: unknown;
  status: 'running' | 'success' | 'error';
  result?: unknown;
}

export type DraftStepType = 'start' | 'action' | 'note';

export interface DraftStep {
  id: string;
  stepType: DraftStepType;
  label: string;
  config: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface AutomationDraft {
  title: string;
  description: string;
  steps: DraftStep[];
  edges: Array<{ source: string; target: string }>;
  /** Human-readable account of what was dropped, rewired or flagged. Shown above the canvas. */
  notes: string[];
}

/**
 * Tools that CANNOT run in an automation because the work happens in the browser.
 * transcribe_audio is the only confirmed member: its executor ends with
 * `// 2. Always delegate transcription to the frontend browser.` and returns
 * clientSideRequired — the worker only resolves the audio URL. A worker-run automation has no
 * AudioContext, so the step is kept as a note rather than a silent failure at run time.
 */
const BROWSER_ONLY = new Set(['transcribe_audio']);

/**
 * Read-only calls. These are dropped ONLY when nothing downstream used their output — a chat
 * run is full of "let me look first" reads that no automation needs. list_recordings is in the
 * set and still survives whenever a later step consumed a value from it, which is the usual case.
 */
const INSPECTION = new Set([
  'read_graph', 'read_graph_content', 'read_node', 'list_graphs', 'list_meta_areas',
  'search_graphs', 'get_node_types_reference', 'get_contract', 'get_system_registry',
  'list_recordings', 'list_components', 'get_component', 'get_layout', 'list_layouts',
  'read_html_section', 'list_recordings_by_date', 'get_graph_history',
]);

/**
 * Transport-only keys on the SSE tool_result — never index these.
 *
 * The browser does NOT receive a tool's full output. agent-loop builds the tool_result payload
 * as { callId, tool, success, summary } and then copies through `nodeId` and `graphId` when the
 * result has them (plus a few per-tool extras such as transcribe_audio's audioUrl). That is a
 * real limit on this feature — a value like perplexity_search's `content` never reaches the
 * page, so it cannot be rewired here — but it happens to cover the two fields the runner's own
 * guidance names as the common refs: create_graph → result.graphId, create_node → result.nodeId.
 * Those paths are identical in the live result, so a ref built here resolves at run time.
 *
 * `callId` and `tool` exist only on the wire; a ref to them would resolve to '' when it ran.
 */
const TRANSPORT_ONLY = new Set(['callId', 'tool']);

/** Shortest useful literal to index. Below this, matches are coincidence (ids, "no", "1-1"). */
const MIN_MATCH_LEN = 8;
/** Only substitute inside a longer string when the value is distinctive enough to be safe. */
const MIN_EMBED_LEN = 12;
const MAX_RESULT_DEPTH = 4;

const titleCase = (s: string) =>
  String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Every string leaf of a value, keyed by the dot path the runner would use to reach it. */
function collectStrings(
  value: unknown,
  path: string,
  depth: number,
  into: Map<string, string>,
): void {
  if (depth > MAX_RESULT_DEPTH || value == null) return;
  if (typeof value === 'string') {
    if (value.length >= MIN_MATCH_LEN && !into.has(value)) into.set(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectStrings(v, `${path}.${i}`, depth + 1, into));
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (depth === 1 && TRANSPORT_ONLY.has(k)) continue;
      collectStrings(v, `${path}.${k}`, depth + 1, into);
    }
  }
}

/** Every string appearing anywhere in a call's params — used to spot echoed inputs. */
function collectInputStrings(value: unknown, depth: number, into: Set<string>): void {
  if (depth > MAX_RESULT_DEPTH || value == null) return;
  if (typeof value === 'string') { if (value.length >= MIN_MATCH_LEN) into.add(value); return; }
  if (Array.isArray(value)) { value.forEach((v) => collectInputStrings(v, depth + 1, into)); return; }
  if (typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectInputStrings(v, depth + 1, into);
  }
}

/**
 * What a call actually PRODUCED: result strings that were not already in its own input.
 *
 * Without this, read_graph({graphId:X}) looks like the producer of X, because the payload
 * echoes graphId back. Every later step then chained off a pure read that only repeated a value
 * the user supplied — and the read could never be pruned, because everything depended on it.
 * Caught by replaying the real Kim André session (2026-09-04).
 */
function producedStrings(call: LoggedCall, stepId: string): Map<string, string> {
  const echoed = new Set<string>();
  collectInputStrings(call.input, 0, echoed);
  const found = new Map<string, string>();
  collectStrings(call.result, 'result', 0, found);
  const out = new Map<string, string>();
  for (const [value, path] of found) {
    if (echoed.has(value)) continue;
    out.set(value, `${stepId}.${path}`);
  }
  return out;
}

/**
 * Rewrite a params object, swapping any literal an earlier step produced for a `{{ref}}`.
 * Returns the new params plus the refs used, so the caller can tell which producing steps
 * are load-bearing and must be kept.
 */
function templatize(
  params: unknown,
  index: Map<string, string>,
  used: Set<string>,
  depth = 0,
): unknown {
  if (depth > MAX_RESULT_DEPTH) return params;
  if (typeof params === 'string') {
    const exact = index.get(params);
    if (exact) {
      used.add(exact.split('.')[0]);
      return `{{${exact}}}`;
    }
    // Embedded: an id or URL sitting inside a longer sentence or label.
    let out = params;
    for (const [value, ref] of index) {
      if (value.length < MIN_EMBED_LEN || !out.includes(value)) continue;
      out = out.split(value).join(`{{${ref}}}`);
      used.add(ref.split('.')[0]);
    }
    return out;
  }
  if (Array.isArray(params)) return params.map((p) => templatize(p, index, used, depth + 1));
  if (params && typeof params === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
      out[k] = templatize(v, index, used, depth + 1);
    }
    return out;
  }
  return params;
}

const paramsOf = (input: unknown): Record<string, unknown> =>
  input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};

/**
 * Convert a chat session's tool calls into an automation draft.
 *
 * @param calls   tool calls in the order they ran (AgentChat's messages[].toolCalls, flattened)
 * @param opts.prompt  the user's first message — used for the title when present
 */
export function logToAutomation(
  calls: LoggedCall[],
  opts: { prompt?: string } = {},
): AutomationDraft {
  const notes: string[] = [];

  const succeeded = (calls || []).filter((c) => c && c.status === 'success');
  const failed = (calls || []).length - succeeded.length;
  if (failed > 0) {
    notes.push(`${failed} call${failed === 1 ? ' that did not succeed was' : 's that did not succeed were'} left out.`);
  }

  // Consecutive identical calls (same tool, same params) are a retry or a double-click, not
  // two steps. Non-consecutive repeats are kept — add_edge four times in a row is four edges.
  const deduped: LoggedCall[] = [];
  for (const c of succeeded) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.tool === c.tool && JSON.stringify(prev.input) === JSON.stringify(c.input)) continue;
    deduped.push(c);
  }
  const dropped = succeeded.length - deduped.length;
  if (dropped > 0) notes.push(`${dropped} repeated call${dropped === 1 ? '' : 's'} collapsed.`);

  // Pass 1 — what each call produced, and which producers its params would reference.
  //
  // Survivorship has to settle BEFORE the final rewrite. A ref may only name a step that is
  // still on the canvas: on the first replay, create_node pointed at {{a4.result.audioUrl}}
  // after a4 had become a browser-only note, and the runner would have resolved that to ''.
  // So: compute references, prune, and iterate to a fixed point — dropping a read can leave
  // the read it depended on unreferenced in turn.
  interface Candidate { id: string; call: LoggedCall; produced: Map<string, string> }
  const candidates: Candidate[] = [];
  let n = 0;
  for (const call of deduped) {
    const id = `a${(n += 1)}`;
    candidates.push({ id, call, produced: producedStrings(call, id) });
  }

  const isNote = (c: Candidate) => BROWSER_ONLY.has(c.call.tool);
  const alive = new Set(candidates.filter((c) => !isNote(c)).map((c) => c.id));

  /** Refs `c` would make, given the currently-alive producers before it. */
  const refsOf = (c: Candidate, live: Set<string>): Set<string> => {
    const index = new Map<string, string>();
    for (const p of candidates) {
      if (p.id === c.id) break;
      if (!live.has(p.id)) continue;
      for (const [value, ref] of p.produced) if (!index.has(value)) index.set(value, ref);
    }
    const used = new Set<string>();
    templatize(paramsOf(c.call.input), index, used);
    return used;
  };

  for (let pass = 0; pass < candidates.length + 1; pass += 1) {
    const referenced = new Set<string>();
    for (const c of candidates) {
      if (!alive.has(c.id) && !isNote(c)) continue;
      for (const r of refsOf(c, alive)) referenced.add(r);
    }
    let changed = false;
    for (const c of candidates) {
      if (!alive.has(c.id)) continue;
      if (INSPECTION.has(c.call.tool) && !referenced.has(c.id)) { alive.delete(c.id); changed = true; }
    }
    if (!changed) break;
  }

  const prunedReads = candidates.filter((c) => !isNote(c) && !alive.has(c.id)).length;
  if (prunedReads > 0) {
    notes.push(`${prunedReads} read-only call${prunedReads === 1 ? '' : 's'} dropped — nothing later used the result.`);
  }

  // Pass 2 — final rewrite against the producers that survived.
  const kept: Array<{ id: string; call: LoggedCall; params: Record<string, unknown> }> = [];
  const finalIndex = new Map<string, string>();
  for (const c of candidates) {
    if (!alive.has(c.id) && !isNote(c)) continue;
    const used = new Set<string>();
    const params = templatize(paramsOf(c.call.input), finalIndex, used) as Record<string, unknown>;
    kept.push({ id: c.id, call: c.call, params });
    if (alive.has(c.id)) {
      for (const [value, ref] of c.produced) if (!finalIndex.has(value)) finalIndex.set(value, ref);
    }
  }

  // Pass 3 — steps. Browser-only tools become notes so the gap is visible on the canvas.
  const steps: DraftStep[] = [];
  const start: DraftStep = {
    id: 's0', stepType: 'start', label: 'Start',
    config: { label: 'Start' }, position: { x: 320, y: 80 },
  };
  steps.push(start);

  let refsUsed = 0;
  for (const c of kept) {
    if (BROWSER_ONLY.has(c.call.tool)) {
      steps.push({
        id: `c${steps.length}`, stepType: 'note',
        label: 'Manual step',
        config: {
          text: `${c.call.tool} runs in the browser, not on the worker — it cannot be automated. `
            + `Do this step in the chat, then start the automation from its output.`,
        },
        position: { x: 320, y: 0 },
      });
      notes.push(`${c.call.tool} is browser-only — kept as a note, not a step.`);
      continue;
    }
    const json = JSON.stringify(c.params);
    refsUsed += (json.match(/\{\{/g) || []).length;
    steps.push({
      id: c.id, stepType: 'action', label: titleCase(c.call.tool),
      config: { label: titleCase(c.call.tool), toolName: c.call.tool, params: c.params },
      position: { x: 320, y: 0 },
    });
  }

  if (refsUsed > 0) {
    notes.push(`${refsUsed} value${refsUsed === 1 ? '' : 's'} rewired to {{step.result}} references.`);
  }
  const actionCount = steps.filter((s) => s.stepType === 'action').length;
  if (actionCount > 0) {
    notes.push('Literals no earlier step produced were left as-is — the runner has no run-parameter namespace, so edit them per run.');
  }

  // Lay out and chain. Notes float free, exactly as the worker's assembleSpec does.
  steps.forEach((s, i) => { s.position = { x: 320, y: 80 + i * 150 }; });
  const chain = steps.filter((s) => s.stepType !== 'note');
  const edges: Array<{ source: string; target: string }> = [];
  for (let i = 0; i < chain.length - 1; i += 1) {
    edges.push({ source: chain[i].id, target: chain[i + 1].id });
  }

  return {
    title: deriveTitle(opts.prompt),
    description: opts.prompt ? `Built from a chat session: ${opts.prompt.trim().slice(0, 200)}` : 'Built from a chat session.',
    steps, edges, notes,
  };
}

function deriveTitle(prompt?: string): string {
  const words = String(prompt || 'Automation from chat').trim().split(/\s+/).slice(0, 6).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
