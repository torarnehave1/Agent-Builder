/**
 * Landing Page Template for Vegvisr Agent Builder
 *
 * Single-page layout that renders ALL graph nodes as scrollable sections.
 * Superadmin users can edit each section inline (textarea + save to KG API).
 *
 * Placeholders:
 *   {{TITLE}}            - Page title (hero section)
 *   {{DESCRIPTION}}      - Subtitle/tagline
 *   {{FOOTER_TEXT}}      - Footer text
 *   {{GRAPH_ID_DEFAULT}} - Fallback graph ID
 */

export const LANDING_PAGE_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <meta name="template-version" content="1.5.0" />
  <meta name="template-id" content="landing-page" />
  <title>{{TITLE}}</title>

  <!-- Marked for Markdown rendering -->
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>
  <!-- Mermaid for diagrams -->
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"><\/script>

  <style>
/* Theme variables — overridden by injected <style data-vegvisr-theme> */
    :root {
      --bg1: #0b1220;
      --bg2: #111827;
      --text: #fff;
      --muted: rgba(255,255,255,0.72);
      --soft: rgba(255,255,255,0.58);
      --accent: #38bdf8;
      --accent2: #8b5cf6;
      --card-bg: rgba(255,255,255,0.06);
      --card-border: rgba(255,255,255,0.12);
      --line: rgba(255,255,255,0.12);
      --radius: 14px;
    }

/* Page background */
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Apple Color Emoji", "Segoe UI Emoji";
      color: var(--text);
      background-color: var(--bg1);
      background-image:
        radial-gradient(circle at top, color-mix(in srgb, var(--accent) 20%, transparent), transparent 55%),
        radial-gradient(circle at bottom, color-mix(in srgb, var(--accent2) 18%, transparent), transparent 55%);
      min-height: 100vh;
      scroll-behavior: smooth;
    }

    .hidden { display: none !important; }

/* Hero Section */
    .landing-hero {
      position: relative;
      padding: 80px 24px 60px;
      text-align: center;
      background-size: cover;
      background-position: center;
      overflow: hidden;
    }
    .landing-hero::before {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(180deg, rgba(0,0,0,0.3) 0%, transparent 100%);
      z-index: 1;
    }
    .landing-hero h1 {
      position: relative;
      z-index: 2;
      font-size: 2.8rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin: 0 0 12px;
      color: var(--text);
    }
    .landing-hero p {
      position: relative;
      z-index: 2;
      font-size: 1.15rem;
      color: var(--muted);
      margin: 0;
      max-width: 640px;
      margin: 0 auto;
      line-height: 1.6;
    }

    @media (max-width: 600px) {
      .landing-hero { padding: 48px 16px 36px; }
      .landing-hero h1 { font-size: 1.8rem; }
      .landing-hero p { font-size: 1rem; }
    }

/* Sticky Navigation */
    .landing-nav {
      position: sticky;
      top: 0;
      z-index: 100;
      background-color: var(--bg1);
      opacity: 0.97;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      padding: 10px 16px;
    }
    .nav-links {
      display: flex;
      justify-content: center;
      gap: 4px;
      flex: 1;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }
    .nav-links::-webkit-scrollbar { height: 4px; }
    .nav-links::-webkit-scrollbar-track { background: transparent; }
    .nav-links::-webkit-scrollbar-thumb { background: var(--line); border-radius: 4px; }
    .nav-auth {
      display: flex;
      gap: 6px;
      margin-left: 12px;
      flex-shrink: 0;
    }
    .nav-login-btn, .nav-logout-btn {
      padding: 6px 14px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: transparent;
      color: var(--muted);
      font-size: 13px;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s;
    }
    .nav-login-btn:hover, .nav-logout-btn:hover {
      background: var(--card-bg);
      color: var(--text);
    }
    .nav-login-btn.logged-in {
      cursor: default;
      max-width: 180px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .landing-nav a {
      padding: 6px 14px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: transparent;
      color: var(--muted);
      font-size: 13px;
      text-decoration: none;
      white-space: nowrap;
      transition: all 0.15s;
      flex-shrink: 0;
    }
    .landing-nav a:hover {
      background: var(--card-bg);
      color: var(--text);
    }
    .landing-nav a.active {
      background: color-mix(in srgb, var(--accent) 16%, transparent);
      border-color: color-mix(in srgb, var(--accent) 40%, transparent);
      color: var(--text);
    }

/* Main Content */
    .landing-sections {
      max-width: 1100px;
      margin: 0 auto;
      padding: 32px 16px 60px;
    }

/* Individual Section */
    .landing-section {
      margin-bottom: 48px;
      scroll-margin-top: 60px;
    }
    .landing-section-title {
      font-size: 1.6rem;
      font-weight: 600;
      color: var(--text);
      margin: 0 0 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .landing-section-content {
      line-height: 1.65;
      color: var(--muted);
    }

/* Markdown content styles */
    .landing-section-content h1, .landing-section-content h2, .landing-section-content h3 { margin: 0.6em 0 0.4em; color: var(--text); }
    .landing-section-content p { margin: 0.6em 0; line-height: 1.55; }
    .landing-section-content a { color: color-mix(in srgb, var(--accent) 95%, white); }
    .landing-section-content hr { border: none; border-top: 1px solid var(--line); margin: 14px 0; }
    .landing-section-content img { max-width: 100%; border-radius: 12px; border: 1px solid var(--line); }
    .landing-section-content blockquote {
      border-left: 4px solid var(--line);
      padding-left: 12px;
      margin: 12px 0;
      color: var(--muted);
    }
    .landing-section-content table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0;
      overflow: hidden;
      border-radius: 12px;
      border: 1px solid var(--line);
    }
    .landing-section-content th, .landing-section-content td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
      color: var(--text);
    }
    .landing-section-content th { background: var(--card-bg); text-align: left; color: var(--text); }
    .landing-section-content ul, .landing-section-content ol { margin: 0.6em 0; padding-left: 1.5em; }
    .landing-section-content li { margin: 0.3em 0; line-height: 1.5; }
    .landing-section-content code {
      background: rgba(0,0,0,0.3);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.9em;
      color: color-mix(in srgb, var(--accent) 95%, white);
    }
    .landing-section-content pre {
      background: rgba(0,0,0,0.3);
      padding: 12px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 10px 0;
    }
    .landing-section-content pre code {
      background: none;
      padding: 0;
    }

/* Vegvisr special element styles */
    .work-note {
      background-color: #ffd580;
      color: #333;
      font-size: 14px;
      font-family: 'Courier New', Courier, monospace;
      font-weight: bold;
      padding: 10px;
      margin: 10px 0;
      border-left: 5px solid #ccc;
      border-radius: 4px;
    }
    .work-note cite {
      display: block;
      text-align: right;
      font-style: normal;
      color: #666;
      margin-top: 0.5em;
    }
    .fancy-quote {
      font-style: italic;
      background-color: #f9f9f9;
      border-left: 5px solid #ccc;
      font-size: 1.2em;
      padding: 1em;
      margin: 1em 0;
      color: #333;
      font-family: Arial, Helvetica, sans-serif;
      border-radius: 8px;
    }
    .fancy-quote cite {
      display: block;
      text-align: right;
      font-style: normal;
      color: #666;
      margin-top: 0.5em;
    }
    .section {
      padding: 15px;
      margin: 15px 0;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      box-sizing: border-box;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.10);
      color: rgba(255,255,255,0.85);
    }
    .fancy-title {
      background-size: cover;
      background-position: center;
      display: flex;
      align-items: center;
      justify-content: center;
      text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.7);
      font-weight: bold;
      border-radius: 8px;
      overflow: hidden;
      min-height: 120px;
      padding: 20px;
    }
    .imagequote-element {
      margin: 2em 0;
      border-radius: 12px;
      min-height: 200px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      text-align: center;
      position: relative;
      overflow: hidden;
      color: white;
      text-shadow: 0 2px 4px rgba(0, 0, 0, 0.7);
      background-size: cover;
      background-position: center;
    }
    .imagequote-element::before {
      content: '';
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.3);
      z-index: 1;
    }
    .imagequote-content {
      position: relative;
      z-index: 2;
      font-size: 1.5rem;
      font-weight: 600;
      line-height: 1.4;
      max-width: 80%;
    }
    .imagequote-citation {
      position: relative;
      z-index: 2;
      margin-top: 1em;
      font-size: 1rem;
      font-style: italic;
      opacity: 0.9;
    }

/* YouTube embed */
    .youtube-embed-container {
      position: relative;
      width: 100%;
      padding-bottom: 56.25%;
      height: 0;
      overflow: hidden;
      border-radius: 12px;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .youtube-embed-container iframe {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      border: none;
      border-radius: 12px;
    }

/* Flexbox Cards */
    .flexbox-cards-container {
      display: flex;
      flex-wrap: wrap;
      gap: 20px;
      justify-content: center;
      margin: 25px 0;
      padding: 0;
    }
    .flexbox-card {
      box-sizing: border-box;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: var(--radius);
      padding: 20px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .flexbox-card:hover {
      transform: translateY(-5px);
      box-shadow: 0 8px 25px rgba(0,0,0,0.25);
    }
    .flexbox-card .card-image {
      width: 100%;
      margin-bottom: 15px;
      border-radius: 8px;
      overflow: hidden;
    }
    .landing-section-content .flexbox-card .card-image img,
    .flexbox-card .card-image img {
      width: 100%;
      height: 200px;
      object-fit: cover;
      border-radius: 8px;
      border: none;
      display: block;
    }
    .flexbox-card .card-title {
      font-size: 1.2rem;
      font-weight: 600;
      color: var(--text);
      margin: 0 0 12px;
      line-height: 1.3;
    }
    .flexbox-card .card-text {
      color: var(--muted);
      line-height: 1.6;
      font-size: 0.95rem;
      text-align: left;
      flex-grow: 1;
    }
    /* Column widths */
    .flexbox-cards-2 .flexbox-card { flex: 0 1 calc(50% - 20px); max-width: calc(50% - 20px); }
    .flexbox-cards-3 .flexbox-card { flex: 0 1 calc(33.333% - 20px); max-width: calc(33.333% - 20px); }
    .flexbox-cards-4 .flexbox-card { flex: 0 1 calc(25% - 20px); max-width: calc(25% - 20px); }
    @media (max-width: 768px) {
      .flexbox-cards-3 .flexbox-card,
      .flexbox-cards-4 .flexbox-card { flex: 0 1 calc(50% - 15px); max-width: calc(50% - 15px); }
    }
    @media (max-width: 480px) {
      .flexbox-cards-2 .flexbox-card,
      .flexbox-cards-3 .flexbox-card,
      .flexbox-cards-4 .flexbox-card { flex: 0 1 100%; max-width: 100%; }
    }

    /* Flexbox Grid */
    .flexbox-grid-container {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin: 25px 0;
    }
    .flexbox-grid-container img {
      width: 100%;
      height: 200px;
      object-fit: cover;
      border-radius: var(--radius);
      border: 1px solid var(--card-border);
    }
    @media (max-width: 768px) {
      .flexbox-grid-container { grid-template-columns: repeat(2, 1fr); }
    }
    @media (max-width: 480px) {
      .flexbox-grid-container { grid-template-columns: 1fr; }
    }

    /* Flexbox Gallery */
    .flexbox-gallery-container {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      justify-content: center;
      margin: 25px 0;
    }
    .flexbox-gallery-container img {
      height: 180px;
      object-fit: cover;
      border-radius: var(--radius);
      border: 1px solid var(--card-border);
      transition: transform 0.2s;
    }
    .flexbox-gallery-container img:hover {
      transform: scale(1.05);
    }

/* Mermaid diagram container */
    .landing-mermaid {
      display: flex;
      justify-content: center;
      padding: 16px 0;
      overflow-x: auto;
    }
    .landing-mermaid svg {
      max-width: 100%;
      height: auto;
    }

/* Footer */
    .landing-footer {
      text-align: center;
      padding: 32px 16px;
      border-top: 1px solid var(--line);
      color: var(--soft);
      font-size: 0.875rem;
    }

/* Loading state */
    .landing-loading {
      text-align: center;
      padding: 60px 20px;
      color: var(--muted);
      font-size: 1rem;
    }
    .landing-loading .spinner {
      display: inline-block;
      width: 28px;
      height: 28px;
      border: 3px solid var(--line);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-bottom: 12px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

/* Error state */
    .landing-error {
      text-align: center;
      padding: 40px 20px;
      color: #ef4444;
    }

/* Section Edit Mode */
    .section-edit-btn {
      display: none;
      background: none;
      border: 1px solid var(--line);
      color: var(--muted);
      font-size: 14px;
      padding: 4px 10px;
      border-radius: 6px;
      cursor: pointer;
      margin-left: 12px;
      vertical-align: middle;
      transition: all 0.15s;
      flex-shrink: 0;
    }
    .section-edit-btn:hover {
      background: var(--card-bg);
      color: var(--text);
      border-color: color-mix(in srgb, var(--accent) 40%, transparent);
    }
    body.landing-admin .section-edit-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .section-edit-textarea {
      width: 100%;
      padding: 12px 14px;
      background: rgba(139, 92, 246, 0.1);
      border: 1px solid rgba(139, 92, 246, 0.3);
      border-radius: 8px;
      color: #fff;
      font-size: 0.95rem;
      font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
      box-sizing: border-box;
      min-height: 200px;
      resize: vertical;
      line-height: 1.5;
    }
    .section-edit-textarea:focus {
      outline: none;
      border-color: rgba(139, 92, 246, 0.6);
      box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.15);
    }
    .section-edit-actions {
      display: flex;
      gap: 8px;
      margin-top: 10px;
      align-items: center;
    }
    .section-edit-actions button {
      padding: 8px 18px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid var(--line);
      transition: all 0.15s;
    }
    .section-save-btn {
      background: color-mix(in srgb, var(--accent) 16%, transparent);
      border-color: color-mix(in srgb, var(--accent) 40%, transparent);
      color: var(--text);
    }
    .section-save-btn:hover {
      background: color-mix(in srgb, var(--accent) 24%, transparent);
    }
    .section-save-btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    .section-cancel-btn {
      background: var(--card-bg);
      color: var(--muted);
    }
    .section-cancel-btn:hover {
      background: color-mix(in srgb, var(--card-bg) 60%, var(--text) 10%);
      color: var(--text);
    }
    .section-edit-status {
      font-size: 13px;
      color: var(--muted);
      margin-left: 8px;
    }
    .section-edit-status.error { color: #ef4444; }
    .section-edit-status.saved { color: #22c55e; }

/* Login Modal */
    .login-modal-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }
    .login-modal {
      background: color-mix(in srgb, var(--bg1) 95%, var(--text) 5%);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 32px;
      max-width: 400px;
      width: 90%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }
    .login-modal h2 { margin: 0 0 8px; font-size: 1.5rem; color: var(--text); }
    .login-modal p { color: var(--muted); margin: 0 0 20px; font-size: 0.95rem; line-height: 1.5; }
    .login-modal .form-group { margin-bottom: 16px; }
    .login-modal label { display: block; margin-bottom: 6px; color: var(--text); font-size: 0.9rem; }
    .login-modal input {
      width: 100%;
      padding: 12px 14px;
      background: rgba(0,0,0,0.3);
      border: 1px solid var(--line);
      border-radius: 8px;
      color: var(--text);
      font-size: 1rem;
      box-sizing: border-box;
    }
    .login-modal input:focus {
      outline: none;
      border-color: color-mix(in srgb, var(--accent) 50%, transparent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent);
    }
    .login-modal .btn-group { display: flex; gap: 10px; margin-top: 20px; }
    .login-modal .btn-primary {
      flex: 1;
      padding: 12px 20px;
      background: color-mix(in srgb, var(--accent) 20%, transparent);
      border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
      border-radius: 8px;
      color: var(--text);
      font-size: 1rem;
      cursor: pointer;
    }
    .login-modal .btn-primary:hover { background: color-mix(in srgb, var(--accent) 30%, transparent); }
    .login-modal .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .login-modal .btn-secondary {
      padding: 12px 20px;
      background: var(--card-bg);
      border: 1px solid var(--line);
      border-radius: 8px;
      color: var(--text);
      font-size: 1rem;
      cursor: pointer;
    }
    .login-modal .btn-secondary:hover { background: color-mix(in srgb, var(--card-bg) 60%, var(--text) 10%); }
    .login-status {
      margin-top: 12px;
      padding: 10px;
      border-radius: 8px;
      font-size: 0.9rem;
    }
    .login-status.info { background: color-mix(in srgb, var(--accent) 10%, transparent); border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent); color: var(--text); }
    .login-status.success { background: rgba(74,222,128,0.1); border: 1px solid rgba(74,222,128,0.25); color: #4ade80; }
    .login-status.error { background: rgba(248,113,113,0.1); border: 1px solid rgba(248,113,113,0.25); color: #f87171; }
    .hidden { display: none !important; }

/* Theme Picker */
    .theme-picker-btn {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 9990;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      border: 1px solid var(--line);
      background: var(--card-bg);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      color: var(--text);
      font-size: 22px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      transition: transform 0.15s, box-shadow 0.15s;
    }
    .theme-picker-btn:hover {
      transform: scale(1.08);
      box-shadow: 0 6px 28px rgba(0,0,0,0.4);
    }
    .theme-picker-panel {
      position: fixed;
      bottom: 80px;
      right: 20px;
      z-index: 9991;
      width: 380px;
      max-height: 520px;
      border-radius: 16px;
      border: 1px solid var(--line);
      background: color-mix(in srgb, var(--bg1) 85%, black);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      box-shadow: 0 12px 48px rgba(0,0,0,0.5);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .theme-picker-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
      font-weight: 600;
      font-size: 14px;
    }
    .theme-picker-header button {
      background: none;
      border: none;
      color: var(--muted);
      font-size: 18px;
      cursor: pointer;
    }
    .theme-picker-tabs {
      display: flex;
      gap: 4px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--line);
      overflow-x: auto;
    }
    .theme-picker-tab {
      padding: 6px 12px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: transparent;
      color: var(--muted);
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s;
    }
    .theme-picker-tab:hover { background: var(--card-bg); }
    .theme-picker-tab.active {
      background: color-mix(in srgb, var(--accent) 16%, transparent);
      border-color: color-mix(in srgb, var(--accent) 40%, transparent);
      color: var(--text);
    }
    .theme-picker-grid {
      padding: 12px;
      overflow-y: auto;
      flex: 1;
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;
    }
    .theme-picker-card {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid var(--line);
      background: transparent;
      cursor: pointer;
      transition: all 0.15s;
    }
    .theme-picker-card:hover {
      background: var(--card-bg);
      border-color: color-mix(in srgb, var(--accent) 30%, transparent);
    }
    .theme-picker-card.active {
      background: color-mix(in srgb, var(--accent) 12%, transparent);
      border-color: color-mix(in srgb, var(--accent) 50%, transparent);
    }
    .theme-picker-swatches {
      display: flex;
      gap: 3px;
      flex-shrink: 0;
    }
    .theme-picker-swatches span {
      width: 18px;
      height: 18px;
      border-radius: 4px;
      border: 1px solid rgba(128,128,128,0.3);
    }
    .theme-picker-card-label {
      font-size: 13px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .theme-picker-loading {
      padding: 24px;
      text-align: center;
      color: var(--muted);
      font-size: 13px;
    }

    @media (max-width: 480px) {
      .theme-picker-panel { width: calc(100vw - 32px); right: 16px; }
    }

  </style>
</head>

<body>

  <!-- Hero Section -->
  <header class="landing-hero" id="heroSection">
  </header>

  <!-- Sticky Navigation -->
  <nav id="landingNav" class="landing-nav">
    <div id="navLinks" class="nav-links"></div>
    <div class="nav-auth">
      <button type="button" id="btnLogin" class="nav-login-btn">Login</button>
      <button type="button" id="btnLogout" class="nav-logout-btn hidden">Logout</button>
    </div>
  </nav>

  <!-- Login Modal -->
  <div id="loginModal" class="login-modal-overlay hidden">
    <div class="login-modal">
      <h2>Login</h2>
      <p>Enter your email address to receive a magic link.</p>
      <div id="loginEmailSection">
        <div class="form-group">
          <label for="loginEmail">Email Address</label>
          <input type="email" id="loginEmail" placeholder="your@email.com" autocomplete="email">
        </div>
        <div class="btn-group">
          <button type="button" id="btnSendMagicLink" class="btn-primary">Send Magic Link</button>
          <button type="button" id="btnCancelLogin" class="btn-secondary">Cancel</button>
        </div>
      </div>
      <div id="loginCheckSection" class="hidden">
        <p style="margin-bottom:16px;">A magic link has been sent to <strong id="sentToEmail"></strong>. Check your email and click the link.</p>
        <div class="btn-group">
          <button type="button" id="btnResendLink" class="btn-secondary">Resend Link</button>
          <button type="button" id="btnBackToEmail" class="btn-secondary">Use Different Email</button>
        </div>
      </div>
      <div id="loginStatus" class="login-status hidden"></div>
    </div>
  </div>

  <!-- Content Sections -->
  <main id="landingSections" class="landing-sections">
    <div class="landing-loading">
      <div class="spinner"></div>
      <div>Loading content...</div>
    </div>
  </main>

  <!-- Footer -->
  <footer class="landing-footer" id="landingFooter">{{FOOTER_TEXT}}</footer>

  <!-- Theme Picker -->
  <button id="btnThemePicker" class="theme-picker-btn" title="Change theme">🎨</button>
  <div id="themePickerPanel" class="theme-picker-panel hidden">
    <div class="theme-picker-header">
      <span>Theme Catalog</span>
      <button id="btnCloseThemePicker">✕</button>
    </div>
    <div id="themePickerTabs" class="theme-picker-tabs"></div>
    <div id="themePickerGrid" class="theme-picker-grid"></div>
  </div>

  <script>
    // ========== CONSTANTS ==========
    var GRAPH_ID = '{{GRAPH_ID_DEFAULT}}';
    var NODE_ID = '{{NODE_ID}}';
    var KG_API = 'https://knowledge.vegvisr.org';
    var LABEL_CONTAINS = '#';

    // Initialize Mermaid
    mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose', logLevel: 'error' });

    // ========== UTILITY FUNCTIONS ==========

    function normalizeStr(x) {
      return String(x ?? '');
    }

    function escapeHtml(str) {
      if (typeof str !== 'string') return '';
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function nodeMatches(n) {
      var label = normalizeStr(n && n.label);
      return label.toLowerCase().includes(LABEL_CONTAINS.toLowerCase());
    }

    // ========== CONTENT RENDERER ==========
    // Handles FLEXBOX blocks on raw content BEFORE marked.parse(),
    // then runs marked + Vegvisr element parsing on the rest.
    function renderContent(raw) {
      // Extract FLEXBOX blocks before markdown processing.
      // ALL string-based — no regex — to avoid template-literal escaping nightmares.
      var parts = [];
      var remaining = raw;

      while (true) {
        // Find earliest [FLEXBOX- marker (case-insensitive)
        var lower = remaining.toLowerCase();
        var startIdx = -1;
        var markers = ['[flexbox-cards', '[flexbox-grid', '[flexbox-gallery'];
        for (var m = 0; m < markers.length; m++) {
          var pos = lower.indexOf(markers[m]);
          if (pos !== -1 && (startIdx === -1 || pos < startIdx)) startIdx = pos;
        }
        if (startIdx === -1) break;

        // Find the closing ] of the opening tag
        var tagEnd = remaining.indexOf(']', startIdx);
        if (tagEnd === -1) break;

        // Find the closing [END FLEXBOX] tag (case-insensitive)
        var endTag = lower.indexOf('[end flexbox]', tagEnd);
        if (endTag === -1) break;
        var endTagEnd = remaining.indexOf(']', endTag) + 1;

        // Text before FLEXBOX block — run through markdown + Vegvisr parser
        var before = remaining.slice(0, startIdx);
        if (before.trim()) {
          parts.push(parseVegvisrElements(marked.parse(before)));
        }

        // Extract type from the opening tag (e.g. "FLEXBOX-CARDS-3" → "CARDS-3")
        var openTag = remaining.slice(startIdx + 1, tagEnd).toUpperCase();
        var flexType = openTag.indexOf('FLEXBOX-') === 0 ? openTag.slice(8) : 'CARDS';

        // Extract content between opening and closing tags
        var innerContent = remaining.slice(tagEnd + 1, endTag);

        // Render the FLEXBOX block
        parts.push(renderFlexboxBlock(flexType, innerContent));

        remaining = remaining.slice(endTagEnd);
      }

      // Remaining text after last FLEXBOX block
      if (remaining.trim()) {
        parts.push(parseVegvisrElements(marked.parse(remaining)));
      }
      return parts.join('');
    }

    function renderFlexboxBlock(type, content) {
      var upperType = type.toUpperCase();

      // FLEXBOX-CARDS or FLEXBOX-CARDS-N
      if (upperType.indexOf('CARDS') === 0) {
        var colNum = upperType.replace('CARDS', '').replace('-', '');
        var colCount = colNum ? parseInt(colNum) : 3;
        var lines = content.trim().split('\\n');
        var cards = [];
        var cur = null;
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line) continue;

          // Check for **title** pattern
          if (line.indexOf('**') === 0 && line.lastIndexOf('**') === line.length - 2 && line.length > 4) {
            if (cur && (cur.title || cur.image || cur.text)) cards.push(cur);
            cur = { title: line.slice(2, -2), image: '', text: '' };
            continue;
          }
          // Check for ![alt](url) image pattern
          if (line.indexOf('![') === 0 && cur) {
            var closeBracket = line.indexOf('](');
            var closeParen = line.lastIndexOf(')');
            if (closeBracket > 0 && closeParen > closeBracket) {
              var imgUrl = line.slice(closeBracket + 2, closeParen);
              var imgAlt = line.slice(2, closeBracket).split('|')[0].trim();
              cur.image = '<div class="card-image"><img src="' + imgUrl + '" alt="' + imgAlt + '"></div>';
              continue;
            }
          }
          // Everything else is text
          if (line && cur) {
            cur.text += (cur.text ? ' ' : '') + line;
          }
        }
        if (cur && (cur.title || cur.image || cur.text)) cards.push(cur);

        var out = '<div class="flexbox-cards-container flexbox-cards-' + colCount + '">';
        for (var c = 0; c < cards.length; c++) {
          out += '<div class="flexbox-card">';
          if (cards[c].image) out += cards[c].image;
          if (cards[c].title) out += '<div class="card-title">' + cards[c].title + '</div>';
          if (cards[c].text) out += '<div class="card-text">' + cards[c].text + '</div>';
          out += '</div>';
        }
        out += '</div>';
        return out;
      }

      // FLEXBOX-GRID or FLEXBOX-GALLERY
      var isGallery = (upperType === 'GALLERY');
      var containerClass = isGallery ? 'flexbox-gallery-container' : 'flexbox-grid-container';
      var images = [];
      var imgLines = content.split('\\n');
      for (var j = 0; j < imgLines.length; j++) {
        var imgLine = imgLines[j].trim();
        if (imgLine.indexOf('![') !== 0) continue;
        var cb = imgLine.indexOf('](');
        var cp = imgLine.lastIndexOf(')');
        if (cb > 0 && cp > cb) {
          images.push('<img src="' + imgLine.slice(cb + 2, cp) + '" alt="' + imgLine.slice(2, cb) + '">');
        }
      }
      return '<div class="' + containerClass + '">' + images.join('') + '</div>';
    }

    // ========== VEGVISR ELEMENT PARSER ==========
    function parseVegvisrElements(html) {
      // Work notes
      html = html.replace(/\\[WNOTE\\s*\\|([^\\]]*)\\]([\\s\\S]*?)\\[END\\s+WNOTE\\]/gi, function(m, params, content) {
        var cited = (params.match(/Cited\\s*=\\s*['"]?([^'"\\];]+)/i) || [])[1] || '';
        return '<div class="work-note">' + marked.parse(content.trim()) + (cited ? '<cite>\\u2014 ' + cited + '</cite>' : '') + '</div>';
      });
      // Quotes
      html = html.replace(/\\[QUOTE\\s*\\|([^\\]]*)\\]([\\s\\S]*?)\\[END\\s+QUOTE\\]/gi, function(m, params, content) {
        var cited = (params.match(/Cited\\s*=\\s*['"]?([^'"\\];]+)/i) || [])[1] || '';
        return '<div class="fancy-quote">' + marked.parse(content.trim()) + (cited ? '<cite>\\u2014 ' + cited + '</cite>' : '') + '</div>';
      });
      // Sections
      html = html.replace(/\\[SECTION\\s*\\|([^\\]]*)\\]([\\s\\S]*?)\\[END\\s+SECTION\\]/gi, function(m, style, content) {
        return '<div class="section" style="' + style + '">' + marked.parse(content.trim()) + '</div>';
      });
      // Fancy titles
      html = html.replace(/\\[FANCY\\s*\\|([^\\]]*)\\]([\\s\\S]*?)\\[END\\s+FANCY\\]/gi, function(m, params, content) {
        var bgMatch = params.match(/background\\s*=\\s*['"]?([^'"\\];]+)/i);
        var bg = bgMatch ? bgMatch[1] : '';
        var style = bg ? "background-image: url('" + bg + "');" : '';
        return '<div class="fancy-title" style="' + style + '">' + marked.parse(content.trim()) + '</div>';
      });
      // Image quotes
      html = html.replace(/\\[IMAGEQUOTE\\s*\\|([^\\]]*)\\]([\\s\\S]*?)\\[END\\s+IMAGEQUOTE\\]/gi, function(m, params, content) {
        var bgMatch = params.match(/background\\s*=\\s*['"]?([^'"\\];]+)/i);
        var citedMatch = params.match(/Cited\\s*=\\s*['"]?([^'"\\];]+)/i);
        var bg = bgMatch ? bgMatch[1] : '';
        var cited = citedMatch ? citedMatch[1] : '';
        var style = bg ? "background-image: url('" + bg + "');" : '';
        return '<div class="imagequote-element" style="' + style + '"><div class="imagequote-content">' + marked.parse(content.trim()) + '</div>' + (cited ? '<div class="imagequote-citation">\\u2014 ' + cited + '</div>' : '') + '</div>';
      });
      // Images
      html = html.replace(/\\[IMAGE\\]\\(([^\\)]+)\\)/gi, function(m, url) {
        return '<img src="' + url + '" alt="Image" style="max-width: 100%; border-radius: 12px; border: 1px solid rgba(255,255,255,0.10); margin: 16px 0;" />';
      });

      return html;
    }

    // ========== YOUTUBE FUNCTIONS ==========
    function extractYouTubeVideoId(url) {
      if (!url || typeof url !== 'string') return null;
      var patterns = [
        /youtu\\.be\\/([a-zA-Z0-9_-]{11})/,
        /youtube\\.com\\/watch\\?v=([a-zA-Z0-9_-]{11})/,
        /youtube\\.com\\/embed\\/([a-zA-Z0-9_-]{11})/,
        /youtube\\.com\\/v\\/([a-zA-Z0-9_-]{11})/,
        /youtube\\.com\\/shorts\\/([a-zA-Z0-9_-]{11})/,
        /^([a-zA-Z0-9_-]{11})$/
      ];
      for (var i = 0; i < patterns.length; i++) {
        var match = url.match(patterns[i]);
        if (match && match[1]) return match[1];
      }
      return null;
    }

    function getYouTubeUrlFromNode(node) {
      if (!node) return null;
      if (node.path) {
        var videoId = extractYouTubeVideoId(node.path);
        if (videoId) return { url: node.path, videoId: videoId };
      }
      if (Array.isArray(node.bibl)) {
        for (var i = 0; i < node.bibl.length; i++) {
          var vid = extractYouTubeVideoId(node.bibl[i]);
          if (vid) return { url: node.bibl[i], videoId: vid };
        }
      }
      if (node.info && typeof node.info === 'string') {
        var urlMatch = node.info.match(/https?:\\/\\/(?:www\\.)?(?:youtube\\.com|youtu\\.be)[^\\s"'<>]+/i);
        if (urlMatch) {
          var vid2 = extractYouTubeVideoId(urlMatch[0]);
          if (vid2) return { url: urlMatch[0], videoId: vid2 };
        }
      }
      return null;
    }

    function isYouTubeNode(node) {
      if (!node) return false;
      var nodeType = (node.type || '').toLowerCase();
      if (nodeType === 'youtube-video' || nodeType === 'youtube' || nodeType === 'video') return true;
      var label = (node.label || '').toLowerCase();
      if (label.includes('youtube') || label.includes('video')) {
        if (getYouTubeUrlFromNode(node)) return true;
      }
      if (node.path && extractYouTubeVideoId(node.path)) return true;
      return false;
    }

    function renderYouTubeEmbed(node) {
      var videoData = getYouTubeUrlFromNode(node);
      if (!videoData || !videoData.videoId) return '';
      var embedUrl = 'https://www.youtube.com/embed/' + videoData.videoId + '?rel=0';
      return '<div class="youtube-embed-container"><iframe src="' + embedUrl + '" title="' + escapeHtml(node.label || 'YouTube Video') + '" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>';
    }

    // ========== LANDING PAGE LOGIC ==========

    var activeSectionIndex = -1;
    var sectionElements = [];
    var landingNodes = [];
    var currentUser = null;
    var authToken = null;

    function isSuperadmin() {
      if (!currentUser) return false;
      var role = currentUser.role || currentUser.userRole || currentUser.roles;
      if (typeof role === 'string') {
        return role.toLowerCase() === 'superadmin';
      }
      if (Array.isArray(role)) {
        for (var r = 0; r < role.length; r++) {
          var roleName = typeof role[r] === 'string' ? role[r] : (role[r].name || '');
          if (roleName.toLowerCase() === 'superadmin') return true;
        }
      }
      return false;
    }

    function loadUserFromStorage() {
      try {
        var keys = ['userStore', 'user', 'currentUser', 'auth', 'authUser'];
        for (var k = 0; k < keys.length; k++) {
          var stored = localStorage.getItem(keys[k]);
          if (stored) {
            try {
              var parsed = JSON.parse(stored);
              var u = parsed.user || parsed.currentUser || parsed;
              if (u && (u.role || u.userRole || u.roles || u.email)) {
                currentUser = u;
                authToken = parsed.token || parsed.accessToken || parsed.authToken || localStorage.getItem('token') || localStorage.getItem('authToken');
                return true;
              }
            } catch (e) { /* skip */ }
          }
        }
        for (var s = 0; s < keys.length; s++) {
          var sStored = sessionStorage.getItem(keys[s]);
          if (sStored) {
            try {
              var sp = JSON.parse(sStored);
              var su = sp.user || sp.currentUser || sp;
              if (su && (su.role || su.userRole || su.roles || su.email)) {
                currentUser = su;
                authToken = sp.token || sp.accessToken || sp.authToken || sessionStorage.getItem('token');
                return true;
              }
            } catch (e) { /* skip */ }
          }
        }
        if (window.__VEGVISR_USER) {
          currentUser = window.__VEGVISR_USER;
          authToken = window.__VEGVISR_TOKEN || window.__VEGVISR_STORAGE_TOKEN;
          return true;
        }
        var cookies = document.cookie.split(';');
        for (var c = 0; c < cookies.length; c++) {
          var cookie = cookies[c].trim();
          if (cookie.indexOf('token=') === 0 || cookie.indexOf('authToken=') === 0) {
            authToken = cookie.split('=')[1];
          }
        }
      } catch (e) {
        console.error('Error loading user from storage:', e);
      }
      return false;
    }

    async function loadLandingPage() {
      var sectionsContainer = document.getElementById('landingSections');

      // Load user auth
      loadUserFromStorage();

      try {
        // 1. Fetch graph
        var res = await fetch(KG_API + '/getknowgraph?id=' + encodeURIComponent(GRAPH_ID));
        if (!res.ok) throw new Error('Failed to fetch graph: ' + res.status);
        var data = await res.json();
        var allNodes = Array.isArray(data.nodes) ? data.nodes.slice() : [];

        // 2. Update page title from graph metadata
        var graphTitle = (data.metadata && data.metadata.title) || data.title || '';
        if (graphTitle) {
          document.title = graphTitle;
        }

        // 3. Find header image (markdown-image node)
        var imgNode = allNodes.find(function(n) { return n.type === 'markdown-image'; });
        if (imgNode) {
          var imgUrl = imgNode.path || '';
          if (!imgUrl && imgNode.info) {
            var imgMatch = imgNode.info.match(/!\\[[^\\]]*\\]\\(([^)]+)\\)/);
            if (imgMatch) imgUrl = imgMatch[1];
          }
          if (imgUrl) {
            var hero = document.getElementById('heroSection');
            hero.style.backgroundImage = "url('" + imgUrl + "')";
            hero.style.minHeight = '300px';
          }
        }

        // 4. Filter and sort content nodes
        var nodes = allNodes.filter(nodeMatches);
        nodes.sort(function(a, b) {
          var ao = Number.isFinite(+a.order) ? +a.order : Infinity;
          var bo = Number.isFinite(+b.order) ? +b.order : Infinity;
          if (ao !== bo) return ao - bo;
          return normalizeStr(a.label).localeCompare(normalizeStr(b.label));
        });

        if (nodes.length === 0) {
          sectionsContainer.innerHTML = '<div class="landing-error">No content nodes found in this graph.</div>';
          return;
        }

        // 5. Build navigation
        buildNav(nodes);

        // 6. Render all sections
        sectionsContainer.innerHTML = '';
        await renderSections(nodes, sectionsContainer);

        // 7. Set up scroll observer for active nav highlighting
        setupScrollObserver();

        // 8. Show edit buttons if Superadmin
        if (isSuperadmin()) {
          document.body.classList.add('landing-admin');
        }

      } catch (err) {
        console.error('Landing page load error:', err);
        sectionsContainer.innerHTML = '<div class="landing-error">Error loading content: ' + escapeHtml(err.message) + '</div>';
      }
    }

    function buildNav(nodes) {
      var navLinks = document.getElementById('navLinks');
      navLinks.innerHTML = '';
      for (var i = 0; i < nodes.length; i++) {
        var link = document.createElement('a');
        link.href = '#section-' + i;
        link.textContent = nodes[i].label.replace(/^#\\s*/, '');
        link.dataset.index = i;
        link.addEventListener('click', function(e) {
          e.preventDefault();
          var target = document.getElementById('section-' + this.dataset.index);
          if (target) target.scrollIntoView({ behavior: 'smooth' });
        });
        navLinks.appendChild(link);
      }
    }

    async function renderSections(nodes, container) {
      sectionElements = [];
      landingNodes = nodes;
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var section = document.createElement('section');
        section.id = 'section-' + i;
        section.className = 'landing-section';
        section.dataset.nodeId = node.id;
        section.dataset.nodeIndex = i;

        // Title row (flex: title text + edit button)
        var title = document.createElement('h2');
        title.className = 'landing-section-title';

        var titleText = document.createElement('span');
        titleText.textContent = node.label.replace(/^#\\s*/, '');
        title.appendChild(titleText);

        var editBtn = document.createElement('button');
        editBtn.className = 'section-edit-btn';
        editBtn.innerHTML = '&#9998; Edit';
        editBtn.dataset.sectionIndex = i;
        editBtn.addEventListener('click', (function(idx) {
          return function() { enterSectionEditMode(idx); };
        })(i));
        title.appendChild(editBtn);

        section.appendChild(title);

        // Content
        var content = document.createElement('div');
        content.className = 'landing-section-content';

        if (node.type === 'mermaid-diagram') {
          content.className += ' landing-mermaid';
          await renderMermaidInSection(content, node.info || '', i);
        } else if (isYouTubeNode(node)) {
          content.innerHTML = renderYouTubeEmbed(node);
        } else {
          var info = normalizeStr(node.info);
          if (info.trim()) {
            content.innerHTML = renderContent(info);
          } else {
            content.innerHTML = '<p style="color:var(--soft);">No content.</p>';
          }
        }

        section.appendChild(content);
        container.appendChild(section);
        sectionElements.push(section);
      }
    }

    async function renderMermaidInSection(container, code, index) {
      if (!code || !code.trim()) {
        container.innerHTML = '<p style="color:var(--soft);">Empty diagram.</p>';
        return;
      }
      try {
        var id = 'mermaid-landing-' + index + '-' + Math.random().toString(36).substr(2, 6);
        var result = await mermaid.render(id, code);
        container.innerHTML = result.svg;
      } catch (err) {
        console.error('Mermaid render error:', err);
        container.innerHTML = '<pre style="color:#ef4444; font-size:13px;">Mermaid error: ' + escapeHtml(err.message) + '</pre>';
      }
    }

    // ========== SCROLL OBSERVER ==========
    function setupScrollObserver() {
      if (!('IntersectionObserver' in window)) return;

      var observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (entry.isIntersecting) {
            var idx = sectionElements.indexOf(entry.target);
            if (idx !== -1 && idx !== activeSectionIndex) {
              activeSectionIndex = idx;
              updateNavActive(idx);
            }
          }
        });
      }, { rootMargin: '-60px 0px -60% 0px', threshold: 0 });

      sectionElements.forEach(function(el) { observer.observe(el); });
    }

    function updateNavActive(idx) {
      var links = document.querySelectorAll('#navLinks a');
      for (var i = 0; i < links.length; i++) {
        links[i].classList.toggle('active', i === idx);
      }
    }

    // ========== SECTION EDIT MODE ==========

    function enterSectionEditMode(sectionIndex) {
      var node = landingNodes[sectionIndex];
      if (!node) return;
      var section = sectionElements[sectionIndex];
      if (!section) return;
      var contentDiv = section.querySelector('.landing-section-content');
      if (!contentDiv) return;
      if (section.dataset.editing === 'true') return;
      section.dataset.editing = 'true';

      var originalHTML = contentDiv.innerHTML;
      var originalInfo = normalizeStr(node.info);
      var isMermaid = ((node.type || '').toLowerCase() === 'mermaid-diagram');

      // Build edit UI
      var editContainer = document.createElement('div');

      var textarea = document.createElement('textarea');
      textarea.className = 'section-edit-textarea';
      textarea.value = originalInfo;
      var lineCount = originalInfo.split('\\n').length;
      textarea.rows = Math.max(8, lineCount + 2);
      editContainer.appendChild(textarea);

      var actions = document.createElement('div');
      actions.className = 'section-edit-actions';

      var saveBtn = document.createElement('button');
      saveBtn.className = 'section-save-btn';
      saveBtn.textContent = 'Save';

      var cancelBtn = document.createElement('button');
      cancelBtn.className = 'section-cancel-btn';
      cancelBtn.textContent = 'Cancel';

      var statusSpan = document.createElement('span');
      statusSpan.className = 'section-edit-status';

      actions.appendChild(saveBtn);
      actions.appendChild(cancelBtn);
      actions.appendChild(statusSpan);
      editContainer.appendChild(actions);

      contentDiv.innerHTML = '';
      contentDiv.appendChild(editContainer);
      textarea.focus();

      var editBtn = section.querySelector('.section-edit-btn');
      if (editBtn) editBtn.style.display = 'none';

      saveBtn.addEventListener('click', function() {
        saveSectionContent(sectionIndex, textarea.value, statusSpan, saveBtn, cancelBtn, function() {
          node.info = textarea.value;
          exitSectionEditMode(sectionIndex, contentDiv, node, editBtn, isMermaid);
        });
      });

      cancelBtn.addEventListener('click', function() {
        contentDiv.innerHTML = originalHTML;
        section.dataset.editing = 'false';
        if (editBtn) editBtn.style.display = '';
      });
    }

    async function exitSectionEditMode(sectionIndex, contentDiv, node, editBtn, isMermaid) {
      contentDiv.innerHTML = '';
      contentDiv.className = 'landing-section-content';
      if (isMermaid) {
        contentDiv.className += ' landing-mermaid';
        await renderMermaidInSection(contentDiv, node.info || '', sectionIndex);
      } else if (isYouTubeNode(node)) {
        contentDiv.innerHTML = renderYouTubeEmbed(node);
      } else {
        var info = normalizeStr(node.info);
        if (info.trim()) {
          contentDiv.innerHTML = renderContent(info);
        } else {
          contentDiv.innerHTML = '<p style="color:var(--soft);">No content.</p>';
        }
      }
      var section = sectionElements[sectionIndex];
      if (section) section.dataset.editing = 'false';
      if (editBtn) editBtn.style.display = '';
    }

    async function saveSectionContent(sectionIndex, newContent, statusEl, saveBtn, cancelBtn, onSuccess) {
      var node = landingNodes[sectionIndex];
      if (!node || !node.id) {
        statusEl.textContent = 'Error: node has no ID';
        statusEl.className = 'section-edit-status error';
        return;
      }
      if (!isSuperadmin()) {
        statusEl.textContent = 'Only Superadmin can save.';
        statusEl.className = 'section-edit-status error';
        return;
      }
      saveBtn.disabled = true;
      cancelBtn.disabled = true;
      statusEl.textContent = 'Saving...';
      statusEl.className = 'section-edit-status';

      try {
        var patchRes = await fetch(KG_API + '/patchNode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin' },
          body: JSON.stringify({
            graphId: GRAPH_ID,
            nodeId: node.id,
            fields: { info: newContent }
          })
        });
        if (patchRes.ok) {
          statusEl.textContent = 'Saved!';
          statusEl.className = 'section-edit-status saved';
          setTimeout(function() { onSuccess(); }, 800);
        } else {
          var errText = '';
          try { var errData = await patchRes.json(); errText = errData.error || errData.message || ''; } catch(e) {}
          statusEl.textContent = 'Save failed: ' + (errText || patchRes.status);
          statusEl.className = 'section-edit-status error';
          saveBtn.disabled = false;
          cancelBtn.disabled = false;
        }
      } catch (err) {
        statusEl.textContent = 'Error: ' + err.message;
        statusEl.className = 'section-edit-status error';
        saveBtn.disabled = false;
        cancelBtn.disabled = false;
      }
    }

    // ========== THEME PICKER ==========
    (function() {
      var pickerBtn = document.getElementById('btnThemePicker');
      var pickerPanel = document.getElementById('themePickerPanel');
      var pickerClose = document.getElementById('btnCloseThemePicker');
      var pickerTabs = document.getElementById('themePickerTabs');
      var pickerGrid = document.getElementById('themePickerGrid');

      var catalogs = [];
      var catalogCache = {};
      var activeCatalogId = null;
      var panelOpen = false;
      var saving = false;

      function showToast(msg, ok) {
        var t = document.createElement('div');
        t.textContent = msg;
        t.style.cssText = 'position:fixed;bottom:20px;left:20px;padding:10px 18px;border-radius:8px;font-size:13px;z-index:10001;color:#fff;background:' + (ok ? 'rgba(34,197,94,0.9)' : 'rgba(239,68,68,0.9)') + ';box-shadow:0 4px 12px rgba(0,0,0,0.3);transition:opacity 0.3s';
        document.body.appendChild(t);
        setTimeout(function() { t.style.opacity = '0'; setTimeout(function() { t.remove(); }, 300); }, 2500);
      }

      async function persistThemeToNode(themeVars, themeId) {
        if (saving) return;
        saving = true;
        try {
          var graphId = GRAPH_ID;
          var nodeId = NODE_ID;
          if (!graphId) { showToast('No GRAPH_ID — cannot save', false); return; }
          showToast('Saving theme...', true);

          var res = await fetch(KG_API + '/getknowgraph?id=' + encodeURIComponent(graphId));
          if (!res.ok) { showToast('Failed to fetch graph', false); return; }
          var data = await res.json();
          var nodes = data.nodes || [];
          var targetNode = null;

          for (var i = 0; i < nodes.length; i++) {
            if (nodeId && nodes[i].id === nodeId) { targetNode = nodes[i]; break; }
          }
          if (!targetNode && !nodeId) {
            for (var j = 0; j < nodes.length; j++) {
              if (nodes[j].type === 'html-node' && nodes[j].info && nodes[j].info.indexOf(':root') !== -1) {
                targetNode = nodes[j]; break;
              }
            }
          }
          if (!targetNode) { showToast('Node not found in graph', false); return; }

          var html = targetNode.info || '';
          var rootBlock = buildRootBlock(themeVars);
          var replaced = html.replace(/:root\\s*\\{[^}]+\\}/, rootBlock);
          if (replaced === html) {
            replaced = html.replace('</style>', rootBlock + '\\n  </style>');
          }

          var themeStyle = '<style data-vegvisr-theme="' + (themeId || 'custom') + '">:root {\\n';
          var vkeys = Object.keys(themeVars);
          for (var k = 0; k < vkeys.length; k++) {
            themeStyle += '  ' + vkeys[k] + ': ' + themeVars[vkeys[k]] + ';\\n';
          }
          themeStyle += '}</style>';
          replaced = replaced.replace(/<style data-vegvisr-theme="[^"]*">:root\\s*\\{[^}]*\\}<\\/style>/g, '');
          replaced = replaced.replace('</head>', themeStyle + '\\n</head>');

          var patchRes = await fetch(KG_API + '/patchNode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin' },
            body: JSON.stringify({ graphId: graphId, nodeId: targetNode.id, fields: { info: replaced } })
          });
          if (patchRes.ok) {
            showToast('Theme saved!', true);
            if (window.parent && window.parent !== window) {
              window.parent.postMessage({ type: 'RELOAD_GRAPH' }, '*');
            }
          } else {
            showToast('Save failed: ' + patchRes.status, false);
          }
        } catch (e) {
          showToast('Error: ' + e.message, false);
        } finally {
          saving = false;
        }
      }

      function buildRootBlock(vars) {
        var css = ':root {\\n';
        var keys = Object.keys(vars);
        for (var i = 0; i < keys.length; i++) {
          css += '  ' + keys[i] + ': ' + vars[keys[i]] + ';\\n';
        }
        if (vars['--card'] && !vars['--card-bg']) {
          css += '  --card-bg: ' + vars['--card'] + ';\\n';
          css += '  --card-border: ' + vars['--card'] + ';\\n';
        }
        if (vars['--surface'] && !vars['--card-bg']) {
          css += '  --card-bg: ' + vars['--surface'] + ';\\n';
          css += '  --card-border: ' + vars['--surface'] + ';\\n';
        }
        if (vars['--muted'] && !vars['--soft']) {
          css += '  --soft: ' + vars['--muted'] + ';\\n';
        }
        css += '}';
        return css;
      }

      function parseCssVarsFromHtml(html) {
        var vars = {};
        var rootMatch = html.match(/:root\\s*\\{([^}]+)\\}/);
        if (!rootMatch) return vars;
        var re = /--([\\/\\w-]+)\\s*:\\s*([^;]+)/g;
        var m;
        while ((m = re.exec(rootMatch[1])) !== null) {
          vars['--' + m[1].trim()] = m[2].trim();
        }
        return vars;
      }

      function applyTokens(vars) {
        var root = document.documentElement;
        var keys = Object.keys(vars);
        for (var i = 0; i < keys.length; i++) {
          root.style.setProperty(keys[i], vars[keys[i]]);
        }
        // Map --card / --surface to --card-bg and --card-border
        if (vars['--card'] && !vars['--card-bg']) {
          root.style.setProperty('--card-bg', vars['--card']);
          root.style.setProperty('--card-border', vars['--card']);
        }
        if (vars['--surface'] && !vars['--card-bg']) {
          root.style.setProperty('--card-bg', vars['--surface']);
          root.style.setProperty('--card-border', vars['--surface']);
        }
        // Derive --soft from --muted if not present
        if (vars['--muted'] && !vars['--soft']) {
          root.style.setProperty('--soft', vars['--muted']);
        }
        // Derive --line from --card-border if not present
        if (!vars['--line'] && vars['--card-border']) {
          root.style.setProperty('--line', vars['--card-border']);
        }
        // Force body background-color update (gradients don't auto-react)
        document.body.style.backgroundColor = 'var(--bg1)';
        document.body.style.color = 'var(--text)';
      }

      function getSwatches(vars) {
        var order = ['--bg1', '--bg', '--text', '--accent', '--accent2', '--card', '--card-bg'];
        var swatches = [];
        for (var i = 0; i < order.length; i++) {
          if (vars[order[i]]) swatches.push(vars[order[i]]);
          if (swatches.length >= 5) break;
        }
        if (swatches.length < 5) {
          var keys = Object.keys(vars);
          for (var j = 0; j < keys.length; j++) {
            var v = vars[keys[j]].trim();
            if (swatches.length >= 5) break;
            if (v.startsWith('#') || v.startsWith('rgb') || v.startsWith('hsl')) {
              if (swatches.indexOf(v) === -1) swatches.push(v);
            }
          }
        }
        return swatches;
      }

      function injectThemeCss(themeId, vars) {
        var existing = document.querySelector('style[data-vegvisr-theme]');
        if (existing) existing.remove();
        var css = ':root {\\n';
        var keys = Object.keys(vars);
        for (var i = 0; i < keys.length; i++) {
          css += '  ' + keys[i] + ': ' + vars[keys[i]] + ';\\n';
        }
        css += '}';
        var style = document.createElement('style');
        style.setAttribute('data-vegvisr-theme', themeId);
        style.textContent = css;
        document.head.appendChild(style);
      }

      async function fetchCatalogs() {
        if (catalogs.length > 0) return catalogs;
        pickerGrid.innerHTML = '<div class="theme-picker-loading">Loading catalogs...</div>';
        try {
          var res = await fetch(KG_API + '/getknowgraphsummaries?offset=0&limit=100');
          var data = await res.json();
          var results = data.results || [];
          catalogs = [];
          for (var i = 0; i < results.length; i++) {
            var meta = results[i].metadata || {};
            if (meta.isThemeGraph) {
              catalogs.push({ id: results[i].id, title: meta.title || results[i].id });
            }
          }
        } catch (e) {
          pickerGrid.innerHTML = '<div class="theme-picker-loading">Failed to load catalogs</div>';
        }
        return catalogs;
      }

      async function fetchThemes(graphId) {
        if (catalogCache[graphId]) return catalogCache[graphId];
        pickerGrid.innerHTML = '<div class="theme-picker-loading">Loading themes...</div>';
        try {
          var res = await fetch(KG_API + '/getknowgraph?id=' + encodeURIComponent(graphId));
          var data = await res.json();
          var nodes = data.nodes || [];
          var themes = [];
          for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            if (n.type !== 'html-node') continue;
            var vars = parseCssVarsFromHtml(n.info || '');
            if (Object.keys(vars).length < 3) continue;
            themes.push({ id: n.id, label: n.label || 'Untitled', vars: vars, swatches: getSwatches(vars) });
          }
          catalogCache[graphId] = themes;
          return themes;
        } catch (e) {
          pickerGrid.innerHTML = '<div class="theme-picker-loading">Failed to load themes</div>';
          return [];
        }
      }

      function renderTabs() {
        pickerTabs.innerHTML = '';
        for (var i = 0; i < catalogs.length; i++) {
          var tab = document.createElement('button');
          tab.className = 'theme-picker-tab' + (catalogs[i].id === activeCatalogId ? ' active' : '');
          tab.textContent = catalogs[i].title;
          tab.dataset.id = catalogs[i].id;
          tab.addEventListener('click', function(e) {
            activeCatalogId = e.target.dataset.id;
            renderTabs();
            loadAndRenderThemes(activeCatalogId);
          });
          pickerTabs.appendChild(tab);
        }
      }

      function renderThemeGrid(themes) {
        pickerGrid.innerHTML = '';
        if (themes.length === 0) {
          pickerGrid.innerHTML = '<div class="theme-picker-loading">No themes found</div>';
          return;
        }
        var activeTag = document.querySelector('style[data-vegvisr-theme]');
        var activeId = activeTag ? activeTag.getAttribute('data-vegvisr-theme') : '';

        for (var i = 0; i < themes.length; i++) {
          var t = themes[i];
          var card = document.createElement('div');
          card.className = 'theme-picker-card' + (t.id === activeId ? ' active' : '');
          var swatchHtml = '<div class="theme-picker-swatches">';
          for (var s = 0; s < t.swatches.length; s++) {
            swatchHtml += '<span style="background:' + t.swatches[s] + '"></span>';
          }
          swatchHtml += '</div>';
          card.innerHTML = swatchHtml + '<div class="theme-picker-card-label">' + (t.label || 'Theme') + '</div>';
          card.dataset.index = i;
          card.addEventListener('click', (function(theme) {
            return function() {
              applyTokens(theme.vars);
              injectThemeCss(theme.id, theme.vars);
              persistThemeToNode(theme.vars, theme.id);
              loadAndRenderThemes(activeCatalogId);
            };
          })(t));
          pickerGrid.appendChild(card);
        }
      }

      async function loadAndRenderThemes(graphId) {
        var themes = await fetchThemes(graphId);
        renderThemeGrid(themes);
      }

      function loadSavedTheme() {
        var saved = document.querySelector('style[data-vegvisr-theme]');
        if (saved) {
          var vars = {};
          var re = /--([\\/\\w-]+)\\s*:\\s*([^;]+)/g;
          var m;
          while ((m = re.exec(saved.textContent)) !== null) {
            vars['--' + m[1].trim()] = m[2].trim();
          }
          if (Object.keys(vars).length > 0) {
            applyTokens(vars);
          }
        }
      }

      if (pickerBtn) {
        pickerBtn.addEventListener('click', async function() {
          panelOpen = !panelOpen;
          pickerPanel.classList.toggle('hidden', !panelOpen);
          if (panelOpen && catalogs.length === 0) {
            await fetchCatalogs();
            if (catalogs.length > 0) {
              activeCatalogId = catalogs[0].id;
              renderTabs();
              loadAndRenderThemes(activeCatalogId);
            }
          }
        });
      }
      if (pickerClose) {
        pickerClose.addEventListener('click', function() {
          panelOpen = false;
          pickerPanel.classList.add('hidden');
        });
      }

      loadSavedTheme();
    })();

    // ========== LOGIN / LOGOUT ==========
    var AUTH_BASE = 'https://cookie.vegvisr.org';
    var DASHBOARD_BASE = 'https://dashboard.vegvisr.org';

    function showLoginModal() {
      var modal = document.getElementById('loginModal');
      modal.classList.remove('hidden');
      document.getElementById('loginEmailSection').classList.remove('hidden');
      document.getElementById('loginCheckSection').classList.add('hidden');
      document.getElementById('loginStatus').classList.add('hidden');
      var emailInput = document.getElementById('loginEmail');
      emailInput.value = localStorage.getItem('vegvisr_connect_email') || '';
      emailInput.focus();
    }

    function hideLoginModal() {
      document.getElementById('loginModal').classList.add('hidden');
    }

    function setLoginStatus(message, type) {
      var statusEl = document.getElementById('loginStatus');
      statusEl.textContent = message;
      statusEl.className = 'login-status ' + (type || 'info');
      statusEl.classList.remove('hidden');
    }

    async function sendMagicLink() {
      var email = document.getElementById('loginEmail').value.trim();
      if (!email || email.indexOf('@') === -1) {
        setLoginStatus('Please enter a valid email address.', 'error');
        return;
      }
      var btn = document.getElementById('btnSendMagicLink');
      btn.disabled = true;
      btn.textContent = 'Sending...';
      try {
        localStorage.setItem('vegvisr_connect_email', email);
        var redirectUrl = window.location.origin + window.location.pathname;
        var response = await fetch(AUTH_BASE + '/login/magic/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, redirectUrl: redirectUrl })
        });
        var data = await response.json();
        if (!response.ok) throw new Error(data.error || data.message || 'Failed to send magic link');
        document.getElementById('loginEmailSection').classList.add('hidden');
        document.getElementById('loginCheckSection').classList.remove('hidden');
        document.getElementById('sentToEmail').textContent = email;
        setLoginStatus('Magic link sent! Check your email inbox.', 'success');
      } catch (err) {
        setLoginStatus('Error: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Send Magic Link';
      }
    }

    async function fetchUserContext(email) {
      var roleRes = await fetch(DASHBOARD_BASE + '/get-role?email=' + encodeURIComponent(email));
      var roleData = await roleRes.json();
      var userRes = await fetch(DASHBOARD_BASE + '/userdata?email=' + encodeURIComponent(email));
      var userData = await userRes.json();
      return {
        email: email,
        role: roleData.role || 'user',
        user_id: userData.user_id || email,
        username: userData.username || email
      };
    }

    async function verifyMagicLinkToken(token) {
      try {
        setLoginStatus('Verifying...', 'info');
        showLoginModal();
        var response = await fetch(AUTH_BASE + '/login/magic/verify?token=' + encodeURIComponent(token), {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        });
        var data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || 'Invalid or expired magic link');

        var userContext = null;
        try {
          userContext = await fetchUserContext(data.email);
        } catch (err) {
          userContext = { email: data.email, role: 'user', user_id: data.email };
        }

        currentUser = userContext;
        authToken = data.token || data.accessToken || null;
        localStorage.setItem('userStore', JSON.stringify({ user: currentUser, token: authToken }));
        if (authToken) localStorage.setItem('token', authToken);

        updateLoginButton();
        hideLoginModal();

        // Show edit buttons if Superadmin
        if (isSuperadmin()) {
          document.body.classList.add('landing-admin');
        }

        // Clear magic token from URL
        var url = new URL(window.location.href);
        url.searchParams.delete('magic');
        window.history.replaceState({}, document.title, url.toString());

      } catch (err) {
        setLoginStatus('Verification failed: ' + err.message, 'error');
      }
    }

    function handleLogout() {
      if (!confirm('Are you sure you want to logout?')) return;
      currentUser = null;
      authToken = null;
      localStorage.removeItem('userStore');
      localStorage.removeItem('user');
      localStorage.removeItem('currentUser');
      localStorage.removeItem('token');
      localStorage.removeItem('authToken');
      try { sessionStorage.clear(); } catch(e) {}
      document.body.classList.remove('landing-admin');
      updateLoginButton();
    }

    function updateLoginButton() {
      var loginBtn = document.getElementById('btnLogin');
      var logoutBtn = document.getElementById('btnLogout');
      if (currentUser) {
        var displayName = escapeHtml(currentUser.email || 'Logged in');
        if (isSuperadmin()) displayName += ' (SA)';
        loginBtn.innerHTML = displayName;
        loginBtn.className = 'nav-login-btn logged-in';
        loginBtn.onclick = null;
        logoutBtn.classList.remove('hidden');
      } else {
        loginBtn.textContent = 'Login';
        loginBtn.className = 'nav-login-btn';
        loginBtn.onclick = showLoginModal;
        logoutBtn.classList.add('hidden');
      }
    }

    function checkForMagicLinkToken() {
      var params = new URLSearchParams(window.location.search);
      var token = params.get('magic');
      if (token) verifyMagicLinkToken(token);
    }

    // Wire up login UI event listeners
    document.getElementById('btnLogin').onclick = showLoginModal;
    document.getElementById('btnLogout').onclick = handleLogout;
    document.getElementById('btnSendMagicLink').onclick = sendMagicLink;
    document.getElementById('btnCancelLogin').onclick = hideLoginModal;
    document.getElementById('btnResendLink').onclick = sendMagicLink;
    document.getElementById('btnBackToEmail').onclick = function() {
      document.getElementById('loginEmailSection').classList.remove('hidden');
      document.getElementById('loginCheckSection').classList.add('hidden');
      document.getElementById('loginStatus').classList.add('hidden');
    };
    document.getElementById('loginEmail').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); sendMagicLink(); }
    });
    document.getElementById('loginModal').onclick = function(e) {
      if (e.target.id === 'loginModal') hideLoginModal();
    };

    // Listen for auth changes in other tabs
    window.addEventListener('storage', function(e) {
      if (e.key === 'userStore' || e.key === 'token' || e.key === 'user') {
        loadUserFromStorage();
        updateLoginButton();
        if (isSuperadmin()) {
          document.body.classList.add('landing-admin');
        } else {
          document.body.classList.remove('landing-admin');
        }
      }
    });

    // ========== INITIALIZE ==========
    loadLandingPage();
    updateLoginButton();
    checkForMagicLinkToken();

  <\/script>
</body>
</html>
`;
