// image-gallery — component (SSOT), served from the Component Registry graph
// node's metadata.impl at api.vegvisr.org/components/image-gallery.js.
//
// Renders a responsive photo grid from a SHARED Vegvisr photo album. The album
// is addressed by its shareId, so the page needs no API token and the gallery
// updates itself whenever photos are added to or removed from the album.
//
// Self-mounting: drop a marker anywhere and this script (loaded with
// <script src=".../components/image-gallery.js" defer>) builds the grid,
// injects its CSS, and wires the lightbox.
//
// Usage:
//   <div data-vegvisr-gallery="<shareId>"   (REQUIRED — the album's shareId)
//        data-columns="auto"      (optional — "auto" or a number, default auto)
//        data-gap="12"            (optional — px between tiles, default 12)
//        data-aspect="4/3"        (optional — tile ratio, or "auto" for natural heights)
//        data-radius="12"         (optional — corner radius in px, default 12)
//        data-lightbox="on"       (optional — "on" | "off", default on)
//        data-limit=""            (optional — show at most N photos)
//        data-title=""            (optional — heading above the grid)
//        data-endpoint="https://photos-api.vegvisr.org/list-r2-images">
//   </div>
//
// Where the shareId comes from: open the album in the Photos app, press Share,
// and publish it. The panel shows the link — the shareId is the last path
// segment of https://seo.vegvisr.org/album/<shareId>. Photos held back with the
// eye toggle never reach this component; the endpoint filters them server-side.
//
// An album that is unpublished later returns 404 and the gallery renders its
// empty state rather than a broken grid.

(function () {
  'use strict'

  var ENDPOINT = 'https://photos-api.vegvisr.org/list-r2-images'
  var STYLE_ID = 'vgal-style'
  var THUMB_W = 700
  var FULL_W = 1600
  var MIN_TILE = 140

  // Prefix has to go INSIDE the format string, or console treats it as its own
  // argument and every %s in the real message is printed literally.
  function log () {
    var a = [].slice.call(arguments)
    if (typeof a[0] === 'string') a[0] = '[image-gallery] ' + a[0]
    else a.unshift('[image-gallery]')
    console.log.apply(console, a)
  }

  // imgix serves every album image, so width/format hints are just query params.
  // Guard for a url that already carries a query rather than assuming it does not.
  function sized (url, w) {
    if (!url) return url
    var join = url.indexOf('?') === -1 ? '?' : '&'
    return url + join + 'w=' + w + '&auto=format&fit=max'
  }

  function injectStyle () {
    if (document.getElementById(STYLE_ID)) return
    var css = [
      '.vgal{margin:0;padding:0}',
      '.vgal-title{font:600 1.1rem/1.3 inherit;margin:0 0 .75rem;opacity:.9}',
      '.vgal-grid{display:grid;width:100%}',
      '.vgal-tile{position:relative;display:block;padding:0;margin:0;border:0;background:rgba(127,127,127,.12);overflow:hidden;cursor:zoom-in;width:100%}',
      '.vgal-tile[data-static]{cursor:default}',
      '.vgal-tile img{display:block;width:100%;height:100%;object-fit:cover;transition:transform .35s ease}',
      '.vgal-tile:hover img{transform:scale(1.04)}',
      '.vgal-tile:focus-visible{outline:2px solid currentColor;outline-offset:2px}',
      '.vgal-msg{padding:1rem;font:400 .9rem/1.5 inherit;opacity:.7;text-align:center}',
      '.vgal-msg[data-error]{color:#c0392b;opacity:1}',
      // Lightbox
      '.vgal-lb{position:fixed;inset:0;z-index:2147483000;background:rgba(8,10,14,.92);display:flex;align-items:center;justify-content:center;padding:2vmin}',
      '.vgal-lb img{max-width:96vw;max-height:92vh;object-fit:contain;border-radius:6px}',
      '.vgal-lb-btn{position:absolute;top:50%;transform:translateY(-50%);width:46px;height:46px;border-radius:50%;border:0;background:rgba(255,255,255,.14);color:#fff;font-size:22px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center}',
      '.vgal-lb-btn:hover{background:rgba(255,255,255,.26)}',
      '.vgal-lb-prev{left:2vmin}.vgal-lb-next{right:2vmin}',
      '.vgal-lb-close{position:absolute;top:2vmin;right:2vmin;transform:none}',
      '.vgal-lb-count{position:absolute;bottom:2vmin;left:0;right:0;text-align:center;color:rgba(255,255,255,.75);font:400 .85rem/1 inherit}',
      '@media (max-width:520px){.vgal-lb-btn{width:38px;height:38px}}',
      '@media (prefers-reduced-motion:reduce){.vgal-tile img{transition:none}.vgal-tile:hover img{transform:none}}'
    ].join('')
    var el = document.createElement('style')
    el.id = STYLE_ID
    el.textContent = css
    document.head.appendChild(el)
  }

  function applyGridStyle (grid, root) {
    var gap = parseInt(root.getAttribute('data-gap') || '12', 10)
    if (isNaN(gap) || gap < 0) gap = 12
    var columns = (root.getAttribute('data-columns') || 'auto').trim()
    grid.style.gap = gap + 'px'
    if (columns === 'auto' || columns === '') {
      // Fluid: as many ~240px columns as fit, never fewer than one.
      grid.style.gridTemplateColumns = 'repeat(auto-fill,minmax(min(240px,100%),1fr))'
    } else {
      var n = parseInt(columns, 10)
      if (isNaN(n) || n < 1) n = 3
      // Honour the requested count where there is room, but never below a usable tile
      // width — a hard `repeat(4,1fr)` on a phone gives 85px thumbnails. The track floor
      // is whichever is larger: the author's Nth of the row, or MIN_TILE. On a narrow
      // screen the floor wins and the grid drops to as many columns as actually fit.
      var share = 'calc((100% - ' + ((n - 1) * gap) + 'px) / ' + n + ')'
      grid.style.gridTemplateColumns =
        'repeat(auto-fill,minmax(min(100%,max(' + MIN_TILE + 'px,' + share + ')),1fr))'
    }
  }

  function tileFor (image, index, root, onOpen) {
    var radius = parseInt(root.getAttribute('data-radius') || '12', 10)
    if (isNaN(radius) || radius < 0) radius = 12
    var aspect = (root.getAttribute('data-aspect') || '4/3').trim()
    var lightbox = (root.getAttribute('data-lightbox') || 'on').trim() !== 'off'

    var tile = document.createElement(lightbox ? 'button' : 'div')
    tile.className = 'vgal-tile'
    tile.style.borderRadius = radius + 'px'
    if (aspect && aspect !== 'auto') tile.style.aspectRatio = aspect.replace('/', ' / ')
    if (lightbox) {
      tile.type = 'button'
      tile.setAttribute('aria-label', 'Open photo ' + (index + 1))
      tile.addEventListener('click', function () { onOpen(index) })
    } else {
      tile.setAttribute('data-static', '')
    }

    var img = document.createElement('img')
    img.src = sized(image.url, THUMB_W)
    img.alt = image.alt || ''
    img.loading = 'lazy'
    img.decoding = 'async'
    if (aspect === 'auto') img.style.height = 'auto'
    tile.appendChild(img)
    return tile
  }

  function openLightbox (images, startIndex) {
    var i = startIndex
    var lb = document.createElement('div')
    lb.className = 'vgal-lb'
    lb.setAttribute('role', 'dialog')
    lb.setAttribute('aria-modal', 'true')
    lb.setAttribute('aria-label', 'Photo viewer')

    var img = document.createElement('img')
    var count = document.createElement('div')
    count.className = 'vgal-lb-count'

    function show (n) {
      i = (n + images.length) % images.length
      img.src = sized(images[i].url, FULL_W)
      img.alt = images[i].alt || ''
      count.textContent = (i + 1) + ' / ' + images.length
    }

    function mkBtn (cls, label, glyph, handler) {
      var b = document.createElement('button')
      b.type = 'button'
      b.className = 'vgal-lb-btn ' + cls
      b.setAttribute('aria-label', label)
      b.textContent = glyph
      b.addEventListener('click', function (e) { e.stopPropagation(); handler() })
      return b
    }

    var prev = mkBtn('vgal-lb-prev', 'Previous photo', '‹', function () { show(i - 1) })
    var next = mkBtn('vgal-lb-next', 'Next photo', '›', function () { show(i + 1) })
    var close = mkBtn('vgal-lb-close', 'Close viewer', '✕', function () { destroy() })

    function onKey (e) {
      if (e.key === 'Escape') destroy()
      else if (e.key === 'ArrowRight') show(i + 1)
      else if (e.key === 'ArrowLeft') show(i - 1)
    }
    function destroy () {
      document.removeEventListener('keydown', onKey)
      if (lb.parentNode) lb.parentNode.removeChild(lb)
      document.documentElement.style.overflow = prevOverflow
      if (opener && opener.focus) opener.focus()
    }

    // Clicking the backdrop closes; clicking the photo itself does not.
    lb.addEventListener('click', function (e) { if (e.target === lb) destroy() })
    img.addEventListener('click', function (e) { e.stopPropagation() })

    if (images.length > 1) { lb.appendChild(prev); lb.appendChild(next) }
    lb.appendChild(close)
    lb.appendChild(img)
    if (images.length > 1) lb.appendChild(count)

    var opener = document.activeElement
    var prevOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    document.body.appendChild(lb)
    show(i)
    close.focus()
  }

  function message (root, text, isError) {
    var m = document.createElement('div')
    m.className = 'vgal-msg'
    if (isError) m.setAttribute('data-error', '')
    m.textContent = text
    root.appendChild(m)
  }

  async function mount (root) {
    if (root.hasAttribute('data-vgc-init')) return
    root.setAttribute('data-vgc-init', '')
    root.classList.add('vgal')

    var shareId = (root.getAttribute('data-vegvisr-gallery') || '').trim()
    if (!shareId) {
      console.warn('[image-gallery] no shareId on the marker — put the album shareId in data-vegvisr-gallery="…". Nothing rendered.')
      message(root, 'Gallery not configured.', true)
      return
    }

    var endpoint = (root.getAttribute('data-endpoint') || ENDPOINT).trim()
    var titleText = (root.getAttribute('data-title') || '').trim()
    var limit = parseInt(root.getAttribute('data-limit') || '', 10)

    if (titleText) {
      var h = document.createElement('div')
      h.className = 'vgal-title'
      h.textContent = titleText
      root.appendChild(h)
    }

    var url = endpoint + (endpoint.indexOf('?') === -1 ? '?' : '&') + 'share=' + encodeURIComponent(shareId)
    var data
    try {
      var res = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!res.ok) {
        // 404 is the ordinary outcome for an album that was unpublished or a
        // link that was regenerated — say so plainly instead of a broken grid.
        console.error('[image-gallery] album fetch failed', res.status, url)
        message(root, res.status === 404 ? 'This album is no longer shared.' : 'Could not load the album.', true)
        return
      }
      data = await res.json()
    } catch (err) {
      console.error('[image-gallery] album fetch threw', err && err.message, url)
      message(root, 'Could not load the album.', true)
      return
    }

    var images = (data && Array.isArray(data.images) ? data.images : [])
      .filter(function (im) { return im && im.url })
      .map(function (im) { return { url: im.url, alt: im.name || im.title || '' } })
    if (!isNaN(limit) && limit > 0) images = images.slice(0, limit)

    log('album "%s" — %s photo(s) from %s', (data && data.album) || shareId, images.length, shareId)

    if (images.length === 0) {
      message(root, 'No photos in this album yet.')
      return
    }

    injectStyle()
    var grid = document.createElement('div')
    grid.className = 'vgal-grid'
    applyGridStyle(grid, root)
    var open = function (n) { openLightbox(images, n) }
    images.forEach(function (image, idx) { grid.appendChild(tileFor(image, idx, root, open)) })
    root.appendChild(grid)
  }

  function mountAll () {
    var nodes = document.querySelectorAll('[data-vegvisr-gallery]')
    if (!nodes.length) {
      console.warn('[image-gallery] loaded but found no [data-vegvisr-gallery] element to mount on.')
      return
    }
    log('mounting', nodes.length, 'gallery/galleries')
    Array.prototype.forEach.call(nodes, function (n) { mount(n) })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll)
  } else {
    mountAll()
  }
})();
