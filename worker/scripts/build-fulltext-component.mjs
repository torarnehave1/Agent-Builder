/**
 * Build worker/components/vegvisr-fulltext.js from the CANONICAL renderer.
 *
 * Source of truth for RENDERING is GNewDefaultNode.vue — the component GNewViewer uses.
 * (Source of truth for element SYNTAX is knowledge.vegvisr.org/plugin/fulltext-elements,
 * backed by D1 graphTemplates where category='Fulltext Elements'.)
 *
 * This script lifts the viewer's parsing functions VERBATIM out of the SFC's <script setup>
 * — they are plain JS with no Vue bindings — and wraps them in a framework-free component.
 * Two things the viewer expresses as Vue templates (the FLEXBOX variants and IMAGEQUOTE) are emitted as
 * string HTML here instead; three elements the viewer does not implement at all
 * ([FLEXBOX | …], [FLEXBOX-ROW], [pb]) are added so the component reaches the full catalog.
 *
 * Run: node scripts/build-fulltext-component.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'

const VIEWER = '/Users/torarnehave/Documents/GitHub/vegvisr-frontend/src/components/GNewNodes/GNewDefaultNode.vue'
const src = readFileSync(VIEWER, 'utf8')

// ── lift each named arrow function out of the SFC, verbatim ──────────────────
function lift(name) {
  const start = src.indexOf(`const ${name} = (`)
  if (start === -1) throw new Error(`build failed: ${name} not found in GNewDefaultNode.vue`)
  // These are consecutive top-level declarations. Ending at the NEXT top-level `const` and
  // trimming back to the last `}` is exact here, and unlike a brace counter it cannot be
  // fooled by an apostrophe in a comment or a `{n,}` quantifier inside a regex literal.
  let end = src.indexOf('\nconst ', start + 1)
  if (end === -1) end = src.length
  let body = src.slice(start, end)
  const close = body.lastIndexOf('}')
  if (close === -1) throw new Error(`build failed: no closing brace for ${name}`)
  return body.slice(0, close + 1)
}

const NAMES = [
  'preprocessTables', 'processLeftRightImages', 'processFormattedElementsPass',
  'parseStyleString', 'parseImageQuoteParams', 'camelToKebab', 'parseQuoteParams',
  'parseFormattedElements',
]
let lifted = NAMES.map(lift).join('\n\n')

// The viewer logs ~18 lines per render for debugging. Harmless in a dev view, noise on a
// published page — strip only whole-line console.log calls, never logic.
const before = lifted.length
lifted = lifted
  .split('\n')
  .filter(l => !/^\s*console\.log\(/.test(l))
  .join('\n')
  // multi-line console.log( ... ) calls: collapse the few that span lines
  .replace(/\n\s*console\.log\([\s\S]*?\)\n/g, '\n')
if (!lifted.includes('processFormattedElementsPass')) throw new Error('build failed: log stripping ate the source')

// sanity: every parser we rely on survived
for (const marker of ['COMMENT', 'FANCY', 'QUOTE', 'SECTION', 'WNOTE', 'YOUTUBE', 'INSTAGRAM', 'Header', 'Center', 'Rightside|Leftside', 'processLeftRightImages']) {
  if (!lifted.includes(marker)) throw new Error(`build failed: "${marker}" missing from lifted source`)
}

// ── CSS: the viewer's own rules for these elements ───────────────────────────
// GNewDefaultNode scopes its rules as `.node-content :deep(X)`; unwrap to plain `X`.
// The three Flexbox SFCs are <style scoped> and lift whole.
const CLASSES = [
  'fancy-title', 'fancy-quote', 'work-note', 'section', 'comment-',
  'imagequote', 'header-image', 'center-image', 'leftside', 'rightside',
  'flexbox-cards', 'flexbox-card', 'card-image', 'card-title', 'card-text',
  'flexbox-grid', 'grid-item', 'flexbox-gallery', 'gallery-item', 'gallery-image',
  'flexbox-row', 'flexbox-generic', 'vegvisr-page-break', 'youtube', 'instagram',
]
function styleBlocks(text) {
  const out = []
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g
  let m
  while ((m = re.exec(text)) !== null) out.push(m[1])
  return out.join('\n')
}
function unwrapDeep(css) {
  return css
    .replace(/\.node-content\s+:deep\(([^)]*)\)/g, '$1')
    .replace(/:deep\(([^)]*)\)/g, '$1')
}
function keepRelevant(css) {
  const kept = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(css)) !== null) {
    const sel = m[1].trim()
    if (!sel || sel.startsWith('@')) continue
    if (CLASSES.some(c => sel.includes(c))) kept.push(sel + ' {' + m[2] + '}')
  }
  return kept.join('\n')
}
const FLEX_DIR = '/Users/torarnehave/Documents/GitHub/vegvisr-frontend/src/components/'
let CSS = keepRelevant(unwrapDeep(styleBlocks(src)))
for (const f of ['FlexboxCards.vue', 'FlexboxGrid.vue', 'FlexboxGallery.vue']) {
  CSS += '\n' + unwrapDeep(styleBlocks(readFileSync(FLEX_DIR + f, 'utf8')))
}
CSS += `
.vegvisr-page-break { border: 0; border-top: 1px solid rgba(128,128,128,.35); margin: 32px 0; }
.flexbox-row { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; margin: 16px 0; }
.flexbox-row-item img { max-width: 100%; border-radius: 8px; }
.flexbox-generic { flex-wrap: wrap; gap: 12px; margin: 16px 0; }
.flexbox-generic img { max-width: 100%; border-radius: 8px; }
.imagequote-citation { position: absolute; bottom: 10px; right: 15px; font-size: .9em; opacity: .9; }
`
if (CSS.length < 1500) throw new Error(`build failed: CSS looks too small (${CSS.length} chars)`)

const out = `/*!
 * vegvisr-fulltext.js — renders Vegvisr fulltext elements + markdown in any page.
 *
 * GENERATED by worker/scripts/build-fulltext-component.mjs. The parsing functions are lifted
 * VERBATIM from GNewDefaultNode.vue — the renderer GNewViewer uses — so a published page and
 * the viewer agree. Do not hand-edit; edit the viewer and rebuild.
 *
 * Element syntax is defined by knowledge.vegvisr.org/plugin/fulltext-elements (D1 graphTemplates,
 * category='Fulltext Elements'). Never author element markup from memory.
 *
 * Delivery: stored as metadata.impl on the 'vegvisr-fulltext' node in the Component Registry
 * graph (4072b898-f111-42a9-b5ca-0d901bb17d26), served verbatim by api-worker as
 * https://api.vegvisr.org/components/vegvisr-fulltext.js. A page carries ONE <script src> line.
 *
 * Dependency: marked, from https://api.vegvisr.org/components/marked.min.js (own origin).
 *
 * API
 *   VegvisrFulltext.ready()            -> Promise, resolves when marked is loaded
 *   VegvisrFulltext.render(markdown)   -> html string (throws if not ready)
 *   VegvisrFulltext.renderInto(el, md) -> Promise
 *   <vegvisr-fulltext graph-id="…" node-id="…">  fetches the node and renders it
 */
(function () {
  'use strict';
  if (window.VegvisrFulltext) return; // idempotent

  var MARKED_URL = 'https://api.vegvisr.org/components/marked.min.js';
  var KG_BASE = 'https://knowledge.vegvisr.org';
  var STYLE_ID = 'vegvisr-fulltext-styles';
  var LOG = '[vegvisr-fulltext]';

  var CSS = ${JSON.stringify(CSS)};

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  var markedReady = null;
  function ready() {
    if (markedReady) return markedReady;
    markedReady = new Promise(function (resolve, reject) {
      if (window.marked) { return resolve(window.marked); }
      var s = document.createElement('script');
      s.src = MARKED_URL;
      s.onload = function () {
        if (window.marked) { console.info(LOG, 'marked loaded from', MARKED_URL); resolve(window.marked); }
        else reject(new Error(MARKED_URL + ' loaded but window.marked is undefined'));
      };
      s.onerror = function () { reject(new Error('failed to load ' + MARKED_URL)); };
      (document.head || document.documentElement).appendChild(s);
    });
    markedReady.catch(function (e) { console.error(LOG, e.message); });
    return markedReady;
  }

  // marked v15 exports an object; the viewer calls marked(text) as a function.
  function marked(text) {
    var m = window.marked;
    if (!m) throw new Error('marked not loaded — await VegvisrFulltext.ready()');
    return (typeof m === 'function' ? m : m.parse)(String(text == null ? '' : text));
  }
  marked.parse = marked;

  var esc = function (v) { return String(v == null ? '' : v).replace(/[<>"]/g, ''); };

  // ===== lifted verbatim from GNewDefaultNode.vue — do not hand-edit =====
${lifted.split('\n').map(l => l ? '  ' + l : l).join('\n')}
  // ===== end lifted =====

${readFileSync(new URL('./fulltext-blocks.js', import.meta.url), 'utf8')}

  function render(raw) {
    if (!window.marked) throw new Error('VegvisrFulltext.render() called before marked loaded — await VegvisrFulltext.ready() first, or use renderInto().');
    injectStyles();
    return renderStructured(String(raw == null ? '' : raw));
  }

  function renderInto(el, raw) {
    if (!el) return Promise.reject(new Error('renderInto(el, markdown): el is required'));
    return ready().then(function () { el.innerHTML = render(raw); return el; })
      .catch(function (e) {
        console.error(LOG, 'renderInto failed:', e.message);
        el.innerHTML = '<div style="padding:12px;border-left:3px solid #c33;color:#c33;">' + LOG + ' ' + e.message + '</div>';
        throw e;
      });
  }

  function fetchNode(graphId, opts) {
    return fetch(KG_BASE + '/getknowgraph?id=' + encodeURIComponent(graphId))
      .then(function (r) { if (!r.ok) throw new Error('getknowgraph ' + graphId + ' -> HTTP ' + r.status); return r.json(); })
      .then(function (g) {
        var nodes = (g && g.nodes) || [];
        var node = null;
        if (opts.nodeId) node = nodes.filter(function (n) { return n.id === opts.nodeId; })[0];
        else if (opts.nodeLabel) node = nodes.filter(function (n) { return String(n.label || '').trim() === opts.nodeLabel; })[0];
        else node = nodes.filter(function (n) { return n.type === 'fulltext'; })[0];
        if (!node) throw new Error('no matching node in graph ' + graphId);
        return node;
      });
  }

  if (window.customElements && !window.customElements.get('vegvisr-fulltext')) {
    window.customElements.define('vegvisr-fulltext', class extends HTMLElement {
      connectedCallback() {
        var el = this;
        var graphId = el.getAttribute('graph-id');
        var opts = { nodeId: el.getAttribute('node-id'), nodeLabel: el.getAttribute('node-label') };
        if (!graphId) { el.innerHTML = '<div style="padding:12px;color:#c33;">' + LOG + ' missing graph-id</div>'; return; }
        el.innerHTML = '<div style="padding:12px;opacity:.6;">Laster…</div>';
        Promise.all([ready(), fetchNode(graphId, opts)])
          .then(function (r) { injectStyles(); el.innerHTML = render(r[1].info || ''); })
          .catch(function (e) {
            console.error(LOG, e.message);
            el.innerHTML = '<div style="padding:12px;border-left:3px solid #c33;color:#c33;">' + LOG + ' ' + e.message + '</div>';
          });
      }
    });
  }

  window.VegvisrFulltext = { ready: ready, render: render, renderInto: renderInto, fetchNode: fetchNode, injectStyles: injectStyles };
  console.info(LOG, 'ready — VegvisrFulltext + <vegvisr-fulltext> registered');
})();
`

writeFileSync(new URL('../components/vegvisr-fulltext.js', import.meta.url), out)
console.log(`built components/vegvisr-fulltext.js — ${out.length} chars (lifted ${lifted.length}, css ${CSS.length}, ${before - lifted.length} chars of console.log stripped)`)
