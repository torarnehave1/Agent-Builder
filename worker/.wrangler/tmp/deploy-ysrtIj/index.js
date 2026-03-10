var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// editable-template.js
var EDITABLE_HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <meta name="template-version" content="1.2.1" />
  <meta name="template-id" content="editable-page" />
  <title>{{TITLE}}</title>

  <!-- Marked for Markdown rendering -->
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>

  <style>
/* Theme variables \u2014 overridden by injected <style data-vegvisr-theme> */
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
      background:
        radial-gradient(circle at top, color-mix(in srgb, var(--accent) 20%, transparent), transparent 55%),
        radial-gradient(circle at bottom, color-mix(in srgb, var(--accent2) 18%, transparent), transparent 55%),
        var(--bg1);
    }

    /* Layout helpers */
    .container { max-width: 1100px; margin: 0 auto; padding: 40px 16px; }
    .mb-6 { margin-bottom: 24px; }
    .mt-1 { margin-top: 4px; }
    .mt-2 { margin-top: 8px; }
    .mt-6 { margin-top: 24px; }
    .space-y-5 > * + * { margin-top: 20px; }
    .text-xs { font-size: 12px; }
    .text-sm { font-size: 14px; }
    .text-xl { font-size: 20px; }
    .text-2xl { font-size: 24px; }
    .text-3xl { font-size: 30px; }
    .font-semibold { font-weight: 600; }
    .tracking-tight { letter-spacing: -0.015em; }
    .whitespace-nowrap { white-space: nowrap; }
    .hidden { display: none !important; }
    .overflow-auto { overflow: auto; }

    /* Cards / UI */
    .card { background: var(--card-bg); border: 1px solid var(--card-border); }
    .muted { color: var(--muted); }
    .soft  { color: var(--soft); }
    .btn { border:1px solid var(--line); background: var(--card-bg); color: var(--text); cursor: pointer; }
    .btn:hover { background: color-mix(in srgb, var(--card-bg) 60%, var(--text) 10%); }
    .btnPrimary { border-color: color-mix(in srgb, var(--accent) 40%, transparent); background: color-mix(in srgb, var(--accent) 16%, transparent); }
    .btnPrimary:hover { background: color-mix(in srgb, var(--accent) 24%, transparent); }
    .btn:disabled { opacity: 0.45; cursor: not-allowed; }

    .rounded-lg { border-radius: 10px; }
    .rounded-2xl { border-radius: 16px; }
    .rounded-3xl { border-radius: 20px; }

    .p-4 { padding: 16px; }
    .p-6 { padding: 24px; }
    .px-3 { padding-left: 12px; padding-right: 12px; }
    .py-2 { padding-top: 8px; padding-bottom: 8px; }

    /* Flex/grid */
    .flex { display: flex; }
    .grid { display: grid; }
    .gap-2 { gap: 8px; }
    .gap-4 { gap: 16px; }
    .gap-6 { gap: 24px; }
    .flex-wrap { flex-wrap: wrap; }
    .items-center { align-items: center; }
    .items-start { align-items: flex-start; }
    .justify-between { justify-content: space-between; }

    @media (min-width: 768px) {
      .md-grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .md-grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .md-text-2xl { font-size: 24px; }
      .md-text-3xl { font-size: 30px; }
    }

    /* Pills */
    .pill {
      border:1px solid var(--line);
      background: var(--card-bg);
      padding: 6px 10px;
      border-radius: 999px;
      font-size: 12px;
      cursor: pointer;
      user-select: none;
      max-width: 260px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pill:hover { background: color-mix(in srgb, var(--card-bg) 60%, var(--text) 8%); }
    .pillActive { border-color: color-mix(in srgb, var(--accent) 55%, transparent); background: color-mix(in srgb, var(--accent) 12%, transparent); }

    code { color: color-mix(in srgb, var(--accent) 95%, white); }
    pre { margin: 0; }

    /* Debug / JSON panel */
    .debugPanel {
      margin-top: 16px;
      padding: 16px;
      border-radius: 16px;
      background: color-mix(in srgb, var(--bg1) 70%, black);
      border: 1px solid var(--line);
      font-size: 12px;
      overflow: auto;
      max-height: 520px;
      white-space: pre;
    }

    /* Node preview panel (UI look) */
    .previewPanel {
      margin-top: 16px;
      padding: 16px;
      border-radius: 16px;
      background: var(--card-bg);
      border: 1px solid var(--line);
    }
    .previewPanel h1, .previewPanel h2, .previewPanel h3 { margin: 0.6em 0 0.4em; }
    .previewPanel p { margin: 0.6em 0; line-height: 1.55; color: var(--muted); }
    .previewPanel a { color: color-mix(in srgb, var(--accent) 95%, white); }
    .previewPanel hr { border: none; border-top: 1px solid var(--line); margin: 14px 0; }
    .previewPanel img { max-width: 100%; border-radius: 12px; border: 1px solid var(--line); }
    .previewPanel blockquote {
      border-left: 4px solid var(--line);
      padding-left: 12px;
      margin: 12px 0;
      color: var(--muted);
    }
    .previewPanel table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0;
      overflow: hidden;
      border-radius: 12px;
      border: 1px solid var(--line);
    }
    .previewPanel th, .previewPanel td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
    }
    .previewPanel th { background: var(--card-bg); text-align: left; }
    .previewPanel ul, .previewPanel ol { margin: 0.6em 0; padding-left: 1.5em; }
    .previewPanel li { margin: 0.3em 0; line-height: 1.5; }
    .previewPanel code {
      background: rgba(0,0,0,0.3);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.9em;
    }
    .previewPanel pre {
      background: rgba(0,0,0,0.3);
      padding: 12px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 10px 0;
    }
    .previewPanel pre code {
      background: none;
      padding: 0;
    }

    /* ========== FORM UI STYLES ========== */
    .ui-form {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .ui-form-title {
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 8px;
      color: #fff;
    }
    .ui-form-description {
      color: rgba(255,255,255,0.7);
      margin-bottom: 16px;
      line-height: 1.5;
    }
    .ui-block {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      padding: 16px;
    }
    .ui-block-title {
      font-size: 1.1rem;
      font-weight: 600;
      margin-bottom: 12px;
      color: rgba(255,255,255,0.9);
    }
    .ui-field {
      margin-bottom: 16px;
    }
    .ui-field:last-child {
      margin-bottom: 0;
    }
    .ui-label {
      display: block;
      font-size: 0.9rem;
      font-weight: 500;
      margin-bottom: 6px;
      color: rgba(255,255,255,0.85);
    }
    .ui-input, .ui-select, .ui-textarea {
      width: 100%;
      padding: 10px 14px;
      background: rgba(0,0,0,0.3);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 8px;
      color: #fff;
      font-size: 0.95rem;
      box-sizing: border-box;
    }
    .ui-input:focus, .ui-select:focus, .ui-textarea:focus {
      outline: none;
      border-color: rgba(56,189,248,0.5);
      box-shadow: 0 0 0 3px rgba(56,189,248,0.15);
    }
    .ui-input::placeholder, .ui-textarea::placeholder {
      color: rgba(255,255,255,0.4);
    }
    .ui-select {
      cursor: pointer;
    }
    .ui-select option {
      background: #1a1a2e;
      color: #fff;
    }
    .ui-textarea {
      min-height: 100px;
      resize: vertical;
    }
    .ui-checkbox-group, .ui-radio-group {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .ui-checkbox-item, .ui-radio-item {
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
    }
    .ui-checkbox-item input, .ui-radio-item input {
      width: 18px;
      height: 18px;
      accent-color: rgba(56,189,248,0.8);
      cursor: pointer;
    }
    .ui-choice-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 12px;
    }
    .ui-choice-card {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 10px;
      padding: 14px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .ui-choice-card:hover {
      background: rgba(255,255,255,0.08);
      border-color: rgba(56,189,248,0.3);
    }
    .ui-choice-card.selected {
      background: rgba(56,189,248,0.12);
      border-color: rgba(56,189,248,0.5);
    }
    .ui-choice-card-title {
      font-weight: 600;
      margin-bottom: 4px;
    }
    .ui-choice-card-desc {
      font-size: 0.85rem;
      color: rgba(255,255,255,0.6);
    }
    .ui-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 12px 24px;
      background: rgba(56,189,248,0.2);
      border: 1px solid rgba(56,189,248,0.4);
      border-radius: 10px;
      color: #fff;
      font-size: 1rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    }
    .ui-button:hover {
      background: rgba(56,189,248,0.3);
    }
    .ui-info-box {
      background: rgba(56,189,248,0.1);
      border: 1px solid rgba(56,189,248,0.25);
      border-radius: 10px;
      padding: 14px;
      color: rgba(255,255,255,0.85);
    }
    .ui-warning-box {
      background: rgba(251,191,36,0.1);
      border: 1px solid rgba(251,191,36,0.25);
      border-radius: 10px;
      padding: 14px;
      color: rgba(255,255,255,0.85);
    }

    /* ========== EDIT MODE STYLES ========== */
    .edit-mode-toolbar {
      display: flex;
      gap: 10px;
      margin-bottom: 16px;
      padding: 12px;
      background: rgba(139,92,246,0.1);
      border: 1px solid rgba(139,92,246,0.3);
      border-radius: 10px;
      align-items: center;
      flex-wrap: wrap;
    }
    .edit-mode-toolbar .status {
      flex: 1;
      font-size: 0.9rem;
      color: rgba(255,255,255,0.7);
    }
    .edit-mode-toolbar .status.saving {
      color: rgba(251,191,36,0.9);
    }
    .edit-mode-toolbar .status.saved {
      color: rgba(74,222,128,0.9);
    }
    .edit-mode-toolbar .status.error {
      color: rgba(248,113,113,0.9);
    }
    .btn-edit {
      background: rgba(139,92,246,0.2);
      border-color: rgba(139,92,246,0.4);
    }
    .btn-edit:hover {
      background: rgba(139,92,246,0.3);
    }
    .btn-save {
      background: rgba(74,222,128,0.2);
      border-color: rgba(74,222,128,0.4);
    }
    .btn-save:hover {
      background: rgba(74,222,128,0.3);
    }
    .btn-cancel {
      background: rgba(248,113,113,0.2);
      border-color: rgba(248,113,113,0.4);
    }
    .btn-cancel:hover {
      background: rgba(248,113,113,0.3);
    }

    /* Editable labels */
    .ui-label.editable {
      cursor: pointer;
      position: relative;
      padding-right: 20px;
    }
    .ui-label.editable::after {
      content: '\u270E';
      position: absolute;
      right: 0;
      opacity: 0.4;
      font-size: 0.8em;
    }
    .ui-label.editable:hover::after {
      opacity: 1;
    }
    .ui-label-input {
      width: 100%;
      padding: 6px 10px;
      background: rgba(139,92,246,0.15);
      border: 1px solid rgba(139,92,246,0.4);
      border-radius: 6px;
      color: #fff;
      font-size: 0.9rem;
      font-weight: 500;
      margin-bottom: 6px;
    }
    .ui-label-input:focus {
      outline: none;
      border-color: rgba(139,92,246,0.7);
      box-shadow: 0 0 0 3px rgba(139,92,246,0.2);
    }

    /* Editable title */
    .ui-form-title.editable {
      cursor: pointer;
      position: relative;
      display: inline-block;
      padding-right: 30px;
    }
    .ui-form-title.editable::after {
      content: '\u270E';
      position: absolute;
      right: 0;
      opacity: 0.4;
      font-size: 0.6em;
    }
    .ui-form-title.editable:hover::after {
      opacity: 1;
    }
    .ui-form-title-input {
      width: 100%;
      padding: 8px 12px;
      background: rgba(139,92,246,0.15);
      border: 1px solid rgba(139,92,246,0.4);
      border-radius: 8px;
      color: #fff;
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 8px;
    }

    /* Edit mode highlight */
    .edit-mode .ui-input,
    .edit-mode .ui-select,
    .edit-mode .ui-textarea {
      border-color: rgba(139,92,246,0.3);
    }
    .edit-mode .ui-input:focus,
    .edit-mode .ui-select:focus,
    .edit-mode .ui-textarea:focus {
      border-color: rgba(139,92,246,0.6);
      box-shadow: 0 0 0 3px rgba(139,92,246,0.15);
    }

    /* Add field button */
    .btn-add-field {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      background: rgba(255,255,255,0.05);
      border: 1px dashed rgba(255,255,255,0.2);
      border-radius: 8px;
      color: rgba(255,255,255,0.6);
      font-size: 0.9rem;
      cursor: pointer;
      transition: all 0.2s;
      margin-top: 12px;
    }
    .btn-add-field:hover {
      background: rgba(255,255,255,0.08);
      border-color: rgba(255,255,255,0.3);
      color: rgba(255,255,255,0.8);
    }

    /* Delete field button */
    .btn-delete-field {
      position: absolute;
      top: 0;
      right: 0;
      width: 24px;
      height: 24px;
      background: rgba(248,113,113,0.2);
      border: 1px solid rgba(248,113,113,0.3);
      border-radius: 6px;
      color: rgba(248,113,113,0.8);
      font-size: 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.2s;
    }
    .ui-field:hover .btn-delete-field {
      opacity: 1;
    }
    .btn-delete-field:hover {
      background: rgba(248,113,113,0.3);
    }
    .ui-field.edit-mode-field {
      position: relative;
      padding-right: 30px;
    }

    /* Edit mode user info */
    #editUserInfo {
      margin-left: auto;
      margin-right: 8px;
      color: rgba(255,255,255,0.5);
    }

    /* Login Modal */
    .login-modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }
    .login-modal {
      background: #1a1a2e;
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 16px;
      padding: 32px;
      max-width: 400px;
      width: 90%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }
    .login-modal h2 {
      margin: 0 0 8px 0;
      font-size: 1.5rem;
      color: #fff;
    }
    .login-modal p {
      color: rgba(255,255,255,0.7);
      margin: 0 0 20px 0;
      font-size: 0.95rem;
      line-height: 1.5;
    }
    .login-modal .form-group {
      margin-bottom: 16px;
    }
    .login-modal label {
      display: block;
      margin-bottom: 6px;
      color: rgba(255,255,255,0.85);
      font-size: 0.9rem;
    }
    .login-modal input {
      width: 100%;
      padding: 12px 14px;
      background: rgba(0,0,0,0.3);
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 8px;
      color: #fff;
      font-size: 1rem;
      box-sizing: border-box;
    }
    .login-modal input:focus {
      outline: none;
      border-color: rgba(56,189,248,0.5);
      box-shadow: 0 0 0 3px rgba(56,189,248,0.15);
    }
    .login-modal .btn-group {
      display: flex;
      gap: 10px;
      margin-top: 20px;
    }
    .login-modal .btn-primary {
      flex: 1;
      padding: 12px 20px;
      background: rgba(56,189,248,0.2);
      border: 1px solid rgba(56,189,248,0.4);
      border-radius: 8px;
      color: #fff;
      font-size: 1rem;
      cursor: pointer;
    }
    .login-modal .btn-primary:hover {
      background: rgba(56,189,248,0.3);
    }
    .login-modal .btn-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .login-modal .btn-secondary {
      padding: 12px 20px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.16);
      border-radius: 8px;
      color: #fff;
      font-size: 1rem;
      cursor: pointer;
    }
    .login-modal .btn-secondary:hover {
      background: rgba(255,255,255,0.10);
    }
    .login-modal .login-status {
      margin-top: 12px;
      padding: 10px;
      border-radius: 8px;
      font-size: 0.9rem;
    }
    .login-modal .login-status.info {
      background: rgba(56,189,248,0.1);
      border: 1px solid rgba(56,189,248,0.25);
      color: rgba(255,255,255,0.85);
    }
    .login-modal .login-status.success {
      background: rgba(74,222,128,0.1);
      border: 1px solid rgba(74,222,128,0.25);
      color: rgba(74,222,128,0.9);
    }
    .login-modal .login-status.error {
      background: rgba(248,113,113,0.1);
      border: 1px solid rgba(248,113,113,0.25);
      color: rgba(248,113,113,0.9);
    }

    /* User info display */
    .user-info {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 8px;
      font-size: 0.85rem;
      color: rgba(255,255,255,0.8);
    }
    .user-info .role-badge {
      padding: 2px 8px;
      background: rgba(139,92,246,0.2);
      border: 1px solid rgba(139,92,246,0.4);
      border-radius: 4px;
      font-size: 0.75rem;
      color: rgba(139,92,246,0.9);
      text-transform: uppercase;
    }

    /* Vegvisr special elements CSS */
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

    /* ========== YOUTUBE EMBED STYLES ========== */
    .youtube-embed-container {
      position: relative;
      width: 100%;
      padding-bottom: 56.25%; /* 16:9 aspect ratio */
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
    .youtube-video-info {
      margin-top: 16px;
      padding: 16px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 10px;
    }
    .youtube-video-info p {
      margin: 0 0 8px 0;
      color: rgba(255, 255, 255, 0.8);
      line-height: 1.5;
    }
    .youtube-video-info p:last-child {
      margin-bottom: 0;
    }
    .youtube-video-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 12px;
      padding: 8px 14px;
      background: rgba(255, 0, 0, 0.1);
      border: 1px solid rgba(255, 0, 0, 0.3);
      border-radius: 8px;
      color: #ff4444;
      text-decoration: none;
      font-size: 0.9rem;
      transition: all 0.2s;
    }
    .youtube-video-link:hover {
      background: rgba(255, 0, 0, 0.2);
      border-color: rgba(255, 0, 0, 0.5);
    }
    .youtube-video-link svg {
      width: 18px;
      height: 18px;
      fill: currentColor;
    }
    .youtube-error {
      padding: 24px;
      background: rgba(248, 113, 113, 0.1);
      border: 1px solid rgba(248, 113, 113, 0.3);
      border-radius: 12px;
      color: rgba(255, 255, 255, 0.8);
      text-align: center;
    }
    .youtube-error code {
      display: block;
      margin-top: 8px;
      font-size: 0.85rem;
      color: rgba(255, 255, 255, 0.6);
    }

    /* YouTube Edit Mode Styles */
    .youtube-edit-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .youtube-edit-field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .youtube-edit-field label {
      font-size: 0.9rem;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.85);
    }
    .youtube-edit-field input,
    .youtube-edit-field textarea {
      width: 100%;
      padding: 10px 14px;
      background: rgba(139, 92, 246, 0.1);
      border: 1px solid rgba(139, 92, 246, 0.3);
      border-radius: 8px;
      color: #fff;
      font-size: 0.95rem;
      box-sizing: border-box;
    }
    .youtube-edit-field input:focus,
    .youtube-edit-field textarea:focus {
      outline: none;
      border-color: rgba(139, 92, 246, 0.6);
      box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.15);
    }
    .youtube-edit-field textarea {
      min-height: 80px;
      resize: vertical;
    }
    .youtube-edit-field .field-help {
      font-size: 0.8rem;
      color: rgba(255, 255, 255, 0.5);
    }
    .youtube-preview-small {
      position: relative;
      width: 100%;
      max-width: 400px;
      padding-bottom: 56.25%;
      height: 0;
      overflow: hidden;
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .youtube-preview-small iframe {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      border: none;
      border-radius: 8px;
    }
    .youtube-preview-placeholder {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: rgba(255, 255, 255, 0.5);
      font-size: 0.9rem;
      text-align: center;
      padding: 20px;
      box-sizing: border-box;
    }
    .youtube-url-status {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.85rem;
      padding: 8px 12px;
      border-radius: 6px;
      margin-top: 8px;
    }
    .youtube-url-status.valid {
      background: rgba(74, 222, 128, 0.1);
      border: 1px solid rgba(74, 222, 128, 0.3);
      color: rgba(74, 222, 128, 0.9);
    }
    .youtube-url-status.invalid {
      background: rgba(248, 113, 113, 0.1);
      border: 1px solid rgba(248, 113, 113, 0.3);
      color: rgba(248, 113, 113, 0.9);
    }

    /* Fulltext Edit Form Styles */
    .fulltext-edit-form {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .fulltext-edit-field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .fulltext-edit-field label {
      font-size: 0.9rem;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.85);
    }
    .fulltext-textarea {
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
      resize: none;
      line-height: 1.5;
    }
    .fulltext-textarea:focus {
      outline: none;
      border-color: rgba(139, 92, 246, 0.6);
      box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.15);
    }
    .fulltext-preview-field {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .fulltext-preview-field label {
      font-size: 0.9rem;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.85);
    }

    /* Header Image Styles */
    .header-image-wrap {
      position: relative;
      margin-bottom: 24px;
    }
    .header-image {
      width: 100%;
      max-height: 400px;
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      object-fit: cover;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    }
    .header-image-edit {
      position: absolute;
      top: 12px;
      right: 12px;
      background: rgba(0,0,0,0.6);
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 8px;
      padding: 6px 12px;
      color: #fff;
      font-size: 14px;
      cursor: pointer;
      backdrop-filter: blur(8px);
      transition: all 0.2s;
    }
    .header-image-edit:hover {
      background: rgba(139,92,246,0.5);
      border-color: rgba(139,92,246,0.6);
    }
    .header-image-editor {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 16px;
      padding: 12px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
    }
    .header-image-input {
      flex: 1;
      padding: 8px 12px;
      background: rgba(0,0,0,0.3);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 8px;
      color: #fff;
      font-size: 13px;
    }
    .header-image-input:focus {
      outline: none;
      border-color: rgba(139,92,246,0.5);
    }

    header {
      position: relative;
    }

    .header-content {
      position: relative;
      z-index: 1;
    }

    /* ========== ELEMENT VISIBILITY CONTROLS ========== */
    .visibility-toggle {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 32px;
      height: 32px;
      padding: 0;
      background: rgba(139, 92, 246, 0.2);
      border: 1px solid rgba(139, 92, 246, 0.4);
      border-radius: 6px;
      color: rgba(139, 92, 246, 0.9);
      font-size: 18px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
      opacity: 0;
      pointer-events: none;
      z-index: 1000;
    }

    .visibility-toggle:hover {
      background: rgba(139, 92, 246, 0.3);
      border-color: rgba(139, 92, 246, 0.6);
    }

    .visibility-toggle.visible {
      pointer-events: auto;
      opacity: 1;
    }

    .controllable-element {
      position: relative;
      transition: opacity 0.3s ease;
    }

    .controllable-element:hover .visibility-toggle.visible {
      opacity: 1;
      pointer-events: auto;
    }

    .controllable-element.hidden-element {
      opacity: 0.5;
      pointer-events: none;
    }

    /* Ensure controllable elements have position relative for absolute positioning */
    header.controllable-element,
    div.controllable-element,
    main.controllable-element {
      position: relative;
    }

    .visibility-panel {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: rgba(20, 30, 50, 0.95);
      border: 1px solid rgba(139, 92, 246, 0.4);
      border-radius: 12px;
      padding: 16px;
      max-width: 320px;
      z-index: 999;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      display: none;
      flex-direction: column;
      gap: 12px;
    }

    .visibility-panel.active {
      display: flex;
    }

    .visibility-panel-title {
      font-weight: 600;
      color: #fff;
      margin-bottom: 8px;
      font-size: 0.95rem;
    }

    .visibility-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px;
      background: rgba(255, 255, 255, 0.04);
      border-radius: 8px;
      cursor: pointer;
    }

    .visibility-item:hover {
      background: rgba(255, 255, 255, 0.08);
    }

    .visibility-toggle-switch {
      width: 40px;
      height: 24px;
      background: rgba(248, 113, 113, 0.3);
      border: 1px solid rgba(248, 113, 113, 0.4);
      border-radius: 12px;
      position: relative;
      cursor: pointer;
      transition: all 0.2s;
    }

    .visibility-toggle-switch.on {
      background: rgba(74, 222, 128, 0.3);
      border-color: rgba(74, 222, 128, 0.4);
    }

    .visibility-toggle-switch::after {
      content: '';
      position: absolute;
      width: 18px;
      height: 18px;
      background: rgba(255, 255, 255, 0.8);
      border-radius: 10px;
      top: 2px;
      left: 2px;
      transition: left 0.2s;
    }

    .visibility-toggle-switch.on::after {
      left: 18px;
    }

    .visibility-item-label {
      flex: 1;
      font-size: 0.9rem;
      color: rgba(255, 255, 255, 0.85);
    }

    .visibility-panel-actions {
      display: flex;
      gap: 8px;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
    }

    .visibility-panel-actions button {
      flex: 1;
      padding: 8px 12px;
      font-size: 0.85rem;
      border: 1px solid rgba(255, 255, 255, 0.2);
      background: rgba(255, 255, 255, 0.06);
      color: #fff;
      border-radius: 6px;
      cursor: pointer;
    }

    .visibility-panel-actions button:hover {
      background: rgba(255, 255, 255, 0.1);
    }

    .visibility-panel-actions button.save {
      background: rgba(74, 222, 128, 0.2);
      border-color: rgba(74, 222, 128, 0.4);
      color: rgba(74, 222, 128, 0.9);
    }

    .visibility-panel-actions button.save:hover {
      background: rgba(74, 222, 128, 0.3);
    }

    /* ========== SIDEBAR NAVIGATION STYLES ========== */
    /* Hamburger button (top-left, fixed) */
    .hamburger-button {
      position: fixed;
      top: 20px;
      left: 20px;
      width: 40px;
      height: 40px;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 1px;
      cursor: pointer;
      z-index: 999;
      display: none; /* Hidden by default */
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }

    .hamburger-button:hover {
      background: color-mix(in srgb, var(--card-bg) 60%, var(--text) 8%);
    }

    .hamburger-button.active {
      background: color-mix(in srgb, var(--accent) 16%, transparent);
      border-color: color-mix(in srgb, var(--accent) 40%, transparent);
    }

    /* Hamburger icon (3 lines) */
    .hamburger-icon {
      width: 20px;
      height: 14px;
      position: relative;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }

    .hamburger-icon span {
      width: 100%;
      height: 2px;
      background: color-mix(in srgb, var(--text) 85%, transparent);
      border-radius: 2px;
      transition: all 0.3s;
    }

    /* Sidebar navigation container */
    .sidebar-nav {
      position: fixed;
      top: 0;
      left: -280px; /* Hidden by default */
      width: 280px;
      height: 100vh;
      background: color-mix(in srgb, var(--bg1) 98%, transparent);
      border-right: 1px solid var(--card-border);
      z-index: 998;
      transition: left 0.3s ease;
      overflow-y: auto;
      padding: 80px 16px 20px 16px;
      box-shadow: 2px 0 20px rgba(0,0,0,0.3);
    }

    .sidebar-nav.open {
      left: 0;
    }

    /* Sidebar pills (vertical layout) */
    .sidebar-nav .pill {
      width: calc(100% - 16px);
      max-width: none;
      margin: 0 8px 8px 8px;
      display: block;
      text-align: left;
    }

    .sidebar-nav .text-sm {
      margin-bottom: 12px;
      padding-left: 4px;
    }

    /* Dimmed backdrop when sidebar is open */
    .sidebar-backdrop {
      position: fixed;
      inset: 0;
      background: transparent;
      z-index: 997; /* below sidebar (998) and hamburger (999) */
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.25s ease;
    }

    body.sidebar-open .sidebar-backdrop {
      opacity: 1;
      pointer-events: auto;
    }

    /* Layout mode classes */
    .nodes-layout-sidebar .card[data-element-id="nodesList"] {
      display: none !important; /* Hide the horizontal card */
    }

    .nodes-layout-sidebar .hamburger-button {
      display: flex; /* Show hamburger button */
    }


/* NodeTitle override (added) */
#nodeTitle {
  color: var(--accent) !important;
}

    /* Navigation bar */
    .nav-bar {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 16px 24px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 16px;
      backdrop-filter: blur(12px);
      position: relative;
    }
    .nav-btn {
      padding: 10px 24px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.06);
      color: rgba(255,255,255,0.85);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    }
    .nav-btn:hover {
      background: rgba(139,92,246,0.25);
      border-color: rgba(139,92,246,0.4);
    }
    .nav-btn-primary {
      background: rgba(139,92,246,0.3);
      border-color: rgba(139,92,246,0.5);
      color: #fff;
    }
    .nav-btn-primary:hover {
      background: rgba(139,92,246,0.5);
    }
    .nav-btn-sm {
      padding: 8px 16px;
      font-size: 12px;
      opacity: 0.7;
    }
    .nav-meta {
      color: rgba(255,255,255,0.5);
      font-size: 13px;
      min-width: 120px;
      text-align: center;
    }

    /* ========== THEME PICKER ========== */
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

  </style>
</head>

<body>
  <!-- Hamburger Menu Button (visible only in sidebar mode) -->
  <button type="button" id="hamburgerButton" class="hamburger-button" title="Toggle navigation menu">
    <div class="hamburger-icon">
      <span></span>
      <span></span>
      <span></span>
    </div>
  </button>

  <!-- Sidebar Navigation (visible only in sidebar mode) -->
  <div id="sidebarNav" class="sidebar-nav">
    <div class="text-sm soft">Nodes:</div>
    <div id="sidebarPills"></div>
  </div>
  <div id="sidebarBackdrop" class="sidebar-backdrop" aria-hidden="true"></div>

  <div class="container">
    <header class="mb-6 controllable-element" data-element-id="header">
      <button type="button" class="visibility-toggle" title="Toggle visibility">\u{1F441}\uFE0F</button>
      <div class="header-image-wrap" id="headerImageWrap">
        <img src="" alt="{{TITLE}} Header" class="header-image" id="headerImage" style="display:none;">
        <button type="button" class="header-image-edit hidden" id="btnEditHeaderImage" title="Change header image">\u270F\uFE0F</button>
      </div>
      <div class="header-image-editor hidden" id="headerImageEditor">
        <input type="text" id="headerImageUrl" class="header-image-input" placeholder="Paste image URL here..." />
        <button type="button" id="btnApplyHeaderImage" class="nav-btn nav-btn-primary" style="padding:8px 16px;font-size:13px;">Apply</button>
        <button type="button" id="btnCancelHeaderImage" class="nav-btn" style="padding:8px 16px;font-size:13px;">Cancel</button>
      </div>
      <div class="header-content">
        <h1 class="text-2xl md-text-3xl font-semibold tracking-tight">{{TITLE}}</h1>
        <p class="muted mt-2">
          {{DESCRIPTION}}
        </p>
      </div>
    </header>

    <div class="grid md-grid-cols-2 gap-4 mb-6 controllable-element" data-element-id="stats">
      <button type="button" class="visibility-toggle" title="Toggle visibility">\u{1F441}\uFE0F</button>
      <div class="card rounded-2xl p-4">
        <div class="text-sm soft">Graph ID</div>
        <div class="mt-1 font-semibold" id="graphIdLabel">\u2014</div>
        <div class="text-xs soft mt-1">Data source: <code>https://knowledge.vegvisr.org/getknowgraph?id=\u2026</code></div>
      </div>

      <div class="card rounded-2xl p-4">
        <div class="text-sm soft">Nodes loaded</div>
        <div class="mt-1 font-semibold" id="discoveredCount">\u2014</div>
        <div class="text-xs soft mt-1">Filter: label contains <code>#</code></div>
      </div>
    </div>

    <div class="card rounded-2xl p-4 mb-6 controllable-element" data-element-id="nodesList">
      <button type="button" class="visibility-toggle" title="Toggle visibility">\u{1F441}\uFE0F</button>
      <div class="flex flex-wrap gap-2 items-center">
        <div class="text-sm soft" style="margin-right:8px;">Nodes:</div>
        <div id="stepPills" class="flex flex-wrap gap-2"></div>
      </div>
    </div>

    <main class="card rounded-3xl p-6 controllable-element" data-element-id="mainContent">
      <button type="button" class="visibility-toggle" title="Toggle visibility">\u{1F441}\uFE0F</button>
      <div class="flex items-start justify-between gap-4">
        <div>
          <div class="text-sm soft" id="nodeMeta">\u2014</div>
          <h2 class="text-xl md-text-2xl font-semibold mt-1" id="nodeTitle">\u2014</h2>
          <div class="muted mt-2" id="nodeIntro"></div>
        </div>
        <div class="flex gap-2 flex-wrap">
          <button type="button" id="btnLogin" class="btn rounded-lg px-3 py-2 text-sm whitespace-nowrap">Login</button>
          <button type="button" id="btnLogout" class="btn btn-cancel rounded-lg px-3 py-2 text-sm whitespace-nowrap hidden">Logout</button>
          <button id="btnEditMode" class="btn btn-edit rounded-lg px-3 py-2 text-sm whitespace-nowrap hidden">Edit Mode</button>
          <button id="btnToggleView" class="btn btnPrimary rounded-lg px-3 py-2 text-sm whitespace-nowrap hidden">Show JSON</button>
          <button id="btnToggleDebug" class="btn rounded-lg px-3 py-2 text-sm whitespace-nowrap hidden">Debug</button>
        </div>
      </div>

      <!-- Edit mode toolbar (hidden by default, only for Superadmin) -->
      <div id="editToolbar" class="edit-mode-toolbar hidden">
        <div class="status" id="editStatus">Edit mode: Click labels to rename, modify values, then save.</div>
        <div class="text-xs soft" id="editUserInfo"></div>
        <button type="button" id="btnSaveNode" class="btn btn-save rounded-lg px-3 py-2 text-sm whitespace-nowrap">Save</button>
        <button type="button" id="btnCancelEdit" class="btn btn-cancel rounded-lg px-3 py-2 text-sm whitespace-nowrap">Cancel</button>
      </div>

      <!-- UI preview -->
      <div id="uiView" class="previewPanel mt-6">
        <div id="nodePreview"></div>
      </div>

      <!-- JSON view -->
      <pre id="jsonView" class="hidden debugPanel"></pre>

      <!-- Debug view -->
      <pre id="debug" class="hidden debugPanel"></pre>
    </main>

    <nav class="nav-bar mt-6 controllable-element" data-element-id="navigation">
      <button type="button" class="visibility-toggle" title="Toggle visibility">\u{1F441}\uFE0F</button>
      <button id="btnPrev" class="nav-btn">\u2190 Back</button>
      <span class="nav-meta" id="nodeMeta2"></span>
      <button id="btnNext" class="nav-btn nav-btn-primary">Next \u2192</button>
      <button id="btnReload" class="nav-btn nav-btn-sm">Reload</button>
    </nav>

    <footer class="soft text-xs mt-6">
      {{FOOTER_TEXT}}
    </footer>
  </div>

  <!-- Visibility Control Panel (only visible to Superadmins) -->
  <div id="visibilityPanel" class="visibility-panel">
    <div class="visibility-panel-title">Element Visibility</div>
    <div id="visibilityItems" class="visibility-items"></div>
    <div class="visibility-panel-actions">
      <button type="button" id="btnSaveVisibility" class="save">Save</button>
      <button type="button" id="btnCloseVisibility">Close</button>
    </div>
  </div>

  <!-- Login Modal -->
  <div id="loginModal" class="login-modal-overlay hidden">
    <div class="login-modal">
      <h2>Login</h2>
      <p>Enter your email address to receive a magic link for authentication.</p>

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
        <p style="margin-bottom: 16px;">A magic link has been sent to <strong id="sentToEmail"></strong>. Check your email and click the link to complete login.</p>
        <div class="btn-group">
          <button type="button" id="btnResendLink" class="btn-secondary">Resend Link</button>
          <button type="button" id="btnBackToEmail" class="btn-secondary">Use Different Email</button>
        </div>
      </div>

      <div id="loginStatus" class="login-status hidden"></div>
    </div>
  </div>

  <!-- Theme Picker UI -->
  <button type="button" id="btnThemePicker" class="theme-picker-btn" title="Change theme">&#127912;</button>
  <div id="themePickerPanel" class="theme-picker-panel hidden">
    <div class="theme-picker-header">
      <span>Theme Catalog</span>
      <button type="button" id="btnCloseThemePicker">&#10005;</button>
    </div>
    <div id="themePickerTabs" class="theme-picker-tabs"></div>
    <div id="themePickerGrid" class="theme-picker-grid"></div>
  </div>

  <script>
    // Graph ID - injected by GNewAppViewerNode.vue at render time, or fallback to URL param/default
    // The placeholder {{GRAPH_ID}} is replaced when the HTML is rendered in the knowledge graph viewer
    function getGraphId() {
      // First check if placeholder was replaced with actual graph ID
      const injectedId = '{{GRAPH_ID}}';
      if (injectedId && !injectedId.includes('{{')) {
        return injectedId;
      }
      // Fallback: check URL parameter
      const urlParams = new URLSearchParams(window.location.search);
      const urlGraphId = urlParams.get('graph');
      if (urlGraphId) {
        return urlGraphId;
      }
      // Final fallback: default graph ID
      return '{{GRAPH_ID_DEFAULT}}';
    }

    const GRAPH_ID = getGraphId();

    // Node ID - injected by agent-builder at creation time
    function getNodeId() {
      const injectedId = '{{NODE_ID}}';
      if (injectedId && !injectedId.includes('{{')) {
        return injectedId;
      }
      // Fallback: check URL parameter
      const urlParams = new URLSearchParams(window.location.search);
      return urlParams.get('node') || null;
    }
    const NODE_ID = getNodeId();

    // Show nodes whose label contains this substring (case-insensitive)
    const LABEL_CONTAINS = '#';

    let nodes = [];
    let currentIndex = 0;
    let headerImageNode = null;
    let debugOn = false;

    // View state: 'ui' or 'json'
    let viewMode = 'ui';

    // Edit mode state
    let editMode = false;
    let originalJsonData = null; // Store original JSON for cancel functionality
    let currentJsonData = null;  // Current working copy of JSON

    // User authentication state
    let currentUser = null;
    let authToken = null;

    // Visibility settings state
    let visibilitySettings = {}; // Store element visibility states
    let visibilityPanelOpen = false;
    let nodesLayoutMode = 'horizontal'; // NEW: 'horizontal' or 'sidebar'
    let sidebarOpen = false; // NEW: Track sidebar open/close state
    const VISIBILITY_CONFIG_NODE_ID = '__CONNECT_VISIBILITY_SETTINGS__';

    // Check if user is Superadmin
    function isSuperadmin() {
      if (!currentUser) return false;
      // Check various possible role structures
      const role = currentUser.role || currentUser.userRole || currentUser.roles;
      if (typeof role === 'string') {
        return role.toLowerCase() === 'superadmin';
      }
      if (Array.isArray(role)) {
        return role.some(r => (typeof r === 'string' ? r : r.name || '').toLowerCase() === 'superadmin');
      }
      return false;
    }

    // Try to get user from various storage locations
    function loadUserFromStorage() {
      try {
        // Try localStorage first (common pattern)
        const userStoreKeys = ['userStore', 'user', 'currentUser', 'auth', 'authUser'];
        for (const key of userStoreKeys) {
          const stored = localStorage.getItem(key);
          if (stored) {
            try {
              const parsed = JSON.parse(stored);
              // Handle different store structures
              const user = parsed.user || parsed.currentUser || parsed;
              if (user && (user.role || user.userRole || user.roles || user.email)) {
                currentUser = user;
                authToken = parsed.token || parsed.accessToken || parsed.authToken || localStorage.getItem('token') || localStorage.getItem('authToken');
                console.log('Loaded user from localStorage:', key, { role: user.role || user.userRole || user.roles });
                return true;
              }
            } catch (e) {
              // Not valid JSON, continue
            }
          }
        }

        // Try sessionStorage
        for (const key of userStoreKeys) {
          const stored = sessionStorage.getItem(key);
          if (stored) {
            try {
              const parsed = JSON.parse(stored);
              const user = parsed.user || parsed.currentUser || parsed;
              if (user && (user.role || user.userRole || user.roles || user.email)) {
                currentUser = user;
                authToken = parsed.token || parsed.accessToken || parsed.authToken || sessionStorage.getItem('token');
                console.log('Loaded user from sessionStorage:', key);
                return true;
              }
            } catch (e) {
              // Not valid JSON, continue
            }
          }
        }

        // Check for global window variables (Vegvisr platform injection)
        if (window.__VEGVISR_USER) {
          currentUser = window.__VEGVISR_USER;
          authToken = window.__VEGVISR_TOKEN || window.__VEGVISR_STORAGE_TOKEN;
          console.log('Loaded user from window.__VEGVISR_USER');
          return true;
        }

        // Check cookies for token
        const cookieToken = document.cookie.split(';').find(c => c.trim().startsWith('token=') || c.trim().startsWith('authToken='));
        if (cookieToken) {
          authToken = cookieToken.split('=')[1];
        }

      } catch (e) {
        console.error('Error loading user from storage:', e);
      }
      return false;
    }

    // Update UI based on user role
    function updateEditButtonVisibility() {
      const editBtn = document.getElementById('btnEditMode');
      if (isSuperadmin()) {
        editBtn.classList.remove('hidden');
        editBtn.title = 'Edit Mode (Superadmin)';
      } else {
        editBtn.classList.add('hidden');
      }
    }

    // Update visibility toggle buttons based on login status
    function updateVisibilityToggleButtons() {
      const toggles = document.querySelectorAll('.visibility-toggle');
      if (isSuperadmin()) {
        toggles.forEach(btn => btn.classList.add('visible'));
      } else {
        toggles.forEach(btn => btn.classList.remove('visible'));
      }
    }

    // Update visibility of Superadmin-only buttons based on login status
    function updateSuperadminButtonsVisibility() {
      const showJsonBtn = document.getElementById('btnToggleView');
      const debugBtn = document.getElementById('btnToggleDebug');
      const editHeaderBtn = document.getElementById('btnEditHeaderImage');

      if (isSuperadmin()) {
        if (showJsonBtn) showJsonBtn.classList.remove('hidden');
        if (debugBtn) debugBtn.classList.remove('hidden');
        if (editHeaderBtn) editHeaderBtn.classList.remove('hidden');
      } else {
        if (showJsonBtn) showJsonBtn.classList.add('hidden');
        if (debugBtn) debugBtn.classList.add('hidden');
        if (editHeaderBtn) editHeaderBtn.classList.add('hidden');
      }
    }

    // ========== VISIBILITY MANAGEMENT FUNCTIONS ==========

    /**
     * Initialize visibility controls for Superadmins
     */
    function initializeVisibilityControls() {
      if (!isSuperadmin()) return;

      // Find all controllable elements
      const controllableElements = document.querySelectorAll('.controllable-element');

      controllableElements.forEach(el => {
        const elementId = el.getAttribute('data-element-id');
        if (elementId) {
          // Initialize visibility setting (default to visible)
          if (!(elementId in visibilitySettings)) {
            visibilitySettings[elementId] = true;
          }

          // Add click handler to visibility toggle button
          const toggleBtn = el.querySelector('.visibility-toggle');
          if (toggleBtn) {
            toggleBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              openVisibilityPanel(elementId);
            });
          }
        }
      });

      // Attach visibility panel handlers
      document.getElementById('btnSaveVisibility').onclick = saveVisibilitySettings;
      document.getElementById('btnCloseVisibility').onclick = closeVisibilityPanel;
    }

    /**
     * Open the visibility panel and populate it with current settings
     */
    function openVisibilityPanel(focusElementId) {
      visibilityPanelOpen = true;
      const panel = document.getElementById('visibilityPanel');
      const itemsContainer = document.getElementById('visibilityItems');

      // Clear existing items
      itemsContainer.innerHTML = '';

      // === NEW: Add layout mode selector ===
      const layoutSelectorHTML = \`
        <div style="padding: 12px; background: rgba(139,92,246,0.1); border-radius: 8px; margin-bottom: 16px;">
          <div style="font-weight: 600; margin-bottom: 8px; font-size: 0.9rem;">Nodes Navigation Layout</div>
          <select id="layoutModeSelect" style="width: 100%; padding: 8px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: #fff; font-size: 0.9rem;">
            <option value="horizontal" \${nodesLayoutMode === 'horizontal' ? 'selected' : ''}>Horizontal (Top Menu)</option>
            <option value="sidebar" \${nodesLayoutMode === 'sidebar' ? 'selected' : ''}>Sidebar (Hamburger Menu)</option>
          </select>
        </div>
      \`;
      itemsContainer.insertAdjacentHTML('beforeend', layoutSelectorHTML);

      // Add change handler for layout selector
      document.getElementById('layoutModeSelect').addEventListener('change', (e) => {
        nodesLayoutMode = e.target.value;
        applyNodesLayout();
      });
      // === END NEW ===

      // Get all controllable elements
      const controllableElements = document.querySelectorAll('.controllable-element');

      controllableElements.forEach(el => {
        const elementId = el.getAttribute('data-element-id');
        if (elementId) {
          const isVisible = visibilitySettings[elementId] !== false;
          const label = getElementLabel(elementId);

          const itemHTML = \`
            <div class="visibility-item" data-element-id="\${elementId}">
              <div class="visibility-item-label">\${label}</div>
              <div class="visibility-toggle-switch \${isVisible ? 'on' : ''}" data-element-id="\${elementId}"></div>
            </div>
          \`;

          itemsContainer.insertAdjacentHTML('beforeend', itemHTML);
        }
      });

      // Add theme picker toggle (not a .controllable-element, handled separately)
      var themePickerVisible = visibilitySettings['themePicker'] !== false;
      var themePickerHTML = \`
        <div class="visibility-item" data-element-id="themePicker">
          <div class="visibility-item-label">\${getElementLabel('themePicker')}</div>
          <div class="visibility-toggle-switch \${themePickerVisible ? 'on' : ''}" data-element-id="themePicker"></div>
        </div>
      \`;
      itemsContainer.insertAdjacentHTML('beforeend', themePickerHTML);

      // Add click handlers to toggle switches
      itemsContainer.querySelectorAll('.visibility-toggle-switch').forEach(toggle => {
        toggle.addEventListener('click', (e) => {
          e.stopPropagation();
          const elementId = e.currentTarget.getAttribute('data-element-id');
          visibilitySettings[elementId] = !toggle.classList.contains('on');
          toggle.classList.toggle('on');
          applyVisibilitySettings();
        });
      });

      // Show panel
      panel.classList.add('active');
    }

    /**
     * Close the visibility panel
     */
    function closeVisibilityPanel() {
      visibilityPanelOpen = false;
      document.getElementById('visibilityPanel').classList.remove('active');
    }

    /**
     * Get a human-readable label for an element ID
     */
    function getElementLabel(elementId) {
      const labels = {
        'header': 'Header with Image',
        'stats': 'Statistics Cards',
        'nodesList': 'Nodes Pills',
        'mainContent': 'Main Node Content',
        'navigation': 'Navigation Bar',
        'themePicker': 'Theme Picker'
      };
      return labels[elementId] || elementId.charAt(0).toUpperCase() + elementId.slice(1);
    }

    /**
     * Apply visibility settings to DOM elements
     */
    function applyVisibilitySettings() {
      Object.entries(visibilitySettings).forEach(([elementId, isVisible]) => {
        // Theme picker is not a .controllable-element, handle separately
        if (elementId === 'themePicker') {
          var btn = document.getElementById('btnThemePicker');
          if (btn) btn.style.display = isVisible ? '' : 'none';
          return;
        }
        const element = document.querySelector(\`.controllable-element[data-element-id="\${elementId}"]\`);
        if (element) {
          if (isVisible) {
            element.classList.remove('hidden-element');
            element.style.display = '';
          } else {
            element.classList.add('hidden-element');
            element.style.display = 'none';
          }
        }
      });
    }

    /**
     * Apply the selected nodes navigation layout mode
     */
    function applyNodesLayout() {
      const body = document.body;

      if (nodesLayoutMode === 'sidebar') {
        // Sidebar mode
        body.classList.add('nodes-layout-sidebar');
        body.classList.remove('nodes-layout-horizontal');

        // Rebuild pills in sidebar
        buildSidebarPills();
      } else {
        // Horizontal mode (default)
        body.classList.add('nodes-layout-horizontal');
        body.classList.remove('nodes-layout-sidebar');

        // Close sidebar if open
        if (sidebarOpen) {
          toggleSidebar(false);
        }

        // Rebuild pills in main area
        buildPills();
      }
    }

    /**
     * Build pills for sidebar navigation
     */
    function buildSidebarPills() {
      const wrap = document.getElementById('sidebarPills');
      wrap.innerHTML = '';

      if (!nodes.length) {
        wrap.innerHTML = \`<div class="soft text-sm">No nodes found.</div>\`;
        return;
      }

      nodes.forEach((n, idx) => {
        const pill = document.createElement('div');
        pill.className = 'pill' + (idx === currentIndex ? ' pillActive' : '');
        pill.textContent = n.label || n.id || ('Node ' + (idx + 1));
        pill.title = \`\${n.label || ''}\\n(id: \${n.id || '\u2014'})\`;
        pill.onclick = () => {
          if (editMode) {
            if (!confirm('Discard changes and switch node?')) return;
            toggleEditMode(false);
          }
          currentIndex = idx;
          renderCurrent();

          // Close sidebar after selection only on touch devices
          if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) {
            toggleSidebar(false);
          }
        };
        wrap.appendChild(pill);
      });
    }

    /**
     * Toggle sidebar open/close
     */
    function toggleSidebar(forceState) {
      sidebarOpen = forceState !== undefined ? forceState : !sidebarOpen;

      const sidebar = document.getElementById('sidebarNav');
      const hamburger = document.getElementById('hamburgerButton');
      const body = document.body;

      if (sidebarOpen) {
        sidebar.classList.add('open');
        hamburger.classList.add('active');
        body.classList.add('sidebar-open');
      } else {
        sidebar.classList.remove('open');
        hamburger.classList.remove('active');
        body.classList.remove('sidebar-open');
      }
    }

    /**
     * Update sidebar pills active state
     */
    function updateSidebarPillsActive() {
      document.querySelectorAll('#sidebarPills .pill').forEach((el, idx) => {
        el.classList.toggle('pillActive', idx === currentIndex);
      });
    }

    /**
     * Load visibility settings from the graph's settings node
     */
    async function loadVisibilitySettings() {
      try {
        const graphRes = await fetch('https://knowledge.vegvisr.org/getknowgraph?id=' + encodeURIComponent(GRAPH_ID));
        if (!graphRes.ok) return;

        const graphData = await graphRes.json();
        const allNodes = Array.isArray(graphData.nodes) ? graphData.nodes : [];

        // Find the visibility settings node
        const settingsNode = allNodes.find(node => node.id === VISIBILITY_CONFIG_NODE_ID);

        if (settingsNode && settingsNode.info) {
          try {
            const jsonData = extractJsonFromInfo(String(settingsNode.info || ''));
            if (jsonData && jsonData.visibility) {
              visibilitySettings = jsonData.visibility;
              console.log('Loaded visibility settings from graph:', visibilitySettings);
              applyVisibilitySettings();
            }

            // === NEW: Load layout mode ===
            if (jsonData && jsonData.nodesLayout) {
              nodesLayoutMode = jsonData.nodesLayout;
              console.log('Loaded nodes layout mode:', nodesLayoutMode);
              applyNodesLayout();
            }
            // === END NEW ===

          } catch (e) {
            console.log('Could not parse visibility settings:', e);
          }
        }
      } catch (err) {
        console.log('Could not load visibility settings:', err.message);
      }
    }

    /**
     * Save visibility settings to the graph's settings node
     */
    async function saveVisibilitySettings() {
      if (!isSuperadmin()) {
        alert('Only Superadmins can save visibility settings.');
        return;
      }

      const saveBtn = document.getElementById('btnSaveVisibility');
      const originalText = saveBtn.textContent;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      try {
        // Fetch current graph
        const graphRes = await fetch('https://knowledge.vegvisr.org/getknowgraph?id=' + encodeURIComponent(GRAPH_ID));
        if (!graphRes.ok) {
          throw new Error('Failed to fetch graph');
        }

        const graphData = await graphRes.json();
        const allNodes = Array.isArray(graphData.nodes) ? graphData.nodes : [];

        // Find or create the settings node
        let settingsNode = allNodes.find(node => node.id === VISIBILITY_CONFIG_NODE_ID);

        const settingsData = {
          title: 'Visibility Settings',
          description: 'Auto-generated settings node for page element visibility (managed by Superadmin)',
          visibility: visibilitySettings,
          nodesLayout: nodesLayoutMode, // === NEW ===
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser.email || currentUser.username || currentUser.id
        };

        if (settingsNode) {
          // Update existing node
          settingsNode.label = 'Visibility Settings';
          settingsNode.info = JSON.stringify(settingsData, null, 2);
          console.log('Updated visibility settings node');
        } else {
          // Create new node
          settingsNode = {
            id: VISIBILITY_CONFIG_NODE_ID,
            label: 'Visibility Settings',
            type: 'visibility-settings',
            info: JSON.stringify(settingsData, null, 2),
            path: '',
            bibl: []
          };
          allNodes.push(settingsNode);
          console.log('Created new visibility settings node');
        }

        // Save updated graph
        const updateRes = await fetch('https://knowledge.vegvisr.org/updateknowgraph', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            id: GRAPH_ID,
            graphData: {
              nodes: allNodes,
              edges: graphData.edges || []
            }
          })
        });

        if (!updateRes.ok) {
          const errorData = await updateRes.json().catch(() => ({}));
          throw new Error(errorData.error || errorData.message || 'Failed to update graph');
        }

        saveBtn.textContent = 'Saved!';
        saveBtn.style.background = 'rgba(74, 222, 128, 0.3)';

        setTimeout(() => {
          saveBtn.disabled = false;
          saveBtn.textContent = originalText;
          saveBtn.style.background = '';
          closeVisibilityPanel();
        }, 1500);

        console.log('Visibility settings saved successfully');

      } catch (err) {
        console.error('Error saving visibility settings:', err);
        saveBtn.textContent = 'Error!';
        saveBtn.style.background = 'rgba(248, 113, 113, 0.3)';
        alert('Error saving settings: ' + err.message);

        setTimeout(() => {
          saveBtn.disabled = false;
          saveBtn.textContent = originalText;
          saveBtn.style.background = '';
        }, 1500);
      }
    }

    // ========== EXTRACT JSON FROM INFO FIELD ==========
    // The info field may contain JSON wrapped in markdown code fences
    function extractJsonFromInfo(info) {
      if (!info || typeof info !== 'string') return null;

      const trimmed = info.trim();

      // Try to parse directly first (it might be pure JSON)
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === 'object' && parsed !== null) {
          return parsed;
        }
      } catch (e) {
        // Not direct JSON, continue
      }

      // Look for JSON in markdown code fences: \`\`\`json ... \`\`\` or \`\`\` ... \`\`\`
      const codeFenceRegex = /\`\`\`(?:json)?\\s*([\\s\\S]*?)\`\`\`/gi;
      let match;
      while ((match = codeFenceRegex.exec(trimmed)) !== null) {
        try {
          const parsed = JSON.parse(match[1].trim());
          if (typeof parsed === 'object' && parsed !== null) {
            return parsed;
          }
        } catch (e) {
          // Not valid JSON in this fence, continue
        }
      }

      // Look for JSON object or array pattern
      const jsonPatterns = [
        /(\\{[\\s\\S]*\\})/,  // Object
        /(\\[[\\s\\S]*\\])/   // Array
      ];

      for (const pattern of jsonPatterns) {
        const jsonMatch = trimmed.match(pattern);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[1]);
            if (typeof parsed === 'object' && parsed !== null) {
              return parsed;
            }
          } catch (e) {
            // Not valid JSON
          }
        }
      }

      return null;
    }

    // ========== RENDER JSON SCHEMA AS UI ==========
    function renderJsonAsUI(data) {
      if (!data || typeof data !== 'object') {
        return null;
      }

      let html = '<div class="ui-form">';

      // Render title if present
      if (data.title) {
        html += \`<div class="ui-form-title">\${escapeHtml(data.title)}</div>\`;
      }

      // Render description if present
      if (data.description) {
        html += \`<div class="ui-form-description">\${escapeHtml(data.description)}</div>\`;
      }

      // Render blocks if present (form schema pattern)
      if (Array.isArray(data.blocks)) {
        for (const block of data.blocks) {
          html += renderBlock(block);
        }
      }

      // Render fields directly if present
      if (Array.isArray(data.fields)) {
        html += '<div class="ui-block">';
        for (const field of data.fields) {
          html += renderField(field);
        }
        html += '</div>';
      }

      // Render options/choices if present at top level
      if (Array.isArray(data.options)) {
        html += renderChoices(data.options, data.field || 'choice');
      }

      // Render steps if present
      if (Array.isArray(data.steps)) {
        for (let i = 0; i < data.steps.length; i++) {
          const step = data.steps[i];
          html += \`<div class="ui-block">\`;
          html += \`<div class="ui-block-title">Step \${i + 1}\${step.title ? ': ' + escapeHtml(step.title) : ''}</div>\`;
          if (step.description) {
            html += \`<p style="color: rgba(255,255,255,0.7); margin-bottom: 12px;">\${escapeHtml(step.description)}</p>\`;
          }
          if (Array.isArray(step.fields)) {
            for (const field of step.fields) {
              html += renderField(field);
            }
          }
          if (Array.isArray(step.options)) {
            html += renderChoices(step.options, step.field || \`step_\${i}_choice\`);
          }
          html += '</div>';
        }
      }

      // Render items if present (generic list)
      if (Array.isArray(data.items)) {
        html += '<div class="ui-block">';
        for (const item of data.items) {
          if (typeof item === 'string') {
            html += \`<div class="ui-field">\${escapeHtml(item)}</div>\`;
          } else if (typeof item === 'object') {
            html += renderField(item);
          }
        }
        html += '</div>';
      }

      // Render content if present
      if (data.content) {
        if (typeof data.content === 'string') {
          html += \`<div class="ui-block">\${marked.parse(data.content)}</div>\`;
        }
      }

      // Render action/button if present
      if (data.action || data.button) {
        const btnText = data.action || data.button;
        html += \`<div><button class="ui-button">\${escapeHtml(typeof btnText === 'string' ? btnText : 'Submit')}</button></div>\`;
      }

      html += '</div>';
      return html;
    }

    function renderBlock(block) {
      if (!block || typeof block !== 'object') return '';

      let html = '<div class="ui-block">';

      // Block title
      if (block.title || block.label) {
        html += \`<div class="ui-block-title">\${escapeHtml(block.title || block.label)}</div>\`;
      }

      // Block description
      if (block.description) {
        html += \`<p style="color: rgba(255,255,255,0.7); margin-bottom: 12px;">\${escapeHtml(block.description)}</p>\`;
      }

      // Handle different block types
      const blockType = (block.type || '').toLowerCase();

      switch (blockType) {
        case 'inputs':
        case 'form':
        case 'fields':
          if (Array.isArray(block.fields)) {
            for (const field of block.fields) {
              html += renderField(field);
            }
          }
          break;

        case 'choice':
        case 'choices':
        case 'select':
        case 'options':
          if (Array.isArray(block.options)) {
            html += renderChoices(block.options, block.field || block.name || 'choice');
          }
          break;

        case 'info':
        case 'information':
          html += \`<div class="ui-info-box">\${block.text ? escapeHtml(block.text) : (block.content ? marked.parse(block.content) : '')}</div>\`;
          break;

        case 'warning':
          html += \`<div class="ui-warning-box">\${block.text ? escapeHtml(block.text) : (block.content ? marked.parse(block.content) : '')}</div>\`;
          break;

        case 'text':
        case 'markdown':
        case 'content':
          if (block.text || block.content) {
            html += marked.parse(block.text || block.content);
          }
          break;

        default:
          // Try to render fields if present
          if (Array.isArray(block.fields)) {
            for (const field of block.fields) {
              html += renderField(field);
            }
          }
          // Try to render options if present
          if (Array.isArray(block.options)) {
            html += renderChoices(block.options, block.field || block.name || 'choice');
          }
          // Render text/content if present
          if (block.text) {
            html += \`<p>\${escapeHtml(block.text)}</p>\`;
          }
          break;
      }

      html += '</div>';
      return html;
    }

    function renderField(field) {
      if (!field || typeof field !== 'object') return '';

      const fieldType = (field.type || 'text').toLowerCase();
      const fieldName = field.name || field.field || field.id || 'field_' + Math.random().toString(36).substr(2, 9);
      const fieldLabel = field.label || field.title || fieldName;
      const placeholder = field.placeholder || '';
      const required = field.required ? 'required' : '';

      let html = '<div class="ui-field">';

      // Label
      if (fieldLabel) {
        html += \`<label class="ui-label" for="\${escapeHtml(fieldName)}">\${escapeHtml(fieldLabel)}\${field.required ? ' *' : ''}</label>\`;
      }

      switch (fieldType) {
        case 'text':
        case 'string':
        case 'email':
        case 'tel':
        case 'phone':
        case 'url':
        case 'number':
          const inputType = fieldType === 'string' ? 'text' : (fieldType === 'phone' ? 'tel' : fieldType);
          html += \`<input type="\${inputType}" class="ui-input" id="\${escapeHtml(fieldName)}" name="\${escapeHtml(fieldName)}" placeholder="\${escapeHtml(placeholder)}" \${required}>\`;
          break;

        case 'textarea':
        case 'longtext':
        case 'multiline':
          html += \`<textarea class="ui-textarea" id="\${escapeHtml(fieldName)}" name="\${escapeHtml(fieldName)}" placeholder="\${escapeHtml(placeholder)}" \${required}></textarea>\`;
          break;

        case 'select':
        case 'dropdown':
          html += \`<select class="ui-select" id="\${escapeHtml(fieldName)}" name="\${escapeHtml(fieldName)}" \${required}>\`;
          html += \`<option value="">Select...</option>\`;
          if (Array.isArray(field.options)) {
            for (const opt of field.options) {
              if (typeof opt === 'string') {
                html += \`<option value="\${escapeHtml(opt)}">\${escapeHtml(opt)}</option>\`;
              } else if (typeof opt === 'object') {
                const val = opt.value || opt.id || opt.label || '';
                const label = opt.label || opt.title || opt.value || '';
                html += \`<option value="\${escapeHtml(val)}">\${escapeHtml(label)}</option>\`;
              }
            }
          }
          html += '</select>';
          break;

        case 'checkbox':
          if (Array.isArray(field.options)) {
            html += '<div class="ui-checkbox-group">';
            for (const opt of field.options) {
              const optValue = typeof opt === 'string' ? opt : (opt.value || opt.id || opt.label || '');
              const optLabel = typeof opt === 'string' ? opt : (opt.label || opt.title || opt.value || '');
              html += \`<label class="ui-checkbox-item"><input type="checkbox" name="\${escapeHtml(fieldName)}" value="\${escapeHtml(optValue)}"> \${escapeHtml(optLabel)}</label>\`;
            }
            html += '</div>';
          } else {
            html += \`<label class="ui-checkbox-item"><input type="checkbox" id="\${escapeHtml(fieldName)}" name="\${escapeHtml(fieldName)}"> \${escapeHtml(field.checkboxLabel || fieldLabel)}</label>\`;
          }
          break;

        case 'radio':
          html += '<div class="ui-radio-group">';
          if (Array.isArray(field.options)) {
            for (const opt of field.options) {
              const optValue = typeof opt === 'string' ? opt : (opt.value || opt.id || opt.label || '');
              const optLabel = typeof opt === 'string' ? opt : (opt.label || opt.title || opt.value || '');
              html += \`<label class="ui-radio-item"><input type="radio" name="\${escapeHtml(fieldName)}" value="\${escapeHtml(optValue)}"> \${escapeHtml(optLabel)}</label>\`;
            }
          }
          html += '</div>';
          break;

        case 'date':
        case 'time':
        case 'datetime':
          const dateInputType = fieldType === 'datetime' ? 'datetime-local' : fieldType;
          html += \`<input type="\${dateInputType}" class="ui-input" id="\${escapeHtml(fieldName)}" name="\${escapeHtml(fieldName)}" \${required}>\`;
          break;

        default:
          html += \`<input type="text" class="ui-input" id="\${escapeHtml(fieldName)}" name="\${escapeHtml(fieldName)}" placeholder="\${escapeHtml(placeholder)}" \${required}>\`;
          break;
      }

      // Help text
      if (field.help || field.description) {
        html += \`<div style="font-size: 0.85rem; color: rgba(255,255,255,0.5); margin-top: 4px;">\${escapeHtml(field.help || field.description)}</div>\`;
      }

      html += '</div>';
      return html;
    }

    function renderChoices(options, fieldName) {
      if (!Array.isArray(options) || options.length === 0) return '';

      let html = '<div class="ui-choice-grid">';
      for (const opt of options) {
        if (typeof opt === 'string') {
          html += \`<div class="ui-choice-card" data-field="\${escapeHtml(fieldName)}" data-value="\${escapeHtml(opt)}">
            <div class="ui-choice-card-title">\${escapeHtml(opt)}</div>
          </div>\`;
        } else if (typeof opt === 'object') {
          const value = opt.value || opt.id || opt.label || '';
          const title = opt.label || opt.title || opt.name || value;
          const desc = opt.description || opt.desc || '';
          html += \`<div class="ui-choice-card" data-field="\${escapeHtml(fieldName)}" data-value="\${escapeHtml(value)}">
            <div class="ui-choice-card-title">\${escapeHtml(title)}</div>
            \${desc ? \`<div class="ui-choice-card-desc">\${escapeHtml(desc)}</div>\` : ''}
          </div>\`;
        }
      }
      html += '</div>';
      return html;
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

    // Add click handlers for choice cards
    function attachChoiceCardHandlers() {
      document.querySelectorAll('.ui-choice-card').forEach(card => {
        card.addEventListener('click', function() {
          const field = this.dataset.field;
          // Deselect siblings
          document.querySelectorAll(\`.ui-choice-card[data-field="\${field}"]\`).forEach(c => c.classList.remove('selected'));
          // Select this one
          this.classList.add('selected');
        });
      });
    }

    // ========== EDIT MODE FUNCTIONS ==========

    function setEditStatus(message, type = '') {
      const statusEl = document.getElementById('editStatus');
      statusEl.textContent = message;
      statusEl.className = 'status' + (type ? ' ' + type : '');
    }

    function toggleEditMode(enable) {
      editMode = enable;
      const toolbar = document.getElementById('editToolbar');
      const preview = document.getElementById('nodePreview');
      const editBtn = document.getElementById('btnEditMode');
      const n = nodes[currentIndex];

      if (enable) {
        // Check if this is a YouTube node
        if (isYouTubeNode(n)) {
          // Store original node data for cancel
          originalJsonData = {
            path: n.path || '',
            info: n.info || '',
            bibl: n.bibl ? [...n.bibl] : []
          };
          currentJsonData = null; // Not using JSON data for YouTube nodes
        } else if (isFulltextNode(n)) {
          // Store original fulltext for cancel
          originalJsonData = {
            info: n.info || ''
          };
          currentJsonData = null; // Not using JSON data for fulltext nodes
        } else {
          // Store original JSON for cancel
          const info = normalizeStr(n.info);
          originalJsonData = extractJsonFromInfo(info);
          currentJsonData = JSON.parse(JSON.stringify(originalJsonData)); // Deep clone
        }

        toolbar.classList.remove('hidden');
        preview.classList.add('edit-mode');
        editBtn.textContent = 'Editing...';
        editBtn.disabled = true;

        // Re-render with edit capabilities
        renderCurrentEditMode();

        if (isYouTubeNode(n)) {
          setEditStatus('Edit mode: Modify the YouTube URL and description, then save.');
        } else if (isFulltextNode(n)) {
          setEditStatus('Edit mode: Edit the content below (Markdown supported), then save.');
        } else {
          setEditStatus('Edit mode: Click labels to rename, modify values, then save.');
        }
      } else {
        toolbar.classList.add('hidden');
        preview.classList.remove('edit-mode');
        editBtn.textContent = 'Edit Mode';
        editBtn.disabled = false;
        originalJsonData = null;
        currentJsonData = null;

        // Re-render normal view
        renderCurrent();
      }
    }

    function renderCurrentEditMode() {
      const n = nodes[currentIndex];

      // Check if this is a YouTube node
      if (isYouTubeNode(n)) {
        const rendered = renderYouTubeNodeEditable(n);
        setHTML('nodePreview', rendered);
        attachYouTubeEditHandlers();
        return;
      }

      // Check if this is a fulltext node
      if (isFulltextNode(n)) {
        const rendered = renderFulltextNodeEditable(n);
        setHTML('nodePreview', rendered);
        attachFulltextEditHandlers();
        return;
      }

      // Regular JSON node editing
      if (!currentJsonData) {
        setEditStatus('No JSON data to edit in this node.', 'error');
        return;
      }

      const rendered = renderJsonAsUIEditable(currentJsonData);
      setHTML('nodePreview', rendered);
      attachEditableHandlers();
      attachChoiceCardHandlers();
    }

    // Render JSON as editable UI
    function renderJsonAsUIEditable(data) {
      if (!data || typeof data !== 'object') {
        return '<div class="soft text-sm">No editable JSON structure found.</div>';
      }

      let html = '<div class="ui-form edit-mode">';

      // Editable title
      if (data.title !== undefined) {
        html += \`<div class="ui-form-title editable" data-path="title">\${escapeHtml(data.title || 'Untitled')}</div>\`;
      }

      // Editable description
      if (data.description !== undefined) {
        html += \`<div class="ui-form-description editable" data-path="description">\${escapeHtml(data.description || 'No description')}</div>\`;
      }

      // Render blocks
      if (Array.isArray(data.blocks)) {
        for (let i = 0; i < data.blocks.length; i++) {
          html += renderBlockEditable(data.blocks[i], \`blocks.\${i}\`);
        }
      }

      // Render fields directly
      if (Array.isArray(data.fields)) {
        html += '<div class="ui-block">';
        for (let i = 0; i < data.fields.length; i++) {
          html += renderFieldEditable(data.fields[i], \`fields.\${i}\`);
        }
        html += \`<button type="button" class="btn-add-field" data-path="fields">+ Add Field</button>\`;
        html += '</div>';
      }

      // Render options/choices
      if (Array.isArray(data.options)) {
        html += renderChoicesEditable(data.options, data.field || 'choice', 'options');
      }

      // Render steps
      if (Array.isArray(data.steps)) {
        for (let i = 0; i < data.steps.length; i++) {
          const step = data.steps[i];
          html += \`<div class="ui-block">\`;
          html += \`<div class="ui-block-title editable" data-path="steps.\${i}.title">Step \${i + 1}\${step.title ? ': ' + escapeHtml(step.title) : ''}</div>\`;
          if (step.description !== undefined) {
            html += \`<p class="editable" style="color: rgba(255,255,255,0.7); margin-bottom: 12px;" data-path="steps.\${i}.description">\${escapeHtml(step.description || 'No description')}</p>\`;
          }
          if (Array.isArray(step.fields)) {
            for (let j = 0; j < step.fields.length; j++) {
              html += renderFieldEditable(step.fields[j], \`steps.\${i}.fields.\${j}\`);
            }
            html += \`<button type="button" class="btn-add-field" data-path="steps.\${i}.fields">+ Add Field</button>\`;
          }
          if (Array.isArray(step.options)) {
            html += renderChoicesEditable(step.options, step.field || \`step_\${i}_choice\`, \`steps.\${i}.options\`);
          }
          html += '</div>';
        }
      }

      // Render items
      if (Array.isArray(data.items)) {
        html += '<div class="ui-block">';
        for (let i = 0; i < data.items.length; i++) {
          const item = data.items[i];
          if (typeof item === 'string') {
            html += \`<div class="ui-field edit-mode-field"><span class="editable" data-path="items.\${i}">\${escapeHtml(item)}</span></div>\`;
          } else if (typeof item === 'object') {
            html += renderFieldEditable(item, \`items.\${i}\`);
          }
        }
        html += '</div>';
      }

      html += '</div>';
      return html;
    }

    function renderBlockEditable(block, basePath) {
      if (!block || typeof block !== 'object') return '';

      let html = '<div class="ui-block">';

      // Editable block title
      if (block.title !== undefined || block.label !== undefined) {
        const titlePath = block.title !== undefined ? \`\${basePath}.title\` : \`\${basePath}.label\`;
        html += \`<div class="ui-block-title editable" data-path="\${titlePath}">\${escapeHtml(block.title || block.label || 'Untitled Block')}</div>\`;
      }

      // Editable description
      if (block.description !== undefined) {
        html += \`<p class="editable" style="color: rgba(255,255,255,0.7); margin-bottom: 12px;" data-path="\${basePath}.description">\${escapeHtml(block.description || 'No description')}</p>\`;
      }

      const blockType = (block.type || '').toLowerCase();

      // Render fields
      if (Array.isArray(block.fields)) {
        for (let i = 0; i < block.fields.length; i++) {
          html += renderFieldEditable(block.fields[i], \`\${basePath}.fields.\${i}\`);
        }
        html += \`<button type="button" class="btn-add-field" data-path="\${basePath}.fields">+ Add Field</button>\`;
      }

      // Render options
      if (Array.isArray(block.options)) {
        html += renderChoicesEditable(block.options, block.field || block.name || 'choice', \`\${basePath}.options\`);
      }

      // Render text content
      if (block.text !== undefined) {
        html += \`<p class="editable" data-path="\${basePath}.text">\${escapeHtml(block.text)}</p>\`;
      }

      html += '</div>';
      return html;
    }

    function renderFieldEditable(field, basePath) {
      if (!field || typeof field !== 'object') return '';

      const fieldType = (field.type || 'text').toLowerCase();
      const fieldName = field.name || field.field || field.id || 'field_' + Math.random().toString(36).substr(2, 9);
      const fieldLabel = field.label || field.title || fieldName;
      const placeholder = field.placeholder || '';

      let html = '<div class="ui-field edit-mode-field">';

      // Delete button
      html += \`<button type="button" class="btn-delete-field" data-path="\${basePath}" title="Delete field">\xD7</button>\`;

      // Editable label
      html += \`<label class="ui-label editable" data-path="\${basePath}.label" for="\${escapeHtml(fieldName)}">\${escapeHtml(fieldLabel)}\${field.required ? ' *' : ''}</label>\`;

      // Input with data-path for value tracking
      switch (fieldType) {
        case 'text':
        case 'string':
        case 'email':
        case 'tel':
        case 'phone':
        case 'url':
        case 'number':
          const inputType = fieldType === 'string' ? 'text' : (fieldType === 'phone' ? 'tel' : fieldType);
          html += \`<input type="\${inputType}" class="ui-input" data-value-path="\${basePath}.value" id="\${escapeHtml(fieldName)}" name="\${escapeHtml(fieldName)}" placeholder="\${escapeHtml(placeholder)}" value="\${escapeHtml(field.value || '')}">\`;
          break;

        case 'textarea':
        case 'longtext':
        case 'multiline':
          html += \`<textarea class="ui-textarea" data-value-path="\${basePath}.value" id="\${escapeHtml(fieldName)}" name="\${escapeHtml(fieldName)}" placeholder="\${escapeHtml(placeholder)}">\${escapeHtml(field.value || '')}</textarea>\`;
          break;

        case 'select':
        case 'dropdown':
          html += \`<select class="ui-select" data-value-path="\${basePath}.value" id="\${escapeHtml(fieldName)}" name="\${escapeHtml(fieldName)}">\`;
          html += \`<option value="">Select...</option>\`;
          if (Array.isArray(field.options)) {
            for (const opt of field.options) {
              const val = typeof opt === 'string' ? opt : (opt.value || opt.id || opt.label || '');
              const label = typeof opt === 'string' ? opt : (opt.label || opt.title || opt.value || '');
              const selected = field.value === val ? 'selected' : '';
              html += \`<option value="\${escapeHtml(val)}" \${selected}>\${escapeHtml(label)}</option>\`;
            }
          }
          html += '</select>';
          break;

        case 'checkbox':
          if (Array.isArray(field.options)) {
            html += '<div class="ui-checkbox-group">';
            for (let i = 0; i < field.options.length; i++) {
              const opt = field.options[i];
              const optValue = typeof opt === 'string' ? opt : (opt.value || opt.id || opt.label || '');
              const optLabel = typeof opt === 'string' ? opt : (opt.label || opt.title || opt.value || '');
              const checked = Array.isArray(field.value) && field.value.includes(optValue) ? 'checked' : '';
              html += \`<label class="ui-checkbox-item"><input type="checkbox" data-value-path="\${basePath}.value" name="\${escapeHtml(fieldName)}" value="\${escapeHtml(optValue)}" \${checked}> \${escapeHtml(optLabel)}</label>\`;
            }
            html += '</div>';
          } else {
            const checked = field.value ? 'checked' : '';
            html += \`<label class="ui-checkbox-item"><input type="checkbox" data-value-path="\${basePath}.value" id="\${escapeHtml(fieldName)}" name="\${escapeHtml(fieldName)}" \${checked}> \${escapeHtml(field.checkboxLabel || fieldLabel)}</label>\`;
          }
          break;

        case 'radio':
          html += '<div class="ui-radio-group">';
          if (Array.isArray(field.options)) {
            for (const opt of field.options) {
              const optValue = typeof opt === 'string' ? opt : (opt.value || opt.id || opt.label || '');
              const optLabel = typeof opt === 'string' ? opt : (opt.label || opt.title || opt.value || '');
              const checked = field.value === optValue ? 'checked' : '';
              html += \`<label class="ui-radio-item"><input type="radio" data-value-path="\${basePath}.value" name="\${escapeHtml(fieldName)}" value="\${escapeHtml(optValue)}" \${checked}> \${escapeHtml(optLabel)}</label>\`;
            }
          }
          html += '</div>';
          break;

        default:
          html += \`<input type="text" class="ui-input" data-value-path="\${basePath}.value" id="\${escapeHtml(fieldName)}" name="\${escapeHtml(fieldName)}" placeholder="\${escapeHtml(placeholder)}" value="\${escapeHtml(field.value || '')}">\`;
          break;
      }

      // Help text (editable)
      if (field.help !== undefined || field.description !== undefined) {
        const helpPath = field.help !== undefined ? \`\${basePath}.help\` : \`\${basePath}.description\`;
        html += \`<div class="editable" style="font-size: 0.85rem; color: rgba(255,255,255,0.5); margin-top: 4px;" data-path="\${helpPath}">\${escapeHtml(field.help || field.description || 'Add help text...')}</div>\`;
      }

      html += '</div>';
      return html;
    }

    function renderChoicesEditable(options, fieldName, basePath) {
      if (!Array.isArray(options) || options.length === 0) return '';

      let html = '<div class="ui-choice-grid">';
      for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        if (typeof opt === 'string') {
          html += \`<div class="ui-choice-card" data-field="\${escapeHtml(fieldName)}" data-value="\${escapeHtml(opt)}" data-path="\${basePath}.\${i}">
            <div class="ui-choice-card-title editable" data-path="\${basePath}.\${i}">\${escapeHtml(opt)}</div>
          </div>\`;
        } else if (typeof opt === 'object') {
          const value = opt.value || opt.id || opt.label || '';
          const title = opt.label || opt.title || opt.name || value;
          const desc = opt.description || opt.desc || '';
          html += \`<div class="ui-choice-card" data-field="\${escapeHtml(fieldName)}" data-value="\${escapeHtml(value)}">
            <div class="ui-choice-card-title editable" data-path="\${basePath}.\${i}.label">\${escapeHtml(title)}</div>
            <div class="ui-choice-card-desc editable" data-path="\${basePath}.\${i}.description">\${escapeHtml(desc || 'Add description...')}</div>
          </div>\`;
        }
      }
      html += '</div>';
      return html;
    }

    // Attach handlers for editable elements
    function attachEditableHandlers() {
      // Editable text elements (labels, titles, descriptions)
      document.querySelectorAll('.editable').forEach(el => {
        el.addEventListener('click', function(e) {
          if (!editMode) return;
          e.stopPropagation();

          const path = this.dataset.path;
          const currentValue = getValueByPath(currentJsonData, path) || '';
          const isTitle = this.classList.contains('ui-form-title');
          const isMultiline = this.tagName === 'P' || path.includes('description');

          // Create input
          const input = isMultiline
            ? document.createElement('textarea')
            : document.createElement('input');

          input.className = isTitle ? 'ui-form-title-input' : 'ui-label-input';
          input.value = currentValue;
          if (isMultiline) {
            input.style.minHeight = '60px';
            input.style.width = '100%';
          }

          // Replace element with input
          const originalDisplay = this.style.display;
          this.style.display = 'none';
          this.parentNode.insertBefore(input, this);
          input.focus();
          input.select();

          // Handle blur/enter
          const finishEdit = () => {
            const newValue = input.value;
            setValueByPath(currentJsonData, path, newValue);
            this.textContent = newValue || '(empty)';
            this.style.display = originalDisplay || '';
            input.remove();
          };

          input.addEventListener('blur', finishEdit);
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !isMultiline) {
              e.preventDefault();
              finishEdit();
            }
            if (e.key === 'Escape') {
              this.style.display = originalDisplay || '';
              input.remove();
            }
          });
        });
      });

      // Value inputs - track changes
      document.querySelectorAll('[data-value-path]').forEach(input => {
        input.addEventListener('change', function() {
          const path = this.dataset.valuePath;
          let value;

          if (this.type === 'checkbox') {
            // Handle checkbox groups
            const name = this.name;
            const checkboxes = document.querySelectorAll(\`input[name="\${name}"]:checked\`);
            if (checkboxes.length > 1 || this.parentNode.parentNode.classList.contains('ui-checkbox-group')) {
              value = Array.from(checkboxes).map(cb => cb.value);
            } else {
              value = this.checked;
            }
          } else if (this.type === 'radio') {
            value = this.value;
          } else {
            value = this.value;
          }

          setValueByPath(currentJsonData, path, value);
        });

        // Also track on input for text fields
        if (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA') {
          input.addEventListener('input', function() {
            if (this.type !== 'checkbox' && this.type !== 'radio') {
              setValueByPath(currentJsonData, this.dataset.valuePath, this.value);
            }
          });
        }
      });

      // Delete field buttons
      document.querySelectorAll('.btn-delete-field').forEach(btn => {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          const path = this.dataset.path;
          if (confirm('Delete this field?')) {
            deleteByPath(currentJsonData, path);
            renderCurrentEditMode();
          }
        });
      });

      // Add field buttons
      document.querySelectorAll('.btn-add-field').forEach(btn => {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          const path = this.dataset.path;
          const newField = {
            label: 'New Field',
            type: 'text',
            name: 'field_' + Date.now(),
            value: ''
          };
          addToArrayByPath(currentJsonData, path, newField);
          renderCurrentEditMode();
        });
      });
    }

    // Path utilities for nested object manipulation
    function getValueByPath(obj, path) {
      const parts = path.split('.');
      let current = obj;
      for (const part of parts) {
        if (current === null || current === undefined) return undefined;
        current = current[part];
      }
      return current;
    }

    function setValueByPath(obj, path, value) {
      const parts = path.split('.');
      let current = obj;
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (current[part] === undefined) {
          current[part] = isNaN(parseInt(parts[i + 1])) ? {} : [];
        }
        current = current[part];
      }
      current[parts[parts.length - 1]] = value;
    }

    function deleteByPath(obj, path) {
      const parts = path.split('.');
      let current = obj;
      for (let i = 0; i < parts.length - 1; i++) {
        current = current[parts[i]];
        if (!current) return;
      }
      const lastPart = parts[parts.length - 1];
      if (Array.isArray(current)) {
        current.splice(parseInt(lastPart), 1);
      } else {
        delete current[lastPart];
      }
    }

    function addToArrayByPath(obj, path, value) {
      const arr = getValueByPath(obj, path);
      if (Array.isArray(arr)) {
        arr.push(value);
      }
    }

    // Save node to API using the direct knowledge graph update endpoint
    async function saveNode() {
      const n = nodes[currentIndex];
      const isYouTube = isYouTubeNode(n);
      const isFulltext = isFulltextNode(n);

      // Validate we have data to save
      if (!isYouTube && !isFulltext && !currentJsonData) {
        setEditStatus('No data to save.', 'error');
        return;
      }

      if (!isSuperadmin()) {
        setEditStatus('Only Superadmin can save changes.', 'error');
        return;
      }

      const nodeId = n.id;

      setEditStatus('Saving...', 'saving');

      try {
        // Step 1: Fetch the full graph data
        setEditStatus('Loading graph...', 'saving');
        const graphRes = await fetch('https://knowledge.vegvisr.org/getknowgraph?id=' + encodeURIComponent(GRAPH_ID));
        if (!graphRes.ok) {
          throw new Error('Failed to fetch graph: ' + graphRes.status);
        }
        const graphData = await graphRes.json();

        // Step 2: Find and update the target node in the graph
        const allNodes = Array.isArray(graphData.nodes) ? graphData.nodes : [];
        const targetNodeIndex = allNodes.findIndex(node => node.id === nodeId);

        if (targetNodeIndex === -1) {
          throw new Error('Node not found in graph');
        }

        // Handle YouTube node vs fulltext node vs regular JSON node
        if (isYouTube) {
          // Get data from YouTube edit form
          const youtubeData = getYouTubeEditData();

          // Validate YouTube URL
          const videoId = extractYouTubeVideoId(youtubeData.path);
          if (!videoId) {
            setEditStatus('Please enter a valid YouTube URL.', 'error');
            return;
          }

          // Update node fields
          allNodes[targetNodeIndex].path = youtubeData.path;
          allNodes[targetNodeIndex].info = youtubeData.info;

          // Also update bibl array if it exists
          if (Array.isArray(allNodes[targetNodeIndex].bibl)) {
            allNodes[targetNodeIndex].bibl[0] = youtubeData.path;
          } else {
            allNodes[targetNodeIndex].bibl = [youtubeData.path];
          }

          // Update local node reference
          n.path = youtubeData.path;
          n.info = youtubeData.info;
          n.bibl = allNodes[targetNodeIndex].bibl;

        } else if (isFulltextNode(n)) {
          // Fulltext node - save the markdown content directly
          const fulltextData = getFulltextEditData();

          if (!fulltextData.info || !fulltextData.info.trim()) {
            setEditStatus('Content cannot be empty.', 'error');
            return;
          }

          // Update node's info field
          allNodes[targetNodeIndex].info = fulltextData.info;

          // Update local node reference
          n.info = fulltextData.info;

        } else {
          // Regular JSON node - add timestamp and editor info
          currentJsonData.updatedAt = new Date().toISOString();
          currentJsonData.updatedBy = currentUser.email || currentUser.username || currentUser.id;

          // Update the node's info field with the new JSON content
          allNodes[targetNodeIndex].info = JSON.stringify(currentJsonData, null, 2);

          // Update local node reference
          n.info = JSON.stringify(currentJsonData, null, 2);
        }

        // Step 3: Save the updated graph back
        setEditStatus('Updating graph...', 'saving');
        const updateRes = await fetch('https://knowledge.vegvisr.org/updateknowgraph', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            id: GRAPH_ID,
            graphData: {
              nodes: allNodes,
              edges: graphData.edges || []
            }
          })
        });

        if (!updateRes.ok) {
          const errorData = await updateRes.json().catch(() => ({}));
          throw new Error(errorData.error || errorData.message || 'Failed to update graph: ' + updateRes.status);
        }

        setEditStatus('Saved successfully!', 'saved');

        // Exit edit mode after a short delay
        setTimeout(() => {
          toggleEditMode(false);
        }, 1500);

      } catch (err) {
        console.error('Save error:', err);
        setEditStatus('Error: ' + err.message, 'error');
      }
    }

    // Parse Vegvisr special elements in content
    function parseVegvisrElements(html) {
      // Work notes
      html = html.replace(/\\[WNOTE\\s*\\|([^\\]]*)\\]([\\s\\S]*?)\\[END\\s+WNOTE\\]/gi, (m, params, content) => {
        const cited = params.match(/Cited\\s*=\\s*['"]?([^'"\\];]+)/i)?.[1] || '';
        return \`<div class="work-note">\${marked.parse(content.trim())}\${cited ? \`<cite>\u2014 \${cited}</cite>\` : ''}</div>\`;
      });
      // Quotes
      html = html.replace(/\\[QUOTE\\s*\\|([^\\]]*)\\]([\\s\\S]*?)\\[END\\s+QUOTE\\]/gi, (m, params, content) => {
        const cited = params.match(/Cited\\s*=\\s*['"]?([^'"\\];]+)/i)?.[1] || '';
        return \`<div class="fancy-quote">\${marked.parse(content.trim())}\${cited ? \`<cite>\u2014 \${cited}</cite>\` : ''}</div>\`;
      });
      // Sections
      html = html.replace(/\\[SECTION\\s*\\|([^\\]]*)\\]([\\s\\S]*?)\\[END\\s+SECTION\\]/gi, (m, style, content) => {
        return \`<div class="section" style="\${style}">\${marked.parse(content.trim())}</div>\`;
      });
      // Fancy titles
      html = html.replace(/\\[FANCY\\s*\\|([^\\]]*)\\]([\\s\\S]*?)\\[END\\s+FANCY\\]/gi, (m, params, content) => {
        const bgMatch = params.match(/background\\s*=\\s*['"]?([^'"\\];]+)/i);
        const bg = bgMatch ? bgMatch[1] : '';
        const style = bg ? \`background-image: url('\${bg}');\` : '';
        return \`<div class="fancy-title" style="\${style}">\${marked.parse(content.trim())}</div>\`;
      });
      // Image quotes
      html = html.replace(/\\[IMAGEQUOTE\\s*\\|([^\\]]*)\\]([\\s\\S]*?)\\[END\\s+IMAGEQUOTE\\]/gi, (m, params, content) => {
        const bgMatch = params.match(/background\\s*=\\s*['"]?([^'"\\];]+)/i);
        const citedMatch = params.match(/Cited\\s*=\\s*['"]?([^'"\\];]+)/i);
        const bg = bgMatch ? bgMatch[1] : '';
        const cited = citedMatch ? citedMatch[1] : '';
        const style = bg ? \`background-image: url('\${bg}');\` : '';
        return \`<div class="imagequote-element" style="\${style}">
          <div class="imagequote-content">\${marked.parse(content.trim())}</div>
          \${cited ? \`<div class="imagequote-citation">\u2014 \${cited}</div>\` : ''}
        </div>\`;
      });
      // Images - support [IMAGE](url) syntax
      html = html.replace(/\\[IMAGE\\]\\(([^\\)]+)\\)/gi, (m, url) => {
        return \`<img src="\${url}" alt="Image" style="max-width: 100%; border-radius: 12px; border: 1px solid rgba(255,255,255,0.10); margin: 16px 0;" />\`;
      });
      return html;
    }

    // ========== YOUTUBE VIDEO FUNCTIONS ==========

    /**
     * Extract YouTube video ID from various URL formats:
     * - https://www.youtube.com/watch?v=VIDEO_ID
     * - https://youtu.be/VIDEO_ID
     * - https://www.youtube.com/embed/VIDEO_ID
     * - https://www.youtube.com/v/VIDEO_ID
     * - https://youtu.be/VIDEO_ID?si=TRACKING_PARAM
     */
    function extractYouTubeVideoId(url) {
      if (!url || typeof url !== 'string') return null;

      const patterns = [
        // youtu.be/VIDEO_ID or youtu.be/VIDEO_ID?si=xxx
        /youtu\\.be\\/([a-zA-Z0-9_-]{11})/,
        // youtube.com/watch?v=VIDEO_ID
        /youtube\\.com\\/watch\\?v=([a-zA-Z0-9_-]{11})/,
        // youtube.com/embed/VIDEO_ID
        /youtube\\.com\\/embed\\/([a-zA-Z0-9_-]{11})/,
        // youtube.com/v/VIDEO_ID
        /youtube\\.com\\/v\\/([a-zA-Z0-9_-]{11})/,
        // youtube.com/shorts/VIDEO_ID
        /youtube\\.com\\/shorts\\/([a-zA-Z0-9_-]{11})/,
        // Just the video ID (11 characters)
        /^([a-zA-Z0-9_-]{11})$/
      ];

      for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match && match[1]) {
          return match[1];
        }
      }

      return null;
    }

    /**
     * Get YouTube video URL from a node
     * Checks: path, bibl array, info field
     */
    function getYouTubeUrlFromNode(node) {
      if (!node) return null;

      // Check path field first (most likely location)
      if (node.path) {
        const videoId = extractYouTubeVideoId(node.path);
        if (videoId) return { url: node.path, videoId };
      }

      // Check bibl array
      if (Array.isArray(node.bibl)) {
        for (const url of node.bibl) {
          const videoId = extractYouTubeVideoId(url);
          if (videoId) return { url, videoId };
        }
      }

      // Check info field for YouTube URLs
      if (node.info && typeof node.info === 'string') {
        const urlMatch = node.info.match(/https?:\\/\\/(?:www\\.)?(?:youtube\\.com|youtu\\.be)[^\\s"'<>]+/i);
        if (urlMatch) {
          const videoId = extractYouTubeVideoId(urlMatch[0]);
          if (videoId) return { url: urlMatch[0], videoId };
        }
      }

      return null;
    }

    /**
     * Render a YouTube video node as an embedded iframe
     */
    function renderYouTubeNode(node) {
      const videoData = getYouTubeUrlFromNode(node);

      if (!videoData || !videoData.videoId) {
        return \`
          <div class="youtube-error">
            <p>\u26A0\uFE0F Could not find a valid YouTube video URL in this node.</p>
            <code>Check the node's "path" or "bibl" fields for a YouTube link.</code>
          </div>
        \`;
      }

      const embedUrl = \`https://www.youtube.com/embed/\${videoData.videoId}?rel=0\`;
      const watchUrl = \`https://www.youtube.com/watch?v=\${videoData.videoId}\`;

      // Get description from info field
      const description = node.info && typeof node.info === 'string' ? node.info.trim() : '';

      let html = \`
        <div class="youtube-embed-container">
          <iframe
            src="\${embedUrl}"
            title="\${escapeHtml(node.label || 'YouTube Video')}"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowfullscreen
          ></iframe>
        </div>
      \`;

      // Add video info section if there's a description
      if (description && !description.includes(videoData.url)) {
        html += \`
          <div class="youtube-video-info">
            <p>\${marked.parse(description)}</p>
          </div>
        \`;
      }

      // Add link to watch on YouTube
      html += \`
        <a href="\${watchUrl}" target="_blank" rel="noopener noreferrer" class="youtube-video-link">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
          </svg>
          Watch on YouTube
        </a>
      \`;

      return html;
    }

    /**
     * Render a YouTube video node in edit mode
     */
    function renderYouTubeNodeEditable(node) {
      const videoData = getYouTubeUrlFromNode(node);
      const currentUrl = node.path || (Array.isArray(node.bibl) && node.bibl[0]) || '';
      const description = node.info && typeof node.info === 'string' ? node.info.trim() : '';
      const videoId = videoData ? videoData.videoId : null;

      let previewHtml = '';
      if (videoId) {
        const embedUrl = \`https://www.youtube.com/embed/\${videoId}?rel=0\`;
        previewHtml = \`<iframe src="\${embedUrl}" title="Preview" allowfullscreen></iframe>\`;
      } else {
        previewHtml = \`<div class="youtube-preview-placeholder">Enter a valid YouTube URL to see preview</div>\`;
      }

      return \`
        <div class="youtube-edit-form">
          <div class="youtube-edit-field">
            <label for="youtube-url-input">YouTube Video URL</label>
            <input
              type="url"
              id="youtube-url-input"
              value="\${escapeHtml(currentUrl)}"
              placeholder="https://youtu.be/VIDEO_ID or https://youtube.com/watch?v=VIDEO_ID"
            >
            <div class="field-help">Supports: youtu.be, youtube.com/watch, youtube.com/embed, youtube.com/shorts</div>
            <div id="youtube-url-status" class="youtube-url-status \${videoId ? 'valid' : 'invalid'}">
              \${videoId ? '\u2713 Valid YouTube URL (Video ID: ' + videoId + ')' : '\u2717 Enter a valid YouTube URL'}
            </div>
          </div>

          <div class="youtube-edit-field">
            <label>Video Preview</label>
            <div id="youtube-preview-container" class="youtube-preview-small">
              \${previewHtml}
            </div>
          </div>

          <div class="youtube-edit-field">
            <label for="youtube-description-input">Description</label>
            <textarea
              id="youtube-description-input"
              placeholder="Add a description for this video..."
            >\${escapeHtml(description)}</textarea>
            <div class="field-help">This text appears below the video. Markdown is supported.</div>
          </div>
        </div>
      \`;
    }

    /**
     * Attach event handlers for YouTube edit mode
     */
    function attachYouTubeEditHandlers() {
      const urlInput = document.getElementById('youtube-url-input');
      const statusEl = document.getElementById('youtube-url-status');
      const previewContainer = document.getElementById('youtube-preview-container');

      if (urlInput) {
        urlInput.addEventListener('input', function() {
          const url = this.value.trim();
          const videoId = extractYouTubeVideoId(url);

          if (videoId) {
            statusEl.className = 'youtube-url-status valid';
            statusEl.textContent = '\u2713 Valid YouTube URL (Video ID: ' + videoId + ')';

            // Update preview
            const embedUrl = \`https://www.youtube.com/embed/\${videoId}?rel=0\`;
            previewContainer.innerHTML = \`<iframe src="\${embedUrl}" title="Preview" allowfullscreen></iframe>\`;
          } else if (url) {
            statusEl.className = 'youtube-url-status invalid';
            statusEl.textContent = '\u2717 Could not extract video ID from URL';
            previewContainer.innerHTML = \`<div class="youtube-preview-placeholder">Invalid YouTube URL</div>\`;
          } else {
            statusEl.className = 'youtube-url-status invalid';
            statusEl.textContent = '\u2717 Enter a valid YouTube URL';
            previewContainer.innerHTML = \`<div class="youtube-preview-placeholder">Enter a valid YouTube URL to see preview</div>\`;
          }
        });
      }
    }

    /**
     * Get YouTube edit data from form
     */
    function getYouTubeEditData() {
      const urlInput = document.getElementById('youtube-url-input');
      const descInput = document.getElementById('youtube-description-input');

      return {
        path: urlInput ? urlInput.value.trim() : '',
        info: descInput ? descInput.value.trim() : ''
      };
    }

    /**
     * Render fulltext node as editable textarea
     */
    function renderFulltextNodeEditable(node) {
      const content = node.info && typeof node.info === 'string' ? node.info.trim() : '';
      const label = node.label || 'Untitled';

      return \`
        <div class="fulltext-edit-form">
          <div class="fulltext-edit-field">
            <label for="fulltext-content-input">Content (Markdown supported)</label>
            <textarea
              id="fulltext-content-input"
              placeholder="Enter your content here. Markdown is fully supported."
              class="fulltext-textarea"
            >\${escapeHtml(content)}</textarea>
            <div class="field-help">
              Supports Markdown: headings, bold, italic, links, tables, code blocks, lists, blockquotes, etc.
            </div>
          </div>

          <div class="fulltext-preview-field">
            <label>Live Preview</label>
            <div id="fulltext-preview" class="previewPanel">
              \${content ? marked.parse(content) : '<em>Preview will appear here...</em>'}
            </div>
          </div>
        </div>
      \`;
    }

    /**
     * Attach event handlers for fulltext edit mode
     */
    function attachFulltextEditHandlers() {
      const textarea = document.getElementById('fulltext-content-input');
      const preview = document.getElementById('fulltext-preview');

      if (textarea && preview) {
        // Update preview on input
        textarea.addEventListener('input', function() {
          const content = this.value;
          try {
            let html = content ? marked.parse(content) : '<em>Preview will appear here...</em>';
            html = parseVegvisrElements(html);
            preview.innerHTML = html;
          } catch (e) {
            console.error('Markdown parse error:', e);
            preview.innerHTML = '<div class="error">Error parsing markdown</div>';
          }
        });

        // Auto-resize textarea
        textarea.addEventListener('input', function() {
          this.style.height = 'auto';
          this.style.height = Math.min(this.scrollHeight, 600) + 'px';
        });

        // Trigger initial resize
        textarea.dispatchEvent(new Event('input'));
      }
    }

    /**
     * Get fulltext edit data from form
     */
    function getFulltextEditData() {
      const textarea = document.getElementById('fulltext-content-input');
      return {
        info: textarea ? textarea.value.trim() : ''
      };
    }

    /**
     * Check if a node is a YouTube video node
     */
    function isYouTubeNode(node) {
      if (!node) return false;

      // Check explicit type
      const nodeType = (node.type || '').toLowerCase();
      if (nodeType === 'youtube-video' || nodeType === 'youtube' || nodeType === 'video') {
        return true;
      }

      // Check if path contains YouTube URL
      if (node.path && extractYouTubeVideoId(node.path)) {
        return true;
      }

      // Check bibl array for YouTube URLs
      if (Array.isArray(node.bibl)) {
        for (const url of node.bibl) {
          if (extractYouTubeVideoId(url)) {
            return true;
          }
        }
      }

      return false;
    }

    function isFulltextNode(node) {
      if (!node) return false;

      // Check explicit type
      const nodeType = (node.type || '').toLowerCase();
      if (nodeType === 'fulltext' || nodeType === 'fulltext-node' || nodeType === 'text' || nodeType === 'markdown') {
        return true;
      }

      // If it has info content but is NOT JSON and NOT YouTube, it's fulltext
      const info = normalizeStr(node.info);
      if (info && info.trim()) {
        // Check if it's NOT JSON
        if (!extractJsonFromInfo(info)) {
          // And NOT YouTube
          if (!isYouTubeNode(node)) {
            return true;
          }
        }
      }

      return false;
    }

    function setText(id, text) {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    }

    function setHTML(id, html) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = html;
    }

    function normalizeStr(x) {
      return String(x ?? '');
    }

    function nodeMatches(n) {
      const label = normalizeStr(n && n.label);
      return label.toLowerCase().includes(LABEL_CONTAINS.toLowerCase());
    }

    function buildPills() {
      const wrap = document.getElementById('stepPills');
      wrap.innerHTML = '';

      if (!nodes.length) {
        wrap.innerHTML = \`<div class="soft text-sm">No nodes whose label contains <code>\${LABEL_CONTAINS}</code> found.</div>\`;
        return;
      }

      nodes.forEach((n, idx) => {
        const pill = document.createElement('div');
        pill.className = 'pill' + (idx === currentIndex ? ' pillActive' : '');
        // pill text = label, but fallback to id
        pill.textContent = n.label || n.id || ('Node ' + (idx + 1));
        pill.title = \`\${n.label || ''}\\n(id: \${n.id || '\u2014'})\`;
        pill.onclick = () => {
          if (editMode) {
            if (!confirm('Discard changes and switch node?')) return;
            toggleEditMode(false);
          }
          currentIndex = idx;
          renderCurrent();
        };
        wrap.appendChild(pill);
      });

      // === NEW: Also build sidebar pills if in sidebar mode ===
      if (nodesLayoutMode === 'sidebar') {
        buildSidebarPills();
      }
      // === END NEW ===
    }

    function updatePillsActive() {
      document.querySelectorAll('#stepPills .pill').forEach((el, idx) => {
        el.classList.toggle('pillActive', idx === currentIndex);
      });
    }

    function setView(mode) {
      viewMode = mode;

      const uiView = document.getElementById('uiView');
      const jsonView = document.getElementById('jsonView');
      const btn = document.getElementById('btnToggleView');

      const showUI = (viewMode === 'ui');
      uiView.classList.toggle('hidden', !showUI);
      jsonView.classList.toggle('hidden', showUI);

      btn.textContent = showUI ? 'Show JSON' : 'Show UI';
    }

    function renderCurrent() {
      const btnPrev = document.getElementById('btnPrev');
      const btnNext = document.getElementById('btnNext');

      if (!nodes.length) {
        setText('nodeMeta', 'No matching nodes');
        setText('nodeTitle', 'Nothing to display');
        setHTML('nodeIntro', '');
        setHTML('nodePreview', \`<div class="soft text-sm">This graph contains no nodes whose label contains <code>\${LABEL_CONTAINS}</code>.</div>\`);
        document.getElementById('jsonView').textContent = '';
        btnPrev.disabled = true;
        btnNext.disabled = true;

        const dbg = { currentIndex, labelContains: LABEL_CONTAINS, nodesShown: 0 };
        document.getElementById('debug').textContent = JSON.stringify(dbg, null, 2);
        return;
      }

      const n = nodes[currentIndex];
      setText('nodeMeta', '');
      const meta2El = document.getElementById('nodeMeta2');
      if (meta2El) meta2El.textContent = \`\${currentIndex + 1} / \${nodes.length}\`;
      setText('nodeTitle', n.label || n.id || 'Untitled');

      // UI preview content
      const info = normalizeStr(n.info);
      let rendered = '';

      // Check if this is a YouTube video node first
      if (isYouTubeNode(n)) {
        rendered = renderYouTubeNode(n);
      } else if (info && info.trim()) {
        // First, try to extract and render JSON as UI
        const jsonData = extractJsonFromInfo(info);

        if (jsonData) {
          // Render JSON as interactive UI
          const uiHtml = renderJsonAsUI(jsonData);
          if (uiHtml) {
            rendered = uiHtml;
          } else {
            // Fallback to markdown if UI rendering fails
            const markdownHTML = marked.parse(info);
            rendered = parseVegvisrElements(markdownHTML);
          }
        } else {
          // Not JSON, render as markdown with Vegvisr elements
          const markdownHTML = marked.parse(info);
          rendered = parseVegvisrElements(markdownHTML);
        }
      } else {
        rendered = '<div class="soft text-sm">No content (node.info is empty).</div>';
      }

      setHTML('nodeIntro', '');
      setHTML('nodePreview', rendered);

      // Attach click handlers for choice cards
      attachChoiceCardHandlers();

      // JSON view content - show both raw info and parsed JSON if available
      const jsonData = extractJsonFromInfo(info);
      const jsonViewContent = {
        node: n,
        parsedJson: jsonData || '(No JSON found in info field)'
      };
      document.getElementById('jsonView').textContent = JSON.stringify(jsonViewContent, null, 2);

      btnPrev.disabled = (currentIndex === 0);
      btnNext.disabled = (currentIndex === nodes.length - 1);

      updatePillsActive();

      // === NEW: Also update sidebar pills ===
      if (nodesLayoutMode === 'sidebar') {
        updateSidebarPillsActive();
      }
      // === END NEW ===

      const dbg = {
        currentIndex,
        labelContains: LABEL_CONTAINS,
        nodeId: n.id,
        nodeLabel: n.label,
        hasInfo: Boolean(n.info && String(n.info).trim()),
        hasJsonInInfo: Boolean(jsonData),
        node: n
      };
      document.getElementById('debug').textContent = JSON.stringify(dbg, null, 2);
    }

    async function loadGraph() {
      setText('graphIdLabel', GRAPH_ID);
      const graphIdCodeEl = document.getElementById('graphIdCode');
      if (graphIdCodeEl) graphIdCodeEl.textContent = GRAPH_ID;

      const res = await fetch('https://knowledge.vegvisr.org/getknowgraph?id=' + encodeURIComponent(GRAPH_ID));
      if (!res.ok) throw new Error('Failed to fetch graph: ' + res.status);

      const data = await res.json();
      const allNodes = Array.isArray(data.nodes) ? data.nodes.slice() : [];

      // Update page title from graph metadata (overrides baked-in template title)
      const graphTitle = (data.metadata && data.metadata.title) || data.title || '';
      if (graphTitle) {
        const h1El = document.querySelector('header h1');
        if (h1El) h1El.textContent = graphTitle;
        document.title = graphTitle;
      }

      // Find the first markdown-image node to use as the header image
      const imgNode = allNodes.find(n => n.type === 'markdown-image');
      if (imgNode) {
        headerImageNode = imgNode;
        let imgUrl = imgNode.path || '';
        if (!imgUrl && imgNode.info) {
          const match = imgNode.info.match(/![[^]]*](([^)]+))/);
          if (match) imgUrl = match[1];
        }
        const headerImg = document.getElementById('headerImage');
        if (headerImg && imgUrl) {
          headerImg.src = imgUrl;
          headerImg.style.display = '';
        }
      }

      // Filter: label contains "NODE" (case-insensitive)
      nodes = allNodes.filter(nodeMatches);

      // Optional: stable sort if "order" exists
      nodes.sort((a, b) => {
        const ao = Number.isFinite(+a?.order) ? +a.order : Number.POSITIVE_INFINITY;
        const bo = Number.isFinite(+b?.order) ? +b.order : Number.POSITIVE_INFINITY;
        if (ao !== bo) return ao - bo;
        return normalizeStr(a?.label).localeCompare(normalizeStr(b?.label));
      });

      setText('discoveredCount', String(nodes.length));

      currentIndex = 0;
      buildPills();
      renderCurrent();
    }

    document.getElementById('btnPrev').onclick = () => {
      if (currentIndex > 0) {
        if (editMode) {
          if (!confirm('Discard changes and go to previous node?')) return;
          toggleEditMode(false);
        }
        currentIndex--;
        renderCurrent();
      }
    };

    document.getElementById('btnNext').onclick = () => {
      if (currentIndex < nodes.length - 1) {
        if (editMode) {
          if (!confirm('Discard changes and go to next node?')) return;
          toggleEditMode(false);
        }
        currentIndex++;
        renderCurrent();
      }
    };

    document.getElementById('btnReload').onclick = async () => {
      await init();
    };

    document.getElementById('btnToggleDebug').onclick = () => {
      debugOn = !debugOn;
      document.getElementById('debug').classList.toggle('hidden', !debugOn);
    };

    document.getElementById('btnToggleView').onclick = () => {
      setView(viewMode === 'ui' ? 'json' : 'ui');
    };

    document.getElementById('btnEditMode').onclick = () => {
      if (!editMode) {
        // Verify Superadmin access
        if (!isSuperadmin()) {
          alert('Edit mode is only available for Superadmin users.');
          return;
        }

        // Check if current node exists
        const n = nodes[currentIndex];
        if (!n) {
          alert('No node selected.');
          return;
        }

        // Check if node is editable (YouTube node, fulltext node, or has JSON data)
        const isYouTube = isYouTubeNode(n);
        const isFulltext = isFulltextNode(n);
        if (!isYouTube && !isFulltext) {
          const info = normalizeStr(n.info);
          const jsonData = extractJsonFromInfo(info);
          if (!jsonData) {
            alert('This node does not contain editable JSON data.');
            return;
          }
        }

        // Show user info in toolbar
        const userInfo = document.getElementById('editUserInfo');
        if (userInfo && currentUser) {
          userInfo.textContent = \`Editing as: \${currentUser.email || currentUser.username || 'Superadmin'}\`;
        }

        toggleEditMode(true);
      }
    };

    document.getElementById('btnSaveNode').onclick = () => {
      saveNode();
    };

    document.getElementById('btnCancelEdit').onclick = () => {
      if (confirm('Discard changes?')) {
        toggleEditMode(false);
      }
    };

    // ========== HEADER IMAGE EDITING ==========
    const btnEditHeaderImage = document.getElementById('btnEditHeaderImage');
    const headerImageEditor = document.getElementById('headerImageEditor');
    const headerImageUrl = document.getElementById('headerImageUrl');
    const headerImage = document.getElementById('headerImage');

    if (btnEditHeaderImage) {
      btnEditHeaderImage.onclick = () => {
        // Pre-fill with current image URL
        if (headerImageUrl && headerImage) {
          headerImageUrl.value = headerImage.src || '';
        }
        if (headerImageEditor) headerImageEditor.classList.remove('hidden');
        btnEditHeaderImage.classList.add('hidden');
      };
    }

    const btnApplyHeaderImage = document.getElementById('btnApplyHeaderImage');
    if (btnApplyHeaderImage) {
      btnApplyHeaderImage.onclick = async () => {
        const newUrl = headerImageUrl ? headerImageUrl.value.trim() : '';
        if (!newUrl) {
          alert('Please enter an image URL.');
          return;
        }
        // Update the image in the DOM
        if (headerImage) headerImage.src = newUrl;
        // Hide the editor
        if (headerImageEditor) headerImageEditor.classList.add('hidden');
        if (btnEditHeaderImage) btnEditHeaderImage.classList.remove('hidden');

        // Persist the change \u2014 patch the markdown-image node's path field
        try {
          if (!headerImageNode || !GRAPH_ID) {
            console.warn('No header image node found or no graph ID; cannot persist.');
            return;
          }
          await fetch('https://knowledge.vegvisr.org/patchNode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              graphId: GRAPH_ID,
              nodeId: headerImageNode.id,
              fields: { path: newUrl }
            })
          });
          // Update local reference
          headerImageNode.path = newUrl;
        } catch (err) {
          console.warn('Could not persist header image change:', err);
        }
      };
    }

    const btnCancelHeaderImage = document.getElementById('btnCancelHeaderImage');
    if (btnCancelHeaderImage) {
      btnCancelHeaderImage.onclick = () => {
        if (headerImageEditor) headerImageEditor.classList.add('hidden');
        if (btnEditHeaderImage) btnEditHeaderImage.classList.remove('hidden');
      };
    }

    // Hamburger menu toggle
    document.getElementById('hamburgerButton').onclick = () => {
      toggleSidebar();
    };

    // Close sidebar when clicking the backdrop (touch devices only)
    document.getElementById('sidebarBackdrop').onclick = () => {
      if (sidebarOpen && window.matchMedia('(hover: none) and (pointer: coarse)').matches) {
        toggleSidebar(false);
      }
    };

    // Close sidebar when clicking outside (touch devices only)
    document.addEventListener('click', (e) => {
      if (!window.matchMedia('(hover: none) and (pointer: coarse)').matches) {
        return;
      }
      if (sidebarOpen && nodesLayoutMode === 'sidebar') {
        const sidebar = document.getElementById('sidebarNav');
        const hamburger = document.getElementById('hamburgerButton');

        // If click is outside sidebar and hamburger button
        if (!sidebar.contains(e.target) && !hamburger.contains(e.target)) {
          toggleSidebar(false);
        }
      }
    });

    async function init() {
      try {
        // Load user authentication first
        loadUserFromStorage();
        updateEditButtonVisibility();

        setText('nodeMeta', 'Loading\u2026');
        setText('nodeTitle', 'Loading\u2026');
        setHTML('nodeIntro', '');
        setHTML('nodePreview', '<div class="soft text-sm">Fetching graph data\u2026</div>');
        document.getElementById('jsonView').textContent = '';
        setView('ui');
        await loadGraph();

        // Log authentication status for debugging
        if (isSuperadmin()) {
          console.log('Superadmin access granted. Edit mode available.');
        } else {
          console.log('User is not Superadmin or not logged in. Edit mode hidden.');
        }
      } catch (e) {
        setText('nodeMeta', 'Error');
        setText('nodeTitle', 'Could not load graph');
        setHTML('nodeIntro', '');
        setHTML('nodePreview', \`<div class="muted text-sm"><code>\${String(e.message || e)}</code></div>\`);
        setText('discoveredCount', '\u2014');
      }
    }

    // Listen for storage changes (e.g., login/logout in another tab)
    window.addEventListener('storage', (e) => {
      if (['userStore', 'user', 'currentUser', 'auth', 'token'].includes(e.key)) {
        loadUserFromStorage();
        updateEditButtonVisibility();
        updateLoginButton();
        if (editMode && !isSuperadmin()) {
          // User logged out or lost Superadmin role - exit edit mode
          toggleEditMode(false);
        }
      }
    });

    // ========== MAGIC LINK LOGIN ==========

    // Use the same auth endpoints as photos-vegvisr and my-test-app
    const AUTH_BASE = 'https://cookie.vegvisr.org';
    const DASHBOARD_BASE = 'https://dashboard.vegvisr.org';

    function showLoginModal() {
      console.log('showLoginModal called');
      const modal = document.getElementById('loginModal');
      modal.classList.remove('hidden');
      document.getElementById('loginEmailSection').classList.remove('hidden');
      document.getElementById('loginCheckSection').classList.add('hidden');
      document.getElementById('loginStatus').classList.add('hidden');
      document.getElementById('loginEmail').value = localStorage.getItem('vegvisr_connect_email') || '';
      document.getElementById('loginEmail').focus();
    }

    function hideLoginModal() {
      document.getElementById('loginModal').classList.add('hidden');
    }

    function setLoginStatus(message, type = 'info') {
      const statusEl = document.getElementById('loginStatus');
      statusEl.textContent = message;
      statusEl.className = 'login-status ' + type;
      statusEl.classList.remove('hidden');
    }

    async function sendMagicLink() {
      const email = document.getElementById('loginEmail').value.trim();

      if (!email || !email.includes('@')) {
        setLoginStatus('Please enter a valid email address.', 'error');
        return;
      }

      const btn = document.getElementById('btnSendMagicLink');
      btn.disabled = true;
      btn.textContent = 'Sending...';

      try {
        // Store email for convenience
        localStorage.setItem('vegvisr_connect_email', email);

        // Build the redirect URL - this is where the user will be sent back after clicking the magic link
        // IMPORTANT: This tells the backend to redirect back to THIS page, not to connect.vegvisr.org
        const redirectUrl = window.location.origin + window.location.pathname;
        console.log('Sending magic link with redirectUrl:', redirectUrl);

        const response = await fetch(\`\${AUTH_BASE}/login/magic/send\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            redirectUrl  // Tell the backend to redirect back to THIS page
          })
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || data.message || 'Failed to send magic link');
        }

        // Show the "check email" section
        document.getElementById('loginEmailSection').classList.add('hidden');
        document.getElementById('loginCheckSection').classList.remove('hidden');
        document.getElementById('sentToEmail').textContent = email;
        setLoginStatus('Magic link sent! Check your email inbox.', 'success');

      } catch (err) {
        console.error('Magic link request error:', err);
        setLoginStatus('Error: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Send Magic Link';
      }
    }

    async function verifyMagicLinkToken(token) {
      try {
        console.log('Verifying magic link token...');
        setLoginStatus('Verifying...', 'info');

        // Use GET request with token as query parameter (as per vegvisr-ui-kit implementation)
        const response = await fetch(\`\${AUTH_BASE}/login/magic/verify?token=\${encodeURIComponent(token)}\`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Invalid or expired magic link');
        }

        console.log('Magic link verified, email:', data.email);

        // Now fetch user context from dashboard to get role info
        let userContext = null;
        try {
          userContext = await fetchUserContext(data.email);
          console.log('User context fetched:', userContext);
        } catch (err) {
          console.log('Could not fetch user context, using basic info:', err.message);
          // Fallback to basic user info
          userContext = {
            email: data.email,
            role: 'user',
            user_id: data.email
          };
        }

        // Store user and token
        currentUser = userContext;
        authToken = data.token || data.accessToken || null;

        // Store in localStorage for persistence
        localStorage.setItem('userStore', JSON.stringify({
          user: currentUser,
          token: authToken
        }));

        if (authToken) {
          localStorage.setItem('token', authToken);
        }

        console.log('Login successful:', { email: currentUser.email, role: currentUser.role });

        // Update UI
        updateEditButtonVisibility();
        updateVisibilityToggleButtons();
        updateSuperadminButtonsVisibility();
        updateLoginButton();
        hideLoginModal();

        // Clear magic token from URL (the token comes as ?magic=xxx)
        const url = new URL(window.location.href);
        url.searchParams.delete('magic');
        window.history.replaceState({}, document.title, url.toString());

        // Show success message
        if (isSuperadmin()) {
          alert('Welcome, Superadmin! Edit mode is now available.');
        } else {
          alert('Login successful! Note: Edit mode is only available for Superadmin users.');
        }

      } catch (err) {
        console.error('Token verification error:', err);
        setLoginStatus('Verification failed: ' + err.message, 'error');
        showLoginModal();
      }
    }

    // Fetch user context (role, user_id, etc.) from dashboard
    // Uses the same two-step approach as photos-vegvisr:
    // 1. /get-role to get the user's role (Superadmin, Admin, user, etc.)
    // 2. /userdata to get the full user data
    async function fetchUserContext(email) {
      // Step 1: Fetch user role from dashboard
      const roleRes = await fetch(
        \`\${DASHBOARD_BASE}/get-role?email=\${encodeURIComponent(email)}\`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        }
      );

      if (!roleRes.ok) {
        throw new Error(\`User role unavailable (status: \${roleRes.status})\`);
      }

      const roleData = await roleRes.json();
      console.log('Role data from dashboard:', roleData);

      if (!roleData?.role) {
        throw new Error('Unable to retrieve user role.');
      }

      // Step 2: Fetch full user data
      const userDataRes = await fetch(
        \`\${DASHBOARD_BASE}/userdata?email=\${encodeURIComponent(email)}\`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        }
      );

      if (!userDataRes.ok) {
        throw new Error(\`Unable to fetch user data (status: \${userDataRes.status})\`);
      }

      const userData = await userDataRes.json();
      console.log('User data from dashboard:', userData);

      // Step 3: Return combined user context (same structure as photos-vegvisr)
      return {
        email: email,
        role: roleData.role,
        user_id: userData.user_id || email,
        emailVerificationToken: userData.emailVerificationToken || null,
        oauth_id: userData.oauth_id || null,
        phone: userData.phone || null,
        phoneVerifiedAt: userData.phoneVerifiedAt || null,
        branding: userData.branding || null,
        profileimage: userData.profileimage || null
      };
    }

    function updateLoginButton() {
      const loginBtn = document.getElementById('btnLogin');
      const logoutBtn = document.getElementById('btnLogout');

      if (currentUser) {
        // User is logged in - show email and logout button
        loginBtn.innerHTML = \`<span style="max-width: 150px; overflow: hidden; text-overflow: ellipsis;">\${escapeHtml(currentUser.email || 'Logged in')}\${isSuperadmin() ? ' (Superadmin)' : ''}</span>\`;
        loginBtn.title = \`Logged in as \${currentUser.email || 'user'}\${isSuperadmin() ? ' (Superadmin)' : ''}\`;
        loginBtn.onclick = null; // No action on click when logged in
        loginBtn.style.cursor = 'default';
        logoutBtn.classList.remove('hidden');
      } else {
        // User is not logged in
        loginBtn.textContent = 'Login';
        loginBtn.title = 'Login with magic link';
        loginBtn.onclick = showLoginModal;
        loginBtn.style.cursor = 'pointer';
        logoutBtn.classList.add('hidden');
      }
    }

    function handleLogout() {
      if (confirm('Are you sure you want to logout?')) {
        // Exit edit mode if active
        if (editMode) {
          toggleEditMode(false);
        }

        // Clear user data
        currentUser = null;
        authToken = null;

        // Clear storage
        localStorage.removeItem('userStore');
        localStorage.removeItem('user');
        localStorage.removeItem('currentUser');
        localStorage.removeItem('token');
        localStorage.removeItem('authToken');
        sessionStorage.clear();

        // Update UI
        updateEditButtonVisibility();
        updateVisibilityToggleButtons();
        updateSuperadminButtonsVisibility();
        updateLoginButton();

        console.log('Logged out successfully');
      }
    }

    // Login modal event listeners
    // NOTE: btnLogin onclick is set by updateLoginButton() based on login state

    document.getElementById('btnSendMagicLink').onclick = sendMagicLink;

    document.getElementById('btnCancelLogin').onclick = hideLoginModal;

    document.getElementById('btnResendLink').onclick = sendMagicLink;

    document.getElementById('btnLogout').onclick = handleLogout;

    document.getElementById('btnBackToEmail').onclick = () => {
      document.getElementById('loginEmailSection').classList.remove('hidden');
      document.getElementById('loginCheckSection').classList.add('hidden');
      document.getElementById('loginStatus').classList.add('hidden');
    };

    document.getElementById('loginEmail').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendMagicLink();
      }
    });

    // Close modal on overlay click
    document.getElementById('loginModal').onclick = (e) => {
      if (e.target.id === 'loginModal') {
        hideLoginModal();
      }
    };

    // Check for magic link token in URL on page load
    // The token comes as ?magic=xxx (as per vegvisr-ui-kit implementation)
    function checkForMagicLinkToken() {
      const urlParams = new URLSearchParams(window.location.search);
      // Look for 'magic' parameter (the standard for vegvisr apps)
      const token = urlParams.get('magic');

      if (token) {
        console.log('Magic link token found in URL (?magic=...), verifying...');
        verifyMagicLinkToken(token);
      }
    }

    // Modified init to also check for magic link token
    async function initWithMagicLink() {
      await init();
      checkForMagicLinkToken();
      updateLoginButton();
      updateVisibilityToggleButtons();
      updateSuperadminButtonsVisibility();

      // Load and initialize visibility settings
      await loadVisibilitySettings();
      initializeVisibilityControls();

      // === NEW: Apply initial layout ===
      applyNodesLayout();
      // === END NEW ===
    }

    initWithMagicLink();

    // ========== THEME PICKER ==========
    (function() {
      var KG_API = 'https://knowledge.vegvisr.org';
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
          var graphId = (typeof GRAPH_ID !== 'undefined') ? GRAPH_ID : null;
          var nodeId = (typeof NODE_ID !== 'undefined') ? NODE_ID : null;
          if (!graphId) { showToast('No GRAPH_ID \u2014 cannot save', false); return; }
          showToast('Saving theme...', true);

          // Fetch the full graph to find this node
          var res = await fetch(KG_API + '/getknowgraph?id=' + encodeURIComponent(graphId));
          if (!res.ok) { showToast('Failed to fetch graph', false); return; }
          var data = await res.json();
          var nodes = data.nodes || [];
          var targetNode = null;

          // Find the node by NODE_ID, or by matching html-node type
          for (var i = 0; i < nodes.length; i++) {
            if (nodeId && nodes[i].id === nodeId) { targetNode = nodes[i]; break; }
          }
          // Fallback: if no NODE_ID, find the first html-node with a :root block
          if (!targetNode && !nodeId) {
            for (var j = 0; j < nodes.length; j++) {
              if (nodes[j].type === 'html-node' && nodes[j].info && nodes[j].info.indexOf(':root') !== -1) {
                targetNode = nodes[j]; break;
              }
            }
          }
          if (!targetNode) { showToast('Node not found in graph', false); return; }

          // Replace the :root block in the node's HTML
          var html = targetNode.info || '';
          var rootBlock = buildRootBlock(themeVars);
          var replaced = html.replace(/:root\\s*\\{[^}]+\\}/, rootBlock);
          if (replaced === html) {
            // No :root found, inject before </style>
            replaced = html.replace('</style>', rootBlock + '\\n  </style>');
          }

          // Also inject/replace the data-vegvisr-theme style tag
          var themeStyle = '<style data-vegvisr-theme="' + (themeId || 'custom') + '">:root {\\n';
          var vkeys = Object.keys(themeVars);
          for (var k = 0; k < vkeys.length; k++) {
            themeStyle += '  ' + vkeys[k] + ': ' + themeVars[vkeys[k]] + ';\\n';
          }
          themeStyle += '}</style>';
          // Remove existing theme tag
          replaced = replaced.replace(/<style data-vegvisr-theme="[^"]*">:root\\s*\\{[^}]*\\}<\\/style>/g, '');
          // Inject new theme tag before </head>
          replaced = replaced.replace('</head>', themeStyle + '\\n</head>');

          // Patch the node
          var patchRes = await fetch(KG_API + '/patchNode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin' },
            body: JSON.stringify({ graphId: graphId, nodeId: targetNode.id, fields: { info: replaced } })
          });
          if (patchRes.ok) {
            showToast('Theme saved!', true);
            // Tell parent (GNewViewer) to reload graph so Vue picks up the new HTML
            if (window.parent && window.parent !== window) {
              window.parent.postMessage({ type: 'RELOAD_GRAPH' }, '*');
            }
            // If on a published domain (not in iframe), also re-publish the updated HTML to KV
            var isPublished = (window.parent === window) && window.location.hostname;
            if (isPublished) {
              var host = window.location.hostname;
              try {
                var pubRes = await fetch('https://test.slowyou.training/__html/publish', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ hostname: host, html: replaced, overwrite: true, graphId: graphId, nodeId: targetNode.id })
                });
                if (pubRes.ok) showToast('Published to ' + host, true);
              } catch (e2) { /* publish is best-effort */ }
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
        // Add mapped vars if source exists
        if (vars['--card'] && !vars['--card-bg']) {
          css += '  --card-bg: ' + vars['--card'] + ';\\n';
          css += '  --card-border: ' + vars['--card'] + ';\\n';
        }
        if (vars['--muted'] && !vars['--soft']) {
          css += '  --soft: ' + vars['--muted'] + ';\\n';
        }
        css += '}';
        return css;
      }

      // Parse :root CSS variables from HTML string
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

      // Apply CSS vars to :root (with variable mapping)
      function applyTokens(vars) {
        var root = document.documentElement;
        var keys = Object.keys(vars);
        for (var i = 0; i < keys.length; i++) {
          root.style.setProperty(keys[i], vars[keys[i]]);
        }
        // Map --card to --card-bg and --card-border if page uses those
        if (vars['--card'] && !vars['--card-bg']) {
          root.style.setProperty('--card-bg', vars['--card']);
          root.style.setProperty('--card-border', vars['--card']);
        }
        // Derive --soft from --muted if not present
        if (vars['--muted'] && !vars['--soft']) {
          root.style.setProperty('--soft', vars['--muted']);
        }
      }

      // Extract swatch colors from vars
      function getSwatches(vars) {
        var order = ['--bg1', '--bg', '--text', '--accent', '--accent2', '--card', '--card-bg'];
        var swatches = [];
        for (var i = 0; i < order.length; i++) {
          if (vars[order[i]]) swatches.push(vars[order[i]]);
          if (swatches.length >= 5) break;
        }
        // Fill from any remaining color vars
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

      // Inject theme CSS into <head>
      function injectThemeCss(themeId, vars) {
        // Remove existing injected theme
        var existing = document.querySelector('style[data-vegvisr-theme]');
        if (existing) existing.remove();
        // Build CSS
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

      // Fetch theme catalogs (graphs with isThemeGraph)
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

      // Fetch themes from a catalog graph
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
            if (Object.keys(vars).length < 3) continue; // Skip nodes without meaningful CSS vars
            themes.push({
              id: n.id,
              label: n.label || 'Untitled',
              vars: vars,
              swatches: getSwatches(vars)
            });
          }
          catalogCache[graphId] = themes;
          return themes;
        } catch (e) {
          pickerGrid.innerHTML = '<div class="theme-picker-loading">Failed to load themes</div>';
          return [];
        }
      }

      // Render tabs
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

      // Render theme grid
      function renderThemeGrid(themes) {
        pickerGrid.innerHTML = '';
        if (themes.length === 0) {
          pickerGrid.innerHTML = '<div class="theme-picker-loading">No themes found</div>';
          return;
        }
        // Check current active theme
        var activeTag = document.querySelector('style[data-vegvisr-theme]');
        var activeId = activeTag ? activeTag.getAttribute('data-vegvisr-theme') : '';

        for (var i = 0; i < themes.length; i++) {
          var t = themes[i];
          var card = document.createElement('div');
          card.className = 'theme-picker-card' + (t.id === activeId ? ' active' : '');
          // Swatches
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
              // Re-render to update active state
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

      // Load saved theme on startup
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

      // Toggle panel
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

      // Load saved theme on page ready
      loadSavedTheme();
    })();

  <\/script>
</body>
</html>
`;

// theme-builder-template.js
var THEME_BUILDER_TEMPLATE = `<!DOCTYPE html>
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
        document.title = graphTitle + ' \u2014 Theme Builder';
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
  <\/script>
</body>
</html>`;

// landing-page-template.js
var LANDING_PAGE_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <meta name="template-version" content="1.7.0" />
  <meta name="default-theme" content="{{DEFAULT_THEME}}" />
  <meta name="template-id" content="landing-page" />
  <title>{{TITLE}}</title>

  <!-- Marked for Markdown rendering -->
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>
  <!-- Mermaid for diagrams -->
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"><\/script>

  <style>
/* Theme variables \u2014 overridden by injected <style data-vegvisr-theme> */
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

/* data-node table + form */
    .data-node-container { margin: 1rem 0; }
    .data-node-table-wrap { overflow-x: auto; }
    .data-node-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    .data-node-table th { background: var(--accent, #2563eb); color: #fff; padding: 0.5rem 0.75rem; text-align: left; font-weight: 600; }
    .data-node-table td { padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--line, #e5e7eb); }
    .data-node-table tr:nth-child(even) { background: var(--surface, rgba(0,0,0,0.02)); }
    .data-node-table tr:hover { background: var(--surface, rgba(0,0,0,0.04)); }
    .data-node-empty { color: var(--soft, #6b7280); font-style: italic; margin-bottom: 1rem; }
    .data-node-header-image { margin-bottom: 1rem; border-radius: 8px; overflow: hidden; }
    .data-node-header-image img { width: 100%; max-height: 240px; object-fit: cover; display: block; }
    .data-node-form { margin-top: 1.5rem; max-width: 480px; }
    .data-node-form h3 { margin-bottom: 0.75rem; font-size: 1.1rem; }
    .data-node-field { margin-bottom: 0.75rem; }
    .data-node-field label { display: block; font-weight: 600; margin-bottom: 0.25rem; font-size: 0.85rem; }
    .data-node-field input, .data-node-field textarea, .data-node-field select {
      width: 100%; padding: 0.5rem; border: 1px solid var(--line, #d1d5db); border-radius: 6px;
      font-size: 0.9rem; background: #fff; color: #111;
    }
    .data-node-field textarea { min-height: 80px; resize: vertical; }
    .data-node-form button[type="submit"] {
      background: var(--accent, #2563eb); color: #fff; border: none; padding: 0.5rem 1.5rem;
      border-radius: 6px; cursor: pointer; font-size: 0.9rem; font-weight: 600;
    }
    .data-node-form button[type="submit"]:hover { opacity: 0.9; }
    .data-node-form button[type="submit"]:disabled { opacity: 0.5; cursor: not-allowed; }
    .data-node-msg { margin-top: 0.5rem; font-size: 0.85rem; }
    .data-node-msg.success { color: #16a34a; }
    .data-node-msg.error { color: #dc2626; }

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

  <!-- Theme Picker (visible to Superadmin only) -->
  <button id="btnThemePicker" class="theme-picker-btn hidden" title="Change theme">\u{1F3A8}</button>
  <div id="themePickerPanel" class="theme-picker-panel hidden">
    <div class="theme-picker-header">
      <span>Theme Catalog</span>
      <button id="btnCloseThemePicker">\u2715</button>
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
      // ALL string-based \u2014 no regex \u2014 to avoid template-literal escaping nightmares.
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

        // Text before FLEXBOX block \u2014 run through markdown + Vegvisr parser
        var before = remaining.slice(0, startIdx);
        if (before.trim()) {
          parts.push(parseVegvisrElements(marked.parse(before)));
        }

        // Extract type from the opening tag (e.g. "FLEXBOX-CARDS-3" \u2192 "CARDS-3")
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

    function getAuthHeaders() {
      if (authToken) return { 'Authorization': 'Bearer ' + authToken };
      return {};
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

        // 8. Show edit buttons + theme picker if Superadmin
        if (isSuperadmin()) {
          document.body.classList.add('landing-admin');
          var tpBtn = document.getElementById('btnThemePicker');
          if (tpBtn) tpBtn.classList.remove('hidden');
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

        if (node.type === 'data-node') {
          content.className += ' landing-data-node';
          await renderDataNodeSection(content, node);
        } else if (node.type === 'mermaid-diagram') {
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

    // ========== DATA-NODE RENDERING ==========
    async function renderDataNodeSection(container, node) {
      var records = [];
      try { records = JSON.parse(node.info || '[]'); } catch(e) { records = []; }
      if (!Array.isArray(records)) records = [];

      var schema = (node.metadata && node.metadata.schema) ? node.metadata.schema : null;
      var columns = (schema && Array.isArray(schema.columns)) ? schema.columns : null;

      // Auto-detect columns from first record if no schema
      if (!columns && records.length > 0) {
        columns = Object.keys(records[0]).filter(function(k) { return k.charAt(0) !== '_'; }).map(function(k) {
          return { key: k, label: k, type: 'text' };
        });
      }
      if (!columns) columns = [];

      var formTitle = (node.metadata && node.metadata.formTitle) ? node.metadata.formTitle : 'Submit';

      var drizzleTableId = (node.metadata && node.metadata.drizzleTableId) ? node.metadata.drizzleTableId : '';
      var html = '<div class="data-node-container" data-node-id="' + escapeHtml(node.id) + '" data-graph-id="' + escapeHtml(GRAPH_ID) + '"' + (drizzleTableId ? ' data-drizzle-table-id="' + escapeHtml(drizzleTableId) + '"' : '') + '>';

      // Header image
      var headerImage = (node.metadata && node.metadata.headerImage) ? node.metadata.headerImage : '';
      if (headerImage) {
        html += '<div class="data-node-header-image"><img src="' + escapeHtml(headerImage) + '" alt="' + escapeHtml(formTitle) + '"></div>';
      }

      // Table \u2014 only visible to Superadmin
      if (isSuperadmin() && records.length > 0) {
        html += '<div class="data-node-table-wrap"><table class="data-node-table"><thead><tr>';
        for (var c = 0; c < columns.length; c++) {
          html += '<th>' + escapeHtml(columns[c].label || columns[c].key) + '</th>';
        }
        html += '<th>Date</th></tr></thead><tbody>';
        for (var r = 0; r < records.length; r++) {
          html += '<tr>';
          for (var c2 = 0; c2 < columns.length; c2++) {
            var val = records[r][columns[c2].key];
            html += '<td>' + escapeHtml(val != null ? String(val) : '') + '</td>';
          }
          var ts = records[r]._ts ? new Date(records[r]._ts).toLocaleDateString() : '';
          html += '<td>' + escapeHtml(ts) + '</td>';
          html += '</tr>';
        }
        html += '</tbody></table></div>';
      } else if (isSuperadmin()) {
        html += '<p class="data-node-empty">No submissions yet.</p>';
      }

      // Form
      html += '<form class="data-node-form" autocomplete="off" onsubmit="event.preventDefault(); submitDataNodeForm(this)">';
      html += '<h3>' + escapeHtml(formTitle) + '</h3>';
      for (var f = 0; f < columns.length; f++) {
        var col = columns[f];
        var inputType = col.type || 'text';
        html += '<div class="data-node-field">';
        html += '<label>' + escapeHtml(col.label || col.key) + '</label>';
        if (inputType === 'textarea') {
          html += '<textarea name="' + escapeHtml(col.key) + '" autocomplete="off"></textarea>';
        } else if (inputType === 'select' && Array.isArray(col.options)) {
          html += '<select name="' + escapeHtml(col.key) + '">';
          for (var o = 0; o < col.options.length; o++) {
            html += '<option value="' + escapeHtml(col.options[o]) + '">' + escapeHtml(col.options[o]) + '</option>';
          }
          html += '</select>';
        } else {
          html += '<input type="' + escapeHtml(inputType) + '" name="' + escapeHtml(col.key) + '" autocomplete="off">';
        }
        html += '</div>';
      }
      html += '<button type="submit">Submit</button>';
      html += '<div class="data-node-msg" style="display:none;"></div>';
      html += '</form>';
      html += '</div>';

      container.innerHTML = html;
    }

    async function submitDataNodeForm(formEl) {
      var AGENT_API = 'https://agent.vegvisr.org';
      var container = formEl.closest('.data-node-container');
      var nodeId = container.dataset.nodeId;
      var graphId = container.dataset.graphId;
      var submitBtn = formEl.querySelector('button[type="submit"]');
      var msgEl = formEl.querySelector('.data-node-msg');

      submitBtn.disabled = true;
      msgEl.style.display = 'none';

      // Collect form values
      var record = {};
      var inputs = formEl.querySelectorAll('input, textarea, select');
      for (var i = 0; i < inputs.length; i++) {
        if (inputs[i].name) {
          record[inputs[i].name] = inputs[i].value;
        }
      }

      try {
        // Check if form is backed by a Drizzle D1 table
        var drizzleTableId = container.dataset.drizzleTableId;
        var res;
        if (drizzleTableId) {
          // Submit directly to drizzle-worker
          res = await fetch('https://drizzle.vegvisr.org/insert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tableId: drizzleTableId, record: record })
          });
        } else {
          // Fallback: submit via agent-worker proxy (data-node, handles encryption)
          res = await fetch(AGENT_API + '/api/data-node/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ graphId: graphId, nodeId: nodeId, record: record })
          });
        }
        if (!res.ok) {
          var errData = await res.json().catch(function() { return {}; });
          throw new Error(errData.error || 'Failed to save data');
        }
        var result = await res.json();

        // Reload page to show updated table with new record
        setTimeout(function() { window.location.reload(); }, 1500);

        // Clear form and show success
        formEl.reset();
        msgEl.className = 'data-node-msg success';
        msgEl.textContent = 'Submitted successfully!';
        msgEl.style.display = 'block';
        setTimeout(function() { msgEl.style.display = 'none'; }, 3000);
      } catch (err) {
        console.error('Data node submit error:', err);
        msgEl.className = 'data-node-msg error';
        msgEl.textContent = 'Error: ' + err.message;
        msgEl.style.display = 'block';
      } finally {
        submitBtn.disabled = false;
      }
      return false;
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
      if (node.type === 'data-node') {
        contentDiv.className += ' landing-data-node';
        await renderDataNodeSection(contentDiv, node);
      } else if (isMermaid) {
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
          if (!graphId) { showToast('No GRAPH_ID \u2014 cannot save', false); return; }
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

      // Auto-apply default theme from meta tag if no theme is already saved in the HTML
      (async function loadDefaultTheme() {
        var existing = document.querySelector('style[data-vegvisr-theme]');
        if (existing) return; // already has a theme saved \u2014 skip
        var meta = document.querySelector('meta[name="default-theme"]');
        var defaultThemeId = meta ? meta.getAttribute('content') : '';
        if (!defaultThemeId) return;
        try {
          await fetchCatalogs();
          for (var c = 0; c < catalogs.length; c++) {
            var themes = await fetchThemes(catalogs[c].id);
            for (var t = 0; t < themes.length; t++) {
              if (themes[t].id === defaultThemeId || themes[t].label.toLowerCase() === defaultThemeId.toLowerCase()) {
                applyTokens(themes[t].vars);
                injectThemeCss(themes[t].id, themes[t].vars);
                return;
              }
            }
          }
        } catch (e) { console.warn('Default theme load failed:', e); }
      })();
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

        // Show edit buttons + theme picker if Superadmin
        if (isSuperadmin()) {
          document.body.classList.add('landing-admin');
          var tpBtn2 = document.getElementById('btnThemePicker');
          if (tpBtn2) tpBtn2.classList.remove('hidden');
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
        var tpBtn3 = document.getElementById('btnThemePicker');
        if (isSuperadmin()) {
          document.body.classList.add('landing-admin');
          if (tpBtn3) tpBtn3.classList.remove('hidden');
        } else {
          document.body.classList.remove('landing-admin');
          if (tpBtn3) tpBtn3.classList.add('hidden');
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

// agent-chat-template.js
var AGENT_CHAT_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <meta name="template-version" content="1.0.0" />
  <meta name="template-id" content="agent-chat" />
  <title>{{TITLE}}</title>

  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>

  <style>
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

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      color: var(--text);
      background-color: var(--bg1);
      background-image: radial-gradient(ellipse at 20% 50%, color-mix(in srgb, var(--accent2) 8%, transparent) 0%, transparent 60%),
                         radial-gradient(ellipse at 80% 20%, color-mix(in srgb, var(--accent) 6%, transparent) 0%, transparent 50%);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* Header */
    .chat-header {
      display: flex;
      align-items: center;
      padding: 10px 16px;
      border-bottom: 1px solid var(--line);
      background-color: var(--bg1);
      backdrop-filter: blur(12px);
      z-index: 10;
      flex-shrink: 0;
    }
    .chat-header-left { display: flex; align-items: center; gap: 10px; }
    .chat-title { font-size: 1.1rem; font-weight: 600; color: var(--text); }
    .chat-header-center { flex: 1; display: flex; justify-content: center; }
    .chat-header-right { display: flex; gap: 6px; }
    .graph-selector {
      padding: 6px 12px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: var(--card-bg);
      color: var(--text);
      font-size: 13px;
      max-width: 300px;
    }
    .graph-selector option { background: var(--bg1); color: var(--text); }
    .nav-btn {
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
    .nav-btn:hover { background: var(--card-bg); color: var(--text); }
    .hidden { display: none !important; }

    /* Messages */
    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .chat-welcome {
      text-align: center;
      padding: 60px 20px;
      color: var(--muted);
    }
    .chat-welcome h2 { color: var(--text); margin-bottom: 12px; font-size: 1.5rem; }
    .chat-welcome p { font-size: 1rem; line-height: 1.6; max-width: 500px; margin: 0 auto; }

    .chat-message {
      max-width: 80%;
      padding: 12px 16px;
      border-radius: var(--radius);
      line-height: 1.55;
      font-size: 0.95rem;
      word-wrap: break-word;
    }
    .chat-message.user {
      align-self: flex-end;
      background: color-mix(in srgb, var(--accent) 16%, transparent);
      border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
      color: var(--text);
    }
    .chat-message.assistant {
      align-self: flex-start;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      color: var(--text);
    }

    /* Markdown in assistant messages */
    .assistant-text h1, .assistant-text h2, .assistant-text h3 { margin: 0.5em 0 0.3em; }
    .assistant-text p { margin: 0.4em 0; }
    .assistant-text a { color: var(--accent); }
    .assistant-text code {
      background: rgba(0,0,0,0.3);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.9em;
      font-family: 'Monaco','Menlo','Courier New',monospace;
    }
    .assistant-text pre {
      background: rgba(0,0,0,0.3);
      padding: 12px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 8px 0;
    }
    .assistant-text pre code { background: none; padding: 0; }
    .assistant-text ul, .assistant-text ol { padding-left: 1.4em; margin: 0.4em 0; }
    .assistant-text table { border-collapse: collapse; width: 100%; margin: 8px 0; }
    .assistant-text th, .assistant-text td { padding: 6px 10px; border: 1px solid var(--line); text-align: left; }
    .assistant-text th { background: var(--card-bg); }
    .assistant-text blockquote { border-left: 3px solid var(--accent); padding-left: 12px; color: var(--muted); margin: 8px 0; }

    /* Tool call cards */
    .tool-call-card {
      margin: 8px 0;
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
      font-size: 13px;
    }
    .tool-call-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: var(--card-bg);
      cursor: pointer;
      user-select: none;
    }
    .tool-call-header:hover { background: color-mix(in srgb, var(--card-bg) 80%, var(--text) 5%); }
    .tool-icon { font-size: 14px; }
    .tool-name { font-weight: 600; color: var(--text); }
    .tool-status { margin-left: auto; font-size: 12px; }
    .tool-status.running { color: var(--accent); }
    .tool-status.success { color: #22c55e; }
    .tool-status.error { color: #ef4444; }
    .tool-chevron { font-size: 10px; color: var(--muted); transition: transform 0.15s; }
    .tool-call-card.expanded .tool-chevron { transform: rotate(90deg); }
    .tool-call-details {
      display: none;
      padding: 8px 12px;
      border-top: 1px solid var(--line);
      background: rgba(0,0,0,0.15);
    }
    .tool-call-card.expanded .tool-call-details { display: block; }
    .tool-call-details pre {
      margin: 0;
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-all;
      color: var(--muted);
      font-family: 'Monaco','Menlo','Courier New',monospace;
    }

    /* Thinking indicator */
    .thinking-indicator {
      display: flex;
      gap: 4px;
      padding: 4px 0;
    }
    .thinking-indicator span {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent);
      opacity: 0.4;
      animation: pulse 1.4s ease-in-out infinite;
    }
    .thinking-indicator span:nth-child(2) { animation-delay: 0.2s; }
    .thinking-indicator span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }

    /* Input area */
    .chat-input-area {
      padding: 12px 16px;
      border-top: 1px solid var(--line);
      background-color: var(--bg1);
      flex-shrink: 0;
    }
    .chat-input-wrapper {
      display: flex;
      gap: 8px;
      max-width: 900px;
      margin: 0 auto;
      align-items: flex-end;
    }
    .chat-input-wrapper textarea {
      flex: 1;
      padding: 10px 14px;
      background: var(--card-bg);
      border: 1px solid var(--line);
      border-radius: 12px;
      color: var(--text);
      font-size: 0.95rem;
      font-family: inherit;
      resize: none;
      line-height: 1.5;
      max-height: 200px;
      overflow-y: auto;
    }
    .chat-input-wrapper textarea:focus {
      outline: none;
      border-color: color-mix(in srgb, var(--accent) 50%, transparent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent);
    }
    .chat-send-btn {
      padding: 10px 20px;
      border-radius: 12px;
      border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
      background: color-mix(in srgb, var(--accent) 16%, transparent);
      color: var(--text);
      font-size: 0.95rem;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s;
    }
    .chat-send-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 24%, transparent); }
    .chat-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    .error-text { color: #ef4444; }

    /* Login Modal */
    .login-modal-overlay {
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.6);
      display: flex; align-items: center; justify-content: center;
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
      width: 100%; padding: 12px 14px;
      background: rgba(0,0,0,0.3); border: 1px solid var(--line);
      border-radius: 8px; color: var(--text); font-size: 1rem; box-sizing: border-box;
    }
    .login-modal input:focus { outline: none; border-color: color-mix(in srgb, var(--accent) 50%, transparent); }
    .login-modal .btn-group { display: flex; gap: 10px; margin-top: 20px; }
    .login-modal .btn-primary {
      flex: 1; padding: 12px 20px;
      background: color-mix(in srgb, var(--accent) 20%, transparent);
      border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
      border-radius: 8px; color: var(--text); font-size: 1rem; cursor: pointer;
    }
    .login-modal .btn-primary:hover { background: color-mix(in srgb, var(--accent) 30%, transparent); }
    .login-modal .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .login-modal .btn-secondary {
      padding: 12px 20px; background: var(--card-bg);
      border: 1px solid var(--line); border-radius: 8px;
      color: var(--text); font-size: 1rem; cursor: pointer;
    }
    .login-status { margin-top: 12px; padding: 10px; border-radius: 8px; font-size: 0.9rem; }
    .login-status.info { background: color-mix(in srgb, var(--accent) 10%, transparent); border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent); color: var(--text); }
    .login-status.success { background: rgba(74,222,128,0.1); border: 1px solid rgba(74,222,128,0.25); color: #4ade80; }
    .login-status.error { background: rgba(248,113,113,0.1); border: 1px solid rgba(248,113,113,0.25); color: #f87171; }

    /* Responsive */
    @media (max-width: 768px) {
      .chat-message { max-width: 95%; }
      .chat-header-center { display: none; }
      .graph-selector { max-width: 150px; }
    }
  </style>
</head>
<body>

  <!-- Header -->
  <header class="chat-header">
    <div class="chat-header-left">
      <span class="chat-title">{{TITLE}}</span>
    </div>
    <div class="chat-header-center">
      <select id="graphSelector" class="graph-selector">
        <option value="">No graph context</option>
      </select>
    </div>
    <div class="chat-header-right">
      <button type="button" id="btnLogin" class="nav-btn">Login</button>
      <button type="button" id="btnLogout" class="nav-btn hidden">Logout</button>
    </div>
  </header>

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
        <p style="margin-bottom:16px;">Magic link sent to <strong id="sentToEmail"></strong>. Check your email.</p>
        <div class="btn-group">
          <button type="button" id="btnResendLink" class="btn-secondary">Resend</button>
          <button type="button" id="btnBackToEmail" class="btn-secondary">Different Email</button>
        </div>
      </div>
      <div id="loginStatus" class="login-status hidden"></div>
    </div>
  </div>

  <!-- Messages -->
  <main id="chatMessages" class="chat-messages">
    <div class="chat-welcome">
      <h2>Vegvisr Agent Chat</h2>
      <p>I can help you create knowledge graphs, build HTML pages, modify content, and manage your apps. What would you like to do?</p>
    </div>
  </main>

  <!-- Input -->
  <div class="chat-input-area">
    <div class="chat-input-wrapper">
      <textarea id="chatInput" placeholder="Type your message..." rows="1"></textarea>
      <button id="btnSend" class="chat-send-btn" disabled>Send</button>
    </div>
  </div>

  <script>
    var GRAPH_ID = '{{GRAPH_ID_DEFAULT}}';
    var NODE_ID = '{{NODE_ID}}';
    var AGENT_API = 'https://agent.vegvisr.org';
    var KG_API = 'https://knowledge.vegvisr.org';
    var AUTH_BASE = 'https://cookie.vegvisr.org';
    var DASHBOARD_BASE = 'https://dashboard.vegvisr.org';

    var messages = [];
    var currentUser = null;
    var authToken = null;
    var isStreaming = false;

    // ========== UTILITIES ==========

    function escapeHtml(str) {
      if (typeof str !== 'string') return '';
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function scrollToBottom() {
      var el = document.getElementById('chatMessages');
      el.scrollTop = el.scrollHeight;
    }

    function updateSendButton() {
      var btn = document.getElementById('btnSend');
      var input = document.getElementById('chatInput');
      btn.disabled = isStreaming || !input.value.trim();
      btn.textContent = isStreaming ? '...' : 'Send';
    }

    // ========== AUTH ==========

    function isSuperadmin() {
      if (!currentUser) return false;
      var role = currentUser.role || currentUser.userRole || currentUser.roles;
      if (typeof role === 'string') return role.toLowerCase() === 'superadmin';
      if (Array.isArray(role)) {
        for (var r = 0; r < role.length; r++) {
          var rn = typeof role[r] === 'string' ? role[r] : (role[r].name || '');
          if (rn.toLowerCase() === 'superadmin') return true;
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
                authToken = parsed.token || parsed.accessToken || parsed.authToken || localStorage.getItem('token');
                return true;
              }
            } catch (e) {}
          }
        }
        for (var s = 0; s < keys.length; s++) {
          var ss = sessionStorage.getItem(keys[s]);
          if (ss) {
            try {
              var sp = JSON.parse(ss);
              var su = sp.user || sp.currentUser || sp;
              if (su && (su.role || su.userRole || su.roles || su.email)) {
                currentUser = su;
                authToken = sp.token || sp.accessToken || sp.authToken || sessionStorage.getItem('token');
                return true;
              }
            } catch (e) {}
          }
        }
        if (window.__VEGVISR_USER) {
          currentUser = window.__VEGVISR_USER;
          authToken = window.__VEGVISR_TOKEN;
          return true;
        }
      } catch (e) {}
      return false;
    }

    function updateLoginButton() {
      var loginBtn = document.getElementById('btnLogin');
      var logoutBtn = document.getElementById('btnLogout');
      if (currentUser) {
        var name = escapeHtml(currentUser.email || 'Logged in');
        if (isSuperadmin()) name += ' (SA)';
        loginBtn.innerHTML = name;
        loginBtn.onclick = null;
        loginBtn.style.cursor = 'default';
        logoutBtn.classList.remove('hidden');
      } else {
        loginBtn.textContent = 'Login';
        loginBtn.onclick = showLoginModal;
        loginBtn.style.cursor = 'pointer';
        logoutBtn.classList.add('hidden');
      }
    }

    function showLoginModal() {
      document.getElementById('loginModal').classList.remove('hidden');
      document.getElementById('loginEmailSection').classList.remove('hidden');
      document.getElementById('loginCheckSection').classList.add('hidden');
      document.getElementById('loginStatus').classList.add('hidden');
      var emailInput = document.getElementById('loginEmail');
      emailInput.value = localStorage.getItem('vegvisr_connect_email') || '';
      emailInput.focus();
    }

    function hideLoginModal() { document.getElementById('loginModal').classList.add('hidden'); }

    function setLoginStatus(msg, type) {
      var el = document.getElementById('loginStatus');
      el.textContent = msg;
      el.className = 'login-status ' + (type || 'info');
      el.classList.remove('hidden');
    }

    async function sendMagicLink() {
      var email = document.getElementById('loginEmail').value.trim();
      if (!email || email.indexOf('@') === -1) { setLoginStatus('Please enter a valid email.', 'error'); return; }
      var btn = document.getElementById('btnSendMagicLink');
      btn.disabled = true; btn.textContent = 'Sending...';
      try {
        localStorage.setItem('vegvisr_connect_email', email);
        var res = await fetch(AUTH_BASE + '/login/magic/send', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, redirectUrl: window.location.origin + window.location.pathname })
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        document.getElementById('loginEmailSection').classList.add('hidden');
        document.getElementById('loginCheckSection').classList.remove('hidden');
        document.getElementById('sentToEmail').textContent = email;
        setLoginStatus('Magic link sent! Check your email.', 'success');
      } catch (err) { setLoginStatus('Error: ' + err.message, 'error'); }
      finally { btn.disabled = false; btn.textContent = 'Send Magic Link'; }
    }

    async function verifyMagicLinkToken(token) {
      try {
        showLoginModal(); setLoginStatus('Verifying...', 'info');
        var res = await fetch(AUTH_BASE + '/login/magic/verify?token=' + encodeURIComponent(token));
        var data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Invalid token');
        var userCtx = { email: data.email, role: 'user', user_id: data.email };
        try {
          var roleRes = await fetch(DASHBOARD_BASE + '/get-role?email=' + encodeURIComponent(data.email));
          var roleData = await roleRes.json();
          userCtx.role = roleData.role || 'user';
        } catch (e) {}
        currentUser = userCtx;
        authToken = data.token || null;
        localStorage.setItem('userStore', JSON.stringify({ user: currentUser, token: authToken }));
        if (authToken) localStorage.setItem('token', authToken);
        updateLoginButton(); hideLoginModal();
        var url = new URL(window.location.href);
        url.searchParams.delete('magic');
        window.history.replaceState({}, document.title, url.toString());
      } catch (err) { setLoginStatus('Failed: ' + err.message, 'error'); }
    }

    function handleLogout() {
      if (!confirm('Logout?')) return;
      currentUser = null; authToken = null;
      localStorage.removeItem('userStore'); localStorage.removeItem('token');
      localStorage.removeItem('user'); localStorage.removeItem('authToken');
      try { sessionStorage.clear(); } catch(e) {}
      updateLoginButton();
    }

    // ========== GRAPH SELECTOR ==========

    async function loadGraphSelector() {
      try {
        var res = await fetch(KG_API + '/getknowgraphsummaries?offset=0&limit=50');
        var data = await res.json();
        var sel = document.getElementById('graphSelector');
        var results = data.results || [];
        for (var i = 0; i < results.length; i++) {
          var g = results[i];
          var opt = document.createElement('option');
          opt.value = g.id;
          opt.textContent = (g.metadata_title || g.id).slice(0, 50);
          if (g.id === GRAPH_ID) opt.selected = true;
          sel.appendChild(opt);
        }
      } catch (e) { console.error('Failed to load graphs:', e); }
    }

    document.getElementById('graphSelector').addEventListener('change', function() {
      GRAPH_ID = this.value;
    });

    // ========== CHAT ==========

    function renderToolCallCard(data) {
      var card = document.createElement('div');
      card.className = 'tool-call-card';
      var inputStr = '';
      try { inputStr = JSON.stringify(data.input, null, 2); } catch(e) { inputStr = String(data.input); }
      card.innerHTML = '<div class="tool-call-header">' +
        '<span class="tool-icon">&#x1f527;</span> ' +
        '<span class="tool-name">' + escapeHtml(data.tool) + '</span>' +
        '<span class="tool-status ' + (data.status || 'running') + '">' + (data.status === 'running' ? 'Running...' : '') + '</span>' +
        '<span class="tool-chevron">&#x25B6;</span>' +
        '</div>' +
        '<div class="tool-call-details"><pre>' + escapeHtml(inputStr) + '</pre></div>';
      card.querySelector('.tool-call-header').addEventListener('click', function() {
        card.classList.toggle('expanded');
      });
      return card;
    }

    function updateToolCallCard(card, data) {
      var statusEl = card.querySelector('.tool-status');
      statusEl.className = 'tool-status ' + (data.success ? 'success' : 'error');
      statusEl.textContent = data.success ? (data.summary || 'Done') : 'Failed';
      var details = card.querySelector('.tool-call-details');
      var resultStr = '';
      try { resultStr = JSON.stringify(data, null, 2).slice(0, 1000); } catch(e) { resultStr = String(data); }
      details.innerHTML += '<hr style="border:none;border-top:1px solid var(--line);margin:6px 0;"><pre>' + escapeHtml(resultStr) + '</pre>';
    }

    function handleSSEEvent(event, data, targetDiv, toolCalls) {
      if (event === 'thinking') {
        var existing = targetDiv.querySelector('.thinking-indicator');
        if (!existing) {
          targetDiv.innerHTML = '<div class="thinking-indicator"><span></span><span></span><span></span></div>';
        }
      } else if (event === 'tool_call') {
        var thinking = targetDiv.querySelector('.thinking-indicator');
        if (thinking) thinking.remove();
        var card = renderToolCallCard({ tool: data.tool, input: data.input, status: 'running' });
        targetDiv.appendChild(card);
        toolCalls.push({ element: card, tool: data.tool });
      } else if (event === 'tool_result') {
        for (var i = toolCalls.length - 1; i >= 0; i--) {
          if (toolCalls[i].tool === data.tool) {
            updateToolCallCard(toolCalls[i].element, data);
            break;
          }
        }
      } else if (event === 'text') {
        var th = targetDiv.querySelector('.thinking-indicator');
        if (th) th.remove();
        var textContainer = targetDiv.querySelector('.assistant-text');
        if (!textContainer) {
          textContainer = document.createElement('div');
          textContainer.className = 'assistant-text';
          textContainer.setAttribute('data-raw', '');
          targetDiv.appendChild(textContainer);
        }
        var raw = textContainer.getAttribute('data-raw') + data.content;
        textContainer.setAttribute('data-raw', raw);
        textContainer.innerHTML = marked.parse(raw);
      } else if (event === 'error') {
        var th2 = targetDiv.querySelector('.thinking-indicator');
        if (th2) th2.remove();
        targetDiv.innerHTML += '<div class="error-text">Error: ' + escapeHtml(data.error) + '</div>';
      }
      scrollToBottom();
    }

    async function sendMessage() {
      var input = document.getElementById('chatInput');
      var text = input.value.trim();
      if (!text || isStreaming) return;

      input.value = '';
      input.style.height = 'auto';
      isStreaming = true;
      updateSendButton();

      // Remove welcome
      var welcome = document.querySelector('.chat-welcome');
      if (welcome) welcome.remove();

      // Add user message
      messages.push({ role: 'user', content: text });
      var userDiv = document.createElement('div');
      userDiv.className = 'chat-message user';
      userDiv.textContent = text;
      document.getElementById('chatMessages').appendChild(userDiv);
      scrollToBottom();

      // Create assistant placeholder
      var assistantDiv = document.createElement('div');
      assistantDiv.className = 'chat-message assistant';
      document.getElementById('chatMessages').appendChild(assistantDiv);

      var assistantText = '';
      var toolCalls = [];

      try {
        var userId = currentUser ? (currentUser.user_id || currentUser.email || 'anonymous') : 'anonymous';
        var response = await fetch(AGENT_API + '/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: userId,
            messages: messages,
            graphId: GRAPH_ID || undefined
          })
        });

        if (!response.ok) {
          var errData = {};
          try { errData = await response.json(); } catch(e) {}
          throw new Error(errData.error || 'Request failed: ' + response.status);
        }

        var reader = response.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';
        var currentEvent = '';

        while (true) {
          var chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });

          var lines = buffer.split('\\n');
          buffer = lines.pop();

          for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (line.indexOf('event: ') === 0) {
              currentEvent = line.slice(7);
            } else if (line.indexOf('data: ') === 0) {
              try {
                var evtData = JSON.parse(line.slice(6));
                handleSSEEvent(currentEvent, evtData, assistantDiv, toolCalls);
                if (currentEvent === 'text') {
                  assistantText += evtData.content;
                }
              } catch (parseErr) {
                console.error('SSE parse error:', parseErr);
              }
            }
          }
        }

        if (assistantText) {
          messages.push({ role: 'assistant', content: assistantText });
        }

      } catch (err) {
        assistantDiv.innerHTML = '<div class="error-text">Error: ' + escapeHtml(err.message) + '</div>';
      }

      isStreaming = false;
      updateSendButton();
      scrollToBottom();
    }

    // ========== EVENT WIRING ==========

    document.getElementById('btnSend').onclick = sendMessage;
    document.getElementById('chatInput').addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    document.getElementById('chatInput').addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 200) + 'px';
      updateSendButton();
    });

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

    // ========== INITIALIZE ==========

    loadUserFromStorage();
    updateLoginButton();
    loadGraphSelector();

    var params = new URLSearchParams(window.location.search);
    var magicToken = params.get('magic');
    if (magicToken) verifyMagicLinkToken(magicToken);

  <\/script>
</body>
</html>`;

// template-registry.js
var TEMPLATES = {
  "editable-page": {
    id: "editable-page",
    template: EDITABLE_HTML_TEMPLATE,
    description: "Full-featured editable HTML page with navigation, markdown rendering, and edit mode.",
    placeholders: {
      "{{TITLE}}": "Page title (in <title>, h1, and img alt)",
      "{{DESCRIPTION}}": "Page description/subtitle shown below the title",
      "{{HEADER_IMAGE}}": "URL for the header image",
      "{{FOOTER_TEXT}}": "Footer text content",
      "{{GRAPH_ID_DEFAULT}}": "Fallback graph ID"
    }
  },
  "theme-builder": {
    id: "theme-builder",
    template: THEME_BUILDER_TEMPLATE,
    description: "CSS variable/design token editor. Loads css-nodes from a knowledge graph, provides visual editing with color pickers, and saves back to KG.",
    placeholders: {
      "{{TITLE}}": "Theme name / page title",
      "{{DESCRIPTION}}": "Theme description",
      "{{GRAPH_ID_DEFAULT}}": "Fallback graph ID for loading theme data"
    }
  },
  "landing-page": {
    id: "landing-page",
    template: LANDING_PAGE_TEMPLATE,
    description: "Single-page landing layout that renders all graph nodes as scrollable sections with sticky navigation.",
    placeholders: {
      "{{TITLE}}": "Page title shown in hero section",
      "{{DESCRIPTION}}": "Subtitle/tagline shown below the title",
      "{{FOOTER_TEXT}}": "Footer text content",
      "{{DEFAULT_THEME}}": "Default theme ID or label (hides picker for non-Superadmin)",
      "{{GRAPH_ID_DEFAULT}}": "Fallback graph ID for loading content"
    }
  },
  "agent-chat": {
    id: "agent-chat",
    template: AGENT_CHAT_TEMPLATE,
    description: "Conversational AI chat interface with real-time tool execution and streaming responses.",
    placeholders: {
      "{{TITLE}}": "Chat title",
      "{{GRAPH_ID_DEFAULT}}": "Default graph context"
    }
  }
};
var DEFAULT_TEMPLATE_ID = "editable-page";
function getTemplate(templateId) {
  return TEMPLATES[templateId] || TEMPLATES[DEFAULT_TEMPLATE_ID];
}
__name(getTemplate, "getTemplate");
function getTemplateVersion(templateId) {
  const entry = getTemplate(templateId);
  const match = entry.template.match(/<meta\s+name="template-version"\s+content="([^"]+)"/);
  return match ? match[1] : "unknown";
}
__name(getTemplateVersion, "getTemplateVersion");
function extractTemplateId(html) {
  const match = (html || "").match(/<meta\s+name="template-id"\s+content="([^"]+)"/);
  return match ? match[1] : DEFAULT_TEMPLATE_ID;
}
__name(extractTemplateId, "extractTemplateId");
function listTemplates() {
  return Object.values(TEMPLATES).map((t) => ({
    id: t.id,
    description: t.description,
    version: getTemplateVersion(t.id),
    placeholders: t.placeholders
  }));
}
__name(listTemplates, "listTemplates");

// openapi-tools.js
var cachedTools = null;
var cachedOperationMap = null;
var cacheTimestamp = 0;
var CACHE_TTL_MS = 5 * 60 * 1e3;
function toSnakeToolName(operationId) {
  const snake = operationId.replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, "");
  return "kg_" + snake;
}
__name(toSnakeToolName, "toSnakeToolName");
function resolveSchema(schema, components) {
  if (!schema) return { type: "object", properties: {} };
  if (schema.$ref) {
    const refName = schema.$ref.replace("#/components/schemas/", "");
    const resolved = components?.schemas?.[refName];
    if (resolved) return resolveSchema(resolved, components);
    return { type: "object", properties: {} };
  }
  if (schema.type === "object" && schema.properties) {
    const props = {};
    for (const [key, prop] of Object.entries(schema.properties)) {
      props[key] = resolveSchema(prop, components);
    }
    const result2 = { type: "object", properties: props };
    if (schema.required) result2.required = schema.required;
    return result2;
  }
  if (schema.type === "array" && schema.items) {
    return { type: "array", items: resolveSchema(schema.items, components) };
  }
  const result = {};
  if (schema.type) result.type = schema.type;
  if (schema.description) result.description = schema.description;
  if (schema.enum) result.enum = schema.enum;
  if (schema.default !== void 0) result.default = schema.default;
  return result;
}
__name(resolveSchema, "resolveSchema");
function operationToTool(path, method, operation, components) {
  const operationId = operation.operationId;
  if (!operationId) return null;
  const toolName = toSnakeToolName(operationId);
  const params = operation.parameters || [];
  const requestBody = operation.requestBody;
  const properties = {};
  const required = [];
  for (const param of params) {
    const paramSchema = param.schema || { type: "string" };
    properties[param.name] = {
      type: paramSchema.type || "string",
      description: param.description || `Parameter: ${param.name}`
    };
    if (paramSchema.enum) properties[param.name].enum = paramSchema.enum;
    if (param.required) required.push(param.name);
  }
  if (requestBody) {
    const content = requestBody.content?.["application/json"];
    if (content?.schema) {
      const bodySchema = resolveSchema(content.schema, components);
      if (bodySchema.properties) {
        for (const [key, prop] of Object.entries(bodySchema.properties)) {
          properties[key] = prop;
        }
        if (bodySchema.required) {
          for (const r of bodySchema.required) {
            if (!required.includes(r)) required.push(r);
          }
        }
      }
    }
  }
  const toolDef = {
    name: toolName,
    description: `[KG API] ${operation.summary || operationId}. ${operation.description || ""}`.trim(),
    input_schema: {
      type: "object",
      properties
    }
  };
  if (required.length > 0) toolDef.input_schema.required = required;
  const execMeta = {
    toolName,
    path,
    method: method.toUpperCase(),
    queryParams: params.filter((p) => p.in === "query").map((p) => p.name),
    hasBody: !!requestBody
  };
  return { toolDef, execMeta };
}
__name(operationToTool, "operationToTool");
async function loadOpenAPITools(env) {
  const now = Date.now();
  if (cachedTools && cachedOperationMap && now - cacheTimestamp < CACHE_TTL_MS) {
    return { tools: cachedTools, operationMap: cachedOperationMap };
  }
  const res = await env.KG_WORKER.fetch("https://knowledge-graph-worker/openapi.json");
  if (!res.ok) {
    console.error("Failed to fetch OpenAPI spec:", res.status);
    return { tools: cachedTools || [], operationMap: cachedOperationMap || {} };
  }
  const spec = await res.json();
  const BLOCKLIST = /* @__PURE__ */ new Set([
    "kg_get_know_graph",
    // → read_graph
    "kg_get_know_graphs",
    // → list_graphs
    "kg_get_contract",
    // → get_contract
    "kg_patch_node",
    // → patch_node
    "kg_add_node"
    // → create_node
  ]);
  const tools = [];
  const operationMap = {};
  for (const [path, methods] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(methods)) {
      if (typeof operation !== "object" || !operation.operationId) continue;
      const result = operationToTool(path, method, operation, spec.components);
      if (result) {
        if (BLOCKLIST.has(result.toolDef.name)) continue;
        tools.push(result.toolDef);
        operationMap[result.toolDef.name] = result.execMeta;
      }
    }
  }
  cachedTools = tools;
  cachedOperationMap = operationMap;
  cacheTimestamp = now;
  return { tools, operationMap };
}
__name(loadOpenAPITools, "loadOpenAPITools");
async function executeOpenAPITool(toolName, input, env, operationMap) {
  const meta = operationMap[toolName];
  if (!meta) throw new Error(`Unknown OpenAPI tool: ${toolName}`);
  let url = `https://knowledge-graph-worker${meta.path}`;
  if (meta.queryParams.length > 0) {
    const params = new URLSearchParams();
    for (const qp of meta.queryParams) {
      if (input[qp] !== void 0 && input[qp] !== null) {
        params.set(qp, String(input[qp]));
      }
    }
    const qs = params.toString();
    if (qs) url += "?" + qs;
  }
  const fetchOpts = {
    method: meta.method,
    headers: { "Content-Type": "application/json" }
  };
  if (meta.hasBody && (meta.method === "POST" || meta.method === "PUT" || meta.method === "PATCH" || meta.method === "DELETE")) {
    const bodyFields = { ...input };
    for (const qp of meta.queryParams) {
      delete bodyFields[qp];
    }
    delete bodyFields.userId;
    fetchOpts.body = JSON.stringify(bodyFields);
  }
  const res = await env.KG_WORKER.fetch(url, fetchOpts);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `KG API ${meta.path} failed (${res.status})`);
  }
  return data;
}
__name(executeOpenAPITool, "executeOpenAPITool");
function isOpenAPITool(toolName) {
  return toolName.startsWith("kg_");
}
__name(isOpenAPITool, "isOpenAPITool");

// tool-definitions.js
var TOOL_DEFINITIONS = [
  {
    name: "create_graph",
    description: "Create a new knowledge graph with metadata. Returns the graph ID and initial version.",
    input_schema: {
      type: "object",
      properties: {
        graphId: {
          type: "string",
          description: 'MUST be a UUID (e.g. "550e8400-e29b-41d4-a716-446655440000"). Generate a random UUID \u2014 NEVER use human-readable names.'
        },
        title: {
          type: "string",
          description: "Human-readable title for the graph"
        },
        description: {
          type: "string",
          description: "Detailed description of what this graph contains"
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for categorization and discovery"
        },
        category: {
          type: "string",
          description: 'Hashtag categories for the graph, e.g. "#Health #Neuroscience #Biology". Use 3-5 relevant hashtags separated by spaces.'
        },
        metaArea: {
          type: "string",
          description: 'A single community-relevant meta area tag in ALL CAPS, e.g. "NEUROSCIENCE", "AI TECHNOLOGY", "NORSE MYTHOLOGY". Should be a proper noun or well-known field of study.'
        }
      },
      required: ["graphId", "title"]
    }
  },
  {
    name: "create_node",
    description: "Add any type of node to a knowledge graph. Use this for fulltext (markdown), image, link, video, audio, or css-node types. For html-node pages, use create_html_from_template instead. The graph must already exist (use create_graph first). Call get_node_types_reference first if creating non-fulltext node types.",
    input_schema: {
      type: "object",
      properties: {
        graphId: {
          type: "string",
          description: "The ID of the graph to add this node to"
        },
        nodeId: {
          type: "string",
          description: 'Unique node ID (lowercase-kebab-case, e.g., "node-intro")'
        },
        label: {
          type: "string",
          description: "Display title for this node"
        },
        nodeType: {
          type: "string",
          enum: ["fulltext", "image", "link", "video", "audio", "css-node", "html-node", "mermaid-diagram", "youtube-video", "chart", "linechart", "bubblechart", "notes", "worknote", "map", "agent-contract", "agent-config", "agent-run", "data-node"],
          description: "Node type. Call get_node_types_reference for data format details."
        },
        content: {
          type: "string",
          description: "Node content (stored in info field). Format depends on nodeType."
        },
        path: {
          type: "string",
          description: "File/media URL (used for image, audio node types)"
        },
        color: {
          type: "string",
          description: 'Node color as hex (e.g., "#7c3aed"). Optional.'
        },
        metadata: {
          type: "object",
          description: 'Optional metadata object. For css-node: use { "appliesTo": ["html-node-id"], "priority": 10 } to link CSS to an HTML node.',
          properties: {
            appliesTo: {
              type: "array",
              items: { type: "string" },
              description: "Array of node IDs this css-node applies to"
            },
            priority: {
              type: "number",
              description: "CSS priority (lower = higher priority). Default: 999"
            }
          }
        },
        references: {
          type: "array",
          items: { type: "string" },
          description: "Optional bibliography/source URLs"
        }
      },
      required: ["graphId", "nodeId", "label", "nodeType", "content"]
    }
  },
  {
    name: "create_html_node",
    description: "Create a custom HTML app/page as a node in a knowledge graph. Use this when the user wants a custom app that does NOT fit the 4 predefined templates (landing-page, editable-page, theme-builder, agent-chat). Generate a complete, standalone HTML document with inline CSS and JavaScript. The HTML is stored as an html-node and viewable at vegvisr.org/gnew-viewer?graphId=GRAPH_ID. Examples: portfolio gallery, dashboard, interactive tool, quiz, calculator, custom form.",
    input_schema: {
      type: "object",
      properties: {
        graphId: {
          type: "string",
          description: "Graph ID (UUID). Create the graph first with create_graph."
        },
        nodeId: {
          type: "string",
          description: 'Unique node ID (kebab-case, e.g. "node-portfolio-app")'
        },
        label: {
          type: "string",
          description: "Display title for this app/page"
        },
        htmlContent: {
          type: "string",
          description: "Complete HTML document. Must be standalone \u2014 include all CSS inline in <style> and all JS inline in <script>. Use the KG API (knowledge.vegvisr.org) to fetch data at runtime if needed (e.g. album images, graph nodes)."
        },
        references: {
          type: "array",
          items: { type: "string" },
          description: "Optional source URLs"
        }
      },
      required: ["graphId", "nodeId", "label", "htmlContent"]
    }
  },
  {
    name: "add_edge",
    description: "Connect two nodes in a knowledge graph with a directed edge. Both nodes must already exist in the graph.",
    input_schema: {
      type: "object",
      properties: {
        graphId: {
          type: "string",
          description: "The ID of the graph containing both nodes"
        },
        sourceId: {
          type: "string",
          description: "The ID of the source node (edge starts here)"
        },
        targetId: {
          type: "string",
          description: "The ID of the target node (edge points here)"
        },
        label: {
          type: "string",
          description: "Optional label for the edge relationship"
        }
      },
      required: ["graphId", "sourceId", "targetId"]
    }
  },
  {
    name: "get_contract",
    description: "Retrieve a contract that specifies how to generate content. The contract contains node type descriptions, templates, CSS design tokens, feature flags, validation rules, and guidelines. Always fetch the contract BEFORE generating content.",
    input_schema: {
      type: "object",
      properties: {
        contractId: {
          type: "string",
          description: 'Contract ID to fetch (e.g., "contract_dark_glass", "contract_open")'
        },
        templateName: {
          type: "string",
          description: 'Or fetch by name (e.g., "Dark Glass Design System", "Open Knowledge Graph")'
        }
      }
    }
  },
  {
    name: "create_html_from_template",
    description: 'Create an HTML app from a template. Available templates: "landing-page" (single-page landing with sticky nav, renders all graph nodes as scrollable sections \u2014 best for marketing/showcase pages), "editable-page" (full page with navigation, markdown rendering, edit mode \u2014 best for content/docs), "theme-builder" (CSS variable editor for design tokens), "agent-chat" (conversational AI chat interface). The worker creates the html-node and content nodes. For editable-page, nodes whose label starts with # are discovered by the page. For landing-page, all nodes render as sections automatically.',
    input_schema: {
      type: "object",
      properties: {
        graphId: {
          type: "string",
          description: 'MUST be a UUID (e.g. "550e8400-e29b-41d4-a716-446655440000"). Generate a random UUID \u2014 NEVER use human-readable names.'
        },
        templateId: {
          type: "string",
          enum: ["landing-page", "editable-page", "theme-builder", "agent-chat"],
          description: 'Which HTML app template to use. "landing-page" for marketing/showcase pages, "editable-page" for content/docs (default), "theme-builder" for CSS editing, "agent-chat" for AI chat.'
        },
        title: {
          type: "string",
          description: "Page title"
        },
        description: {
          type: "string",
          description: "Page description/subtitle"
        },
        headerImage: {
          type: "string",
          description: "URL for the header image. Creates a markdown-image node in the graph that the template discovers dynamically. Use Unsplash URLs like https://images.unsplash.com/photo-ID?w=1200&h=400&fit=crop"
        },
        footerText: {
          type: "string",
          description: "Footer text"
        },
        defaultTheme: {
          type: "string",
          description: 'Default theme ID or label to auto-apply (e.g. "warm-cream", "Dark Glass"). When set, the theme picker is hidden for non-Superadmin users and this theme loads automatically.'
        },
        sections: {
          type: "array",
          description: "Content sections to create as fulltext nodes. Each section becomes a navigable node in the page. Use 3-6 sections.",
          items: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "Section title (will be prefixed with # automatically)"
              },
              content: {
                type: "string",
                description: "Section content in Markdown format. Include headings, paragraphs, lists, etc."
              }
            },
            required: ["title", "content"]
          }
        }
      },
      required: ["graphId", "title", "sections"]
    }
  },
  {
    name: "read_graph",
    description: "Read graph STRUCTURE: metadata, node list (id, label, type, truncated info preview), and edges. Use this to see what a graph contains. Content nodes (fulltext, info) show up to 2000 chars; HTML/CSS nodes show 200 chars. If info_truncated=true, use read_node or read_graph_content to get the full text.",
    input_schema: {
      type: "object",
      properties: {
        graphId: {
          type: "string",
          description: "The graph ID to read"
        }
      },
      required: ["graphId"]
    }
  },
  {
    name: "read_graph_content",
    description: "Read FULL CONTENT of all nodes in a graph \u2014 no truncation. Use this when you need to analyze, compare, or work with the actual text content. Optionally filter by node type. WARNING: can return large results for graphs with many nodes.",
    input_schema: {
      type: "object",
      properties: {
        graphId: {
          type: "string",
          description: "The graph ID to read"
        },
        nodeTypes: {
          type: "array",
          items: { type: "string" },
          description: 'Optional: only return nodes of these types (e.g. ["fulltext", "info"]). Omit to get all nodes.'
        }
      },
      required: ["graphId"]
    }
  },
  {
    name: "read_node",
    description: "Read a single node with FULL content (not truncated). Use after read_graph to get the complete info field of a specific node.",
    input_schema: {
      type: "object",
      properties: {
        graphId: {
          type: "string",
          description: "The graph ID containing the node"
        },
        nodeId: {
          type: "string",
          description: "The node ID to read in full"
        }
      },
      required: ["graphId", "nodeId"]
    }
  },
  {
    name: "patch_node",
    description: "Update specific fields on an existing node. Only the provided fields are changed; others are preserved. Use read_graph or read_node first to see current values.",
    input_schema: {
      type: "object",
      properties: {
        graphId: {
          type: "string",
          description: "The graph ID containing the node"
        },
        nodeId: {
          type: "string",
          description: "The node ID to update"
        },
        fields: {
          type: "object",
          description: "Fields to update. Valid keys: info (content), label, path, color, type, metadata, bibl, visible, position, imageWidth, imageHeight.",
          properties: {
            info: { type: "string", description: "Node content (markdown, HTML, CSS, etc.)" },
            label: { type: "string", description: "Display title" },
            path: { type: "string", description: "File/media URL" },
            color: { type: "string", description: "Node color hex" },
            type: { type: "string", description: "Node type" },
            visible: { type: "boolean", description: "Show/hide node" }
          }
        }
      },
      required: ["graphId", "nodeId", "fields"]
    }
  },
  {
    name: "edit_html_node",
    description: "Surgically edit an html-node by finding and replacing an exact string in its HTML content. Unlike patch_node (which replaces the entire info field), this tool only changes the specific part you target \u2014 all other code stays untouched. Use this instead of patch_node when modifying existing HTML apps to avoid accidentally breaking working code. You can make multiple edits by calling this tool multiple times.",
    input_schema: {
      type: "object",
      properties: {
        graphId: {
          type: "string",
          description: "The graph ID containing the html-node"
        },
        nodeId: {
          type: "string",
          description: "The html-node ID to edit"
        },
        old_string: {
          type: "string",
          description: "The exact string to find in the HTML. Must be unique in the document. Include enough surrounding context to make it unique."
        },
        new_string: {
          type: "string",
          description: "The replacement string. Can be larger than old_string (for adding code) or empty string (for removing code)."
        },
        replace_all: {
          type: "boolean",
          description: "If true, replace ALL occurrences of old_string. Default false (replaces only the first match)."
        }
      },
      required: ["graphId", "nodeId", "old_string", "new_string"]
    }
  },
  {
    name: "patch_graph_metadata",
    description: "Update graph-level metadata fields (title, description, category, metaArea, etc.) without re-sending all nodes and edges. Only the provided fields are changed; others are preserved.",
    input_schema: {
      type: "object",
      properties: {
        graphId: {
          type: "string",
          description: "The graph ID to update"
        },
        fields: {
          type: "object",
          description: "Metadata fields to update. Valid keys: title, description, category, metaArea, createdBy, graphType, seoSlug, publicationState.",
          properties: {
            title: { type: "string", description: "Graph title" },
            description: { type: "string", description: "Graph description" },
            category: { type: "string", description: 'Category tags (e.g. "#AI #Research")' },
            metaArea: { type: "string", description: 'Meta area tag in ALL CAPS (e.g. "#NINE", "#SANSKRIT")' }
          }
        }
      },
      required: ["graphId", "fields"]
    }
  },
  {
    name: "list_graphs",
    description: 'List available knowledge graphs with summaries. Returns graph IDs, titles, categories, meta areas, and node counts. Use metaArea to filter by a specific meta area (e.g. "NEUROSCIENCE", "AI TECHNOLOGY").',
    input_schema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max number of graphs to return (default 20)"
        },
        offset: {
          type: "number",
          description: "Offset for pagination (default 0)"
        },
        metaArea: {
          type: "string",
          description: 'Filter by meta area (e.g. "NEUROSCIENCE", "AI TECHNOLOGY"). Case-insensitive partial match.'
        }
      }
    }
  },
  {
    name: "list_meta_areas",
    description: 'List all unique meta areas and categories across knowledge graphs. Returns sorted lists with graph counts for each. Use this when the user asks "what topics exist?", "what meta areas are available?", or wants to browse/discover content by topic.',
    input_schema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "perplexity_search",
    description: 'Search the web using Perplexity AI with real-time results and citations. Returns detailed answers with source URLs. Use this for in-depth research, recent news, or when you need cited sources. Choose model: "sonar" (fast), "sonar-pro" (deep search), or "sonar-reasoning" (complex analysis).',
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query"
        },
        model: {
          type: "string",
          enum: ["sonar", "sonar-pro", "sonar-reasoning"],
          description: "Perplexity model: sonar (fast, default), sonar-pro (deep search), sonar-reasoning (complex analysis)"
        },
        search_recency_filter: {
          type: "string",
          enum: ["day", "week", "month", "year"],
          description: "Filter results by recency (optional)"
        }
      },
      required: ["query"]
    }
  },
  {
    name: "search_pexels",
    description: "Search Pexels for free stock photos. Returns image URLs, photographer credits, and dimensions. Use the returned URLs in image nodes or as header images in templates.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: 'Search query for images (e.g. "mountain landscape", "team collaboration")'
        },
        count: {
          type: "number",
          description: "Number of images to return (default 5, max 20)"
        }
      },
      required: ["query"]
    }
  },
  {
    name: "search_unsplash",
    description: "Search Unsplash for free stock photos. Returns image URLs, photographer credits, and dimensions. Use the returned URLs in image nodes or as header images in templates.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: 'Search query for images (e.g. "nature sunset", "office workspace")'
        },
        count: {
          type: "number",
          description: "Number of images to return (default 5, max 20)"
        }
      },
      required: ["query"]
    }
  },
  {
    name: "get_album_images",
    description: "Get images from a user photo album stored in Vegvisr. Returns image URLs served via imgix CDN. Use these images in graphs, templates, or content nodes.",
    input_schema: {
      type: "object",
      properties: {
        albumName: {
          type: "string",
          description: "Name of the photo album to retrieve"
        }
      },
      required: ["albumName"]
    }
  },
  {
    name: "analyze_image",
    description: "Analyze an image by URL. Useful for describing photos, extracting text (OCR), identifying objects, or answering questions about visual content. Works with imgix CDN URLs (vegvisr.imgix.net) and any public image URL.",
    input_schema: {
      type: "object",
      properties: {
        imageUrl: {
          type: "string",
          description: "URL of the image to analyze (must be publicly accessible, e.g. https://vegvisr.imgix.net/<key>)"
        },
        question: {
          type: "string",
          description: 'What to analyze or ask about the image. Default: "Describe this image in detail."'
        }
      },
      required: ["imageUrl"]
    }
  },
  {
    name: "get_formatting_reference",
    description: "Get the fulltext formatting syntax reference (SECTION, FANCY, QUOTE, IMAGEQUOTE, positioned images, FLEXBOX layouts). Call this BEFORE creating styled/formatted content in fulltext nodes.",
    input_schema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "get_node_types_reference",
    description: "Get data format reference for node types (mermaid-diagram, youtube-video, chart, linechart, bubblechart, notes, worknote, map). Call this when creating nodes other than fulltext, image, or link.",
    input_schema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "get_html_builder_reference",
    description: "Get the complete HTML app builder reference \u2014 editing rules (edit_html_node scoping, matching tips), Drizzle API (all endpoints with request/response formats), CSS design system variables, error handling and logging conventions, preview error debugging process, and proactive coding rules. Call this BEFORE creating, editing, or debugging any HTML app.",
    input_schema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "list_recordings",
    description: "List audio recordings from the current user's audio portfolio. Automatically uses the logged-in user's email. Returns recording metadata including titles, durations, tags, and transcription status. Use this to find recordings before transcribing them.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max recordings to return (default 20)" },
        query: { type: "string", description: "Optional search query to filter recordings by name, tags, or transcription text" }
      }
    }
  },
  {
    name: "transcribe_audio",
    description: "Transcribe an audio file. Provide either a recordingId (to transcribe from the audio portfolio) or an audioUrl (direct R2/public URL). Automatically uses the logged-in user's email for portfolio lookups. Returns the transcription text. Use saveToGraph to create a graph with the transcription as a fulltext node directly \u2014 this saves directly without sending the full text through the LLM, so it is much faster for large transcriptions. ALWAYS use saveToGraph:true when the user asks to transcribe and save/create a graph.",
    input_schema: {
      type: "object",
      properties: {
        recordingId: { type: "string", description: "Portfolio recording ID (e.g. rec_1709123456_abc). If provided, fetches the audio URL from portfolio metadata." },
        audioUrl: { type: "string", description: "Direct URL to audio file (e.g. https://audio.vegvisr.org/audio/...). Use this for files not in the portfolio." },
        service: { type: "string", enum: ["openai", "cloudflare"], description: "Transcription service. Default: openai (higher quality)" },
        language: { type: "string", description: 'Language code hint (e.g. "en", "no"). Improves accuracy.' },
        saveToPortfolio: { type: "boolean", description: "If true and recordingId provided, save transcription text back to portfolio metadata. Default: false" },
        saveToGraph: { type: "boolean", description: "If true, after transcription the frontend creates a new graph with the transcription as a fulltext node directly (no LLM round-trip). Default: false" },
        graphTitle: { type: "string", description: "Title for the new graph when saveToGraph is true. Auto-generated from recording name if not provided." }
      }
    }
  },
  {
    name: "analyze_node",
    description: "Analyze semantic content of a single knowledge graph node using Claude. Returns sentiment, importance weight (0-1), keywords, and a brief summary. Optionally stores results in node metadata.",
    input_schema: {
      type: "object",
      properties: {
        graphId: { type: "string", description: "The graph containing the node" },
        nodeId: { type: "string", description: "The node to analyze" },
        analysisType: {
          type: "string",
          enum: ["sentiment", "keywords", "weight", "summary", "all"],
          description: 'What to analyze. Default: "all"'
        },
        store: {
          type: "boolean",
          description: "If true, store results in node.metadata.analysis. Default: false"
        }
      },
      required: ["graphId", "nodeId"]
    }
  },
  {
    name: "analyze_graph",
    description: "Analyze all nodes in a knowledge graph using Claude. Returns graph-level sentiment, topic clusters, node importance rankings, and an overall summary. Best for understanding the full meaning of a graph.",
    input_schema: {
      type: "object",
      properties: {
        graphId: { type: "string", description: "The graph to analyze" },
        store: {
          type: "boolean",
          description: "If true, store per-node weights in each node metadata. Default: false"
        }
      },
      required: ["graphId"]
    }
  },
  {
    name: "who_am_i",
    description: "Get the current logged-in user's profile information including email, role, bio, branding, profile image, and configured API keys. No parameters needed \u2014 automatically uses the current user context. The bio field contains the user's full biography \u2014 always output it verbatim when asked.",
    input_schema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "admin_register_user",
    description: "Register a new user in the Vegvisr platform. Superadmin only. Creates a user record with email, phone, and role. The new user can then log in via magic link at login.vegvisr.org using their email. Returns the generated user_id and emailVerificationToken.",
    input_schema: {
      type: "object",
      properties: {
        email: {
          type: "string",
          description: "Email address for the new user (required)"
        },
        name: {
          type: "string",
          description: "Full name of the new user (optional)"
        },
        phone: {
          type: "string",
          description: "Phone number for the new user (optional)"
        },
        role: {
          type: "string",
          enum: ["Admin", "user", "Subscriber", "Superadmin"],
          description: 'Role to assign. Default: "Admin"'
        }
      },
      required: ["email"]
    }
  },
  {
    name: "send_email",
    description: "Send an email on behalf of the user. Uses the user's configured email account (Gmail or SMTP/vegvisr.org). Requires the user to have at least one email account set up in their profile settings. Use this when the user asks to send, write, or compose an email.",
    input_schema: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "Recipient email address (required)"
        },
        subject: {
          type: "string",
          description: "Email subject line (required)"
        },
        html: {
          type: "string",
          description: "Email body as HTML (required). Wrap plain text in <p> tags."
        },
        fromEmail: {
          type: "string",
          description: "Sender email address (optional). If omitted, uses the user's default email account."
        }
      },
      required: ["to", "subject", "html"]
    }
  },
  {
    name: "analyze_transcription",
    description: 'Analyze a conversation transcription from the Enkel Endring program. Fetches the transcription from a graph node and produces a structured Norwegian-language report with: key themes, success indicators, powerful quotes, action points, and mentor feedback. Use this when the user asks for a "vurdering", "analyse", or "rapport" of a transcription.',
    input_schema: {
      type: "object",
      properties: {
        graphId: { type: "string", description: "The graph containing the transcription node" },
        nodeId: { type: "string", description: "The node with the transcription text. If not provided, uses the first fulltext node in the graph." },
        conversationType: {
          type: "string",
          enum: ["1-1", "group"],
          description: 'Type of conversation. "1-1" for individual sessions, "group" for group sessions. Affects analysis focus. Default: "1-1"'
        },
        saveToGraph: {
          type: "boolean",
          description: "If true, save the analysis as a new fulltext node in the same graph. Default: true"
        }
      },
      required: ["graphId"]
    }
  },
  {
    name: "save_form_data",
    description: "Append a data record to a data-node in a knowledge graph. Creates the data-node if it does not exist. Data is encrypted at rest automatically by the KG worker. The node ID is always a UUID.",
    input_schema: {
      type: "object",
      properties: {
        graphId: { type: "string", description: "Graph ID containing (or to contain) the data-node" },
        nodeId: { type: "string", description: "data-node UUID. If omitted, a new UUID is auto-generated." },
        record: { type: "object", description: 'Key-value record to append (e.g., {"name":"John","email":"john@example.com","message":"Hello"})' },
        schema: {
          type: "object",
          description: 'Column schema (required when creating a new data-node). Example: { "columns": [{"key":"name","label":"Name","type":"text"},{"key":"email","label":"Email","type":"email"}] }'
        },
        label: { type: "string", description: 'Node label (required when creating). Start with # for landing page visibility (e.g., "#Contact Submissions").' },
        formTitle: { type: "string", description: 'Title shown above the submission form in the landing page (e.g., "Contact Us").' }
      },
      required: ["graphId", "record"]
    }
  },
  {
    name: "query_data_nodes",
    description: "Read records from a data-node. Returns the decrypted data as a JSON array with schema information.",
    input_schema: {
      type: "object",
      properties: {
        graphId: { type: "string", description: "Graph ID" },
        nodeId: { type: "string", description: "data-node UUID" },
        limit: { type: "number", description: "Max records to return (default 50, max 200)" },
        offset: { type: "number", description: "Skip first N records (default 0)" },
        filterKey: { type: "string", description: "Optional: filter by this field key" },
        filterValue: { type: "string", description: "Optional: match this value (case-insensitive contains)" }
      },
      required: ["graphId", "nodeId"]
    }
  },
  {
    name: "create_app_table",
    description: "Create a new relational database table (D1) for structured app data. Use this instead of data-node when you need proper relational storage with SQL queries. Tables are linked to a graphId.",
    input_schema: {
      type: "object",
      properties: {
        graphId: { type: "string", description: "Graph ID that owns this table" },
        displayName: { type: "string", description: 'Human-readable table name (e.g., "Contact Submissions")' },
        columns: {
          type: "array",
          description: 'Column definitions. Each column has name (lowercase, e.g. "email"), label (display name), type (text|integer|real|boolean|datetime), and optional required (boolean).',
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: 'Column name (lowercase alphanumeric + underscores, e.g., "first_name")' },
              label: { type: "string", description: 'Display label (e.g., "First Name")' },
              type: { type: "string", enum: ["text", "integer", "real", "boolean", "datetime"], description: "Column data type" },
              required: { type: "boolean", description: "Whether this column is required" }
            },
            required: ["name", "type"]
          }
        }
      },
      required: ["graphId", "displayName", "columns"]
    }
  },
  {
    name: "insert_app_record",
    description: "Insert a record into an app data table. The table must have been created with create_app_table first.",
    input_schema: {
      type: "object",
      properties: {
        tableId: { type: "string", description: "Table UUID (returned by create_app_table)" },
        record: { type: "object", description: 'Key-value pairs matching the table columns (e.g., {"name":"John","email":"john@test.com"})' }
      },
      required: ["tableId", "record"]
    }
  },
  {
    name: "query_app_table",
    description: "Query records from an app data table with optional filtering, ordering, and pagination.",
    input_schema: {
      type: "object",
      properties: {
        tableId: { type: "string", description: "Table UUID" },
        where: { type: "object", description: 'Optional filter conditions as key-value pairs (e.g., {"email":"john@test.com"})' },
        orderBy: { type: "string", description: "Column to order by (default: _created_at)" },
        order: { type: "string", enum: ["asc", "desc"], description: "Sort direction (default: desc)" },
        limit: { type: "number", description: "Max records to return (default 50, max 1000)" },
        offset: { type: "number", description: "Skip first N records (default 0)" }
      },
      required: ["tableId"]
    }
  },
  {
    name: "db_list_tables",
    description: "List all tables in the main vegvisr_org database with their columns. Use this to explore the database schema (config, user_api_keys, graphs, etc.).",
    input_schema: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "db_query",
    description: "Run a read-only SQL SELECT query against the main vegvisr_org database. Use this to inspect config, user_api_keys, graphs, and other tables. Only SELECT queries are allowed.",
    input_schema: {
      type: "object",
      properties: {
        sql: { type: "string", description: 'SQL SELECT query to execute (e.g., "SELECT email, Role FROM config LIMIT 10")' },
        params: {
          type: "array",
          description: 'Optional bind parameters for the query (e.g., ["torarnehave@gmail.com"])',
          items: { type: "string" }
        }
      },
      required: ["sql"]
    }
  },
  {
    name: "calendar_list_tables",
    description: "List all tables in the calendar database (calendar_db). Returns table names so you can explore the calendar schema.",
    input_schema: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "calendar_query",
    description: "Run a read-only SQL query against the calendar database (calendar_db). Use this to view bookings, settings, availability, meeting types, and group meetings. Only SELECT queries are allowed.",
    input_schema: {
      type: "object",
      properties: {
        sql: { type: "string", description: 'SQL SELECT query to execute (e.g., "SELECT * FROM bookings LIMIT 10")' },
        params: {
          type: "array",
          description: 'Optional bind parameters for the query (e.g., ["torarnehave@gmail.com"])',
          items: { type: "string" }
        }
      },
      required: ["sql"]
    }
  },
  {
    name: "calendar_get_settings",
    description: "Get a user's booking profile \u2014 availability hours, available days of the week, meeting types (with durations), and upcoming group meetings. Use this before booking to understand what slots and meeting types are available.",
    input_schema: {
      type: "object",
      properties: {
        userEmail: { type: "string", description: "The calendar owner's email address" }
      },
      required: ["userEmail"]
    }
  },
  {
    name: "calendar_check_availability",
    description: "Check booked time slots for a specific date. Returns occupied slots from both D1 bookings and Google Calendar events. Use this to find free time before creating a booking.",
    input_schema: {
      type: "object",
      properties: {
        userEmail: { type: "string", description: "The calendar owner's email address" },
        date: { type: "string", description: 'Date to check in YYYY-MM-DD format (e.g., "2026-03-10")' }
      },
      required: ["userEmail", "date"]
    }
  },
  {
    name: "calendar_list_bookings",
    description: "List all bookings for a user with guest details, times, and meeting type info. Use this to see upcoming and past appointments.",
    input_schema: {
      type: "object",
      properties: {
        userEmail: { type: "string", description: "The calendar owner's email address" }
      },
      required: ["userEmail"]
    }
  },
  {
    name: "calendar_create_booking",
    description: "Book a meeting for a user. Automatically syncs to Google Calendar if connected. Returns conflict error if the time slot is already taken. Times must be ISO 8601 format.",
    input_schema: {
      type: "object",
      properties: {
        ownerEmail: { type: "string", description: "The calendar owner's email address (who is being booked)" },
        guestName: { type: "string", description: "Full name of the guest booking the meeting" },
        guestEmail: { type: "string", description: "Email address of the guest" },
        startTime: { type: "string", description: 'Meeting start time in ISO 8601 format (e.g., "2026-03-10T10:00:00.000Z")' },
        endTime: { type: "string", description: 'Meeting end time in ISO 8601 format (e.g., "2026-03-10T10:30:00.000Z")' },
        description: { type: "string", description: "Optional meeting description or notes" },
        meetingTypeId: { type: "number", description: "Optional meeting type ID (from calendar_get_settings)" }
      },
      required: ["ownerEmail", "guestName", "guestEmail", "startTime", "endTime"]
    }
  },
  {
    name: "calendar_reschedule_booking",
    description: "Reschedule an existing booking to a new time. Updates both D1 and Google Calendar (if synced). Returns conflict error (409) if the new time overlaps another booking.",
    input_schema: {
      type: "object",
      properties: {
        userEmail: { type: "string", description: "The calendar owner's email address" },
        bookingId: { type: "number", description: "The booking ID to reschedule (from calendar_list_bookings)" },
        newStartTime: { type: "string", description: 'New start time in ISO 8601 format (e.g., "2026-03-12T14:00:00.000Z")' },
        newEndTime: { type: "string", description: 'New end time in ISO 8601 format (e.g., "2026-03-12T14:30:00.000Z")' }
      },
      required: ["userEmail", "bookingId", "newStartTime", "newEndTime"]
    }
  },
  {
    name: "calendar_delete_booking",
    description: "Cancel/delete a booking. Removes it from D1 and from Google Calendar (if synced). This action cannot be undone.",
    input_schema: {
      type: "object",
      properties: {
        userEmail: { type: "string", description: "The calendar owner's email address" },
        bookingId: { type: "number", description: "The booking ID to delete (from calendar_list_bookings)" }
      },
      required: ["userEmail", "bookingId"]
    }
  },
  {
    name: "calendar_get_status",
    description: "Check if a user's Google Calendar is connected. Returns connected: true/false.",
    input_schema: {
      type: "object",
      properties: {
        userEmail: { type: "string", description: "The calendar owner's email address" }
      },
      required: ["userEmail"]
    }
  },
  {
    name: "list_chat_groups",
    description: "List all chat groups in Hallo Vegvisr. Returns group IDs and names. Use this to find a group before adding users.",
    input_schema: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "add_user_to_chat_group",
    description: "Add a vegvisr.org user (by email) to a chat group in Hallo Vegvisr. Looks up the user in the vegvisr_org config table, then adds them to the specified group.",
    input_schema: {
      type: "object",
      properties: {
        email: { type: "string", description: "User email address (must exist in vegvisr.org)" },
        groupId: { type: "string", description: "Chat group UUID (use list_chat_groups to find it)" },
        groupName: { type: "string", description: "Chat group name \u2014 used to find groupId if groupId is not provided" },
        role: { type: "string", enum: ["member", "admin"], description: "Role in the group (default: member)" }
      },
      required: ["email"]
    }
  },
  {
    name: "get_group_messages",
    description: "Get recent messages from a Hallo Vegvisr chat group. Returns message text, sender email, and timestamp. Use this to read, analyze, summarize, or do sentiment analysis on group conversations.",
    input_schema: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "Chat group UUID" },
        groupName: { type: "string", description: "Chat group name (resolves to groupId if groupId not provided)" },
        limit: { type: "number", description: "Number of messages to return (default 10, max 100)" }
      },
      required: []
    }
  },
  {
    name: "get_group_stats",
    description: "Get activity statistics for all Hallo Vegvisr chat groups. Returns message count, member count, last message time, and creator for each group, sorted by most active.",
    input_schema: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "send_group_message",
    description: "Send a text or voice message to a Hallo Vegvisr chat group on behalf of a user. The user must be a member of the group. For voice messages, use list_recordings to get the audioUrl first.",
    input_schema: {
      type: "object",
      properties: {
        email: { type: "string", description: "Sender email address (must exist in vegvisr.org and be a group member)" },
        groupId: { type: "string", description: "Chat group UUID" },
        groupName: { type: "string", description: "Chat group name (resolves to groupId if groupId not provided)" },
        body: { type: "string", description: "Message text to send (required for text, optional for voice)" },
        messageType: { type: "string", enum: ["text", "voice"], description: "Message type (default: text)" },
        audioUrl: { type: "string", description: "URL to audio file (required for voice messages). Get from list_recordings." },
        audioDurationMs: { type: "number", description: "Audio duration in milliseconds" },
        transcriptText: { type: "string", description: "Transcription of the voice message" },
        transcriptLang: { type: "string", description: 'Language code of transcript (e.g. "en", "no")' }
      },
      required: ["email"]
    }
  },
  {
    name: "create_chat_group",
    description: "Create a new Hallo Vegvisr chat group. The creator (identified by email) becomes the owner. Use this when the user asks to create or set up a new chat group.",
    input_schema: {
      type: "object",
      properties: {
        email: { type: "string", description: "Email of the user creating the group (becomes owner)" },
        name: { type: "string", description: "Name for the new chat group" },
        graphId: { type: "string", description: "Optional knowledge graph ID to link to the group" }
      },
      required: ["email", "name"]
    }
  },
  {
    name: "register_chat_bot",
    description: "Register an AI chatbot in a chat group. The bot personality is defined by a knowledge graph (fulltext nodes become the system prompt). Use this to add a bot to a group.",
    input_schema: {
      type: "object",
      properties: {
        graphId: { type: "string", description: "Knowledge graph ID containing bot personality and guidelines" },
        groupId: { type: "string", description: "Chat group UUID" },
        groupName: { type: "string", description: "Chat group name" },
        botName: { type: "string", description: 'Display name for the bot (e.g. "SIMULA")' }
      },
      required: ["graphId", "botName"]
    }
  },
  {
    name: "get_group_members",
    description: "Get all members of a chat group with their names, emails, IDs, roles, and profile images. Also shows which members are bots.",
    input_schema: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "Chat group UUID" },
        groupName: { type: "string", description: "Chat group name (use this or groupId)" }
      },
      required: []
    }
  },
  {
    name: "trigger_bot_response",
    description: "Trigger a chatbot to respond to recent messages in its group. Loads bot personality from its knowledge graph, reads recent messages, generates a response via Claude, and posts it to the group.",
    input_schema: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "Chat group UUID" },
        groupName: { type: "string", description: "Chat group name" },
        botGraphId: { type: "string", description: "Specific bot graph ID (if group has multiple bots). If omitted, triggers all bots." },
        messageCount: { type: "number", description: "Number of recent messages to include as context (default 10, max 50)" }
      },
      required: []
    }
  },
  {
    name: "describe_capabilities",
    description: `Describe this agent's capabilities \u2014 returns a structured list of all available tools (with descriptions), all HTML templates (with descriptions and placeholders), and supported node types. Use this when the user asks "what can you do?", "what tools do you have?", "describe yourself", or "what are your capabilities?".`,
    input_schema: {
      type: "object",
      properties: {
        include_tools: {
          type: "boolean",
          description: "Include the full list of available tools (default true)",
          default: true
        },
        include_templates: {
          type: "boolean",
          description: "Include the list of HTML templates (default true)",
          default: true
        }
      },
      required: []
    }
  },
  {
    name: "delegate_to_html_builder",
    description: "Delegate an HTML building or editing task to the specialized HTML Builder subagent. Use this when the user asks to create, edit, debug, fix, or redesign an HTML app. The subagent has focused HTML expertise and tools for reading specific sections of large HTML files. Use this instead of calling edit_html_node directly.",
    input_schema: {
      type: "object",
      properties: {
        graphId: {
          type: "string",
          description: "The graph containing the HTML node"
        },
        nodeId: {
          type: "string",
          description: "The html-node ID to work on. Omit for new HTML creation."
        },
        task: {
          type: "string",
          description: "What to do: create, edit, fix errors, redesign, etc. Include all user requirements and any error messages from the console."
        },
        consoleErrors: {
          type: "array",
          items: { type: "string" },
          description: "Console error messages from the HTML preview, if any."
        }
      },
      required: ["graphId", "task"]
    }
  }
];
var WEB_SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search",
  max_uses: 5
};

// system-prompt.js
var CHAT_SYSTEM_PROMPT = `You are the Vegvisr Agent \u2014 a conversational AI assistant built into the Vegvisr platform.
You help users manage knowledge graphs, create and modify HTML apps, and build content.

## Core Tools (always available)
- **list_graphs**: List available knowledge graphs with summaries. Supports metaArea filter.
- **list_meta_areas**: List all unique meta areas and categories with graph counts. Use when the user wants to browse topics or discover what content exists.
- **read_graph**: Read graph STRUCTURE \u2014 metadata, node list (id, label, type, truncated info preview), edges. Use to see what's in a graph before making changes. Content nodes (fulltext, info) show up to 2000 chars; HTML/CSS nodes show 200 chars. If a node has info_truncated=true, use read_node or read_graph_content for the full text.
- **read_graph_content**: Read FULL CONTENT of all nodes \u2014 no truncation. Use when you need to analyze, compare, or display actual text content. Can filter by nodeTypes (e.g. ["fulltext", "info"]).
- **read_node**: Read a single node's full content (not truncated). Use when you need one specific node's complete info. When reading an html-node, check if the code has proper \`[functionName]\` logging in fetch calls and event handlers \u2014 if not, flag it and offer to upgrade the logging when making any other changes.
- **patch_node**: Update specific fields on a node (info, label, path, color, etc.). This is for NODE fields only \u2014 do NOT use for graph-level metadata. WARNING: For html-node content edits, use \`delegate_to_html_builder\` instead \u2014 patch_node replaces the ENTIRE info field which risks breaking existing code.
- **delegate_to_html_builder**: Delegate ALL HTML app tasks (create, edit, debug, fix errors) to the specialized HTML Builder subagent. Pass graphId, task description, nodeId (if editing), and consoleErrors (if fixing). Do NOT try to edit HTML directly \u2014 always delegate.
- **patch_graph_metadata**: Update graph-level metadata (title, description, category, metaArea, etc.) without re-sending all nodes/edges. Use this when the user wants to change a graph's category, metaArea, title, or description.
- **create_graph**: Create a new knowledge graph
- **create_node**: Add any type of node (fulltext, image, link, css-node, etc.)
- **create_html_node**: Add a raw HTML node
- **create_html_from_template**: Create an HTML app from a template. Use templateId: "landing-page" for marketing/showcase pages, "editable-page" for content/docs, "theme-builder" for CSS editing, "agent-chat" for AI chat. When the user says "landing page", always use templateId "landing-page". After creating from template, review the generated HTML \u2014 if it contains fetch calls or event handlers without \`[functionName]\` logging, patch the node to add proper logging before telling the user it's ready.
- **add_edge**: Connect two nodes with a directed edge
- **get_contract**: Retrieve a contract for content generation
- **web_search**: Quick web search (built-in, lightweight)
- **perplexity_search**: Deep web search with Perplexity AI \u2014 returns detailed answers with citations. Models: sonar (fast), sonar-pro (thorough), sonar-reasoning (complex analysis).
- **search_pexels** / **search_unsplash**: Search for free stock photos. Use returned URLs in image nodes or as headerImage in templates.
- **get_album_images**: Get images from a user's Vegvisr photo album (imgix CDN URLs).
- **analyze_image**: Analyze an image by URL \u2014 describe content, extract text (OCR), identify objects, answer questions. Works with imgix CDN URLs and any public image URL. Use this when the user asks about a specific image from an album or graph node.
- **get_formatting_reference**: Get fulltext formatting syntax (SECTION, FANCY, QUOTE, etc.). Call this BEFORE creating styled content.
- **get_node_types_reference**: Get data format reference for non-standard node types. Call this BEFORE creating mermaid-diagram, chart, youtube-video, etc.
- **who_am_i**: Get the current user's profile \u2014 email, role, bio, branding, profile image, and configured API keys. When the user asks to see their bio, output the bio field VERBATIM \u2014 do not summarize, paraphrase, or shorten it.
- **describe_capabilities**: Describe this agent's full capabilities \u2014 lists all available tools with descriptions, all HTML templates with placeholders, and a summary. Use when the user asks "what can you do?", "what tools do you have?", "list your capabilities", or wants to understand what the agent can help with.
- **list_recordings**: Browse the user's audio portfolio \u2014 returns recording metadata (titles, durations, tags, transcription status).
- **transcribe_audio**: Transcribe audio from portfolio (by recordingId) or from a direct URL. Supports OpenAI Whisper and Cloudflare AI. Optionally saves transcription back to portfolio. Use \`saveToGraph: true\` when the user wants to create a graph with the transcription \u2014 this saves directly without sending the full text through the LLM, making it much faster.
- **analyze_node**: Semantic analysis of a single node \u2014 returns sentiment, importance weight (0-1), keywords, and summary. Uses Claude Sonnet.
- **analyze_graph**: Full graph semantic analysis \u2014 returns topic clusters, node importance rankings, overall sentiment, and summary. Uses Claude Sonnet.
- **analyze_transcription**: Analyze a conversation transcription from Enkel Endring. Produces a structured Norwegian report (themes, success indicators, quotes, action points, mentor feedback). Set conversationType to "1-1" or "group".
- **db_list_tables**: List all tables and columns in the main vegvisr_org database. Use this to explore the schema (config, user_api_keys, graphs, etc.).
- **db_query**: Run a read-only SQL SELECT query against the main vegvisr_org database. Only SELECT queries allowed.
- **calendar_list_tables**: List all tables and columns in the calendar database (calendar_db). Use this to explore the schema.
- **calendar_query**: Run a read-only SQL SELECT query against the calendar database. View bookings, settings, availability, meeting types, and group meetings. Only SELECT queries allowed.
- **calendar_get_settings**: Get a user's booking profile \u2014 availability hours, available days, meeting types (with durations), and group meetings. Call this first before booking.
- **calendar_check_availability**: Check booked time slots for a specific date. Returns occupied slots from both D1 bookings and Google Calendar. Use to find free times.
- **calendar_list_bookings**: List all bookings for a user with guest details, times, and meeting type info.
- **calendar_create_booking**: Book a meeting. Automatically syncs to Google Calendar if connected. Returns conflict error (409) if slot is taken.
- **calendar_reschedule_booking**: Move an existing booking to a new time. Updates both D1 and Google Calendar. Returns conflict error (409) if the new time overlaps another booking.
- **calendar_delete_booking**: Cancel and permanently delete a booking. Also removes it from Google Calendar if synced.
- **calendar_get_status**: Check if a user's Google Calendar is connected.

## Dynamic KG API Tools (auto-loaded from OpenAPI spec)
You also have access to tools prefixed with "kg_" that map directly to Knowledge Graph API endpoints.
These are generated dynamically from the KG worker's OpenAPI spec. Examples:
- **kg_get_know_graph**: Get a graph by ID (with optional nodeId/nodeTitle filters)
- **kg_get_know_graph_history**: Get version history for a graph
- **kg_duplicate_know_graph**: Duplicate an existing graph
- **kg_get_slideshow**: Get slideshow presentation for a graph
- **kg_get_templates**: List graph templates
- **kg_remove_node**: Remove a node from a graph
Use these kg_ tools when the core tools don't cover what you need.

## HTML App Builder
For ALL HTML app tasks \u2014 creating, editing, debugging, fixing errors \u2014 use \`delegate_to_html_builder\`. This delegates to a specialized HTML Builder subagent that has focused tools for reading specific HTML sections and making precise edits. Pass the graphId, nodeId (if editing), task description, and any console errors. Do NOT call edit_html_node directly \u2014 always delegate to the HTML Builder subagent.

## Guidelines
0. **Graph IDs MUST be UUIDs**: When creating a new graph, ALWAYS generate a UUID for the graphId (e.g. "550e8400-e29b-41d4-a716-446655440000"). NEVER use human-readable names like "graph_science_of_compassion". Use crypto.randomUUID() format: 8-4-4-4-12 hex characters.
1. **Read before writing**: Always use read_graph before modifying a graph so you understand its current state. Use read_graph for structure overview, read_graph_content when you need the actual text.
2. **Don't re-read**: After read_graph, you already have node types, labels, and content previews. Do NOT call read_graph or kg_get_know_graph again just to check node types \u2014 use the data you already have.
3. **Confirm destructive changes**: Before overwriting node content, tell the user what you plan to change.
4. **Be concise**: Give clear, actionable responses. Use markdown for formatting.
5. **Use the right tool**: Pick the most specific tool for the job. Prefer core tools over kg_ tools when both can do the job.
6. **Graph context**: If the user has selected a graph in the UI, use that graphId for operations.
7. **userId**: The current user's ID is provided in the request context. Use it when tools need a userId parameter.
8. **Perplexity search -> nodes**: When creating nodes from perplexity_search results, ALWAYS include the citations. Format each fulltext node's info as markdown with a "## Sources" section at the bottom listing all citation URLs as markdown links. Also populate the node's bibl array with the citation URLs.
9. **Image usage**: When the user asks for images, search Pexels or Unsplash. Always credit photographers in the image node's info/alt text. Album images are served via https://vegvisr.imgix.net/{key} \u2014 append ?w=800&h=400&fit=crop for resizing.
10. **Image analysis**: Users can attach images directly in chat (drag & drop, paste, or file upload). When you receive a message with images, you can see them directly \u2014 do NOT call \`analyze_image\` for images already in the chat message. Only use \`analyze_image\` for images referenced by HTTPS URL (e.g. from albums, graph nodes). Each attached image includes metadata: URL images show the URL you can use for graph nodes; pasted images say "NO persistent URL" \u2014 in that case, tell the user to upload the image to their photo album first if they want to save it as a node.
    - **Image nodes**: Use type \`markdown-image\` (NOT \`image\`). Set \`path\` to the image URL. Set \`info\` to alt text/description.
11. **Formatting**: By default, use plain markdown for node content. When the user asks for styled/formatted content, call get_formatting_reference first to get the syntax.
12. **Graph results \u2014 IMPORTANT**: When the user asks to list or find graphs, you MUST ALWAYS format and display the full results immediately after calling the tool \u2014 never call a listing tool without showing the results. Format each graph as a markdown link using this exact URL pattern:
    \`[Graph Title](https://www.vegvisr.org/gnew-viewer?graphId=THE_GRAPH_ID)\`
    Replace THE_GRAPH_ID with the actual graph ID. The chat UI detects these links and renders them as rich interactive cards with metadata badges and a "View Graph" button. Without this exact URL format, results show as plain text. Include description and details as text around each link.
13. **Custom apps**: When building or editing HTML apps, ALWAYS use \`delegate_to_html_builder\`. Pass the graphId, task description, nodeId (if editing), and any console errors. The HTML Builder subagent handles creation, editing, and debugging. Always create graph first, then delegate. Include viewUrl as markdown link in your response.
14. **User templates**: Before building from scratch, check \`kg_get_templates\`. Offer to use existing templates as starting points. Mention "Save as Template" button on tool result cards.
15. **Semantic analysis**: Use \`analyze_node\` when the user asks about the meaning, sentiment, or importance of specific content. Use \`analyze_graph\` when they want to understand the overall theme, find the most important nodes, or get topic clusters. Pass \`store: true\` to save results in node metadata for future reference. The analysis uses Claude Sonnet for balanced quality and cost.
16. **Audio transcription**: Use \`list_recordings\` first to browse the user's audio portfolio and find recordings. Then use \`transcribe_audio\` with the recordingId to transcribe. For direct audio URLs, pass audioUrl instead. Default service is OpenAI Whisper (best quality). Use the \`language\` param for non-English audio (e.g. "no" for Norwegian). Set \`saveToPortfolio: true\` to persist transcription results back to the recording metadata. IMPORTANT: When the user asks to transcribe AND create a graph (or save to graph), ALWAYS use \`saveToGraph: true\` \u2014 this creates the graph with a fulltext node directly on the client, bypassing the LLM for the large text. This is MUCH faster than transcribing first and then calling create_graph/create_node separately.
17. **User profile / bio**: When the user asks "who am I", "show my bio", "write out my bio", or similar \u2014 call \`who_am_i\` and output the \`bio\` field EXACTLY as returned, without summarizing, paraphrasing, or shortening. The bio is the user's own content and must be reproduced verbatim.
18. **Track node IDs precisely**: When you create a node, the tool result returns the exact nodeId. ALWAYS use that exact ID for subsequent patch_node or add_edge calls \u2014 never guess or reconstruct IDs from memory. If unsure of a node's ID, call read_graph first. Common mistake: creating a node with nodeId "node-sentiment-chart" then later trying to patch "sentiment-chart" \u2014 this will fail.
19. **Transcription analysis**: Use \`analyze_transcription\` when the user asks for a "vurdering", "analyse", or "rapport" of a transcription. This produces a structured Norwegian-language report with key themes, success indicators, quotes, action points, and mentor feedback. Set \`conversationType\` to "1-1" for individual sessions or "group" for group sessions. By default it saves the analysis as a new fulltext node in the same graph. The analysis uses Claude Sonnet and the text is sent directly to Claude \u2014 it does NOT go through the main LLM loop.
20. **Booking workflow**: To book a meeting: (1) call \`calendar_get_settings\` to get available days, hours, and meeting types; (2) call \`calendar_check_availability\` with the desired date to see occupied slots; (3) compute a free slot from the available hours minus occupied slots; (4) call \`calendar_create_booking\` with ISO 8601 start/end times. If 409 conflict, suggest the next available slot. Use the current user's email (from \`who_am_i\`) as the owner email.
21. **Reschedule/cancel workflow**: To reschedule: (1) call \`calendar_list_bookings\` to find the booking ID; (2) call \`calendar_check_availability\` for the new date; (3) call \`calendar_reschedule_booking\` with the booking ID and new ISO 8601 times. If 409, suggest alternatives. To cancel: (1) find the booking ID from \`calendar_list_bookings\`; (2) call \`calendar_delete_booking\`. Both operations sync to Google Calendar automatically.`;
var FORMATTING_REFERENCE = `## Fulltext Formatting Elements

Use these ONLY when the user requests formatted/styled content. Plain markdown is the default.

**SECTION** \u2014 styled content block:
\`\`\`
[SECTION | background-color: 'lightblue'; color: 'black'; text-align: 'center'; font-size: '1.1em']
Your markdown content here
[END SECTION]
\`\`\`

**FANCY** \u2014 large styled title/heading:
\`\`\`
[FANCY | font-size: 4.5em; color: #2c3e50; text-align: center]
Your title here
[END FANCY]
\`\`\`
With background image: \`[FANCY | font-size: 3em; color: white; background-image: url('https://...'); text-align: center]\`
With gradient: \`[FANCY | font-size: 3em; background: linear-gradient(45deg, #f0f8ff, #e6f3ff); padding: 20px; border-radius: 10px]\`

**QUOTE** \u2014 styled quotation with citation:
\`\`\`
[QUOTE | Cited='Author Name']
Your quote text here
[END QUOTE]
\`\`\`

**WNOTE** \u2014 work note annotation:
\`\`\`
[WNOTE | Cited='Author']
Your work note here
[END WNOTE]
\`\`\`

**COMMENT** \u2014 comment block:
\`\`\`
[COMMENT | author: 'Name'; color: 'gray'; background-color: '#f9f9f9']
Your comment here
[END COMMENT]
\`\`\`

**IMAGEQUOTE** \u2014 text over background image:
\`\`\`
[IMAGEQUOTE backgroundImage:'https://...' aspectRatio:'16/9' textAlign:'center' padding:'2rem' fontSize:'1.5rem' cited:'Author']
Your overlay text
[END IMAGEQUOTE]
\`\`\`

**Images** \u2014 positioned images with text wrap:
Syntax: \`![Position-N|styles](url)\` where Position is Leftside, Rightside, or Header. N = number of paragraphs that wrap around the image.

- **Leftside-N**: Image on LEFT, next N paragraphs wrap on the RIGHT.
  \`![Leftside-2|width: 25%; height: 200px; object-fit: cover; object-position: center](url)\`
  The next 2 non-empty paragraphs wrap beside the image. Paragraph 3+ appears below at full width.

- **Rightside-N**: Image on RIGHT, next N paragraphs wrap on the LEFT.
  \`![Rightside-3|width: 20%; height: 250px; object-fit: cover](url)\`
  The next 3 non-empty paragraphs wrap beside the image.

- **Header**: Full-width image, NO text wrapping. Purely decorative.
  \`![Header|height: 300px; object-fit: cover; object-position: top](url)\`

If N is omitted (e.g. Leftside instead of Leftside-1), defaults to 1 paragraph.
Supported styles: width (default 20%), height (default 200px), object-fit (cover/contain/fill), object-position (center/top/bottom).
Keywords are case-sensitive: Leftside, Rightside, Header.

**FLEXBOX layouts** \u2014 image grids and cards:
- Grid: \`[FLEXBOX-GRID]\\n![Img|width:100px](url) ![Img|width:100px](url)\\n[END FLEXBOX]\`
- Gallery: \`[FLEXBOX-GALLERY]\\n![Img|width:150px](url) ![Img|width:150px](url)\\n[END FLEXBOX]\`
- Cards: \`[FLEXBOX-CARDS]\\n**Card Title**\\n![Thumb|width:60px](url)\\nContent\\n[END FLEXBOX]\`

**Style properties** use format: \`property: 'value'\` separated by \`;\`. Common: background-color, color, font-size, text-align, padding, border-radius, background-image, width, height.`;
var NODE_TYPES_REFERENCE = `## Node Types Reference

When creating nodes with create_node, set the correct nodeType and format the content (info field) as shown:

**mermaid-diagram** \u2014 Mermaid syntax for flowcharts, gantt, timelines, quadrants. The info field IS the mermaid code directly.
- Flowchart: \`graph TD\\nA[Start] --> B[Step 1]\\nB --> C[Step 2]\`
- Gantt: \`gantt\\n    title Project\\n    dateFormat YYYY-MM-DD\\n    section Phase 1\\n    Task A :a1, 2024-01-01, 14d\`
- Timeline: \`timeline\\n    title History\\n    section Era 1\\n        Event A : Detail\\n        Event B : Detail\`
- Quadrant: \`quadrantChart\\n    title Analysis\\n    x-axis Low --> High\\n    y-axis Low --> High\\n    quadrant-1 Expand\\n    Item A: [0.3, 0.6]\`

**youtube-video** \u2014 YouTube embed. Info = description text. Label = \`![YOUTUBE src=https://www.youtube.com/embed/VIDEO_ID]Video Title[END YOUTUBE]\`

**chart** \u2014 Horizontal bar chart. Info = JSON array: \`[{"label":"Item A","value":100,"color":"#4a90e2"},{"label":"Item B","value":200,"color":"#e94e77"}]\`

**linechart** \u2014 Line chart. Info = JSON object:
- Single series: \`{"data":[{"x":1,"y":10},{"x":2,"y":15}],"xLabel":"Time","yLabel":"Value"}\`
- Multi series: \`{"data":[{"label":"Series A","color":"#4a90e2","points":[{"x":1,"y":10},{"x":2,"y":15}]},{"label":"Series B","color":"#e94e77","points":[{"x":1,"y":7},{"x":2,"y":12}]}],"xLabel":"Time","yLabel":"Value"}\`

**bubblechart** \u2014 Bubble chart. Info = JSON: \`{"data":[{"x":90,"y":20000,"size":50,"label":"Item A","color":"#4a90e2"}],"xLabel":"X Axis","yLabel":"Y Axis"}\`

**notes** \u2014 Short note/insight (50-150 words plain text). Color: use a pastel like #f0f0f0.

**worknote** \u2014 Work-in-progress annotation. Format: "YYYY-MM-DD: @username - Summary\\n\\nDetails...". Color: #FFD580 (amber).

**map** \u2014 Map node. Info = descriptive text about the locations. The map data (KML/coordinates) is managed separately by the viewer.

**data-node** \u2014 Encrypted structured data storage (JSON records). Info = JSON array of record objects.
Each record auto-gets _id (UUID) and _ts (ISO timestamp). Use metadata.schema.columns to define fields:
\`[{"key":"name","label":"Name","type":"text"},{"key":"email","label":"Email","type":"email"}]\`.
Supported field types: text, email, tel, url, number, textarea, select, checkbox, date.
Data is encrypted at rest in the KG. Node ID must be a UUID. Label should start with # for landing page visibility.
Use save_form_data tool to create/append records and query_data_nodes to read them.

**fulltext** \u2014 Standard markdown content (default).
**image** \u2014 Alt text in info, image URL in path field.
**link** \u2014 URL in info field.

## App Data Tables (Drizzle / D1)
Use these tools for proper relational database storage when you need SQL queries, filtering, and pagination:
- **create_app_table**: Create a relational table linked to a graphId. Column types: text, integer, real, boolean, datetime.
- **insert_app_record**: Insert a record into an app table by tableId.
- **query_app_table**: Query records with optional WHERE filters, ORDER BY, LIMIT/OFFSET.
Tables are stored in D1 (SQLite) and support proper indexes and queries. Prefer this over data-node for apps that need structured data with many records.
For landing page forms: create a table, then store the tableId in the data-node metadata as drizzleTableId.

**Client-side HTML apps**: For Drizzle API endpoint details (POST /query, /insert, /raw-query, GET /tables, /table), call \`get_html_builder_reference\` \u2014 it has the complete API with request/response formats.

## Chat Group Management (Hallo Vegvisr)
- **list_chat_groups**: List all chat groups in Hallo Vegvisr. Returns group IDs and names.
- **add_user_to_chat_group**: Add a vegvisr.org user (by email) to a Hallo Vegvisr chat group. Provide the email and either groupId or groupName. The tool looks up the user in vegvisr_org, verifies the group exists, and adds them as a member.
- **get_group_messages**: Get recent messages from a chat group. Returns message text, sender email, and timestamp. Use this when the user asks to see messages, analyze conversations, or do sentiment analysis. You can then analyze the returned messages directly.
- **get_group_stats**: Get activity statistics for all chat groups \u2014 message count, member count, last message time. Use when the user asks which group is most active or wants an overview.
- **send_group_message**: Send a text or voice message to a chat group. For text: requires email, group, body. For voice: requires email, group, audioUrl (get from list_recordings). Optionally include transcriptText for voice messages.
- **create_chat_group**: Create a new chat group. Requires email (creator becomes owner) and group name. Optionally link a knowledge graph via graphId.
- **register_chat_bot**: Register an AI chatbot in a chat group. Requires a knowledge graph ID (bot personality) and bot name. The graph's fulltext nodes define the bot's personality and guidelines.
- **get_group_members**: Get all members of a chat group with names, emails, IDs, roles (owner/member/bot), and profile images.
- **trigger_bot_response**: Trigger a chatbot to respond to recent group messages. Loads bot personality from its knowledge graph, generates a response via Claude, and posts it to the group.`;
var HTML_BUILDER_REFERENCE = `## HTML App Builder Reference

### Handling Preview Console Errors
When you receive a message about runtime errors, JavaScript errors, or console errors from the HTML preview \u2014 ACT IMMEDIATELY. Do NOT ask the user for more information. Do NOT give debugging advice. You have the graph context and node ID \u2014 use them. This is a MANDATORY rule.
1. **Read the source**: Use \`read_node\` with the graphId and nodeId from the Current Context (injected in your system prompt) or from the error message. If you have a Current Context with an active HTML node, ALWAYS use that nodeId \u2014 do NOT guess or ask.
2. **Find the bug**: Trace each error to the specific code that causes it. Look at fetch URLs, variable references, function calls, event handlers.
3. **Delegate to HTML Builder**: Use \`delegate_to_html_builder\` to fix the code. Pass the graphId, nodeId, task description, and the console errors. The HTML Builder subagent will read the relevant sections and make precise edits.
4. **Common issues**:
   - 404 errors: wrong API endpoint URL \u2014 check the Drizzle API section below
   - "Failed to fetch": CORS issue or wrong URL
   - "is not defined": missing variable or function declaration
   - "is not a function": wrong method name or missing library
5. **Use the log context**: Error messages from well-instrumented code will include \`[functionName]\` prefixes. Use these to find the exact function in the HTML source that needs fixing.
6. **When fixing, maintain AND improve logging**: Keep all existing console.log/error statements. When fixing a bug, ALWAYS add descriptive logging around the fix so that if it fails again, the error message explains exactly what went wrong and where. Never remove instrumentation.
7. **Upgrade existing code that lacks logging**: When you read_node and see HTML with bare fetch().catch(e => console.error(e)) or no error handling at all, ADD proper [functionName] logging as part of your fix \u2014 even if the user didn't ask for it. Every patch is an opportunity to improve observability.
8. **Log before AND after**: For every fetch/API call, log what you are about to do ([loadContacts] Fetching contacts...) AND the result ([loadContacts] Got 12 contacts or [loadContacts] Failed: 404). This makes the console output tell a complete story.
Do NOT give generic debugging advice. You have the tools to read the actual code and fix it \u2014 use them.

### Be PROACTIVE \u2014 Think Beyond the Immediate Task
When you create, patch, or fix code, do NOT solve only the single thing in front of you. Ask: "where else does this problem or principle apply?" and handle ALL of those places in the same action.

#### When CREATING an HTML app:
- Before writing any fetch() call, verify the endpoint exists in the Drizzle API section below. If it is not listed there, do NOT use it.
- Anticipate runtime failures: What if the API is down? What if the response is empty? What if the user has no data yet? Add graceful handling for all of these.
- Check every browser API your HTML uses (fetch, prompt, alert, localStorage, window.open) \u2014 all must work in a sandboxed iframe.

#### CRITICAL \u2014 Understand the data model BEFORE adding data-related features:
When the user asks for features that touch data (import, export, search, filter, sort, delete, bulk edit), you MUST first:
1. **Read the HTML source** with read_node \u2014 find where data comes from (fetch URL, localStorage, hardcoded array)
2. **Identify the data variable** \u2014 what variable holds the records? (e.g. \`contacts\`, \`items\`, \`data\`) Where is it declared? What scope is it in?
3. **Identify the render function** \u2014 what function displays the data? (e.g. \`renderContacts()\`, \`displayList()\`) Your new feature must call this after modifying data.
4. **Identify the persistence layer** \u2014 is it Drizzle (\`POST /query\`, \`POST /insert\`), localStorage, or in-memory only? Export reads from this. Import writes to this AND updates the in-memory variable AND re-renders.
5. **Plan the data flow**: For CSV export: read variable \u2192 convert to CSV \u2192 download. For CSV import: parse file \u2192 validate \u2192 write to persistence \u2192 update variable \u2192 re-render. Every step must use the ACTUAL variable names and function names from the existing code.
Do NOT add data features by guessing variable names or assuming a data structure. Read the code first.

#### CRITICAL \u2014 ALL HTML modifications go through delegate_to_html_builder:
NEVER use patch_node or edit_html_node directly to modify existing HTML content. Always use \`delegate_to_html_builder\` which has specialized tools for reading sections and making precise edits.
- **To edit, fix, or add features**: delegate to the HTML Builder with a clear task description
- **Only use patch_node** when creating a completely new html-node from scratch

#### When PATCHING code (fixing a bug):
- After fixing the reported bug, scan the REST of the HTML for the same class of problem. If one fetch calls a wrong endpoint, check ALL fetches in the app. If one event handler has no error handling, check ALL event handlers.
- Do not fix just line 42 and leave the identical bug on line 108.

#### When FIXING preview errors:
- If the error is "404 on /update", do not just fix that one call. Search the entire HTML for ALL endpoint URLs and verify each one exists.
- If the error is "X is not defined", check if other variables or functions also have the same scoping problem.
- After fixing, mentally run through the app as a user: click every button, fill every form, trigger every action. Would anything else break?

#### When READING existing code:
- If you read an html-node and notice problems (missing error handling, wrong endpoints, no logging), proactively tell the user and offer to fix them \u2014 do not wait for runtime errors to expose them.

#### When the user asks for SUGGESTIONS or feature ideas:
- ALWAYS read the actual HTML source first with read_node. Base your suggestions on what the code ACTUALLY has and is missing \u2014 never give generic advice.
- Look for: missing error handling, no loading states, no empty-state messages, no search/filter, no data export, missing accessibility, no mobile responsiveness, missing input validation.
- Suggest specific improvements tied to what you see: "Your contact list has no search \u2014 I can add a filter bar" is proactive. "Consider adding search functionality" is generic and unhelpful.
- Prioritize: code quality fixes first (bugs, error handling, logging), then UX improvements (loading states, empty states), then new features (search, export, etc.).

### MANDATORY Error Logging in Generated HTML
Every fetch() call and every event handler MUST include descriptive console.error() with context about WHAT failed and WHERE. The preview console captures these \u2014 vague errors make debugging impossible. Example:
\`\`\`js
// GOOD \u2014 descriptive context
async function loadContacts() {
  try {
    const res = await fetch('https://drizzle.vegvisr.org/query', { method: 'POST', ... });
    if (!res.ok) { console.error('[loadContacts] Query failed:', res.status, await res.text()); return; }
    const data = await res.json();
    console.log('[loadContacts] Loaded', data.records?.length, 'contacts');
  } catch (err) { console.error('[loadContacts] Network error:', err.message); }
}
// BAD \u2014 no context
fetch(url).then(r => r.json()).catch(e => console.error(e));
\`\`\`
- Every function that does I/O should include a console.log at the start with the function name as a prefix string. Example: \`console.log('[loadContacts] Starting...')\`. The bracket prefix is ONLY used INSIDE console.log/console.error string arguments \u2014 it is NOT valid JavaScript syntax on its own. NEVER write \`[functionName]\` as a standalone line of code \u2014 that is a syntax error.
- Log success too (e.g. \`console.log('[saveContact] Saved OK')\`) so the console shows the full flow, not just failures
- For event handlers: log which UI action triggered the call (e.g. \`console.log('[onSave] Save button clicked for contact:', id)\`)

### Runtime Data Endpoints for HTML Apps
- **Album images**: Use \`fetch('https://albums.vegvisr.org/photo-album?name=ALBUM_NAME')\` at runtime. Response: \`{ images: ["key1", "key2", ...] }\`. Render: \`https://vegvisr.imgix.net/{key}?w=800&h=600&fit=crop\`. Do NOT use get_album_images to embed URLs \u2014 let the app fetch them live.
- **Graph data**: Use \`fetch('https://knowledge.vegvisr.org/getknowgraph?id=GRAPH_ID')\` at runtime.
- **Graph summaries**: \`/getknowgraphsummaries\` response has \`data.results\` (not \`data.graphs\`). Each result has nested \`metadata\` object: use \`r.metadata.title\`, \`r.metadata.metaArea\`, \`r.metadata.category\` \u2014 NOT flat fields like \`r.metaArea\`.

### Template Design System \u2014 CSS Variables
All built-in templates (landing-page, editable-page, theme-builder, agent-chat) share the same CSS custom properties. When the user says "use the same palette as the landing page" or "match the template style", use these variables:
\`\`\`css
:root {
  --bg1: #0b1220;         /* primary background (dark) */
  --bg2: #111827;         /* secondary background */
  --text: #fff;           /* main text color */
  --muted: rgba(255,255,255,0.72);  /* secondary text */
  --soft: rgba(255,255,255,0.58);   /* tertiary text / subtle */
  --accent: #38bdf8;      /* primary accent (sky blue) */
  --accent2: #8b5cf6;     /* secondary accent (purple) */
  --card-bg: rgba(255,255,255,0.06);    /* card background */
  --card-border: rgba(255,255,255,0.12); /* card border */
  --line: rgba(255,255,255,0.12);        /* dividers/lines */
  --radius: 14px;         /* border radius */
}
\`\`\`
**Body gradient**: \`background-image: radial-gradient(circle at top, color-mix(in srgb, var(--accent) 20%, transparent), transparent 55%), radial-gradient(circle at bottom, color-mix(in srgb, var(--accent2) 18%, transparent), transparent 55%);\`
**Font stack**: \`ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial\`
ALWAYS use these CSS variables instead of hardcoded colors \u2014 this ensures visual consistency with the rest of the platform and allows theme switching to work.

### Drizzle API (Client-side HTML apps)
Use \`https://drizzle.vegvisr.org\` for app table operations from the browser.

**POST /query** \u2014 Read records:
\`\`\`js
fetch('https://drizzle.vegvisr.org/query', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    tableId: 'uuid-of-table',           // required
    where: { email: 'john@test.com' },  // optional \u2014 equality filters only, AND-joined
    orderBy: '_created_at',              // optional \u2014 default: _created_at
    order: 'desc',                       // optional \u2014 asc or desc, default: desc
    limit: 50,                           // optional \u2014 1-1000, default: 50
    offset: 0                            // optional \u2014 pagination
  })
})
// Response: { records: [...], total: 120, limit: 50, offset: 0 }
// IMPORTANT: records are in response.records \u2014 NOT response.results or response.data
\`\`\`

**POST /insert** \u2014 Add a record:
\`\`\`js
fetch('https://drizzle.vegvisr.org/insert', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    tableId: 'uuid-of-table',
    record: { name: 'John', email: 'john@test.com', phone: '12345678' }
  })
})
// Response: { success: true, _id: 'new-record-uuid', _created_at: '2026-03-09T...' }
// System fields _id and _created_at are auto-generated \u2014 do NOT include them
\`\`\`

**GET /tables?graphId=X** \u2014 Discover existing tables for a graph:
\`\`\`js
fetch('https://drizzle.vegvisr.org/tables?graphId=' + GRAPH_ID)
// Response: { tables: [{ tableId, displayName, graphId, columns: [...] }] }
\`\`\`

**GET /table/{tableId}** \u2014 Get table schema:
\`\`\`js
fetch('https://drizzle.vegvisr.org/table/' + tableId)
// Response: { tableId, displayName, graphId, columns: [{ name, label, type }] }
\`\`\`

**POST /raw-query** \u2014 Custom read-only SQL (SELECT only):
\`\`\`js
fetch('https://drizzle.vegvisr.org/raw-query', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sql: 'SELECT * FROM app_table_xxx WHERE name LIKE ?', params: ['%john%'] })
})
// Response: { results: [...] }
// ONLY SELECT allowed \u2014 INSERT/UPDATE/DELETE will return 403
\`\`\`

**There is NO /update, NO /delete endpoint.** To update: read record, delete+re-insert via /raw-query workaround, or use localStorage as mutable cache.

**Critical rules**:
- Do NOT use knowledge.vegvisr.org for table operations
- Do NOT generate HTML that calls endpoints that do not exist
- ALWAYS access response data as \`response.records\` (from /query) or \`response.results\` (from /raw-query)
- Every table has system columns \`_id\` and \`_created_at\` auto-added
- WHERE filters are equality-only and AND-joined \u2014 for LIKE/range, use /raw-query`;

// html-builder-subagent.js
var HTML_BUILDER_SYSTEM_PROMPT = `You are the HTML Builder \u2014 a specialist subagent for creating and editing HTML apps in the Vegvisr knowledge graph.

## CRITICAL: Always Use read_html_section (NEVER skip this)
You have a special tool called \`read_html_section\` that reads specific parts of HTML with line numbers. You MUST use it before ANY edit. DO NOT use read_node \u2014 it dumps the entire HTML and you cannot match exact strings from that.

## Debugging Strategy (follow this EXACTLY for error fixes)
1. **Search for the error**: Use \`read_html_section\` with \`search: "errorKeyword"\` to find where the error originates.
2. **Search for ALL references**: Use \`read_html_section\` with \`search: "variableName"\` to find EVERY place a variable/function is used. This reveals mismatches (e.g., code uses \`contacts\` but the declared variable is \`allContacts\`).
3. **Understand the root cause**: The bug is usually a NAME MISMATCH, not a missing declaration. Compare what the error references vs what the code actually declares.
4. **Fix the references, not the declarations**: If the app declares \`allContacts\` but a function uses \`contacts\`, fix the function to use \`allContacts\` \u2014 do NOT add a new \`contacts\` variable.
5. **Search for the same bug elsewhere**: After fixing one reference, search again to find ALL other places with the same mismatch.

## Editing Strategy
1. Use \`read_html_section\` FIRST to read ONLY the section you need (e.g., section: "script", or search: "functionName").
2. Copy the EXACT text from the returned content into \`edit_html_node\` old_string. Keep old_string SHORT (1-5 lines) and UNIQUE.
3. If edit_html_node fails, re-read with read_html_section to get the EXACT current text \u2014 do NOT guess.
4. For multiple changes, make them one at a time.
5. NEVER try to reproduce text from memory. Always read first, then edit.

## HTML Rules
- All HTML must be self-contained (inline CSS, inline JS)
- Every fetch() call must have: console.error('[functionName] Error:', error)
- Log success too: console.log('[functionName] Loaded N records')
- Use Drizzle API at https://drizzle.vegvisr.org for data operations
  - POST /query with { tableId } for reads \u2192 returns { records: [...] }
  - POST /insert with { tableId, record } for writes \u2192 returns { success, _id }
  - GET /tables?graphId=X for table discovery
  - There is NO /update, NO /delete endpoint

## Scoping Rules for JS Edits
- Insert new JS INSIDE the existing <script> block, not outside
- Find the scope boundary and insert BEFORE its closing brace
- Match onclick handler names to function definitions exactly

After completing your task, provide a brief summary of what you changed.`;
var READ_HTML_SECTION_TOOL = {
  name: "read_html_section",
  description: "Read a specific section or line range of an HTML node. Returns content with line numbers. Use this BEFORE edit_html_node so you have the exact text to match.",
  input_schema: {
    type: "object",
    properties: {
      graphId: { type: "string", description: "The graph ID" },
      nodeId: { type: "string", description: "The html-node ID" },
      section: {
        type: "string",
        enum: ["head", "style", "body", "script", "full"],
        description: 'Which section to read. "script" returns <script> blocks. "style" returns <style> blocks. "full" returns entire HTML (capped at 200 lines).'
      },
      startLine: {
        type: "integer",
        description: "Start line number (1-based). Use with endLine for precise line ranges. Takes priority over section."
      },
      endLine: {
        type: "integer",
        description: "End line number (inclusive). Max range: 100 lines."
      },
      search: {
        type: "string",
        description: "Search for a string in the HTML. Returns 10 lines of context around each match with line numbers. Best way to find exact text for edit_html_node."
      }
    },
    required: ["graphId", "nodeId"]
  }
};
async function executeReadHtmlSection(input, env) {
  const res = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(input.graphId)}`
  );
  const graphData = await res.json();
  if (!res.ok) throw new Error(graphData.error || "Graph not found");
  const node = graphData.nodes?.find((n) => n.id === input.nodeId);
  if (!node) throw new Error(`Node "${input.nodeId}" not found`);
  const html = (node.info || "").replace(/\r\n/g, "\n");
  const lines = html.split("\n");
  const totalLines = lines.length;
  const totalChars = html.length;
  if (input.startLine && input.endLine) {
    const start = Math.max(1, input.startLine) - 1;
    const end = Math.min(totalLines, input.endLine);
    const maxRange = 100;
    const slice = lines.slice(start, Math.min(start + maxRange, end));
    const numbered = slice.map((line, i) => `${start + i + 1}: ${line}`).join("\n");
    return {
      graphId: input.graphId,
      nodeId: input.nodeId,
      totalLines,
      totalChars,
      range: `${start + 1}-${Math.min(start + maxRange, end)}`,
      content: numbered
    };
  }
  if (input.search) {
    const matches = [];
    const searchLower = input.search.toLowerCase();
    const seenRanges = /* @__PURE__ */ new Set();
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(searchLower)) {
        const contextStart = Math.max(0, i - 10);
        const contextEnd = Math.min(totalLines, i + 11);
        const rangeKey = `${contextStart}-${contextEnd}`;
        if (seenRanges.has(rangeKey)) continue;
        seenRanges.add(rangeKey);
        const context = lines.slice(contextStart, contextEnd).map((line, j) => `${contextStart + j + 1}${j + contextStart === i ? ">" : ":"} ${line}`).join("\n");
        matches.push({ line: i + 1, context });
        if (matches.length >= 5) break;
      }
    }
    return {
      graphId: input.graphId,
      nodeId: input.nodeId,
      totalLines,
      totalChars,
      searchTerm: input.search,
      matchCount: matches.length,
      matches
    };
  }
  const section = input.section || "full";
  if (section === "full") {
    const cap = Math.min(totalLines, 200);
    const numbered = lines.slice(0, cap).map((l, i) => `${i + 1}: ${l}`).join("\n");
    return {
      graphId: input.graphId,
      nodeId: input.nodeId,
      totalLines,
      totalChars,
      section: "full",
      truncated: cap < totalLines,
      content: numbered
    };
  }
  const sectionRegexes = {
    style: /<style[^>]*>([\s\S]*?)<\/style>/gi,
    script: /<script[^>]*>([\s\S]*?)<\/script>/gi,
    head: /<head[^>]*>([\s\S]*?)<\/head>/i,
    body: /<body[^>]*>([\s\S]*?)<\/body>/i
  };
  const regex = sectionRegexes[section];
  if (!regex) throw new Error(`Unknown section: ${section}`);
  const sectionMatches = [];
  let match;
  while ((match = regex.exec(html)) !== null) {
    const beforeMatch = html.substring(0, match.index);
    const startLine = beforeMatch.split("\n").length;
    const sectionLines = match[0].split("\n");
    const numbered = sectionLines.map((l, i) => `${startLine + i}: ${l}`).join("\n");
    sectionMatches.push({
      startLine,
      endLine: startLine + sectionLines.length - 1,
      lineCount: sectionLines.length,
      content: numbered
    });
  }
  return {
    graphId: input.graphId,
    nodeId: input.nodeId,
    totalLines,
    totalChars,
    section,
    blocks: sectionMatches,
    message: sectionMatches.length === 0 ? `No <${section}> blocks found` : `Found ${sectionMatches.length} <${section}> block(s)`
  };
}
__name(executeReadHtmlSection, "executeReadHtmlSection");
var SUBAGENT_TOOL_NAMES = /* @__PURE__ */ new Set([
  "edit_html_node",
  "create_html_node",
  "create_html_from_template",
  "read_node",
  "patch_node",
  "get_html_builder_reference",
  "get_contract"
]);
function getSubagentTools() {
  const tools = TOOL_DEFINITIONS.filter((t) => SUBAGENT_TOOL_NAMES.has(t.name));
  tools.push(READ_HTML_SECTION_TOOL);
  return tools;
}
__name(getSubagentTools, "getSubagentTools");
async function runHtmlBuilderSubagent(input, env, onProgress, executeTool2) {
  const { graphId, nodeId, task, consoleErrors, userId } = input;
  const maxTurns = 8;
  const model = "claude-sonnet-4-20250514";
  const log = /* @__PURE__ */ __name((msg) => console.log(`[html-builder-subagent] ${msg}`), "log");
  const progress = typeof onProgress === "function" ? onProgress : () => {
  };
  let userMessage = `## Task
${task}

## Context
- graphId: ${graphId}`;
  if (nodeId) userMessage += `
- nodeId: ${nodeId}`;
  if (consoleErrors && consoleErrors.length > 0) {
    userMessage += `

## Console Errors
${consoleErrors.map((e) => `- ${e}`).join("\n")}`;
  }
  userMessage += `

Remember: use read_html_section FIRST to read the relevant section before editing.`;
  const messages = [{ role: "user", content: userMessage }];
  const tools = getSubagentTools();
  let turn = 0;
  const actions = [];
  log(`started | graphId=${graphId} nodeId=${nodeId || "none"} task="${task.slice(0, 100)}"`);
  progress("HTML Builder started...");
  while (turn < maxTurns) {
    turn++;
    log(`turn ${turn}/${maxTurns}`);
    progress(`HTML Builder thinking (turn ${turn}/${maxTurns})...`);
    const response = await env.ANTHROPIC.fetch("https://anthropic.vegvisr.org/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: userId || "html-builder-subagent",
        messages,
        model,
        max_tokens: 8192,
        temperature: 0.2,
        system: HTML_BUILDER_SYSTEM_PROMPT,
        tools
      })
    });
    const data = await response.json();
    if (!response.ok) {
      log(`ERROR: ${JSON.stringify(data.error)}`);
      return { success: false, error: data.error || "Anthropic API error", turns: turn, actions };
    }
    if (data.stop_reason === "end_turn") {
      const text = (data.content || []).filter((c) => c.type === "text").map((b) => b.text).join("\n");
      log(`end_turn \u2014 summary: ${text.slice(0, 200)}`);
      return {
        success: true,
        summary: text,
        turns: turn,
        actions,
        graphId,
        nodeId: nodeId || actions.find((a) => a.nodeId)?.nodeId
      };
    }
    if (data.stop_reason === "tool_use") {
      const toolUses = (data.content || []).filter((c) => c.type === "tool_use");
      log(`tool_use \u2014 ${toolUses.length} tools: [${toolUses.map((t) => t.name).join(", ")}]`);
      const toolResults = [];
      for (const toolUse of toolUses) {
        progress(`HTML Builder: ${toolUse.name}...`);
        try {
          let result;
          if (toolUse.name === "read_html_section") {
            result = await executeReadHtmlSection(toolUse.input, env);
          } else {
            result = await executeTool2(toolUse.name, { ...toolUse.input, userId }, env, {});
          }
          const resultStr = JSON.stringify(result);
          actions.push({
            tool: toolUse.name,
            success: true,
            nodeId: toolUse.input.nodeId || result.nodeId,
            summary: result.message || `${toolUse.name} ok`
          });
          const truncated = resultStr.length > 8e3 ? resultStr.slice(0, 8e3) + "... [truncated]" : resultStr;
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: truncated
          });
        } catch (error) {
          log(`${toolUse.name} FAILED: ${error.message}`);
          actions.push({ tool: toolUse.name, success: false, error: error.message });
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify({ error: error.message })
          });
        }
      }
      messages.push(
        { role: "assistant", content: data.content },
        { role: "user", content: toolResults }
      );
    } else {
      log(`stop_reason: ${data.stop_reason}`);
      messages.push(
        { role: "assistant", content: data.content },
        { role: "user", content: "Continue. You have more turns available." }
      );
    }
  }
  log(`max turns reached (${maxTurns})`);
  return {
    success: actions.some((a) => a.success),
    summary: `HTML Builder completed ${actions.length} actions in ${turn} turns (max turns reached).`,
    turns: turn,
    actions,
    graphId,
    nodeId: nodeId || actions.find((a) => a.nodeId)?.nodeId,
    maxTurnsReached: true
  };
}
__name(runHtmlBuilderSubagent, "runHtmlBuilderSubagent");

// tool-executors.js
async function executeCreateGraph(input, env) {
  const existsRes = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(input.graphId)}`
  );
  if (existsRes.ok) {
    const existing = await existsRes.json();
    if (existing && existing.nodes) {
      return {
        graphId: input.graphId,
        version: existing.metadata?.version || 0,
        alreadyExists: true,
        nodeCount: existing.nodes.length,
        edgeCount: existing.edges?.length || 0,
        message: `Graph "${input.graphId}" already exists (${existing.nodes.length} nodes). You can add nodes to it directly.`,
        viewUrl: `https://www.vegvisr.org/gnew-viewer?graphId=${input.graphId}`
      };
    }
  }
  const graphData = {
    metadata: {
      title: input.title,
      description: input.description || "",
      category: input.category || "",
      metaArea: input.metaArea || "",
      createdBy: input.userId || "agent-worker",
      version: 0,
      userId: input.userId || "agent-system",
      tags: input.tags || []
    },
    nodes: [],
    edges: []
  };
  const response = await env.KG_WORKER.fetch("https://knowledge-graph-worker/saveGraphWithHistory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: input.graphId, graphData })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Failed to create graph (status: ${response.status})`);
  }
  return {
    graphId: data.id || input.graphId,
    version: data.newVersion || 1,
    message: `Graph "${input.title}" created successfully`,
    viewUrl: `https://www.vegvisr.org/gnew-viewer?graphId=${input.graphId}`
  };
}
__name(executeCreateGraph, "executeCreateGraph");
function truncateNodeInfo(info, type) {
  if (!info) return { text: "", truncated: false };
  const limits = {
    "html-node": 200,
    "css-node": 200,
    "fulltext": 2e3,
    "info": 2e3,
    "mermaid-diagram": 500
  };
  const limit = limits[type] || 500;
  if (info.length <= limit) return { text: info, truncated: false };
  return { text: info.slice(0, limit) + "...", truncated: true };
}
__name(truncateNodeInfo, "truncateNodeInfo");
async function executeReadGraph(input, env) {
  const res = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(input.graphId)}`
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph not found: ${err}`);
  }
  const graphData = await res.json();
  const nodes = (graphData.nodes || []).map((n) => {
    const { text, truncated } = truncateNodeInfo(n.info, n.type);
    const node = {
      id: n.id,
      label: n.label,
      type: n.type,
      info: text,
      path: n.path || void 0,
      color: n.color || void 0
    };
    if (truncated) {
      node.info_truncated = true;
      node.info_full_length = n.info.length;
    }
    return node;
  });
  return {
    graphId: input.graphId,
    metadata: graphData.metadata || {},
    nodeCount: nodes.length,
    edgeCount: (graphData.edges || []).length,
    nodes,
    edges: (graphData.edges || []).slice(0, 50)
  };
}
__name(executeReadGraph, "executeReadGraph");
async function executeReadGraphContent(input, env) {
  const res = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(input.graphId)}`
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph not found: ${err}`);
  }
  const graphData = await res.json();
  let nodes = graphData.nodes || [];
  if (input.nodeTypes && Array.isArray(input.nodeTypes) && input.nodeTypes.length > 0) {
    nodes = nodes.filter((n) => input.nodeTypes.includes(n.type));
  }
  return {
    graphId: input.graphId,
    metadata: graphData.metadata || {},
    nodeCount: nodes.length,
    nodes: nodes.map((n) => ({
      id: n.id,
      label: n.label,
      type: n.type,
      info: n.info || "",
      path: n.path || void 0,
      color: n.color || void 0,
      metadata: n.metadata || void 0
    }))
  };
}
__name(executeReadGraphContent, "executeReadGraphContent");
async function executeReadNode(input, env) {
  const res = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(input.graphId)}`
  );
  if (!res.ok) throw new Error("Graph not found");
  const graphData = await res.json();
  const node = (graphData.nodes || []).find((n) => String(n.id) === String(input.nodeId));
  if (!node) throw new Error(`Node "${input.nodeId}" not found in graph "${input.graphId}"`);
  return {
    graphId: input.graphId,
    node: {
      id: node.id,
      label: node.label,
      type: node.type,
      info: node.info || "",
      path: node.path || void 0,
      color: node.color || void 0,
      metadata: node.metadata || void 0,
      bibl: node.bibl || [],
      position: node.position || {},
      visible: node.visible
    }
  };
}
__name(executeReadNode, "executeReadNode");
async function executePatchNode(input, env) {
  const res = await env.KG_WORKER.fetch("https://knowledge-graph-worker/patchNode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      graphId: input.graphId,
      nodeId: input.nodeId,
      fields: input.fields
    })
  });
  const data = await res.json();
  if (!res.ok) {
    const errMsg = data.error || `patchNode failed (${res.status})`;
    if (errMsg.toLowerCase().includes("not found")) {
      try {
        const graphRes = await env.KG_WORKER.fetch(
          `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(input.graphId)}`
        );
        const graphData = await graphRes.json();
        if (graphRes.ok && graphData.nodes) {
          const nodeIds = graphData.nodes.map((n) => `"${n.id}" (${n.label})`).join(", ");
          throw new Error(`${errMsg}. Valid node IDs in this graph: ${nodeIds}`);
        }
      } catch (e) {
        if (e.message.includes("Valid node IDs")) throw e;
      }
    }
    throw new Error(errMsg);
  }
  return {
    graphId: input.graphId,
    nodeId: input.nodeId,
    updatedFields: Object.keys(input.fields),
    version: data.newVersion,
    message: `Node "${input.nodeId}" updated: ${Object.keys(input.fields).join(", ")}`
  };
}
__name(executePatchNode, "executePatchNode");
async function executeEditHtmlNode(input, env) {
  const readRes = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(input.graphId)}`
  );
  const graphData = await readRes.json();
  if (!readRes.ok) {
    throw new Error(graphData.error || `Failed to read graph (${readRes.status})`);
  }
  const node = graphData.nodes?.find((n) => n.id === input.nodeId);
  if (!node) {
    const validIds = graphData.nodes?.map((n) => `"${n.id}" (${n.label})`).join(", ") || "none";
    throw new Error(`Node "${input.nodeId}" not found. Valid node IDs: ${validIds}`);
  }
  if (node.type !== "html-node" && node.type !== "css-node") {
    throw new Error(`edit_html_node only works on html-node or css-node types. Node "${input.nodeId}" is type "${node.type}". Use patch_node instead.`);
  }
  const currentHtml = (node.info || "").replace(/\r\n/g, "\n");
  let oldString = input.old_string;
  let newString = input.new_string;
  if (oldString.includes("\\n")) oldString = oldString.replace(/\\n/g, "\n");
  if (newString.includes("\\n")) newString = newString.replace(/\\n/g, "\n");
  if (oldString.includes("\\t")) oldString = oldString.replace(/\\t/g, "	");
  if (newString.includes("\\t")) newString = newString.replace(/\\t/g, "	");
  oldString = oldString.replace(/\r\n/g, "\n");
  newString = newString.replace(/\r\n/g, "\n");
  const occurrences = currentHtml.split(oldString).length - 1;
  if (occurrences === 0) {
    const flexPattern = oldString.replace(/\s+/g, "\\s+");
    let flexMatch = null;
    try {
      const regex = new RegExp(flexPattern);
      flexMatch = currentHtml.match(regex);
    } catch (e) {
    }
    const preview = currentHtml.substring(0, 500);
    let errorMsg = `old_string not found in node "${input.nodeId}". The string must match EXACTLY (including whitespace and newlines).`;
    if (flexMatch) {
      errorMsg += `

A similar string was found with different whitespace. The actual text is:
${flexMatch[0].substring(0, 300)}`;
    }
    errorMsg += `

First 500 chars of current content:
${preview}`;
    throw new Error(errorMsg);
  }
  if (occurrences > 1 && !input.replace_all) {
    throw new Error(`old_string found ${occurrences} times in node "${input.nodeId}". Either provide more context to make it unique, or set replace_all: true to replace all occurrences.`);
  }
  let newHtml;
  if (input.replace_all) {
    newHtml = currentHtml.split(oldString).join(newString);
  } else {
    const idx = currentHtml.indexOf(oldString);
    newHtml = currentHtml.substring(0, idx) + newString + currentHtml.substring(idx + oldString.length);
  }
  const patchRes = await env.KG_WORKER.fetch("https://knowledge-graph-worker/patchNode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      graphId: input.graphId,
      nodeId: input.nodeId,
      fields: { info: newHtml }
    })
  });
  const patchData = await patchRes.json();
  if (!patchRes.ok) {
    throw new Error(patchData.error || `patchNode failed (${patchRes.status})`);
  }
  const replacements = input.replace_all ? occurrences : 1;
  return {
    graphId: input.graphId,
    nodeId: input.nodeId,
    replacements,
    oldLength: currentHtml.length,
    newLength: newHtml.length,
    version: patchData.newVersion,
    message: `Edited node "${input.nodeId}": replaced ${replacements} occurrence(s). HTML ${newHtml.length > currentHtml.length ? "grew" : "shrank"} from ${currentHtml.length} to ${newHtml.length} chars.`,
    updatedHtml: newHtml
  };
}
__name(executeEditHtmlNode, "executeEditHtmlNode");
async function executePatchGraphMetadata(input, env) {
  const res = await env.KG_WORKER.fetch("https://knowledge-graph-worker/patchGraphMetadata", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      graphId: input.graphId,
      fields: input.fields
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `patchGraphMetadata failed (${res.status})`);
  return {
    graphId: input.graphId,
    updatedFields: data.updatedFields || Object.keys(input.fields),
    version: data.newVersion,
    message: `Graph metadata updated: ${Object.keys(input.fields).join(", ")}`
  };
}
__name(executePatchGraphMetadata, "executePatchGraphMetadata");
async function executeListGraphs(input, env) {
  const limit = Math.max(input.limit || 20, 10);
  const offset = input.offset || 0;
  let apiUrl = `https://knowledge-graph-worker/getknowgraphsummaries?offset=${offset}&limit=${limit}`;
  if (input.metaArea) {
    apiUrl += `&metaArea=${encodeURIComponent(input.metaArea)}`;
  }
  const res = await env.KG_WORKER.fetch(apiUrl);
  if (!res.ok) throw new Error("Failed to fetch graph summaries");
  const data = await res.json();
  const results = (data.results || []).map((g) => {
    const meta = g.metadata || {};
    return {
      id: g.id,
      title: meta.title || g.title || g.id,
      description: meta.description || "",
      category: meta.category || "",
      metaArea: meta.metaArea || "",
      nodeCount: g.nodeCount || g.node_count || 0,
      updatedAt: meta.updatedAt || g.updatedAt || ""
    };
  });
  return {
    total: data.total || results.length,
    offset,
    limit,
    graphs: results
  };
}
__name(executeListGraphs, "executeListGraphs");
async function executeListMetaAreas(input, env) {
  const res = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraphsummaries?offset=0&limit=500`
  );
  if (!res.ok) throw new Error("Failed to fetch graph summaries");
  const data = await res.json();
  const metaAreaCounts = {};
  const categoryCounts = {};
  for (const g of data.results || []) {
    const meta = g.metadata || {};
    const rawMeta = meta.metaArea || "";
    const areas = rawMeta.split("#").map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (areas.length === 0 && rawMeta.trim()) {
      areas.push(rawMeta.trim().toUpperCase());
    }
    for (const area of areas) {
      metaAreaCounts[area] = (metaAreaCounts[area] || 0) + 1;
    }
    const rawCat = meta.category || "";
    const cats = rawCat.split("#").map((s) => s.trim()).filter(Boolean);
    for (const cat of cats) {
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    }
  }
  const metaAreas = Object.entries(metaAreaCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  const categories = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  return {
    message: `Found ${metaAreas.length} meta areas and ${categories.length} categories`,
    metaAreas,
    categories
  };
}
__name(executeListMetaAreas, "executeListMetaAreas");
async function executeCreateHtmlNode(input, env) {
  const response = await env.KG_WORKER.fetch("https://knowledge-graph-worker/addNode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      graphId: input.graphId,
      node: {
        id: input.nodeId,
        label: input.label,
        type: "html-node",
        info: input.htmlContent,
        bibl: input.references || [],
        position: { x: 0, y: 0 },
        visible: true,
        metadata: { origin: "custom", createdAt: (/* @__PURE__ */ new Date()).toISOString() }
      }
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Failed to add node (status: ${response.status})`);
  }
  return {
    graphId: input.graphId,
    nodeId: input.nodeId,
    origin: "custom",
    version: data.newVersion,
    message: `HTML node "${input.label}" added successfully`,
    viewUrl: `https://www.vegvisr.org/gnew-viewer?graphId=${input.graphId}`
  };
}
__name(executeCreateHtmlNode, "executeCreateHtmlNode");
async function executeCreateNode(input, env) {
  const node = {
    id: input.nodeId,
    label: input.label,
    type: input.nodeType || "fulltext",
    info: input.content || "",
    bibl: input.references || [],
    position: { x: input.positionX || 0, y: input.positionY || 0 },
    visible: true
  };
  if (input.path) node.path = input.path;
  if (input.imageWidth) node.imageWidth = input.imageWidth;
  if (input.imageHeight) node.imageHeight = input.imageHeight;
  if (input.color) node.color = input.color;
  if (input.metadata) node.metadata = input.metadata;
  const response = await env.KG_WORKER.fetch("https://knowledge-graph-worker/addNode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ graphId: input.graphId, node })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Failed to add node (status: ${response.status})`);
  }
  return {
    graphId: input.graphId,
    nodeId: input.nodeId,
    nodeType: node.type,
    version: data.newVersion,
    message: `Node "${input.label}" (${node.type}) added successfully`
  };
}
__name(executeCreateNode, "executeCreateNode");
async function executeAddEdge(input, env) {
  const getRes = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(input.graphId)}`
  );
  const graphData = await getRes.json();
  if (!getRes.ok || !graphData.nodes) {
    throw new Error(graphData.error || "Graph not found");
  }
  const nodeIds = graphData.nodes.map((n) => n.id);
  const missing = [];
  if (!nodeIds.includes(input.sourceId)) missing.push(`sourceId "${input.sourceId}"`);
  if (!nodeIds.includes(input.targetId)) missing.push(`targetId "${input.targetId}"`);
  if (missing.length > 0) {
    const validIds = graphData.nodes.map((n) => `"${n.id}" (${n.label})`).join(", ");
    throw new Error(`${missing.join(" and ")} not found in graph. Valid node IDs: ${validIds}`);
  }
  const edgeId = `${input.sourceId}_${input.targetId}`;
  const existingEdge = graphData.edges.find((e) => e.id === edgeId);
  if (existingEdge) {
    return { graphId: input.graphId, edgeId, message: "Edge already exists" };
  }
  graphData.edges.push({
    id: edgeId,
    source: input.sourceId,
    target: input.targetId,
    label: input.label || ""
  });
  const saveRes = await env.KG_WORKER.fetch("https://knowledge-graph-worker/saveGraphWithHistory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: input.graphId, graphData, override: true })
  });
  const saveData = await saveRes.json();
  if (!saveRes.ok) {
    throw new Error(saveData.error || `Failed to save edge (status: ${saveRes.status})`);
  }
  return {
    graphId: input.graphId,
    edgeId,
    version: saveData.newVersion,
    message: `Edge ${input.sourceId} -> ${input.targetId} added`
  };
}
__name(executeAddEdge, "executeAddEdge");
function deepMerge(source, target) {
  const result = { ...source };
  for (const key of Object.keys(target)) {
    if (target[key] && typeof target[key] === "object" && !Array.isArray(target[key]) && source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      result[key] = deepMerge(source[key], target[key]);
    } else {
      result[key] = target[key];
    }
  }
  return result;
}
__name(deepMerge, "deepMerge");
async function executeGetContract(input, env) {
  let contract = null;
  if (input.contractId) {
    contract = await env.DB.prepare(
      "SELECT * FROM agent_contracts WHERE id = ?1"
    ).bind(input.contractId).first();
  } else if (input.templateName) {
    contract = await env.DB.prepare(
      "SELECT * FROM agent_contracts WHERE name = ?1"
    ).bind(input.templateName).first();
  }
  if (contract) {
    let contractJson = JSON.parse(contract.contract_json);
    if (contract.parent_contract_id) {
      const parent = await env.DB.prepare(
        "SELECT contract_json FROM agent_contracts WHERE id = ?1"
      ).bind(contract.parent_contract_id).first();
      if (parent) {
        const parentJson = JSON.parse(parent.contract_json);
        contractJson = deepMerge(parentJson, contractJson);
      }
    }
    if (contract.template_id) {
      const template = await env.DB.prepare(
        "SELECT name, nodes, ai_instructions FROM graphTemplates WHERE id = ?1"
      ).bind(contract.template_id).first();
      if (template) {
        contractJson._templateExample = {
          name: template.name,
          nodes: template.nodes ? JSON.parse(template.nodes) : null
        };
      }
    }
    return contractJson;
  }
  if (input.templateName) {
    const template = await env.DB.prepare(
      "SELECT name, nodes, ai_instructions FROM graphTemplates WHERE name = ?1"
    ).bind(input.templateName).first();
    if (template && template.ai_instructions) {
      try {
        return JSON.parse(template.ai_instructions);
      } catch {
        return { rawInstructions: template.ai_instructions };
      }
    }
  }
  return { error: "Contract not found" };
}
__name(executeGetContract, "executeGetContract");
async function executeGetHtmlTemplate(input, env) {
  let contractInfo = null;
  let templateId = input.templateId || DEFAULT_TEMPLATE_ID;
  if (input.contractId) {
    const row = await env.DB.prepare(
      "SELECT contract_json FROM agent_contracts WHERE id = ?1"
    ).bind(input.contractId).first();
    if (row) {
      contractInfo = JSON.parse(row.contract_json);
      if (contractInfo.node?.templateId && !input.templateId) {
        templateId = contractInfo.node.templateId;
      }
    }
  }
  const entry = getTemplate(templateId);
  let cssVariables = null;
  const rootMatch = entry.template.match(/:root\s*\{([^}]+)\}/);
  if (rootMatch) {
    cssVariables = {};
    const re = /--([\w-]+)\s*:\s*([^;]+)/g;
    let m;
    while ((m = re.exec(rootMatch[1])) !== null) {
      cssVariables["--" + m[1].trim()] = m[2].trim();
    }
  }
  return {
    templateId: entry.id,
    templateSize: entry.template.length,
    placeholders: entry.placeholders,
    description: entry.description,
    version: getTemplateVersion(templateId),
    cssVariables,
    instructions: "Use create_html_from_template to create the HTML node. Pass the placeholder values and the worker fills them into the template server-side. CSS must be created as a SEPARATE css-node. Use the cssVariables to match this template's visual style in custom apps.",
    contractInfo,
    availableTemplates: listTemplates()
  };
}
__name(executeGetHtmlTemplate, "executeGetHtmlTemplate");
async function executeCreateHtmlFromTemplate(input, env) {
  const templateId = input.templateId || DEFAULT_TEMPLATE_ID;
  const entry = getTemplate(templateId);
  let html = entry.template;
  html = html.replaceAll("{{TITLE}}", input.title || "Untitled");
  html = html.replaceAll("{{DESCRIPTION}}", input.description || "");
  html = html.replaceAll("{{FOOTER_TEXT}}", input.footerText || "");
  html = html.replaceAll("{{DEFAULT_THEME}}", input.defaultTheme || "");
  html = html.replaceAll("{{GRAPH_ID_DEFAULT}}", input.graphId || "");
  const nodeId = input.nodeId || `html-node-${Date.now()}`;
  html = html.replaceAll("{{NODE_ID}}", nodeId);
  const response = await env.KG_WORKER.fetch("https://knowledge-graph-worker/addNode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      graphId: input.graphId,
      node: {
        id: nodeId,
        label: input.title || "Untitled Page",
        type: "html-node",
        info: html,
        bibl: [],
        position: { x: 0, y: 0 },
        visible: true,
        metadata: { origin: "template", templateId, createdAt: (/* @__PURE__ */ new Date()).toISOString() }
      }
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Failed to create HTML node (status: ${response.status})`);
  }
  const createdSections = [];
  if (Array.isArray(input.sections) && input.sections.length > 0) {
    for (let i = 0; i < input.sections.length; i++) {
      const section = input.sections[i];
      const sectionTitle = section.title || `Section ${i + 1}`;
      const sectionContent = section.content || "";
      const sectionId = `section-${i + 1}-${Date.now()}`;
      const sectionRes = await env.KG_WORKER.fetch("https://knowledge-graph-worker/addNode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          graphId: input.graphId,
          node: {
            id: sectionId,
            label: `# ${sectionTitle}`,
            type: "fulltext",
            info: sectionContent,
            bibl: [],
            position: { x: 200, y: 100 + i * 150 },
            visible: true
          }
        })
      });
      if (sectionRes.ok) {
        createdSections.push({ id: sectionId, label: `# ${sectionTitle}` });
      }
    }
  }
  let headerImageNodeId = null;
  if (input.headerImage) {
    headerImageNodeId = `header-image-${Date.now()}`;
    const imgRes = await env.KG_WORKER.fetch("https://knowledge-graph-worker/addNode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        graphId: input.graphId,
        node: {
          id: headerImageNodeId,
          label: "Header Image",
          type: "markdown-image",
          info: `![Header Image|width:100%;height:400px;object-fit:cover](${input.headerImage})`,
          path: input.headerImage,
          bibl: [],
          position: { x: -200, y: 0 },
          visible: true,
          imageWidth: "1536",
          imageHeight: "400"
        }
      })
    });
    if (!imgRes.ok) {
      console.warn("Failed to create header image node");
      headerImageNodeId = null;
    }
  }
  return {
    graphId: input.graphId,
    nodeId,
    origin: "template",
    templateId,
    version: data.newVersion,
    htmlSize: html.length,
    sectionsCreated: createdSections.length,
    headerImageNodeId,
    message: `Editable HTML page "${input.title}" created from template "${templateId}" (${html.length} bytes) with ${createdSections.length} content sections${headerImageNodeId ? " and a header image node" : ""}. The page discovers nodes with # prefix labels.`,
    viewUrl: `https://www.vegvisr.org/gnew-viewer?graphId=${input.graphId}`
  };
}
__name(executeCreateHtmlFromTemplate, "executeCreateHtmlFromTemplate");
async function executePerplexitySearch(input, env) {
  const query = input.query;
  if (!query) throw new Error("query is required");
  const model = input.model || "sonar";
  const validModels = ["sonar", "sonar-pro", "sonar-reasoning"];
  if (!validModels.includes(model)) {
    throw new Error(`Invalid model: ${model}. Use one of: ${validModels.join(", ")}`);
  }
  const endpoint = model === "sonar" ? "/sonar" : model === "sonar-pro" ? "/sonar-pro" : "/sonar-reasoning";
  const body = {
    userId: input.userId,
    messages: [{ role: "user", content: query }]
  };
  if (input.search_recency_filter) body.search_recency_filter = input.search_recency_filter;
  const res = await env.PERPLEXITY.fetch(`https://perplexity-worker${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Perplexity API error (${res.status})`);
  }
  const choice = data.choices?.[0]?.message?.content || "";
  const citations = data.citations || [];
  const searchResults = data.search_results || [];
  return {
    message: `Perplexity search completed (${model})`,
    model: data.model,
    content: choice,
    citations,
    sources: searchResults.map((s) => ({ title: s.title, url: s.url, snippet: s.snippet })),
    usage: data.usage
  };
}
__name(executePerplexitySearch, "executePerplexitySearch");
async function executeSearchPexels(input, env) {
  const query = input.query;
  if (!query) throw new Error("query is required");
  const res = await env.API_WORKER.fetch("https://vegvisr-api-worker/pexels-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, count: input.count || 5 })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Pexels API error (${res.status})`);
  return {
    message: `Found ${data.total || 0} Pexels images for "${query}"`,
    query: data.query,
    total: data.total,
    images: (data.images || []).map((img) => ({
      url: img.src?.large || img.url,
      alt: img.alt,
      photographer: img.photographer,
      width: img.width,
      height: img.height,
      pexels_url: img.pexels_url
    }))
  };
}
__name(executeSearchPexels, "executeSearchPexels");
async function executeSearchUnsplash(input, env) {
  const query = input.query;
  if (!query) throw new Error("query is required");
  const res = await env.API_WORKER.fetch("https://vegvisr-api-worker/unsplash-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, count: input.count || 5 })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Unsplash API error (${res.status})`);
  return {
    message: `Found ${data.total || 0} Unsplash images for "${query}"`,
    query: data.query,
    total: data.total,
    images: (data.images || []).map((img) => ({
      url: img.urls?.regular || img.url,
      alt: img.alt,
      photographer: img.photographer,
      width: img.width,
      height: img.height,
      unsplash_url: img.unsplash_url
    }))
  };
}
__name(executeSearchUnsplash, "executeSearchUnsplash");
async function executeGetAlbumImages(input, env) {
  const albumName = input.albumName;
  if (!albumName) throw new Error("albumName is required");
  const userId = input.userId;
  if (!userId) throw new Error("userId is required for album access");
  const userRecord = await env.DB.prepare(
    "SELECT emailVerificationToken FROM config WHERE user_id = ?"
  ).bind(userId).first();
  if (!userRecord?.emailVerificationToken) {
    throw new Error("No API token found for user \u2014 please log in again");
  }
  const res = await env.ALBUMS_WORKER.fetch(
    `https://vegvisr-albums-worker/photo-album?name=${encodeURIComponent(albumName)}`,
    { headers: { "X-API-Token": userRecord.emailVerificationToken } }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Albums API error (${res.status})`);
  const images = (data.images || []).map((key) => ({
    key,
    url: `https://vegvisr.imgix.net/${key}`
  }));
  return {
    message: `Album "${albumName}" has ${images.length} images`,
    albumName,
    imageCount: images.length,
    images
  };
}
__name(executeGetAlbumImages, "executeGetAlbumImages");
async function executeAnalyzeImage(input, env) {
  const imageUrl = input.imageUrl;
  if (!imageUrl) throw new Error("imageUrl is required");
  if (!imageUrl.startsWith("https://")) {
    throw new Error("analyze_image requires an HTTPS URL (e.g. https://vegvisr.imgix.net/...). If the image was pasted directly in chat, you can already see it \u2014 no need to call this tool. For base64/data URIs, the user must upload the image to their photo album first.");
  }
  const question = input.question || "Describe this image in detail.";
  const res = await env.ANTHROPIC.fetch("https://anthropic.vegvisr.org/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: input.userId,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "url", url: imageUrl } },
          { type: "text", text: question }
        ]
      }],
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048
    })
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Image analysis failed (${res.status}): ${errText}`);
  }
  const data = await res.json();
  const analysis = (data.content || []).find((c) => c.type === "text")?.text || "No analysis available";
  return { imageUrl, question, analysis };
}
__name(executeAnalyzeImage, "executeAnalyzeImage");
async function resolveUserProfile(userId, env) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      let profile = await env.DB.prepare(
        "SELECT email, user_id, bio, profileimage, Role AS role, phone, phone_verified_at, data FROM config WHERE email = ?"
      ).bind(userId).first();
      if (!profile) {
        profile = await env.DB.prepare(
          "SELECT email, user_id, bio, profileimage, Role AS role, phone, phone_verified_at, data FROM config WHERE user_id = ?"
        ).bind(userId).first();
      }
      return profile;
    } catch (err) {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }
      return null;
    }
  }
  return null;
}
__name(resolveUserProfile, "resolveUserProfile");
async function executeWhoAmI(input, env) {
  const userId = input.userId;
  if (!userId) throw new Error("No user context available");
  const profile = await resolveUserProfile(userId, env);
  let extraData = {};
  if (profile?.data) {
    try {
      extraData = JSON.parse(profile.data);
    } catch {
    }
  }
  let apiKeys = [];
  try {
    let keysResult = await env.DB.prepare(
      "SELECT provider, enabled, last_used FROM user_api_keys WHERE user_id = ?"
    ).bind(userId).all();
    if ((!keysResult.results || keysResult.results.length === 0) && profile?.user_id && profile.user_id !== userId) {
      keysResult = await env.DB.prepare(
        "SELECT provider, enabled, last_used FROM user_api_keys WHERE user_id = ?"
      ).bind(profile.user_id).all();
    }
    if ((!keysResult.results || keysResult.results.length === 0) && profile?.email && profile.email !== userId) {
      keysResult = await env.DB.prepare(
        "SELECT provider, enabled, last_used FROM user_api_keys WHERE user_id = ?"
      ).bind(profile.email).all();
    }
    apiKeys = (keysResult.results || []).map((k) => ({
      provider: k.provider,
      enabled: !!k.enabled,
      lastUsed: k.last_used || null
    }));
  } catch {
  }
  const email = profile?.email || (userId.includes("@") ? userId : null);
  return {
    email,
    userId: profile?.user_id || userId,
    role: profile?.role || "user",
    bio: profile?.bio || null,
    phone: profile?.phone || null,
    phoneVerifiedAt: profile?.phone_verified_at || null,
    profileImage: profile?.profileimage || null,
    branding: {
      mySite: extraData?.branding?.mySite || null,
      myLogo: extraData?.branding?.myLogo || null
    },
    apiKeys,
    message: `User: ${email || userId}, Role: ${profile?.role || "user"}, API keys: ${apiKeys.length} configured${profile?.bio ? ", Bio: included (output it verbatim when the user asks)" : ""}`
  };
}
__name(executeWhoAmI, "executeWhoAmI");
async function executeAdminRegisterUser(input, env) {
  const callerUserId = input.userId;
  if (!callerUserId) throw new Error("No user context available");
  const callerProfile = await resolveUserProfile(callerUserId, env);
  const callerRole = (callerProfile?.Role || callerProfile?.role || "").trim();
  if (callerRole !== "Superadmin") {
    throw new Error("Superadmin role required to register users");
  }
  const email = (input.email || "").trim().toLowerCase();
  if (!email) throw new Error("Email is required");
  const name = (input.name || "").trim() || null;
  const phone = (input.phone || "").trim() || null;
  const role = (input.role || "Admin").trim();
  const existing = await env.DB.prepare("SELECT email FROM config WHERE email = ?").bind(email).first();
  if (existing) {
    return { success: false, error: "User with this email already exists", email };
  }
  const user_id = crypto.randomUUID();
  const emailVerificationToken = Array.from(crypto.getRandomValues(new Uint8Array(20))).map((b) => b.toString(16).padStart(2, "0")).join("");
  const data = JSON.stringify({ profile: { user_id, email, name, phone }, settings: {} });
  await env.DB.prepare(`
    INSERT INTO config (user_id, email, emailVerificationToken, Role, phone, data)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(user_id, email, emailVerificationToken, role, phone, data).run();
  return {
    success: true,
    user_id,
    email,
    name,
    phone,
    role,
    emailVerificationToken,
    loginUrl: `https://login.vegvisr.org`,
    message: `User ${email} (${name || "no name"}) registered with role "${role}". They can log in at login.vegvisr.org by entering their email.`
  };
}
__name(executeAdminRegisterUser, "executeAdminRegisterUser");
async function executeSendEmail(input, env) {
  const callerUserId = input.userId;
  if (!callerUserId) throw new Error("No user context available");
  const profile = await resolveUserProfile(callerUserId, env);
  if (!profile) throw new Error("Could not resolve user profile");
  let userData = {};
  if (profile.data) {
    try {
      userData = JSON.parse(profile.data);
    } catch {
    }
  }
  const accounts = userData?.settings?.emailAccounts || [];
  if (accounts.length === 0) {
    throw new Error("No email accounts configured. Please set up an email account in vemail.vegvisr.org first.");
  }
  const requestedFrom = (input.fromEmail || "").trim().toLowerCase();
  let account;
  if (requestedFrom) {
    account = accounts.find((a) => a.email.toLowerCase() === requestedFrom);
    if (!account) throw new Error(`No configured account matches "${requestedFrom}". Available: ${accounts.map((a) => a.email).join(", ")}`);
  } else {
    account = accounts.find((a) => a.email.endsWith("@vegvisr.org")) || accounts.find((a) => a.isDefault) || accounts[0];
  }
  const toEmail = (input.to || "").trim();
  const subject = (input.subject || "").trim();
  const html = input.html || "";
  if (!toEmail) throw new Error("Recipient email (to) is required");
  if (!subject) throw new Error("Subject is required");
  if (!html) throw new Error("Email body (html) is required");
  const isGmail = (account.accountType || "").toLowerCase() === "gmail" || account.email.endsWith("@gmail.com");
  const endpoint = isGmail ? "/send-gmail-email" : "/send-email";
  const payload = {
    userEmail: profile.email,
    accountId: account.id,
    fromEmail: account.email,
    toEmail,
    subject,
    html
  };
  const res = await env.EMAIL_WORKER.fetch(`https://email-worker.internal${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const responseText = await res.text();
  let result;
  try {
    result = JSON.parse(responseText);
  } catch {
    result = { raw: responseText };
  }
  if (!res.ok || result.success === false) {
    throw new Error(`Failed to send email: ${result.error || result.details || responseText}`);
  }
  return {
    success: true,
    from: account.email,
    to: toEmail,
    subject,
    message: `Email sent successfully from ${account.email} to ${toEmail} with subject "${subject}".`
  };
}
__name(executeSendEmail, "executeSendEmail");
async function executeListRecordings(input, env) {
  const { limit = 20, query } = input;
  let userEmail = input.userEmail || input.userId;
  if (!userEmail) throw new Error("userEmail is required");
  if (!userEmail.includes("@")) {
    const profile = await resolveUserProfile(userEmail, env);
    if (profile?.email) {
      userEmail = profile.email;
    } else {
      throw new Error("Could not resolve user identity. Please try again.");
    }
  }
  const fetchUrl = `https://audio-portfolio-worker/list-recordings?userEmail=${encodeURIComponent(userEmail)}&limit=200&userRole=Superadmin&ownerEmail=${encodeURIComponent(userEmail)}`;
  const res = await env.AUDIO_PORTFOLIO.fetch(fetchUrl);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to list recordings: ${err}`);
  }
  const data = await res.json();
  let allRecordings = data.recordings || [];
  const sonicEmail = "sonic-wisdom@vegvisr.org";
  if (userEmail.toLowerCase() !== sonicEmail) {
    try {
      const sonicUrl = `https://audio-portfolio-worker/list-recordings?userEmail=${encodeURIComponent(sonicEmail)}&limit=200&userRole=Superadmin&ownerEmail=${encodeURIComponent(sonicEmail)}`;
      const sonicRes = await env.AUDIO_PORTFOLIO.fetch(sonicUrl);
      if (sonicRes.ok) {
        const sonicData = await sonicRes.json();
        const sonicRecordings = (sonicData.recordings || []).map((r) => ({ ...r, source: "Sonic Wisdom" }));
        allRecordings = allRecordings.concat(sonicRecordings);
      }
    } catch (e) {
    }
  }
  if (query) {
    const q = query.toLowerCase().trim();
    allRecordings = allRecordings.filter((r) => {
      const searchable = [
        r.recordingId || "",
        r.displayName || "",
        r.fileName || "",
        r.transcriptionText || "",
        (r.tags || []).join(" "),
        r.category || ""
      ].join(" ").toLowerCase();
      return searchable.includes(q);
    });
  }
  allRecordings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const recordings = allRecordings.slice(0, limit).map((r) => ({
    recordingId: r.recordingId,
    displayName: r.displayName || r.fileName,
    fileName: r.fileName,
    duration: r.duration,
    fileSize: r.fileSize,
    tags: r.tags || [],
    category: r.category || "",
    hasTranscription: !!r.transcriptionText,
    audioUrl: r.r2Url || "",
    createdAt: r.createdAt || ""
  }));
  return {
    message: `Found ${recordings.length} recording(s) for ${userEmail}`,
    total: recordings.length,
    recordings
  };
}
__name(executeListRecordings, "executeListRecordings");
async function executeTranscribeAudio(input, env) {
  const { recordingId, audioUrl, language, saveToPortfolio = false, saveToGraph = false, graphTitle } = input;
  let userEmail = input.userEmail || input.userId;
  if (userEmail && !userEmail.includes("@")) {
    const profile = await resolveUserProfile(userEmail, env);
    if (profile?.email) {
      userEmail = profile.email;
    } else {
      throw new Error("Could not resolve user identity. Please try again.");
    }
  }
  let resolvedUrl = audioUrl;
  let resolvedRecordingId = recordingId;
  if (recordingId && userEmail && !audioUrl) {
    const listRes = await env.AUDIO_PORTFOLIO.fetch(
      `https://audio-portfolio-worker/list-recordings?userEmail=${encodeURIComponent(userEmail)}&limit=200&userRole=Superadmin&ownerEmail=${encodeURIComponent(userEmail)}`
    );
    if (!listRes.ok) throw new Error("Failed to fetch recordings from portfolio");
    const listData = await listRes.json();
    const recording = (listData.recordings || []).find((r) => r.recordingId === recordingId);
    if (!recording) throw new Error(`Recording "${recordingId}" not found in portfolio`);
    resolvedUrl = recording.r2Url;
    if (!resolvedUrl) throw new Error(`Recording "${recordingId}" has no audio URL`);
  }
  if (!resolvedUrl) {
    throw new Error("Provide either recordingId + userEmail or audioUrl");
  }
  return {
    clientSideRequired: true,
    audioUrl: resolvedUrl,
    recordingId: resolvedRecordingId || null,
    language: language || null,
    saveToPortfolio,
    saveToGraph,
    graphTitle: graphTitle || null,
    userEmail,
    message: saveToGraph ? `Audio file found. Transcribing on your device and saving to a new graph...` : `Audio file found. Transcribing on your device...`
  };
}
__name(executeTranscribeAudio, "executeTranscribeAudio");
var ANALYSIS_MODEL = "claude-sonnet-4-20250514";
async function executeAnalyzeNode(input, env) {
  const { graphId, nodeId, analysisType = "all", store = false } = input;
  const graphRes = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${graphId}`
  );
  if (!graphRes.ok) throw new Error("Failed to fetch graph");
  const graphData = await graphRes.json();
  const node = (graphData.nodes || []).find((n) => n.id === nodeId);
  if (!node) throw new Error(`Node "${nodeId}" not found in graph`);
  const content = (node.info || "").slice(0, 4e3);
  if (!content.trim()) {
    return { graphId, nodeId, analysis: null, message: "Node has no content to analyze" };
  }
  const analysisPrompt = `Analyze this content and return a JSON object with:
- sentiment: "positive", "negative", "neutral", or "mixed"
- sentimentScore: number from -1.0 to 1.0
- weight: number from 0.0 to 1.0 (importance/significance of this content)
- keywords: array of 3-8 key terms extracted from the content
- summary: 1-2 sentence summary of the content's meaning
- language: detected language code (e.g. "en", "no", "de")

Content type: ${node.type || "unknown"}
Title: ${node.label || "Untitled"}
Content:
${content}

Return ONLY the JSON object, no markdown fences or explanation.`;
  const claudeRes = await env.ANTHROPIC.fetch("https://anthropic.vegvisr.org/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: input.userId || "system-analysis",
      messages: [{ role: "user", content: analysisPrompt }],
      model: ANALYSIS_MODEL,
      max_tokens: 1e3,
      temperature: 0.1
    })
  });
  if (!claudeRes.ok) throw new Error(`Claude analysis failed (status: ${claudeRes.status})`);
  const claudeData = await claudeRes.json();
  const textBlock = (claudeData.content || []).find((b) => b.type === "text");
  if (!textBlock) throw new Error("No analysis response from Claude");
  let analysis;
  try {
    analysis = JSON.parse(textBlock.text.trim());
  } catch {
    analysis = { raw: textBlock.text.trim(), parseError: true };
  }
  if (analysisType !== "all" && !analysis.parseError) {
    const filtered = {};
    if (analysisType === "sentiment") {
      filtered.sentiment = analysis.sentiment;
      filtered.sentimentScore = analysis.sentimentScore;
    } else if (analysisType === "keywords") {
      filtered.keywords = analysis.keywords;
    } else if (analysisType === "weight") {
      filtered.weight = analysis.weight;
    } else if (analysisType === "summary") {
      filtered.summary = analysis.summary;
    }
    analysis = filtered;
  }
  if (store && !analysis.parseError) {
    const existingMeta = node.metadata || {};
    await env.KG_WORKER.fetch("https://knowledge-graph-worker/patchNode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        graphId,
        nodeId,
        fields: {
          metadata: { ...existingMeta, analysis: { ...analysis, analyzedAt: (/* @__PURE__ */ new Date()).toISOString() } }
        }
      })
    });
  }
  return {
    graphId,
    nodeId,
    nodeLabel: node.label,
    analysis,
    stored: store,
    message: `Analyzed node "${node.label}" \u2014 sentiment: ${analysis.sentiment || "n/a"}, weight: ${analysis.weight || "n/a"}`
  };
}
__name(executeAnalyzeNode, "executeAnalyzeNode");
async function executeAnalyzeGraph(input, env) {
  const { graphId, store = false } = input;
  const graphRes = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${graphId}`
  );
  if (!graphRes.ok) throw new Error("Failed to fetch graph");
  const graphData = await graphRes.json();
  const nodes = graphData.nodes || [];
  if (nodes.length === 0) {
    return { graphId, analysis: null, message: "Graph has no nodes to analyze" };
  }
  const nodeDescriptions = nodes.map((n) => {
    const preview = (n.info || "").replace(/<[^>]*>/g, "").slice(0, 200);
    return `- [${n.id}] ${n.label || "Untitled"} (${n.type || "unknown"}): ${preview}`;
  }).join("\n");
  const analysisPrompt = `Analyze this knowledge graph and return a JSON object with:
- sentiment: overall sentiment ("positive", "negative", "neutral", "mixed")
- summary: 2-3 sentence summary of what this graph is about
- topicClusters: array of { "topic": string, "nodeIds": string[], "description": string } grouping related nodes
- nodeRankings: array of { "nodeId": string, "label": string, "weight": number (0.0-1.0), "sentiment": "positive"|"negative"|"neutral"|"mixed", "reason": string } sorted by weight descending (most important first). Each node MUST have its own sentiment.
- language: primary language code of the content

Graph title: ${graphData.title || graphData.metadata?.title || "Untitled"}
Total nodes: ${nodes.length}
Total edges: ${(graphData.edges || []).length}

Nodes:
${nodeDescriptions}

Return ONLY the JSON object, no markdown fences or explanation.`;
  const claudeRes = await env.ANTHROPIC.fetch("https://anthropic.vegvisr.org/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: input.userId || "system-analysis",
      messages: [{ role: "user", content: analysisPrompt }],
      model: ANALYSIS_MODEL,
      max_tokens: 4e3,
      temperature: 0.1
    })
  });
  if (!claudeRes.ok) throw new Error(`Claude analysis failed (status: ${claudeRes.status})`);
  const claudeData = await claudeRes.json();
  const textBlock = (claudeData.content || []).find((b) => b.type === "text");
  if (!textBlock) throw new Error("No analysis response from Claude");
  let analysis;
  try {
    analysis = JSON.parse(textBlock.text.trim());
  } catch {
    analysis = { raw: textBlock.text.trim(), parseError: true };
  }
  if (store && !analysis.parseError && analysis.nodeRankings) {
    for (const ranking of analysis.nodeRankings) {
      const node = nodes.find((n) => n.id === ranking.nodeId);
      if (!node) continue;
      const existingMeta = node.metadata || {};
      await env.KG_WORKER.fetch("https://knowledge-graph-worker/patchNode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          graphId,
          nodeId: ranking.nodeId,
          fields: {
            metadata: {
              ...existingMeta,
              analysis: {
                weight: ranking.weight,
                reason: ranking.reason,
                analyzedAt: (/* @__PURE__ */ new Date()).toISOString()
              }
            }
          }
        })
      });
    }
  }
  return {
    graphId,
    nodeCount: nodes.length,
    edgeCount: (graphData.edges || []).length,
    analysis,
    stored: store,
    message: `Analyzed graph "${graphData.title || graphId}" \u2014 ${analysis.topicClusters?.length || 0} topic clusters, ${analysis.nodeRankings?.length || 0} nodes ranked`
  };
}
__name(executeAnalyzeGraph, "executeAnalyzeGraph");
var TRANSCRIPTION_PROMPT_1_1 = `Analyser denne samtalen fra Enkel Endring-programmet og gi en strukturert rapport
p\xE5 norsk med f\xF8lgende fem seksjoner:

---

## 1. \u{1F511} N\xF8kkeltemaer
Hvilke hovedtemaer ble ber\xF8rt i samtalen?
List opp 3\u20136 temaer med en kort forklaring (2\u20133 setninger) for hvert tema.

---

## 2. \u2705 Suksessm\xE5linger
Identifiser tegn p\xE5 innsikt, fremgang eller positiv endring hos deltageren.
Se etter:
- Uttrykk for ny forst\xE5else eller innsikt
- Tegn p\xE5 mer ro, harmoni eller lettelse
- Utsagn om mindre stress eller bekymring
- \xD8yeblikk der deltager opplever en "shift" i tankegang

For hvert suksessmoment: beskriv hva som skjedde og hva det kan bety for deltagerens utvikling.

---

## 3. \u{1F31F} Gullkorn
Plukk ut 3\u20137 kraftfulle sitater fra samtalen \u2013 b\xE5de fra mentor og deltager.
Format:
> "Sitat her" \u2014 [Mentor / Deltager]

Velg sitater som er:
- Innsiktsfulle eller tankevekkende
- Morsomme eller menneskelige
- Beskriver en viktig sannhet eller vendepunkt

---

## 4. \u{1F3AF} Handlingspunkter
Hva er de konkrete neste stegene som kom frem i samtalen?
List opp handlingspunkter for:
- Deltager: hva de skal gj\xF8re, utforske eller reflektere over
- Mentor (Tor Arne): oppf\xF8lgingspunkter eller ting \xE5 ta med til neste samtale

---

## 5. \u{1FA9E} Mentorfeedback \u2013 Selvrefleksjon
Gi konstruktiv tilbakemelding til Tor Arne som mentor.
Vurder:
- Hva fungerte bra? (lytting, sp\xF8rsm\xE5l, timing, rom for innsikt)
- Hva kan gj\xF8res annerledes eller bedre neste gang?
- Ble Tre Prinsippene (Sinn, Bevissthet, Tanke) brukt naturlig og effektivt?
- Var det \xF8yeblikk der samtalens retning kunne v\xE6rt annerledes?

Hold tilbakemeldingen st\xF8ttende, konkret og fremadrettet.`;
var TRANSCRIPTION_PROMPT_GROUP = `Analyser denne gruppesamtalen fra Enkel Endring-programmet og gi en strukturert rapport
p\xE5 norsk med f\xF8lgende fem seksjoner:

---

## 1. \u{1F511} N\xF8kkeltemaer
Hvilke hovedtemaer ble ber\xF8rt i gruppesamtalen?
List opp 3\u20136 temaer med en kort forklaring (2\u20133 setninger) for hvert tema.
Merk hvilke temaer som engasjerte flere deltagere.

---

## 2. \u2705 Suksessm\xE5linger
Identifiser tegn p\xE5 innsikt, fremgang eller positiv endring hos deltagerne.
Se etter:
- Uttrykk for ny forst\xE5else eller innsikt hos enkeltpersoner
- Tegn p\xE5 mer ro, harmoni eller lettelse i gruppen
- \xD8yeblikk der en deltagers deling utl\xF8ste gjenkjennelse hos andre
- Gruppedynamikk som fremmet \xE5penhet og trygghet

For hvert suksessmoment: beskriv hva som skjedde, hvem som var involvert, og hva det kan bety.

---

## 3. \u{1F31F} Gullkorn
Plukk ut 3\u20137 kraftfulle sitater fra samtalen \u2013 fra mentor og deltagere.
Format:
> "Sitat her" \u2014 [Mentor / Deltager]

Velg sitater som er:
- Innsiktsfulle eller tankevekkende
- Morsomme eller menneskelige
- Beskriver en viktig sannhet eller vendepunkt
- Skapte resonans i gruppen

---

## 4. \u{1F3AF} Handlingspunkter
Hva er de konkrete neste stegene som kom frem i samtalen?
List opp handlingspunkter for:
- Deltagerne: felles og individuelle refleksjoner eller oppgaver
- Mentor (Tor Arne): oppf\xF8lgingspunkter, temaer \xE5 ta videre, eller individuelle behov \xE5 f\xF8lge opp

---

## 5. \u{1FA9E} Mentorfeedback \u2013 Selvrefleksjon
Gi konstruktiv tilbakemelding til Tor Arne som mentor/fasilitator.
Vurder:
- Hva fungerte bra? (rommet som ble skapt, balanse mellom deltagere, timing)
- Ble alle deltagere inkludert og sett?
- Ble Tre Prinsippene (Sinn, Bevissthet, Tanke) brukt naturlig og effektivt?
- Hva kan gj\xF8res annerledes for \xE5 styrke gruppedynamikken neste gang?

Hold tilbakemeldingen st\xF8ttende, konkret og fremadrettet.`;
async function executeAnalyzeTranscription(input, env, progress = () => {
}) {
  const { graphId, nodeId, conversationType = "1-1", saveToGraph = true } = input;
  progress("Henter transkripsjon fra graf...");
  const graphRes = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${graphId}`
  );
  if (!graphRes.ok) throw new Error("Failed to fetch graph");
  const graphData = await graphRes.json();
  const nodes = graphData.nodes || [];
  let node;
  if (nodeId) {
    node = nodes.find((n) => n.id === nodeId);
    if (!node) throw new Error(`Node "${nodeId}" not found in graph`);
  } else {
    node = nodes.find((n) => n.type === "fulltext");
    if (!node) throw new Error("No fulltext node found in graph. Provide a nodeId.");
  }
  const transcriptionText = (node.info || "").trim();
  if (!transcriptionText) {
    return { graphId, nodeId: node.id, message: "Node has no transcription text to analyze" };
  }
  const systemPrompt = conversationType === "group" ? TRANSCRIPTION_PROMPT_GROUP : TRANSCRIPTION_PROMPT_1_1;
  progress("Analyserer samtalen med Claude...");
  const claudeRes = await env.ANTHROPIC.fetch("https://anthropic.vegvisr.org/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: input.userId || "system-analysis",
      messages: [{ role: "user", content: `${systemPrompt}

---

Transkripsjon:

${transcriptionText}` }],
      model: ANALYSIS_MODEL,
      max_tokens: 4e3,
      temperature: 0.3
    })
  });
  if (!claudeRes.ok) throw new Error(`Claude analysis failed (status: ${claudeRes.status})`);
  const claudeData = await claudeRes.json();
  const textBlock = (claudeData.content || []).find((b) => b.type === "text");
  if (!textBlock) throw new Error("No analysis response from Claude");
  const analysisText = textBlock.text.trim();
  if (saveToGraph) {
    progress("Lagrer analyse i grafen...");
    const analysisNodeId = `node-analysis-${Date.now()}`;
    const typeLabel = conversationType === "group" ? "Gruppesamtale" : "1-1 Samtale";
    await env.KG_WORKER.fetch("https://knowledge-graph-worker/addNode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        graphId,
        node: {
          id: analysisNodeId,
          label: `# Analyse \u2013 ${typeLabel}`,
          type: "fulltext",
          info: analysisText,
          color: "#E8A838"
        }
      })
    });
  }
  return {
    graphId,
    nodeId: node.id,
    conversationType,
    savedToGraph: saveToGraph,
    analysisText,
    message: `Analyserte ${conversationType === "group" ? "gruppesamtale" : "1-1 samtale"} transkripsjon${saveToGraph ? " og lagret analysen i grafen" : ""}`
  };
}
__name(executeAnalyzeTranscription, "executeAnalyzeTranscription");
async function executeSaveFormData(input, env) {
  const graphId = (input.graphId || "").trim();
  if (!graphId) throw new Error("graphId is required");
  const record = input.record;
  if (!record || typeof record !== "object") throw new Error("record must be an object");
  const nodeId = (input.nodeId || "").trim() || crypto.randomUUID();
  record._id = crypto.randomUUID();
  record._ts = (/* @__PURE__ */ new Date()).toISOString();
  const getRes = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(graphId)}`
  );
  if (!getRes.ok) {
    const err = await getRes.json().catch(() => ({}));
    throw new Error(err.error || "Failed to fetch graph");
  }
  const graphData = await getRes.json();
  const existingNode = (graphData.nodes || []).find((n) => n.id === nodeId);
  if (existingNode) {
    let records = [];
    try {
      records = JSON.parse(existingNode.info || "[]");
    } catch {
      records = [];
    }
    if (!Array.isArray(records)) records = [];
    records.push(record);
    const patchRes = await env.KG_WORKER.fetch("https://knowledge-graph-worker/patchNode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        graphId,
        nodeId,
        fields: { info: JSON.stringify(records) }
      })
    });
    if (!patchRes.ok) {
      const err = await patchRes.json().catch(() => ({}));
      throw new Error(err.error || "Failed to update data-node");
    }
    return {
      success: true,
      graphId,
      nodeId,
      recordId: record._id,
      recordCount: records.length,
      message: `Record appended to data-node "${nodeId}" (${records.length} total records)`
    };
  } else {
    const schema = input.schema || { columns: Object.keys(record).filter((k) => !k.startsWith("_")).map((k) => ({ key: k, label: k, type: "text" })) };
    const label = input.label || "#Data";
    const metadata = { schema, encrypted: true };
    if (input.formTitle) metadata.formTitle = input.formTitle;
    const addRes = await env.KG_WORKER.fetch("https://knowledge-graph-worker/addNode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        graphId,
        node: {
          id: nodeId,
          label,
          type: "data-node",
          info: JSON.stringify([record]),
          color: "#2563eb",
          position: { x: 0, y: 0 },
          visible: true,
          metadata
        }
      })
    });
    if (!addRes.ok) {
      const err = await addRes.json().catch(() => ({}));
      throw new Error(err.error || "Failed to create data-node");
    }
    return {
      success: true,
      graphId,
      nodeId,
      recordId: record._id,
      recordCount: 1,
      message: `Created new data-node "${nodeId}" with label "${label}" and 1 record`
    };
  }
}
__name(executeSaveFormData, "executeSaveFormData");
async function executeQueryDataNodes(input, env) {
  const graphId = (input.graphId || "").trim();
  const nodeId = (input.nodeId || "").trim();
  if (!graphId) throw new Error("graphId is required");
  if (!nodeId) throw new Error("nodeId is required");
  const limit = Math.min(Math.max(input.limit || 50, 1), 200);
  const offset = Math.max(input.offset || 0, 0);
  const getRes = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(graphId)}`
  );
  if (!getRes.ok) {
    const err = await getRes.json().catch(() => ({}));
    throw new Error(err.error || "Failed to fetch graph");
  }
  const graphData = await getRes.json();
  const node = (graphData.nodes || []).find((n) => n.id === nodeId);
  if (!node) throw new Error(`Node "${nodeId}" not found in graph "${graphId}"`);
  if (node.type !== "data-node") throw new Error(`Node "${nodeId}" is type "${node.type}", not data-node`);
  let records = [];
  try {
    records = JSON.parse(node.info || "[]");
  } catch {
    records = [];
  }
  if (!Array.isArray(records)) records = [];
  const total = records.length;
  if (input.filterKey && input.filterValue) {
    const fk = input.filterKey;
    const fv = input.filterValue.toLowerCase();
    records = records.filter((r) => {
      const val = r[fk];
      return val != null && String(val).toLowerCase().includes(fv);
    });
  }
  const filtered = records.length;
  records = records.slice(offset, offset + limit);
  return {
    graphId,
    nodeId,
    records,
    total,
    filtered,
    returned: records.length,
    schema: node.metadata?.schema || null,
    message: `Returned ${records.length} of ${total} records from data-node "${nodeId}"${input.filterKey ? ` (filtered: ${filtered} matches)` : ""}`
  };
}
__name(executeQueryDataNodes, "executeQueryDataNodes");
async function executeCreateAppTable(input, env) {
  const graphId = (input.graphId || "").trim();
  const displayName = (input.displayName || "").trim();
  if (!graphId) throw new Error("graphId is required");
  if (!displayName) throw new Error("displayName is required");
  if (!Array.isArray(input.columns) || input.columns.length === 0) {
    throw new Error("columns array is required and must not be empty");
  }
  const res = await env.DRIZZLE_WORKER.fetch("https://drizzle-worker/create-table", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      graphId,
      displayName,
      columns: input.columns
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to create table");
  return {
    success: true,
    tableId: data.id,
    tableName: data.tableName,
    displayName: data.displayName,
    columnCount: data.columnCount,
    message: `Created table "${displayName}" (${data.tableName}) with ${data.columnCount} columns. Table ID: ${data.id}`
  };
}
__name(executeCreateAppTable, "executeCreateAppTable");
async function executeInsertAppRecord(input, env) {
  const tableId = (input.tableId || "").trim();
  if (!tableId) throw new Error("tableId is required");
  if (!input.record || typeof input.record !== "object") {
    throw new Error("record object is required");
  }
  const res = await env.DRIZZLE_WORKER.fetch("https://drizzle-worker/insert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tableId,
      record: input.record
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to insert record");
  return {
    success: true,
    _id: data._id,
    _created_at: data._created_at,
    message: `Inserted record ${data._id} into table ${tableId}`
  };
}
__name(executeInsertAppRecord, "executeInsertAppRecord");
async function executeQueryAppTable(input, env) {
  const tableId = (input.tableId || "").trim();
  if (!tableId) throw new Error("tableId is required");
  const res = await env.DRIZZLE_WORKER.fetch("https://drizzle-worker/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tableId,
      where: input.where || void 0,
      orderBy: input.orderBy || void 0,
      order: input.order || void 0,
      limit: input.limit || 50,
      offset: input.offset || 0
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to query table");
  return {
    records: data.records,
    total: data.total,
    returned: data.records.length,
    columns: data.columns,
    message: `Returned ${data.records.length} of ${data.total} records from table ${tableId}`
  };
}
__name(executeQueryAppTable, "executeQueryAppTable");
async function executeListChatGroups(input, env) {
  const res = await env.DRIZZLE_WORKER.fetch("https://drizzle-worker/chat-groups", {
    method: "GET"
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to list chat groups");
  return {
    groups: data.groups,
    count: data.groups.length,
    message: `Found ${data.groups.length} chat groups`
  };
}
__name(executeListChatGroups, "executeListChatGroups");
async function executeAddUserToChatGroup(input, env) {
  const email = (input.email || "").trim();
  if (!email) throw new Error("email is required");
  if (!input.groupId && !input.groupName) throw new Error("groupId or groupName is required");
  const res = await env.DRIZZLE_WORKER.fetch("https://drizzle-worker/add-user-to-group", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      groupId: input.groupId || void 0,
      groupName: input.groupName || void 0,
      role: input.role || void 0
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to add user to group");
  return {
    success: true,
    user_id: data.user_id,
    email: data.email,
    group_id: data.group_id,
    groupName: data.groupName,
    role: data.role,
    message: `Added ${data.email} to group "${data.groupName}" as ${data.role}`
  };
}
__name(executeAddUserToChatGroup, "executeAddUserToChatGroup");
async function executeGetGroupMessages(input, env) {
  const params = new URLSearchParams();
  if (input.groupId) params.set("groupId", input.groupId);
  if (input.groupName) params.set("groupName", input.groupName);
  if (input.limit) params.set("limit", String(input.limit));
  const res = await env.DRIZZLE_WORKER.fetch(
    `https://drizzle-worker/group-messages?${params}`
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to get group messages");
  return {
    groupName: data.groupName,
    groupId: data.groupId,
    messages: data.messages,
    count: data.count,
    message: `Retrieved ${data.count} messages from "${data.groupName}"`
  };
}
__name(executeGetGroupMessages, "executeGetGroupMessages");
async function executeGetGroupStats(input, env) {
  const res = await env.DRIZZLE_WORKER.fetch("https://drizzle-worker/group-stats");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to get group stats");
  const mostActive = data.groups[0];
  return {
    groups: data.groups,
    count: data.groups.length,
    message: mostActive ? `${data.groups.length} groups. Most active: "${mostActive.name}" with ${mostActive.messageCount} messages` : "No groups found"
  };
}
__name(executeGetGroupStats, "executeGetGroupStats");
async function executeSendGroupMessage(input, env) {
  const email = (input.email || "").trim();
  const body = (input.body || "").trim();
  const messageType = (input.messageType || "text").trim();
  if (!email) throw new Error("email is required");
  if (messageType === "voice") {
    if (!input.audioUrl) throw new Error("audioUrl is required for voice messages");
  } else {
    if (!body) throw new Error("body (message text) is required");
  }
  if (!input.groupId && !input.groupName) throw new Error("groupId or groupName is required");
  const payload = {
    email,
    groupId: input.groupId || void 0,
    groupName: input.groupName || void 0,
    body,
    messageType
  };
  if (messageType === "voice") {
    payload.audioUrl = input.audioUrl;
    if (input.audioDurationMs) payload.audioDurationMs = input.audioDurationMs;
    if (input.transcriptText) payload.transcriptText = input.transcriptText;
    if (input.transcriptLang) payload.transcriptLang = input.transcriptLang;
  }
  const res = await env.DRIZZLE_WORKER.fetch("https://drizzle-worker/send-group-message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to send message");
  const result = {
    success: true,
    messageId: data.messageId,
    groupId: data.groupId,
    groupName: data.groupName,
    email: data.email,
    body: data.body,
    messageType: data.messageType,
    createdAt: data.createdAt,
    message: messageType === "voice" ? `Sent voice message to "${data.groupName}" as ${data.email}` : `Sent message to "${data.groupName}" as ${data.email}`
  };
  if (messageType === "voice") {
    result.audioUrl = data.audioUrl;
    result.transcriptText = data.transcriptText;
    result.transcriptionStatus = data.transcriptionStatus;
  }
  return result;
}
__name(executeSendGroupMessage, "executeSendGroupMessage");
async function executeCreateChatGroup(input, env) {
  const email = (input.email || "").trim();
  const name = (input.name || "").trim();
  if (!email) throw new Error("email is required");
  if (!name) throw new Error("name (group name) is required");
  const res = await env.DRIZZLE_WORKER.fetch("https://drizzle-worker/create-chat-group", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      name,
      graphId: input.graphId || void 0
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to create chat group");
  return {
    success: true,
    groupId: data.groupId,
    groupName: data.groupName,
    createdBy: data.createdBy,
    role: data.role,
    graphId: data.graphId,
    createdAt: data.createdAt,
    message: `Created chat group "${data.groupName}" with ${data.createdBy} as owner`
  };
}
__name(executeCreateChatGroup, "executeCreateChatGroup");
async function executeRegisterChatBot(input, env) {
  const graphId = (input.graphId || "").trim();
  const botName = (input.botName || "").trim();
  if (!graphId) throw new Error("graphId is required");
  if (!botName) throw new Error("botName is required");
  if (!input.groupId && !input.groupName) throw new Error("groupId or groupName is required");
  const res = await env.DRIZZLE_WORKER.fetch("https://drizzle-worker/register-chat-bot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      graphId,
      botName,
      groupId: input.groupId || void 0,
      groupName: input.groupName || void 0
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to register chat bot");
  return {
    success: true,
    botUserId: data.botUserId,
    botEmail: data.botEmail,
    botName: data.botName,
    groupId: data.groupId,
    groupName: data.groupName,
    graphId: data.graphId,
    message: `Registered bot "${data.botName}" in group "${data.groupName}" (personality graph: ${data.graphId})`
  };
}
__name(executeRegisterChatBot, "executeRegisterChatBot");
async function executeGetGroupMembers(input, env) {
  if (!input.groupId && !input.groupName) throw new Error("groupId or groupName is required");
  const params = new URLSearchParams();
  if (input.groupId) params.set("groupId", input.groupId);
  if (input.groupName) params.set("groupName", input.groupName);
  const res = await env.DRIZZLE_WORKER.fetch(`https://drizzle-worker/group-members?${params}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to get group members");
  return data;
}
__name(executeGetGroupMembers, "executeGetGroupMembers");
async function executeTriggerBotResponse(input, env) {
  if (!input.groupId && !input.groupName) throw new Error("groupId or groupName is required");
  const messageCount = Math.min(input.messageCount || 10, 50);
  const botParams = new URLSearchParams();
  if (input.groupId) botParams.set("groupId", input.groupId);
  if (input.groupName) botParams.set("groupName", input.groupName);
  const botRes = await env.DRIZZLE_WORKER.fetch(`https://drizzle-worker/group-bots?${botParams}`);
  const botData = await botRes.json();
  if (!botRes.ok) throw new Error(botData.error || "Failed to get group bots");
  if (!botData.bots || botData.bots.length === 0) throw new Error(`No bots registered in group "${botData.groupName}"`);
  let bots = botData.bots;
  if (input.botGraphId) {
    bots = bots.filter((b) => b.graphId === input.botGraphId);
    if (bots.length === 0) throw new Error(`Bot with graph "${input.botGraphId}" not found in group`);
  }
  const msgParams = new URLSearchParams();
  msgParams.set("groupId", botData.groupId);
  msgParams.set("limit", String(messageCount));
  const msgRes = await env.DRIZZLE_WORKER.fetch(`https://drizzle-worker/group-messages?${msgParams}`);
  const msgData = await msgRes.json();
  if (!msgRes.ok) throw new Error(msgData.error || "Failed to get group messages");
  const now = Date.now();
  const formattedMessages = (msgData.messages || []).reverse().map((m) => {
    const ago = Math.round((now - new Date(m.createdAt).getTime()) / 6e4);
    const timeStr = ago < 1 ? "just now" : ago < 60 ? `${ago}m ago` : `${Math.round(ago / 60)}h ago`;
    const text = m.messageType === "voice" && m.transcriptText ? `[voice] ${m.transcriptText}` : m.body;
    return `[${m.email}, ${timeStr}]: ${text}`;
  }).join("\n");
  const results = [];
  for (const bot of bots) {
    const isAgentBot = bot.userId.startsWith("bot-agent-");
    let botTitle = bot.botName || bot.email;
    let personality = "";
    let botModel = "claude-haiku-4-5-20251001";
    let botTemp = 0.7;
    let systemPromptOverride = "";
    let botAvatarUrl = null;
    if (isAgentBot) {
      const agentId = bot.userId.replace("bot-agent-", "");
      const agentConfig = await env.DB.prepare("SELECT * FROM agent_configs WHERE id = ?").bind(agentId).first();
      if (agentConfig) {
        botTitle = agentConfig.name || botTitle;
        botModel = agentConfig.model || botModel;
        botTemp = agentConfig.temperature ?? botTemp;
        botAvatarUrl = agentConfig.avatar_url || null;
        if (agentConfig.system_prompt) systemPromptOverride = agentConfig.system_prompt;
        try {
          const meta = JSON.parse(agentConfig.metadata || "{}");
          if (meta.botGraphId && !bot.graphId) bot.graphId = meta.botGraphId;
        } catch {
        }
      }
    }
    if (bot.graphId) {
      const kgRes = await env.KG_WORKER.fetch(`https://knowledge-graph-worker/getknowgraph?id=${bot.graphId}`);
      const kgData = await kgRes.json();
      if (kgRes.ok && kgData.nodes) {
        if (!isAgentBot) botTitle = kgData.metadata?.title || botTitle;
        const fulltextNodes = kgData.nodes.filter((n) => n.type === "fulltext" && n.info);
        personality = fulltextNodes.map((n) => n.info).join("\n\n---\n\n");
      } else if (!isAgentBot) {
        results.push({ bot: bot.email, error: `Failed to load graph ${bot.graphId}` });
        continue;
      }
    } else if (!systemPromptOverride) {
      results.push({ bot: bot.email, error: "No knowledge graph or system prompt configured" });
      continue;
    }
    const systemPrompt = `${systemPromptOverride ? systemPromptOverride + "\n\n" : ""}You are ${botTitle}, a chatbot in the "${botData.groupName}" chat group.

${personality}

Below are recent messages from the group. Respond naturally as ${botTitle}.
Keep your response concise and conversational. Do not repeat what others said.
Do not prefix your response with your name or any label.`;
    const userMessage = `Here are the recent messages in the group:

${formattedMessages}

Please respond as ${botTitle}.`;
    const aiRes = await env.ANTHROPIC.fetch("https://anthropic.vegvisr.org/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: bot.userId,
        messages: [{ role: "user", content: userMessage }],
        system: systemPrompt,
        model: botModel,
        max_tokens: 1024,
        temperature: botTemp
      })
    });
    const aiData = await aiRes.json();
    if (!aiRes.ok) {
      results.push({ bot: bot.email, error: `Claude API error: ${aiData.error || "unknown"}` });
      continue;
    }
    const textBlock = (aiData.content || []).find((c) => c.type === "text");
    const responseText = textBlock?.text || "";
    if (!responseText) {
      results.push({ bot: bot.email, error: "Empty response from Claude" });
      continue;
    }
    const sendPayload = {
      email: bot.email,
      groupId: botData.groupId,
      body: responseText
    };
    if (botAvatarUrl) sendPayload.senderAvatarUrl = botAvatarUrl;
    const sendRes = await env.DRIZZLE_WORKER.fetch("https://drizzle-worker/send-group-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sendPayload)
    });
    const sendData = await sendRes.json();
    if (!sendRes.ok) {
      results.push({ bot: bot.email, error: sendData.error || "Failed to post response" });
      continue;
    }
    results.push({
      bot: bot.email,
      botName: botTitle,
      messageId: sendData.messageId,
      response: responseText,
      success: true
    });
  }
  return {
    groupId: botData.groupId,
    groupName: botData.groupName,
    messagesAnalyzed: msgData.messages?.length || 0,
    botResponses: results,
    message: results.map((r) => r.success ? `${r.botName}: "${r.response.substring(0, 100)}..."` : `${r.bot}: ERROR - ${r.error}`).join("\n")
  };
}
__name(executeTriggerBotResponse, "executeTriggerBotResponse");
async function executeDescribeCapabilities(input, env) {
  const includeTools = input.include_tools !== false;
  const includeTemplates = input.include_templates !== false;
  const result = {};
  if (includeTools) {
    const hardcoded = TOOL_DEFINITIONS.map((t) => ({ name: t.name, description: t.description }));
    let dynamic = [];
    try {
      const loaded = await loadOpenAPITools(env);
      const hardcodedNames = new Set(TOOL_DEFINITIONS.map((t) => t.name));
      dynamic = loaded.tools.filter((t) => !hardcodedNames.has(t.name)).map((t) => ({ name: t.name, description: t.description }));
    } catch {
    }
    result.tools = {
      hardcoded,
      dynamic,
      builtin: [{ name: "web_search", description: "Quick web search (Claude built-in, lightweight)" }],
      total: hardcoded.length + dynamic.length + 1
    };
  }
  if (includeTemplates) {
    result.templates = listTemplates();
  }
  result.summary = `This agent has ${result.tools?.total || "?"} tools and ${result.templates?.length || "?"} HTML templates available. Tools cover knowledge graph management, web search, image search & analysis, audio transcription, semantic analysis, email, and HTML app creation.`;
  return result;
}
__name(executeDescribeCapabilities, "executeDescribeCapabilities");
async function executeDbListTables(env) {
  const db = env.DB;
  if (!db) throw new Error("DB binding not available");
  const result = await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name"
  ).all();
  const tables = [];
  for (const row of result.results) {
    const info = await db.prepare(`PRAGMA table_info(${row.name})`).all();
    tables.push({
      name: row.name,
      columns: info.results.map((c) => ({ name: c.name, type: c.type, notnull: !!c.notnull, pk: !!c.pk }))
    });
  }
  return { tables, message: `Found ${tables.length} tables in vegvisr_org` };
}
__name(executeDbListTables, "executeDbListTables");
async function executeDbQuery(input, env) {
  const db = env.DB;
  if (!db) throw new Error("DB binding not available");
  const sql = (input.sql || "").trim();
  if (!sql) throw new Error("sql is required");
  if (!/^SELECT\b/i.test(sql)) {
    throw new Error("Only SELECT queries are allowed on vegvisr_org.");
  }
  const params = input.params || [];
  let stmt = db.prepare(sql);
  if (params.length > 0) stmt = stmt.bind(...params);
  const result = await stmt.all();
  return {
    records: result.results,
    count: result.results.length,
    message: `Returned ${result.results.length} records`
  };
}
__name(executeDbQuery, "executeDbQuery");
async function executeCalendarListTables(env) {
  const db = env.CALENDAR_DB;
  if (!db) throw new Error("CALENDAR_DB binding not available");
  const result = await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name"
  ).all();
  const tables = [];
  for (const row of result.results) {
    const info = await db.prepare(`PRAGMA table_info(${row.name})`).all();
    tables.push({
      name: row.name,
      columns: info.results.map((c) => ({ name: c.name, type: c.type, notnull: !!c.notnull, pk: !!c.pk }))
    });
  }
  return { tables, message: `Found ${tables.length} tables in calendar_db` };
}
__name(executeCalendarListTables, "executeCalendarListTables");
async function executeCalendarQuery(input, env) {
  const db = env.CALENDAR_DB;
  if (!db) throw new Error("CALENDAR_DB binding not available");
  const sql = (input.sql || "").trim();
  if (!sql) throw new Error("sql is required");
  if (!/^SELECT\b/i.test(sql)) {
    throw new Error("Only SELECT queries are allowed on calendar_db. Use the calendar app for modifications.");
  }
  const params = input.params || [];
  let stmt = db.prepare(sql);
  if (params.length > 0) stmt = stmt.bind(...params);
  const result = await stmt.all();
  return {
    records: result.results,
    count: result.results.length,
    message: `Returned ${result.results.length} records`
  };
}
__name(executeCalendarQuery, "executeCalendarQuery");
async function executeCalendarGetSettings(input, env) {
  const userEmail = (input.userEmail || "").trim();
  if (!userEmail) throw new Error("userEmail is required");
  const res = await env.CALENDAR_WORKER.fetch(
    `https://calendar-worker/api/public/settings?user=${encodeURIComponent(userEmail)}`
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to get calendar settings");
  return {
    settings: data.settings,
    availability: data.availability,
    meetingTypes: data.meetingTypes,
    groupMeetings: data.groupMeetings,
    message: `Retrieved calendar settings for ${userEmail}: available ${data.settings.availability_start}-${data.settings.availability_end}, ${data.meetingTypes?.length || 0} meeting types`
  };
}
__name(executeCalendarGetSettings, "executeCalendarGetSettings");
async function executeCalendarCheckAvailability(input, env) {
  const userEmail = (input.userEmail || "").trim();
  const date = (input.date || "").trim();
  if (!userEmail) throw new Error("userEmail is required");
  if (!date) throw new Error("date is required (YYYY-MM-DD)");
  const res = await env.CALENDAR_WORKER.fetch(
    `https://calendar-worker/api/public/bookings?user=${encodeURIComponent(userEmail)}&date=${date}`
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to check availability");
  const bookings = data.bookings || [];
  return {
    date,
    bookedSlots: bookings,
    count: bookings.length,
    message: bookings.length === 0 ? `No bookings on ${date} \u2014 all slots are free` : `${bookings.length} occupied slot(s) on ${date}`
  };
}
__name(executeCalendarCheckAvailability, "executeCalendarCheckAvailability");
async function executeCalendarListBookings(input, env) {
  const userEmail = (input.userEmail || "").trim();
  if (!userEmail) throw new Error("userEmail is required");
  const res = await env.CALENDAR_WORKER.fetch(
    "https://calendar-worker/api/admin/bookings",
    { headers: { "X-User-Email": userEmail } }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to list bookings");
  const bookings = data.bookings || [];
  return {
    bookings,
    count: bookings.length,
    message: bookings.length === 0 ? `No bookings found for ${userEmail}` : `Found ${bookings.length} booking(s) for ${userEmail}`
  };
}
__name(executeCalendarListBookings, "executeCalendarListBookings");
async function executeCalendarCreateBooking(input, env) {
  const ownerEmail = (input.ownerEmail || "").trim();
  const guestName = (input.guestName || "").trim();
  const guestEmail = (input.guestEmail || "").trim();
  const startTime = (input.startTime || "").trim();
  const endTime = (input.endTime || "").trim();
  if (!ownerEmail) throw new Error("ownerEmail is required");
  if (!guestName) throw new Error("guestName is required");
  if (!guestEmail) throw new Error("guestEmail is required");
  if (!startTime) throw new Error("startTime is required (ISO 8601)");
  if (!endTime) throw new Error("endTime is required (ISO 8601)");
  const res = await env.CALENDAR_WORKER.fetch(
    "https://calendar-worker/api/bookings",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner_email: ownerEmail,
        guest_name: guestName,
        guest_email: guestEmail,
        start_time: startTime,
        end_time: endTime,
        description: input.description || "",
        meeting_type_id: input.meetingTypeId || null
      })
    }
  );
  const data = await res.json();
  if (res.status === 409) {
    return {
      success: false,
      conflict: true,
      message: data.error || "This time slot is already booked. Please choose a different time."
    };
  }
  if (!res.ok) throw new Error(data.error || "Failed to create booking");
  return {
    success: true,
    bookingId: data.bookingId,
    googleSynced: data.google_synced,
    message: `Booking created (ID: ${data.bookingId}). ${data.google_synced ? "Synced to Google Calendar." : "Google Calendar not connected \u2014 booking saved in D1 only."}`
  };
}
__name(executeCalendarCreateBooking, "executeCalendarCreateBooking");
async function executeCalendarRescheduleBooking(input, env) {
  const userEmail = (input.userEmail || "").trim();
  const bookingId = input.bookingId;
  const newStartTime = (input.newStartTime || "").trim();
  const newEndTime = (input.newEndTime || "").trim();
  if (!userEmail) throw new Error("userEmail is required");
  if (!bookingId) throw new Error("bookingId is required");
  if (!newStartTime) throw new Error("newStartTime is required (ISO 8601)");
  if (!newEndTime) throw new Error("newEndTime is required (ISO 8601)");
  const res = await env.CALENDAR_WORKER.fetch(
    "https://calendar-worker/api/admin/bookings",
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-User-Email": userEmail
      },
      body: JSON.stringify({
        id: bookingId,
        start_time: newStartTime,
        end_time: newEndTime
      })
    }
  );
  const data = await res.json();
  if (res.status === 409) {
    return {
      success: false,
      conflict: true,
      message: data.error || "The new time slot conflicts with an existing booking. Please choose a different time."
    };
  }
  if (res.status === 404) {
    return {
      success: false,
      message: data.error || "Booking not found. It may have been deleted."
    };
  }
  if (!res.ok) throw new Error(data.error || "Failed to reschedule booking");
  return {
    success: true,
    bookingId: data.bookingId,
    googleUpdated: data.google_updated,
    message: `Booking ${data.bookingId} rescheduled to ${newStartTime} \u2014 ${newEndTime}. ${data.google_updated ? "Google Calendar updated." : "Google Calendar not updated (not synced or not connected)."}`
  };
}
__name(executeCalendarRescheduleBooking, "executeCalendarRescheduleBooking");
async function executeCalendarDeleteBooking(input, env) {
  const userEmail = (input.userEmail || "").trim();
  const bookingId = input.bookingId;
  if (!userEmail) throw new Error("userEmail is required");
  if (!bookingId) throw new Error("bookingId is required");
  const res = await env.CALENDAR_WORKER.fetch(
    `https://calendar-worker/api/admin/bookings?id=${bookingId}`,
    {
      method: "DELETE",
      headers: { "X-User-Email": userEmail }
    }
  );
  const data = await res.json();
  if (res.status === 404) {
    return {
      success: false,
      message: data.error || "Booking not found. It may have already been deleted."
    };
  }
  if (!res.ok) throw new Error(data.error || "Failed to delete booking");
  return {
    success: true,
    googleDeleted: data.google_deleted,
    message: `Booking ${bookingId} has been cancelled and removed. ${data.google_deleted ? "Also removed from Google Calendar." : ""}`
  };
}
__name(executeCalendarDeleteBooking, "executeCalendarDeleteBooking");
async function executeCalendarGetStatus(input, env) {
  const userEmail = (input.userEmail || "").trim();
  if (!userEmail) throw new Error("userEmail is required");
  const res = await env.CALENDAR_WORKER.fetch(
    "https://calendar-worker/api/auth/calendar-status",
    { headers: { "X-User-Email": userEmail } }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to check calendar status");
  return {
    connected: data.connected,
    message: data.connected ? `Google Calendar is connected for ${userEmail}` : `Google Calendar is NOT connected for ${userEmail}`
  };
}
__name(executeCalendarGetStatus, "executeCalendarGetStatus");
async function executeTool(toolName, toolInput, env, operationMap, onProgress) {
  const progress = typeof onProgress === "function" ? onProgress : () => {
  };
  switch (toolName) {
    case "create_graph":
      return await executeCreateGraph(toolInput, env);
    case "create_html_node":
      return await executeCreateHtmlNode(toolInput, env);
    case "create_node":
      return await executeCreateNode(toolInput, env);
    case "add_edge":
      return await executeAddEdge(toolInput, env);
    case "get_contract":
      return await executeGetContract(toolInput, env);
    case "get_html_template":
      return await executeGetHtmlTemplate(toolInput, env);
    case "create_html_from_template":
      return await executeCreateHtmlFromTemplate(toolInput, env);
    case "read_graph":
      return await executeReadGraph(toolInput, env);
    case "read_graph_content":
      return await executeReadGraphContent(toolInput, env);
    case "read_node":
      return await executeReadNode(toolInput, env);
    case "patch_node":
      return await executePatchNode(toolInput, env);
    case "edit_html_node":
      return await executeEditHtmlNode(toolInput, env);
    case "patch_graph_metadata":
      return await executePatchGraphMetadata(toolInput, env);
    case "list_graphs":
      return await executeListGraphs(toolInput, env);
    case "list_meta_areas":
      return await executeListMetaAreas(toolInput, env);
    case "perplexity_search":
      return await executePerplexitySearch(toolInput, env);
    case "search_pexels":
      return await executeSearchPexels(toolInput, env);
    case "search_unsplash":
      return await executeSearchUnsplash(toolInput, env);
    case "get_album_images":
      return await executeGetAlbumImages(toolInput, env);
    case "analyze_image":
      return await executeAnalyzeImage(toolInput, env);
    case "get_formatting_reference":
      return { reference: FORMATTING_REFERENCE };
    case "get_node_types_reference":
      return { reference: NODE_TYPES_REFERENCE };
    case "get_html_builder_reference":
      return { reference: HTML_BUILDER_REFERENCE };
    case "who_am_i":
      return await executeWhoAmI(toolInput, env);
    case "list_recordings":
      return await executeListRecordings(toolInput, env);
    case "transcribe_audio":
      return await executeTranscribeAudio(toolInput, env);
    case "analyze_node":
      return await executeAnalyzeNode(toolInput, env);
    case "analyze_graph":
      return await executeAnalyzeGraph(toolInput, env);
    case "analyze_transcription":
      return await executeAnalyzeTranscription(toolInput, env, progress);
    case "admin_register_user":
      return await executeAdminRegisterUser(toolInput, env);
    case "send_email":
      return await executeSendEmail(toolInput, env);
    case "save_form_data":
      return await executeSaveFormData(toolInput, env);
    case "query_data_nodes":
      return await executeQueryDataNodes(toolInput, env);
    case "create_app_table":
      return await executeCreateAppTable(toolInput, env);
    case "insert_app_record":
      return await executeInsertAppRecord(toolInput, env);
    case "query_app_table":
      return await executeQueryAppTable(toolInput, env);
    case "list_chat_groups":
      return await executeListChatGroups(toolInput, env);
    case "add_user_to_chat_group":
      return await executeAddUserToChatGroup(toolInput, env);
    case "get_group_messages":
      return await executeGetGroupMessages(toolInput, env);
    case "get_group_stats":
      return await executeGetGroupStats(toolInput, env);
    case "send_group_message":
      return await executeSendGroupMessage(toolInput, env);
    case "create_chat_group":
      return await executeCreateChatGroup(toolInput, env);
    case "register_chat_bot":
      return await executeRegisterChatBot(toolInput, env);
    case "get_group_members":
      return await executeGetGroupMembers(toolInput, env);
    case "trigger_bot_response":
      return await executeTriggerBotResponse(toolInput, env);
    case "describe_capabilities":
      return await executeDescribeCapabilities(toolInput, env);
    case "db_list_tables":
      return await executeDbListTables(env);
    case "db_query":
      return await executeDbQuery(toolInput, env);
    case "calendar_list_tables":
      return await executeCalendarListTables(env);
    case "calendar_query":
      return await executeCalendarQuery(toolInput, env);
    case "calendar_get_settings":
      return await executeCalendarGetSettings(toolInput, env);
    case "calendar_check_availability":
      return await executeCalendarCheckAvailability(toolInput, env);
    case "calendar_list_bookings":
      return await executeCalendarListBookings(toolInput, env);
    case "calendar_create_booking":
      return await executeCalendarCreateBooking(toolInput, env);
    case "calendar_reschedule_booking":
      return await executeCalendarRescheduleBooking(toolInput, env);
    case "calendar_delete_booking":
      return await executeCalendarDeleteBooking(toolInput, env);
    case "calendar_get_status":
      return await executeCalendarGetStatus(toolInput, env);
    case "delegate_to_html_builder": {
      const result = await runHtmlBuilderSubagent(toolInput, env, progress, executeTool);
      return {
        success: result.success,
        summary: result.summary,
        graphId: result.graphId,
        nodeId: result.nodeId,
        turns: result.turns,
        actionsPerformed: (result.actions || []).map((a) => ({
          tool: a.tool,
          success: a.success,
          summary: a.summary || a.error
        })),
        message: result.success ? `HTML Builder completed: ${(result.summary || "").slice(0, 500)}` : `HTML Builder failed: ${result.error || "Unknown error"}`,
        viewUrl: result.graphId ? `https://www.vegvisr.org/gnew-viewer?graphId=${result.graphId}` : void 0
      };
    }
    default:
      if (isOpenAPITool(toolName) && operationMap) {
        return await executeOpenAPITool(toolName, toolInput, env, operationMap);
      }
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
__name(executeTool, "executeTool");

// agent-loop.js
async function loadAllTools(env) {
  let openAPITools = [];
  let operationMap = {};
  try {
    const loaded = await loadOpenAPITools(env);
    openAPITools = loaded.tools;
    operationMap = loaded.operationMap;
  } catch (err) {
    console.error("Failed to load OpenAPI tools:", err);
  }
  const hardcodedNames = new Set(TOOL_DEFINITIONS.map((t) => t.name));
  const dynamicTools = openAPITools.filter((t) => !hardcodedNames.has(t.name));
  const ORCHESTRATOR_BLOCKED_TOOLS = /* @__PURE__ */ new Set(["edit_html_node"]);
  const filteredTools = TOOL_DEFINITIONS.filter((t) => !ORCHESTRATOR_BLOCKED_TOOLS.has(t.name));
  const allTools = [...filteredTools, ...dynamicTools, WEB_SEARCH_TOOL];
  return { allTools, operationMap };
}
__name(loadAllTools, "loadAllTools");
function truncateResult(result) {
  let resultStr = JSON.stringify(result);
  const MAX_RESULT_SIZE = 12e3;
  if (resultStr.length > MAX_RESULT_SIZE) {
    const truncated = JSON.parse(resultStr);
    if (truncated.nodes) {
      truncated.nodes = truncated.nodes.map((n) => ({
        ...n,
        info: n.info && n.info.length > 300 ? n.info.slice(0, 300) + "... [truncated]" : n.info
      }));
    }
    resultStr = JSON.stringify(truncated);
    if (resultStr.length > MAX_RESULT_SIZE) {
      resultStr = resultStr.slice(0, MAX_RESULT_SIZE) + "... [truncated \u2014 result too large]";
    }
  }
  return resultStr;
}
__name(truncateResult, "truncateResult");
async function streamingAgentLoop(writer, encoder, messages, systemPrompt, userId, env, options) {
  const maxTurns = options.maxTurns || 8;
  const model = options.model || "claude-haiku-4-5-20251001";
  let turn = 0;
  const startTime = Date.now();
  const log = /* @__PURE__ */ __name((msg) => {
    const elapsed = ((Date.now() - startTime) / 1e3).toFixed(1);
    console.log(`[agent-loop +${elapsed}s] ${msg}`);
  }, "log");
  let { allTools, operationMap } = await loadAllTools(env);
  if (options.toolFilter && options.toolFilter.length > 0) {
    const allowed = new Set(options.toolFilter);
    allTools = allTools.filter((t) => allowed.has(t.name));
    log(`tool filter applied: ${options.toolFilter.length} allowed \u2192 ${allTools.length} tools`);
  }
  log(`started | model=${model} maxTurns=${maxTurns} tools=${allTools.length} userId=${userId?.slice(0, 8)}...`);
  try {
    if (options.avatarUrl) {
      writer.write(encoder.encode(`event: agent_info
data: ${JSON.stringify({ avatarUrl: options.avatarUrl })}

`));
    }
    while (turn < maxTurns) {
      turn++;
      log(`turn ${turn}/${maxTurns} \u2014 calling Anthropic`);
      writer.write(encoder.encode(`event: thinking
data: ${JSON.stringify({ turn })}

`));
      const response = await env.ANTHROPIC.fetch("https://anthropic.vegvisr.org/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          messages,
          model,
          max_tokens: 16384,
          temperature: 0.3,
          system: systemPrompt,
          tools: allTools
        })
      });
      const data = await response.json();
      log(`turn ${turn} response: status=${response.status} stop_reason=${data.stop_reason} content_blocks=${(data.content || []).length}`);
      if (!response.ok) {
        log(`ERROR: Anthropic API error \u2014 ${JSON.stringify(data.error || "unknown")}`);
        writer.write(encoder.encode(`event: error
data: ${JSON.stringify({ error: data.error || "Anthropic API error" })}

`));
        break;
      }
      if (data.stop_reason === "end_turn") {
        const textBlocks = (data.content || []).filter((c) => c.type === "text");
        const textLen = textBlocks.reduce((sum, b) => sum + b.text.length, 0);
        log(`end_turn \u2014 ${textBlocks.length} text blocks (${textLen} chars)`);
        for (const block of textBlocks) {
          writer.write(encoder.encode(`event: text
data: ${JSON.stringify({ content: block.text })}

`));
        }
        try {
          const lastAssistantText = textBlocks.map((b) => b.text).join("\n");
          const recentContext = messages.slice(-4).map((m) => {
            let content;
            if (typeof m.content === "string") {
              content = m.content;
            } else if (Array.isArray(m.content)) {
              content = m.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
              const imgCount = m.content.filter((b) => b.type === "image").length;
              if (imgCount > 0) content = `[${imgCount} image(s)] ${content}`;
            } else {
              content = JSON.stringify(m.content);
            }
            return `${m.role}: ${content.slice(0, 300)}`;
          }).join("\n");
          const suggestRes = await env.ANTHROPIC.fetch("https://anthropic.vegvisr.org/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId,
              messages: [{
                role: "user",
                content: `Based on this conversation context and the assistant's last response, suggest exactly 3 short follow-up prompts the user might want to ask next. Each should be a natural next step, question, or action. Return ONLY a JSON array of 3 strings, no explanation.

Recent conversation:
${recentContext}

Assistant's response:
${lastAssistantText.slice(0, 500)}`
              }],
              model: "claude-haiku-4-5-20251001",
              max_tokens: 256,
              temperature: 0.7
            })
          });
          if (suggestRes.ok) {
            const suggestData = await suggestRes.json();
            const suggestText = (suggestData.content || []).find((c) => c.type === "text")?.text || "";
            const jsonMatch = suggestText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              const suggestions = JSON.parse(jsonMatch[0]);
              if (Array.isArray(suggestions) && suggestions.length > 0) {
                const cleaned = suggestions.slice(0, 3).map((s) => String(s).trim()).filter((s) => s.length > 0);
                if (cleaned.length > 0) {
                  log(`suggestions generated: ${cleaned.length}`);
                  writer.write(encoder.encode(`event: suggestions
data: ${JSON.stringify({ suggestions: cleaned })}

`));
                }
              }
            }
          }
        } catch (sugErr) {
          log(`suggestions generation failed (non-fatal): ${sugErr.message}`);
        }
        writer.write(encoder.encode(`event: done
data: ${JSON.stringify({ turns: turn })}

`));
        break;
      }
      if (data.stop_reason === "tool_use") {
        const toolUses = (data.content || []).filter((c) => c.type === "tool_use");
        const textBlocks = (data.content || []).filter((c) => c.type === "text");
        log(`tool_use \u2014 ${toolUses.length} tools: [${toolUses.map((t) => t.name).join(", ")}]`);
        for (const block of textBlocks) {
          writer.write(encoder.encode(`event: text
data: ${JSON.stringify({ content: block.text })}

`));
        }
        const SEQUENTIAL_TOOLS = /* @__PURE__ */ new Set([
          "create_graph",
          "create_node",
          "create_html_node",
          "add_edge",
          "patch_node",
          "patch_graph_metadata",
          "edit_html_node",
          "save_form_data",
          "create_app_table",
          "insert_app_record",
          "add_user_to_chat_group",
          "send_group_message",
          "create_chat_group",
          "register_chat_bot",
          "trigger_bot_response",
          "delegate_to_html_builder"
        ]);
        const sequentialTools = toolUses.filter((t) => SEQUENTIAL_TOOLS.has(t.name));
        const parallelTools = toolUses.filter((t) => !SEQUENTIAL_TOOLS.has(t.name));
        const executeAndStream = /* @__PURE__ */ __name(async (toolUse) => {
          const toolStart = Date.now();
          log(`executing ${toolUse.name} (input: ${JSON.stringify(toolUse.input).slice(0, 200)})`);
          writer.write(encoder.encode(`event: tool_call
data: ${JSON.stringify({ tool: toolUse.name, input: toolUse.input })}

`));
          const onProgress = /* @__PURE__ */ __name((msg) => {
            writer.write(encoder.encode(`event: tool_progress
data: ${JSON.stringify({ tool: toolUse.name, message: msg })}

`));
          }, "onProgress");
          try {
            const result = await executeTool(toolUse.name, { ...toolUse.input, userId }, env, operationMap, onProgress);
            const summary = result.message || `${toolUse.name} completed`;
            const resultLen = JSON.stringify(result).length;
            log(`${toolUse.name} OK (${((Date.now() - toolStart) / 1e3).toFixed(1)}s, ${resultLen} chars)`);
            const ssePayload = { tool: toolUse.name, success: true, summary };
            if (toolUse.name === "edit_html_node" && result.updatedHtml) {
              ssePayload.updatedHtml = result.updatedHtml;
              ssePayload.nodeId = result.nodeId;
            }
            if (result.clientSideRequired) {
              ssePayload.clientSideRequired = true;
              ssePayload.audioUrl = result.audioUrl;
              ssePayload.language = result.language;
              ssePayload.recordingId = result.recordingId;
              ssePayload.saveToGraph = result.saveToGraph || false;
              ssePayload.graphTitle = result.graphTitle || null;
            }
            writer.write(encoder.encode(`event: tool_result
data: ${JSON.stringify(ssePayload)}

`));
            const resultForClaude = { ...result };
            delete resultForClaude.updatedHtml;
            const resultStr = truncateResult(resultForClaude);
            return { type: "tool_result", tool_use_id: toolUse.id, content: resultStr };
          } catch (error) {
            log(`${toolUse.name} FAILED (${((Date.now() - toolStart) / 1e3).toFixed(1)}s): ${error.message}`);
            writer.write(encoder.encode(`event: tool_result
data: ${JSON.stringify({ tool: toolUse.name, success: false, error: error.message })}

`));
            return { type: "tool_result", tool_use_id: toolUse.id, content: JSON.stringify({ error: error.message }) };
          }
        }, "executeAndStream");
        const sequentialResults = [];
        for (const toolUse of sequentialTools) {
          sequentialResults.push(await executeAndStream(toolUse));
        }
        const parallelResults = await Promise.all(parallelTools.map(executeAndStream));
        const toolResults = [...sequentialResults, ...parallelResults];
        messages.push(
          { role: "assistant", content: data.content },
          { role: "user", content: toolResults }
        );
      } else if (data.stop_reason === "max_tokens") {
        log(`max_tokens hit on turn ${turn} \u2014 sending continuation`);
        const textBlocks = (data.content || []).filter((c) => c.type === "text");
        for (const block of textBlocks) {
          writer.write(encoder.encode(`event: text
data: ${JSON.stringify({ content: block.text })}

`));
        }
        messages.push(
          { role: "assistant", content: data.content },
          { role: "user", content: "Continue. Do not repeat what you already said." }
        );
      } else {
        log(`unexpected stop_reason: ${data.stop_reason}`);
        writer.write(encoder.encode(`event: error
data: ${JSON.stringify({ error: "Unexpected stop: " + data.stop_reason })}

`));
        break;
      }
    }
    if (turn >= maxTurns) {
      log(`max turns reached (${maxTurns})`);
      writer.write(encoder.encode(`event: done
data: ${JSON.stringify({ turns: turn, maxReached: true })}

`));
    }
  } catch (err) {
    log(`FATAL ERROR: ${err.message}
${err.stack}`);
    writer.write(encoder.encode(`event: error
data: ${JSON.stringify({ error: err.message })}

`));
  } finally {
    log(`stream closed \u2014 ${turn} turns, ${((Date.now() - startTime) / 1e3).toFixed(1)}s total`);
    writer.close();
  }
}
__name(streamingAgentLoop, "streamingAgentLoop");
async function executeAgent(agentConfig, userTask, userId, env) {
  let taskWithContract = userTask;
  if (agentConfig.default_contract_id) {
    taskWithContract = `${userTask}

[Default contract: ${agentConfig.default_contract_id}]`;
  }
  const messages = [{ role: "user", content: taskWithContract }];
  const { allTools, operationMap } = await loadAllTools(env);
  const executionLog = [];
  let turn = 0;
  const maxTurns = agentConfig.max_turns || 5;
  while (turn < maxTurns) {
    turn++;
    executionLog.push({
      turn,
      type: "agent_thinking",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    const response = await env.ANTHROPIC.fetch("https://anthropic.vegvisr.org/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        messages,
        model: agentConfig.model || "claude-haiku-4-5-20251001",
        max_tokens: agentConfig.max_tokens || 4096,
        temperature: agentConfig.temperature ?? 0.3,
        system: agentConfig.system_prompt,
        tools: allTools
      })
    });
    const data = await response.json();
    if (!response.ok) {
      executionLog.push({
        turn,
        type: "error",
        error: data.error || "Anthropic API error",
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      break;
    }
    if (data.stop_reason === "end_turn") {
      const serverSearches = data.content.filter((c) => c.type === "server_tool_use");
      for (const search of serverSearches) {
        executionLog.push({
          turn,
          type: "web_search",
          tool: "web_search",
          query: search.input?.query,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
      const textContent = data.content.find((c) => c.type === "text");
      executionLog.push({
        turn,
        type: "agent_complete",
        response: textContent ? textContent.text : "",
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      break;
    }
    if (data.stop_reason === "tool_use") {
      const toolUses = data.content.filter((c) => c.type === "tool_use");
      const serverSearches = data.content.filter((c) => c.type === "server_tool_use");
      for (const search of serverSearches) {
        executionLog.push({
          turn,
          type: "web_search",
          tool: "web_search",
          query: search.input?.query,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
      if (toolUses.length > 0) {
        executionLog.push({
          turn,
          type: "tool_calls",
          tools: toolUses.map((t) => ({ name: t.name, input: t.input })),
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
      const SEQUENTIAL_TOOLS = /* @__PURE__ */ new Set([
        "create_graph",
        "create_node",
        "create_html_node",
        "add_edge",
        "patch_node",
        "patch_graph_metadata",
        "edit_html_node",
        "save_form_data",
        "create_app_table",
        "insert_app_record",
        "add_user_to_chat_group",
        "send_group_message",
        "create_chat_group",
        "register_chat_bot",
        "trigger_bot_response"
      ]);
      const sequentialTools = toolUses.filter((t) => SEQUENTIAL_TOOLS.has(t.name));
      const parallelTools = toolUses.filter((t) => !SEQUENTIAL_TOOLS.has(t.name));
      const sequentialResults = [];
      for (const toolUse of sequentialTools) {
        try {
          const result = await executeTool(toolUse.name, { ...toolUse.input, userId }, env, operationMap);
          executionLog.push({ turn, type: "tool_result", tool: toolUse.name, success: true, result, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
          sequentialResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: JSON.stringify(result) });
        } catch (error) {
          executionLog.push({ turn, type: "tool_error", tool: toolUse.name, error: error.message, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
          sequentialResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: JSON.stringify({ error: error.message }) });
        }
      }
      const parallelResults = await Promise.all(parallelTools.map(async (toolUse) => {
        try {
          const result = await executeTool(toolUse.name, { ...toolUse.input, userId }, env, operationMap);
          executionLog.push({ turn, type: "tool_result", tool: toolUse.name, success: true, result, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
          return { type: "tool_result", tool_use_id: toolUse.id, content: JSON.stringify(result) };
        } catch (error) {
          executionLog.push({ turn, type: "tool_error", tool: toolUse.name, error: error.message, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
          return { type: "tool_result", tool_use_id: toolUse.id, content: JSON.stringify({ error: error.message }) };
        }
      }));
      const toolResults = [...sequentialResults, ...parallelResults];
      messages.push(
        { role: "assistant", content: data.content },
        { role: "user", content: toolResults }
      );
    } else if (data.stop_reason === "pause_turn") {
      executionLog.push({
        turn,
        type: "pause_turn",
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      const serverSearches = data.content.filter((c) => c.type === "server_tool_use");
      for (const search of serverSearches) {
        executionLog.push({
          turn,
          type: "web_search",
          tool: "web_search",
          query: search.input?.query,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
      messages.push(
        { role: "assistant", content: data.content },
        { role: "user", content: "Continue." }
      );
    } else if (data.stop_reason === "max_tokens") {
      executionLog.push({
        turn,
        type: "max_tokens_continuation",
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      messages.push(
        { role: "assistant", content: data.content },
        { role: "user", content: "You hit the token limit. Do NOT repeat what you already said. Continue by making your next tool call (create_node, add_edge, etc.) to finish the task." }
      );
    } else {
      executionLog.push({
        turn,
        type: "unexpected_stop",
        stop_reason: data.stop_reason,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      break;
    }
  }
  if (turn >= maxTurns) {
    executionLog.push({
      type: "max_turns_reached",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  return {
    success: turn < maxTurns,
    turns: turn,
    executionLog
  };
}
__name(executeAgent, "executeAgent");

// index.js
var index_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Content-Type": "application/json"
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    try {
      if (pathname === "/api/data-node/submit" && request.method === "POST") {
        const body = await request.json();
        const { graphId, nodeId, record } = body;
        if (!graphId || !nodeId || !record || typeof record !== "object") {
          return new Response(JSON.stringify({ error: "graphId, nodeId, and record are required" }), { status: 400, headers: corsHeaders });
        }
        record._id = crypto.randomUUID();
        record._ts = (/* @__PURE__ */ new Date()).toISOString();
        const getRes = await env.KG_WORKER.fetch(
          `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(graphId)}&nodeId=${encodeURIComponent(nodeId)}`
        );
        if (!getRes.ok) {
          return new Response(JSON.stringify({ error: "Graph or node not found" }), { status: 404, headers: corsHeaders });
        }
        const graphData = await getRes.json();
        const node = (graphData.nodes || []).find((n) => n.id === nodeId);
        if (!node || node.type !== "data-node") {
          return new Response(JSON.stringify({ error: "data-node not found" }), { status: 404, headers: corsHeaders });
        }
        let records = [];
        try {
          records = JSON.parse(node.info || "[]");
        } catch {
          records = [];
        }
        if (!Array.isArray(records)) records = [];
        records.push(record);
        const patchRes = await env.KG_WORKER.fetch("https://knowledge-graph-worker/patchNode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ graphId, nodeId, fields: { info: JSON.stringify(records) } })
        });
        if (!patchRes.ok) {
          const err = await patchRes.json().catch(() => ({}));
          return new Response(JSON.stringify({ error: err.error || "Failed to save" }), { status: 500, headers: corsHeaders });
        }
        return new Response(JSON.stringify({ success: true, recordId: record._id, recordCount: records.length }), { headers: corsHeaders });
      }
      if (pathname === "/execute" && request.method === "POST") {
        const body = await request.json();
        const { agentId, task, userId, contractId, graphId } = body;
        if (!agentId || !task || !userId) {
          return new Response(JSON.stringify({
            error: "agentId, task, and userId are required"
          }), { status: 400, headers: corsHeaders });
        }
        const agentConfig = await env.DB.prepare(`
          SELECT * FROM agent_configs WHERE id = ?1 AND is_active = 1
        `).bind(agentId).first();
        if (!agentConfig) {
          return new Response(JSON.stringify({
            error: "Agent not found or inactive"
          }), { status: 404, headers: corsHeaders });
        }
        const config = {
          ...agentConfig,
          tools: JSON.parse(agentConfig.tools || "[]"),
          metadata: JSON.parse(agentConfig.metadata || "{}"),
          default_contract_id: contractId || agentConfig.default_contract_id
        };
        const targetGraphId = graphId || crypto.randomUUID();
        let enrichedTask = `${task}

[Target graph ID: ${targetGraphId}] \u2014 Use this exact graphId when calling create_graph and create_html_from_template.`;
        const result = await executeAgent(config, enrichedTask, userId, env);
        return new Response(JSON.stringify(result), { headers: corsHeaders });
      }
      if (pathname === "/chat" && request.method === "POST") {
        const body = await request.json();
        const { userId, messages: userMessages, graphId, model, maxTurns, agentId, activeHtmlNodeId } = body;
        console.log(`[/chat] graphId=${graphId} activeHtmlNodeId=${activeHtmlNodeId} agentId=${agentId}`);
        if (!userId || !userMessages || !Array.isArray(userMessages)) {
          return new Response(JSON.stringify({
            error: "userId and messages[] are required"
          }), { status: 400, headers: corsHeaders });
        }
        let systemPrompt = CHAT_SYSTEM_PROMPT;
        let toolFilter = null;
        let agentAvatarUrl = null;
        let agentModel = model || "claude-haiku-4-5-20251001";
        if (agentId) {
          const agentConfig = await env.DB.prepare(
            "SELECT * FROM agent_configs WHERE id = ?1 AND is_active = 1"
          ).bind(agentId).first();
          if (agentConfig) {
            if (agentConfig.system_prompt) systemPrompt = agentConfig.system_prompt;
            agentAvatarUrl = agentConfig.avatar_url || null;
            if (agentConfig.model) agentModel = agentConfig.model;
            const tools = JSON.parse(agentConfig.tools || "[]");
            if (tools.length > 0) toolFilter = tools;
          }
        }
        if (graphId) {
          let ctx2 = `

## Current Context
The user has selected graph "${graphId}". Use this graphId for operations unless they specify otherwise.`;
          if (activeHtmlNodeId) {
            ctx2 += `
The active HTML node is "${activeHtmlNodeId}". Use this nodeId when reading or editing the HTML app \u2014 do NOT guess node IDs.`;
          }
          systemPrompt += ctx2;
        }
        const chatMessages = userMessages.map((m) => ({ role: m.role, content: m.content }));
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();
        ctx.waitUntil(
          streamingAgentLoop(writer, encoder, chatMessages, systemPrompt, userId, env, {
            model: agentModel,
            maxTurns: maxTurns || 8,
            toolFilter,
            avatarUrl: agentAvatarUrl
          })
        );
        return new Response(readable, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization"
          }
        });
      }
      if (pathname === "/upload-image" && request.method === "POST") {
        const body = await request.json();
        const { userId, base64, mediaType, filename } = body;
        if (!userId || !base64) {
          return new Response(JSON.stringify({ error: "userId and base64 are required" }), {
            status: 400,
            headers: corsHeaders
          });
        }
        let userEmail = null;
        try {
          const profile = await env.DB.prepare(
            "SELECT email FROM config WHERE user_id = ?"
          ).bind(userId).first();
          if (!profile) {
            const profileByEmail = await env.DB.prepare(
              "SELECT email FROM config WHERE email = ?"
            ).bind(userId).first();
            userEmail = profileByEmail?.email || userId;
          } else {
            userEmail = profile.email;
          }
        } catch {
          userEmail = userId;
        }
        const binaryData = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const blob = new Blob([binaryData], { type: mediaType || "image/png" });
        const uploadName = filename || `agent-upload-${Date.now()}.${(mediaType || "image/png").split("/")[1] || "png"}`;
        const formData = new FormData();
        formData.append("file", blob, uploadName);
        if (userEmail) formData.append("userEmail", userEmail);
        const uploadRes = await env.PHOTOS_WORKER.fetch("https://photos-api.vegvisr.org/upload", {
          method: "POST",
          body: formData
        });
        if (!uploadRes.ok) {
          const errText = await uploadRes.text();
          return new Response(JSON.stringify({ error: `Upload failed: ${errText}` }), {
            status: uploadRes.status,
            headers: corsHeaders
          });
        }
        const uploadData = await uploadRes.json();
        const key = uploadData.keys?.[0] || uploadData.key || uploadData.r2Key || uploadName;
        const url2 = uploadData.urls?.[0] || `https://vegvisr.imgix.net/${key}`;
        return new Response(JSON.stringify({ key, url: url2 }), { headers: corsHeaders });
      }
      if (pathname === "/analyze" && request.method === "POST") {
        const body = await request.json();
        const { graphId, nodeId } = body;
        if (!graphId) {
          return new Response(JSON.stringify({ error: "graphId is required" }), {
            status: 400,
            headers: corsHeaders
          });
        }
        try {
          let result;
          if (nodeId) {
            result = await executeAnalyzeNode({ graphId, nodeId, analysisType: "all", store: false, userId: "viewer" }, env);
          } else {
            result = await executeAnalyzeGraph({ graphId, store: false, userId: "viewer" }, env);
          }
          return new Response(JSON.stringify(result), { headers: corsHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: corsHeaders
          });
        }
      }
      if (pathname === "/layout" && request.method === "GET") {
        const contractId = url.searchParams.get("contractId");
        if (!contractId) {
          return new Response(JSON.stringify({ error: "contractId required" }), {
            status: 400,
            headers: corsHeaders
          });
        }
        const row = await env.DB.prepare(
          "SELECT layout FROM agent_contracts WHERE id = ?1"
        ).bind(contractId).first();
        return new Response(JSON.stringify({
          contractId,
          layout: row?.layout ? JSON.parse(row.layout) : null
        }), { headers: corsHeaders });
      }
      if (pathname === "/layout" && request.method === "PUT") {
        const body = await request.json();
        const { contractId, layout } = body;
        if (!contractId || !layout) {
          return new Response(JSON.stringify({ error: "contractId and layout required" }), {
            status: 400,
            headers: corsHeaders
          });
        }
        await env.DB.prepare(
          "UPDATE agent_contracts SET layout = ?1, updated_at = datetime('now') WHERE id = ?2"
        ).bind(JSON.stringify(layout), contractId).run();
        return new Response(JSON.stringify({
          contractId,
          saved: true
        }), { headers: corsHeaders });
      }
      if (pathname === "/build-html-page" && request.method === "POST") {
        const body = await request.json();
        const { graphId, title, userId } = body;
        if (!graphId || !title || !userId) {
          return new Response(JSON.stringify({ error: "graphId, title, and userId required" }), {
            status: 400,
            headers: corsHeaders
          });
        }
        try {
          const result = await executeCreateHtmlFromTemplate({
            graphId,
            title,
            templateId: body.templateId || DEFAULT_TEMPLATE_ID,
            description: body.description || "",
            footerText: body.footerText || "",
            sections: body.sections || [],
            headerImage: body.headerImage || null
          }, env);
          return new Response(JSON.stringify(result), { headers: corsHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: corsHeaders
          });
        }
      }
      if (pathname === "/template-version" && request.method === "GET") {
        const templateId = url.searchParams.get("templateId");
        if (templateId) {
          return new Response(JSON.stringify({
            templateId,
            version: getTemplateVersion(templateId)
          }), { headers: corsHeaders });
        }
        return new Response(JSON.stringify({
          version: getTemplateVersion(DEFAULT_TEMPLATE_ID),
          templates: listTemplates()
        }), { headers: corsHeaders });
      }
      if (pathname === "/templates" && request.method === "GET") {
        return new Response(JSON.stringify({
          templates: listTemplates()
        }), { headers: corsHeaders });
      }
      if (pathname === "/upgrade-html-node" && request.method === "POST") {
        const body = await request.json();
        const { graphId, nodeId } = body;
        if (!graphId || !nodeId) {
          return new Response(JSON.stringify({ error: "graphId and nodeId required" }), {
            status: 400,
            headers: corsHeaders
          });
        }
        try {
          const getRes = await env.KG_WORKER.fetch(
            `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(graphId)}`
          );
          if (!getRes.ok) throw new Error(`Graph not found (${graphId}, status ${getRes.status})`);
          const graphData = await getRes.json();
          if (!graphData.nodes || !Array.isArray(graphData.nodes)) {
            throw new Error(`Invalid graph data: nodes missing or not array (keys: ${Object.keys(graphData).join(",")})`);
          }
          const nodeIndex = graphData.nodes.findIndex((n) => String(n.id) === String(nodeId));
          if (nodeIndex === -1) {
            const nodeIds = graphData.nodes.filter((n) => n.type === "html-node").map((n) => n.id);
            throw new Error(`Node ${nodeId} not found in graph ${graphId}. Html-nodes: [${nodeIds.join(", ")}]`);
          }
          const oldNode = graphData.nodes[nodeIndex];
          if (oldNode.type !== "html-node") throw new Error("Node is not an html-node");
          const oldHtml = oldNode.info || "";
          const titleMatch = oldHtml.match(/<title>([^<]*)<\/title>/);
          const descMatch = oldHtml.match(/<p\s+class="muted[^"]*"[^>]*>([^<]*)<\/p>/);
          const footerMatch = oldHtml.match(/footer-text[^>]*>([^<]*)</);
          const oldVersionMatch = oldHtml.match(/<meta\s+name="template-version"\s+content="([^"]+)"/);
          const title = titleMatch ? titleMatch[1] : oldNode.label || "Untitled";
          const description = descMatch ? descMatch[1] : "";
          const footerText = footerMatch ? footerMatch[1] : "";
          const oldVersion = oldVersionMatch ? oldVersionMatch[1] : "none";
          const templateId = extractTemplateId(oldHtml);
          const entry = getTemplate(templateId);
          const headerImgMatch = oldHtml.match(/class="header-image"[^>]*style="[^"]*url\('([^']+)'\)/);
          const headerImage = headerImgMatch ? headerImgMatch[1] : null;
          const themeStyleMatch = oldHtml.match(/<style data-vegvisr-theme="[^"]*">[^<]*<\/style>/);
          const savedThemeStyle = themeStyleMatch ? themeStyleMatch[0] : null;
          let newHtml = entry.template;
          newHtml = newHtml.replaceAll("{{TITLE}}", title);
          newHtml = newHtml.replaceAll("{{DESCRIPTION}}", description);
          newHtml = newHtml.replaceAll("{{FOOTER_TEXT}}", footerText);
          newHtml = newHtml.replaceAll("{{GRAPH_ID_DEFAULT}}", graphId);
          newHtml = newHtml.replaceAll("{{NODE_ID}}", nodeId);
          if (savedThemeStyle) {
            newHtml = newHtml.replace("</head>", savedThemeStyle + "\n</head>");
          }
          if (headerImage) {
            newHtml = newHtml.replace(
              /class="header-image"[^>]*>/,
              `class="header-image" style="background-image:url('${headerImage}');background-size:cover;background-position:center;height:200px;">`
            );
          }
          const newVersion = getTemplateVersion(templateId);
          const saveRes = await env.KG_WORKER.fetch("https://knowledge-graph-worker/patchNode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              graphId,
              nodeId,
              fields: { info: newHtml }
            })
          });
          if (!saveRes.ok) {
            const errData = await saveRes.text();
            throw new Error("Failed to save upgraded graph: " + errData);
          }
          return new Response(JSON.stringify({
            success: true,
            nodeId,
            templateId,
            oldVersion,
            newVersion,
            title,
            htmlSize: newHtml.length,
            message: `Upgraded ${templateId} from v${oldVersion} to v${newVersion}`
          }), { headers: corsHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: corsHeaders
          });
        }
      }
      if (pathname === "/tools" && request.method === "GET") {
        let openAPITools = [];
        try {
          const loaded = await loadOpenAPITools(env);
          openAPITools = loaded.tools;
        } catch (err) {
        }
        const hardcodedNames = new Set(TOOL_DEFINITIONS.map((t) => t.name));
        const dynamicTools = openAPITools.filter((t) => !hardcodedNames.has(t.name));
        return new Response(JSON.stringify({
          hardcoded: TOOL_DEFINITIONS.map((t) => ({ name: t.name, description: t.description })),
          dynamic: dynamicTools.map((t) => ({ name: t.name, description: t.description })),
          total: TOOL_DEFINITIONS.length + dynamicTools.length + 1
          // +1 for web_search
        }), { headers: corsHeaders });
      }
      if (pathname === "/agents" && request.method === "GET") {
        const { results } = await env.DB.prepare(
          `SELECT id, name, description, avatar_url, model, tools, is_active
           FROM agent_configs WHERE is_active = 1 ORDER BY name`
        ).all();
        return new Response(JSON.stringify({ agents: results || [] }), { headers: corsHeaders });
      }
      if (pathname === "/agents" && request.method === "POST") {
        const body = await request.json();
        const { name, description, system_prompt, model, max_tokens, temperature, tools, metadata, avatar_url } = body;
        if (!name) {
          return new Response(JSON.stringify({ error: "name is required" }), { status: 400, headers: corsHeaders });
        }
        const id = `agent_${crypto.randomUUID().slice(0, 8)}`;
        await env.DB.prepare(
          `INSERT INTO agent_configs (id, name, description, system_prompt, model, max_tokens, temperature, tools, metadata, is_active, avatar_url)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10)`
        ).bind(
          id,
          name,
          description || "",
          system_prompt || "",
          model || "claude-haiku-4-5-20251001",
          max_tokens || 4096,
          temperature ?? 0.3,
          JSON.stringify(tools || []),
          JSON.stringify(metadata || {}),
          avatar_url || null
        ).run();
        return new Response(JSON.stringify({ id, name, created: true }), { status: 201, headers: corsHeaders });
      }
      if (pathname === "/agent" && request.method === "GET") {
        const agentId = url.searchParams.get("id");
        if (!agentId) {
          return new Response(JSON.stringify({ error: "id query param required" }), { status: 400, headers: corsHeaders });
        }
        const agent = await env.DB.prepare(
          "SELECT * FROM agent_configs WHERE id = ?1"
        ).bind(agentId).first();
        if (!agent) {
          return new Response(JSON.stringify({ error: "Agent not found" }), { status: 404, headers: corsHeaders });
        }
        return new Response(JSON.stringify({ agent }), { headers: corsHeaders });
      }
      if (pathname === "/agent" && request.method === "PUT") {
        const body = await request.json();
        const { id: agentId } = body;
        if (!agentId) {
          return new Response(JSON.stringify({ error: "id is required" }), { status: 400, headers: corsHeaders });
        }
        const allowedFields = ["name", "description", "system_prompt", "model", "max_tokens", "temperature", "avatar_url", "is_active"];
        const sets = [];
        const values = [];
        for (const key of allowedFields) {
          if (body[key] !== void 0) {
            sets.push(`${key} = ?`);
            values.push(body[key]);
          }
        }
        if (body.tools !== void 0) {
          sets.push("tools = ?");
          values.push(JSON.stringify(body.tools));
        }
        if (body.metadata !== void 0) {
          sets.push("metadata = ?");
          values.push(JSON.stringify(body.metadata));
        }
        if (sets.length === 0) {
          return new Response(JSON.stringify({ error: "No fields to update" }), { status: 400, headers: corsHeaders });
        }
        values.push(agentId);
        await env.DB.prepare(
          `UPDATE agent_configs SET ${sets.join(", ")} WHERE id = ?`
        ).bind(...values).run();
        return new Response(JSON.stringify({ id: agentId, updated: true }), { headers: corsHeaders });
      }
      if (pathname === "/agent" && request.method === "DELETE") {
        const body = await request.json();
        const { id: agentId } = body;
        if (!agentId) {
          return new Response(JSON.stringify({ error: "id is required" }), { status: 400, headers: corsHeaders });
        }
        await env.DB.prepare(
          "UPDATE agent_configs SET is_active = 0 WHERE id = ?1"
        ).bind(agentId).run();
        return new Response(JSON.stringify({ id: agentId, deleted: true }), { headers: corsHeaders });
      }
      if (pathname === "/chat-groups" && request.method === "GET") {
        const res = await env.DRIZZLE_WORKER.fetch("https://drizzle-worker/chat-groups");
        const data = await res.text();
        return new Response(data, { status: res.status, headers: corsHeaders });
      }
      if (pathname === "/agent-bot-groups" && request.method === "GET") {
        const agentId = url.searchParams.get("agentId");
        if (!agentId) return new Response(JSON.stringify({ error: "agentId required" }), { status: 400, headers: corsHeaders });
        const res = await env.DRIZZLE_WORKER.fetch(`https://drizzle-worker/agent-bot-groups?agentId=${encodeURIComponent(agentId)}`);
        const data = await res.text();
        return new Response(data, { status: res.status, headers: corsHeaders });
      }
      if (pathname === "/register-agent-bot" && request.method === "POST") {
        const body = await request.json();
        const res = await env.DRIZZLE_WORKER.fetch("https://drizzle-worker/register-chat-bot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        const data = await res.text();
        return new Response(data, { status: res.status, headers: corsHeaders });
      }
      if (pathname === "/unregister-agent-bot" && request.method === "POST") {
        const body = await request.json();
        const res = await env.DRIZZLE_WORKER.fetch("https://drizzle-worker/unregister-chat-bot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        const data = await res.text();
        return new Response(data, { status: res.status, headers: corsHeaders });
      }
      if (pathname === "/health" && request.method === "GET") {
        return new Response(JSON.stringify({
          status: "healthy",
          worker: "agent-worker",
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        }), { headers: corsHeaders });
      }
      return new Response(JSON.stringify({
        error: "Not found",
        available_endpoints: ["/execute", "/chat", "/agents", "/agent", "/layout", "/build-html-page", "/template-version", "/templates", "/tools", "/upgrade-html-node", "/health"]
      }), { status: 404, headers: corsHeaders });
    } catch (error) {
      return new Response(JSON.stringify({
        error: error.message,
        stack: error.stack
      }), { status: 500, headers: corsHeaders });
    }
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
