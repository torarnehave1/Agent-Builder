/**
 * Organizational network analysis ↔ React Flow.
 *
 * Mirrors automationToGraph.ts: the worker returns a graph, the canvas renders
 * it. Two node kinds — people and topics — so this is a two-mode (bipartite)
 * affiliation network, not a plain social graph.
 *
 * Layout is computed here rather than stored: unlike an automation, nobody
 * arranges this by hand, and the arrangement should follow the data.
 */
import { MarkerType, type Node, type Edge } from '@xyflow/react';

export const AGENT_API = 'https://agent.vegvisr.org';

export interface ActorNode {
  // Bots participate but are not people — kept distinct so they can be coloured
  // separately and so centrality over humans stays honest.
  id: string; kind: 'person' | 'bot';
  label: string; avatar?: string | null; role?: string | null;
  messages: number; topics: number; outDegree: number; inDegree: number;
}
export interface TopicNode {
  id: string; kind: 'topic'; label: string;
  messages: number; participants: number; shared: boolean;
}
export type NetworkNode = ActorNode | TopicNode;

export interface NetworkEdge {
  source: string; target: string;
  kind: 'affiliation' | 'reply' | 'react';
  weight: number;
}

export interface NetworkStats {
  people: number; bots: number; topics: number;
  sharedTopics: number; soloTopics: number;
  interactionPairs: number; density: number;
}

export interface NetworkResponse {
  nodes: NetworkNode[]; edges: NetworkEdge[]; stats: NetworkStats;
  /** Saved positions for this viewer, keyed by node id. */
  layout?: Record<string, { x: number; y: number }>;
}

export async function saveLayout(
  authToken: string,
  positions: Record<string, { x: number; y: number }>,
): Promise<void> {
  const res = await fetch(`${AGENT_API}/network/layout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authToken, positions }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error((d as { error?: string })?.error || `Save failed (${res.status})`);
  }
}

export async function fetchNetwork(authToken: string): Promise<NetworkResponse> {
  const res = await fetch(`${AGENT_API}/network?authToken=${encodeURIComponent(authToken)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `Network request failed (${res.status})`);
  return data as NetworkResponse;
}

/** Edge thickness by weight, kept in a narrow band so one huge topic can't drown the rest. */
function strokeWidth(weight: number, max: number): number {
  if (max <= 0) return 1;
  return 1 + Math.min(6, Math.round((weight / max) * 6));
}

/**
 * People in a left column, topics in a right column, shared topics above solo
 * ones. Deliberately not force-directed: a stable layout is readable across
 * visits, and a springy one moves every time the data shifts slightly.
 */
export function networkToReactFlow(net: NetworkResponse): { nodes: Node[]; edges: Edge[] } {
  const saved = net.layout || {};
  const people = net.nodes.filter((n): n is ActorNode => n.kind === 'person' || n.kind === 'bot')
    .sort((a, b) => b.messages - a.messages);
  const topics = net.nodes.filter((n): n is TopicNode => n.kind === 'topic')
    // Shared first, then by volume — the connective tissue reads before the solo tail.
    .sort((a, b) => Number(b.shared) - Number(a.shared) || b.messages - a.messages);

  const ROW = 92;
  const nodes: Node[] = [
    // A saved position always wins over the computed one — once the owner has
    // arranged the chart, recomputing the layout under them would be hostile.
    ...people.map((p, i) => ({
      id: p.id,
      type: 'personNode',
      position: saved[p.id] || { x: 40, y: 40 + i * ROW },
      data: p as unknown as Record<string, unknown>,
    })),
    ...topics.map((t, i) => ({
      id: t.id,
      type: 'topicNode',
      position: saved[t.id] || { x: 460, y: 40 + i * ROW },
      data: t as unknown as Record<string, unknown>,
    })),
  ];

  const maxWeight = Math.max(1, ...net.edges.map((e) => e.weight));

  // Two people can have up to four edges between them — reply and react, each
  // way. Drawn on the same anchors with the same style they stack into a single
  // visible line, so the chart shows one number and hides three. Count the
  // parallels per unordered pair and fan them apart.
  const parallelCount = new Map<string, number>();
  const pairKey = (a: string, b: string) => [a, b].sort().join('|');
  for (const e of net.edges) {
    if (e.kind === 'affiliation') continue;
    const k = pairKey(e.source, e.target);
    parallelCount.set(k, (parallelCount.get(k) || 0) + 1);
  }
  const seen = new Map<string, number>();

  const STROKE = {
    affiliation: '#3B82C4',
    reply: '#8B7BB8',   // purple — a written response
    react: '#C08A2E',   // amber — a tap, a lighter act
  } as const;

  const edges: Edge[] = net.edges.map((e, i) => {
    const affiliation = e.kind === 'affiliation';
    const stroke = STROKE[e.kind];

    // Offset each parallel edge so they separate instead of overlapping.
    let curvature = 0.25;
    if (!affiliation) {
      const k = pairKey(e.source, e.target);
      const total = parallelCount.get(k) || 1;
      const idx = seen.get(k) || 0;
      seen.set(k, idx + 1);
      if (total > 1) curvature = 0.15 + idx * (0.6 / total);
    }

    return {
      id: `${e.kind}_${e.source}_${e.target}_${i}`,
      source: e.source,
      target: e.target,
      type: affiliation ? 'default' : 'simplebezier',
      // Direction is often the whole point of a sociogram: replying to someone
      // seven times more than they reply to you is the finding, and without a
      // head the two directions are indistinguishable.
      markerEnd: affiliation
        ? undefined
        : { type: MarkerType.ArrowClosed, width: 14, height: 14, color: stroke },
      // Every interaction edge is labelled, not just the heavy ones — an
      // unlabelled parallel edge is exactly what caused the confusion.
      label: affiliation ? (e.weight >= 10 ? String(e.weight) : undefined) : `${e.kind} ${e.weight}`,
      labelStyle: { fill: stroke, fontSize: 10 },
      labelBgStyle: { fill: '#0B1220', fillOpacity: 0.85 },
      style: {
        stroke,
        strokeWidth: strokeWidth(e.weight, maxWeight),
        opacity: affiliation ? 0.45 : 0.9,
        // Affiliation = membership (solid). Reply = written (solid, purple).
        // React = a tap (dashed, amber). Colour is never the only cue.
        strokeDasharray: e.kind === 'react' ? '5 4' : undefined,
      },
      pathOptions: affiliation ? undefined : { curvature },
      animated: false,
    } as Edge;
  });

  return { nodes, edges };
}
