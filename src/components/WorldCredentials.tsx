import { useEffect, useState } from 'react';

const AGENT_API = 'https://agent.vegvisr.org';

interface Props {
  resolvedTheme?: 'light' | 'dark';
}

interface WorldRow {
  domain: string;
  founder_email: string | null;
  hosting_model: string | null;
  cf_account_id: string | null;
  token_stored: boolean;
}

interface CredentialState {
  domain: string;
  founder_email: string | null;
  cf_account_id: string | null;
  kv_namespace_id: string | null;
  token_stored: boolean;
  token_suffix: string | null;
  token_live: boolean | null;
}

// Same convention as GitHubConnect: the Agent-Builder login leaves no cookie session the
// worker can see, so every authenticated call carries this token explicitly.
function getAuthToken(): string {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    return user.emailVerificationToken || '';
  } catch {
    return '';
  }
}

// A World's Cloudflare token, entered OUTSIDE the agent chat.
//
// Typing a token into the chat sends it to the model provider, which logs it — that is how one
// token was burned on 2026-09-23. This field posts it straight to the worker, which verifies it
// against Cloudflare and writes it to the founder's row. The secret is never part of a prompt,
// never in a tool call, and is dropped from component state the moment it is saved. Nothing here
// ever displays a stored token: the worker returns only the last six characters.
export default function WorldCredentials({ resolvedTheme = 'dark' }: Props) {
  const [worlds, setWorlds] = useState<WorldRow[]>([]);
  const [domain, setDomain] = useState('');
  const [accountId, setAccountId] = useState('');
  const [token, setToken] = useState('');
  const [state, setState] = useState<CredentialState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const isLight = resolvedTheme === 'light';

  useEffect(() => {
    fetch(`${AGENT_API}/world-credentials?list=1`, { headers: { 'X-API-Token': getAuthToken() } })
      .then((r) => r.json())
      .then((d) => setWorlds(Array.isArray(d.worlds) ? d.worlds : []))
      .catch(() => setError('Could not load the World registry.'));
  }, []);

  const pick = (d: string) => {
    setDomain(d);
    const row = worlds.find((w) => w.domain === d);
    setAccountId(row?.cf_account_id || '');
    setState(null);
    if (d) check(d);
  };

  const check = async (forDomain?: string) => {
    const d = (forDomain ?? domain).trim().toLowerCase();
    if (!d) return;
    setBusy(true);
    setError('');
    setSaved('');
    try {
      const res = await fetch(`${AGENT_API}/world-credentials?domain=${encodeURIComponent(d)}`, {
        headers: { 'X-API-Token': getAuthToken() },
      });
      const data = await res.json();
      if (!res.ok) {
        setState(null);
        setError(data.error || `Could not read the World's credential state (HTTP ${res.status}).`);
      } else {
        setState(data);
        if (data.cf_account_id && !accountId) setAccountId(data.cf_account_id);
      }
    } catch {
      setError('Could not reach the worker.');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const d = domain.trim().toLowerCase();
    if (!d || !token.trim()) return;
    setBusy(true);
    setError('');
    setSaved('');
    try {
      const res = await fetch(`${AGENT_API}/world-credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Token': getAuthToken() },
        body: JSON.stringify({
          domain: d,
          cf_account_id: accountId.trim(),
          cf_api_token: token.trim(),
        }),
      });
      const data = await res.json();
      // Hold the secret no longer than the request, whether it was accepted or refused.
      setToken('');
      if (!res.ok || data.success === false) {
        setError(data.error || `Cloudflare refused the token (HTTP ${res.status}).`);
      } else {
        setSaved(data.message || 'Stored.');
        await check(d);
      }
    } catch {
      setToken('');
      setError('Could not reach the worker. Nothing was stored.');
    } finally {
      setBusy(false);
    }
  };

  const field = `w-full rounded-lg border px-3 py-2 text-xs ${
    isLight ? 'border-slate-200 bg-white text-slate-900' : 'border-white/10 bg-white/[0.04] text-white'
  }`;
  const labelClass = `text-xs mb-1 block ${isLight ? 'text-slate-600' : 'text-white/60'}`;

  return (
    <div className={`rounded-2xl border p-5 ${isLight ? 'border-slate-200 bg-white' : 'border-white/10 bg-white/[0.03]'}`}>
      <h3 className={`text-sm font-semibold mb-1 ${isLight ? 'text-slate-900' : 'text-white'}`}>World Cloudflare credentials</h3>
      <p className={`text-xs mb-4 ${isLight ? 'text-slate-500' : 'text-white/50'}`}>
        Store a World's API token here, never in the chat — a token typed into a prompt is read and logged
        by the model provider, and must be treated as compromised. The token is verified against Cloudflare
        before it is stored, and is never shown again.
      </p>

      <div className="flex flex-col gap-3">
        <div>
          <label className={labelClass}>World</label>
          <select className={field} value={domain} onChange={(e) => pick(e.target.value)}>
            <option value="">— choose a World —</option>
            {worlds.map((w) => (
              <option key={w.domain} value={w.domain}>
                {w.domain}
                {w.hosting_model === 'own_account' ? ' · own account' : ''}
                {w.token_stored ? ' · token stored' : ' · no token'}
              </option>
            ))}
          </select>
        </div>

        {state && (
          <div className={`rounded-lg border px-3 py-2 text-xs ${isLight ? 'border-slate-200 bg-slate-50 text-slate-700' : 'border-white/10 bg-white/[0.04] text-white/70'}`}>
            <div>Founder: {state.founder_email || '—'}</div>
            <div>Account: {state.cf_account_id || <span className="text-amber-400">not set</span>}</div>
            <div>
              Token:{' '}
              {!state.token_stored ? (
                <span className="text-amber-400">none stored</span>
              ) : state.token_live === false ? (
                <span className="text-rose-400">{state.token_suffix} — REJECTED by Cloudflare</span>
              ) : state.token_live === null ? (
                <span>{state.token_suffix} — could not verify</span>
              ) : (
                <span className="text-emerald-400">{state.token_suffix} — accepted</span>
              )}
            </div>
            <div>Page store: {state.kv_namespace_id || <span className="text-amber-400">not provisioned</span>}</div>
          </div>
        )}

        <div>
          <label className={labelClass}>Cloudflare account id</label>
          <input
            className={field}
            value={accountId}
            placeholder="from the World's Cloudflare account"
            onChange={(e) => setAccountId(e.target.value)}
          />
        </div>

        <div>
          <label className={labelClass}>API token</label>
          <input
            className={field}
            type="password"
            value={token}
            autoComplete="off"
            spellCheck={false}
            placeholder="paste the token here"
            onChange={(e) => setToken(e.target.value)}
          />
        </div>

        {(!domain || !token.trim()) && (
          <p className={`text-xs ${isLight ? 'text-slate-500' : 'text-white/40'}`}>
            {!domain ? 'Choose a World first.' : 'Paste the API token to enable Store.'}
          </p>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy || !domain.trim() || !token.trim()}
            onClick={save}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
          >
            {busy ? 'Verifying…' : 'Store token'}
          </button>
          <button
            type="button"
            disabled={busy || !domain.trim()}
            onClick={() => check()}
            className={`rounded-lg border px-3 py-2 text-xs disabled:opacity-40 ${isLight ? 'border-slate-200 text-slate-700' : 'border-white/10 text-white/70'}`}
          >
            Check
          </button>
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}
      {saved && <p className="mt-3 text-xs text-emerald-300">{saved}</p>}
    </div>
  );
}
