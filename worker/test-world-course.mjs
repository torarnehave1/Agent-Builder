// World course builder (2026-10-24): world-course.js against a fake KG worker (versioned saves, World
// listing) and fake Whisper/LLM endpoints. What matters:
//   - a new course has the exact template Min side reads (world-customer.js reads it back here)
//   - lesson ids never change; order, labels, counts, the step list and the `next` chain follow
//   - hand-written text in «Produkt» and «Om kurset» survives a structural change
//   - a stale version is refused (409), nobody's edit is overwritten
//   - only the founder / Superadmin / system owner may build; a customer may not
//   - a hidden step disappears from Min side but keeps its node and file
//
// Run:  node worker/test-world-course.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { DatabaseSync } from 'node:sqlite'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'world-course-'))
for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')
fs.symlinkSync(path.join(dir, 'node_modules'), path.join(tmp, 'node_modules'))
const C = await import(path.join(tmp, 'world-course.js'))
const { handleWorldCustomer } = await import(path.join(tmp, 'world-customer.js'))
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))

let failures = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`ok    ${name}`)
  else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) }
}
const ACCOUNT = 'b68bda52e04081f0cbc04df338a44019'
const WORLD = 'sodesign.no'

// ---- platform D1 -------------------------------------------------------------------------------
const db = new DatabaseSync(':memory:')
db.exec(`
  CREATE TABLE config (user_id TEXT, email TEXT, Role TEXT, bio TEXT, profileimage TEXT, phone TEXT, phone_verified_at TEXT, data TEXT, cf_account_id TEXT, cf_api_token TEXT, emailVerificationToken TEXT);
  CREATE TABLE world_founders (id TEXT, founder_email TEXT, account_holder_email TEXT, hosting_model TEXT, cf_account_id TEXT, domain TEXT, created_at TEXT);
  CREATE TABLE world_commerce_stores (domain TEXT PRIMARY KEY, cf_account_id TEXT, d1_database_id TEXT, d1_database_name TEXT, schema_version INTEGER, status TEXT, provisioned_at TEXT, updated_at TEXT);
  CREATE TABLE system_owners (email TEXT);
`)
db.prepare(`INSERT INTO config (user_id, email, Role) VALUES ('owner-uuid', 'owner@example.com', 'Superadmin')`).run()
db.prepare(`INSERT INTO config (user_id, email, Role, cf_account_id, cf_api_token) VALUES ('stine-uuid', 'stine.oksvold@gmail.com', 'Admin', ?, 'tok')`).run(ACCOUNT)
db.prepare(`INSERT INTO config (user_id, email, Role) VALUES ('kunde-uuid', 'kunde@example.com', 'User')`).run()
db.prepare(`INSERT INTO world_founders VALUES ('wf', 'stine.oksvold@gmail.com', null, 'own_account', ?, ?, '2026-10-15')`).run(ACCOUNT, WORLD)
db.prepare(`INSERT INTO world_commerce_stores VALUES (?, ?, 'cdb', 'world-commerce-sodesign', 1, 'provisioned', 'x', 'x')`).run(WORLD, ACCOUNT)
const DB = { prepare(sql) { let a = []; const st = { bind(...x) { a = x; return st }, async first() { return db.prepare(sql).get(...a) ?? null }, async all() { return { results: db.prepare(sql).all(...a) } }, async run() { db.prepare(sql).run(...a); return { success: true } } }; return st } }

// ---- the World's customer database (behind the D1 API) -------------------------------------------
const founderDb = new DatabaseSync(':memory:')
founderDb.exec(`
  CREATE TABLE grants (id TEXT PRIMARY KEY, email TEXT NOT NULL, product_ref TEXT NOT NULL, kind TEXT NOT NULL, source TEXT NOT NULL, source_ref TEXT, starts_at TEXT NOT NULL, ends_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL, created_by TEXT);
  CREATE TABLE progress (email TEXT NOT NULL, course_ref TEXT NOT NULL, lesson_ref TEXT NOT NULL, done_at TEXT NOT NULL, PRIMARY KEY (email, course_ref, lesson_ref));
`)

// ---- fake KG worker: World graphs, versioned saves, acting user recorded ---------------------------
const graphs = new Map()
const kgCalls = []
const KG_WORKER = {
  async fetch(u, init = {}) {
    const url = new URL(u)
    const acting = (init.headers || {})['x-acting-user-email'] || null
    kgCalls.push({ path: url.pathname, acting })
    if (url.pathname === '/getknowgraph') {
      const g = graphs.get(url.searchParams.get('id'))
      return g ? new Response(JSON.stringify(g)) : new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
    }
    if (url.pathname === '/getknowgraphs') {
      const results = [...graphs.entries()].map(([id, g]) => ({ id, title: g.metadata.title, metaArea: g.metadata.metaArea, metadata: { version: g.metadata.version } }))
      return new Response(JSON.stringify({ world: url.searchParams.get('world'), results }))
    }
    if (url.pathname === '/saveGraphWithHistory') {
      const body = JSON.parse(init.body)
      const cur = graphs.get(body.id)
      const current = cur ? cur.metadata.version : 0
      if (cur && !body.override && body.graphData.metadata.version !== current) {
        return new Response(JSON.stringify({ error: 'Version mismatch', currentVersion: current }), { status: 409 })
      }
      const saved = JSON.parse(JSON.stringify(body.graphData))
      saved.metadata.version = current + 1
      graphs.set(body.id, saved)
      return new Response(JSON.stringify({ id: body.id, newVersion: current + 1, world: body.world || null }))
    }
    return new Response('{}', { status: 404 })
  },
}
const env = { DB, KG_WORKER }

// ---- fake outside services (D1 API for customer db, Whisper, LLM) ----------------------------------
const realFetch = globalThis.fetch
let audioCalls = 0
globalThis.fetch = async (u, init = {}) => {
  const s = String(u)
  if (s.includes('/d1/database/')) {
    const { sql, params } = JSON.parse(init.body)
    const st = founderDb.prepare(sql)
    const rows = /^\s*select/i.test(sql) ? st.all(...params) : (st.run(...params), [])
    return new Response(JSON.stringify({ success: true, result: [{ results: rows }] }))
  }
  if (s === 'https://openai.vegvisr.org/audio') {
    audioCalls++
    return new Response(JSON.stringify({ text: 'Hei hei. Nå legger vi opp masker.', duration: 130, segments: [
      { start: 0, text: 'Hei hei, velkommen.' }, { start: 20, text: 'Finn enden på nøstet.' }, { start: 75, text: 'Nå legger vi opp masker på rundpinnen.' },
    ] }))
  }
  if (s === 'https://anthropic.vegvisr.org/chat') {
    return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({
      intro: 'Du lærer å legge opp masker.',
      points: [{ at: '00:20', text: 'Finn enden på nøstet' }, { at: '00:20', text: 'dobbelt tidspunkt' }, { at: '01:15', text: 'Legg opp på rundpinnen' }, { at: '09:59', text: 'etter videoens slutt' }],
      keywords: ['legge opp'], hashtags: ['strikking'],
    }) }] }))
  }
  return realFetch(u, init)
}

const STINE = { email: 'stine.oksvold@gmail.com', role: 'Admin', userId: 'stine-uuid', token: 'stine-token' }
const SUPER = { email: 'owner@example.com', role: 'Superadmin', userId: 'owner-uuid', token: 't' }
const KUNDE = { email: 'kunde@example.com', role: 'User', userId: 'kunde-uuid', token: 't' }

// ---- 1. create ---------------------------------------------------------------------------------
let r = await C.courseOp(env, STINE, 'create', { world: WORLD, title: 'Enkel lue', tagline: 'Strikk din første lue', about: 'Et lite kurs.', level: 'nybegynner', you_need: ['rundpinne nr. 5', 'garn'], metaArea: '#STRIKKESKOLEN', image_url: 'https://cdn.sodesign.no/photos/kurs/enkel-lue/kursbilde.jpg', image_key: 'kurs/enkel-lue/kursbilde.jpg' })
check('the founder creates a course', r.status === 200 && r.body.graphId, JSON.stringify(r.body))
const id = r.body.graphId
let g = graphs.get(id)
check('the course has the template: produkt, kursbilde, om-kurset', ['produkt', 'kursbilde', 'om-kurset'].every((x) => g.nodes.some((n) => n.id === x)), g.nodes.map((n) => n.id).join(','))
check('status draft, slug, folder kurs/<slug>, tagged #KURS', g.nodes[0].metadata.product.status === 'draft' && g.nodes[0].metadata.product.slug === 'enkel-lue' && g.nodes[0].metadata.product.folder === 'kurs/enkel-lue' && g.metadata.metaArea === '#KURS #STRIKKESKOLEN', JSON.stringify(g.nodes[0].metadata.product) + g.metadata.metaArea)
check('saved as the founder, into her World', kgCalls.some((c) => c.path === '/saveGraphWithHistory' && c.acting === 'stine.oksvold@gmail.com'), JSON.stringify(kgCalls))

// ---- 2. who may ----------------------------------------------------------------------------------
r = await C.courseOp(env, KUNDE, 'create', { world: WORLD, title: 'Hack' })
check('a customer may not build courses (403)', r.status === 403, JSON.stringify(r))
r = await C.courseOp(env, SUPER, 'get', { world: WORLD, graphId: id })
check('a Superadmin may read it', r.status === 200 && r.body.course.title === 'Enkel lue', JSON.stringify(r.body))
r = await C.courseOp(env, STINE, 'get', { world: 'nowhere.no', graphId: id })
check('an unknown World is 404', r.status === 404, JSON.stringify(r))

// ---- 3. add steps ---------------------------------------------------------------------------------
let v = graphs.get(id).metadata.version
r = await C.courseOp(env, STINE, 'add_lesson', { world: WORLD, graphId: id, version: v, type: 'text', title: 'Oppskriften', text: 'Her er oppskriften.', pdf_url: 'https://cdn.sodesign.no/photos/kurs/enkel-lue/enkel-lue.pdf', pdf_key: 'kurs/enkel-lue/enkel-lue.pdf', pdf_name: 'Enkel_lue.pdf' })
check('a text step with a PDF is added', r.status === 200 && r.body.lessonId === 'l01-oppskriften', JSON.stringify(r.body))
r = await C.courseOp(env, STINE, 'add_lesson', { world: WORLD, graphId: id, type: 'video', title: 'Legg opp', video_url: 'https://cdn.sodesign.no/photos/kurs/enkel-lue/02-legg-opp.mp4', key: 'kurs/enkel-lue/02-legg-opp.mp4', bytes: 60e6, duration_s: 300 })
const leggOpp = r.body.lessonId
r = await C.courseOp(env, STINE, 'add_lesson', { world: WORLD, graphId: id, type: 'video', title: 'Fell av', video_url: 'https://cdn.sodesign.no/photos/kurs/enkel-lue/03-fell-av.mp4', key: 'kurs/enkel-lue/03-fell-av.mp4', duration_s: 200 })
const fellAv = r.body.lessonId
r = await C.courseOp(env, STINE, 'add_lesson', { world: WORLD, graphId: id, type: 'video', title: 'For stor', video_url: 'x', bytes: 150e6 })
check('a video over 100 MB is refused', r.status === 500 && /100 MB/.test(r.body.error), JSON.stringify(r.body))
g = graphs.get(id)
const p = g.nodes.find((n) => n.id === 'produkt').metadata.product
check('product counts follow: 3 steps, 2 videos, 500 s', p.lessons === 3 && p.videos === 2 && p.duration_s === 500, JSON.stringify(p))
check('the PDF becomes a grant', p.grants.some((x) => x.type === 'file' && x.ref === 'kurs/enkel-lue/enkel-lue.pdf'), JSON.stringify(p.grants))
check('labels are «Steg N av M – …»', g.nodes.find((n) => n.id === fellAv).label === 'Steg 3 av 3 – Fell av', g.nodes.find((n) => n.id === fellAv).label)
const about = g.nodes.find((n) => n.id === 'om-kurset').info
check('«Om kurset» lists the steps and counts', /\*\*3 steg\*\*/.test(about) && /1\. Oppskriften\n2\. Legg opp \(5 min\)\n3\. Fell av \(3 min\)/.test(about), about)

// ---- 4. stale version is refused ------------------------------------------------------------------
r = await C.courseOp(env, STINE, 'update_lesson', { world: WORLD, graphId: id, version: v, lessonId: leggOpp, title: 'Gammel' })
check('a save with a stale version is refused (409), nothing overwritten', r.status === 409 && graphs.get(id).nodes.find((n) => n.id === leggOpp).metadata.lesson.title === 'Legg opp', JSON.stringify(r.body))

// ---- 5. reorder: ids stay, order/labels/chain follow ----------------------------------------------
r = await C.courseOp(env, STINE, 'reorder', { world: WORLD, graphId: id, order: [leggOpp, fellAv] })
g = graphs.get(id)
const course = r.body.course
check('reorder: steps in the new order, ids unchanged', course.lessons.map((l) => l.id).join(',') === `${leggOpp},${fellAv},l01-oppskriften`, course.lessons.map((l) => l.id).join(','))
check('reorder: labels renumbered', g.nodes.find((n) => n.id === 'l01-oppskriften').label === 'Steg 3 av 3 – Oppskriften')
const chain = g.edges.map((e) => `${e.source}>${e.target}`).join(' ')
check('the next chain follows the order', chain === `produkt>kursbilde kursbilde>om-kurset om-kurset>${leggOpp} ${leggOpp}>${fellAv} ${fellAv}>l01-oppskriften`, chain)

// ---- 6. transcribe: Whisper + summary written by id --------------------------------------------------
r = await C.courseOp(env, STINE, 'transcribe', { world: WORLD, graphId: id, lessonId: leggOpp, audio: new Blob([new Uint8Array(1000)], { type: 'audio/wav' }), filename: 'a.wav' })
g = graphs.get(id)
const tr = g.nodes.find((n) => n.id === `${leggOpp}-transkripsjon`)
const sm = g.nodes.find((n) => n.id === `${leggOpp}-oppsummering`)
check('transcript node written, joined by id, with timestamps', r.status === 200 && tr && /\*\*\[00:00\]\*\*/.test(tr.info) && /\*\*\[01:15\]\*\*/.test(tr.info), JSON.stringify(r.body).slice(0, 300))
check('summary written; duplicate and out-of-range timestamps dropped', sm && (sm.info.match(/\*\*00:20\*\*/g) || []).length === 1 && !/09:59/.test(sm.info), sm && sm.info)
check('the chain now runs summary > video > transcript', g.edges.some((e) => e.source === `${leggOpp}-oppsummering` && e.target === leggOpp) && g.edges.some((e) => e.source === leggOpp && e.target === `${leggOpp}-transkripsjon`))
r = await C.courseOp(env, STINE, 'transcribe', { world: WORLD, graphId: id, lessonId: 'l01-oppskriften', audio: new Blob([new Uint8Array(10)]) })
check('a text step cannot be transcribed', r.status === 400, JSON.stringify(r.body))
check('the builder view shows nothing missing on the transcribed step', r && (await C.courseOp(env, STINE, 'get', { world: WORLD, graphId: id })).body.course.lessons[0].missing.length === 0)

// ---- 7. hide: gone from Min side, node and file kept ----------------------------------------------------
r = await C.courseOp(env, STINE, 'update_lesson', { world: WORLD, graphId: id, lessonId: fellAv, visible: false })
g = graphs.get(id)
check('hidden step: product counts drop to 2', g.nodes.find((n) => n.id === 'produkt').metadata.product.lessons === 2)
check('hidden step keeps its node and video', g.nodes.find((n) => n.id === fellAv)?.path?.endsWith('03-fell-av.mp4'))
founderDb.prepare(`INSERT INTO grants VALUES ('g1', 'kunde@example.com', ?, 'course', 'manual', 'test', '2026-01-01', null, null, '2026-01-01', 'x')`).run(id)
const customerReq = new Request(`https://agent.vegvisr.org/world-customer/course?world=${WORLD}&graphId=${id}`)
const res = await handleWorldCustomer(customerReq, env, new URL(customerReq.url), {}, async () => ({ authenticated: true, email: 'kunde@example.com' }))
const seen = await res.json()
check('Min side shows the course without the hidden step', res.status === 200 && seen.steps.length === 2 && !seen.steps.some((s) => s.id === fellAv), JSON.stringify(seen).slice(0, 300))
check('Min side shows the summary and transcript written by the builder', seen.steps[0].summary.includes('I denne videoen') && seen.steps[0].transcript.includes('[00:00]'))

// ---- 8. status, course edit, list ---------------------------------------------------------------------
r = await C.courseOp(env, STINE, 'set_status', { world: WORLD, graphId: id, status: 'published' })
check('status published, shown in Produkt', r.body.course.status === 'published' && /Status: published\./.test(graphs.get(id).nodes[0].info))
r = await C.courseOp(env, STINE, 'update_course', { world: WORLD, graphId: id, tagline: 'Ny linje' })
check('editing «Om kurset» fields rewrites it and keeps counts and steps', /\*\*Ny linje\*\*/.test(graphs.get(id).nodes.find((n) => n.id === 'om-kurset').info) && /\*\*2 steg\*\*/.test(graphs.get(id).nodes.find((n) => n.id === 'om-kurset').info))
r = await C.courseOp(env, STINE, 'list', { world: WORLD })
check('list finds the course by #KURS', r.status === 200 && r.body.courses.some((c) => c.graphId === id), JSON.stringify(r.body))

// ---- 9. an existing, hand-written course (Enkel hals) survives a change --------------------------------
const hals = {
  metadata: { title: 'Enkel hals strikkekurs', description: 'Strikk din første hals', metaArea: '#KURS #STRIKKESKOLEN', version: 18 },
  nodes: [
    { id: 'produkt', type: 'fulltext', info: '**Kurs · 2 steg · ca. 6 min video**\n\nInkludert i medlemskapet Den lille strikkeskolen\n\nStatus: draft. Dette er produktnoden: metadata.product styrer tilgang, kort og nettbutikk.', metadata: { product: { kind: 'course', slug: 'enkel-hals', status: 'draft', lessons: 2, grants: [] } } },
    { id: 'om-kurset', type: 'fulltext', info: '**Strikk din første hals**\n\nStine skrev dette selv.\n\n**Nivå:** nybegynner · **2 steg** · **ca. 6 min video**\n\n**Stegene**\n1. Oppskriften\n2. Legg opp (5 min)\n\n**Stikkord:** hals', metadata: { about: { level: 'nybegynner' } } },
    { id: 'l01-oppskriften', label: 'Steg 1 av 2 – Oppskriften', type: 'fulltext', info: 'Last ned.\n\n**[Last ned oppskriften (PDF)](https://cdn.sodesign.no/photos/kurs/enkel-hals/enkel-hals.pdf)**', metadata: { lesson: { order: 1, type: 'text', pdf: { key: 'kurs/enkel-hals/enkel-hals.pdf' } } } },
    { id: 'l02-legg-opp', label: 'Steg 2 av 2 – Legg opp', type: 'realtime-video', path: 'https://cdn.sodesign.no/photos/kurs/enkel-hals/02-legg-opp.mp4', metadata: { lesson: { order: 2, type: 'video', duration_s: 315 } } },
    { id: 'e01', label: 'Enkel hals – høststemning', type: 'fulltext', info: 'bilde' },
  ],
  edges: [{ source: 'produkt', target: 'om-kurset' }, { source: 'e01', target: 'produkt', label: 'mitt eget' }],
}
graphs.set('hals', hals)
r = await C.courseOp(env, STINE, 'update_lesson', { world: WORLD, graphId: 'hals', lessonId: 'l01-oppskriften', title: 'Oppskrift (PDF)' })
g = graphs.get('hals')
const omk = g.nodes.find((n) => n.id === 'om-kurset').info
check('Enkel hals: Stine\'s own text in «Om kurset» survives', omk.includes('Stine skrev dette selv.') && omk.includes('**Stikkord:** hals') && omk.includes('1. Oppskrift (PDF)'), omk)
check('Enkel hals: «Produkt» keeps its membership line', g.nodes[0].info.includes('Inkludert i medlemskapet Den lille strikkeskolen'), g.nodes[0].info)
check('Enkel hals: the text step keeps its PDF link', g.nodes.find((n) => n.id === 'l01-oppskriften').info.includes('enkel-hals.pdf'), g.nodes.find((n) => n.id === 'l01-oppskriften').info)
check('Enkel hals: a person\'s own edge and node are kept', g.edges.some((e) => e.source === 'e01' && e.label === 'mitt eget') && g.nodes.some((n) => n.id === 'e01'))

// ---- 10. the Agent-Builder tool path --------------------------------------------------------------------
const t = await executeTool('get_world_course', { world: WORLD, graphId: id, userId: 'stine-uuid' }, env)
check('tool get_world_course works for the founder', t.success === true && t.course.title === 'Enkel lue', JSON.stringify(t).slice(0, 300))
const t2 = await executeTool('create_world_course', { world: WORLD, title: 'Nei', userId: 'kunde-uuid' }, env)
check('tool create_world_course refuses a customer', t2.success === false && /founder/.test(t2.error), JSON.stringify(t2))

// ---- 11. HTTP route ----------------------------------------------------------------------------------
const hreq = new Request(`https://agent.vegvisr.org/world-course/get?world=${WORLD}&graphId=${id}`)
const hres = await C.handleWorldCourse(hreq, env, new URL(hreq.url), {}, async () => ({ authenticated: true, email: 'stine.oksvold@gmail.com', role: 'Admin', userId: 'stine-uuid' }))
check('GET /world-course/get answers the founder', hres.status === 200 && (await hres.json()).course.lessons.length === 3)
const nreq = new Request(`https://agent.vegvisr.org/world-course/get?world=${WORLD}&graphId=${id}`)
const nres = await C.handleWorldCourse(nreq, env, new URL(nreq.url), {}, async () => ({ authenticated: false }))
check('not signed in is 401', nres.status === 401)

globalThis.fetch = realFetch
console.log(failures ? `\n${failures} world-course check(s) failed` : '\nall world-course checks pass')
process.exit(failures ? 1 : 0)
