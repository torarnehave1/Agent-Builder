#!/usr/bin/env node
// doc-drift-check — extracts the LOAD-BEARING architecture facts from the worker source so
// ARCHITECTURE.md can be verified against reality instead of drifting silently (the audit already
// drifted: it says "203 tools" while the code has more). This first version is an INVENTORY
// EXTRACTOR: it prints the current truth. Once ARCHITECTURE.md exists, extend it to diff the doc's
// declared inventory against this and exit non-zero on mismatch.
//
// Run: node worker/scripts/doc-drift-check.mjs   (from repo root or worker/)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const WORKER = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (f) => { try { return readFileSync(join(WORKER, f), 'utf8') } catch { return '' } }

// Members of a `new Set([...])` or `[...]` literal assigned to NAME, as quoted strings.
function setMembers(src, name) {
  const m = src.match(new RegExp(`${name}\\s*=\\s*(?:new Set\\()?\\[([\\s\\S]*?)\\]`))
  if (!m) return null
  return [...m[1].matchAll(/['"]([a-zA-Z0-9_]+)['"]/g)].map((x) => x[1])
}
// Keys of an object literal assigned to NAME.
function objectKeys(src, name) {
  const m = src.match(new RegExp(`${name}\\s*=\\s*\\{([\\s\\S]*?)\\n\\s*\\}`))
  if (!m) return null
  return [...m[1].matchAll(/['"]?([a-zA-Z0-9_ .-]+)['"]?\s*:/g)].map((x) => x[1].trim())
}

const toolDefs = read('tool-definitions.js')
const toolExec = read('tool-executors.js')
const agentJs = read('agent.js')
const agentLoop = read('agent-loop.js')
const indexJs = read('index.js')
const modelsJs = read('models.js')
const agentChatTsx = read('../src/components/AgentChat.tsx') // the only raw /chat SSE consumer (§6.2)
const wranglerToml = read('wrangler.toml') // gitignored — present locally, absent in fresh checkouts

// 1. Tool definitions (names at 4-space indent inside TOOL_DEFINITIONS) + PROFF_TOOLS
const defNames = [...toolDefs.matchAll(/^\s{4}name:\s*'([a-zA-Z0-9_]+)'/gm)].map((m) => m[1])
// 2. Dispatch cases in executeTool
const cases = [...toolExec.matchAll(/^\s*case\s*'([a-zA-Z0-9_]+)':/gm)].map((m) => m[1])
// 3. Exposure filters
const workersAi = setMembers(agentJs, 'WORKERS_AI_TOOLS') || []
const openaiAllow = setMembers(agentLoop, 'OPENAI_AGENT_TOOL_NAMES') || []
const orchBlocked = setMembers(agentLoop, 'ORCHESTRATOR_BLOCKED_TOOLS') || []
const sequential = setMembers(agentLoop, 'SEQUENTIAL_TOOLS') || []
const exclusiveKeys = objectKeys(indexJs, 'EXCLUSIVE_CONTEXTS') || []
// 3b. Model registry — the Claude IDs live callers + agent_configs.model MUST reference (models.js).
const modelIds = (() => {
  const m = modelsJs.match(/MODELS\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/)
  if (!m) return []
  return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1])
})()
// 3c. SSE event catalogue — the two-sided allow-list (§6.2). Worker emits `event: <name>\n`; the
// frontend's StreamEvent union is the set it will act on. A mismatch either way is a real bug (L46).
const sseWorker = [...new Set(
  [agentLoop, indexJs].flatMap((s) => [...s.matchAll(/event:\s+([a-z_]+)\\n/g)].map((m) => m[1]))
)].sort()
const sseFrontend = (() => {
  const m = agentChatTsx.match(/interface\s+StreamEvent\s*\{[\s\S]*?type:\s*([^;]+);/)
  if (!m) return []
  return [...new Set([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]))].sort()
})()
// 3d. D1 database bindings (§5.2). wrangler.toml is gitignored, so only checkable when present.
const d1Dbs = [...wranglerToml.matchAll(/database_name\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]).sort()
// 4. Subagent whitelists (each *_TOOL_NAMES in a subagent file)
const subFiles = ['kg-subagent.js', 'html-builder-subagent.js', 'chat-subagent.js', 'bot-subagent.js',
  'contact-subagent.js', 'album-subagent.js', 'agent-builder-subagent.js', 'video-subagent.js']
const subagents = subFiles.map((f) => {
  const src = read(f)
  const nameMatch = src.match(/const\s+([A-Z_]*TOOL_NAMES)\s*=/)
  const set = nameMatch ? setMembers(src, nameMatch[1]) : null
  return { file: f, listName: nameMatch ? nameMatch[1] : '(none)', count: set ? set.length : 0 }
})

const uniq = (a) => [...new Set(a)]
const p = (label, v) => console.log(`${label.padEnd(34)} ${v}`)

console.log('=== Agent-Builder load-bearing inventory (source of truth) ===\n')
p('TOOL_DEFINITIONS names', defNames.length)
p('executeTool dispatch cases', cases.length)
p('WORKERS_AI_TOOLS (Workers-AI whitelist)', workersAi.length)
p('OPENAI_AGENT_TOOL_NAMES (OpenAI/Grok)', openaiAllow.length)
p('ORCHESTRATOR_BLOCKED_TOOLS (Claude blocklist)', orchBlocked.length)
p('SEQUENTIAL_TOOLS (KG-write, 1-at-a-time)', sequential.length)
p('EXCLUSIVE_CONTEXTS keys', exclusiveKeys.length ? exclusiveKeys.join(', ') : '(none)')
p('MODELS registry (models.js)', modelIds.length ? modelIds.join(', ') : '(none)')
p('SSE events emitted (worker)', sseWorker.join(', '))
p('SSE events handled (AgentChat)', sseFrontend.length ? sseFrontend.join(', ') : '(AgentChat.tsx not found)')
p('D1 databases (wrangler.toml)', d1Dbs.length ? d1Dbs.join(', ') : '(wrangler.toml not found)')
console.log('\n--- subagent whitelists ---')
for (const s of subagents) p(`  ${s.file} (${s.listName})`, s.count)

// Coherence checks that catch real wiring bugs (a tool defined but undispatchable, or vice versa).
console.log('\n--- coherence ---')
const defSet = new Set(defNames)
const caseSet = new Set(cases)
const definedNoDispatch = defNames.filter((n) => !caseSet.has(n))
const dispatchNoDef = uniq(cases).filter((n) => !defSet.has(n) && n !== 'default')
p('defined but no dispatch case', definedNoDispatch.length ? definedNoDispatch.join(', ') : '0')
// These are subagent-scoped/legacy NAMED cases (e.g. bot-subagent tools), dispatched through the shared
// switch — NOT the dynamic OpenAPI tools (those are definitions with no case, resolved via default:, §8.4).
p('dispatch case but no definition', dispatchNoDef.length ? `${dispatchNoDef.length}: ${dispatchNoDef.join(', ')} (subagent/legacy; §8.4)` : '0')

// SSE two-sided allow-list (§6.2): a worker event the frontend can't handle is silently dropped; a
// frontend branch on an unemitted event is dead code. Only checkable when the frontend file is present.
let sseFail = false
if (sseFrontend.length) {
  const feSet = new Set(sseFrontend)
  const wkSet = new Set(sseWorker)
  const emittedNotHandled = sseWorker.filter((e) => !feSet.has(e))
  const handledNotEmitted = sseFrontend.filter((e) => !wkSet.has(e))
  p('SSE emitted but NOT handled', emittedNotHandled.length ? emittedNotHandled.join(', ') : '0')
  p('SSE handled but NOT emitted', handledNotEmitted.length ? handledNotEmitted.join(', ') : '0')
  if (emittedNotHandled.length) sseFail = true // frontend would silently drop these — a real bug
} else {
  p('SSE allow-list cross-check', '(AgentChat.tsx not found — skipped)')
}

// Whitelist entries naming a tool that isn't in TOOL_DEFINITIONS are silent no-ops: buildTools/the
// OpenAI filter iterate TOOL_DEFINITIONS and membership-test the whitelist, so a stale/typo'd name is
// invisible on that engine (§6.3 / §8). Informational — a client-side tool may legitimately not be defined.
const whitelistOrphans = (name, list) => {
  const orphans = list.filter((n) => !defSet.has(n))
  p(`${name} not in TOOL_DEFINITIONS`, orphans.length ? orphans.join(', ') : '0')
}
whitelistOrphans('WORKERS_AI_TOOLS', workersAi)
whitelistOrphans('OPENAI_AGENT_TOOL_NAMES', openaiAllow)

// DOC CROSS-CHECK — the reference is only trustworthy if its declared numbers match the code.
// Parses ARCHITECTURE.md's "Verified inventory snapshot" and fails (exit 1) on any mismatch, so the
// doc cannot drift silently the way the audit did ("203" vs real 213).
const arch = read('ARCHITECTURE.md')
let driftFail = false
if (arch) {
  const declared = {
    'TOOL_DEFINITIONS': defNames.length,
    'dispatch cases': cases.length,
    'WORKERS_AI_TOOLS': workersAi.length,
    'OPENAI_AGENT_TOOL_NAMES': openaiAllow.length,
    'ORCHESTRATOR_BLOCKED_TOOLS': orchBlocked.length,
    'SEQUENTIAL_TOOLS': sequential.length,
  }
  console.log('\n--- ARCHITECTURE.md drift check ---')
  for (const [label, actual] of Object.entries(declared)) {
    const m = arch.match(new RegExp(`${label.replace(/[()]/g, '\\$&')}\\s+(\\d+)`))
    if (!m) { console.log(`  ${label.padEnd(28)} MISSING from doc`); driftFail = true; continue }
    const docN = Number(m[1])
    const ok = docN === actual
    if (!ok) driftFail = true
    console.log(`  ${label.padEnd(28)} doc=${docN} code=${actual} ${ok ? 'OK' : 'DRIFT'}`)
  }
  // EXCLUSIVE_CONTEXTS keys must all appear in the doc.
  for (const k of exclusiveKeys) {
    if (!arch.includes(k)) { console.log(`  EXCLUSIVE_CONTEXTS "${k}" MISSING from doc`); driftFail = true }
  }
  // Model registry IDs must all appear in the doc — a retired/renamed model must update §6.1 too.
  for (const id of modelIds) {
    if (!arch.includes(id)) { console.log(`  MODELS id "${id}" MISSING from doc`); driftFail = true }
  }
  // Every worker-emitted SSE event must be named in the doc — a new event must update §6.2 too.
  for (const e of sseWorker) {
    if (!arch.includes(`\`${e}\``)) { console.log(`  SSE event "${e}" MISSING from doc`); driftFail = true }
  }
  // Every D1 database must be named in the doc (§5.2) — only when wrangler.toml is present locally.
  for (const db of d1Dbs) {
    if (!arch.includes(db)) { console.log(`  D1 database "${db}" MISSING from doc`); driftFail = true }
  }
} else {
  console.log('\n(ARCHITECTURE.md not found — skipping doc cross-check)')
}

// Cross-model reachability for a named tool (pass as argv[2]) — the exact class of miss from 2026-08-02.
const probe = process.argv[2]
if (probe) {
  console.log(`\n--- reachability of "${probe}" ---`)
  p('in TOOL_DEFINITIONS', defSet.has(probe))
  p('has dispatch case', caseSet.has(probe))
  p('WORKERS_AI_TOOLS (Workers-AI)', workersAi.includes(probe))
  p('OPENAI_AGENT_TOOL_NAMES (OpenAI/Grok)', openaiAllow.includes(probe))
  p('Claude path (blocked?)', orchBlocked.includes(probe) ? 'BLOCKED (delegation)' : 'exposed')
  const inExclusive = exclusiveKeys.filter((k) => (objectKeys(indexJs, 'EXCLUSIVE_CONTEXTS'), setMembers(indexJs, `'${k}'`)))
  const exclusiveHit = [...indexJs.matchAll(/'([^']+)':\s*\[([^\]]*)\]/g)]
    .filter((m) => m[2].includes(`'${probe}'`)).map((m) => m[1])
  p('EXCLUSIVE_CONTEXTS granting it', exclusiveHit.length ? exclusiveHit.join(', ') : '(none — locked out of any exclusive context)')
}

const fail = driftFail || sseFail
if (sseFail) console.log('\nRESULT: SSE CONTRACT BREAK — worker emits an event AgentChat.tsx will silently drop (§6.2).')
console.log(fail ? (driftFail ? '\nRESULT: DRIFT — ARCHITECTURE.md is out of sync with the code (fix the doc).' : '') : '\nRESULT: doc in sync with code.')
process.exit(fail ? 1 : 0)
