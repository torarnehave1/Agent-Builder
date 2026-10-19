// VEmotion media for agents (2026-10-19): what the Add Layer tabs Images, Video and Audio offer a
// person, as tools — the caller's clips, recordings, and the facts a layer needs about a file.
//
// The app learns an image's size and a clip's length by loading them in the browser. An agent has
// no browser, so get_vemotion_media_info reads the same facts from the file's own header: width and
// height for PNG / JPEG / GIF / WebP, duration (and frame size) for MP4 / MOV from the `mvhd` and
// `tkhd` boxes. It fetches byte ranges, never the whole file.

const HEAD_BYTES = 256 * 1024
const TAIL_BYTES = 2 * 1024 * 1024

// A VEmotion clip lives on api.vegvisr.org — the same Cloudflare zone as this worker, which cannot
// fetch it by its public URL (HTTP 522). Those go through the vemotion-worker service binding.
function fetcherFor(url, env) {
  if (env?.VEMOTION_WORKER && /^https:\/\/api\.vegvisr\.org\/vemotion\//.test(url)) {
    return (u, init) => env.VEMOTION_WORKER.fetch(u.replace('https://api.vegvisr.org', 'https://vemotion-worker'), init)
  }
  return fetch
}

async function fetchRange(url, range, env) {
  const res = await fetcherFor(url, env)(url, { headers: { Range: range } })
  if (!res.ok && res.status !== 206) throw new Error(`Could not read ${url} (HTTP ${res.status})`)
  const total = Number((res.headers.get('content-range') || '').split('/')[1]) || Number(res.headers.get('content-length')) || null
  const type = (res.headers.get('content-type') || '').split(';')[0] || null
  const buf = new Uint8Array(await res.arrayBuffer())
  return { buf, total, type, ranged: res.status === 206 }
}

const u16 = (b, o) => (b[o] << 8) | b[o + 1]
const u32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]
const le16 = (b, o) => b[o] | (b[o + 1] << 8)
const le24 = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)

export function imageSize(b) {
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { format: 'png', width: u32(b, 16), height: u32(b, 20) }
  }
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { format: 'gif', width: le16(b, 6), height: le16(b, 8) }
  }
  if (b.length >= 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15])
    if (chunk === 'VP8X') return { format: 'webp', width: le24(b, 24) + 1, height: le24(b, 27) + 1 }
    if (chunk === 'VP8 ') return { format: 'webp', width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff }
    if (chunk === 'VP8L') {
      const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)
      return { format: 'webp', width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }
    }
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) { o++; continue }
      const marker = b[o + 1]
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { o += 2; continue }
      const len = u16(b, o + 2)
      if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { format: 'jpeg', height: u16(b, o + 5), width: u16(b, o + 7) }
      }
      o += 2 + len
    }
    return { format: 'jpeg', width: null, height: null }
  }
  return null
}

// Walk ISO-BMFF boxes in `b` (which starts at file offset `base`), descending into containers.
function findBoxes(b, start, end, out) {
  let o = start
  while (o + 8 <= end) {
    let size = u32(b, o)
    const type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7])
    let header = 8
    if (size === 1 && o + 16 <= end) { size = u32(b, o + 8) * 2 ** 32 + u32(b, o + 12); header = 16 }
    if (size === 0) size = end - o
    if (size < header) break
    out.push({ type, start: o, header, size, complete: o + size <= end })
    if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(type)) findBoxes(b, o + header, Math.min(o + size, end), out)
    o += size
  }
  return out
}

export function mp4Info(b) {
  const boxes = findBoxes(b, 0, b.length, [])
  const mvhd = boxes.find((x) => x.type === 'mvhd')
  if (!mvhd || mvhd.start + 40 > b.length) return null
  const p = mvhd.start + mvhd.header
  const version = b[p]
  const timescale = version === 1 ? u32(b, p + 20) : u32(b, p + 12)
  const duration = version === 1 ? u32(b, p + 24) * 2 ** 32 + u32(b, p + 28) : u32(b, p + 16)
  let width = null, height = null
  for (const t of boxes.filter((x) => x.type === 'tkhd')) {
    const q = t.start + t.header
    const v = b[q]
    const wOff = q + (v === 1 ? 88 : 76)
    if (wOff + 8 > b.length) continue
    const w = u32(b, wOff) / 65536, h = u32(b, wOff + 4) / 65536
    if (!(w > 0 && h > 0)) continue
    // A phone clip is stored landscape with a 90° rotation in the track matrix (a = 0, b = ±1).
    const m = q + (v === 1 ? 52 : 40)
    const rotated = m + 8 <= b.length && u32(b, m) === 0 && u32(b, m + 4) !== 0
    width = Math.round(rotated ? h : w); height = Math.round(rotated ? w : h)
    break
  }
  return timescale > 0 ? { format: 'mp4', duration: Math.round((duration / timescale) * 1000) / 1000, width, height } : null
}

// A box header found anywhere in a tail chunk: scan for 'moov' and parse from there.
function moovIn(b) {
  for (let i = 4; i + 4 < b.length; i++) {
    if (b[i] === 0x6d && b[i + 1] === 0x6f && b[i + 2] === 0x6f && b[i + 3] === 0x76) {
      const info = mp4Info(b.subarray(i - 4))
      if (info) return info
    }
  }
  return null
}

export async function getVemotionMediaInfo(input, env) {
  const url = String(input?.url || '').trim()
  if (!/^https:\/\//.test(url)) throw new Error('url must be an https URL of an image, video or audio file.')
  const head = await fetchRange(url, `bytes=0-${HEAD_BYTES - 1}`, env)
  const img = imageSize(head.buf)
  if (img) {
    return { message: `${img.format} image, ${img.width}×${img.height}`, url, kind: 'image', ...img, bytes: head.total, contentType: head.type }
  }
  let video = mp4Info(head.buf)
  if (!video && head.ranged && head.total && head.total > HEAD_BYTES) {
    // moov at the end (not "fast-start"): read the tail.
    const tail = await fetchRange(url, `bytes=-${TAIL_BYTES}`, env)
    video = moovIn(tail.buf)
  }
  if (video) {
    return { message: `video, ${video.duration}s${video.width ? `, ${video.width}×${video.height}` : ''}`, url, kind: 'video', ...video, bytes: head.total, contentType: head.type }
  }
  const kind = /^audio\//.test(head.type || '') ? 'audio' : /^video\//.test(head.type || '') ? 'video' : 'unknown'
  return {
    message: `${kind} file — its length cannot be read from the header (only MP4/MOV video and PNG/JPEG/GIF/WebP images are). For audio, use the duration from vemotion_list_audio.`,
    url, kind, duration: null, width: null, height: null, bytes: head.total, contentType: head.type,
  }
}

export async function listVemotionVideos(input, env, authToken) {
  if (!env.VEMOTION_WORKER) throw new Error('VEMOTION_WORKER service binding is not configured')
  const res = await env.VEMOTION_WORKER.fetch('https://vemotion-worker/vemotion/videos', { headers: { 'X-API-Token': authToken } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Could not list your videos (HTTP ${res.status})`)
  let videos = Array.isArray(data.videos) ? data.videos : []
  const q = String(input?.query || '').trim().toLowerCase()
  if (q) videos = videos.filter((v) => String(v.name || '').toLowerCase().includes(q))
  return {
    message: `${videos.length} video clip(s)${q ? ` matching "${input.query}"` : ''} — use the url as a video layer's src. A clip without duration: get_vemotion_media_info reads it.`,
    count: videos.length,
    videos,
  }
}

export async function importVemotionVideo(input, env, authToken) {
  if (!env.VEMOTION_WORKER) throw new Error('VEMOTION_WORKER service binding is not configured')
  const url = String(input?.url || '').trim()
  if (!/^https:\/\//.test(url)) throw new Error('url must be an https URL of a video.')
  // Measure first, so the stored clip carries its length and size like an app upload does.
  let info = null
  try { info = await getVemotionMediaInfo({ url }, env) } catch { /* the import itself reports the real error */ }
  const body = { url, ...(input?.name ? { name: String(input.name) } : {}) }
  if (info?.kind === 'video') Object.assign(body, { duration: info.duration, width: info.width, height: info.height })
  const res = await env.VEMOTION_WORKER.fetch('https://vemotion-worker/vemotion/video/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Token': authToken },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Could not import the video (HTTP ${res.status})`)
  return {
    message: `Imported "${data.name}" into your VEmotion clips${info?.duration ? ` (${info.duration}s${info.width ? `, ${info.width}×${info.height}` : ''})` : ''} — use url as the video layer's src.`,
    url: data.url,
    key: data.key,
    name: data.name,
    duration: info?.duration ?? null,
    width: info?.width ?? null,
    height: info?.height ?? null,
  }
}
