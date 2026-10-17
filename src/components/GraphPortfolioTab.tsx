import { useState, useEffect, useCallback, useRef, useMemo, useDeferredValue } from 'react';
import { kgAuthHeaders, kgJsonHeaders } from '../lib/kgAuth';

const KG_API = 'https://knowledge.vegvisr.org';
// The server caps a page at 250. A page costs about a second whatever its size, so few large
// pages fetched side by side beat many small ones fetched in turn (27 x 50 took ~27 s; 6 x 250 ~5 s).
const PAGE_SIZE = 250;
const RENDER_STEP = 120; // cards drawn at a time — 1350 cards made every keystroke lag
const SEARCH_MIN = 3; // from this length the server is asked too (it also matches node content)

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
  // Hosts the graph's html-nodes are published to: the node stamp merged with the publish
  // registry by /getknowgraphsummaries and /searchGraphs.
  publishedDomains?: string[];
  // Node types + up to 40 node labels + domains, assembled by the server for searching.
  searchText?: string;
  metadata: GraphMetadata | null;
}

interface Props {
  graphId: string;
  onGraphChange: (id: string) => void;
  onNavigateToChat: () => void;
  onGraphSelected?: ((id: string, title: string) => void) | undefined;
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso || iso === 'Unknown') return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return '';
  const d = Math.floor(diff / 86400000);
  if (d <= 0) return 'today';
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

// /searchGraphs returns FLAT rows ({ title, description, category, metaArea, updatedAt }) while
// /getknowgraphsummaries nests the same fields under `metadata` — accept both shapes.
interface RawSummary extends GraphSummary {
  description?: string;
  createdBy?: string;
  metaArea?: string;
  category?: string;
}

// "https://lipi.vegr.ai/x" and "lipi.vegr.ai" should find the same graph.
function normaliseQuery(q: string): string {
  return q.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim() || q.trim().toLowerCase();
}

function matchesLocal(g: GraphSummary, q: string, raw: string): boolean {
  if (!q) return true;
  const hay = [
    g.metadata?.title || g.title || '',
    g.metadata?.description || '',
    g.metadata?.metaArea || '',
    g.metadata?.category || '',
    g.searchText || '',
    (g.publishedDomains || []).join(' '),
  ].join(' ').toLowerCase();
  return hay.includes(q) || (raw !== q && hay.includes(raw));
}

// Fetched pages survive leaving the tab (the component unmounts), so coming back is instant;
// a fresh copy is fetched behind it.
let portfolioCache: { graphs: GraphSummary[]; total: number } | null = null;

// Normalise a raw summary into a consistent shape (mirrors processGraphSummary in GraphPortfolio.vue)
function processSummary(raw: RawSummary): GraphSummary {
  const meta = raw.metadata || {};
  return {
    ...raw,
    metadata: {
      ...meta,
      title: meta.title || raw.title || 'Untitled',
      description: meta.description || raw.description || '',
      createdBy: meta.createdBy || raw.createdBy || 'Unknown',
      metaArea: meta.metaArea || raw.metaArea || '',
      category: meta.category || raw.category || '',
      // normalise updatedAt into metadata (same as Vue: summary.updatedAt || summary.createdAt || metadata.updatedAt)
      updatedAt: raw.updatedAt || raw.createdAt || meta.updatedAt || undefined,
    },
  };
}

export default function GraphPortfolioTab({ graphId, onGraphChange, onNavigateToChat, onGraphSelected }: Props) {
  const [graphs, setGraphs] = useState<GraphSummary[]>(() => portfolioCache?.graphs || []);
  const [total, setTotal] = useState(() => portfolioCache?.total || 0);
  const [loading, setLoading] = useState(() => !portfolioCache);
  const [hydrating, setHydrating] = useState(false); // remaining pages still loading
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // Extra hits from /searchGraphs (node content matches the summaries cannot see).
  const [serverHits, setServerHits] = useState<{ q: string; hits: GraphSummary[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const [selectedArea, setSelectedArea] = useState<string | null>(null);
  const [selectedCreator, setSelectedCreator] = useState<string | null>(null);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [showDomains, setShowDomains] = useState(false);
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [toast, setToast] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const loadRunRef = useRef(0);
  const searchRunRef = useRef(0);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((text: string, ms = 2500) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(text);
    toastTimerRef.current = setTimeout(() => setToast(null), ms);
  }, []);
  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);

  // MetaArea frequencies — sorted by count descending (matches portfolioStore.sortedMetaAreas)
  const { metaAreas, metaAreaFreq } = useMemo(() => {
    const freq: Record<string, number> = {};
    for (const g of graphs) {
      for (const area of parseMetaAreas(g.metadata?.metaArea)) {
        freq[area] = (freq[area] || 0) + 1;
      }
    }
    const sorted = Object.keys(freq).sort((a, b) => freq[b] - freq[a]);
    return { metaAreas: sorted, metaAreaFreq: freq };
  }, [graphs]);

  // Published hosts, alphabetical, with how many graphs serve each
  const { domains, domainFreq } = useMemo(() => {
    const freq: Record<string, number> = {};
    for (const g of graphs) for (const h of g.publishedDomains || []) freq[h] = (freq[h] || 0) + 1;
    return { domains: Object.keys(freq).sort(), domainFreq: freq };
  }, [graphs]);

  // Unique creators sorted alphabetically
  const creators = useMemo(() => Array.from(
    new Set(
      graphs
        .map(g => g.metadata?.createdBy)
        .filter((c): c is string => !!c && c !== 'Unknown')
    )
  ).sort(), [graphs]);

  // Typing stays responsive: the grid filters against a deferred copy of the query.
  const deferredSearch = useDeferredValue(search);
  const rawQuery = deferredSearch.trim().toLowerCase();
  const query = normaliseQuery(deferredSearch);

  // Filtered + sorted view. The local match runs over every loaded graph (title, description,
  // areas, node labels, published domains); server hits for the same query are added on top.
  const filtered = useMemo(() => {
    const extra = serverHits && serverHits.q === deferredSearch.trim() ? serverHits.hits : [];
    const extraIds = new Set(extra.map(h => h.id));
    const byId = new Set<string>();
    const pool: GraphSummary[] = [];
    for (const g of graphs) {
      if (!query || extraIds.has(g.id) || matchesLocal(g, query, rawQuery)) { pool.push(g); byId.add(g.id); }
    }
    for (const h of extra) if (!byId.has(h.id)) { pool.push(h); byId.add(h.id); }
    return pool
      .filter(g => {
        const matchesArea = !selectedArea || parseMetaAreas(g.metadata?.metaArea).includes(selectedArea);
        // /searchGraphs rows carry no createdBy — don't filter those on a field they lack.
        const createdBy = g.metadata?.createdBy;
        const matchesCreator = !selectedCreator || !createdBy || createdBy === 'Unknown' || createdBy === selectedCreator;
        const matchesDomain = !selectedDomain || (g.publishedDomains || []).includes(selectedDomain);
        return matchesArea && matchesCreator && matchesDomain;
      })
      .sort((a, b) => {
        // A query that names a published host puts the graphs serving it first.
        if (query) {
          const da = (a.publishedDomains || []).some(h => h.includes(query)) ? 0 : 1;
          const db = (b.publishedDomains || []).some(h => h.includes(query)) ? 0 : 1;
          if (da !== db) return da - db;
        }
        if (sortOrder === 'az') {
          const ta = (a.metadata?.title || a.title || '').toLowerCase();
          const tb = (b.metadata?.title || b.title || '').toLowerCase();
          return ta.localeCompare(tb);
        }
        const ta = new Date(a.metadata?.updatedAt || a.updatedAt || 0).getTime() || 0;
        const tb = new Date(b.metadata?.updatedAt || b.updatedAt || 0).getTime() || 0;
        return sortOrder === 'newest' ? tb - ta : ta - tb;
      });
  }, [graphs, serverHits, deferredSearch, query, rawQuery, selectedArea, selectedCreator, selectedDomain, sortOrder]);

  // Draw the grid in steps; a sentinel below the last card asks for the next step.
  const [renderCount, setRenderCount] = useState(RENDER_STEP);
  useEffect(() => { setRenderCount(RENDER_STEP); }, [deferredSearch, selectedArea, selectedCreator, selectedDomain, sortOrder]);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) setRenderCount(n => n + RENDER_STEP);
    }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [filtered.length, renderCount]);

  // Load every page: the first one shows at once, the rest are fetched side by side.
  // With a cached list on screen nothing is cleared — the fresh list replaces it in one step.
  const loadAllGraphs = useCallback(async () => {
    const runId = ++loadRunRef.current;
    const live = () => runId === loadRunRef.current;
    const hadCache = !!portfolioCache;
    setLoadError(null);
    if (!hadCache) setLoading(true);
    setHydrating(true);

    const fetchPage = async (offset: number) => {
      const res = await fetch(`${KG_API}/getknowgraphsummaries?offset=${offset}&limit=${PAGE_SIZE}`, { headers: kgAuthHeaders() });
      if (!res.ok) throw new Error(`Graph list failed (HTTP ${res.status}) at offset ${offset}`);
      const data = await res.json();
      return { total: Number(data.total || 0), rows: ((data.results as RawSummary[]) || []).map(processSummary) };
    };

    try {
      const first = await fetchPage(0);
      if (!live()) return;
      if (!hadCache) {
        setGraphs(first.rows);
        setTotal(first.total);
        setLoading(false);
      }
      const offsets: number[] = [];
      for (let o = PAGE_SIZE; o < first.total; o += PAGE_SIZE) offsets.push(o);
      const pages = await Promise.all(offsets.map(fetchPage));
      if (!live()) return;

      // Offsets can shift if graphs change while pages load — keep each id once.
      const seen = new Set<string>();
      const all: GraphSummary[] = [];
      for (const g of [first.rows, ...pages.map(p => p.rows)].flat()) {
        if (!seen.has(g.id)) { seen.add(g.id); all.push(g); }
      }
      portfolioCache = { graphs: all, total: first.total };
      setGraphs(all);
      setTotal(first.total);
    } catch (e) {
      if (!live()) return;
      setLoadError(e instanceof Error ? e.message : 'Graph list failed');
    } finally {
      if (live()) { setLoading(false); setHydrating(false); }
    }
  }, []);

  useEffect(() => { loadAllGraphs(); }, [loadAllGraphs]);

  // Debounced server search, added to the local matches (never replaces the loaded list).
  useEffect(() => {
    const q = search.trim();
    const runId = ++searchRunRef.current;
    if (q.length < SEARCH_MIN) { setServerHits(null); setSearching(false); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ q, limit: '50', offset: '0' });
        // Without the role header the worker searches PUBLISHED graphs only — drafts vanish.
        const res = await fetch(`${KG_API}/searchGraphs?${params}`, { headers: kgAuthHeaders() });
        if (!res.ok) throw new Error(`Search failed (HTTP ${res.status})`);
        const data = await res.json();
        if (runId !== searchRunRef.current) return;
        setServerHits({ q, hits: ((data.results as RawSummary[]) || []).map(processSummary) });
      } catch (e) {
        if (runId === searchRunRef.current) showToast(e instanceof Error ? e.message : 'Search failed', 3000);
      } finally {
        if (runId === searchRunRef.current) setSearching(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [search, showToast]);

  const deleteGraph = async (id: string) => {
    setDeleting(true);
    try {
      const res = await fetch(`${KG_API}/deleteknowgraph`, {
        method: 'POST',
        headers: kgJsonHeaders(),
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error('Delete failed');
      const title = graphs.find(g => g.id === id)?.metadata?.title || id;
      setGraphs(prev => prev.filter(g => g.id !== id));
      setServerHits(prev => prev && { ...prev, hits: prev.hits.filter(g => g.id !== id) });
      setTotal(prev => prev - 1);
      if (portfolioCache) portfolioCache = { graphs: portfolioCache.graphs.filter(g => g.id !== id), total: portfolioCache.total - 1 };
      showToast(`Deleted: ${title}`);
    } catch {
      showToast('Delete failed — please try again', 3000);
    } finally {
      setDeleting(false);
      setConfirmDeleteId(null);
    }
  };

  const selectGraph = (g: GraphSummary) => {
    onGraphChange(g.id);
    const name = g.metadata?.title || g.title;
    showToast(`Context set: ${name}`);
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

        {/* Published domains filter */}
        {domains.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowDomains(v => !v)}
              className="w-full text-left px-3 text-[10px] uppercase tracking-widest text-white/30 mb-2 hover:text-white/60"
            >
              {showDomains ? '▾' : '▸'} Domains <span className="normal-case tracking-normal">({domains.length})</span>
            </button>
            {selectedDomain && !showDomains && (
              <button
                type="button"
                onClick={() => setSelectedDomain(null)}
                className="w-full text-left px-3 py-1.5 text-xs truncate text-sky-300 font-semibold bg-sky-500/10 border-l-2 border-sky-400"
                title="Clear domain filter"
              >
                {selectedDomain} ×
              </button>
            )}
            {showDomains && domains.map(host => (
              <button
                type="button"
                key={host}
                onClick={() => setSelectedDomain(prev => prev === host ? null : host)}
                className={`w-full text-left px-3 py-1.5 text-xs truncate transition-colors ${
                  selectedDomain === host
                    ? 'text-sky-300 font-semibold bg-sky-500/10 border-l-2 border-sky-400'
                    : 'text-white/50 hover:text-white/80'
                }`}
                title={host}
              >
                {host}
                {domainFreq[host] > 1 && <span className="ml-1 text-white/25 text-[10px]">({domainFreq[host]})</span>}
              </button>
            ))}
          </div>
        )}

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
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search graphs or domains…"
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
            {loading ? 'Loading…' : `${filtered.length} of ${total}${hydrating || searching ? '…' : ''}`}
          </span>
          {loadError && (
            <button
              type="button"
              onClick={() => loadAllGraphs()}
              className="text-[11px] text-red-300 bg-red-500/10 border border-red-500/30 px-2 py-0.5 rounded-full hover:bg-red-500/20"
              title={loadError}
            >
              Load failed — retry
            </button>
          )}
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
              {filtered.slice(0, renderCount).map(g => {
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
                          onError={e => { e.currentTarget.style.display = 'none'; }}
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

                    {/* Node type tags — html-node highlighted so it's spottable at a glance */}
                    {(g.nodeTypes?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {Array.from(new Set(g.nodeTypes)).map(t => (
                          <span
                            key={t}
                            className={`text-[9px] px-1.5 py-0.5 rounded font-mono truncate max-w-[110px] ${
                              t === 'html-node'
                                ? 'bg-sky-500/20 text-sky-300'
                                : 'bg-white/5 text-white/40'
                            }`}
                            title={t}
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Published domains — click to filter on that host */}
                    {(g.publishedDomains?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {(g.publishedDomains || []).map(host => (
                          <span
                            key={host}
                            role="button"
                            tabIndex={0}
                            onClick={e => { e.stopPropagation(); setSelectedDomain(prev => prev === host ? null : host); }}
                            onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); setSelectedDomain(prev => prev === host ? null : host); } }}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 hover:bg-sky-500/30 truncate max-w-full"
                            title={`Show graphs published to ${host}`}
                          >
                            {host}
                          </span>
                        ))}
                      </div>
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
          {!loading && renderCount < filtered.length && (
            <div ref={sentinelRef} className="py-4 text-center">
              <button
                type="button"
                onClick={() => setRenderCount(n => n + RENDER_STEP)}
                className="text-xs text-white/40 hover:text-white/70"
              >
                Show more ({filtered.length - renderCount} left)
              </button>
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
