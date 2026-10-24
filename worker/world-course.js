// World course builder (2026-10-24): create and change a course in a World — the write side of the
// course template that /world-customer/* reads (Min side) and scripts/course-migrate builds from
// Kajabi. One set of rules for every way in: the Agent-Builder tools (create_world_course, …), the
// HTTP routes under /world-course/* that a World's course-builder page calls, and later MCP.
//
// The template (the same shape as «Enkel hals strikkekurs», graph 27d21ff6):
//   produkt          fulltext, metadata.product {kind, slug, status, access, lessons, videos, duration_s, …}
//   kursbilde        portfolio-image, path = the card image
//   om-kurset        fulltext, metadata.about {tagline, about, you_make, for_whom, level, you_need, …}
//   <lesson>         per step: metadata.lesson {order, type: video|text, title, key, duration_s, pdf}
//                    video = realtime-video with path; text = fulltext with info
//   <lesson>-oppsummering / <lesson>-transkripsjon   joined to the step BY ID (Min side reads them so)
//
// Rules this module owns so nobody else has to:
//   - a lesson's node id never changes after it is made — customers' progress rows point at it
//   - order, «Steg N av M» labels, product counts, positions and the `next` chain are recomputed
//     on every change (renumber), never typed by hand
//   - text a person wrote is never regenerated: only the counts line and the step list in «Om kurset»
//     and the first line and status line of «Produkt» are rewritten
//   - every save is optimistic: metadata.version must match, a concurrent edit is refused (409)
//   - files are never deleted; a hidden step keeps its video, a replaced file is a new key
//
// Who may: the World's founder or account holder, a Superadmin, or a system owner — the same rule
// as /world-photos/token. The KG worker checks again as the acting user.

export const COURSE_META_AREA = '#KURS'
const AUDIO = 'https://openai.vegvisr.org/audio'
const LLM = 'https://anthropic.vegvisr.org/chat'
const SUMMARY_MODEL = 'claude-sonnet-5-5'
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024
const AUDIO_MAX_BYTES = 24 * 1024 * 1024

// ---- small helpers -----------------------------------------------------------------------------
export function slugify(s) {
  return String(s || '').toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'kurs'
}
const minutes = (s) => Math.max(1, Math.round((s || 0) / 60))
const byId = (g, id) => (g.nodes || []).find((n) => n.id === id)
const lessonNodes = (g) => (g.nodes || []).filter((n) => n.metadata && n.metadata.lesson)
const stripStep = (label) => String(label || '').replace(/^Steg \d+ av \d+ – /, '').replace(/^Skjult – /, '')
const lessonTitle = (n) => (n.metadata.lesson.title || stripStep(n.label)).trim()
const isHidden = (n) => n.visible === false
const clone = (x) => JSON.parse(JSON.stringify(x))
const uuid = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)))
const tag = (h) => `#${String(h).replace(/^#/, '').replace(/\s+/g, '').toLowerCase()}`
const fail = (status, error) => ({ status, body: { success: false, error } })
const ok = (body) => ({ status: 200, body: { success: true, ...body } })

export function isCourseGraph(g) {
  const p = byId(g, 'produkt')
  return Boolean(p && p.metadata && p.metadata.product && (p.metadata.product.kind || 'course') === 'course')
}

// ---- reading -----------------------------------------------------------------------------------
// What a builder needs to see: every step in order with what is there and what is missing.
export function courseView(graphId, g) {
  const product = (byId(g, 'produkt') || {}).metadata?.product || {}
  const aboutNode = byId(g, 'om-kurset')
  const img = byId(g, 'kursbilde')
  const lessons = lessonNodes(g)
    .sort((a, b) => a.metadata.lesson.order - b.metadata.lesson.order)
    .map((n) => {
      const l = n.metadata.lesson
      const summary = byId(g, `${n.id}-oppsummering`)
      const transcript = byId(g, `${n.id}-transkripsjon`)
      return {
        id: n.id,
        order: l.order,
        title: lessonTitle(n),
        type: l.type,
        visible: !isHidden(n),
        video: l.type === 'video' ? (n.path || null) : null,
        key: l.key || null,
        duration_s: l.duration_s || 0,
        text: l.type === 'video' ? '' : stripPdfLine(n.info || ''),
        pdf: l.pdf && typeof l.pdf === 'object' ? l.pdf : null,
        summary: summary ? summary.info || '' : '',
        transcript: transcript ? transcript.info || '' : '',
        missing: l.type === 'video'
          ? [!n.path && 'video', !transcript && 'transkripsjon', !summary && 'oppsummering'].filter(Boolean)
          : [!(n.info || '').trim() && 'tekst'].filter(Boolean),
      }
    })
  return {
    graphId,
    title: g.metadata?.title || '',
    description: g.metadata?.description || '',
    version: Number(g.metadata?.version || 0),
    status: product.status || 'draft',
    slug: product.slug || null,
    folder: product.folder || null,
    album: product.album || null,
    level: product.level || null,
    access: product.access || null,
    lessonsCount: product.lessons || 0,
    duration_s: product.duration_s || 0,
    image: img ? img.path || null : null,
    about: aboutNode?.metadata?.about || null,
    aboutText: aboutNode ? aboutNode.info || '' : '',
    lessons,
  }
}

function stripPdfLine(info) {
  return String(info).replace(/\n*\*\*\[Last ned [^\]]*\]\([^)]*\)\*\*\s*$/, '').trim()
}

// ---- building ----------------------------------------------------------------------------------
export function aboutMarkdown(d, steps, totalS) {
  const lines = []
  if (d.tagline) lines.push(`**${d.tagline}**`, '')
  if (d.about) lines.push(d.about, '')
  if (d.you_make) lines.push(`**Du lager:** ${d.you_make}`, '')
  if (d.for_whom) lines.push(`**Passer for:** ${d.for_whom}`, '')
  lines.push(countsLine(d.level, steps.length, totalS), '')
  if (Array.isArray(d.you_need) && d.you_need.length) lines.push('**Dette trenger du**', ...d.you_need.map((x) => `- ${x}`), '')
  lines.push('**Stegene**', ...stepList(steps))
  if (Array.isArray(d.keywords) && d.keywords.length) lines.push('', `**Stikkord:** ${d.keywords.join(' · ')}`)
  if (Array.isArray(d.hashtags) && d.hashtags.length) lines.push('', d.hashtags.map(tag).join(' '))
  return lines.join('\n')
}
const countsLine = (level, n, totalS) => `**Nivå:** ${level || '–'} · **${n} steg**${totalS ? ` · **ca. ${minutes(totalS)} min video**` : ''}`
const stepList = (steps) => steps.length ? steps.map((st, i) => `${i + 1}. ${st.title}${st.duration_s ? ` (${minutes(st.duration_s)} min)` : ''}`) : ['_Ingen steg ennå._']

export function newCourseGraph(input, { createdBy, world }) {
  const title = String(input.title || '').trim()
  const slug = slugify(input.slug || title)
  const folder = input.folder || `kurs/${slug}`
  const about = {
    tagline: input.tagline || '',
    about: input.about || '',
    you_make: input.you_make || '',
    for_whom: input.for_whom || '',
    level: input.level || '',
    you_need: Array.isArray(input.you_need) ? input.you_need : [],
    keywords: Array.isArray(input.keywords) ? input.keywords : [],
    hashtags: Array.isArray(input.hashtags) ? input.hashtags : [],
    source: 'builder',
  }
  const product = {
    kind: 'course', slug, status: 'draft',
    access: input.access || null,
    prices: Array.isArray(input.prices) ? input.prices : [],
    category: Array.isArray(input.category) ? input.category : [],
    level: input.level || null,
    lessons: 0, videos: 0, duration_s: 0,
    image: input.image_key || null,
    grants: [{ type: 'course', ref: slug }],
    folder, album: input.album || title,
    ...(input.glossary ? { glossary: input.glossary } : {}),
    source: { system: 'builder', world, created_by: createdBy },
  }
  const nodes = [{
    id: 'produkt', label: 'Produkt', type: 'fulltext', visible: true, bibl: [], position: { x: 0, y: 0 },
    info: '', metadata: { product },
  }]
  if (input.image_url) {
    nodes.push({ id: 'kursbilde', label: title, type: 'portfolio-image', path: input.image_url, info: `![${title}](${input.image_url})`, visible: true, bibl: [], position: { x: 0, y: 60 }, metadata: { image: { key: input.image_key || null, kind: 'course-image' } } })
  }
  nodes.push({ id: 'om-kurset', label: 'Om kurset', type: 'fulltext', visible: true, bibl: [], position: { x: 0, y: 90 }, info: aboutMarkdown(about, [], 0), metadata: { about } })
  const metaArea = [COURSE_META_AREA, ...(String(input.metaArea || '').split(/\s+/).filter(Boolean))]
  const g = {
    metadata: {
      title,
      description: input.tagline || input.description || '',
      metaArea: [...new Set(metaArea)].join(' '),
      createdBy, version: 0,
    },
    nodes, edges: [],
  }
  return renumber(g)
}

// Everything derived is recomputed here: order, labels, counts, positions, the `next` chain, and
// the two generated lines in «Produkt» and «Om kurset». Hand-written text is left alone.
export function renumber(g) {
  const all = lessonNodes(g).sort((a, b) => a.metadata.lesson.order - b.metadata.lesson.order)
  const visible = all.filter((n) => !isHidden(n))
  const hidden = all.filter(isHidden)
  const M = visible.length
  ;[...visible, ...hidden].forEach((n, i) => {
    const order = i + 1
    const title = lessonTitle(n)
    n.metadata.lesson.order = order
    n.metadata.lesson.title = title
    n.label = isHidden(n) ? `Skjult – ${title}` : `Steg ${order} av ${M} – ${title}`
    n.position = { x: 0, y: 120 + order * 120 }
    const s = byId(g, `${n.id}-oppsummering`)
    if (s) { s.label = `Om steg ${order}: ${title}`; s.position = { x: -300, y: 120 + order * 120 }; s.visible = !isHidden(n) }
    const t = byId(g, `${n.id}-transkripsjon`)
    if (t) { t.label = `Transkripsjon – steg ${order}: ${title}`; t.position = { x: 300, y: 120 + order * 120 }; t.visible = !isHidden(n) }
  })
  const totalS = visible.reduce((a, n) => a + (n.metadata.lesson.type === 'video' ? Number(n.metadata.lesson.duration_s || 0) : 0), 0)
  const prodNode = byId(g, 'produkt')
  if (prodNode) {
    const p = prodNode.metadata.product
    p.lessons = M
    p.videos = visible.filter((n) => n.metadata.lesson.type === 'video').length
    p.duration_s = totalS
    const pdfs = visible.map((n) => n.metadata.lesson.pdf).filter((x) => x && x.key).map((x) => ({ type: 'file', ref: x.key }))
    p.grants = [{ type: 'course', ref: p.slug }, ...pdfs]
    const head = `**Kurs · ${M} steg${totalS ? ` · ca. ${minutes(totalS)} min video` : ''}**`
    const statusLine = `Status: ${p.status}. Dette er produktnoden: metadata.product styrer tilgang, kort og nettbutikk.`
    let info = String(prodNode.info || '')
    info = /^\*\*Kurs · [^\n]*\*\*/.test(info) ? info.replace(/^\*\*Kurs · [^\n]*\*\*/, head) : `${head}${info ? `\n\n${info}` : ''}`
    info = /Status: [^\n]*/.test(info) ? info.replace(/Status: [^\n]*/, statusLine) : `${info}\n\n${statusLine}`
    prodNode.info = info
  }
  const about = byId(g, 'om-kurset')
  if (about) {
    const level = about.metadata?.about?.level || prodNode?.metadata?.product?.level || ''
    const steps = visible.map((n) => ({ title: lessonTitle(n), duration_s: n.metadata.lesson.type === 'video' ? n.metadata.lesson.duration_s : 0 }))
    let info = String(about.info || '')
    const counts = countsLine(level, M, totalS)
    info = /\*\*Nivå:\*\*[^\n]*/.test(info) ? info.replace(/\*\*Nivå:\*\*[^\n]*/, counts) : `${info}\n\n${counts}`
    const list = stepList(steps).join('\n')
    info = /\*\*Stegene\*\*\n(?:(?:\d+\. [^\n]*|_Ingen steg ennå\._)\n?)*/.test(info)
      ? info.replace(/\*\*Stegene\*\*\n(?:(?:\d+\. [^\n]*|_Ingen steg ennå\._)\n?)*/, `**Stegene**\n${list}\n`)
      : `${info}\n\n**Stegene**\n${list}`
    about.info = info.replace(/\n{3,}/g, '\n\n').trim()
  }
  // The `next` chain over the template's nodes; any other edge (a person's own) is kept.
  const ids = new Set(['produkt', 'kursbilde', 'om-kurset', ...all.flatMap((n) => [n.id, `${n.id}-oppsummering`, `${n.id}-transkripsjon`])])
  const kept = (g.edges || []).filter((e) => !(ids.has(e.source) && ids.has(e.target)))
  const chain = ['produkt', 'kursbilde', 'om-kurset'].filter((id) => byId(g, id))
  for (const n of [...visible, ...hidden]) {
    if (byId(g, `${n.id}-oppsummering`)) chain.push(`${n.id}-oppsummering`)
    chain.push(n.id)
    if (byId(g, `${n.id}-transkripsjon`)) chain.push(`${n.id}-transkripsjon`)
  }
  const edges = []
  for (let i = 1; i < chain.length; i++) edges.push({ id: `${chain[i - 1]}_${chain[i]}`, source: chain[i - 1], target: chain[i], label: 'next', type: 'next' })
  g.edges = [...kept, ...edges]
  return g
}

export function addLesson(g, input) {
  const type = input.type === 'text' ? 'text' : 'video'
  const title = String(input.title || '').trim()
  if (!title) throw new Error('title is required')
  if (type === 'video' && !input.video_url) throw new Error('video_url is required for a video step — upload the file first')
  if (type === 'video' && input.bytes && Number(input.bytes) > MAX_UPLOAD_BYTES) throw new Error(`the video is ${Math.round(input.bytes / 1048576)} MB; the limit is 100 MB per file`)
  const n0 = lessonNodes(g).length + 1
  let id = `l${String(n0).padStart(2, '0')}-${slugify(title)}`
  while (byId(g, id)) id = `${id}-${Math.random().toString(36).slice(2, 6)}`
  const lesson = { order: 10000, type, title }
  const node = { id, label: title, visible: true, bibl: [], position: { x: 0, y: 0 } }
  if (type === 'video') {
    Object.assign(lesson, { key: input.key || null, bytes: input.bytes ? Number(input.bytes) : null, duration_s: Math.round(Number(input.duration_s || 0)), ...(input.sha256 ? { sha256: input.sha256 } : {}) })
    Object.assign(node, { type: 'realtime-video', path: input.video_url, info: '' })
  } else {
    const pdf = input.pdf_url ? { key: input.pdf_key || null, name: input.pdf_name || 'oppskrift.pdf', url: input.pdf_url } : null
    lesson.pdf = pdf
    Object.assign(node, { type: 'fulltext', info: textWithPdf(input.text || '', pdf) })
  }
  node.metadata = { lesson }
  g.nodes.push(node)
  // An explicit position (1-based) moves it there; otherwise last.
  if (input.position) moveLesson(g, id, Number(input.position))
  renumber(g)
  return id
}

const textWithPdf = (text, pdf) => `${String(text || '').trim()}${pdf && pdf.url ? `\n\n**[Last ned ${pdf.label || 'oppskriften'} (PDF)](${pdf.url})**` : ''}`.trim()

function moveLesson(g, id, position) {
  const list = lessonNodes(g).sort((a, b) => a.metadata.lesson.order - b.metadata.lesson.order).filter((n) => n.id !== id)
  const me = byId(g, id)
  const at = Math.max(0, Math.min(list.length, position - 1))
  list.splice(at, 0, me)
  list.forEach((n, i) => { n.metadata.lesson.order = i + 1 })
}

export function reorderLessons(g, orderedIds) {
  const all = lessonNodes(g)
  const known = new Set(all.map((n) => n.id))
  const ids = (orderedIds || []).filter((id) => known.has(id))
  if (new Set(ids).size !== ids.length) throw new Error('the order lists a step twice')
  const rest = all.filter((n) => !ids.includes(n.id)).sort((a, b) => a.metadata.lesson.order - b.metadata.lesson.order).map((n) => n.id)
  ;[...ids, ...rest].forEach((id, i) => { byId(g, id).metadata.lesson.order = i + 1 })
  return renumber(g)
}

export function updateLesson(g, id, input) {
  const n = byId(g, id)
  if (!n || !n.metadata?.lesson) throw new Error(`no step ${id} in this course`)
  const l = n.metadata.lesson
  if (input.title !== undefined) l.title = String(input.title).trim() || l.title
  if (input.visible !== undefined) n.visible = Boolean(input.visible)
  if (l.type === 'text') {
    const pdf = input.pdf_url !== undefined
      ? (input.pdf_url ? { key: input.pdf_key || null, name: input.pdf_name || 'oppskrift.pdf', url: input.pdf_url } : null)
      : (l.pdf && typeof l.pdf === 'object' ? { ...l.pdf, url: l.pdf.url || pdfUrlIn(n.info) } : null)
    if (input.pdf_url !== undefined) l.pdf = pdf
    if (input.text !== undefined || input.pdf_url !== undefined) n.info = textWithPdf(input.text !== undefined ? input.text : stripPdfLine(n.info || ''), pdf)
  } else if (input.video_url) {
    // A new file: new key, new checksum, and the old transcript/summary no longer match it.
    if (input.bytes && Number(input.bytes) > MAX_UPLOAD_BYTES) throw new Error('the limit is 100 MB per file')
    n.path = input.video_url
    Object.assign(l, { key: input.key || l.key, bytes: input.bytes ? Number(input.bytes) : l.bytes, duration_s: Math.round(Number(input.duration_s || l.duration_s || 0)) })
    if (input.sha256) l.sha256 = input.sha256; else delete l.sha256
    for (const suffix of ['oppsummering', 'transkripsjon']) {
      const x = byId(g, `${id}-${suffix}`)
      if (x) { x.metadata = { ...(x.metadata || {}), stale: true }; x.info = `_Videoen er byttet. Denne teksten gjelder den forrige videoen og lages på nytt._\n\n${x.info || ''}` }
    }
  }
  if (input.summary !== undefined) upsertText(g, id, 'oppsummering', input.summary, { summary: { of: id, source: 'manual' } })
  if (input.transcript !== undefined) upsertText(g, id, 'transkripsjon', input.transcript, { transcript: { of: id, source: 'manual' } })
  return renumber(g)
}
const pdfUrlIn = (info) => (/\]\((https?:[^)]+\.pdf)\)/i.exec(String(info || '')) || [])[1] || null

function upsertText(g, id, suffix, text, meta) {
  const nid = `${id}-${suffix}`
  let x = byId(g, nid)
  if (!x) {
    x = { id: nid, label: nid, type: 'fulltext', visible: true, bibl: [], position: { x: 0, y: 0 }, info: '', metadata: {} }
    g.nodes.push(x)
  }
  x.info = String(text || '')
  x.metadata = { ...(x.metadata || {}), ...meta }
  delete x.metadata.stale
  return x
}

export function updateCourse(g, input) {
  const p = byId(g, 'produkt').metadata.product
  if (input.title !== undefined && String(input.title).trim()) {
    g.metadata.title = String(input.title).trim()
    const img = byId(g, 'kursbilde'); if (img) img.label = g.metadata.title
  }
  if (input.description !== undefined) g.metadata.description = String(input.description)
  if (input.level !== undefined) p.level = input.level || null
  if (input.access !== undefined) p.access = input.access
  if (input.category !== undefined) p.category = input.category
  if (input.image_url) {
    let img = byId(g, 'kursbilde')
    if (!img) {
      img = { id: 'kursbilde', label: g.metadata.title, type: 'portfolio-image', visible: true, bibl: [], position: { x: 0, y: 60 }, metadata: {} }
      g.nodes.splice(1, 0, img)
    }
    img.path = input.image_url
    img.info = `![${g.metadata.title}](${input.image_url})`
    img.metadata = { image: { key: input.image_key || null, kind: 'course-image' } }
    p.image = input.image_key || p.image
  }
  const aboutFields = ['tagline', 'about', 'you_make', 'for_whom', 'level', 'you_need', 'keywords', 'hashtags']
  if (aboutFields.some((k) => input[k] !== undefined)) {
    const node = byId(g, 'om-kurset')
    const d = { ...(node.metadata?.about || {}) }
    for (const k of aboutFields) if (input[k] !== undefined) d[k] = input[k]
    d.source = 'builder'
    node.metadata = { ...(node.metadata || {}), about: d }
    // Asked to change the description itself: written fresh from the fields (the counts and the
    // step list come back in renumber).
    node.info = aboutMarkdown(d, [], 0)
    if (input.tagline !== undefined && input.description === undefined) g.metadata.description = input.tagline
  }
  return renumber(g)
}

export function setCourseStatus(g, status) {
  if (!['draft', 'published', 'archived'].includes(status)) throw new Error('status is draft, published or archived')
  byId(g, 'produkt').metadata.product.status = status
  return renumber(g)
}

// ---- transcript and summary ---------------------------------------------------------------------
const stamp = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`
const escapeRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export function transcriptMarkdown(segments, glossary = {}) {
  const repl = glossary.replacements || {}
  const fix = (text) => Object.entries(repl).reduce((t, [from, to]) => t.replace(new RegExp(`\\b${escapeRe(from)}\\b`, 'gi'), to), text)
  const paras = []
  for (const seg of segments) {
    const last = paras[paras.length - 1]
    if (!last || seg.start - last.start >= 60) paras.push({ start: seg.start, text: String(seg.text || '').trim() })
    else last.text += ` ${String(seg.text || '').trim()}`
  }
  return paras.map((p) => `**[${stamp(p.start)}]** ${fix(p.text)}`).join('\n\n')
}

export function summaryMarkdown(d) {
  return [
    d.intro || '',
    '',
    '**I denne videoen**',
    ...(d.points || []).map((p) => `- **${p.at}** – ${p.text}`),
    '',
    `**Stikkord:** ${(d.keywords || []).join(' · ')}`,
    '',
    (d.hashtags || []).map(tag).join(' '),
  ].join('\n').trim()
}

async function transcribeAudio({ audio, filename, language, glossary, userId }) {
  const fd = new FormData()
  fd.append('file', audio, filename || 'lyd.wav')
  fd.append('model', 'whisper-1')
  fd.append('language', language || 'no')
  fd.append('response_format', 'verbose_json')
  const terms = (glossary && glossary.terms) || []
  if (terms.length) fd.append('prompt', terms.join(', '))
  if (userId) fd.append('userId', userId)
  const r = await fetch(AUDIO, { method: 'POST', body: fd })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || typeof j.text !== 'string') throw new Error(`transcription failed (${r.status}): ${j.error || 'unknown'}`)
  const segs = (j.segments || []).map((s) => ({ start: s.start, text: s.text }))
  return { segments: segs.length ? segs : [{ start: 0, text: j.text }], duration_s: Math.round(j.duration || 0) }
}

async function summarizeTranscript({ courseTitle, lessonTitle: lt, text, durationS, token, userId }) {
  const prompt = [
    `Du lager en kort oversikt som står OVER en kursvideo i «${courseTitle}», så deltakeren vet hva videoen går gjennom før hun ser den.`,
    `Videoen heter «${lt}». Under er den automatiske transkripsjonen med tidsstempler [mm:ss].`,
    'Svar BARE med JSON, uten forklaring og uten kodeblokk, på formen:',
    '{"intro": "én setning på norsk, du-form, varm og konkret", "points": [{"at": "mm:ss", "text": "kort punkt, maks 12 ord"}], "keywords": ["3-6 stikkord, små bokstaver"], "hashtags": ["3-5 hashtags uten #, små bokstaver, ett ord hver, norsk"]}',
    'Regler: 3-6 punkter i rekkefølgen de kommer i videoen, med tidsstempelet der temaet starter. Hvert tidsstempel er forskjellig. Bare det som faktisk sies i videoen. Ingen hilsener eller "velkommen".',
    '',
    text,
  ].join('\n')
  const r = await fetch(LLM, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Token': token },
    body: JSON.stringify({ userId, model: SUMMARY_MODEL, max_tokens: 900, temperature: 0.2, messages: [{ role: 'user', content: prompt }] }),
  })
  const j = await r.json().catch(() => ({}))
  const raw = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim()
  let data = null
  try { data = JSON.parse(raw.replace(/^```(json)?|```$/g, '').trim()) } catch { data = null }
  if (!r.ok || !data || !Array.isArray(data.points)) throw new Error(`summary failed (${r.status}): ${j.error || raw.slice(0, 160)}`)
  const secs = (at) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(at || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN }
  const seen = new Set()
  data.points = data.points
    .filter((p) => p && p.text && Number.isFinite(secs(p.at)) && secs(p.at) <= (durationS || Infinity))
    .sort((a, b) => secs(a.at) - secs(b.at))
    .filter((p) => (seen.has(p.at) ? false : (seen.add(p.at), true)))
    .slice(0, 8)
  if (data.points.length < 2) throw new Error('summary has too few valid points')
  return data
}

// ---- who may, and the KG round trip --------------------------------------------------------------
export async function mayBuildIn(env, who, domain) {
  const d = String(domain || '').trim().toLowerCase()
  if (!d) return { ok: false, status: 400, error: 'world is required, e.g. sodesign.no' }
  const wf = await env.DB.prepare('SELECT founder_email, account_holder_email FROM world_founders WHERE LOWER(domain) = ? ORDER BY created_at LIMIT 1').bind(d).first().catch(() => null)
  if (!wf) return { ok: false, status: 404, error: `no World ${d}` }
  const me = String(who.email || '').toLowerCase()
  if (!me) return { ok: false, status: 401, error: 'not signed in' }
  const isMember = [wf.founder_email, wf.account_holder_email].some((e) => e && String(e).toLowerCase() === me)
  const isSuper = String(who.role || '').toLowerCase() === 'superadmin'
  const isOwner = isMember || isSuper || Boolean(await env.DB.prepare('SELECT 1 AS ok FROM system_owners WHERE LOWER(email) = ? LIMIT 1').bind(me).first().catch(() => null))
  if (!isOwner) return { ok: false, status: 403, error: `only ${d}'s founder may build its courses` }
  return { ok: true, domain: d, founderEmail: String(wf.founder_email || '').toLowerCase() }
}

function kgFetch(env, who, path, init = {}) {
  const headers = { ...(init.headers || {}), 'x-acting-user-email': String(who.email).toLowerCase() }
  return env.KG_WORKER.fetch(`https://knowledge-graph-worker${path}`, { ...init, headers })
}

async function loadCourse(env, who, graphId) {
  if (!graphId) throw Object.assign(new Error('graphId is required'), { status: 400 })
  const res = await kgFetch(env, who, `/getknowgraph?id=${encodeURIComponent(graphId)}`)
  if (!res.ok) throw Object.assign(new Error(res.status === 404 ? 'course not found' : `could not read the course (${res.status})`), { status: res.status === 404 ? 404 : 502 })
  const g = await res.json()
  if (!g || !Array.isArray(g.nodes)) throw Object.assign(new Error('course not found'), { status: 404 })
  if (!isCourseGraph(g)) throw Object.assign(new Error('this graph is not a course (no produkt node with metadata.product)'), { status: 400 })
  g.edges = g.edges || []
  return g
}

async function saveCourse(env, who, graphId, g, { world, isNew = false } = {}) {
  const body = { id: graphId, graphData: g, override: false, ...(isNew && world ? { world } : {}) }
  const res = await kgFetch(env, who, '/saveGraphWithHistory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await res.json().catch(() => ({}))
  if (res.status === 409) throw Object.assign(new Error('Kurset ble endret et annet sted i mellomtiden. Last inn på nytt og prøv igjen.'), { status: 409, currentVersion: j.currentVersion })
  if (!res.ok) throw Object.assign(new Error(j.error || `saving the course failed (${res.status})`), { status: res.status })
  g.metadata.version = Number(j.newVersion || (g.metadata.version || 0) + 1)
  return j
}

// Read, change, save — with the version that was read, so a concurrent edit is refused, not lost.
async function changeCourse(env, who, input, change) {
  const g = await loadCourse(env, who, input.graphId)
  if (input.version !== undefined && Number(input.version) !== Number(g.metadata?.version || 0)) {
    throw Object.assign(new Error('Kurset ble endret et annet sted i mellomtiden. Last inn på nytt og prøv igjen.'), { status: 409, currentVersion: Number(g.metadata?.version || 0) })
  }
  const extra = change(g) || {}
  await saveCourse(env, who, input.graphId, g)
  return { ...extra, course: courseView(input.graphId, g) }
}

// ---- the operations (tools and HTTP both land here) ----------------------------------------------
// who: { email, role, userId, token? }   input: { world, graphId?, … }
export async function courseOp(env, who, op, input = {}) {
  const gate = await mayBuildIn(env, who, input.world)
  if (!gate.ok) return fail(gate.status, gate.error)
  const world = gate.domain
  try {
    switch (op) {
      case 'list': {
        const res = await kgFetch(env, who, `/getknowgraphs?world=${encodeURIComponent(world)}`)
        const j = await res.json().catch(() => ({}))
        if (!res.ok) return fail(res.status, j.error || `could not list ${world}'s graphs`)
        const courses = (j.results || [])
          .filter((r) => String(r.metaArea || r.metadata?.metaArea || '').toUpperCase().split(/\s+/).includes(COURSE_META_AREA))
          .map((r) => ({ graphId: r.id, title: r.title, image: r.portfolioImagePath || null, updatedAt: r.updatedAt, version: r.metadata?.version || null, metaArea: r.metaArea }))
        return ok({ world, courses, message: `${courses.length} course(s) in ${world}.` })
      }
      case 'get': {
        const g = await loadCourse(env, who, input.graphId)
        return ok({ world, course: courseView(input.graphId, g) })
      }
      case 'create': {
        if (!String(input.title || '').trim()) return fail(400, 'title is required')
        const graphId = uuid()
        const g = newCourseGraph(input, { createdBy: who.email, world })
        await saveCourse(env, who, graphId, g, { world, isNew: true })
        return ok({ world, graphId, course: courseView(graphId, g), editorUrl: `https://editor.${world}/?graphId=${graphId}`, message: `Course «${g.metadata.title}» created in ${world} as a draft.` })
      }
      case 'add_lesson': {
        let lessonId
        const r = await changeCourse(env, who, input, (g) => { lessonId = addLesson(g, input) })
        return ok({ world, lessonId, ...r, message: `Step «${input.title}» added.` })
      }
      case 'update_lesson': {
        const r = await changeCourse(env, who, input, (g) => { updateLesson(g, input.lessonId, input) })
        return ok({ world, ...r, message: 'Step updated.' })
      }
      case 'reorder': {
        const r = await changeCourse(env, who, input, (g) => { reorderLessons(g, input.order) })
        return ok({ world, ...r, message: 'Order saved.' })
      }
      case 'update_course': {
        const r = await changeCourse(env, who, input, (g) => { updateCourse(g, input) })
        return ok({ world, ...r, message: 'Course updated.' })
      }
      case 'set_status': {
        const r = await changeCourse(env, who, input, (g) => { setCourseStatus(g, input.status) })
        return ok({ world, ...r, message: `Status: ${input.status}.` })
      }
      case 'transcribe': {
        // input.audio: a Blob (mono speech, ≤ 24 MB — the page sends 16 kHz WAV). Whisper first, then
        // the summary; both written to the step's -transkripsjon / -oppsummering nodes.
        if (!input.audio || typeof input.audio.arrayBuffer !== 'function') return fail(400, 'audio is required')
        if (input.audio.size > AUDIO_MAX_BYTES) return fail(413, 'the audio is larger than 24 MB')
        const g0 = await loadCourse(env, who, input.graphId)
        const n = byId(g0, input.lessonId)
        if (!n || n.metadata?.lesson?.type !== 'video') return fail(400, `no video step ${input.lessonId} in this course`)
        const glossary = byId(g0, 'produkt').metadata.product.glossary || {}
        const t = await transcribeAudio({ audio: input.audio, filename: input.filename, language: input.language, glossary, userId: who.userId })
        const transcriptText = transcriptMarkdown(t.segments, glossary)
        let summary = null
        let summaryError = null
        if (who.token) {
          try {
            summary = await summarizeTranscript({ courseTitle: g0.metadata.title, lessonTitle: lessonTitle(n), text: transcriptText, durationS: t.duration_s || n.metadata.lesson.duration_s, token: who.token, userId: who.userId })
          } catch (e) { summaryError = e.message }
        } else summaryError = 'no user token for the summary'
        const r = await changeCourse(env, who, { graphId: input.graphId }, (g) => {
          const ln = byId(g, input.lessonId)
          if (t.duration_s && !ln.metadata.lesson.duration_s) ln.metadata.lesson.duration_s = t.duration_s
          upsertText(g, input.lessonId, 'transkripsjon', `_Automatisk transkribert (Whisper). Kan inneholde feil._\n\n${transcriptText}`,
            { transcript: { of: input.lessonId, model: 'whisper-1', language: input.language || 'no', segments: t.segments.length, duration_s: t.duration_s, source: 'automatic' } })
          if (summary) {
            upsertText(g, input.lessonId, 'oppsummering', summaryMarkdown(summary),
              { summary: { of: input.lessonId, model: SUMMARY_MODEL, keywords: summary.keywords || [], hashtags: summary.hashtags || [], source: 'automatic' } })
          }
          renumber(g)
        })
        return ok({ world, ...r, summaryError, message: summary ? 'Transcript and summary written.' : `Transcript written; summary not: ${summaryError}` })
      }
      default:
        return fail(404, `unknown operation ${op}`)
    }
  } catch (e) {
    return { status: e.status || 500, body: { success: false, error: e.message, ...(e.currentVersion !== undefined ? { currentVersion: e.currentVersion } : {}) } }
  }
}

// ---- HTTP: /world-course/* -----------------------------------------------------------------------
//   GET  /world-course/list?world=               the World's courses (graphs tagged #KURS)
//   GET  /world-course/get?world=&graphId=       one course, every step with what is missing
//   POST /world-course/create        {world, title, tagline?, about?, level?, …}
//   POST /world-course/lesson        {world, graphId, version, title, type, video_url|text, …}
//   POST /world-course/lesson/update {world, graphId, version, lessonId, title?, text?, visible?, …}
//   POST /world-course/reorder       {world, graphId, version, order: [lessonId…]}
//   POST /world-course/update        {world, graphId, version, title?, tagline?, image_url?, …}
//   POST /world-course/status        {world, graphId, version, status}
//   POST /world-course/transcribe    multipart: world, graphId, lessonId, audio (WAV)
// Files are uploaded by the page itself with /world-photos/token {world, scope:[upload]}.
const ROUTES = {
  'GET /world-course/list': 'list',
  'GET /world-course/get': 'get',
  'POST /world-course/create': 'create',
  'POST /world-course/lesson': 'add_lesson',
  'POST /world-course/lesson/update': 'update_lesson',
  'POST /world-course/reorder': 'reorder',
  'POST /world-course/update': 'update_course',
  'POST /world-course/status': 'set_status',
  'POST /world-course/transcribe': 'transcribe',
}

export async function handleWorldCourse(request, env, url, cors, resolveCaller) {
  const op = ROUTES[`${request.method} ${url.pathname}`]
  const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  if (!op) return json({ success: false, error: 'not found' }, 404)
  const caller = await resolveCaller(request, env).catch(() => null)
  if (!caller || !caller.authenticated || !caller.email) return json({ success: false, error: 'not signed in' }, 401)
  const who = {
    email: String(caller.email).toLowerCase(), role: caller.role, userId: caller.userId,
    token: String(caller.profile?.emailVerificationToken || caller.authToken || '').trim() || null,
  }
  let input = Object.fromEntries(url.searchParams.entries())
  if (request.method === 'POST') {
    const type = request.headers.get('content-type') || ''
    if (type.includes('multipart/form-data')) {
      const fd = await request.formData()
      for (const [k, v] of fd.entries()) input[k] = v
      if (input.audio && typeof input.audio === 'object') input.filename = input.audio.name
    } else {
      input = { ...input, ...(await request.json().catch(() => ({}))) }
    }
  }
  const r = await courseOp(env, who, op, input)
  return json(r.body, r.status)
}

// ---- Agent-Builder tools ---------------------------------------------------------------------------
export const COURSE_TOOL_OPS = {
  list_world_courses: 'list',
  get_world_course: 'get',
  create_world_course: 'create',
  add_course_lesson: 'add_lesson',
  update_course_lesson: 'update_lesson',
  reorder_course_lessons: 'reorder',
  update_world_course: 'update_course',
  set_world_course_status: 'set_status',
}

export async function executeCourseTool(toolName, input, env) {
  const op = COURSE_TOOL_OPS[toolName]
  if (!op) return { success: false, error: `unknown course tool ${toolName}` }
  if (!input.userId) return { success: false, error: 'No user context available — sign in and retry.' }
  const row = await env.DB.prepare('SELECT email, Role FROM config WHERE user_id = ? OR LOWER(email) = LOWER(?) LIMIT 1').bind(input.userId, input.userId).first().catch(() => null)
  if (!row || !row.email) return { success: false, error: 'Could not resolve the signed-in user.' }
  const who = { email: String(row.email).toLowerCase(), role: row.Role, userId: input.userId }
  const world = input.world || input.domain
  const r = await courseOp(env, who, op, { ...input, world })
  return r.body
}
