import { useState, useEffect, useRef, useCallback } from 'react';

interface GraphInfo {
  id: string;
  title: string;
  updatedAt?: string;
}

// Both endpoints answer rows this component has to flatten: /getknowgraphsummaries nests the
// title under `metadata`, /searchGraphs returns it flat. Neither has a `metadata_title` field.
interface RawGraph {
  id: string;
  title?: string;
  updatedAt?: string;
  metadata?: { title?: string } | null;
}

interface Props {
  graphId: string;
  onGraphChange: (graphId: string) => void;
}

const KG_API = 'https://knowledge.vegvisr.org';
const PAGE_LIMIT = 50;

// Session auth — without it the worker answers PUBLISHED graphs only, so drafts are invisible.
const KG_HEADERS = { 'x-user-role': 'Superadmin' };

function toGraphInfo(raw: RawGraph): GraphInfo {
  const info: GraphInfo = { id: raw.id, title: raw.metadata?.title || raw.title || raw.id };
  if (raw.updatedAt) info.updatedAt = raw.updatedAt;
  return info;
}

export default function GraphSelector({ graphId, onGraphChange }: Props) {
  const [graphs, setGraphs] = useState<GraphInfo[]>([]);
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runIdRef = useRef(0);

  // Most recent graphs — the default list when nothing is typed
  const loadRecent = useCallback(async () => {
    const runId = ++runIdRef.current;
    try {
      const res = await fetch(`${KG_API}/getknowgraphsummaries?offset=0&limit=${PAGE_LIMIT}`, { headers: KG_HEADERS });
      if (!res.ok) return;
      const data = await res.json();
      if (runId !== runIdRef.current) return;
      setGraphs(((data.results as RawGraph[]) || []).map(toGraphInfo));
    } catch { /* leave the list as it is */ }
  }, []);

  useEffect(() => { loadRecent(); }, [loadRecent]);

  // Search runs on the server: it matches titles, descriptions, node labels and node content,
  // which a filter over this component's 50 loaded rows could never do.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = search.trim();
    if (q.length >= 2) {
      setSearching(true);
      debounceRef.current = setTimeout(async () => {
        const runId = ++runIdRef.current;
        try {
          const params = new URLSearchParams({ q, limit: String(PAGE_LIMIT), offset: '0' });
          const res = await fetch(`${KG_API}/searchGraphs?${params}`, { headers: KG_HEADERS });
          if (!res.ok || runId !== runIdRef.current) return;
          const data = await res.json();
          setGraphs(((data.results as RawGraph[]) || []).map(toGraphInfo));
        } catch { /* leave the list as it is */ } finally {
          if (runId === runIdRef.current) setSearching(false);
        }
      }, 300);
    } else {
      setSearching(false);
      if (q.length === 0) loadRecent();
    }
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, loadRecent]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as HTMLElement)) {
        setOpen(false);
        setCreating(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const currentGraph = graphs.find(g => g.id === graphId);
  const displayName = currentGraph?.title || graphId;

  const handleCreateNew = () => {
    if (!newTitle.trim()) return;
    const id = `graph_${Date.now()}`;
    onGraphChange(id);
    setGraphs(prev => [{ id, title: newTitle.trim() }, ...prev]);
    setNewTitle('');
    setCreating(false);
    setOpen(false);
  };

  return (
    <div className="relative ml-4" ref={ref}>
      <button
        onClick={() => setOpen(prev => !prev)}
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
      >
        <svg className="w-3 h-3 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
        <span className="max-w-[200px] truncate">{displayName}</span>
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-[320px] rounded-lg border border-white/10 bg-slate-900/95 backdrop-blur-sm shadow-2xl z-50 overflow-hidden">
          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
            <svg className="w-3 h-3 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search all graphs…"
              className="flex-1 bg-transparent text-[11px] text-white placeholder:text-gray-600 focus:outline-none"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="text-[10px] text-gray-500 hover:text-gray-300"
                title="Clear search"
              >
                &times;
              </button>
            )}
          </div>

          {/* Create new toggle */}
          {!creating ? (
            <button
              onClick={() => setCreating(true)}
              className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-purple-400 hover:bg-purple-600/10 border-b border-white/5"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Create new graph
            </button>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
              <input
                type="text"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateNew()}
                placeholder="Graph title..."
                autoFocus
                className="flex-1 bg-transparent text-[11px] text-white placeholder:text-gray-600 focus:outline-none"
              />
              <button
                onClick={handleCreateNew}
                disabled={!newTitle.trim()}
                className="text-[10px] font-semibold text-purple-400 hover:text-purple-300 disabled:text-gray-600"
              >
                Create
              </button>
              <button
                onClick={() => { setCreating(false); setNewTitle(''); }}
                className="text-[10px] text-gray-500 hover:text-gray-300"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Graph list */}
          <div className="max-h-[280px] overflow-y-auto">
            {graphs.map(g => (
              <button
                key={g.id}
                onClick={() => {
                  onGraphChange(g.id);
                  setOpen(false);
                }}
                className={`w-full flex flex-col gap-0.5 px-3 py-2 text-left hover:bg-white/5 transition-colors ${
                  g.id === graphId ? 'bg-purple-600/10 border-l-2 border-purple-500' : ''
                }`}
              >
                <span className="text-[11px] text-white truncate">{g.title}</span>
                <span className="text-[9px] text-gray-600 font-mono truncate">{g.id}</span>
              </button>
            ))}
            {graphs.length === 0 && (
              <div className="px-3 py-4 text-[11px] text-gray-600 text-center">
                {searching ? 'Searching…' : search ? 'No graphs match that search' : 'No graphs found'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
