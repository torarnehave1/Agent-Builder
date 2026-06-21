import { useEffect, useState } from 'react';
import {
  Flag, Network, LayoutGrid, Film, Users, Building2, Square, ArrowRight,
  Mail, UserCog, Sparkles,
  type LucideIcon,
} from 'lucide-react';

const AGENT_API = 'https://agent.vegvisr.org';

// Map the icon string stored on each work-context node to a lucide icon.
// Unknown / missing → a neutral square. Add a row here to support a new icon.
const ICONS: Record<string, LucideIcon> = {
  'ti-flag': Flag,
  'ti-sitemap': Network,
  'ti-apps': LayoutGrid,
  'ti-movie': Film,
  'ti-users': Users,
  'ti-building': Building2,
  'ti-mail': Mail,
  'ti-user-cog': UserCog,
  'ti-sparkles': Sparkles,
};

export interface Capability {
  name: string;
  summary: string;
}

export interface WorkContext {
  id: string;
  title: string;
  description: string;
  color: string | null;
  icon: string;
  targetGraphId: string;
  capabilities: Capability[];
  starterPrompts: string[];
}

interface Props {
  onSelect: (ctx: WorkContext) => void;
}

export default function WorkContextTab({ onSelect }: Props) {
  const [contexts, setContexts] = useState<WorkContext[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${AGENT_API}/work-contexts`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setContexts(Array.isArray(d.contexts) ? d.contexts : []); })
      .catch(e => { if (!cancelled) setError(e?.message || 'Failed to load work contexts'); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-6">
      <div className="max-w-[900px] mx-auto">
        <h2 className="app-text text-lg sm:text-xl font-semibold mb-1">Choose a work context</h2>
        <p className="app-text-muted text-sm mb-5">
          Pick where you want to work. Each context points the agent at the right graph and gives you starter prompts — so you never face a blank page.
        </p>

        {error && (
          <div className="app-text-muted text-sm border app-border rounded-lg p-4">
            Couldn’t load work contexts: {error}
          </div>
        )}

        {!error && contexts === null && (
          <div className="app-text-muted text-sm">Loading…</div>
        )}

        {!error && contexts !== null && contexts.length === 0 && (
          <div className="app-text-muted text-sm border app-border rounded-lg p-4">
            No work contexts defined yet. Add nodes of type <code>work-context</code> to the Work Contexts graph and they’ll appear here.
          </div>
        )}

        {contexts && contexts.length > 0 && (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            {contexts.map(ctx => {
              const Icon = ICONS[ctx.icon] || Square;
              const accent = ctx.color || undefined;
              return (
                <button
                  key={ctx.id}
                  type="button"
                  onClick={() => onSelect(ctx)}
                  className="text-left app-surface border app-border rounded-xl p-4 flex flex-col gap-2 transition-colors app-hover-surface-strong group"
                >
                  <div className="flex items-center justify-between">
                    <span
                      className="inline-flex items-center justify-center w-9 h-9 rounded-lg"
                      style={accent ? { backgroundColor: `${accent}22`, color: accent } : undefined}
                    >
                      <Icon size={20} />
                    </span>
                    <ArrowRight size={16} className="app-text-faint opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <span className="app-text font-medium text-[0.95rem]">{ctx.title}</span>
                  <span className="app-text-muted text-[0.82rem] leading-relaxed">{ctx.description}</span>
                  <span className="app-text-faint text-[0.72rem] mt-1">
                    {ctx.capabilities.length > 0
                      ? `${ctx.capabilities.length} capabilit${ctx.capabilities.length === 1 ? 'y' : 'ies'}`
                      : 'Full toolbox'}
                    {ctx.targetGraphId ? ' · 1 graph' : ''}
                    {ctx.starterPrompts.length ? ` · ${ctx.starterPrompts.length} prompts` : ''}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
