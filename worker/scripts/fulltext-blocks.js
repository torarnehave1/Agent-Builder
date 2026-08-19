  // ===== structured blocks =====
  // The viewer expresses these as Vue components (FlexboxCards/Grid/Gallery.vue) and a Vue
  // template (IMAGEQUOTE), so they cannot be lifted as JS. Translated here to the SAME class
  // names and the SAME parsing rules, minus the Superadmin edit buttons (viewer-only chrome).
  // [FLEXBOX | …], [FLEXBOX-ROW] and [pb] are in the element catalog but have NO handler in
  // the viewer at all; they are implemented here from their registered `format`.

  function mdImages(text) {
    var re = /!\[([^\]]*?)\]\(([^)]+)\)/g, out = [], m;
    while ((m = re.exec(text)) !== null) out.push({ alt: m[1], src: m[2] });
    return out;
  }

  // Same rules as FlexboxCards.vue's `cards` computed.
  function parseCards(content) {
    var cards = [], cur = { title: '', image: '', text: '', imageUrl: '' }, started = false;
    var lines = String(content).trim().split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var title = line.match(/^\*\*(.+?)\*\*$/);
      if (title) {
        if (started && (cur.title || cur.image || cur.text)) cards.push(cur);
        cur = { title: title[1], image: '', text: '', imageUrl: '' };
        started = true;
        continue;
      }
      var img = line.match(/!\[([^\]]*?)\]\(([^)]+)\)/);
      if (img && started) {
        cur.image = '<img src="' + esc(img[2]) + '" alt="' + esc(img[1]) + '" class="card-image">';
        cur.imageUrl = img[2];
        continue;
      }
      if (line && started) cur.text += (cur.text ? ' ' : '') + line;
    }
    if (started && (cur.title || cur.image || cur.text)) cards.push(cur);
    return cards;
  }

  function renderFlexboxCards(content, columnCount) {
    var n = columnCount || 3;
    var html = '<div class="flexbox-cards-container flexbox-cards-' + n + '">';
    parseCards(content).forEach(function (c) {
      html += '<div class="flexbox-card">';
      if (c.image) html += '<div class="card-image">' + c.image + '</div>';
      if (c.title) html += '<h4 class="card-title">' + esc(c.title) + '</h4>';
      if (c.text) html += '<div class="card-text">' + esc(c.text) + '</div>';
      html += '</div>';
    });
    return html + '</div>';
  }

  function renderFlexboxGrid(content) {
    return '<div class="flexbox-grid">' + mdImages(content).map(function (i) {
      return '<div class="grid-item"><img src="' + esc(i.src) + '" alt="' + esc(i.alt) + '" /></div>';
    }).join('') + '</div>';
  }

  function renderFlexboxGallery(content) {
    return '<div class="flexbox-gallery">' + mdImages(content).map(function (i) {
      return '<div class="gallery-item"><img src="' + esc(i.src) + '" alt="' + esc(i.alt) + '" class="gallery-image" /></div>';
    }).join('') + '</div>';
  }

  // [FLEXBOX-ROW] — registered, no viewer handler. Images side by side, sizes from ![alt|styles].
  function renderFlexboxRow(content) {
    var re = /!\[([^\]|]*)(?:\|([^\]]*))?\]\(([^)]+)\)/g, items = [], m;
    while ((m = re.exec(content)) !== null) {
      items.push('<div class="flexbox-row-item"><img src="' + esc(m[3]) + '" alt="' + esc(m[1]) +
        '" style="' + (m[2] ? parseStyleString(m[2]) : '') + '" /></div>');
    }
    return '<div class="flexbox-row">' + items.join('') + '</div>';
  }

  // [FLEXBOX | gap; justify-content; align-items] — registered, no viewer handler.
  function renderFlexboxGeneric(params, content) {
    var re = /!\[([^\]|]*)(?:\|([^\]]*))?\]\(([^)]+)\)/g, items = [], m;
    while ((m = re.exec(content)) !== null) {
      items.push('<img src="' + esc(m[3]) + '" alt="' + esc(m[1]) + '" style="' + (m[2] ? parseStyleString(m[2]) : '') + '" />');
    }
    var body = items.length ? items.join('') : marked(String(content).trim());
    return '<div class="flexbox-generic" style="display: flex; ' + parseStyleString(params) + '">' + body + '</div>';
  }

  // IMAGEQUOTE — params are space separated with NO pipe: [IMAGEQUOTE backgroundImage:'…' …]
  function renderImageQuote(params, content) {
    var p = parseImageQuoteParams(params || '');
    var container = '';
    if (p.backgroundImage) container += "background-image: url('" + String(p.backgroundImage).replace(/'/g, '') + "'); background-size: cover; background-position: center;";
    var inner = '';
    if (p.fontFamily) inner += 'font-family: ' + esc(p.fontFamily) + ';';
    if (p.fontSize) inner += 'font-size: ' + esc(p.fontSize) + ';';
    if (p.textColor) inner += 'color: ' + esc(p.textColor) + ';';
    var text = String(content).trim();
    var cited = '';
    var cm = text.match(/\n\s*[—-]\s*(.+)$/);
    if (cm) { cited = cm[1].trim(); text = text.slice(0, cm.index).trim(); }
    return '<div class="imagequote-element" style="' + container + '">' +
      '<div class="imagequote-content" style="' + inner + '">' + esc(text) + '</div>' +
      (cited ? '<div class="imagequote-citation">— ' + esc(cited) + '</div>' : '') +
      '</div>';
  }

  // Split the raw text on the structured blocks, render each, and send everything between them
  // through the viewer's own parseFormattedElements. Mirrors GNewDefaultNode's parsedContent.
  var BLOCK_RE = /\[FLEXBOX-(GRID|CARDS(?:-(\d+))?|GALLERY|ROW)\]([\s\S]*?)\[END\s+FLEXBOX(?:-[A-Z]+)?\]|\[FLEXBOX\s*\|([^\]]*)\]([\s\S]*?)\[END\s+FLEXBOX\]|\[IMAGEQUOTE\s*([^\]]*)\]([\s\S]*?)\[END\s+IMAGEQUOTE\]/g;

  function renderStructured(raw) {
    // [pb] — PAGE BREAK. Registered, no viewer handler. Done first so it survives every pass.
    var text = String(raw).replace(/\[pb\]/gi, '\n\n<hr class="vegvisr-page-break" />\n\n');
    var parts = [], last = 0, m;
    BLOCK_RE.lastIndex = 0;
    while ((m = BLOCK_RE.exec(text)) !== null) {
      if (m.index > last) {
        var before = text.slice(last, m.index).trim();
        if (before) parts.push(parseFormattedElements(before));
      }
      if (m[1]) {
        var kind = m[1].toUpperCase(), body = m[3];
        if (kind.indexOf('CARDS') === 0) parts.push(renderFlexboxCards(body, m[2] ? parseInt(m[2], 10) : 3));
        else if (kind === 'GRID') parts.push(renderFlexboxGrid(body));
        else if (kind === 'GALLERY') parts.push(renderFlexboxGallery(body));
        else if (kind === 'ROW') parts.push(renderFlexboxRow(body));
      } else if (m[4] !== undefined) {
        parts.push(renderFlexboxGeneric(m[4], m[5]));
      } else if (m[6] !== undefined) {
        parts.push(renderImageQuote(m[6], m[7]));
      }
      last = m.index + m[0].length;
    }
    var rest = text.slice(last).trim();
    if (rest) parts.push(parseFormattedElements(rest));
    return parts.join('\n');
  }
