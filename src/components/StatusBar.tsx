interface Props {
  graphId: string;
  nodeCount: number;
  edgeCount: number;
  contractName: string;
}

export default function StatusBar({ graphId, nodeCount, edgeCount }: Props) {
  return (
    <div className="flex items-center gap-6 border-t border-white/10 bg-slate-950/95 px-5 py-1.5">
      <span className="text-[10px] text-gray-500">Graph: {graphId}</span>
      <span className="text-[10px] text-gray-500">Nodes: {nodeCount}</span>
      <span className="text-[10px] text-gray-500">Edges: {edgeCount}</span>
      <a
        href={`https://www.vegvisr.org/gnew-viewer?graphId=${graphId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[10px] text-emerald-400 hover:text-emerald-300"
      >
        Viewable in GNewViewer
      </a>
      <span className="text-[10px] text-gray-600 ml-auto">v0.2.0</span>
    </div>
  );
}
