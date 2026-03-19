const MODELS = [
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Haiku 4.5',
    description: 'Fast and cost-efficient. Best for most tasks.',
    inputCost: 0.80,
    outputCost: 4.00,
    badge: 'Default',
    badgeColor: 'bg-emerald-500/20 text-emerald-300',
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Sonnet 4.6',
    description: 'Balanced performance. Better reasoning and longer outputs.',
    inputCost: 3.00,
    outputCost: 15.00,
    badge: 'Balanced',
    badgeColor: 'bg-sky-500/20 text-sky-300',
  },
  {
    id: 'claude-opus-4-6',
    name: 'Opus 4.6',
    description: 'Most powerful. Use for complex multi-step reasoning.',
    inputCost: 15.00,
    outputCost: 75.00,
    badge: 'Powerful',
    badgeColor: 'bg-violet-500/20 text-violet-300',
  },
];

const STORAGE_KEY = 'agent_builder_model';

export function getStoredModel(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'claude-haiku-4-5-20251001';
  } catch {
    return 'claude-haiku-4-5-20251001';
  }
}

interface Props {
  model: string;
  onChange: (model: string) => void;
}

export default function ModelSettings({ model, onChange }: Props) {
  const handleChange = (id: string) => {
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch { /* ignore */ }
    onChange(id);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-xl mx-auto">
        <h2 className="text-base font-semibold text-white mb-1">Model</h2>
        <p className="text-xs text-white/50 mb-5">
          Select which Claude model to use for your chat sessions. Applies to new conversations.
        </p>

        <div className="flex flex-col gap-3">
          {MODELS.map((m) => {
            const selected = model === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => handleChange(m.id)}
                className={`w-full text-left rounded-xl border px-4 py-4 transition-colors ${
                  selected
                    ? 'border-sky-500/60 bg-sky-500/10'
                    : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className={`h-3 w-3 rounded-full border-2 flex-shrink-0 ${
                      selected ? 'border-sky-400 bg-sky-400' : 'border-white/30'
                    }`} />
                    <span className="text-sm font-semibold text-white">{m.name}</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${m.badgeColor}`}>
                      {m.badge}
                    </span>
                  </div>
                  <span className="text-[11px] text-white/40 font-mono">
                    ${m.inputCost.toFixed(2)} / ${m.outputCost.toFixed(2)} per MTok
                  </span>
                </div>
                <p className="text-xs text-white/50 ml-5">{m.description}</p>
              </button>
            );
          })}
        </div>

        <p className="mt-6 text-[11px] text-white/30">
          Pricing shown as input / output per million tokens.
          Haiku is ~4× cheaper than Sonnet, Sonnet is ~5× cheaper than Opus.
        </p>
      </div>
    </div>
  );
}
