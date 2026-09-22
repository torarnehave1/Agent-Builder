// Regression guard: setup_chat_workspace (2026-09-22, decisions 4B + A1). The registry entry
// chat-workspace names a release; the tool copies that bundle into a member page's embedded
// data URL only if its SHA-256 matches, stamps metadata.chatWorkspace, and changes nothing else.
// In-memory KG_WORKER; drives the real executor through executeTool.
//
// Run:  node worker/test-setup-chat-workspace.mjs   (exit 0 = pass)
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-chat-'))
for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')
fs.symlinkSync(path.join(dir, 'node_modules'), path.join(tmp, 'node_modules'))
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))

let failures = 0
const check = (name, cond, detail) => { if (cond) console.log(`ok    ${name}`); else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) } }
const sha = text => crypto.createHash('sha256').update(text).digest('hex')
const b64 = text => Buffer.from(text, 'utf8').toString('base64')
const V3 = '/* chat-workspace 0.3.0 — æøå */ var VegvisrChatWorkspace = {}'
const V2 = '/* chat-workspace 0.2.0 */ var VegvisrChatWorkspace = {}'
const page = bundle => `<html><body><script>\n  const workspaceComponent = "data:text/javascript;base64,${b64(bundle)}"\n</script></body></html>`

function makeEnv({ tamper = false } = {}) {
  const graphs = {
    '4072b898-f111-42a9-b5ca-0d901bb17d26': { metadata: { version: 60 }, nodes: [{ id: 'component-chat-workspace', label: 'chat-workspace', type: 'component', metadata: { delivery: 'embedded', version: '0.3.0', bundleSha256: sha(V3), releaseGraphId: 'rel', releaseNodeId: 'chat-workspace-0.3.0', source: { tag: 'chat-workspace-v0.3.0' } } }] },
    rel: { metadata: { version: 2 }, nodes: [
      { id: 'chat-workspace-0.2.0', metadata: { version: '0.2.0', bundle: V2, bundleSha256: sha(V2), source: { tag: 'chat-workspace-v0.2.0' } } },
      { id: 'chat-workspace-0.3.0', metadata: { version: '0.3.0', bundle: tamper ? V3 + ' ' : V3, bundleSha256: sha(V3), source: { tag: 'chat-workspace-v0.3.0' } } },
    ] },
    world: { metadata: { version: 7 }, nodes: [
      { id: 'members', type: 'html-node', info: page(V2), metadata: { publishGate: { 'minside.example': {} }, chatWorkspace: { version: '0.2.0', bundleSha256: sha(V2) } } },
      { id: 'plain', type: 'html-node', info: '<html><body>no chat</body></html>', metadata: {} },
    ] },
  }
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const KG_WORKER = { async fetch(url, init = {}) {
    const u = new URL(url)
    if (u.pathname === '/getknowgraph') { const g = graphs[u.searchParams.get('id')]; return g ? json(JSON.parse(JSON.stringify(g))) : json({ error: 'not found' }, 404) }
    if (u.pathname === '/patchNode') {
      const b = JSON.parse(init.body); const g = graphs[b.graphId]
      if (b.expectedVersion !== g.metadata.version) return json({ error: 'conflict', currentVersion: g.metadata.version }, 409)
      Object.assign(g.nodes.find(n => n.id === b.nodeId), b.fields); g.metadata.version += 1
      return json({ success: true, newVersion: g.metadata.version })
    }
    return json({ error: 'unexpected ' + u.pathname }, 404)
  } }
  return { env: { KG_WORKER }, graphs }
}
const CALLER = { userId: 'owner', authContext: { role: 'Superadmin', email: 'owner@example.com' } }
const decode = info => Buffer.from(info.match(/base64,([A-Za-z0-9+/=]*)"/)[1], 'base64').toString('utf8')

{
  const { env, graphs } = makeEnv()
  const r = await executeTool('setup_chat_workspace', { ...CALLER, graphId: 'world', nodeId: 'members' }, env)
  const node = graphs.world.nodes[0]
  check('installs the registered release', r.success === true && r.changed === true && r.version === '0.3.0' && r.previousVersion === '0.2.0', JSON.stringify(r).slice(0, 300))
  check('embedded copy is exactly the release bundle (UTF-8 intact)', decode(node.info) === V3, decode(node.info))
  check('stamps version, hash, source and release on the node; keeps other metadata', node.metadata.chatWorkspace.version === '0.3.0' && node.metadata.chatWorkspace.bundleSha256 === sha(V3) && node.metadata.chatWorkspace.release.nodeId === 'chat-workspace-0.3.0' && node.metadata.publishGate['minside.example'], JSON.stringify(node.metadata))
  check('says it is not published yet', /publish/i.test(r.message), r.message)
  const again = await executeTool('setup_chat_workspace', { ...CALLER, graphId: 'world', nodeId: 'members' }, env)
  check('second run changes nothing', again.success === true && again.changed === false && graphs.world.metadata.version === 8, JSON.stringify(again))
  const back = await executeTool('setup_chat_workspace', { ...CALLER, graphId: 'world', nodeId: 'members', version: '0.2.0' }, env)
  check('rollback to an earlier release', back.success === true && back.version === '0.2.0' && decode(graphs.world.nodes[0].info) === V2, JSON.stringify(back).slice(0, 200))
  const missing = await executeTool('setup_chat_workspace', { ...CALLER, graphId: 'world', nodeId: 'members', version: '9.9.9' }, env)
  check('unknown version refused with the available list', missing.success === false && /0\.2\.0, 0\.3\.0/.test(missing.error), missing.error)
  const plain = await executeTool('setup_chat_workspace', { ...CALLER, graphId: 'world', nodeId: 'plain' }, env)
  check('page without the workspace host is refused, untouched', plain.success === false && /no chat workspace host/.test(plain.error) && graphs.world.nodes[1].info.includes('no chat'), plain.error)
}
{
  const { env, graphs } = makeEnv({ tamper: true })
  const r = await executeTool('setup_chat_workspace', { ...CALLER, graphId: 'world', nodeId: 'members' }, env)
  check('bundle that does not match its hash is refused, page untouched', r.success === false && /does not match/.test(r.error) && decode(graphs.world.nodes[0].info) === V2, r.error)
}
{
  const { env } = makeEnv()
  const got = await executeTool('get_component', { name: 'chat-workspace' }, env)
  check('get_component reports the embedded release, no source', got.success === true && got.delivery === 'embedded' && got.version === '0.3.0' && !('impl' in got) && /setup_chat_workspace/.test(got.message), JSON.stringify(got).slice(0, 300))
  const ins = await executeTool('insert_component', { ...CALLER, graphId: 'world', nodeId: 'members', component: 'chat-workspace' }, env)
  check('insert_component refuses the embedded package', ins.success === false && /setup_chat_workspace/.test(ins.error), ins.error)
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(failures ? `\n${failures} FAILED` : '\nPASS — setup_chat_workspace installs only hash-verified registered releases, stamps the page, is idempotent, rolls back, and refuses pages without the host.')
process.exit(failures ? 1 : 0)
