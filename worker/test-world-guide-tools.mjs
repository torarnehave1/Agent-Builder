// The tools behind setup-guide steps 6, 7, 10 and 11–16 answer with their step, so the traps written there reach
// the reader when the tool runs — on success and on failure. Drives the REAL executeTool for the
// failure path (no user context → refused before any network) and the wrapper for the success path.
//
// Run:  node worker/test-world-guide-tools.mjs   (exit 0 = pass, 1 = fail)
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'world-guide-tools-'))
for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')
fs.symlinkSync(path.join(dir, 'node_modules'), path.join(tmp, 'node_modules'))
const { executeTool, withWorldSetupGuide } = await import(path.join(tmp, 'tool-executors.js'))

let failures = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`ok    ${name}`)
  else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) }
}

const source = fs.readFileSync(path.join(dir, 'tool-executors.js'), 'utf8')
const map = source.match(/const WORLD_SETUP_GUIDE_STEP_FOR_TOOL = \{([\s\S]*?)\n\}/)?.[1] || ''
const pointed = new Set([...map.matchAll(/'(step-[a-z0-9-]+)'/g)].map(m => m[1]))
for (const step of ['step-06-mailbox', 'step-07-sending', 'step-10-verify', 'step-11-graph-store', 'step-12-editor-brand', 'step-13-homepage-redirect', 'step-14-commerce', 'step-15-media-cdn', 'step-16-courses']) {
  check(`a tool points at ${step}`, pointed.has(step))
}

// Failure path, through the real dispatcher: refused for want of a user, before any network.
const refused = await executeTool('set_world_brand', { domain: 'example.no', host: 'editor.example.no' }, {})
check('a refused set_world_brand still fails', refused.success === false, JSON.stringify(refused))
check('and carries step 12', refused.guide?.node_id === 'step-12-editor-brand', JSON.stringify(refused.guide))
check('and the error line names the guide', /Guide: 12 · Editoren/.test(refused.error || ''), refused.error)
check('the original reason is kept first', String(refused.error).startsWith('No user context'), refused.error)

const photos = await executeTool('provision_world_photos', { domain: 'example.no' }, {})
check('provision_world_photos carries step 15', photos.guide?.node_id === 'step-15-media-cdn', JSON.stringify(photos))

const dns = await executeTool('set_world_dns_records', { domain: 'example.no', records: [] }, {})
check('set_world_dns_records carries step 6', dns.guide?.node_id === 'step-06-mailbox', JSON.stringify(dns))
const pub = await executeTool('check_world_publish', { domain: 'example.no' }, {})
check('check_world_publish carries step 10', pub.guide?.node_id === 'step-10-verify', JSON.stringify(pub))

// add_email_account THROWS on refusal; a World sender's error still names step 7, a Gmail one does not.
const other = { success: true, message: 'x' }
const thrown = async (input) => { try { await executeTool('add_email_account', input, {}); return '' } catch (e) { return e.message } }
const world = await thrown({ email: 'post@example.no', accountType: 'cf-email-service' })
check('a refused World sender names step 7', /Guide: 7 · Gi verdenen rett til å sende/.test(world), world)
check('and keeps its own reason first', world.startsWith('No user context'), world)
const gmail = await thrown({ email: 'someone@gmail.com', accountType: 'gmail' })
check('a Gmail sender gets no World guide', gmail && !/Guide:/.test(gmail), gmail)
check('a Gmail success is left alone', withWorldSetupGuide('add_email_account', other, { accountType: 'gmail' }) === other)
const sender = withWorldSetupGuide('add_email_account', { success: true, message: 'added' }, { accountType: 'cf-email-service' })
check('a World sender success carries step 7', sender.guide?.node_id === 'step-07-sending', JSON.stringify(sender))

// Success path: the guide goes on the message, the line the chat shows.
const ok = withWorldSetupGuide('provision_world_graphs', { success: true, message: 'Graph store ready.' })
check('a success carries step 11', ok.guide?.node_id === 'step-11-graph-store')
check('and the message ends with the guide line', /\nGuide: 11 · Grafer/.test(ok.message), ok.message)
check('success is not touched otherwise', ok.success === true && ok.message.startsWith('Graph store ready.'))

// A result that already chose its own guide keeps it; an unmapped tool is left alone.
const own = { success: true, message: 'x', guide: { node_id: 'step-09-hosts-and-pages' } }
check('an existing guide is not overwritten', withWorldSetupGuide('setup_world_homepage', own) === own)
check('an unmapped tool is left alone', withWorldSetupGuide('create_graph', other) === other)
const twice = withWorldSetupGuide('set_world_redirect', withWorldSetupGuide('set_world_redirect', { success: true, message: 'm' }))
check('the line is added once', twice.message.split('Guide:').length === 2, twice.message)

console.log(failures ? `\n${failures} FAILED` : '\nPASS — steps 6, 7, 10 and 11–16 are each pointed at by the tools that do them, on success and on failure.')
process.exit(failures ? 1 : 0)
