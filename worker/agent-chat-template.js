/**
 * Agent Chat Template for Vegvisr Agent Builder
 *
 * Full-screen conversational AI chat interface.
 * Connects to the agent-worker /chat endpoint via SSE for
 * real-time streaming responses with tool execution visibility.
 *
 * Placeholders:
 *   {{TITLE}}            - Chat title / page title
 *   {{GRAPH_ID_DEFAULT}} - Default graph context
 */

export const AGENT_CHAT_TEMPLATE = `<!DOCTYPE html>
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
