import { Handle, Position } from '@xyflow/react';
import type { ToggleData } from '../../lib/contractToGraph';

export default function ToggleNode({ data }: { data: ToggleData }) {
  const label = data.featureName.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());

  return (
    <div className={`rounded-lg border px-3 py-2 min-w-[110px] backdrop-blur-sm ${
      data.enabled
        ? 'border-emerald-500/30 bg-emerald-500/10'
        : 'border-white/8 bg-emerald-500/5'
    }`}>
      <Handle type="target" position={Position.Top} className="!bg-emerald-400 !w-1.5 !h-1.5" />

      <div className="flex items-center justify-between gap-2">
        <span className={`text-[11px] ${data.enabled ? 'text-emerald-300' : 'text-gray-500'}`}>
          {label}
        </span>
        <div className={`w-7 h-3.5 rounded-full relative transition-colors ${
          data.enabled ? 'bg-emerald-500/40' : 'bg-white/10'
        }`}>
          <div className={`absolute top-0.5 w-2.5 h-2.5 rounded-full transition-all ${
            data.enabled ? 'left-3.5 bg-emerald-400' : 'left-0.5 bg-gray-500'
          }`} />
        </div>
      </div>
    </div>
  );
}
