import { type DragEvent } from 'react';
import { AUTOMATION_PALETTE, type StepType } from '../lib/automation';

interface Props {
  onAddNode: (type: StepType) => void;
}

const colorClasses: Record<string, string> = {
  purple: 'border-purple-500/30 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20',
  amber: 'border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20',
  blue: 'border-blue-500/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20',
  green: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20',
  rose: 'border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20',
  slate: 'border-slate-500/30 bg-slate-500/10 text-slate-300 hover:bg-slate-500/20',
};

export default function AutomationNodePalette({ onAddNode }: Props) {
  const onDragStart = (event: DragEvent<HTMLButtonElement>, nodeType: string) => {
    // Same dataTransfer key ContractCanvas's drop handler reads.
    event.dataTransfer.setData('application/reactflow-nodetype', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="grid grid-cols-2 gap-2">
      {AUTOMATION_PALETTE.map((item) => (
        <button
          key={item.stepType}
          draggable
          onDragStart={(e) => onDragStart(e, item.stepType)}
          onClick={() => onAddNode(item.stepType)}
          className={`rounded-lg border px-3 py-2 text-[11px] font-semibold transition-colors cursor-grab active:cursor-grabbing ${colorClasses[item.color]}`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
