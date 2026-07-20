import type { NoteData } from '../../../lib/automation';

// Non-executing sticky note. No handles — it documents the flow, it isn't part of it.
export default function NoteNode({ data }: { data: NoteData }) {
  return (
    <div className="rounded-md border border-slate-500/30 bg-slate-500/10 px-3 py-2 min-w-[120px] max-w-[220px] backdrop-blur-sm">
      <div className="text-[9px] uppercase tracking-wide text-slate-400/70">Note</div>
      <div className="text-[11px] text-slate-300 whitespace-pre-wrap break-words">{data.text || 'Note…'}</div>
    </div>
  );
}
