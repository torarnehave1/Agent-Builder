import { Handle, Position } from '@xyflow/react';

export interface ToolNodeData {
  toolName: string;
  displayName: string;
  description: string;
  enabled: boolean;
  [key: string]: unknown;
}

export default function ToolNode({ data }: { data: ToolNodeData }) {
  return (
    <div className={`rounded-lg border px-3 py-2 min-w-[130px] backdrop-blur-sm ${
      data.enabled
        ? 'border-amber-500/30 bg-amber-500/10'
        : 'border-white/8 bg-amber-500/5'
    }`}>
      <Handle type="target" position={Position.Top} className="!bg-amber-400 !w-1.5 !h-1.5" />
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className={`text-[11px] block truncate ${data.enabled ? 'text-amber-300' : 'text-gray-500'}`}>
            {data.displayName}
          </span>
          <span className="text-[9px] text-gray-600 block truncate">{data.description}</span>
        </div>
        <div className={`w-7 h-3.5 rounded-full relative transition-colors flex-shrink-0 ${
          data.enabled ? 'bg-amber-500/40' : 'bg-white/10'
        }`}>
          <div className={`absolute top-0.5 w-2.5 h-2.5 rounded-full transition-all ${
            data.enabled ? 'left-3.5 bg-amber-400' : 'left-0.5 bg-gray-500'
          }`} />
        </div>
      </div>
    </div>
  );
}
