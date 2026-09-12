// html-tabs.js — the managed tab set for html-nodes (deterministic, content-preserving).
//
// WHY THIS EXISTS (2026-09-12, vegr-ai-homepage in graph 27f135ea):
// "Du la til komponenten men ikke i en egen tab?" — the agent had appended the
// graph-portfolio component below the footer and was asked to put it in its own tab.
// It had no tool for that, so it improvised: guessed an anchor that did not exist
// (read_html_section 'container' → "This page has no edit anchors yet"), then
// insert_html_at('append_to_style') with .tabs/.tab-button/.tab-content CSS (v15), then
// insert_html_at('before_body_end') with a controller querying '.tab-button' (v16) — on a
// page that had NOT ONE tab button or panel. Both writes returned success. The page was
// left with dead CSS, a dead controller and the component still outside everything, and
// the agent then delegated a whole-page restructure to the html-builder.
//
// Tabs are a RESTRUCTURE: existing sections have to be wrapped in panels, a bar of
// buttons generated, and ids matched between the two. The additive primitives
// (insert_html_at / insert_in_element) cannot wrap anything, and move_html_element moves
// one element at a time into containers that do not exist yet — so the model bolts on the
// CSS and JS it CAN write and the markup never arrives. This is the same failure
// apply_layout was built for ("restructuring a whole page overruns the turn budget and
// silently fails"), and the same fix: ONE deterministic server-side call.
//
// Design, load-bearing:
//  - Content is MOVED by byte range, never retyped — nothing can be lost or reworded.
//  - The whole set lives in ONE replaceable <!-- v-tabs --> block, so re-running upgrades
//    it in place instead of stacking a second controller (the duplicate-declaration
//    failure html-i18n.js exists for).
//  - Class names are v- prefixed. A page's own `section {…}` card styling and global
//    `button {…}` rules must not leak into the panels/bar, and the page's existing
//    .tabs/.tab-content rules (dead or alive) must not collide with the managed ones.
//  - Panels are <div>, not <section>: on the page above, `section { background:white;
//    padding:40px; box-shadow… }` would have drawn a card around every card.

export const TABS_START = '<!-- v-tabs:start -->'
export const TABS_END = '<!-- v-tabs:end -->'
const TABS_BLOCK_RE = /[ \t]*<!-- v-tabs:start -->[\s\S]*?<!-- v-tabs:end -->[ \t]*\n?/

/** URL/id-safe slug for a tab, deduped against ids already taken. */
export function slugTabId(label, used) {
  const base = String(label == null ? '' : label)
    .toLowerCase()
    .replace(/[æ]/g, 'ae').replace(/[ø]/g, 'oe').replace(/[å]/g, 'aa')
    .replace(/[áàâä]/g, 'a').replace(/[éèêë]/g, 'e').replace(/[íìîï]/g, 'i')
    .replace(/[óòôö]/g, 'o').replace(/[úùûü]/g, 'u').replace(/[ç]/g, 'c').replace(/[ñ]/g, 'n')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  let id = `tab-${base || 'seksjon'}`
  if (!used) return id
  let n = 2
  while (used.has(id)) { id = `tab-${base || 'seksjon'}-${n}`; n += 1 }
  used.add(id)
  return id
}

/**
 * The inner markup of one panel, found by depth-counting <div>s from its open tag (the
 * panels hold whole page sections, so a plain lazy regex would stop at the first nested
 * </div>). Returns null when the panel is not there.
 */
export function panelInner(html, id) {
  const src = String(html || '')
  const open = new RegExp(`<div\\b[^>]*\\bdata-v-tab-panel=["']${String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`, 'i')
  const m = src.match(open)
  if (!m) return null
  const from = m.index + m[0].length
  const re = /<div\b[^>]*>|<\/div\s*>/gi
  re.lastIndex = from
  let depth = 1, hit
  while ((hit = re.exec(src)) !== null) {
    if (hit[0][1] === '/') { depth -= 1; if (depth === 0) return src.slice(from, hit.index) }
    else depth += 1
  }
  return null
}

/**
 * Read the managed block out of a node: its byte range and the tab set it declares.
 * Returns null when the page has no managed tabs (which is itself the answer the failed
 * run needed — it guessed an anchor instead of asking).
 */
export function readTabsBlock(html) {
  const src = String(html || '')
  const m = src.match(TABS_BLOCK_RE)
  if (!m) return null
  const start = m.index
  const end = m.index + m[0].length
  const inner = m[0]
  const tabs = []
  for (const b of inner.matchAll(/<button\b[^>]*\bdata-v-tab=["']([^"']+)["'][^>]*>([\s\S]*?)<\/button>/gi)) {
    tabs.push({ id: b[1], label: b[2].replace(/<[^>]+>/g, '').trim() })
  }
  for (const t of tabs) {
    const body = panelInner(inner, t.id)
    t.hasPanel = body !== null
    t.contentChars = body ? body.trim().length : 0
  }
  const act = inner.match(/class=["']v-tabs["'][^>]*\bdata-v-tab-active=["']([^"']*)["']/i)
  return { start, end, inner, tabs, activeDefault: act ? act[1] : (tabs[0] ? tabs[0].id : null) }
}

/**
 * Hand-rolled tab controllers from before this tool existed — and the ones a model writes
 * when it cannot wrap the markup. Signature: an inline <script> that queries the
 * conventional tab classes or data-tab attribute. Two controllers on one page fight over
 * the same buttons, so apply_tabs replaces them; `alive` says whether the page actually
 * HAS such markup (false = the script is dead code, safe to drop without asking).
 */
export function findLegacyTabScripts(html) {
  const src = String(html || '')
  const hits = []
  for (const m of src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(m[1] || '')) continue
    if (/\bdata-v-tabs\b/i.test(m[1] || '')) continue // ours
    const body = m[2] || ''
    const touchesTabs = /["'`]\.tab-button["'`]|["'`]\.tab-content["'`]|["'`]\[data-tab\]?["'`]|getAttribute\(\s*["'`]data-tab["'`]/.test(body)
    if (!touchesTabs) continue
    hits.push({ start: m.index, end: m.index + m[0].length, chars: m[0].length })
  }
  const markupAlive = /class=["'][^"']*\btab-button\b/i.test(src) ||
    /class=["'][^"']*\btab-content\b/i.test(src) ||
    /<[a-z][^>]*\sdata-tab\s*=/i.test(src)
  return { hits, alive: markupAlive }
}

export function removeLegacyTabScripts(html) {
  const { hits } = findLegacyTabScripts(html)
  if (!hits.length) return { html: String(html || ''), removed: 0, chars: 0 }
  let out = String(html || '')
  let chars = 0
  for (const hit of [...hits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, hit.start) + out.slice(hit.end)
    chars += hit.chars
  }
  return { html: out, removed: hits.length, chars }
}

export function stripTabsBlock(html) {
  const src = String(html || '')
  const m = src.match(TABS_BLOCK_RE)
  if (!m) return { html: src, removed: false, inner: '' }
  return { html: src.slice(0, m.index) + src.slice(m.index + m[0].length), removed: true, inner: m[0] }
}

const TABS_STYLE = `
/* managed by apply_tabs — v- prefixed so the page's own button/section rules cannot leak in */
.v-tabs{display:flex;flex-wrap:wrap;gap:.25rem;border-bottom:2px solid rgba(0,0,0,.14);margin:0 0 1.5rem}
.v-tab-btn{appearance:none;-webkit-appearance:none;background:none;border:0;border-bottom:3px solid transparent;border-radius:0;margin:0;padding:.75rem 1.1rem;font:inherit;font-weight:600;color:inherit;opacity:.6;cursor:pointer;transition:opacity .2s,border-color .2s}
.v-tab-btn:hover,.v-tab-btn:focus-visible{background:none;opacity:1}
.v-tab-btn[aria-selected="true"]{opacity:1;border-bottom-color:currentColor}
.v-tab-panel{display:none}
.v-tab-panel.is-active{display:block}
@media (max-width:600px){.v-tab-btn{padding:.6rem .7rem;font-size:.95em}}`

// Runs where it is written — at the end of its own block, so every button and panel it
// queries is already parsed (detectPrematureInit's failure mode), and it re-checks on
// DOMContentLoaded in case the block is later moved above the markup. Idempotent: a
// second copy of the block cannot double-bind, because init marks the bar it wired.
const TABS_SCRIPT = `
(function(){
  function wire(bar){
    if(!bar||bar.dataset.vTabsReady==='1')return;
    bar.dataset.vTabsReady='1';
    var scope=bar.closest('[data-v-tabs-root]')||document;
    function panels(){return scope.querySelectorAll('.v-tab-panel');}
    function buttons(){return bar.querySelectorAll('.v-tab-btn');}
    function show(id,push){
      var found=false;
      panels().forEach(function(p){var on=p.getAttribute('data-v-tab-panel')===id;p.classList.toggle('is-active',on);if(on)found=true;});
      buttons().forEach(function(b){var on=b.getAttribute('data-v-tab')===id;b.setAttribute('aria-selected',on?'true':'false');b.setAttribute('tabindex',on?'0':'-1');});
      if(found&&push&&window.history&&history.replaceState)try{history.replaceState(null,'','#'+id);}catch(e){}
      return found;
    }
    bar.addEventListener('click',function(e){
      var b=e.target&&e.target.closest?e.target.closest('.v-tab-btn'):null;
      if(!b||!bar.contains(b))return;
      e.preventDefault();show(b.getAttribute('data-v-tab'),true);
    });
    bar.addEventListener('keydown',function(e){
      if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft')return;
      var list=[].slice.call(buttons());if(!list.length)return;
      var i=list.findIndex(function(b){return b.getAttribute('aria-selected')==='true';});
      var n=list[(i+(e.key==='ArrowRight'?1:list.length-1)+list.length)%list.length];
      if(n){e.preventDefault();show(n.getAttribute('data-v-tab'),true);n.focus();}
    });
    var want=(location.hash||'').replace('#','');
    if(!want||!show(want,false)){
      var pref=bar.getAttribute('data-v-tab-active');
      var first=bar.querySelector('.v-tab-btn');
      show(pref||(first?first.getAttribute('data-v-tab'):''),false);
    }
  }
  function boot(){[].forEach.call(document.querySelectorAll('.v-tabs'),wire);}
  boot();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);
})();`

export function buildTabButton(tab, isActive) {
  const label = String(tab.label || tab.id).replace(/</g, '&lt;')
  return `    <button type="button" class="v-tab-btn" role="tab" id="v-tabbtn-${tab.id}" data-v-tab="${tab.id}" aria-controls="${tab.id}" aria-selected="${isActive ? 'true' : 'false'}" tabindex="${isActive ? '0' : '-1'}">${label}</button>`
}

export function buildTabPanel(tab, content) {
  const body = String(content == null ? '' : content).replace(/^\n+|\n+$/g, '')
  return `  <div class="v-tab-panel${tab.isActive ? ' is-active' : ''}" id="${tab.id}" data-v-tab-panel="${tab.id}" role="tabpanel" aria-labelledby="v-tabbtn-${tab.id}">
${body}
  </div>`
}

/**
 * The whole tab set as ONE replaceable block. `tabs` is [{ id, label, content }] in tab
 * order; `content` is the EXACT markup moved out of the page (never retyped).
 */
export function buildTabsBlock({ tabs, active, ariaLabel }) {
  const list = (tabs || []).filter(t => t && t.id)
  const activeId = list.some(t => t.id === active) ? active : (list[0] ? list[0].id : '')
  const bar = [
    `<div class="v-tabs" role="tablist" aria-label="${String(ariaLabel || 'Seksjoner').replace(/"/g, '&quot;')}" data-v-tab-active="${activeId}">`,
    ...list.map(t => buildTabButton(t, t.id === activeId)),
    '  </div>',
  ].join('\n')
  const panels = list.map(t => buildTabPanel({ ...t, isActive: t.id === activeId }, t.content)).join('\n')
  return [
    TABS_START,
    `<div class="v-tab-set" data-v-tabs-root>`,
    '  ' + bar,
    panels,
    '</div>',
    `<style data-v-tabs>${TABS_STYLE}\n</style>`,
    `<script data-v-tabs>${TABS_SCRIPT}\n</script>`,
    TABS_END,
  ].join('\n')
}

/**
 * Every class/id an inline script LOOKS UP but that no element on the page carries — the
 * defect class the vegr-ai run shipped twice in a row (a .tab-button controller on a page
 * with no .tab-button). Returns human gap strings, same shape as detectFunctionalGaps.
 *
 * Deliberately narrow, because a false positive teaches the agent to ignore the gate:
 *  - only single-class / single-id literal selectors (no descendant/combinator selectors),
 *  - skipped when any script could CREATE the element (classList.add, className,
 *    class="…" inside a string, createElement),
 *  - skipped unless the lookup result is actually used (forEach / addEventListener / [0] /
 *    .length / .classList), so a defensive probe is not reported.
 */
export function detectDeadSelectorWiring(html) {
  const src = String(html || '')
  const markupClasses = new Set()
  for (const m of src.matchAll(/\sclass=["']([^"']+)["']/gi)) {
    for (const c of m[1].split(/\s+/)) if (c) markupClasses.add(c)
  }
  const markupIds = new Set()
  for (const m of src.matchAll(/\sid=["']([^"'\s]+)["']/gi)) markupIds.add(m[1])

  // Every inline script's body, so a selector one script queries can be cleared by the
  // element another script builds.
  const scripts = []
  for (const s of src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(s[1] || '')) continue
    scripts.push(s[2] || '')
  }
  const allScripts = scripts.join('\n')
  // A script that INJECTS markup can create anything — skip it wholesale rather than guess.
  // (classList.add on its own does NOT count: the failing controller calls
  // classList.add('active') on elements it never creates, and treating that as creation is
  // what made this detector silent on the page it was written for.)
  const injects = /createElement\s*\(|insertAdjacentHTML\s*\(|\.(?:inner|outer)HTML\s*=|\.insertBefore\s*\(|\.appendChild\s*\(/.test(allScripts)

  const dead = new Map() // selector -> how many scripts query it
  for (const body of scripts) {
    if (injects) continue
    for (const q of body.matchAll(/(?:querySelectorAll|querySelector)\(\s*["'`]([.#][\w-]+)["'`]\s*\)([\s\S]{0,80})/g)) {
      const sel = q[1]
      // The lookup must actually be USED — either straight away, or through the variable it
      // is assigned to further down (the failing controller did
      // `const tabButtons = document.querySelectorAll('.tab-button')` and only called
      // tabButtons.forEach(…) three lines later, which an after-the-call window misses).
      const usedAfter = /\.(?:forEach|addEventListener|classList|length|textContent|innerHTML|style|value|click)\b|\[\s*\d+\s*\]|\bfor\s*\(/.test(q[2] || '')
      const assign = body.slice(Math.max(0, q.index - 60), q.index).match(/(?:const|let|var)\s+([\w$]+)\s*=\s*[\w.$]*$/)
      const usedVia = assign ? new RegExp(`\\b${assign[1]}\\s*[.[]`).test(body.slice(q.index + q[0].length - (q[2] || '').length)) : false
      if (!usedAfter && !usedVia) continue
      const name = sel.slice(1)
      const present = sel[0] === '.' ? markupClasses.has(name) : markupIds.has(name)
      if (present) continue
      // Named in a creation context anywhere on the page → it may appear at runtime.
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const dynamic = new RegExp(`classList\\s*\\.\\s*(?:add|toggle)\\s*\\(\\s*["'\`]${esc}["'\`]|className\\s*=[^\\n;]*${esc}|class\\s*=\\s*\\\\?["'\`][^"'\`]*\\b${esc}\\b|\\bid\\s*=\\s*\\\\?["'\`]${esc}["'\`]`).test(allScripts)
      if (dynamic) continue
      dead.set(sel, (dead.get(sel) || 0) + 1)
    }
  }
  if (!dead.size) return []
  const sels = [...dead.keys()]
  const tabby = sels.some(s => /tab/i.test(s))
  return [`Script is PRESENT but DEAD — it queries ${sels.map(s => `"${s}"`).join(', ')} and NO element on the page carries ${sels.length === 1 ? 'that class/id' : 'those classes/ids'}, so querySelectorAll returns an empty list, every addEventListener is skipped, and nothing happens when the user clicks. There is no console error and no syntax error, so the tool results all said "success". The CSS and the controller are only two thirds of the feature — the MARKUP the controller drives is missing.${tabby ? ' For TABS this is exactly what apply_tabs is for: it wraps the existing sections in panels, generates the matching buttons, and installs ONE managed controller — do not hand-write the bar on top of this dead script, call apply_tabs(graphId, nodeId, tabs:[{label, target}, …]) and let it replace it.' : ' Either add the markup those selectors need, or remove the dead script.'}`]
}
