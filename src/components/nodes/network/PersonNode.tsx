import { Handle, Position } from '@xyflow/react';

interface Data {
  kind: 'person' | 'bot';
  label: string;
  avatar?: string | null;
  role?: string | null;
  messages: number;
  topics: number;
  inDegree: number;
  outDegree: number;
}

// A participant. Bots get their own colour and a label, because "who is a person
// here" is the first question anyone asks of a social diagram — and an unmarked
// bot silently inflates every human's apparent connectedness.
export default function PersonNode({ data }: { data: Data }) {
  const isBot = data.kind === 'bot';
  const ring = isBot ? 'border-amber-500/50 bg-amber-500/10' : 'border-teal-500/40 bg-teal-500/10';
  const title = isBot ? 'text-amber-100' : 'text-teal-100';
  const sub = isBot ? 'text-amber-300/70' : 'text-teal-300/70';
  const faint = isBot ? 'text-amber-300/50' : 'text-teal-300/50';

  return (
    <div className={`rounded-full border px-4 py-3 min-w-[160px] text-center backdrop-blur-sm ${ring}`}>
      <Handle type="source" position={Position.Right} className="!bg-white/30" />
      <Handle type="target" position={Position.Right} className="!bg-white/30" />
      <div className="flex items-center justify-center gap-1.5">
        {data.avatar && (
          <img src={data.avatar} alt="" className="w-4 h-4 rounded-full object-cover" />
        )}
        <span className={`text-[11px] font-medium ${title}`}>{data.label}</span>
      </div>
      <div className={`text-[9px] uppercase tracking-wide ${faint}`}>
        {isBot ? 'bot' : data.role || 'member'}
      </div>
      <div className={`text-[10px] ${sub}`}>{data.messages} messages · {data.topics} topics</div>
      {(data.inDegree > 0 || data.outDegree > 0) && (
        <div className={`text-[9px] mt-0.5 ${faint}`}>in {data.inDegree} · out {data.outDegree}</div>
      )}
    </div>
  );
}
