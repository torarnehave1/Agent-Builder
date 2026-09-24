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

// tokenOwner: 'user' (verifies at /user/tokens/verify), 'account' (a World account's own token —
// REJECTED by the user endpoint, accepted by the account one), or 'none' (genuinely dead).
// zone: 'active' (the World account holds it), 'pending', 'absent', or null (endpoint unusable).
// hosts: { '<hostname>': { status, key } } — what the hostname answers and whether html:<host> exists.
function makeEnv({ world = null, domainRow = null, config = null, tokenOwner = 'user', zone = null, proxy = false, publishSecret = null, hosts = null } = {}) {
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
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  const active = { success: true, result: { status: 'active' } }
  const rejected = { success: false, errors: [{ code: 1000, message: 'Invalid API Token' }] }
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.includes('/user/tokens/verify')) return json(tokenOwner === 'user' ? active : rejected)
    if (u.includes('/tokens/verify')) return json(tokenOwner === 'account' ? active : rejected)
    // A deployed brand proxy, so a zone assertion is not masked by an unrelated failure.
    if (hosts && u.includes('/dns_records')) {
      return json({ success: true, result: Object.entries(hosts).map(([h, v]) => (
        v.via === 'placeholder'
          ? { name: h, type: 'AAAA', content: '100::', proxied: true }
          : { name: h, type: 'worker', content: 'brand-proxy', proxied: true }
      )) })
    }
    if (hosts && u.includes('/workers/domains')) return json({ success: true, result: Object.keys(hosts).map(h => ({ hostname: h, service: 'alivenesslab-brand-proxy' })) })
    if (hosts && u.includes('/storage/kv/namespaces/')) {
      return json({ success: true, result: Object.entries(hosts).filter(([, v]) => v.key).map(([h]) => ({ name: `html:${h}` })) })
    }
    if (hosts) {
      const hit = Object.keys(hosts).find(h => u === `https://${h}/`)
      if (hit) return new Response('page', { status: hosts[hit].status })
    }
    if (proxy && u.includes('/workers/domains')) return json({ success: true, result: [] })
    if (proxy && /\/workers\/scripts\/[^/]+\/settings/.test(u)) return json({ success: true, result: { bindings: [] } })
    if (u.includes('/zones?name=')) {
      if (!zone) return json({})
      const name = decodeURIComponent(u.split('name=')[1].split('&')[0])
      return json({ success: true, result: zone === 'absent' ? [] : [{ id: 'zone123', name, status: zone }] })
    }
    return json({})
  }
  const WORLD_TEMPLATES = { async get(key) { return publishSecret && key.includes(publishSecret) ? 'secret-value' : null } }
  return { env: { DB, WORLD_TEMPLATES }, writes, restore: () => { globalThis.fetch = realFetch } }
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
  // The message IS the report: the model may narrate nothing (Grok returned an empty reply to a
  // READY verdict on 2026-09-24), and this line is what the chat renders regardless.
  check('the message lists every check, not just a score', (r.message || '').split('\n').length >= (r.checks || []).length + 2, r.message)
  check('the message names each failing check', /FAIL registry/.test(r.message || ''), r.message)
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
  check('passing checks are reported too', /OK   registry/.test(r.message || ''), r.message)
  // With no failures the reader is sent to the zone move; with failures, to the step that explains
  // the FIRST one. This stub World has no proxy, so it is the second case.
  const firstFail = (r.checks || []).find(c => c.state === 'fail')
  check('the guide follows the first failure, or the zone move when there is none',
    r.guide?.node_id === (firstFail ? firstFail.guide.node_id : 'step-08-zone-move'),
    JSON.stringify({ firstFail: firstFail?.check, guide: r.guide?.node_id }))
}

// 3. An ACCOUNT-owned token — rejected by /user/tokens/verify, valid everywhere that matters.
// On 2026-09-24 the pre-flight called such a token REJECTED minutes after setup_world had used it
// to create a KV namespace and deploy a proxy.
{
  const { env, restore } = makeEnv({
    world: { founder_email: 'alivenesslab.org@gmail.com', hosting_model: 'own_account', cf_account_id: '077b2127436f8d047c000ecad69e4017' },
    domainRow: { hosting_model: 'own_account', cf_account_id: '077b2127436f8d047c000ecad69e4017' },
    config: { cf_account_id: '077b2127436f8d047c000ecad69e4017', cf_api_token: 'cfat_account_owned', cf_kv_namespace_id: 'kv456' },
    tokenOwner: 'account',
  })
  const r = await executeTool('preflight_world', { ...CALLER, domain: 'alivenesslab.net' }, env)
  restore()
  check('an account-owned token is NOT called rejected', find(r, 'credentials')?.state === 'pass', JSON.stringify(find(r, 'credentials')))
  check('and the answer says which kind of token it is', /account-owned/.test(find(r, 'credentials')?.detail || ''), find(r, 'credentials')?.detail)
}

// 4. A genuinely dead token still fails, and names both checks.
{
  const { env, restore } = makeEnv({
    world: { founder_email: 'post@nibi.no', hosting_model: 'own_account', cf_account_id: 'e458403763ce460e42d1c87896cfc7e9' },
    domainRow: { hosting_model: 'own_account', cf_account_id: 'e458403763ce460e42d1c87896cfc7e9' },
    config: { cf_account_id: 'e458403763ce460e42d1c87896cfc7e9', cf_api_token: 'cfat_dead', cf_kv_namespace_id: 'kv789' },
    tokenOwner: 'none',
  })
  const r = await executeTool('preflight_world', { ...CALLER, domain: 'nibi.no' }, env)
  restore()
  check('a dead token is still a failure', find(r, 'credentials')?.state === 'fail', JSON.stringify(find(r, 'credentials')))
  check('and it says both ways were tried', /as an account token/.test(find(r, 'credentials')?.detail || ''), find(r, 'credentials')?.detail)
}

// 5. The zone is already in the World's own account — the alivenesslab.net case, where the domain
// was BOUGHT there. Telling the reader to move it is advice to redo something already done.
{
  const { env, restore } = makeEnv({
    world: { founder_email: 'alivenesslab.org@gmail.com', hosting_model: 'own_account', cf_account_id: '077b2127436f8d047c000ecad69e4017' },
    domainRow: { hosting_model: 'own_account', cf_account_id: '077b2127436f8d047c000ecad69e4017' },
    config: { cf_account_id: '077b2127436f8d047c000ecad69e4017', cf_api_token: 'cfat_account_owned', cf_kv_namespace_id: 'kv456' },
    tokenOwner: 'account', zone: 'active', proxy: true, publishSecret: 'alivenesslab.net', publishSecret: 'alivenesslab.net',
  })
  const r = await executeTool('preflight_world', { ...CALLER, domain: 'alivenesslab.net' }, env)
  restore()
  check('an owned zone passes its check', find(r, 'zone')?.state === 'pass', JSON.stringify(find(r, 'zone')))
  check('and the guide points at hosts and pages, NOT the zone move', r.guide?.node_id === 'step-09-hosts-and-pages', JSON.stringify(r.guide))
  // The point is that a held zone is never told to move — not the exact wording of what comes next.
  check('and next never tells you to move a zone you hold', !/move or add the/i.test(r.next || ''), r.next)
  check('and it points at what remains', /ready/i.test(r.next || ''), r.next)
}

// 6. The zone is somewhere else: a caution with the move named, not a pass.
{
  const { env, restore } = makeEnv({
    world: { founder_email: 'alivenesslab.org@gmail.com', hosting_model: 'own_account', cf_account_id: '077b2127436f8d047c000ecad69e4017' },
    domainRow: { hosting_model: 'own_account', cf_account_id: '077b2127436f8d047c000ecad69e4017' },
    config: { cf_account_id: '077b2127436f8d047c000ecad69e4017', cf_api_token: 'cfat_account_owned', cf_kv_namespace_id: 'kv456' },
    tokenOwner: 'account', zone: 'absent', proxy: true, publishSecret: 'alivenesslab.org',
  })
  const r = await executeTool('preflight_world', { ...CALLER, domain: 'alivenesslab.org' }, env)
  restore()
  check('a zone the account does not hold is a warning', find(r, 'zone')?.state === 'warn', JSON.stringify(find(r, 'zone')))
  check('and the guide points at the zone move', r.guide?.node_id === 'step-08-zone-move', JSON.stringify(r.guide))
}

// 7. A pending zone is called out — the error-1016 trap, not a green light.
{
  const { env, restore } = makeEnv({
    world: { founder_email: 'alivenesslab.org@gmail.com', hosting_model: 'own_account', cf_account_id: '077b2127436f8d047c000ecad69e4017' },
    domainRow: { hosting_model: 'own_account', cf_account_id: '077b2127436f8d047c000ecad69e4017' },
    config: { cf_account_id: '077b2127436f8d047c000ecad69e4017', cf_api_token: 'cfat_account_owned', cf_kv_namespace_id: 'kv456' },
    tokenOwner: 'account', zone: 'pending', proxy: true, publishSecret: 'alivenesslab.net',
  })
  const r = await executeTool('preflight_world', { ...CALLER, domain: 'alivenesslab.net' }, env)
  restore()
  check('a pending zone is a warning, not a pass', find(r, 'zone')?.state === 'warn', JSON.stringify(find(r, 'zone')))
  check('and it names the certificate trap', /1016/.test(find(r, 'zone')?.fix || ''), find(r, 'zone')?.fix)
}

// 8. The afternoon of 2026-09-24 in one check: hostnames answering 530 with no page published.
// Every tool reported success; the cause was a missing KV key, not DNS, tokens or the worker.
{
  const { env, restore } = makeEnv({
    world: { founder_email: 'alivenesslab.org@gmail.com', hosting_model: 'own_account', cf_account_id: 'acct1' },
    domainRow: { hosting_model: 'own_account', cf_account_id: 'acct1' },
    config: { cf_account_id: 'acct1', cf_api_token: 'tok', cf_kv_namespace_id: 'kv1' },
    tokenOwner: 'account', zone: 'active', publishSecret: 'alivenesslab.net',
    hosts: {
      'alivenesslab.net': { status: 200, key: true },
      'www.alivenesslab.net': { status: 200, key: false },
      'me.alivenesslab.net': { status: 530, key: false },
      'challenge.alivenesslab.net': { status: 530, key: false },
    },
  })
  const r = await executeTool('preflight_world', { ...CALLER, domain: 'alivenesslab.net' }, env)
  restore()
  const hostCheck = find(r, 'hosts')
  check('a 530 with no page is a warning, not a failure', hostCheck?.state === 'warn', JSON.stringify(hostCheck))
  check('it reports the status code per hostname', /me\.alivenesslab\.net 530/.test(hostCheck?.detail || ''), hostCheck?.detail)
  check('it says the page was never published', /NO page published/.test(hostCheck?.detail || ''), hostCheck?.detail)
  check('it tells you NOT to touch DNS or tokens', /Do NOT change DNS/.test(hostCheck?.fix || ''), hostCheck?.fix)
  check('www is not called unpublished — it falls back to the apex key', !/www\.alivenesslab\.net 200 \(NO page/.test(hostCheck?.detail || ''), hostCheck?.detail)
}

// 9. A host that HAS a page and still fails is the opposite verdict: real broken routing.
{
  const { env, restore } = makeEnv({
    world: { founder_email: 'alivenesslab.org@gmail.com', hosting_model: 'own_account', cf_account_id: 'acct1' },
    domainRow: { hosting_model: 'own_account', cf_account_id: 'acct1' },
    config: { cf_account_id: 'acct1', cf_api_token: 'tok', cf_kv_namespace_id: 'kv1' },
    tokenOwner: 'account', zone: 'active', publishSecret: 'alivenesslab.net',
    hosts: { 'alivenesslab.net': { status: 530, key: true } },
  })
  const r = await executeTool('preflight_world', { ...CALLER, domain: 'alivenesslab.net' }, env)
  restore()
  const hostCheck = find(r, 'hosts')
  check('a published page that still 530s is a failure', hostCheck?.state === 'fail', JSON.stringify(hostCheck))
  check('and it is named as broken routing', /broken routing/.test(hostCheck?.detail || ''), hostCheck?.detail)
}

// 10. vegr.ai's shape: seven hosts on proxied AAAA 100:: placeholders bound by Worker ROUTES, and
// exactly one real custom domain. Listing only /workers/domains would have seen one host of eight
// and called the rest unserved.
{
  const { env, restore } = makeEnv({
    world: { founder_email: 'post@vegr.ai', hosting_model: 'own_account', cf_account_id: 'acct2' },
    domainRow: { hosting_model: 'own_account', cf_account_id: 'acct2' },
    config: { cf_account_id: 'acct2', cf_api_token: 'tok', cf_kv_namespace_id: 'kv2' },
    tokenOwner: 'account', zone: 'active', publishSecret: 'vegr.ai',
    hosts: {
      'vegr.ai': { status: 200, key: true, via: 'placeholder' },
      'me.vegr.ai': { status: 200, key: true, via: 'placeholder' },
      'minside.vegr.ai': { status: 200, key: true, via: 'placeholder' },
      'challenge.vegr.ai': { status: 404, key: false, via: 'custom-domain' },
    },
  })
  const r = await executeTool('preflight_world', { ...CALLER, domain: 'vegr.ai' }, env)
  restore()
  const hostCheck = find(r, 'hosts')
  check('placeholder-routed hosts are seen, not just custom domains', /me\.vegr\.ai/.test(hostCheck?.detail || '') && /minside\.vegr\.ai/.test(hostCheck?.detail || ''), hostCheck?.detail)
  check('the custom-domain host is seen too', /challenge\.vegr\.ai/.test(hostCheck?.detail || ''), hostCheck?.detail)
  check('a 404 is not treated as a dead host', hostCheck?.state === 'pass', JSON.stringify(hostCheck))
}

// 11. domain is required.
{
  const { env, restore } = makeEnv({})
  const r = await executeTool('preflight_world', { ...CALLER }, env)
  restore()
  check('domain is required', r.success === false && /domain is required/.test(r.error || ''), r.error)
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(failures ? `\n${failures} FAILED` : '\nPASS — preflight_world names the half-registered World, the missing credentials and the missing infrastructure, and writes nothing.')
process.exit(failures ? 1 : 0)
