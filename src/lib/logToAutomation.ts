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
 * TWO KINDS OF VALUE
 * A literal an earlier step produced becomes `{{aN.result.field}}` — always, automatically.
 * A literal the SESSION supplied (the graph the chat worked on, a person's name, a URL) is a
 * run parameter: with `parameterize` it becomes `{{input.<key>}}` and is declared on the Start
 * step with the observed value as its default, so running with no parameters reproduces the
 * source session exactly, and running with one targets something else. This used to be
 * impossible — the runner had no `input` namespace and a templated literal would have resolved
 * to '' at run time. automation-runner.js now seeds it; see its "RUN PARAMETERS" note.
 * Anything neither produced nor recognised is still left as a literal for the user to edit.
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

/** A value the automation asks for per run. Declared on the Start step's config. */
export interface AutomationInput {
  key: string;
  label: string;
  default: string;
  required?: boolean;
}

/**
 * What the automation should do about the graph the chat worked on:
 *   pin  — write to that same graph every run (the session, replayed)
 *   new  — create a fresh graph each run and write into it
 *   ask  — {{input.graphId}}, defaulting to the chat's graph
 */
export type GraphTarget = 'pin' | 'new' | 'ask';

export interface ConvertOptions {
  /** The user's first message — titles the automation and seeds parameter detection. */
  prompt?: string;
  graphTarget?: GraphTarget;
  /** The graph the chat was working on. When absent it is inferred from the calls. */
  contextGraphId?: string;
  /** Its title — the default for the new-graph-per-run parameter. */
  contextGraphTitle?: string;
  /** Turn session-supplied literals into declared run parameters. */
  parameterize?: boolean;
  /** Keep read-only steps even when nothing downstream used them. */
  keepReads?: boolean;
  /**
   * Expand a delegate_to_* call into the concrete calls the subagent actually made.
   * Default true: a delegation left intact re-runs a whole subagent conversation on every
   * run, which is the single most expensive thing an automation built from chat can contain.
   */
  flattenDelegates?: boolean;
}

export interface AutomationDraft {
  title: string;
  description: string;
  steps: DraftStep[];
  edges: Array<{ source: string; target: string }>;
  /** How many steps call a model (or a paid service) on every run. */
  modelSteps: number;
  /** Run parameters, mirrored onto the Start step's config for the runner. */
  inputs: AutomationInput[];
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
 * Steps that call a MODEL (or a paid external service) every single run.
 *
 * These are what makes one automation cost 50× another, and nothing in the flow says so —
 * an `analyze_graph` step looks exactly like an `add_edge` step on the canvas. Counting them
 * lets the conversion dialog state the per-run cost before anything is built, and is why
 * expanding a delegation (which is a whole subagent conversation) is the default.
 */
const MODEL_CALLING_TOOLS = new Set([
  'analyze_node', 'analyze_graph', 'analyze_image', 'analyze_transcription',
  'perplexity_search', 'generate_image', 'transcribe_audio', 'translate_html_node',
  'suggest_node_types', 'generate_node_content',
]);

/** True for any step that spends model tokens when the automation runs. */
export const isModelStep = (tool: string): boolean =>
  tool.startsWith('delegate_to_') || MODEL_CALLING_TOOLS.has(tool);

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
/**
 * A prompt phrase shorter than this is not worth parameterising ("Kim" alone would match half
 * the words in a label). Lower than MIN_EMBED_LEN because a capitalised phrase appearing in
 * BOTH the request and the arguments is far stronger evidence than a bare substring match.
 */
const MIN_PHRASE_LEN = 5;

/**
 * Params that select a MODE, not a subject. A prompt mentioning "audio" must not turn
 * nodeType:"audio" into a run parameter — varying it would just break the step.
 */
const STRUCTURAL_KEYS = new Set([
  'nodeType', 'type', 'service', 'language', 'channel', 'unit', 'color', 'format',
  'model', 'conversationType', 'saveToGraph', 'visible', 'limit', 'offset',
]);
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

/**
 * A delegation's inner calls, as if the agent had made them directly.
 *
 * agent-loop forwards `actions` on a delegate_to_* tool_result: the tool name, the exact
 * arguments, and the ids the call PRODUCED (see replayableActions there). Replaying those is
 * both cheaper and more honest than replaying the delegation — the automation then shows what
 * will actually happen, and costs no model tokens for that part of the flow.
 *
 * Returns null when the chat carries no usable record (an older session, or a payload over the
 * forwarding budget), in which case the delegate step is kept as it is.
 */
function expandDelegate(call: LoggedCall): LoggedCall[] | null {
  if (!call.tool.startsWith('delegate_to_')) return null;
  const actions = (call.result as { actions?: unknown } | undefined)?.actions;
  if (!Array.isArray(actions) || actions.length === 0) return null;
  const out: LoggedCall[] = [];
  for (const a of actions as Array<Record<string, unknown>>) {
    if (!a || typeof a.tool !== 'string' || !a.input || typeof a.input !== 'object') continue;
    // The result mirrors the SSE tool_result shape the rest of this file is written against:
    // the ids the call produced, which is what the ref machinery indexes.
    const result: Record<string, unknown> = { tool: a.tool, success: true };
    if (typeof a.graphId === 'string') result.graphId = a.graphId;
    if (typeof a.nodeId === 'string') result.nodeId = a.nodeId;
    out.push({ tool: a.tool, input: a.input, status: 'success', result });
  }
  return out.length ? out : null;
}

/** camelCase key from arbitrary text, safe for {{input.<key>}} (word chars only). */
function slugKey(text: string): string {
  // An identifier-shaped key is already a good key — only the first letter is normalised.
  // Without this, audioUrl came out as "audiourl".
  if (/^[A-Za-z][A-Za-z0-9]*$/.test(text)) return text.charAt(0).toLowerCase() + text.slice(1);
  const words = String(text)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // "André" → "Andre"
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim().split(/\s+/).slice(0, 4);
  if (!words.length) return 'value';
  return words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join('');
}

/**
 * Capitalised phrases in the prompt — the thing a run most often varies by (a person, a
 * project, a place). Only these are substituted INSIDE longer strings, and only when the same
 * phrase also occurs in a param: a phrase present in both the request and the arguments is
 * what the session was about, not a coincidence.
 */
function properNounPhrases(prompt: string): string[] {
  const out: string[] = [];
  // Unicode-aware: Norwegian names (André, Håve, Øst) must count as capitalised.
  const re = /\p{Lu}[\p{L}'’-]*(?:\s+\p{Lu}[\p{L}'’-]*)*/gu;
  for (const m of String(prompt || '').matchAll(re)) {
    const phrase = m[0].trim();
    if (phrase.length >= MIN_PHRASE_LEN) out.push(phrase);
  }
  // Longest first, so "Kim André" wins over "Kim" and the shorter one never splits it.
  return [...new Set(out)].sort((a, b) => b.length - a.length);
}

/** Deep string replace of `value` with `token` — whole-value and embedded. */
function substitute(params: unknown, value: string, token: string, depth = 0): unknown {
  if (depth > MAX_RESULT_DEPTH || !value) return params;
  if (typeof params === 'string') {
    if (params === value) return token;
    return params.includes(value) ? params.split(value).join(token) : params;
  }
  if (Array.isArray(params)) return params.map((p) => substitute(p, value, token, depth + 1));
  if (params && typeof params === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
      out[k] = substitute(v, value, token, depth + 1);
    }
    return out;
  }
  return params;
}

/** True when any string anywhere in the params contains `value`. */
function containsValue(params: unknown, value: string, depth = 0): boolean {
  if (depth > MAX_RESULT_DEPTH || params == null || !value) return false;
  if (typeof params === 'string') return params.includes(value);
  if (Array.isArray(params)) return params.some((p) => containsValue(p, value, depth + 1));
  if (typeof params === 'object') {
    return Object.values(params as Record<string, unknown>).some((v) => containsValue(v, value, depth + 1));
  }
  return false;
}

/**
 * The graph this session worked on, when the caller did not say: the literal `graphId` param
 * used by most steps. Templated ones are skipped — those were produced by an earlier step and
 * are already handled by the ref machinery.
 */
function inferGraphId(kept: Array<{ params: Record<string, unknown> }>): string | undefined {
  const counts = new Map<string, number>();
  for (const k of kept) {
    const g = k.params?.graphId;
    if (typeof g !== 'string' || !g || g.includes('{{')) continue;
    counts.set(g, (counts.get(g) || 0) + 1);
  }
  let best: string | undefined;
  let bestN = 0;
  for (const [g, n] of counts) if (n > bestN) { best = g; bestN = n; }
  return best;
}

const paramsOf = (input: unknown): Record<string, unknown> =>
  input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};

/**
 * Convert a chat session's tool calls into an automation draft.
 *
 * @param calls  tool calls in the order they ran (AgentChat's messages[].toolCalls, flattened).
 *               Filter this list to convert only part of a session.
 * @param opts   see ConvertOptions — graph target, parameterisation, read pruning.
 */
export function logToAutomation(
  calls: LoggedCall[],
  opts: ConvertOptions = {},
): AutomationDraft {
  const notes: string[] = [];
  const inputs: AutomationInput[] = [];
  const graphTarget: GraphTarget = opts.graphTarget || 'pin';

  const rawSucceeded = (calls || []).filter((c) => c && c.status === 'success');
  const succeeded = opts.flattenDelegates === false
    ? rawSucceeded
    : rawSucceeded.flatMap((c) => {
        const inner = expandDelegate(c);
        if (!inner) return [c];
        notes.push(`${c.tool} expanded into ${inner.length} step${inner.length === 1 ? '' : 's'} — no subagent runs when this automation runs.`);
        return inner;
      });
  const unexpanded = rawSucceeded.filter((c) => c.tool.startsWith('delegate_to_') && !expandDelegate(c));
  if (opts.flattenDelegates !== false && unexpanded.length) {
    notes.push(`${unexpanded.length} delegated step${unexpanded.length === 1 ? '' : 's'} could not be expanded (the chat did not record the inner calls) — ${unexpanded.length === 1 ? 'it runs' : 'they run'} an AI subagent on every run.`);
  }
  const failed = (calls || []).length - rawSucceeded.length;
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

  for (let pass = 0; opts.keepReads !== true && pass < candidates.length + 1; pass += 1) {
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
  } else if (opts.keepReads === true) {
    notes.push('Read-only calls kept, as asked — they run every time and their results feed nothing.');
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

  // Pass 2b — the graph this automation writes to.
  //
  // The session's graphId is the single literal that most decides whether the automation is
  // reusable: pinned, it rewrites the same graph forever. `kept` is rewritten in place, so a
  // later step's embedded copy of the id (inside a viewer URL, say) is rewired too.
  const sessionGraphId = opts.contextGraphId || inferGraphId(kept);
  const createsOwnGraph = kept.some((k) => k.call.tool === 'create_graph');
  let graphStep: { id: string; params: Record<string, unknown> } | null = null;

  if (sessionGraphId && graphTarget !== 'pin') {
    if (createsOwnGraph) {
      // The session already mints its own graph and every graphId is a ref to it. Adding a
      // second create_graph would produce an empty orphan every run.
      notes.push('This session creates its own graph, so the graph option was left as-is.');
    } else if (graphTarget === 'ask') {
      const token = '{{input.graphId}}';
      for (const k of kept) k.params = substitute(k.params, sessionGraphId, token) as Record<string, unknown>;
      inputs.push({
        key: 'graphId',
        label: 'Target graph ID',
        default: sessionGraphId,
        required: true,
      });
      notes.push('Target graph is a run parameter — defaults to the graph from this chat.');
    } else if (graphTarget === 'new') {
      // create_graph ignores any supplied graphId and mints a UUID server-side
      // (tool-executors.js executeCreateGraph), so this really is a fresh graph per run.
      const titleDefault = opts.contextGraphTitle || deriveTitle(opts.prompt);
      graphStep = {
        id: 'g0',
        params: {
          title: '{{input.graphTitle}}',
          description: opts.prompt ? `Created by automation: ${opts.prompt.trim().slice(0, 160)}` : 'Created by automation',
        },
      };
      const token = '{{g0.result.graphId}}';
      for (const k of kept) k.params = substitute(k.params, sessionGraphId, token) as Record<string, unknown>;
      inputs.push({
        key: 'graphTitle',
        label: 'Title for the new graph',
        default: titleDefault,
        required: true,
      });
      notes.push('A new graph is created each run — every step writes into that run\'s graph.');
    }
  } else if (!sessionGraphId && graphTarget !== 'pin') {
    notes.push('No graph id found in these calls, so the graph option had nothing to apply to.');
  }

  // Pass 2c — session-supplied literals become declared run parameters.
  //
  // Every parameter keeps the observed value as its default, so a run with no arguments
  // reproduces this session exactly. That is what makes this safe to do by default.
  if (opts.parameterize) {
    // Only steps that will actually RUN. A browser-only call becomes a note with no params,
    // so parameterising it would declare a row on Start that no step ever reads.
    const runnable = kept.filter((k) => !BROWSER_ONLY.has(k.call.tool));
    const used = new Set(inputs.map((i) => i.key));
    const declare = (key: string, label: string, value: string): string => {
      let k = key;
      let n = 2;
      while (used.has(k) && inputs.find((i) => i.key === k)?.default !== value) k = `${key}${n++}`;
      if (!used.has(k)) { used.add(k); inputs.push({ key: k, label, default: value }); }
      return `{{input.${k}}}`;
    };

    // (a) A param whose whole value the user typed in the request.
    const prompt = String(opts.prompt || '');
    for (const k of runnable) {
      for (const [key, v] of Object.entries(k.params)) {
        if (typeof v !== 'string' || v.includes('{{') || v.length < MIN_MATCH_LEN) continue;
        if (STRUCTURAL_KEYS.has(key) || !prompt.includes(v)) continue;
        const token = declare(slugKey(key), `${titleCase(key)} (from your request)`, v);
        k.params[key] = token;
      }
    }

    // (b) URLs — a recording, an image, a page. Always the thing a rerun points elsewhere.
    for (const k of runnable) {
      for (const [key, v] of Object.entries(k.params)) {
        if (typeof v !== 'string' || !/^https?:\/\//.test(v)) continue;
        k.params[key] = declare(slugKey(key), titleCase(key), v);
      }
    }

    // (c) Capitalised phrases shared by the request and the arguments — the subject of the run.
    for (const phrase of properNounPhrases(prompt)) {
      if (!runnable.some((k) => containsValue(k.params, phrase))) continue;
      const token = declare(slugKey(phrase), `"${phrase}" (subject of the run)`, phrase);
      for (const k of runnable) k.params = substitute(k.params, phrase, token) as Record<string, unknown>;
    }

    // Declare only what is actually referenced. A parameter no step reads is a prompt for a
    // value that changes nothing — worse than not offering it.
    const referenced = JSON.stringify(runnable.map((k) => k.params));
    const orphans = inputs.filter((i) => !referenced.includes(`{{input.${i.key}}}`));
    for (const o of orphans) inputs.splice(inputs.indexOf(o), 1);

    const added = inputs.filter((i) => i.key !== 'graphId' && i.key !== 'graphTitle').length;
    if (added > 0) {
      notes.push(`${added} session value${added === 1 ? '' : 's'} turned into run parameters — defaults reproduce this chat.`);
    }
  }

  // Pass 3 — steps. Browser-only tools become notes so the gap is visible on the canvas.
  const steps: DraftStep[] = [];
  const start: DraftStep = {
    id: 's0', stepType: 'start', label: 'Start',
    config: { label: 'Start', ...(inputs.length ? { inputs } : {}) },
    position: { x: 320, y: 80 },
  };
  steps.push(start);

  if (graphStep) {
    steps.push({
      id: graphStep.id, stepType: 'action', label: 'Create Graph',
      config: { label: 'Create Graph', toolName: 'create_graph', params: graphStep.params },
      position: { x: 320, y: 0 },
    });
  }

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
    notes.push(inputs.length
      ? 'Anything not rewired or parameterised is still a literal — edit it on the step, or add a run parameter on Start.'
      : 'Every value is a literal from this chat — add run parameters on the Start step to vary them.');
  }

  // Lay out and chain. Notes float free, exactly as the worker's assembleSpec does.
  steps.forEach((s, i) => { s.position = { x: 320, y: 80 + i * 150 }; });
  const chain = steps.filter((s) => s.stepType !== 'note');
  const edges: Array<{ source: string; target: string }> = [];
  for (let i = 0; i < chain.length - 1; i += 1) {
    edges.push({ source: chain[i].id, target: chain[i + 1].id });
  }

  const modelSteps = steps.filter(
    (s) => s.stepType === 'action' && isModelStep(String(s.config.toolName || '')),
  ).length;
  if (modelSteps > 0) {
    notes.push(`${modelSteps} step${modelSteps === 1 ? '' : 's'} call${modelSteps === 1 ? 's' : ''} an AI model on every run — the rest are free to repeat.`);
  }

  return {
    title: deriveTitle(opts.prompt),
    description: opts.prompt ? `Built from a chat session: ${opts.prompt.trim().slice(0, 200)}` : 'Built from a chat session.',
    steps, edges, inputs, notes, modelSteps,
  };
}

function deriveTitle(prompt?: string): string {
  const words = String(prompt || 'Automation from chat').trim().split(/\s+/).slice(0, 6).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
