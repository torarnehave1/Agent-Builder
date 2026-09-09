import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReactFlowProvider, type Node, type Edge, type NodeTypes } from '@xyflow/react';
import ContractCanvas from './ContractCanvas';
import PersonNode from './nodes/network/PersonNode';
import TopicNode from './nodes/network/TopicNode';
import { fetchNetwork, networkToReactFlow, type NetworkStats } from '../lib/networkToGraph';

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

  // User ids are opaque; until a profile lookup is wired, show a short prefix
  // rather than a 36-character uuid that makes every node unreadable.
  const displayName = useCallback((id: string) => id.slice(0, 8), []);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    fetchNetwork(authToken)
      .then((net) => {
        const flow = networkToReactFlow(net, displayName);
        setNodes(flow.nodes);
        setEdges(flow.edges);
        setStats(net.stats);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load the network'))
      .finally(() => setLoading(false));
  }, [authToken, displayName]);

  useEffect(load, [load]);

  const summary = useMemo(() => {
    if (!stats) return null;
    return [
      `${stats.people} people`,
      `${stats.sharedTopics} shared topics`,
      `${stats.soloTopics} solo`,
      `${stats.interactionPairs} direct ties`,
      `density ${stats.density}`,
    ].join(' · ');
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
        <button
          onClick={load}
          className="text-[11px] px-2 py-1 rounded border border-white/15 text-white/60 hover:text-white/90"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 text-[12px] text-rose-300/90">{error}</div>
      )}

      <div className="flex-1 min-h-[520px]">
        <ReactFlowProvider>
          <ContractCanvas
            initialNodes={nodes}
            initialEdges={edges}
            nodeTypes={nodeTypes}
            onNodeSelect={() => {}}
            onNodesChange={setNodes}
            onEdgesChange={setEdges}
            minimapNodeColor={(n) => (n.type === 'personNode' ? '#3B9E9E' : '#3B82C4')}
          />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
