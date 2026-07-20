import { Handle, Position } from '@xyflow/react';
import type { ActionData } from '../../../lib/automation';

export default function ActionNode({ data }: { data: ActionData }) {
  const paramCount = data.params ? Object.keys(data.params).length : 0;
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 min-w-[150px] backdrop-blur-sm">
      <Handle type="target" position={Position.Top} className="!bg-amber-400 !w-1.5 !h-1.5" />
      <div className="text-[9px] uppercase tracking-wide text-amber-500/70">Action</div>
      <div className="text-[12px] text-amber-200 truncate">{data.label || 'Action'}</div>
      <div className="text-[10px] font-mono text-gray-500 truncate">{data.toolName}</div>
      {paramCount > 0 && (
        <div className="text-[9px] text-gray-600 mt-0.5">{paramCount} param{paramCount > 1 ? 's' : ''}</div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-amber-400 !w-1.5 !h-1.5" />
    </div>
  );
}
