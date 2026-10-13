// deploy_worker_guarded must never upload over a worker that has bindings.
//
// A Cloudflare script upload replaces the whole binding set, and executeDeployWorker sends only
// the bindings it sets itself. Reached from the MCP server, a model naming knowledge-graph-worker
// would deploy "successfully" and leave it without D1, KV or secrets. The guard reads the target
// first and fails closed.
//
//     node test-deploy-worker-guard.mjs
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-guard-'))
for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
fs.cpSync(path.join(dir, 'templates'), path.join(tmp, 'templates'), { recursive: true })
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))

let failures = 0
const check = (name, cond, detail) => { if (cond) console.log(`ok    ${name}`); else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) } }

const ROOT = { userId: 'owner', authContext: { authenticated: true, role: 'Superadmin', email: 'owner@example.com' } }
const ENV = { CLOUDFLARE_API_TOKEN: 'test-token', CF_ACCOUNT_ID: 'acct' }
const CODE = 'export default { fetch() { return new Response("hi") } }'

/** Replace global fetch with a Cloudflare API that answers `settings` as told and records the rest. */
function cloudflare(settings) {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url)
    calls.push({ url: u, method: init.method || 'GET', body: init.body })
    if (u.endsWith('/settings')) return settings()
    if (u.endsWith('/subdomain')) return new Response(JSON.stringify({ success: true }), { status: 200 })
    return new Response(JSON.stringify({ success: true, result: { deployment_id: 'd1' } }), { status: 200 })
  }
  return calls
}
const json = (status, body) => () => new Response(JSON.stringify(body), { status })
const uploads = (calls) => calls.filter((c) => c.method === 'PUT')

// 1. A worker with bindings is refused and nothing is uploaded.
{
  const calls = cloudflare(json(200, { success: true, result: { bindings: [{ name: 'vegvisr_org', type: 'd1' }, { name: 'OAUTH_KV', type: 'kv_namespace' }] } }))
  const r = await executeTool('deploy_worker_guarded', { ...ROOT, workerName: 'knowledge-graph-worker', code: CODE }, ENV)
  check('a worker with bindings is refused', r.success === false && r.refused === 'HAS_BINDINGS', JSON.stringify(r))
  check('  the refusal names the bindings', /vegvisr_org \(d1\)/.test(r.error || ''), r.error)
  check('  and nothing was uploaded', uploads(calls).length === 0, JSON.stringify(calls))
}

// 2. Fail closed: an unreadable answer is not "no bindings".
for (const [label, settings] of [
  ['a 403', json(403, { success: false, errors: [{ code: 10000 }] })],
  ['a 500', json(500, { success: false, errors: [] })],
  ['a 404 that is not "script not found"', json(404, { success: false, errors: [{ code: 7003 }] })],
  ['a success without a bindings array', json(200, { success: true, result: {} })],
  ['a network failure', () => { throw new Error('boom') }],
]) {
  const calls = cloudflare(settings)
  const r = await executeTool('deploy_worker_guarded', { ...ROOT, workerName: 'some-worker', code: CODE }, ENV)
  check(`${label} is refused as unknown`, r.success === false && r.refused === 'BINDINGS_UNKNOWN', JSON.stringify(r))
  check(`  and nothing was uploaded after ${label}`, uploads(calls).length === 0, JSON.stringify(calls))
}

// 3. A new worker and an existing binding-free one are both deployed, with no bindings sent.
for (const [label, settings, created] of [
  ['a worker that does not exist yet', json(404, { success: false, errors: [{ code: 10007 }] }), true],
  ['an existing worker with no bindings', json(200, { success: true, result: { bindings: [] } }), false],
]) {
  const calls = cloudflare(settings)
  // bindAdmin:true in the input must not survive.
  const r = await executeTool('deploy_worker_guarded', { ...ROOT, workerName: 'hello-mcp', code: CODE, bindAdmin: true, registerInGraph: false }, ENV)
  check(`${label} is deployed`, r.success === true && r.created === created, JSON.stringify(r))
  const put = uploads(calls)[0]
  const meta = put ? JSON.parse(await put.body.get('metadata').text()) : null
  check(`  with no bindings in the upload for ${label}`, !!meta && meta.bindings === undefined, JSON.stringify(meta))
}

// 4. Name and caller.
{
  const calls = cloudflare(json(404, { success: false, errors: [{ code: 10007 }] }))
  for (const bad of ['../x', 'Has-Caps', 'a/b', '', 'x'.repeat(64)]) {
    const r = await executeTool('deploy_worker_guarded', { ...ROOT, workerName: bad, code: CODE }, ENV)
    check(`name ${JSON.stringify(bad.slice(0, 12))} is refused`, r.success === false, JSON.stringify(r))
  }
  let threw = null
  try {
    await executeTool('deploy_worker_guarded', { userId: 'u', authContext: { authenticated: true, role: 'Admin' }, workerName: 'hello-mcp', code: CODE }, ENV)
  } catch (e) { threw = e }
  check('a non-Superadmin is refused', !!threw && /Superadmin/.test(threw.message), String(threw))
  check('  and none of that reached Cloudflare', calls.length === 0, JSON.stringify(calls))
}

fs.rmSync(tmp, { recursive: true, force: true })
if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nall green')
