// Per-world photos proxy — deployed into a World Founder's OWN Cloudflare account by
// provision_world_photos, bound to that founder's isolated R2 bucket (world-photos-<stem>).
// Serves the founder's images at cdn.<domain>. This is the canonical source; the deployed copy
// lives in agent-worker's WORLD_TEMPLATES KV under key `template:world-photos-proxy`.
//
// Bindings (stamped at deploy by provision_world_photos):
//   PHOTOS_BUCKET        R2 bucket   world-photos-<stem>
//   PHOTO_ALBUMS         KV          PHOTO_ALBUMS-<stem>   (reserved for album metadata)
//   PHOTOS_UPLOAD_SECRET secret      shared upload secret (agent-worker's HTML_PUBLISH_SECRET)
//   DELIVERY_BASE        plain_text  https://cdn.<domain>
//
// Phase 1 (v1): serves the ORIGINAL bytes at GET /photos/<key> + an authenticated upload endpoint.
// Resize (?w=&h=&fit=) is a deferred v2 — it depends on Cloudflare Image Transformations being
// enabled on the founder's zone (Gate 1); v1 ignores those params and returns the original.

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const path = url.pathname

    // Readiness probe (used by check_world_photos later).
    if (path === '/__photos/check') {
      return json({
        ok: true,
        bucket_bound: !!env.PHOTOS_BUCKET,
        albums_bound: !!env.PHOTO_ALBUMS,
        delivery_base: env.DELIVERY_BASE || null,
      })
    }

    // Authenticated upload: POST /photos/upload, multipart field "file" (+ optional "key").
    if (path === '/photos/upload' && request.method === 'POST') {
      const secret = env.PHOTOS_UPLOAD_SECRET || ''
      const given = request.headers.get('X-Upload-Secret') || ''
      if (!secret || given !== secret) return json({ error: 'unauthorized' }, 401)
      if (!env.PHOTOS_BUCKET) return json({ error: 'no bucket bound' }, 500)
      const form = await request.formData().catch(() => null)
      const file = form && form.get('file')
      if (!file || typeof file === 'string') return json({ error: 'no file' }, 400)
      const ext = file.name && file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : 'bin'
      const rawKey = form.get('key')
      const key = String(rawKey || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`).replace(/^\/+/, '')
      await env.PHOTOS_BUCKET.put(key, file.stream(), {
        httpMetadata: { contentType: file.type || 'application/octet-stream' },
      })
      return json({ key, url: `${env.DELIVERY_BASE || ''}/photos/${key}` })
    }

    // Delivery: GET|HEAD /photos/<key> — original bytes (v1).
    if (path.startsWith('/photos/') && (request.method === 'GET' || request.method === 'HEAD')) {
      if (!env.PHOTOS_BUCKET) return json({ error: 'no bucket bound' }, 500)
      const key = decodeURIComponent(path.slice('/photos/'.length))
      if (!key) return json({ error: 'no key' }, 400)
      const obj = await env.PHOTOS_BUCKET.get(key)
      if (!obj) return json({ error: 'not found', key }, 404)
      const headers = new Headers()
      obj.writeHttpMetadata(headers)
      headers.set('etag', obj.httpEtag)
      headers.set('cache-control', 'public, max-age=31536000, immutable')
      return new Response(request.method === 'HEAD' ? null : obj.body, { headers })
    }

    return json({ error: 'not found', path }, 404)
  },
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
