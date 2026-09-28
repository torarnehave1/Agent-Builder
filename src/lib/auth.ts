export type AuthUser = {
  userId: string;
  email: string;
  role?: string | null;
};

const AUTH_SESSION_URL = '/auth/openauth/session';

export const readStoredUser = (): AuthUser | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem('user');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const userId = parsed.user_id || parsed.oauth_id;
    const email = parsed.email;
    if (!userId || !email) return null;
    return { userId, email, role: parsed.role || null };
  } catch {
    return null;
  }
};

/**
 * The signed-in user's X-API-Token (their emailVerificationToken).
 *
 * AuthUser deliberately omits it, but the Vegvisr workers authenticate subrequests with it —
 * agent-worker's /upload-image and /generate-image both 401 without it. The auth flow persists
 * it in localStorage.'user' (see persistUser in App.tsx).
 *
 * Returns '' when signed out, so callers can decide whether that is fatal.
 */
export const getApiToken = (): string => {
  if (typeof window === 'undefined') return '';
  try {
    const parsed = JSON.parse(window.localStorage.getItem('user') || '{}');
    return parsed.emailVerificationToken || '';
  } catch {
    return '';
  }
};

export const fetchAuthSession = async (): Promise<AuthUser | null> => {
  const res = await fetch(AUTH_SESSION_URL, { credentials: 'include' });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data?.success || !data?.subject) return null;
  return {
    userId: data.subject.id,
    email: data.subject.email,
    role: data.subject.role || null
  };
};

export const loginUrl = (redirectTo: string) => {
  const target = encodeURIComponent(redirectTo);
  return `https://login.vegvisr.org?redirect=${target}`;
};
