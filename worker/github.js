// GitHub App connector — OAuth user-to-server flow + token storage/refresh + API helper.
// Mirrors this worker's existing D1 (env.DB) + resolveAuthorizedCaller auth conventions.

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const GITHUB_API_BASE = 'https://api.github.com'

export function buildGithubAuthorizeUrl(env, state) {
  const params = new URLSearchParams({
    client_id: env.GITHUB_APP_CLIENT_ID,
    state,
  })
  return `${GITHUB_AUTHORIZE_URL}?${params.toString()}`
}

async function requestGithubToken(env, body) {
  const res = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_APP_CLIENT_ID,
      client_secret: env.GITHUB_APP_CLIENT_SECRET,
      ...body,
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`GitHub token exchange failed: ${data.error_description || data.error}`)
  return data
}

// code -> { access_token, expires_in, refresh_token, refresh_token_expires_in }
export async function exchangeGithubCode(env, code) {
  return requestGithubToken(env, { code })
}

async function refreshGithubToken(env, refreshToken) {
  return requestGithubToken(env, { grant_type: 'refresh_token', refresh_token: refreshToken })
}

export async function saveGithubConnection(env, userId, tokenData) {
  const now = new Date()
  const accessExpiresAt = tokenData.expires_in
    ? new Date(now.getTime() + tokenData.expires_in * 1000).toISOString()
    : null
  const refreshExpiresAt = tokenData.refresh_token_expires_in
    ? new Date(now.getTime() + tokenData.refresh_token_expires_in * 1000).toISOString()
    : null

  let accountLogin = null
  try {
    const res = await fetch(`${GITHUB_API_BASE}/user`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, 'User-Agent': 'agent-builder', Accept: 'application/vnd.github+json' },
    })
    if (res.ok) accountLogin = (await res.json()).login || null
  } catch { /* non-fatal — account_login is informational only */ }

  await env.DB.prepare(
    `INSERT INTO github_connections (user_id, installation_id, access_token, access_token_expires_at, refresh_token, refresh_token_expires_at, account_login, connected_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       installation_id = excluded.installation_id,
       access_token = excluded.access_token,
       access_token_expires_at = excluded.access_token_expires_at,
       refresh_token = excluded.refresh_token,
       refresh_token_expires_at = excluded.refresh_token_expires_at,
       account_login = excluded.account_login,
       connected_at = datetime('now')`
  ).bind(
    userId,
    tokenData.installation_id || '',
    tokenData.access_token,
    accessExpiresAt,
    tokenData.refresh_token || null,
    refreshExpiresAt,
    accountLogin,
  ).run()

  return { accountLogin }
}

export async function getGithubConnection(env, userId) {
  if (!userId) return null
  const row = await env.DB.prepare('SELECT * FROM github_connections WHERE user_id = ?').bind(userId).first()
  if (!row) return null

  const expiresAt = row.access_token_expires_at ? new Date(row.access_token_expires_at) : null
  const isExpired = expiresAt && expiresAt.getTime() < Date.now() + 60_000 // refresh 1 min early
  if (!isExpired || !row.refresh_token) return row

  const refreshed = await refreshGithubToken(env, row.refresh_token)
  await saveGithubConnection(env, userId, { ...refreshed, installation_id: row.installation_id })
  return { ...row, access_token: refreshed.access_token }
}

export async function disconnectGithub(env, userId) {
  await env.DB.prepare('DELETE FROM github_connections WHERE user_id = ?').bind(userId).run()
}

// A hard, config-level backstop that disables all GitHub write tools outright —
// independent of and in addition to the per-call confirmed:true gate already on
// github_write_file / github_create_pr. Mirrors github-mcp-server's --read-only
// flag: "write tools are skipped... even if explicitly requested."
export async function setGithubReadOnly(env, userId, readOnly) {
  await env.DB.prepare('UPDATE github_connections SET read_only = ? WHERE user_id = ?')
    .bind(readOnly ? 1 : 0, userId).run()
}

// Throws if the connected user has read-only mode enabled. Call this at the
// top of every GitHub write-tool executor before making any mutating API call.
export async function assertGithubWriteAllowed(env, userId) {
  const conn = await getGithubConnection(env, userId)
  if (conn && conn.read_only) {
    const err = new Error('GitHub is set to read-only for this account. Turn off read-only mode in Settings to allow writes.')
    err.code = 'READ_ONLY'
    throw err
  }
}

// Rate-limit handling per GitHub's own documented order of precedence
// (docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api):
//   1. Retry-After header present → wait exactly that long.
//   2. Otherwise x-ratelimit-remaining === 0 → wait until x-ratelimit-reset.
//   3. Otherwise (secondary/abuse limit, transient 5xx) → exponential backoff.
//   4. Stop and fail loudly past a bounded retry count — GitHub warns that
//      continuing to hit a rate-limited endpoint risks the integration being banned.
// Waits are capped so a single tool call can't stall a chat turn indefinitely —
// a wait longer than the cap fails fast with a clear "try again shortly" error
// instead of blocking, since a Worker invocation has a wall-clock budget.
const RATE_LIMIT_MAX_RETRIES = 3
const RATE_LIMIT_MAX_WAIT_MS = 15_000

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isRateLimited(res) {
  if (res.status === 403 || res.status === 429) return true
  return false
}

function computeRateLimitWaitMs(res) {
  const retryAfter = res.headers.get('retry-after')
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10)
    if (!Number.isNaN(seconds)) return seconds * 1000
  }
  const remaining = res.headers.get('x-ratelimit-remaining')
  const reset = res.headers.get('x-ratelimit-reset')
  if (remaining === '0' && reset) {
    const resetMs = parseInt(reset, 10) * 1000
    return Math.max(0, resetMs - Date.now())
  }
  return null // secondary/abuse limit or transient error with no explicit signal
}

// Low-level fetch shared by githubApiRequest and githubPaginate — returns both
// the parsed body and the raw Response so callers that need response headers
// (e.g. the Link header for pagination) aren't forced to re-fetch.
async function githubFetch(env, userId, path, options = {}) {
  const conn = await getGithubConnection(env, userId)
  if (!conn) {
    const err = new Error('No GitHub connection for this user. Connect GitHub first in Settings.')
    err.code = 'NOT_CONNECTED'
    throw err
  }

  const doFetch = () => fetch(path.startsWith('http') ? path : `${GITHUB_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${conn.access_token}`,
      'User-Agent': 'agent-builder',
      Accept: 'application/vnd.github+json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })

  let res = await doFetch()
  let attempt = 0
  while (isRateLimited(res) && attempt < RATE_LIMIT_MAX_RETRIES) {
    const explicitWaitMs = computeRateLimitWaitMs(res)
    const waitMs = explicitWaitMs !== null ? explicitWaitMs : Math.min(1_000 * 2 ** attempt, RATE_LIMIT_MAX_WAIT_MS)
    if (waitMs > RATE_LIMIT_MAX_WAIT_MS) {
      const err = new Error(`GitHub rate limit hit — reset is ${Math.ceil(waitMs / 1000)}s away, longer than this call can wait. Try again shortly.`)
      err.status = res.status
      err.code = 'RATE_LIMITED'
      throw err
    }
    await sleep(waitMs)
    attempt += 1
    res = await doFetch()
  }

  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
  if (!res.ok) {
    const err = new Error(data.message || `GitHub API error (${res.status})`)
    err.status = res.status
    err.data = data
    if (isRateLimited(res)) err.code = 'RATE_LIMITED'
    throw err
  }
  return { data, res }
}

// Thin wrapper for calling the GitHub REST API as the connected user.
export async function githubApiRequest(env, userId, path, options = {}) {
  const { data } = await githubFetch(env, userId, path, options)
  return data
}

// Extracts the "next" URL from a GitHub Link response header, per GitHub's
// documented pagination contract (rel="next"/"prev"/"first"/"last"). Returns
// null when the header is absent — GitHub omits it once results fit on one page.
function extractNextLink(linkHeader) {
  if (!linkHeader) return null
  const match = linkHeader.split(',').find(part => /rel="next"/.test(part))
  if (!match) return null
  const urlMatch = match.match(/<([^>]+)>/)
  return urlMatch ? urlMatch[1] : null
}

// Fully paginates a GitHub list endpoint by following the Link header's
// rel="next" URL until it's absent, rather than assuming any fixed per_page
// ceiling is enough (a per_page=100-only call still silently truncates any
// account with more than 100 items). `arrayKey` selects which field of each
// page's JSON body holds the array to accumulate (e.g. "repositories" for
// /user/installations/{id}/repositories, or omit for endpoints that return
// a bare array like /user/repos).
export async function githubPaginate(env, userId, path, { arrayKey, perPage = 100, maxPages = 20 } = {}) {
  const sep = path.includes('?') ? '&' : '?'
  let nextUrl = `${GITHUB_API_BASE}${path}${sep}per_page=${perPage}`
  const items = []
  let pages = 0
  while (nextUrl && pages < maxPages) {
    const { data, res } = await githubFetch(env, userId, nextUrl)
    const pageItems = arrayKey ? (data[arrayKey] || []) : (Array.isArray(data) ? data : [])
    items.push(...pageItems)
    nextUrl = extractNextLink(res.headers.get('link'))
    pages += 1
  }
  return items
}
