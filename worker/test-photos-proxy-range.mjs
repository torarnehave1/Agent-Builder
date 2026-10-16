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

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nall photos-proxy range checks pass')
