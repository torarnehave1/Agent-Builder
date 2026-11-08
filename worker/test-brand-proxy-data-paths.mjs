// A World proxy that passes through to the vegvisr.org app must send the app's graph/API data calls
// to knowledge.vegvisr.org / api.vegvisr.org (2026-11-08, movemetime.com). On a custom domain the
// viewer turns those URLs into relative paths on the World's own host; www.vegvisr.org answered them
// with the app's HTML and the viewer showed "Unexpected token '<'".
//
// Drives the REAL template (templates/brand-proxy.reference.js) with a stubbed fetch.
// Run:  node worker/test-brand-proxy-data-paths.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-proxy-data-paths-'))
const file = path.join(tmp, 'proxy.mjs')
fs.copyFileSync(path.join(dir, 'templates', 'brand-proxy.reference.js'), file)
const proxy = (await import(file)).default

let failures = 0
const check = (name, cond, detail) => {
  if (cond) console.log(`ok    ${name}`)
  else { failures++; console.error(`FAIL  ${name}\n      ${detail}`) }
}

const kv = { get: async () => null, put: async () => {}, delete: async () => {} }
let lastUrl = null
globalThis.fetch = async (u) => { lastUrl = String(u); return new Response('upstream', { status: 200 }) }
globalThis.caches = { default: { match: async () => null, put: async () => {} } }

async function hit(url, defaultOrigin) {
  lastUrl = null
  const env = { HTML_PAGES: kv, BRAND_CONFIG: kv, DEFAULT_ORIGIN: defaultOrigin, HTML_PUBLISH_SECRET: 'x' }
  await proxy.fetch(new Request(url), env, { waitUntil() {} })
  return lastUrl
}

const V = 'https://www.vegvisr.org'
check('graph read goes to knowledge.vegvisr.org',
  (await hit('https://movemetime.com/getknowgraph?id=graph_1751404643907', V)) === 'https://knowledge.vegvisr.org/getknowgraph?id=graph_1751404643907',
  `got ${lastUrl}`)
check('graph summaries go to knowledge.vegvisr.org',
  (await hit('https://movemetime.com/getknowgraphsummaries?offset=0', V)) === 'https://knowledge.vegvisr.org/getknowgraphsummaries?offset=0',
  `got ${lastUrl}`)
check('graph save goes to knowledge.vegvisr.org',
  (await hit('https://movemetime.com/saveGraphWithHistory', V)) === 'https://knowledge.vegvisr.org/saveGraphWithHistory',
  `got ${lastUrl}`)
check('AI path goes to api.vegvisr.org',
  (await hit('https://movemetime.com/grok-ask', V)) === 'https://api.vegvisr.org/grok-ask',
  `got ${lastUrl}`)
check('app page still goes to www.vegvisr.org',
  (await hit('https://movemetime.com/gnew-viewer?graphId=g1', V)) === 'https://www.vegvisr.org/gnew-viewer?graphId=g1',
  `got ${lastUrl}`)
check('a World with its own origin is not rerouted',
  (await hit('https://shop.example.no/getknowgraph?id=a', 'https://origin.example.no')) === 'https://origin.example.no/getknowgraph?id=a',
  `got ${lastUrl}`)
check('editor.<domain> still goes to the editor',
  (await hit('https://editor.movemetime.com/getknowgraph?id=a', V)) === 'https://editor.vegvisr.org/getknowgraph?id=a',
  `got ${lastUrl}`)

fs.rmSync(tmp, { recursive: true, force: true })
process.exit(failures ? 1 : 0)
