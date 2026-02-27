import type { Node } from '@xyflow/react';
import type { ContractRootData, CategoryData, TokenData, ToggleData, SectionData, ToolNodeData, TemplateNodeData } from '../lib/contractToGraph';

interface Props {
  selectedNode: Node | null;
  onUpdateNode: (id: string, data: Record<string, unknown>) => void;
  onDeleteNode: (id: string) => void;
}

export default function NodeInspector({ selectedNode, onUpdateNode, onDeleteNode }: Props) {
  if (!selectedNode) {
    return (
      <div className="text-xs text-white/40 italic">
        Click a node on the canvas to inspect it
      </div>
    );
  }

  const { id, type, data } = selectedNode;

  return (
    <div className="rounded-xl border border-purple-600/30 bg-slate-900/50 p-4 space-y-3">
      {type === 'contractRoot' && <ContractRootInspector id={id} data={data as ContractRootData} onUpdate={onUpdateNode} />}
      {type === 'category' && <CategoryInspector id={id} data={data as CategoryData} />}
      {type === 'token' && <TokenInspector id={id} data={data as TokenData} onUpdate={onUpdateNode} />}
      {type === 'toggle' && <ToggleInspector id={id} data={data as ToggleData} onUpdate={onUpdateNode} />}
      {type === 'section' && <SectionInspector id={id} data={data as SectionData} onUpdate={onUpdateNode} />}
      {type === 'tool' && <ToolInspector data={data as ToolNodeData} />}
      {type === 'template' && <TemplateInspector data={data as TemplateNodeData} />}
      <button
        type="button"
        onClick={() => onDeleteNode(id)}
        className="w-full mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-[11px] font-semibold text-rose-400 hover:bg-rose-500/20 transition-colors"
      >
        Delete Node
      </button>
    </div>
  );
}

function ContractRootInspector({ id, data, onUpdate }: { id: string; data: ContractRootData; onUpdate: (id: string, data: Record<string, unknown>) => void }) {
  return (
    <>
      <div className="text-sm font-bold text-white">{data.label}</div>
      <div className="text-[11px] text-gray-400">Type: {data.contractType}</div>
      <FieldLabel label="CONTRACT NAME" />
      <FieldInput value={data.label} onChange={(v) => onUpdate(id, { ...data, label: v })} />
      <FieldLabel label="TYPE" />
      <FieldInput value={data.contractType} onChange={(v) => onUpdate(id, { ...data, contractType: v })} />
    </>
  );
}

function CategoryInspector({ data }: { id: string; data: CategoryData }) {
  return (
    <>
      <div className="text-sm font-bold text-white">{data.label}</div>
      <div className="text-[11px] text-gray-400">Category: {data.color}</div>
      <div className="text-[11px] text-gray-500">{data.description}</div>
    </>
  );
}

function TokenInspector({ id, data, onUpdate }: { id: string; data: TokenData; onUpdate: (id: string, data: Record<string, unknown>) => void }) {
  const isColor = data.tokenValue.startsWith('#');
  return (
    <>
      <div className="text-sm font-bold text-white">{data.tokenKey}</div>
      <div className="text-[11px] text-gray-400">Type: token</div>
      <FieldLabel label="KEY" />
      <FieldInput value={data.tokenKey} onChange={(v) => onUpdate(id, { ...data, tokenKey: v })} />
      <FieldLabel label="VALUE" />
      <div className="flex gap-2">
        {isColor && (
          <input
            type="color"
            value={data.tokenValue}
            onChange={(e) => onUpdate(id, { ...data, tokenValue: e.target.value })}
            className="w-8 h-8 rounded border border-white/10 cursor-pointer bg-transparent"
          />
        )}
        <FieldInput value={data.tokenValue} onChange={(v) => onUpdate(id, { ...data, tokenValue: v })} />
      </div>
    </>
  );
}

function ToggleInspector({ id, data, onUpdate }: { id: string; data: ToggleData; onUpdate: (id: string, data: Record<string, unknown>) => void }) {
  const label = data.featureName.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
  return (
    <>
      <div className="text-sm font-bold text-white">{label}</div>
      <div className="text-[11px] text-gray-400">Type: feature toggle</div>
      <label className="flex items-center gap-3 mt-2 cursor-pointer">
        <input
          type="checkbox"
          checked={data.enabled}
          onChange={(e) => onUpdate(id, { ...data, enabled: e.target.checked })}
          className="w-4 h-4 accent-emerald-500"
        />
        <span className="text-xs text-white/80">{data.enabled ? 'Enabled' : 'Disabled'}</span>
      </label>
    </>
  );
}

function SectionInspector({ id, data, onUpdate }: { id: string; data: SectionData; onUpdate: (id: string, data: Record<string, unknown>) => void }) {
  return (
    <>
      <div className="text-sm font-bold text-white">{data.sectionName}</div>
      <div className="text-[11px] text-gray-400">Type: content section</div>
      <FieldLabel label="SECTION NAME" />
      <FieldInput value={data.sectionName} onChange={(v) => onUpdate(id, { ...data, sectionName: v })} />
    </>
  );
}

function ToolInspector({ data }: { data: ToolNodeData }) {
  return (
    <>
      <div className="text-sm font-bold text-white">{data.displayName}</div>
      <div className="text-[11px] text-gray-400">Type: agent tool</div>
      <div className="text-[11px] text-gray-500 mt-1">{data.description}</div>
      <div className="flex items-center gap-2 mt-2">
        <div className={`w-2 h-2 rounded-full ${data.enabled ? 'bg-amber-500' : 'bg-gray-600'}`} />
        <span className="text-[11px] text-gray-400">{data.enabled ? 'Enabled' : 'Disabled'}</span>
      </div>
      <div className="text-[10px] text-gray-600 font-mono mt-1">{data.toolName}</div>
    </>
  );
}

function TemplateInspector({ data }: { data: TemplateNodeData }) {
  return (
    <>
      <div className="text-sm font-bold text-white">{data.templateName}</div>
      <div className="text-[11px] text-gray-400">Type: template</div>
      <div className="text-[11px] text-gray-500">Category: {data.category}</div>
      <div className="text-[10px] text-gray-600 font-mono mt-1">ID: {data.templateId}</div>
    </>
  );
}

// Reusable field components
function FieldLabel({ label }: { label: string }) {
  return <div className="text-[10px] font-semibold text-gray-500 mt-2">{label}</div>;
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
