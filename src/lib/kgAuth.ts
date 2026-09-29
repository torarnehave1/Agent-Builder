/**
 * Auth headers for Knowledge Graph API calls.
 *
 * WHY THIS EXISTS (2026-09-29)
 * ----------------------------
 * knowledge-graph-worker closed two holes in late September 2026: a bare `x-user-role`
 * header used to be trusted on its own (2026-09-26), and `Origin: https://www.vegvisr.org`
 * used to grant write access to every graph (2026-09-27, now capped at graph:read). Both
 * were settable by anyone with curl.
 *
 * Every KG write in this app sent exactly `x-user-role: Superadmin` (+ sometimes
 * x-user-email) and nothing else, so every one of them has answered 401 since:
 *
 *   Session authentication requires a session token (X-Session-Token) — a role header
 *   alone is not sufficient. Log in again to obtain one.
 *
 * vegvisr-frontend migrated its 63 call sites to `src/utils/kgAuth.js`; this app did not.
 * This is the same helper, so the two apps cannot drift apart again.
 *
 * WHAT THE WORKER ACTUALLY CHECKS (dev-worker/index.js, "Method 3"): `X-Session-Token` is
 * looked up in `config.emailVerificationToken`, and the caller's email AND role are read
 * from THAT row. The `x-user-role` header's VALUE is advisory — the worker never authorizes
 * on it — but its PRESENCE is what selects the session branch, so both must be sent.
 *
 * READS are unaffected and stay that way: verified 2026-09-29, GET /getknowgraph with a bare
 * role header still answers 200. That is why a signed-out caller still gets the role header
 * here — dropping it would quietly hide draft graphs from every list in the app. A write
 * without a token then fails with the worker's own message, which already says what to do.
 */

type StoredUser = {
  role?: string | null;
  token?: string | null;
  emailVerificationToken?: string | null;
};

function readStored(key: string): StoredUser {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as StoredUser) : {};
  } catch {
    return {};
  }
}

/**
 * The session token this browser can prove an identity with: the same
 * emailVerificationToken the magic-link flow issues. `user` is what App.tsx persists;
 * `vegvisr_user` is the canonical record vegvisr-auth writes on published pages.
 */
export function kgSessionToken(): string {
  const user = readStored('user');
  const canonical = readStored('vegvisr_user');
  return (
    user.emailVerificationToken || user.token ||
    canonical.token || canonical.emailVerificationToken || ''
  );
}

/**
 * The signed-in user's real role — not a hardcoded "Superadmin". The worker ignores the
 * value, but asserting a role you do not hold is the exact habit the 2026-09-26 fix ends.
 */
export function kgRole(): string {
  const user = readStored('user');
  const canonical = readStored('vegvisr_user');
  return user.role || canonical.role || 'User';
}

/** Auth headers for any KG call. Spread into a fetch's `headers`. */
export function kgAuthHeaders(): Record<string, string> {
  const token = kgSessionToken();
  const headers: Record<string, string> = { 'x-user-role': kgRole() };
  if (token) headers['X-Session-Token'] = token;
  return headers;
}

/** Auth headers plus Content-Type, for a KG POST body. */
export function kgJsonHeaders(extra?: Record<string, string>): Record<string, string> {
  return { 'Content-Type': 'application/json', ...kgAuthHeaders(), ...(extra || {}) };
}

/**
 * True when this browser can perform a KG WRITE at all. Call it before a save to say
 * "you are signed out" in the app's own words, instead of letting the user discover it
 * through a 401 from another service.
 */
export function canWriteKg(): boolean {
  return kgSessionToken() !== '';
}
