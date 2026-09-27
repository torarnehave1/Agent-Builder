// Local tests for the world-photos-proxy template. No network, no Cloudflare account: the R2 and KV
// bindings are in-memory fakes, and the one outbound call the worker makes (the /cdn-cgi/image
// subrequest) is stubbed. Run with:  node --test worker/templates/test/
//
// What this cannot prove: that Cloudflare's edge intercepts /cdn-cgi/image/ on a founder's zone
// before the request reaches the worker. That was measured separately against a real deployment
// (cdn.stineoksvolddesign.no, 2026-09-27) and is why the transform path has a fallback.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import worker from '../world-photos-proxy.js'

const SECRET = 'test-upload-secret'

function fakeBucket() {
  const store = new Map()
  const api = {
    _store: store,
    async put(key, body, opts = {}) {
      const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body
      store.set(key, {
        body: bytes,
        httpMetadata: opts.httpMetadata || {},
        customMetadata: opts.customMetadata || {},
        size: bytes.length ?? 0,
        uploaded: new Date('2026-09-27T00:00:00Z'),
        etag: 'etag-' + key,
      })
    },
    async get(key) {
      const o = store.get(key)
      if (!o) return null
      return {
        ...o,
        httpEtag: `"${o.etag}"`,
        writeHttpMetadata(headers) {
          if (o.httpMetadata.contentType) headers.set('content-type', o.httpMetadata.contentType)
        },
        async text() {
          return new TextDecoder().decode(o.body)
        },
      }
    },
    async head(key) {
      return store.has(key) ? { ...store.get(key) } : null
    },
    async delete(key) {
      store.delete(key)
    },
    async list({ prefix = '', cursor, limit = 1000 } = {}) {
      const objects = [...store.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .slice(0, limit)
        .map(([k, v]) => ({ key: k, size: v.size, uploaded: v.uploaded, etag: v.etag }))
      return { objects, truncated: false, cursor: null }
    },
  }
  return api
}

function fakeKv() {
  const store = new Map()
  return {
    _store: store,
    async get(key) {
      return store.has(key) ? store.get(key) : null
    },
    async put(key, value) {
      store.set(key, value)
    },
    async delete(key) {
      store.delete(key)
    },
    async list({ prefix = '' } = {}) {
      return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }
    },
  }
}

function makeEnv() {
  return {
    PHOTOS_BUCKET: fakeBucket(),
    PHOTO_ALBUMS: fakeKv(),
    PHOTOS_UPLOAD_SECRET: SECRET,
    DELIVERY_BASE: 'https://cdn.example.test',
  }
}

const call = (env, path, init = {}) =>
  worker.fetch(new Request(`https://cdn.example.test${path}`, init), env)

const withSecret = (extra = {}) => ({ 'X-Upload-Secret': SECRET, ...extra })

async function uploadPng(env, key, album) {
  const form = new FormData()
  form.append('file', new File([new Uint8Array([1, 2, 3, 4])], `${key}`, { type: 'image/png' }))
  form.append('key', key)
  if (album) form.append('album', album)
  return await call(env, '/photos/upload', { method: 'POST', headers: withSecret(), body: form })
}

// Same construction as agent-worker's signPublishToken.
async function signToken(payload, secret = SECRET) {
  const enc = new TextEncoder()
  const b64 = (buf) =>
    Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const header = b64(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body = b64(enc.encode(JSON.stringify(payload)))
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${body}`))
  return `${header}.${body}.${b64(new Uint8Array(sig))}`
}

const future = () => Math.floor(Date.now() / 1000) + 600
const past = () => Math.floor(Date.now() / 1000) - 10

test('check reports bindings and a KV round-trip', async () => {
  const env = makeEnv()
  globalThis.fetch = async () => new Response('ERROR 9404: Could not fetch the image', { status: 404 })
  const res = await call(env, '/__photos/check')
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.equal(body.bucket_bound, true)
  assert.equal(body.albums_bound, true)
  assert.equal(body.albums_ok, true)
  assert.equal(body.delivery_base, 'https://cdn.example.test')
  assert.equal(body.transform_ok, true, 'a resizer error proves transformations are on')
})

test('v1 compatibility: upload with the fixed secret, then fetch the original bytes', async () => {
  const env = makeEnv()
  const up = await uploadPng(env, 'a.png')
  assert.equal(up.status, 200)
  const { key, url } = await up.json()
  assert.equal(key, 'a.png')
  assert.equal(url, 'https://cdn.example.test/photos/a.png')

  const got = await call(env, '/photos/a.png')
  assert.equal(got.status, 200)
  assert.equal(got.headers.get('content-type'), 'image/png')
  assert.equal(got.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  assert.deepEqual(new Uint8Array(await got.arrayBuffer()), new Uint8Array([1, 2, 3, 4]))
})

test('upload rejects a wrong secret and a missing one', async () => {
  const env = makeEnv()
  const form = new FormData()
  form.append('file', new File([new Uint8Array([1])], 'x.png', { type: 'image/png' }))
  assert.equal((await call(env, '/photos/upload', { method: 'POST', body: form })).status, 401)
  const form2 = new FormData()
  form2.append('file', new File([new Uint8Array([1])], 'x.png', { type: 'image/png' }))
  const res = await call(env, '/photos/upload', { method: 'POST', headers: { 'X-Upload-Secret': 'nope' }, body: form2 })
  assert.equal(res.status, 401)
})

test('bearer tokens: valid scope passes, wrong scope, expiry and bad signature do not', async () => {
  const env = makeEnv()
  const mk = async (token) =>
    call(env, '/photos/list', { headers: { Authorization: `Bearer ${token}` } })

  assert.equal((await mk(await signToken({ scope: ['read'], exp: future() }))).status, 200)
  assert.equal((await mk(await signToken({ scope: ['upload'], exp: future() }))).status, 401, 'wrong scope')
  assert.equal((await mk(await signToken({ scope: ['read'], exp: past() }))).status, 401, 'expired')
  assert.equal((await mk(await signToken({ scope: ['read'] }))).status, 401, 'no exp')
  assert.equal((await mk(await signToken({ scope: ['read'], exp: future() }, 'other-secret'))).status, 401, 'bad signature')
  assert.equal((await mk('not.a.token')).status, 401)
})

test('transform: params go to /cdn-cgi/image on the same host, and format=auto is added', async () => {
  const env = makeEnv()
  await uploadPng(env, 'b.png')
  let requested = null
  globalThis.fetch = async (input) => {
    requested = String(input)
    return new Response(new Uint8Array([9, 9]), { status: 200, headers: { 'content-type': 'image/avif' } })
  }
  const res = await call(env, '/photos/b.png?w=200&q=80')
  assert.equal(res.status, 200)
  assert.match(requested, /^https:\/\/cdn\.example\.test\/cdn-cgi\/image\//)
  assert.match(requested, /width=200/)
  assert.match(requested, /quality=80/)
  assert.match(requested, /format=auto/, 'format=auto is added unless asked otherwise')
  assert.match(requested, /\/photos\/b\.png$/)
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), new Uint8Array([9, 9]))
})

test('transform falls back to the original when the resize subrequest fails', async () => {
  const env = makeEnv()
  await uploadPng(env, 'c.png')
  globalThis.fetch = async () => {
    throw new Error('transformations not enabled on this zone')
  }
  const res = await call(env, '/photos/c.png?w=200')
  assert.equal(res.status, 200)
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), new Uint8Array([1, 2, 3, 4]), 'original bytes, not an error')
})

test('a junk transform parameter is dropped rather than forwarded', async () => {
  const env = makeEnv()
  await uploadPng(env, 'd.png')
  let requested = null
  globalThis.fetch = async (input) => {
    requested = String(input)
    return new Response(new Uint8Array([7]), { status: 200 })
  }
  await call(env, '/photos/d.png?w=' + encodeURIComponent('200/../../evil') + '&h=100')
  assert.ok(!requested.includes('evil'), 'value outside the option grammar is dropped')
  assert.match(requested, /height=100/)
})

test('album round-trip keeps every field an upload used to destroy', async () => {
  const env = makeEnv()
  const created = await call(env, '/albums/Holiday', {
    method: 'POST',
    headers: withSecret({ 'content-type': 'application/json' }),
    body: JSON.stringify({ images: [], seoTitle: 'Holiday', seoDescription: 'sunny', actor: 'a@b.no' }),
  })
  assert.equal(created.status, 200)

  await uploadPng(env, 'e.png', 'Holiday')

  const res = await call(env, '/albums/Holiday', { headers: withSecret() })
  const album = await res.json()
  assert.equal(album.seoTitle, 'Holiday', 'seoTitle survives an upload into the album')
  assert.equal(album.seoDescription, 'sunny')
  assert.equal(album.createdBy, 'a@b.no')
  assert.deepEqual(album.images, ['e.png'])
  assert.deepEqual(album.urls, ['https://cdn.example.test/photos/e.png'])
  assert.equal(album.auditLog.length, 2)
  assert.deepEqual(album.auditLog.map((e) => e.action), ['create_album', 'add_images'])
})

test('add and remove images', async () => {
  const env = makeEnv()
  await call(env, '/albums/Trip', { method: 'POST', headers: withSecret(), body: JSON.stringify({ images: ['x.png'] }) })
  await call(env, '/albums/Trip/add', { method: 'POST', headers: withSecret(), body: JSON.stringify({ images: ['y.png', 'x.png'] }) })
  let album = await (await call(env, '/albums/Trip', { headers: withSecret() })).json()
  assert.deepEqual(album.images, ['x.png', 'y.png'], 'add dedupes')
  await call(env, '/albums/Trip/remove', { method: 'POST', headers: withSecret(), body: JSON.stringify({ image: 'x.png' }) })
  album = await (await call(env, '/albums/Trip', { headers: withSecret() })).json()
  assert.deepEqual(album.images, ['y.png'])
})

test('share mints an id once and keeps it across unshare and reshare', async () => {
  const env = makeEnv()
  await call(env, '/albums/Pub', { method: 'POST', headers: withSecret(), body: JSON.stringify({ images: [] }) })
  const first = await (await call(env, '/albums/Pub/share', { method: 'POST', headers: withSecret(), body: JSON.stringify({ isShared: true }) })).json()
  assert.equal(first.isShared, true)
  assert.match(first.shareId, /^[0-9a-f-]{36}$/)

  await call(env, '/albums/Pub/share', { method: 'POST', headers: withSecret(), body: JSON.stringify({ isShared: false }) })
  const again = await (await call(env, '/albums/Pub/share', { method: 'POST', headers: withSecret(), body: JSON.stringify({ isShared: true }) })).json()
  assert.equal(again.shareId, first.shareId, 'a handed-out link must not rotate')
})

test('a shared album reads without a credential; an unshared one does not', async () => {
  const env = makeEnv()
  await call(env, '/albums/Open', { method: 'POST', headers: withSecret(), body: JSON.stringify({ images: [] }) })
  assert.equal((await call(env, '/albums/Open')).status, 401)
  await call(env, '/albums/Open/share', { method: 'POST', headers: withSecret(), body: JSON.stringify({ isShared: true }) })
  assert.equal((await call(env, '/albums/Open')).status, 200)
})

test('delete trashes the object and drops it from every album', async () => {
  const env = makeEnv()
  await call(env, '/albums/Keep', { method: 'POST', headers: withSecret(), body: JSON.stringify({ images: [] }) })
  await uploadPng(env, 'f.png', 'Keep')

  const del = await call(env, '/photos/f.png', { method: 'DELETE', headers: withSecret() })
  assert.equal(del.status, 200)
  const { trashed } = await del.json()
  assert.match(trashed, /^trash\/\d+-f\.png$/)

  assert.equal((await call(env, '/photos/f.png')).status, 404)
  const album = await (await call(env, '/albums/Keep', { headers: withSecret() })).json()
  assert.deepEqual(album.images, [], 'an album never points at a missing object')

  const trash = await (await call(env, '/photos/trash/list', { headers: withSecret() })).json()
  assert.equal(trash.items.length, 1)
  assert.equal(trash.items[0].originalKey, 'f.png')
})

test('restore brings it back, and refuses to overwrite without being told to', async () => {
  const env = makeEnv()
  await uploadPng(env, 'g.png')
  const { trashed } = await (await call(env, '/photos/g.png', { method: 'DELETE', headers: withSecret() })).json()

  await uploadPng(env, 'g.png')
  const clash = await call(env, '/photos/restore', { method: 'POST', headers: withSecret(), body: JSON.stringify({ trashKey: trashed }) })
  assert.equal(clash.status, 409)

  const ok = await call(env, '/photos/restore', { method: 'POST', headers: withSecret(), body: JSON.stringify({ trashKey: trashed, overwrite: true }) })
  assert.equal(ok.status, 200)
  assert.equal((await ok.json()).restored, 'g.png')
})

test('list excludes trash and reports urls', async () => {
  const env = makeEnv()
  await uploadPng(env, 'h.png')
  await uploadPng(env, 'i.png')
  await call(env, '/photos/i.png', { method: 'DELETE', headers: withSecret() })
  const listed = await (await call(env, '/photos/list', { headers: withSecret() })).json()
  assert.deepEqual(listed.objects.map((o) => o.key), ['h.png'])
  assert.equal(listed.objects[0].url, 'https://cdn.example.test/photos/h.png')
})

test('a malformed upload body is a 400, not a 500', async () => {
  const env = makeEnv()
  const res = await call(env, '/photos/upload', { method: 'POST', headers: withSecret({ 'content-type': 'application/json' }), body: '{' })
  assert.equal(res.status, 400)
})

test('unknown routes are 404', async () => {
  const env = makeEnv()
  assert.equal((await call(env, '/nope')).status, 404)
  assert.equal((await call(env, '/photos/')).status, 400)
})
