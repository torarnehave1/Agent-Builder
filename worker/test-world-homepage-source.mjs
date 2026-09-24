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
  // A publish secret exists (anything not a template: key); templates do not, so option C still
  // reports "not found" rather than silently succeeding.
  const WORLD_TEMPLATES = { async get(key) { return String(key).startsWith('template:') ? null : 'publish-secret-value' } }
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

// 5. The door is chosen by what ANSWERS. On alivenesslab.net me.<domain> answered 530 for over an
// hour while the apex served fine, so publishing through a hard-coded me.<domain> would have failed
// the very run that had just succeeded.
{
  const { env, restore } = makeEnv()
  const realFetch = globalThis.fetch
  const asked = []
  globalThis.fetch = async (url, init) => {
    const u = String(url)
    if (u.includes('__html/check')) {
      asked.push(u)
      return u.includes('me.') ? new Response('error code: 530', { status: 530 }) : new Response(JSON.stringify({ exists: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (u.includes('__html/publish')) return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const r = await executeTool('setup_world_homepage', { ...CALLER, domain: 'alivenesslab.net', graphId: 'g-123', nodeId: 'home-1' }, env)
  globalThis.fetch = realFetch
  restore()
  check('a dead me. door does not fail the publish', r.success !== false, JSON.stringify(r).slice(0, 200))
  check('me. was tried first', asked.some(u => u.includes('me.alivenesslab.net')), JSON.stringify(asked))
  check('and the apex was used when me. did not answer', asked.some(u => u.includes('//alivenesslab.net')), JSON.stringify(asked))
}

// 6. When NO door answers, it is reported as routing, never as a credential problem — the agent
// replaced credentials and ran four repair tools over one 530 on 2026-09-24.
{
  const { env, restore } = makeEnv()
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url) => String(url).includes('__html/')
    ? new Response('error code: 530', { status: 530 })
    : new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  const r = await executeTool('setup_world_homepage', { ...CALLER, domain: 'alivenesslab.net', graphId: 'g-123', nodeId: 'home-1', proxy_url: 'https://x.invalid/__html/publish' }, env)
  globalThis.fetch = realFetch
  restore()
  check('no door answering is a failure', r.success === false, JSON.stringify(r).slice(0, 160))
  check('and it is called ROUTING', /ROUTING/.test(r.message || ''), r.message)
  check('and it says NOT to replace the token', /Do NOT replace the Cloudflare token/.test(r.message || ''), r.message)
  check('and it hands over a curl to check a host', /curl -o \/dev\/null/.test(r.message || ''), r.message)
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(failures ? `\n${failures} FAILED` : '\nPASS — setup_world_homepage asks which page to serve, and offers the active graph instead of demanding a pasted string.')
process.exit(failures ? 1 : 0)
