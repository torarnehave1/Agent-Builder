// find_published_page: which graph/node a live host serves (2026-10-16).
//
// The agent was asked which graph sodesign.vegr.ai serves, searched graph text for the hostname,
// found nothing and said no graph publishes there. The answer was one /__html/check away:
// graph f5e2e356, node forslag-html. Drives the REAL executor against fakes of both stores.
//
// Run:  node worker/test-find-published-page.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'find-published-page-'))
for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')
fs.symlinkSync(path.join(dir, 'node_modules'), path.join(tmp, 'node_modules'))
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))

let failures = 0
const check = (name, cond, detail) => {
  if (cond) console.log(`ok    ${name}`)
  else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) }
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status })
const SHARED = { 'sodesign.vegr.ai': { graphId: 'f5e2e356-6581-40b3-aa23-156d4f3b2358', nodeId: 'forslag-html', publishedAt: '2026-09-29T10:55:31.370Z' } }
const WORLD = { 'me.sodesign.no': { graphId: 'g-world', nodeId: 'console', publishedAt: '2026-10-15T20:00:00Z' } }

const env = {
  BRAND_WORKER: { async fetch(url) {
    const h = new URL(url).searchParams.get('hostname')
    return json({ ok: true, hostname: h, exists: !!SHARED[h], metadata: SHARED[h] || null })
  } },
  KG_WORKER: { async fetch(url) {
    const id = new URL(url).searchParams.get('id')
    if (id === SHARED['sodesign.vegr.ai'].graphId) return json({ metadata: { title: 'Stine Oksvold Design – forslag' }, nodes: [{ id: 'forslag-html', label: 'Forslag' }] })
    if (id === 'g-world') return new Response(JSON.stringify({ metadata: { title: 'Konsoll' }, nodes: [] }), { status: 200, headers: { 'X-Graph-World': 'sodesign.no' } })
    return json({ error: 'not found' }, 404)
  } },
}
globalThis.fetch = async (input) => {
  const u = new URL(typeof input === 'string' ? input : input.url)
  if (u.hostname === 'nowhere.example') throw new Error('getaddrinfo ENOTFOUND')
  const h = u.searchParams.get('hostname')
  return json({ ok: true, hostname: h, exists: !!WORLD[h], metadata: WORLD[h] || null })
}

{
  const r = await executeTool('find_published_page', { host: 'sodesign.vegr.ai' }, env)
  check('the 2026-10-16 question: sodesign.vegr.ai -> f5e2e356 / forslag-html, with title', r.success && r.published && r.graphId === SHARED['sodesign.vegr.ai'].graphId && r.nodeId === 'forslag-html' && r.via === 'brand-worker' && /forslag/i.test(r.title || ''), JSON.stringify(r))
}
{
  const r = await executeTool('find_published_page', { host: 'https://me.sodesign.no/some/path?x=1' }, env)
  check('a World host is answered by the host itself, from a full URL, and names the World', r.success && r.graphId === 'g-world' && r.via === 'host' && r.world === 'sodesign.no', JSON.stringify(r))
}
{
  const r = await executeTool('find_published_page', { host: 'routed-but-empty.vegr.ai' }, env)
  check('a routed host with no stored page says so, and claims no graph', r.success && r.published === false && !r.graphId && /absent/.test(r.message), JSON.stringify(r))
}
{
  const r = await executeTool('find_published_page', { host: 'nowhere.example' }, env)
  check('an unresolvable host says it does not resolve', r.success && r.published === false && /does not resolve/.test(r.message), JSON.stringify(r))
}
{
  const r = await executeTool('find_published_page', { host: 'not a host' }, env)
  check('garbage input is refused', r.success === false, JSON.stringify(r))
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nall find_published_page checks pass')
