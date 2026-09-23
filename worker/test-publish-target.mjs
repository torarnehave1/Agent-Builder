// publish_html_node must write to the proxy that ACTUALLY serves the host.
// vegr.ai became an own_account World on 2026-09-23 while still sitting in SHARED_BRAND_ZONES, so
// every publish went into the PLATFORM's KV, reported success, and never reached the live site.
// The registry — not a static list — decides.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-target-'))
for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
fs.cpSync(path.join(dir, 'templates'), path.join(tmp, 'templates'), { recursive: true })
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))

let failures = 0
const check = (name, cond, detail) => { if (cond) console.log(`ok    ${name}`); else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) } }

function makeEnv(worlds) {
  const calls = { binding: [], public: [] }
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const node = { id: 'page', type: 'html-node', info: '<html><body>hello</body></html>', metadata: {} }
  const KG_WORKER = { async fetch(url) {
    const u = new URL(url)
    if (u.pathname === '/getknowgraph') return json({ metadata: { version: 1 }, nodes: [node] })
    return json({ error: 'unexpected ' + u.pathname }, 404)
  } }
  const BRAND_WORKER = { async fetch(url, init) { calls.binding.push(JSON.parse(init.body).hostname); return json({ success: true }) } }
  // the shared path mints a publish token through api-worker; the World path uses its stored secret
  const API_WORKER = { async fetch() { return json({ success: true, token: 'minted' }) } }
  const secrets = new Map([['world-publish-secret:vegr.ai', 'world-secret']])
  const WORLD_TEMPLATES = { async get(key) { return secrets.get(key) ?? null }, async put(k, v) { secrets.set(k, v) } }
  const DB = { prepare(sql) { return { bind(...v) { return { async first() {
    if (!sql.includes('world_founders')) return null
    return worlds.find(w => w.domain === v[0]) || null
  } } } } } }
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url)
    if (u.includes('/__html/publish')) { calls.public.push(new URL(u).hostname); return json({ success: true }) }
    if (u.includes('/__html/check')) return json({ success: true, exists: true, length: 34 })
    return new Response('', { status: 200 })
  }
  return { env: { KG_WORKER, BRAND_WORKER, API_WORKER, WORLD_TEMPLATES, DB, INTERNAL_SHARED_SECRET: 's' }, calls, restore: () => { globalThis.fetch = realFetch } }
}

const CALLER = { userId: 'owner', authContext: { role: 'Superadmin', email: 'owner@example.com', authToken: 't', profile: { emailVerificationToken: 't' } } }

// 1. An own_account World is NEVER published through the shared binding, even when its zone is listed.
{
  const { env, calls, restore } = makeEnv([{ domain: 'vegr.ai', hosting_model: 'own_account' }])
  const r = await executeTool('publish_html_node', { ...CALLER, graphId: 'g', nodeId: 'page', host: 'minside.vegr.ai' }, env)
  restore()
  if (!r.success) console.error('      (tool said: ' + (r.error || '').slice(0, 220) + ')')
  check('own_account World: nothing written through the platform binding', calls.binding.length === 0, `binding calls: ${JSON.stringify(calls.binding)}`)
  check("own_account World: posted to the World's own proxy", calls.public.includes('minside.vegr.ai'), `public calls: ${JSON.stringify(calls.public)}`)
}

// 2. A central World on a shared zone still uses the binding.
{
  const { env, calls, restore } = makeEnv([{ domain: 'vegvisr.org', hosting_model: 'central' }])
  await executeTool('publish_html_node', { ...CALLER, graphId: 'g', nodeId: 'page', host: 'test.vegvisr.org' }, env)
  restore()
  check('central World on a shared zone: uses the platform binding', calls.binding.includes('test.vegvisr.org'), `binding: ${JSON.stringify(calls.binding)} public: ${JSON.stringify(calls.public)}`)
}

// 3. No registry row: the static list still decides, so nothing else changes.
{
  const { env, calls, restore } = makeEnv([])
  await executeTool('publish_html_node', { ...CALLER, graphId: 'g', nodeId: 'page', host: 'anything.vegvisr.org' }, env)
  restore()
  check('unregistered host on a shared zone: unchanged behaviour', calls.binding.includes('anything.vegvisr.org'), `binding: ${JSON.stringify(calls.binding)}`)
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(failures ? `\n${failures} FAILED` : '\nPASS — publish_html_node targets the proxy that serves the host: an own_account World goes to its own proxy, a central World keeps the shared binding.')
process.exit(failures ? 1 : 0)
