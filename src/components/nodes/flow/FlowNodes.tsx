import { Handle, Position } from '@xyflow/react';
import type { FlowHeaderData, FlowStepData } from '../../../lib/flowGraph';

/** Colour per flow-step kind (flows-worker/compile.js STEP_KINDS). */
export const FLOW_KIND_STYLE: Record<string, { box: string; tag: string; text: string; hex: string; name: string }> = {
  action:   { box: 'border-amber-500/30 bg-amber-500/10',     tag: 'text-amber-500/80',   text: 'text-amber-200',   hex: '#f59e0b', name: 'Action' },
  approval: { box: 'border-emerald-500/40 bg-emerald-500/10', tag: 'text-emerald-400/80', text: 'text-emerald-200', hex: '#10b981', name: 'Approval' },
  agent:    { box: 'border-sky-500/30 bg-sky-500/10',         tag: 'text-sky-400/80',     text: 'text-sky-200',     hex: '#0ea5e9', name: 'Agent' },
  route:    { box: 'border-violet-500/30 bg-violet-500/10',   tag: 'text-violet-400/80',  text: 'text-violet-200',  hex: '#8b5cf6', name: 'Route' },
  wait:     { box: 'border-blue-500/30 bg-blue-500/10',       tag: 'text-blue-400/80',    text: 'text-blue-200',    hex: '#3b82f6', name: 'Wait' },
  loop:     { box: 'border-fuchsia-500/30 bg-fuchsia-500/10', tag: 'text-fuchsia-400/80', text: 'text-fuchsia-200', hex: '#d946ef', name: 'Loop' },
  subflow:  { box: 'border-indigo-500/30 bg-indigo-500/10',   tag: 'text-indigo-400/80',  text: 'text-indigo-200',  hex: '#6366f1', name: 'Subflow' },
  note:     { box: 'border-slate-500/30 bg-slate-500/10',     tag: 'text-slate-400/80',   text: 'text-slate-200',   hex: '#64748b', name: 'Note' },
};

export function kindStyle(kind: string) {
  return FLOW_KIND_STYLE[kind] || FLOW_KIND_STYLE.note;
}

export function FlowHeaderNode({ data }: { data: FlowHeaderData }) {
  const inputs = data.inputs ? Object.keys(data.inputs) : [];
  const sends = data.limits?.maxExternalSends;
  return (
    <div className="relative rounded-lg border border-purple-500/40 bg-purple-500/15 px-3 py-2 w-[240px] backdrop-blur-sm">
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] uppercase tracking-wide text-purple-300/80">VEGR Flow</span>
        {data.status && <span className="rounded bg-white/10 px-1 text-[9px] text-white/60">{data.status}</span>}
      </div>
      <div className="text-[13px] font-semibold text-purple-100 truncate">{data.label}</div>
      {inputs.length > 0 && <div className="text-[10px] text-white/50 truncate">inputs: {inputs.join(', ')}</div>}
      {sends !== undefined && <div className="text-[10px] text-white/40">max {String(sends)} sends</div>}
      <Handle type="source" position={Position.Bottom} className="!bg-purple-400 !w-1.5 !h-1.5" />
    </div>
  );
}

export function FlowStepNode({ data }: { data: FlowStepData }) {
  const s = kindStyle(data.kind);
  const sub =
    data.kind === 'approval'
      ? `${data.approver || 'owner'} · ${data.timeout || '24h'}${data.previewTool ? ` · ${data.previewTool}` : ''}`
      : data.toolName || '';
  return (
    <div className={`relative rounded-lg border ${s.box} px-3 py-2 w-[220px] backdrop-blur-sm`}>
      <Handle type="target" position={Position.Top} className="!bg-slate-300 !w-1.5 !h-1.5" />
      <div className={`text-[9px] uppercase tracking-wide ${s.tag}`}>{s.name}</div>
      <div className={`text-[12px] ${s.text} truncate`}>{data.label}</div>
      {sub && <div className="text-[10px] font-mono text-gray-500 truncate">{sub}</div>}
      {data.forEach && (
        <div className="text-[9px] text-gray-500 truncate">for each {data.forEach}{data.maxItems ? ` (max ${data.maxItems})` : ''}</div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-slate-300 !w-1.5 !h-1.5" />
    </div>
  );
}

/** Read-only details of the selected flow node, for the right rail. */
export function FlowStepDetails({ node }: { node: { type?: string; data: Record<string, unknown> } | null }) {
  if (!node) return <div className="text-[11px] text-white/40">Click a step to see what it does.</div>;
  const d = node.data as FlowStepData & FlowHeaderData;
  const isHeader = node.type === 'flowHeader';
  const json = (v: unknown) => JSON.stringify(v, null, 2);
  const block = (title: string, v: unknown) =>
    v === undefined || v === null || (typeof v === 'object' && !Object.keys(v as object).length) ? null : (
      <div>
        <div className="text-[10px] text-white/40 mb-0.5">{title}</div>
        <pre className="max-h-[220px] overflow-auto rounded bg-slate-950/70 border border-white/8 p-2 text-[10px] text-white/70 whitespace-pre-wrap break-words">{typeof v === 'string' ? v : json(v)}</pre>
      </div>
    );
  return (
    <div className="space-y-2">
      <div>
        <div className={`text-[9px] uppercase tracking-wide ${isHeader ? 'text-purple-300/80' : kindStyle(d.kind).tag}`}>
          {isHeader ? 'VEGR Flow' : kindStyle(d.kind).name}
        </div>
        <div className="text-[13px] text-white">{d.label}</div>
      </div>
      {d.info && <div className="text-[11px] text-white/70 whitespace-pre-wrap">{d.info}</div>}
      {isHeader ? (
        <>
          {block('Inputs', d.inputs)}
          {block('Limits', d.limits)}
          {block('Triggers', d.triggers)}
        </>
      ) : (
        <>
          {d.toolName && block('Tool', d.toolName)}
          {d.forEach && block('For each', `${d.forEach}${d.maxItems ? ` (max ${d.maxItems})` : ''}`)}
          {block('Params', d.params)}
          {block('Payload', d.payload)}
        </>
      )}
    </div>
  );
}
