// Every contact and every contact recording must be reachable, not just the first page.
//
// 2026-09-30, real data: the user has 1811 contacts and 6866 contact logs. Asked for the
// recordings of "Olve Aleksander Storås", the agent answered that the contact did not exist
// and that 2 recordings were "the only ones". Both statements came from page-sized windows:
//   * search_contacts read the first 1000 contacts ordered by name and filtered them in JS —
//     Olve sits at row 1229, so he was unreachable by search at all.
//   * list_recordings read the newest 200 logs — that window stopped at 2026-06-18, hiding
//     his third recording from 2026-06-16.
//   * every contact-log recordingId was `contactlog:undefined`, because the id column is
//     `_id`, and the same wrong field made transcribe-by-recordingId unresolvable.
//
// The fake Drizzle below behaves like the real one: it filters, counts and paginates
// server-side and NEVER returns more rows than `limit`. Any executor that goes back to
// filtering a page client-side fails these checks.
//
// Run:  node worker/test-contact-reach.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'contact-reach-'))
for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))

let failures = 0
const check = (name, cond, detail) => { if (cond) console.log(`ok    ${name}`); else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) } }

const CONTACTS_TABLE = 'contacts-table-id'
const LOGS_TABLE = 'logs-table-id'
const OLVE_ID = '9dc03191-a2dc-434a-a131-fc51e1f43b3e'

// 1811 contacts, Olve at row 1229 of the name-ordered table — exactly where the real one sits.
// 1229 filler names sort before "Olve", the remaining 581 after, so a 1000-row page cannot
// contain him no matter how the caller sorts.
const contacts = [{ _id: OLVE_ID, full_name: 'Olve Aleksander Storås', organization: '', emails: '', phones: '' }]
for (let i = 0; i < 1810; i++) {
  const name = i < 1229 ? `Alf ${String(i).padStart(4, '0')}` : `Zara ${String(i).padStart(4, '0')}`
  contacts.push({ _id: `c-${i}`, full_name: name, organization: '', emails: '', phones: '' })
}
contacts.sort((a, b) => a.full_name.localeCompare(b.full_name))
if (contacts.length !== 1811 || contacts.findIndex(c => c._id === OLVE_ID) !== 1229) {
  console.error(`FAIL  fixture: the contact must sit at row 1229 of 1811 (got row ${contacts.findIndex(c => c._id === OLVE_ID)} of ${contacts.length})`)
  process.exit(1)
}

// 6000 logs; three of Olve's carry a recording and the oldest is far outside any 200-row window.
const logs = []
for (let i = 0; i < 6000; i++) {
  logs.push({
    _id: `l-${i}`, contact_id: `c-${i % 400}`, contact_name: `Person ${String(i % 400).padStart(4, '0')}`,
    notes: 'note', logged_at: new Date(Date.UTC(2026, 8, 30) - i * 3600e3).toISOString(), recording_url: '',
  })
}
const olveLogs = [
  { _id: 'log-aug', logged_at: '2026-08-12T07:57:04.622Z', recording_url: 'https://audio.vegvisr.org/audio/aug.webm' },
  { _id: 'log-jul', logged_at: '2026-07-08T08:43:27.734Z', recording_url: 'https://audio.vegvisr.org/norwegian-audio/jul.webm' },
  { _id: 'log-jun', logged_at: '2026-06-16T08:44:55.111Z', recording_url: 'https://audio.vegvisr.org/norwegian-audio/jun.webm' },
]
for (const l of olveLogs) logs.push({ ...l, contact_id: OLVE_ID, contact_name: 'Olve Aleksander Storås', contact_type: 'Zoom', notes: 'samtale' })
// 7 more logs without audio, so his history is 10 entries of which 3 carry audio — the real
// shape, and the one the Contacts app shows under "Interaction History".
for (let i = 0; i < 7; i++) {
  logs.push({
    _id: `olve-zoom-${i}`, contact_id: OLVE_ID, contact_name: 'Olve Aleksander Storås',
    contact_type: 'zoom', notes: '<p>Olve Aleksander 1-1 med Tor Arne</p><p>Sted: zoom</p>',
    logged_at: `2026-05-${String(i + 1).padStart(2, '0')}T09:00:00.000Z`, recording_url: '',
  })
}

const fold = (v) => String(v ?? '').toLowerCase()

function makeEnv({ ignoreSearch = false } = {}) {
  const queries = []
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  const DRIZZLE_WORKER = {
    async fetch(url, init) {
      const u = new URL(url)
      if (u.pathname === '/tables') {
        return json({ tables: [
          { id: CONTACTS_TABLE, displayName: 'contacts' },
          { id: LOGS_TABLE, displayName: 'contact_logs' },
        ] })
      }
      if (u.pathname !== '/query') return json({ error: 'unexpected ' + u.pathname })
      const body = JSON.parse(init.body)
      queries.push(body)
      let rows = body.tableId === CONTACTS_TABLE ? [...contacts] : [...logs]
      if (body.where) {
        for (const [k, v] of Object.entries(body.where)) rows = rows.filter(r => String(r[k]) === String(v))
      }
      if (body.search && body.search.term && !ignoreSearch) {
        const words = fold(body.search.term).split(/\s+/).filter(Boolean)
        const cols = body.search.columns || []
        rows = rows.filter(r => words.every(w => cols.some(c => fold(r[c]).includes(w))))
      }
      if (Array.isArray(body.notEmpty)) {
        for (const c of body.notEmpty) rows = rows.filter(r => r[c] !== null && r[c] !== undefined && r[c] !== '')
      }
      const col = body.orderBy || '_created_at'
      rows.sort((a, b) => String(a[col] ?? '').localeCompare(String(b[col] ?? '')))
      if (body.order !== 'asc') rows.reverse()
      const total = rows.length
      const limit = Math.min(Math.max(parseInt(body.limit) || 50, 1), 10000)
      const offset = Math.max(parseInt(body.offset) || 0, 0)
      return json({ records: rows.slice(offset, offset + limit), total, limit, offset })
    },
  }
  // No KV recordings at all — the contact logs are the only source, as they were in production.
  const AUDIO_PORTFOLIO = { async fetch() { return json({ recordings: [] }) } }
  return { env: { DRIZZLE_WORKER, AUDIO_PORTFOLIO }, queries }
}

const CALLER = { userId: 'ca3d9d93-3b02-4e49-a4ee-43552ec4ca2b', userEmail: 'owner@example.com' }

// 1. A contact past the first page is found, and the summary carries the data.
{
  const { env, queries } = makeEnv()
  const r = await executeTool('search_contacts', { ...CALLER, query: 'Olve Aleksander Storås' }, env)
  const contactQueries = queries.filter(q => q.tableId === CONTACTS_TABLE)
  check('search_contacts finds a contact at row 1229 of 1811',
    (r.contacts || []).some(c => c._id === OLVE_ID), `got ${JSON.stringify((r.contacts || []).map(c => c.full_name))}`)
  check('search_contacts filters in the query, not in JS',
    contactQueries.every(q => q.search && q.search.term) && contactQueries.every(q => (q.limit || 0) <= 200),
    `queries: ${JSON.stringify(contactQueries)}`)
  check('search_contacts returns a summary naming the contact and its id',
    typeof r.message === 'string' && r.message.includes('Olve Aleksander Storås') && r.message.includes(OLVE_ID),
    `message: ${r.message}`)
}

// 1b. An all-caps search still matches — the fold must not be ASCII-only.
{
  const { env } = makeEnv()
  const r = await executeTool('search_contacts', { ...CALLER, query: 'STORÅS' }, env)
  check('search_contacts is case-insensitive for Norwegian letters',
    (r.contacts || []).some(c => c._id === OLVE_ID), `got ${JSON.stringify((r.contacts || []).map(c => c.full_name))}`)
}

// 1c. A contact that really is absent reads as "no match", with an empty list.
{
  const { env } = makeEnv()
  const r = await executeTool('search_contacts', { ...CALLER, query: 'Ingen Slik Person' }, env)
  check('a genuine miss returns no contacts and says so',
    (r.contacts || []).length === 0 && /No contacts match/.test(r.message || ''), `message: ${r.message}`)
}

// 1e. The name a person actually types: two words with a middle name between them in the
//     stored value. A contiguous-substring match returns nothing here.
{
  const { env } = makeEnv()
  const r = await executeTool('search_contacts', { ...CALLER, query: 'Olve Storås' }, env)
  check('a partial name finds the full one ("Olve Storås" -> "Olve Aleksander Storås")',
    (r.contacts || []).some(c => c._id === OLVE_ID), `got ${JSON.stringify((r.contacts || []).map(c => c.full_name))}`)
  const rec = await executeTool('list_recordings', { ...CALLER, query: 'Olve Storås', limit: 20 }, env)
  check('list_recordings matches the same partial name',
    (rec.recordings || []).length === 3, `got ${(rec.recordings || []).length}`)
}

// 1d. Against a drizzle-worker that does not know `search` yet (deploy order), the tool must
//     return nothing rather than the first rows of the table dressed up as matches.
{
  const { env } = makeEnv({ ignoreSearch: true })
  const r = await executeTool('search_contacts', { ...CALLER, query: 'Olve Aleksander Storås' }, env)
  check('an unfiltered page is never passed off as matches',
    (r.contacts || []).every(c => /olve/i.test(c.full_name)), `got ${JSON.stringify((r.contacts || []).map(c => c.full_name))}`)
}

// 2. Every contact recording is listed, including one older than the newest 200 logs.
{
  const { env, queries } = makeEnv()
  const r = await executeTool('list_recordings', { ...CALLER, query: 'Olve Aleksander Storås', limit: 20 }, env)
  const urls = (r.recordings || []).map(x => x.audioUrl)
  check('list_recordings returns all three of the contact\'s recordings',
    olveLogs.every(l => urls.includes(l.recording_url)), `got ${JSON.stringify(urls)}`)
  check('list_recordings asks Drizzle for the rows that have a recording',
    queries.some(q => q.tableId === LOGS_TABLE && Array.isArray(q.notEmpty) && q.notEmpty.includes('recording_url')),
    `queries: ${JSON.stringify(queries.filter(q => q.tableId === LOGS_TABLE))}`)
  check('every recordingId carries the log id, never "undefined"',
    (r.recordings || []).every(x => /^contactlog:log-/.test(x.recordingId)),
    `ids: ${JSON.stringify((r.recordings || []).map(x => x.recordingId))}`)
}

// 3. The recordingId list_recordings hands out resolves back to its audio.
{
  const { env } = makeEnv()
  const r = await executeTool('transcribe_audio', { ...CALLER, recordingId: 'contactlog:log-jun' }, env)
  check('transcribe_audio resolves a contactlog recordingId to its URL',
    r.audioUrl === 'https://audio.vegvisr.org/norwegian-audio/jun.webm', `got ${JSON.stringify(r).slice(0, 200)}`)
}

// 4. The interaction history IS the answer: the entries, the real total, and a truncation
//    that says it is one. The agent answered "list all interactions" with 2 audio files
//    while the contact had 10 logged interactions (2026-09-30).
{
  const { env } = makeEnv()
  const full = await executeTool('get_contact_logs', { ...CALLER, contactId: OLVE_ID }, env)
  check('get_contact_logs returns the contact\'s 10 interactions', (full.logs || []).length === 10, `got ${(full.logs || []).length}`)
  check('get_contact_logs counts the entries that have audio', full.withRecording === 3, `got ${full.withRecording}`)
  check('the message IS the history — dated entries with their type',
    /10 logged interactions/.test(full.message || '') && /2026-08-12 07:57 · Zoom · audio/.test(full.message || ''),
    `message: ${(full.message || '').slice(0, 300)}`)
  check('HTML from the calendar import is flattened in the preview',
    /Olve Aleksander 1-1 med Tor Arne/.test(full.message || '') && !/<p>/.test(full.message || ''),
    `message: ${(full.message || '').slice(0, 300)}`)
  const r = await executeTool('get_contact_logs', { ...CALLER, contactId: OLVE_ID, limit: 4 }, env)
  check('a truncated history says it is truncated',
    r.total === 10 && r.returned === 4 && /showing the 4 newest/.test(r.message || ''), `message: ${(r.message || '').slice(0, 200)}`)
}

// 5. The search result states how much history each hit has, so an audio list can never
//    be passed off as the whole history.
{
  const { env } = makeEnv()
  const r = await executeTool('search_contacts', { ...CALLER, query: 'Olve Storås' }, env)
  check('search_contacts states the interaction count next to the contact',
    /10 logged interactions \(3 with audio\)/.test(r.message || ''), `message: ${(r.message || '').slice(0, 300)}`)
  check('search_contacts tells the agent to call get_contact_logs itself',
    /call \s*get_contact_logs[^]*NOW/.test(r.message || '') && /do not tell the user/.test(r.message || ''),
    `message: ${(r.message || '').slice(0, 400)}`)
}

// 6. add_contact_log writes a type the Contacts app actually renders.
{
  const defs = await import(path.join(tmp, 'tool-definitions.js'))
  const t = defs.TOOL_DEFINITIONS.find(d => d.name === 'add_contact_log')
  const APP_TYPES = ['Meeting', 'Phone Call', 'Zoom', 'Email', 'Message', 'Note', 'Other']
  const en = t?.input_schema?.properties?.contact_type?.enum || []
  check('add_contact_log offers the Contacts app\'s own interaction types',
    APP_TYPES.every(x => en.includes(x)) && en.length === APP_TYPES.length, `enum: ${JSON.stringify(en)}`)
}

if (failures) { console.error(`\nFAILED — ${failures} check(s)`); process.exit(1) }
console.log('\nPASS — a contact and their whole history are reachable: search runs in SQL and matches a partial name, every recording-bearing log is read, recordingIds resolve, get_contact_logs returns the interactions themselves, and a truncated list says it is truncated.')
