import { useState } from 'react';
import type { Node, Edge } from '@xyflow/react';
import NodeInspector from './NodeInspector';
import NodePalette from './NodePalette';
import AgentExecutor from './AgentExecutor';
import { reactFlowToContract } from '../lib/contractToGraph';

interface Props {
  selectedNode: Node | null;
  nodes: Node[];
  edges: Edge[];
  userId: string;
  contractId: string;
  contractName: string;
  graphId: string;
  onUpdateNode: (id: string, data: Record<string, unknown>) => void;
  onAddNode: (type: string) => void;
  onDeleteNode: (id: string) => void;
}

export default function Sidebar({ selectedNode, nodes, edges, userId, contractId, contractName, graphId, onUpdateNode, onAddNode, onDeleteNode }: Props) {
  const [jsonOpen, setJsonOpen] = useState(false);

  const contractJson = jsonOpen ? JSON.stringify(reactFlowToContract(nodes, edges), null, 2) : '';

  return (
    <div className="w-[280px] flex-shrink-0 border-l border-white/10 bg-slate-950/85 overflow-y-auto flex flex-col">
      <div className="flex-1 px-3 py-4 space-y-5">
        {/* Node Inspector */}
        <section>
          <SectionLabel>NODE INSPECTOR</SectionLabel>
          <NodeInspector selectedNode={selectedNode} onUpdateNode={onUpdateNode} onDeleteNode={onDeleteNode} />
        </section>

        {/* Drag to Add */}
        <section>
          <SectionLabel>DRAG TO ADD</SectionLabel>
          <NodePalette onAddNode={onAddNode} />
        </section>

        {/* Divider */}
        <div className="border-t border-white/8" />

        {/* Agent Executor */}
        <section>
          <SectionLabel>AGENT TASK</SectionLabel>
          <AgentExecutor userId={userId} contractId={contractId} contractName={contractName} graphId={graphId} />
        </section>

        {/* Divider */}
        <div className="border-t border-white/8" />

        {/* Contract JSON */}
        <section>
          <button
            type="button"
            onClick={() => setJsonOpen(!jsonOpen)}
            className="flex items-center gap-2 w-full text-left"
          >
            <span className="text-[11px] font-semibold text-gray-500 tracking-[0.05em]">CONTRACT JSON</span>
            <span className="text-[10px] text-gray-600">{jsonOpen ? '▼' : '▶'}</span>
          </button>
          {jsonOpen && (
            <pre className="mt-2 rounded-xl border border-white/10 bg-slate-950/80 p-3 text-[10px] text-emerald-300/80 font-mono overflow-x-auto max-h-[400px] overflow-y-auto whitespace-pre-wrap break-all">
              {contractJson}
            </pre>
          )}
        </section>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold text-gray-500 tracking-[0.05em] mb-2">
      {children}
    </div>
  );
}
