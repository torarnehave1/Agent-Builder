// graph-portfolio — component (SSOT), served from the Component Registry graph
// node's metadata.impl at api.vegvisr.org/components/graph-portfolio.js.
//
// Renders a card grid of PUBLISHED knowledge graphs, filtered on one or more
// meta areas, for embedding on any website. The page needs no login and no API
// token: it reads knowledge.vegvisr.org/getknowgraphsummaries anonymously.
//
// Self-mounting: drop a marker anywhere and this script (loaded with
// <script src=".../components/graph-portfolio.js" defer>) fetches, injects its
// CSS and builds the grid.
//
// Usage:
//   <div data-vegvisr-portfolio="NIBI, BLOGG"   (meta areas, comma separated; empty = every published graph)
//        data-columns="auto"     (optional — "auto" or a number, default auto)
//        data-gap="16"           (optional — px between cards, default 16)
//        data-limit=""           (optional — show at most N cards)
//        data-sort="updated"     (optional — "updated" | "title" | "nodes", default updated)
//        data-filters="auto"     (optional — "auto" | "on" | "off"; auto = chips when >1 area)
//        data-include="published" (optional — "published" (default) | "public", see below)
//        data-title=""           (optional — heading above the grid)
//        data-lang="no"          (optional — "no" | "en", default no)
//        data-open="modal"       (optional — "modal" (default) | "page" | "self")
//        data-target="_blank"    (optional — link target for data-open="page", default _blank)
//        data-viewer="https://www.vegvisr.org/gnew-viewer?graphId="
//        data-endpoint="https://knowledge.vegvisr.org/getknowgraphsummaries">
//   </div>
//
// THE CARD KEEPS THE READER ON THIS SITE. data-open="modal" (the default) reads the
// graph and renders it in a dialog on the page — the visitor never leaves the
// domain the grid is embedded on. In that mode a card is a <button>, not a link,
// so there is no href that a middle-click or cmd-click could follow off-site
// either. data-open="page"/"self" is the deliberate opt-in to sending the reader
// to data-viewer (vegvisr.org's viewer unless you point it at your own page).
//
// The dialog renders graph content with the 'vegvisr-fulltext' registry component,
// loaded lazily from our own origin the first time a card is opened, so the grid
// itself stays light. That component is generated verbatim from GNewDefaultNode.vue
// — the renderer the real viewer uses — so the dialog and the viewer agree about
// what the markup means. Node `info` already carries its own heading, so the node
// label is NOT rendered as one; doing that prints every title twice.
//
// ONE REQUEST PER META AREA, merged by id. The endpoint's metaArea filter takes a
// SINGLE term — "NIBI,BLOGG" and "NIBI BLOGG" both match zero rows (verified
// 2026-09-12) — and it filters server-side, so each area is fetched whole (paged
// at the server's 250-row cap) rather than one page being filtered in the browser.
//
// PUBLISHED ONLY, twice over. The anonymous endpoint is supposed to return only
// published graphs, but its rule is `publicationState = 'published' OR seoSlug IS
// NOT NULL`, and a graph saved with seoSlug "" satisfies IS NOT NULL — so 134 of
// the 211 rows it returns anonymously are drafts (verified 2026-09-12). This
// component therefore keeps only rows whose own metadata says published. That
// filter runs over each area's COMPLETE result set, never over one page of it,
// so the counts on the filter chips match the cards actually on screen.
//
// The consequence is visible, so it is worth stating: an area whose graphs are all
// still drafts renders an EMPTY grid, not a full one (NIBI: 3 rows anonymously,
// 0 of them published; LIVINGART: 52 and 0 — both verified 2026-09-12). Publish
// the graphs to fill it. data-include="public" deliberately shows everything the
// API hands an anonymous caller, drafts included — only for a page where that is
// genuinely wanted.

(function () {
  'use strict'

  var ENDPOINT = 'https://knowledge.vegvisr.org/getknowgraphsummaries'
  var GRAPH_ENDPOINT = 'https://knowledge.vegvisr.org/getknowgraph?id='
  var VIEWER = 'https://www.vegvisr.org/gnew-viewer?graphId='
  var FULLTEXT_URL = 'https://api.vegvisr.org/components/vegvisr-fulltext.js'
  // mermaid 11.9.0, the same version the Vue viewer bundles, served from OUR OWN
  // origin (the web-components R2 bucket) — not a third-party CDN, which a
  // component running on a customer's page must never pull in. It is 2.7MB, so it
  // is fetched only when an opened graph actually contains a diagram.
  var MERMAID_URL = 'https://api.vegvisr.org/components/mermaid.min.js'
  var STYLE_ID = 'vgp-style'
  var PAGE = 250 // the endpoint caps limit at 250 whatever you ask for
  var CEILING = 1000 // stop paging one area after this many rows
  var MIN_CARD = 240 // px — never squeeze a card narrower than this
  var DESC_MAX = 180

  var TEXT = {
    no: {
      empty: 'Ingen publiserte grafer her ennå.',
      error: 'Kunne ikke laste porteføljen akkurat nå.',
      all: 'Alle',
      nodes: 'noder',
      updated: 'Oppdatert',
      loading: 'Laster …',
      noConfig: 'Porteføljen er ikke konfigurert.',
      close: 'Lukk',
      loadingGraph: 'Laster innhold …',
      graphError: 'Kunne ikke laste denne grafen.',
      emptyGraph: 'Denne grafen har ikke noe innhold å vise.',
      diagram: 'Diagram',
      diagramNote: 'Vis diagramkilde',
    },
    en: {
      empty: 'No published graphs here yet.',
      error: 'Could not load the portfolio right now.',
      all: 'All',
      nodes: 'nodes',
      updated: 'Updated',
      loading: 'Loading …',
      noConfig: 'Portfolio is not configured.',
      close: 'Close',
      loadingGraph: 'Loading content …',
      graphError: 'Could not load this graph.',
      emptyGraph: 'This graph has no content to show.',
      diagram: 'Diagram',
      diagramNote: 'Show diagram source',
    },
  }

  // Prefix has to go INSIDE the format string, or console treats it as its own
  // argument and every %s in the real message is printed literally.
  function log () {
    var a = [].slice.call(arguments)
    if (typeof a[0] === 'string') a[0] = '[graph-portfolio] ' + a[0]
    else a.unshift('[graph-portfolio]')
    console.log.apply(console, a)
  }

  // ---- pure helpers (unit-tested by worker/test-graph-portfolio.mjs) ----

  // "NIBI, #BLOGG" -> ['NIBI','BLOGG']. Split on comma and '#' only: a real area
  // can contain a space ("BUSINESS DEVELOPMENT"), so splitting on whitespace
  // would shatter it into two areas that match nothing.
  function parseAreas (raw) {
    var out = []
    String(raw == null ? '' : raw).split(/[#,\n]+/).forEach(function (part) {
      var t = part.trim().toUpperCase()
      if (t && out.indexOf(t) === -1) out.push(t)
    })
    return out
  }

  // A row's own areas, from metadata.metaArea ("#VEGR.AI #BLOGG" or "NIBI, PROFF").
  function graphAreas (row) {
    var md = (row && row.metadata) || {}
    return parseAreas(md.metaArea || '')
  }

  // Mirror the server's LIKE %term% so a chip never hides a card the server
  // returned for that very area (e.g. area "AI" inside "VEGR.AI").
  function matchesArea (row, area) {
    var want = String(area || '').trim().toUpperCase()
    if (!want) return true
    if (graphAreas(row).indexOf(want) !== -1) return true
    var md = (row && row.metadata) || {}
    return String(md.metaArea || '').toUpperCase().indexOf(want) !== -1
  }

  // The endpoint's anonymous gate lets drafts through (see header note), so the
  // component decides for itself what counts as published.
  function isPublished (row) {
    var md = (row && row.metadata) || {}
    return String(md.publicationState || '').toLowerCase() === 'published'
  }

  // "published" (default) = the strict rule above. "public" = whatever the API
  // hands an anonymous caller, which today includes drafts.
  function visibleRows (rows, include) {
    if (String(include || '').toLowerCase() === 'public') return (rows || []).slice()
    return (rows || []).filter(isPublished)
  }

  // Merge per-area result sets, first occurrence wins. A graph tagged with two
  // requested areas comes back from two requests and must appear once.
  function mergeById (lists) {
    var seen = {}
    var out = []
    ;(lists || []).forEach(function (list) {
      ;(list || []).forEach(function (row) {
        var id = row && row.id
        if (!id || seen[id]) return
        seen[id] = true
        out.push(row)
      })
    })
    return out
  }

  function sortRows (rows, mode) {
    var copy = (rows || []).slice()
    var by = String(mode || 'updated').toLowerCase()
    if (by === 'title') {
      return copy.sort(function (a, b) {
        return String(a.title || '').localeCompare(String(b.title || ''), 'no')
      })
    }
    if (by === 'nodes') {
      return copy.sort(function (a, b) { return (b.nodeCount || 0) - (a.nodeCount || 0) })
    }
    return copy.sort(function (a, b) {
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    })
  }

  // Only 4 of 211 published graphs carry portfolioImagePath (verified
  // 2026-09-12), so the card cannot lean on an image. Every other card gets a
  // stable colour derived from its id — same graph, same hue on every visit.
  function hueFor (id) {
    var h = 0
    var s = String(id || '')
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
    return h
  }

  function initialsFor (title) {
    var words = String(title || '').trim().split(/\s+/).filter(Boolean)
    if (!words.length) return '•'
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
    return (words[0][0] + words[1][0]).toUpperCase()
  }

  function summarize (text, max) {
    var t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim()
    var cap = max || DESC_MAX
    if (t.length <= cap) return t
    var cut = t.slice(0, cap)
    var sp = cut.lastIndexOf(' ')
    return (sp > cap * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:.\-]$/, '') + '…'
  }

  function fmtDate (iso, lang) {
    if (!iso) return ''
    var d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    try {
      return d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'nb-NO', {
        year: 'numeric', month: 'short', day: 'numeric',
      })
    } catch (e) {
      return String(iso).slice(0, 10)
    }
  }

  // One row -> everything the card needs. Kept pure so the mapping is testable
  // without a DOM.
  function cardData (row, opts) {
    var o = opts || {}
    var md = (row && row.metadata) || {}
    var title = String(row.title || md.title || '').trim() || '(uten tittel)'
    return {
      id: row.id,
      title: title,
      description: summarize(md.description || '', o.descMax),
      areas: graphAreas(row),
      nodeCount: row.nodeCount || 0,
      updated: fmtDate(row.updatedAt, o.lang),
      image: row.portfolioImagePath || '',
      initials: initialsFor(title),
      hue: hueFor(row.id),
      href: (o.viewer || VIEWER) + encodeURIComponent(row.id),
    }
  }

  // A graph's nodes, in order, minus the ones hidden in the editor.
  function visibleNodes (graph) {
    return (((graph && graph.nodes) || [])).filter(function (n) { return n && n.visible !== false })
  }

  // What the dialog should do with one node. Kept pure so the mapping is testable
  // without a DOM, and so an unknown node type degrades to something visible
  // rather than vanishing silently.
  function nodeRenderPlan (node) {
    var type = String((node && node.type) || '').toLowerCase()
    var info = String((node && node.info) || '')
    var label = String((node && node.label) || '')
    if (type === 'mermaid-diagram') {
      return { kind: info.trim() ? 'mermaid' : 'skip', text: info, label: label }
    }
    // markdown-image renders from markdown in the LABEL, not info or path — the
    // viewer's own quirk, documented in CLAUDE.md.
    if (type === 'markdown-image') {
      return { kind: /!\[/.test(label) ? 'markdown' : 'skip', text: label, label: label }
    }
    if (type === 'css-node') return { kind: 'skip', text: '', label: label }
    if (info.trim()) return { kind: 'markdown', text: info, label: label }
    return { kind: 'skip', text: '', label: label }
  }

  // A meta area can hold graphs written by other accounts, and this grid renders
  // them on SOMEBODY ELSE'S site, so rendered markdown is scrubbed before it is
  // inserted (marked passes raw HTML through by design). These two are the pure,
  // testable half; scrubInto() below does the DOM walk.
  var UNSAFE_TAGS = ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'style']

  // The dialog puts the graph title in its title bar, and the first node's `info`
  // usually opens with that same title as a markdown heading — so it printed twice.
  // Compared loosely (case, whitespace and trailing punctuation ignored) because
  // the two are typed in different places by hand.
  function sameHeading (a, b) {
    var norm = function (s) {
      return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.:;!?–—-]+$/, '').trim()
    }
    var x = norm(a)
    return x !== '' && x === norm(b)
  }

  function isUnsafeUrl (value) {
    // Everything from NUL through space is stripped first: "java\tscript:alert(1)" is a
    // url the browser happily follows but a naive prefix test walks straight past.
    var v = String(value == null ? '' : value).replace(/[ - ]/g, '').toLowerCase()
    return v.indexOf('javascript:') === 0 || v.indexOf('data:text/html') === 0 || v.indexOf('vbscript:') === 0
  }

  // ---- DOM + network ----

  // keepStyle is for mermaid output ONLY: mermaid ships the diagram's CSS in a
  // <style> inside the SVG, so stripping it leaves solid black boxes with
  // unreadable labels — rendered, and useless (seen 2026-09-12). Mermaid runs in
  // securityLevel 'strict', which escapes the label text that CSS could hide in.
  // Page markdown never gets this exemption.
  function scrubInto (container, keepStyle) {
    (keepStyle ? UNSAFE_TAGS.filter(function (t) { return t !== 'style' }) : UNSAFE_TAGS).forEach(function (tag) {
      var found = container.querySelectorAll(tag)
      Array.prototype.forEach.call(found, function (el) { el.parentNode.removeChild(el) })
    })
    var all = container.querySelectorAll('*')
    Array.prototype.forEach.call(all, function (el) {
      Array.prototype.slice.call(el.attributes).forEach(function (attr) {
        var name = attr.name.toLowerCase()
        if (name.indexOf('on') === 0) el.removeAttribute(attr.name)
        else if ((name === 'href' || name === 'src' || name === 'xlink:href') && isUnsafeUrl(attr.value)) {
          el.removeAttribute(attr.name)
        }
      })
      // Anything the graph links out to opens in a new tab, so the reader keeps
      // the page they are on — the whole point of the dialog.
      if (el.tagName === 'A' && el.getAttribute('href')) {
        el.setAttribute('target', '_blank')
        el.setAttribute('rel', 'noopener noreferrer')
      }
    })
    return container
  }

  function injectStyle () {
    if (document.getElementById(STYLE_ID)) return
    var css = [
      '.vgp{margin:0;padding:0}',
      '.vgp-title{font:600 1.25rem/1.3 inherit;margin:0 0 .85rem;color:var(--v-text,inherit)}',
      '.vgp-chips{display:flex;flex-wrap:wrap;gap:.45rem;margin:0 0 1rem}',
      '.vgp-chip{font:500 .82rem/1 inherit;padding:.45rem .8rem;border-radius:999px;cursor:pointer;',
      'border:1px solid var(--v-border,rgba(127,127,127,.35));background:transparent;color:var(--v-text,inherit);opacity:.75}',
      '.vgp-chip:hover{opacity:1}',
      '.vgp-chip[aria-pressed="true"]{background:var(--v-primary,#2a9d8f);border-color:var(--v-primary,#2a9d8f);color:#fff;opacity:1}',
      '.vgp-chip-n{opacity:.65;margin-left:.35rem;font-variant-numeric:tabular-nums}',
      '.vgp-grid{display:grid;width:100%}',
      // A card is a <button> in modal mode, so the button UA styles have to be
      // undone: font, text alignment, padding and cursor are NOT inherited.
      '.vgp-card{display:flex;flex-direction:column;overflow:hidden;border-radius:12px;text-decoration:none;color:inherit;',
      'background:var(--v-surface,rgba(127,127,127,.07));border:1px solid var(--v-border,rgba(127,127,127,.18));',
      'font:inherit;text-align:left;padding:0;cursor:pointer;width:100%;',
      'transition:transform .2s ease,box-shadow .2s ease}',
      '.vgp-card:hover{transform:translateY(-3px);box-shadow:0 8px 22px rgba(0,0,0,.13)}',
      '.vgp-card:focus-visible{outline:2px solid var(--v-primary,currentColor);outline-offset:2px}',
      '.vgp-thumb{position:relative;aspect-ratio:16/9;overflow:hidden;display:flex;align-items:center;justify-content:center}',
      '.vgp-thumb img{width:100%;height:100%;object-fit:cover;display:block}',
      '.vgp-mono{font:700 2rem/1 inherit;color:rgba(255,255,255,.92);letter-spacing:.04em}',
      '.vgp-body{padding:.9rem 1rem 1rem;display:flex;flex-direction:column;gap:.45rem;flex:1}',
      '.vgp-h{font:600 1.02rem/1.35 inherit;margin:0;color:var(--v-text,inherit)}',
      '.vgp-d{font:400 .88rem/1.5 inherit;margin:0;color:var(--v-muted,rgba(127,127,127,.95))}',
      '.vgp-meta{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;margin-top:auto;padding-top:.5rem;',
      'font:500 .74rem/1 inherit;color:var(--v-muted,rgba(127,127,127,.9))}',
      '.vgp-badge{padding:.28rem .5rem;border-radius:6px;background:rgba(127,127,127,.14)}',
      '.vgp-facts{white-space:nowrap}',
      '.vgp-msg{padding:1.1rem;font:400 .9rem/1.5 inherit;opacity:.75;text-align:center}',
      '.vgp-msg[data-error]{color:#c0392b;opacity:1}',
      // Dialog
      '.vgp-back{position:fixed;inset:0;z-index:2147483000;background:rgba(8,10,14,.62);display:flex;',
      'align-items:flex-start;justify-content:center;padding:4vmin 3vmin;overflow-y:auto}',
      '.vgp-back[hidden]{display:none}',
      '.vgp-dlg{position:relative;width:min(820px,100%);max-height:92vh;display:flex;flex-direction:column;',
      'background:var(--v-bg,#fff);color:var(--v-text,inherit);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.35)}',
      '.vgp-dlg-bar{display:flex;align-items:flex-start;gap:1rem;padding:1.1rem 1.3rem .8rem;',
      'border-bottom:1px solid var(--v-border,rgba(127,127,127,.2))}',
      '.vgp-dlg-h{font:600 1.25rem/1.35 inherit;margin:0;flex:1;color:var(--v-text,inherit)}',
      '.vgp-close{flex:none;width:34px;height:34px;border-radius:50%;border:0;cursor:pointer;font-size:22px;line-height:1;',
      'background:rgba(127,127,127,.16);color:inherit;display:flex;align-items:center;justify-content:center}',
      '.vgp-close:hover{background:rgba(127,127,127,.3)}',
      '.vgp-dlg-body{padding:1.1rem 1.3rem 1.6rem;overflow-y:auto;font:400 1rem/1.6 inherit}',
      '.vgp-lead{margin:0 0 1.2rem;color:var(--v-muted,rgba(127,127,127,.95));font-size:.95rem}',
      '.vgp-node{margin:0 0 1.1rem}',
      '.vgp-node img{max-width:100%;height:auto}',
      '.vgp-node pre,.vgp-node table{overflow-x:auto;max-width:100%}',
      '.vgp-diagram{margin:0 0 1.1rem;padding:.9rem 1rem;border:1px solid var(--v-border,rgba(127,127,127,.22));border-radius:10px}',
      '.vgp-diagram[data-fallback]{border-style:dashed}',
      '.vgp-diagram figcaption{font:600 .9rem/1.4 inherit;margin-bottom:.6rem}',
      '.vgp-diagram-canvas{overflow-x:auto;margin-bottom:.5rem}',
      '.vgp-diagram-canvas svg{max-width:100%;height:auto;display:block;margin:0 auto}',
      '.vgp-diagram summary{cursor:pointer;font-size:.85rem;opacity:.75}',
      '.vgp-diagram pre{margin:.6rem 0 0;padding:.7rem;overflow-x:auto;background:rgba(127,127,127,.1);border-radius:6px;font-size:.8rem}',
      '@media (max-width:560px){.vgp-back{padding:0}.vgp-dlg{width:100%;max-height:100vh;border-radius:0;min-height:100vh}}',
      '@media (prefers-reduced-motion:reduce){.vgp-card{transition:none}.vgp-card:hover{transform:none}}',
    ].join('')
    var el = document.createElement('style')
    el.id = STYLE_ID
    el.textContent = css
    document.head.appendChild(el)
  }

  function applyGridStyle (grid, root) {
    var gap = parseInt(root.getAttribute('data-gap') || '16', 10)
    if (isNaN(gap) || gap < 0) gap = 16
    var columns = (root.getAttribute('data-columns') || 'auto').trim()
    grid.style.gap = gap + 'px'
    if (columns === 'auto' || columns === '') {
      grid.style.gridTemplateColumns = 'repeat(auto-fill,minmax(min(' + MIN_CARD + 'px,100%),1fr))'
    } else {
      var n = parseInt(columns, 10)
      if (isNaN(n) || n < 1) n = 3
      // Honour the requested count where there is room, but never below a usable
      // card width — a hard repeat(4,1fr) on a phone gives 80px cards. The track
      // floor is whichever is larger: the author's Nth of the row, or MIN_CARD,
      // so a narrow screen drops to as many columns as actually fit.
      var share = 'calc((100% - ' + (n - 1) * gap + 'px) / ' + n + ')'
      grid.style.gridTemplateColumns =
        'repeat(auto-fill,minmax(min(max(' + share + ',' + MIN_CARD + 'px),100%),1fr))'
    }
  }

  function message (root, text, isError) {
    var el = document.createElement('div')
    el.className = 'vgp-msg'
    if (isError) el.setAttribute('data-error', '')
    el.textContent = text
    root.appendChild(el)
  }

  // Fetch ONE area completely (paged), or every published graph when area is ''.
  function fetchArea (endpoint, area, onRows) {
    var rows = []
    function page (offset) {
      var url = endpoint + (endpoint.indexOf('?') === -1 ? '?' : '&') +
        'offset=' + offset + '&limit=' + PAGE +
        (area ? '&metaArea=' + encodeURIComponent(area) : '')
      return fetch(url, { headers: { accept: 'application/json' } }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.json()
      }).then(function (data) {
        var got = (data && data.results) || []
        rows = rows.concat(got)
        var more = data && data.hasMore && got.length && rows.length < CEILING
        return more ? page(offset + got.length) : rows
      })
    }
    return page(0).then(onRows || function (r) { return r })
  }

  function thumbFor (card) {
    var thumb = document.createElement('div')
    thumb.className = 'vgp-thumb'
    if (card.image) {
      var img = document.createElement('img')
      img.alt = ''
      // NOT loading="lazy", and onerror BEFORE src. Both were wrong here until
      // 2026-09-13, and together they made a card with a real portfolioImagePath
      // render as a BLANK rectangle: the lazy heuristic never started the load for
      // an image this script creates and appends (currentSrc stayed empty,
      // complete stayed false, neither load nor error ever fired), so the gradient
      // fallback below could not run either. It went unnoticed because only 4 of
      // 211 published graphs carry an image, and no card in any earlier test had
      // one. Revisit with IntersectionObserver if a grid ever carries enough
      // images to be worth deferring.
      img.onerror = function () {
        if (img.parentNode === thumb) thumb.removeChild(img)
        paintFallback(thumb, card)
      }
      img.src = card.image
      thumb.appendChild(img)
    } else {
      paintFallback(thumb, card)
    }
    return thumb
  }

  function paintFallback (thumb, card) {
    thumb.style.background =
      'linear-gradient(135deg,hsl(' + card.hue + ',52%,42%),hsl(' + ((card.hue + 38) % 360) + ',58%,30%))'
    var mono = document.createElement('span')
    mono.className = 'vgp-mono'
    mono.textContent = card.initials
    thumb.appendChild(mono)
  }

  // Built with DOM APIs, never innerHTML: titles and descriptions come from a
  // database and land on a public page.
  function cardEl (card, opts) {
    // In modal mode the card is a BUTTON, not a link: with no href there is no
    // middle-click, cmd-click or "copy link" that could still carry the reader off
    // this site. A link is used only when the author asked for one with
    // data-open="page"/"self".
    var modal = opts.open === 'modal'
    var a = document.createElement(modal ? 'button' : 'a')
    a.className = 'vgp-card'
    if (modal) {
      a.type = 'button'
      a.addEventListener('click', function () { openDialog(card, opts) })
    } else {
      a.href = card.href
      a.target = opts.open === 'self' ? '_self' : opts.target
      if (a.target === '_blank') a.rel = 'noopener noreferrer'
    }
    a.setAttribute('data-graph-id', card.id)

    a.appendChild(thumbFor(card))

    var body = document.createElement('div')
    body.className = 'vgp-body'
    var h = document.createElement('h3')
    h.className = 'vgp-h'
    h.textContent = card.title
    body.appendChild(h)

    if (card.description) {
      var p = document.createElement('p')
      p.className = 'vgp-d'
      p.textContent = card.description
      body.appendChild(p)
    }

    var meta = document.createElement('div')
    meta.className = 'vgp-meta'
    card.areas.slice(0, 3).forEach(function (area) {
      var b = document.createElement('span')
      b.className = 'vgp-badge'
      b.textContent = area
      meta.appendChild(b)
    })
    // Count and date share ONE span so the separator can never wrap onto the next
    // line ahead of the date, which is what a separate dot element did once the
    // area badges filled the first row.
    var facts = []
    if (card.nodeCount) facts.push(card.nodeCount + ' ' + opts.t.nodes)
    if (card.updated) facts.push(opts.t.updated + ' ' + card.updated)
    if (facts.length) {
      var f = document.createElement('span')
      f.className = 'vgp-facts'
      f.textContent = facts.join(' · ')
      meta.appendChild(f)
    }
    body.appendChild(meta)
    a.appendChild(body)
    return a
  }

  function renderGrid (host, rows, opts, root) {
    host.textContent = ''
    if (!rows.length) {
      message(host, opts.t.empty)
      return
    }
    var grid = document.createElement('div')
    grid.className = 'vgp-grid'
    applyGridStyle(grid, root)
    rows.forEach(function (row) { grid.appendChild(cardEl(cardData(row, opts), opts)) })
    host.appendChild(grid)
  }

  function buildChips (root, host, all, areas, opts) {
    var bar = document.createElement('div')
    bar.className = 'vgp-chips'
    var defs = [{ key: '', label: opts.t.all, rows: all }]
    areas.forEach(function (area) {
      defs.push({
        key: area,
        label: area,
        rows: all.filter(function (r) { return matchesArea(r, area) }),
      })
    })
    var buttons = []
    defs.forEach(function (def) {
      var b = document.createElement('button')
      b.type = 'button'
      b.className = 'vgp-chip'
      b.setAttribute('aria-pressed', def.key === '' ? 'true' : 'false')
      b.appendChild(document.createTextNode(def.label))
      var n = document.createElement('span')
      n.className = 'vgp-chip-n'
      n.textContent = String(def.rows.length)
      b.appendChild(n)
      b.addEventListener('click', function () {
        buttons.forEach(function (o) { o.setAttribute('aria-pressed', o === b ? 'true' : 'false') })
        renderGrid(host, limitRows(def.rows, opts.limit), opts, root)
      })
      buttons.push(b)
      bar.appendChild(b)
    })
    return bar
  }

  function limitRows (rows, limit) {
    return limit > 0 ? rows.slice(0, limit) : rows
  }

  // ---- the dialog: the reader stays on this site ----

  var fulltextPromise = null

  // Loaded on the FIRST card open, not with the grid: a portfolio that nobody
  // clicks should not pull 42KB of renderer plus marked.
  function ensureFulltext () {
    if (fulltextPromise) return fulltextPromise
    fulltextPromise = new Promise(function (resolve, reject) {
      if (window.VegvisrFulltext) return resolve(window.VegvisrFulltext)
      var existing = document.querySelector('script[src="' + FULLTEXT_URL + '"]')
      var s = existing || document.createElement('script')
      s.addEventListener('load', function () { resolve(window.VegvisrFulltext) })
      s.addEventListener('error', function () { reject(new Error('could not load ' + FULLTEXT_URL)) })
      if (!existing) {
        s.src = FULLTEXT_URL
        document.head.appendChild(s)
      }
    }).then(function (api) {
      if (!api) throw new Error('vegvisr-fulltext loaded but exposed no VegvisrFulltext')
      return api.ready().then(function () { return api })
    })
    return fulltextPromise
  }

  var mermaidPromise = null

  function ensureMermaid () {
    if (mermaidPromise) return mermaidPromise
    mermaidPromise = new Promise(function (resolve, reject) {
      if (window.mermaid) return resolve(window.mermaid)
      var existing = document.querySelector('script[src="' + MERMAID_URL + '"]')
      var s = existing || document.createElement('script')
      s.addEventListener('load', function () { resolve(window.mermaid) })
      s.addEventListener('error', function () { reject(new Error('could not load ' + MERMAID_URL)) })
      if (!existing) {
        s.src = MERMAID_URL
        document.head.appendChild(s)
      }
    }).then(function (m) {
      if (!m) throw new Error('mermaid loaded but exposed no global')
      // startOnLoad would have mermaid hunt the whole page for .mermaid elements,
      // including the host site's own; this component renders its diagrams itself.
      m.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' })
      return m
    })
    return mermaidPromise
  }

  var diagramSeq = 0

  var dialog = null // one dialog serves every grid on the page

  function buildDialog () {
    if (dialog) return dialog
    var back = document.createElement('div')
    back.className = 'vgp-back'
    back.setAttribute('hidden', '')
    var box = document.createElement('div')
    box.className = 'vgp-dlg'
    box.setAttribute('role', 'dialog')
    box.setAttribute('aria-modal', 'true')
    var bar = document.createElement('div')
    bar.className = 'vgp-dlg-bar'
    var heading = document.createElement('h2')
    heading.className = 'vgp-dlg-h'
    heading.id = 'vgp-dlg-h'
    box.setAttribute('aria-labelledby', heading.id)
    var close = document.createElement('button')
    close.type = 'button'
    close.className = 'vgp-close'
    close.innerHTML = '&times;'
    bar.appendChild(heading)
    bar.appendChild(close)
    var body = document.createElement('div')
    body.className = 'vgp-dlg-body'
    box.appendChild(bar)
    box.appendChild(body)
    back.appendChild(box)
    document.body.appendChild(back)
    dialog = { back: back, box: box, heading: heading, close: close, body: body, opener: null, open: false }

    close.addEventListener('click', function () { closeDialog() })
    back.addEventListener('click', function (e) { if (e.target === back) closeDialog() })
    document.addEventListener('keydown', function (e) {
      if (!dialog.open) return
      if (e.key === 'Escape') { e.preventDefault(); closeDialog() }
      else if (e.key === 'Tab') trapTab(e)
    })
    // Browser Back closes the dialog instead of leaving the site — the behaviour
    // a phone's back gesture implies. The history entry carries no url change, so
    // the host page's own address is never rewritten.
    window.addEventListener('popstate', function () { if (dialog.open) closeDialog(true) })
    return dialog
  }

  function trapTab (e) {
    var focusable = dialog.box.querySelectorAll('a[href], button, [tabindex]:not([tabindex="-1"])')
    if (!focusable.length) return
    var first = focusable[0]
    var last = focusable[focusable.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  function closeDialog (fromPopstate) {
    if (!dialog || !dialog.open) return
    dialog.open = false
    dialog.back.setAttribute('hidden', '')
    dialog.body.textContent = ''
    document.documentElement.style.overflow = dialog.prevOverflow || ''
    if (!fromPopstate && dialog.pushed) window.history.back()
    dialog.pushed = false
    if (dialog.opener && dialog.opener.focus) dialog.opener.focus()
  }

  function openDialog (card, opts) {
    var d = buildDialog()
    d.opener = document.activeElement
    d.open = true
    d.heading.textContent = card.title
    d.body.textContent = ''
    d.close.setAttribute('aria-label', opts.t.close)
    d.close.title = opts.t.close
    d.prevOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    d.back.removeAttribute('hidden')
    d.box.scrollTop = 0
    d.close.focus()
    try {
      window.history.pushState({ vgpDialog: card.id }, '')
      d.pushed = true
    } catch (e) { d.pushed = false }

    var loading = document.createElement('div')
    loading.className = 'vgp-msg'
    loading.textContent = opts.t.loadingGraph
    d.body.appendChild(loading)

    var token = card.id
    d.token = token
    Promise.all([
      fetch(GRAPH_ENDPOINT + encodeURIComponent(card.id), { headers: { accept: 'application/json' } })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() }),
      ensureFulltext(),
    ]).then(function (both) {
      if (!d.open || d.token !== token) return // closed, or another card opened meanwhile
      var withTitle = {}
      for (var k in opts) withTitle[k] = opts[k]
      withTitle.dialogTitle = card.title
      renderGraphInto(d.body, both[0], both[1], withTitle)
    }).catch(function (err) {
      console.error('[graph-portfolio] could not open graph ' + card.id + ':', err)
      if (!d.open || d.token !== token) return
      d.body.textContent = ''
      message(d.body, opts.t.graphError, true)
    })
  }

  function renderGraphInto (body, graph, ft, opts) {
    body.textContent = ''
    var md = (graph && graph.metadata) || {}
    if (md.description) {
      var lead = document.createElement('p')
      lead.className = 'vgp-lead'
      lead.textContent = md.description
      body.appendChild(lead)
    }
    var rendered = 0
    visibleNodes(graph).forEach(function (node) {
      var plan = nodeRenderPlan(node)
      if (plan.kind === 'skip') return
      if (plan.kind === 'mermaid') {
        body.appendChild(diagramEl(plan, opts))
        rendered += 1
        return
      }
      var section = document.createElement('div')
      section.className = 'vgp-node'
      try {
        section.innerHTML = ft.render(plan.text)
      } catch (e) {
        console.warn('[graph-portfolio] node ' + node.id + ' did not render:', e)
        section.textContent = plan.text
      }
      scrubInto(section)
      // Drop the first node's opening heading when it merely repeats the title
      // already shown in the dialog bar.
      if (rendered === 0) {
        var lead = section.firstElementChild
        if (lead && /^H[1-3]$/.test(lead.tagName) && sameHeading(lead.textContent, opts.dialogTitle)) {
          section.removeChild(lead)
        }
      }
      body.appendChild(section)
      rendered += 1
    })
    if (!rendered) message(body, opts.t.emptyGraph)
  }

  // A diagram node is DRAWN with mermaid (served from our own origin, loaded only
  // when a graph actually has one). The source stays reachable in a <details>, and
  // it is also what the reader is left with if mermaid fails to load or the
  // diagram does not parse — a broken diagram must never swallow the content.
  function diagramEl (plan, opts) {
    var wrap = document.createElement('figure')
    wrap.className = 'vgp-diagram'
    var cap = document.createElement('figcaption')
    cap.textContent = plan.label ? opts.t.diagram + ' — ' + plan.label : opts.t.diagram
    wrap.appendChild(cap)
    var canvas = document.createElement('div')
    canvas.className = 'vgp-diagram-canvas'
    wrap.appendChild(canvas)
    var det = document.createElement('details')
    var sum = document.createElement('summary')
    sum.textContent = opts.t.diagramNote
    var pre = document.createElement('pre')
    pre.textContent = plan.text
    det.appendChild(sum)
    det.appendChild(pre)
    wrap.appendChild(det)

    diagramSeq += 1
    var id = 'vgp-mmd-' + diagramSeq
    ensureMermaid().then(function (m) {
      return m.render(id, plan.text)
    }).then(function (res) {
      canvas.innerHTML = (res && res.svg) || ''
      scrubInto(canvas, true)
    }).catch(function (err) {
      console.warn('[graph-portfolio] diagram did not render:', err && err.message ? err.message : err)
      wrap.setAttribute('data-fallback', '')
      canvas.parentNode.removeChild(canvas)
      det.setAttribute('open', '')
      // mermaid leaves its failed attempt in the document; clear it so a broken
      // diagram does not leave a stray error block on the host page.
      var orphan = document.getElementById(id)
      if (orphan && orphan.parentNode) orphan.parentNode.removeChild(orphan)
      var stray = document.querySelector('#d' + id)
      if (stray && stray.parentNode) stray.parentNode.removeChild(stray)
    })
    return wrap
  }

  function mount (root) {
    var lang = (root.getAttribute('data-lang') || 'no').trim().toLowerCase() === 'en' ? 'en' : 'no'
    var t = TEXT[lang]
    var endpoint = (root.getAttribute('data-endpoint') || ENDPOINT).trim()
    var viewer = (root.getAttribute('data-viewer') || VIEWER).trim()
    var target = (root.getAttribute('data-target') || '_blank').trim()
    var limit = parseInt(root.getAttribute('data-limit') || '0', 10)
    if (isNaN(limit) || limit < 0) limit = 0
    var sort = (root.getAttribute('data-sort') || 'updated').trim()
    var areas = parseAreas(root.getAttribute('data-vegvisr-portfolio') || root.getAttribute('data-meta-areas') || '')
    var filterMode = (root.getAttribute('data-filters') || 'auto').trim().toLowerCase()
    var include = (root.getAttribute('data-include') || 'published').trim().toLowerCase()
    var open = (root.getAttribute('data-open') || 'modal').trim().toLowerCase()
    if (open !== 'page' && open !== 'self') open = 'modal'
    var opts = { lang: lang, t: t, viewer: viewer, target: target, limit: limit, descMax: DESC_MAX, open: open }

    injectStyle()
    root.classList.add('vgp')
    root.textContent = ''

    var heading = (root.getAttribute('data-title') || '').trim()
    if (heading) {
      var h = document.createElement('h2')
      h.className = 'vgp-title'
      h.textContent = heading
      root.appendChild(h)
    }

    var host = document.createElement('div')
    var loading = document.createElement('div')
    loading.className = 'vgp-msg'
    loading.textContent = t.loading
    host.appendChild(loading)

    // One request per area (server-side filter), or a single unfiltered sweep.
    var jobs = areas.length
      ? areas.map(function (a) { return fetchArea(endpoint, a) })
      : [fetchArea(endpoint, '')]

    Promise.all(jobs).then(function (lists) {
      var fetched = mergeById(lists)
      var rows = sortRows(visibleRows(fetched, include), sort)
      // Concatenated, not a %s format string: the message is read back through
      // consoles that print the arguments after the template instead of into it.
      log('showing ' + rows.length + ' of ' + fetched.length + ' fetched row(s) (include=' +
        include + ') from ' + (areas.length ? areas.join(' + ') : 'every area'))
      if (!rows.length && fetched.length) {
        console.warn('[graph-portfolio] the API returned ' + fetched.length +
          ' row(s) but none are published, so the grid is empty. Publish the graphs, or set data-include="public" to show drafts too.')
      }
      var showChips = filterMode === 'on' || (filterMode !== 'off' && areas.length > 1)
      if (showChips) root.appendChild(buildChips(root, host, rows, areas, opts))
      root.appendChild(host)
      renderGrid(host, limitRows(rows, limit), opts, root)
    }).catch(function (err) {
      console.error('[graph-portfolio] load failed:', err)
      root.appendChild(host)
      host.textContent = ''
      message(host, t.error, true)
    })
  }

  function mountAll () {
    var nodes = document.querySelectorAll('[data-vegvisr-portfolio]')
    if (!nodes.length) {
      console.warn('[graph-portfolio] loaded but found no [data-vegvisr-portfolio] element to mount on.')
      return
    }
    log('mounting', nodes.length, 'portfolio grid(s)')
    Array.prototype.forEach.call(nodes, function (n) { mount(n) })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll)
  } else {
    mountAll()
  }
})();
