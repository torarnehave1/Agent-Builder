import { Handle, Position } from '@xyflow/react';
import type { NotifyData } from '../../../lib/automation';
import TestBadge from './TestBadge';

export default function NotifyNode({ data }: { data: NotifyData & { _test?: string } }) {
  return (
    <div className="relative rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 min-w-[140px] backdrop-blur-sm">
      <TestBadge status={data._test} />
      <Handle type="target" position={Position.Top} className="!bg-rose-400 !w-1.5 !h-1.5" />
      <div className="text-[9px] uppercase tracking-wide text-rose-500/70">Notify</div>
      <div className="text-[12px] text-rose-200">🔔 {data.channel}{data.channel === 'email' && data.to ? ` → ${data.to}` : ''}</div>
      {data.message && <div className="text-[10px] text-gray-500 truncate max-w-[160px]">{data.message}</div>}
      <Handle type="source" position={Position.Bottom} className="!bg-rose-400 !w-1.5 !h-1.5" />
    </div>
  );
}
