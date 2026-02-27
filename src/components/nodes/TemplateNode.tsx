import { Handle, Position } from '@xyflow/react';

export interface TemplateNodeData {
  templateId: string;
  templateName: string;
  category: string;
  [key: string]: unknown;
}

export default function TemplateNode({ data }: { data: TemplateNodeData }) {
  return (
    <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 min-w-[120px] backdrop-blur-sm">
      <Handle type="target" position={Position.Top} className="!bg-rose-400 !w-1.5 !h-1.5" />
      <div className="min-w-0">
        <div className="text-[10px] text-gray-500 truncate">{data.category}</div>
        <div className="text-[11px] text-rose-300 font-semibold truncate">{data.templateName}</div>
      </div>
    </div>
  );
}
