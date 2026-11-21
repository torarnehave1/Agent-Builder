// Server-side transcription of a recording that is too big for one Whisper call.
//
// Whisper takes at most 25 MB per request; Contact Hub recordings are 24–57 MB (WebM/Opus,
// 128 kbit/s, measured 2026-10-27). The chat transcribes in the browser (AudioContext → 2-minute
// WAV chunks), which the MCP server cannot do — it has no browser. This does the same on the
// server WITHOUT re-encoding: a MediaRecorder WebM is a short header (EBML, Info, Tracks)
// followed by Clusters of ~30 s each, so header + a run of whole Clusters is itself a valid WebM
// file. Verified on a 40-minute recording: 8 pieces, each decodes cleanly and Whisper returns
// Norwegian text.
//
// Memory: a Worker has 128 MB. The pieces are Blobs built from views into the one download, and
// only CONCURRENCY of them are in flight at once, so a 57 MB file stays well under the limit.

import { splitAudio, planMp4FromMoov } from './audio-split.js'

export const WHISPER_MAX_BYTES = 24 * 1024 * 1024
export const CHUNK_BYTES = 8 * 1024 * 1024
const CONCURRENCY = 4

const ID_EBML = 0x1a45dfa3
const ID_SEGMENT = 0x18538067
const ID_INFO = 0x1549a966
const ID_TRACKS = 0x1654ae6b
const ID_CLUSTER = 0x1f43b675
const ID_TIMECODE = 0xe7

// EBML variable-length integer at p. keepMarker=true reads an element ID (marker bit kept).
function vint(buf, p, keepMarker) {
  const b = buf[p]
  if (b === undefined) throw new Error('truncated WebM')
  let len = 1
  let mask = 0x80
  while (len <= 8 && !(b & mask)) { mask >>= 1; len++ }
  if (len > 8) throw new Error('invalid EBML length')
  let value = keepMarker ? b : (b & (mask - 1))
  let allOnes = (b & (mask - 1)) === mask - 1
  for (let i = 1; i < len; i++) {
    value = value * 256 + buf[p + i]
    if (buf[p + i] !== 0xff) allOnes = false
  }
  return { value, len, unknown: !keepMarker && allOnes }
}

export function isWebm(buf) {
  return buf.length > 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3
}

/**
 * Split a WebM at Cluster boundaries.
 * Returns [{ parts: Uint8Array[], bytes, startMs }]: each piece is
 * EBML header + Segment (unknown size) + Info + Tracks + whole Clusters, at most maxBytes.
 */
export function splitWebm(buf, maxBytes = CHUNK_BYTES) {
  const ebml = vint(buf, 0, true)
  if (ebml.value !== ID_EBML) throw new Error('not a WebM file')
  const ebmlSize = vint(buf, ebml.len, false)
  const segAt = ebml.len + ebmlSize.len + ebmlSize.value
  const seg = vint(buf, segAt, true)
  if (seg.value !== ID_SEGMENT) throw new Error('WebM has no Segment')
  const segSize = vint(buf, segAt + seg.len, false)
  let p = segAt + seg.len + segSize.len

  const keep = []
  const clusters = []
  while (p < buf.length) {
    const id = vint(buf, p, true)
    const size = vint(buf, p + id.len, false)
    const dataAt = p + id.len + size.len
    if (id.value === ID_CLUSTER && size.unknown) {
      // A live-mode recording (no cluster sizes) would need a byte scan; none seen so far.
      throw new Error('WebM clusters have no size (live-mode file) — cannot split')
    }
    const end = Math.min(dataAt + size.value, buf.length)
    if (id.value === ID_INFO || id.value === ID_TRACKS) keep.push(buf.subarray(p, end))
    if (id.value === ID_CLUSTER) {
      let startMs = 0
      const tid = vint(buf, dataAt, true)
      if (tid.value === ID_TIMECODE) {
        const tsz = vint(buf, dataAt + tid.len, false)
        const at = dataAt + tid.len + tsz.len
        for (let i = 0; i < tsz.value; i++) startMs = startMs * 256 + buf[at + i]
      }
      clusters.push({ start: p, end, startMs })
    }
    if (size.unknown) break
    p = end
  }
  if (!clusters.length) throw new Error('WebM has no audio clusters')

  // Segment with "unknown size" (8-byte vint, all ones), so a piece never claims the whole file's length.
  const segHeader = new Uint8Array([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])
  const head = [buf.subarray(0, segAt), segHeader, ...keep]
  const headBytes = head.reduce((n, a) => n + a.length, 0)

  const pieces = []
  let cur = null
  for (const c of clusters) {
    const len = c.end - c.start
    if (cur && cur.bytes + len > maxBytes) { pieces.push(cur); cur = null }
    if (!cur) cur = { parts: [...head], bytes: headBytes, startMs: c.startMs }
    cur.parts.push(buf.subarray(c.start, c.end))
    cur.bytes += len
  }
  if (cur) pieces.push(cur)
  return pieces
}

export function formatClock(ms) {
  const s = Math.floor((ms || 0) / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

async function whisper(env, blob, fileName, language) {
  const fd = new FormData()
  fd.append('file', blob, fileName)
  fd.append('model', 'whisper-1')
  if (language) fd.append('language', language)
  const target = env.OPENAI_WORKER?.fetch
    ? (req) => env.OPENAI_WORKER.fetch('https://openai-worker/audio', req)
    : (req) => fetch('https://openai.vegvisr.org/audio', req)
  let lastErr = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await target({ method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error?.message || data?.error || `Whisper HTTP ${res.status}`)
      return String(data.text || data.transcription || '').trim()
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}

/**
 * Transcribe audio bytes. A file over the Whisper limit is split without re-encoding: WebM at
 * Cluster boundaries, MP4/M4A, WAV and MP3 by audio-split.js; any other format must fit in one
 * call. Returns { text, chunks, failed }.
 * text is "[mm:ss] …" paragraphs, one per piece, like the chat's browser transcription.
 */
export async function transcribeAudioBytes(env, buf, { fileName = 'audio.webm', contentType = 'audio/webm', language = 'no' } = {}) {
  let pieces
  let pieceExt = null
  if (buf.length <= WHISPER_MAX_BYTES) {
    pieces = [{ parts: [buf], bytes: buf.length, startMs: 0 }]
  } else if (isWebm(buf)) {
    pieces = splitWebm(buf, CHUNK_BYTES)
  } else {
    // MP4/M4A, WAV, MP3 (audio-split.js). The pieces are files of that kind, whatever the
    // recording was named, so the name and type sent to Whisper come from the splitter.
    const split = splitAudio(buf, CHUNK_BYTES)
    if (!split) {
      throw new Error(`The file is ${(buf.length / 1048576).toFixed(1)} MB and not WebM, MP4/M4A, WAV or MP3; only those can be split on the server (Whisper takes at most 24 MB).`)
    }
    pieces = split.pieces
    pieceExt = split.ext
    contentType = split.contentType
    const tooBig = pieces.find(p => p.bytes > WHISPER_MAX_BYTES)
    if (tooBig) throw new Error(`A ${split.format} piece is ${(tooBig.bytes / 1048576).toFixed(1)} MB and cannot be made smaller; Whisper takes at most 24 MB.`)
  }
  const ext = pieceExt || (fileName.split('.').pop() || 'webm').toLowerCase()
  return whisperPieces(env, pieces, { ext, contentType, language, concurrency: CONCURRENCY, partsOf: (p) => p.parts })
}

// Send pieces to Whisper, `concurrency` at a time, and join the text. partsOf(piece) gives the
// piece's bytes (may be async: the range path fetches them only now, so they are freed as soon
// as that piece is sent).
async function whisperPieces(env, pieces, { ext, contentType, language, concurrency, partsOf }) {
  const results = new Array(pieces.length)
  let next = 0
  const worker = async () => {
    while (next < pieces.length) {
      const i = next++
      const piece = pieces[i]
      try {
        const blob = new Blob(await partsOf(piece), { type: contentType })
        results[i] = { ok: true, text: await whisper(env, blob, `part_${i + 1}.${ext}`, language) }
      } catch (e) {
        results[i] = { ok: false, text: `[Feil i denne delen: ${e.message}]` }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pieces.length) }, worker))
  const text = pieces
    .map((p, i) => (results[i].text ? `[${formatClock(p.startMs)}] ${results[i].text}` : ''))
    .filter(Boolean)
    .join('\n\n')
  return {
    text,
    chunks: pieces.length,
    failed: results.filter(r => !r.ok).length,
  }
}

// ── Large MP4/M4A by HTTP Range (2026-11-21) ──────────────────────────────────────────────────
// A Zoom recording of a 90-minute group conversation is 85–90 MB: more than transcribeAudioBytes
// can hold (the whole file + the pieces in flight, in a Worker's 128 MB). Here the file is never
// downloaded whole: the top-level box headers are read with small Range requests, then the moov
// index (about 1–3 MB), and each piece's sample bytes are fetched only when that piece goes to
// Whisper. In memory at once: the index plus RANGE_CONCURRENCY pieces of ≤ CHUNK_BYTES.
export const RANGE_CONCURRENCY = 2
const MAX_MOOV_BYTES = 32 * 1024 * 1024

async function fetchRange(fetchFn, url, start, end) { // [start, end)
  const res = await fetchFn(url, { headers: { Range: `bytes=${start}-${end - 1}` } })
  if (res.status !== 206) {
    try { await res.body?.cancel() } catch { /* nothing to release */ }
    throw new Error(`the server did not answer a Range request (HTTP ${res.status})`)
  }
  const buf = new Uint8Array(await res.arrayBuffer())
  if (buf.length !== end - start) throw new Error(`Range ${start}-${end - 1} returned ${buf.length} bytes`)
  return buf
}

/**
 * Transcribe a plain MP4/M4A at `url` of `totalBytes` bytes without holding it in memory.
 * The URL must answer Range requests with 206 (R2 does). Same result shape as transcribeAudioBytes.
 */
export async function transcribeMp4FromUrl(env, url, totalBytes, { language = 'no', fetchFn = fetch } = {}) {
  const u32 = (b, p) => ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3]
  let moov = null
  let p = 0
  let boxes = 0
  while (p + 8 <= totalBytes) {
    if (++boxes > 64) throw new Error('MP4 has too many top-level boxes to read by range')
    const h = await fetchRange(fetchFn, url, p, Math.min(p + 16, totalBytes))
    let size = u32(h, 0)
    const type = String.fromCharCode(h[4], h[5], h[6], h[7])
    if (boxes === 1 && !['ftyp', 'moov', 'mdat', 'free', 'wide', 'skip'].includes(type)) {
      throw new Error('the file is not MP4/M4A')
    }
    if (size === 1) size = u32(h, 8) * 4294967296 + u32(h, 12)
    else if (size === 0) size = totalBytes - p
    if (size < 8) throw new Error('MP4 box with an impossible size')
    if (type === 'moof') throw new Error('fragmented MP4 cannot be split by range')
    if (type === 'moov') moov = { start: p, end: Math.min(p + size, totalBytes) }
    p += size
  }
  if (!moov) throw new Error('MP4 has no moov box (the recording is incomplete) — cannot split')
  if (moov.end - moov.start > MAX_MOOV_BYTES) throw new Error('the MP4 index is too large')
  const moovBytes = await fetchRange(fetchFn, url, moov.start, moov.end)
  const pieces = planMp4FromMoov(moovBytes, totalBytes, CHUNK_BYTES)
  const tooBig = pieces.find(pc => pc.bytes > WHISPER_MAX_BYTES)
  if (tooBig) throw new Error(`An MP4/M4A piece is ${(tooBig.bytes / 1048576).toFixed(1)} MB and cannot be made smaller; Whisper takes at most 24 MB.`)
  const partsOf = async (piece) => {
    const out = []
    for (const part of piece.parts) {
      out.push(part instanceof Uint8Array ? part : await fetchRange(fetchFn, url, part.start, part.end))
    }
    return out
  }
  return whisperPieces(env, pieces, { ext: 'm4a', contentType: 'audio/mp4', language, concurrency: RANGE_CONCURRENCY, partsOf })
}
