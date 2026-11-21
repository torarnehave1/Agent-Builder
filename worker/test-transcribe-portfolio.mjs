// transcribe_contact_recording also takes a recording that is ONLY in the audio portfolio
// (2026-11-15): an upload or a group conversation is on no ContactHub interaction, and was
// refused ("in the audio portfolio but not on any ContactHub interaction").
//
// Run:  node worker/test-transcribe-portfolio.mjs   (exit 0 = pass, 1 = fail)
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-portfolio-'))
for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')
fs.symlinkSync(path.join(dir, 'node_modules'), path.join(tmp, 'node_modules'))
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))

let failures = 0
const check = (name, ok, msg = '') => { if (ok) console.log(`ok    ${name}`); else { failures++; console.error(`FAIL  ${name}\n      ${msg}`) } }

const EMAIL = 'alice@example.com'
const USER_ID = '11111111-2222-4333-8444-555555555555'
const GROUP_URL = 'https://audio.example/audio/group.m4a'
const CONTACT_URL = 'https://audio.example/audio/contact-log-1.webm'
const PORTFOLIO = [
  { recordingId: 'rec_group', displayName: '2026-11-12 Gruppe', fileName: 'group.m4a', r2Url: GROUP_URL, createdAt: '2026-11-14T12:34:35.304Z', tags: [] },
  { recordingId: 'rec_contact', displayName: 'Contact Log Recording', fileName: 'contact-log-1.webm', r2Url: CONTACT_URL, createdAt: '2026-11-06T11:44:00.000Z', tags: ['contacts'] },
]
const LOG_ROW = { _id: 'log1', contact_id: 'c1', contact_name: 'Bob Example', recording_url: CONTACT_URL, logged_at: '2026-11-06T11:44:00.000Z', notes: 'Første samtale' }

function world({ hasContactHub = true, audioBytes = 2000, contentLength } = {}) {
  const seen = { whisper: 0, graphs: [], nodes: [], noteUpdates: [], downloads: [] }
  const json = (body, ok = true, status = 200) => ({ ok, status, json: async () => body, text: async () => JSON.stringify(body), headers: new Map() })
  const env = {
    __kgActing: EMAIL,
    DB: { prepare: () => ({ bind: () => ({ first: async () => ({ email: EMAIL, user_id: USER_ID, role: 'User' }) }) }) },
    DRIZZLE_WORKER: { fetch: async (url, init) => {
      const u = new URL(url)
      if (u.pathname === '/tables') return json({ tables: hasContactHub ? [{ id: 't_contacts', displayName: 'contacts' }, { id: 't_logs', displayName: 'contact_logs' }] : [] })
      const body = JSON.parse(init.body)
      if (u.pathname === '/query') return json({ records: body.offset ? [] : [LOG_ROW] })
      if (u.pathname === '/update') { seen.noteUpdates.push(body); return json({ success: true }) }
      return json({}, false, 404)
    } },
    AUDIO_PORTFOLIO: { fetch: async (url) => {
      const p = new URL(url).searchParams
      const offset = Number(p.get('offset') || 0)
      const page = PORTFOLIO.slice(offset, offset + Number(p.get('limit') || 50))
      return json({ recordings: page, total: PORTFOLIO.length, offset, nextOffset: offset + page.length, hasMore: false })
    } },
    OPENAI_WORKER: { fetch: async () => { seen.whisper++; return json({ text: `tekst ${seen.whisper}` }) } },
    KG_WORKER: { fetch: async (url, init) => {
      const body = JSON.parse(init.body)
      if (url.endsWith('/saveGraphWithHistory')) { seen.graphs.push(body); return json({ id: body.id }) }
      if (url.endsWith('/addNode')) { seen.nodes.push(body); return json({ success: true }) }
      return json({}, false, 404)
    } },
  }
  globalThis.fetch = async (url) => {
    seen.downloads.push(String(url))
    const bytes = new Uint8Array(audioBytes).fill(1)
    const headers = new Map([['content-type', 'audio/mp4'], ['content-length', String(contentLength ?? bytes.length)]])
    return { ok: true, status: 200, headers: { get: (k) => headers.get(k.toLowerCase()) || null }, arrayBuffer: async () => bytes.buffer, body: { cancel: async () => {} } }
  }
  return { env, seen }
}

// 1. A portfolio-only recording: transcribed, saved in a new private graph, no ContactHub note.
{
  const { env, seen } = world()
  const r = await executeTool('transcribe_contact_recording', { userId: USER_ID, recordingId: 'rec_group' }, env)
  check('portfolio-only: transcribed', r.success === true && r.transcript === '[00:00] tekst 1' && seen.whisper === 1, JSON.stringify(r).slice(0, 200))
  check('portfolio-only: the right file was downloaded', seen.downloads.length === 1 && seen.downloads[0] === GROUP_URL, seen.downloads.join(','))
  const g = seen.graphs[0]?.graphData
  check('portfolio-only: a new graph named after the recording', seen.graphs.length === 1 && /2026-11-12 Gruppe/.test(g.metadata.title) && g.metadata.createdBy === EMAIL, JSON.stringify(g?.metadata))
  check('portfolio-only: the node holds the text and points at the audio', g?.nodes[0].info.includes('tekst 1') && g.nodes[0].bibl[0] === GROUP_URL && g.nodes[0].type === 'fulltext')
  check('portfolio-only: no ContactHub note is written', seen.noteUpdates.length === 0 && r.notesUpdated === false)
  check('portfolio-only: the answer says where it came from', r.source === 'audio-portfolio' && r.recordingId === 'rec_group' && r.contactName === null && r.recordingName === '2026-11-12 Gruppe' && /no interaction note/.test(r.message), r.message)
  check('portfolio-only: date of the recording, Norwegian time', /14\. november 2026/.test(g.metadata.title) && r.loggedAt === '2026-11-14T12:34:35.304Z', g?.metadata.title)
}

// 2. …into an existing graph when graphId is given.
{
  const { env, seen } = world()
  const r = await executeTool('transcribe_contact_recording', { userId: USER_ID, recordingId: 'rec_group', graphId: 'graph-9' }, env)
  check('portfolio-only: added to the given graph, no new graph', seen.nodes.length === 1 && seen.nodes[0].graphId === 'graph-9' && seen.graphs.length === 0 && r.graphId === 'graph-9')
}

// 3. A user who has never opened ContactHub can still transcribe a portfolio recording.
{
  const { env } = world({ hasContactHub: false })
  const r = await executeTool('transcribe_contact_recording', { userId: USER_ID, recordingId: 'rec_group' }, env)
  check('no ContactHub tables: portfolio recording still transcribed', r.success === true && r.source === 'audio-portfolio')
}

// 4. A recording that IS on an interaction behaves as before: contact name, note appended.
{
  const { env, seen } = world()
  const r = await executeTool('transcribe_contact_recording', { userId: USER_ID, recordingId: 'rec_contact' }, env)
  check('on an interaction: still the ContactHub path', r.source === 'contacthub' && r.recordingId === 'contactlog:log1' && r.contactName === 'Bob Example' && r.contactId === 'c1', JSON.stringify({ s: r.source, id: r.recordingId }))
  check('on an interaction: note appended once', seen.noteUpdates.length === 1 && seen.noteUpdates[0].id === 'log1' && seen.noteUpdates[0].record.notes.startsWith('Første samtale') && r.notesUpdated === true)
  check('on an interaction: graph titled with the contact', /Bob Example/.test(seen.graphs[0].graphData.metadata.title) && seen.graphs[0].graphData.metadata.metaArea === '#TRANSKRIPSJON #SAMTALE')
  const byLog = await executeTool('transcribe_contact_recording', { userId: USER_ID, recordingId: 'contactlog:log1' }, env)
  check('on an interaction: contactlog: id still works', byLog.contactName === 'Bob Example')
}

// 5. Unknown id, and a file too big for a Worker: refused with nothing done.
{
  const { env, seen } = world()
  let msg = ''
  try { await executeTool('transcribe_contact_recording', { userId: USER_ID, recordingId: 'rec_nope' }, env) } catch (e) { msg = e.message }
  check('unknown id: refused, nothing downloaded', /No recording with id rec_nope/.test(msg) && seen.downloads.length === 0, msg)
}
{
  // Not MP4 (the WebM on the interaction) and over 80 MB: still refused (2026-11-21).
  const { env, seen } = world({ contentLength: 200 * 1024 * 1024 })
  let msg = ''
  try { await executeTool('transcribe_contact_recording', { userId: USER_ID, recordingId: 'rec_contact' }, env) } catch (e) { msg = e.message }
  check('too large WebM: refused before transcribing, nothing saved', /200 MB; server transcription takes at most 80 MB, except MP4/.test(msg) && seen.whisper === 0 && seen.graphs.length === 0, msg)
}
{
  // MP4/M4A over the 400 MB Range ceiling: refused.
  const { env, seen } = world({ contentLength: 401 * 1024 * 1024 })
  let msg = ''
  try { await executeTool('transcribe_contact_recording', { userId: USER_ID, recordingId: 'rec_group' }, env) } catch (e) { msg = e.message }
  check('too large m4a: refused over 400 MB, nothing saved', /401 MB; server transcription of MP4\/M4A takes at most 400 MB/.test(msg) && seen.whisper === 0 && seen.graphs.length === 0, msg)
}
{
  // MP4/M4A of 85 MB: goes the Range way (this fake server has no Range, so it says that —
  // the full Range path is checked against real files in test-audio-split.mjs).
  const { env, seen } = world({ contentLength: 85 * 1024 * 1024 })
  let msg = ''
  try { await executeTool('transcribe_contact_recording', { userId: USER_ID, recordingId: 'rec_group' }, env) } catch (e) { msg = e.message }
  check('85 MB m4a: taken to the Range path, not refused for size', /did not answer a Range request/.test(msg) && seen.whisper === 0, msg)
}

fs.unlinkSync(path.join(tmp, 'node_modules'))
fs.rmSync(tmp, { recursive: true, force: true })
if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nAll portfolio transcription checks passed.')
