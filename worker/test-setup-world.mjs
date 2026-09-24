// setup_world runs the provisioning sequence server-side so the MODEL is not in the critical path.
// Every World before this was six pasted prompts with D1 checks between them, and the agent kept
// dropping arguments (cf_account_id three times, a token eight times in a row).
// What must hold: each step is verified by reading the system back, a finished step is skipped on a
// re-run, and anything needing a human STOPS with one instruction instead of writing half a World.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-world-'))
for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
fs.cpSync(path.join(dir, 'templates'), path.join(tmp, 'templates'), { recursive: true })
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))

let failures = 0
const check = (name, cond, detail) => { if (cond) console.log(`ok    ${name}`); else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) } }

const ACCOUNT = '077b2127436f8d047c000ecad69e4017'
const DOMAIN = 'alivenesslab.org'
const FOUNDER = 'alivenesslab.org@gmail.com'

// A tiny stand-in for the rows these tools read and write.
function makeEnv({ token = null, kv = null, world = null, domainRow = null } = {}) {
  const state = { token, kv, world, domainRow, calls: [] }
  const DB = { prepare(sql) { return { bind(...v) { return {
    async first() {
      if (sql.includes('FROM world_founders')) return state.world
      if (sql.includes('FROM domains')) return state.domainRow
      if (sql.includes('cf_kv_namespace_id FROM config')) return { cf_kv_namespace_id: state.kv }
      if (sql.includes('FROM config')) return { cf_account_id: state.world?.cf_account_id || null, cf_api_token: state.token }
      return null
    },
    async run() { state.calls.push(sql.trim().split('\n')[0]); return { success: true } },
    async all() { return { results: [] } },
  } } } } }
  return { env: { DB }, state }
}
const CALLER = { userId: 'owner', authContext: { role: 'Superadmin', email: 'owner@example.com' } }

// 1. Nothing stored yet: STOP at credentials with an instruction, and write nothing.
{
  const { env, state } = makeEnv({})
  const r = await executeTool('setup_world', { ...CALLER, domain: DOMAIN, founder_email: FOUNDER, cf_account_id: ACCOUNT }, env)
  check('stops at credentials when no token is stored', r.success === true && r.complete === false, JSON.stringify(r).slice(0, 220))
  check('the stop names what to create', /API token/i.test(r.next || ''), r.next)
  check('the stop lists the scopes needed', /Workers KV Storage/.test(r.next || '') && /DNS Edit/.test(r.next || ''), r.next)
  check('it says to run setup_world again', /setup_world/.test(r.message || ''), r.message)
  check('nothing was written while stopped', state.calls.length === 0, JSON.stringify(state.calls))
  check('the step list shows the pause, not a failure', r.steps?.some(s => s.step === 'credentials' && s.status === 'needs-you'), JSON.stringify(r.steps))
  // A pause must hand over the step of the setup guide that explains the human action.
  check('the pause points at the token step of the setup guide', r.guide?.node_id === 'step-02-token' && r.guide?.graph_id === 'b7f3a1d0-9c52-4e18-a6b4-3f5d8e2c7a91', JSON.stringify(r.guide))
  check('the guide reaches the user in the message', /gnew-viewer\?graphId=b7f3a1d0/.test(r.message || ''), r.message)
}

// 2. Rows disagree and no account id is known anywhere: STOP, write nothing.
{
  const { env, state } = makeEnv({
    token: 'cfat_x',
    world: { founder_email: FOUNDER, account_holder_email: FOUNDER, hosting_model: 'own_account', cf_account_id: null },
    domainRow: { hosting_model: 'central', cf_account_id: '5d9b2060ef095c777711a8649c24914e' },
  })
  const r = await executeTool('setup_world', { ...CALLER, domain: DOMAIN }, env)
  check('credentials already stored are skipped, not re-stored', r.steps?.some(s => s.step === 'credentials' && s.status === 'skipped'), JSON.stringify(r.steps))
  check('stops when no account id is known', r.complete === false && /account id/i.test(r.next || ''), JSON.stringify(r).slice(0, 220))
  check('a missing account id points at the account step', r.guide?.node_id === 'step-01-account', JSON.stringify(r.guide))
  check('half-written registry is not "fixed" blindly', state.calls.length === 0, JSON.stringify(state.calls))
}

// 2b. Same disagreeing rows, but the account id IS given: it registers and then VERIFIES the rows.
// The stand-in never updates them, which is exactly the phantom-success case — it must be caught.
{
  const { env } = makeEnv({
    token: 'cfat_x',
    world: { founder_email: FOUNDER, account_holder_email: FOUNDER, hosting_model: 'own_account', cf_account_id: null },
    domainRow: { hosting_model: 'central', cf_account_id: '5d9b2060ef095c777711a8649c24914e' },
  })
  const r = await executeTool('setup_world', { ...CALLER, domain: DOMAIN, cf_account_id: ACCOUNT }, env)
  check('a registry that still disagrees after the write is reported', r.success === false && /disagree/i.test(r.error || ''), JSON.stringify(r).slice(0, 300))
  check('and it does not continue to KV or proxy after that', !(r.steps || []).some(s => ['kv', 'proxy', 'publish-secret'].includes(s.step)), JSON.stringify(r.steps))
}

// 3. Missing domain / missing founder are refused up front.
{
  const { env } = makeEnv({})
  const noDomain = await executeTool('setup_world', { ...CALLER }, env)
  check('domain is required', noDomain.success === false && /domain is required/.test(noDomain.error || ''), noDomain.error)
  const noFounder = await executeTool('setup_world', { ...CALLER, domain: 'nowhere.example' }, env)
  check('an unregistered World needs founder_email', noFounder.success === false && /founder_email/.test(noFounder.error || ''), noFounder.error)
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(failures ? `\n${failures} FAILED` : '\nPASS — setup_world verifies each step against the system, skips what is already true, and stops with one instruction instead of writing half a World.')
process.exit(failures ? 1 : 0)
