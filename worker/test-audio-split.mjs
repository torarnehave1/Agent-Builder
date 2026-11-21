// audio-split.js: MP4/M4A, WAV and MP3 are split into pieces that are valid files on their own.
//
// The WAV and routing checks need nothing. The MP4/MP3 checks build real files with ffmpeg and
// read every piece back with ffprobe/ffmpeg (decodes cleanly, durations add up, start times
// right); without ffmpeg on the machine they are SKIPPED, not failed.
//
// Run:  node worker/test-audio-split.mjs   (exit 0 = pass, 1 = fail)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { splitAudio, splitMp4, splitWav, splitMp3, isMp4, isWav, isMp3 } from './audio-split.js'
import { transcribeAudioBytes, WHISPER_MAX_BYTES } from './server-transcribe.js'

let failures = 0
const check = (name, ok, msg = '') => { if (ok) console.log(`ok    ${name}`); else { failures++; console.error(`FAIL  ${name}\n      ${msg}`) } }
const join = (piece) => Buffer.concat(piece.parts.map((a) => Buffer.from(a.buffer, a.byteOffset, a.length)))

// ── WAV, by hand: 8 kHz mono 16-bit, 10 s of a ramp ──────────────────────────────────────────
function makeWav(seconds, rate = 8000) {
  const data = Buffer.alloc(seconds * rate * 2)
  for (let i = 0; i < data.length / 2; i++) data.writeInt16LE((i % 2000) - 1000, i * 2)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(data.length, 40)
  return { file: new Uint8Array(Buffer.concat([h, data])), data }
}
{
  const { file, data } = makeWav(10)
  check('wav: recognised', isWav(file) && !isMp4(file) && !isMp3(file))
  const pieces = splitWav(file, 50001) // not a multiple of the block size on purpose
  check('wav: split in 4', pieces.length === 4, `${pieces.length} pieces`)
  const bodies = pieces.map((p) => join(p).subarray(44))
  check('wav: every sample kept, in order', Buffer.concat(bodies).equals(data))
  check('wav: pieces end on whole samples', bodies.every((b) => b.length % 2 === 0))
  check('wav: each piece has its own correct header', pieces.every((p) => {
    const b = join(p)
    return b.toString('latin1', 0, 4) === 'RIFF' && b.readUInt32LE(4) === b.length - 8 && b.readUInt32LE(40) === b.length - 44 && p.bytes === b.length
  }))
  check('wav: start times', pieces[0].startMs === 0 && pieces[1].startMs === 3125, pieces.map((p) => p.startMs).join(','))
  const sized = makeWav(3).file
  sized[40] = sized[41] = sized[42] = sized[43] = 0 // a recorder that never wrote the data size
  check('wav: data size 0 means "the rest of the file"', splitWav(sized, 1 << 20)[0].bytes === sized.length)
}

// ── Routing in transcribeAudioBytes, with a fake Whisper ─────────────────────────────────────
{
  const calls = []
  const env = { OPENAI_WORKER: { fetch: async (_url, req) => {
    const f = req.body.get('file')
    calls.push({ name: f.name, type: f.type, size: f.size })
    return { ok: true, json: async () => ({ text: `del ${calls.length}` }) }
  } } }
  // 25 MB of WAV: over the Whisper limit, so it must be split (8 MB pieces) and sent as .wav
  const big = makeWav(Math.ceil((WHISPER_MAX_BYTES + 1e6) / 16000)).file
  const tx = await transcribeAudioBytes(env, big, { fileName: 'opptak.m4a', contentType: 'audio/mp4', language: 'no' })
  check('transcribe: a large WAV is split, not refused', tx.chunks === 4 && tx.failed === 0, JSON.stringify({ chunks: tx.chunks, failed: tx.failed }))
  check('transcribe: pieces are named and typed by what they ARE', calls.every((c) => c.name.endsWith('.wav') && c.type === 'audio/wav'), JSON.stringify(calls[0]))
  check('transcribe: every piece fits Whisper', calls.every((c) => c.size <= WHISPER_MAX_BYTES))
  check('transcribe: timestamps on each part', /^\[00:00\] /.test(tx.text) && tx.text.split('\n\n').length === 4, tx.text.slice(0, 80))

  const junk = new Uint8Array(WHISPER_MAX_BYTES + 10).fill(7)
  let msg = ''
  try { await transcribeAudioBytes(env, junk, { fileName: 'x.bin' }) } catch (e) { msg = e.message }
  check('transcribe: an unknown large format is refused with the list of what works', /WebM, MP4\/M4A, WAV or MP3/.test(msg), msg)
  check('splitAudio: unknown format → null', splitAudio(junk, 1000) === null)
}

// ── Real files, when ffmpeg is here ──────────────────────────────────────────────────────────
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0
if (!hasFfmpeg) {
  console.log('SKIP  ffmpeg/ffprobe not found — MP4 and MP3 pieces not checked against a decoder')
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-split-'))
  const ff = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  // Length of what actually DECODES (seconds). Not the container's own duration field: a
  // fragment keeps its original timestamps, so that field is "where it ends", not how long it is.
  const duration = (file) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-f', 's16le', '-ac', '1', '-ar', '8000', '-'], { maxBuffer: 64 * 1024 * 1024 }).length / 16000
  // Decode to nothing; anything ffmpeg complains about is a broken piece.
  const decodeErrors = (file) => spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', file, '-vn', '-f', 'null', '-']).stderr.toString().trim()
  const SECONDS = 180
  const tone = ['-f', 'lavfi', '-i', `sine=frequency=440:duration=${SECONDS}:sample_rate=44100`]

  const cases = [
    { name: 'm4a (index at the end)', file: 'plain.m4a', make: (f) => ff(...tone, '-c:a', 'aac', '-b:a', '64k', f), split: splitMp4, ext: 'm4a' },
    { name: 'm4a (index first)', file: 'fast.m4a', make: (f) => ff(...tone, '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', f), split: splitMp4, ext: 'm4a' },
    { name: 'mp4 with video beside the audio', file: 'video.mp4', make: (f) => ff('-f', 'lavfi', '-i', `testsrc=size=160x120:rate=5:duration=${SECONDS}`, ...tone, '-c:v', 'mpeg4', '-b:v', '40k', '-c:a', 'aac', '-b:a', '64k', '-shortest', f), split: splitMp4, ext: 'm4a' },
    { name: 'fragmented mp4 (absolute offsets)', file: 'frag.mp4', make: (f) => ff(...tone, '-c:a', 'aac', '-b:a', '64k', '-movflags', '+frag_keyframe+empty_moov', '-frag_duration', '5000000', f), split: splitMp4, ext: 'mp4' },
    { name: 'fragmented mp4 (offsets from moof)', file: 'fragmoof.mp4', make: (f) => ff(...tone, '-c:a', 'aac', '-b:a', '64k', '-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '5000000', f), split: splitMp4, ext: 'mp4' },
    { name: 'mp3 (constant bitrate, with ID3 tag)', file: 'cbr.mp3', make: (f) => ff(...tone, '-c:a', 'libmp3lame', '-b:a', '64k', '-metadata', 'title=Test', f), split: splitMp3, ext: 'mp3' },
    { name: 'mp3 (variable bitrate)', file: 'vbr.mp3', make: (f) => ff(...tone, '-c:a', 'libmp3lame', '-q:a', '6', f), split: splitMp3, ext: 'mp3' },
  ]
  for (const c of cases) {
    const src = path.join(tmp, c.file)
    try { c.make(src) } catch (e) { console.log(`SKIP  ${c.name}: ffmpeg could not make the test file (${String(e.stderr || e.message).trim().split('\n')[0]})`); continue }
    const buf = new Uint8Array(fs.readFileSync(src))
    const total = duration(src)
    const pieces = c.split(buf, 300 * 1024)
    check(`${c.name}: split in several pieces`, pieces.length >= 3, `${pieces.length} piece(s) from ${(buf.length / 1024).toFixed(0)} KB`)
    let sum = 0
    let clean = true
    let timesOk = true
    let sizesOk = true
    const detail = []
    pieces.forEach((p, i) => {
      const out = path.join(tmp, `${c.file}.${i}.${c.ext}`)
      const bytes = join(p)
      fs.writeFileSync(out, bytes)
      if (bytes.length !== p.bytes) sizesOk = false
      const err = decodeErrors(out)
      if (err) { clean = false; detail.push(`piece ${i}: ${err.split('\n')[0]}`) }
      // A piece starts where the ones before it ended (±0.6 s: one fragment's rounding).
      if (Math.abs(p.startMs / 1000 - sum) > 0.6) { timesOk = false; detail.push(`piece ${i}: startMs ${p.startMs}, expected ~${Math.round(sum * 1000)}`) }
      sum += duration(out)
    })
    check(`${c.name}: every piece decodes without errors`, clean, detail.join(' | '))
    check(`${c.name}: durations add up (${sum.toFixed(1)} s of ${total.toFixed(1)} s)`, Math.abs(sum - total) < 0.5 + pieces.length * 0.06, `sum ${sum}, original ${total}`)
    check(`${c.name}: start time of each piece`, timesOk, detail.join(' | '))
    check(`${c.name}: reported size is the real size`, sizesOk)
    check(`${c.name}: recognised by splitAudio`, splitAudio(buf, 300 * 1024)?.pieces.length === pieces.length)
  }

  // The audio itself must be untouched: decode original and the joined pieces to PCM and compare
  // loudness over the whole length (a dropped or repeated run of samples would show as a gap).
  {
    const src = path.join(tmp, 'plain.m4a')
    if (fs.existsSync(src)) {
      const pieces = splitMp4(new Uint8Array(fs.readFileSync(src)), 300 * 1024)
      const list = path.join(tmp, 'list.txt')
      fs.writeFileSync(list, pieces.map((_, i) => `file '${path.join(tmp, `plain.m4a.${i}.m4a`)}'`).join('\n'))
      const pcm = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args, '-f', 's16le', '-ac', '1', '-ar', '8000', '-'], { maxBuffer: 64 * 1024 * 1024 })
      const a = pcm(['-i', src])
      const b = pcm(['-f', 'concat', '-safe', '0', '-i', list])
      const rms = (buf, from, to) => { let s = 0; for (let i = from; i < to; i += 2) { const v = buf.readInt16LE(i); s += v * v } return Math.sqrt(s / ((to - from) / 2)) }
      let silent = 0
      for (let at = 0; at + 16000 <= b.length; at += 16000) if (rms(b, at, at + 16000) < 0.5 * rms(a, 0, 16000)) silent++
      check('m4a: joined pieces are as long as the original', Math.abs(a.length - b.length) < 16000 * 0.5 * pieces.length, `${a.length} vs ${b.length} bytes of PCM`)
      check('m4a: no silent second anywhere in the joined pieces', silent === 0, `${silent} silent second(s)`)
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true })
}

// ── Large MP4/M4A by HTTP Range (2026-11-21) ─────────────────────────────────────────────────
// transcribeMp4FromUrl must send Whisper exactly the pieces splitMp4 makes from the whole file,
// while reading only the box headers, the moov box and each piece's own bytes — never the file
// whole. Checked on real m4a files with the index at the end (ffmpeg's default, as in Zoom
// files) and at the start (+faststart), each large enough for several 8 MB pieces.
if (hasFfmpeg) {
  const { transcribeMp4FromUrl, CHUNK_BYTES } = await import('./server-transcribe.js')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'range-'))
  const join2 = (parts) => Buffer.concat(parts.map((a) => Buffer.from(a.buffer, a.byteOffset, a.length)))
  for (const faststart of [false, true]) {
    const name = `range m4a (moov ${faststart ? 'first' : 'last'})`
    const src = path.join(tmp, `r${faststart ? 1 : 0}.m4a`)
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anoisesrc=d=720:c=pink:r=44100', '-ac', '2', '-c:a', 'aac', '-b:a', '320k', ...(faststart ? ['-movflags', '+faststart'] : []), src])
    const file = new Uint8Array(fs.readFileSync(src))
    const expected = splitMp4(file, CHUNK_BYTES).map((p) => join2(p.parts))
    const sent = []
    const env = { OPENAI_WORKER: { fetch: async (url, init) => {
      const blob = init.body.get('file')
      sent.push({ name: blob.name, bytes: Buffer.from(await blob.arrayBuffer()) })
      return { ok: true, status: 200, json: async () => ({ text: `del ${sent.length}` }) }
    } } }
    const ranges = []
    const fetchFn = async (url, init) => {
      const m = /^bytes=(\d+)-(\d+)$/.exec(init?.headers?.Range || '')
      if (!m) return { status: 200, body: { cancel: async () => {} }, arrayBuffer: async () => { throw new Error('whole file requested') } }
      const a = Number(m[1]); const b = Math.min(Number(m[2]), file.length - 1)
      ranges.push(b - a + 1)
      const slice = file.slice(a, b + 1)
      return { status: 206, body: { cancel: async () => {} }, arrayBuffer: async () => slice.buffer }
    }
    const tx = await transcribeMp4FromUrl(env, 'https://audio.example/x.m4a', file.length, { fetchFn })
    sent.sort((x, y) => Number(x.name.match(/\d+/)[0]) - Number(y.name.match(/\d+/)[0]))
    check(`${name}: several pieces`, expected.length >= 3 && tx.chunks === expected.length && tx.failed === 0, `${tx.chunks} vs ${expected.length} pieces, ${(file.length / 1048576).toFixed(1)} MB`)
    check(`${name}: each piece byte-identical to splitting the whole file`, sent.length === expected.length && sent.every((s, i) => s.bytes.equals(expected[i])))
    check(`${name}: text joined in order`, /^\[00:00\] del \d/.test(tx.text) && tx.text.split('\n\n').length === expected.length, tx.text.slice(0, 120))
    const largest = Math.max(...ranges)
    check(`${name}: never more than one piece read at a time`, largest <= CHUNK_BYTES + 1024 && ranges.reduce((a, b) => a + b, 0) < file.length * 1.05, `largest range ${largest}`)
  }
  {
    let msg = ''
    const fetchFn = async () => ({ status: 200, body: { cancel: async () => {} }, arrayBuffer: async () => new ArrayBuffer(0) })
    try { await transcribeMp4FromUrl({}, 'https://x/y.m4a', 90e6, { fetchFn }) } catch (e) { msg = e.message }
    check('range m4a: a server without Range support is refused clearly', /did not answer a Range request/.test(msg), msg)
  }
  fs.rmSync(tmp, { recursive: true, force: true })
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nAll audio-split checks passed.')
