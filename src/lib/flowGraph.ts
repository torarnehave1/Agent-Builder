/**
 * VEGR Flows in the Automations tab — READ-ONLY (2026-11-16).
 *
 * A VEGR Flow is a graph with one `flow` node and `flow-step` nodes joined by labelled edges
 * (next / approved / rejected / error). It is NOT an automation: flows-worker runs it (over the
 * MCP tool run_flow), with approval steps and sends limited to ContactHub contacts — the
 * automation runner has neither. So this file only lists and draws flows; nothing here saves or
 * runs one. The step shape is flows-worker/compile.js (vegvisr-frontend): metadata.kind is
 * action | agent | approval | route | wait | loop | subflow | note.
 */
import type { Node, Edge } from '@xyflow/react';
import { kgAuthHeaders } from './kgAuth';
import { KG_API } from './automationToGraph';

export interface FlowSummary {
  id: string;
  title: string;
  description: string;
  world?: string;
}

export interface FlowStepData {
  label: string;
  kind: string;
  info: string;
  toolName?: string;
  forEach?: string;
  maxItems?: number;
  params?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  timeout?: string;
  approver?: string;
  previewTool?: string;
  [key: string]: unknown;
}

export interface FlowHeaderData {
  label: string;
  info: string;
  status?: string;
  limits?: Record<string, unknown>;
  inputs?: Record<string, string>;
  triggers?: Array<{ id?: string; type?: string; [k: string]: unknown }>;
  [key: string]: unknown;
}

export interface LoadedFlow {
  id: string;
  title: string;
  description: string;
  world: string | null;
  nodes: Node[];
  edges: Edge[];
}

/**
 * Flows: graphs tagged with a FLOWS area (#VEGRAIFLOWS, #FLOWS), filtered by the server
 * (metaArea), then kept only if they really hold a `flow` node — an area tag alone does not make
 * a graph a flow.
 */
export async function listFlows(): Promise<FlowSummary[]> {
  const params = new URLSearchParams({ offset: '0', limit: '100', metaArea: 'FLOWS' });
  const res = await fetch(`${KG_API}/getknowgraphsummaries?${params}`, { headers: kgAuthHeaders() });
  if (!res.ok) throw new Error(`List failed: ${res.status}`);
  const data = (await res.json()) as {
    results?: Array<{ id: string; title?: string; nodeTypes?: string[]; world?: string; metadata?: Record<string, unknown> }>;
  };
  return (data.results || [])
    .filter((g) => Array.isArray(g.nodeTypes) && g.nodeTypes.includes('flow'))
    .map((g) => ({
      id: g.id,
      title: (g.metadata?.title as string) || g.title || g.id,
      description: (g.metadata?.description as string) || '',
      ...(g.world ? { world: g.world } : {}),
    }));
}

// Graph positions are laid out ~200 apart, closer than a step card is wide; spread them out.
const SPREAD_X = 1.6;
const SPREAD_Y = 1.25;

const EDGE_COLORS: Record<string, string> = {
  approved: 'rgba(52,211,153,0.7)',
  rejected: 'rgba(244,63,94,0.7)',
  error: 'rgba(251,146,60,0.8)',
};

/** Load a flow graph and draw it: the flow node as the header, each flow-step by its kind. */
export async function loadFlow(id: string): Promise<LoadedFlow> {
  const res = await fetch(`${KG_API}/getknowgraph?id=${encodeURIComponent(id)}`, { headers: kgAuthHeaders() });
  if (!res.ok) throw new Error(`Load failed: ${res.status}`);
  const world = res.headers.get('X-Graph-World');
  const graph = (await res.json()) as {
    metadata?: Record<string, unknown>;
    nodes?: Array<{ id: string; type?: string; label?: string; info?: string; position?: { x?: number; y?: number }; metadata?: Record<string, any> }>;
    edges?: Array<{ id?: string; source: string; target: string; label?: string }>;
  };
  const kgNodes = graph.nodes || [];
  if (!kgNodes.some((n) => n.type === 'flow')) throw new Error('This graph has no flow node — it is not a VEGR Flow.');

  const nodes: Node[] = kgNodes
    .filter((n) => n.type === 'flow' || n.type === 'flow-step')
    .map((n) => {
      const m = n.metadata || {};
      const position = { x: (n.position?.x ?? 0) * SPREAD_X, y: (n.position?.y ?? 0) * SPREAD_Y };
      if (n.type === 'flow') {
        const data: FlowHeaderData = {
          label: n.label || 'Flow', info: n.info || '', status: m.status, limits: m.limits, inputs: m.inputs, triggers: m.triggers,
        };
        return { id: n.id, type: 'flowHeader', position, data, draggable: false };
      }
      const data: FlowStepData = {
        label: n.label || n.id,
        kind: String(m.kind || 'note'),
        info: n.info || '',
        toolName: m.toolName,
        forEach: m.forEach,
        maxItems: m.maxItems,
        params: m.params,
        payload: m.payload,
        timeout: m.timeout,
        approver: m.approver,
        previewTool: m.preview?.toolName,
      };
      return { id: n.id, type: 'flowStep', position, data, draggable: false };
    });

  // Flows written by a tool often store every step at 0,0 (six of nine flows, 2026-11-16), and
  // drawn as stored they all lie on one spot. Unless every node has a position of its own, the
  // flow is laid out in rows by its edges instead.
  const seen = new Set(nodes.map((n) => `${n.position.x},${n.position.y}`));
  if (seen.size < nodes.length) layoutByEdges(nodes, graph.edges || []);

  // Two edges can join the same pair (a step's "next" and "error" both lead to the log step).
  // Drawn separately they lie exactly on top of each other and only one label shows, so one line
  // is drawn per pair, labelled with every route it carries ("next · error").
  const ids = new Set(nodes.map((n) => n.id));
  const byPair = new Map<string, { source: string; target: string; labels: string[] }>();
  for (const e of graph.edges || []) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    const key = `${e.source}\u0000${e.target}`;
    const pair = byPair.get(key) || { source: e.source, target: e.target, labels: [] };
    const l = (e.label || 'next').trim() || 'next';
    if (!pair.labels.includes(l)) pair.labels.push(l);
    byPair.set(key, pair);
  }
  const edges: Edge[] = [...byPair.values()].map((p) => {
    const only = p.labels.length === 1 ? p.labels[0] : null;
    const label = only === 'next' ? undefined : p.labels.join(' · ');
    const stroke = (only && EDGE_COLORS[only]) || 'rgba(148,163,184,0.5)';
    return {
      id: `${p.source}->${p.target}`,
      source: p.source,
      target: p.target,
      label,
      style: { stroke, strokeWidth: 1.5 },
      labelStyle: { fill: '#e2e8f0', fontSize: 10 },
      labelBgStyle: { fill: '#0f172a' },
      animated: false,
    };
  });

  const m = graph.metadata || {};
  return {
    id,
    title: (m.title as string) || 'Untitled flow',
    description: (m.description as string) || '',
    world,
    nodes,
    edges,
  };
}

const ROW_GAP = 150;
const COL_GAP = 270;

/**
 * Rows by distance from the start: the flow header (or, without one, every step nothing points
 * to) is row 0, each step goes one row below the first step that reaches it, and the steps of a
 * row sit side by side, centred. A step nothing reaches goes in a last row. Changes positions in
 * place; the graph itself is not touched.
 */
export function layoutByEdges(nodes: Node[], kgEdges: Array<{ source: string; target: string }>): void {
  const ids = new Set(nodes.map((n) => n.id));
  const out = new Map<string, string[]>();
  const incoming = new Set<string>();
  for (const e of kgEdges) {
    if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) continue;
    out.set(e.source, [...(out.get(e.source) || []), e.target]);
    incoming.add(e.target);
  }
  const header = nodes.find((n) => n.type === 'flowHeader');
  const row = new Map<string, number>();
  const walk = (starts: string[], at: number) => {
    const queue = starts.filter((s) => !row.has(s));
    for (const s of queue) row.set(s, at);
    while (queue.length) {
      const id = queue.shift()!;
      for (const t of out.get(id) || []) {
        if (row.has(t)) continue;
        row.set(t, (row.get(id) || 0) + 1);
        queue.push(t);
      }
    }
  };
  // The header first; then any step nothing points to (a flow whose header has no edge to its
  // first step) starts the row below it.
  if (header) walk([header.id], 0);
  walk(nodes.filter((n) => n.type !== 'flowHeader' && !incoming.has(n.id)).map((n) => n.id), header ? 1 : 0);
  const last = Math.max(0, ...row.values()) + 1;
  const rows = new Map<number, Node[]>();
  for (const n of nodes) {
    const r = row.has(n.id) ? row.get(n.id)! : last;
    rows.set(r, [...(rows.get(r) || []), n]);
  }
  for (const [r, list] of rows) {
    list.forEach((n, i) => {
      n.position = { x: (i - (list.length - 1) / 2) * COL_GAP, y: r * ROW_GAP };
    });
  }
}

/** Where the graph opens for editing: the World's own editor for a World graph. */
export function flowEditorUrl(id: string, world: string | null): string {
  const base = world ? `https://editor.${world.toLowerCase()}` : 'https://editor.vegvisr.org';
  return `${base}/?graphId=${encodeURIComponent(id)}`;
}
