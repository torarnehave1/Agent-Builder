import { useState, useEffect, useCallback } from 'react';

const AGENT_API = 'https://agent.vegvisr.org';

interface Recording {
  recordingId: string;
  displayName: string;
  fileName: string;
  duration: number | null;
  fileSize: number | null;
  tags: string[];
  category: string;
  hasTranscription: boolean;
  audioUrl: string;
  createdAt: string;
  source?: string;
}

interface Props {
  userId: string;
  onClose: () => void;
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds)) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatDate(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso.slice(0, 16);
  }
}

export default function RecordingsPanel({ userId, onClose }: Props) {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${AGENT_API}/recordings?userId=${encodeURIComponent(userId)}&limit=50`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setRecordings(Array.isArray(data?.recordings) ? data.recordings : []);
      setTotal(typeof data?.total === 'number' ? data.total : (data?.recordings?.length || 0));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to load recordings: ${msg}`);
      setRecordings([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col h-full w-full md:w-[420px] border-l border-white/10 bg-slate-950/95">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-slate-900/80">
        <div className="text-white/80 text-sm font-medium">
          Recordings {total > 0 && <span className="text-white/40 text-xs">({total})</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="px-2 py-0.5 rounded text-xs bg-white/[0.06] border border-white/10 text-white/60 hover:bg-white/[0.10] hover:text-white/80 disabled:opacity-40"
            title="Reload"
          >
            {loading ? '…' : 'Reload'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-white/40 hover:text-white/80 text-sm px-2 py-0.5 rounded hover:bg-white/[0.06]"
            title="Close panel"
          >
            ×
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-3 py-2 text-xs text-rose-300 bg-rose-500/10 border-b border-rose-500/20">
          {error}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2">
        {loading && recordings.length === 0 && (
          <div className="text-white/50 text-xs flex items-center gap-2">
            <span className="inline-block w-3 h-3 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
            Loading recordings...
          </div>
        )}

        {!loading && recordings.length === 0 && !error && (
          <div className="text-white/30 text-xs italic">
            No recordings found.
          </div>
        )}

        {recordings.map(r => (
          <div
            key={r.recordingId}
            className="rounded border border-white/10 bg-white/[0.03] px-3 py-2 text-xs"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-white/80 font-medium truncate" title={r.displayName}>
                  {r.displayName || r.fileName || r.recordingId}
                </div>
                <div className="text-white/40 text-[10px] mt-0.5">
                  {formatDate(r.createdAt)} · {formatDuration(r.duration)}
                  {r.category && <> · {r.category}</>}
                  {r.source && <> · {r.source}</>}
                </div>
                {(r.tags || []).length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {r.tags.map(t => (
                      <span key={t} className="px-1.5 py-0.5 rounded bg-white/[0.05] text-white/50 text-[9px]">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                {r.hasTranscription && (
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[9px] border border-emerald-500/20" title="Has transcription">
                    transcribed
                  </span>
                )}
                {r.audioUrl && (
                  <a
                    href={r.audioUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 text-[9px] border border-sky-500/20 hover:bg-sky-500/25"
                    title="Open audio in new tab"
                  >
                    play ↗
                  </a>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="px-3 py-2 border-t border-white/10 bg-slate-900/40 text-[10px] text-white/30">
        Direct lookup — no agent involved.
      </div>
    </div>
  );
}
