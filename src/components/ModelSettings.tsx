/* eslint-disable react-refresh/only-export-components */
const MODELS = [
  {
    id: '@cf/meta/llama-4-scout-17b-16e-instruct',
    name: 'Llama 4 Scout 17B',
    description: 'Cloudflare Workers AI. Free tier included, then billed per neuron.',
    inputCost: 0,
    outputCost: 0,
    badge: 'Workers AI',
    badgeColor: 'bg-orange-500/20 text-orange-300',
  },
  {
    id: '@cf/google/gemma-4-26b-a4b-it',
    name: 'Gemma 4 26B',
    description: 'Cloudflare Workers AI. Free tier included, then billed per neuron.',
    inputCost: 0,
    outputCost: 0,
    badge: 'Workers AI',
    badgeColor: 'bg-orange-500/20 text-orange-300',
  },
  {
    id: '@cf/nvidia/nemotron-3-120b-a12b',
    name: 'Nemotron-3 120B',
    description: 'NVIDIA hybrid MoE. Reasoning + function calling. Built for multi-agent apps.',
    inputCost: 0.50,
    outputCost: 1.50,
    badge: 'Reasoning',
    badgeColor: 'bg-green-600/20 text-green-300',
  },
  {
    id: 'ollama/gemma4:e2b',
    name: 'Gemma 4 2B (Edge)',
    description: 'Free, lightweight. Optimized for laptops. Lower resource usage.',
    inputCost: 0,
    outputCost: 0,
    badge: 'Local',
    badgeColor: 'bg-orange-500/20 text-orange-300',
  },
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
  {
    id: '@cf/bytedance/stable-diffusion-xl-lightning',
    name: 'SDXL Lightning',
    description: 'Stable Diffusion XL Lightning. Every message becomes an image prompt.',
    inputCost: 0,
    outputCost: 0,
    badge: 'Image Gen',
    badgeColor: 'bg-pink-500/20 text-pink-300',
  },
  {
    id: '@cf/leonardo/lucid-origin',
    name: 'Lucid Origin',
    description: 'Leonardo.AI. Prompt-responsive, renders text, wide style range. $0.007/tile.',
    inputCost: 0,
    outputCost: 0,
    badge: 'Image Gen',
    badgeColor: 'bg-pink-500/20 text-pink-300',
  },
];

const STORAGE_KEY = 'agent_builder_model';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

export function isLocalDev(): boolean {
  try {
    return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export function isWorkersAIModel(model: string): boolean {
  return model.startsWith('@cf/');
}

export function getStoredModel(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) || DEFAULT_MODEL;
    // Ollama models only available on localhost — fall back to default on prod
    if (stored.startsWith('ollama/') && !isLocalDev()) {
      return DEFAULT_MODEL;
    }
    return stored;
  } catch {
    return DEFAULT_MODEL;
  }
}

interface Props {
  model: string;
  onChange: (model: string) => void;
  resolvedTheme?: 'light' | 'dark';
}

export default function ModelSettings({ model, onChange, resolvedTheme = 'dark' }: Props) {
  const isLight = resolvedTheme === 'light';
  const handleChange = (id: string) => {
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch { /* ignore */ }
    onChange(id);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-xl mx-auto">
        <h2 className={`text-base font-semibold mb-1 ${isLight ? 'text-slate-900' : 'text-white'}`}>Model</h2>
        <p className={`text-xs mb-5 ${isLight ? 'text-slate-500' : 'text-white/50'}`}>
          Select a model. Workers AI models use a persistent WebSocket agent hosted on Cloudflare. Claude models use the SSE chat path.
        </p>

        <div className="flex flex-col gap-3">
          {MODELS.filter((m) => !m.id.startsWith('ollama/') || isLocalDev()).map((m) => {
            const selected = model === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => handleChange(m.id)}
                className={`w-full text-left rounded-xl border px-4 py-4 transition-colors ${
                  selected
                    ? isLight ? 'border-sky-500/60 bg-sky-50' : 'border-sky-500/60 bg-sky-500/10'
                    : isLight ? 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50' : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className={`h-3 w-3 rounded-full border-2 flex-shrink-0 ${
                      selected ? 'border-sky-400 bg-sky-400' : isLight ? 'border-slate-300' : 'border-white/30'
                    }`} />
                    <span className={`text-sm font-semibold ${isLight ? 'text-slate-900' : 'text-white'}`}>{m.name}</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${m.badgeColor}`}>
                      {m.badge}
                    </span>
                  </div>
                  <span className={`text-[11px] font-mono ${isLight ? 'text-slate-500' : 'text-white/40'}`}>
                    {m.badge === 'Workers AI' || m.badge === 'Image Gen' ? 'Free tier / per neuron' : m.inputCost === 0 && m.outputCost === 0 ? 'Free (local)' : `$${m.inputCost.toFixed(2)} / $${m.outputCost.toFixed(2)} per MTok`}
                  </span>
                </div>
                <p className={`text-xs ml-5 ${isLight ? 'text-slate-500' : 'text-white/50'}`}>{m.description}</p>
              </button>
            );
          })}
        </div>

        <p className={`mt-6 text-[11px] ${isLight ? 'text-slate-400' : 'text-white/30'}`}>
          Pricing shown as input / output per million tokens.
          Haiku is ~4× cheaper than Sonnet, Sonnet is ~5× cheaper than Opus.
        </p>
      </div>
    </div>
  );
}
