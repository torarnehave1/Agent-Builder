// Server-side transcription: WebM split at Cluster boundaries + parallel Whisper with timestamps.
// Optional real-file check: REAL_WEBM=/path/to/recording.webm node test-server-transcribe.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { splitWebm, transcribeAudioBytes, isWebm, formatClock, WHISPER_MAX_BYTES } from './server-transcribe.js'

// --- tiny EBML writer ---------------------------------------------------------------------------
const idBytes = (id) => { const out = []; let v = id; while (v > 0) { out.unshift(v & 0xff); v = Math.floor(v / 256) } return out }
const size8 = (n) => { const b = [0x01, 0, 0, 0, 0, 0, 0, 0]; for (let i = 7; i >= 1; i--) { b[i] = n & 0xff; n = Math.floor(n / 256) } return b }
const el = (id, payload) => [...idBytes(id), ...size8(payload.length), ...payload]
const uint2 = (v) => [(v >> 8) & 0xff, v & 0xff]

const ebml = el(0x1a45dfa3, el(0x4282, [...Buffer.from('webm')]))
const info = el(0x1549a966, el(0x2ad7b1, [0x0f, 0x42, 0x40]))
const tracks = el(0x1654ae6b, el(0xae, el(0x86, [...Buffer.from('A_OPUS')])))
const cluster = (ms, fill) => el(0x1f43b675, [...el(0xe7, uint2(ms)), ...el(0xa3, new Array(1000).fill(fill))])
const clusters = [cluster(0, 1), cluster(30000 % 65536, 2), cluster(60000 % 65536, 3)]
const segPayload = [...info, ...tracks, ...clusters.flat()]
const file = new Uint8Array([...ebml, ...el(0x18538067, segPayload)])

assert.equal(isWebm(file), true)
assert.equal(isWebm(new Uint8Array([1, 2, 3, 4, 5])), false)

// Every piece: original EBML header + unknown-size Segment + Info + Tracks + whole clusters.
const pieces = splitWebm(file, 2200)
assert.equal(pieces.length, 2, 'two clusters fit in the first piece, the third goes alone')
const join = (p) => Buffer.concat(p.parts.map(a => Buffer.from(a)))
const first = join(pieces[0])
const second = join(pieces[1])
assert.deepEqual([...first.subarray(0, ebml.length)], ebml, 'starts with the EBML header')
assert.deepEqual([...first.subarray(ebml.length, ebml.length + 12)], [0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], 'Segment of unknown size')
const headLen = ebml.length + 12 + info.length + tracks.length
assert.deepEqual([...second.subarray(0, headLen)], [...first.subarray(0, headLen)], 'same header on every piece')
assert.deepEqual([...second.subarray(headLen)], clusters[2], 'second piece is exactly the third cluster')
assert.equal(first.length, headLen + clusters[0].length + clusters[1].length)
assert.equal(pieces[0].startMs, 0)
assert.equal(pieces[1].startMs, 60000 % 65536)
assert.equal(pieces[0].bytes, first.length)
assert.throws(() => splitWebm(new Uint8Array([0x42, 0x86, 0x81, 0x01])), /not a WebM/)

assert.equal(formatClock(0), '00:00')
assert.equal(formatClock(605000), '10:05')
assert.equal(formatClock(3725000), '1:02:05')

// --- transcribeAudioBytes with a fake Whisper ---------------------------------------------------
function fakeEnv(failOn = -1) {
  const calls = []
  return {
    calls,
    OPENAI_WORKER: {
      async fetch(url, req) {
        const f = req.body.get('file')
        const name = f.name
        calls.push({ url, name, size: f.size, lang: req.body.get('language') })
        const n = Number(name.match(/part_(\d+)/)[1])
        if (n - 1 === failOn) return new Response(JSON.stringify({ error: 'boom' }), { status: 500 })
        await new Promise(r => setTimeout(r, (5 - n) * 5)) // finish out of order
        return new Response(JSON.stringify({ text: `tekst ${n}` }))
      },
    },
  }
}

// Small file → one call, no split.
{
  const env = fakeEnv()
  const r = await transcribeAudioBytes(env, file, { fileName: 'a.webm' })
  assert.equal(r.chunks, 1)
  assert.equal(r.text, '[00:00] tekst 1')
  assert.equal(env.calls[0].url, 'https://openai-worker/audio')
  assert.equal(env.calls[0].lang, 'no')
}

// Over the limit and not WebM → refused with the reason.
{
  const big = new Uint8Array(WHISPER_MAX_BYTES + 1)
  await assert.rejects(() => transcribeAudioBytes(fakeEnv(), big, { fileName: 'a.mp3' }), /not WebM/)
}

// Real recording: split it, check every piece is under the limit and in time order, and the
// text comes back in order with one timestamp per piece and failures marked, not dropped.
const real = process.env.REAL_WEBM
if (real && fs.existsSync(real)) {
  const buf = new Uint8Array(fs.readFileSync(real))
  const ps = splitWebm(buf)
  assert.ok(ps.length >= 2)
  for (const p of ps) assert.ok(p.bytes <= 8 * 1024 * 1024 + 600000, `piece ${p.bytes} bytes`)
  for (let i = 1; i < ps.length; i++) assert.ok(ps[i].startMs > ps[i - 1].startMs)
  const env = fakeEnv(1)
  const r = await transcribeAudioBytes(env, buf, { fileName: 'r.webm' })
  assert.equal(r.chunks, ps.length)
  assert.equal(r.failed, 1)
  const lines = r.text.split('\n\n')
  assert.equal(lines.length, ps.length)
  assert.match(lines[0], /^\[00:00\] tekst 1$/)
  assert.match(lines[1], /Feil i denne delen/)
  assert.match(lines.at(-1), new RegExp(`tekst ${ps.length}$`))
  console.log(`real file: ${(buf.length / 1048576).toFixed(1)} MB → ${ps.length} pieces, starts ${ps.map(p => formatClock(p.startMs)).join(' ')}`)
}

console.log('test-server-transcribe: all assertions passed')
