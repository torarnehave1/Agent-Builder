#!/usr/bin/env node
// Course migration routine (2026-10-16): one course from Kajabi into a World, from a manifest.
//
//   compress  originals in <videoDir>/.. -> <videoDir> (H.264, faststart), CRF 20 -> 23 -> 26
//             until the file is under the 95 MB upload ceiling; skipped when already there
//   upload    each video into the World's own R2 under <folder>/<NN>-<slug>.mp4, in <album>,
//             with lesson metadata on the object, using a 5-minute token scoped to that World
//   verify    each uploaded video answers a byte range (206) — iPhone playback depends on it
//   transcribe each video's audio (mono MP3) through openai.vegvisr.org/audio (Whisper), kept in
//             state so a re-run never pays twice; timestamped paragraphs of about a minute
//   summarize a short overview of each video from its corrected transcript (anthropic.vegvisr.org,
//             structured JSON, formatted here): what it covers, points with timestamps, keywords,
//             hashtags — cached on the transcript text, so it is rewritten only when that changes
//   course    a course image (a frame of the first video, uploaded to the album) and «Om kurset» —
//             what you make, who it is for, what you need, the steps — written from every lesson
//   graph     the course graph in the World, built on the product template: a produkt node with
//             metadata.product, the course image (portfolio-image), «Om kurset», then per lesson
//             «Steg N av M»: for a video lesson
//             its summary, the realtime-video node and its transcript, in that order,
//             `next` edges; re-runs overwrite the same graph
//
// State per course in state/<slug>.json, so an interrupted run resumes where it stopped.
// Downloading from Kajabi is not here: it needs the signed-in browser (Claude in Chrome).
//
// Usage:  VEGVISR_TOKEN=<emailVerificationToken> node migrate.mjs <manifest.json>
//         (run.sh reads the token from D1 and never prints it)

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'

const AGENT = 'https://agent.vegvisr.org'
const KG = 'https://knowledge.vegvisr.org'
const CEILING = 95 * 1024 * 1024
// CRF 28 added 2026-11-13: Krise-siden's 5½-minute 1080p videos are ~109 MB at CRF 26.
const LADDER = [20, 23, 26, 28]
// One level for the whole school (decided 2026-11-17): CRF 23 wherever the proxy takes a file in
// parts. Measured on «Strikk flette» (8½ min, 1080p): 457 MB at CRF 20, 288 MB at CRF 23.
const FIXED_CRF = 23
// Upload in parts (2026-11-13): «Strikk flette» is 8½ minutes and about 160 MB even at CRF 28. A
// World photos proxy that answers `multipart: true` on /__photos/check takes a file of any size in
// parts, so the video stays at the first step of the ladder. 32 MiB per part: R2 wants at least
// 5 MiB and equal sizes, a Worker request carries about 100 MB.
const PART = 32 * 1024 * 1024

const here = path.dirname(fileURLToPath(import.meta.url))
const manifestPath = process.argv[2]
const DRY = process.argv.includes('--dry')
const ADOPT = process.argv.includes('--adopt')
if (!manifestPath) { console.error('usage: node migrate.mjs <manifest.json>'); process.exit(2) }
const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const token = process.env.VEGVISR_TOKEN
if (!token) { console.error('VEGVISR_TOKEN is not set'); process.exit(2) }
const actor = process.env.VEGVISR_EMAIL || 'torarnehave@gmail.com'
const userId = process.env.VEGVISR_USER_ID || ''
const AUDIO = 'https://openai.vegvisr.org/audio'
const LLM = 'https://anthropic.vegvisr.org/chat'
const SUMMARY_MODEL = process.env.SUMMARY_MODEL || 'claude-sonnet-5-5'
const SUMMARY_VERSION = 1
const LANGUAGE = m.language || 'no'
// Shared word file (2026-10-16): `terms` is Whisper's prompt, `replacements` fixes known misreadings.
// Corrections are applied when the graph is built, from the stored raw segments — a new pair in the
// file reaches every course on its next run without transcribing again.
const glossary = m.glossary ? JSON.parse(fs.readFileSync(path.join(here, 'glossary', `${m.glossary}.json`), 'utf8')) : { terms: [], replacements: {} }
const whisperPrompt = (glossary.terms || []).join(', ')
const promptHash = crypto.createHash('sha256').update(whisperPrompt).digest('hex').slice(0, 12)
const escapeRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function applyReplacements(text) {
  let out = text
  for (const phrase of glossary.drop_phrases || []) out = out.split(phrase).join('')
  out = out.replace(/\s{2,}/g, ' ').trim()
  for (const [wrong, right] of Object.entries(glossary.replacements || {})) {
    out = out.replace(new RegExp(`(?<![\\p{L}])${escapeRe(wrong)}(?![\\p{L}])`, 'giu'), (hit) =>
      hit[0] === hit[0].toUpperCase() ? right[0].toUpperCase() + right.slice(1) : right)
  }
  return out
}

fs.mkdirSync(path.join(here, 'state'), { recursive: true })
const statePath = path.join(here, 'state', `${m.slug}.json`)
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { uploads: {}, graphId: null }
state.transcripts = state.transcripts || {}
state.summaries = state.summaries || {}
state.course = state.course || {}
state.files = state.files || {}
state.compressed = state.compressed || {}
const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2))
const log = (...a) => console.log(`[${m.slug}]`, ...a)
// A library (product.kind "library", 2026-11-13) is a set of standalone videos — Krise-siden, the
// Teknikkbibliotek: «Video N av M», «Om <tittel>», no «Du strikker»/«Dette trenger du». A course
// keeps every prompt and label exactly as before, so its cached summaries stay valid.
const LIBRARY = (m.product && m.product.kind) === 'library'
const stepWord = LIBRARY ? 'Video' : 'Steg'

const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const duration = (p) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]).toString().trim())

// ---- compress ---------------------------------------------------------------------------------
function ensureCompressed(lesson, multipart) {
  const out = path.join(m.videoDir, lesson.file)
  // A file this routine made is reused only at the level in force; one made at another level is
  // made again. A file with no record is from before the record existed and is kept if it fits.
  const made = state.compressed[lesson.lesson_id]
  const wanted = multipart ? [FIXED_CRF] : LADDER
  if (fs.existsSync(out)) {
    const size = fs.statSync(out).size
    if (made ? (wanted.includes(made.crf) && made.bytes === size && (multipart || size <= CEILING)) : size <= CEILING) return out
  }
  const original = path.join(path.dirname(m.videoDir), lesson.file)
  if (!fs.existsSync(original)) throw new Error(`no original for ${lesson.title}: ${original} (download it from Kajabi first)`)
  fs.mkdirSync(m.videoDir, { recursive: true })
  for (const crf of wanted) {
    const tmp = `${out}.tmp.mp4`
    execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-i', original, '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', tmp])
    const size = fs.statSync(tmp).size
    log(`compressed ${lesson.title} at CRF ${crf}: ${(size / 1e6).toFixed(1)} MB`)
    if (size <= CEILING || multipart || crf === wanted[wanted.length - 1]) {
      fs.renameSync(tmp, out)
      state.compressed[lesson.lesson_id] = { crf, bytes: size }
      save()
      if (multipart) return out
      if (size > CEILING) throw new Error(`${lesson.title} is still ${(size / 1e6).toFixed(1)} MB at CRF ${crf}`)
      return out
    }
    fs.unlinkSync(tmp)
  }
}

// ---- upload -----------------------------------------------------------------------------------
async function mintToken() {
  const r = await fetch(`${AGENT}/world-photos/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ scope: ['upload', 'album', 'read'], world: m.world }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.token) throw new Error(`token for ${m.world} refused (${r.status}): ${j.error || 'unknown'}`)
  return j
}

// Whether this World's proxy takes a file in parts. Asked once per run.
let multipartOk = null
async function proxyTakesParts() {
  if (multipartOk === null) {
    const r = await fetch(`${await currentBase()}/__photos/check`)
    const j = await r.json().catch(() => ({}))
    multipartOk = r.ok && j.multipart === true
    log(`photos proxy: upload in parts ${multipartOk ? 'available' : 'not available'}`)
  }
  return multipartOk
}

// One file in parts. A token lives five minutes, so every call mints its own. Answers what
// /photos/upload answers. A failed part is tried three times; a failed upload is aborted, so no
// half-sent file is left in the founder's bucket.
async function uploadInParts(key, file, type, meta, title) {
  const call = async (route, init) => {
    const t = await mintToken()
    const r = await fetch(`${t.deliveryBase.replace(/\/+$/, '')}/photos/multipart/${route}`, {
      ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${t.token}` },
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(`${route.split('?')[0]} for ${title} failed (${r.status}): ${j.error || 'unknown'}${j.detail ? ` — ${j.detail}` : ''}`)
    return { ...j, owner: t.owner }
  }
  const post = (route, body) => call(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const { uploadId } = await post('create', { key, contentType: type, meta })
  try {
    const blob = await fs.openAsBlob(file, { type })
    const count = Math.ceil(blob.size / PART)
    const parts = []
    for (let n = 1; n <= count; n += 1) {
      const body = blob.slice((n - 1) * PART, Math.min(n * PART, blob.size))
      const route = `part?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}&partNumber=${n}`
      let part = null
      for (let attempt = 1; !part; attempt += 1) {
        try { part = await call(route, { method: 'PUT', body }) } catch (err) {
          if (attempt === 3) throw err
          log(`part ${n} of ${title} failed, trying again: ${err.message}`)
        }
      }
      parts.push({ partNumber: part.partNumber, etag: part.etag })
      log(`sent part ${n} of ${count}: ${title}`)
    }
    const t = await mintToken()
    const done = await post('complete', { key, uploadId, parts, album: m.album, actor, owner: t.owner || undefined })
    if (done.size !== blob.size) throw new Error(`${title}: the proxy stored ${done.size} bytes, the file is ${blob.size}`)
    return done
  } catch (err) {
    await post('abort', { key, uploadId }).catch(() => {})
    throw err
  }
}

async function upload(lesson, order, file) {
  const key = `${m.folder}/${String(order).padStart(2, '0')}-${slugify(lesson.title)}.mp4`
  const done = state.uploads[lesson.lesson_id]
  const digest = sha256(file)
  if (done && done.sha256 === digest) { log(`already uploaded: ${lesson.title}`); return done }
  const t = await mintToken()
  const meta = {
    course: m.slug, course_title: m.title, lesson: lesson.title, lesson_id: lesson.lesson_id, order,
    duration_s: Math.round(duration(file)), sha256: digest,
    source: `${m.source.system}:${m.source.product_id}/${m.source.category_id}/${lesson.lesson_id}`,
  }
  let j
  if (fs.statSync(file).size > CEILING) {
    j = await uploadInParts(key, file, 'video/mp4', meta, lesson.title)
  } else {
    const fd = new FormData()
    fd.append('file', await fs.openAsBlob(file, { type: 'video/mp4' }), path.basename(key))
    fd.append('key', key)
    fd.append('album', m.album)
    fd.append('actor', actor)
    if (t.owner) fd.append('owner', t.owner)
    fd.append('meta', JSON.stringify(meta))
    const r = await fetch(`${t.deliveryBase.replace(/\/+$/, '')}/photos/upload`, { method: 'POST', headers: { Authorization: `Bearer ${t.token}` }, body: fd })
    j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(`upload of ${lesson.title} failed (${r.status}): ${j.error || 'unknown'}`)
  }
  state.uploads[lesson.lesson_id] = { key, url: j.url, sha256: digest, bytes: fs.statSync(file).size, duration_s: meta.duration_s, at: new Date().toISOString() }
  save()
  log(`uploaded ${lesson.title} -> ${j.url}`)
  return state.uploads[lesson.lesson_id]
}

// The World's delivery address can change (cdn.stineoksvolddesign.no -> cdn.sodesign.no,
// 2026-10-16). The key is what was uploaded; the address is read fresh on every run.
let deliveryBase = null
async function currentBase() {
  if (!deliveryBase) deliveryBase = (await mintToken()).deliveryBase.replace(/\/+$/, '')
  return deliveryBase
}
const urlFor = async (u) => `${await currentBase()}/photos/${u.key}`

async function verifyRange(u) {
  const r = await fetch(await urlFor(u), { headers: { Range: 'bytes=0-1' } })
  const ok = r.status === 206 && /^bytes 0-1\/\d+$/.test(r.headers.get('content-range') || '')
  await r.arrayBuffer().catch(() => null)
  if (!ok) throw new Error(`${await urlFor(u)} did not answer a byte range (status ${r.status}, ${r.headers.get('content-range')})`)
  return true
}

// ---- transcribe -------------------------------------------------------------------------------
const stamp = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`
async function transcribe(lesson, file) {
  const digest = state.uploads[lesson.lesson_id] && state.uploads[lesson.lesson_id].sha256
  const have = state.transcripts[lesson.lesson_id]
  if (have && have.video_sha256 === digest && have.prompt_hash === promptHash && Array.isArray(have.raw)) { log(`transcript cached: ${lesson.title}`); return have }
  if (!userId) throw new Error('VEGVISR_USER_ID is not set (needed by the transcription service)')
  const mp3 = path.join(here, 'state', `${m.slug}-${lesson.lesson_id}.mp3`)
  execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k', mp3])
  const fd = new FormData()
  fd.append('file', await fs.openAsBlob(mp3, { type: 'audio/mpeg' }), path.basename(mp3))
  fd.append('model', 'whisper-1')
  fd.append('language', LANGUAGE)
  fd.append('response_format', 'verbose_json')
  if (whisperPrompt) fd.append('prompt', whisperPrompt)
  fd.append('userId', userId)
  const r = await fetch(AUDIO, { method: 'POST', body: fd })
  const j = await r.json().catch(() => ({}))
  fs.unlinkSync(mp3)
  if (!r.ok || typeof j.text !== 'string') throw new Error(`transcription of ${lesson.title} failed (${r.status}): ${j.error || JSON.stringify(j).slice(0, 200)}`)
  const raw = (j.segments || []).map((sg) => ({ start: sg.start, text: sg.text }))
  if (!raw.length) raw.push({ start: 0, text: j.text })
  state.transcripts[lesson.lesson_id] = { video_sha256: digest, prompt_hash: promptHash, model: 'whisper-1', language: LANGUAGE, segments: raw.length, duration_s: Math.round(j.duration || 0), raw, at: new Date().toISOString() }
  save()
  log(`transcribed ${lesson.title}: ${(j.segments || []).length} segments`)
  return state.transcripts[lesson.lesson_id]
}

// Paragraphs of about a minute, each led by its start time, corrections applied.
function transcriptMarkdown(t) {
  const paras = []
  for (const seg of t.raw) {
    const last = paras[paras.length - 1]
    if (!last || seg.start - last.start >= 60) paras.push({ start: seg.start, text: seg.text.trim() })
    else last.text += ` ${seg.text.trim()}`
  }
  return paras.map((p) => `**[${stamp(p.start)}]** ${applyReplacements(p.text)}`).join('\n\n')
}

// ---- language model ---------------------------------------------------------------------------
async function askJson(prompt, maxTokens, what) {
  const r = await fetch(LLM, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Token': token },
    body: JSON.stringify({ userId, model: SUMMARY_MODEL, max_tokens: maxTokens, temperature: 0.2, messages: [{ role: 'user', content: prompt }] }),
  })
  const j = await r.json().catch(() => ({}))
  const raw = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim()
  let data
  try { data = JSON.parse(raw.replace(/^```(json)?|```$/g, '').trim()) } catch { data = null }
  if (!r.ok || !data) throw new Error(`${what} failed (${r.status}): ${j.error || raw.slice(0, 200)}`)
  return data
}

// ---- summarize --------------------------------------------------------------------------------
async function summarize(lesson) {
  const t = state.transcripts[lesson.lesson_id]
  const text = transcriptMarkdown(t)
  const instruction = [
    `Du lager en kort oversikt som står OVER en ${LIBRARY ? 'hjelpevideo' : 'kursvideo'} i «${m.title}» (${m.source.product}), så deltakeren vet hva videoen går gjennom før hun ser den.`,
    `Videoen heter «${lesson.title}». Under er den automatiske transkripsjonen med tidsstempler [mm:ss].`,
    'Svar BARE med JSON, uten forklaring og uten kodeblokk, på formen:',
    '{"intro": "én setning på norsk, du-form, varm og konkret", "points": [{"at": "mm:ss", "text": "kort punkt, maks 12 ord"}], "keywords": ["3-6 stikkord, små bokstaver"], "hashtags": ["3-5 hashtags uten #, små bokstaver, ett ord hver, norsk"]}',
    'Regler: 3-6 punkter i rekkefølgen de kommer i videoen, med tidsstempelet der temaet starter. Bare det som faktisk sies i videoen. Ingen hilsener eller "velkommen".',
    '',
    text,
  ].join('\n')
  const sourceHash = crypto.createHash('sha256').update(`${SUMMARY_MODEL}|${instruction}`).digest('hex').slice(0, 16)
  const have = state.summaries[lesson.lesson_id]
  if (have && have.source_hash === sourceHash) { log(`summary cached: ${lesson.title}`); return have }
  const data = await askJson(instruction, 900, `summary of ${lesson.title}`)
  if (!Array.isArray(data.points)) throw new Error(`summary of ${lesson.title} has no points`)
  // Checked, not trusted: every point starts at a real moment of THIS video, in order, at most 8.
  const secs = (at) => { const mm = /^(\d{1,2}):(\d{2})$/.exec(String(at || '')); return mm ? Number(mm[1]) * 60 + Number(mm[2]) : NaN }
  data.points = data.points.filter((p) => p && p.text && secs(p.at) <= (t.duration_s || Infinity)).sort((a, b) => secs(a.at) - secs(b.at)).slice(0, 8)
  if (data.points.length < 2) throw new Error(`summary of ${lesson.title} has too few valid points`)
  state.summaries[lesson.lesson_id] = { source_hash: sourceHash, model: SUMMARY_MODEL, data, at: new Date().toISOString() }
  save()
  log(`summarized ${lesson.title}: ${data.points.length} points`)
  return state.summaries[lesson.lesson_id]
}

// ---- course: image and «Om kurset» -------------------------------------------------------------
async function uploadFile(key, file, type, meta) {
  const t = await mintToken()
  const fd = new FormData()
  fd.append('file', await fs.openAsBlob(file, { type }), path.basename(key))
  fd.append('key', key)
  fd.append('album', m.album)
  fd.append('actor', actor)
  if (t.owner) fd.append('owner', t.owner)
  fd.append('meta', JSON.stringify(meta))
  const r = await fetch(`${t.deliveryBase.replace(/\/+$/, '')}/photos/upload`, { method: 'POST', headers: { Authorization: `Bearer ${t.token}` }, body: fd })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`upload of ${key} failed (${r.status}): ${j.error || 'unknown'}`)
  return j
}

// The course image: from about 30 % into the first video (past title cards), ffmpeg's thumbnail
// filter picks the most representative of the next 120 frames. A manifest can set imageAt (seconds).
async function courseImage() {
  const first = m.lessons.find((l) => l.type === 'video')
  const video = path.join(m.videoDir, first.file)
  const at = m.imageAt ?? Math.round(duration(video) * 0.3)
  const key = `${m.folder}/kursbilde.jpg`
  const have = state.course.image
  const src = `${state.uploads[first.lesson_id].sha256}@${at}@thumb120`
  if (have && have.src === src) { log('course image cached'); return have }
  const jpg = path.join(here, 'state', `${m.slug}-kursbilde.jpg`)
  execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-ss', String(at), '-i', video, '-vf', 'thumbnail=120,scale=1280:-2', '-frames:v', '1', '-q:v', '3', jpg])
  await uploadFile(key, jpg, 'image/jpeg', { course: m.slug, kind: 'course-image', from_lesson: first.lesson_id, at_s: at })
  fs.unlinkSync(jpg)
  state.course.image = { key, src }
  save()
  log(`course image uploaded: ${key}`)
  return state.course.image
}

// «Om kurset»: one description for the shop, the product page and the course card (plan S2/S5/S6).
async function describeCourse() {
  const lessonsText = m.lessons.map((l, i) => {
    const head = `### ${stepWord} ${i + 1}: ${l.title}`
    if (l.type !== 'video') return `${head}\n${l.info || ''}`
    const t = state.transcripts[l.lesson_id]
    return `${head}\n${t ? transcriptMarkdown(t) : ''}`
  }).join('\n\n')
  const prompt = LIBRARY ? [
    `Du skriver beskrivelsen av «${m.title}» i ${m.source.product} (Stine Oksvold Design): en samling frittstående hjelpevideoer, ikke et kurs. Den brukes på siden og på kortet.`,
    'Under er alle videoene, med automatisk transkripsjon.',
    'Svar BARE med JSON, uten forklaring og uten kodeblokk, på formen:',
    '{"tagline": "én kort setning, maks 10 ord", "about": "2-3 setninger, du-form, varm og konkret: når du trenger disse videoene", "helps_with": ["ett punkt per problem videoene løser, kort"], "for_whom": "hvem samlingen passer for, én setning", "keywords": ["3-6 stikkord, små bokstaver"], "hashtags": ["3-5 hashtags uten #, små bokstaver, ett ord hver"]}',
    'Bare fakta som står i videoene. Ingen priser.',
    '',
    lessonsText,
  ].join('\n') : [
    `Du skriver kursbeskrivelsen for «${m.title}» i ${m.source.product} (Stine Oksvold Design). Den brukes i nettbutikken, på produktsiden og på kurskortet.`,
    'Under er alle stegene i kurset, med automatisk transkripsjon av videoene.',
    'Svar BARE med JSON, uten forklaring og uten kodeblokk, på formen:',
    '{"tagline": "én kort setning, maks 10 ord", "about": "2-3 setninger, du-form, varm og konkret", "you_make": "hva du har strikket når du er ferdig, én setning", "for_whom": "hvem kurset passer for, én setning", "level": "nybegynner | litt erfaren | erfaren", "you_need": ["utstyr og materialer du må ha klart: pinner med nummer og lengde, garn (type og mengde hvis nevnt), nål, saks — bare det som faktisk nevnes, ikke fremgangsmåte eller antall masker"], "keywords": ["3-6 stikkord, små bokstaver"], "hashtags": ["3-5 hashtags uten #, små bokstaver, ett ord hver"]}',
    'Bare fakta som står i stegene. Ingen priser.',
    '',
    lessonsText,
  ].join('\n')
  // Keyed on the whole prompt: a changed instruction or transcript writes it again, nothing else does.
  const hash = crypto.createHash('sha256').update(`${SUMMARY_MODEL}|${prompt}`).digest('hex').slice(0, 16)
  if (state.course.about && state.course.about.hash === hash) { log('course description cached'); return state.course.about }
  const data = await askJson(prompt, 1200, 'course description')
  if (!data.about || !Array.isArray(LIBRARY ? data.helps_with : data.you_need)) throw new Error(`course description is missing about or ${LIBRARY ? 'helps_with' : 'you_need'}`)
  state.course.about = { hash, data, model: SUMMARY_MODEL, at: new Date().toISOString() }
  save()
  log('course description written')
  return state.course.about
}

// PDFs (the recipe): looked up next to the originals (<videoDir>/..), uploaded once per checksum.
// A lesson has one `pdf`; further files of the same lesson go in `extraPdfs: [{ file, label }]` and are
// kept in the state under `<lesson id>:<file>`.
async function uploadPdf(lesson, name = lesson.pdf, stateKey = lesson.lesson_id) {
  const file = path.join(path.dirname(m.videoDir), name)
  if (!fs.existsSync(file)) { log(`PDF not downloaded yet: ${name}`); return null }
  const digest = sha256(file)
  const have = state.files[stateKey]
  if (have && have.sha256 === digest) { log(`PDF already uploaded: ${name}`); return have }
  const key = `${m.folder}/${slugify(name.replace(/\.pdf$/i, ''))}.pdf`
  await uploadFile(key, file, 'application/pdf', { course: m.slug, kind: 'pdf', lesson: lesson.title, lesson_id: lesson.lesson_id, sha256: digest, source: `${m.source.system}:${m.source.product_id}/${m.source.category_id}/${lesson.lesson_id}` })
  state.files[stateKey] = { key, sha256: digest, bytes: fs.statSync(file).size, name }
  save()
  log(`PDF uploaded: ${key}`)
  return state.files[stateKey]
}

const minutes = (s) => Math.max(1, Math.round(s / 60))
function aboutMarkdown(d, steps, totalS) {
  const tag = (h) => `#${String(h).replace(/^#/, '').replace(/\s+/g, '').toLowerCase()}`
  if (LIBRARY) return [
    `**${d.tagline}**`,
    '',
    d.about,
    '',
    '**Hjelp når**',
    ...d.helps_with.map((x) => `- ${x}`),
    '',
    `**Passer for:** ${d.for_whom}`,
    '',
    `**${steps.length} videoer** · **ca. ${minutes(totalS)} min**`,
    '',
    '**Videoene**',
    ...steps.map((st, i) => `${i + 1}. ${st.title}${st.duration_s ? ` (${minutes(st.duration_s)} min)` : ''}`),
    '',
    `**Stikkord:** ${(d.keywords || []).join(' · ')}`,
    '',
    (d.hashtags || []).map(tag).join(' '),
  ].join('\n')
  return [
    `**${d.tagline}**`,
    '',
    d.about,
    '',
    `**Du strikker:** ${d.you_make}`,
    '',
    `**Passer for:** ${d.for_whom}`,
    '',
    `**Nivå:** ${d.level} · **${steps.length} steg** · **ca. ${minutes(totalS)} min video**`,
    '',
    '**Dette trenger du**',
    ...d.you_need.map((x) => `- ${x}`),
    '',
    '**Stegene**',
    ...steps.map((st, i) => `${i + 1}. ${st.title}${st.duration_s ? ` (${minutes(st.duration_s)} min)` : ''}`),
    '',
    `**Stikkord:** ${(d.keywords || []).join(' · ')}`,
    '',
    (d.hashtags || []).map(tag).join(' '),
  ].join('\n')
}

// One layout for every lesson: the sentence, the points with their start time, keywords, hashtags.
function summaryMarkdown(d) {
  const tag = (h) => `#${String(h).replace(/^#/, '').replace(/\s+/g, '').toLowerCase()}`
  return [
    d.intro,
    '',
    '**I denne videoen**',
    ...d.points.map((p) => `- **${p.at}** – ${p.text}`),
    '',
    `**Stikkord:** ${(d.keywords || []).join(' · ')}`,
    '',
    (d.hashtags || []).map(tag).join(' '),
  ].join('\n')
}

// ---- graph ------------------------------------------------------------------------------------
async function saveGraph() {
  const id = state.graphId || crypto.randomUUID()
  const urls = {}
  for (const [lid, u] of Object.entries(state.uploads)) urls[lid] = await urlFor(u)
  const pdfUrls = {}
  for (const [lid, f] of Object.entries(state.files)) pdfUrls[lid] = await urlFor(f)
  // Product template (the same shape as The BOLD vest): produkt node with metadata.product, the
  // course image, «Om kurset», then the steps.
  const total = m.lessons.length
  const steps = m.lessons.map((l) => ({ title: l.title, duration_s: l.type === 'video' && state.uploads[l.lesson_id] ? state.uploads[l.lesson_id].duration_s : 0 }))
  const totalS = steps.reduce((a, st) => a + st.duration_s, 0)
  const about = state.course.about && state.course.about.data
  const image = state.course.image
  const imageUrl = image ? await urlFor(image) : null
  const p = m.product || {}
  const product = {
    kind: p.kind || 'course', slug: m.slug, status: p.status || 'draft',
    access: p.access || null, prices: p.prices || [], category: p.category || [], level: (about && about.level) || p.level || null,
    lessons: total, videos: m.lessons.filter((l) => l.type === 'video').length, duration_s: totalS,
    image: image ? image.key : null,
    grants: [{ type: 'course', ref: m.slug }, ...Object.values(state.files).map((f) => ({ type: 'file', ref: f.key }))],
    folder: m.folder, album: m.album, source: m.source,
  }
  const accessText = product.access && product.access.type === 'membership' ? 'Inkludert i medlemskapet Den lille strikkeskolen' : (product.prices[0] ? `${product.prices[0].amount} kr` : '')
  const nodes = [{
    id: 'produkt', label: 'Produkt', type: 'fulltext', visible: true, bibl: [], position: { x: 0, y: 0 },
    info: `**${LIBRARY ? `Videosamling · ${total} videoer` : `Kurs · ${total} steg`} · ca. ${minutes(totalS)} min video**${accessText ? `\n\n${accessText}` : ''}\n\nStatus: ${product.status}. Dette er produktnoden: metadata.product styrer tilgang, kort og nettbutikk.`,
    metadata: { product },
  }]
  const edges = []
  let prev = 'produkt'
  if (imageUrl) {
    // path is what the catalogue card reads; info carries the same image so the viewer shows it.
    nodes.push({ id: 'kursbilde', label: m.title, type: 'portfolio-image', path: imageUrl, info: `![${m.title}](${imageUrl})`, visible: true, bibl: [], position: { x: 0, y: 60 }, metadata: { image: { key: image.key, kind: 'course-image' } } })
    edges.push({ source: prev, target: 'kursbilde', type: 'next', label: 'next' }); prev = 'kursbilde'
  }
  if (about) {
    nodes.push({ id: 'om-kurset', label: LIBRARY ? `Om ${m.title}` : 'Om kurset', type: LIBRARY ? 'fulltext' : 'kursbeskrivelse', visible: true, bibl: [], position: { x: 0, y: 90 }, info: aboutMarkdown(about, steps, totalS), metadata: { about: { ...about, source: 'automatic' } } })
    edges.push({ source: prev, target: 'om-kurset', type: 'next', label: 'next' }); prev = 'om-kurset'
  }
  // A course's steps are kurs-steg nodes and its description a kursbeskrivelse node (registered
  // platform types, 2026-11-16; the same as worker/world-course.js makes). A video collection
  // (LIBRARY) is not a course and keeps the plain types.
  const STEP_TYPE = LIBRARY ? null : 'kurs-steg'
  m.lessons.forEach((lesson, i) => {
    const order = i + 1
    const nid = `l${String(order).padStart(2, '0')}-${slugify(lesson.title)}`
    const stepLabel = `${stepWord} ${order} av ${total} – ${lesson.title}`
    const base = { id: nid, label: stepLabel, visible: true, bibl: [], position: { x: 0, y: order * 120 } }
    const lessonMeta = { lesson_id: lesson.lesson_id, order, type: lesson.type }
    if (lesson.type === 'video') {
      const u = state.uploads[lesson.lesson_id]
      const sm = state.summaries[lesson.lesson_id]
      if (sm) {
        const sid = `${nid}-oppsummering`
        nodes.push({
          id: sid, label: `Om ${stepWord.toLowerCase()} ${order}: ${lesson.title}`, type: 'fulltext', visible: true, bibl: [], position: { x: -300, y: order * 120 },
          info: summaryMarkdown(sm.data),
          metadata: { summary: { lesson_id: lesson.lesson_id, of: nid, model: sm.model, keywords: sm.data.keywords || [], hashtags: sm.data.hashtags || [], source: 'automatic' } },
        })
        edges.push({ source: prev, target: sid, type: 'next', label: 'next' })
        prev = sid
      }
      nodes.push({ ...base, type: STEP_TYPE || 'realtime-video', path: urls[lesson.lesson_id], info: '', metadata: { lesson: { ...lessonMeta, key: u.key, sha256: u.sha256, bytes: u.bytes, duration_s: u.duration_s } } })
      const t = state.transcripts[lesson.lesson_id]
      if (t) {
        const tid = `${nid}-transkripsjon`
        nodes.push({
          id: tid, label: `Transkripsjon – ${stepWord.toLowerCase()} ${order}: ${lesson.title}`, type: 'fulltext', visible: true, bibl: [], position: { x: 300, y: order * 120 },
          info: `_Automatisk transkribert (Whisper). Kan inneholde feil._\n\n${transcriptMarkdown(t)}`,
          metadata: { transcript: { lesson_id: lesson.lesson_id, of: nid, model: t.model, language: t.language, segments: t.segments, duration_s: t.duration_s, source: 'automatic', glossary: m.glossary || null, prompt_hash: t.prompt_hash, replacements: Object.keys(glossary.replacements || {}).length } },
        })
        edges.push({ source: prev, target: nid, type: 'next', label: 'next' })
        edges.push({ source: nid, target: tid, type: 'next', label: 'next' })
        prev = tid
        return
      }
    } else {
      const f = state.files[lesson.lesson_id]
      const pdfNote = f ? `\n\n**[${lesson.pdfLabel || 'Last ned oppskriften (PDF)'}](${pdfUrls[lesson.lesson_id]})**` : (lesson.pdf ? `\n\n_PDF: ${lesson.pdf} — ikke lastet opp ennå._` : '')
      const extras = (lesson.extraPdfs || []).map((x) => ({ x, f: state.files[`${lesson.lesson_id}:${x.file}`], url: pdfUrls[`${lesson.lesson_id}:${x.file}`] })).filter((e) => e.f)
      const extraNote = extras.map((e) => `\n\n**[${e.x.label || e.f.name}](${e.url})**`).join('')
      const extraMeta = extras.length ? { extraPdfs: extras.map((e) => ({ key: e.f.key, sha256: e.f.sha256, bytes: e.f.bytes, name: e.f.name, label: e.x.label || null })) } : {}
      nodes.push({ ...base, type: STEP_TYPE || 'fulltext', info: `${lesson.info || ''}${pdfNote}${extraNote}`, metadata: { lesson: { ...lessonMeta, pdf: f ? { key: f.key, sha256: f.sha256, bytes: f.bytes, name: f.name } : (lesson.pdf || null), ...extraMeta } } })
    }
    edges.push({ source: prev, target: nid, type: 'next', label: 'next' })
    prev = nid
  })
  // A course that already has a graph is updated node by node (architect decision 2026-11-18):
  // only the nodes whose generated content changed are written, and a node somebody has edited
  // since this routine last wrote it is left alone and reported. Nothing else in the graph —
  // other nodes, edges, order — is touched.
  if (state.graphId) return updateGraph(id, nodes)
  const body = {
    id, override: false, world: m.world,
    graphData: { metadata: { title: m.title, description: (about && about.tagline) || `${LIBRARY ? 'Hjelpevideoer' : 'Kurs'} i ${m.source.product} (${m.source.module}).`, metaArea: m.metaArea, createdBy: actor, version: 0 }, nodes, edges },
  }
  if (DRY) { log(`dry run: would create the course graph with ${nodes.length} nodes`); return id }
  const r = await fetch(`${KG}/saveGraphWithHistory`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Token': token }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`saving the course graph failed (${r.status}): ${j.error || JSON.stringify(j).slice(0, 200)}`)
  state.graphId = id
  state.written = Object.fromEntries(nodes.map((n) => [n.id, fingerprint(n, n)]))
  save()
  log(`course graph ${id} saved (version ${j.newVersion}) in ${m.world}`)
  return id
}

// What this routine owns in a node: label, type, info, path and the metadata keys it writes.
// Keys somebody else added to metadata are not compared and are kept on a write.
const canonical = (v) => Array.isArray(v) ? v.map(canonical)
  : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, canonical(v[k])])) : v
// transcript.replacements only counts the entries in the word file; a new entry is not a change
// to the node, so it is left out of the comparison.
function owned(node, generated) {
  const meta = {}
  for (const k of Object.keys(generated.metadata || {})) meta[k] = (node.metadata || {})[k] ?? null
  if (meta.transcript) { meta.transcript = { ...meta.transcript }; delete meta.transcript.replacements }
  return { label: node.label || '', type: node.type || '', info: node.info || '', path: node.path || null, ...Object.fromEntries(Object.entries(meta).map(([k, v]) => [`metadata.${k}`, v])) }
}
function fingerprint(node, generated) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(owned(node, generated)))).digest('hex')
}
// Which of the owned fields differ between the node as it stands and the node as generated.
function differing(node, generated) {
  const a = owned(node, generated); const b = owned(generated, generated)
  return Object.keys(b).filter((k) => JSON.stringify(canonical(a[k])) !== JSON.stringify(canonical(b[k])))
}

async function updateGraph(id, nodes) {
  const r = await fetch(`${KG}/getknowgraph?id=${id}`, { headers: { 'X-API-Token': token } })
  const live = await r.json().catch(() => ({}))
  if (!r.ok || !Array.isArray(live.nodes)) throw new Error(`reading the course graph ${id} failed (${r.status}): ${live.error || 'no nodes'}`)
  let version = Number((live.metadata && live.metadata.version) || 0)
  const byId = new Map(live.nodes.map((n) => [n.id, n]))
  state.written = state.written || {}
  // A graph at version 1 has been saved once, by this routine: every node is as it wrote it.
  const untouched = version === 1
  const out = { unchanged: [], updated: [], edited: [], unknown: [], missing: [] }
  const why = {}
  for (const g of nodes) {
    const l = byId.get(g.id)
    if (!l) { out.missing.push(g.id); continue }
    const want = fingerprint(g, g)
    const have = fingerprint(l, g)
    if (have === want) { state.written[g.id] = want; out.unchanged.push(g.id); continue }
    // --adopt: take the node as it stands now as this routine's own. Used once for the courses
    // built before the routine kept a record, after their history is checked.
    why[g.id] = differing(l, g).join(', ')
    if ((ADOPT || untouched) && !state.written[g.id]) state.written[g.id] = have
    if (!state.written[g.id]) { out.unknown.push(g.id); continue }
    if (state.written[g.id] !== have) { out.edited.push(g.id); continue }
    if (DRY) { out.updated.push(g.id); continue }
    const fields = { label: g.label, type: g.type, info: g.info, metadata: { ...(l.metadata || {}), ...(g.metadata || {}) } }
    if (g.path !== undefined) fields.path = g.path
    const pr = await fetch(`${KG}/patchNode`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Token': token }, body: JSON.stringify({ graphId: id, nodeId: g.id, fields, expectedVersion: version }) })
    const pj = await pr.json().catch(() => ({}))
    if (!pr.ok) { save(); throw new Error(`updating node ${g.id} failed (${pr.status}): ${pj.error || JSON.stringify(pj).slice(0, 200)}`) }
    version = pj.newVersion
    state.written[g.id] = want
    save()
    out.updated.push(g.id)
  }
  if (!DRY) save()
  log(`course graph ${id}${DRY ? ' (dry run, nothing written)' : ''}: ${out.updated.length} ${DRY ? 'would be updated' : 'updated'}, ${out.unchanged.length} unchanged, version ${version}`)
  for (const n of out.updated) log(`  ${DRY ? 'would update' : 'updated'}: ${n} (${why[n]})`)
  for (const n of out.edited) log(`  LEFT ALONE, edited by hand since the routine wrote it: ${n} (${why[n]})`)
  for (const n of out.unknown) log(`  LEFT ALONE, differs and the routine has no record of what it wrote: ${n} (${why[n]})`)
  for (const n of out.missing) log(`  NOT ADDED, the graph has no such node: ${n}`)
  return id
}

// The album belongs to the World's founder (it shows under her «Mine album»); the audit log keeps
// who ran the migration. Set on every run, so an album created earlier under the runner moves too.
async function ensureAlbumOwner() {
  const t = await mintToken()
  if (!t.owner) { log('token carries no owner; album owner left as is'); return }
  const r = await fetch(`${t.deliveryBase.replace(/\/+$/, '')}/albums/${encodeURIComponent(m.album)}`, {
    method: 'POST', headers: { Authorization: `Bearer ${t.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner: t.owner, actor }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.createdBy !== t.owner) throw new Error(`could not set the owner of album «${m.album}» (${r.status}): ${j.error || j.createdBy}`)
  log(`album «${m.album}» owned by ${t.owner}, ${(j.images || []).length} files`)
}

// ---- run --------------------------------------------------------------------------------------
let order = 0
for (const lesson of m.lessons) {
  order += 1
  if (lesson.type !== 'video') continue
  const file = ensureCompressed(lesson, await proxyTakesParts())
  const u = await upload(lesson, order, file)
  await verifyRange(u)
  log(`range ok: ${lesson.title}`)
  await transcribe(lesson, file)
  await summarize(lesson)
}
for (const lesson of m.lessons) {
  if (lesson.pdf) await uploadPdf(lesson)
  for (const x of lesson.extraPdfs || []) await uploadPdf(lesson, x.file, `${lesson.lesson_id}:${x.file}`)
}
await courseImage()
await describeCourse()
await ensureAlbumOwner()
const graphId = await saveGraph()
console.log(JSON.stringify({ course: m.slug, world: m.world, graphId, editor: `https://editor.${m.world}/?graphId=${graphId}`, videos: await Promise.all(Object.values(state.uploads).map(urlFor)) }, null, 2))
