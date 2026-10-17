// world-photos-proxy serves byte ranges (2026-10-16): MP4 lessons must play on iPhone and seek.
//
// Runs the REAL template against a fake R2 bucket that parses Range the way R2 does
// (bytes=a-b, bytes=a-, bytes=-n), and checks 200/206/416 and the headers a video player needs.
//
// Run:  node worker/test-photos-proxy-range.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.join(dir, 'templates/world-photos-proxy.js'), 'utf8')
const mod = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'))
const proxy = mod.default

let failures = 0
const check = (name, cond, detail) => {
  if (cond) console.log(`ok    ${name}`)
  else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) }
}

const DATA = new Uint8Array(1000).map((_, i) => i % 256)
const KEY = 'lessons/legg-opp.mp4'
function parseRange(h, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(h || '')
  if (!m) return null
  if (m[1] === '') return { suffix: Number(m[2]) }
  const offset = Number(m[1])
  if (offset >= size) throw new Error('range not satisfiable')
  return m[2] === '' ? { offset } : { offset, length: Number(m[2]) - offset + 1 }
}
const bucket = {
  async head(k) { return k === KEY ? { size: DATA.length } : null },
  async get(k, opts) {
    if (k !== KEY) return null
    const range = opts && opts.range ? parseRange(opts.range.get('range'), DATA.length) : null
    let start = 0, end = DATA.length
    if (range) {
      if ('suffix' in range) start = DATA.length - range.suffix
      else { start = range.offset; end = range.length ? start + range.length : DATA.length }
    }
    return {
      size: DATA.length, httpEtag: '"e1"', range: range || undefined, body: DATA.slice(start, end),
      writeHttpMetadata(h) { h.set('content-type', 'video/mp4') },
    }
  },
}
const env = { PHOTOS_BUCKET: bucket }
const get = (headers = {}, method = 'GET', key = KEY) => proxy.fetch(new Request(`https://cdn.example/photos/${encodeURIComponent(key)}`, { method, headers }), env)

{
  const r = await get()
  check('a plain GET is 200 with the whole file and advertises ranges', r.status === 200 && r.headers.get('accept-ranges') === 'bytes' && (await r.arrayBuffer()).byteLength === 1000 && r.headers.get('content-length') === '1000', `${r.status} ${[...r.headers]}`)
}
{
  const r = await get({ range: 'bytes=0-1' })
  const b = new Uint8Array(await r.arrayBuffer())
  check('the Safari probe (bytes=0-1) is 206 with 2 bytes and bytes 0-1/1000', r.status === 206 && r.headers.get('content-range') === 'bytes 0-1/1000' && b.length === 2 && r.headers.get('content-type') === 'video/mp4', `${r.status} ${r.headers.get('content-range')} ${b.length}`)
}
{
  const r = await get({ range: 'bytes=500-' })
  const b = new Uint8Array(await r.arrayBuffer())
  check('an open range (seek) is 206 to the end', r.status === 206 && r.headers.get('content-range') === 'bytes 500-999/1000' && b.length === 500 && b[0] === DATA[500], `${r.status} ${r.headers.get('content-range')}`)
}
{
  const r = await get({ range: 'bytes=-100' })
  check('a suffix range is 206 with the last 100 bytes', r.status === 206 && r.headers.get('content-range') === 'bytes 900-999/1000' && r.headers.get('content-length') === '100', `${r.status} ${r.headers.get('content-range')}`)
}
{
  const r = await get({ range: 'bytes=5000-' })
  check('a range past the end is 416 with the size', r.status === 416 && r.headers.get('content-range') === 'bytes */1000', `${r.status} ${r.headers.get('content-range')}`)
}
{
  const r = await get({}, 'GET', 'missing.mp4')
  check('a missing key is still 404', r.status === 404, String(r.status))
}

// Upload with metadata (2026-10-16): the course routine stores lesson facts on each object.
{
  const puts = []
  const upEnv = { PHOTOS_BUCKET: { async put(k, body, opts) { puts.push({ k, opts }) } }, PHOTOS_UPLOAD_SECRET: 'sek', DELIVERY_BASE: 'https://cdn.example' }
  const send = (meta) => {
    const fd = new FormData()
    fd.append('file', new File([new Uint8Array(10)], 'a.mp4', { type: 'video/mp4' }))
    fd.append('key', 'kurs/enkel-hals/01-legg-opp.mp4')
    if (meta !== undefined) fd.append('meta', meta)
    return proxy.fetch(new Request('https://cdn.example/photos/upload', { method: 'POST', headers: { 'X-Upload-Secret': 'sek' }, body: fd }), upEnv)
  }
  const r = await send(JSON.stringify({ course: 'enkel-hals', lesson_id: 2155872188, order: 1, sha256: 'abc', skip: null }))
  const j = await r.json()
  const cm = puts[0] && puts[0].opts.customMetadata
  check('meta is stored as string custom metadata, nulls dropped', r.status === 200 && cm && cm.course === 'enkel-hals' && cm.lesson_id === '2155872188' && cm.order === '1' && !('skip' in cm) && puts[0].opts.httpMetadata.contentType === 'video/mp4' && j.key === 'kurs/enkel-hals/01-legg-opp.mp4', JSON.stringify({ status: r.status, j, puts }))
  const bad = await send('not json')
  check('meta that is not a JSON object is refused before anything is stored', bad.status === 400 && puts.length === 1, String(bad.status))
  const big = await send(JSON.stringify(Object.fromEntries(Array.from({ length: 20 }, (_, i) => ['k' + i, 'x'.repeat(200)]))))
  check('meta over 2 KB is refused', big.status === 400 && puts.length === 1, String(big.status))
  const none = await send()
  check('an upload without meta works as before', none.status === 200 && puts.length === 2 && !puts[1].opts.customMetadata, String(none.status))
}

// Album owner (2026-10-16): files an album under the World's founder while the log keeps the actor.
{
  const kv = new Map()
  const ALB = { async get(k) { return kv.get(k) ?? null }, async put(k, v) { kv.set(k, v) }, async delete(k) { kv.delete(k) }, async list() { return { keys: [...kv.keys()].map((name) => ({ name })) } } }
  const aEnv = { PHOTOS_BUCKET: { async put() {} }, PHOTO_ALBUMS: ALB, PHOTOS_UPLOAD_SECRET: 'sek', DELIVERY_BASE: 'https://cdn.example' }
  const up = (owner) => { const fd = new FormData(); fd.append('file', new File([new Uint8Array(4)], 'a.mp4', { type: 'video/mp4' })); fd.append('key', 'kurs/x/01.mp4'); fd.append('album', 'Kurs X'); fd.append('actor', 'sysowner@example.com'); if (owner) fd.append('owner', owner); return proxy.fetch(new Request('https://cdn.example/photos/upload', { method: 'POST', headers: { 'X-Upload-Secret': 'sek' }, body: fd }), aEnv) }
  const albumGet = async () => JSON.parse(kv.get('album:Kurs X') || '{}')
  await up(null)
  check('without owner, the uploader owns a new album (unchanged behaviour)', (await albumGet()).createdBy === 'sysowner@example.com', JSON.stringify(await albumGet()))
  const r = await proxy.fetch(new Request('https://cdn.example/albums/Kurs%20X', { method: 'POST', headers: { 'X-Upload-Secret': 'sek', 'Content-Type': 'application/json' }, body: JSON.stringify({ owner: 'founder@example.com', actor: 'sysowner@example.com' }) }), aEnv)
  const a = await albumGet()
  check('POST owner moves the album to the founder and keeps its files', r.status === 200 && a.createdBy === 'founder@example.com' && a.images.length === 1, JSON.stringify(a))
  const last = (a.auditLog || [])[a.auditLog.length - 1] || {}
  check('the audit entry keeps who did it and the previous owner', last.actor === 'sysowner@example.com' && last.details && last.details.owner === 'founder@example.com' && last.details.previousOwner === 'sysowner@example.com', JSON.stringify(last))
  await up('founder@example.com')
  check('an upload with owner keeps the founder as owner', (await albumGet()).createdBy === 'founder@example.com', JSON.stringify(await albumGet()))
}

// Resize parameters (2026-10-17): without IMAGE_TRANSFORMS=on the original is served, not a 302 to a 404.
{
  const r = await proxy.fetch(new Request(`https://cdn.example/photos/${KEY}?w=1200&h=630&fit=crop`), env)
  check('?w= without IMAGE_TRANSFORMS serves the file itself (200), not a redirect', r.status === 200 && (await r.arrayBuffer()).byteLength === 1000, String(r.status))
  const on = await proxy.fetch(new Request(`https://cdn.example/photos/${KEY}?w=1200`), { ...env, IMAGE_TRANSFORMS: 'on', DELIVERY_BASE: 'https://cdn.example' })
  const loc = on.headers.get('location') || ''
  check('with IMAGE_TRANSFORMS=on it redirects, slashes kept in the path', on.status === 302 && loc.includes('/photos/lessons/legg-opp.mp4') && !loc.includes('%2F'), loc)
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nall photos-proxy range checks pass')
