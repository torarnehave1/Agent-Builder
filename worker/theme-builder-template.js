/**
 * Theme Builder HTML App Template
 * Version: 1.2.0
 *
 * Showcase-style theme preview with color palette swatches, component
 * preview cards, and a token editor toggle. Loads css-nodes from a
 * knowledge graph and applies design tokens live.
 *
 * Placeholders:
 *   {{TITLE}}            - Theme name
 *   {{DESCRIPTION}}      - Theme description
 *   {{GRAPH_ID_DEFAULT}} - Fallback graph ID
 */
export const THEME_BUILDER_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="template-version" content="1.2.0" />
  <meta name="template-id" content="theme-builder" />
  <title>{{TITLE}}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Sora:wght@300;400;500;600;700&display=swap" rel="stylesheet" />

  <style>
    :root {
      --bg1: #ecfeff;
      --bg2: #e0f2fe;
      --text: #06283d;
      --muted: #335f73;
      --accent: #38bdf8;
      --accent2: #22c55e;
      --card: rgba(255,255,255,0.72);
      --line: rgba(6,40,61,0.14);
      --radius: 18px;
      --font: 'Sora', system-ui, -apple-system, sans-serif;
      --font-display: 'DM Serif Display', serif;
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--font);
      color: var(--text);
      background:
        radial-gradient(ellipse 900px 520px at 15% -10%, color-mix(in srgb, var(--accent) 25%, transparent), transparent 55%),
        radial-gradient(ellipse 800px 500px at 95% 10%, color-mix(in srgb, var(--accent2) 14%, transparent), transparent 60%),
        linear-gradient(180deg, var(--bg1) 0%, var(--bg2) 35%, color-mix(in srgb, var(--bg1) 90%, white) 100%);
      min-height: 100vh;
    }

    /* ---- Header ---- */
    .header {
      position: sticky; top: 0; z-index: 50;
      background: color-mix(in srgb, var(--bg1) 70%, transparent);
      backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--line);
    }
    .header-inner {
      max-width: 960px; margin: 0 auto; padding: 16px 20px;
      display: flex; align-items: center; justify-content: space-between;
    }
    .header-left { display: flex; align-items: center; gap: 12px; }
    .header-icon {
      width: 36px; height: 36px; border-radius: 12px;
      background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 30%, white));
    }
    .header-name { font-family: var(--font-display); font-size: 20px; line-height: 1.2; }
    .header-badge { font-size: 10px; text-transform: uppercase; letter-spacing: 0.14em; opacity: 0.6; }
    .header-right { display: flex; gap: 8px; align-items: center; }

    /* ---- Buttons ---- */
    .btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 16px; border: none; border-radius: 10px;
      font-size: 13px; font-weight: 500; cursor: pointer;
      transition: all 0.2s; font-family: var(--font);
    }
    .btn-accent { background: var(--accent); color: white; }
    .btn-accent:hover { background: color-mix(in srgb, var(--accent) 80%, black); }
    .btn-outline {
      background: color-mix(in srgb, var(--card) 60%, transparent);
      color: var(--text); border: 1px solid var(--line);
    }
    .btn-outline:hover { background: var(--card); }
    .btn-create { background: var(--accent2); color: white; }
    .btn-create:hover { background: color-mix(in srgb, var(--accent2) 80%, black); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    /* ---- Showcase layout ---- */
    .showcase { max-width: 960px; margin: 0 auto; padding: 48px 20px; }

    /* Hero card */
    .hero {
      background: var(--card); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
      border: 1px solid var(--line); border-radius: calc(var(--radius) + 6px);
      padding: 32px 36px; box-shadow: 0 26px 80px rgba(0,0,0,0.08);
    }
    .kicker {
      font-size: 11px; letter-spacing: 0.14em;
      text-transform: uppercase; color: var(--muted);
    }
    .hero-banner {
      margin-top: 16px; border-radius: var(--radius); overflow: hidden;
      border: 1px solid var(--line);
      background: linear-gradient(135deg,
        color-mix(in srgb, var(--accent) 30%, var(--bg1)),
        color-mix(in srgb, var(--accent2) 20%, var(--bg2)));
      height: 240px; display: flex; align-items: center; justify-content: center;
    }
    .hero-banner-text { font-family: var(--font-display); font-size: 32px; opacity: 0.25; }
    .hero-title {
      margin-top: 24px; font-family: var(--font-display);
      font-size: clamp(32px, 6vw, 56px); line-height: 1.05;
    }
    .gradient-text {
      background: linear-gradient(135deg, var(--accent) 0%, var(--accent2) 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
    }
    .hero-desc {
      margin-top: 20px; max-width: 600px; line-height: 1.7;
      color: color-mix(in srgb, var(--text) 80%, transparent);
    }
    .hero-actions { margin-top: 28px; display: flex; flex-wrap: wrap; gap: 12px; }
    .hero-btn {
      padding: 12px 24px; border-radius: var(--radius); border: none;
      font-size: 15px; font-weight: 500; cursor: pointer;
      transition: all 0.2s; font-family: var(--font);
    }
    .hero-btn-primary { background: var(--accent); color: white; }
    .hero-btn-primary:hover { background: color-mix(in srgb, var(--accent) 80%, black); }
    .hero-btn-secondary {
      background: color-mix(in srgb, var(--card) 50%, transparent);
      color: var(--text); border: 1px solid var(--line);
    }
    .hero-btn-secondary:hover { background: var(--card); }

    /* Palette */
    .palette {
      margin-top: 40px; display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 16px;
    }
    .swatch-card {
      border-radius: var(--radius); overflow: hidden;
      border: 1px solid var(--line); background: var(--card);
      transition: transform 0.3s; cursor: default;
    }
    .swatch-card:hover { transform: translateY(-6px); }
    .swatch-block { height: 56px; }
    .swatch-info { padding: 12px; }
    .swatch-name { font-size: 13px; font-weight: 600; }
    .swatch-hex { font-size: 11px; color: var(--muted); margin-top: 2px; }

    /* Components */
    .components {
      margin-top: 40px; display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px;
    }
    .comp-card {
      border-radius: var(--radius); border: 1px solid var(--line);
      background: var(--card); backdrop-filter: blur(10px);
      padding: 24px; transition: transform 0.3s;
    }
    .comp-card:hover { transform: translateY(-6px); }
    .comp-kicker {
      font-size: 10px; text-transform: uppercase;
      letter-spacing: 0.14em; color: var(--muted);
    }
    .comp-title { margin-top: 12px; font-family: var(--font-display); font-size: 22px; line-height: 1.15; }
    .comp-text {
      margin-top: 12px; font-size: 13px; line-height: 1.6;
      color: color-mix(in srgb, var(--text) 75%, transparent);
    }
    .comp-ink {
      background: color-mix(in srgb, var(--text) 92%, transparent);
      color: var(--bg1); border-color: color-mix(in srgb, var(--bg1) 24%, transparent);
    }
    .comp-ink .comp-kicker { color: color-mix(in srgb, var(--bg1) 70%, transparent); }
    .comp-ink .comp-text { color: color-mix(in srgb, var(--bg1) 85%, transparent); }
    .accent-chip {
      display: inline-block; margin-top: 16px; padding: 4px 14px;
      border-radius: 999px; background: var(--bg1);
      border: 1px solid var(--line); color: var(--text);
      font-size: 12px; font-weight: 600;
    }
    .comp-btns { margin-top: 16px; display: flex; flex-wrap: wrap; gap: 8px; }
    .comp-btn {
      padding: 8px 16px; border-radius: 10px; font-size: 13px;
      font-weight: 500; cursor: pointer; font-family: var(--font); border: none;
    }
    .comp-btn-primary { background: var(--accent); color: white; }
    .comp-btn-secondary {
      background: color-mix(in srgb, var(--card) 60%, transparent);
      color: var(--text); border: 1px solid var(--line);
    }
    .comp-btn-link { background: transparent; color: var(--accent); }

    /* Footer */
    .showcase-footer {
      margin-top: 48px; padding: 40px 0; text-align: center;
      font-size: 11px; letter-spacing: 0.14em;
      text-transform: uppercase; color: var(--muted);
    }

    /* ---- Editor view ---- */
    .editor { max-width: 960px; margin: 0 auto; padding: 32px 20px; display: none; }
    .editor-grid {
      display: grid; grid-template-columns: 1fr 360px; gap: 24px;
    }
    @media (max-width: 800px) { .editor-grid { grid-template-columns: 1fr; } }
    .editor-card {
      background: var(--card); backdrop-filter: blur(10px);
      border: 1px solid var(--line); border-radius: var(--radius); padding: 20px;
    }
    .editor-card-header {
      display: flex; align-items: center;
      justify-content: space-between; margin-bottom: 16px;
    }
    .editor-card-title { font-size: 15px; font-weight: 600; }
    .editor-card-meta { font-size: 11px; color: var(--muted); }
    .group-label {
      font-size: 11px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.05em; color: var(--muted); margin: 16px 0 6px;
    }
    .group-label:first-child { margin-top: 0; }
    .token-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
    .token-label {
      font-family: monospace; font-size: 12px; color: var(--muted);
      min-width: 120px; flex-shrink: 0;
    }
    input[type="color"] {
      width: 32px; height: 28px; border: 1px solid var(--line);
      border-radius: 6px; background: transparent; cursor: pointer;
      padding: 2px; flex-shrink: 0;
    }
    input[type="text"], select {
      background: color-mix(in srgb, var(--bg2) 70%, transparent);
      border: 1px solid var(--line); border-radius: 6px;
      color: var(--text); padding: 5px 8px;
      font-family: monospace; font-size: 12px; flex: 1; min-width: 0;
    }
    input[type="text"]:focus, select:focus { outline: none; border-color: var(--accent); }
    .save-actions { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
    .save-status { font-size: 11px; margin-top: 6px; min-height: 16px; }
    .save-status.ok { color: var(--accent2); }
    .save-status.err { color: #ef4444; }
    .css-output-box {
      background: color-mix(in srgb, var(--text) 5%, var(--bg1));
      border: 1px solid var(--line); border-radius: 8px; padding: 12px;
      font-family: monospace; font-size: 11px; color: var(--muted);
      white-space: pre-wrap; max-height: 300px; overflow-y: auto;
    }

    /* Node tabs */
    .node-tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
    .node-tab {
      padding: 6px 14px; border-radius: 8px; font-size: 12px; font-weight: 500;
      cursor: pointer; border: 1px solid var(--line);
      background: transparent; color: var(--text); font-family: var(--font);
      transition: all 0.2s;
    }
    .node-tab.active { background: var(--accent); color: white; border-color: var(--accent); }

    /* ---- Modal ---- */
    .modal-overlay {
      display: none; position: fixed; inset: 0;
      background: rgba(0,0,0,0.5); backdrop-filter: blur(4px);
      z-index: 100; align-items: center; justify-content: center;
    }
    .modal-overlay.active { display: flex; }
    .modal {
      background: color-mix(in srgb, var(--card) 95%, white);
      backdrop-filter: blur(20px); border: 1px solid var(--line);
      border-radius: var(--radius); padding: 28px;
      width: 90%; max-width: 440px; box-shadow: 0 26px 80px rgba(0,0,0,0.2);
    }
    .modal h2 { font-family: var(--font-display); font-size: 20px; margin-bottom: 20px; }
    .modal-field { margin-bottom: 14px; }
    .modal-field label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
    .modal-field input, .modal-field select { width: 100%; }
    .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }

    /* States */
    .loading-state { text-align: center; padding: 80px 20px; color: var(--muted); }
    .empty-state { text-align: center; padding: 60px 20px; color: var(--muted); }
    .empty-state p { margin-bottom: 16px; line-height: 1.6; }

    /* Showcase node tabs */
    .showcase-tabs {
      display: flex; gap: 8px; flex-wrap: wrap;
      margin-bottom: 24px;
    }
    .showcase-tab {
      padding: 6px 14px; border-radius: 8px; font-size: 12px; font-weight: 500;
      cursor: pointer; border: 1px solid var(--line);
      background: transparent; color: var(--text); font-family: var(--font);
      transition: all 0.2s;
    }
    .showcase-tab.active { background: var(--accent); color: white; border-color: var(--accent); }
  </style>
</head>
<body>

  <!-- Header -->
  <header class="header">
    <div class="header-inner">
      <div class="header-left">
        <div class="header-icon"></div>
        <span class="header-name" id="themeName">{{TITLE}}</span>
        <span class="header-badge">theme</span>
      </div>
      <div class="header-right">
        <button class="btn btn-accent" id="btnToggleView">View tokens</button>
        <button class="btn btn-create" id="btnNewTheme">+ New</button>
      </div>
    </div>
  </header>

  <!-- Loading state -->
  <div class="loading-state" id="loadingState">
    <p>Loading theme data...</p>
  </div>

  <!-- Showcase view (default) -->
  <div class="showcase" id="showcaseView" style="display:none;">

    <!-- Tabs for multiple css-nodes -->
    <div class="showcase-tabs" id="showcaseTabs" style="display:none;"></div>

    <!-- Hero -->
    <section class="hero">
      <p class="kicker" id="heroKicker">THEME PREVIEW</p>
      <div class="hero-banner" id="heroBanner">
        <span class="hero-banner-text" id="heroBannerText">Theme Preview</span>
      </div>
      <h1 class="hero-title">
        A <span class="gradient-text" id="heroTitleAccent">Beautiful</span> UI theme
      </h1>
      <p class="hero-desc">
        {{DESCRIPTION}}
      </p>
      <div class="hero-actions">
        <button class="hero-btn hero-btn-primary" onclick="document.getElementById('paletteSection').scrollIntoView({behavior:'smooth'})">Explore palette</button>
        <button class="hero-btn hero-btn-secondary" id="btnHeroEdit">Edit tokens</button>
      </div>
    </section>

    <!-- Palette -->
    <section class="palette" id="paletteSection"></section>

    <!-- Components -->
    <section class="components" id="componentsSection">
      <article class="comp-card">
        <p class="comp-kicker">Card</p>
        <h2 class="comp-title">Warm editorial blocks</h2>
        <p class="comp-text">
          Lorem ipsum dolor sit amet, consectetur adipiscing elit,
          sed do eiusmod tempor incididunt ut labore.
        </p>
      </article>
      <article class="comp-card comp-ink" id="compInkCard">
        <p class="comp-kicker">Contrast</p>
        <h3 class="comp-title">Ink surface</h3>
        <p class="comp-text">
          Lorem ipsum dolor sit amet, consectetur adipiscing elit.
          Ut enim ad minim veniam.
        </p>
        <span class="accent-chip">Accent chip</span>
      </article>
      <article class="comp-card">
        <p class="comp-kicker">Button set</p>
        <h4 class="comp-title">CTAs</h4>
        <div class="comp-btns">
          <button class="comp-btn comp-btn-primary">Primary</button>
          <button class="comp-btn comp-btn-secondary">Secondary</button>
          <button class="comp-btn comp-btn-link">Link</button>
        </div>
      </article>
    </section>

    <!-- Footer -->
    <footer class="showcase-footer" id="showcaseFooter">
      Made with Vegvisr Knowledge Graph
    </footer>
  </div>

  <!-- Editor view -->
  <div class="editor" id="editorView">
    <div id="nodeTabs" class="node-tabs"></div>
    <div class="editor-grid">
      <div id="tokenEditors"></div>
      <div>
        <div class="editor-card" id="cssOutputCard">
          <div class="editor-card-header">
            <span class="editor-card-title">Generated CSS</span>
            <button class="btn btn-outline" id="btnCopyCss" style="padding:4px 12px;font-size:12px;">Copy</button>
          </div>
          <div class="css-output-box" id="cssOutput"></div>
          <div class="save-status" id="copyStatus"></div>
        </div>
      </div>
    </div>
  </div>

  <!-- New Theme Modal -->
  <div class="modal-overlay" id="newThemeModal">
    <div class="modal">
      <h2>Create New Theme</h2>
      <div class="modal-field">
        <label>Theme Name</label>
        <input type="text" id="newThemeName" value="My Theme" />
      </div>
      <div class="modal-field">
        <label>Preset</label>
        <select id="newThemePreset">
          <option value="coastal">Coastal Blue</option>
          <option value="dark">Dark Mode</option>
          <option value="forest">Forest</option>
          <option value="sunset">Sunset</option>
          <option value="minimal">Minimal</option>
          <option value="midnight">Midnight</option>
        </select>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" id="btnCancelNew">Cancel</button>
        <button class="btn btn-create" id="btnConfirmNew">Create</button>
      </div>
      <div class="save-status" id="newThemeStatus"></div>
    </div>
  </div>

  <script>
    // ---- Graph ID resolution ----
    function getGraphId() {
      var injectedId = '{{GRAPH_ID}}';
      if (injectedId && injectedId.indexOf('{{') === -1) return injectedId;
      var urlParams = new URLSearchParams(window.location.search);
      var urlGraphId = urlParams.get('graph');
      if (urlGraphId) return urlGraphId;
      return '{{GRAPH_ID_DEFAULT}}';
    }
    var GRAPH_ID = getGraphId();
    var KG_API = 'https://knowledge.vegvisr.org';

    // ---- Presets ----
    var PRESETS = {
      coastal: {
        '--bg1': '#ecfeff', '--bg2': '#e0f2fe',
        '--text': '#06283d', '--muted': '#335f73',
        '--accent': '#38bdf8', '--accent2': '#22c55e',
        '--card': 'rgba(255,255,255,0.72)', '--line': 'rgba(6,40,61,0.14)',
        '--radius': '18px',
        '--font': "'Sora', system-ui, sans-serif",
        '--font-display': "'DM Serif Display', serif"
      },
      dark: {
        '--bg1': '#0a0e17', '--bg2': '#111827',
        '--text': '#e5e7eb', '--muted': '#9ca3af',
        '--accent': '#6366f1', '--accent2': '#8b5cf6',
        '--card': 'rgba(17,24,39,0.80)', '--line': 'rgba(255,255,255,0.08)',
        '--radius': '12px',
        '--font': 'system-ui, sans-serif',
        '--font-display': 'Georgia, serif'
      },
      forest: {
        '--bg1': '#f0fdf4', '--bg2': '#dcfce7',
        '--text': '#14532d', '--muted': '#4d7c0f',
        '--accent': '#22c55e', '--accent2': '#84cc16',
        '--card': 'rgba(255,255,255,0.72)', '--line': 'rgba(20,83,45,0.12)',
        '--radius': '14px',
        '--font': 'system-ui, sans-serif',
        '--font-display': 'Georgia, serif'
      },
      sunset: {
        '--bg1': '#fff7ed', '--bg2': '#ffedd5',
        '--text': '#7c2d12', '--muted': '#9a3412',
        '--accent': '#f97316', '--accent2': '#ef4444',
        '--card': 'rgba(255,255,255,0.72)', '--line': 'rgba(124,45,18,0.12)',
        '--radius': '16px',
        '--font': 'system-ui, sans-serif',
        '--font-display': 'Georgia, serif'
      },
      minimal: {
        '--bg1': '#fafafa', '--bg2': '#f5f5f5',
        '--text': '#171717', '--muted': '#737373',
        '--accent': '#171717', '--accent2': '#525252',
        '--card': 'rgba(255,255,255,0.80)', '--line': 'rgba(0,0,0,0.08)',
        '--radius': '8px',
        '--font': 'system-ui, sans-serif',
        '--font-display': 'Georgia, serif'
      },
      midnight: {
        '--bg1': '#0f0f23', '--bg2': '#1a1a3e',
        '--text': '#c8c8ff', '--muted': '#8888bb',
        '--accent': '#7c3aed', '--accent2': '#a78bfa',
        '--card': 'rgba(26,26,62,0.80)', '--line': 'rgba(200,200,255,0.10)',
        '--radius': '14px',
        '--font': 'system-ui, sans-serif',
        '--font-display': 'Georgia, serif'
      }
    };

    // ---- State ----
    var cssNodes = [];
    var activeNodeIndex = 0;
    var currentView = 'showcase';

    // ---- Display names ----
    var DISPLAY_NAMES = {
      '--bg1': 'Background', '--bg2': 'Surface',
      '--text': 'Text', '--muted': 'Muted',
      '--accent': 'Primary', '--accent2': 'Secondary',
      '--card': 'Card', '--line': 'Border',
      '--radius': 'Radius', '--font': 'Font', '--font-display': 'Display Font',
      '--bg': 'Background', '--bg-card': 'Card BG',
      '--primary': 'Primary', '--border': 'Border'
    };

    // ---- Helpers ----
    function escapeHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    function isColorValue(v) {
      if (!v) return false;
      var t = v.trim().toLowerCase();
      if (t.startsWith('#')) return /^#[0-9a-f]{3,8}$/i.test(t);
      if (t.startsWith('rgb') || t.startsWith('hsl')) return true;
      return false;
    }

    function toHex(v) {
      if (!v) return '#000000';
      var t = v.trim();
      if (t.startsWith('#')) {
        if (t.length === 4) return '#' + t[1]+t[1] + t[2]+t[2] + t[3]+t[3];
        return t.slice(0, 7);
      }
      var el = document.createElement('div');
      el.style.color = t;
      document.body.appendChild(el);
      var c = getComputedStyle(el).color;
      document.body.removeChild(el);
      var m = c.match(/\\d+/g);
      if (m && m.length >= 3) return '#' + m.slice(0,3).map(function(n) { return (+n).toString(16).padStart(2,'0'); }).join('');
      return '#000000';
    }

    function parseCssVariables(css) {
      var vars = {};
      var re = /--([\\/\\w-]+)\\s*:\\s*([^;]+)/g;
      var m;
      while ((m = re.exec(css)) !== null) vars['--' + m[1]] = m[2].trim();
      return vars;
    }

    function varsToCSS(vars) {
      var out = ':root {';
      var keys = Object.keys(vars);
      for (var i = 0; i < keys.length; i++) out += '\\n  ' + keys[i] + ': ' + vars[keys[i]] + ';';
      out += '\\n}';
      return out;
    }

    function categorize(key) {
      var k = key.toLowerCase();
      if (k.includes('bg') || k.includes('background') || k.includes('card')) return 'Background';
      if (k.includes('text') || k.includes('muted') || k.includes('foreground')) return 'Text';
      if (k.includes('accent') || k.includes('primary') || k.includes('hover')) return 'Brand';
      if (k.includes('border') || k.includes('line') || k.includes('shadow')) return 'Border';
      if (k.includes('radius')) return 'Shape';
      if (k.includes('font') || k.includes('size')) return 'Typography';
      return 'Other';
    }

    function displayName(varName) {
      return DISPLAY_NAMES[varName] || varName.replace(/^--/, '').replace(/-/g, ' ').replace(/\\b\\w/g, function(c) { return c.toUpperCase(); });
    }

    // ---- Apply tokens to :root ----
    function applyTokens(vars) {
      var root = document.documentElement;
      var keys = Object.keys(vars);
      for (var i = 0; i < keys.length; i++) root.style.setProperty(keys[i], vars[keys[i]]);
    }

    // ---- Load graph ----
    async function loadGraph() {
      var res = await fetch(KG_API + '/getknowgraph?id=' + encodeURIComponent(GRAPH_ID));
      if (!res.ok) throw new Error('Failed to load graph: ' + res.status);
      var data = await res.json();

      var graphTitle = (data.metadata && data.metadata.title) || data.title || '';
      if (graphTitle) {
        document.getElementById('themeName').textContent = graphTitle;
        document.title = graphTitle + ' — Theme Builder';
      }

      cssNodes = (data.nodes || []).filter(function(n) { return n.type === 'css-node'; });
      return cssNodes;
    }

    // ---- Render showcase ----
    function renderShowcase() {
      if (cssNodes.length === 0) {
        document.getElementById('showcaseView').innerHTML =
          '<div class="empty-state"><p>No themes found in this graph.</p>' +
          '<p>Click <strong>+ New</strong> to create your first theme.</p></div>';
        return;
      }

      // Tabs for multiple nodes
      var tabsEl = document.getElementById('showcaseTabs');
      if (cssNodes.length > 1) {
        tabsEl.style.display = '';
        tabsEl.innerHTML = '';
        for (var t = 0; t < cssNodes.length; t++) {
          var tab = document.createElement('button');
          tab.className = 'showcase-tab' + (t === activeNodeIndex ? ' active' : '');
          tab.textContent = cssNodes[t].label || 'Theme ' + (t + 1);
          tab.dataset.index = t;
          tab.addEventListener('click', function(e) {
            activeNodeIndex = parseInt(e.target.dataset.index);
            renderShowcase();
          });
          tabsEl.appendChild(tab);
        }
      } else {
        tabsEl.style.display = 'none';
      }

      var node = cssNodes[activeNodeIndex] || cssNodes[0];
      var vars = parseCssVariables(node.info || '');

      // Apply tokens to page
      applyTokens(vars);

      // Update hero
      var themeName = node.label || 'Theme';
      document.getElementById('heroTitleAccent').textContent = themeName;
      document.getElementById('heroKicker').textContent = (themeName + ' \\u2022 Theme Preview').toUpperCase();
      document.getElementById('heroBannerText').textContent = themeName;

      // Render palette swatches
      var paletteEl = document.getElementById('paletteSection');
      paletteEl.innerHTML = '';
      var entries = Object.entries(vars);
      var colorEntries = entries.filter(function(e) { return isColorValue(e[1]); });

      for (var i = 0; i < colorEntries.length; i++) {
        var key = colorEntries[i][0];
        var val = colorEntries[i][1];
        var card = document.createElement('div');
        card.className = 'swatch-card';
        card.innerHTML =
          '<div class="swatch-block" style="background:' + escapeHtml(val) + '"></div>' +
          '<div class="swatch-info">' +
            '<div class="swatch-name">' + escapeHtml(displayName(key)) + '</div>' +
            '<div class="swatch-hex">' + escapeHtml(val) + '</div>' +
          '</div>';
        paletteEl.appendChild(card);
      }
    }

    // ---- Toggle view ----
    function toggleView() {
      if (currentView === 'showcase') {
        currentView = 'editor';
        document.getElementById('showcaseView').style.display = 'none';
        document.getElementById('editorView').style.display = '';
        document.getElementById('btnToggleView').textContent = 'View preview';
        renderEditor();
      } else {
        currentView = 'showcase';
        document.getElementById('showcaseView').style.display = '';
        document.getElementById('editorView').style.display = 'none';
        document.getElementById('btnToggleView').textContent = 'View tokens';
        renderShowcase();
      }
    }

    // ---- Render editor ----
    function renderEditor() {
      var tabsEl = document.getElementById('nodeTabs');
      tabsEl.innerHTML = '';
      for (var i = 0; i < cssNodes.length; i++) {
        var tab = document.createElement('button');
        tab.className = 'node-tab' + (i === activeNodeIndex ? ' active' : '');
        tab.textContent = cssNodes[i].label || 'CSS Node ' + (i + 1);
        tab.dataset.index = i;
        tab.addEventListener('click', function(e) {
          activeNodeIndex = parseInt(e.target.dataset.index);
          renderEditor();
        });
        tabsEl.appendChild(tab);
      }

      var container = document.getElementById('tokenEditors');
      container.innerHTML = '';

      if (cssNodes.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No css-nodes found.</p>' +
          '<p>Click <strong>+ New</strong> to create a theme.</p></div>';
        return;
      }

      var node = cssNodes[activeNodeIndex] || cssNodes[0];
      var vars = parseCssVariables(node.info || '');
      var entries = Object.entries(vars);

      var card = document.createElement('div');
      card.className = 'editor-card';
      card.dataset.nodeId = node.id;

      var html = '<div class="editor-card-header">';
      html += '<span class="editor-card-title">' + escapeHtml(node.label || 'Untitled') + '</span>';
      html += '<span class="editor-card-meta">' + entries.length + ' tokens</span>';
      html += '</div>';

      if (entries.length === 0) {
        html += '<div class="empty-state" style="padding:20px 0;"><p>No CSS variables found in this node.</p>';
        html += '<p style="font-size:12px;">CSS variables look like: <code>--primary: #6366f1;</code></p></div>';
      } else {
        var groups = {};
        for (var i = 0; i < entries.length; i++) {
          var cat = categorize(entries[i][0]);
          if (!groups[cat]) groups[cat] = [];
          groups[cat].push(entries[i]);
        }
        var groupNames = Object.keys(groups);
        for (var g = 0; g < groupNames.length; g++) {
          html += '<div class="group-label">' + escapeHtml(groupNames[g]) + '</div>';
          var items = groups[groupNames[g]];
          for (var j = 0; j < items.length; j++) {
            var key = items[j][0];
            var value = items[j][1];
            var isColor = isColorValue(value);
            html += '<div class="token-row">';
            html += '<span class="token-label">' + escapeHtml(key) + '</span>';
            if (isColor) {
              html += '<input type="color" data-var="' + escapeHtml(key) + '" value="' + toHex(value) + '" />';
            }
            html += '<input type="text" data-var="' + escapeHtml(key) + '" data-node-id="' + node.id + '" value="' + escapeHtml(value) + '" />';
            html += '</div>';
          }
        }
      }

      html += '<div class="save-actions">';
      html += '<button class="btn btn-accent btn-save" data-node-id="' + node.id + '">Save</button>';
      html += '<button class="btn btn-outline btn-apply" data-node-id="' + node.id + '">Apply to preview</button>';
      html += '</div>';
      html += '<div class="save-status" id="status-' + node.id + '"></div>';

      card.innerHTML = html;
      container.appendChild(card);
      wireEditorEvents(card, node.id);
      updateCssOutput();
    }

    function wireEditorEvents(card, nodeId) {
      card.querySelectorAll('input[type="color"]').forEach(function(cp) {
        var varName = cp.dataset['var'];
        var ti = card.querySelector('input[type="text"][data-var="' + varName + '"]');
        if (ti) cp.addEventListener('input', function() { ti.value = cp.value; updateCssOutput(); });
      });
      card.querySelectorAll('input[type="text"]').forEach(function(ti) {
        ti.addEventListener('input', function() {
          var cp = card.querySelector('input[type="color"][data-var="' + ti.dataset['var'] + '"]');
          if (cp && isColorValue(ti.value)) cp.value = toHex(ti.value);
          updateCssOutput();
        });
      });
      card.querySelector('.btn-save').addEventListener('click', function() { saveCssNode(nodeId); });
      var applyBtn = card.querySelector('.btn-apply');
      if (applyBtn) applyBtn.addEventListener('click', function() {
        var vars = collectEditorVars(card);
        applyTokens(vars);
      });
    }

    function collectEditorVars(card) {
      var vars = {};
      card.querySelectorAll('input[type="text"][data-var]').forEach(function(inp) {
        vars[inp.dataset['var']] = inp.value;
      });
      return vars;
    }

    function updateCssOutput() {
      var card = document.querySelector('.editor-card[data-node-id]');
      if (!card) return;
      var vars = collectEditorVars(card);
      document.getElementById('cssOutput').textContent = varsToCSS(vars);
    }

    // ---- Save ----
    async function saveCssNode(nodeId) {
      var card = document.querySelector('.editor-card[data-node-id="' + nodeId + '"]');
      var statusEl = document.getElementById('status-' + nodeId);
      var saveBtn = card.querySelector('.btn-save');
      var vars = collectEditorVars(card);
      var newCss = varsToCSS(vars);

      saveBtn.disabled = true;
      statusEl.textContent = 'Saving...';
      statusEl.className = 'save-status';

      try {
        var res = await fetch(KG_API + '/patchNode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin' },
          body: JSON.stringify({ graphId: GRAPH_ID, nodeId: nodeId, fields: { info: newCss } })
        });
        if (!res.ok) throw new Error(await res.text());
        for (var i = 0; i < cssNodes.length; i++) {
          if (cssNodes[i].id === nodeId) { cssNodes[i].info = newCss; break; }
        }
        statusEl.textContent = 'Saved!';
        statusEl.className = 'save-status ok';
      } catch (e) {
        statusEl.textContent = 'Error: ' + e.message;
        statusEl.className = 'save-status err';
      } finally {
        saveBtn.disabled = false;
        setTimeout(function() { statusEl.textContent = ''; }, 4000);
      }
    }

    // ---- Create new theme ----
    async function createTheme() {
      var name = document.getElementById('newThemeName').value.trim() || 'My Theme';
      var preset = document.getElementById('newThemePreset').value;
      var statusEl = document.getElementById('newThemeStatus');
      var vars = PRESETS[preset] || PRESETS.coastal;
      var css = varsToCSS(vars);
      var nodeId = 'css-node-' + Date.now();

      statusEl.textContent = 'Creating...';
      statusEl.className = 'save-status';

      try {
        var res = await fetch(KG_API + '/addNode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin' },
          body: JSON.stringify({
            graphId: GRAPH_ID,
            node: {
              id: nodeId,
              label: name,
              type: 'css-node',
              info: css,
              metadata: { priority: 100, appliesTo: ['*'] }
            }
          })
        });
        if (!res.ok) throw new Error(await res.text());
        statusEl.textContent = 'Created!';
        statusEl.className = 'save-status ok';
        document.getElementById('newThemeModal').classList.remove('active');
        await reload();
      } catch (e) {
        statusEl.textContent = 'Error: ' + e.message;
        statusEl.className = 'save-status err';
      }
    }

    // ---- Copy CSS ----
    document.getElementById('btnCopyCss').addEventListener('click', async function() {
      var css = document.getElementById('cssOutput').textContent;
      var el = document.getElementById('copyStatus');
      try { await navigator.clipboard.writeText(css); el.textContent = 'Copied!'; el.className = 'save-status ok'; }
      catch(e) { el.textContent = 'Copy failed'; el.className = 'save-status err'; }
      setTimeout(function() { el.textContent = ''; }, 2000);
    });

    // ---- Events ----
    document.getElementById('btnToggleView').addEventListener('click', toggleView);
    document.getElementById('btnHeroEdit').addEventListener('click', toggleView);
    document.getElementById('btnNewTheme').addEventListener('click', function() {
      document.getElementById('newThemeModal').classList.add('active');
      document.getElementById('newThemeStatus').textContent = '';
    });
    document.getElementById('btnCancelNew').addEventListener('click', function() {
      document.getElementById('newThemeModal').classList.remove('active');
    });
    document.getElementById('btnConfirmNew').addEventListener('click', createTheme);

    // ---- Reload ----
    async function reload() {
      document.getElementById('loadingState').style.display = '';
      document.getElementById('showcaseView').style.display = 'none';
      document.getElementById('editorView').style.display = 'none';
      await loadGraph();
      document.getElementById('loadingState').style.display = 'none';
      if (currentView === 'showcase') {
        document.getElementById('showcaseView').style.display = '';
        renderShowcase();
      } else {
        document.getElementById('editorView').style.display = '';
        renderEditor();
      }
    }

    // ---- Init ----
    async function init() {
      try {
        await loadGraph();
        document.getElementById('loadingState').style.display = 'none';
        document.getElementById('showcaseView').style.display = '';
        renderShowcase();
      } catch (e) {
        document.getElementById('loadingState').innerHTML = '<p>Error: ' + escapeHtml(e.message) + '</p>';
      }
    }
    init();
  </script>
</body>
</html>`;
