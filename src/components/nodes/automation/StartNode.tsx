import { Handle, Position } from '@xyflow/react';
import type { StartData } from '../../../lib/automation';

export default function StartNode({ data }: { data: StartData }) {
  return (
    <div className="rounded-full border border-purple-500/40 bg-purple-500/15 px-4 py-2 min-w-[90px] text-center backdrop-blur-sm">
      <span className="text-[12px] font-semibold text-purple-200">▶ {data.label || 'Start'}</span>
      <Handle type="source" position={Position.Bottom} className="!bg-purple-400 !w-1.5 !h-1.5" />
    </div>
  );
}
