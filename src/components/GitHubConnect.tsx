import { useEffect, useState } from 'react';

const AGENT_API = 'https://agent.vegvisr.org';

interface Props {
  resolvedTheme?: 'light' | 'dark';
}

// Agent-Builder's login doesn't create a session the worker's cookie-based auth
// can see — every authenticated call passes this stored token explicitly instead
// (same convention AgentChat.tsx uses for /chat).
function getAuthToken(): string {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    return user.emailVerificationToken || '';
  } catch {
    return '';
  }
}

export default function GitHubConnect({ resolvedTheme = 'dark' }: Props) {
  const [connected, setConnected] = useState(false);
  const [accountLogin, setAccountLogin] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const isLight = resolvedTheme === 'light';

  const loadStatus = () => {
    setLoading(true);
    fetch(`${AGENT_API}/github/status?authToken=${encodeURIComponent(getAuthToken())}`)
      .then((res) => res.json())
      .then((data) => {
        setConnected(!!data.connected);
        setAccountLogin(data.accountLogin || null);
        setReadOnly(!!data.readOnly);
        setError('');
      })
      .catch(() => setError('Could not check GitHub connection status.'))
      .finally(() => setLoading(false));
  };

  const handleToggleReadOnly = async () => {
    const next = !readOnly;
    setReadOnly(next); // optimistic — matches the hard server-side gate this drives
    await fetch(`${AGENT_API}/github/read-only`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authToken: getAuthToken(), readOnly: next }),
    }).catch(() => {
      setReadOnly(!next);
      setError('Could not update read-only mode.');
    });
  };

  useEffect(() => {
    loadStatus();
    // If we just came back from the OAuth callback redirect, refresh status.
    const params = new URLSearchParams(window.location.search);
    if (params.get('github') === 'connected') {
      const url = new URL(window.location.href);
      url.searchParams.delete('github');
      url.searchParams.delete('as');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  const handleConnect = () => {
    window.location.href = `${AGENT_API}/github/oauth/start?authToken=${encodeURIComponent(getAuthToken())}`;
  };

  const handleDisconnect = async () => {
    await fetch(`${AGENT_API}/github/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authToken: getAuthToken() }),
    });
    loadStatus();
  };

  return (
    <div className={`rounded-2xl border p-5 ${isLight ? 'border-slate-200 bg-white' : 'border-white/10 bg-white/[0.03]'}`}>
      <h3 className={`text-sm font-semibold mb-1 ${isLight ? 'text-slate-900' : 'text-white'}`}>GitHub</h3>
      <p className={`text-xs mb-4 ${isLight ? 'text-slate-500' : 'text-white/50'}`}>
        Connect a GitHub account so chat can list, read, and write files in your repos.
      </p>
      {loading ? (
        <div className={`text-xs ${isLight ? 'text-slate-400' : 'text-white/40'}`}>Checking connection…</div>
      ) : connected ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className={`text-xs ${isLight ? 'text-slate-700' : 'text-white/70'}`}>
              Connected{accountLogin ? ` as ${accountLogin}` : ''}
            </span>
            <button
              type="button"
              onClick={handleDisconnect}
              className="rounded-lg border border-rose-400/40 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10"
            >
              Disconnect
            </button>
          </div>
          <label className={`flex items-center gap-2 text-xs cursor-pointer ${isLight ? 'text-slate-600' : 'text-white/60'}`}>
            <input type="checkbox" checked={readOnly} onChange={handleToggleReadOnly} className="accent-amber-500" />
            Read-only mode — blocks all GitHub writes (commits, pull requests), even if chat asks to confirm one
          </label>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleConnect}
          className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
        >
          Connect GitHub
        </button>
      )}
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
    </div>
  );
}
