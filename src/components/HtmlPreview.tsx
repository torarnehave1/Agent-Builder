import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// --- Direct anchor-section editing (no agent, no LLM) -------------------------
// Editable regions are delimited by comment markers <!-- edit:<id>:start/end -->.
// These helpers read/replace the inner content by NAME — a deterministic string
// splice, the same operation the replace_html_section tool does server-side.
function listAnchorIds(html: string): string[] {
  const ids: string[] = [];
  const re = /<!--\s*edit:([a-z0-9][a-z0-9-]*):start\s*-->/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) ids.push(m[1]);
  return ids;
}
function getSectionInner(html: string, id: string): string | null {
  const startM = `<!-- edit:${id}:start -->`;
  const endM = `<!-- edit:${id}:end -->`;
  const s = html.indexOf(startM);
  const e = html.indexOf(endM);
  if (s === -1 || e === -1 || e < s) return null;
  return html.slice(s + startM.length, e).replace(/^\n/, '').replace(/\n$/, '');
}
function setSectionInner(html: string, id: string, inner: string): string {
  const startM = `<!-- edit:${id}:start -->`;
  const endM = `<!-- edit:${id}:end -->`;
  const s = html.indexOf(startM);
  const e = html.indexOf(endM);
  if (s === -1 || e === -1 || e < s) return html;
  return html.slice(0, s + startM.length) + '\n' + inner + '\n' + html.slice(e);
}

// --- Email-template preview fill --------------------------------------------
// Email bodies carry send-time {placeholders} (brand + system vars). For the PREVIEW iframe only,
// fill them with sample values so the founder sees a rendered email instead of a broken {brandLogo}
// image and an unstyled {brandAccent} button. Editing (section HTML / Erstatt) still reads the RAW
// `html`, so the placeholders are preserved. Visual "Rediger" is hidden for emails because it edits
// the (filled) iframe DOM, which would overwrite the placeholders on save.
const PREVIEW_SAMPLE_VARS: Record<string, string> = {
  brandName: 'Your Brand',
  brandLogo: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="48"><rect width="160" height="48" rx="6" fill="%23e2e8f0"/><text x="80" y="30" font-family="Arial" font-size="13" fill="%230f2a43" text-anchor="middle">LOGO</text></svg>',
  brandAccent: '#0f2a43',
  brandFromName: 'Your Brand',
  brandFooter: 'Your Brand · example.com',
  magicLink: '#',
  expiryMinutes: '30',
  meetingId: 'DEMO-123',
};
function isEmailTemplateHtml(h: string | null): boolean {
  return !!h && /\{(brandName|brandLogo|brandAccent|magicLink)\}/.test(h);
}
function fillPreviewSampleVars(h: string, vars: Record<string, string>): string {
  let out = h;
  for (const [k, v] of Object.entries(vars)) out = out.split('{' + k + '}').join(v);
  return out;
}

// --- Visual "click-on-the-page" text editing --------------------------------
// The preview iframe runs same-origin, so we make EVERY element that directly holds
// text contentEditable on click. Save re-parses the stored source and applies only the
// changed text blocks (matched by document order), so the page's structure, scripts,
// styles and runtime state are preserved — only edited text changes. No anchors needed.
const V_ATTR = 'data-v-editable';

// Elements we never make editable even if they contain text (scripts/styles/head meta,
// and interactive controls whose click must keep its behavior — tab buttons, inputs).
const V_SKIP = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TITLE', 'TEMPLATE', 'HEAD', 'META', 'LINK',
  'BUTTON', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
]);

// True if the element has a direct child text node with non-whitespace content.
function hasDirectText(el: Element): boolean {
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === 3 && (n.textContent ?? '').trim() !== '') return true;
  }
  return false;
}

// Every element that directly holds visible text — "all text is editable". A pure
// layout wrapper (only element children, no direct text) is excluded, so a page never
// collapses into one giant editable blob. When text-bearing elements nest (e.g. a link
// inside a paragraph), only the OUTERMOST is returned, so editing it inline covers the
// inner text and no element is diffed twice on save. Document order is stable and equal
// between the live iframe DOM and a fresh re-parse of the source, so index i matches.
function getEditableEls(root: Element | null | undefined): HTMLElement[] {
  if (!root) return [];
  const isCand = (el: Element) => !V_SKIP.has(el.tagName) && hasDirectText(el);
  const out: HTMLElement[] = [];
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (!isCand(el)) continue;
    let p = el.parentElement, nested = false;
    while (p && p !== root) {
      if (isCand(p)) { nested = true; break; }
      p = p.parentElement;
    }
    if (!nested) out.push(el as HTMLElement);
  }
  return out;
}

// Strip the edit-only attributes we injected before saving, so node.info stays clean.
function cleanInner(s: string): string {
  return s
    .replace(/\s*contenteditable="(?:true|false)"/gi, '')
    .replace(new RegExp(`\\s*${V_ATTR}="[^"]*"`, 'gi'), '');
}

// --- Deterministic search & replace over the raw node HTML (no agent, no LLM) ------
// The same class of operation edit_html_node does server-side: a raw string replace
// over the stored HTML source. Literal mode is an exact split/join (no regex escaping
// pitfalls); whole-word mode wraps the term in \b…\b. Runs entirely client-side.
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function countMatches(html: string, find: string, wholeWord: boolean): number {
  if (!find) return 0;
  if (!wholeWord) return html.split(find).length - 1;
  const m = html.match(new RegExp('\\b' + escapeRegExp(find) + '\\b', 'g'));
  return m ? m.length : 0;
}
function replaceMatches(html: string, find: string, replace: string, wholeWord: boolean): string {
  if (!find) return html;
  if (!wholeWord) return html.split(find).join(replace);
  // Function replacement so `$`-sequences in `replace` are inserted literally.
  return html.replace(new RegExp('\\b' + escapeRegExp(find) + '\\b', 'g'), () => replace);
}

// KG writes authenticate with x-user-role + x-user-email (the pattern the rest of
// the app uses). NOT X-API-Token — under impersonation the localStorage token is a
// different account and the KG worker rejects it as "Invalid API token" (verified
// in-browser: with X-API-Token → 401; x-user headers only → saved).

interface Props {
  html: string | null;
  onClose: () => void;
  onConsoleErrors?: (errors: string[]) => void;
  onHtmlChange?: (html: string) => void;
  graphId?: string | null;
  nodeId?: string | null;
  userEmail?: string;
  // Real brand values (brandName/brandLogo/brandAccent/…) for an email-template preview; merged over
  // the generic sample values so the preview renders with the World's actual brand.
  previewVars?: Record<string, string> | null;
}

interface ConsoleEntry {
  level: 'log' | 'warn' | 'error' | 'info' | 'network';
  message: string;
  timestamp: number;
  graphId?: string;
  nodeId?: string;
}

// Build the console bridge script with graphId/nodeId baked in.
// Every postMessage from the iframe will include these IDs at the source,
// so there's no dependency on React state timing.
function buildConsoleBridge(graphId?: string | null, nodeId?: string | null): string {
  const gId = graphId ? graphId.replace(/'/g, "\\'") : '';
  const nId = nodeId ? nodeId.replace(/'/g, "\\'") : '';
  return `<script>
(function() {
  var MSG_KEY = '__vegvisr_console__';
  var GRAPH_ID = '${gId}';
  var NODE_ID = '${nId}';
  function send(level, args) {
    try {
      var parts = [];
      for (var i = 0; i < args.length; i++) {
        try { parts.push(typeof args[i] === 'string' ? args[i] : JSON.stringify(args[i])); }
        catch(e) { parts.push(String(args[i])); }
      }
      window.parent.postMessage({ type: MSG_KEY, level: level, message: parts.join(' '), graphId: GRAPH_ID, nodeId: NODE_ID }, '*');
    } catch(e) {}
  }
  var orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  console.log = function() { orig.log.apply(console, arguments); send('log', arguments); };
  console.warn = function() { orig.warn.apply(console, arguments); send('warn', arguments); };
  console.error = function() { orig.error.apply(console, arguments); send('error', arguments); };
  console.info = function() { orig.info.apply(console, arguments); send('info', arguments); };
  window.onerror = function(msg, src, line, col) {
    send('error', [msg + (src ? ' at ' + src + ':' + line + ':' + col : '')]);
  };
  window.addEventListener('unhandledrejection', function(e) {
    send('error', ['Unhandled promise rejection: ' + (e.reason && e.reason.message || e.reason || 'unknown')]);
  });
  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function(url, opts) {
      var method = (opts && opts.method || 'GET').toUpperCase();
      var urlStr = typeof url === 'string' ? url : (url && url.url || String(url));
      return origFetch.apply(this, arguments).then(function(res) {
        if (!res.ok) send('network', [method + ' ' + urlStr + ' ' + res.status]);
        return res;
      }).catch(function(err) {
        send('network', [method + ' ' + urlStr + ' FAILED: ' + err.message]);
        throw err;
      });
    };
  }
  var origXHROpen = XMLHttpRequest.prototype.open;
  var origXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    this.__v_method = method; this.__v_url = url;
    return origXHROpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function() {
    var xhr = this;
    xhr.addEventListener('loadend', function() {
      if (xhr.status >= 400 || xhr.status === 0) {
        send('network', [(xhr.__v_method || 'GET').toUpperCase() + ' ' + xhr.__v_url + ' ' + (xhr.status || 'FAILED')]);
      }
    });
    return origXHRSend.apply(this, arguments);
  };
})();
</script>`;
}

// Auth bridge — hands the builder's identity into the srcdoc iframe, then loads the SAME standard
// auth component the published page uses (api.vegvisr.org/components/vegvisr-auth.js). One code path
// for preview and live. The iframe is `about:srcdoc`, so page JS can't reach the builder's auth on
// its own; we set window.__VEGVISR_USER (which the component reads first) so preview resolves the
// current user with no login round-trip, plus window.__VEGVISR_GRAPH_ID. The component then defines
// window.vegvisrPatchNode / window.vegvisrWhoAmI and the <vegvisr-auth> bar. Writes use
// x-user-role + x-user-email (NOT X-API-Token — the KG worker rejects it; see commit 512555f).
function buildAuthBridge(graphId?: string | null, userEmail?: string): string {
  const gId = graphId ? graphId.replace(/'/g, "\\'") : '';
  const email = userEmail ? userEmail.replace(/'/g, "\\'") : '';
  return `<script>window.__VEGVISR_USER={email:'${email}',role:'Superadmin'};window.__VEGVISR_GRAPH_ID='${gId}';</script>` +
    `<script src="https://api.vegvisr.org/components/vegvisr-auth.js"></script>`;
}

function injectBridge(html: string, graphId?: string | null, nodeId?: string | null, userEmail?: string): string {
  // Auth bridge FIRST so window.__VEGVISR_USER / vegvisrPatchNode exist before any page script runs.
  const bridge = buildAuthBridge(graphId, userEmail) + buildConsoleBridge(graphId, nodeId);
  const headIdx = html.indexOf('<head>');
  if (headIdx !== -1) {
    return html.slice(0, headIdx + 6) + bridge + html.slice(headIdx + 6);
  }
  const htmlIdx = html.indexOf('<html');
  if (htmlIdx !== -1) {
    const closeTag = html.indexOf('>', htmlIdx);
    if (closeTag !== -1) {
      return html.slice(0, closeTag + 1) + '<head>' + bridge + '</head>' + html.slice(closeTag + 1);
    }
  }
  return bridge + html;
}

const LEVEL_STYLE: Record<string, { icon: string; color: string }> = {
  log: { icon: '○', color: 'text-white/60' },
  info: { icon: '●', color: 'text-sky-400' },
  warn: { icon: '▲', color: 'text-amber-400' },
  error: { icon: '✕', color: 'text-rose-400' },
  network: { icon: '↔', color: 'text-orange-400' },
};

interface VersionEntry {
  version: number;
  timestamp: string;
}

// Guard (L53): a Save can only succeed if the node actually lives in the target graph.
// The preview's graphId is now pinned to the node's origin graph, but this belt-and-suspenders
// check turns any remaining mismatch into a clear message instead of a raw KG "not found" error.
function nodeMissingMsg(g: { nodes?: Array<{ id?: string }> } | null, nodeId: string, graphId: string): string | null {
  if (!g || !Array.isArray(g.nodes)) return null; // read already failed elsewhere — don't block
  return g.nodes.some((n) => n?.id === nodeId)
    ? null
    : `Noden «${nodeId}» finnes ikke i grafen ${graphId} — åpne siden på nytt fra riktig graf`;
}

export default function HtmlPreview({ html, onClose, onConsoleErrors, onHtmlChange, graphId, nodeId, userEmail, previewVars }: Props) {
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [consoleOpen, setConsoleOpen] = useState(true);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const reportedRef = useRef<Set<string>>(new Set());


  // Version history
  const [versions, setVersions] = useState<VersionEntry[] | null>(null);
  const [versionHtml, setVersionHtml] = useState<string | null>(null);
  const [activeVersion, setActiveVersion] = useState<number | null>(null);
  const [loadingVersion, setLoadingVersion] = useState(false);

  // Direct section editor (deterministic, no agent)
  const [editOpen, setEditOpen] = useState(false);
  const [editAnchor, setEditAnchor] = useState<string>('');
  const [editValue, setEditValue] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string>('');

  // Deterministic search & replace panel state (no agent)
  const [srOpen, setSrOpen] = useState(false);
  const [srFind, setSrFind] = useState('');
  const [srReplace, setSrReplace] = useState('');
  const [srWholeWord, setSrWholeWord] = useState(false);
  const [srSaving, setSrSaving] = useState(false);
  const [srMsg, setSrMsg] = useState('');

  const anchorIds = useMemo(() => (html ? listAnchorIds(html) : []), [html]);
  const isEmailTpl = useMemo(() => isEmailTemplateHtml(html), [html]);
  // Real brand vars (from the World's email-brand node) win over the generic samples.
  const effPreviewVars = useMemo(() => ({ ...PREVIEW_SAMPLE_VARS, ...(previewVars || {}) }), [previewVars]);

  // When the editor opens or the selected anchor changes, load that section's
  // current inner HTML into the textarea.
  useEffect(() => {
    if (!editOpen || !html) return;
    const id = editAnchor || anchorIds[0] || '';
    if (id && id !== editAnchor) setEditAnchor(id);
    if (id) setEditValue(getSectionInner(html, id) ?? '');
  }, [editOpen, editAnchor, html, anchorIds]);

  // Visual "click-on-the-page" edit mode
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const baselineRef = useRef<string[]>([]); // per text-block (document order) clean innerHTML at load
  const [visualEdit, setVisualEdit] = useState(false);
  const [visualSaving, setVisualSaving] = useState(false);
  const [visualMsg, setVisualMsg] = useState('');

  // Stable click handler (attached to the iframe document while in edit mode).
  // Change detection is NOT event-based — save() diffs the live DOM against a
  // baseline captured at load, so any edit is caught regardless of keystroke events.
  const handlersRef = useRef({
    click: (e: Event) => {
      const el = (e.target as Element)?.closest?.(`[${V_ATTR}]`) as HTMLElement | null;
      if (!el) return; // clicks on non-text elements (tab buttons, etc.) pass through
      e.preventDefault();
      e.stopPropagation();
      el.setAttribute('contenteditable', 'true');
      el.focus();
    },
  });

  const enableVisualEdit = useCallback((doc: Document | null | undefined) => {
    if (!doc || !doc.documentElement) return;
    if (!doc.getElementById('__v_edit_style__')) {
      const st = doc.createElement('style');
      st.id = '__v_edit_style__';
      st.textContent = `[${V_ATTR}]{outline:1px dashed rgba(249,115,22,.55);outline-offset:2px;cursor:text}[${V_ATTR}]:hover{outline:2px solid rgba(249,115,22,.95)}[contenteditable="true"]{outline:2px solid #22c55e!important;background:rgba(34,197,94,.06)}`;
      doc.head?.appendChild(st);
    }
    // Make EVERY block-level text element on the page editable (no anchors needed),
    // and capture each one's clean innerHTML in document order as the baseline that
    // save() diffs against. querySelectorAll order is stable and matches a re-parse of
    // the source, so index i here == index i in the source document on save.
    const els = getEditableEls(doc.body || doc.documentElement);
    const base: string[] = [];
    els.forEach((el, i) => {
      el.setAttribute(V_ATTR, '1');
      base[i] = cleanInner(el.innerHTML);
    });
    baselineRef.current = base;
    doc.addEventListener('click', handlersRef.current.click, true);
  }, []);

  const disableVisualEdit = useCallback((doc: Document | null | undefined) => {
    if (!doc) return;
    doc.removeEventListener('click', handlersRef.current.click, true);
    doc.getElementById('__v_edit_style__')?.remove();
    doc.querySelectorAll(`[${V_ATTR}]`).forEach(el => {
      el.removeAttribute(V_ATTR);
      el.removeAttribute('contenteditable');
    });
  }, []);

  // Re-apply / remove edit mode whenever it toggles (on the current iframe doc).
  useEffect(() => {
    const doc = iframeRef.current?.contentDocument;
    if (visualEdit) enableVisualEdit(doc);
    else { disableVisualEdit(doc); baselineRef.current = []; setVisualMsg(''); }
  }, [visualEdit, enableVisualEdit, disableVisualEdit]);

  // Fired on every iframe (re)load — re-arm edit mode if it's on.
  const handleIframeLoad = () => {
    if (visualEdit) enableVisualEdit(iframeRef.current?.contentDocument);
  };

  const saveVisual = async () => {
    if (!graphId || !nodeId || !html) return;
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    setVisualSaving(true);
    setVisualMsg('');
    try {
      // Diff each live text block against its as-loaded baseline (document order), and
      // apply ONLY the changed blocks onto a FRESH parse of the source. Re-parsing the
      // stored source (not the runtime DOM) means the page's structure, scripts, styles
      // and runtime state (active tab, inline display) are preserved — only edited text
      // changes. All text is editable; nothing else is touched.
      const liveEls = getEditableEls(doc.body || doc.documentElement);
      const src = new DOMParser().parseFromString(html, 'text/html');
      const srcEls = getEditableEls(src.body || src.documentElement);
      if (liveEls.length !== srcEls.length) {
        setVisualMsg('Kan ikke lagre trygt — last siden på nytt'); setVisualSaving(false); return;
      }
      let changed = false;
      for (let i = 0; i < liveEls.length; i++) {
        const cur = cleanInner(liveEls[i].innerHTML);
        if (cur !== baselineRef.current[i]) { srcEls[i].innerHTML = cur; changed = true; }
      }
      if (!changed) { setVisualMsg('Ingen endring'); setVisualSaving(false); return; }
      const newHtml = '<!DOCTYPE html>\n' + src.documentElement.outerHTML;
      const gRes = await fetch(`https://knowledge.vegvisr.org/getknowgraph?id=${encodeURIComponent(graphId)}`);
      if (!gRes.ok) { setVisualMsg('Lesing feilet'); setVisualSaving(false); return; }
      const g0 = await gRes.json();
      const miss0 = nodeMissingMsg(g0, nodeId, graphId);
      if (miss0) { setVisualMsg(miss0); setVisualSaving(false); return; }
      let expectedVersion = Number(g0?.metadata?.version || 0);
      let res = await fetch('https://knowledge.vegvisr.org/patchNode', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin', ...(userEmail ? { 'x-user-email': userEmail } : {}) },
        body: JSON.stringify({ graphId, nodeId, fields: { info: newHtml }, expectedVersion }),
      });
      if (res.status === 409) {
        expectedVersion = Number((await (await fetch(`https://knowledge.vegvisr.org/getknowgraph?id=${encodeURIComponent(graphId)}`)).json())?.metadata?.version || 0);
        res = await fetch('https://knowledge.vegvisr.org/patchNode', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin', ...(userEmail ? { 'x-user-email': userEmail } : {}) },
          body: JSON.stringify({ graphId, nodeId, fields: { info: newHtml }, expectedVersion }),
        });
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) { setVisualMsg(data?.error || `Lagring feilet (${res.status})`); setVisualSaving(false); return; }
      onHtmlChange?.(newHtml); // re-renders the iframe from clean bytes; handleIframeLoad re-arms edit mode + recaptures baseline
      setVisualMsg(`Lagret · v${data.newVersion}`);
    } catch (e) {
      setVisualMsg(e instanceof Error ? e.message : 'Lagringsfeil');
    } finally {
      setVisualSaving(false);
    }
  };

  const saveSection = async () => {
    if (!graphId || !nodeId || !html || !editAnchor) return;
    setSaving(true);
    setSaveMsg('');
    try {
      const newHtml = setSectionInner(html, editAnchor, editValue);
      if (newHtml === html) { setSaveMsg('No change'); setSaving(false); return; }
      const gRes = await fetch(`https://knowledge.vegvisr.org/getknowgraph?id=${encodeURIComponent(graphId)}`);
      if (!gRes.ok) { setSaveMsg('Read failed'); setSaving(false); return; }
      const g = await gRes.json();
      const miss = nodeMissingMsg(g, nodeId, graphId);
      if (miss) { setSaveMsg(miss); setSaving(false); return; }
      let expectedVersion = Number(g?.metadata?.version || 0);
      let res = await fetch('https://knowledge.vegvisr.org/patchNode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin', ...(userEmail ? { 'x-user-email': userEmail } : {}) },
        body: JSON.stringify({ graphId, nodeId, fields: { info: newHtml }, expectedVersion }),
      });
      if (res.status === 409) {
        const latest = await (await fetch(`https://knowledge.vegvisr.org/getknowgraph?id=${encodeURIComponent(graphId)}`)).json();
        expectedVersion = Number(latest?.metadata?.version || 0);
        res = await fetch('https://knowledge.vegvisr.org/patchNode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin', ...(userEmail ? { 'x-user-email': userEmail } : {}) },
          body: JSON.stringify({ graphId, nodeId, fields: { info: newHtml }, expectedVersion }),
        });
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) { setSaveMsg(data?.error || `Save failed (${res.status})`); setSaving(false); return; }
      onHtmlChange?.(newHtml); // refresh the preview from the new bytes — deterministic, no agent
      setSaveMsg(`Saved · v${data.newVersion}`);
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : 'Save error');
    } finally {
      setSaving(false);
    }
  };

  const replaceAllInNode = async () => {
    if (!graphId || !nodeId || !html || !srFind) return;
    setSrSaving(true);
    setSrMsg('');
    try {
      const n = countMatches(html, srFind, srWholeWord);
      if (n === 0) { setSrMsg('Ingen treff'); setSrSaving(false); return; }
      const newHtml = replaceMatches(html, srFind, srReplace, srWholeWord);
      if (newHtml === html) { setSrMsg('Ingen endring'); setSrSaving(false); return; }
      const gRes = await fetch(`https://knowledge.vegvisr.org/getknowgraph?id=${encodeURIComponent(graphId)}`);
      if (!gRes.ok) { setSrMsg('Lesing feilet'); setSrSaving(false); return; }
      const gSr = await gRes.json();
      const missSr = nodeMissingMsg(gSr, nodeId, graphId);
      if (missSr) { setSrMsg(missSr); setSrSaving(false); return; }
      let expectedVersion = Number(gSr?.metadata?.version || 0);
      let res = await fetch('https://knowledge.vegvisr.org/patchNode', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin', ...(userEmail ? { 'x-user-email': userEmail } : {}) },
        body: JSON.stringify({ graphId, nodeId, fields: { info: newHtml }, expectedVersion }),
      });
      if (res.status === 409) {
        expectedVersion = Number((await (await fetch(`https://knowledge.vegvisr.org/getknowgraph?id=${encodeURIComponent(graphId)}`)).json())?.metadata?.version || 0);
        res = await fetch('https://knowledge.vegvisr.org/patchNode', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin', ...(userEmail ? { 'x-user-email': userEmail } : {}) },
          body: JSON.stringify({ graphId, nodeId, fields: { info: newHtml }, expectedVersion }),
        });
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) { setSrMsg(data?.error || `Lagring feilet (${res.status})`); setSrSaving(false); return; }
      onHtmlChange?.(newHtml); // refresh preview from new bytes — deterministic, no agent
      setSrMsg(`Erstattet ${n} · v${data.newVersion}`);
    } catch (e) {
      setSrMsg(e instanceof Error ? e.message : 'Lagringsfeil');
    } finally {
      setSrSaving(false);
    }
  };

  const fetchVersions = async () => {
    if (!graphId) return;
    if (versions) { setVersions(null); setVersionHtml(null); setActiveVersion(null); return; }
    try {
      const res = await fetch(`https://knowledge.vegvisr.org/getknowgraphhistory?id=${encodeURIComponent(graphId)}`);
      if (!res.ok) return;
      const data = await res.json();
      setVersions(data.history?.results || data.results || []);
    } catch { /* ignore */ }
  };

  const previewVersion = async (version: number) => {
    if (!graphId || !nodeId) return;
    setLoadingVersion(true);
    try {
      const res = await fetch(`https://knowledge.vegvisr.org/getknowgraphversion?id=${encodeURIComponent(graphId)}&version=${version}`);
      if (!res.ok) { setLoadingVersion(false); return; }
      const data = await res.json();
      const node = (data.nodes || []).find((n: { id: string }) => n.id === nodeId);
      if (node?.info) {
        setVersionHtml(node.info);
        setActiveVersion(version);
      }
    } catch { /* ignore */ }
    setLoadingVersion(false);
  };

  const clearVersionPreview = () => {
    setVersionHtml(null);
    setActiveVersion(null);
  };

  const restoreVersion = async () => {
    if (!graphId || !nodeId || !versionHtml) return;
    try {
      const graphRes = await fetch(`https://knowledge.vegvisr.org/getknowgraph?id=${encodeURIComponent(graphId)}`);
      if (!graphRes.ok) return;
      const graphData = await graphRes.json();
      const expectedVersion = Number(graphData?.metadata?.version || 0);

      const res = await fetch('https://knowledge.vegvisr.org/patchNode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin', ...(userEmail ? { 'x-user-email': userEmail } : {}) },
        body: JSON.stringify({ graphId, nodeId, fields: { info: versionHtml }, expectedVersion }),
      });

      if (res.status === 409) {
        const latestRes = await fetch(`https://knowledge.vegvisr.org/getknowgraph?id=${encodeURIComponent(graphId)}`);
        if (!latestRes.ok) return;
        const latestGraph = await latestRes.json();
        const retryVersion = Number(latestGraph?.metadata?.version || 0);
        const retryRes = await fetch('https://knowledge.vegvisr.org/patchNode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin', ...(userEmail ? { 'x-user-email': userEmail } : {}) },
          body: JSON.stringify({ graphId, nodeId, fields: { info: versionHtml }, expectedVersion: retryVersion }),
        });
        if (!retryRes.ok) return;
      } else if (!res.ok) {
        return;
      }

      onHtmlChange?.(versionHtml);
      setVersionHtml(null);
      setActiveVersion(null);
      setVersions(null);
    } catch { /* ignore */ }
  };

  // graphId/nodeId now come FROM the postMessage itself (baked into the bridge script),
  // so there's no closure staleness risk.
  const handleMessage = useCallback((e: MessageEvent) => {
    if (e.data?.type === '__vegvisr_console__') {
      setEntries(prev => [...prev, {
        level: e.data.level,
        message: e.data.message,
        graphId: e.data.graphId || undefined,
        nodeId: e.data.nodeId || undefined,
        timestamp: Date.now(),
      }]);
    }
  }, []);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  // Clear console entries (visual) when html changes, but KEEP reportedRef
  // so the same error message isn't re-sent to the agent after a fix attempt
  useEffect(() => {
    setEntries([]);
  }, [html]);

  // Reset dedup set when switching to a different node
  useEffect(() => {
    reportedRef.current = new Set();
  }, [nodeId]);

  // Manual "Fix" button handler — sends current errors to the agent
  const handleFixErrors = useCallback(() => {
    if (!onConsoleErrors) return;
    const errors = entries.filter(e => e.level === 'error' || e.level === 'network');
    if (errors.length === 0) return;
    const unique = [...new Map(errors.map(e => [e.message, e])).values()];
    unique.forEach(e => reportedRef.current.add(e.message));
    onConsoleErrors(unique.map(e => {
      const ctx = e.graphId && e.nodeId ? ` [graphId: ${e.graphId}, nodeId: ${e.nodeId}]` : '';
      return e.message + ctx;
    }));
  }, [entries, onConsoleErrors]);

  // Auto-scroll console
  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  if (!html) {
    return (
      <div className="flex-1 flex items-center justify-center text-white/30 text-sm px-8 text-center">
        Click <span className="mx-1 px-1.5 py-0.5 bg-white/10 rounded text-white/50 text-xs">Preview</span> on an HTML tool result to see it here.
      </div>
    );
  }

  const errorCount = entries.filter(e => e.level === 'error' || e.level === 'network').length;
  const srCount = html ? countMatches(html, srFind, srWholeWord) : 0;

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="flex items-center justify-between px-3 h-[36px] border-b border-white/10 bg-slate-900/50 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/50">Preview</span>
          {activeVersion !== null && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
              v{activeVersion}
            </span>
          )}
          {activeVersion !== null && (
            <>
              <button
                type="button"
                onClick={clearVersionPreview}
                className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 hover:bg-sky-500/30 transition-colors"
              >
                Back to current
              </button>
              <button
                type="button"
                onClick={restoreVersion}
                className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 transition-colors"
              >
                Restore v{activeVersion}
              </button>
            </>
          )}
          {errorCount > 0 && (
            <>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-400">
                {errorCount} {errorCount === 1 ? 'error' : 'errors'}
              </span>
              {onConsoleErrors && (
                <button
                  type="button"
                  onClick={handleFixErrors}
                  className="text-[10px] px-2 py-0.5 rounded bg-rose-500/30 text-rose-300 hover:bg-rose-500/50 hover:text-white transition-colors font-medium"
                  title="Send errors to agent for fixing"
                >
                  Fix
                </button>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          {graphId && nodeId && activeVersion === null && (
            <button
              type="button"
              onClick={() => { setVisualEdit(v => !v); if (editOpen) setEditOpen(false); }}
              className={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors ${visualEdit ? 'bg-orange-500/40 text-orange-200' : 'bg-orange-500/15 text-orange-300 hover:bg-orange-500/30'}`}
              title="Rediger tekst ved å klikke direkte på siden (ingen agent)"
            >
              {visualEdit ? '● Rediger av' : '✎ Rediger'}
            </button>
          )}
          {graphId && nodeId && anchorIds.length > 0 && (
            <button
              type="button"
              onClick={() => setEditOpen(p => !p)}
              className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${editOpen ? 'bg-emerald-500/30 text-emerald-300' : 'text-white/40 hover:text-white hover:bg-white/10'}`}
              title="Edit a section's raw HTML directly (no agent)"
            >
              HTML
            </button>
          )}
          {graphId && nodeId && activeVersion === null && (
            <button
              type="button"
              onClick={() => { setSrOpen(p => !p); setVisualEdit(false); setEditOpen(false); }}
              className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${srOpen ? 'bg-sky-500/30 text-sky-300' : 'text-white/40 hover:text-white hover:bg-white/10'}`}
              title="Søk og erstatt tekst direkte (ingen agent)"
            >
              Erstatt
            </button>
          )}
          {graphId && nodeId && (
            <button
              type="button"
              onClick={fetchVersions}
              className={`text-white/40 hover:text-white text-[10px] px-1.5 py-0.5 rounded hover:bg-white/10 transition-colors ${versions ? 'text-sky-400' : ''}`}
              title="Show version history"
            >
              Versions
            </button>
          )}
          <button
            type="button"
            onClick={() => setConsoleOpen(p => !p)}
            className="text-white/40 hover:text-white text-[10px] px-1.5 py-0.5 rounded hover:bg-white/10 transition-colors"
            title={consoleOpen ? 'Hide console' : 'Show console'}
          >
            Console
          </button>
          <button
            type="button"
            onClick={() => setEntries([])}
            className="text-white/40 hover:text-white text-[10px] px-1.5 py-0.5 rounded hover:bg-white/10 transition-colors"
            title="Clear console"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-white/40 hover:text-white text-sm px-1.5 py-0.5 rounded hover:bg-white/10 transition-colors"
            title="Close preview"
          >
            ✕
          </button>
        </div>
      </div>
      {visualEdit && (
        <div className="px-3 py-1.5 border-b border-white/10 bg-orange-950/30 flex-shrink-0 flex items-center gap-2">
          <span className="text-[11px] text-orange-200/80">Klikk på en tekst i siden og skriv. Så:</span>
          <button
            type="button"
            onClick={saveVisual}
            disabled={visualSaving}
            className="text-[11px] px-2.5 py-0.5 rounded bg-emerald-500/30 text-emerald-200 hover:bg-emerald-500/50 hover:text-white transition-colors disabled:opacity-40 font-medium"
          >
            {visualSaving ? 'Lagrer…' : 'Lagre'}
          </button>
          {visualMsg && <span className="text-[11px] text-white/60">{visualMsg}</span>}
          <span className="ml-auto text-[9px] text-white/25">visuell redigering · ingen agent</span>
        </div>
      )}
      {editOpen && (
        <div className="px-3 py-2 border-b border-white/10 bg-slate-900/40 flex-shrink-0 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-white/40">Section</span>
            <select
              value={editAnchor}
              onChange={e => setEditAnchor(e.target.value)}
              className="text-[11px] bg-slate-800 text-white/80 border border-white/10 rounded px-1.5 py-0.5"
            >
              {anchorIds.map(id => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={saveSection}
              disabled={saving}
              className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/30 text-emerald-300 hover:bg-emerald-500/50 hover:text-white transition-colors disabled:opacity-40"
              title="Write this section directly to the graph (no agent)"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saveMsg && <span className="text-[10px] text-white/50">{saveMsg}</span>}
            <span className="ml-auto text-[9px] text-white/25">direct edit · no agent</span>
          </div>
          <textarea
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            spellCheck={false}
            className="w-full h-40 bg-slate-950 text-white/85 border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] leading-snug resize-y"
            placeholder="HTML for this section…"
          />
        </div>
      )}
      {srOpen && (
        <div className="px-3 py-2 border-b border-white/10 bg-slate-900/40 flex-shrink-0 flex items-center gap-2 flex-wrap">
          <input
            value={srFind}
            onChange={e => setSrFind(e.target.value)}
            spellCheck={false}
            placeholder="Finn…"
            className="text-[11px] bg-slate-950 text-white/85 border border-white/10 rounded px-2 py-0.5 font-mono w-40"
          />
          <span className="text-white/30 text-[11px]">→</span>
          <input
            value={srReplace}
            onChange={e => setSrReplace(e.target.value)}
            spellCheck={false}
            placeholder="Erstatt med…"
            className="text-[11px] bg-slate-950 text-white/85 border border-white/10 rounded px-2 py-0.5 font-mono w-40"
          />
          <label className="flex items-center gap-1 text-[10px] text-white/50 select-none cursor-pointer">
            <input type="checkbox" checked={srWholeWord} onChange={e => setSrWholeWord(e.target.checked)} />
            Helt ord
          </label>
          <span className="text-[10px] text-white/40 w-16">{srFind ? `${srCount} treff` : ''}</span>
          <button
            type="button"
            onClick={replaceAllInNode}
            disabled={srSaving || !srFind || srCount === 0}
            className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/30 text-emerald-300 hover:bg-emerald-500/50 hover:text-white transition-colors disabled:opacity-40"
            title="Erstatt alle forekomster og lagre (ingen agent)"
          >
            {srSaving ? 'Lagrer…' : `Erstatt alle${srCount ? ` (${srCount})` : ''}`}
          </button>
          {srMsg && <span className="text-[10px] text-white/50">{srMsg}</span>}
          <span className="ml-auto text-[9px] text-white/25">søk & erstatt · ingen agent</span>
        </div>
      )}
      {versions && (
        <div className="flex gap-1 px-3 py-1.5 border-b border-white/10 bg-slate-900/30 overflow-x-auto flex-shrink-0">
          {versions.map(v => (
            <button
              key={v.version}
              type="button"
              onClick={() => previewVersion(v.version)}
              disabled={loadingVersion}
              className={`text-[10px] px-2 py-0.5 rounded whitespace-nowrap transition-colors ${
                activeVersion === v.version
                  ? 'bg-sky-500/30 text-sky-300 border border-sky-500/40'
                  : 'text-white/40 hover:text-white hover:bg-white/10 border border-transparent'
              }`}
              title={v.timestamp || `Version ${v.version}`}
            >
              v{v.version}
            </button>
          ))}
        </div>
      )}
      <iframe
        ref={iframeRef}
        onLoad={handleIframeLoad}
        srcDoc={injectBridge(isEmailTpl && !visualEdit ? fillPreviewSampleVars(versionHtml || html, effPreviewVars) : (versionHtml || html), graphId, nodeId, userEmail)}
        sandbox="allow-scripts allow-forms allow-same-origin allow-modals allow-popups"
        className={`w-full bg-white border-0 ${consoleOpen ? 'flex-[3]' : 'flex-1'}`}
        title="HTML Preview"
      />
      {consoleOpen && (
        <div className="flex-1 min-h-[120px] max-h-[200px] border-t border-white/10 bg-slate-950 flex flex-col">
          <div className="px-2 py-1 border-b border-white/10 flex-shrink-0 flex items-center gap-2">
            <span className="text-[10px] text-white/30 font-mono">Console</span>
            {graphId && nodeId && (
              <span className="text-[9px] text-white/20 font-mono">graph: {graphId} | node: {nodeId}</span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-1 font-mono text-[11px]">
            {entries.length === 0 && (
              <div className="text-white/20 text-[10px] py-1">No output yet</div>
            )}
            {entries.map((entry, i) => {
              const style = LEVEL_STYLE[entry.level] || LEVEL_STYLE.log;
              const ctx = (entry.level === 'error' || entry.level === 'network') && entry.graphId && entry.nodeId
                ? ` [graphId: ${entry.graphId}, nodeId: ${entry.nodeId}]` : '';
              return (
                <div key={i} className={`${style.color} py-[1px] flex gap-1.5 leading-tight`}>
                  <span className="flex-shrink-0 w-3 text-center">{style.icon}</span>
                  <span className="break-all">{entry.message}{ctx}</span>
                </div>
              );
            })}
            <div ref={consoleEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}
