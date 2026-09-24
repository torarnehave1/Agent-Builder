// setup_world_homepage must ASK where the page comes from instead of failing, and a node must be
// published through the normal path so the graph stays the source.
//
//     node test-world-homepage-source.mjs
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'world-homepage-'))
for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
fs.cpSync(path.join(dir, 'templates'), path.join(tmp, 'templates'), { recursive: true })
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))

let failures = 0
const check = (name, cond, detail) => { if (cond) console.log(`ok    ${name}`); else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) } }

const GRAPH = {
  metadata: { title: 'Aliveness Lab' },
  nodes: [
    { id: 'home-1', type: 'html-node', label: 'Forside', info: '<html><body>Hei</body></html>' },
    { id: 'note-1', type: 'fulltext', label: 'Notat', info: 'ikke en side' },
    { id: 'home-2', type: 'html-node', label: 'Kampanje', info: '<html><body>Kampanje</body></html>' },
  ],
}

function makeEnv() {
  // One row that satisfies both lookups: the caller's profile (Role) and the World's credentials.
  const ROW = {
    user_id: 'owner', email: 'alivenesslab.org@gmail.com', Role: 'Superadmin', role: 'Superadmin',
    founder_email: 'alivenesslab.org@gmail.com', hosting_model: 'own_account',
    cf_account_id: 'acct1', cf_api_token: 'tok1', cf_kv_namespace_id: 'kv1',
  }
  const DB = { prepare() { return { bind() { return {
    async first() { return ROW },
    async all() { return { results: [] } },
    async run() { return { success: true } },
  } } } } }
  const KG_WORKER = { async fetch() { return new Response(JSON.stringify(GRAPH), { status: 200, headers: { 'Content-Type': 'application/json' } }) } }
  const WORLD_TEMPLATES = { async get() { return null } }
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  return { env: { DB, KG_WORKER, WORLD_TEMPLATES }, restore: () => { globalThis.fetch = realFetch } }
}
const CALLER = { userId: 'owner', authContext: { role: 'Superadmin', email: 'owner@example.com' } }

// 1. No source given, with a Graph Context selected: ask, and offer what is in that graph.
{
  const { env, restore } = makeEnv()
  const r = await executeTool('setup_world_homepage', { ...CALLER, domain: 'alivenesslab.net', contextGraphId: 'g-123' }, env)
  restore()
  check('it asks instead of failing', r.success === true && r.complete === false && r.needs_choice === true, JSON.stringify(r).slice(0, 200))
  check('it offers the html-nodes of the active graph', (r.html_nodes || []).map(n => n.nodeId).join(',') === 'home-1,home-2', JSON.stringify(r.html_nodes))
  check('it does not offer a fulltext node as a page', !(r.html_nodes || []).some(n => n.nodeId === 'note-1'), JSON.stringify(r.html_nodes))
  check('the question names the apex', /alivenesslab\.net/.test(r.question || ''), r.question)
  check('the message lists the nodes by label', /Forside/.test(r.message || '') && /Kampanje/.test(r.message || ''), r.message)
  check('the message names the plain-string option too', /simple HTML string/.test(r.message || ''), r.message)
}

// 2. No source and no Graph Context: still asks, and says what it needs.
{
  const { env, restore } = makeEnv()
  const r = await executeTool('setup_world_homepage', { ...CALLER, domain: 'alivenesslab.net' }, env)
  restore()
  check('with no graph selected it still asks', r.needs_choice === true, JSON.stringify(r).slice(0, 160))
  check('and it says to pass graphId and nodeId', /pass graphId and nodeId/.test(r.message || ''), r.message)
}

// 3. A nodeId without any graph is refused rather than guessed at.
{
  const { env, restore } = makeEnv()
  const r = await executeTool('setup_world_homepage', { ...CALLER, domain: 'alivenesslab.net', nodeId: 'home-1' }, env)
  restore()
  check('a node with no graph is refused, not guessed', r.success === false && /graphId/.test(r.error || ''), JSON.stringify(r).slice(0, 200))
}

// 4. Inline html still works — the old path must not regress.
{
  const { env, restore } = makeEnv()
  const r = await executeTool('setup_world_homepage', { ...CALLER, domain: 'alivenesslab.net', html: '<html><body>Hei</body></html>' }, env)
  restore()
  check('inline html is not turned into a question', r.needs_choice !== true, JSON.stringify(r).slice(0, 160))
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(failures ? `\n${failures} FAILED` : '\nPASS — setup_world_homepage asks which page to serve, and offers the active graph instead of demanding a pasted string.')
process.exit(failures ? 1 : 0)
