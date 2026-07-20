/**
 * Convert an automation canvas (React Flow nodes/edges) ↔ a Knowledge Graph.
 * "The automation IS the graph" — one KG graph per automation.
 *
 * KG graph shape follows the app-wide convention used by saveGraphWithHistory:
 *   { id, graphData: { nodes, edges, metadata }, override: true }
 * Each React Flow node → a KG node of type 'automation-step' whose machine-config lives in
 * metadata.config, mirroring the email-template / data-node precedent for typed app nodes.
 */
import type { Node, Edge } from '@xyflow/react';
import type { StepData, StepType } from './automation';
import { stepSummary } from './automation';

export const KG_API = 'https://knowledge.vegvisr.org';
export const AGENT_API = 'https://agent.vegvisr.org';
export const AUTOMATION_META_AREA = '#automation';

export interface RunStep {
  nodeId: string;
  stepType: string;
  label: string;
  status: 'ok' | 'simulated' | 'skipped' | 'error';
  detail: string;
  toolName?: string;
}

export interface RunResult {
  success: boolean;
  dryRun: boolean;
  steps: RunStep[];
  summary: { total: number; executed: number; simulated: number; errors: number; capped: boolean };
  graphId?: string;
  runNodeId?: string;
  error?: string;
}

export interface AutomationSpecStep {
  id: string;
  stepType: string;
  label: string;
  config: Record<string, unknown>;
  position?: { x: number; y: number };
}
export interface AutomationSpec {
  title: string;
  description: string;
  steps: AutomationSpecStep[];
  edges: Array<{ source: string; target: string }>;
  error?: string;
}

/** NL → automation spec via the worker (agent authors it; nothing runs). */
export async function buildAutomation(
  prompt: string,
  userId: string,
  tools: Array<{ name: string; description: string }>,
): Promise<AutomationSpec> {
  const res = await fetch(`${AGENT_API}/automation/build`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, userId, tools }),
  });
  const data = (await res.json()) as AutomationSpec;
  if (!res.ok) throw new Error(data.error || `Build failed: ${res.status}`);
  return data;
}

/** Map a built spec onto React Flow nodes/edges for the canvas. */
export function specToReactFlow(spec: AutomationSpec): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = (spec.steps || []).map((s, i) => ({
    id: s.id,
    type: s.stepType,
    position: s.position || { x: 320, y: 80 + i * 150 },
    data: { ...(s.config || {}), label: s.label },
  }));
  const edges: Edge[] = (spec.edges || []).map((e) => ({
    id: `${e.source}_${e.target}`,
    source: e.source,
    target: e.target,
    style: EDGE_STYLE,
    animated: true,
  }));
  return { nodes, edges };
}

/** Test ONE step in isolation, for real (Zapier-style). Returns the step result. */
export async function testStep(
  graphId: string,
  stepId: string,
  userId: string,
): Promise<{ success: boolean; step: RunStep | null; error?: string }> {
  const res = await fetch(`${AGENT_API}/automation/run`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ graphId, stepId, userId }),
  });
  const data = (await res.json()) as { success: boolean; step: RunStep | null; error?: string };
  if (!res.ok && !data.step) throw new Error(data.error || `Test failed: ${res.status}`);
  return data;
}

/** Execute an automation on the worker. dryRun (default) simulates action steps. */
export async function runAutomation(
  graphId: string,
  dryRun: boolean,
  userId: string,
): Promise<RunResult> {
  const res = await fetch(`${AGENT_API}/automation/run`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ graphId, dryRun, userId }),
  });
  const data = (await res.json()) as RunResult;
  if (!res.ok) throw new Error(data.error || `Run failed: ${res.status}`);
  return data;
}

const EDGE_STYLE = { stroke: 'rgba(124,58,237,0.4)', strokeWidth: 1.5 };

export interface AutomationMeta {
  title: string;
  description?: string;
  createdBy?: string;
  version?: number;
}

// Minimal shape of a KG node/edge we read back from getknowgraph.
interface KgNode {
  id: string;
  label?: string;
  type?: string;
  info?: string;
  position?: { x: number; y: number };
  metadata?: { stepType?: StepType; config?: Record<string, unknown> } | null;
}
interface KgEdge { id?: string; source: string; target: string; label?: string }
interface KgGraphData { nodes: KgNode[]; edges: KgEdge[]; metadata?: Record<string, unknown> }

/**
 * React Flow → KG graphData (ready to POST to saveGraphWithHistory as `graphData`).
 */
export function reactFlowToAutomationGraph(
  nodes: Node[],
  edges: Edge[],
  meta: AutomationMeta,
): KgGraphData {
  const kgNodes: KgNode[] = nodes.map((n) => {
    const stepType = (n.type || 'note') as StepType;
    const data = n.data as StepData;
    const label = (data as { label?: string }).label
      || (stepType === 'note' ? 'Note' : stepType.charAt(0).toUpperCase() + stepType.slice(1));
    // Drop transient UI-only fields (e.g. _test badge state) so they never persist.
    const config = Object.fromEntries(
      Object.entries(data as Record<string, unknown>).filter(([k]) => !k.startsWith('_'))
    );
    return {
      id: n.id,
      label,
      type: 'automation-step',
      info: stepSummary(stepType, data),
      position: n.position,
      metadata: { stepType, config },
    } as KgNode & { visible: boolean };
  });

  const kgEdges: KgEdge[] = edges.map((e) => ({
    id: e.id || `${e.source}_${e.target}`,
    source: e.source,
    target: e.target,
    label: (e.label as string) || 'next',
  }));

  return {
    nodes: kgNodes,
    edges: kgEdges,
    metadata: {
      title: meta.title,
      description: meta.description || '',
      category: 'Automation',
      metaArea: AUTOMATION_META_AREA,
      createdBy: meta.createdBy || '',
      version: meta.version ?? 0,
    },
  };
}

/**
 * KG graphData → React Flow. Restores nodes (with position + config) and edges.
 */
export function automationToReactFlow(graphData: KgGraphData): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = (graphData.nodes || [])
    // Only builder steps land on the canvas — run-history / other nodes are ignored.
    .filter((kn) => kn.type === 'automation-step')
    .map((kn) => {
      const stepType = (kn.metadata?.stepType || 'note') as StepType;
      const config = kn.metadata?.config || {};
      return {
        id: kn.id,
        type: stepType,
        position: kn.position || { x: 0, y: 0 },
        data: config as Record<string, unknown>,
      };
    });

  const edges: Edge[] = (graphData.edges || []).map((ke) => ({
    id: ke.id || `${ke.source}_${ke.target}`,
    source: ke.source,
    target: ke.target,
    label: ke.label && ke.label !== 'next' ? ke.label : undefined,
    style: EDGE_STYLE,
    animated: true,
  }));

  return { nodes, edges };
}

/** Persist an automation. New automations pass a fresh UUID as `id`. */
export async function saveAutomation(
  id: string,
  nodes: Node[],
  edges: Edge[],
  meta: AutomationMeta,
): Promise<{ id: string; newVersion?: number }> {
  const graphData = reactFlowToAutomationGraph(nodes, edges, meta);

  // Preserve any non-step nodes already on the graph (run-history), since
  // saveGraphWithHistory(override) replaces the whole nodes array.
  try {
    const existingRes = await fetch(`${KG_API}/getknowgraph?id=${encodeURIComponent(id)}`, {
      headers: { 'x-user-role': 'Superadmin' },
    });
    if (existingRes.ok) {
      const existing = (await existingRes.json()) as KgGraphData;
      const preserved = (existing.nodes || []).filter((n) => n.type !== 'automation-step');
      if (preserved.length) graphData.nodes = [...graphData.nodes, ...preserved];
    }
  } catch {
    // First save (graph doesn't exist yet) — nothing to preserve.
  }

  const res = await fetch(`${KG_API}/saveGraphWithHistory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin' },
    body: JSON.stringify({ id, graphData, override: true }),
  });
  if (!res.ok) throw new Error(`Save failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { id?: string; newVersion?: number };
  return { id: data.id || id, newVersion: data.newVersion };
}

/** Load an automation graph and map it back onto the canvas. */
export async function loadAutomation(
  id: string,
): Promise<{ nodes: Node[]; edges: Edge[]; meta: AutomationMeta }> {
  const res = await fetch(`${KG_API}/getknowgraph?id=${encodeURIComponent(id)}`, {
    headers: { 'x-user-role': 'Superadmin' },
  });
  if (!res.ok) throw new Error(`Load failed: ${res.status}`);
  const graph = (await res.json()) as KgGraphData;
  const { nodes, edges } = automationToReactFlow(graph);
  const m = graph.metadata || {};
  return {
    nodes,
    edges,
    meta: {
      title: (m.title as string) || 'Untitled automation',
      description: (m.description as string) || '',
      version: (m.version as number) ?? 0,
    },
  };
}

export interface AutomationSummary {
  id: string;
  title: string;
  description: string;
  updated?: string;
}

/**
 * List saved automations via server-side metaArea filter (never client-filter — project rule).
 */
export async function listAutomations(): Promise<AutomationSummary[]> {
  const params = new URLSearchParams({ offset: '0', limit: '100', metaArea: 'automation' });
  const res = await fetch(`${KG_API}/getknowgraphsummaries?${params}`, {
    headers: { 'x-user-role': 'Superadmin' },
  });
  if (!res.ok) throw new Error(`List failed: ${res.status}`);
  const data = (await res.json()) as { results?: Array<{ id: string; metadata?: Record<string, unknown> }> };
  return (data.results || []).map((g) => ({
    id: g.id,
    title: (g.metadata?.title as string) || g.id,
    description: (g.metadata?.description as string) || '',
    updated: (g.metadata?.updatedAt as string) || undefined,
  }));
}
