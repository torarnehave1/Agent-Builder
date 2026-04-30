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

function buildCredentialHeaders({ cookie = '', authorization = '', authToken = '' } = {}) {
  const headers = {}
  const normalizedCookie = typeof cookie === 'string' ? cookie.trim() : ''
  const normalizedAuthorization = typeof authorization === 'string' ? authorization.trim() : ''
  const normalizedToken = typeof authToken === 'string' ? authToken.trim() : ''

  if (normalizedCookie) headers.cookie = normalizedCookie
  if (normalizedAuthorization) headers.authorization = normalizedAuthorization

  if (normalizedToken) {
    if (!headers.authorization) headers.authorization = `Bearer ${normalizedToken}`
    if (!headers.cookie) headers.cookie = `vegvisr_token=${encodeURIComponent(normalizedToken)}`
  }

  return headers
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

async function resolveUserProfileByToken(token, env) {
  if (!token) return null
  const normalizedToken = String(token).trim()
  if (!normalizedToken) return null

  return await env.DB.prepare(
    'SELECT email, user_id, Role AS role, phone, bio, emailVerificationToken FROM config WHERE emailVerificationToken = ?'
  ).bind(normalizedToken).first()
}

export async function resolveAuthenticatedSessionWithCredentials(credentials, env) {
  const headers = buildCredentialHeaders(credentials)
  if (!headers.cookie && !headers.authorization) return null

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

export async function resolveAuthenticatedSession(request, env) {
  return resolveAuthenticatedSessionWithCredentials({
    cookie: request.headers.get('cookie') || '',
    authorization: request.headers.get('authorization') || request.headers.get('Authorization') || '',
  }, env)
}

export async function resolveAuthorizedCallerWithCredentials(credentials, env) {
  const directToken = typeof credentials?.authToken === 'string' && credentials.authToken.trim()
    ? credentials.authToken.trim()
    : (
      typeof credentials?.authorization === 'string' && credentials.authorization.trim().toLowerCase().startsWith('bearer ')
        ? credentials.authorization.trim().slice(7).trim()
        : ''
    )

  const session = await resolveAuthenticatedSessionWithCredentials(credentials, env)
  if (session) {
    const profile = await resolveUserProfileByIdentity(session, env).catch(() => null)
    return {
      authenticated: true,
      authToken: directToken,
      session,
      profile,
      userId: profile?.user_id || session.id || session.email || null,
      email: profile?.email || session.email || null,
      role: profile?.role || session.role || null,
    }
  }

  const tokenProfile = await resolveUserProfileByToken(directToken, env).catch(() => null)
  if (tokenProfile) {
    return {
      authenticated: true,
      authToken: directToken,
      session: {
        id: tokenProfile.user_id || null,
        email: tokenProfile.email || null,
        role: tokenProfile.role || null,
      },
      profile: tokenProfile,
      userId: tokenProfile.user_id || tokenProfile.email || null,
      email: tokenProfile.email || null,
      role: tokenProfile.role || null,
    }
  }

  return {
    authenticated: false,
    authToken: '',
    session: null,
    profile: null,
    userId: null,
    email: null,
    role: null,
  }
}

export async function resolveAuthorizedCaller(request, env) {
  return resolveAuthorizedCallerWithCredentials({
    cookie: request.headers.get('cookie') || '',
    authorization: request.headers.get('authorization') || request.headers.get('Authorization') || '',
  }, env)
}
