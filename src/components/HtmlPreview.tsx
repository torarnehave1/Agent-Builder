import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { formatHtmlForReading } from '../lib/format-html';

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

// --- Publishing (where is this node live + one-click publish) ----------------
// The agent-worker records the live host(s) onto the node's references/bibl as https://<host>/
// when publish_html_node succeeds. We read the node back and extract those hosts so the toolbar
// can show "where it's published" and default the publish target. Mirrors the host extraction in
// executePublishHtmlNode's wrong-host guard.
const AGENT_API = 'https://agent.vegvisr.org';

function getAuthToken(): string {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const canonical = JSON.parse(localStorage.getItem('vegvisr_user') || '{}');
    return user.emailVerificationToken || user.token || canonical.token || canonical.emailVerificationToken || '';
  } catch {
    return '';
  }
}

function hostFromRef(r: unknown): string {
  const s = String(r ?? '');
  try {
    return new URL(s).hostname.toLowerCase();
  } catch {
    return s.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
  }
}

interface NodeRefs { references?: unknown[]; bibl?: unknown[]; path?: string }
interface PublishGate { gate: boolean; gateRole?: string; gateAppName?: string; gateLogo?: string; gateLang?: string; gateRegisterMode?: string }
function extractPublishedHosts(node: NodeRefs | null | undefined): string[] {
  if (!node) return [];
  const src = [
    ...(Array.isArray(node.references) ? node.references : []),
    ...(Array.isArray(node.bibl) ? node.bibl : []),
    ...(node.path ? [node.path] : []),
  ];
  return [...new Set(src.map(hostFromRef).filter(h => h && h.includes('.') && !h.includes(' ')))];
}

// --- Visual "click-on-the-page" text editing --------------------------------
// The preview iframe runs same-origin, so we make every element that directly holds
// text contentEditable on click. Save re-parses the stored source and applies only the
// changed text blocks, so the page's structure, scripts, styles and runtime state are
// preserved — only edited text changes. No anchors needed.
//
// Identity, NOT document order (L49 — verified on treet.vegvisr.org: 74 text elements in
// the live DOM vs 23 in the source, diverging already at index 13). Pages build DOM at
// runtime (d3 pins, `card.innerHTML` + appendChild, panel rewrites), so a live-DOM index
// does not address the same element as a source index — matching by order either aborts
// the save or writes text into the wrong element. Instead the source elements are stamped
// with `data-v-src-idx` BEFORE the iframe renders them: every stamped element in the live
// DOM maps back to exactly one source element, and script-generated elements carry no
// stamp, so they are neither editable nor able to block a save.
const V_IDX = 'data-v-src-idx';   // per editable source element: its index in the source parse
const V_COUNT = 'data-v-src-count'; // on <html>: how many the stamping pass found (staleness check)

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
// inner text and no element is diffed twice on save. Deterministic for a given source
// string: the stamping pass and the save pass parse the same bytes and get the same list.
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
// (`data-v-editable` is the pre-stamping attribute — kept in the strip list so any HTML
// still carrying it round-trips clean.)
function cleanInner(s: string): string {
  return s
    .replace(/\s*contenteditable="(?:true|false)"/gi, '')
    .replace(new RegExp(`\\s*${V_IDX}="[^"]*"`, 'gi'), '')
    .replace(/\s*data-v-editable="[^"]*"/gi, '');
}

// Stamp every editable SOURCE element with its index, so the rendered page can be mapped
// back to the source element-by-element regardless of what the page's scripts do to the
// DOM at runtime. Only used for the edit-mode render; the bytes we save are always a fresh
// parse of the stored source, so no stamp ever reaches node.info.
function stampEditable(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const els = getEditableEls(doc.body || doc.documentElement);
  els.forEach((el, i) => el.setAttribute(V_IDX, String(i)));
  doc.documentElement.setAttribute(V_COUNT, String(els.length));
  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
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
  userId?: string;
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

// The preview iframe shares Agent-Builder's origin (allow-same-origin — the visual editor needs it),
// so a previewed page's own sign-out (vegvisr-auth, World member pages: removeItem('user'), …)
// deleted Agent-Builder's login and forced a new login on the next refresh (2026-09-22). Inside the
// preview, Agent-Builder's session keys are read-only; everything else in storage works as usual.
function buildStorageGuard(): string {
  return `<script>(function(){try{var keys={user:1,originalUser:1,vegvisr_user:1,userStore:1};var P=Storage.prototype,rm=P.removeItem,set=P.setItem,clr=P.clear;function own(s){try{return s===window.localStorage}catch(e){return false}}P.removeItem=function(k){if(own(this)&&keys[k])return;return rm.call(this,k)};P.setItem=function(k,v){if(own(this)&&keys[k])return;return set.call(this,k,v)};P.clear=function(){if(own(this)){for(var i=this.length-1;i>=0;i--){var k=this.key(i);if(!keys[k])rm.call(this,k)}return}return clr.call(this)}}catch(e){}})();</script>`;
}

function injectBridge(html: string, graphId?: string | null, nodeId?: string | null, userEmail?: string): string {
  // Storage guard, then the auth bridge, FIRST so they are in place before any page script runs.
  const bridge = buildStorageGuard() + buildAuthBridge(graphId, userEmail) + buildConsoleBridge(graphId, nodeId);
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

export default function HtmlPreview({ html, onClose, onConsoleErrors, onHtmlChange, graphId, nodeId, userId, userEmail, previewVars }: Props) {
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

  // Full-source editor (deterministic, no agent) — see the WHOLE page, edit it as text, or
  // paste a completely new page over it. The section editor above only reaches anchored
  // regions, and most pages carry no anchors at all; this reaches every byte of node.info.
  const [codeOpen, setCodeOpen] = useState(false);
  const [codeValue, setCodeValue] = useState('');
  // Finding anything in a 3.4 MB minified page meant scrolling a textarea by eye. Search is the
  // navigation: count the matches, step through them, and put the caret on each one.
  const codeAreaRef = useRef<HTMLTextAreaElement>(null);
  const [codeSearch, setCodeSearch] = useState('');
  const [codePretty, setCodePretty] = useState(false);
  const codeDisplay = useMemo(
    () => (codePretty ? formatHtmlForReading(codeValue) : codeValue),
    [codePretty, codeValue]
  );
  const [codeMatchIdx, setCodeMatchIdx] = useState(0);
  const codeMatches = useMemo(() => {
    const needle = codeSearch.toLowerCase();
    if (needle.length < 2) return [] as number[];
    const hay = codeDisplay.toLowerCase();
    const out: number[] = [];
    let at = hay.indexOf(needle);
    while (at !== -1 && out.length < 5000) { out.push(at); at = hay.indexOf(needle, at + needle.length); }
    return out;
  }, [codeSearch, codeDisplay]);
  const goToMatch = useCallback((which: number) => {
    if (!codeMatches.length) return;
    const wrapped = (which + codeMatches.length) % codeMatches.length;
    setCodeMatchIdx(wrapped);
    const area = codeAreaRef.current;
    if (!area) return;
    const start = codeMatches[wrapped];
    area.focus();
    area.setSelectionRange(start, start + codeSearch.length);
    // The source is one long minified line, so line-height maths does not apply; scroll by how far
    // into the text the match sits, then let the caret do the fine positioning.
    const ratio = codeDisplay.length ? start / codeDisplay.length : 0;
    area.scrollTop = Math.max(0, ratio * (area.scrollHeight - area.clientHeight) - area.clientHeight / 3);
  }, [codeMatches, codeSearch, codeDisplay]);
  const [codeSaving, setCodeSaving] = useState(false);
  const [codeMsg, setCodeMsg] = useState('');
  // A SNAPSHOT of the buffer rendered in the iframe without saving, so a pasted page can be
  // seen before it is written. A snapshot, not a live binding — typing must not re-render.
  const [codeDraft, setCodeDraft] = useState<string | null>(null);
  const codeLoadedRef = useRef<string>(''); // bytes last loaded into the buffer (dirty check)

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

  // Keep the source buffer on the bytes it is editing: load them when the panel opens, and
  // re-load when the stored HTML changes underneath (another panel saved, a version was
  // picked). Unsaved edits are never discarded — a touched buffer stays as it is, and the
  // user decides with «Hent på nytt».
  useEffect(() => {
    if (!codeOpen) return;
    const base = versionHtml || html || '';
    // Capture the ref BEFORE moving it: the updater below runs during the next render, so
    // reading `codeLoadedRef.current` inside it would read the value we just wrote and the
    // buffer would never adopt anything (verified in-browser: the panel opened empty).
    const loaded = codeLoadedRef.current;
    codeLoadedRef.current = base;
    setCodeValue(prev => (prev === loaded ? base : prev));
  }, [codeOpen, versionHtml, html]);

  // Visual "click-on-the-page" edit mode
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const baselineRef = useRef<string[]>([]); // clean innerHTML at load, keyed by SOURCE index (V_IDX)
  const [visualEdit, setVisualEdit] = useState(false);
  const [visualSaving, setVisualSaving] = useState(false);
  const [visualMsg, setVisualMsg] = useState('');

  // AI "✨ Enhance" over a text selection made inside a contentEditable block (visual edit
  // mode only). Mirrors the elaborate-text modal in vegvisr-frontend's GNewViewer.vue
  // (expand/question/template), but applies straight into the live DOM so it flows through
  // saveVisual()'s existing baseline-diff save — no separate save path needed.
  const enhanceRangeRef = useRef<Range | null>(null);
  const [enhanceSelText, setEnhanceSelText] = useState('');
  const [enhanceOpen, setEnhanceOpen] = useState(false);
  const enhanceOpenRef = useRef(false);
  enhanceOpenRef.current = enhanceOpen;
  const [enhanceMode, setEnhanceMode] = useState<'expand' | 'question' | 'template'>('expand');
  const [enhanceInstructions, setEnhanceInstructions] = useState('');
  const [enhanceQuestion, setEnhanceQuestion] = useState('');
  const [enhanceTemplateContent, setEnhanceTemplateContent] = useState('');
  const [enhancedText, setEnhancedText] = useState('');
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceMsg, setEnhanceMsg] = useState('');

  // What the iframe actually renders. Edit mode renders the STAMPED source so every text
  // block can be mapped back to the source on save; every other mode renders exactly what
  // it rendered before (email templates get their send-time placeholders filled in), so
  // normal previewing and publishing are byte-for-byte unaffected by the stamping.
  const previewHtml = useMemo(() => {
    if (codeDraft !== null) return codeDraft; // unsaved source draft — render it exactly as typed
    const base = versionHtml || html || '';
    if (!base) return base;
    if (visualEdit) {
      if (versionHtml) return versionHtml; // old version: read-only, saving is blocked
      try { return stampEditable(base); } catch { return base; } // no stamps → save says so
    }
    return isEmailTpl ? fillPreviewSampleVars(base, effPreviewVars) : base;
  }, [codeDraft, versionHtml, html, visualEdit, isEmailTpl, effPreviewVars]);

  // Publishing — where the node is live + one-click publish/republish.
  const [publishedHosts, setPublishedHosts] = useState<string[]>([]);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishHost, setPublishHost] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState('');
  const [publishNeedsSubdomain, setPublishNeedsSubdomain] = useState(false);
  // Host the node is not linked to (e.g. a copy of the test page going to minside): the server's
  // wrong-host guard refuses; a person choosing the host here may confirm it deliberately.
  const [publishNeedsForce, setPublishNeedsForce] = useState<string | null>(null);
  // Login gate per host, as stored on node.metadata.publishGate by publish_html_node.
  const [storedGates, setStoredGates] = useState<Record<string, PublishGate>>({});
  const [gateOn, setGateOn] = useState(false);
  const [gateLang, setGateLang] = useState('nb');
  const [gateAppName, setGateAppName] = useState('');
  const [gateLogo, setGateLogo] = useState('');

  // Read the node's recorded live host(s) from references/bibl whenever the pinned node changes.
  const loadPublishedHosts = useCallback(async () => {
    if (!graphId || !nodeId) { setPublishedHosts([]); return; }
    try {
      const res = await fetch(`https://knowledge.vegvisr.org/getknowgraph?id=${encodeURIComponent(graphId)}`);
      if (!res.ok) return;
      const data = await res.json();
      const node = (data.nodes || []).find((n: { id: string }) => n.id === nodeId);
      setPublishedHosts(extractPublishedHosts(node));
      const pg = node?.metadata?.publishGate;
      setStoredGates(pg && typeof pg === 'object' ? pg : {});
    } catch { /* non-fatal — publish still works, just no prefill */ }
  }, [graphId, nodeId]);

  useEffect(() => { loadPublishedHosts(); }, [loadPublishedHosts]);

  // When the publish panel opens, default the target to the node's current live host.
  useEffect(() => {
    if (publishOpen && !publishHost) setPublishHost(publishedHosts[0] || '');
  }, [publishOpen, publishedHosts, publishHost]);

  // The checkbox mirrors what is stored for the target host, so Republiser keeps the gate.
  const publishHostKey = publishHost.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  useEffect(() => {
    const g = storedGates[publishHostKey];
    setGateOn(!!g?.gate);
    setGateLang(g?.gateLang || 'nb');
    setGateAppName(g?.gateAppName || '');
    setGateLogo(g?.gateLogo || '');
  }, [publishHostKey, storedGates]);

  const runPublish = async (host: string, force = false) => {
    const target = host.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!target || !target.includes('.')) {
      setPublishMsg('Skriv et gyldig vertsnavn, f.eks. universi.vegvisr.org');
      return;
    }
    setPublishing(true);
    setPublishMsg('Publiserer…');
    setPublishNeedsSubdomain(false);
    setPublishNeedsForce(null);
    try {
      const res = await fetch(`${AGENT_API}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graphId, nodeId, host: target, force, userId, userEmail, authToken: getAuthToken(),
          // Explicit on every UI publish: the checkbox shows the stored state, so this keeps it.
          // Role/app-name/logo/register-mode set by the agent are carried over from the stored gate.
          gate: gateOn,
          ...(gateOn ? { ...storedGates[target], gate: true, gateLang, gateAppName: gateAppName.trim(), gateLogo: gateLogo.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        setPublishMsg(`Publisert · ${target} er live · ${gateOn ? 'innlogging kreves' : 'åpen for alle'}`);
        setPublishNeedsSubdomain(false);
        loadPublishedHosts();
        return;
      }
      const err = String(data?.error || `HTTP ${res.status}`);
      // Host isn't routed to brand-worker yet → offer to create the subdomain then retry.
      if (/create_subdomain|does not route|create it first|route to brand-worker/i.test(err)) {
        setPublishNeedsSubdomain(true);
        setPublishMsg(`${target} finnes ikke som vert ennå — opprett subdomenet først.`);
      } else if (!force && Array.isArray(data?.associatedHosts) && data.associatedHosts.length) {
        setPublishNeedsForce(target);
        setPublishMsg(`Denne noden er knyttet til ${data.associatedHosts.join(', ')}. Vil du publisere den til ${target}?`);
      } else {
        setPublishMsg(err);
      }
    } catch (e) {
      setPublishMsg(`Publisering feilet: ${(e as Error).message}`);
    } finally {
      setPublishing(false);
    }
  };

  const createSubdomainAndPublish = async () => {
    const target = publishHost.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const [subdomain, ...rest] = target.split('.');
    const root_domain = rest.join('.');
    if (!subdomain || !root_domain.includes('.')) {
      setPublishMsg('Kan ikke utlede subdomene + rotdomene fra vertsnavnet.');
      return;
    }
    setPublishing(true);
    setPublishMsg(`Oppretter ${target}…`);
    try {
      const res = await fetch(`${AGENT_API}/create-subdomain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subdomain, root_domain, authToken: getAuthToken() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setPublishMsg(String(data?.error || `Kunne ikke opprette subdomenet (HTTP ${res.status})`));
        setPublishing(false);
        return;
      }
      // Route exists — publish via the brand-worker binding works immediately (no DNS wait).
      setPublishNeedsSubdomain(false);
      await runPublish(target);
    } catch (e) {
      setPublishMsg(`Opprettelse feilet: ${(e as Error).message}`);
      setPublishing(false);
    }
  };

  // Stable click handler (attached to the iframe document while in edit mode).
  // Change detection is NOT event-based — save() diffs the live DOM against a
  // baseline captured at load, so any edit is caught regardless of keystroke events.
  const handlersRef = useRef({
    click: (e: Event) => {
      const el = (e.target as Element)?.closest?.(`[${V_IDX}]`) as HTMLElement | null;
      if (!el) return; // non-source text (script-generated cards, tab buttons, …) passes through
      e.preventDefault();
      e.stopPropagation();
      el.setAttribute('contenteditable', 'true');
      el.focus();
    },
  });

  // Tracks a non-collapsed selection that lives fully inside one contentEditable block, so
  // the "✨ Enhance" button knows what to send and applyEnhancedText() knows what to replace.
  // A stale Range (element re-rendered, iframe reloaded) simply fails silently on apply —
  // guarded there with try/catch.
  const handleSelectionChange = useCallback(() => {
    // While the panel is open the user is typing instructions in the parent document; keep the
    // captured selection even if the iframe's own selection collapses meanwhile.
    if (enhanceOpenRef.current) return;
    const doc = iframeRef.current?.contentDocument;
    const sel = doc?.getSelection();
    const clear = () => { enhanceRangeRef.current = null; setEnhanceSelText(''); };
    if (!doc || !sel || sel.isCollapsed || sel.rangeCount === 0) return clear();
    const text = sel.toString().trim();
    if (!text) return clear();
    const range = sel.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const elNode = (container.nodeType === 1 ? (container as Element) : container.parentElement) as Element | null;
    // A stamped source block, not only an already-opened one: a drag-select fires selectionchange
    // BEFORE the click that sets contenteditable. Open it here so saveVisual() includes it.
    const host = elNode?.closest(`[${V_IDX}]`) as HTMLElement | null;
    if (!host) return clear();
    host.setAttribute('contenteditable', 'true');
    enhanceRangeRef.current = range.cloneRange();
    setEnhanceSelText(text);
  }, []);

  const enableVisualEdit = useCallback((doc: Document | null | undefined) => {
    if (!doc || !doc.documentElement) return;
    if (!doc.getElementById('__v_edit_style__')) {
      const st = doc.createElement('style');
      st.id = '__v_edit_style__';
      st.textContent = `[${V_IDX}]{outline:1px dashed rgba(249,115,22,.55);outline-offset:2px;cursor:text}[${V_IDX}]:hover{outline:2px solid rgba(249,115,22,.95)}[contenteditable="true"]{outline:2px solid #22c55e!important;background:rgba(34,197,94,.06)}`;
      doc.head?.appendChild(st);
    }
    // Every stamped element — i.e. every text block that exists in the SOURCE — becomes
    // editable, and its clean innerHTML at this moment is the baseline save() diffs
    // against, keyed by the stamped source index (not by position in the live DOM).
    const base: string[] = [];
    doc.querySelectorAll(`[${V_IDX}]`).forEach(el => {
      const i = Number(el.getAttribute(V_IDX));
      if (Number.isInteger(i)) base[i] = cleanInner(el.innerHTML);
    });
    baselineRef.current = base;
    doc.addEventListener('click', handlersRef.current.click, true);
    doc.addEventListener('selectionchange', handleSelectionChange);
  }, [handleSelectionChange]);

  const disableVisualEdit = useCallback((doc: Document | null | undefined) => {
    if (!doc) return;
    doc.removeEventListener('click', handlersRef.current.click, true);
    doc.removeEventListener('selectionchange', handleSelectionChange);
    doc.getElementById('__v_edit_style__')?.remove();
    // The stamps themselves stay — they come from the rendered srcDoc, not from here, and
    // leaving edit mode re-renders the iframe from the unstamped source anyway.
    doc.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));
  }, [handleSelectionChange]);

  // Re-apply / remove edit mode whenever it toggles (on the current iframe doc).
  useEffect(() => {
    const doc = iframeRef.current?.contentDocument;
    if (visualEdit) enableVisualEdit(doc);
    else {
      disableVisualEdit(doc);
      baselineRef.current = [];
      setVisualMsg('');
      enhanceRangeRef.current = null;
      setEnhanceSelText('');
      setEnhanceOpen(false);
      setEnhancedText('');
      setEnhanceMsg('');
    }
  }, [visualEdit, enableVisualEdit, disableVisualEdit]);

  // Fired on every iframe (re)load — re-arm edit mode if it's on. A reload replaces every DOM
  // node, so any Range from before it is stale — drop the selection rather than let Apply
  // silently target detached nodes.
  const handleIframeLoad = () => {
    if (visualEdit) enableVisualEdit(iframeRef.current?.contentDocument);
    enhanceRangeRef.current = null;
    setEnhanceSelText('');
    setEnhanceOpen(false);
    setEnhancedText('');
  };

  const saveVisual = async () => {
    if (!graphId || !nodeId || !html) return;
    if (versionHtml) { setVisualMsg('Avslutt versjonsvisningen før du lagrer'); return; }
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    setVisualSaving(true);
    setVisualMsg('');
    try {
      // Apply ONLY the edited blocks onto a FRESH parse of the source. Re-parsing the
      // stored source (not the runtime DOM) means the page's structure, scripts, styles
      // and runtime state (active tab, inline display) are preserved — only edited text
      // changes. Each live block addresses its source element through its own stamp, so
      // script-generated DOM is simply absent from this loop instead of derailing it.
      const src = new DOMParser().parseFromString(html, 'text/html');
      const srcEls = getEditableEls(src.body || src.documentElement);
      const stamped = Array.from(doc.querySelectorAll(`[${V_IDX}]`));
      if (stamped.length === 0) {
        setVisualMsg('Redigering ikke aktiv på denne visningen — slå av og på «Rediger»'); setVisualSaving(false); return;
      }
      // The only way indices can be wrong now is if `html` changed after the iframe was
      // rendered (a save from another panel, a restored version). The stamped count says
      // what the render was built from; a mismatch means re-render before touching text.
      const stampedFrom = Number(doc.documentElement.getAttribute(V_COUNT));
      if (!Number.isInteger(stampedFrom) || stampedFrom !== srcEls.length) {
        setVisualMsg('Siden er endret siden den ble lastet — last den på nytt'); setVisualSaving(false); return;
      }
      let changed = false;
      for (const el of stamped) {
        // Only blocks the user actually opened (click sets contenteditable) are candidates.
        // Without this, a script that rewrites its own element after load — a theme toggle
        // swapping its label, a panel re-rendering — would be diffed as a "user edit" and
        // written into the stored source.
        if (!el.hasAttribute('contenteditable')) continue;
        const i = Number(el.getAttribute(V_IDX));
        if (!Number.isInteger(i) || !srcEls[i]) continue;
        const cur = cleanInner(el.innerHTML);
        if (cur === baselineRef.current[i]) continue;
        srcEls[i].innerHTML = cur;
        changed = true;
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

  const enhanceCanGenerate =
    enhanceMode === 'expand' ? !!enhanceInstructions.trim()
    : enhanceMode === 'question' ? !!enhanceQuestion.trim()
    : !!enhanceTemplateContent.trim();

  const runEnhance = async () => {
    if (!enhanceSelText || !enhanceCanGenerate) return;
    setEnhancing(true);
    setEnhanceMsg('');
    setEnhancedText('');
    try {
      const res = await fetch(`${AGENT_API}/enhance-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedText: enhanceSelText,
          mode: enhanceMode,
          instructions: enhanceMode === 'expand' ? enhanceInstructions : undefined,
          question: enhanceMode === 'question' ? enhanceQuestion : undefined,
          templateContent: enhanceMode === 'template' ? enhanceTemplateContent : undefined,
          documentContext: (html || '').replace(/<[^>]*>/g, ' ').slice(0, 2000),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.enhancedText) {
        setEnhanceMsg(data?.error || `Feilet (${res.status})`);
        setEnhancing(false);
        return;
      }
      setEnhancedText(data.enhancedText);
    } catch (e) {
      setEnhanceMsg(e instanceof Error ? e.message : 'Feil');
    } finally {
      setEnhancing(false);
    }
  };

  // Replaces the ORIGINAL selection in the live DOM with the AI text — nothing is saved here.
  // The edited block already carries contenteditable from the click that started the
  // selection, so saveVisual()'s baseline diff picks this up exactly like a manual edit.
  const applyEnhancedText = () => {
    const range = enhanceRangeRef.current;
    const doc = iframeRef.current?.contentDocument;
    if (!range || !enhancedText || !doc) return;
    try {
      range.deleteContents();
      range.insertNode(doc.createTextNode(enhancedText));
      doc.getSelection()?.removeAllRanges();
    } catch {
      setVisualMsg('Kunne ikke sette inn — siden har endret seg, prøv å velge teksten på nytt');
      return;
    }
    enhanceRangeRef.current = null;
    setEnhanceSelText('');
    setEnhancedText('');
    setEnhanceOpen(false);
    setVisualMsg('AI-tekst satt inn — husk å trykke «Lagre»');
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

  // One deterministic write of the node's whole `info`, with the optimistic-version dance the
  // other panels do inline (read version → patch → on 409 re-read the version and retry once).
  const patchNodeInfo = async (
    newHtml: string,
  ): Promise<{ ok: true; version: number } | { ok: false; error: string }> => {
    if (!graphId || !nodeId) return { ok: false, error: 'Ingen node valgt' };
    const gRes = await fetch(`https://knowledge.vegvisr.org/getknowgraph?id=${encodeURIComponent(graphId)}`);
    if (!gRes.ok) return { ok: false, error: 'Lesing feilet' };
    const g = await gRes.json();
    const miss = nodeMissingMsg(g, nodeId, graphId);
    if (miss) return { ok: false, error: miss };
    const headers = {
      'Content-Type': 'application/json',
      'x-user-role': 'Superadmin',
      ...(userEmail ? { 'x-user-email': userEmail } : {}),
    };
    const put = (expectedVersion: number) =>
      fetch('https://knowledge.vegvisr.org/patchNode', {
        method: 'POST',
        headers,
        body: JSON.stringify({ graphId, nodeId, fields: { info: newHtml }, expectedVersion }),
      });
    let res = await put(Number(g?.metadata?.version || 0));
    if (res.status === 409) {
      const latest = await (await fetch(`https://knowledge.vegvisr.org/getknowgraph?id=${encodeURIComponent(graphId)}`)).json();
      res = await put(Number(latest?.metadata?.version || 0));
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) return { ok: false, error: String(data?.error || `Lagring feilet (${res.status})`) };
    return { ok: true, version: Number(data.newVersion) };
  };

  // Write the ENTIRE buffer as the node's HTML — an edit of the whole page, or a paste that
  // replaces it outright. Refuses an empty buffer: that is a mis-paste, never an intent.
  const saveCode = async () => {
    if (!graphId || !nodeId) { setCodeMsg('Ikke knyttet til en node — kan ikke lagre'); return; }
    if (versionHtml) { setCodeMsg('Avslutt versjonsvisningen før du lagrer'); return; }
    const next = codeValue;
    if (next === html) { setCodeMsg('Ingen endring'); return; }
    if (next.trim() === '') { setCodeMsg('Tom kildekode — avbrutt'); return; }
    setCodeSaving(true);
    setCodeMsg('');
    try {
      const r = await patchNodeInfo(next);
      if (!r.ok) { setCodeMsg(r.error); return; }
      codeLoadedRef.current = next;
      setCodeDraft(null); // the saved bytes are what the iframe renders from here on
      onHtmlChange?.(next);
      setCodeMsg(`Lagret · v${r.version}`);
    } catch (e) {
      setCodeMsg(e instanceof Error ? e.message : 'Lagringsfeil');
    } finally {
      setCodeSaving(false);
    }
  };

  const reloadCode = () => {
    const base = versionHtml || html || '';
    setCodeValue(base);
    codeLoadedRef.current = base;
    setCodeDraft(null);
    setCodeMsg('Hentet på nytt fra grafen');
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(codeValue);
      setCodeMsg('Kopiert til utklippstavlen');
    } catch {
      setCodeMsg('Kunne ikke kopiere — merk teksten og kopier manuelt');
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
    setVisualEdit(false); // an old version is not what a save would write to — leave edit mode
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

  // A component on the page that saves ITSELF (theme-picker "Save theme") changes the stored node
  // behind this preview. Re-read the node so the preview, the code panel and the visual editor's
  // baseline follow the saved bytes — otherwise the next visual-edit save writes the stale copy back
  // and silently undoes the component's save.
  useEffect(() => {
    const onNodeSaved = async (e: MessageEvent) => {
      const d = e.data;
      if (!d || d.type !== 'vegvisr:node-saved' || !graphId || !nodeId) return;
      if (d.nodeId !== nodeId || (d.graphId && d.graphId !== graphId)) return;
      try {
        const res = await fetch(`https://knowledge.vegvisr.org/getknowgraph?id=${encodeURIComponent(graphId)}`, { cache: 'no-store' });
        if (!res.ok) return;
        const g = await res.json();
        const node = (g.nodes || []).find((n: { id: string }) => n.id === nodeId);
        if (node && typeof node.info === 'string' && node.info !== html) onHtmlChange?.(node.info);
      } catch { /* the save itself already succeeded; the preview just stays as it is */ }
    };
    window.addEventListener('message', onNodeSaved);
    return () => window.removeEventListener('message', onNodeSaved);
  }, [graphId, nodeId, html, onHtmlChange]);

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
  const codeDirty = codeOpen && codeValue !== (versionHtml || html || '');

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="flex items-center justify-between px-3 h-[36px] border-b border-white/10 bg-slate-900/50 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-white/50 flex-shrink-0">Preview</span>
          {/* Where this node is live — read from the node's recorded host(s). */}
          {publishedHosts.length > 0 && activeVersion === null && (
            <span className="flex items-center gap-1 min-w-0" title="Live på">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
              {publishedHosts.slice(0, 2).map(h => (
                <a
                  key={h}
                  href={`https://${h}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="text-[10px] text-emerald-300 hover:text-emerald-100 hover:underline truncate max-w-[160px]"
                >
                  {h} ↗
                </a>
              ))}
              {publishedHosts.length > 2 && (
                <span className="text-[10px] text-white/30">+{publishedHosts.length - 2}</span>
              )}
            </span>
          )}
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
              onClick={() => { setVisualEdit(v => !v); if (editOpen) setEditOpen(false); setCodeOpen(false); setCodeDraft(null); }}
              className={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors ${visualEdit ? 'bg-orange-500/40 text-orange-200' : 'bg-orange-500/15 text-orange-300 hover:bg-orange-500/30'}`}
              title="Rediger tekst ved å klikke direkte på siden (ingen agent)"
            >
              {visualEdit ? '● Rediger av' : '✎ Rediger'}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              const next = !codeOpen;
              setCodeOpen(next);
              if (!next) setCodeDraft(null);
              setVisualEdit(false); setEditOpen(false); setSrOpen(false);
            }}
            className={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors ${codeOpen ? 'bg-violet-500/40 text-violet-100' : 'bg-violet-500/15 text-violet-300 hover:bg-violet-500/30'}`}
            title="Vis og rediger hele HTML-kilden — eller lim inn en helt ny side"
          >
            {'</> Kildekode'}
          </button>
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
          {graphId && nodeId && activeVersion === null && !isEmailTpl && (
            <button
              type="button"
              onClick={() => { setPublishOpen(p => !p); setVisualEdit(false); setEditOpen(false); setSrOpen(false); }}
              className={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors ${publishOpen ? 'bg-emerald-500/40 text-emerald-100' : 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/30'}`}
              title="Publiser denne siden til et live domene"
            >
              ⬆ Publiser
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
      {publishOpen && (
        <div className="px-3 py-2 border-b border-white/10 bg-emerald-950/30 flex-shrink-0 flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-emerald-200/80 flex-shrink-0">Publiser til vert</span>
            <input
              type="text"
              value={publishHost}
              onChange={e => { setPublishHost(e.target.value); setPublishNeedsSubdomain(false); }}
              onKeyDown={e => { if (e.key === 'Enter' && !publishing) runPublish(publishHost); }}
              placeholder="f.eks. universi.vegvisr.org"
              spellCheck={false}
              className="text-[11px] bg-slate-800 text-white/90 border border-white/10 rounded px-2 py-0.5 min-w-[220px] focus:outline-none focus:border-emerald-500/50"
            />
            <button
              type="button"
              onClick={() => runPublish(publishHost)}
              disabled={publishing || !publishHost.trim()}
              className="text-[11px] px-2.5 py-0.5 rounded bg-emerald-500/30 text-emerald-100 hover:bg-emerald-500/50 hover:text-white transition-colors disabled:opacity-40 font-medium"
            >
              {publishing ? 'Publiserer…' : (publishedHosts.includes(publishHost.trim().toLowerCase()) ? 'Republiser' : 'Publiser')}
            </button>
            <label className="flex items-center gap-1 text-[11px] text-emerald-100/80 select-none cursor-pointer" title="Hele siden krever innlogging (vegvisr-auth login-kort)">
              <input type="checkbox" checked={gateOn} onChange={e => setGateOn(e.target.checked)} />
              Krev innlogging
            </label>
            {gateOn && (
              <select
                value={gateLang}
                onChange={e => setGateLang(e.target.value)}
                className="text-[11px] bg-slate-800 text-white/80 border border-white/10 rounded px-1.5 py-0.5"
                title="Språk på innloggingskortet"
              >
                <option value="nb">Norsk</option>
                <option value="en">English</option>
              </select>
            )}
            {publishNeedsSubdomain && (
              <button
                type="button"
                onClick={createSubdomainAndPublish}
                disabled={publishing}
                className="text-[11px] px-2.5 py-0.5 rounded bg-sky-500/30 text-sky-100 hover:bg-sky-500/50 hover:text-white transition-colors disabled:opacity-40 font-medium"
              >
                Opprett subdomene og publiser
              </button>
            )}
            {publishNeedsForce && (
              <button
                type="button"
                onClick={() => runPublish(publishNeedsForce, true)}
                disabled={publishing}
                className="text-[11px] px-2.5 py-0.5 rounded bg-amber-500/30 text-amber-100 hover:bg-amber-500/50 hover:text-white transition-colors disabled:opacity-40 font-medium"
              >
                Publiser likevel til {publishNeedsForce}
              </button>
            )}
            {publishedHosts.length > 0 && (
              <span className="ml-auto text-[9px] text-white/30">
                live: {publishedHosts.join(', ')}
              </span>
            )}
          </div>
          {gateOn && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-emerald-200/60 flex-shrink-0">Innloggingskort</span>
              <input
                type="text"
                value={gateAppName}
                onChange={e => setGateAppName(e.target.value)}
                placeholder="Navn på kortet (standard: Vegvisr)"
                title="Vises som «Welcome to …» / «Velkommen til …» på innloggingskortet"
                className="text-[11px] bg-slate-800 text-white/90 border border-white/10 rounded px-2 py-0.5 min-w-[200px] focus:outline-none focus:border-emerald-500/50"
              />
              <input
                type="text"
                value={gateLogo}
                onChange={e => setGateLogo(e.target.value)}
                placeholder="Logo-URL (https://…)"
                spellCheck={false}
                className="text-[11px] bg-slate-800 text-white/90 border border-white/10 rounded px-2 py-0.5 min-w-[240px] focus:outline-none focus:border-emerald-500/50"
              />
              {/^https:\/\//.test(gateLogo.trim()) && (
                <img src={gateLogo.trim()} alt="" className="h-6 w-6 rounded object-cover border border-white/10" />
              )}
            </div>
          )}
          {publishMsg && <span className="text-[11px] text-white/70">{publishMsg}</span>}
        </div>
      )}
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
          <button
            type="button"
            onClick={() => setEnhanceOpen(o => !o)}
            disabled={!enhanceSelText && !enhanceOpen}
            className={`text-[11px] px-2.5 py-0.5 rounded font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${enhanceOpen ? 'bg-fuchsia-500/40 text-fuchsia-100' : 'bg-fuchsia-500/20 text-fuchsia-300 hover:bg-fuchsia-500/40'}`}
            title={enhanceSelText ? 'Forbedre den valgte teksten med AI' : 'Merk en tekst i siden først'}
          >
            ✨ AI
          </button>
          {!enhanceSelText && !enhanceOpen && (
            <span className="text-[10px] text-white/35">merk tekst for AI-hjelp</span>
          )}
          {visualMsg && <span className="text-[11px] text-white/60">{visualMsg}</span>}
          <span className="ml-auto text-[9px] text-white/25">visuell redigering · ingen agent</span>
        </div>
      )}
      {visualEdit && enhanceOpen && (
        <div className="px-3 py-2 border-b border-white/10 bg-fuchsia-950/25 flex-shrink-0 flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-white/40 flex-shrink-0">Valgt tekst:</span>
            <span className="text-[10px] text-white/70 italic truncate max-w-[320px]">
              "{enhanceSelText.length > 100 ? enhanceSelText.slice(0, 100) + '…' : enhanceSelText}"
            </span>
            <select
              value={enhanceMode}
              onChange={e => { setEnhanceMode(e.target.value as typeof enhanceMode); setEnhancedText(''); setEnhanceMsg(''); }}
              className="text-[11px] bg-slate-800 text-white/80 border border-white/10 rounded px-1.5 py-0.5"
            >
              <option value="expand">Utvid tekst</option>
              <option value="question">Still spørsmål</option>
              <option value="template">Bruk som mal</option>
            </select>
            <button
              type="button"
              onClick={() => { setEnhanceOpen(false); setEnhancedText(''); setEnhanceMsg(''); }}
              className="ml-auto text-[10px] text-white/40 hover:text-white"
            >
              Lukk
            </button>
          </div>
          {enhanceMode === 'expand' && (
            <textarea
              value={enhanceInstructions}
              onChange={e => setEnhanceInstructions(e.target.value)}
              spellCheck={false}
              placeholder="F.eks. «legg til et eksempel», «gjør det mer muntlig», «legg til faglig belegg»…"
              className="w-full h-14 bg-slate-950 text-white/85 border border-white/10 rounded px-2 py-1 text-[11px] resize-y"
            />
          )}
          {enhanceMode === 'question' && (
            <textarea
              value={enhanceQuestion}
              onChange={e => setEnhanceQuestion(e.target.value)}
              spellCheck={false}
              placeholder="F.eks. «Hva mangler her?», «Er dette for bastant?»…"
              className="w-full h-14 bg-slate-950 text-white/85 border border-white/10 rounded px-2 py-1 text-[11px] resize-y"
            />
          )}
          {enhanceMode === 'template' && (
            <textarea
              value={enhanceTemplateContent}
              onChange={e => setEnhanceTemplateContent(e.target.value)}
              spellCheck={false}
              placeholder="Nytt innhold/tema som skal formateres med samme struktur som den valgte teksten…"
              className="w-full h-14 bg-slate-950 text-white/85 border border-white/10 rounded px-2 py-1 text-[11px] resize-y"
            />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={runEnhance}
              disabled={enhancing || !enhanceCanGenerate}
              className="text-[11px] px-2.5 py-0.5 rounded bg-fuchsia-500/30 text-fuchsia-200 hover:bg-fuchsia-500/50 hover:text-white transition-colors disabled:opacity-40 font-medium"
            >
              {enhancing ? 'Genererer…' : 'Generer'}
            </button>
            {enhanceMsg && <span className="text-[11px] text-white/60">{enhanceMsg}</span>}
          </div>
          {enhancedText && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-white/40">AI-forslag:</span>
              <div className="text-[11px] text-white/85 bg-slate-950 border border-white/10 rounded px-2 py-1.5 max-h-32 overflow-y-auto whitespace-pre-wrap">
                {enhancedText}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={applyEnhancedText}
                  className="text-[11px] px-2.5 py-0.5 rounded bg-emerald-500/30 text-emerald-200 hover:bg-emerald-500/50 hover:text-white transition-colors font-medium"
                >
                  Sett inn
                </button>
                <span className="text-[9px] text-white/25">erstatter valgt tekst · husk «Lagre» etterpå</span>
              </div>
            </div>
          )}
        </div>
      )}
      {codeOpen && (
        <div className="px-3 py-2 border-b border-white/10 bg-violet-950/25 flex-shrink-0 flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-white/40">
              Hele siden{activeVersion !== null ? ` · v${activeVersion} (skrivebeskyttet)` : ''} · {codeValue.length} tegn
            </span>
            {codeDirty && <span className="text-[10px] text-amber-400">● ulagret</span>}
            <button
              type="button"
              onClick={saveCode}
              disabled={codeSaving || !graphId || !nodeId || activeVersion !== null || !codeDirty}
              className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/30 text-emerald-200 hover:bg-emerald-500/50 hover:text-white transition-colors disabled:opacity-40 font-medium"
              title="Skriv hele denne HTML-en til noden (ingen agent)"
            >
              {codeSaving ? 'Lagrer…' : 'Lagre hele siden'}
            </button>
            <button
              type="button"
              onClick={() => setCodeDraft(codeDraft === null ? codeValue : null)}
              className={`text-[10px] px-2 py-0.5 rounded transition-colors ${codeDraft !== null ? 'bg-sky-500/40 text-sky-100' : 'bg-sky-500/15 text-sky-300 hover:bg-sky-500/30'}`}
              title="Rendre utkastet i forhåndsvisningen uten å lagre det"
            >
              {codeDraft !== null ? 'Vis lagret igjen' : 'Prøv uten å lagre'}
            </button>
            <button
              type="button"
              onClick={reloadCode}
              className="text-[10px] px-2 py-0.5 rounded text-white/50 hover:text-white hover:bg-white/10 transition-colors"
              title="Forkast endringene i feltet og hent bytene fra grafen på nytt"
            >
              Hent på nytt
            </button>
            <button
              type="button"
              onClick={() => setCodePretty(v => !v)}
              className={`text-[10px] px-2 py-0.5 rounded transition-colors ${codePretty ? 'bg-violet-500/40 text-violet-100' : 'bg-violet-500/15 text-violet-300 hover:bg-violet-500/30'}`}
              title="Vis kilden med innrykk og linjeskift. Kun visning — lagring skriver alltid de opprinnelige bytene."
            >
              {codePretty ? 'Vis original' : 'Formater for lesing'}
            </button>
            <button
              type="button"
              onClick={copyCode}
              className="text-[10px] px-2 py-0.5 rounded text-white/50 hover:text-white hover:bg-white/10 transition-colors"
              title="Kopier hele kilden til utklippstavlen"
            >
              Kopier
            </button>
            {codeMsg && <span className="text-[10px] text-white/60">{codeMsg}</span>}
            <span className="ml-auto text-[9px] text-white/25">hele kilden · ingen agent</span>
          </div>
          {(!graphId || !nodeId) && (
            <span className="text-[10px] text-amber-300/70">
              Ikke knyttet til en node — kun visning. Åpne siden med «Develop» for å kunne lagre.
            </span>
          )}
          <div className="flex items-center gap-2">
            <input
              value={codeSearch}
              onChange={e => { setCodeSearch(e.target.value); setCodeMatchIdx(0); }}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); goToMatch(e.shiftKey ? codeMatchIdx - 1 : codeMatchIdx + (codeMatches.length && codeMatchIdx === 0 ? 0 : 1)); }
                if (e.key === 'Escape') { setCodeSearch(''); codeAreaRef.current?.focus(); }
              }}
              spellCheck={false}
              placeholder="Søk i kilden — Enter for neste, Shift+Enter for forrige"
              className="flex-1 min-w-[180px] bg-slate-950 text-white/85 border border-white/10 rounded px-2 py-1 font-mono text-[11px]"
            />
            <span className="text-[10px] text-white/40 tabular-nums whitespace-nowrap">
              {codeSearch.length < 2 ? 'skriv 2+ tegn' : codeMatches.length ? `${codeMatchIdx + 1} / ${codeMatches.length}${codeMatches.length === 5000 ? '+' : ''}` : 'ingen treff'}
            </span>
            <button
              type="button"
              onClick={() => goToMatch(codeMatchIdx - 1)}
              disabled={!codeMatches.length}
              className="text-[10px] px-2 py-0.5 rounded text-white/50 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30"
              title="Forrige treff (Shift+Enter)"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => goToMatch(codeMatchIdx + 1)}
              disabled={!codeMatches.length}
              className="text-[10px] px-2 py-0.5 rounded text-white/50 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30"
              title="Neste treff (Enter)"
            >
              ↓
            </button>
          </div>
          {codePretty && (
            <span className="text-[10px] text-violet-300/70">
              Formatert for lesing — skrivebeskyttet. Søket gjelder denne visningen; «Lagre hele siden» skriver alltid originalen.
            </span>
          )}
          <textarea
            ref={codeAreaRef}
            value={codeDisplay}
            readOnly={codePretty}
            onChange={e => { if (codePretty) return; setCodeValue(e.target.value); if (codeMsg) setCodeMsg(''); }}
            onKeyDown={e => {
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveCode(); }
              // Cmd/Ctrl+F inside the source goes to THIS search, not the browser's — the browser
              // cannot see text inside a textarea's scrollback anyway.
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
                e.preventDefault();
                const sel = e.currentTarget.value.slice(e.currentTarget.selectionStart, e.currentTarget.selectionEnd);
                if (sel && sel.length <= 80) { setCodeSearch(sel); setCodeMatchIdx(0); }
                (e.currentTarget.parentElement?.querySelector('input') as HTMLInputElement | null)?.focus();
              }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); goToMatch(codeMatchIdx + 1); }
            }}
            spellCheck={false}
            wrap="soft"
            className="w-full h-[38vh] min-h-[160px] bg-slate-950 text-white/85 border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] leading-snug resize-y"
            placeholder="Hele HTML-kilden for denne noden — rediger, eller lim inn en helt ny side…"
          />
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
        srcDoc={injectBridge(previewHtml, graphId, nodeId, userEmail)}
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
