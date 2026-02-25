var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// editable-template.js
var EDITABLE_HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <meta name="template-version" content="1.0.0" />
  <title>{{TITLE}}</title>

  <!-- Marked for Markdown rendering -->
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>

  <style>
/* Page background */
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Apple Color Emoji", "Segoe UI Emoji";
      color: #fff;
      background:
        radial-gradient(circle at top, rgba(56,189,248,0.20), transparent 55%),
        radial-gradient(circle at bottom, rgba(139,92,246,0.18), transparent 55%),
        #0b1220;
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
    .card { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); }
    .muted { color: rgba(255,255,255,0.72); }
    .soft  { color: rgba(255,255,255,0.58); }
    .btn { border:1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.06); color: #fff; cursor: pointer; }
    .btn:hover { background: rgba(255,255,255,0.10); }
    .btnPrimary { border-color: rgba(56,189,248,0.40); background: rgba(56,189,248,0.16); }
    .btnPrimary:hover { background: rgba(56,189,248,0.24); }
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
      border:1px solid rgba(255,255,255,0.14);
      background: rgba(255,255,255,0.05);
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
    .pill:hover { background: rgba(255,255,255,0.08); }
    .pillActive { border-color: rgba(56,189,248,0.55); background: rgba(56,189,248,0.12); }

    code { color: rgba(125, 211, 252, 0.95); }
    pre { margin: 0; }

    /* Debug / JSON panel */
    .debugPanel {
      margin-top: 16px;
      padding: 16px;
      border-radius: 16px;
      background: rgba(0,0,0,0.30);
      border: 1px solid rgba(255,255,255,0.10);
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
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.10);
    }
    .previewPanel h1, .previewPanel h2, .previewPanel h3 { margin: 0.6em 0 0.4em; }
    .previewPanel p { margin: 0.6em 0; line-height: 1.55; color: rgba(255,255,255,0.82); }
    .previewPanel a { color: rgba(125, 211, 252, 0.95); }
    .previewPanel hr { border: none; border-top: 1px solid rgba(255,255,255,0.12); margin: 14px 0; }
    .previewPanel img { max-width: 100%; border-radius: 12px; border: 1px solid rgba(255,255,255,0.10); }
    .previewPanel blockquote {
      border-left: 4px solid rgba(255,255,255,0.25);
      padding-left: 12px;
      margin: 12px 0;
      color: rgba(255,255,255,0.78);
    }
    .previewPanel table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0;
      overflow: hidden;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.10);
    }
    .previewPanel th, .previewPanel td {
      padding: 10px 12px;
      border-bottom: 1px solid rgba(255,255,255,0.10);
      vertical-align: top;
    }
    .previewPanel th { background: rgba(255,255,255,0.06); text-align: left; }
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
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.16);
      border-radius: 1px;
      cursor: pointer;
      z-index: 999;
      display: none; /* Hidden by default */
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }

    .hamburger-button:hover {
      background: rgba(255,255,255,0.10);
    }

    .hamburger-button.active {
      background: rgba(56,189,248,0.16);
      border-color: rgba(56,189,248,0.40);
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
      background: rgba(255,255,255,0.85);
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
      background: rgba(11, 18, 32, 0.98);
      border-right: 1px solid rgba(255,255,255,0.12);
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
  color: blue !important;
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
        'navigation': 'Navigation Bar'
      };
      return labels[elementId] || elementId.charAt(0).toUpperCase() + elementId.slice(1);
    }

    /**
     * Apply visibility settings to DOM elements
     */
    function applyVisibilitySettings() {
      Object.entries(visibilitySettings).forEach(([elementId, isVisible]) => {
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
  <\/script>
</body>
</html>
`;

// index.js
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
    body: JSON.stringify({
      id: input.graphId,
      graphData
    })
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
        visible: true
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
    version: data.newVersion,
    message: `HTML node "${input.label}" added successfully`
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
    body: JSON.stringify({
      id: input.graphId,
      graphData,
      override: true
    })
  });
  const saveData = await saveRes.json();
  if (!saveRes.ok) {
    throw new Error(saveData.error || `Failed to save edge (status: ${saveRes.status})`);
  }
  return {
    graphId: input.graphId,
    edgeId,
    version: saveData.newVersion,
    message: `Edge ${input.sourceId} \u2192 ${input.targetId} added`
  };
}
__name(executeAddEdge, "executeAddEdge");
async function executeGetHtmlTemplate(input, env) {
  let contractInfo = null;
  if (input.contractId) {
    const row = await env.DB.prepare(
      "SELECT contract_json FROM agent_contracts WHERE id = ?1"
    ).bind(input.contractId).first();
    if (row) {
      contractInfo = JSON.parse(row.contract_json);
    }
  }
  return {
    templateSize: EDITABLE_HTML_TEMPLATE.length,
    placeholders: {
      "{{TITLE}}": "Page title (in <title>, h1, and img alt)",
      "{{DESCRIPTION}}": "Page description/subtitle shown below the title",
      "{{HEADER_IMAGE}}": "URL for the header image",
      "{{FOOTER_TEXT}}": "Footer text content",
      "{{GRAPH_ID_DEFAULT}}": "Fallback graph ID ({{GRAPH_ID}} is replaced at publish time)"
    },
    instructions: "Use create_html_from_template to create the HTML node. Pass the placeholder values and the worker fills them into the template server-side. CSS must be created as a SEPARATE css-node.",
    contractInfo
  };
}
__name(executeGetHtmlTemplate, "executeGetHtmlTemplate");
async function executeCreateHtmlFromTemplate(input, env) {
  let html = EDITABLE_HTML_TEMPLATE;
  html = html.replaceAll("{{TITLE}}", input.title || "Untitled");
  html = html.replaceAll("{{DESCRIPTION}}", input.description || "");
  html = html.replaceAll("{{FOOTER_TEXT}}", input.footerText || "");
  html = html.replaceAll("{{GRAPH_ID_DEFAULT}}", input.graphId || "");
  const nodeId = input.nodeId || `html-node-${Date.now()}`;
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
        visible: true
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
    version: data.newVersion,
    htmlSize: html.length,
    sectionsCreated: createdSections.length,
    headerImageNodeId,
    message: `Editable HTML page "${input.title}" created (${html.length} bytes) with ${createdSections.length} content sections${headerImageNodeId ? " and a header image node" : ""}. The page discovers nodes with # prefix labels.`,
    viewUrl: `https://www.vegvisr.org/gnew-viewer?graphId=${input.graphId}`
  };
}
__name(executeCreateHtmlFromTemplate, "executeCreateHtmlFromTemplate");
async function executeTool(toolName, toolInput, env) {
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
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
__name(executeTool, "executeTool");
var TOOL_DEFINITIONS = [
  {
    name: "create_graph",
    description: "Create a new knowledge graph with metadata. Returns the graph ID and initial version.",
    input_schema: {
      type: "object",
      properties: {
        graphId: {
          type: "string",
          description: "UUID for the graph. Use the exact graphId provided in the task context."
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
    description: "Add any type of node to a knowledge graph. Use this for fulltext (markdown), image, link, video, audio, or css-node types. For html-node pages, use create_html_from_template instead. The graph must already exist (use create_graph first).",
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
          enum: ["fulltext", "image", "link", "video", "audio", "css-node", "html-node", "agent-contract", "agent-config", "agent-run"],
          description: "Node type. fulltext=markdown, image=image URL, link=external URL, video=video embed, audio=audio file, css-node=CSS theme, agent-contract=contract JSON, agent-config=config JSON, agent-run=execution log JSON"
        },
        content: {
          type: "string",
          description: "Node content. For fulltext: markdown text. For link/video: URL. For css-node: CSS text. For image: alt text/caption."
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
    description: "Create an editable HTML page from the base template with content sections. The worker creates the html-node (with CSS, login, edit mode, navigation) AND fulltext content nodes for each section. The page discovers and displays nodes whose label starts with #. No separate css-node needed.",
    input_schema: {
      type: "object",
      properties: {
        graphId: {
          type: "string",
          description: "UUID for the graph. Use the exact graphId from the task context."
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
  }
];
var WEB_SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search",
  max_uses: 5
};
async function executeAgent(agentConfig, userTask, userId, env) {
  let taskWithContract = userTask;
  if (agentConfig.default_contract_id) {
    taskWithContract = `${userTask}

[Default contract: ${agentConfig.default_contract_id}]`;
  }
  const messages = [
    {
      role: "user",
      content: taskWithContract
    }
  ];
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
        tools: [...TOOL_DEFINITIONS, WEB_SEARCH_TOOL]
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
      const graphTools = toolUses.filter((t) => t.name === "create_graph");
      const otherTools = toolUses.filter((t) => t.name !== "create_graph");
      const phase1Results = await Promise.all(graphTools.map(async (toolUse) => {
        try {
          const result = await executeTool(toolUse.name, { ...toolUse.input, userId }, env);
          executionLog.push({ turn, type: "tool_result", tool: toolUse.name, success: true, result, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
          return { type: "tool_result", tool_use_id: toolUse.id, content: JSON.stringify(result) };
        } catch (error) {
          executionLog.push({ turn, type: "tool_error", tool: toolUse.name, error: error.message, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
          return { type: "tool_result", tool_use_id: toolUse.id, content: JSON.stringify({ error: error.message }) };
        }
      }));
      const phase2Results = await Promise.all(otherTools.map(async (toolUse) => {
        try {
          const result = await executeTool(toolUse.name, { ...toolUse.input, userId }, env);
          executionLog.push({ turn, type: "tool_result", tool: toolUse.name, success: true, result, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
          return { type: "tool_result", tool_use_id: toolUse.id, content: JSON.stringify(result) };
        } catch (error) {
          executionLog.push({ turn, type: "tool_error", tool: toolUse.name, error: error.message, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
          return { type: "tool_result", tool_use_id: toolUse.id, content: JSON.stringify({ error: error.message }) };
        }
      }));
      const toolResults = [...phase1Results, ...phase2Results];
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
var index_default = {
  async fetch(request, env) {
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
      if (pathname === "/execute" && request.method === "POST") {
        const body = await request.json();
        const { agentId, task, userId, contractId, graphId } = body;
        if (!agentId || !task || !userId) {
          return new Response(JSON.stringify({
            error: "agentId, task, and userId are required"
          }), {
            status: 400,
            headers: corsHeaders
          });
        }
        const agentConfig = await env.DB.prepare(`
          SELECT * FROM agent_configs WHERE id = ?1 AND is_active = 1
        `).bind(agentId).first();
        if (!agentConfig) {
          return new Response(JSON.stringify({
            error: "Agent not found or inactive"
          }), {
            status: 404,
            headers: corsHeaders
          });
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
        return new Response(JSON.stringify(result), {
          headers: corsHeaders
        });
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
            description: body.description || "",
            footerText: body.footerText || "",
            sections: [],
            headerImage: null
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
        const versionMatch = EDITABLE_HTML_TEMPLATE.match(/<meta\s+name="template-version"\s+content="([^"]+)"/);
        return new Response(JSON.stringify({
          version: versionMatch ? versionMatch[1] : "unknown"
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
          if (!getRes.ok) throw new Error("Graph not found");
          const graphData = await getRes.json();
          const nodeIndex = graphData.nodes.findIndex((n) => String(n.id) === String(nodeId));
          if (nodeIndex === -1) throw new Error("Node not found");
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
          let newHtml = EDITABLE_HTML_TEMPLATE;
          newHtml = newHtml.replaceAll("{{TITLE}}", title);
          newHtml = newHtml.replaceAll("{{DESCRIPTION}}", description);
          newHtml = newHtml.replaceAll("{{FOOTER_TEXT}}", footerText);
          newHtml = newHtml.replaceAll("{{GRAPH_ID_DEFAULT}}", graphId);
          const newVersionMatch = newHtml.match(/<meta\s+name="template-version"\s+content="([^"]+)"/);
          const newVersion = newVersionMatch ? newVersionMatch[1] : "unknown";
          graphData.nodes[nodeIndex] = {
            ...oldNode,
            info: newHtml,
            updatedAt: (/* @__PURE__ */ new Date()).toISOString()
          };
          const saveRes = await env.KG_WORKER.fetch("https://knowledge-graph-worker/saveGraphWithHistory", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              graphId,
              nodes: graphData.nodes,
              edges: graphData.edges || [],
              metadata: graphData.metadata || {}
            })
          });
          if (!saveRes.ok) throw new Error("Failed to save upgraded graph");
          return new Response(JSON.stringify({
            success: true,
            nodeId,
            oldVersion,
            newVersion,
            title,
            htmlSize: newHtml.length,
            message: `Upgraded from v${oldVersion} to v${newVersion}`
          }), { headers: corsHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: corsHeaders
          });
        }
      }
      if (pathname === "/health" && request.method === "GET") {
        return new Response(JSON.stringify({
          status: "healthy",
          worker: "agent-worker",
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        }), {
          headers: corsHeaders
        });
      }
      return new Response(JSON.stringify({
        error: "Not found",
        available_endpoints: ["/execute", "/layout", "/build-html-page", "/template-version", "/upgrade-html-node", "/health"]
      }), {
        status: 404,
        headers: corsHeaders
      });
    } catch (error) {
      return new Response(JSON.stringify({
        error: error.message,
        stack: error.stack
      }), {
        status: 500,
        headers: corsHeaders
      });
    }
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
