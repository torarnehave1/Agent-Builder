import { Handle, Position } from '@xyflow/react';
import type { LoopData } from '../../../lib/automation';

export default function LoopNode({ data }: { data: LoopData }) {
  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 min-w-[130px] backdrop-blur-sm">
      <Handle type="target" position={Position.Top} className="!bg-emerald-400 !w-1.5 !h-1.5" />
      <div className="text-[9px] uppercase tracking-wide text-emerald-500/70">Loop</div>
      <div className="text-[12px] text-emerald-200">↻ {data.times}×</div>
      {data.over && <div className="text-[10px] text-gray-500 truncate">over {data.over}</div>}
      <Handle type="source" position={Position.Bottom} className="!bg-emerald-400 !w-1.5 !h-1.5" />
    </div>
  );
}
