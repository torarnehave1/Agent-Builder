import { Handle, Position } from '@xyflow/react';
import type { SectionData } from '../../lib/contractToGraph';

export default function SectionNode({ data }: { data: SectionData }) {
  return (
    <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-2 min-w-[80px] backdrop-blur-sm">
      <Handle type="target" position={Position.Top} className="!bg-blue-400 !w-1.5 !h-1.5" />

      <span className="text-xs font-semibold text-blue-400 capitalize">
        {data.sectionName}
      </span>
    </div>
  );
}
