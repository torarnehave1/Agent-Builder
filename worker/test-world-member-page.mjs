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
  const store = new Map()
  const WORLD_TEMPLATES = {
    async get(key) { return store.has(key) ? store.get(key) : null },
    async put(key, value) { store.set(key, value) },
    async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) } },
  }
  return { env: { KG_WORKER, DB, WORLD_TEMPLATES }, graphs, store }
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

// 4. The template is DATA: a stored copy wins over the bundled seed, and the build says which it used.
{
  const { env, graphs, store } = makeEnv()
  const seed = await executeTool('create_world_member_page', { ...CALLER, domain: 'vegr.ai' }, env)
  check('with nothing stored the bundled seed is used and named', seed.success === true && page(graphs, seed.graphId).metadata.worldMemberPage.templateSource === 'bundled seed', JSON.stringify(page(graphs, seed.graphId).metadata.worldMemberPage))

  // What save_world_founder_template would have written — the template with its placeholders intact.
  const stored = page(graphs, seed.graphId).info
    .replace("const worldDomain = 'vegr.ai'", "const worldDomain = '{{WORLD_DOMAIN}}'")
    .replace('<body', '<body data-from-store="yes"')
  store.set('template:world-member-page', stored)

  const fromStore = await executeTool('create_world_member_page', { ...CALLER, domain: 'vegr.ai' }, env)
  const storedNode = page(graphs, fromStore.graphId)
  check('a stored template is used instead of the bundle', fromStore.success === true && storedNode.info.includes('data-from-store="yes"') && storedNode.metadata.worldMemberPage.templateSource === 'stored', JSON.stringify(storedNode.metadata.worldMemberPage))
  check('the stored template is still filled with the World values', storedNode.info.includes("const worldDomain = 'vegr.ai'") && !/\{\{[A-Z_]+\}\}/.test(storedNode.info), 'placeholders left')

  // A stored copy that is not a template (no placeholders) must not be served as one.
  store.set('template:world-member-page', '<html>not a template</html>')
  const junk = await executeTool('create_world_member_page', { ...CALLER, domain: 'vegr.ai' }, env)
  check('a stored copy that is not a template falls back to the seed', junk.success === true && page(graphs, junk.graphId).metadata.worldMemberPage.templateSource === 'bundled seed', JSON.stringify(page(graphs, junk.graphId).metadata.worldMemberPage))

  const listed = await env.WORLD_TEMPLATES.list({ prefix: 'template:world-' })
  check('the member template sits under the prefix the backup tool reads', listed.keys.some(k => k.name === 'template:world-member-page'), JSON.stringify(listed.keys))
}

// 5. A rebuild carries the founder's own edits instead of discarding them.
{
  const { env, graphs } = makeEnv()
  const first = await executeTool('create_world_member_page', { ...CALLER, domain: 'vegr.ai', graphId: 'existing', overwrite: true }, env)
  check('page built into the existing graph', first.success === true, JSON.stringify(first).slice(0, 200))

  // What a founder's edit through replace_html_section leaves behind: a changed anchored region.
  const node0 = page(graphs, 'existing')
  const start = '<!-- edit:articles-heading:start -->'
  const end = '<!-- edit:articles-heading:end -->'
  const a = node0.info.indexOf(start), b = node0.info.indexOf(end)
  check('the template carries the anchors a founder edits', a !== -1 && b > a, 'anchors missing from the built page')
  node0.info = node0.info.slice(0, a + start.length) + '<h1>Founder wrote this</h1>' + node0.info.slice(b)

  const rebuilt = await executeTool('create_world_member_page', { ...CALLER, domain: 'vegr.ai', graphId: 'existing', overwrite: true }, env)
  const node = page(graphs, 'existing')
  check('the rebuild keeps the founder edit', rebuilt.success === true && node.info.includes('Founder wrote this'), 'edit lost on rebuild')
  check('and records which regions were carried', (node.metadata.worldMemberPage.carriedAnchors || []).includes('articles-heading'), JSON.stringify(node.metadata.worldMemberPage.carriedAnchors))
  check('the rest of the page still comes from the template', node.info.includes("const worldDomain = 'vegr.ai'") && node.info.includes('id="logout"'), 'template content missing')

  // Same edit again, then an explicit clean rebuild.
  const node1 = page(graphs, 'existing')
  const a1 = node1.info.indexOf(start), b1 = node1.info.indexOf(end)
  node1.info = node1.info.slice(0, a1 + start.length) + '<h1>Founder wrote this</h1>' + node1.info.slice(b1)
  const clean = await executeTool('create_world_member_page', { ...CALLER, domain: 'vegr.ai', graphId: 'existing', overwrite: true, discard_edits: true }, env)
  check('discard_edits gives a clean page from the template', clean.success === true && !page(graphs, 'existing').info.includes('Founder wrote this'), 'edit survived an explicit discard')
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(failures ? `\n${failures} FAILED` : '\nPASS — create_world_member_page builds a World page from the template with its own values, installs the chat package, hides tabs without content, prepares the gate, and refuses unknown Worlds, bad colours and accidental overwrites; the template is stored data with the bundle as a seed, and a rebuild carries the founder\'s anchored edits.')
process.exit(failures ? 1 : 0)
