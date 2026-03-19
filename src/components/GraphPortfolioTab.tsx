import { useState, useEffect, useCallback, useRef } from 'react';

const KG_API = 'https://knowledge.vegvisr.org';
const PAGE_SIZE = 24;

interface GraphSummary {
  id: string;
  title: string;
  metadata_title: string;
  metadata_description: string;
  metadata_created_by: string;
  metadata_meta_area: string;
  metadata_category: string;
  node_count: number;
  edge_count: number;
  node_types_csv: string;
  portfolio_image_path: string | null;
  updated_at: string | null;
}

interface Props {
  graphId: string;
  onGraphChange: (id: string) => void;
  onNavigateToChat: () => void;
}

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d}d ago`;
  const m = Math.floor(d / 30);
  if (m < 12) return `${m}mo ago`;
  return `${Math.floor(m / 12)}y ago`;
}

function nodeTypeIcon(csv: string): string {
  const types = csv.split(',').filter(Boolean);
  if (types.includes('html-node')) return '🌐';
  if (types.includes('mermaid-diagram')) return '📊';
  if (types.includes('video')) return '🎬';
  if (types.includes('audio')) return '🎵';
  if (types.includes('fulltext')) return '📝';
  return '◈';
}

export default function GraphPortfolioTab({ graphId, onGraphChange, onNavigateToChat }: Props) {
  const [graphs, setGraphs] = useState<GraphSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedArea, setSelectedArea] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derived: unique meta areas from loaded graphs
  const metaAreas = Array.from(
    new Set(
      graphs
        .map(g => g.metadata_meta_area?.trim())
        .filter(Boolean)
        .flatMap(a => a.split(/[,;]/))
        .map(a => a.trim())
        .filter(Boolean)
    )
  ).sort();

  // Client-side filtered view
  const filtered = graphs.filter(g => {
    const q = search.toLowerCase();
    const title = (g.metadata_title || g.title || '').toLowerCase();
    const desc = (g.metadata_description || '').toLowerCase();
    const area = (g.metadata_meta_area || '').toLowerCase();
    const cat = (g.metadata_category || '').toLowerCase();
    const matchesSearch = !q || title.includes(q) || desc.includes(q) || area.includes(q) || cat.includes(q);
    const matchesArea = !selectedArea || (g.metadata_meta_area || '').includes(selectedArea);
    return matchesSearch && matchesArea;
  });

  const fetchGraphs = useCallback(async (offset = 0, append = false) => {
    if (offset === 0) setLoading(true); else setLoadingMore(true);
    try {
      const params = new URLSearchParams({ offset: String(offset), limit: String(PAGE_SIZE) });
      const res = await fetch(`${KG_API}/getknowgraphsummaries?${params}`);
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      const results: GraphSummary[] = data.results || [];
      setTotal(data.total || 0);
      setGraphs(prev => append ? [...prev, ...results] : results);
    } catch {
      // silent fail — don't crash the tab
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => { fetchGraphs(0); }, [fetchGraphs]);

  // Debounced server-search when search term is long enough
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (search.length >= 3) {
      debounceRef.current = setTimeout(async () => {
        setLoading(true);
        try {
          const params = new URLSearchParams({ q: search, limit: String(PAGE_SIZE), offset: '0' });
          const res = await fetch(`${KG_API}/searchGraphs?${params}`);
          if (res.ok) {
            const data = await res.json();
            setGraphs(data.results || []);
            setTotal(data.results?.length || 0);
          }
        } catch { /* silent */ } finally {
          setLoading(false);
        }
      }, 400);
    } else if (search.length === 0) {
      fetchGraphs(0);
    }
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, fetchGraphs]);

  const selectGraph = (g: GraphSummary) => {
    onGraphChange(g.id);
    const name = g.metadata_title || g.title;
    setToast(`Context set: ${name}`);
    setTimeout(() => setToast(null), 2500);
    setTimeout(() => onNavigateToChat(), 800);
  };

  const canLoadMore = graphs.length < total && search.length < 3 && !selectedArea;

  return (
    <div className="flex flex-1 min-h-0 bg-slate-950">

      {/* ── Left sidebar — MetaArea filters ── */}
      <aside className="w-[180px] flex-shrink-0 border-r border-white/10 flex flex-col py-3 overflow-y-auto">
        <p className="px-3 text-[10px] uppercase tracking-widest text-white/30 mb-2">Filter by area</p>
        <button
          onClick={() => setSelectedArea(null)}
          className={`text-left px-3 py-1.5 text-xs transition-colors ${
            !selectedArea ? 'text-purple-400 font-semibold' : 'text-white/50 hover:text-white/80'
          }`}
        >
          All <span className="text-white/30 text-[10px]">({total})</span>
        </button>
        {metaAreas.map(area => (
          <button
            key={area}
            onClick={() => setSelectedArea(prev => prev === area ? null : area)}
            className={`text-left px-3 py-1.5 text-xs truncate transition-colors ${
              selectedArea === area
                ? 'text-purple-400 font-semibold bg-purple-600/10 border-l-2 border-purple-500'
                : 'text-white/50 hover:text-white/80'
            }`}
          >
            {area}
          </button>
        ))}
      </aside>

      {/* ── Main content ── */}
      <div className="flex flex-col flex-1 min-h-0 min-w-0">

        {/* Search bar */}
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
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
              >
                ×
              </button>
            )}
          </div>
          <span className="text-[11px] text-white/30 flex-shrink-0">
            {loading ? 'Loading…' : `${filtered.length} of ${total} graphs`}
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
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {filtered.map(g => {
                  const isActive = g.id === graphId;
                  const title = g.metadata_title || g.title || 'Untitled';
                  const desc = g.metadata_description || '';
                  const area = g.metadata_meta_area?.trim();
                  const icon = nodeTypeIcon(g.node_types_csv || '');
                  return (
                    <button
                      key={g.id}
                      onClick={() => selectGraph(g)}
                      className={`
                        group text-left rounded-xl border p-3 flex flex-col gap-2 transition-all
                        ${isActive
                          ? 'border-purple-500 bg-purple-600/10 shadow-[0_0_0_1px_rgb(168_85_247/0.3)]'
                          : 'border-white/8 bg-white/3 hover:border-white/20 hover:bg-white/6'
                        }
                      `}
                    >
                      {/* Image or placeholder */}
                      {g.portfolio_image_path ? (
                        <div className="w-full h-[80px] rounded-lg overflow-hidden bg-slate-800 flex-shrink-0">
                          <img
                            src={g.portfolio_image_path}
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
                        {area && (
                          <span className="text-[10px] bg-white/5 text-white/40 px-1.5 py-0.5 rounded truncate max-w-[120px]">
                            {area}
                          </span>
                        )}
                        <span className="text-[10px] text-white/25 ml-auto flex-shrink-0">
                          {g.node_count} nodes
                        </span>
                      </div>

                      {/* Last updated */}
                      <p className="text-[9px] text-white/20 -mt-1">
                        {timeAgo(g.updated_at)}
                        {g.metadata_created_by && g.metadata_created_by !== 'Unknown' && (
                          <span className="ml-1">· {g.metadata_created_by.split('@')[0]}</span>
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
                  );
                })}
              </div>

              {/* Load more */}
              {canLoadMore && (
                <div className="flex justify-center mt-6">
                  <button
                    onClick={() => fetchGraphs(graphs.length, true)}
                    disabled={loadingMore}
                    className="flex items-center gap-2 px-4 py-2 text-xs text-white/50 border border-white/10 rounded-lg hover:border-white/20 hover:text-white/80 transition-colors disabled:opacity-40"
                  >
                    {loadingMore ? (
                      <>
                        <span className="w-3 h-3 border border-white/40 border-t-transparent rounded-full animate-spin" />
                        Loading…
                      </>
                    ) : (
                      `Load more (${total - graphs.length} remaining)`
                    )}
                  </button>
                </div>
              )}
            </>
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
