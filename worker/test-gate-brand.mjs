// The publish gate wears a World's design on the World's own host (2026-10-23): buildGateElement adds
// brand="auto" only when asked (World host), so shared vegvisr.org pages keep today's card.
// Extracts the REAL function from tool-executors.js.
//
// Run:  node worker/test-gate-brand.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.join(dir, 'tool-executors.js'), 'utf8')
const m = src.match(/function buildGateElement\(opts\) \{[\s\S]*?\n\}/)
if (!m) { console.error('FAIL: buildGateElement not found'); process.exit(1) }
const buildGateElement = new Function(`${m[0]}; return buildGateElement`)()

let failures = 0
const check = (name, cond, detail) => { if (cond) console.log(`ok    ${name}`); else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) } }

const base = { gate: true, gateAppName: 'Stine Oksvold Design – Min side', gateLang: 'nb' }
const world = buildGateElement({ ...base, gateBrand: true })
const shared = buildGateElement({ ...base, gateBrand: false })
check('a World host gets brand="auto"', /\bbrand="auto"/.test(world) && /require-auth/.test(world), world)
check('a shared host does not', !/brand=/.test(shared) && /require-auth/.test(shared), shared)
check('no gate, no element', buildGateElement({ gate: false, gateBrand: true }) === '', 'expected empty')
check('stored gate settings without gateBrand behave as before', !/brand=/.test(buildGateElement(base)), buildGateElement(base))

// 2026-10-27: no card name on a World host -> no app-name, so the component takes the World's brand name.
const worldNoName = buildGateElement({ gate: true, gateBrand: true })
check('World host without a card name leaves app-name out', !/app-name=/.test(worldNoName) && /brand="auto"/.test(worldNoName), worldNoName)
check('World host with a card name keeps it', /app-name="Stine Oksvold Design – Min side"/.test(world), world)
check('shared host without a card name still says Vegvisr', /app-name="Vegvisr"/.test(buildGateElement({ gate: true, gateBrand: false })), buildGateElement({ gate: true, gateBrand: false }))

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nall gate-brand checks pass')
