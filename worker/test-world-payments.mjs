// World payments (2026-11-05): one row per payment in the World's own database; every dashboard
// figure is computed from the rows. Access: founder, account holder, system owner only; responses
// never carry an e-mail address. Drives the real handler against a fake D1 API.
//
// Run:  node worker/test-world-payments.mjs   (exit 0 = pass, 1 = fail)

import { DatabaseSync } from 'node:sqlite'
import { handleWorldPayments, paymentRow, MAX_IMPORT } from './world-payments.js'

let failures = 0
const check = (name, cond, detail) => {
  if (cond) console.log(`ok    ${name}`)
  else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) }
}
const ACCOUNT = 'b68bda52e04081f0cbc04df338a44019'

const db = new DatabaseSync(':memory:')
db.exec(`
  CREATE TABLE config (user_id TEXT, email TEXT, Role TEXT, cf_account_id TEXT, cf_api_token TEXT);
  CREATE TABLE world_founders (id TEXT, founder_email TEXT, account_holder_email TEXT, hosting_model TEXT, cf_account_id TEXT, domain TEXT, world_name TEXT, created_at TEXT);
  CREATE TABLE world_commerce_stores (domain TEXT PRIMARY KEY, cf_account_id TEXT, d1_database_id TEXT);
  CREATE TABLE system_owners (email TEXT);
`)
db.prepare(`INSERT INTO config VALUES ('stine', 'stine.oksvold@gmail.com', 'Admin', ?, 'tok')`).run(ACCOUNT)
db.prepare(`INSERT INTO world_founders VALUES ('wf', 'stine.oksvold@gmail.com', null, 'own_account', ?, 'sodesign.no', 'Stine Oksvold Design', '2026-10-15')`).run(ACCOUNT)
db.prepare(`INSERT INTO world_commerce_stores VALUES ('sodesign.no', ?, 'cdb')`).run(ACCOUNT)
db.prepare(`INSERT INTO system_owners VALUES ('owner@example.com')`).run()
const DB = { prepare(sql) { let a = []; const st = { bind(...x) { a = x; return st }, async first() { return db.prepare(sql).get(...a) ?? null }, async all() { return { results: db.prepare(sql).all(...a) } }, async run() { db.prepare(sql).run(...a); return { success: true } } }; return st } }

const founderDb = new DatabaseSync(':memory:')
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  const p = url.pathname.replace('/client/v4', '')
  if (p === `/accounts/${ACCOUNT}/d1/database/cdb/query`) {
    const b = JSON.parse(init.body)
    if (b.sql.length > 100_000) return new Response(JSON.stringify({ success: false, errors: [{ message: 'statement too long' }] }), { status: 400 })
    try {
      const st = founderDb.prepare(b.sql)
      const results = /^\s*select/i.test(b.sql) ? st.all(...(b.params || [])) : (st.run(...(b.params || [])), [])
      return new Response(JSON.stringify({ success: true, result: [{ results }] }))
    } catch (e) { return new Response(JSON.stringify({ success: false, errors: [{ message: e.message }] }), { status: 400 }) }
  }
  return new Response(JSON.stringify({ success: false, errors: [{ message: `unexpected ${p}` }] }), { status: 404 })
}
const env = { DB }
const as = (email, role = '') => async () => ({ authenticated: true, email, role })
const anon = async () => ({ authenticated: false })
const call = async (method, pathq, who, body) => {
  const res = await handleWorldPayments(
    new Request(`https://agent.vegvisr.org${pathq}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }),
    env, new URL(`https://agent.vegvisr.org${pathq}`), {}, who)
  return { status: res.status, body: await res.json() }
}
const OWNER = as('owner@example.com', 'Superadmin')
const STINE = as('stine.oksvold@gmail.com', 'Admin')

const PAY = [
  { id: 'c1', source: 'card', paid_at: '2020-04-13 10:00:00', amount: 190, product: 'Påskespesial', kind: 'one_off', email: 'A@x.no' },
  { id: 'c2', source: 'card', paid_at: '2020-04-13 11:00:00', amount: 190, product: 'Påskespesial', kind: 'one_off', email: 'b@x.no' },
  { id: 'c3', source: 'card', paid_at: '2020-04-20 11:00:00', amount: 60, product: 'Fjellgenseren', kind: 'one_off', email: 'a@x.no' },
  { id: 'c4', source: 'card', paid_at: '2020-05-02 09:00:00', amount: 180, refunded: 180, product: 'Fjellstrikk', kind: 'one_off', email: 'c@x.no' },
  { id: 'c5', source: 'card', paid_at: '2026-10-20 09:00:00', amount: 49, product: 'Abonnement (kort)', kind: 'subscription', email: 'd@x.no' },
  { id: 'v1', source: 'vipps', paid_at: '2026-10-15', amount: 99, product: 'Den lille strikkeskolen', kind: 'subscription', email: 'e@x.no' },
  { id: 'v2', source: 'vipps', paid_at: '2025-11-10', amount: 75, product: 'Fjellgenseren', kind: 'one_off', email: 'e@x.no' },
]

// validation
check('a bad source is refused', /source must be/.test(paymentRow({ ...PAY[0], source: 'paypal' }).error || ''), '')
check('a bad date is refused', /paid_at must/.test(paymentRow({ ...PAY[0], paid_at: '13.04.2020' }).error || ''), '')
check('a negative amount is refused', /amount/.test(paymentRow({ ...PAY[0], amount: -5 }).error || ''), '')

{
  const a = await call('GET', '/world-payments/overview?world=sodesign.no', STINE)
  check('no payments yet → 404', a.status === 404, JSON.stringify(a))
  const imp = await call('POST', '/world-payments/import', OWNER, { world: 'sodesign.no', payments: PAY })
  check('system owner imports', imp.status === 200 && imp.body.written === 7 && imp.body.total === 7, JSON.stringify(imp))
  const again = await call('POST', '/world-payments/import', OWNER, { world: 'sodesign.no', payments: PAY })
  check('importing the same payments again adds nothing', again.body.total === 7, JSON.stringify(again))
  const bad = await call('POST', '/world-payments/import', OWNER, { world: 'sodesign.no', payments: [PAY[0], { ...PAY[1], kind: 'gift' }] })
  check('one bad row refuses the whole batch, nothing written', bad.status === 400 && /payment 2/.test(bad.body.error), JSON.stringify(bad))
  const big = await call('POST', '/world-payments/import', OWNER, { world: 'sodesign.no', payments: Array.from({ length: MAX_IMPORT + 1 }, (_, i) => ({ ...PAY[0], id: 'x' + i })) })
  check('more than the batch limit is refused', big.status === 400, JSON.stringify(big.body))
}
{
  const o = await call('GET', '/world-payments/overview?world=sodesign.no&today=2026-11-05', STINE)
  const b = o.body
  check('founder gets the overview', o.status === 200, JSON.stringify(o).slice(0, 200))
  check('refunded payment does not count; e-mails are case-folded', b.totals.payments === 6 && b.totals.revenue === 663 && b.totals.customers === 4, JSON.stringify(b.totals))
  check('customers who only paid with Vipps', b.onlyVipps === 1, String(b.onlyVipps))
  check('last 12 whole months (Nov 2025 – Oct 2026) and the Vipps share', b.last12.revenue === 223 && b.last12.vipps === 174, JSON.stringify(b.last12))
  check('active members = subscription paid in the last 35 days, per source', b.active.length === 2 && b.active.every((x) => x.members === 1), JSON.stringify(b.active))
  const apr = b.months.find((m) => m.month === '2020-04')
  check('months per source', apr && apr.revenue === 440 && apr.payments === 3 && !b.months.some((m) => m.month === '2020-05'), JSON.stringify(b.months))
  check('cohorts by first payment year', JSON.stringify(b.cohorts.map((c) => [c.year, c.customers])) === JSON.stringify([['2020', 2], ['2025', 1], ['2026', 1]]), JSON.stringify(b.cohorts))
  check('the response carries no e-mail address', !/@x\.no/i.test(JSON.stringify(b)), '')
}
{
  const p = await call('GET', '/world-payments/products?world=sodesign.no&from=2020-04-01&to=2020-05-01', STINE)
  const b = p.body
  check('what was sold in April 2020', p.status === 200 && b.products[0].product === 'Påskespesial' && b.products[0].payments === 2 && b.products[0].revenue === 380 && b.totals.revenue === 440, JSON.stringify(b))
  check('busiest day', b.busiestDay && b.busiestDay.day === '2020-04-13' && b.busiestDay.payments === 2, JSON.stringify(b.busiestDay))
  const v = await call('GET', '/world-payments/products?world=sodesign.no&source=vipps', STINE)
  check('filter by Vipps', v.body.products.length === 2 && v.body.totals.revenue === 174, JSON.stringify(v.body))
  const e = await call('GET', '/world-payments/products?world=sodesign.no&source=paypal', STINE)
  check('a bad filter is refused', e.status === 400, JSON.stringify(e.body))
}
{
  const s = await call('GET', '/world-payments/overview?world=sodesign.no', as('super@example.com', 'Superadmin'))
  check('another Superadmin is refused (403)', s.status === 403 && !s.body.totals, JSON.stringify(s.body))
  const w = await call('POST', '/world-payments/import', as('super@example.com', 'Superadmin'), { world: 'sodesign.no', payments: [{ ...PAY[0], id: 'evil' }] })
  check('… and may not import', w.status === 403, JSON.stringify(w.body))
  const n = await call('GET', '/world-payments/products?world=sodesign.no', anon)
  check('no sign-in → 401', n.status === 401, JSON.stringify(n.body))
}

console.log(failures ? `\n${failures} failure(s)` : '\nall passed')
process.exit(failures ? 1 : 0)
