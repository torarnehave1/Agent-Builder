// html-i18n.js — string extraction + the managed translation block for html-nodes.
//
// WHY THIS EXISTS (2026-08-13, ravner.vegvisr.org):
// Asked to make a page switch to English, the agent called read_node, got all 70 795
// chars back, and then wrote the Norwegian source strings of its translation dictionary
// FROM MEMORY. Measured on the live page afterwards: 49 dictionary keys, 255 visible
// strings on the page, 3 keys that actually matched. Clicking ENG changed the heading and
// two tabs — "kun tittelen endres". A second attempt stacked another `const translations`
// on top of the first and the page died with "Identifier 'translations' has already been
// declared".
//
// The fix is to take the source strings away from the model entirely:
//   - extractTranslatableStrings() reads the REAL strings out of the node and hands them
//     back with ids; the model only ever supplies a translation per id.
//   - buildI18nBlock() writes ONE managed, replaceable block, so re-running can never
//     produce a duplicate declaration.
// Extraction covers markup text AND the user-facing string literals inside <script> data
// arrays — on the ravner page 228 of the 255 visible strings are in markup and ~27 are
// built at runtime by its d3/timeline scripts from literals in the source.

// ── text helpers ──────────────────────────────────────────────────

// The runtime keys on this normalization, so extraction must use the exact same one.
// HTML collapses whitespace when rendering, so a paragraph broken across source lines
// and the same paragraph on one line must produce one key.
export function normText(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
}

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ',
  thinsp: ' ', shy: '', mdash: '—', ndash: '–', hellip: '…', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', bull: '•', middot: '·', deg: '°',
  copy: '©', reg: '®', trade: '™', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç',
  uuml: 'ü', ouml: 'ö', auml: 'ä', aring: 'å', Aring: 'Å', oslash: 'ø', Oslash: 'Ø',
  aelig: 'æ', AElig: 'Æ', szlig: 'ß', times: '×', divide: '÷', euro: '€', pound: '£',
}

export function decodeEntities(s) {
  return String(s == null ? '' : s).replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (m, body) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10)
      if (!Number.isFinite(cp) || cp < 1 || cp > 0x10ffff) return m
      try { return String.fromCodePoint(cp) } catch { return m }
    }
    const hit = NAMED_ENTITIES[body] !== undefined ? NAMED_ENTITIES[body] : NAMED_ENTITIES[body.toLowerCase()]
    return hit === undefined ? m : hit
  })
}

// Undo the JS escapes inside a source-level string literal.
function decodeJsString(s) {
  return String(s == null ? '' : s).replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (m, body) => {
    if (body[0] === 'u' || body[0] === 'x') {
      const hex = body[0] === 'u' && body[1] === '{' ? body.slice(2, -1) : body.slice(1)
      const cp = parseInt(hex, 16)
      if (!Number.isFinite(cp)) return m
      try { return String.fromCodePoint(cp) } catch { return m }
    }
    const simple = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0' }
    return simple[body] !== undefined ? simple[body] : body
  })
}

// Blank out a region while keeping every byte position (so later index math stays valid).
function blank(m) {
  return m.replace(/[^\n]/g, ' ')
}

// Elements whose text is never page copy (or whose whitespace is significant).
const TEXT_SKIP_TAGS = 'script|style|pre|textarea|noscript|template'

function maskNonTextRegions(html) {
  return String(html || '')
    .replace(new RegExp(`<(${TEXT_SKIP_TAGS})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, 'gi'), blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
}

// ── what counts as translatable ───────────────────────────────────

const HAS_LETTER = /\p{L}/u
const URLISH = /^(https?:|mailto:|tel:|data:|blob:|\/\/|\.{0,2}\/)|\.(js|css|png|jpe?g|svg|gif|webp|woff2?|json|mp4|webm)(\?|#|$)/i
const CSS_DECL = /^[\w-]+\s*:\s*[^;]+;/
const SELECTORISH = /^[#.][\w-]+$/
const TOKENISH = /^[A-Za-z0-9_$-]+$/
const MEDIA_QUERY = /^\(?\s*(?:prefers-|min-|max-|orientation\s*:|only\s|screen\b|print\b)/i
// A capitalised single word IS page copy often enough to keep ("Bhutan", "Japan"), while
// the shape excludes camelCase/ALLCAPS identifiers ("DOMContentLoaded", "JSON", "div").
const PROPER_WORD = /^\p{Lu}\p{Ll}{2,}$/u

function isTranslatable(text, source) {
  const t = normText(text)
  if (t.length < 2 || t.length > 2000) return false
  if (!HAS_LETTER.test(t)) return false
  if (URLISH.test(t)) return false
  if (SELECTORISH.test(t)) return false
  if (CSS_DECL.test(t)) return false
  if (MEDIA_QUERY.test(t)) return false
  // A CSS blob assembled in JS (style.cssText = 'border:none;background:...').
  if ((t.match(/;/g) || []).length >= 2 && (t.match(/:/g) || []).length >= 2) return false
  if (source === 'script') {
    // Script literals are mostly code: selectors, event names, class names, units.
    // Keep the ones that read like human copy — multi-word, carrying a letter outside
    // the ASCII identifier range (æøå, accents, punctuation in words), or a single
    // capitalised word (a place/name in a data array, e.g. 'Bhutan').
    const humanish = /\s/.test(t) || !TOKENISH.test(t) || PROPER_WORD.test(t)
    if (!humanish) return false
  }
  return true
}

// ── extraction ────────────────────────────────────────────────────

// Pull the text runs out of a markup fragment (already masked / entity-encoded).
function markupTextRuns(fragment) {
  const out = []
  const masked = maskNonTextRegions(fragment)
  // Text between a closing '>' and the next '<'. A fragment with no tags at all
  // (a bare string literal) yields nothing here, so the caller falls back to it.
  for (const m of masked.matchAll(/>([^<]+)</g)) {
    const raw = decodeEntities(m[1])
    if (normText(raw)) out.push(raw)
  }
  return out
}

/**
 * Every distinct translatable string in an html-node, in document order.
 *
 * Returns { strings: [{ id, text, source, count }], total, markupCount, scriptCount,
 *           languageToggle, charCount }
 *  - id      't1'… — stable for a given HTML body; the model translates BY ID and never
 *            retypes the source string, which is what makes fabricated keys impossible.
 *  - source  'markup' (in the HTML) | 'script' (a literal a script renders at runtime)
 *  - count   how many times the string occurs
 */
export function extractTranslatableStrings(html, options = {}) {
  const src = String(html || '').replace(/\r\n/g, '\n')
  const includeScripts = options.includeScripts !== false
  const seen = new Map() // normalized text -> record

  const add = (raw, source) => {
    if (!isTranslatable(raw, source)) return
    const text = normText(raw)
    const hit = seen.get(text)
    if (hit) {
      hit.count += 1
      // Text present in markup is the stronger signal; keep that label.
      if (source === 'markup') hit.source = 'markup'
      return
    }
    seen.set(text, { text, source, count: 1 })
  }

  // <title> is page copy too (it shows in the tab and in search results).
  const titleM = src.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (titleM) add(decodeEntities(titleM[1]), 'markup')

  for (const run of markupTextRuns(src)) add(run, 'markup')
  const markupCount = seen.size

  if (includeScripts) {
    for (const sm of src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const attrs = sm[1] || ''
      if (/\bsrc\s*=/i.test(attrs)) continue
      if (/type\s*=\s*["'](?!text\/javascript|module|application\/javascript)/i.test(attrs)) continue
      const body = sm[2] || ''
      const literals = body.matchAll(
        /'((?:[^'\\\n]|\\[\s\S])*)'|"((?:[^"\\\n]|\\[\s\S])*)"|`((?:[^`\\$]|\\[\s\S]|\$(?!\{))*)`/g
      )
      for (const lm of literals) {
        const raw = decodeJsString(lm[1] ?? lm[2] ?? lm[3] ?? '')
        if (!raw) continue
        // A literal holding markup (el.innerHTML = '<h3>Tittel</h3><p>…</p>') renders as
        // its inner text runs — those are the strings the runtime will actually see.
        if (/<[a-z][^>]*>/i.test(raw)) {
          const runs = markupTextRuns(raw)
          if (runs.length) { for (const run of runs) add(run, 'script'); continue }
        }
        add(raw, 'script')
      }
    }
  }

  const strings = [...seen.values()].map((rec, i) => ({
    id: `t${i + 1}`,
    text: rec.text,
    source: rec.source,
    count: rec.count,
  }))

  return {
    strings,
    total: strings.length,
    markupCount,
    scriptCount: strings.length - markupCount,
    languageToggle: detectLanguageToggle(src),
    charCount: src.length,
  }
}

/**
 * The page's own language buttons, so the caller uses the SAME language codes the markup
 * already carries (the ravner page ships data-lang="en" / data-lang="no" — translating
 * under lang:'eng' would have produced a dictionary no button could ever select).
 */
export function detectLanguageToggle(html) {
  const src = String(html || '')
  const values = []
  for (const m of src.matchAll(/<[a-z][^>]*\bdata-lang\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const v = m[1].trim()
    if (v && !values.includes(v)) values.push(v)
  }
  if (values.length >= 2) return { selector: '[data-lang]', values, found: true }
  const classBtns = [...src.matchAll(/<(?:button|a|span)[^>]*class\s*=\s*["'][^"']*\blang-btn\b[^"']*["'][^>]*>([\s\S]*?)<\//gi)]
    .map(m => normText(decodeEntities(m[1])))
    .filter(Boolean)
  if (classBtns.length >= 2) return { selector: '.lang-btn', values: classBtns, found: true, labelsOnly: true }
  return { selector: '[data-lang]', values, found: false }
}

// ── the managed block ─────────────────────────────────────────────

export const I18N_START = '<!-- v-i18n:start -->'
export const I18N_END = '<!-- v-i18n:end -->'
const I18N_BLOCK_RE = /[ \t]*<!-- v-i18n:start -->[\s\S]*?<!-- v-i18n:end -->[ \t]*\n?/g

/** The config already stored in the node's managed block (so re-runs merge, not clobber). */
export function readI18nConfig(html) {
  const src = String(html || '')
  const m = src.match(/<script[^>]*id=["']v-i18n-data["'][^>]*>([\s\S]*?)<\/script>/i)
  if (!m) return null
  try {
    const cfg = JSON.parse(m[1].replace(/\\u003c/gi, '<'))
    if (!cfg || typeof cfg !== 'object') return null
    return { base: cfg.base || 'no', selector: cfg.selector || '[data-lang]', langs: cfg.langs || {} }
  } catch {
    return null
  }
}

export function stripI18nBlocks(html) {
  const src = String(html || '')
  const count = (src.match(I18N_BLOCK_RE) || []).length
  return { html: src.replace(I18N_BLOCK_RE, ''), count }
}

/**
 * Hand-rolled translation scripts from before this tool existed. The signature is
 * deliberately narrow — a <script> that declares BOTH a `translations` object and a
 * `translatePage()` function is the exact artifact of the failure this module replaces,
 * and leaving it in place means two switchers fighting over the same buttons.
 */
export function findLegacyTranslationScripts(html) {
  const src = String(html || '')
  const hits = []
  for (const m of src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(m[1] || '')) continue
    const body = m[2] || ''
    if (/\b(?:const|let|var)\s+translations\s*=/.test(body) && /function\s+translatePage\s*\(/.test(body)) {
      hits.push({ start: m.index, end: m.index + m[0].length, chars: m[0].length })
    }
  }
  return hits
}

export function removeLegacyTranslationScripts(html) {
  const hits = findLegacyTranslationScripts(html)
  if (!hits.length) return { html: String(html || ''), removed: 0, chars: 0 }
  let out = String(html || '')
  let chars = 0
  for (const hit of [...hits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, hit.start) + out.slice(hit.end)
    chars += hit.chars
  }
  return { html: out, removed: hits.length, chars }
}

/**
 * The whole client-side switcher, as ONE replaceable block.
 *
 * Design notes that are load-bearing:
 *  - Dictionaries ride in a <script type="application/json"> — no JS string escaping, which
 *    is what mangled the earlier hand-written attempt.
 *  - Keys are normalized source text, so a string works whether it came from markup or from
 *    a script literal rendered at runtime.
 *  - A MutationObserver re-applies to DOM the page's own scripts build later (the ravner
 *    timeline entries appear only after d3 runs); originals are kept in a WeakMap so
 *    switching back to the base language does NOT need location.reload().
 */
export function buildI18nBlock(config) {
  const cfg = {
    base: config.base || 'no',
    selector: config.selector || '[data-lang]',
    langs: config.langs || {},
  }
  // Escaping '<' makes a '</script>' inside any string harmless.
  const json = JSON.stringify(cfg).replace(/</g, '\\u003c')
  return `${I18N_START}
<script type="application/json" id="v-i18n-data">${json}</script>
<script>
(function () {
  var el = document.getElementById('v-i18n-data');
  if (!el) return;
  var CFG;
  try { CFG = JSON.parse(el.textContent); } catch (e) { console.error('[v-i18n] bad dictionary JSON', e); return; }
  var BASE = CFG.base || 'no';
  var LANGS = CFG.langs || {};
  var SELECTOR = CFG.selector || '[data-lang]';
  var STORE_KEY = 'v-i18n-lang';
  var SKIP = /^(SCRIPT|STYLE|PRE|TEXTAREA|NOSCRIPT|TEMPLATE)$/;
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  var norm = function (s) { return String(s == null ? '' : s).replace(/\\s+/g, ' ').trim(); };
  var origText = new WeakMap();
  var origAttr = new WeakMap();
  var current = BASE;
  var applying = false;

  function translateTextNode(n, dict) {
    var p = n.parentNode;
    if (!p || SKIP.test(p.nodeName)) return 0;
    var raw = n.nodeValue;
    if (!raw || !raw.trim()) return 0;
    var key = origText.has(n) ? origText.get(n) : norm(raw);
    if (!dict) {
      if (origText.has(n) && norm(raw) !== key) { n.nodeValue = key; return 1; }
      return 0;
    }
    var hit = dict[key];
    if (hit === undefined || norm(raw) === hit) return 0;
    if (!origText.has(n)) origText.set(n, key);
    n.nodeValue = hit;
    return 1;
  }

  function walkText(root, dict) {
    var n = 0;
    if (root.nodeType === 3) return translateTextNode(root, dict);
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return 0;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var node, jobs = [];
    while ((node = w.nextNode())) jobs.push(node);
    for (var i = 0; i < jobs.length; i++) n += translateTextNode(jobs[i], dict);
    return n;
  }

  function walkAttrs(root, dict) {
    if (!root.querySelectorAll) return 0;
    var sel = ATTRS.map(function (a) { return '[' + a + ']'; }).join(',');
    var els = root.querySelectorAll(sel);
    var list = root.nodeType === 1 && root.matches && root.matches(sel) ? [root].concat([].slice.call(els)) : [].slice.call(els);
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      var elx = list[i];
      var saved = origAttr.get(elx) || {};
      for (var a = 0; a < ATTRS.length; a++) {
        var name = ATTRS[a];
        if (!elx.hasAttribute(name)) continue;
        var val = elx.getAttribute(name);
        var key = saved[name] !== undefined ? saved[name] : norm(val);
        if (!dict) {
          if (saved[name] !== undefined && norm(val) !== key) { elx.setAttribute(name, key); n++; }
          continue;
        }
        var hit = dict[key];
        if (hit === undefined || norm(val) === hit) continue;
        if (saved[name] === undefined) { saved[name] = key; origAttr.set(elx, saved); }
        elx.setAttribute(name, hit);
        n++;
      }
    }
    return n;
  }

  var origTitle = null;
  function applyTitle(dict) {
    if (origTitle === null) origTitle = norm(document.title);
    if (!dict) { if (document.title !== origTitle) document.title = origTitle; return; }
    var hit = dict[origTitle];
    if (hit !== undefined) document.title = hit;
  }

  function markButtons(lang) {
    var btns = document.querySelectorAll(SELECTOR);
    for (var i = 0; i < btns.length; i++) {
      var v = btns[i].getAttribute('data-lang');
      if (v) btns[i].classList.toggle('active', v === lang);
    }
  }

  function apply(lang) {
    var dict = lang === BASE ? null : LANGS[lang];
    if (lang !== BASE && !dict) { console.warn('[v-i18n] no dictionary for language "' + lang + '"'); return 0; }
    applying = true;
    var n = walkText(document.body, dict) + walkAttrs(document.body, dict);
    applyTitle(dict);
    document.documentElement.setAttribute('lang', lang);
    current = lang;
    try { localStorage.setItem(STORE_KEY, lang); } catch (e) {}
    markButtons(lang);
    applying = false;
    try { window.dispatchEvent(new CustomEvent('languageChanged', { detail: { lang: lang } })); } catch (e) {}
    return n;
  }

  // Delegated, so buttons rendered later by the page's own scripts still work.
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    var btn = t && t.closest ? t.closest(SELECTOR) : null;
    if (!btn) return;
    var lang = btn.getAttribute('data-lang');
    if (!lang || lang === current) return;
    apply(lang);
  });

  // The page builds part of its own DOM after load; translate that too.
  var observer = new MutationObserver(function (muts) {
    if (applying || current === BASE) return;
    var dict = LANGS[current];
    if (!dict) return;
    applying = true;
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];
      if (m.type === 'characterData') {
        if (!origText.has(m.target)) translateTextNode(m.target, dict);
      } else {
        for (var j = 0; j < m.addedNodes.length; j++) {
          var node = m.addedNodes[j];
          if (node.nodeType === 3) { if (!origText.has(node)) translateTextNode(node, dict); }
          else if (node.nodeType === 1) { walkText(node, dict); walkAttrs(node, dict); }
        }
      }
    }
    applying = false;
  });

  function boot() {
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    var saved = null;
    try { saved = localStorage.getItem(STORE_KEY); } catch (e) {}
    var start = saved && (saved === BASE || LANGS[saved]) ? saved : BASE;
    apply(start);
    // One more pass once every deferred script has run and painted.
    window.addEventListener('load', function () { if (current !== BASE) apply(current); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.__vI18n = { apply: apply, config: CFG, current: function () { return current; } };
})();
</script>
${I18N_END}`
}

// ── coherence gate ────────────────────────────────────────────────

/**
 * Static check for the failure this module exists to prevent: a language toggle whose
 * dictionary does not match the page's own text. Returns a gap string or null.
 * Heuristic (source-level), not a browser observation — it gates the agent's end_turn,
 * it does not certify that translation works.
 */
export function detectTranslationGap(html) {
  const src = String(html || '')
  const toggle = detectLanguageToggle(src)
  if (!toggle.found) return null

  const managed = readI18nConfig(src)
  const legacyKeys = []
  for (const m of src.matchAll(/\b(?:const|let|var)\s+translations\s*=\s*\{/g)) {
    const from = m.index + m[0].length - 1
    const slice = src.slice(from, from + 40000)
    for (const km of slice.matchAll(/(['"])((?:[^\\]|\\.)*?)\1\s*:/g)) legacyKeys.push(decodeJsString(km[2]))
  }

  const managedKeys = managed
    ? [...new Set(Object.values(managed.langs).flatMap(d => Object.keys(d || {})))]
    : []
  const keys = [...new Set([...managedKeys, ...legacyKeys])]

  if (!keys.length) {
    return `A language switcher is present (${toggle.selector}, values: ${toggle.values.join(', ')}) but the page carries NO translation dictionary — clicking it cannot change any text. Call list_html_text to get the page's real strings, then translate_html_node to install the dictionary.`
  }

  const pageText = new Set(extractTranslatableStrings(src).strings.map(s => s.text))
  const matched = keys.filter(k => pageText.has(normText(k)))
  const ratio = matched.length / keys.length
  if (ratio < 0.5) {
    return `The translation dictionary does not match this page: only ${matched.length} of ${keys.length} dictionary keys occur as text on the page, so clicking the language button will change almost nothing (this is the "kun tittelen endres" failure). The source strings were written from memory instead of read from the node. Call list_html_text to get the REAL strings with ids, then translate_html_node with those ids — never retype the source strings.`
  }
  return null
}
