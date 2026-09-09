// Instagram connector — Business Login OAuth + long-lived token storage/refresh +
// webhook signature verification. Mirrors github.js and this worker's env.DB /
// resolveAuthorizedCaller conventions.
//
// Contracts below are transcribed from Meta's "Instagram API with Instagram Login"
// docs (Business Login, Webhooks). Response SHAPES are documented but not yet
// confirmed against a live call — the first real connect is what verifies them.

const IG_AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize'
const IG_TOKEN_URL = 'https://api.instagram.com/oauth/access_token'
const IG_GRAPH_BASE = 'https://graph.instagram.com'

// instagram_business_basic is mandatory (it is also what makes a long-lived token
// refreshable at all). The other two are what this integration is actually for:
// reading/replying to comments, and the DM inbox.
const IG_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_comments',
  'instagram_business_manage_messages',
].join(',')

// The redirect_uri must match the one registered on the Meta app EXACTLY —
// same scheme, host, path, no trailing slash. agent.vegvisr.org is this worker's
// own public route (wrangler.toml [[routes]]).
export function instagramRedirectUri(env) {
  return env.INSTAGRAM_REDIRECT_URI || 'https://agent.vegvisr.org/instagram/oauth/callback'
}

export function buildInstagramAuthorizeUrl(env, state) {
  const params = new URLSearchParams({
    client_id: env.INSTAGRAM_APP_ID,
    redirect_uri: instagramRedirectUri(env),
    response_type: 'code',
    scope: IG_SCOPES,
    state,
  })
  return `${IG_AUTHORIZE_URL}?${params.toString()}`
}

// Step 1: authorization code -> SHORT-lived token (1 hour). The code itself is
// single-use and valid 1 hour.
async function exchangeCodeForShortLivedToken(env, code) {
  const res = await fetch(IG_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.INSTAGRAM_APP_ID,
      client_secret: env.INSTAGRAM_APP_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: instagramRedirectUri(env),
      code,
    }).toString(),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error_type || data.error_message) {
    throw new Error(`Instagram code exchange failed: ${data.error_message || data.error || res.status}`)
  }
  return data // { access_token, user_id, permissions }
}

// Step 2: short-lived -> LONG-lived token (60 days). Note this one is a GET.
async function exchangeForLongLivedToken(env, shortLivedToken) {
  const params = new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_secret: env.INSTAGRAM_APP_SECRET,
    access_token: shortLivedToken,
  })
  const res = await fetch(`${IG_GRAPH_BASE}/access_token?${params.toString()}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error) {
    throw new Error(`Instagram long-lived exchange failed: ${data.error?.message || res.status}`)
  }
  return data // { access_token, token_type, expires_in }
}

// Refresh buys another 60 days. Meta's preconditions: the token must be at least
// 24 hours old, STILL UNEXPIRED, and the user must have granted
// instagram_business_basic. "Still unexpired" is the trap — unlike GitHub there is
// no refresh_token to fall back on, so an expired token is dead and the user has to
// reconnect by hand. Hence the 7-day pre-expiry window in getInstagramConnection.
async function refreshInstagramToken(env, accessToken) {
  const params = new URLSearchParams({
    grant_type: 'ig_refresh_token',
    access_token: accessToken,
  })
  const res = await fetch(`${IG_GRAPH_BASE}/refresh_access_token?${params.toString()}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error) {
    throw new Error(`Instagram token refresh failed: ${data.error?.message || res.status}`)
  }
  return data // { access_token, token_type, expires_in }
}

export async function saveInstagramConnection(env, userId, { accessToken, expiresIn, igUserId, permissions }) {
  const expiresAt = expiresIn
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null

  // Informational only — a failure here must not lose a valid token.
  let username = null
  let resolvedIgUserId = igUserId ? String(igUserId) : null
  try {
    const res = await fetch(`${IG_GRAPH_BASE}/me?fields=user_id,username&access_token=${encodeURIComponent(accessToken)}`)
    if (res.ok) {
      const me = await res.json()
      username = me.username || null
      resolvedIgUserId = me.user_id ? String(me.user_id) : resolvedIgUserId
    }
  } catch { /* non-fatal */ }

  if (!resolvedIgUserId) throw new Error('Instagram connect failed: no Instagram user id returned.')

  await env.DB.prepare(
    `INSERT INTO instagram_connections (user_id, ig_user_id, username, access_token, token_expires_at, permissions, connected_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       ig_user_id = excluded.ig_user_id,
       username = excluded.username,
       access_token = excluded.access_token,
       token_expires_at = excluded.token_expires_at,
       permissions = excluded.permissions,
       connected_at = datetime('now')`
  ).bind(
    userId,
    resolvedIgUserId,
    username,
    accessToken,
    expiresAt,
    Array.isArray(permissions) ? permissions.join(',') : (permissions || null),
  ).run()

  return { igUserId: resolvedIgUserId, username, expiresAt }
}

// Webhook fields this app subscribes each connected account to. Meta requires
// BOTH the app-level field subscription (App Dashboard) AND this per-account
// call — the dashboard toggle alone delivers nothing.
const SUBSCRIBED_FIELDS = ['comments', 'messages', 'message_reactions', 'mentions'].join(',')

// Step 3 of Meta's four-step webhook setup: "Your app must enable subscriptions
// by sending a POST request to the /me/subscribed_apps endpoint with the
// subscribed_fields parameter." Without it, a correctly configured callback URL
// and a correctly subscribed app still receive zero live events.
export async function subscribeAccountToWebhooks(env, accessToken) {
  const res = await fetch(`${IG_GRAPH_BASE}/v23.0/me/subscribed_apps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      subscribed_fields: SUBSCRIBED_FIELDS,
      access_token: accessToken,
    }).toString(),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error) {
    throw new Error(`Instagram subscribed_apps failed: ${data.error?.message || res.status}`)
  }
  return data // { success: true }
}

// Removes this app's webhook subscription from an account. Meta's docs are
// inconsistent about whether DELETE is supported on this edge for Instagram Login
// (the Page variant's docs say Instagram subscriptions cannot be removed via the
// API), so the real response is logged — the first call settles it rather than a
// guess. Callers treat failure as non-fatal.
export async function unsubscribeAccountFromWebhooks(env, accessToken) {
  const res = await fetch(`${IG_GRAPH_BASE}/v23.0/me/subscribed_apps?access_token=${encodeURIComponent(accessToken)}`, {
    method: 'DELETE',
  })
  const body = await res.text()
  console.log(`[instagram] unsubscribe DELETE /me/subscribed_apps status=${res.status} body=${body.slice(0, 400)}`)
  if (!res.ok) throw new Error(`Instagram unsubscribe failed (${res.status}): ${body.slice(0, 200)}`)
  return body
}

// Reads back which fields this account is actually subscribed to — the state the
// App Dashboard's per-account toggle claims to represent but does not prove.
export async function getAccountSubscriptions(env, accessToken) {
  const res = await fetch(`${IG_GRAPH_BASE}/v23.0/me/subscribed_apps?access_token=${encodeURIComponent(accessToken)}`)
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

// Full connect: code -> short-lived -> long-lived -> stored -> subscribed.
//
// Reconnecting as a DIFFERENT Instagram account is the dangerous case: the row is
// keyed on user_id, so the upsert silently replaces the previous account's token
// while that account stays subscribed at Meta. Events then keep arriving for an
// account we can no longer authenticate as, or even identify. Unsubscribe the
// outgoing account first, while its token is still in hand.
export async function connectInstagram(env, userId, code) {
  const short = await exchangeCodeForShortLivedToken(env, code)
  const long = await exchangeForLongLivedToken(env, short.access_token)

  const prior = await env.DB.prepare('SELECT ig_user_id, access_token FROM instagram_connections WHERE user_id = ?')
    .bind(userId).first().catch(() => null)
  if (prior?.access_token && String(prior.ig_user_id) !== String(short.user_id)) {
    try {
      await unsubscribeAccountFromWebhooks(env, prior.access_token)
      console.log(`[instagram] unsubscribed replaced account ${prior.ig_user_id}`)
    } catch (err) {
      console.error(`[instagram] could not unsubscribe replaced account ${prior.ig_user_id}: ${err.message}`)
    }
  }

  const saved = await saveInstagramConnection(env, userId, {
    accessToken: long.access_token,
    expiresIn: long.expires_in,
    igUserId: short.user_id,
    permissions: short.permissions,
  })

  // Non-fatal: a stored connection with no webhook subscription is still useful
  // for reads, and the failure is worth surfacing rather than losing the token.
  let subscribed = false
  let subscribeError = null
  try {
    await subscribeAccountToWebhooks(env, long.access_token)
    subscribed = true
  } catch (err) {
    subscribeError = err.message
    console.error('[instagram] subscribed_apps failed after connect', err.message)
  }
  return { ...saved, subscribed, subscribeError }
}

// Lazy refresh on read, same shape as getGithubConnection — but the window is 7
// days, not 1 minute, because an expired IG token cannot be recovered.
export async function getInstagramConnection(env, userId) {
  if (!userId) return null
  const row = await env.DB.prepare('SELECT * FROM instagram_connections WHERE user_id = ?').bind(userId).first()
  return refreshIfStale(env, row)
}

// Webhook deliveries carry the Instagram-scoped account id, not this app's userId.
export async function getInstagramConnectionByIgUserId(env, igUserId) {
  if (!igUserId) return null
  const row = await env.DB.prepare('SELECT * FROM instagram_connections WHERE ig_user_id = ?')
    .bind(String(igUserId)).first()
  return refreshIfStale(env, row)
}

const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

async function refreshIfStale(env, row) {
  if (!row) return null
  const expiresAt = row.token_expires_at ? new Date(row.token_expires_at) : null
  if (!expiresAt || expiresAt.getTime() > Date.now() + REFRESH_WINDOW_MS) return row

  // Already dead — no refresh path exists; surface it as disconnected so callers
  // tell the user to reconnect instead of firing a doomed Graph call.
  if (expiresAt.getTime() <= Date.now()) return { ...row, expired: true }

  try {
    const refreshed = await refreshInstagramToken(env, row.access_token)
    const newExpiry = refreshed.expires_in
      ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
      : row.token_expires_at
    await env.DB.prepare('UPDATE instagram_connections SET access_token = ?, token_expires_at = ? WHERE user_id = ?')
      .bind(refreshed.access_token, newExpiry, row.user_id).run()
    return { ...row, access_token: refreshed.access_token, token_expires_at: newExpiry }
  } catch (err) {
    console.error('[instagram] token refresh failed', err.message)
    return row // still usable until it actually expires
  }
}

// Sends a direct message as the connected professional account.
//
// TWO HARD LIMITS, both enforced by Meta and neither visible from the payload:
//   * You may only message someone who messaged the account first, and only
//     within 24 HOURS of their last message. Outside that window the call is
//     rejected — there is no way to open a conversation.
//   * A private reply to a comment is the one exception (recipient {comment_id}),
//     allowed within 7 days of the comment and exactly ONCE per comment.
// `recipient` is passed through verbatim so both forms are usable:
//   { id: "<IGSID>" }  or  { comment_id: "<comment id>" }
// Formats Meta accepts per attachment type. Anything outside these is rejected
// by Meta with an opaque error, so it is caught here instead, where the reason
// can be explained. Note webm is valid for VIDEO but not for AUDIO.
export const IG_ATTACHMENT_FORMATS = {
  image: ['png', 'jpg', 'jpeg'],
  audio: ['aac', 'm4a', 'wav', 'mp4'],
  video: ['mp4', 'ogg', 'avi', 'mov', 'webm'],
  file: ['pdf'],
}

// Best-effort extension from a media URL. Chat media is served as
// /media?key=…%2Fname.ext and voice as /audio?key=…%2Fname.ext, so the
// extension lives in the query string rather than the path.
export function mediaExtension(url) {
  try {
    const u = new URL(url)
    const key = u.searchParams.get('key') || u.pathname
    const m = decodeURIComponent(key).match(/\.([a-z0-9]+)$/i)
    return m ? m[1].toLowerCase() : null
  } catch {
    return null
  }
}

// Throws with a human reason when Meta would reject the file anyway.
export function assertAttachmentSupported(type, url) {
  const allowed = IG_ATTACHMENT_FORMATS[type]
  if (!allowed) throw new Error(`unsupported_attachment_type_${type}`)
  const ext = mediaExtension(url)
  if (!ext) return // unknown extension: let Meta decide rather than blocking
  if (!allowed.includes(ext)) {
    throw new Error(`format_${ext}_not_supported_for_${type}`)
  }
}

export async function sendInstagramMessage(env, accessToken, igUserId, recipient, text, attachment = null) {
  if (!recipient || (!recipient.id && !recipient.comment_id)) {
    throw new Error('sendInstagramMessage: recipient needs an id or comment_id')
  }

  let message
  if (attachment) {
    // { type: 'image'|'audio'|'video'|'file', url } — Meta FETCHES the url, so
    // it has to be publicly reachable (chat media and voice both are).
    assertAttachmentSupported(attachment.type, attachment.url)
    message = { attachment: { type: attachment.type, payload: { url: attachment.url } } }
  } else {
    const bytes = new TextEncoder().encode(text || '').length
    if (!bytes) throw new Error('sendInstagramMessage: empty message')
    if (bytes > 1000) throw new Error(`sendInstagramMessage: text is ${bytes} bytes, Meta's limit is 1000`)
    message = { text }
  }

  const res = await fetch(`${IG_GRAPH_BASE}/v23.0/${igUserId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ recipient, message }),
  })
  const data = await res.json().catch(() => ({}))
  console.log(`[instagram] send status=${res.status} body=${JSON.stringify(data).slice(0, 400)}`)
  if (!res.ok || data.error) {
    const e = data.error || {}
    throw new Error(`Instagram send failed (${res.status}): ${e.message || 'unknown'}${e.code ? ` [code ${e.code}]` : ''}`)
  }
  return data // { recipient_id, message_id }
}

export async function disconnectInstagram(env, userId) {
  // Drop the webhook subscription before the token is gone — afterwards there is
  // no way to authenticate as that account to stop the deliveries.
  const row = await env.DB.prepare('SELECT ig_user_id, access_token FROM instagram_connections WHERE user_id = ?')
    .bind(userId).first().catch(() => null)
  if (row?.access_token) {
    try {
      await unsubscribeAccountFromWebhooks(env, row.access_token)
    } catch (err) {
      console.error(`[instagram] unsubscribe on disconnect failed for ${row.ig_user_id}: ${err.message}`)
    }
  }
  await env.DB.prepare('DELETE FROM instagram_connections WHERE user_id = ?').bind(userId).run()
}

// ---------------------------------------------------------------------------
// Conversation ingestion (option A: one chat group per Instagram conversation)
// ---------------------------------------------------------------------------

// Best-effort display name for the other party. The messaging webhook carries
// only the sender's scoped id, so the username is fetched separately. Logged
// verbatim because this contract is unverified — a failure just leaves the
// thread named by its id.
export async function lookupParticipant(env, accessToken, igsid) {
  // `username` is documented as unavailable on a scoped id, but it demonstrably
  // returns one here, so it stays in the field list — the observation outranks
  // the doc. `profile_pic` is the avatar; note Meta serves it from a signed CDN
  // URL that EXPIRES, so a stored value will eventually 404.
  try {
    const res = await fetch(`${IG_GRAPH_BASE}/v23.0/${igsid}?fields=username,name,profile_pic&access_token=${encodeURIComponent(accessToken)}`)
    const body = await res.text()
    console.log(`[instagram] participant lookup ${igsid} status=${res.status} body=${body.slice(0, 300)}`)
    if (!res.ok) return { username: null, name: null, profilePic: null }
    const d = JSON.parse(body)
    return { username: d.username || null, name: d.name || null, profilePic: d.profile_pic || null }
  } catch (err) {
    console.log(`[instagram] participant lookup ${igsid} threw ${err.message}`)
    return { username: null, name: null, profilePic: null }
  }
}

// Finds the chat group for this (account, participant) pair, creating it on
// first contact. The group lives in CHAT_DB; the mapping lives in DB.
async function findOrCreateThread(env, conn, participantIgsid) {
  const existing = await env.DB.prepare(
    'SELECT * FROM instagram_threads WHERE ig_user_id = ? AND participant_igsid = ?'
  ).bind(String(conn.ig_user_id), String(participantIgsid)).first()
  if (existing) return existing

  const info = await lookupParticipant(env, conn.access_token, participantIgsid)
  const username = info.username || info.name
  const groupId = crypto.randomUUID()
  const now = Date.now()
  // Channel prefix keeps every thread for an account together in the group list.
  const name = `IG ${conn.username || conn.ig_user_id} · ${username || participantIgsid}`

  // external_kind is what lets group-chat-worker decide, without a subrequest on
  // every message, whether an outgoing message must also be relayed to Instagram.
  await env.CHAT_DB.prepare(
    'INSERT INTO groups (id, name, created_by, created_at, updated_at, external_kind) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(groupId, name, conn.user_id, now, now, 'instagram').run()

  // The owner must be a member: ensureMember gates READING the group, and the
  // Instagram participant deliberately gets no member row — they are an author
  // string, not an account (mirrors how bot: authors work).
  await env.CHAT_DB.prepare(
    'INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
  ).bind(groupId, conn.user_id, 'owner', now).run()

  await env.DB.prepare(
    `INSERT INTO instagram_threads (group_id, ig_user_id, participant_igsid, participant_username, participant_avatar_url, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))`
  ).bind(groupId, String(conn.ig_user_id), String(participantIgsid), username, info.profilePic).run()

  console.log(`[instagram] created thread group ${groupId} "${name}"`)
  return { group_id: groupId, ig_user_id: String(conn.ig_user_id), participant_igsid: String(participantIgsid), participant_username: username, last_inbound_at: null }
}

// Claims an idempotency key. Returns true if this caller won the claim, false
// if the key was already taken — i.e. the message has already been handled.
// INSERT OR IGNORE makes this atomic: two concurrent deliveries cannot both win.
export async function claimMessageKey(env, key, groupId, kind) {
  const res = await env.DB.prepare(
    'INSERT OR IGNORE INTO instagram_message_keys (key, group_id, kind, created_at) VALUES (?, ?, ?, ?)'
  ).bind(key, groupId || null, kind, Date.now()).run()
  return (res?.meta?.changes ?? 0) > 0
}

// Releases a claim so a genuine retry can proceed — used when the work the claim
// was guarding did not actually happen.
export async function releaseMessageKey(env, key) {
  await env.DB.prepare('DELETE FROM instagram_message_keys WHERE key = ?').bind(key).run().catch(() => {})
}

// Meta attachment type -> chat message_type, and the file extension we store
// it under. `share`, `ig_reel` and `story_mention` are link-shaped rather than
// files, so they are handled as text rather than downloaded.
const IG_ATTACHMENT_TO_CHAT = {
  image: { messageType: 'image', ext: '.jpg' },
  video: { messageType: 'video', ext: '.mp4' },
  audio: { messageType: 'voice', ext: '.m4a' },
  file:  { messageType: 'pdf',   ext: '.pdf' },
}

// Pulls an inbound attachment out of Meta's CDN and into our own R2, returning
// a durable url. Meta's links are signed and expire, so keeping them would mean
// images silently disappearing from the chat history.
async function rehostAttachment(env, groupId, url, kind, accessToken) {
  // Meta's lookaside CDN links are signed but still require the account's
  // access token. Fetching without it returns a Facebook HTML login page with
  // status 200 — which we would happily store as a .jpg. Hence both the token
  // and the content-type check below.
  // THE USER-AGENT IS LOAD-BEARING. A Workers fetch sends no browser UA, and
  // Facebook's lookaside CDN answers those with an "Update Your Browser" HTML
  // page — at status 200, so it reads as success and gets stored as a .jpg.
  // Auth is NOT the issue: bearer header, ?access_token= and no auth at all all
  // returned the same page until a real UA was sent.
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'image/avif,image/webp,image/apng,image/*,video/*,audio/*,application/pdf,*/*;q=0.8',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  })
  const contentType = res.headers.get('content-type') || 'application/octet-stream'
  console.log(`[instagram] attachment fetch status=${res.status} type=${contentType}`)
  if (!res.ok) throw new Error(`fetch attachment failed: ${res.status}`)
  if (/^text\/html/i.test(contentType)) {
    throw new Error('attachment fetch returned HTML instead of media')
  }
  const stored = await env.CHAT_WORKER.fetch('https://group-chat-worker/internal/media-ingest', {
    method: 'POST',
    headers: {
      'X-Internal-Secret': env.INTERNAL_SHARED_SECRET || '',
      'X-Group-Id': groupId,
      'X-Media-Content-Type': contentType,
      'X-File-Name': `ig_${Date.now()}${kind.ext}`,
    },
    body: res.body,
  })
  const data = await stored.json().catch(() => ({}))
  if (!stored.ok || !data.mediaUrl) {
    throw new Error(`media-ingest failed: ${stored.status} ${JSON.stringify(data).slice(0, 200)}`)
  }
  return { mediaUrl: data.mediaUrl, contentType }
}

// Writes one inbound Instagram message into its chat group.
// Returns null (and writes nothing) for events that are not genuine inbound
// messages — see the two guards below, both learned from real deliveries.
export async function ingestInboundMessage(env, conn, senderId, msg) {
  // Guard 1 — our own outgoing message echoes back as a `messaging` event with
  // senderId equal to the connected account. Ingesting it would duplicate every
  // reply into the thread AND, worse, extend last_inbound_at so the composer
  // would report a closed conversation as open.
  if (String(senderId) === String(conn.ig_user_id)) return null

  // Guard 2 — read receipts and reactions arrive as `messaging` events with
  // neither text nor attachments. They are not messages and must not move the
  // window. An attachment with no caption IS a message.
  const text = msg?.message?.text || ''
  const attachments = Array.isArray(msg?.message?.attachments) ? msg.message.attachments : []
  if (!text && attachments.length === 0) return null

  // The attachment payload shape is not pinned down in Meta's docs — log the
  // real thing so the first delivery settles it rather than a guess.
  if (attachments.length) {
    console.log('[instagram] inbound attachments', JSON.stringify(attachments).slice(0, 600))
  }

  // Meta retries deliveries it does not get a prompt 200 for. Claim the message
  // id BEFORE any insert, so a retry cannot half-duplicate a message that has
  // both an attachment and text.
  const mid = msg?.message?.mid
  if (mid) {
    const won = await claimMessageKey(env, `in:${mid}`, null, 'in')
    if (!won) {
      console.log(`[instagram] duplicate delivery ignored mid=${mid}`)
      return null
    }
  }

  const thread = await findOrCreateThread(env, conn, senderId)
  const now = Date.now()
  const author = `ig:${senderId}`

  for (const att of attachments) {
    const kind = IG_ATTACHMENT_TO_CHAT[att?.type]
    const url = att?.payload?.url
    if (!kind || !url) {
      // share / ig_reel / story_mention and anything unrecognised: keep the link
      // as text rather than dropping the message entirely.
      const label = att?.payload?.title || att?.type || 'vedlegg'
      const link = att?.payload?.url || ''
      await env.CHAT_DB.prepare(
        `INSERT INTO group_messages (group_id, user_id, body, created_at, message_type)
         VALUES (?, ?, ?, ?, 'text')`
      ).bind(thread.group_id, author, `[${label}] ${link}`.trim(), now).run()
      continue
    }
    try {
      const { mediaUrl, contentType } = await rehostAttachment(env, thread.group_id, url, kind, conn.access_token)
      if (kind.messageType === 'voice') {
        await env.CHAT_DB.prepare(
          `INSERT INTO group_messages (group_id, user_id, body, created_at, message_type, audio_url)
           VALUES (?, ?, '', ?, 'voice', ?)`
        ).bind(thread.group_id, author, now, mediaUrl).run()
      } else {
        await env.CHAT_DB.prepare(
          `INSERT INTO group_messages (group_id, user_id, body, created_at, message_type, media_url, media_content_type)
           VALUES (?, ?, '', ?, ?, ?, ?)`
        ).bind(thread.group_id, author, now, kind.messageType, mediaUrl, contentType).run()
      }
    } catch (err) {
      console.error(`[instagram] attachment ingest failed: ${err.message}`)
      await env.CHAT_DB.prepare(
        `INSERT INTO group_messages (group_id, user_id, body, created_at, message_type)
         VALUES (?, ?, ?, ?, 'bot_error')`
      ).bind(thread.group_id, 'system:instagram', `Kunne ikke hente vedlegg fra Instagram (${att?.type || 'ukjent'}).`, now).run()
    }
  }

  if (text) {
    await env.CHAT_DB.prepare(
      `INSERT INTO group_messages (group_id, user_id, body, created_at, message_type)
       VALUES (?, ?, ?, ?, 'text')`
    ).bind(thread.group_id, author, text, now).run()
  }

  // What surfaces the thread in the group list — /bot-message does the same.
  await env.CHAT_DB.prepare('UPDATE groups SET updated_at = ? WHERE id = ?')
    .bind(now, thread.group_id).run()

  await env.DB.prepare('UPDATE instagram_threads SET last_inbound_at = ? WHERE group_id = ?')
    .bind(now, thread.group_id).run()

  return { groupId: thread.group_id, participantIgsid: String(senderId), text, attachments: attachments.length, at: now }
}

// How long Meta's standard reply window lasts from the last inbound message.
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000

// Classifies a thread's reply window. The Human Agent tag would extend the
// middle band to 7 days, but that is a separate App Review feature and is NOT
// implemented — so anything past 24h is reported closed rather than pretending.
export function replyWindowState(lastInboundAt, now = Date.now()) {
  if (!lastInboundAt) return { state: 'never_messaged', canSend: false, msLeft: 0 }
  const msLeft = lastInboundAt + REPLY_WINDOW_MS - now
  if (msLeft > 0) return { state: 'open', canSend: true, msLeft }
  return { state: 'expired', canSend: false, msLeft: 0 }
}

// Relays a message posted in a chat group out to Instagram. Returns a reason
// instead of throwing when the group simply is not an Instagram thread — the
// caller fires this for every message in a marked group and must not treat a
// non-thread as an error.
// chat message_type -> Meta attachment type.
const CHAT_TYPE_TO_IG = { image: 'image', video: 'video', voice: 'audio', pdf: 'file' }

export async function relayGroupMessageToInstagram(env, groupId, text, media = null, messageId = null) {
  const thread = await getThreadByGroupId(env, groupId)
  if (!thread) return { relayed: false, reason: 'not_an_instagram_thread' }

  // The relay runs in ctx.waitUntil after the message is stored, so a client
  // retry produces two inserts and would produce two sends. The chat row id is
  // the natural idempotency key. Claimed before sending and released if the send
  // does not happen, so a real retry is never blocked.
  const outKey = messageId ? `out:${messageId}` : null
  if (outKey) {
    const won = await claimMessageKey(env, outKey, groupId, 'out')
    if (!won) {
      console.log(`[instagram] duplicate relay ignored messageId=${messageId}`)
      return { relayed: false, reason: 'already_relayed' }
    }
  }

  const conn = await getInstagramConnectionByIgUserId(env, thread.ig_user_id)
  if (!conn || conn.expired) {
    if (outKey) await releaseMessageKey(env, outKey)
    return { relayed: false, reason: 'no_usable_connection' }
  }

  const window = replyWindowState(thread.last_inbound_at)
  if (!window.canSend) {
    console.warn(`[instagram] relay blocked for ${groupId}: window ${window.state}`)
    if (outKey) await releaseMessageKey(env, outKey)
    return { relayed: false, reason: `window_${window.state}` }
  }

  let attachment = null
  if (media?.url && media?.messageType && media.messageType !== 'text') {
    const igType = CHAT_TYPE_TO_IG[media.messageType]
    if (!igType) {
      if (outKey) await releaseMessageKey(env, outKey)
      return { relayed: false, reason: `unsupported_message_type_${media.messageType}` }
    }
    attachment = { type: igType, url: media.url }
  }
  if (!attachment && !text) {
    if (outKey) await releaseMessageKey(env, outKey)
    return { relayed: false, reason: 'nothing_to_send' }
  }

  try {
    const result = await sendInstagramMessage(
      env, conn.access_token, conn.ig_user_id,
      { id: thread.participant_igsid },
      text, attachment,
    )
    console.log(`[instagram] relayed group ${groupId} -> ${thread.participant_igsid} ${attachment ? attachment.type : 'text'} mid=${result.message_id}`)

    // An attachment carries no caption; send any accompanying text separately so
    // a photo-with-a-comment does not silently lose the comment.
    if (attachment && text) {
      try {
        await sendInstagramMessage(env, conn.access_token, conn.ig_user_id, { id: thread.participant_igsid }, text)
      } catch (err) {
        console.warn(`[instagram] caption send failed for ${groupId}: ${err.message}`)
      }
    }
    return { relayed: true, ...result }
  } catch (err) {
    // Format rejections are thrown before Meta is called; surface the reason so
    // the thread notice can explain it rather than showing a raw API error.
    if (outKey) await releaseMessageKey(env, outKey)
    if (/^format_|^unsupported_attachment_type_/.test(err.message)) {
      return { relayed: false, reason: err.message }
    }
    throw err
  }
}

// The reply target and window state for a group, for the composer and for send.
export async function getThreadByGroupId(env, groupId) {
  return env.DB.prepare('SELECT * FROM instagram_threads WHERE group_id = ?').bind(groupId).first()
}

// Fills in participant details that are missing — threads created before the
// avatar column existed, or a lookup that failed at creation time. Best-effort
// and silent on failure; the thread is perfectly usable without them.
export async function backfillThreadParticipant(env, thread) {
  if (!thread || (thread.participant_username && thread.participant_avatar_url)) return thread
  const conn = await getInstagramConnectionByIgUserId(env, thread.ig_user_id)
  if (!conn || conn.expired) return thread
  const info = await lookupParticipant(env, conn.access_token, thread.participant_igsid)
  const username = thread.participant_username || info.username || info.name
  const avatar = thread.participant_avatar_url || info.profilePic
  if (username === thread.participant_username && avatar === thread.participant_avatar_url) return thread
  await env.DB.prepare(
    'UPDATE instagram_threads SET participant_username = ?, participant_avatar_url = ? WHERE group_id = ?'
  ).bind(username, avatar, thread.group_id).run()
  return { ...thread, participant_username: username, participant_avatar_url: avatar }
}

// Verifies a Meta webhook's HMAC-SHA256 signature ("X-Hub-Signature-256: sha256=<hex>").
// Meta keys this on the APP SECRET itself — there is no separate webhook secret as
// there is on GitHub. Constant-time compare, same as verifyGithubWebhookSignature.
export async function verifyInstagramWebhookSignature(env, rawBody, signatureHeader) {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false

  // A Meta app carries TWO distinct secrets: the Meta app secret (App settings ->
  // Basic) and the Instagram app secret (Instagram -> API setup with Instagram
  // login). Which one signs Instagram webhooks is not stated unambiguously in the
  // docs, so try both and log which matched — the first real delivery settles it,
  // rather than 401'ing on a coin-flip. Both are our own secrets, so accepting
  // either proves the payload came from Meta.
  const candidates = [
    ['META_APP_SECRET', env.META_APP_SECRET],
    ['INSTAGRAM_APP_SECRET', env.INSTAGRAM_APP_SECRET],
  ].filter(([, v]) => !!v)

  if (!candidates.length) {
    console.error('[instagram] no app secret set (META_APP_SECRET / INSTAGRAM_APP_SECRET) — rejecting webhook')
    return false
  }

  for (const [name, secret] of candidates) {
    if (await hmacMatches(secret, rawBody, signatureHeader)) {
      console.log(`[instagram] webhook signature verified with ${name}`)
      return true
    }
  }
  console.warn('[instagram] webhook signature matched neither app secret')
  return false
}

async function hmacMatches(secret, rawBody, signatureHeader) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  const expectedHex = 'sha256=' + Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('')
  if (expectedHex.length !== signatureHeader.length) return false
  let diff = 0
  for (let i = 0; i < expectedHex.length; i++) diff |= expectedHex.charCodeAt(i) ^ signatureHeader.charCodeAt(i)
  return diff === 0
}
