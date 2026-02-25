import { Handle, Position } from '@xyflow/react';
import type { CategoryData } from '../../lib/contractToGraph';

const colorMap: Record<string, { bg: string; border: string; dot: string; text: string }> = {
  blue: {
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/50',
    dot: 'bg-blue-500',
    text: 'text-blue-300',
  },
  green: {
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/50',
    dot: 'bg-emerald-500',
    text: 'text-emerald-300',
  },
  purple: {
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/50',
    dot: 'bg-purple-500',
    text: 'text-purple-300',
  },
};

export default function CategoryNode({ data }: { data: CategoryData }) {
  const colors = colorMap[data.color] || colorMap.blue;

  return (
    <div className={`rounded-xl border-[1.5px] ${colors.border} ${colors.bg} px-4 py-3 min-w-[170px] backdrop-blur-sm`}>
      <Handle type="target" position={Position.Top} className="!bg-purple-400 !w-2 !h-2" />
      <Handle type="source" position={Position.Bottom} className="!bg-gray-400 !w-2 !h-2" id="bottom" />
      <Handle type="source" position={Position.Left} className="!bg-gray-400 !w-2 !h-2" id="left" />
      <Handle type="source" position={Position.Right} className="!bg-gray-400 !w-2 !h-2" id="right" />

      <div className="flex items-center gap-2 mb-1">
        <div className={`w-2.5 h-2.5 rounded-full ${colors.dot}`} />
        <span className="text-[13px] font-bold text-white">{data.label}</span>
      </div>
      <div className="text-[11px] text-gray-400">{data.description}</div>
    </div>
  );
}
