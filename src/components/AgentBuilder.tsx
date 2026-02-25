import { useState, useCallback, useEffect, useRef } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { ReactFlowProvider } from '@xyflow/react';
import { AuthBar, EcosystemNav, LanguageSelector } from 'vegvisr-ui-kit';
import ContractCanvas, { createNewNode } from './ContractCanvas';
import Sidebar from './Sidebar';
import StatusBar from './StatusBar';
import GraphSelector from './GraphSelector';
import { contractToReactFlow, DEFAULT_CONTRACT } from '../lib/contractToGraph';
import type { AgentContract } from '../types/contract';

interface Props {
  userId: string;
  userEmail: string;
  language: string;
  onLanguageChange: (lang: 'en' | 'no') => void;
  onLogout: () => void;
}

const CONTRACT_API = 'https://knowledge.vegvisr.org/getContract';
const AGENT_API = 'https://agent.vegvisr.org';

export default function AgentBuilder({ userId, userEmail, language, onLanguageChange, onLogout }: Props) {
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [contractName, setContractName] = useState('Dark Glass');
  const [contractId, setContractId] = useState('contract_dark_glass');
  const [graphId, setGraphId] = useState('graph_agent_builder_development');
  const [loading, setLoading] = useState(true);
  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  const [graphState, setGraphState] = useState<{ nodes: Node[]; edges: Edge[] }>({ nodes: [], edges: [] });
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Apply saved layout positions over computed defaults
  const applyLayout = (nodes: Node[], layout: Record<string, { x: number; y: number }> | null): Node[] => {
    if (!layout) return nodes;
    return nodes.map(n => layout[n.id] ? { ...n, position: layout[n.id] } : n);
  };

  // Debounced save layout to API
  const saveLayout = useCallback((nodes: Node[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const layout: Record<string, { x: number; y: number }> = {};
      for (const n of nodes) {
        layout[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
      }
      fetch(`${AGENT_API}/layout`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractId, layout }),
      }).catch(() => {/* silent */});
    }, 800);
  }, [contractId]);

  // Load contract + saved layout from API
  useEffect(() => {
    const loadContract = async () => {
      setLoading(true);
      try {
        // Fetch contract and layout in parallel
        const [contractRes, layoutRes] = await Promise.all([
          fetch(`${CONTRACT_API}?id=${contractId}`),
          fetch(`${AGENT_API}/layout?contractId=${contractId}`).catch(() => null),
        ]);

        let savedLayout: Record<string, { x: number; y: number }> | null = null;
        if (layoutRes?.ok) {
          const layoutData = await layoutRes.json();
          savedLayout = layoutData.layout || null;
        }

        if (contractRes.ok) {
          const data = await contractRes.json();
          const contract: AgentContract = data.contract ?? data;
          const { nodes, edges } = contractToReactFlow(contract, contractName);
          const finalNodes = applyLayout(nodes, savedLayout);
          nodesRef.current = finalNodes;
          edgesRef.current = edges;
          setGraphState({ nodes: finalNodes, edges });
        } else {
          const { nodes, edges } = contractToReactFlow(DEFAULT_CONTRACT, contractName);
          const finalNodes = applyLayout(nodes, savedLayout);
          nodesRef.current = finalNodes;
          edgesRef.current = edges;
          setGraphState({ nodes: finalNodes, edges });
        }
      } catch {
        const { nodes, edges } = contractToReactFlow(DEFAULT_CONTRACT, contractName);
        nodesRef.current = nodes;
        edgesRef.current = edges;
        setGraphState({ nodes, edges });
      } finally {
        setLoading(false);
      }
    };
    loadContract();
  }, [contractId, contractName]);

  const handleNodeSelect = useCallback((node: Node | null) => {
    setSelectedNode(node);
  }, []);

  const handleNodesChange = useCallback((nodes: Node[]) => {
    nodesRef.current = nodes;
  }, []);

  const handleNodeDragStop = useCallback(() => {
    saveLayout(nodesRef.current);
  }, [saveLayout]);

  const handleEdgesChange = useCallback((edges: Edge[]) => {
    edgesRef.current = edges;
  }, []);

  const handleUpdateNode = useCallback((id: string, data: Record<string, unknown>) => {
    nodesRef.current = nodesRef.current.map((n) =>
      n.id === id ? { ...n, data } : n
    );
    setGraphState({ nodes: [...nodesRef.current], edges: edgesRef.current });
    setSelectedNode((prev) => prev?.id === id ? { ...prev, data } : prev);
  }, []);

  const handleDeleteNode = useCallback((id: string) => {
    nodesRef.current = nodesRef.current.filter((n) => n.id !== id);
    edgesRef.current = edgesRef.current.filter((e) => e.source !== id && e.target !== id);
    setGraphState({ nodes: [...nodesRef.current], edges: [...edgesRef.current] });
    setSelectedNode((prev) => prev?.id === id ? null : prev);
    saveLayout(nodesRef.current);
  }, [saveLayout]);

  const handleDeleteNodes = useCallback((deleted: Node[]) => {
    const ids = new Set(deleted.map((n) => n.id));
    nodesRef.current = nodesRef.current.filter((n) => !ids.has(n.id));
    edgesRef.current = edgesRef.current.filter((e) => !ids.has(e.source) && !ids.has(e.target));
    setGraphState({ nodes: [...nodesRef.current], edges: [...edgesRef.current] });
    setSelectedNode((prev) => prev && ids.has(prev.id) ? null : prev);
    saveLayout(nodesRef.current);
  }, [saveLayout]);

  const handleAddNode = useCallback((type: string) => {
    const newNode = createNewNode(type, nodesRef.current);
    nodesRef.current = [...nodesRef.current, newNode];
    setGraphState({ nodes: [...nodesRef.current], edges: edgesRef.current });
  }, []);

  const handleDropNode = useCallback((type: string, position: { x: number; y: number }) => {
    const newNode = createNewNode(type, nodesRef.current);
    newNode.position = position;
    nodesRef.current = [...nodesRef.current, newNode];
    setGraphState({ nodes: [...nodesRef.current], edges: edgesRef.current });
    saveLayout(nodesRef.current);
  }, [saveLayout]);

  // Contract selector
  const contracts = [
    { id: 'contract_open', name: 'Open (any type)' },
    { id: 'contract_knowledge_graph_me', name: 'KnowledgeGraphME' },
    { id: 'contract_dark_glass', name: 'Dark Glass' },
    { id: 'contract_base_html', name: 'Base HTML' },
    { id: 'contract_guided_builder', name: 'Guided Builder' },
    { id: 'contract_editable_html_template', name: 'Editable HTML Template' },
  ];

  const handleContractChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = contracts.find(c => c.id === e.target.value);
    if (selected) {
      setContractId(selected.id);
      setContractName(selected.name);
      setSelectedNode(null);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-white">
      {/* Top Navigation */}
      <header className="flex items-center justify-between px-5 h-[52px] border-b border-white/10 bg-slate-950/95 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-base font-bold text-white">Vegvisr</span>
          <span className="text-base text-purple-500">Agent Builder</span>
          <GraphSelector graphId={graphId} onGraphChange={setGraphId} />
          <span className="text-xs text-gray-600">/</span>
          <select
            value={contractId}
            onChange={handleContractChange}
            className="text-xs text-purple-400 bg-transparent border-none focus:outline-none cursor-pointer"
          >
            {contracts.map(c => (
              <option key={c.id} value={c.id} className="bg-slate-900 text-white">
                Contract: {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <button className="rounded-md border border-purple-600/40 bg-purple-600/20 px-4 py-1.5 text-xs font-semibold text-purple-400 hover:bg-purple-600/30">
            Preview
          </button>
          <button className="rounded-md bg-gradient-to-r from-purple-600 to-purple-700 px-4 py-1.5 text-xs font-semibold text-white shadow-md shadow-purple-900/40">
            Execute
          </button>
          <span className="w-px h-5 bg-white/10" />
          <LanguageSelector value={language} onChange={onLanguageChange} />
          <AuthBar
            userEmail={userEmail}
            badgeLabel="Agent Builder"
            signInLabel="Sign in"
            onSignIn={() => {}}
            logoutLabel="Log out"
            onLogout={onLogout}
          />
        </div>
      </header>

      {/* Ecosystem Navigation */}
      <EcosystemNav className="border-b border-white/10 bg-slate-950/90" />

      {/* Main Content: Canvas + Sidebar */}
      <div className="flex flex-1 min-h-0">
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-sm text-gray-500">Loading contract...</div>
          </div>
        ) : (
          <ReactFlowProvider>
            <ContractCanvas
              initialNodes={graphState.nodes}
              initialEdges={graphState.edges}
              onNodeSelect={handleNodeSelect}
              onNodesChange={handleNodesChange}
              onEdgesChange={handleEdgesChange}
              onNodeDragStop={handleNodeDragStop}
              onDropNode={handleDropNode}
              onDeleteNodes={handleDeleteNodes}
            />
          </ReactFlowProvider>
        )}
        <Sidebar
          selectedNode={selectedNode}
          nodes={graphState.nodes}
          edges={graphState.edges}
          userId={userId}
          contractId={contractId}
          contractName={contractName}
          graphId={graphId}
          onUpdateNode={handleUpdateNode}
          onAddNode={handleAddNode}
          onDeleteNode={handleDeleteNode}
        />
      </div>

      {/* Status Bar */}
      <StatusBar
        graphId={graphId}
        nodeCount={nodesRef.current.length}
        edgeCount={edgesRef.current.length}
        contractName={contractName}
      />
    </div>
  );
}
