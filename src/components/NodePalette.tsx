import { type DragEvent } from 'react';

interface Props {
  onAddNode: (type: string) => void;
}

const paletteItems = [
  { type: 'token', label: '+ CSS Token', color: 'blue' },
  { type: 'toggle', label: '+ Feature', color: 'green' },
  { type: 'section', label: '+ Section', color: 'blue' },
  { type: 'token-rule', label: '+ Rule', color: 'green' },
  { type: 'contractRoot', label: '+ Contract', color: 'purple' },
  { type: 'category', label: '+ Category', color: 'purple' },
  { type: 'tool', label: '+ Tool', color: 'amber' },
  { type: 'template', label: '+ Template', color: 'rose' },
];

const colorClasses: Record<string, string> = {
  blue: 'border-blue-500/30 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20',
  green: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20',
  purple: 'border-purple-500/30 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20',
  amber: 'border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20',
  rose: 'border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20',
};

export default function NodePalette({ onAddNode }: Props) {
  const onDragStart = (event: DragEvent<HTMLButtonElement>, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow-nodetype', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="grid grid-cols-2 gap-2">
      {paletteItems.map((item) => (
        <button
          key={item.type + item.label}
          draggable
          onDragStart={(e) => onDragStart(e, item.type)}
          onClick={() => onAddNode(item.type)}
          className={`rounded-lg border px-3 py-2 text-[11px] font-semibold transition-colors cursor-grab active:cursor-grabbing ${colorClasses[item.color]}`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
