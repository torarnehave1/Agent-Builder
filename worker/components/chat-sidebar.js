// chat-sidebar — component (SSOT), served from the Component Registry graph
// node's metadata.impl at api.vegvisr.org/components/chat-sidebar.js.
//
// Puts a Vegvisr chat GROUP on any website as a side panel, left or right. A
// launcher button sits pinned to the chosen edge; clicking it slides the panel in
// over the page.
//
// Usage:
//   <div data-vegvisr-chat="<groupId>"    (REQUIRED — the group's id)
//        data-side="right"        (optional — "right" (default) or "left")
//        data-title="Fellesskapet" (optional — heading in the panel)
//        data-width="380"         (optional — panel width in px, default 380)
//        data-start="closed"      (optional — "closed" (default) or "open")
//        data-poll="6"            (optional — seconds between polls, 2-60, default 6)
//        data-launcher="💬"       (optional — launcher button label)
//        data-lang="no"           (optional — "no" (default) or "en")
//        data-chat-api="https://group-chat-worker.torarnehave.workers.dev"
//        data-identity-api="https://vegvisr-frontend.torarnehave.workers.dev">
//   </div>
//
// WHO CAN SEE IT: signed-in MEMBERS of the group, and nobody else. That is not a
// choice this component makes — group-chat-worker gates both reads and writes on
// ensureMember() and answers a non-member with 403, and there is no "public group"
// flag in its schema (verified 2026-09-13). A signed-in non-member gets a plain
// "you are not a member" panel; an anonymous visitor gets the sign-in bar.
//
// IDENTITY, AND THE ENDPOINT THIS DELIBERATELY DOES NOT USE. The chat API needs
// user_id + phone. The Vue app gets them from GET /userdata?email=<address>, which
// answers ANYONE with no authentication and hands back phone AND
// emailVerificationToken — the account's API credential. Spreading that call onto
// customer pages would spread the hole, so this component uses
// GET /userdata-from-token with `Authorization: Bearer <token>` instead: the token
// vegvisr-auth already holds in localStorage is exchanged server-side for
// user_id + phone. Verified 2026-09-13: a bogus token gets 401, a bogus identity
// gets "User not found" from the chat worker.
//
// The identity call goes to the workers.dev host because that is the ONLY host
// serving /userdata-from-token — dashboard.vegvisr.org and api.vegvisr.org both
// 404 it (verified 2026-09-13). Route it on a vegvisr.org domain and change
// data-identity-api.
//
// Polling, not sockets: group-chat-worker is REST with an `after` cursor, so the
// panel polls. It stops polling while the panel is closed or the tab is hidden —
// a background tab must not bill the account for a conversation nobody is reading.

(function () {
  'use strict'

  var CHAT_API = 'https://group-chat-worker.torarnehave.workers.dev'
  var IDENTITY_API = 'https://vegvisr-frontend.torarnehave.workers.dev'
  var AUTH_URL = 'https://api.vegvisr.org/components/vegvisr-auth.js'
  var STYLE_ID = 'vcs-style'
  var PAGE_SIZE = 40
  var DEFAULT_POLL = 6
  var Z = 2147482000 // below the portfolio dialog's 2147483000

  var TEXT = {
    no: {
      title: 'Chat',
      open: 'Åpne chat',
      close: 'Lukk chat',
      send: 'Send',
      placeholder: 'Skriv en melding …',
      loading: 'Laster …',
      signIn: 'Logg inn for å delta i samtalen.',
      notMember: 'Du er ikke medlem av denne gruppen.',
      notMemberHint: 'Be om en invitasjon fra den som eier gruppen.',
      empty: 'Ingen meldinger ennå. Skriv den første.',
      error: 'Får ikke kontakt med chatten akkurat nå.',
      sendFailed: 'Meldingen ble ikke sendt. Prøv igjen.',
      you: 'Du',
      bot: 'Bot',
      image: 'Bilde',
      video: 'Video',
      audio: 'Lydmelding',
      file: 'Vedlegg',
      noGroup: 'Chatten mangler en gruppe-id.',
    },
    en: {
      title: 'Chat',
      open: 'Open chat',
      close: 'Close chat',
      send: 'Send',
      placeholder: 'Write a message …',
      loading: 'Loading …',
      signIn: 'Sign in to join the conversation.',
      notMember: 'You are not a member of this group.',
      notMemberHint: 'Ask the group owner for an invitation.',
      empty: 'No messages yet. Write the first one.',
      error: 'Cannot reach the chat right now.',
      sendFailed: 'The message was not sent. Try again.',
      you: 'You',
      bot: 'Bot',
      image: 'Image',
      video: 'Video',
      audio: 'Voice message',
      file: 'Attachment',
      noGroup: 'The chat is missing a group id.',
    },
  }

  function log () {
    var a = [].slice.call(arguments)
    if (typeof a[0] === 'string') a[0] = '[chat-sidebar] ' + a[0]
    else a.unshift('[chat-sidebar]')
    console.log.apply(console, a)
  }

  // ---- pure helpers (unit-tested by worker/test-chat-sidebar.mjs) ----

  function parseSide (raw) {
    return String(raw || '').trim().toLowerCase() === 'left' ? 'left' : 'right'
  }

  // Seconds between polls. Below 2s this hammers a D1-backed worker; above 60s it
  // stops feeling like a chat. Anything unparseable falls back to the default
  // rather than producing setInterval(NaN), which fires continuously.
  function clampPoll (raw) {
    var n = parseFloat(raw)
    if (!isFinite(n) || n <= 0) return DEFAULT_POLL
    return Math.min(60, Math.max(2, n))
  }

  function clampWidth (raw) {
    var n = parseInt(raw, 10)
    if (!isFinite(n) || n <= 0) return 380
    return Math.min(720, Math.max(260, n))
  }

  // vegvisr-auth stores {email, role, token} under 'vegvisr_user', and older
  // builds left {user:{…emailVerificationToken}} under 'user'/'userStore'. Read
  // all three shapes so a visitor already signed in does not have to sign in again.
  function tokenFromStores (stores) {
    var raw = stores || {}
    var keys = ['vegvisr_user', 'user', 'userStore']
    for (var i = 0; i < keys.length; i++) {
      var text = raw[keys[i]]
      if (!text) continue
      try {
        var parsed = JSON.parse(text)
        var u = parsed && parsed.user ? parsed.user : parsed
        var token = (u && (u.token || u.emailVerificationToken)) || (parsed && parsed.token)
        if (token) return String(token)
      } catch (e) { /* a non-JSON value in one key must not hide a good one in the next */ }
    }
    return null
  }

  function sessionToken (root, stores) {
    if (root.hasAttribute('data-session-token')) return root.getAttribute('data-session-token') || null
    return tokenFromStores(stores)
  }

  function isBot (userId) {
    return String(userId || '').indexOf('bot:') === 0
  }

  function isMine (msg, meId) {
    return !!meId && String((msg && msg.user_id) || '') === String(meId)
  }

  // No display names exist anywhere in this API — group_messages and group_members
  // both carry user_id only (verified 2026-09-13) — so a stable short label is
  // derived from the id rather than inventing a name or printing a raw UUID.
  function shortLabel (userId, t) {
    var id = String(userId || '')
    if (!id) return '?'
    if (isBot(id)) return (t && t.bot) || 'Bot'
    // Three characters, not four: four overflowed the 30px avatar circle.
    var tail = id.replace(/^bot:/, '').replace(/-/g, '')
    return tail.slice(0, 3).toUpperCase()
  }

  function messageKind (msg) {
    var type = String((msg && msg.message_type) || 'text').toLowerCase()
    if (type === 'image' || type === 'video' || type === 'voice' || type === 'audio') {
      return type === 'audio' ? 'voice' : type
    }
    if (msg && msg.media_content_type) {
      var ct = String(msg.media_content_type)
      if (ct.indexOf('image/') === 0) return 'image'
      if (ct.indexOf('video/') === 0) return 'video'
      if (ct.indexOf('audio/') === 0) return 'voice'
    }
    if (msg && msg.audio_url) return 'voice'
    return 'text'
  }

  // created_at is written with Date.now() (milliseconds). A row that somehow holds
  // seconds would otherwise render as 1970.
  function fmtTime (value, lang) {
    var n = Number(value)
    if (!isFinite(n) || n <= 0) return ''
    if (n < 1e12) n = n * 1000
    var d = new Date(n)
    if (isNaN(d.getTime())) return ''
    try {
      return d.toLocaleTimeString(lang === 'en' ? 'en-GB' : 'nb-NO', { hour: '2-digit', minute: '2-digit' })
    } catch (e) {
      return ''
    }
  }

  // Merge a poll's rows into what is already on screen. Dedupes by id and keeps
  // ascending order, because a resend or an overlapping cursor must not print the
  // same message twice.
  function mergeMessages (existing, incoming) {
    var out = (existing || []).slice()
    var seen = {}
    out.forEach(function (m) { if (m && m.id != null) seen[m.id] = true })
    ;(incoming || []).forEach(function (m) {
      if (!m || m.id == null || seen[m.id]) return
      seen[m.id] = true
      out.push(m)
    })
    out.sort(function (a, b) { return Number(a.id) - Number(b.id) })
    return out
  }

  function lastId (messages) {
    var max = 0
    ;(messages || []).forEach(function (m) {
      var n = Number(m && m.id)
      if (isFinite(n) && n > max) max = n
    })
    return max
  }

  // ---- DOM ----

  function injectStyle (side, width) {
    if (document.getElementById(STYLE_ID)) return
    var css = [
      '.vcs-launch{position:fixed;bottom:22px;z-index:' + Z + ';border:0;cursor:pointer;',
      'width:56px;height:56px;border-radius:50%;font-size:24px;line-height:1;',
      'background:var(--v-primary,#2a9d8f);color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.28);',
      'display:flex;align-items:center;justify-content:center}',
      '.vcs-launch:hover{filter:brightness(1.08)}',
      '.vcs-launch[data-side="right"]{right:22px}.vcs-launch[data-side="left"]{left:22px}',
      '.vcs-panel{position:fixed;top:0;bottom:0;z-index:' + (Z + 1) + ';display:flex;flex-direction:column;',
      'background:var(--v-bg,#fff);color:var(--v-text,#1d2330);box-shadow:0 0 40px rgba(0,0,0,.28);',
      'font:400 15px/1.5 inherit;transition:transform .25s ease}',
      '.vcs-panel[data-side="right"]{right:0;border-left:1px solid var(--v-border,rgba(127,127,127,.2))}',
      '.vcs-panel[data-side="left"]{left:0;border-right:1px solid var(--v-border,rgba(127,127,127,.2))}',
      '.vcs-panel[hidden]{display:none}',
      '.vcs-bar{display:flex;align-items:center;gap:.6rem;padding:.85rem 1rem;',
      'border-bottom:1px solid var(--v-border,rgba(127,127,127,.2))}',
      '.vcs-h{font:600 1.05rem/1.3 inherit;margin:0;flex:1}',
      '.vcs-x{flex:none;width:32px;height:32px;border-radius:50%;border:0;cursor:pointer;font-size:20px;',
      'line-height:1;background:rgba(127,127,127,.16);color:inherit}',
      '.vcs-x:hover{background:rgba(127,127,127,.3)}',
      '.vcs-body{flex:1;overflow-y:auto;padding:1rem;display:flex;flex-direction:column;gap:.7rem}',
      '.vcs-msg{display:flex;gap:.55rem;max-width:88%}',
      '.vcs-msg[data-mine]{align-self:flex-end;flex-direction:row-reverse}',
      '.vcs-av{flex:none;width:30px;height:30px;border-radius:50%;overflow:hidden;background:rgba(127,127,127,.22);',
      'display:flex;align-items:center;justify-content:center;font:600 10px/1 inherit;letter-spacing:0;',
      'color:var(--v-text,#1d2330)}',
      '.vcs-av img{width:100%;height:100%;object-fit:cover}',
      '.vcs-bub{background:var(--v-surface,rgba(127,127,127,.12));border-radius:12px;padding:.5rem .7rem;min-width:0}',
      '.vcs-msg[data-mine] .vcs-bub{background:var(--v-primary,#2a9d8f);color:#fff}',
      // color:inherit on every text node in a bubble is load-bearing, not tidiness.
      // The panel lives on somebody else's page, and a host rule as ordinary as
      // `p { color: #6b7280 }` outranks plain inheritance — it turned the white
      // text in the green "mine" bubble grey-on-green (seen 2026-09-13). A class
      // selector beats an element selector, so this holds.
      '.vcs-who{font:600 .72rem/1.3 inherit;color:inherit;opacity:.75;margin-bottom:.15rem}',
      '.vcs-txt{margin:0;color:inherit;font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}',
      '.vcs-when{font-size:.68rem;color:inherit;opacity:.6;margin-top:.2rem;text-align:right}',
      '.vcs-bub img,.vcs-bub video{max-width:100%;border-radius:8px;display:block}',
      '.vcs-bub audio{width:100%}',
      '.vcs-foot{border-top:1px solid var(--v-border,rgba(127,127,127,.2));padding:.7rem}',
      '.vcs-form{display:flex;gap:.5rem;align-items:flex-end}',
      '.vcs-in{flex:1;resize:none;font:inherit;padding:.55rem .7rem;border-radius:10px;max-height:120px;',
      'border:1px solid var(--v-border,rgba(127,127,127,.35));background:transparent;color:inherit}',
      '.vcs-send{flex:none;border:0;cursor:pointer;border-radius:10px;padding:.6rem .95rem;font:600 .9rem/1 inherit;',
      'background:var(--v-primary,#2a9d8f);color:#fff}',
      '.vcs-send[disabled]{opacity:.5;cursor:default}',
      '.vcs-note{padding:1.2rem 1rem;text-align:center;font-size:.9rem;opacity:.8}',
      '.vcs-note[data-error]{color:#c0392b;opacity:1}',
      '.vcs-note b{display:block;margin-bottom:.3rem;opacity:1}',
      '@media (max-width:520px){.vcs-panel{width:100%!important}}',
      '@media (prefers-reduced-motion:reduce){.vcs-panel{transition:none}}',
    ].join('')
    var el = document.createElement('style')
    el.id = STYLE_ID
    el.textContent = css
    document.head.appendChild(el)
  }

  function note (host, text, hint, isError) {
    host.textContent = ''
    var d = document.createElement('div')
    d.className = 'vcs-note'
    if (isError) d.setAttribute('data-error', '')
    if (hint) {
      var b = document.createElement('b')
      b.textContent = text
      d.appendChild(b)
      d.appendChild(document.createTextNode(hint))
    } else {
      d.textContent = text
    }
    host.appendChild(d)
    return d
  }

  function readStores () {
    var out = {}
    ;['vegvisr_user', 'user', 'userStore'].forEach(function (k) {
      try { out[k] = localStorage.getItem(k) } catch (e) { out[k] = null }
    })
    return out
  }

  function ensureAuthComponent () {
    if (window.customElements && window.customElements.get('vegvisr-auth')) return Promise.resolve(true)
    return new Promise(function (resolve) {
      var existing = document.querySelector('script[src="' + AUTH_URL + '"]')
      var s = existing || document.createElement('script')
      s.addEventListener('load', function () { resolve(true) })
      s.addEventListener('error', function () { resolve(false) })
      if (!existing) { s.src = AUTH_URL; document.head.appendChild(s) }
    })
  }

  // token -> { user_id, phone, email }. Never /userdata?email= (see header).
  function resolveIdentity (identityApi, token) {
    return fetch(identityApi + '/userdata-from-token', {
      headers: { Authorization: 'Bearer ' + token, accept: 'application/json' },
    }).then(function (r) {
      if (r.status === 401) return null
      if (!r.ok) throw new Error('identity HTTP ' + r.status)
      return r.json()
    }).then(function (d) {
      if (!d || !d.user_id || !d.phone) return null
      return { user_id: String(d.user_id), phone: String(d.phone), email: d.email || null }
    })
  }

  function chatUrl (base, groupId, me, extra) {
    var q = '?user_id=' + encodeURIComponent(me.user_id) + '&phone=' + encodeURIComponent(me.phone)
    if (me.email) q += '&email=' + encodeURIComponent(me.email)
    return base + '/groups/' + encodeURIComponent(groupId) + '/messages' + q + (extra || '')
  }

  function mount (root) {
    var groupId = String(root.getAttribute('data-vegvisr-chat') || '').trim()
    var lang = (root.getAttribute('data-lang') || 'no').trim().toLowerCase() === 'en' ? 'en' : 'no'
    var t = TEXT[lang]
    var side = parseSide(root.getAttribute('data-side'))
    var width = clampWidth(root.getAttribute('data-width'))
    var pollSec = clampPoll(root.getAttribute('data-poll'))
    var chatApi = (root.getAttribute('data-chat-api') || CHAT_API).replace(/\/+$/, '')
    var identityApi = (root.getAttribute('data-identity-api') || IDENTITY_API).replace(/\/+$/, '')
    var heading = (root.getAttribute('data-title') || t.title).trim()
    var direct = root.getAttribute('data-chat-kind') === 'direct'
    var authenticatedToken = null
    var launcherLabel = root.getAttribute('data-launcher') || '💬'

    if (!groupId) {
      console.warn('[chat-sidebar] ' + t.noGroup + ' Set data-vegvisr-chat="<groupId>".')
      return
    }
    injectStyle()

    var state = { me: null, messages: [], timer: null, open: false, sending: false, stopped: false }

    var launcher = document.createElement('button')
    launcher.type = 'button'
    launcher.className = 'vcs-launch'
    launcher.setAttribute('data-side', side)
    launcher.setAttribute('aria-label', t.open)
    launcher.title = t.open
    launcher.textContent = launcherLabel

    var panel = document.createElement('div')
    panel.className = 'vcs-panel'
    panel.setAttribute('data-side', side)
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', heading)
    panel.style.width = width + 'px'
    panel.hidden = true

    var bar = document.createElement('div')
    bar.className = 'vcs-bar'
    var h = document.createElement('h2')
    h.className = 'vcs-h'
    h.textContent = heading
    var x = document.createElement('button')
    x.type = 'button'
    x.className = 'vcs-x'
    x.innerHTML = '&times;'
    x.setAttribute('aria-label', t.close)
    x.title = t.close
    bar.appendChild(h)
    bar.appendChild(x)

    var body = document.createElement('div')
    body.className = 'vcs-body'
    var foot = document.createElement('div')
    foot.className = 'vcs-foot'

    panel.appendChild(bar)
    panel.appendChild(body)
    panel.appendChild(foot)
    document.body.appendChild(launcher)
    document.body.appendChild(panel)
    root.setAttribute('data-vegvisr-chat-mounted', '')

    function openPanel () {
      state.open = true
      panel.hidden = false
      launcher.hidden = true
      start()
    }
    function closePanel () {
      state.open = false
      panel.hidden = true
      launcher.hidden = false
      stopPolling()
      launcher.focus()
    }
    launcher.addEventListener('click', openPanel)
    x.addEventListener('click', closePanel)
    document.addEventListener('keydown', function (e) {
      if (state.open && e.key === 'Escape') { e.preventDefault(); closePanel() }
    })
    // A hidden tab must not keep polling a billed worker.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stopPolling()
      else if (state.open && state.me) startPolling()
    })

    function stopPolling () {
      if (state.timer) { clearInterval(state.timer); state.timer = null }
    }
    function startPolling () {
      stopPolling()
      state.timer = setInterval(poll, pollSec * 1000)
    }

    function renderMessages () {
      body.textContent = ''
      if (!state.messages.length) {
        note(body, t.empty)
        return
      }
      state.messages.forEach(function (m) {
        body.appendChild(messageEl(m))
      })
      body.scrollTop = body.scrollHeight
    }

    function messageEl (m) {
      var mine = isMine(m, state.me && state.me.user_id)
      var wrap = document.createElement('div')
      wrap.className = 'vcs-msg'
      if (mine) wrap.setAttribute('data-mine', '')

      var av = document.createElement('div')
      av.className = 'vcs-av'
      if (m.sender_avatar_url) {
        var img = document.createElement('img')
        img.alt = ''
        // Same two rules as the message picture above: handler before src, and no
        // lazy loading inside this panel (see the note on the message image).
        img.onerror = function () { av.textContent = shortLabel(m.user_id, t) }
        img.src = m.sender_avatar_url
        av.appendChild(img)
      } else {
        av.textContent = mine ? t.you.slice(0, 2).toUpperCase() : shortLabel(m.user_id, t)
      }
      wrap.appendChild(av)

      var bub = document.createElement('div')
      bub.className = 'vcs-bub'
      var who = document.createElement('div')
      who.className = 'vcs-who'
      who.textContent = mine ? t.you : direct ? heading : shortLabel(m.user_id, t)
      bub.appendChild(who)

      var kind = messageKind(m)
      if (kind === 'image' && m.media_url) {
        var pic = document.createElement('img')
        pic.alt = m.body || t.image
        // NOT loading="lazy". Inside this fixed, scrollable panel the lazy heuristic
        // never decided the image was near the viewport: it stayed complete=false
        // with an empty currentSrc and fired neither load NOR error, so the picture
        // simply never appeared and the fallback below could never run either
        // (measured 2026-09-13 — an eager image on the same url errored at once).
        // A chat panel shows a handful of recent messages; eager is right here.
        // Chat media outlives nothing in particular — a deleted or expired url must
        // leave a labelled placeholder, not a blank gap in the conversation.
        // onerror is attached BEFORE src: an already-cached failure fires the event
        // synchronously on assignment, and a handler added afterwards never sees it
        // (observed 2026-09-13 — the placeholder simply never appeared).
        pic.onerror = function () {
          var miss = document.createElement('p')
          miss.className = 'vcs-txt'
          miss.textContent = '🖼 ' + t.image
          if (pic.parentNode) pic.parentNode.replaceChild(miss, pic)
        }
        pic.src = m.media_url
        bub.appendChild(pic)
      } else if (kind === 'video' && m.media_url) {
        var vid = document.createElement('video')
        vid.src = m.media_url
        vid.controls = true
        if (m.video_thumbnail_url) vid.poster = m.video_thumbnail_url
        bub.appendChild(vid)
      } else if (kind === 'voice' && (m.audio_url || m.media_url)) {
        var aud = document.createElement('audio')
        aud.src = m.audio_url || m.media_url
        aud.controls = true
        bub.appendChild(aud)
      }
      // Chat text is rendered as TEXT, never markdown or HTML: it is written by
      // other people and lands on someone else's website.
      var txt = String(m.body || (kind !== 'text' ? '' : ''))
      if (txt || kind === 'text') {
        var p = document.createElement('p')
        p.className = 'vcs-txt'
        p.textContent = txt
        bub.appendChild(p)
      }
      if (m.transcript_text) {
        var tr = document.createElement('p')
        tr.className = 'vcs-txt'
        tr.textContent = m.transcript_text
        bub.appendChild(tr)
      }
      var when = document.createElement('div')
      when.className = 'vcs-when'
      when.textContent = fmtTime(m.created_at, lang)
      bub.appendChild(when)
      wrap.appendChild(bub)
      return wrap
    }

    function renderComposer () {
      foot.textContent = ''
      var form = document.createElement('form')
      form.className = 'vcs-form'
      var input = document.createElement('textarea')
      input.className = 'vcs-in'
      input.rows = 1
      input.placeholder = t.placeholder
      var send = document.createElement('button')
      send.type = 'submit'
      send.className = 'vcs-send'
      send.textContent = t.send
      form.appendChild(input)
      form.appendChild(send)
      foot.appendChild(form)

      input.addEventListener('input', function () {
        input.style.height = 'auto'
        input.style.height = Math.min(120, input.scrollHeight) + 'px'
      })
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.dispatchEvent(new Event('submit', { cancelable: true })) }
      })
      form.addEventListener('submit', function (e) {
        e.preventDefault()
        var value = input.value.trim()
        if (!value || state.sending) return
        state.sending = true
        send.disabled = true
        fetch(chatApi + (direct ? '/direct/' : '/groups/') + encodeURIComponent(groupId) + '/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(direct ? { Authorization: 'Bearer ' + authenticatedToken } : {}) },
          body: JSON.stringify({
            user_id: state.me.user_id, phone: state.me.phone, email: state.me.email || undefined,
            body: value, message_type: 'text',
          }),
        }).then(function (r) {
          if (!r.ok) throw new Error('send HTTP ' + r.status)
          input.value = ''
          input.style.height = 'auto'
          return poll()
        }).catch(function (err) {
          console.error('[chat-sidebar] send failed:', err)
          window.alert(t.sendFailed)
        }).then(function () {
          state.sending = false
          send.disabled = false
          input.focus()
        })
      })
    }

    // 403 is the documented answer for a non-member — the panel says so plainly
    // rather than showing an empty conversation that looks broken.
    function handleLoadError (r) {
      if (r && (r.status === 403 || r.status === 401)) {
        state.messages = []
        note(body, t.notMember, t.notMemberHint)
        foot.textContent = ''
        return true
      }
      return false
    }

    function poll () {
      if (!state.me || state.stopped) return Promise.resolve()
      var after = lastId(state.messages)
      return fetch(direct ? chatApi + '/direct/' + encodeURIComponent(groupId) + '/messages?after=' + after + '&limit=' + PAGE_SIZE : chatUrl(chatApi, groupId, state.me, '&after=' + after + '&limit=' + PAGE_SIZE), {
        headers: { accept: 'application/json', ...(direct ? { Authorization: 'Bearer ' + authenticatedToken } : {}) },
      }).then(function (r) {
        if (!r.ok) { if (handleLoadError(r)) { stopPolling(); state.stopped = true } return null }
        return r.json()
      }).then(function (d) {
        if (!d || !d.messages || !d.messages.length) return
        var before = state.messages.length
        state.messages = mergeMessages(state.messages, d.messages)
        if (state.messages.length !== before) renderMessages()
      }).catch(function (err) {
        console.warn('[chat-sidebar] poll failed:', err && err.message)
      })
    }

    function loadFirstPage () {
      note(body, t.loading)
      return fetch(direct ? chatApi + '/direct/' + encodeURIComponent(groupId) + '/messages?latest=1&limit=' + PAGE_SIZE : chatUrl(chatApi, groupId, state.me, '&latest=1&limit=' + PAGE_SIZE), {
        headers: { accept: 'application/json', ...(direct ? { Authorization: 'Bearer ' + authenticatedToken } : {}) },
      }).then(function (r) {
        if (!r.ok) { if (handleLoadError(r)) return null; throw new Error('messages HTTP ' + r.status) }
        return r.json()
      }).then(function (d) {
        if (!d) return
        state.messages = mergeMessages([], d.messages || [])
        renderMessages()
        renderComposer()
        startPolling()
        log('group ' + groupId + ': ' + state.messages.length + ' message(s) loaded, polling every ' + pollSec + 's')
      }).catch(function (err) {
        console.error('[chat-sidebar] could not load messages:', err)
        note(body, t.error, null, true)
      })
    }

    function showSignIn () {
      body.textContent = ''
      foot.textContent = ''
      var d = note(body, t.signIn)
      ensureAuthComponent().then(function (ok) {
        if (!ok) return
        var auth = document.createElement('vegvisr-auth')
        d.appendChild(document.createElement('br'))
        d.appendChild(auth)
      })
      // vegvisr-auth writes the store on sign-in; pick it up without a reload.
      var watch = setInterval(function () {
        if (sessionToken(root, readStores())) { clearInterval(watch); start() }
      }, 1500)
    }

    function start () {
      if (state.me) {
        if (!state.timer && state.open) startPolling()
        return
      }
      var token = sessionToken(root, readStores())
      if (!token) { showSignIn(); return }
      authenticatedToken = token
      note(body, t.loading)
      resolveIdentity(identityApi, token).then(function (me) {
        if (!me) { showSignIn(); return }
        state.me = me
        return loadFirstPage()
      }).catch(function (err) {
        console.error('[chat-sidebar] identity failed:', err)
        note(body, t.error, null, true)
      })
    }

    if ((root.getAttribute('data-start') || 'closed').trim().toLowerCase() === 'open') openPanel()
  }

  function mountAll () {
    var nodes = document.querySelectorAll('[data-vegvisr-chat]:not([data-vegvisr-chat-mounted])')
    if (!nodes.length) {
      console.warn('[chat-sidebar] loaded but found no [data-vegvisr-chat] element to mount on.')
      return
    }
    // One panel per page: two launchers stacked on the same edge is never wanted.
    if (nodes.length > 1) console.warn('[chat-sidebar] ' + nodes.length + ' markers found; mounting the first only.')
    mount(nodes[0])
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll)
  } else {
    mountAll()
  }
})();
