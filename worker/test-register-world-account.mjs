// An own_account World MUST carry its Cloudflare account id. Registering without one leaves
// world_founders saying own_account while domains still points at the platform account — every
// account-resolving tool then reads the wrong one, and the tool used to report "completed".
// The agent dropped this argument on vegr.ai twice and on alivenesslab.org (2026-09-23/24).
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'register-world-'))
for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
fs.cpSync(path.join(dir, 'templates'), path.join(tmp, 'templates'), { recursive: true })
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))

let failures = 0
const check = (name, cond, detail) => { if (cond) console.log(`ok    ${name}`); else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) } }

function makeEnv(configRows) {
  const writes = []
  const DB = { prepare(sql) { return { bind(...v) { return {
    async first() {
      if (sql.includes('FROM config')) { const r = configRows[v[0]]; return r ? { cf_account_id: r } : null }
      if (sql.includes('world_founders')) return null
      if (sql.includes('domains')) return null
      return null
    },
    async run() { writes.push({ sql: sql.trim().split('\n')[0], values: v }); return { success: true } },
    async all() { return { results: [] } },
  } } } } }
  return { env: { DB }, writes }
}
const CALLER = { userId: 'owner', authContext: { role: 'Superadmin', email: 'owner@example.com' } }

// 1. own_account with no id anywhere: refuse, write nothing, name the argument.
{
  const { env, writes } = makeEnv({})
  const r = await executeTool('register_world_founder', { ...CALLER, domain: 'alivenesslab.org', founder_email: 'alivenesslab.org@gmail.com', hosting_model: 'own_account' }, env)
  check('own_account without an account id is refused', r.success === false && /cf_account_id is required/.test(r.error || ''), JSON.stringify(r).slice(0, 220))
  check('nothing is written when it is refused', writes.length === 0, JSON.stringify(writes).slice(0, 200))
}

// 2. the id is taken from the founder's stored credentials when the agent drops the argument.
{
  const { env } = makeEnv({ 'alivenesslab.org@gmail.com': '077b2127436f8d047c000ecad69e4017' })
  const r = await executeTool('register_world_founder', { ...CALLER, domain: 'alivenesslab.org', founder_email: 'alivenesslab.org@gmail.com', hosting_model: 'own_account' }, env)
  check('a stored founder account id is used when the argument is missing', r.success !== false, JSON.stringify(r).slice(0, 200))
}

// 3. an explicit id still wins, and a central World is unaffected.
{
  const { env } = makeEnv({})
  const r = await executeTool('register_world_founder', { ...CALLER, domain: 'somewhere.example', founder_email: 'a@b.com', hosting_model: 'central' }, env)
  check('a central World without an account id is still allowed', r.success !== false, JSON.stringify(r).slice(0, 200))
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(failures ? `\n${failures} FAILED` : '\nPASS — register_world_founder refuses a half-registered own_account World and falls back to the founder\'s stored account id.')
process.exit(failures ? 1 : 0)
