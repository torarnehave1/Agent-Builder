// Split MP4/M4A, WAV and MP3 audio into pieces Whisper accepts — WITHOUT decoding or re-encoding.
//
// server-transcribe.js could only split WebM, so a 55 MB .m4a in the audio portfolio (a phone or
// Zoom recording) was refused on the server while the chat transcribed it in the browser
// (AudioContext decodes anything). A Worker has no decoder, but none is needed: every format
// here is a container around independently decodable frames, so a piece is "a small header +
// a run of whole frames", written as a valid file of the same kind.
//
//   MP4/M4A (plain)      one index (moov → stbl) says where every sample is. A piece gets its
//                        own small index for its run of samples, and the samples themselves.
//   MP4 (fragmented)     Safari's MediaRecorder: init (ftyp + moov) followed by moof+mdat
//                        fragments. A piece is init + whole fragments, like WebM clusters.
//   WAV                  header + raw PCM; a piece is a new header + whole sample blocks.
//   MP3                  a stream of frames; a piece is a run of whole frames.
//
// Every splitter returns [{ parts: Uint8Array[], bytes, startMs }] — the same shape as
// splitWebm — where parts are views into the one download (plus small generated headers).
// The pieces were checked with ffprobe/ffmpeg in test-audio-split.mjs: each decodes on its own
// and the durations add up to the original.

const u16 = (b, p) => (b[p] << 8) | b[p + 1]
const u32 = (b, p) => ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3]
const u64 = (b, p) => u32(b, p) * 4294967296 + u32(b, p + 4)
const le16 = (b, p) => b[p] | (b[p + 1] << 8)
const le32 = (b, p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16)) + b[p + 3] * 16777216
const fourcc = (b, p) => String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3])
const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0))
const be32 = (n) => new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff])
const be16 = (n) => new Uint8Array([(n >>> 8) & 0xff, n & 0xff])
const zeros = (n) => new Uint8Array(n)
function concat(arrays) {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0))
  let p = 0
  for (const a of arrays) { out.set(a, p); p += a.length }
  return out
}

// ───────────────────────────── MP4 / M4A ─────────────────────────────

function mp4Boxes(buf, start, end) {
  const out = []
  let p = start
  while (p + 8 <= end) {
    let size = u32(buf, p)
    let header = 8
    if (size === 1) {
      if (p + 16 > end) break
      size = u64(buf, p + 8)
      header = 16
    } else if (size === 0) {
      size = end - p
    }
    if (size < header) break
    out.push({ type: fourcc(buf, p + 4), start: p, dataAt: p + header, end: Math.min(p + size, end) })
    p += size
  }
  return out
}
const child = (buf, parent, type) => mp4Boxes(buf, parent.dataAt, parent.end).find((b) => b.type === type) || null

export function isMp4(buf) {
  if (buf.length < 12) return false
  const t = fourcc(buf, 4)
  return t === 'ftyp' || t === 'moov' || t === 'mdat' || t === 'free' || t === 'wide' || t === 'skip'
}

const mp4Box = (type, ...payload) => {
  const body = concat(payload)
  return concat([be32(body.length + 8), ascii(type), body])
}
const MATRIX = concat([be32(0x00010000), zeros(12), be32(0x00010000), zeros(12), be32(0x40000000)])

// A complete, minimal index for ONE audio track holding `sizes.length` samples in one chunk.
// The last four bytes are the chunk offset (stco), filled in by the caller once the size is known.
function buildMoov({ timescale, stsd, sizes, durations, totalDuration }) {
  const sttsRuns = []
  for (const d of durations) {
    const last = sttsRuns[sttsRuns.length - 1]
    if (last && last[1] === d) last[0]++
    else sttsRuns.push([1, d])
  }
  const stts = mp4Box('stts', be32(0), be32(sttsRuns.length), ...sttsRuns.flatMap(([n, d]) => [be32(n), be32(d)]))
  const stsc = mp4Box('stsc', be32(0), be32(1), be32(1), be32(sizes.length), be32(1))
  const sizeTable = new Uint8Array(sizes.length * 4)
  const view = new DataView(sizeTable.buffer)
  for (let i = 0; i < sizes.length; i++) view.setUint32(i * 4, sizes[i])
  const stsz = mp4Box('stsz', be32(0), be32(0), be32(sizes.length), sizeTable)
  const stco = mp4Box('stco', be32(0), be32(1), be32(0))
  const stbl = mp4Box('stbl', stsd, stts, stsc, stsz, stco)
  const dinf = mp4Box('dinf', mp4Box('dref', be32(0), be32(1), mp4Box('url ', be32(1))))
  const minf = mp4Box('minf', mp4Box('smhd', be32(0), be32(0)), dinf, stbl)
  const mdia = mp4Box('mdia',
    mp4Box('mdhd', be32(0), be32(0), be32(0), be32(timescale), be32(totalDuration), be16(0x55c4), be16(0)),
    mp4Box('hdlr', be32(0), be32(0), ascii('soun'), zeros(12), ascii('SoundHandler\0')),
    minf)
  const tkhd = mp4Box('tkhd', be32(7), be32(0), be32(0), be32(1), be32(0), be32(totalDuration), zeros(8),
    be16(0), be16(0), be16(0x0100), be16(0), MATRIX, be32(0), be32(0))
  const mvhd = mp4Box('mvhd', be32(0), be32(0), be32(0), be32(timescale), be32(totalDuration),
    be32(0x00010000), be16(0x0100), zeros(10), MATRIX, zeros(24), be32(2))
  return mp4Box('moov', mvhd, mp4Box('trak', tkhd, mdia))
}

const PIECE_FTYP = mp4Box('ftyp', ascii('M4A '), be32(0), ascii('M4A '), ascii('mp42'), ascii('isom'))

function audioTrack(buf, moov) {
  for (const trak of mp4Boxes(buf, moov.dataAt, moov.end).filter((b) => b.type === 'trak')) {
    const mdia = child(buf, trak, 'mdia')
    const hdlr = mdia && child(buf, mdia, 'hdlr')
    if (!hdlr || fourcc(buf, hdlr.dataAt + 8) !== 'soun') continue
    const mdhd = child(buf, mdia, 'mdhd')
    const tkhd = child(buf, trak, 'tkhd')
    const minf = child(buf, mdia, 'minf')
    const stbl = minf && child(buf, minf, 'stbl')
    if (!mdhd || !stbl) continue
    const timescale = u32(buf, mdhd.dataAt + (buf[mdhd.dataAt] === 1 ? 20 : 12))
    const trackId = tkhd ? u32(buf, tkhd.dataAt + (buf[tkhd.dataAt] === 1 ? 20 : 12)) : 1
    return { stbl, timescale: timescale || 44100, trackId }
  }
  return null
}

/**
 * Split an MP4/M4A at sample (plain) or fragment (fragmented) boundaries.
 * Returns [{ parts, bytes, startMs }]; each piece is a complete .m4a/.mp4 with the audio track.
 */
export function splitMp4(buf, maxBytes) {
  const top = mp4Boxes(buf, 0, buf.length)
  const moov = top.find((b) => b.type === 'moov')
  if (!moov) throw new Error('MP4 has no moov box (the recording is incomplete) — cannot split')
  const track = audioTrack(buf, moov)
  if (!track) throw new Error('MP4 has no audio track')
  if (top.some((b) => b.type === 'moof')) return splitFragmentedMp4(buf, top, moov, track, maxBytes)

  const { stbl, timescale } = track
  const stsd = child(buf, stbl, 'stsd')
  const stts = child(buf, stbl, 'stts')
  const stsc = child(buf, stbl, 'stsc')
  const stsz = child(buf, stbl, 'stsz')
  const stco = child(buf, stbl, 'stco')
  const co64 = child(buf, stbl, 'co64')
  if (!stsd || !stts || !stsc || !stsz || !(stco || co64)) throw new Error('MP4 sample tables are incomplete — cannot split')

  const uniform = u32(buf, stsz.dataAt + 4)
  const count = u32(buf, stsz.dataAt + 8)
  if (!count) throw new Error('MP4 audio track has no samples')
  const sizeOf = (i) => (uniform || u32(buf, stsz.dataAt + 12 + i * 4))

  // Where each sample starts: chunk offset + the samples before it in that chunk.
  const offsets = new Float64Array(count)
  const chunkCount = u32(buf, (stco || co64).dataAt + 4)
  const chunkOffset = (c) => (stco ? u32(buf, stco.dataAt + 8 + c * 4) : u64(buf, co64.dataAt + 8 + c * 8))
  const runs = u32(buf, stsc.dataAt + 4)
  let sample = 0
  for (let r = 0; r < runs && sample < count; r++) {
    const at = stsc.dataAt + 8 + r * 12
    const firstChunk = u32(buf, at)
    const perChunk = u32(buf, at + 4)
    const nextFirst = r + 1 < runs ? u32(buf, at + 12) : chunkCount + 1
    for (let c = firstChunk; c < nextFirst && sample < count; c++) {
      let p = chunkOffset(c - 1)
      for (let k = 0; k < perChunk && sample < count; k++) {
        offsets[sample] = p
        p += sizeOf(sample)
        sample++
      }
    }
  }
  const usable = sample // samples the chunk tables actually place

  const durations = new Uint32Array(usable)
  {
    const entries = u32(buf, stts.dataAt + 4)
    let i = 0
    for (let e = 0; e < entries && i < usable; e++) {
      const n = u32(buf, stts.dataAt + 8 + e * 8)
      const d = u32(buf, stts.dataAt + 12 + e * 8)
      for (let k = 0; k < n && i < usable; k++) durations[i++] = d
    }
  }

  const stsdBytes = buf.subarray(stsd.start, stsd.end)
  const pieces = []
  let from = 0
  let ticks = 0
  while (from < usable) {
    let to = from
    let dataBytes = 0
    let pieceTicks = 0
    while (to < usable) {
      const size = sizeOf(to)
      if (offsets[to] + size > buf.length) break // truncated file: stop at the last whole sample
      if (to > from && dataBytes + size > maxBytes) break
      dataBytes += size
      pieceTicks += durations[to]
      to++
    }
    if (to === from) break
    const sizes = new Uint32Array(to - from)
    const data = []
    let runStart = offsets[from]
    let runEnd = runStart
    for (let i = from; i < to; i++) {
      const size = sizeOf(i)
      sizes[i - from] = size
      if (offsets[i] !== runEnd) { // not contiguous (another track's data in between)
        if (runEnd > runStart) data.push(buf.subarray(runStart, runEnd))
        runStart = offsets[i]
      }
      runEnd = offsets[i] + size
    }
    if (runEnd > runStart) data.push(buf.subarray(runStart, runEnd))

    const moovBytes = buildMoov({ timescale, stsd: stsdBytes, sizes, durations: durations.subarray(from, to), totalDuration: pieceTicks })
    new DataView(moovBytes.buffer).setUint32(moovBytes.length - 4, PIECE_FTYP.length + moovBytes.length + 8)
    const mdatHeader = concat([be32(dataBytes + 8), ascii('mdat')])
    pieces.push({
      parts: [PIECE_FTYP, moovBytes, mdatHeader, ...data],
      bytes: PIECE_FTYP.length + moovBytes.length + 8 + dataBytes,
      startMs: Math.round((ticks / timescale) * 1000),
    })
    ticks += pieceTicks
    from = to
  }
  if (!pieces.length) throw new Error('MP4 audio data is missing from the file — cannot split')
  return pieces
}

function splitFragmentedMp4(buf, top, moov, track, maxBytes) {
  const ftyp = top.find((b) => b.type === 'ftyp')
  const head = [...(ftyp ? [buf.subarray(ftyp.start, ftyp.end)] : []), buf.subarray(moov.start, moov.end)]
  const headBytes = head.reduce((n, a) => n + a.length, 0)

  // A fragment = one moof and everything up to the next moof that is media (mdat).
  const fragments = []
  for (const b of top) {
    if (b.type === 'moof') fragments.push({ moof: b, end: b.end, startTicks: null })
    else if (b.type === 'mdat' && fragments.length) fragments[fragments.length - 1].end = b.end
  }
  for (const f of fragments) {
    for (const traf of mp4Boxes(buf, f.moof.dataAt, f.moof.end).filter((b) => b.type === 'traf')) {
      const tfhd = child(buf, traf, 'tfhd')
      const tfdt = child(buf, traf, 'tfdt')
      if (!tfhd || !tfdt || u32(buf, tfhd.dataAt + 4) !== track.trackId) continue
      f.startTicks = buf[tfdt.dataAt] === 1 ? u64(buf, tfdt.dataAt + 4) : u32(buf, tfdt.dataAt + 4)
    }
  }

  const pieces = []
  let cur = null
  for (const f of fragments) {
    const len = f.end - f.moof.start
    if (cur && cur.bytes + len > maxBytes) { pieces.push(cur); cur = null }
    if (!cur) cur = { parts: [...head], bytes: headBytes, startMs: f.startTicks == null ? 0 : Math.round((f.startTicks / track.timescale) * 1000) }
    // A tfhd may carry an ABSOLUTE file offset (base_data_offset). The fragment moves, so the
    // offset moves with it; everything else in a fragment is relative and stays as it is.
    const shift = f.moof.start - cur.bytes
    let moofBytes = buf.subarray(f.moof.start, f.moof.end)
    if (shift !== 0) {
      let copy = null
      for (const traf of mp4Boxes(buf, f.moof.dataAt, f.moof.end).filter((b) => b.type === 'traf')) {
        const tfhd = child(buf, traf, 'tfhd')
        if (!tfhd || !(u32(buf, tfhd.dataAt) & 0x000001)) continue
        if (!copy) copy = new Uint8Array(buf.subarray(f.moof.start, f.moof.end))
        const at = tfhd.dataAt + 8 - f.moof.start
        const moved = u64(copy, at) - shift
        const dv = new DataView(copy.buffer)
        dv.setUint32(at, Math.floor(moved / 4294967296))
        dv.setUint32(at + 4, moved >>> 0)
      }
      if (copy) moofBytes = copy
    }
    cur.parts.push(moofBytes, buf.subarray(f.moof.end, f.end))
    cur.bytes += len
  }
  if (cur) pieces.push(cur)
  if (!pieces.length) throw new Error('Fragmented MP4 has no media fragments — cannot split')
  return pieces
}

// ───────────────────────────── WAV ─────────────────────────────

export function isWav(buf) {
  return buf.length > 12 && fourcc(buf, 0) === 'RIFF' && fourcc(buf, 8) === 'WAVE'
}

export function splitWav(buf, maxBytes) {
  let fmt = null
  let data = null
  let p = 12
  while (p + 8 <= buf.length) {
    const id = fourcc(buf, p)
    const size = le32(buf, p + 4)
    if (id === 'fmt ') fmt = { start: p, end: Math.min(p + 8 + size, buf.length) }
    if (id === 'data') {
      // A recorder that never went back to write the size leaves 0 or 0xFFFFFFFF: take the rest.
      const end = size === 0 || p + 8 + size > buf.length ? buf.length : p + 8 + size
      data = { start: p + 8, end }
      break
    }
    p += 8 + size + (size & 1)
  }
  if (!fmt || !data) throw new Error('WAV has no fmt or data chunk — cannot split')
  const byteRate = le32(buf, fmt.start + 16) || 1
  const blockAlign = le16(buf, fmt.start + 20) || 1
  const fmtBytes = buf.subarray(fmt.start, fmt.end)
  const pad = fmtBytes.length & 1 ? [zeros(1)] : []
  const le = (n) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff])
  const step = Math.max(blockAlign, Math.floor(maxBytes / blockAlign) * blockAlign)

  const pieces = []
  for (let at = data.start; at < data.end; at += step) {
    const end = Math.min(at + step, data.end)
    const len = end - at
    const headerLen = 12 + fmtBytes.length + pad.length + 8
    const header = concat([ascii('RIFF'), le(headerLen - 8 + len), ascii('WAVE'), fmtBytes, ...pad, ascii('data'), le(len)])
    pieces.push({
      parts: [header, buf.subarray(at, end)],
      bytes: header.length + len,
      startMs: Math.round(((at - data.start) / byteRate) * 1000),
    })
  }
  if (!pieces.length) throw new Error('WAV has no audio data')
  return pieces
}

// ───────────────────────────── MP3 ─────────────────────────────

const MP3_BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
const MP3_BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
const MP3_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }

// A Layer III frame header at p → { size, samples, rate }, or null.
function mp3Frame(buf, p) {
  if (p + 4 > buf.length || buf[p] !== 0xff || (buf[p + 1] & 0xe0) !== 0xe0) return null
  const version = (buf[p + 1] >> 3) & 3
  const layer = (buf[p + 1] >> 1) & 3
  if (version === 1 || layer !== 1) return null
  const bitrateIdx = buf[p + 2] >> 4
  const rateIdx = (buf[p + 2] >> 2) & 3
  if (bitrateIdx === 0 || bitrateIdx === 15 || rateIdx === 3) return null
  const rate = MP3_RATES[version][rateIdx]
  const kbps = (version === 3 ? MP3_BITRATES_V1 : MP3_BITRATES_V2)[bitrateIdx]
  const padding = (buf[p + 2] >> 1) & 1
  const size = Math.floor(((version === 3 ? 144 : 72) * kbps * 1000) / rate) + padding
  return { size, samples: version === 3 ? 1152 : 576, rate }
}

function isMp3InfoFrame(buf, p, size) {
  const end = Math.min(p + Math.min(size, 48), buf.length - 4)
  for (let i = p + 4; i < end; i++) {
    const tag = fourcc(buf, i)
    if (tag === 'Xing' || tag === 'Info' || tag === 'VBRI') return true
  }
  return false
}

function mp3AudioStart(buf) {
  let p = 0
  if (buf.length > 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) { // "ID3"
    p = 10 + ((buf[6] & 0x7f) << 21) + ((buf[7] & 0x7f) << 14) + ((buf[8] & 0x7f) << 7) + (buf[9] & 0x7f)
  }
  return p
}

export function isMp3(buf) {
  let p = mp3AudioStart(buf)
  // Two frames in a row, within the first few KB after any tag.
  for (const limit = Math.min(buf.length, p + 8192); p < limit; p++) {
    const f = mp3Frame(buf, p)
    if (f && mp3Frame(buf, p + f.size)) return true
  }
  return false
}

export function splitMp3(buf, maxBytes) {
  const pieces = []
  let p = mp3AudioStart(buf)
  let cur = null
  let seconds = 0
  while (p < buf.length) {
    const f = mp3Frame(buf, p)
    if (!f || p + f.size > buf.length) { p++; continue } // tag, padding or a damaged frame: resync
    if (cur && p + f.size - cur.start > maxBytes) {
      pieces.push({ parts: [buf.subarray(cur.start, p)], bytes: p - cur.start, startMs: cur.startMs })
      cur = null
    }
    // The encoder's own info frame (Xing/Info/VBRI) describes the WHOLE file — frame count and
    // seek table — and holds no sound. Left in the first piece it would claim the full length.
    if (!cur && !pieces.length && isMp3InfoFrame(buf, p, f.size)) { p += f.size; continue }
    if (!cur) cur = { start: p, startMs: Math.round(seconds * 1000) }
    seconds += f.samples / f.rate
    p += f.size
  }
  if (cur && p > cur.start) pieces.push({ parts: [buf.subarray(cur.start, Math.min(p, buf.length))], bytes: Math.min(p, buf.length) - cur.start, startMs: cur.startMs })
  if (!pieces.length) throw new Error('MP3 has no audio frames — cannot split')
  return pieces
}

// ───────────────────────────── one door ─────────────────────────────

/**
 * Split a non-WebM recording. Returns { pieces, ext, contentType, format } or null when the
 * format is not one this file can split.
 */
export function splitAudio(buf, maxBytes) {
  if (isMp4(buf)) return { pieces: splitMp4(buf, maxBytes), ext: 'm4a', contentType: 'audio/mp4', format: 'MP4/M4A' }
  if (isWav(buf)) return { pieces: splitWav(buf, maxBytes), ext: 'wav', contentType: 'audio/wav', format: 'WAV' }
  if (isMp3(buf)) return { pieces: splitMp3(buf, maxBytes), ext: 'mp3', contentType: 'audio/mpeg', format: 'MP3' }
  return null
}
