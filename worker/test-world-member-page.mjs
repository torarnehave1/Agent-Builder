// Regression guard: create_world_member_page (2026-09-23). A World's member page is built from the
// shared template with the World's own values, the chat package is installed into it, tabs the World
// has no content for are left empty, and nothing is published. In-memory KG + registry + registry DB.
//
// Run:  node worker/test-world-member-page.mjs   (exit 0 = pass)
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'world-member-'))
for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
fs.mkdirSync(path.join(tmp, 'templates'))
fs.copyFileSync(path.join(dir, 'templates/world-member-page.js'), path.join(tmp, 'templates/world-member-page.js'))
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')
fs.symlinkSync(path.join(dir, 'node_modules'), path.join(tmp, 'node_modules'))
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))

let failures = 0
const check = (name, cond, detail) => { if (cond) console.log(`ok    ${name}`); else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) } }
const BUNDLE = '/* chat-workspace 0.4.0 */ var VegvisrChatWorkspace = {}'
const SHA = crypto.createHash('sha256').update(BUNDLE).digest('hex')

function makeEnv() {
  const graphs = {
    '4072b898-f111-42a9-b5ca-0d901bb17d26': { metadata: { version: 60 }, nodes: [{ id: 'component-chat-workspace', label: 'chat-workspace', type: 'component', metadata: { delivery: 'embedded', version: '0.4.0', bundleSha256: SHA, releaseGraphId: 'rel', releaseNodeId: 'chat-workspace-0.4.0' } }] },
    rel: { metadata: { version: 1 }, nodes: [{ id: 'chat-workspace-0.4.0', metadata: { version: '0.4.0', bundle: BUNDLE, bundleSha256: SHA, source: { tag: 'chat-workspace-v0.4.0' } } }] },
    existing: { metadata: { version: 3 }, nodes: [{ id: 'member-page-vegr', type: 'html-node', info: '<html>old</html>', metadata: { publishGate: { 'other.host': { gate: true } } } }] },
  }
  const worlds = [
    { domain: 'vegr.ai', world_name: 'Vegr.ai', founder_email: 'post@vegr.ai', meta_area_tag: '#VEGR', main_chat_group_id: '19bf9960', created_at: 1 },
    { domain: 'lonely.example', world_name: 'Lonely', founder_email: 'chief@lonely.example', meta_area_tag: '#LONELY', main_chat_group_id: null, created_at: 2 },
  ]
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const KG_WORKER = { async fetch(url, init = {}) {
    const u = new URL(url)
    if (u.pathname === '/getknowgraph') { const g = graphs[u.searchParams.get('id')]; return g ? json(JSON.parse(JSON.stringify(g))) : json({ error: 'not found' }, 404) }
    if (u.pathname === '/saveGraphWithHistory') { const b = JSON.parse(init.body); graphs[b.id] = { metadata: { ...b.graphData.metadata, version: 1 }, nodes: b.graphData.nodes, edges: b.graphData.edges }; return json({ id: b.id, newVersion: 1 }) }
    if (u.pathname === '/addNode') { const b = JSON.parse(init.body); graphs[b.graphId].nodes.push(b.node); graphs[b.graphId].metadata.version += 1; return json({ success: true }) }
    if (u.pathname === '/patchNode') { const b = JSON.parse(init.body); Object.assign(graphs[b.graphId].nodes.find(n => n.id === b.nodeId), b.fields); graphs[b.graphId].metadata.version += 1; return json({ success: true, newVersion: graphs[b.graphId].metadata.version }) }
    return json({ error: 'unexpected ' + u.pathname }, 404)
  } }
  const DB = { prepare(sql) { return { bind(...values) { return { async first() {
    if (!sql.includes('world_founders')) return null
    return worlds.find(w => w.domain === values[0]) || null
  } } } } } }
  return { env: { KG_WORKER, DB }, graphs }
}
const CALLER = { userId: 'owner', authContext: { role: 'Superadmin', email: 'owner@example.com' } }
const page = (graphs, graphId, nodeId = 'member-page-vegr') => graphs[graphId].nodes.find(n => n.id === nodeId)

// 1. A registered World with only a chat: page built in a new graph, other tabs empty.
{
  const { env, graphs } = makeEnv()
  const r = await executeTool('create_world_member_page', { ...CALLER, domain: 'vegr.ai' }, env)
  check('builds the page and reports what to do next', r.success === true && r.host === 'minside.vegr.ai' && /create_subdomain/.test(r.message), JSON.stringify(r).slice(0, 400))
  const node = page(graphs, r.graphId)
  check('new graph holds one html-node named after the World', graphs[r.graphId].nodes.length === 1 && node.label === 'Vegr.ai | Min side' && node.type === 'html-node', JSON.stringify(graphs[r.graphId].metadata))
  check('no placeholder and no NIBI value left in the page', !/\{\{[A-Z_]+\}\}/.test(node.info) && !/NIBI(?!_REALTIME)|nibi\.no|post@nibi/.test(node.info), (node.info.match(/\{\{[A-Z_]+\}\}|NIBI(?!_REALTIME)|nibi\.no/g) || []).slice(0, 5).join(','))
  check("the World's own values are in the page", node.info.includes("const worldDomain = 'vegr.ai'") && node.info.includes("const worldName = 'Vegr.ai'") && node.info.includes("const worldTag = 'VEGR'") && node.info.includes("const founderEmail = 'post@vegr.ai'") && node.info.includes('<title>Vegr.ai | Min side</title>'), 'values missing')
  check('tabs without content are empty and reported', node.info.includes("const teamMeetingId = ''") && node.info.includes("const commonGraphId = ''") && node.info.includes("const personalGraphId = ''") && JSON.stringify(r.hiddenTabs) === JSON.stringify(['meeting', 'common', 'personal']), JSON.stringify(r.hiddenTabs))
  check('login gate prepared for minside.<domain>, page not published', node.metadata.publishGate['minside.vegr.ai'].gate === true && node.metadata.publishGate['minside.vegr.ai'].gateAppName === 'Vegr.ai Min side' && node.bibl[0] === 'https://minside.vegr.ai/', JSON.stringify(node.metadata.publishGate))
  check('the chat package is installed and stamped', r.chatWorkspace === '0.4.0' && node.metadata.chatWorkspace.version === '0.4.0' && node.info.includes(Buffer.from(BUNDLE, 'utf8').toString('base64')), JSON.stringify(node.metadata.chatWorkspace))
  check('e-mail alerts stay off unless asked for', node.info.includes("const worldAlerts = '' === '1'"), 'alerts flag wrong')
}

// 2. Everything given: values land in the page, no tab hidden.
{
  const { env, graphs } = makeEnv()
  const r = await executeTool('create_world_member_page', { ...CALLER, domain: 'vegr.ai', world_mark: 'VGR', brand_colour: '#123456', accent_colour: '#654321', team_meeting_id: 'meet-1', common_graph_id: 'common-1', personal_graph_id: 'personal-1', personal_user_id: 'user-1', email_alerts: true, section_types: { 'node-a': 'aktuelt' } }, env)
  const node = page(graphs, r.graphId)
  check('meeting, common and personal ids are used; nothing hidden', node.info.includes("const teamMeetingId = 'meet-1'") && node.info.includes("const commonGraphId = 'common-1'") && node.info.includes("const personalUserId = 'user-1'") && r.hiddenTabs.length === 0, JSON.stringify(r.hiddenTabs))
  check('brand colours and mark applied', node.info.includes('#123456') && node.info.includes('#654321') && node.info.includes('>VGR</span>') && node.color === '#123456', 'brand values missing')
  check('section order map and alert switches applied', node.info.includes('{"node-a":"aktuelt"}') && node.info.includes("const worldAlerts = '1' === '1'"), 'section types or alerts missing')
  check('alerts warning names the NIBI-only backend', r.warnings.some(w => /NIBI FELLES/.test(w)), JSON.stringify(r.warnings))
}

// 3. Guards: unknown World, bad colour, existing node, missing community group.
{
  const { env, graphs } = makeEnv()
  const unknown = await executeTool('create_world_member_page', { ...CALLER, domain: 'nowhere.example' }, env)
  check('unregistered World refused, pointing at register_world_founder', unknown.success === false && /register_world_founder/.test(unknown.error), unknown.error)
  const colour = await executeTool('create_world_member_page', { ...CALLER, domain: 'vegr.ai', brand_colour: 'green' }, env)
  check('a colour that is not hex is refused', colour.success === false && /hex/.test(colour.error), colour.error)
  const taken = await executeTool('create_world_member_page', { ...CALLER, domain: 'vegr.ai', graphId: 'existing' }, env)
  check('an existing page is not overwritten by accident', taken.success === false && /overwrite/.test(taken.error) && page(graphs, 'existing').info === '<html>old</html>', taken.error)
  const rebuilt = await executeTool('create_world_member_page', { ...CALLER, domain: 'vegr.ai', graphId: 'existing', overwrite: true }, env)
  const node = page(graphs, 'existing')
  check('overwrite rebuilds it and keeps other hosts in the gate', rebuilt.success === true && node.info.includes("const worldDomain = 'vegr.ai'") && node.metadata.publishGate['other.host'] && node.metadata.publishGate['minside.vegr.ai'], JSON.stringify(node.metadata.publishGate))
  const lonely = await executeTool('create_world_member_page', { ...CALLER, domain: 'lonely.example' }, env)
  check('a World without a community group is built, with a warning', lonely.success === true && lonely.warnings.some(w => /community group/.test(w)), JSON.stringify(lonely.warnings))
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(failures ? `\n${failures} FAILED` : '\nPASS — create_world_member_page builds a World page from the template with its own values, installs the chat package, hides tabs without content, prepares the gate, and refuses unknown Worlds, bad colours and accidental overwrites.')
process.exit(failures ? 1 : 0)
