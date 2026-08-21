// contact-form — verified web component (SSOT), served from the Component
// Registry graph node's metadata.impl at /components/contact-form.js.
//
// Self-mounting: place a marker anywhere, and this script (injected at publish
// time via <script src=".../components/contact-form.js">) builds the form,
// injects its CSS, and wires the OTP + submit flow — so it RUNS on the served
// page (external script), unlike a copied HTML+inline-script blob.
//
// Usage:
//   <div data-vegvisr-contact
//        data-graph="<graphId>"     (optional — per-node routing key)
//        data-node="<nodeId>"       (optional — per-node routing key)
//        data-endpoint="/__contact" (optional — relay base, default /__contact)
//        data-title="Ta kontakt"    (optional)
//        data-lead="..."          (optional)
//        data-success="..."       (optional — text shown after a sent enquiry)
//        data-submit="..."></div> (optional)
//
// Wording can also live on the html-node itself, at metadata.contactForm, keyed by the same
// data-graph + data-node pair that routes the submission:
//   { "title": "", "lead": "", "success": "Takk! Vi svarer innen to virkedager.",
//     "nameLabel": "Navn", "emailLabel": "E-post", "messageLabel": "Din melding",
//     "sendCode": "Send kode", "submit": "Send", "hint": "..." }
// Precedence: default < node config < data- attribute. An empty string is honoured, so
// "title": "" removes the heading rather than falling back to the default.
(function () {
  var STYLE_ID = 'vgc-styles-v1';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      ".vgcontact{--vgc-navy:#0f2a43;--vgc-navy2:#183a5a;--vgc-paper:#fdfbf7;--vgc-ink:#1f1e1c;--vgc-muted:#6b5d4c;--vgc-line:#d9ccb7;--vgc-gold:#b08a4a;max-width:520px;margin:1.4em auto;font-family:Georgia,'Times New Roman',serif;color:var(--vgc-ink);text-align:left}" +
      ".vgcontact h3{color:var(--vgc-navy);font-size:1.4em;margin:0 0 .2em;text-align:center}" +
      ".vgcontact .vgc-lead{color:var(--vgc-muted);text-align:center;margin:0 0 1.2em}" +
      ".vgcontact .vgc-hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}" +
      ".vgcontact label{display:block;font-size:.82em;color:var(--vgc-muted);margin:.7em 0 .2em}" +
      ".vgcontact input,.vgcontact textarea{width:100%;box-sizing:border-box;font-family:inherit;font-size:1em;color:var(--vgc-ink);background:var(--vgc-paper);border:1px solid var(--vgc-line);border-radius:8px;padding:10px 12px}" +
      ".vgcontact input:focus,.vgcontact textarea:focus{outline:none;border-color:var(--vgc-gold)}" +
      ".vgcontact textarea{min-height:110px;resize:vertical}" +
      ".vgcontact .vgc-row{display:flex;gap:10px;align-items:flex-end}" +
      ".vgcontact .vgc-row .vgc-grow{flex:1}" +
      ".vgcontact button{cursor:pointer;font-family:inherit;font-size:1em;padding:11px 22px;border-radius:8px;background:var(--vgc-navy);color:#fff;border:1px solid var(--vgc-navy);white-space:nowrap}" +
      ".vgcontact button:hover{background:var(--vgc-navy2)}" +
      ".vgcontact button:disabled{opacity:.5;cursor:default}" +
      ".vgcontact .vgc-hint{font-size:.82em;color:var(--vgc-muted);margin:.3em 0 0}" +
      ".vgcontact .vgc-status{margin:.9em 0 0;font-size:.95em;min-height:1.2em}" +
      ".vgcontact .vgc-status.err{color:#7b241c}" +
      ".vgcontact .vgc-status.ok{color:#3f6f5b}" +
      ".vgcontact .vgc-step2{display:none}" +
      ".vgcontact.sent .vgc-step2{display:block}" +
      ".vgcontact .vgc-done{display:none;color:var(--vgc-navy);font-size:1.1em;text-align:center;padding:1em 0}" +
      ".vgcontact.done-state form{display:none}" +
      ".vgcontact.done-state .vgc-done{display:block}";
    (document.head || document.documentElement).appendChild(s);
  }

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) if (attrs.hasOwnProperty(k)) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }

  function mount(root) {
    if (root.getAttribute('data-vgc-init')) return;
    root.setAttribute('data-vgc-init', '1');
    root.classList.add('vgcontact');

    var gid = root.getAttribute('data-graph') || '';
    var nid = root.getAttribute('data-node') || '';
    // Default to the absolute relay (brand-worker) so the form submits from ANY
    // published host cross-origin — the relay lives only on brand-worker, and its
    // /__contact/* responses send CORS ACAO:*. Override with data-endpoint for a
    // page served by the relay worker itself (relative '/__contact').
    var base = root.getAttribute('data-endpoint') || 'https://brand-worker.torarnehave.workers.dev/__contact';
    // Texts resolve in three layers: built-in default, then the node's stored config, then a
    // data- attribute. Attributes win because a page that sets one means it.
    //
    // PRESENCE, not truthiness: data-title="" previously fell through to 'Ta kontakt', because
    // '' || default returns the default. Setting a title empty to suppress it therefore did
    // nothing, and a page with its own heading above the form showed the heading twice.
    function attr(name) {
      return root.hasAttribute(name) ? root.getAttribute(name) : undefined;
    }
    var TEXT_DEFAULTS = {
      title: 'Ta kontakt',
      lead: 'Fyll ut skjemaet — vi bekrefter nummeret med en engangskode på SMS og tar kontakt.',
      success: 'Takk — henvendelsen er sendt. Vi tar kontakt.',
      nameLabel: 'Navn', emailLabel: 'E-post', phoneLabel: 'Mobil (norsk)', messageLabel: 'Melding',
      sendCode: 'Send kode', submit: 'Send henvendelse',
      hint: 'Vi sender en engangskode på SMS for å bekrefte nummeret.'
    };
    var texts = {};
    for (var k in TEXT_DEFAULTS) texts[k] = TEXT_DEFAULTS[k];
    var ATTR_FOR = { title: 'data-title', lead: 'data-lead', success: 'data-success', submit: 'data-submit' };
    var fromAttr = {};
    for (var a in ATTR_FOR) {
      var v = attr(ATTR_FOR[a]);
      if (v !== undefined) { texts[a] = v; fromAttr[a] = true; }
    }
    var loadTs = Date.now();

    var titleEl = el('h3', null, texts.title);
    var leadEl = el('p', { class: 'vgc-lead' }, texts.lead);
    if (texts.title !== '') root.appendChild(titleEl);
    if (texts.lead !== '') root.appendChild(leadEl);

    var form = el('form', { class: 'vgc-form', autocomplete: 'on' });

    var hp = el('input', { class: 'vgc-hp', type: 'text', name: 'company', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' });
    form.appendChild(hp);

    form.appendChild(el('label', null, texts.nameLabel));
    var name = el('input', { class: 'vgc-name', type: 'text', required: '', maxlength: '120' });
    form.appendChild(name);

    form.appendChild(el('label', null, texts.emailLabel));
    var email = el('input', { class: 'vgc-email', type: 'email', required: '', maxlength: '160' });
    form.appendChild(email);

    var row1 = el('div', { class: 'vgc-row' });
    var grow = el('div', { class: 'vgc-grow' });
    grow.appendChild(el('label', null, 'Mobil (norsk)'));
    var phone = el('input', { class: 'vgc-phone', type: 'tel', required: '', inputmode: 'tel', placeholder: '8 siffer' });
    grow.appendChild(phone);
    row1.appendChild(grow);
    var sendBtn = el('button', { type: 'button', class: 'vgc-sendcode' }, texts.sendCode);
    row1.appendChild(sendBtn);
    form.appendChild(row1);

    form.appendChild(el('p', { class: 'vgc-hint' }, texts.hint));

    form.appendChild(el('label', null, texts.messageLabel));
    var msg = el('textarea', { class: 'vgc-msg', required: '', maxlength: '4000' });
    form.appendChild(msg);

    var step2 = el('div', { class: 'vgc-step2' });
    step2.appendChild(el('label', null, 'Verifiseringskode (fra SMS)'));
    var row2 = el('div', { class: 'vgc-row' });
    var grow2 = el('div', { class: 'vgc-grow' });
    var code = el('input', { class: 'vgc-code', type: 'text', inputmode: 'numeric', maxlength: '6', placeholder: '6 siffer' });
    grow2.appendChild(code);
    row2.appendChild(grow2);
    var subBtn = el('button', { type: 'submit', class: 'vgc-submit' }, texts.submit);
    row2.appendChild(subBtn);
    step2.appendChild(row2);
    form.appendChild(step2);

    var status = el('p', { class: 'vgc-status', role: 'status', 'aria-live': 'polite' });
    form.appendChild(status);

    root.appendChild(form);
    var doneEl = el('div', { class: 'vgc-done' }, texts.success);
    root.appendChild(doneEl);

    // Config lives on the html-node this form belongs to — the SAME data-graph + data-node pair
    // that already routes the submission. No new attributes, and the wording becomes data the
    // owner edits in the graph instead of markup baked into every page that uses the form.
    // Fetched after render, never before: a slow or failed lookup must not delay or hide the form.
    if (gid && nid) {
      fetch('https://knowledge.vegvisr.org/getknowgraph?id=' + encodeURIComponent(gid))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (g) {
          var nodes = (g && g.nodes) || [];
          var n = null;
          for (var i = 0; i < nodes.length; i++) if (nodes[i].id === nid) { n = nodes[i]; break; }
          var cfg = n && n.metadata && n.metadata.contactForm;
          if (!cfg) return;
          for (var key in TEXT_DEFAULTS) {
            if (fromAttr[key]) continue;              // an attribute on the page wins
            if (typeof cfg[key] !== 'string') continue;
            texts[key] = cfg[key];
          }
          if (!fromAttr.title) { titleEl.textContent = texts.title; if (texts.title === '' && titleEl.parentNode) titleEl.parentNode.removeChild(titleEl); }
          if (!fromAttr.lead) { leadEl.textContent = texts.lead; if (texts.lead === '' && leadEl.parentNode) leadEl.parentNode.removeChild(leadEl); }
          doneEl.textContent = texts.success;
          var lbl = root.querySelectorAll('label');
          if (lbl[0]) lbl[0].textContent = texts.nameLabel;
          if (lbl[1]) lbl[1].textContent = texts.emailLabel;
          if (lbl[3]) lbl[3].textContent = texts.messageLabel;
          var sc = root.querySelector('.vgc-sendcode'); if (sc) sc.textContent = texts.sendCode;
          var sb = root.querySelector('.vgc-submit'); if (sb) sb.textContent = texts.submit;
          var hn = root.querySelector('.vgc-hint'); if (hn) hn.textContent = texts.hint;
        })
        .catch(function () { /* config is optional — the form works on defaults */ });
    }

    function setMsg(t, cls) {
      status.textContent = t;
      status.className = 'vgc-status' + (cls ? ' ' + cls : '');
    }
    function val(input) {
      return (input.value || '').trim();
    }
    async function post(path, body) {
      body.graphId = gid;
      body.nodeId = nid;
      body.hp = hp.value;
      body.t = loadTs;
      var r = await fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      var j = await r.json().catch(function () { return { ok: false, error: 'Nettverksfeil.' }; });
      return { status: r.status, j: j };
    }

    sendBtn.addEventListener('click', async function () {
      if (!val(phone)) { setMsg('Fyll inn mobilnummer.', 'err'); return; }
      sendBtn.disabled = true;
      setMsg('Sender kode…');
      var res = await post('/send-otp', { phone: val(phone) });
      if (res.j.ok) {
        root.classList.add('sent');
        setMsg('Kode sendt på SMS. Skriv den inn nedenfor.', 'ok');
        code.focus();
      } else {
        setMsg(res.j.error || 'Kunne ikke sende kode.', 'err');
      }
      sendBtn.disabled = false;
    });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (!root.classList.contains('sent')) { setMsg('Be om en kode først.', 'err'); return; }
      if (!val(name) || !val(email) || !val(msg)) { setMsg('Fyll ut navn, e-post og melding.', 'err'); return; }
      if (val(code).length < 4) { setMsg('Skriv inn koden fra SMS.', 'err'); return; }
      subBtn.disabled = true;
      setMsg('Sender…');
      var res = await post('/submit', {
        name: val(name), email: val(email), phone: val(phone), message: val(msg), code: val(code)
      });
      if (res.j.ok) { root.classList.add('done-state'); }
      else { setMsg(res.j.error || 'Kunne ikke sende.', 'err'); subBtn.disabled = false; }
    });
  }

  function mountAll() {
    injectStyles();
    var list = document.querySelectorAll('[data-vegvisr-contact]');
    for (var i = 0; i < list.length; i++) mount(list[i]);
  }

  function init() {
    mountAll();
    // Dynamic builders (React/Vue editors/previews) insert markers after load.
    // Observe the DOM so those markers mount live too — the user sees the exact
    // form that will publish (WYSIWYG), not an empty box.
    if (window.MutationObserver && !window.__vgcObserver) {
      var obs = new MutationObserver(function () { mountAll(); });
      obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
      window.__vgcObserver = obs;
    }
    // Expose a manual re-scan hook for hosts that prefer to call it explicitly.
    window.VegvisrContact = { mountAll: mountAll };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
