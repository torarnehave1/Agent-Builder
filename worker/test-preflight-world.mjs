// preflight_world must NAME the traps that cost real evenings, and must never write.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-world-'))
for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
fs.cpSync(path.join(dir, 'templates'), path.join(tmp, 'templates'), { recursive: true })
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))

let failures = 0
const check = (name, cond, detail) => { if (cond) console.log(`ok    ${name}`); else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) } }
const find = (r, name) => (r.checks || []).find(c => c.check === name)

function makeEnv({ world = null, domainRow = null, config = null } = {}) {
  const writes = []
  const DB = { prepare(sql) { return { bind(...v) { return {
    async first() {
      if (sql.includes('FROM world_founders')) return world
      if (sql.includes('FROM domains')) return domainRow
      if (sql.includes('FROM config')) return config
      return null
    },
    async run() { writes.push(sql); return { success: true } },
    async all() { return { results: [] } },
  } } } } }
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url) => String(url).includes('/user/tokens/verify')
    ? new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    : new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  return { env: { DB }, writes, restore: () => { globalThis.fetch = realFetch } }
}
const CALLER = { userId: 'owner', authContext: { role: 'Superadmin', email: 'owner@example.com' } }

// 1. Half-registered own_account World: the state alivenesslab.org was left in.
{
  const { env, writes, restore } = makeEnv({
    world: { founder_email: 'alivenesslab.org@gmail.com', hosting_model: 'own_account', cf_account_id: null },
    domainRow: { hosting_model: 'central', cf_account_id: '5d9b2060ef095c777711a8649c24914e' },
    config: { cf_account_id: null, cf_api_token: null, cf_kv_namespace_id: null },
  })
  const r = await executeTool('preflight_world', { ...CALLER, domain: 'alivenesslab.org' }, env)
  restore()
  check('a half-registered World is BLOCKED', r.verdict === 'BLOCKED', JSON.stringify(r).slice(0, 200))
  check('the registry check names the missing account id', /half-registered|NULL/.test(find(r, 'registry')?.detail || ''), JSON.stringify(find(r, 'registry')))
  check('the missing token is a failure', find(r, 'credentials')?.state === 'fail', JSON.stringify(find(r, 'credentials')))
  check('no page store is a failure', find(r, 'page-store')?.state === 'fail', JSON.stringify(find(r, 'page-store')))
  check('it says what to do first', Boolean(r.next), r.next)
  check('it writes nothing', writes.length === 0, JSON.stringify(writes))
  // The answer must point at the setup graph, at the STEP that explains this failure — not at the
  // top of a runbook the reader then has to search.
  check('the result points at the setup guide', r.guide?.graph_id === 'b7f3a1d0-9c52-4e18-a6b4-3f5d8e2c7a91', JSON.stringify(r.guide))
  check('the guide names a step', Boolean(r.guide?.step && r.guide?.node_id), JSON.stringify(r.guide))
  check('the missing token points at the token step', find(r, 'credentials')?.guide?.node_id === 'step-02-token', JSON.stringify(find(r, 'credentials')?.guide))
  check('the registry failure points at setup_world', find(r, 'registry')?.guide?.node_id === 'step-03-setup-world', JSON.stringify(find(r, 'registry')?.guide))
  check('the message carries the guide URL', /gnew-viewer\?graphId=b7f3a1d0/.test(r.message || ''), r.message)
}

// 2. A healthy own_account World.
{
  const { env, restore } = makeEnv({
    world: { founder_email: 'post@nibi.no', hosting_model: 'own_account', cf_account_id: 'e458403763ce460e42d1c87896cfc7e9' },
    domainRow: { hosting_model: 'own_account', cf_account_id: 'e458403763ce460e42d1c87896cfc7e9' },
    config: { cf_account_id: 'e458403763ce460e42d1c87896cfc7e9', cf_api_token: 'cfat_live', cf_kv_namespace_id: 'kv123' },
  })
  const r = await executeTool('preflight_world', { ...CALLER, domain: 'nibi.no' }, env)
  restore()
  check('registry agreeing passes', find(r, 'registry')?.state === 'pass', JSON.stringify(find(r, 'registry')))
  check('a live token passes', find(r, 'credentials')?.state === 'pass', JSON.stringify(find(r, 'credentials')))
  check('a provisioned page store passes', find(r, 'page-store')?.state === 'pass', JSON.stringify(find(r, 'page-store')))
  check('nibi.no is not flagged as a platform zone', find(r, 'platform-zone-lists')?.state === 'pass', JSON.stringify(find(r, 'platform-zone-lists')))
  check('a passing check is not cluttered with a guide', !find(r, 'registry')?.guide, JSON.stringify(find(r, 'registry')))
  // With no failures the reader is sent to the zone move; with failures, to the step that explains
  // the FIRST one. This stub World has no proxy, so it is the second case.
  const firstFail = (r.checks || []).find(c => c.state === 'fail')
  check('the guide follows the first failure, or the zone move when there is none',
    r.guide?.node_id === (firstFail ? firstFail.guide.node_id : 'step-08-zone-move'),
    JSON.stringify({ firstFail: firstFail?.check, guide: r.guide?.node_id }))
}

// 3. domain is required.
{
  const { env, restore } = makeEnv({})
  const r = await executeTool('preflight_world', { ...CALLER }, env)
  restore()
  check('domain is required', r.success === false && /domain is required/.test(r.error || ''), r.error)
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(failures ? `\n${failures} FAILED` : '\nPASS — preflight_world names the half-registered World, the missing credentials and the missing infrastructure, and writes nothing.')
process.exit(failures ? 1 : 0)
