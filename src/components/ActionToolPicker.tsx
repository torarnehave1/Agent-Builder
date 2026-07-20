import { useEffect, useMemo, useState } from 'react';
import { TOOL_CATALOG } from '../lib/toolCatalog';

const AGENT_API = 'https://agent.vegvisr.org';

interface Capability { name: string; summary: string }
interface WorkContext { id: string; title: string; capabilities: Capability[] }

// Module-level cache so the picker doesn't refetch on every Action step selection.
let contextsCache: WorkContext[] | null = null;
let contextsPromise: Promise<WorkContext[]> | null = null;
function loadContexts(): Promise<WorkContext[]> {
  if (contextsCache) return Promise.resolve(contextsCache);
  if (!contextsPromise) {
    contextsPromise = fetch(`${AGENT_API}/work-contexts`)
      .then((r) => r.json())
      .then((d) => {
        contextsCache = Array.isArray(d.contexts) ? d.contexts : [];
        return contextsCache!;
      })
      .catch(() => { contextsCache = []; return []; });
  }
  return contextsPromise;
}

const CATALOG_BY_NAME = new Map(TOOL_CATALOG.map((t) => [t.name, t]));
const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const friendlyName = (tool: string) => CATALOG_BY_NAME.get(tool)?.displayName || titleCase(tool);
const toolSummary = (tool: string, fallback?: string) => CATALOG_BY_NAME.get(tool)?.description || fallback || '';

interface Props {
  value: string;
  onChange: (toolName: string, displayName: string) => void;
}

/**
 * Two-level tool picker: pick a work context (like the Start tab), then a tool from it.
 * Reuses the same /work-contexts data the Start tab reads. An "All tools" group ensures
 * every tool stays reachable even if no context lists it.
 */
export default function ActionToolPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [contexts, setContexts] = useState<WorkContext[]>(contextsCache || []);
  const [ctxId, setCtxId] = useState<string | null>(null);

  useEffect(() => { loadContexts().then(setContexts); }, []);

  // Contexts that actually carry tools + a synthetic "All tools" group at the end.
  const groups = useMemo(() => {
    const real = contexts
      .map((c) => ({ id: c.id, title: c.title, tools: (c.capabilities || []).map((cap) => cap.name) }))
      .filter((g) => g.tools.length > 0);
    return [...real, { id: '__all__', title: 'All tools', tools: TOOL_CATALOG.map((t) => t.name) }];
  }, [contexts]);

  const activeGroup = groups.find((g) => g.id === ctxId) || null;

  const pick = (tool: string) => {
    onChange(tool, friendlyName(tool));
    setOpen(false);
    setCtxId(null);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between rounded bg-slate-950/60 border border-white/8 px-2 py-1.5 text-[11px] text-white hover:border-purple-500/50"
      >
        <span className="truncate">{value ? friendlyName(value) : 'Choose a tool…'}</span>
        <span className="text-white/40 ml-2">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-1 rounded-lg border border-white/10 bg-slate-900 p-2 max-h-[280px] overflow-y-auto">
          {!activeGroup ? (
            <>
              <div className="text-[9px] uppercase tracking-wide text-white/40 px-1 pb-1">Pick a context</div>
              <div className="grid grid-cols-2 gap-1.5">
                {groups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setCtxId(g.id)}
                    className={`rounded-md border px-2 py-1.5 text-left transition-colors ${
                      g.id === '__all__'
                        ? 'border-white/10 bg-white/5 hover:bg-white/10'
                        : 'border-purple-500/25 bg-purple-500/10 hover:bg-purple-500/20'
                    }`}
                  >
                    <div className="text-[11px] text-white truncate">{g.title}</div>
                    <div className="text-[9px] text-white/40">{g.tools.length} tool{g.tools.length === 1 ? '' : 's'}</div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setCtxId(null)}
                className="text-[10px] text-sky-400 hover:underline px-1 pb-1"
              >
                ← Contexts
              </button>
              <div className="text-[9px] uppercase tracking-wide text-white/40 px-1 pb-1">{activeGroup.title}</div>
              <div className="space-y-0.5">
                {[...new Set(activeGroup.tools)].map((tool) => (
                  <button
                    key={tool}
                    type="button"
                    onClick={() => pick(tool)}
                    className={`w-full text-left rounded px-2 py-1 hover:bg-white/10 ${tool === value ? 'bg-purple-500/20' : ''}`}
                  >
                    <div className="text-[11px] text-white">{friendlyName(tool)}</div>
                    <div className="text-[9px] text-white/40 truncate">{toolSummary(tool)}</div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
