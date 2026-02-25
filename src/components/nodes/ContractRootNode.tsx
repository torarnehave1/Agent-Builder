import { Handle, Position } from '@xyflow/react';
import type { ContractRootData } from '../../lib/contractToGraph';

export default function ContractRootNode({ data }: { data: ContractRootData }) {
  return (
    <div className="rounded-2xl border-2 border-purple-600 bg-purple-600/20 px-5 py-4 min-w-[180px] backdrop-blur-sm">
      <Handle type="source" position={Position.Top} className="!bg-purple-500 !w-2 !h-2" />
      <Handle type="source" position={Position.Bottom} className="!bg-purple-500 !w-2 !h-2" id="bottom" />
      <Handle type="source" position={Position.Left} className="!bg-purple-500 !w-2 !h-2" id="left" />
      <Handle type="source" position={Position.Right} className="!bg-purple-500 !w-2 !h-2" id="right" />

      <div className="flex items-center gap-3 mb-2">
        <div className="w-7 h-7 rounded-full bg-purple-600 flex items-center justify-center text-white text-sm font-bold">
          C
        </div>
        <span className="text-xs text-purple-300/70">{data.contractType}</span>
      </div>
      <div className="text-sm font-bold text-white">{data.label}</div>
      {data.version && (
        <div className="text-[10px] text-gray-400 mt-1">v{data.version}</div>
      )}
    </div>
  );
}
