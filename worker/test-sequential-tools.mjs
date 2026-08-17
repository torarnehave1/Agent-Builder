// Mechanical guard for the same-node write race (Lesson 65 / RULES).
// A tool that MUTATES a knowledge-graph node/graph (its executor calls a version-bumping KG
// write endpoint) MUST be listed in SEQUENTIAL_TOOLS in agent-loop.js, or the loop runs it in
// the Promise.all() batch and two same-node writes race (409 + nth mis-target). This test
// statically derives the mutating tools from the executor source and fails if any is missing
// from the set — so the omission that caused the bug can never silently recur.
//
// Run:  node worker/test-sequential-tools.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const execSrc = fs.readFileSync(path.join(dir, 'tool-executors.js'), 'utf8')
const loopSrc = fs.readFileSync(path.join(dir, 'agent-loop.js'), 'utf8')

// 1. Dispatch map: tool name -> executor function name, from the `case 'x': return await fn(` switch.
const dispatch = {}
for (const m of execSrc.matchAll(/case\s+['"]([\w]+)['"]\s*:\s*\n?\s*return\s+await\s+(\w+)\s*\(/g)) {
  dispatch[m[1]] = m[2]
}

// 2. Executor bodies: split the file on top-level function declarations.
const bodies = {}
for (const part of execSrc.split(/\n(?=(?:async\s+)?function\s)/)) {
  const nm = part.match(/^(?:async\s+)?function\s+(\w+)\s*\(/)
  if (nm) bodies[nm[1]] = part
}

// 3. Writers: an executor that calls a version-bumping KG write endpoint, directly OR
//    transitively (e.g. fill_slot_with_component -> executeInsertInElement -> patchNode).
const WRITE_RE = /patchNodeWithVersionRetry\s*\(|knowledge-graph-worker\/(?:patchNode|addNode|saveGraphWithHistory|removeNode)\b/
const fnNames = Object.keys(bodies)
const writers = new Set(fnNames.filter(fn => WRITE_RE.test(bodies[fn])))
let changed = true
while (changed) {
  changed = false
  for (const fn of fnNames) {
    if (writers.has(fn)) continue
    for (const w of writers) {
      if (fn !== w && new RegExp('\\b' + w + '\\s*\\(').test(bodies[fn])) { writers.add(fn); changed = true; break }
    }
  }
}
const mutatingTools = Object.entries(dispatch).filter(([, fn]) => writers.has(fn)).map(([t]) => t).sort()

// 4. SEQUENTIAL_TOOLS as declared in agent-loop.js (parse the exported set literal).
const setBlock = loopSrc.match(/export const SEQUENTIAL_TOOLS = new Set\(\[([\s\S]*?)\]\)/)
if (!setBlock) { console.error('FAIL: could not find `export const SEQUENTIAL_TOOLS = new Set([...])` in agent-loop.js'); process.exit(1) }
const sequential = new Set([...setBlock[1].matchAll(/['"]([\w]+)['"]/g)].map(m => m[1]))

// 5. Assert every mutating tool is serialized.
const missing = mutatingTools.filter(t => !sequential.has(t))
console.log(`Dispatch tools: ${Object.keys(dispatch).length} | KG-mutating tools: ${mutatingTools.length} | SEQUENTIAL_TOOLS: ${sequential.size}`)
if (missing.length) {
  console.error('\nFAIL — these node-mutating tools are NOT in SEQUENTIAL_TOOLS (they will race on same-node writes):')
  for (const t of missing) console.error(`  - ${t}  (executor: ${dispatch[t]})`)
  console.error('\nAdd them to `export const SEQUENTIAL_TOOLS` in worker/agent-loop.js.')
  process.exit(1)
}
console.log('\nPASS — every KG-mutating tool is in SEQUENTIAL_TOOLS. No same-node write race possible.')
process.exit(0)
