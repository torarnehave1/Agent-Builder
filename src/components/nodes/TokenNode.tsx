import { Handle, Position } from '@xyflow/react';
import type { TokenData } from '../../lib/contractToGraph';

export default function TokenNode({ data }: { data: TokenData }) {
  const isColor = data.tokenValue.startsWith('#') || data.tokenValue.startsWith('rgb');

  return (
    <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 px-3 py-2 min-w-[120px] backdrop-blur-sm">
      <Handle type="target" position={Position.Top} className="!bg-blue-400 !w-1.5 !h-1.5" />

      <div className="flex items-center gap-2">
        {isColor && (
          <div
            className="w-4 h-4 rounded border border-white/20 flex-shrink-0"
            style={{ background: data.tokenValue }}
          />
        )}
        <div className="min-w-0">
          <div className="text-[10px] text-gray-500 truncate">{data.tokenKey}</div>
          <div className="text-[11px] text-blue-300 font-mono truncate">{data.tokenValue}</div>
        </div>
      </div>
    </div>
  );
}
