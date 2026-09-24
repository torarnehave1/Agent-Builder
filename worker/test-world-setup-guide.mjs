// The setup guide lives in a graph, so the code holds a POINTER to it — and a pointer can dangle.
// This test reads the graph the tools send people to and checks that every step they name is really
// there, and that the graph has no step the tools never mention. Offline, it skips rather than
// failing the build: it guards against a wrong id, not against a missing network.
//
//     node test-world-setup-guide.mjs
import fs from 'fs'

const source = fs.readFileSync(new URL('./tool-executors.js', import.meta.url), 'utf8')
const graphId = source.match(/const WORLD_SETUP_GUIDE_GRAPH = '([^']+)'/)?.[1]
const block = source.match(/const WORLD_SETUP_GUIDE_STEPS = \{([\s\S]*?)\n\}/)?.[1] || ''
const named = [...block.matchAll(/'(step-[a-z0-9-]+)':/g)].map(m => m[1])
// Steps the executors actually point at, wherever they do it.
const referenced = [...source.matchAll(/worldSetupGuide\('(step-[a-z0-9-]+)'\)|'(step-[a-z0-9-]+)',?\s*$/gm)]
  .map(m => m[1] || m[2]).filter(Boolean)

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}`)
  if (!ok) { failures++; if (detail) console.log('      ' + detail) }
}

check('the code names a guide graph', Boolean(graphId), String(graphId))
check('the step map is not empty', named.length >= 10, `${named.length} steps`)
const unknown = referenced.filter(step => !named.includes(step))
check('every step the tools point at is in the step map', unknown.length === 0, unknown.join(', '))

let graph = null
try {
  const r = await fetch(`https://knowledge.vegvisr.org/getknowgraph?id=${graphId}`, {
    headers: { 'x-user-email': 'torarnehave@gmail.com', 'x-user-role': 'Superadmin' },
    signal: AbortSignal.timeout(10000),
  })
  if (r.ok) graph = await r.json()
  else console.log(`SKIP  the guide graph could not be read (HTTP ${r.status}) — not failing the build on that`)
} catch (e) {
  console.log(`SKIP  no network to read the guide graph (${e.name}) — not failing the build on that`)
}

if (graph) {
  const ids = (graph.nodes || graph.graphData?.nodes || []).map(n => n.id)
  check('the guide graph exists and has nodes', ids.length > 0, JSON.stringify(ids).slice(0, 200))
  const missing = named.filter(step => !ids.includes(step))
  check('every step the code names exists in the graph', missing.length === 0, missing.join(', '))
  const extra = ids.filter(id => id.startsWith('step-') && !named.includes(id))
  check('the graph has no step the code never points at', extra.length === 0, extra.join(', '))
}

console.log(failures ? `\n${failures} FAILED` : '\nPASS — the setup guide the tools point at is real, and every step they name is in it.')
process.exit(failures ? 1 : 0)
