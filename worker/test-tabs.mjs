// Guards for the managed tab set (2026-09-12, vegr-ai-homepage in graph 27f135ea).
//
// The failure this locks down: asked to put the graph-portfolio component "i en egen tab",
// the agent had no tab tool, so it guessed an edit anchor that did not exist, then wrote
// .tab-button/.tab-content CSS (v15) and a .tab-button controller (v16) onto a page with
// ZERO tab buttons and zero panels. Both writes returned success. The page showed no tabs.
//
// Tested here:
//   1. slugTabId — stable, deduped, Norwegian-safe ids (the #hash a tab deep-links on).
//   2. buildTabsBlock — every button has a panel and every panel a button (the id match no
//      hand-written tab set ever gets right), panels are <div> not <section>, one style +
//      one script, all inside ONE replaceable block.
//   3. readTabsBlock / panelInner — read back a set whose panels hold nested <div>s.
//   4. findLegacyTabScripts — recognises the real v16 controller, and knows DEAD (no
//      matching markup) from ALIVE (markup present) so a working page is never stripped.
//   5. detectDeadSelectorWiring — flags the real v15+v16 page, stays silent on a page whose
//      markup exists and on one that builds its elements at runtime.
//   6. The splice itself, against the REAL page: sections move byte-for-byte into panels,
//      no tag type is lost, the moved markup survives intact.
//   7. The wiring: definitions exist, the dispatcher routes all three tools.
//
// Run:  node worker/test-tabs.mjs   (exit 0 = pass, 1 = fail)

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  slugTabId, buildTabsBlock, buildTabPanel, buildTabButton, readTabsBlock, panelInner,
  findLegacyTabScripts, removeLegacyTabScripts, detectDeadSelectorWiring, retypedExistingContent,
} from './html-tabs.js'

const dir = path.dirname(fileURLToPath(import.meta.url))
const execSrc = fs.readFileSync(path.join(dir, 'tool-executors.js'), 'utf8')
const defSrc = fs.readFileSync(path.join(dir, 'tool-definitions.js'), 'utf8')

// Load the REAL selector engine out of the executor source (same splitting the other tests use).
const parts = {}
for (const part of execSrc.split(/\n(?=(?:async\s+)?function\s)/)) {
  const nm = part.match(/^(?:async\s+)?function\s+(\w+)\s*\(/)
  if (nm) parts[nm[1]] = part
}
const need = ['parseSelector', 'matchesSelector', 'findElementRange', 'countHtmlTags', 'tabsPreservationCheck', 'topLevelChildRanges', 'autoTabsContainer', 'resolveTabTargets']
for (const n of need) {
  if (!parts[n]) { console.error(`FAIL: function ${n} not found in tool-executors.js`); process.exit(1) }
}
const voidTags = execSrc.match(/const VOID_TAGS = new Set\(\[[^\]]*\]\)/)
const api = new Function(`${voidTags[0]}\n${need.map(n => parts[n]).join('\n')}\nreturn { ${need.join(', ')} }`)()

let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n      ${detail}`}`)
  if (!ok) failed += 1
}

// ── 1. ids ────────────────────────────────────────────────────────────────────
{
  const used = new Set()
  check('slugTabId slugifies Norwegian labels', slugTabId('Portefølje', used) === 'tab-portefoelje')
  check('slugTabId dedupes a repeated label', slugTabId('Portefølje', used) === 'tab-portefoelje-2')
  check('slugTabId survives an empty label', slugTabId('', new Set()) === 'tab-seksjon')
  check('slugTabId strips punctuation', slugTabId('Hva vi gjør!', new Set()) === 'tab-hva-vi-gjoer')
}

// ── 2. the block ──────────────────────────────────────────────────────────────
const TABS = [
  { id: 'tab-om-oss', label: 'Om oss', content: '<section><h2>Om oss</h2><div class="x">a</div></section>' },
  { id: 'tab-portefoelje', label: 'Portefølje', content: '<div data-vegvisr-portfolio="BLOGG"></div>' },
]
{
  const block = buildTabsBlock({ tabs: TABS, active: 'tab-portefoelje' })
  const btnIds = [...block.matchAll(/data-v-tab="([^"]+)"/g)].map(m => m[1])
  const panelIds = [...block.matchAll(/data-v-tab-panel="([^"]+)"/g)].map(m => m[1])
  check('every button has a panel and every panel a button', JSON.stringify(btnIds) === JSON.stringify(panelIds),
    `buttons=${btnIds} panels=${panelIds}`)
  check('aria-controls matches the panel id', /aria-controls="tab-om-oss"/.test(block) && /id="tab-om-oss"/.test(block))
  check('requested active tab is the one marked selected',
    /data-v-tab="tab-portefoelje"[^>]*aria-selected="true"/.test(block) && /class="v-tab-panel is-active" id="tab-portefoelje"/.test(block))
  check('unknown active falls back to the first tab',
    /data-v-tab="tab-om-oss"[^>]*aria-selected="true"/.test(buildTabsBlock({ tabs: TABS, active: 'nope' })))
  check('panels are <div> (a page\'s own section{} card styling must not double-frame them)',
    !/<section class="v-tab-panel/.test(block) && /<div class="v-tab-panel/.test(block))
  check('exactly one managed style and one managed script', (block.match(/<style data-v-tabs>/g) || []).length === 1 &&
    (block.match(/<script data-v-tabs>/g) || []).length === 1)
  check('content is carried verbatim into the panel', block.includes(TABS[0].content) && block.includes(TABS[1].content))
  check('the whole set is ONE replaceable block',
    block.startsWith('<!-- v-tabs:start -->') && block.trimEnd().endsWith('<!-- v-tabs:end -->'))
  check('managed CSS beats the page\'s own button{} rules by specificity (class selector, background:none)',
    /\.v-tab-btn\{[^}]*background:none/.test(block))
  check('the controller is not flagged as dead wiring by our own detector', detectDeadSelectorWiring(`<body>${block}</body>`).length === 0)
}

// ── 3. read back ──────────────────────────────────────────────────────────────
{
  const page = `<!DOCTYPE html><html><head><style>body{}</style></head><body>\n<div class="container">\n${buildTabsBlock({ tabs: TABS, active: 'tab-om-oss' })}\n</div></body></html>`
  const read = readTabsBlock(page)
  check('readTabsBlock finds the set', !!read && read.tabs.length === 2)
  check('readTabsBlock reports labels and the default tab',
    read.tabs.map(t => t.label).join('|') === 'Om oss|Portefølje' && read.activeDefault === 'tab-om-oss',
    JSON.stringify(read && read.tabs))
  check('panelInner walks nested <div>s instead of stopping at the first </div>',
    panelInner(page, 'tab-om-oss').includes('<div class="x">a</div>'))
  check('every panel reports non-zero content', read.tabs.every(t => t.hasPanel && t.contentChars > 0))
  check('readTabsBlock returns null when there is no set', readTabsBlock('<body><p>hi</p></body>') === null)
}

// ── 4+5. the real failing page ────────────────────────────────────────────────
// Trimmed to the shape that matters: v15's dead CSS, v16's dead controller, the component
// appended below the footer, and the sections that should have become tabs.
const REAL = `<!DOCTYPE html>
<html lang="no">
<head>
<style>
section { background: white; padding: 40px; }
button { background: #1a4d6d; color: white; }
.tabs { display: flex; }
.tab-button { background: none; }
.tab-button.active { color: #0f2a43; }
.tab-content { display: none; }
.tab-content.active { display: block; }
</style>
</head>
<body>
    <header><h1>VEGR.AI</h1></header>
    <div class="container">
        <section>
            <h2>Om oss</h2>
            <p>Vi leverer kunnskapsledelsessystemer.</p>
        </section>
        <section>
            <h2>Hva vi gjør</h2>
            <div class="features"><div class="feature-item"><h3>Kunnskapsorganisering</h3></div></div>
        </section>
        <section>
            <h2>Kontakt oss</h2>
            <div data-vegvisr-contact data-graph="27f135ea" data-node="vegr-ai-homepage"></div>
        </section>
    </div>
    <footer><p>VEGR.AI</p></footer>
<script src="https://api.vegvisr.org/components/graph-portfolio.js" defer></script>
<div data-vegvisr-portfolio="BLOGG, KUNNSKAPSLEDELSE" data-title="Kunnskapsportefølje"></div>
<script>
document.addEventListener('DOMContentLoaded', function() {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    tabButtons.forEach(button => {
        button.addEventListener('click', function() {
            const tabName = this.getAttribute('data-tab');
            tabContents.forEach(content => content.classList.remove('active'));
            this.classList.add('active');
        });
    });
});
</script>
</body>
</html>`
{
  const legacy = findLegacyTabScripts(REAL)
  check('the real v16 controller is recognised as a hand-rolled tab script', legacy.hits.length === 1)
  check('it is recognised as DEAD — no .tab-button/.tab-content element on the page', legacy.alive === false)
  check('a page WITH tab markup is reported alive (a working controller is never auto-stripped)',
    findLegacyTabScripts(REAL.replace('<footer>', '<button class="tab-button" data-tab="x">X</button><footer>')).alive === true)
  const stripped = removeLegacyTabScripts(REAL)
  check('removing the legacy controller leaves the component script alone',
    stripped.removed === 1 && stripped.html.includes('graph-portfolio.js') && !stripped.html.includes('tabButtons'))

  const gaps = detectDeadSelectorWiring(REAL)
  check('dead wiring IS detected on the real page (the gate that stayed silent through v15+v16)', gaps.length === 1, JSON.stringify(gaps))
  check('the gap names the selector and points at apply_tabs',
    gaps[0] && gaps[0].includes('".tab-button"') && gaps[0].includes('apply_tabs'), gaps[0])
  check('no false positive once the markup exists',
    detectDeadSelectorWiring(REAL.replace('<footer>', '<div class="tab-content"><button class="tab-button">X</button></div><footer>')).length === 0)
  check('no false positive for elements the script creates at runtime',
    detectDeadSelectorWiring(`<body><script>var d=document.createElement('div');d.classList.add('made-up');document.body.appendChild(d);document.querySelectorAll('.made-up').forEach(function(x){x.textContent='1'})</script></body>`).length === 0)
  check('a bare lookup whose result is never used is not reported',
    detectDeadSelectorWiring(`<body><script>var probe=document.querySelector('.maybe-there');</script></body>`).length === 0)
}

// ── 6. the splice, on the real page ───────────────────────────────────────────
{
  const mapping = [
    { id: 'tab-om-oss', label: 'Om oss', target: 'section', nth: 1 },
    { id: 'tab-hva-vi-gjoer', label: 'Hva vi gjør', target: 'section', nth: 2 },
    { id: 'tab-kontakt', label: 'Kontakt', target: 'section', nth: 3 },
    { id: 'tab-portefoelje', label: 'Portefølje', target: '[data-vegvisr-portfolio]' },
  ]
  // Same algorithm as executeApplyTabs: resolve all, cut from the end, mount where the first was.
  const resolved = mapping.map(m => ({ ...m, range: api.findElementRange(REAL, m.target, m.nth) }))
  check('every mapped selector resolves on the real page', resolved.every(r => !r.range.error),
    JSON.stringify(resolved.filter(r => r.range.error).map(r => [r.target, r.range.error])))
  const mapped = [...resolved].sort((a, b) => a.range.start - b.range.start)
  check('no mapped element contains another', mapped.every((r, i) => i === 0 || r.range.start >= mapped[i - 1].range.end))
  let working = REAL
  const MOUNT = '<!--v-tabs-mount-->'
  for (const r of [...mapped].reverse()) {
    r.content = working.slice(r.range.start, r.range.end)
    working = working.slice(0, r.range.start) + (r === mapped[0] ? MOUNT : '') + working.slice(r.range.end)
  }
  working = working.replace(MOUNT, buildTabsBlock({ tabs: resolved, active: 'tab-om-oss' }))
  const legacyOut = removeLegacyTabScripts(working)
  working = legacyOut.html

  check('the moved markup survives byte-for-byte', resolved.every(r => working.includes(r.content.replace(/^\n+|\n+$/g, ''))))
  check('the portfolio component ends up INSIDE its panel',
    (panelInner(working, 'tab-portefoelje') || '').includes('data-vegvisr-portfolio'))
  check('the contact form ends up inside the Kontakt panel',
    (panelInner(working, 'tab-kontakt') || '').includes('data-vegvisr-contact'))
  check('nothing is left outside the tab set that should be in it',
    !/<\/footer>\s*<script src="https:\/\/api\.vegvisr\.org\/components\/graph-portfolio\.js"[^>]*><\/script>\s*<div data-vegvisr-portfolio/.test(working))
  check('the component\'s <script src> is NOT swallowed into a panel (it stays a page-level load)',
    working.includes('graph-portfolio.js'))
  const dropped = api.tabsPreservationCheck(REAL, working, legacyOut.removed)
  check('no tag type is lost by the rebuild', dropped.length === 0, dropped.join(', '))
  check('the rebuilt page has no dead wiring left', detectDeadSelectorWiring(working).length === 0,
    JSON.stringify(detectDeadSelectorWiring(working)))
  check('one set, one controller (re-running replaces, never stacks)',
    (working.match(/<!-- v-tabs:start -->/g) || []).length === 1 &&
    (working.match(/<script data-v-tabs>/g) || []).length === 1)
  const read = readTabsBlock(working)
  check('the result reads back as a 4-tab set', read && read.tabs.length === 4, JSON.stringify(read && read.tabs))
}

// ── 7. wiring ─────────────────────────────────────────────────────────────────
for (const t of ['apply_tabs', 'add_tab', 'list_tabs']) {
  check(`${t} is defined in tool-definitions.js`, new RegExp(`name: '${t}'`).test(defSrc))
  const fn = 'execute' + t.split('_').map(s => s[0].toUpperCase() + s.slice(1)).join('')
  check(`executeTool dispatches ${t} → ${fn}`,
    new RegExp(`case '${t}':\\s*\\n\\s*return await ${fn}\\(`).test(execSrc))
  check(`${fn} exists`, !!parts[fn])
}
check('apply_tabs refuses a partial build (no tab may be left unresolved)',
  /NOTHING was written — every tab must resolve first/.test(execSrc))
check('apply_tabs verifies content preservation before it saves',
  /tabsPreservationCheck\(original, working, legacyRemoved\)/.test(execSrc))
check('add_tab on a page with NO tabs bootstraps the set instead of refusing (the requirement)',
  /NO tab set yet → this IS the "one extra tab beside what is already there" case/.test(execSrc))
check('the functional-coherence gate calls the dead-wiring detector',
  /gaps\.push\(\.\.\.detectDeadSelectorWiring\(h\)\)/.test(fs.readFileSync(path.join(dir, 'html-builder-subagent.js'), 'utf8')))
{
  const loop = fs.readFileSync(path.join(dir, 'agent-loop.js'), 'utf8')
  check('apply_tabs/add_tab run sequentially (they are node writers)',
    /SEQUENTIAL_TOOLS = new Set\(\[[\s\S]*?'apply_tabs', 'add_tab',[\s\S]*?\]\)/.test(loop))
  check('the tab tools refresh the preview + get syntax-checked',
    /HTML_EDIT_TOOLS_WITH_HTML = new Set\(\[[\s\S]*?'apply_tabs', 'add_tab'/.test(loop))
  check('a tab edit arms the functional-coherence gate', /apply_tabs\|add_tab/.test(loop))
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed')
process.exit(failed ? 1 : 0)

// ── 8. THE REQUIREMENT (2026-09-12, round 2) ──────────────────────────────────
// "Jeg ba ikke om flere enn 1 ekstra tab, ikke mange tabs."
// One target per tab made that inexpressible: the agent made every section its own tab,
// then retyped the page into `html` — and its retyped copy replaced the live
// <div data-vegvisr-contact> component with an invented <form>. These checks encode what
// was ASKED for, not what the failing transcript happened to do.
{
  const c = api.autoTabsContainer(REAL)
  check('the page container is found automatically', c && c.selector === '.container', JSON.stringify(c && c.selector))
  const top = api.topLevelChildRanges(REAL, c.range.innerStart, c.range.innerEnd)
  check('its top-level children are swept (3 sections, no scripts/styles)', top.length === 3 && top.every(t => t.tag === 'section'),
    JSON.stringify(top.map(t => t.tag)))

  // add_tab's bootstrap path: everything already there = tab 1, the component = tab 2.
  const claimed = [api.findElementRange(REAL, '[data-vegvisr-portfolio]')]
  const swept = api.topLevelChildRanges(REAL, c.range.innerStart, c.range.innerEnd)
    .filter(x => !claimed.some(k => x.start < k.end && k.start < x.end))
  const tabs = [
    { id: 'tab-innhold', label: 'Innhold', ranges: swept },
    { id: 'tab-portefoelje', label: 'Portefølje', ranges: claimed },
  ]
  const all = tabs.flatMap(t => t.ranges.map(r => ({ r, t }))).sort((a, b) => a.r.start - b.r.start)
  let w = REAL
  const MOUNT = '<!--v-tabs-mount-->'
  const mountRange = all[0].r
  for (const { r, t } of [...all].reverse()) {
    t.chunks = t.chunks || []; t.chunks.unshift(w.slice(r.start, r.end))
    w = w.slice(0, r.start) + (r === mountRange ? MOUNT : '') + w.slice(r.end)
  }
  w = w.replace(MOUNT, buildTabsBlock({ tabs: tabs.map(t => ({ ...t, content: t.chunks.join('\n') })), active: 'tab-innhold' }))
  w = removeLegacyTabScripts(w).html

  const read = readTabsBlock(w)
  check('ONE extra tab, not many: exactly 2 tabs', read.tabs.length === 2, JSON.stringify(read.tabs.map(t => t.label)))
  const innhold = panelInner(w, 'tab-innhold')
  check('ALL three existing sections sit in the first tab, together', (innhold.match(/<section/g) || []).length === 3,
    String((innhold.match(/<section/g) || []).length))
  check('the live contact component survived as itself (not retyped into a <form>)',
    innhold.includes('data-vegvisr-contact') && !/<form/.test(innhold))
  check('the component is alone in the second tab', (panelInner(w, 'tab-portefoelje') || '').includes('data-vegvisr-portfolio'))
  check('nothing is left loose in the container beside the tab set', (() => {
    const cc = api.findElementRange(w, '.container')
    const set = api.findElementRange(w, '[data-v-tabs-root]')
    return api.topLevelChildRanges(w, cc.innerStart, cc.innerEnd).filter(x => x.start >= set.end || x.end <= set.start).length === 0
  })())
  check('no tag type lost', api.tabsPreservationCheck(REAL, w, 1).length === 0, api.tabsPreservationCheck(REAL, w, 1).join(', '))
  check('header and footer stay OUTSIDE the tabs', !panelInner(w, 'tab-innhold').includes('<footer') && w.includes('<footer'))
}

// ── 9. the retyped-content guard ──────────────────────────────────────────────
{
  const retyped = `<section><h2>Om oss</h2><p>Vi leverer kunnskapsledelsessystemer.</p></section>
    <section><h2>Kontakt oss</h2><form><input placeholder="Ditt navn"></form></section>`
  check('html that is already on the page is caught as retyped content',
    retypedExistingContent(REAL, retyped).length >= 2, JSON.stringify(retypedExistingContent(REAL, retyped)))
  check('genuinely new html is not flagged',
    retypedExistingContent(REAL, '<section><h2>Nyheter</h2><p>Her kommer nyheter fra teamet vårt hver uke framover.</p></section>').length === 0)
  check('a short snippet is never flagged', retypedExistingContent(REAL, '<div data-vegvisr-portfolio="BLOGG"></div>').length === 0)
}

// ── 10. the new refusals ──────────────────────────────────────────────────────
check('apply_tabs refuses two tabs with the same label', /two tabs are both labelled/.test(execSrc))
check('apply_tabs refuses html that is already on the page', /passes html that is ALREADY on this page/.test(execSrc))
check('add_tab bootstraps a set when the page has none (one extra tab beside the page)',
  /had no tabs, so this created the set: everything already on the page is now the/.test(execSrc))
check('apply_tabs reports what is still OUTSIDE the tab set', /STILL OUTSIDE the tab set, inside/.test(execSrc))
check('a multi-match target tells the model how to put SEVERAL elements in one tab',
  /pass targets:\[\{target:"\$\{target\}",nth:1\}/.test(execSrc))
