import { Handle, Position } from '@xyflow/react';

interface Data {
  label: string;
  messages: number;
  topics: number;
  inDegree: number;
  outDegree: number;
}

// A person. Size is not encoded here — the numbers are shown literally, because
// a reader of a sociogram should not have to estimate a centrality from an area.
export default function PersonNode({ data }: { data: Data }) {
  return (
    <div className="rounded-full border border-teal-500/40 bg-teal-500/10 px-4 py-3 min-w-[150px] text-center backdrop-blur-sm">
      <Handle type="source" position={Position.Right} className="!bg-teal-400/60" />
      <Handle type="target" position={Position.Right} className="!bg-teal-400/60" />
      <div className="text-[11px] font-medium text-teal-100">{data.label}</div>
      <div className="text-[10px] text-teal-300/70">{data.messages} messages · {data.topics} topics</div>
      {(data.inDegree > 0 || data.outDegree > 0) && (
        <div className="text-[9px] text-teal-300/50 mt-0.5">
          in {data.inDegree} · out {data.outDegree}
        </div>
      )}
    </div>
  );
}
