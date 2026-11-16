// Local tests for the world-photos-proxy template. No network, no Cloudflare account: the R2 and KV
// bindings are in-memory fakes. Run with:
//   node --test worker/templates/test/world-photos-proxy.test.mjs
//
// What this cannot prove: how Cloudflare's edge treats /cdn-cgi/image/. That was measured against
// the live canary on 2026-09-27 — intercepted when the request comes from OUTSIDE, NOT intercepted
// for a subrequest the worker makes to its own hostname — which is why resizing is a redirect and
// not an in-process fetch.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import worker from '../world-photos-proxy.js'

const SECRET = 'test-upload-secret'

function fakeBucket() {
  const store = new Map()
  const uploads = new Map()
  // R2's multipart upload, as far as the proxy uses it. A part body is a stream (request.body).
  const multipart = (key, uploadId) => ({
    key,
    uploadId,
    async uploadPart(partNumber, body) {
      const u = uploads.get(uploadId)
      if (!u || u.key !== key) throw new Error('no such upload')
      const bytes = new Uint8Array(await new Response(body).arrayBuffer())
      const etag = `part-${partNumber}-${bytes.length}`
      u.parts.set(partNumber, { bytes, etag })
      return { partNumber, etag }
    },
    async complete(parts) {
      const u = uploads.get(uploadId)
      if (!u || u.key !== key) throw new Error('no such upload')
      const chunks = parts.map((p) => {
        const stored = u.parts.get(p.partNumber)
        if (!stored || stored.etag !== p.etag) throw new Error(`part ${p.partNumber} does not match`)
        return stored.bytes
      })
      const body = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
      let at = 0
      for (const c of chunks) { body.set(c, at); at += c.length }
      const object = { body, httpMetadata: u.httpMetadata, customMetadata: u.customMetadata, size: body.length, uploaded: new Date('2026-11-13T00:00:00Z'), etag: 'etag-' + key }
      store.set(key, object)
      uploads.delete(uploadId)
      return { key, size: object.size, customMetadata: object.customMetadata }
    },
    async abort() {
      if (!uploads.has(uploadId)) throw new Error('no such upload')
      uploads.delete(uploadId)
    },
  })
  const api = {
    _store: store,
    _uploads: uploads,
    async createMultipartUpload(key, opts = {}) {
      const uploadId = `upload-${uploads.size + 1}`
      uploads.set(uploadId, { key, parts: new Map(), httpMetadata: opts.httpMetadata || {}, customMetadata: opts.customMetadata || {} })
      return multipart(key, uploadId)
    },
    resumeMultipartUpload(key, uploadId) {
      return multipart(key, uploadId)
    },
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

test('check reports bindings, a KV round-trip, and refuses to guess about transforms', async () => {
  const env = makeEnv()
  const res = await call(env, '/__photos/check')
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.equal(body.bucket_bound, true)
  assert.equal(body.albums_bound, true)
  assert.equal(body.albums_ok, true)
  assert.equal(body.delivery_base, 'https://cdn.example.test')
  assert.equal(body.transform_ok, null, 'the worker cannot answer this about its own zone')
  assert.equal(body.transform_probe, 'https://cdn.example.test/cdn-cgi/image/width=1/photos/__transform_probe__')
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

const HOST = 'cdn.example.test'

test('bearer tokens: valid scope passes, wrong scope, expiry and bad signature do not', async () => {
  const env = makeEnv()
  const mk = async (token) =>
    call(env, '/photos/list', { headers: { Authorization: `Bearer ${token}` } })

  assert.equal((await mk(await signToken({ scope: ['read'], hostname: HOST, exp: future() }))).status, 200)
  assert.equal((await mk(await signToken({ scope: ['upload'], hostname: HOST, exp: future() }))).status, 401, 'wrong scope')
  assert.equal((await mk(await signToken({ scope: ['read'], hostname: HOST, exp: past() }))).status, 401, 'expired')
  assert.equal((await mk(await signToken({ scope: ['read'], hostname: HOST }))).status, 401, 'no exp')
  assert.equal((await mk(await signToken({ scope: ['read'], hostname: HOST, exp: future() }, 'other-secret'))).status, 401, 'bad signature')
  assert.equal((await mk('not.a.token')).status, 401)
})

test('a token minted for another World does not open this one', async () => {
  const env = makeEnv()
  // Same secret, same scope, unexpired — only the hostname claim differs. Every proxy is stamped
  // with the same upload secret, so this is the only thing standing between the Worlds.
  const foreign = await signToken({ scope: ['read'], hostname: 'cdn.someone-else.test', exp: future() })
  assert.equal((await call(env, '/photos/list', { headers: { Authorization: `Bearer ${foreign}` } })).status, 401)
  const missing = await signToken({ scope: ['read'], exp: future() })
  assert.equal((await call(env, '/photos/list', { headers: { Authorization: `Bearer ${missing}` } })).status, 401, 'no hostname claim at all')
})

test('transform: params redirect to /cdn-cgi/image on the same host, and format=auto is added', async () => {
  const env = makeEnv()
  await uploadPng(env, 'b.png')
  const res = await call(env, '/photos/b.png?w=200&q=80')
  assert.equal(res.status, 302, 'the client must make the request the edge will intercept')
  const target = res.headers.get('location')
  assert.match(target, /^https:\/\/cdn\.example\.test\/cdn-cgi\/image\//)
  assert.match(target, /width=200/)
  assert.match(target, /quality=80/)
  assert.match(target, /format=auto/, 'format=auto is added unless asked otherwise')
  assert.match(target, /\/photos\/b\.png$/)
  assert.equal(res.headers.get('cache-control'), 'public, max-age=3600', 'not permanent — the mechanism may change')
})

test('no transform params still serves the bytes in-process, never a redirect', async () => {
  const env = makeEnv()
  await uploadPng(env, 'c.png')
  const res = await call(env, '/photos/c.png')
  assert.equal(res.status, 200)
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), new Uint8Array([1, 2, 3, 4]))
})

test('a junk transform parameter is dropped rather than forwarded', async () => {
  const env = makeEnv()
  await uploadPng(env, 'd.png')
  const res = await call(env, '/photos/d.png?w=' + encodeURIComponent('200/../../evil') + '&h=100')
  const target = res.headers.get('location')
  assert.ok(!target.includes('evil'), 'value outside the option grammar is dropped')
  assert.match(target, /height=100/)
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

test('an album read hides keys whose object is gone, without rewriting the record', async () => {
  const env = makeEnv()
  await uploadPng(env, 'keep.png')
  await call(env, '/albums/Stale', {
    method: 'POST',
    headers: withSecret(),
    body: JSON.stringify({ images: ['keep.png', 'vanished.png'] }),
  })

  const read = await (await call(env, '/albums/Stale', { headers: withSecret() })).json()
  assert.deepEqual(read.images, ['keep.png'], 'a viewer never sees a photo that is not there')
  assert.deepEqual(read.missingImages, ['vanished.png'])
  assert.deepEqual(read.storedImages, ['keep.png', 'vanished.png'])

  // The stored record is untouched: a migration that writes an album before copying its objects
  // must not have its state eaten by someone opening the album.
  const stored = JSON.parse(env.PHOTO_ALBUMS._store.get('album:Stale'))
  assert.deepEqual(stored.images, ['keep.png', 'vanished.png'])
  assert.ok(!stored.auditLog.some((e) => e.action === 'prune_missing'), 'no write on read')
})

test('add and remove images', async () => {
  const env = makeEnv()
  await uploadPng(env, 'x.png')
  await uploadPng(env, 'y.png')
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

// ---- upload in parts (2026-11-13) ---------------------------------------------------------------

const jsonPost = (env, path, body, headers = withSecret()) =>
  call(env, path, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const putPart = (env, key, uploadId, n, bytes, headers = withSecret()) =>
  call(env, `/photos/multipart/part?key=${encodeURIComponent(key)}&uploadId=${uploadId}&partNumber=${n}`, { method: 'PUT', headers, body: bytes })

test('check reports that upload in parts is available', async () => {
  const check = await (await call(makeEnv(), '/__photos/check')).json()
  assert.equal(check.multipart, true)
  assert.equal(check.version, 'v2')
})

test('a file sent in parts is stored whole, with its type, meta and album', async () => {
  const env = makeEnv()
  const key = 'kurs/x/03-strikk-flette.mp4'
  const created = await jsonPost(env, '/photos/multipart/create', { key, contentType: 'video/mp4', meta: { course: 'x', order: 3 } })
  assert.equal(created.status, 200)
  const { uploadId } = await created.json()
  assert.ok(uploadId)

  const one = await (await putPart(env, key, uploadId, 1, new Uint8Array([1, 2, 3]))).json()
  const two = await (await putPart(env, key, uploadId, 2, new Uint8Array([4, 5]))).json()
  assert.equal(one.partNumber, 1)
  assert.ok(two.etag)
  assert.equal(env.PHOTOS_BUCKET._store.has(key), false, 'nothing is delivered before complete')

  const done = await jsonPost(env, '/photos/multipart/complete', { key, uploadId, parts: [one, two], album: 'Kurs X', actor: 'a@example.test', owner: 'founder@example.test' })
  assert.equal(done.status, 200)
  const out = await done.json()
  assert.equal(out.url, `https://cdn.example.test/photos/${key}`)
  assert.equal(out.size, 5)
  assert.deepEqual(out.meta, { course: 'x', order: '3' })
  assert.equal(out.album, 'Kurs X')

  const stored = env.PHOTOS_BUCKET._store.get(key)
  assert.deepEqual([...stored.body], [1, 2, 3, 4, 5])
  assert.equal(stored.httpMetadata.contentType, 'video/mp4')
  const album = JSON.parse(env.PHOTO_ALBUMS._store.get('album:Kurs X'))
  assert.deepEqual(album.images, [key])
  assert.equal(album.createdBy, 'founder@example.test')

  const served = await call(env, `/photos/${key}`)
  assert.equal(served.status, 200)
  assert.equal(served.headers.get('content-type'), 'video/mp4')
})

test('every multipart route needs the upload scope', async () => {
  const env = makeEnv()
  const none = {}
  assert.equal((await jsonPost(env, '/photos/multipart/create', { key: 'a.mp4' }, none)).status, 401)
  assert.equal((await putPart(env, 'a.mp4', 'upload-1', 1, new Uint8Array([1]), none)).status, 401)
  assert.equal((await jsonPost(env, '/photos/multipart/complete', { key: 'a.mp4', uploadId: 'u', parts: [{ partNumber: 1, etag: 'e' }] }, none)).status, 401)
  assert.equal((await jsonPost(env, '/photos/multipart/abort', { key: 'a.mp4', uploadId: 'u' }, none)).status, 401)

  const exp = Math.floor(Date.now() / 1000) + 60
  const readOnly = { Authorization: `Bearer ${await signToken({ scope: ['read'], exp, hostname: 'cdn.example.test' })}` }
  assert.equal((await jsonPost(env, '/photos/multipart/create', { key: 'a.mp4' }, readOnly)).status, 401)
  const otherWorld = { Authorization: `Bearer ${await signToken({ scope: ['upload'], exp, hostname: 'cdn.other.test' })}` }
  assert.equal((await jsonPost(env, '/photos/multipart/create', { key: 'a.mp4' }, otherWorld)).status, 401)
  const upload = { Authorization: `Bearer ${await signToken({ scope: ['upload'], exp, hostname: 'cdn.example.test' })}` }
  assert.equal((await jsonPost(env, '/photos/multipart/create', { key: 'a.mp4' }, upload)).status, 200)
})

test('bad multipart input is a 400, and abort discards the upload', async () => {
  const env = makeEnv()
  assert.equal((await jsonPost(env, '/photos/multipart/create', {})).status, 400)
  assert.equal((await jsonPost(env, '/photos/multipart/create', { key: 'a.mp4', meta: [1] })).status, 400)
  assert.equal((await call(env, '/photos/multipart/create', { method: 'POST', headers: withSecret(), body: '{' })).status, 400)

  const { uploadId } = await (await jsonPost(env, '/photos/multipart/create', { key: 'a.mp4' })).json()
  assert.equal((await putPart(env, 'a.mp4', uploadId, 0, new Uint8Array([1]))).status, 400)
  assert.equal((await putPart(env, 'a.mp4', 'no-such', 1, new Uint8Array([1]))).status, 400)
  assert.equal((await jsonPost(env, '/photos/multipart/complete', { key: 'a.mp4', uploadId, parts: [] })).status, 400)
  assert.equal((await jsonPost(env, '/photos/multipart/complete', { key: 'a.mp4', uploadId, parts: [{ partNumber: 1, etag: 'wrong' }] })).status, 400)

  const aborted = await jsonPost(env, '/photos/multipart/abort', { key: 'a.mp4', uploadId })
  assert.equal(aborted.status, 200)
  assert.equal(env.PHOTOS_BUCKET._uploads.size, 0)
  assert.equal(env.PHOTOS_BUCKET._store.has('a.mp4'), false)
})
