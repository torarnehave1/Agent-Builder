import { useEffect, useState } from 'react';

const AGENT_WORKER_URL = import.meta.env.VITE_AGENT_WORKER_URL || 'https://agent.vegvisr.org';

interface UsageData {
  period: { days: number; since: string };
  totals: {
    sessions: number;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
    turns: number;
    avg_duration_ms: number;
    fast_path_sessions: number;
  };
  byModel: { model: string; sessions: number; input_tokens: number; output_tokens: number; cost_usd: number }[];
  dailyCost: { day: string; sessions: number; cost_usd: number; input_tokens: number; output_tokens: number }[];
  topTools: { tool_name: string; calls: number; successes: number }[];
  recentSessions: {
    id: string; user_id: string; started_at: string; model: string;
    turns: number; input_tokens: number; output_tokens: number;
    cost_usd: number; success: number; duration_ms: number;
    agent_id: string | null; max_turns_reached: number;
  }[];
}

const MODEL_LABELS: Record<string, string> = {
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-sonnet-4-20250514': 'Sonnet 4',
  'claude-opus-4-6': 'Opus 4.6',
  'claude-opus-4-20250514': 'Opus 4',
  'fast-path': 'Fast-path',
};

function fmt(n: number | null | undefined, decimals = 0) {
  if (n == null) return '—';
  if (decimals > 0) return n.toFixed(decimals);
  return n.toLocaleString();
}

function fmtCost(n: number | null | undefined) {
  if (n == null) return '—';
  if (n < 0.01) return '<$0.01';
  return `$${n.toFixed(3)}`;
}

function fmtMs(ms: number | null | undefined) {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white/[0.04] border border-white/10 rounded-xl p-4">
      <div className="text-[11px] text-white/40 mb-1">{label}</div>
      <div className="text-lg font-semibold text-white">{value}</div>
      {sub && <div className="text-[11px] text-white/30 mt-0.5">{sub}</div>}
    </div>
  );
}

interface Props {
  userId: string;
}

export default function UsageDashboard({ userId }: Props) {
  const [data, setData] = useState<UsageData | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    fetch(`${AGENT_WORKER_URL}/api/usage?days=${days}`)
      .then(r => r.json())
      .then((d: UsageData) => setData(d))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [userId, days]);

  // Daily sparkline — simple bar chart using relative heights
  const maxDailyCost = data ? Math.max(...(data.dailyCost.map(d => d.cost_usd || 0)), 0.0001) : 1;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">Usage & Cost</h2>
            <p className="text-xs text-white/40 mt-0.5">Agent Builder API usage tracked in agent-stats-db</p>
          </div>
          <div className="flex items-center gap-2">
            {([7, 14, 30] as const).map(d => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  days === d ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {loading && (
          <div className="text-center py-12 text-white/30 text-sm">Loading usage data…</div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-300">{error}</div>
        )}

        {data && !loading && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard
                label="Total cost"
                value={fmtCost(data.totals.cost_usd)}
                sub={`last ${days} days`}
              />
              <StatCard
                label="Sessions"
                value={fmt(data.totals.sessions)}
                sub={`${fmt(data.totals.fast_path_sessions)} fast-path`}
              />
              <StatCard
                label="Input tokens"
                value={data.totals.input_tokens >= 1_000_000
                  ? `${(data.totals.input_tokens / 1_000_000).toFixed(1)}M`
                  : fmt(data.totals.input_tokens)}
                sub="across all turns"
              />
              <StatCard
                label="Avg session time"
                value={fmtMs(data.totals.avg_duration_ms)}
                sub={`${fmt(data.totals.turns)} total turns`}
              />
            </div>

            {/* Daily cost sparkline */}
            {data.dailyCost.length > 1 && (
              <div className="bg-white/[0.03] border border-white/10 rounded-xl p-4">
                <div className="text-[11px] text-white/40 mb-3">Daily cost</div>
                <div className="flex items-end gap-1 h-16">
                  {data.dailyCost.map(d => {
                    const h = Math.max(2, Math.round(((d.cost_usd || 0) / maxDailyCost) * 56));
                    return (
                      <div key={d.day} className="flex-1 flex flex-col items-center justify-end group relative">
                        <div
                          style={{ height: `${h}px` }}
                          className="w-full bg-sky-500/40 group-hover:bg-sky-400/60 rounded-sm transition-colors"
                        />
                        {/* Tooltip */}
                        <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 whitespace-nowrap bg-slate-800 border border-white/10 rounded px-2 py-1 text-[10px] text-white/80">
                          <div>{d.day}</div>
                          <div>{fmtCost(d.cost_usd)} · {fmt(d.sessions)} sessions</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between text-[10px] text-white/20 mt-1">
                  <span>{data.dailyCost[0]?.day}</span>
                  <span>{data.dailyCost[data.dailyCost.length - 1]?.day}</span>
                </div>
              </div>
            )}

            {/* By model */}
            {data.byModel.length > 0 && (
              <div className="bg-white/[0.03] border border-white/10 rounded-xl p-4">
                <div className="text-[11px] text-white/40 mb-3">Cost by model</div>
                <div className="space-y-2">
                  {data.byModel.map(m => {
                    const pct = data.totals.cost_usd > 0 ? ((m.cost_usd || 0) / data.totals.cost_usd) * 100 : 0;
                    return (
                      <div key={m.model}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-white/70">{MODEL_LABELS[m.model] || m.model}</span>
                          <span className="text-white/50 font-mono">{fmtCost(m.cost_usd)} · {fmt(m.sessions)} sessions</span>
                        </div>
                        <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-sky-500/50 rounded-full"
                            style={{ width: `${pct.toFixed(1)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Top tools */}
            {data.topTools.length > 0 && (
              <div className="bg-white/[0.03] border border-white/10 rounded-xl p-4">
                <div className="text-[11px] text-white/40 mb-3">Most used tools</div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                  {data.topTools.slice(0, 16).map(t => (
                    <div key={t.tool_name} className="flex items-center justify-between">
                      <span className="text-xs text-white/60 truncate max-w-[160px]">{t.tool_name}</span>
                      <span className="text-xs text-white/30 font-mono ml-2 flex-shrink-0">
                        {fmt(t.calls)}
                        {t.calls > 0 && t.successes < t.calls && (
                          <span className="text-red-400/60 ml-1">({t.calls - t.successes} err)</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent sessions */}
            {data.recentSessions.length > 0 && (
              <div className="bg-white/[0.03] border border-white/10 rounded-xl p-4">
                <div className="text-[11px] text-white/40 mb-3">Recent sessions</div>
                <div className="space-y-1.5">
                  {data.recentSessions.map(s => (
                    <div key={s.id} className="flex items-center gap-3 text-xs">
                      <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${s.success ? 'bg-emerald-400/60' : 'bg-red-400/60'}`} />
                      <span className="text-white/30 font-mono flex-shrink-0 w-[100px]">
                        {s.started_at.slice(5, 16).replace('T', ' ')}
                      </span>
                      <span className="text-white/50 flex-shrink-0 w-[80px]">{MODEL_LABELS[s.model] || s.model}</span>
                      <span className="text-white/30 flex-shrink-0">{s.turns}t</span>
                      <span className="text-white/30 flex-shrink-0 font-mono">{fmtCost(s.cost_usd)}</span>
                      <span className="text-white/20 flex-shrink-0">{fmtMs(s.duration_ms)}</span>
                      {s.max_turns_reached ? <span className="text-amber-400/50 flex-shrink-0">max</span> : null}
                      {s.agent_id && <span className="text-purple-400/50 truncate">{s.agent_id.slice(0, 8)}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data.totals.sessions === 0 && (
              <div className="text-center py-8 text-white/20 text-sm">
                No sessions recorded in the last {days} days.
                <br />
                <span className="text-xs">Sessions are tracked in agent-stats-db after your first chat.</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
