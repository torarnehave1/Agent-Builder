const TRUSTED_ORIGIN_RE = /^https?:\/\/(?:(?:localhost|127\.0\.0\.1)(?::\d+)?|(?:[\w-]+\.)*vegvisr\.org)$/i

function isTrustedOrigin(origin) {
  return !!origin && TRUSTED_ORIGIN_RE.test(origin)
}

export function buildCorsHeaders(request, extra = {}) {
  const origin = request.headers.get('origin') || request.headers.get('Origin') || ''
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
    'Vary': 'Origin',
  }

  if (isTrustedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Credentials'] = 'true'
  } else {
    headers['Access-Control-Allow-Origin'] = '*'
  }

  return { ...headers, ...extra }
}

export function applyCorsHeaders(request, response) {
  const headers = new Headers(response.headers)
  const corsHeaders = buildCorsHeaders(request)
  for (const [key, value] of Object.entries(corsHeaders)) headers.set(key, value)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

async function resolveUserProfileByIdentity(identity, env) {
  if (!identity) return null

  if (identity.email) {
    const byEmail = await env.DB.prepare(
      'SELECT email, user_id, Role AS role, phone, bio, emailVerificationToken FROM config WHERE email = ?'
    ).bind(identity.email).first()
    if (byEmail) return byEmail
  }

  if (identity.id) {
    const byId = await env.DB.prepare(
      'SELECT email, user_id, Role AS role, phone, bio, emailVerificationToken FROM config WHERE user_id = ?'
    ).bind(identity.id).first()
    if (byId) return byId
  }

  return null
}

export async function resolveAuthenticatedSession(request, env) {
  const cookie = request.headers.get('cookie') || ''
  const authorization = request.headers.get('authorization') || request.headers.get('Authorization') || ''
  if (!cookie && !authorization) return null

  const headers = {}
  if (cookie) headers.cookie = cookie
  if (authorization) headers.authorization = authorization

  try {
    const res = await fetch('https://auth.vegvisr.org/auth/openauth/session', {
      method: 'GET',
      headers,
    })
    if (!res.ok) return null
    const data = await res.json().catch(() => null)
    if (!data?.success || !data?.subject) return null
    return {
      id: data.subject.id || null,
      email: data.subject.email || null,
      role: data.subject.role || null,
    }
  } catch {
    return null
  }
}

export async function resolveAuthorizedCaller(request, env) {
  const session = await resolveAuthenticatedSession(request, env)
  if (!session) {
    return {
      authenticated: false,
      session: null,
      profile: null,
      userId: null,
      email: null,
      role: null,
    }
  }

  const profile = await resolveUserProfileByIdentity(session, env).catch(() => null)
  return {
    authenticated: true,
    session,
    profile,
    userId: profile?.user_id || session.id || session.email || null,
    email: profile?.email || session.email || null,
    role: profile?.role || session.role || null,
  }
}
