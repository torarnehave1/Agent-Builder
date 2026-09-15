// Regression guard: set_world_dns_records adds mail-auth records safely (2026-09-15).
//
// nibi.no's Uniweb SPF, four DKIM CNAMEs and DMARC had to be typed into the Cloudflare dashboard,
// and on the Grok path there was no tool at all. The tool must: create missing records, keep CNAMEs
// DNS-only, UPDATE the one existing DMARC instead of adding a second (two DMARC records = none),
// be idempotent on re-run, refuse an apex MX, and stay Superadmin-only. cloudflare_api must also be
// Superadmin-only now.
//
// Drives the REAL executors through executeTool with an in-memory SQLite (node:sqlite) for D1 and a
// fake Cloudflare API behind globalThis.fetch, seeded with nibi.no's live state (one _dmarc p=reject).
//
// Run:  node worker/test-world-dns-records.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { DatabaseSync } from 'node:sqlite'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'world-dns-'))
for (const f of fs.readdirSync(dir)) {
  if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
}
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')
fs.symlinkSync(path.join(dir, 'node_modules'), path.join(tmp, 'node_modules'))
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))

let failures = 0
const check = (name, cond, detail) => {
  if (cond) console.log(`ok    ${name}`)
  else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) }
}

const ACCOUNT = 'e458403763ce460e42d1c87896cfc7e9'
const ZONE = 'zone-nibi'

function makeEnv() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE config (user_id TEXT, email TEXT, Role TEXT, bio TEXT, profileimage TEXT, phone TEXT, phone_verified_at TEXT, data TEXT, cf_account_id TEXT, cf_api_token TEXT);
    CREATE TABLE world_founders (id TEXT, founder_email TEXT, account_holder_email TEXT, hosting_model TEXT, cf_account_id TEXT, domain TEXT, created_at TEXT);
  `)
  db.prepare(`INSERT INTO config (user_id, email, Role, cf_account_id, cf_api_token) VALUES ('owner-uuid', 'owner@example.com', 'Superadmin', NULL, NULL)`).run()
  db.prepare(`INSERT INTO config (user_id, email, Role, cf_account_id, cf_api_token) VALUES ('admin-uuid', 'admin@example.com', 'Admin', NULL, NULL)`).run()
  db.prepare(`INSERT INTO config (user_id, email, Role, cf_account_id, cf_api_token) VALUES ('b8e7', 'post@nibi.no', 'Admin', ?, 'tok-nibi')`).run(ACCOUNT)
  db.prepare(`INSERT INTO world_founders VALUES ('wf', 'post@nibi.no', 'post@nibi.no', 'own_account', ?, 'nibi.no', '2026-09-13 17:35:39')`).run(ACCOUNT)
  const DB = {
    prepare(sql) {
      let args = []
      const stmt = {
        bind(...a) { args = a; return stmt },
        async first() { return db.prepare(sql).get(...args) ?? null },
        async all() { return { results: db.prepare(sql).all(...args) } },
        async run() { db.prepare(sql).run(...args); return { success: true } },
      }
      return stmt
    },
  }
  return { env: { DB } }
}

// Fake Cloudflare API: one zone, a record store, and a log of writes.
function fakeCloudflare(seed) {
  const store = seed.map((r, i) => ({ id: `r${i}`, ...r }))
  const writes = []
  let next = store.length
  const ok = (result) => new Response(JSON.stringify({ success: true, errors: [], result }), { status: 200 })
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url)
    const p = u.pathname.replace('/client/v4', '')
    const method = (init.method || 'GET').toUpperCase()
    if (init.headers?.Authorization !== 'Bearer tok-nibi') return new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }), { status: 403 })
    if (p === '/zones' && method === 'GET') return ok(u.searchParams.get('name') === 'nibi.no' ? [{ id: ZONE, name: 'nibi.no' }] : [])
    if (p === `/zones/${ZONE}/dns_records` && method === 'GET') {
      const type = u.searchParams.get('type'); const name = u.searchParams.get('name.exact')
      return ok(store.filter((r) => r.type === type && r.name === name))
    }
    if (p === `/zones/${ZONE}/dns_records` && method === 'POST') {
      const b = JSON.parse(init.body); const rec = { id: `r${next++}`, ...b }
      store.push(rec); writes.push({ method, ...b }); return ok(rec)
    }
    const m = p.match(new RegExp(`^/zones/${ZONE}/dns_records/(.+)$`))
    if (m && method === 'PATCH') {
      const rec = store.find((r) => r.id === m[1]); Object.assign(rec, JSON.parse(init.body))
      writes.push({ method, id: m[1], ...JSON.parse(init.body) }); return ok(rec)
    }
    return new Response(JSON.stringify({ success: false, errors: [{ message: `unmocked ${method} ${p}` }] }), { status: 404 })
  }
  return { store, writes }
}

const NIBI_RECORDS = [
  { type: 'TXT', name: '@', content: 'v=spf1 include:_spf.uniweb.no ~all' },
  { type: 'CNAME', name: 'ed1._domainkey', content: 'ed1.dkim.c5fptl309.service.one' },
  { type: 'CNAME', name: 'ed2._domainkey', content: 'ed2.dkim.c5fptl309.service.one' },
  { type: 'CNAME', name: 'rsa1._domainkey', content: 'rsa1.dkim.c5fptl309.service.one' },
  { type: 'CNAME', name: 'rsa2._domainkey', content: 'rsa2.dkim.c5fptl309.service.one' },
  { type: 'TXT', name: '_dmarc', content: 'v=DMARC1; p=quarantine; rua=mailto:post@nibi.no' },
]
const OWNER = { userId: 'owner-uuid' }

// 1. First run on nibi.no's live state.
{
  const { env } = makeEnv()
  const cf = fakeCloudflare([{ type: 'TXT', name: '_dmarc.nibi.no', content: '"v=DMARC1; p=reject;"' }])
  const r = await executeTool('set_world_dns_records', { ...OWNER, domain: 'nibi.no', records: NIBI_RECORDS }, env)
  const by = (n) => r.results?.find((x) => x.name === n)
  check('run succeeds', r.success === true, JSON.stringify(r))
  check('SPF created on the apex, quoted', by('nibi.no')?.action === 'created' && cf.store.some((x) => x.name === 'nibi.no' && x.content === '"v=spf1 include:_spf.uniweb.no ~all"'), JSON.stringify(cf.store))
  check('four DKIM CNAMEs created, all DNS only',
    ['ed1', 'ed2', 'rsa1', 'rsa2'].every((s) => by(`${s}._domainkey.nibi.no`)?.action === 'created') &&
    cf.writes.filter((w) => w.type === 'CNAME').every((w) => w.proxied === false) && cf.writes.filter((w) => w.type === 'CNAME').length === 4, JSON.stringify(cf.writes))
  const dmarcs = cf.store.filter((x) => x.name === '_dmarc.nibi.no')
  check('existing DMARC updated in place, not duplicated', by('_dmarc.nibi.no')?.action === 'updated' && dmarcs.length === 1 && dmarcs[0].content === '"v=DMARC1; p=quarantine; rua=mailto:post@nibi.no"', JSON.stringify(dmarcs))
  check('update reports the previous DMARC value', by('_dmarc.nibi.no')?.previous === '"v=DMARC1; p=reject;"', JSON.stringify(by('_dmarc.nibi.no')))
  check('message counts are right', /5 created, 1 updated, 0 unchanged, 0 failed/.test(r.message || ''), r.message)

  // 2. Re-run is idempotent.
  const writesBefore = cf.writes.length
  const again = await executeTool('set_world_dns_records', { ...OWNER, domain: 'nibi.no', records: NIBI_RECORDS }, env)
  check('re-run: everything unchanged, no writes', again.success === true && again.results.every((x) => x.action === 'unchanged') && cf.writes.length === writesBefore, JSON.stringify({ again, writes: cf.writes.length }))
}

// 3. A proxied DKIM CNAME is switched to DNS only; a wrong target is corrected in place.
{
  const { env } = makeEnv()
  const cf = fakeCloudflare([
    { type: 'CNAME', name: 'ed1._domainkey.nibi.no', content: 'ed1.dkim.c5fptl309.service.one', proxied: true },
    { type: 'CNAME', name: 'ed2._domainkey.nibi.no', content: 'wrong.example.com', proxied: false },
  ])
  const r = await executeTool('set_world_dns_records', { ...OWNER, domain: 'nibi.no', records: NIBI_RECORDS.slice(1, 3) }, env)
  const e1 = cf.store.find((x) => x.name === 'ed1._domainkey.nibi.no')
  const e2 = cf.store.filter((x) => x.name === 'ed2._domainkey.nibi.no')
  check('proxied CNAME becomes DNS only', e1.proxied === false && r.results[0].action === 'updated', JSON.stringify({ e1, r }))
  check('wrong CNAME target corrected, still one record', e2.length === 1 && e2[0].content === 'ed2.dkim.c5fptl309.service.one', JSON.stringify(e2))
}

// 4. Two SPF-shaped inputs never create a second SPF on the same name.
{
  const { env } = makeEnv()
  const cf = fakeCloudflare([{ type: 'TXT', name: 'nibi.no', content: '"v=spf1 include:_custspf.g1i.one ~all"' }])
  await executeTool('set_world_dns_records', { ...OWNER, domain: 'nibi.no', records: [NIBI_RECORDS[0]] }, env)
  const spfs = cf.store.filter((x) => x.name === 'nibi.no' && /v=spf1/.test(x.content))
  check('existing SPF replaced, not duplicated', spfs.length === 1 && /_spf\.uniweb\.no/.test(spfs[0].content), JSON.stringify(spfs))
}

// 5. Refusals.
{
  const { env } = makeEnv()
  const cf = fakeCloudflare([])
  const mx = await executeTool('set_world_dns_records', { ...OWNER, domain: 'nibi.no', records: [{ type: 'MX', name: '@', content: 'mx.example.com' }] }, env)
  check('apex MX refused without allow_apex_mx', mx.success === false && mx.results[0].action === 'failed' && cf.writes.length === 0, JSON.stringify(mx))
  const bad = await executeTool('set_world_dns_records', { ...OWNER, domain: 'nibi.no', records: [{ type: 'A', name: 'www', content: '1.2.3.4' }] }, env)
  check('unsupported type refused', bad.results[0].action === 'failed' && cf.writes.length === 0, JSON.stringify(bad))
  const admin = await executeTool('set_world_dns_records', { userId: 'admin-uuid', domain: 'nibi.no', records: NIBI_RECORDS }, env)
  check('non-Superadmin refused, nothing written', admin.success === false && /Superadmin/.test(admin.error || '') && cf.writes.length === 0, JSON.stringify(admin))
  const cfa = await executeTool('cloudflare_api', { userId: 'admin-uuid', founder_email: 'post@nibi.no', path: '/workers/scripts' }, env)
  check('cloudflare_api refuses non-Superadmin', cfa.success === false && /Superadmin/.test(cfa.error || ''), JSON.stringify(cfa))
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(failures ? `\n${failures} FAILED` : '\nPASS — set_world_dns_records writes mail-auth records safely and idempotently.')
process.exit(failures ? 1 : 0)
