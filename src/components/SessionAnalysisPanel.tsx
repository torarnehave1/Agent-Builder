import { useState, useEffect, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const AGENT_API = 'https://agent.vegvisr.org';
const CHAT_HISTORY_API = 'https://api.vegvisr.org/chat-history';

interface SessionInfo {
  id: string;
  title: string;
  updatedAt: string;
}

interface DialogMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  userId: string;
  onClose: () => void;
}

export default function SessionAnalysisPanel({ userId, onClose }: Props) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [overview, setOverview] = useState<string | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [dialog, setDialog] = useState<DialogMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const dialogEndRef = useRef<HTMLDivElement | null>(null);

  // Load agent sessions on mount
  useEffect(() => {
    if (!userId) return;
    setSessionsLoading(true);
    fetch(`${CHAT_HISTORY_API}/agent-sessions`, { headers: { 'x-user-id': userId, 'Content-Type': 'application/json' } })
      .then(r => r.json())
      .then(data => {
        const list = (data.sessions || []).map((s: { id: string; title?: string; updated_at?: string }) => ({
          id: s.id,
          title: s.title || 'Untitled',
          updatedAt: s.updated_at || '',
        }));
        setSessions(list);
      })
      .catch(err => setError(`Failed to load sessions: ${err?.message || err}`))
      .finally(() => setSessionsLoading(false));
  }, [userId]);

  // Auto-scroll dialog
  useEffect(() => {
    dialogEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [dialog, overviewLoading]);

  const selectSession = useCallback(async (sid: string) => {
    setSelectedId(sid);
    setOverview(null);
    setDialog([]);
    setInput('');
    setError(null);
    setOverviewLoading(true);
    try {
      const res = await fetch(`${AGENT_API}/analyze-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
        body: JSON.stringify({ sessionId: sid, userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setOverview(data.overview || '_(empty overview)_');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Overview failed: ${msg}`);
      setOverview(null);
    } finally {
      setOverviewLoading(false);
    }
  }, [userId]);

  const sendDialog = useCallback(async () => {
    const text = input.trim();
    if (!text || !selectedId || sending) return;
    setSending(true);
    setError(null);
    const userMsg: DialogMessage = { role: 'user', content: text };
    const nextHistory = [...dialog, userMsg];
    setDialog(nextHistory);
    setInput('');
    try {
      const res = await fetch(`${AGENT_API}/analyze-session/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
        body: JSON.stringify({ sessionId: selectedId, userId, history: dialog, message: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setDialog([...nextHistory, { role: 'assistant', content: data.reply || '_(no reply)_' }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Reply failed: ${msg}`);
    } finally {
      setSending(false);
    }
  }, [input, selectedId, dialog, sending, userId]);

  const handleInputKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendDialog();
    }
  };

  const selectedTitle = sessions.find(s => s.id === selectedId)?.title || '';

  return (
    <div className="flex flex-col h-full w-full md:w-[420px] border-l border-white/10 bg-slate-950/95">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-slate-900/80">
        <div className="text-white/80 text-sm font-medium">Session Analysis</div>
        <button
          type="button"
          onClick={onClose}
          className="text-white/40 hover:text-white/80 text-sm px-2 py-0.5 rounded hover:bg-white/[0.06]"
          title="Close panel"
        >
          ×
        </button>
      </div>

      {/* Session picker */}
      <div className="px-3 py-2 border-b border-white/10">
        <label htmlFor="analysis-session-select" className="block text-[10px] uppercase tracking-wide text-white/40 mb-1">
          Agent session
        </label>
        <select
          id="analysis-session-select"
          value={selectedId || ''}
          onChange={e => { if (e.target.value) selectSession(e.target.value); }}
          disabled={sessionsLoading || overviewLoading}
          className="w-full bg-white/[0.06] border border-white/10 rounded px-2 py-1 text-white/80 text-xs outline-none focus:border-sky-400/40"
        >
          <option value="" disabled>
            {sessionsLoading ? 'Loading sessions...' : sessions.length === 0 ? 'No agent sessions' : 'Pick a session to analyze'}
          </option>
          {sessions.map(s => (
            <option key={s.id} value={s.id}>
              {s.title}{s.updatedAt ? ` — ${new Date(s.updatedAt).toLocaleDateString()}` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-3 py-2 text-xs text-rose-300 bg-rose-500/10 border-b border-rose-500/20">
          {error}
        </div>
      )}

      {/* Body — overview + dialog */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
        {!selectedId && !overviewLoading && (
          <div className="text-white/30 text-xs italic">
            Pick a session above to get a broad overview. After the overview appears, you can ask follow-up questions in the dialog below.
          </div>
        )}

        {overviewLoading && (
          <div className="text-white/50 text-xs flex items-center gap-2">
            <span className="inline-block w-3 h-3 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
            Analyzing session...
          </div>
        )}

        {overview && (
          <div className="rounded border border-white/10 bg-white/[0.03] p-3">
            <div className="text-[10px] uppercase tracking-wide text-white/40 mb-1">Overview</div>
            {selectedTitle && <div className="text-white/60 text-xs mb-2 truncate" title={selectedTitle}>{selectedTitle}</div>}
            <div className="prose prose-invert prose-sm max-w-none text-white/80 text-xs">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{overview}</ReactMarkdown>
            </div>
          </div>
        )}

        {dialog.map((m, i) => (
          <div key={i} className={`rounded p-2 text-xs ${m.role === 'user' ? 'bg-sky-500/10 border border-sky-500/20 text-sky-100' : 'bg-white/[0.04] border border-white/10 text-white/80'}`}>
            <div className="text-[10px] uppercase tracking-wide text-white/40 mb-1">{m.role}</div>
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
            </div>
          </div>
        ))}

        {sending && (
          <div className="text-white/50 text-xs flex items-center gap-2">
            <span className="inline-block w-3 h-3 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
            Thinking...
          </div>
        )}

        <div ref={dialogEndRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-2 border-t border-white/10 bg-slate-900/40">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleInputKey}
          placeholder={overview ? 'Ask about this session... (Enter to send)' : 'Pick a session first'}
          disabled={!overview || sending}
          rows={2}
          className="w-full bg-white/[0.04] border border-white/10 rounded px-2 py-1.5 text-white/80 text-xs outline-none focus:border-sky-400/40 resize-none disabled:opacity-40"
        />
        <div className="flex items-center justify-between mt-1">
          <div className="text-[10px] text-white/30">Dialog is not saved — closing the panel clears it.</div>
          <button
            type="button"
            onClick={sendDialog}
            disabled={!overview || sending || !input.trim()}
            className="px-2 py-1 rounded text-xs bg-sky-500/20 border border-sky-500/40 text-sky-200 hover:bg-sky-500/30 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
