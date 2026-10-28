// Graph-write-intensjon og plan-modus — 2026-10-28.
import { isGraphWriteIntent, stripForIntent } from './agent-loop.js'
import fs from 'fs'

let failed = 0
const eq = (name, got, want) => { const ok = got === want; if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — got ${got}, want ${want}`}`) }

// Morgenens melding 1: «write» sto i sloganet i anførselstegn, «graph» kom fra UI-konteksten.
const brand = 'Kjør set_world_brand med domain "vegr.ai", host "lipi.vegr.ai", name "Lipi", slogan "Learn to write Sanskrit", og editor: accent "#b4521e". Vis meg value og message du får tilbake.\n\n[Current UI context: graphId="27afae70-01ab-470f-b713-a149c2e9377b", activeHtmlNodeId="lipi-placeholder"]'
eq('set_world_brand-meldingen er ikke graf-skriving', isGraphWriteIntent(brand), false)
eq('UI-konteksten fjernes', stripForIntent(brand).includes('graphid'), false)

// Ekte graf-skriving skal fortsatt treffe
eq('create a node', isGraphWriteIntent('Create a node about Ganesha in this graph'), true)
eq('add nodes', isGraphWriteIntent('add three nodes with the vowels'), true)
eq('patch noden (norsk bøyning)', isGraphWriteIntent('patch noden lipi-placeholder'), true)
eq('build a knowledge graph', isGraphWriteIntent('Build a knowledge graph of the Sanskrit alphabet'), true)
eq('updated the graph', isGraphWriteIntent('I updated the graph, now add an edge node'), true)

// Falske treff som ikke lenger skal slå til
eq('paragraph er ikke graph', isGraphWriteIntent('write a paragraph for the page'), false)
eq('address er ikke add', isGraphWriteIntent('what is the address of the node server?'), false)
eq('lese-spørsmål', isGraphWriteIntent('Hva er tittelen på grafen 27afae70?\n\n[Current UI context: graphId="27afae70"]'), false)

// Plan-modus: HTML-lese-verktøyene står i lese-lista
const src = fs.readFileSync(new URL('./agent-loop.js', import.meta.url), 'utf8')
const list = src.slice(src.indexOf('const READ_ONLY_TOOLS = new Set(['), src.indexOf('])', src.indexOf('const READ_ONLY_TOOLS')))
for (const t of ['read_html_source', 'read_html_head', 'read_html_section', 'list_html_anchors', 'list_html_text']) eq(`plan-modus tillater ${t}`, list.includes(`'${t}'`), true)
for (const t of ['edit_html_node', 'insert_html_at', 'publish_html_node']) eq(`plan-modus blokkerer fortsatt ${t}`, list.includes(`'${t}'`), false)

if (failed) { console.error(`${failed} failed`); process.exit(1) }
console.log('all passed')
