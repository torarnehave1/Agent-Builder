import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReactFlowProvider, type Node, type Edge, type NodeTypes } from '@xyflow/react';
import ContractCanvas from './ContractCanvas';
import PersonNode from './nodes/network/PersonNode';
import TopicNode from './nodes/network/TopicNode';
import { fetchNetwork, networkToReactFlow, saveLayout, type NetworkStats } from '../lib/networkToGraph';

const nodeTypes: NodeTypes = {
  personNode: PersonNode as unknown as NodeTypes[string],
  topicNode: TopicNode as unknown as NodeTypes[string],
};

interface Props {
  authToken: string;
}

/**
 * Two-mode affiliation network over the chat data — who posts where, and who
 * replies to whom. System-owner only; the route enforces that independently.
 */
export default function NetworkTab({ authToken }: Props) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [stats, setStats] = useState<NetworkStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [saving, setSaving] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    fetchNetwork(authToken)
      .then((net) => {
        const flow = networkToReactFlow(net);
        setNodes(flow.nodes);
        setEdges(flow.edges);
        setStats(net.stats);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load the network'))
      .finally(() => setLoading(false));
  }, [authToken]);

  useEffect(load, [load]);

  // Positions are saved explicitly rather than on every drag — an autosave here
  // would write on each pointer move, and the owner may be exploring rather than
  // committing to an arrangement.
  const persist = useCallback(() => {
    setSaving('Saving…');
    const positions = Object.fromEntries(nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }]));
    saveLayout(authToken, positions)
      .then(() => setSaving('Saved'))
      .catch((err) => setSaving(err instanceof Error ? err.message : 'Save failed'))
      .finally(() => setTimeout(() => setSaving(''), 2500));
  }, [authToken, nodes]);

  const summary = useMemo(() => {
    if (!stats) return null;
    return [
      `${stats.people} people`,
      stats.bots ? `${stats.bots} bots` : '',
      `${stats.sharedTopics} shared topics`,
      `${stats.soloTopics} solo`,
      `${stats.interactionPairs} direct ties`,
      `density ${stats.density}`,
    ].filter(Boolean).join(' · ');
  }, [stats]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
        <div>
          <div className="text-sm text-white/80">Network</div>
          <div className="text-[11px] text-white/40">
            {loading ? 'Loading…' : error ? '' : summary}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saving && <span className="text-[10px] text-white/40">{saving}</span>}
          <button
            onClick={persist}
            className="text-[11px] px-2 py-1 rounded border border-white/15 text-white/60 hover:text-white/90"
          >
            Save layout
          </button>
          <button
            onClick={load}
            className="text-[11px] px-2 py-1 rounded border border-white/15 text-white/60 hover:text-white/90"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 text-[12px] text-rose-300/90">{error}</div>
      )}

      {/* Colour alone never distinguishes an edge kind — reply is solid, react
          dashed — so the legend names both cues. */}
      <div className="flex items-center gap-4 px-4 py-1.5 text-[10px] text-white/45 border-b border-white/5">
        <span className="flex items-center gap-1.5">
          <svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" stroke="#3B82C4" strokeWidth="3" opacity="0.6" /></svg>
          posts in topic
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" stroke="#8B7BB8" strokeWidth="2.5" /></svg>
          replied to
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" stroke="#C08A2E" strokeWidth="2.5" strokeDasharray="5 4" /></svg>
          reacted to
        </span>
        <span className="text-white/30">arrow points at the person acted on</span>
      </div>

      <div className="flex-1 min-h-[520px]">
        <ReactFlowProvider>
          <ContractCanvas
            initialNodes={nodes}
            initialEdges={edges}
            nodeTypes={nodeTypes}
            onNodeSelect={() => {}}
            onNodesChange={setNodes}
            onEdgesChange={setEdges}
            minimapNodeColor={(n) => (n.type !== 'personNode' ? '#3B82C4' : (n.data as { kind?: string })?.kind === 'bot' ? '#C08A2E' : '#3B9E9E')}
          />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
