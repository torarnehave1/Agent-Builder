// Every KG_WORKER call from a tool names the chat user (G5, 2026-10-15).
//
// The knowledge-graph worker serves a graph stored in a World's own account only to that World's
// founder or a Superadmin, and learns who is asking from x-acting-user-email on the service
// binding. This drives the REAL executeTool with a recording KG_WORKER and checks that the header
// carries the authenticated user's email — resolved from input.userId, never from a tool argument
// — and that create_graph forwards world.
//
// Run:  node worker/test-acting-user.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { DatabaseSync } from 'node:sqlite'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acting-user-'))
for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')
fs.symlinkSync(path.join(dir, 'node_modules'), path.join(tmp, 'node_modules'))
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))

let failures = 0
const check = (name, cond, detail) => {
  if (cond) console.log(`ok    ${name}`)
  else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) }
}

function makeEnv() {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE config (user_id TEXT, email TEXT, Role TEXT, bio TEXT, profileimage TEXT, phone TEXT, phone_verified_at TEXT, data TEXT)`)
  db.prepare(`INSERT INTO config (user_id, email, Role) VALUES ('stine-uuid', 'Stine.Oksvold@gmail.com', 'Admin')`).run()
  const DB = {
    prepare(sql) {
      let args = []
      const stmt = {
        bind(...a) { args = a; return stmt },
        async first() { return db.prepare(sql).get(...args) ?? null },
        async all() { return { results: db.prepare(sql).all(...args) } },
        async run() { db.prepare(sql).run(...args); return { success: true } },
      }
      return stmt
    },
  }
  const calls = []
  const KG_WORKER = {
    async fetch(input, init = {}) {
      const req = input instanceof Request ? input : new Request(input, init)
      const body = req.method === 'POST' ? await req.clone().text() : ''
      calls.push({ url: req.url, acting: req.headers.get('x-acting-user-email'), body })
      if (req.url.includes('/saveGraphWithHistory')) {
        const b = JSON.parse(body)
        return new Response(JSON.stringify({ id: b.id, newVersion: 1, ...(b.world ? { world: b.world } : {}) }), { status: 200 })
      }
      if (req.url.includes('/getknowgraph')) {
        return new Response(JSON.stringify({ metadata: { title: 'T', version: 1 }, nodes: [], edges: [] }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    },
  }
  return { env: { DB, KG_WORKER }, calls }
}

// 1. create_graph with world, as a user identified only by uuid.
{
  const { env, calls } = makeEnv()
  const r = await executeTool('create_graph', { userId: 'stine-uuid', title: 'Strikkeskolen', metaArea: '#STINE', world: 'Sodesign.no' }, env)
  const save = calls.find((c) => c.url.includes('/saveGraphWithHistory'))
  check('the save names the chat user, resolved from the uuid and lowercased', save?.acting === 'stine.oksvold@gmail.com', JSON.stringify(save))
  check('world is forwarded, lowercased', JSON.parse(save?.body || '{}').world === 'sodesign.no', save?.body)
  check('the result says where it is stored and links to the editor', r.world === 'sodesign.no' && /editor\.vegvisr\.org\/\?graphId=/.test(r.viewUrl) && /sodesign\.no's own storage/.test(r.message), JSON.stringify(r))
}

// 2. Without world: unchanged body, viewer link, but the user is still named.
{
  const { env, calls } = makeEnv()
  const r = await executeTool('create_graph', { userId: 'stine-uuid', title: 'Plattform' }, env)
  const save = calls.find((c) => c.url.includes('/saveGraphWithHistory'))
  check('no world key when none is asked for', !('world' in JSON.parse(save.body)), save.body)
  check('platform graph keeps the gnew-viewer link', /gnew-viewer\?graphId=/.test(r.viewUrl) && !r.world, JSON.stringify(r))
  check('the user is named on platform calls too', save.acting === 'stine.oksvold@gmail.com', JSON.stringify(save))
}

// 3. Reads carry it as well.
{
  const { env, calls } = makeEnv()
  await executeTool('read_graph', { userId: 'stine-uuid', graphId: 'abc' }, env)
  check('read_graph names the user', calls.length > 0 && calls.every((c) => c.acting === 'stine.oksvold@gmail.com'), JSON.stringify(calls))
}

// 4. No identity: nothing invented.
{
  const { env, calls } = makeEnv()
  await executeTool('read_graph', { graphId: 'abc' }, env)
  check('without a user there is no acting header', calls.length > 0 && calls.every((c) => c.acting === null), JSON.stringify(calls))
}
{
  const { env, calls } = makeEnv()
  await executeTool('read_graph', { userId: 'unknown-uuid', graphId: 'abc' }, env)
  check('an unknown user id names nobody', calls.every((c) => c.acting === null), JSON.stringify(calls))
}

// 5. A tool argument cannot choose the identity.
{
  const { env, calls } = makeEnv()
  await executeTool('read_graph', { userId: 'stine-uuid', graphId: 'abc', email: 'root@example.com', actingUserEmail: 'root@example.com' }, env)
  check('arguments named like an identity are ignored', calls.every((c) => c.acting === 'stine.oksvold@gmail.com'), JSON.stringify(calls))
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nall acting-user checks pass')
