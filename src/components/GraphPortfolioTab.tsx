import { useState, useEffect, useCallback, useRef } from 'react';

const KG_API = 'https://knowledge.vegvisr.org';
const PAGE_SIZE = 50; // larger pages for background loading

type SortOrder = 'newest' | 'oldest' | 'az';

interface GraphMetadata {
  title?: string;
  description?: string;
  createdBy?: string;
  metaArea?: string;
  category?: string;
  updatedAt?: string;
}

interface GraphSummary {
  id: string;
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
  nodeCount: number;
  edgeCount: number;
  nodeTypes: string[];
  portfolioImagePath: string | null;
  metadata: GraphMetadata | null;
}

interface Props {
  graphId: string;
  onGraphChange: (id: string) => void;
  onNavigateToChat: () => void;
  onGraphSelected?: (id: string, title: string) => void;
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso || iso === 'Unknown') return '';
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d}d ago`;
  const m = Math.floor(d / 30);
  if (m < 12) return `${m}mo ago`;
  return `${Math.floor(m / 12)}y ago`;
}

function nodeTypeIcon(types: string[]): string {
  if (types.includes('html-node')) return '🌐';
  if (types.includes('mermaid-diagram')) return '📊';
  if (types.includes('video')) return '🎬';
  if (types.includes('audio')) return '🎵';
  if (types.includes('fulltext')) return '📝';
  return '◈';
}

function parseMetaAreas(metaArea: string | undefined | null): string[] {
  if (!metaArea?.trim()) return [];
  return metaArea.split('#').map(a => a.trim()).filter(Boolean);
}

function shortName(email: string | undefined | null): string {
  if (!email || email === 'Unknown') return '';
  return email.split('@')[0];
}

// Normalise a raw summary into a consistent shape (mirrors processGraphSummary in GraphPortfolio.vue)
function processSummary(raw: GraphSummary): GraphSummary {
  const meta = raw.metadata || {};
  return {
    ...raw,
    metadata: {
      ...meta,
      title: meta.title || raw.title || 'Untitled',
      description: meta.description || '',
      createdBy: meta.createdBy || 'Unknown',
      metaArea: meta.metaArea || '',
      category: meta.category || '',
      // normalise updatedAt into metadata (same as Vue: summary.updatedAt || summary.createdAt || metadata.updatedAt)
      updatedAt: raw.updatedAt || raw.createdAt || meta.updatedAt || undefined,
    },
  };
}

export default function GraphPortfolioTab({ graphId, onGraphChange, onNavigateToChat }: Props) {
  const [graphs, setGraphs] = useState<GraphSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hydrating, setHydrating] = useState(false); // background loading remaining pages
  const [search, setSearch] = useState('');
  const [selectedArea, setSelectedArea] = useState<string | null>(null);
  const [selectedCreator, setSelectedCreator] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [toast, setToast] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runIdRef = useRef(0);

  // MetaArea frequencies — sorted by count descending (matches portfolioStore.sortedMetaAreas)
  const { metaAreas, metaAreaFreq } = (() => {
    const freq: Record<string, number> = {};
    for (const g of graphs) {
      for (const area of parseMetaAreas(g.metadata?.metaArea)) {
        freq[area] = (freq[area] || 0) + 1;
      }
    }
    const sorted = Object.keys(freq).sort((a, b) => freq[b] - freq[a]);
    return { metaAreas: sorted, metaAreaFreq: freq };
  })();

  // Unique creators sorted alphabetically
  const creators = Array.from(
    new Set(
      graphs
        .map(g => g.metadata?.createdBy)
        .filter((c): c is string => !!c && c !== 'Unknown')
    )
  ).sort();

  // Filtered + sorted view
  const filtered = graphs
    .filter(g => {
      const q = search.toLowerCase();
      const title = (g.metadata?.title || g.title || '').toLowerCase();
      const desc = (g.metadata?.description || '').toLowerCase();
      const area = (g.metadata?.metaArea || '').toLowerCase();
      const cat = (g.metadata?.category || '').toLowerCase();
      const matchesSearch = !q || title.includes(q) || desc.includes(q) || area.includes(q) || cat.includes(q);
      const graphAreas = parseMetaAreas(g.metadata?.metaArea);
      const matchesArea = !selectedArea || graphAreas.includes(selectedArea);
      const matchesCreator = !selectedCreator || g.metadata?.createdBy === selectedCreator;
      return matchesSearch && matchesArea && matchesCreator;
    })
    .sort((a, b) => {
      if (sortOrder === 'newest') {
        const ta = a.metadata?.updatedAt || a.updatedAt || '';
        const tb = b.metadata?.updatedAt || b.updatedAt || '';
        return new Date(tb || 0).getTime() - new Date(ta || 0).getTime();
      }
      if (sortOrder === 'oldest') {
        const ta = a.metadata?.updatedAt || a.updatedAt || '';
        const tb = b.metadata?.updatedAt || b.updatedAt || '';
        return new Date(ta || 0).getTime() - new Date(tb || 0).getTime();
      }
      const ta = (a.metadata?.title || a.title || '').toLowerCase();
      const tb = (b.metadata?.title || b.title || '').toLowerCase();
      return ta.localeCompare(tb);
    });

  // Load all pages — first page fast, remaining pages in background (mirrors fetchGraphs in GraphPortfolio.vue)
  const loadAllGraphs = useCallback(async () => {
    const runId = ++runIdRef.current;
    setLoading(true);
    setHydrating(false);
    setGraphs([]);

    try {
      // First page — show results immediately
      const firstRes = await fetch(`${KG_API}/getknowgraphsummaries?offset=0&limit=${PAGE_SIZE}`, { headers: { 'x-user-role': 'Superadmin' } });
      if (!firstRes.ok) throw new Error('Failed');
      const firstData = await firstRes.json();
      const totalCount: number = firstData.total || 0;
      setTotal(totalCount);

      const firstBatch = (firstData.results as GraphSummary[] || []).map(processSummary);
      if (runId !== runIdRef.current) return;
      setGraphs(firstBatch);
      setLoading(false);

      // Background: fetch remaining pages
      let offset = firstBatch.length;
      if (offset < totalCount) {
        setHydrating(true);
        while (offset < totalCount) {
          if (runId !== runIdRef.current) return;
          const res = await fetch(`${KG_API}/getknowgraphsummaries?offset=${offset}&limit=${PAGE_SIZE}`, { headers: { 'x-user-role': 'Superadmin' } });
          if (!res.ok) break;
          const data = await res.json();
          const page = (data.results as GraphSummary[] || []).map(processSummary);
          if (!page.length) break;
          if (runId !== runIdRef.current) return;
          setGraphs(prev => [...prev, ...page]);
          offset += page.length;
          if (!data.hasMore) break;
        }
        if (runId === runIdRef.current) setHydrating(false);
      }
    } catch {
      setLoading(false);
      setHydrating(false);
    }
  }, []);

  useEffect(() => { loadAllGraphs(); }, [loadAllGraphs]);

  // Debounced server-search when search term is long enough
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (search.length >= 3) {
      debounceRef.current = setTimeout(async () => {
        const runId = ++runIdRef.current;
        setLoading(true);
        try {
          const params = new URLSearchParams({ q: search, limit: '100', offset: '0' });
          const res = await fetch(`${KG_API}/searchGraphs?${params}`);
          if (res.ok && runId === runIdRef.current) {
            const data = await res.json();
            setGraphs((data.results || []).map(processSummary));
            setTotal(data.results?.length || 0);
          }
        } catch { /* silent */ } finally {
          if (runId === runIdRef.current) setLoading(false);
        }
      }, 400);
    } else if (search.length === 0) {
      loadAllGraphs();
    }
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, loadAllGraphs]);

  const deleteGraph = async (id: string) => {
    setDeleting(true);
    try {
      const res = await fetch(`${KG_API}/deleteknowgraph`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error('Delete failed');
      setGraphs(prev => prev.filter(g => g.id !== id));
      setTotal(prev => prev - 1);
      const title = graphs.find(g => g.id === id)?.metadata?.title || id;
      setToast(`Deleted: ${title}`);
      setTimeout(() => setToast(null), 2500);
    } catch {
      setToast('Delete failed — please try again');
      setTimeout(() => setToast(null), 3000);
    } finally {
      setDeleting(false);
      setConfirmDeleteId(null);
    }
  };

  const selectGraph = (g: GraphSummary) => {
    onGraphChange(g.id);
    const name = g.metadata?.title || g.title;
    setToast(`Context set: ${name}`);
    setTimeout(() => setToast(null), 2500);
    if (onGraphSelected) {
      onGraphSelected(g.id, name);
    } else {
      setTimeout(() => onNavigateToChat(), 800);
    }
  };

  return (
    <div className="flex flex-1 min-h-0 bg-slate-950">

      {/* ── Left sidebar ── */}
      <aside className="w-[180px] flex-shrink-0 border-r border-white/10 flex flex-col py-3 overflow-y-auto gap-4">

        {/* MetaArea filter */}
        <div>
          <p className="px-3 text-[10px] uppercase tracking-widest text-white/30 mb-2">Area</p>
          <button
            type="button"
            onClick={() => setSelectedArea(null)}
            className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
              !selectedArea ? 'text-purple-400 font-semibold' : 'text-white/50 hover:text-white/80'
            }`}
          >
            All <span className="text-white/30 text-[10px]">({total})</span>
          </button>
          {metaAreas.length === 0 && !loading && (
            <p className="px-3 text-[10px] text-white/20 mt-1">No areas found</p>
          )}
          {metaAreas.map(area => (
            <button
              type="button"
              key={area}
              onClick={() => setSelectedArea(prev => prev === area ? null : area)}
              className={`w-full text-left px-3 py-1.5 text-xs truncate transition-colors ${
                selectedArea === area
                  ? 'text-purple-400 font-semibold bg-purple-600/10 border-l-2 border-purple-500'
                  : 'text-white/50 hover:text-white/80'
              }`}
            >
              {area}
              <span className="ml-1 text-white/25 text-[10px]">({metaAreaFreq[area]})</span>
            </button>
          ))}
          {hydrating && (
            <p className="px-3 text-[10px] text-white/20 mt-2 flex items-center gap-1">
              <span className="inline-block w-2 h-2 border border-white/30 border-t-transparent rounded-full animate-spin" />
              Loading…
            </p>
          )}
        </div>

        {/* CreatedBy filter */}
        {creators.length > 0 && (
          <div>
            <p className="px-3 text-[10px] uppercase tracking-widest text-white/30 mb-2">Created by</p>
            <button
              type="button"
              onClick={() => setSelectedCreator(null)}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                !selectedCreator ? 'text-purple-400 font-semibold' : 'text-white/50 hover:text-white/80'
              }`}
            >
              Anyone
            </button>
            {creators.map(creator => (
              <button
                type="button"
                key={creator}
                onClick={() => setSelectedCreator(prev => prev === creator ? null : creator)}
                className={`w-full text-left px-3 py-1.5 text-xs truncate transition-colors ${
                  selectedCreator === creator
                    ? 'text-purple-400 font-semibold bg-purple-600/10 border-l-2 border-purple-500'
                    : 'text-white/50 hover:text-white/80'
                }`}
                title={creator}
              >
                {shortName(creator)}
              </button>
            ))}
          </div>
        )}
      </aside>

      {/* ── Main content ── */}
      <div className="flex flex-col flex-1 min-h-0 min-w-0">

        {/* Search + sort bar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 flex-shrink-0">
          <div className="relative flex-1 max-w-[400px]">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search graphs…"
              className="w-full bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-purple-500/50 focus:bg-white/8 transition-colors"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
              >
                ×
              </button>
            )}
          </div>

          {/* Sort dropdown */}
          <select
            value={sortOrder}
            onChange={e => setSortOrder(e.target.value as SortOrder)}
            title="Sort order"
            aria-label="Sort order"
            className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white/70 focus:outline-none focus:border-purple-500/50 cursor-pointer"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="az">A → Z</option>
          </select>

          <span className="text-[11px] text-white/30 flex-shrink-0">
            {loading ? 'Loading…' : hydrating ? `${filtered.length} of ${total}…` : `${filtered.length} of ${total}`}
          </span>
          {graphId && (
            <div className="ml-auto flex items-center gap-2 text-[11px] text-purple-300 bg-purple-600/10 px-2.5 py-1 rounded-full border border-purple-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 flex-shrink-0" />
              Context active
            </div>
          )}
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-white/30">
              <svg className="w-8 h-8 mb-2 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2a4 4 0 0 1 8 0v2M3 21h18M5 21V7l7-4 7 4v14" />
              </svg>
              <p className="text-sm">No graphs found</p>
              {search && <p className="text-xs mt-1">Try a different search term</p>}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {filtered.map(g => {
                const isActive = g.id === graphId;
                const title = g.metadata?.title || g.title || 'Untitled';
                const desc = g.metadata?.description || '';
                const areas = parseMetaAreas(g.metadata?.metaArea);
                const icon = nodeTypeIcon(g.nodeTypes || []);
                const createdBy = g.metadata?.createdBy;
                const updatedAt = g.metadata?.updatedAt || g.updatedAt;
                return (
                  <div key={g.id} className="relative group">
                    <button
                      type="button"
                      onClick={() => selectGraph(g)}
                      className={`
                        w-full text-left rounded-xl border p-3 flex flex-col gap-2 transition-all
                        ${isActive
                          ? 'border-purple-500 bg-purple-600/10 shadow-[0_0_0_1px_rgb(168_85_247/0.3)]'
                          : 'border-white/8 bg-white/3 hover:border-white/20 hover:bg-white/6'
                        }
                      `}
                    >
                    {/* Image or placeholder */}
                    {g.portfolioImagePath ? (
                      <div className="w-full h-[80px] rounded-lg overflow-hidden bg-slate-800 flex-shrink-0">
                        <img
                          src={g.portfolioImagePath}
                          alt={title}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </div>
                    ) : (
                      <div className={`w-full h-[56px] rounded-lg flex items-center justify-center flex-shrink-0 text-2xl ${
                        isActive ? 'bg-purple-600/20' : 'bg-white/5 group-hover:bg-white/8'
                      }`}>
                        {icon}
                      </div>
                    )}

                    {/* Title */}
                    <p className={`text-sm font-medium leading-snug line-clamp-2 ${isActive ? 'text-purple-200' : 'text-white/90'}`}>
                      {title}
                    </p>

                    {/* Description */}
                    {desc && (
                      <p className="text-[11px] text-white/40 line-clamp-2 leading-relaxed">
                        {desc}
                      </p>
                    )}

                    {/* Footer */}
                    <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1">
                      {areas.slice(0, 2).map(area => (
                        <span key={area} className="text-[10px] bg-white/5 text-white/40 px-1.5 py-0.5 rounded truncate max-w-[100px]">
                          {area}
                        </span>
                      ))}
                      <span className="text-[10px] text-white/25 ml-auto flex-shrink-0">
                        {g.nodeCount} nodes
                      </span>
                    </div>

                    {/* Last updated + creator */}
                    <p className="text-[9px] text-white/20 -mt-1">
                      {timeAgo(updatedAt)}
                      {createdBy && createdBy !== 'Unknown' && (
                        <span className="ml-1">· {shortName(createdBy)}</span>
                      )}
                    </p>

                    {/* Active indicator */}
                    {isActive && (
                      <div className="flex items-center gap-1 text-[10px] text-purple-400 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                        Active context
                      </div>
                    )}
                    </button>

                    {/* Delete button — appears on hover */}
                    {confirmDeleteId !== g.id && (
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); setConfirmDeleteId(g.id); }}
                        title="Delete graph"
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md bg-black/40 hover:bg-red-600/80 text-white/50 hover:text-white"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}

                    {/* Confirm delete overlay */}
                    {confirmDeleteId === g.id && (
                      <div className="absolute inset-0 rounded-xl bg-black/80 flex flex-col items-center justify-center gap-3 z-10 p-3">
                        <p className="text-xs text-white/80 text-center leading-snug">Delete <span className="text-white font-medium">{title}</span>?</p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); setConfirmDeleteId(null); }}
                            className="px-3 py-1 text-xs rounded-lg bg-white/10 text-white/70 hover:bg-white/20"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={deleting}
                            onClick={e => { e.stopPropagation(); deleteGraph(g.id); }}
                            className="px-3 py-1 text-xs rounded-lg bg-red-600 text-white hover:bg-red-500 disabled:opacity-50"
                          >
                            {deleting ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-purple-600 text-white text-sm rounded-lg shadow-xl flex items-center gap-2 animate-fade-in">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          {toast}
        </div>
      )}
    </div>
  );
}
