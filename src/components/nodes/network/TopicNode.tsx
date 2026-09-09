import { Handle, Position } from '@xyflow/react';

interface Data {
  label: string;
  messages: number;
  participants: number;
  shared: boolean;
}

// A topic — a chat group treated as a subject. Solo topics (one participant)
// are deliberately kept and marked: they carry no shared-interest signal, but
// they are a real statement about what that person is working on, and a
// person-to-person graph would discard them entirely.
export default function TopicNode({ data }: { data: Data }) {
  const shared = data.shared;
  return (
    <div
      className={
        'rounded-lg border px-3 py-2 min-w-[190px] max-w-[240px] backdrop-blur-sm ' +
        (shared
          ? 'border-blue-500/40 bg-blue-500/10'
          : 'border-purple-500/40 bg-purple-500/10 border-dashed')
      }
    >
      <Handle type="target" position={Position.Left} className="!bg-blue-400/60" />
      <Handle type="source" position={Position.Left} className="!bg-blue-400/60" />
      <div className={'text-[9px] uppercase tracking-wide ' + (shared ? 'text-blue-300/70' : 'text-purple-300/70')}>
        {shared ? `shared · ${data.participants} people` : 'solo'}
      </div>
      <div className={'text-[11px] font-medium break-words ' + (shared ? 'text-blue-100' : 'text-purple-100')}>
        {data.label}
      </div>
      <div className={'text-[10px] ' + (shared ? 'text-blue-300/60' : 'text-purple-300/60')}>
        {data.messages} messages
      </div>
    </div>
  );
}
