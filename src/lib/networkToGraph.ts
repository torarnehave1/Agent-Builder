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
import type { Node, Edge } from '@xyflow/react';

export const AGENT_API = 'https://agent.vegvisr.org';

export interface PersonNode {
  id: string; kind: 'person';
  messages: number; topics: number; outDegree: number; inDegree: number;
}
export interface TopicNode {
  id: string; kind: 'topic'; label: string;
  messages: number; participants: number; shared: boolean;
}
export type NetworkNode = PersonNode | TopicNode;

export interface NetworkEdge {
  source: string; target: string;
  kind: 'affiliation' | 'reply' | 'react';
  weight: number;
}

export interface NetworkStats {
  people: number; topics: number;
  sharedTopics: number; soloTopics: number;
  interactionPairs: number; density: number;
}

export interface NetworkResponse {
  nodes: NetworkNode[]; edges: NetworkEdge[]; stats: NetworkStats;
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
export function networkToReactFlow(
  net: NetworkResponse,
  displayName: (userId: string) => string,
): { nodes: Node[]; edges: Edge[] } {
  const people = net.nodes.filter((n): n is PersonNode => n.kind === 'person')
    .sort((a, b) => b.messages - a.messages);
  const topics = net.nodes.filter((n): n is TopicNode => n.kind === 'topic')
    // Shared first, then by volume — the connective tissue reads before the solo tail.
    .sort((a, b) => Number(b.shared) - Number(a.shared) || b.messages - a.messages);

  const ROW = 92;
  const nodes: Node[] = [
    ...people.map((p, i) => ({
      id: p.id,
      type: 'personNode',
      position: { x: 40, y: 40 + i * ROW },
      data: { ...p, label: displayName(p.id) } as unknown as Record<string, unknown>,
    })),
    ...topics.map((t, i) => ({
      id: t.id,
      type: 'topicNode',
      position: { x: 460, y: 40 + i * ROW },
      data: t as unknown as Record<string, unknown>,
    })),
  ];

  const maxWeight = Math.max(1, ...net.edges.map((e) => e.weight));

  const edges: Edge[] = net.edges.map((e, i) => {
    const affiliation = e.kind === 'affiliation';
    return {
      id: `${e.kind}_${e.source}_${e.target}_${i}`,
      source: e.source,
      target: e.target,
      // Weight is the whole point of these edges, so it is shown, not implied.
      label: e.weight >= 10 ? String(e.weight) : undefined,
      style: {
        stroke: affiliation ? '#3B82C4' : '#8B7BB8',
        strokeWidth: strokeWidth(e.weight, maxWeight),
        opacity: affiliation ? 0.5 : 0.75,
        // Reply/react edges are directed acts; affiliations are memberships.
        strokeDasharray: affiliation ? undefined : '5 4',
      },
      animated: false,
    };
  });

  return { nodes, edges };
}
