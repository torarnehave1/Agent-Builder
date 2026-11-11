// add_contact_note (2026-11-11): a note on one contact is a contact_logs row of type 'Note'.
// The contact must exist in the caller's own table, and its name comes from that row —
// never from the input. Run: node worker/test-contact-note.mjs   (exit 0 = pass, 1 = fail)
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'contact-note-'))
for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))

let failures = 0
const check = (name, cond, detail) => { if (cond) console.log(`ok    ${name}`); else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) } }

function fakeEnv({ withLogs = true } = {}) {
  const inserts = []
  const contacts = [{ _id: 'c1', full_name: 'Thomas Berg' }]
  return {
    inserts,
    DRIZZLE_WORKER: {
      async fetch(url, init) {
        const u = new URL(url)
        if (u.pathname === '/tables') {
          const tables = [{ id: 'T-contacts', displayName: 'contacts' }]
          if (withLogs) tables.push({ id: 'T-logs', displayName: 'contact_logs' })
          return new Response(JSON.stringify({ tables }))
        }
        const body = JSON.parse(init.body)
        if (u.pathname === '/query') {
          const rows = contacts.filter(c => c._id === body.where?._id)
          return new Response(JSON.stringify({ records: rows }))
        }
        if (u.pathname === '/insert') { inserts.push(body); return new Response(JSON.stringify({ _id: 'L-new' })) }
        return new Response('no route', { status: 404 })
      },
    },
  }
}

{
  const env = fakeEnv()
  const r = await executeTool('add_contact_note', { userId: 'u1', contactId: 'c1', note: '  Ring tilbake fredag  ', contactName: 'Spoofed' }, env, {})
  check('returns success with the new log id', r.success === true && r.logId === 'L-new', JSON.stringify(r))
  check('name comes from the contact row, not the input', r.name === 'Thomas Berg', r.name)
  const rec = env.inserts[0]?.record || {}
  check('writes to the caller\'s contact_logs table', env.inserts[0]?.tableId === 'T-logs', JSON.stringify(env.inserts[0]))
  check('row is type Note with trimmed text', rec.contact_type === 'Note' && rec.notes === 'Ring tilbake fredag' && rec.contact_id === 'c1' && rec.contact_name === 'Thomas Berg', JSON.stringify(rec))
  check('row is timestamped', typeof rec.logged_at === 'string' && !Number.isNaN(Date.parse(rec.logged_at)), rec.logged_at)
}

for (const [name, input, re] of [
  ['unknown contact is refused', { userId: 'u1', contactId: 'nope', note: 'x' }, /No contact with id nope/],
  ['empty note is refused', { userId: 'u1', contactId: 'c1', note: '   ' }, /note is required/],
  ['missing contactId is refused', { userId: 'u1', note: 'x' }, /contactId is required/],
]) {
  const env = fakeEnv()
  let msg = ''
  try { await executeTool('add_contact_note', input, env, {}) } catch (e) { msg = e.message }
  check(name, re.test(msg) && env.inserts.length === 0, `error="${msg}", inserts=${env.inserts.length}`)
}

{
  const env = fakeEnv({ withLogs: false })
  let msg = ''
  try { await executeTool('add_contact_note', { userId: 'u1', contactId: 'c1', note: 'x' }, env, {}) } catch (e) { msg = e.message }
  check('no contact_logs table is refused, nothing written', /contact_logs table/.test(msg) && env.inserts.length === 0, msg)
}

fs.rmSync(tmp, { recursive: true, force: true })
if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nall add_contact_note checks passed')
