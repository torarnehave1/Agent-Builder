import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  addEdge,
  type Node,
  type Edge,
  type OnConnect,
  type NodeTypes,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import ContractRootNode from './nodes/ContractRootNode';
import CategoryNode from './nodes/CategoryNode';
import TokenNode from './nodes/TokenNode';
import ToggleNode from './nodes/ToggleNode';
import SectionNode from './nodes/SectionNode';

interface Props {
  initialNodes: Node[];
  initialEdges: Edge[];
  onNodeSelect: (node: Node | null) => void;
  onNodesChange: (nodes: Node[]) => void;
  onEdgesChange: (edges: Edge[]) => void;
  onNodeDragStop?: () => void;
  onDropNode?: (type: string, position: { x: number; y: number }) => void;
  onDeleteNodes?: (nodes: Node[]) => void;
}

export default function ContractCanvas({
  initialNodes,
  initialEdges,
  onNodeSelect,
  onNodesChange: onNodesChangeCallback,
  onEdgesChange: onEdgesChangeCallback,
  onNodeDragStop,
  onDropNode,
  onDeleteNodes,
}: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const { screenToFlowPosition } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const onDropNodeRef = useRef(onDropNode);
  onDropNodeRef.current = onDropNode;

  // Sync when parent adds/removes nodes (e.g. drop from palette, contract change)
  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  // Native DOM event listeners for drag-and-drop (bypasses React Flow's event interception)
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      const nodeType = e.dataTransfer?.getData('application/reactflow-nodetype');
      if (!nodeType || !onDropNodeRef.current) return;

      const position = screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });
      onDropNodeRef.current(nodeType, position);
    };

    el.addEventListener('dragover', handleDragOver);
    el.addEventListener('drop', handleDrop);
    return () => {
      el.removeEventListener('dragover', handleDragOver);
      el.removeEventListener('drop', handleDrop);
    };
  }, [screenToFlowPosition]);

  const nodeTypes: NodeTypes = useMemo(() => ({
    contractRoot: ContractRootNode,
    category: CategoryNode,
    token: TokenNode,
    toggle: ToggleNode,
    section: SectionNode,
  }), []);

  const onConnect: OnConnect = useCallback(
    (params) => {
      setEdges((eds) => {
        const newEdges = addEdge(
          { ...params, style: { stroke: 'rgba(124,58,237,0.4)', strokeWidth: 1.5 }, animated: true },
          eds
        );
        onEdgesChangeCallback(newEdges);
        return newEdges;
      });
    },
    [setEdges, onEdgesChangeCallback]
  );

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onNodeSelect(node);
    },
    [onNodeSelect]
  );

  const handlePaneClick = useCallback(() => {
    onNodeSelect(null);
  }, [onNodeSelect]);

  // Sync nodes/edges to parent on every change
  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      onNodesChange(changes);
      // We need to pass the latest nodes after the change
      // React Flow's setNodes is async, so we schedule it
      setTimeout(() => {
        setNodes((current) => {
          onNodesChangeCallback(current);
          return current;
        });
      }, 0);
    },
    [onNodesChange, setNodes, onNodesChangeCallback]
  );

  return (
    <div ref={wrapperRef} className="flex-1 h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        onNodeDragStop={onNodeDragStop ? () => onNodeDragStop() : undefined}
        onNodesDelete={onDeleteNodes}
        deleteKeyCode={['Backspace', 'Delete']}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.3}
        maxZoom={2}
        defaultEdgeOptions={{
          style: { stroke: 'rgba(124,58,237,0.3)', strokeWidth: 1.5 },
          animated: true,
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="rgba(255,255,255,0.04)"
        />
        <Controls
          showInteractive={false}
          className="!bg-slate-900/80 !border-white/10 !rounded-lg [&>button]:!bg-slate-800 [&>button]:!border-white/10 [&>button]:!text-white/60 [&>button:hover]:!bg-slate-700"
        />
        <MiniMap
          nodeColor={(node) => {
            switch (node.type) {
              case 'contractRoot': return '#7c3aed';
              case 'category': return '#3b82f6';
              case 'token': return '#60a5fa';
              case 'toggle': return '#22c55e';
              case 'section': return '#3b82f6';
              default: return '#6b7280';
            }
          }}
          maskColor="rgba(0,0,0,0.7)"
          className="!bg-slate-900/80 !border-white/10 !rounded-lg"
        />
      </ReactFlow>
    </div>
  );
}

/**
 * Expose methods to add/update nodes from outside
 */
export function createNewNode(type: string, existingNodes: Node[]): Node {
  const offset = existingNodes.length * 30;
  const basePosition = { x: 300 + offset, y: 400 + offset };
  const id = `${type}-${Date.now()}`;

  switch (type) {
    case 'token':
      return {
        id,
        type: 'token',
        position: basePosition,
        data: { tokenKey: '--new-token', tokenValue: '#ffffff' },
      };
    case 'toggle':
      return {
        id,
        type: 'toggle',
        position: basePosition,
        data: { featureName: 'newFeature', enabled: false },
      };
    case 'section':
      return {
        id,
        type: 'section',
        position: basePosition,
        data: { sectionName: 'new-section' },
      };
    case 'token-rule':
      return {
        id,
        type: 'token',
        position: basePosition,
        data: { tokenKey: 'Rule', tokenValue: 'new validation rule' },
      };
    case 'contractRoot':
      return {
        id,
        type: 'contractRoot',
        position: basePosition,
        data: { label: 'New Contract', contractType: 'html-node', version: '1.0' },
      };
    case 'category':
      return {
        id,
        type: 'category',
        position: basePosition,
        data: { label: 'New Category', description: 'description', color: 'purple' },
      };
    default:
      return {
        id,
        type: 'token',
        position: basePosition,
        data: { tokenKey: 'unknown', tokenValue: '' },
      };
  }
}
