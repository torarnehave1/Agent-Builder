// The Grok/OpenAI loop stops when the user names a tool that path does not carry (2026-10-15).
//
// Grok was asked to "Kall save_component …"; save_component was not in its list, and it called
// save_world_founder_template(html:"test") instead, overwriting the shared console template.
// This test replays that prompt against the pure check the loop runs before the first model call.
//
// Run:  node worker/test-requested-tool-guard.mjs   (exit 0 = pass, 1 = fail)

import { missingRequestedTools, OPENAI_AGENT_TOOLS } from './agent-loop.js'
import { TOOL_DEFINITIONS } from './tool-definitions.js'

let failures = 0
const check = (name, cond, detail) => {
  if (cond) console.log(`ok    ${name}`)
  else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) }
}
const known = new Set(TOOL_DEFINITIONS.map((t) => t.name))
const INCIDENT = 'Kall save_component med nøyaktig disse argumentene, og ingenting annet: name: "graph-portfolio" fromGraphId: "0d8d5dd1" fromNodeId: "gp-impl" overwrite: true delivery: "graph-js" schemaProps: {"world": {"attr": "data-world"}}'

{
  const before = new Set([...OPENAI_AGENT_TOOLS].filter((n) => n !== 'save_component'))
  const m = missingRequestedTools(INCIDENT, known, before)
  check('the incident prompt is stopped when save_component is not on the path', m.length === 1 && m[0] === 'save_component', JSON.stringify(m))
}
check('today the path carries save_component, so the same prompt runs', missingRequestedTools(INCIDENT, known, OPENAI_AGENT_TOOLS).length === 0, JSON.stringify(missingRequestedTools(INCIDENT, known, OPENAI_AGENT_TOOLS)))
check('attribute and field names that are not tools never stop a run (from_node_id, data_world, graph_js)',
  missingRequestedTools('use from_node_id and data_world with graph_js', known, new Set()).length === 0)
check('plain prose never stops a run', missingRequestedTools('Lag en ny graf om strikking', known, new Set()).length === 0)
check('delegate_to_chat is swapped for direct tools on this path, so naming it does not stop',
  missingRequestedTools('bruk delegate_to_chat', known, new Set()).length === 0)
check('a carried tool never stops', missingRequestedTools('kjør list_components', known, new Set(['list_components'])).length === 0)
{
  const m = missingRequestedTools('kall save_component og save_layout', known, new Set())
  check('several missing tools are all named', m.includes('save_component') && m.includes('save_layout') && m.length === 2, JSON.stringify(m))
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nall requested-tool guard checks pass')
