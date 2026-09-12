// Guards for putting registry components on pages (2026-09-11, theme-picker on nibi-website-main).
//  1. insert_component's splice keeps ONE owned block, upgrades it in place, removes provable copies,
//     and reports (or on request removes) hand-written leftovers with the nth remove_html_element uses.
//  2. The duplicate-insert guard no longer flags a variable that is local to an IIFE-wrapped script.
//     That false positive ("root" is ALREADY defined) is what taught the agent to pass force:true,
//     which then let real second copies of the component onto the page.
//  3. The registry re-implementation gate: the write tools refuse hand-written component code and
//     protect the block insert_component owns, while leaving page text, CSS and unrelated scripts
//     alone. 0 of 3 live agent runs used insert_component while only the prompt asked them to (L79).
//
// Run:  node worker/test-component-insert.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.join(dir, 'tool-executors.js'), 'utf8')

// Load the REAL functions from the executor source (same splitting as test-sequential-tools.mjs).
const parts = {}
for (const part of src.split(/\n(?=(?:async\s+)?function\s)/)) {
  const nm = part.match(/^(?:async\s+)?function\s+(\w+)\s*\(/)
  if (nm) parts[nm[1]] = part
}
const need = [
  'parseSelector', 'matchesSelector', 'spliceInElement', 'findElementRange',
  'isIifeScript', 'findDuplicateInserts', 'spliceComponentBlock',
  'looksLikeRegistryCode', 'matchRegistrySignatures', 'countSignatureHits',
  'registryEditReimplementation', 'ownedComponentBlocks', 'ownedBlocksDamaged',
]
for (const n of need) {
  if (!parts[n]) { console.error(`FAIL: function ${n} not found in tool-executors.js`); process.exit(1) }
}
const voidTags = src.match(/const VOID_TAGS = new Set\(\[[^\]]*\]\)/)
if (!voidTags) { console.error('FAIL: VOID_TAGS not found in tool-executors.js'); process.exit(1) }
const api = new Function(`${voidTags[0]}\n${need.map(n => parts[n]).join('\n')}\nreturn { ${need.join(', ')} }`)()

let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n      ${detail}`}`)
  if (!ok) failed += 1
}
const count = (s, sub) => s.split(sub).length - 1
if (!/case 'insert_component':\s*\n\s*return await executeInsertComponent\(/.test(src)) {
  check('executeTool dispatches insert_component', false, 'no `case \'insert_component\': return await executeInsertComponent(` in tool-executors.js')
}

const PAGE = `<!DOCTYPE html>
<html lang="no" data-theme="light">
<head>
<style>
:root { --bg-primary: #fefce8; }
</style>
<!-- component:demo-widget v1 — old header comment -->
<style data-component="demo-widget">
.demo-widget-btn { color: red; }
</style>
</head>
<body>
<div data-slot="header"><h1>Title</h1></div>
<script>
(function() {
  const KEY = "nibi-theme";
  const root = document.documentElement;
  root.setAttribute('data-x', KEY);
})();
</script>
<script>
(function(){
  if (window.__demoWidget) return;
  window.__demoWidget = true;
  console.log('old registry copy');
})();
</script>
<script>
(function(){
  var fab = document.createElement('button');
  fab.className = 'demo-widget-btn';
  console.log('hand-written attempt');
})();
</script>
</body>
</html>`

const IMPL = `<!-- component:demo-widget v3 -->
<style data-component="demo-widget">
.demo-widget-btn { color: blue; }
</style>
<script data-component="demo-widget">
(function () {
  if (window.__demoWidget) return;
  window.__demoWidget = true;
  var HOST = '%%VEGVISR_NODE_ID%%';
  var root = document.documentElement;
  var closeTag = '<' + '/style>';
})();
</script>`
const START = '<!-- vegvisr-component:demo-widget:start -->'

// ---- 1. first insert ----
const r1 = api.spliceComponentBlock(PAGE, 'demo-widget', IMPL, { nodeId: 'node-1' })
check('first insert returns html', typeof r1.html === 'string' && !r1.error, r1.error)
check('exactly one owned block', count(r1.html, START) === 1)
check('host node id stamped, placeholder gone', r1.html.includes("var HOST = 'node-1'") && !r1.html.includes('%%VEGVISR_NODE_ID%%'))
check('old <style data-component> copy removed', !r1.html.includes('color: red'))
check('old registry <script> copy (same guard) removed', !r1.html.includes('old registry copy'))
check('legacy header comment removed', !r1.html.includes('component:demo-widget v1'))
check('only the owned style + script carry data-component', count(r1.html, 'data-component="demo-widget"') === 2, `found ${count(r1.html, 'data-component="demo-widget"')}`)
check('unrelated page script untouched', r1.html.includes("root.setAttribute('data-x', KEY)"))
check('three provable copies reported removed', r1.removed.length === 3, JSON.stringify(r1.removed))
check('owned block sits before </body>', r1.html.indexOf(START) > r1.html.indexOf('hand-written attempt') && r1.html.indexOf(START) < r1.html.lastIndexOf('</body>'))
check('hand-written attempt reported, not removed', r1.suspected.length === 1 && r1.html.includes('hand-written attempt'), JSON.stringify(r1.suspected))
if (r1.suspected.length === 1) {
  const el = api.findElementRange(r1.html, 'script', r1.suspected[0].nth)
  check('reported nth is the one remove_html_element would remove', !el.error && r1.html.slice(el.innerStart, el.innerEnd).includes('hand-written attempt'), JSON.stringify(el))
}

// ---- 2. re-run = idempotent ----
const r2 = api.spliceComponentBlock(r1.html, 'demo-widget', IMPL, { nodeId: 'node-1' })
check('re-run with the same impl changes nothing', r2.html === r1.html && r2.upgraded === true)

// ---- 3. upgrade in place ----
const r3 = api.spliceComponentBlock(r1.html, 'demo-widget', IMPL.replace('color: blue', 'color: green'), { nodeId: 'node-1' })
check('upgrade replaces the owned block', r3.html.includes('color: green') && !r3.html.includes('color: blue') && count(r3.html, START) === 1)
check('upgrade keeps the block where it was', r3.html.indexOf(START) === r1.html.indexOf(START))

// ---- 4. removeSuspected ----
const r4 = api.spliceComponentBlock(r1.html, 'demo-widget', IMPL, { nodeId: 'node-1', removeSuspected: true })
check('removeSuspected deletes the hand-written attempt', !r4.html.includes('hand-written attempt') && r4.suspected.length === 0)
check('removeSuspected leaves unrelated scripts', r4.html.includes("root.setAttribute('data-x', KEY)"))

// ---- 5. target placement ----
const r5 = api.spliceComponentBlock(PAGE, 'demo-widget', IMPL, { nodeId: 'node-1', target: '[data-slot="header"]' })
const hdrOpen = r5.html.indexOf('<div data-slot="header">')
check('target places the block inside the element', !r5.error && r5.html.indexOf(START) > hdrOpen && r5.html.indexOf(START) < r5.html.indexOf('</div>', hdrOpen + 30), r5.error)

// ---- 6. duplicate guard ----
check('isIifeScript: (function(){})();', api.isIifeScript('\n(function(){ var a = 1; })();\n') === true)
check('isIifeScript: (() => {})()', api.isIifeScript('(() => { let b = 2 })()') === true)
check('isIifeScript: (function(){ }());', api.isIifeScript('(function(){ var c = 3; }());') === true)
check('isIifeScript: plain function is not', api.isIifeScript('function shared() {}') === false)
const agentSnippet = `<script>
(function () {
  if (window.__vegvisrThemePicker) return;
  window.__vegvisrThemePicker = true;
  var root = document.documentElement;
})();
</script>`
const rootHits = api.findDuplicateInserts(PAGE, agentSnippet)
check('IIFE-local `root` in page and snippet is NOT a duplicate', !rootHits.some(h => h.includes('"root"')), JSON.stringify(rootHits))
const guardHits = api.findDuplicateInserts(r1.html, `<script>(function(){ if (window.__demoWidget) return; window.__demoWidget = true; })();</script>`)
check('a second copy carrying the same window guard IS a duplicate', guardHits.some(h => h.includes('__demoWidget')), JSON.stringify(guardHits))
const fnHits = api.findDuplicateInserts('<script>\nfunction sharedFn() {}\n</script>', '<script>\nfunction sharedFn() { return 2 }\n</script>')
check('a top-level function defined twice IS a duplicate', fnHits.some(h => h.includes('sharedFn')), JSON.stringify(fnHits))

// ---- 7. registry re-implementation gate ----
const COMPS = [{ name: 'theme-picker', signatures: ['isThemeGraph', '__vegvisrTheme', 'theme-picker', 'Theme Catalog', '/theme/catalog'] }]
const handWrittenPicker = `<script>
(function(){
  if (window.__vegvisrThemeCatalog) return;
  window.__vegvisrThemeCatalog = true;
  fetch('https://knowledge.vegvisr.org/getknowgraphsummaries?limit=100').then(r => r.json()).then(d => {
    var themes = (d.results || []).filter(g => g.metadata && g.metadata.isThemeGraph);
  });
})();
</script>`
const hit = api.matchRegistrySignatures(handWrittenPicker, COMPS)
check('hand-written picker code is caught', !!hit && hit.component === 'theme-picker', JSON.stringify(hit))
check('page text mentioning the component is NOT caught', api.matchRegistrySignatures('<h2>Theme Catalog</h2><p>Velg et tema</p>', COMPS) === null)
check('a CSS rule for the component is NOT caught', api.matchRegistrySignatures('.theme-picker-btn { bottom: 90px; }', COMPS) === null)
check('an unrelated script is NOT caught', api.matchRegistrySignatures('<script>document.querySelector("#x").addEventListener("click", () => alert(1))</script>', COMPS) === null)
check('looksLikeRegistryCode: markup only is not code', api.looksLikeRegistryCode('<div class="theme-picker-card">x</div>') === false)
check('countSignatureHits counts every occurrence', api.countSignatureHits('theme-picker theme-picker isThemeGraph', ['theme-picker', 'isThemeGraph']) === 3)

const regionWithPicker = `<p>Tekst</p>\n${handWrittenPicker}`
const regionTextEdited = `<p>Ny tekst</p>\n${handWrittenPicker}`
const regionPickerEdited = regionWithPicker.replace('limit=100', 'limit=250')
check('editing a region that KEEPS the hand-written component is refused', !!api.registryEditReimplementation(regionWithPicker, regionTextEdited, COMPS))
check('patching the hand-written component itself is refused', !!api.registryEditReimplementation(regionWithPicker, regionPickerEdited, COMPS))
check('REMOVING the hand-written component is allowed', api.registryEditReimplementation(regionWithPicker, '<p>Tekst</p>', COMPS) === null)
check('an edit with no component code on either side is allowed', api.registryEditReimplementation('<p>a</p>', '<p>b</p>', COMPS) === null)
check('an unchanged region is allowed', api.registryEditReimplementation(regionWithPicker, regionWithPicker, COMPS) === null)

check('owned block edited is detected', api.ownedBlocksDamaged(r1.html, r1.html.replace('color: blue', 'color: crimson')).includes('demo-widget'))
check('owned block removed is detected', api.ownedBlocksDamaged(r1.html, PAGE).includes('demo-widget'))
check('an untouched owned block is not flagged', api.ownedBlocksDamaged(r1.html, r1.html + '\n<p>ny seksjon</p>').length === 0)
check('ownedComponentBlocks finds the block by name', Object.keys(api.ownedComponentBlocks(r1.html)).join() === 'demo-widget')

// The gate must be wired into every write path, with no force override.
for (const call of [
  "registryComponentRefusal('insert_html_at'", "registryComponentRefusal('insert_in_element'",
  "registryComponentRefusal('append_to_section'", "registryComponentRefusal('replace_html_section'",
  "registryComponentRefusal('edit_html_node'", "registryComponentRefusal('patch_node'",
]) check(`gate wired: ${call.split("'")[1]}`, src.includes(call))
check('fill_slot_with_component bypasses the gate (it inserts the registry impl itself)', /__registryInsert: true/.test(src))
check('the gate has no force override', !/force !== true[\s\S]{0,120}matchRegistrySignatures/.test(src))

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll component-insert checks passed.')
process.exit(failed ? 1 : 0)
