// save_component overwrite keeps the stored schema (2026-10-15, graph-portfolio World mode).
//
// Drives the REAL executor against an in-memory registry graph. Until this date an overwrite
// without `schema` replaced the stored schema with {}, so extending a served component meant
// re-sending its whole schema through a tool-call argument. Now: no schema = keep it, and
// schemaProps adds props to it. An explicit schema still replaces it.
//
// Run:  node worker/test-save-component-schema.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { DatabaseSync } from 'node:sqlite'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'save-component-schema-'))
for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f))
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')
fs.symlinkSync(path.join(dir, 'node_modules'), path.join(tmp, 'node_modules'))
const { executeTool } = await import(path.join(tmp, 'tool-executors.js'))

let failures = 0
const check = (name, cond, detail) => {
  if (cond) console.log(`ok    ${name}`)
  else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) }
}
const IMPL = '(function(){ /* ' + 'x'.repeat(3000) + ' */ })();'
const SCHEMA = { component: 'demo', version: 1, description: 'Demo', props: { a: { attr: 'data-a' }, b: { attr: 'data-b' } } }

function makeEnv() {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE config (user_id TEXT, email TEXT, Role TEXT, bio TEXT, profileimage TEXT, phone TEXT, phone_verified_at TEXT, data TEXT, cf_account_id TEXT, cf_api_token TEXT);`)
  db.prepare(`INSERT INTO config (user_id, email, Role) VALUES ('owner-uuid', 'owner@example.com', 'Superadmin')`).run()
  const DB = { prepare(sql) { let a = []; const st = { bind(...x) { a = x; return st }, async first() { return db.prepare(sql).get(...a) ?? null }, async all() { return { results: db.prepare(sql).all(...a) } }, async run() { db.prepare(sql).run(...a); return { success: true } } }; return st } }
  const graph = {
    metadata: { version: 7 },
    nodes: [{ id: 'component-demo', label: 'demo', type: 'component', info: 'demo', metadata: { schema: SCHEMA, impl: IMPL, delivery: 'graph-js', verify: { verdict: 'PASS' } } }],
    edges: [],
  }
  const KG_WORKER = {
    async fetch(url, init = {}) {
      const u = new URL(url)
      if (u.pathname === '/getknowgraph') return new Response(JSON.stringify(graph), { status: 200 })
      if (u.pathname === '/patchNode') {
        const b = JSON.parse(init.body)
        const n = graph.nodes.find((x) => x.id === b.nodeId)
        Object.assign(n, b.fields)
        graph.metadata.version += 1
        return new Response(JSON.stringify({ newVersion: graph.metadata.version }), { status: 200 })
      }
      return new Response(JSON.stringify({ error: `unexpected ${u.pathname}` }), { status: 404 })
    },
  }
  return { env: { DB, KG_WORKER }, graph }
}
const base = { userId: 'owner-uuid', name: 'demo', impl: IMPL + ' ', overwrite: true, delivery: 'graph-js' }
const schemaOf = (g) => g.nodes[0].metadata.schema

{
  const { env, graph } = makeEnv()
  const r = await executeTool('save_component', base, env)
  check('an overwrite without schema keeps the stored schema', r.success === true && JSON.stringify(schemaOf(graph)) === JSON.stringify(SCHEMA), JSON.stringify(r).slice(0, 300) + ' ' + JSON.stringify(schemaOf(graph)))
}
{
  const { env, graph } = makeEnv()
  const r = await executeTool('save_component', { ...base, schemaProps: { world: { attr: 'data-world' } } }, env)
  const s = schemaOf(graph)
  check('schemaProps adds a prop and keeps the others and the rest of the schema', r.success === true && s.props.world?.attr === 'data-world' && s.props.a && s.props.b && s.description === 'Demo' && s.version === 1, JSON.stringify(s))
}
{
  const { env, graph } = makeEnv()
  const r = await executeTool('save_component', { ...base, schema: { description: 'New', props: { z: {} } } }, env)
  check('an explicit schema still replaces it', r.success === true && schemaOf(graph).description === 'New' && !schemaOf(graph).props.a, JSON.stringify(schemaOf(graph)))
}

{
  const { env, graph } = makeEnv()
  const r = await executeTool('save_component', { ...base, schemaProps: JSON.stringify({ world: { attr: 'data-world' } }) }, env)
  check('schemaProps sent as a JSON string is parsed and applied, and the message lists the props', r.success === true && schemaOf(graph).props.world?.attr === 'data-world' && /world/.test(r.message), JSON.stringify(r).slice(0, 300))
}
{
  const { env, graph } = makeEnv()
  const before = JSON.stringify(graph.nodes[0])
  // The exact 2026-10-15 shape: a string with unescaped inner quotes.
  const r = await executeTool('save_component', { ...base, schemaProps: '{"include": {"description": ""published" (default)"}}' }, env)
  check('an invalid JSON string refuses the whole save and writes nothing', r.success === false && /Nothing was saved/.test(r.error) && JSON.stringify(graph.nodes[0]) === before, JSON.stringify(r))
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nall save_component schema checks pass')
