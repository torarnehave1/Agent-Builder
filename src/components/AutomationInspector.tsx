import type { Node } from '@xyflow/react';
import { TOOL_CATALOG } from '../lib/toolCatalog';
import ActionToolPicker from './ActionToolPicker';
import type { ActionData, DelayData, LoopData, NotifyData, NoteData } from '../lib/automation';

export interface StepTestState {
  status: 'testing' | 'passed' | 'failed';
  detail?: string;
}

interface Props {
  selectedNode: Node | null;
  onUpdateNode: (id: string, data: Record<string, unknown>) => void;
  onDeleteNode: (id: string) => void;
  onTestStep?: (id: string) => void;
  testState?: StepTestState;
}

export default function AutomationInspector({ selectedNode, onUpdateNode, onDeleteNode, onTestStep, testState }: Props) {
  if (!selectedNode) {
    return <div className="text-xs text-white/40 italic">Click a step on the canvas to configure it</div>;
  }

  const { id, type, data } = selectedNode;
  const testable = type === 'action' || type === 'notify';

  return (
    <div className="rounded-xl border border-purple-600/30 bg-slate-900/50 p-4 space-y-3">
      {type === 'start' && <div className="text-sm font-bold text-white">▶ Start</div>}
      {type === 'action' && <ActionInspector id={id} data={data as ActionData} onUpdate={onUpdateNode} />}
      {type === 'delay' && <DelayInspector id={id} data={data as DelayData} onUpdate={onUpdateNode} />}
      {type === 'loop' && <LoopInspector id={id} data={data as LoopData} onUpdate={onUpdateNode} />}
      {type === 'notify' && <NotifyInspector id={id} data={data as NotifyData} onUpdate={onUpdateNode} />}
      {type === 'note' && <NoteInspector id={id} data={data as NoteData} onUpdate={onUpdateNode} />}

      {testable && onTestStep && (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => onTestStep(id)}
            disabled={testState?.status === 'testing'}
            className="w-full rounded-lg border border-sky-500/40 bg-sky-500/15 px-3 py-1.5 text-[11px] font-semibold text-sky-200 hover:bg-sky-500/25 disabled:opacity-50 transition-colors"
            title="Run just this step, for real"
          >
            {testState?.status === 'testing' ? 'Testing…' : '✓ Test this step'}
          </button>
          {testState && testState.status !== 'testing' && (
            <div className={`mt-2 rounded border px-2 py-1.5 text-[10px] ${
              testState.status === 'passed'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
            }`}>
              <span className="font-semibold uppercase">{testState.status}</span>
              {testState.detail ? ` — ${testState.detail}` : ''}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => onDeleteNode(id)}
        className="w-full mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-[11px] font-semibold text-rose-400 hover:bg-rose-500/20 transition-colors"
      >
        Delete Step
      </button>
    </div>
  );
}

function ActionInspector({ id, data, onUpdate }: { id: string; data: ActionData; onUpdate: (id: string, data: Record<string, unknown>) => void }) {
  const paramsText = JSON.stringify(data.params ?? {}, null, 2);
  return (
    <>
      <div className="text-sm font-bold text-white">⚙ Action</div>
      <FieldLabel label="TOOL" />
      <ActionToolPicker
        value={data.toolName}
        onChange={(toolName, displayName) => onUpdate(id, { ...data, toolName, label: displayName })}
      />
      <div className="text-[10px] text-gray-500">{TOOL_CATALOG.find((t) => t.name === data.toolName)?.description}</div>
      <FieldLabel label="PARAMS (JSON)" />
      <RefHint />
      <textarea
        value={paramsText}
        onChange={(e) => {
          try {
            const parsed = JSON.parse(e.target.value || '{}');
            onUpdate(id, { ...data, params: parsed });
          } catch {
            // ignore invalid JSON mid-typing; keep last valid params
          }
        }}
        rows={4}
        className="w-full rounded bg-slate-950/60 border border-white/8 px-2 py-1.5 text-[10px] text-emerald-300/80 font-mono focus:outline-none focus:border-purple-500/50"
      />
    </>
  );
}

function DelayInspector({ id, data, onUpdate }: { id: string; data: DelayData; onUpdate: (id: string, data: Record<string, unknown>) => void }) {
  return (
    <>
      <div className="text-sm font-bold text-white">⏱ Delay</div>
      <FieldLabel label="AMOUNT" />
      <input
        type="number"
        min={0}
        value={data.amount}
        onChange={(e) => onUpdate(id, { ...data, amount: Number(e.target.value) })}
        className="w-full rounded bg-slate-950/60 border border-white/8 px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-purple-500/50"
      />
      <FieldLabel label="UNIT" />
      <select
        value={data.unit}
        onChange={(e) => onUpdate(id, { ...data, unit: e.target.value as DelayData['unit'] })}
        className="w-full rounded bg-slate-950/60 border border-white/8 px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-purple-500/50"
      >
        <option value="seconds">seconds</option>
        <option value="minutes">minutes</option>
        <option value="hours">hours</option>
      </select>
    </>
  );
}

function LoopInspector({ id, data, onUpdate }: { id: string; data: LoopData; onUpdate: (id: string, data: Record<string, unknown>) => void }) {
  return (
    <>
      <div className="text-sm font-bold text-white">↻ Loop</div>
      <FieldLabel label="TIMES" />
      <input
        type="number"
        min={1}
        value={data.times}
        onChange={(e) => onUpdate(id, { ...data, times: Number(e.target.value) })}
        className="w-full rounded bg-slate-950/60 border border-white/8 px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-purple-500/50"
      />
      <FieldLabel label="OVER (optional list/expression)" />
      <FieldInput value={data.over} onChange={(v) => onUpdate(id, { ...data, over: v })} />
    </>
  );
}

function NotifyInspector({ id, data, onUpdate }: { id: string; data: NotifyData; onUpdate: (id: string, data: Record<string, unknown>) => void }) {
  return (
    <>
      <div className="text-sm font-bold text-white">🔔 Notify</div>
      <FieldLabel label="CHANNEL" />
      <select
        value={data.channel}
        onChange={(e) => onUpdate(id, { ...data, channel: e.target.value })}
        className="w-full rounded bg-slate-950/60 border border-white/8 px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-purple-500/50"
      >
        <option value="email">email</option>
        <option value="chat">chat</option>
        <option value="webhook">webhook</option>
      </select>
      {data.channel === 'email' && (
        <>
          <FieldLabel label="TO" />
          <FieldInput value={data.to || ''} onChange={(v) => onUpdate(id, { ...data, to: v })} />
          <FieldLabel label="SUBJECT" />
          <FieldInput value={data.subject || ''} onChange={(v) => onUpdate(id, { ...data, subject: v })} />
          <FieldLabel label="FROM" />
          <FieldInput value={data.fromEmail || 'noreply@vegr.ai'} onChange={(v) => onUpdate(id, { ...data, fromEmail: v })} />
        </>
      )}
      <FieldLabel label={data.channel === 'email' ? 'BODY' : 'MESSAGE'} />
      <RefHint />
      <textarea
        value={data.message}
        onChange={(e) => onUpdate(id, { ...data, message: e.target.value })}
        rows={3}
        className="w-full rounded bg-slate-950/60 border border-white/8 px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-purple-500/50"
      />
    </>
  );
}

function NoteInspector({ id, data, onUpdate }: { id: string; data: NoteData; onUpdate: (id: string, data: Record<string, unknown>) => void }) {
  return (
    <>
      <div className="text-sm font-bold text-white">📝 Note</div>
      <FieldLabel label="TEXT" />
      <textarea
        value={data.text}
        onChange={(e) => onUpdate(id, { ...data, text: e.target.value })}
        rows={4}
        className="w-full rounded bg-slate-950/60 border border-white/8 px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-purple-500/50"
      />
    </>
  );
}

function FieldLabel({ label }: { label: string }) {
  return <div className="text-[10px] font-semibold text-gray-500 mt-2">{label}</div>;
}

function RefHint() {
  return (
    <div className="text-[9px] text-sky-400/70 mb-1">
      Insert a previous step's output: <code className="text-sky-300">{'{{a1.result.content}}'}</code>
    </div>
  );
}

function FieldInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded bg-slate-950/60 border border-white/8 px-3 py-1.5 text-[11px] text-white font-mono focus:outline-none focus:border-purple-500/50"
    />
  );
}
