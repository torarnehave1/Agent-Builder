// Regression guard: publish_html_node's VERSION PILL (2026-09-21).
//
// The architect asked for a visible pill to tell test.nibi.no and minside.nibi.no apart — two
// html-nodes in one graph, both published. The pill is injected into the SERVED copy only, shows
// host · graph version · publish time, and carries node id, graph id and a content fingerprint.
// It is remembered per host like the login gate.
//
// Drives the REAL executor through executeTool: in-memory KG worker (getknowgraph + patchNode with
// version bumps), a fake World brand proxy behind globalThis.fetch that stores what is published.
//
// Run:  node worker/test-publish-version-pill.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-pill-'))
for (const f of fs.readdirSync(dir)) {
  if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
}
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')
fs.symlinkSync(path.join(dir, 'node_modules'), path.join(tmp, 'node_modules'))
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))

let failures = 0
const check = (name, cond, detail) => {
  if (cond) console.log(`ok    ${name}`)
  else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) }
}

const GRAPH = '6e1f12f1-53b8-4d5f-8c9c-9a88135ad0ad'
const PAGE = (tag) => `<!doctype html><html><head><title>${tag}</title></head><body><h1>${tag}</h1><vegvisr-auth require-auth app-name="NIBI Min side" lang="no"></vegvisr-auth><script src="https://api.vegvisr.org/components/vegvisr-auth.js" defer></script></body></html>`
const TEST_HTML = PAGE('NIBI test')
const MINSIDE_HTML = PAGE('NIBI min side')

function makeEnv() {
  const graph = {
    metadata: { title: 'NIBI members', version: 31 },
    nodes: [
      { id: 'nibi-members-page', type: 'html-node', label: 'Min side', info: MINSIDE_HTML, bibl: ['https://minside.nibi.no/'], metadata: {} },
      { id: 'nibi-members-page-chat-workspace-test', type: 'html-node', label: 'Test', info: TEST_HTML, bibl: ['https://test.nibi.no/'], metadata: {} },
    ],
    edges: [],
  }
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const KG_WORKER = {
    async fetch(url, init = {}) {
      const u = new URL(url)
      if (u.pathname === '/getknowgraph') return json(JSON.parse(JSON.stringify(graph)))
      if (u.pathname === '/patchNode') {
        const b = JSON.parse(init.body)
        const n = graph.nodes.find((x) => x.id === b.nodeId)
        Object.assign(n, b.fields)
        graph.metadata.version += 1
        return json({ success: true, newVersion: graph.metadata.version })
      }
      return json({ error: 'not found' }, 404)
    },
  }
  const store = {}
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url)
    if (u.pathname === '/__html/publish') {
      const b = JSON.parse(init.body)
      store[b.hostname] = { html: b.html, nodeId: b.nodeId }
      return json({ ok: true })
    }
    if (u.pathname === '/__html/check') {
      const h = u.searchParams.get('hostname')
      return json({ ok: true, hostname: h, exists: !!store[h], metadata: store[h] ? { graphId: GRAPH, nodeId: store[h].nodeId } : null })
    }
    return new Response('', { status: 200 })
  }
  const env = { KG_WORKER, HTML_PUBLISH_SECRET: 'test-secret' }
  return { env, graph, store }
}

const OWNER = { userId: 'owner-uuid', authContext: { role: 'Superadmin', email: 'owner@example.com' } }
const sha8 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 8)

// 1. Pill on for test.nibi.no: served copy carries it, the node does not.
{
  const { env, graph, store } = makeEnv()
  const r = await executeTool('publish_html_node', { ...OWNER, graphId: GRAPH, nodeId: 'nibi-members-page-chat-workspace-test', host: 'test.nibi.no', version_pill: true }, env)
  const served = store['test.nibi.no']?.html || ''
  check('publish succeeds and is verified', r.success === true && r.verified === true, JSON.stringify(r).slice(0, 400))
  check('served copy has exactly one pill, before </body>', served.split('<!-- vegvisr-version-pill -->').length === 2 && /<\/details><!-- \/vegvisr-version-pill --><\/body>/.test(served), served.slice(-600))
  check('pill shows host · graph version it was published from', /<summary[^>]*>test\.nibi\.no · v31 · \d\d\.\d\d \d\d:\d\d<\/summary>/.test(served), (served.match(/<summary[^>]*>[^<]*<\/summary>/) || [''])[0])
  check('pill carries node id, graph id and the node HTML fingerprint', served.includes('node nibi-members-page-chat-workspace-test') && served.includes(`graf ${GRAPH} v31`) && served.includes(`innhold ${sha8(TEST_HTML)}`), served.slice(-700))
  check('node.info in the graph stays clean', !graph.nodes[1].info.includes('vegvisr-version-pill'), graph.nodes[1].info.slice(-200))
  check('setting is remembered per host on the node', graph.nodes[1].metadata.publishVersionPill?.['test.nibi.no'] === true, JSON.stringify(graph.nodes[1].metadata))
  check('result names the pill', r.version_pill?.fingerprint === sha8(TEST_HTML) && /Version pill ON: test\.nibi\.no · v31 · node nibi-members-page-chat-workspace-test · innhold [0-9a-f]{8}\./.test(r.message), r.message)

  // 2. Plain republish (version_pill omitted) keeps the pill; still exactly one.
  const again = await executeTool('publish_html_node', { ...OWNER, graphId: GRAPH, nodeId: 'nibi-members-page-chat-workspace-test', host: 'test.nibi.no' }, env)
  const served2 = store['test.nibi.no']?.html || ''
  check('republish without version_pill keeps it (one pill)', again.success === true && served2.split('<!-- vegvisr-version-pill -->').length === 2 && /kept from the previous publish/.test(again.message), again.message)

  // 3. version_pill:false removes it and forgets the setting.
  const off = await executeTool('publish_html_node', { ...OWNER, graphId: GRAPH, nodeId: 'nibi-members-page-chat-workspace-test', host: 'test.nibi.no', version_pill: false }, env)
  check('version_pill:false removes the pill and the stored setting', off.success === true && !store['test.nibi.no'].html.includes('vegvisr-version-pill') && !graph.nodes[1].metadata.publishVersionPill?.['test.nibi.no'], JSON.stringify(graph.nodes[1].metadata))
}

// 4. Two nodes → two different pills (the architect's use: tell test from min side).
{
  const { env, store } = makeEnv()
  await executeTool('publish_html_node', { ...OWNER, graphId: GRAPH, nodeId: 'nibi-members-page-chat-workspace-test', host: 'test.nibi.no', version_pill: true }, env)
  await executeTool('publish_html_node', { ...OWNER, graphId: GRAPH, nodeId: 'nibi-members-page', host: 'minside.nibi.no', version_pill: true }, env)
  const t = store['test.nibi.no'].html, m = store['minside.nibi.no'].html
  const fp = (s) => (s.match(/data-fingerprint="([0-9a-f]{8})"/) || [])[1]
  check('test and min side pills differ by host, node and fingerprint', fp(t) === sha8(TEST_HTML) && fp(m) === sha8(MINSIDE_HTML) && fp(t) !== fp(m) && m.includes('minside.nibi.no · v') && m.includes('node nibi-members-page<'), `${fp(t)} ${fp(m)}`)
}

// 5. Without version_pill and nothing stored, no pill is added (default unchanged).
{
  const { env, store } = makeEnv()
  const r = await executeTool('publish_html_node', { ...OWNER, graphId: GRAPH, nodeId: 'nibi-members-page', host: 'minside.nibi.no' }, env)
  check('default publish adds no pill', r.success === true && !store['minside.nibi.no'].html.includes('vegvisr-version-pill') && r.version_pill === null, JSON.stringify(r).slice(0, 300))
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(failures ? `\n${failures} FAILED` : '\nPASS — version pill is served-copy only, per host, and tells two published nodes apart.')
process.exit(failures ? 1 : 0)
