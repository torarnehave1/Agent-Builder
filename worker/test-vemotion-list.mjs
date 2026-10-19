// vemotion_list_compositions follows the worker's cursor (2026-10-19).
//
// GET /vemotion/compositions pages through every user's KV keys in id order and keeps the caller's,
// so the first page held only old ids: a composition saved today was neither listed nor found by
// name. The executor must read every page and list newest first.
//
// Run:  node worker/test-vemotion-list.mjs   (exit 0 = pass, 1 = fail)
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vemotion-list-'))
for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')
fs.symlinkSync(path.join(dir, 'node_modules'), path.join(tmp, 'node_modules'))
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))

let failures = 0
const check = (name, ok, msg) => { if (ok) console.log(`ok    ${name}`); else { failures++; console.error(`FAIL  ${name}\n      ${msg}`) } }

// Three pages; the newest composition is on the last one.
const pages = {
  '': { compositions: [{ id: 'comp_old1', name: 'Old one', updatedAt: '2026-05-01T00:00:00Z' }], cursor: 'c2' },
  c2: { compositions: [], cursor: 'c3' },
  c3: { compositions: [{ id: 'comp_new', name: 'Agent test — NORDLYS', updatedAt: '2026-10-19T20:00:00Z' }], cursor: null },
}
const calls = []
const env = { VEMOTION_WORKER: { fetch: async (url) => {
  const cursor = new URL(url).searchParams.get('cursor') || ''
  calls.push(cursor)
  return { status: 200, text: async () => JSON.stringify({ ok: true, ...pages[cursor] }) }
} } }

const all = await executeTool('vemotion_list_compositions', { authToken: 't' }, env)
check('reads every page', JSON.stringify(calls) === JSON.stringify(['', 'c2', 'c3']), `cursors requested: ${JSON.stringify(calls)}`)
check('newest first', all.compositions[0]?.compositionId === 'comp_new', JSON.stringify(all.compositions))
const found = await executeTool('vemotion_list_compositions', { authToken: 't', query: 'nordlys' }, env)
check('a composition on a later page is found by name', found.count === 1 && found.compositions[0].compositionId === 'comp_new', JSON.stringify(found))
const capped = await executeTool('vemotion_list_compositions', { authToken: 't', limit: 1 }, env)
check('limit keeps the newest and says how many exist', capped.count === 1 && capped.total === 2 && /2 composition/.test(capped.message), JSON.stringify(capped))

fs.unlinkSync(path.join(tmp, 'node_modules'))
fs.rmSync(tmp, { recursive: true, force: true })
if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nAll vemotion list checks passed.')
