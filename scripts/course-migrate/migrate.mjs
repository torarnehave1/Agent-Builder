#!/usr/bin/env node
// Course migration routine (2026-10-16): one course from Kajabi into a World, from a manifest.
//
//   compress  originals in <videoDir>/.. -> <videoDir> (H.264, faststart), CRF 20 -> 23 -> 26
//             until the file is under the 95 MB upload ceiling; skipped when already there
//   upload    each video into the World's own R2 under <folder>/<NN>-<slug>.mp4, in <album>,
//             with lesson metadata on the object, using a 5-minute token scoped to that World
//   verify    each uploaded video answers a byte range (206) — iPhone playback depends on it
//   graph     the course graph in the World: a course node, the text lessons, one realtime-video
//             node per video lesson in order, `next` edges; re-runs overwrite the same graph
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
const LADDER = [20, 23, 26]

const here = path.dirname(fileURLToPath(import.meta.url))
const manifestPath = process.argv[2]
if (!manifestPath) { console.error('usage: node migrate.mjs <manifest.json>'); process.exit(2) }
const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const token = process.env.VEGVISR_TOKEN
if (!token) { console.error('VEGVISR_TOKEN is not set'); process.exit(2) }
const actor = process.env.VEGVISR_EMAIL || 'torarnehave@gmail.com'

fs.mkdirSync(path.join(here, 'state'), { recursive: true })
const statePath = path.join(here, 'state', `${m.slug}.json`)
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { uploads: {}, graphId: null }
const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2))
const log = (...a) => console.log(`[${m.slug}]`, ...a)

const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const duration = (p) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]).toString().trim())

// ---- compress ---------------------------------------------------------------------------------
function ensureCompressed(lesson) {
  const out = path.join(m.videoDir, lesson.file)
  if (fs.existsSync(out) && fs.statSync(out).size <= CEILING) return out
  const original = path.join(path.dirname(m.videoDir), lesson.file)
  if (!fs.existsSync(original)) throw new Error(`no original for ${lesson.title}: ${original} (download it from Kajabi first)`)
  fs.mkdirSync(m.videoDir, { recursive: true })
  for (const crf of LADDER) {
    const tmp = `${out}.tmp.mp4`
    execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-i', original, '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', tmp])
    const size = fs.statSync(tmp).size
    log(`compressed ${lesson.title} at CRF ${crf}: ${(size / 1e6).toFixed(1)} MB`)
    if (size <= CEILING || crf === LADDER[LADDER.length - 1]) {
      fs.renameSync(tmp, out)
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
  const fd = new FormData()
  fd.append('file', await fs.openAsBlob(file, { type: 'video/mp4' }), path.basename(key))
  fd.append('key', key)
  fd.append('album', m.album)
  fd.append('actor', actor)
  fd.append('meta', JSON.stringify(meta))
  const r = await fetch(`${t.deliveryBase.replace(/\/+$/, '')}/photos/upload`, { method: 'POST', headers: { Authorization: `Bearer ${t.token}` }, body: fd })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`upload of ${lesson.title} failed (${r.status}): ${j.error || 'unknown'}`)
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

// ---- graph ------------------------------------------------------------------------------------
async function saveGraph() {
  const id = state.graphId || crypto.randomUUID()
  const urls = {}
  for (const [lid, u] of Object.entries(state.uploads)) urls[lid] = await urlFor(u)
  const nodes = [{
    id: 'kurs', label: m.title, type: 'fulltext', visible: true, bibl: [], position: { x: 0, y: 0 },
    info: `**${m.title}**\n\n${m.lessons.length} leksjoner · ${m.source.module}`,
    metadata: { course: { slug: m.slug, folder: m.folder, album: m.album, lessons: m.lessons.length, source: m.source } },
  }]
  const edges = []
  let prev = 'kurs'
  m.lessons.forEach((lesson, i) => {
    const order = i + 1
    const nid = `l${String(order).padStart(2, '0')}-${slugify(lesson.title)}`
    const base = { id: nid, label: lesson.title, visible: true, bibl: [], position: { x: 0, y: order * 120 } }
    const lessonMeta = { lesson_id: lesson.lesson_id, order, type: lesson.type }
    if (lesson.type === 'video') {
      const u = state.uploads[lesson.lesson_id]
      nodes.push({ ...base, type: 'realtime-video', path: urls[lesson.lesson_id], info: '', metadata: { lesson: { ...lessonMeta, key: u.key, sha256: u.sha256, bytes: u.bytes, duration_s: u.duration_s } } })
    } else {
      const pdfNote = lesson.pdf ? `\n\n_PDF: ${lesson.pdf} — ikke lastet opp ennå._` : ''
      nodes.push({ ...base, type: 'fulltext', info: `${lesson.info || ''}${pdfNote}`, metadata: { lesson: { ...lessonMeta, pdf: lesson.pdf || null } } })
    }
    edges.push({ source: prev, target: nid, type: 'next', label: 'next' })
    prev = nid
  })
  const body = {
    id, override: !!state.graphId, world: m.world,
    graphData: { metadata: { title: m.title, description: `Kurs i ${m.source.product} (${m.source.module}), migrert fra Kajabi.`, metaArea: m.metaArea, createdBy: actor, version: 0 }, nodes, edges },
  }
  const r = await fetch(`${KG}/saveGraphWithHistory`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Token': token }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`saving the course graph failed (${r.status}): ${j.error || JSON.stringify(j).slice(0, 200)}`)
  state.graphId = id
  save()
  log(`course graph ${id} saved (version ${j.newVersion}) in ${m.world}`)
  return id
}

// ---- run --------------------------------------------------------------------------------------
let order = 0
for (const lesson of m.lessons) {
  order += 1
  if (lesson.type !== 'video') continue
  const file = ensureCompressed(lesson)
  const u = await upload(lesson, order, file)
  await verifyRange(u)
  log(`range ok: ${lesson.title}`)
}
const graphId = await saveGraph()
console.log(JSON.stringify({ course: m.slug, world: m.world, graphId, editor: `https://editor.${m.world}/?graphId=${graphId}`, videos: await Promise.all(Object.values(state.uploads).map(urlFor)) }, null, 2))
