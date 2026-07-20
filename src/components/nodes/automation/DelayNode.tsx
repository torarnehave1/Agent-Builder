import { Handle, Position } from '@xyflow/react';
import type { DelayData } from '../../../lib/automation';

export default function DelayNode({ data }: { data: DelayData }) {
  return (
    <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 min-w-[120px] backdrop-blur-sm">
      <Handle type="target" position={Position.Top} className="!bg-blue-400 !w-1.5 !h-1.5" />
      <div className="text-[9px] uppercase tracking-wide text-blue-500/70">Delay</div>
      <div className="text-[12px] text-blue-200">⏱ {data.amount} {data.unit}</div>
      <Handle type="source" position={Position.Bottom} className="!bg-blue-400 !w-1.5 !h-1.5" />
    </div>
  );
}
