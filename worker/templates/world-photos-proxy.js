// Per-world photos proxy — deployed into a World Founder's OWN Cloudflare account by
// provision_world_photos, bound to that founder's isolated R2 bucket (world-photos-<stem>).
// Serves the founder's images at cdn.<domain>. This is the canonical source; the deployed copy
// lives in agent-worker's WORLD_TEMPLATES KV under key `template:world-photos-proxy`.
//
// Bindings (stamped at deploy by provision_world_photos):
//   PHOTOS_BUCKET        R2 bucket   world-photos-<stem>
//   PHOTO_ALBUMS         KV          PHOTO_ALBUMS-<stem>
//   PHOTOS_UPLOAD_SECRET secret      shared upload secret (agent-worker's HTML_PUBLISH_SECRET)
//   DELIVERY_BASE        plain_text  https://cdn.<domain>
//
// v2 (2026-09-27). v1 served original bytes and accepted uploads; nothing else. v2 adds resize,
// listing, delete, trash and album records, so the Photos app can run its real flow against a
// founder's own storage instead of the shared bucket.
//
// Resizing is a 302 to /cdn-cgi/image/, not an in-process fetch. The first cut tried the latter and
// the canary proved it does not work: a Worker subrequest to its own hostname bypasses the edge's
// image-resizing interception, so the resize silently did not happen and the fallback served the
// full original. See handleDeliver.
//
// EVERY v1 ROUTE IS BYTE-COMPATIBLE: GET /photos/<key> with no query returns exactly what it
// returned before, POST /photos/upload takes the same form fields and X-Upload-Secret, and
// /__photos/check keeps its three original fields and only gains new ones.
//
// ROLLOUT ORDER. Re-provision the NEWEST, emptiest World first, never the oldest. At the time of
// writing that is stineoksvolddesign.no (provisioned 2026-09-27, one probe image, no consumers).
// universi.no has been serving cdn.universi.no since 2026-07-20 and belongs to a different founder:
// it goes LAST, once v2 has been exercised somewhere failure costs nothing. An earlier revision of
// this comment had that backwards.
//
// Auth. Two credentials are accepted on every mutating route, deliberately — not a flag day:
//   1. X-Upload-Secret: <PHOTOS_UPLOAD_SECRET>   the fixed secret upload_world_image already ships
//   2. Authorization: Bearer <HS256 JWT>          signed with the same secret, {scope, exp, hostname}
// (2) is the D5-C path for photos-worker: short-lived, scoped, and nothing standing leaves
// agent-worker. It is the same token shape agent-worker's signPublishToken already produces.

const ALBUM_PREFIX = 'album:'
const IMAGE_META_PREFIX = 'image-meta:'
const TRASH_PREFIX = 'trash/'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    try {
      // ---- readiness -------------------------------------------------------------------------
      if (path === '/__photos/check') return await handleCheck(request, env)

      // ---- photos ----------------------------------------------------------------------------
      // Listing is matched BEFORE delivery, so an object whose key is literally "list" is not
      // reachable through this route. Keys are timestamped on upload, so that cannot happen by
      // accident; a deliberate one can still be fetched through the album it belongs to.
      if (path === '/photos/list' && (method === 'GET' || method === 'HEAD')) {
        return await handleList(request, env, url)
      }
      if (path === '/photos/upload' && method === 'POST') return await handleUpload(request, env)
      if (path === '/photos/trash' && method === 'POST') return await handleTrash(request, env)
      if (path === '/photos/restore' && method === 'POST') return await handleRestore(request, env)
      if (path === '/photos/trash/list' && method === 'GET') return await handleTrashList(request, env)

      if (path.startsWith('/photos/')) {
        const key = decodeURIComponent(path.slice('/photos/'.length))
        if (!key) return json({ error: 'no key' }, 400)
        if (method === 'GET' || method === 'HEAD') return await handleDeliver(request, env, url, key)
        if (method === 'DELETE') return await handleDelete(request, env, key)
      }

      // ---- albums ----------------------------------------------------------------------------
      if (path === '/albums' && method === 'GET') return await handleAlbumList(request, env, url)
      if (path.startsWith('/albums/')) return await handleAlbumRoute(request, env, url, path, method)

      return json({ error: 'not found', path }, 404)
    } catch (err) {
      // Never leak a stack to a public delivery host.
      return json({ error: 'internal error', detail: String(err && err.message ? err.message : err) }, 500)
    }
  },
}

// ---- auth ------------------------------------------------------------------------------------

// Returns null when authorized, or a Response to return when not. `scope` names the operation a
// bearer token must carry; the fixed secret is unscoped and passes everything, exactly as in v1.
async function authorize(request, env, scope) {
  const secret = env.PHOTOS_UPLOAD_SECRET || ''
  if (!secret) return json({ error: 'proxy has no upload secret configured' }, 500)

  const given = request.headers.get('X-Upload-Secret') || ''
  if (given && given === secret) return null

  const bearer = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (bearer) {
    const claims = await verifyToken(bearer, secret)
    if (claims && (!scope || (Array.isArray(claims.scope) && claims.scope.includes(scope)))) return null
  }
  return json({ error: 'unauthorized' }, 401)
}

// HS256 JWT, the shape agent-worker's signPublishToken produces. Returns the payload or null.
async function verifyToken(token, secret) {
  const parts = String(token).split('.')
  if (parts.length !== 3) return null
  const [header, body, sig] = parts
  const enc = new TextEncoder()
  let key
  try {
    key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  } catch {
    return null
  }
  let ok = false
  try {
    ok = await crypto.subtle.verify('HMAC', key, b64urlToBytes(sig), enc.encode(`${header}.${body}`))
  } catch {
    return null
  }
  if (!ok) return null
  let payload
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(body)))
  } catch {
    return null
  }
  // exp is seconds, as signPublishToken writes it. A token without exp is rejected: a
  // short-lived credential that never expires is just a shared secret with extra steps.
  if (!payload || typeof payload.exp !== 'number') return null
  if (payload.exp <= Math.floor(Date.now() / 1000)) return null
  return payload
}

function b64urlToBytes(value) {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

// ---- readiness -------------------------------------------------------------------------------

async function handleCheck(request, env) {
  const out = {
    ok: true,
    bucket_bound: !!env.PHOTOS_BUCKET,
    albums_bound: !!env.PHOTO_ALBUMS,
    delivery_base: env.DELIVERY_BASE || null,
    version: 'v2',
  }
  // A KV round-trip, so "bound" is not mistaken for "works".
  if (env.PHOTO_ALBUMS) {
    try {
      await env.PHOTO_ALBUMS.get(`${ALBUM_PREFIX}__check__`)
      out.albums_ok = true
    } catch {
      out.albums_ok = false
    }
  } else {
    out.albums_ok = false
  }
  // Whether Image Transformations is enabled on this zone CANNOT be answered from in here. A
  // subrequest from this worker to its own hostname is not intercepted by the edge resizer, so a
  // probe made here reports a failure whether or not the zone is configured — it did exactly that
  // on the canary. Hand the caller the URL to probe from outside instead of guessing.
  out.transform_ok = null
  out.transform_probe = env.DELIVERY_BASE
    ? `${env.DELIVERY_BASE.replace(/\/+$/, '')}/cdn-cgi/image/width=1/photos/__transform_probe__`
    : null
  out.transform_note =
    'Fetch transform_probe from outside the worker: an "ERROR 9xxx" body means the resizer is active on this zone; a JSON 404 from this worker means it is not.'
  return json(out)
}

// ---- photo delivery --------------------------------------------------------------------------

const TRANSFORM_PARAMS = {
  w: 'width',
  width: 'width',
  h: 'height',
  height: 'height',
  fit: 'fit',
  q: 'quality',
  quality: 'quality',
  format: 'format',
  gravity: 'gravity',
  blur: 'blur',
  sharpen: 'sharpen',
}

async function handleDeliver(request, env, url, key) {
  if (!env.PHOTOS_BUCKET) return json({ error: 'no bucket bound' }, 500)

  const opts = []
  for (const [name, mapped] of Object.entries(TRANSFORM_PARAMS)) {
    const raw = url.searchParams.get(name)
    if (raw === null || raw === '') continue
    const value = String(raw).trim()
    // Only characters the option grammar uses. Anything else is dropped rather than passed on.
    if (!/^[A-Za-z0-9.-]+$/.test(value)) continue
    if (!opts.some((o) => o.startsWith(`${mapped}=`))) opts.push(`${mapped}=${value}`)
  }

  // No parameters: byte-for-byte v1 behaviour.
  if (!opts.length) return await serveObject(request, env, key)

  // `format=auto` matters more than any other option — the same 1200x630 crop measured 392 623
  // bytes as PNG and 3 849 bytes as AVIF on a real founder bucket. Add it unless asked otherwise.
  if (!opts.some((o) => o.startsWith('format='))) opts.push('format=auto')

  // Redirect rather than resize in-process. Measured on the live canary 2026-09-27: requested from
  // OUTSIDE, /cdn-cgi/image/width=200/photos/<key> returns 16 349 bytes at 200x104; fetched by this
  // worker as a subrequest to its own hostname, the same URL is NOT intercepted by the edge and the
  // resize silently does not happen. A Worker cannot reach its own zone's image-resizing layer that
  // way, so the client has to make the request the edge will intercept.
  //
  // The proxy still owns the ?w= grammar — no caller composes a /cdn-cgi/image/ URL itself, which is
  // the whole reason that option was rejected. 302 and a one-hour cache, deliberately not 301: if a
  // later revision resizes in-process after all, a permanent redirect would sit in browser caches
  // long after the code changed.
  const base = (env.DELIVERY_BASE || url.origin).replace(/\/+$/, '')
  const target = `${base}/cdn-cgi/image/${opts.join(',')}/photos/${encodeURIComponent(key)}`
  return new Response(null, {
    status: 302,
    headers: {
      location: target,
      'cache-control': 'public, max-age=3600',
      'access-control-allow-origin': '*',
    },
  })
}

async function serveObject(request, env, key) {
  const obj = await env.PHOTOS_BUCKET.get(key)
  if (!obj) return json({ error: 'not found', key }, 404)
  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('etag', obj.httpEtag)
  headers.set('cache-control', 'public, max-age=31536000, immutable')
  return new Response(request.method === 'HEAD' ? null : obj.body, { headers })
}

// ---- photo management ------------------------------------------------------------------------

async function handleUpload(request, env) {
  const denied = await authorize(request, env, 'upload')
  if (denied) return denied
  if (!env.PHOTOS_BUCKET) return json({ error: 'no bucket bound' }, 500)

  let form
  try {
    form = await request.formData()
  } catch {
    return json({ error: 'expected a multipart/form-data body' }, 400)
  }
  const file = form.get('file')
  if (!file || typeof file === 'string') return json({ error: 'no file' }, 400)
  const ext = file.name && file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : 'bin'
  const rawKey = form.get('key')
  const key = String(rawKey || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`).replace(/^\/+/, '')

  await env.PHOTOS_BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  })

  const album = normalizeName(form.get('album'))
  if (album && env.PHOTO_ALBUMS) {
    const record = await readAlbum(env, album)
    const existing = record || { name: album, images: [] }
    const actor = String(form.get('actor') || '') || null
    await writeAlbum(env, album, buildAlbumRecord({
      name: album,
      images: [...new Set([...(existing.images || []), key])],
      existing,
      createdBy: existing.createdBy ?? actor,
      auditEntry: auditEntryFor('add_images', actor, { added: 1 }),
    }))
  }

  return json({ key, url: `${env.DELIVERY_BASE || ''}/photos/${key}`, album: album || null })
}

async function handleList(request, env, url) {
  const denied = await authorize(request, env, 'read')
  if (denied) return denied
  if (!env.PHOTOS_BUCKET) return json({ error: 'no bucket bound' }, 500)

  const prefix = url.searchParams.get('prefix') || ''
  const cursor = url.searchParams.get('cursor') || undefined
  const limit = Math.min(Number(url.searchParams.get('limit')) || 1000, 1000)
  const listed = await env.PHOTOS_BUCKET.list({ prefix, cursor, limit })
  const base = env.DELIVERY_BASE || ''
  const objects = listed.objects
    .filter((o) => !o.key.startsWith(TRASH_PREFIX))
    .map((o) => ({
      key: o.key,
      size: o.size,
      uploaded: o.uploaded ? new Date(o.uploaded).toISOString() : null,
      etag: o.etag || null,
      url: `${base}/photos/${o.key}`,
    }))
  return json({ objects, cursor: listed.truncated ? listed.cursor : null, truncated: !!listed.truncated })
}

// Delete moves the object under trash/ with its original key and timestamp in custom metadata,
// mirroring photos-worker's shape so the two behave the same for a user.
async function handleDelete(request, env, key) {
  const denied = await authorize(request, env, 'delete')
  if (denied) return denied
  if (!env.PHOTOS_BUCKET) return json({ error: 'no bucket bound' }, 500)

  const obj = await env.PHOTOS_BUCKET.get(key)
  if (!obj) return json({ error: 'not found', key }, 404)
  const deletedAt = new Date().toISOString()
  const trashKey = `${TRASH_PREFIX}${Date.now()}-${key}`
  await env.PHOTOS_BUCKET.put(trashKey, obj.body, {
    httpMetadata: obj.httpMetadata,
    customMetadata: { originalKey: key, deletedAt },
  })
  await env.PHOTOS_BUCKET.delete(key)

  // Drop it from every album that referenced it, so an album never points at a missing object.
  if (env.PHOTO_ALBUMS) {
    const listed = await env.PHOTO_ALBUMS.list({ prefix: ALBUM_PREFIX })
    for (const entry of listed.keys) {
      const name = entry.name.slice(ALBUM_PREFIX.length)
      const record = await readAlbum(env, name)
      if (!record || !Array.isArray(record.images) || !record.images.includes(key)) continue
      await writeAlbum(env, name, buildAlbumRecord({
        name,
        images: record.images.filter((k) => k !== key),
        existing: record,
        auditEntry: auditEntryFor('remove_images', null, { removed: 1, reason: 'object deleted' }),
      }))
    }
  }

  return json({ deleted: key, trashed: trashKey, deletedAt })
}

async function handleTrashList(request, env) {
  const denied = await authorize(request, env, 'read')
  if (denied) return denied
  if (!env.PHOTOS_BUCKET) return json({ error: 'no bucket bound' }, 500)
  const listed = await env.PHOTOS_BUCKET.list({ prefix: TRASH_PREFIX })
  const items = []
  for (const obj of listed.objects) {
    const head = await env.PHOTOS_BUCKET.head(obj.key)
    items.push({
      trashKey: obj.key,
      originalKey: (head && head.customMetadata && head.customMetadata.originalKey) || null,
      deletedAt: (head && head.customMetadata && head.customMetadata.deletedAt) || null,
      size: obj.size,
    })
  }
  return json({ items })
}

async function handleTrash(request, env) {
  const denied = await authorize(request, env, 'delete')
  if (denied) return denied
  const body = await readJson(request)
  if (!body) return json({ error: 'invalid JSON body' }, 400)
  const trashKey = String(body.trashKey || '')
  if (!trashKey.startsWith(TRASH_PREFIX)) return json({ error: 'trashKey must be under trash/' }, 400)
  await env.PHOTOS_BUCKET.delete(trashKey)
  return json({ deleted: trashKey })
}

async function handleRestore(request, env) {
  const denied = await authorize(request, env, 'delete')
  if (denied) return denied
  const body = await readJson(request)
  if (!body) return json({ error: 'invalid JSON body' }, 400)
  const trashKey = String(body.trashKey || '')
  if (!trashKey.startsWith(TRASH_PREFIX)) return json({ error: 'trashKey must be under trash/' }, 400)

  const obj = await env.PHOTOS_BUCKET.get(trashKey)
  if (!obj) return json({ error: 'not found', trashKey }, 404)
  const originalKey =
    String(body.originalKey || '') ||
    (obj.customMetadata && obj.customMetadata.originalKey) ||
    trashKey.slice(TRASH_PREFIX.length).replace(/^\d+-/, '')
  if (!originalKey) return json({ error: 'originalKey is required' }, 400)

  const clash = await env.PHOTOS_BUCKET.head(originalKey)
  if (clash && !body.overwrite) return json({ error: 'destination already exists', originalKey }, 409)

  await env.PHOTOS_BUCKET.put(originalKey, obj.body, { httpMetadata: obj.httpMetadata })
  await env.PHOTOS_BUCKET.delete(trashKey)
  return json({ restored: originalKey, trashed: trashKey })
}

// ---- albums ----------------------------------------------------------------------------------

async function handleAlbumList(request, env, url) {
  const denied = await authorize(request, env, 'read')
  if (denied) return denied
  if (!env.PHOTO_ALBUMS) return json({ error: 'no albums namespace bound' }, 500)

  const listed = await env.PHOTO_ALBUMS.list({ prefix: ALBUM_PREFIX })
  const withMeta = url.searchParams.get('includeMeta') === '1'
  if (!withMeta) return json({ albums: listed.keys.map((k) => k.name.slice(ALBUM_PREFIX.length)) })

  const albums = []
  for (const entry of listed.keys) {
    const name = entry.name.slice(ALBUM_PREFIX.length)
    const record = await readAlbum(env, name)
    albums.push(summarize(name, record))
  }
  return json({ albums })
}

async function handleAlbumRoute(request, env, url, path, method) {
  if (!env.PHOTO_ALBUMS) return json({ error: 'no albums namespace bound' }, 500)

  const rest = path.slice('/albums/'.length)
  const slash = rest.lastIndexOf('/')
  const action = slash >= 0 ? rest.slice(slash + 1) : ''
  const isAction = ['add', 'remove', 'share'].includes(action)
  const name = normalizeName(decodeURIComponent(isAction ? rest.slice(0, slash) : rest))
  if (!name) return json({ error: 'album name is required' }, 400)

  if (!isAction && method === 'GET') {
    const record = await readAlbum(env, name)
    if (!record) return json({ error: 'not found', album: name }, 404)
    // A published album is readable without a credential — that is what publishing means. Anything
    // else needs one.
    if (!record.isShared) {
      const denied = await authorize(request, env, 'read')
      if (denied) return denied
    }
    return json(withUrls(env, record))
  }

  const denied = await authorize(request, env, 'album')
  if (denied) return denied
  const existing = (await readAlbum(env, name)) || { name, images: [] }
  const body = method === 'GET' ? {} : (await readJson(request)) || {}
  const actor = body.actor ? String(body.actor) : null

  if (!isAction && method === 'POST') {
    const images = Array.isArray(body.images) ? body.images.filter((k) => typeof k === 'string') : existing.images || []
    const record = buildAlbumRecord({
      name,
      images: [...new Set(images)],
      existing,
      createdBy: existing.createdBy ?? actor,
      auditEntry: auditEntryFor(existing.createdAt ? 'update_album' : 'create_album', actor, { imageCount: images.length }),
      seo: {
        title: body.seoTitle,
        description: body.seoDescription,
        imageKey: body.seoImageKey,
      },
      hiddenImages: Array.isArray(body.hiddenImages) ? body.hiddenImages : undefined,
    })
    await writeAlbum(env, name, record)
    return json(withUrls(env, record))
  }

  if (!isAction && method === 'DELETE') {
    await env.PHOTO_ALBUMS.delete(`${ALBUM_PREFIX}${name}`)
    return json({ deleted: name })
  }

  if (action === 'add' || action === 'remove') {
    const incoming = (Array.isArray(body.images) ? body.images : [body.image])
      .filter((k) => typeof k === 'string' && k.trim())
      .map((k) => k.trim())
    if (!incoming.length) return json({ error: 'images is required' }, 400)
    const images =
      action === 'add'
        ? [...new Set([...(existing.images || []), ...incoming])]
        : (existing.images || []).filter((k) => !incoming.includes(k))
    const record = buildAlbumRecord({
      name,
      images,
      existing,
      createdBy: existing.createdBy ?? actor,
      auditEntry: auditEntryFor(action === 'add' ? 'add_images' : 'remove_images', actor, {
        [action === 'add' ? 'added' : 'removed']: incoming.length,
      }),
    })
    await writeAlbum(env, name, record)
    return json(withUrls(env, record))
  }

  if (action === 'share') {
    const isShared = body.isShared !== false
    const record = buildAlbumRecord({
      name,
      images: existing.images || [],
      existing,
      isShared,
      // The share id is permanent once minted: a link that is handed out and then rotated is a
      // broken link. Unsharing clears isShared and keeps the id, so re-sharing restores the URL.
      shareId: existing.shareId || (isShared ? crypto.randomUUID() : null),
      auditEntry: auditEntryFor(isShared ? 'share_album' : 'unshare_album', actor, { isShared }),
    })
    await writeAlbum(env, name, record)
    return json({ name, isShared: record.isShared, shareId: record.shareId })
  }

  return json({ error: 'not found', path }, 404)
}

// ---- album record ------------------------------------------------------------------------------
// Identical field set to the central KV record that albums-worker and photos-worker write, so one
// album type serves both storage modes and nothing is lost moving between them.

function buildAlbumRecord({ name, images, existing, createdBy, auditEntry, seo, isShared, shareId, hiddenImages }) {
  const now = new Date().toISOString()
  const base = existing && typeof existing === 'object' ? existing : {}
  return {
    name,
    images,
    hiddenImages: hiddenImages ?? (Array.isArray(base.hiddenImages) ? base.hiddenImages : []),
    createdAt: base.createdAt || now,
    createdBy: createdBy ?? base.createdBy ?? null,
    seoTitle: seo?.title ?? base.seoTitle ?? null,
    seoDescription: seo?.description ?? base.seoDescription ?? null,
    seoImageKey: seo?.imageKey ?? base.seoImageKey ?? null,
    isShared: isShared ?? base.isShared ?? false,
    shareId: shareId ?? base.shareId ?? null,
    updatedAt: now,
    lastModifiedBy: auditEntry?.actor || base.lastModifiedBy || null,
    lastModifiedRole: auditEntry?.actorRole || base.lastModifiedRole || null,
    lastModifiedAction: auditEntry?.action || base.lastModifiedAction || null,
    auditLog: auditEntry ? [...(Array.isArray(base.auditLog) ? base.auditLog : []), auditEntry].slice(-100) : base.auditLog || [],
    superadminAuditLog: base.superadminAuditLog || [],
  }
}

function auditEntryFor(action, actor, details) {
  return { action, actor: actor || null, actorRole: null, at: new Date().toISOString(), details: details || {} }
}

function summarize(name, record) {
  if (!record || typeof record !== 'object') {
    return { name, createdBy: null, createdAt: null, updatedAt: null, isShared: false, shareId: null, imageCount: 0, hiddenCount: 0 }
  }
  const hidden = new Set(Array.isArray(record.hiddenImages) ? record.hiddenImages : [])
  return {
    name,
    createdBy: record.createdBy ?? null,
    createdAt: record.createdAt ?? null,
    updatedAt: record.updatedAt ?? null,
    isShared: !!record.isShared,
    shareId: record.shareId ?? null,
    imageCount: Array.isArray(record.images) ? record.images.length : 0,
    hiddenCount: (Array.isArray(record.images) ? record.images : []).filter((k) => hidden.has(k)).length,
  }
}

function withUrls(env, record) {
  const base = env.DELIVERY_BASE || ''
  return { ...record, urls: (record.images || []).map((k) => `${base}/photos/${k}`) }
}

async function readAlbum(env, name) {
  const stored = await env.PHOTO_ALBUMS.get(`${ALBUM_PREFIX}${name}`)
  if (!stored) return null
  try {
    return JSON.parse(stored)
  } catch {
    return null
  }
}

async function writeAlbum(env, name, record) {
  await env.PHOTO_ALBUMS.put(`${ALBUM_PREFIX}${name}`, JSON.stringify(record))
}

// ---- helpers -----------------------------------------------------------------------------------

function normalizeName(value) {
  return typeof value === 'string' ? value.trim() : ''
}

async function readJson(request) {
  try {
    return await request.json()
  } catch {
    return null
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  })
}

export { IMAGE_META_PREFIX }
