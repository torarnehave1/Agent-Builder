// agent-chat — component (SSOT), served from the Component Registry graph
// node's metadata.impl at api.vegvisr.org/components/agent-chat.js.
//
// A chat with the Vegvisr agent, embedded on a published page, where the SIGNED-IN
// USER decides what the agent knows. The Knowledge panel lists every knowledge graph
// in this page's scope (a metaArea tag) with a checkbox, plus one switch for whether
// the agent may search the internet at all.
//
// THE SWITCHES ARE REAL, AND THEY ARE ENFORCED ON THE SERVER. The browser sends only
// the scope NAME with each message. agent-worker reads the user's saved selection from
// D1 itself and builds the toolbox from it — so nothing here can widen what the agent
// reaches, and with web search off the internet tools are never sent to the model at
// all. Editing this component, or the request it makes, cannot change that.
//
// Requires a signed-in user: this page must already load vegvisr-auth.js (every page
// published with a login gate does). Identity comes from window.vegvisrWhoAmI() and
// the durable token in localStorage['vegvisr_user'] — the same value the API accepts
// as X-API-Token. Signed out, the component says so and does nothing else.
//
// Self-mounting: drop a marker anywhere and this script (loaded with
// <script src=".../components/agent-chat.js" defer>) injects its CSS and builds itself.
//
// Usage:
//   <div data-vegvisr-agent-chat="IIBA"      (REQUIRED — the metaArea tag that is this
//                                             chat's knowledge scope; '#' optional)
//        data-title="Ask the IIBA agent"     (optional — heading above the chat)
//        data-intro=""                       (optional — one line under the heading)
//        data-placeholder=""                 (optional — input placeholder)
//        data-height="420"                   (optional — px, thread height, default 420)
//        data-lang="no"                      (optional — "no" | "en", default no)
//        data-endpoint="https://agent.vegvisr.org">  (optional — agent API base)
//   </div>
//
// THEMING: every colour is a var() with a fallback, reading the host page's own tokens
// (--card, --ink, --muted, --line, --accent) where they exist, so the chat looks like
// the page it sits on instead of importing a second design.
(function () {
  'use strict'

  var API_DEFAULT = 'https://agent.vegvisr.org'
  var STORE_KEY = 'vegvisr_user' // written by vegvisr-auth.js — {email, role, token}
  var CSS_ID = 'vegvisr-agent-chat-css'
  // vegvisr-auth writes its identity store ASYNCHRONOUSLY: bootOnce() runs on DOMContentLoaded
  // and only writes {email, role, token} after verifyMagic + a role lookup have resolved. This
  // component mounts on the same event, so a single synchronous read finds nothing and would
  // say "sign in" on a page that is, a moment later, signed in — observed on testiiba.vegr.ai
  // (2026-09-29) with the auth bar showing the user's own address. vegvisr-auth announces the
  // change on the window; this component listens and re-mounts.
  var AUTH_CHANGED = 'vegvisr-auth-changed'
  var MAX_TURNS_NOTE = 12

  function log () {
    var a = Array.prototype.slice.call(arguments)
    a.unshift('[agent-chat]')
    console.log.apply(console, a)
  }
  function warn () {
    var a = Array.prototype.slice.call(arguments)
    a.unshift('[agent-chat]')
    console.warn.apply(console, a)
  }
  function fail () {
    var a = Array.prototype.slice.call(arguments)
    a.unshift('[agent-chat]')
    console.error.apply(console, a)
  }

  // ---------- text ----------

  var TEXT = {
    no: {
      heading: 'Spør agenten',
      knowledge: 'Kunnskap',
      panelLead: 'Du bestemmer hva agenten kan lese. Endringene lagres på din bruker og gjelder med én gang.',
      graphsHead: 'Kunnskapsgrafer',
      webLabel: 'Søk på internett',
      webHelpOff: 'Av: agenten har ingen verktøy som når utenfor grafene over.',
      webHelpOn: 'På: agenten kan søke på nettet og hente sider, og skal si hva som kom utenfra.',
      selectAll: 'Velg alle',
      selectNone: 'Fjern alle',
      saving: 'Lagrer …',
      saved: 'Lagret',
      saveFailed: 'Kunne ikke lagre',
      loading: 'Henter kunnskapen …',
      loadFailed: 'Kunne ikke hente kunnskapen',
      empty: 'Fant ingen grafer i dette området.',
      placeholder: 'Skriv spørsmålet ditt …',
      send: 'Send',
      sending: '…',
      signedOut: 'Logg inn for å bruke chatten.',
      noToken: 'Økten mangler et gyldig token — logg ut og inn igjen.',
      statusOn: 'internett på',
      statusOff: 'internett av',
      ofGraphs: 'av',
      graphs: 'grafer',
      usingDefault: 'standard: alle',
      thinking: 'Tenker …',
      errorPrefix: 'Feil',
      nodes: 'noder',
      emptyHint: 'Still et spørsmål. Trykk «Kunnskap» for å se og endre hva jeg kan lese.',
      draft: 'utkast',
      draftNote: 'Merket «utkast» er ikke publisert — de er synlige her fordi du er logget inn, og står derfor ikke i porteføljen lenger nede på siden.',
    },
    en: {
      heading: 'Ask the agent',
      knowledge: 'Knowledge',
      panelLead: 'You decide what the agent may read. Changes are saved to your account and take effect immediately.',
      graphsHead: 'Knowledge graphs',
      webLabel: 'Search the web',
      webHelpOff: 'Off: the agent has no tool that reaches outside the graphs above.',
      webHelpOn: 'On: the agent may search the web and fetch pages, and must say what came from outside.',
      selectAll: 'Select all',
      selectNone: 'Clear all',
      saving: 'Saving …',
      saved: 'Saved',
      saveFailed: 'Could not save',
      loading: 'Loading knowledge …',
      loadFailed: 'Could not load the knowledge',
      empty: 'No graphs found in this area.',
      placeholder: 'Type your question …',
      send: 'Send',
      sending: '…',
      signedOut: 'Sign in to use the chat.',
      noToken: 'This session has no verifiable token — sign out and in again.',
      statusOn: 'web on',
      statusOff: 'web off',
      ofGraphs: 'of',
      graphs: 'graphs',
      usingDefault: 'default: all',
      thinking: 'Thinking …',
      errorPrefix: 'Error',
      nodes: 'nodes',
      emptyHint: 'Ask a question. Press "Knowledge" to see and change what I can read.',
      draft: 'draft',
      draftNote: 'The ones marked "draft" are not published — you see them here because you are signed in, which is why they are absent from the portfolio further down the page.',
    },
  }

  function esc (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  // Small markdown renderer — the agent answers in markdown. Escapes FIRST, then adds
  // the handful of tags worth having. Deliberately not a full parser: anything it does
  // not know stays visible as plain text rather than disappearing.
  function md (src) {
    var code = []
    var out = esc(src)
    // Fenced code comes out first, behind a placeholder, so the line-break pass below
    // cannot turn its newlines into <br> inside a <pre>.
    out = out.replace(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/g, function (m, body) {
      code.push(body.replace(/\n+$/, ''))
      return '@@VACCODE' + (code.length - 1) + '@@'
    })
    out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>')
    out = out.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    out = out.replace(/^#{1,6}\s+(.+)$/gm, '<h3>$1</h3>')
    out = out.replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>')
    // A run of consecutive <li> lines becomes one list; the newlines inside it go, so
    // the break pass below cannot put a <br> between two list items.
    out = out.replace(/(?:<li>[^\n]*<\/li>\n?)+/g, function (run) {
      return '<ul>' + run.replace(/\n/g, '') + '</ul>\n'
    })
    out = out.replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>')
    out = out.replace(/@@VACCODE(\d+)@@/g, function (m, i) {
      return code[i] === undefined ? m : '<pre><code>' + code[i] + '</code></pre>'
    })
    // Block tags bring their own spacing — a <br> touching one just doubles the gap.
    out = out.replace(/(?:<br>\s*)+(<(?:ul|h3|pre)\b)/g, '$1')
    out = out.replace(/(<\/(?:ul|h3|pre)>)(?:\s*<br>)+/g, '$1')
    return out
  }

  // ---------- identity ----------

  // vegvisr-auth.js owns this record. Reading it directly (rather than only
  // vegvisrWhoAmI(), which returns no token) is how every gated page's components get
  // the X-API-Token they need.
  function readIdentity () {
    try {
      var raw = localStorage.getItem(STORE_KEY)
      if (raw) {
        var u = JSON.parse(raw)
        if (u && u.email) return { email: u.email, role: u.role || null, token: u.token || null }
      }
    } catch (e) { warn('could not read', STORE_KEY, e && e.message) }
    if (window.__VEGVISR_USER && window.__VEGVISR_USER.email) {
      return { email: window.__VEGVISR_USER.email, role: window.__VEGVISR_USER.role || null, token: null }
    }
    return null
  }

  // What a mount was built for. A remount wipes the thread, so it must happen on a real
  // sign-in/sign-out, not on every announcement.
  function identityKey (me) { return me ? me.email + '|' + (me.token ? 'T' : '-') : '' }

  // ---------- CSS ----------

  function injectCss () {
    if (document.getElementById(CSS_ID)) return
    var s = document.createElement('style')
    s.id = CSS_ID
    s.textContent = [
      '.vac{--vac-ink:var(--ink,var(--text,#1c1917));--vac-muted:var(--muted,#6b655b);--vac-line:var(--line,#e4ddd0);',
      '--vac-card:var(--card,var(--surface,#fffdf8));--vac-accent:var(--accent,#8a4b2a);',
      'font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--vac-ink);',
      'border:1px solid var(--vac-line);border-radius:16px;background:var(--vac-card);overflow:hidden;margin:24px 0}',
      '.vac *{box-sizing:border-box}',
      '.vac-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 18px;border-bottom:1px solid var(--vac-line)}',
      '.vac-title{font-weight:600;font-size:16px;flex:1 1 auto;min-width:0}',
      '.vac-intro{flex:1 1 100%;margin:0;font-size:13px;color:var(--vac-muted)}',
      '.vac-kbtn{flex:0 0 auto;font:inherit;font-size:13px;cursor:pointer;padding:6px 12px;border-radius:999px;',
      'border:1px solid var(--vac-line);background:transparent;color:var(--vac-ink)}',
      '.vac-kbtn:hover{border-color:var(--vac-accent);color:var(--vac-accent)}',
      '.vac-kbtn[aria-expanded="true"]{background:var(--vac-accent);border-color:var(--vac-accent);color:#fff}',
      '.vac-panel{padding:16px 18px;border-bottom:1px solid var(--vac-line);background:rgba(127,127,127,.06)}',
      '.vac-panel[hidden]{display:none}',
      '.vac-panel-lead{margin:0 0 12px;font-size:13px;color:var(--vac-muted)}',
      '.vac-sub{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--vac-muted);margin:0 0 8px}',
      '.vac-bulk{display:flex;gap:8px;margin:0 0 10px}',
      '.vac-bulk button{font:inherit;font-size:12px;cursor:pointer;padding:3px 10px;border-radius:999px;',
      'border:1px solid var(--vac-line);background:transparent;color:var(--vac-muted)}',
      '.vac-bulk button:hover{color:var(--vac-accent);border-color:var(--vac-accent)}',
      '.vac-list{list-style:none;margin:0 0 14px;padding:0;max-height:260px;overflow-y:auto}',
      '.vac-list li{margin:0 0 2px}',
      '.vac-list label{display:flex;gap:10px;align-items:flex-start;padding:7px 8px;border-radius:8px;cursor:pointer}',
      '.vac-list label:hover{background:rgba(127,127,127,.1)}',
      '.vac-list input{margin:4px 0 0;flex:0 0 auto}',
      '.vac-gt{display:block;font-size:14px}',
      '.vac-gm{display:block;font-size:12px;color:var(--vac-muted)}',
      '.vac-draft{display:inline-block;margin-left:7px;padding:0 7px;border-radius:999px;font-size:11px;',
      'border:1px solid var(--vac-line);color:var(--vac-muted);vertical-align:1px}',
      '.vac-note{margin:0 0 10px;font-size:12px;color:var(--vac-muted)}',
      '.vac-note[hidden]{display:none}',
      '.vac-web{display:flex;gap:10px;align-items:flex-start;padding:10px 8px;border-top:1px solid var(--vac-line);cursor:pointer}',
      '.vac-web input{margin:4px 0 0;flex:0 0 auto}',
      '.vac-status{margin:10px 0 0;font-size:12px;color:var(--vac-muted);min-height:1.4em}',
      '.vac-status.err{color:#b91c1c}',
      '.vac-thread{padding:18px;overflow-y:auto;display:flex;flex-direction:column;gap:14px}',
      '.vac-msg{max-width:88%;padding:10px 14px;border-radius:14px;word-wrap:break-word;overflow-wrap:anywhere}',
      '.vac-msg.user{align-self:flex-end;background:var(--vac-accent);color:#fff}',
      '.vac-msg.user a{color:#fff;text-decoration:underline}',
      '.vac-msg.bot{align-self:flex-start;background:rgba(127,127,127,.1);border:1px solid var(--vac-line)}',
      '.vac-msg.bot a{color:var(--vac-accent)}',
      '.vac-msg.err{align-self:flex-start;background:rgba(185,28,28,.1);border:1px solid rgba(185,28,28,.3);color:#b91c1c}',
      '.vac-msg p:first-child{margin-top:0}.vac-msg p:last-child{margin-bottom:0}',
      '.vac-msg pre{background:rgba(0,0,0,.18);padding:10px;border-radius:8px;overflow-x:auto;font-size:13px}',
      '.vac-msg ul{margin:6px 0;padding-left:20px}',
      '.vac-tools{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}',
      '.vac-tool{font-size:11px;padding:2px 9px;border-radius:999px;border:1px solid var(--vac-line);color:var(--vac-muted)}',
      '.vac-tool.done{border-color:var(--vac-accent);color:var(--vac-accent)}',
      '.vac-empty{color:var(--vac-muted);font-size:14px;margin:auto;text-align:center;max-width:36em}',
      '.vac-form{display:flex;gap:10px;padding:14px 18px;border-top:1px solid var(--vac-line);align-items:flex-end}',
      '.vac-form textarea{flex:1 1 auto;resize:none;font:inherit;padding:10px 12px;border-radius:10px;',
      'border:1px solid var(--vac-line);background:transparent;color:var(--vac-ink);max-height:140px}',
      '.vac-form textarea:focus{outline:none;border-color:var(--vac-accent)}',
      '.vac-form button{flex:0 0 auto;font:inherit;font-weight:600;cursor:pointer;padding:10px 18px;border-radius:10px;',
      'border:0;background:var(--vac-accent);color:#fff}',
      '.vac-form button:disabled{opacity:.45;cursor:default}',
      '.vac-locked{padding:22px 18px;color:var(--vac-muted);font-size:14px}',
      '@media (max-width:600px){.vac-msg{max-width:96%}.vac-head{padding:12px 14px}.vac-thread{padding:14px}.vac-form{padding:12px 14px}}',
    ].join('')
    document.head.appendChild(s)
  }

  // ---------- one chat ----------

  function mount (el) {
    var scope = String(el.getAttribute('data-vegvisr-agent-chat') || '').trim().replace(/^#/, '')
    if (!scope) {
      fail('the marker has no scope — write <div data-vegvisr-agent-chat="IIBA"></div>. Nothing rendered.')
      return
    }
    var lang = String(el.getAttribute('data-lang') || 'no').toLowerCase().indexOf('en') === 0 ? 'en' : 'no'
    var t = TEXT[lang]
    var api = (el.getAttribute('data-endpoint') || API_DEFAULT).replace(/\/+$/, '')
    var height = parseInt(el.getAttribute('data-height') || '420', 10) || 420

    var me = readIdentity()
    el.__vacIdentity = identityKey(me)
    log('mounting scope="' + scope + '" lang=' + lang + ' api=' + api +
      ' user=' + (me ? me.email : 'signed out') + ' token=' + (me && me.token ? 'yes' : 'no'))

    el.classList.add('vac')
    el.innerHTML = ''

    // --- header ---
    var head = document.createElement('div')
    head.className = 'vac-head'
    var title = document.createElement('span')
    title.className = 'vac-title'
    title.textContent = el.getAttribute('data-title') || t.heading
    head.appendChild(title)
    var kbtn = document.createElement('button')
    kbtn.type = 'button'
    kbtn.className = 'vac-kbtn'
    kbtn.setAttribute('aria-expanded', 'false')
    kbtn.textContent = t.knowledge
    head.appendChild(kbtn)
    var intro = el.getAttribute('data-intro')
    if (intro) {
      var ip = document.createElement('p')
      ip.className = 'vac-intro'
      ip.textContent = intro
      head.appendChild(ip)
    }
    el.appendChild(head)

    // Signed out (or a session with no durable token): say so and stop. The page's own
    // login gate is what signs people in — this component never asks for credentials.
    if (!me || !me.token) {
      kbtn.disabled = true
      var locked = document.createElement('div')
      locked.className = 'vac-locked'
      locked.textContent = !me ? t.signedOut : t.noToken
      el.appendChild(locked)
      warn(!me ? 'no signed-in user — chat not rendered' : 'signed in as ' + me.email + ' but the session has no token — chat not rendered')
      return
    }

    // --- knowledge panel ---
    var panel = document.createElement('div')
    panel.className = 'vac-panel'
    panel.hidden = true
    panel.innerHTML =
      '<p class="vac-panel-lead">' + esc(t.panelLead) + '</p>' +
      '<p class="vac-sub">' + esc(t.graphsHead) + '</p>' +
      '<div class="vac-bulk"><button type="button" data-all>' + esc(t.selectAll) + '</button>' +
      '<button type="button" data-none>' + esc(t.selectNone) + '</button></div>' +
      '<p class="vac-note" data-draftnote hidden></p>' +
      '<ul class="vac-list"></ul>' +
      '<label class="vac-web"><input type="checkbox" data-web>' +
      '<span><span class="vac-gt">' + esc(t.webLabel) + '</span>' +
      '<span class="vac-gm" data-webhelp>' + esc(t.webHelpOff) + '</span></span></label>' +
      '<p class="vac-status"></p>'
    el.appendChild(panel)

    var list = panel.querySelector('.vac-list')
    var webBox = panel.querySelector('[data-web]')
    var status = panel.querySelector('.vac-status')
    var btnAll = panel.querySelector('[data-all]')
    var btnNone = panel.querySelector('[data-none]')
    var webHelp = panel.querySelector('[data-webhelp]')
    var draftNote = panel.querySelector('[data-draftnote]')

    // --- thread + input ---
    var thread = document.createElement('div')
    thread.className = 'vac-thread'
    thread.style.height = height + 'px'
    el.appendChild(thread)

    var form = document.createElement('form')
    form.className = 'vac-form'
    var input = document.createElement('textarea')
    input.rows = 1
    input.placeholder = el.getAttribute('data-placeholder') || t.placeholder
    var sendBtn = document.createElement('button')
    sendBtn.type = 'submit'
    sendBtn.textContent = t.send
    sendBtn.disabled = true
    form.appendChild(input)
    form.appendChild(sendBtn)
    el.appendChild(form)

    // --- state ---
    var knowledge = { universe: [], selected: [], webSearch: false, usingDefault: true }
    var messages = []
    var streaming = false
    var saveSeq = 0

    function headers () {
      return { 'Content-Type': 'application/json', 'X-API-Token': me.token }
    }

    function summaryLine () {
      return t.knowledge + ' · ' + knowledge.selected.length + ' ' + t.ofGraphs + ' ' +
        knowledge.universe.length + ' ' + t.graphs + ' · ' +
        (knowledge.webSearch ? t.statusOn : t.statusOff) +
        (knowledge.usingDefault ? ' · ' + t.usingDefault : '')
    }
    function paintSummary () {
      kbtn.textContent = summaryLine()
      webHelp.textContent = knowledge.webSearch ? t.webHelpOn : t.webHelpOff
    }

    function paintList () {
      list.innerHTML = ''
      if (!knowledge.universe.length) {
        var li = document.createElement('li')
        li.className = 'vac-gm'
        li.textContent = t.empty
        list.appendChild(li)
        return
      }
      var drafts = 0
      knowledge.universe.forEach(function (g) { if (g.published === false) drafts++ })
      draftNote.textContent = t.draftNote
      draftNote.hidden = drafts === 0
      knowledge.universe.forEach(function (g) {
        var li = document.createElement('li')
        var label = document.createElement('label')
        var box = document.createElement('input')
        box.type = 'checkbox'
        box.value = g.id
        box.checked = knowledge.selected.indexOf(g.id) !== -1
        box.addEventListener('change', function () {
          var i = knowledge.selected.indexOf(g.id)
          if (box.checked && i === -1) knowledge.selected.push(g.id)
          else if (!box.checked && i !== -1) knowledge.selected.splice(i, 1)
          save()
        })
        var txt = document.createElement('span')
        var bits = []
        if (g.nodeCount) bits.push(g.nodeCount + ' ' + t.nodes)
        if (g.updatedAt) bits.push(String(g.updatedAt).slice(0, 10))
        txt.innerHTML = '<span class="vac-gt">' + esc(g.title) +
          (g.published === false ? '<span class="vac-draft">' + esc(t.draft) + '</span>' : '') + '</span>' +
          (bits.length ? '<span class="vac-gm">' + esc(bits.join(' · ')) + '</span>' : '')
        label.appendChild(box)
        label.appendChild(txt)
        li.appendChild(label)
        list.appendChild(li)
      })
    }

    function setStatus (msg, isErr) {
      status.textContent = msg || ''
      status.className = 'vac-status' + (isErr ? ' err' : '')
    }

    function load () {
      setStatus(t.loading)
      return fetch(api + '/agent-knowledge?scope=' + encodeURIComponent(scope), { headers: headers() })
        .then(function (r) {
          return r.json().then(function (d) {
            if (!r.ok) throw new Error(d && d.error ? d.error : 'HTTP ' + r.status)
            return d
          })
        })
        .then(function (d) {
          knowledge.universe = d.universe || []
          knowledge.selected = d.selected || []
          knowledge.webSearch = d.webSearch === true
          knowledge.usingDefault = d.usingDefault === true
          webBox.checked = knowledge.webSearch
          paintList()
          paintSummary()
          setStatus('')
          log('knowledge loaded: ' + knowledge.selected.length + '/' + knowledge.universe.length +
            ' graphs, web=' + knowledge.webSearch + (knowledge.usingDefault ? ' (default, nothing saved yet)' : ''))
        })
        .catch(function (err) {
          fail('loading /agent-knowledge failed:', err)
          setStatus(t.loadFailed + ': ' + err.message, true)
        })
    }

    function save () {
      var seq = ++saveSeq
      paintSummary()
      setStatus(t.saving)
      fetch(api + '/agent-knowledge', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ scope: scope, graphs: knowledge.selected, webSearch: knowledge.webSearch }),
      })
        .then(function (r) {
          return r.json().then(function (d) {
            if (!r.ok) throw new Error(d && d.error ? d.error : 'HTTP ' + r.status)
            return d
          })
        })
        .then(function (d) {
          if (seq !== saveSeq) return // a newer change is already in flight
          // Trust the server's echo: it has already intersected with the scope.
          knowledge.selected = d.selected || []
          knowledge.webSearch = d.webSearch === true
          knowledge.usingDefault = false
          paintSummary()
          setStatus(t.saved)
          log('knowledge saved: ' + knowledge.selected.length + '/' + knowledge.universe.length +
            ' graphs, web=' + knowledge.webSearch)
        })
        .catch(function (err) {
          if (seq !== saveSeq) return
          fail('saving /agent-knowledge failed:', err)
          setStatus(t.saveFailed + ': ' + err.message, true)
        })
    }

    btnAll.addEventListener('click', function () {
      knowledge.selected = knowledge.universe.map(function (g) { return g.id })
      paintList(); save()
    })
    btnNone.addEventListener('click', function () {
      knowledge.selected = []
      paintList(); save()
    })
    webBox.addEventListener('change', function () {
      knowledge.webSearch = webBox.checked
      save()
    })
    kbtn.addEventListener('click', function () {
      var open = panel.hidden
      panel.hidden = !open
      kbtn.setAttribute('aria-expanded', open ? 'true' : 'false')
    })

    // --- thread ---

    function emptyState () {
      thread.innerHTML = ''
      var p = document.createElement('div')
      p.className = 'vac-empty'
      p.textContent = t.emptyHint
      thread.appendChild(p)
    }
    function clearEmpty () {
      var e = thread.querySelector('.vac-empty')
      if (e) e.remove()
    }
    function scrollDown () { thread.scrollTop = thread.scrollHeight }

    function addMsg (cls, text) {
      clearEmpty()
      var d = document.createElement('div')
      d.className = 'vac-msg ' + cls
      if (cls === 'user') d.textContent = text
      else d.innerHTML = md(text)
      thread.appendChild(d)
      scrollDown()
      return d
    }

    function send (text) {
      if (streaming || !text) return
      streaming = true
      sendBtn.disabled = true
      sendBtn.textContent = t.sending
      input.value = ''
      input.style.height = 'auto'

      messages.push({ role: 'user', content: text })
      addMsg('user', text)

      var bot = document.createElement('div')
      bot.className = 'vac-msg bot'
      var tools = document.createElement('div')
      tools.className = 'vac-tools'
      var body = document.createElement('div')
      body.textContent = t.thinking
      bot.appendChild(tools)
      bot.appendChild(body)
      thread.appendChild(bot)
      scrollDown()

      var answer = ''
      var pills = {}
      var sawTool = false

      function onEvent (name, data) {
        if (name === 'text') {
          answer += data.content || ''
          body.innerHTML = md(answer)
          scrollDown()
        } else if (name === 'tool_call') {
          sawTool = true
          var pill = document.createElement('span')
          pill.className = 'vac-tool'
          pill.textContent = data.tool
          tools.appendChild(pill)
          pills[data.tool] = pill
          log('tool_call:', data.tool, data.input || {})
          scrollDown()
        } else if (name === 'tool_result') {
          if (pills[data.tool]) pills[data.tool].className = 'vac-tool done'
          log('tool_result:', data.tool, data.success ? 'ok' : 'FAILED', data.summary || '')
        } else if (name === 'error') {
          fail('agent error:', data.error)
          body.innerHTML = ''
          bot.className = 'vac-msg err'
          body.textContent = t.errorPrefix + ': ' + (data.error || 'unknown')
        } else if (name === 'done') {
          log('done after', data.turns, 'turn(s); tools used:', sawTool)
        }
      }

      fetch(api + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: me.email,
          messages: messages,
          authToken: me.token,
          knowledgeScope: scope,
          maxTurns: MAX_TURNS_NOTE,
        }),
      })
        .then(function (res) {
          if (!res.ok) {
            return res.json().catch(function () { return {} }).then(function (d) {
              throw new Error(d.error || 'HTTP ' + res.status)
            })
          }
          var reader = res.body.getReader()
          var dec = new TextDecoder()
          var buf = ''
          var evt = ''
          function pump () {
            return reader.read().then(function (chunk) {
              if (chunk.done) return
              buf += dec.decode(chunk.value, { stream: true })
              var lines = buf.split('\n')
              buf = lines.pop()
              for (var i = 0; i < lines.length; i++) {
                var line = lines[i]
                if (line.indexOf('event: ') === 0) evt = line.slice(7).trim()
                else if (line.indexOf('data: ') === 0) {
                  try { onEvent(evt, JSON.parse(line.slice(6))) }
                  catch (e) { warn('could not parse SSE data:', line.slice(6), e && e.message) }
                }
              }
              return pump()
            })
          }
          return pump()
        })
        .then(function () {
          if (answer) messages.push({ role: 'assistant', content: answer })
          else if (bot.className.indexOf('err') === -1) {
            bot.className = 'vac-msg err'
            body.textContent = t.errorPrefix + ': empty response'
            fail('stream finished with no text')
          }
        })
        .catch(function (err) {
          fail('chat request failed:', err)
          bot.className = 'vac-msg err'
          tools.innerHTML = ''
          body.textContent = t.errorPrefix + ': ' + err.message
        })
        .then(function () {
          streaming = false
          sendBtn.textContent = t.send
          sendBtn.disabled = !input.value.trim()
          scrollDown()
        })
    }

    input.addEventListener('input', function () {
      sendBtn.disabled = streaming || !input.value.trim()
      input.style.height = 'auto'
      input.style.height = Math.min(input.scrollHeight, 140) + 'px'
    })
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value.trim()) }
    })
    form.addEventListener('submit', function (e) { e.preventDefault(); send(input.value.trim()) })

    emptyState()
    paintSummary()
    load()
  }

  function mountAll () {
    injectCss()
    var nodes = document.querySelectorAll('[data-vegvisr-agent-chat]')
    if (!nodes.length) {
      warn('loaded but found no [data-vegvisr-agent-chat] element to mount on.')
      return
    }
    log('mounting', nodes.length, 'chat(s)')
    Array.prototype.forEach.call(nodes, function (n) { mount(n) })

    if (!window.__vacAuthWatch) {
      window.__vacAuthWatch = true
      window.addEventListener(AUTH_CHANGED, remountChanged)
    }
    // Safety net for the case the event cannot cover: this script loaded so late that
    // vegvisr-auth had already announced. whoAmI() resolves a half-written store (an email
    // whose role is still pending); it cannot complete a magic-link return, which is what the
    // event is for.
    if (!readIdentity() && typeof window.vegvisrWhoAmI === 'function') {
      window.vegvisrWhoAmI().then(remountChanged).catch(function () {})
    }
  }

  function remountChanged () {
    var key = identityKey(readIdentity())
    var nodes = document.querySelectorAll('[data-vegvisr-agent-chat]')
    Array.prototype.forEach.call(nodes, function (n) {
      if (n.__vacIdentity === key) return
      log('identity changed (' + (n.__vacIdentity || 'none') + ' -> ' + (key || 'none') + ') — remounting')
      mount(n)
    })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll)
  else mountAll()
})();
