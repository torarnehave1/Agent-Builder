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
//        data-target="_blank"    (optional — link target, default _blank)
//        data-viewer="https://www.vegvisr.org/gnew-viewer?graphId="
//        data-endpoint="https://knowledge.vegvisr.org/getknowgraphsummaries">
//   </div>
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
  var VIEWER = 'https://www.vegvisr.org/gnew-viewer?graphId='
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
    },
    en: {
      empty: 'No published graphs here yet.',
      error: 'Could not load the portfolio right now.',
      all: 'All',
      nodes: 'nodes',
      updated: 'Updated',
      loading: 'Loading …',
      noConfig: 'Portfolio is not configured.',
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

  // ---- DOM + network ----

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
      '.vgp-card{display:flex;flex-direction:column;overflow:hidden;border-radius:12px;text-decoration:none;color:inherit;',
      'background:var(--v-surface,rgba(127,127,127,.07));border:1px solid var(--v-border,rgba(127,127,127,.18));',
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
      img.src = card.image
      img.alt = ''
      img.loading = 'lazy'
      // A dead imgix key must not leave a blank rectangle — fall back to the tile.
      img.onerror = function () {
        thumb.removeChild(img)
        paintFallback(thumb, card)
      }
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
    var a = document.createElement('a')
    a.className = 'vgp-card'
    a.href = card.href
    a.target = opts.target
    if (opts.target === '_blank') a.rel = 'noopener noreferrer'
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
    var opts = { lang: lang, t: t, viewer: viewer, target: target, limit: limit, descMax: DESC_MAX }

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
