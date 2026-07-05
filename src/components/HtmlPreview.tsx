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

// --- Visual "click-on-the-page" text editing --------------------------------
// The preview iframe runs same-origin, so we can make text blocks inside anchor
// sections contentEditable and read the edited section back from the live DOM.
// Block-level text elements only, so tab buttons and layout containers stay
// untouched. Saving is still SECTION-SCOPED (only the edited section's inner HTML
// is spliced into the source string) — never a whole-document re-serialize.
const V_EDITABLE_SEL = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption';
const V_ATTR = 'data-v-editable';

// Serialize the live DOM content of one anchor section (nodes between the
// start/end comment markers, which are siblings inside the section element).
function getLiveSectionInner(doc: Document, id: string): string | null {
  const walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_COMMENT);
  const startRe = new RegExp(`^\\s*edit:${id}:start\\s*$`);
  const endRe = new RegExp(`^\\s*edit:${id}:end\\s*$`);
  let startNode: Comment | null = null;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const d = (n as Comment).data;
    if (!startNode && startRe.test(d)) { startNode = n as Comment; continue; }
    if (startNode && endRe.test(d)) {
      let out = '';
      let cur: Node | null = startNode.nextSibling;
      while (cur && cur !== n) {
        if (cur.nodeType === Node.ELEMENT_NODE) out += (cur as Element).outerHTML;
        else if (cur.nodeType === Node.TEXT_NODE) out += (cur.textContent || '');
        cur = cur.nextSibling;
      }
      return out;
    }
  }
  return null;
}

// Strip the edit-only attributes we injected before saving, so node.info stays clean.
function cleanInner(s: string): string {
  return s
    .replace(/\s*contenteditable="(?:true|false)"/gi, '')
    .replace(new RegExp(`\\s*${V_ATTR}="[^"]*"`, 'gi'), '');
}

// The logged-in user's X-API-Token, read the same way as the rest of the app
// (localStorage.user.emailVerificationToken). Required — patchNode rejects
// unauthenticated writes with "Authentication required".
function readAuthToken(): string {
  if (typeof window === 'undefined') return '';
  try {
    const raw = window.localStorage.getItem('user');
    if (raw) {
      const t = JSON.parse(raw)?.emailVerificationToken;
      if (typeof t === 'string' && t.trim()) return t.trim();
    }
  } catch { /* ignore */ }
  for (const k of ['token', 'authToken']) {
    try { const v = window.localStorage.getItem(k); if (v?.trim()) return v.trim(); } catch { /* ignore */ }
  }
  return '';
}

interface Props {
  html: string | null;
  onClose: () => void;
  onConsoleErrors?: (errors: string[]) => void;
  onHtmlChange?: (html: string) => void;
  graphId?: string | null;
  nodeId?: string | null;
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

function injectBridge(html: string, graphId?: string | null, nodeId?: string | null): string {
  const bridge = buildConsoleBridge(graphId, nodeId);
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

export default function HtmlPreview({ html, onClose, onConsoleErrors, onHtmlChange, graphId, nodeId }: Props) {
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

  const anchorIds = useMemo(() => (html ? listAnchorIds(html) : []), [html]);

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
  const baselineRef = useRef<Record<string, string>>({}); // anchor id -> clean inner captured at load
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
    // Tag block-level text elements INSIDE each anchor section.
    const walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_COMMENT);
    const startRe = /^\s*edit:([a-z0-9-]+):start\s*$/;
    const endRe = /^\s*edit:([a-z0-9-]+):end\s*$/;
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const m = startRe.exec((n as Comment).data);
      if (!m) continue;
      const id = m[1];
      let cur: Node | null = n.nextSibling;
      while (cur) {
        if (cur.nodeType === Node.COMMENT_NODE) {
          const em = endRe.exec((cur as Comment).data);
          if (em && em[1] === id) break;
        }
        if (cur.nodeType === Node.ELEMENT_NODE) {
          const el = cur as Element;
          if (el.matches(V_EDITABLE_SEL)) el.setAttribute(V_ATTR, id);
          el.querySelectorAll(V_EDITABLE_SEL).forEach(b => b.setAttribute(V_ATTR, id));
        }
        cur = cur.nextSibling;
      }
    }
    doc.addEventListener('click', handlersRef.current.click, true);
    // Baseline of each section's clean inner HTML as loaded — save() compares the live
    // DOM against this to detect real edits (robust; no dependence on keystroke events).
    listAnchorIds(doc.documentElement.outerHTML).forEach(id => {
      baselineRef.current[id] = cleanInner(getLiveSectionInner(doc, id) ?? '');
    });
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
    else { disableVisualEdit(doc); baselineRef.current = {}; setVisualMsg(''); }
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
      // Diff the live DOM of each anchor section against its as-loaded baseline.
      let working = html;
      let changed = false;
      for (const id of listAnchorIds(html)) {
        const cur = cleanInner(getLiveSectionInner(doc, id) ?? '');
        const base = baselineRef.current[id];
        if (base !== undefined && cur !== base) {
          working = setSectionInner(working, id, cur);
          changed = true;
        }
      }
      if (!changed || working === html) { setVisualMsg('Ingen endring'); setVisualSaving(false); return; }
      const gRes = await fetch(`https://knowledge.vegvisr.org/getknowgraph?id=${encodeURIComponent(graphId)}`);
      if (!gRes.ok) { setVisualMsg('Lesing feilet'); setVisualSaving(false); return; }
      let expectedVersion = Number((await gRes.json())?.metadata?.version || 0);
      let res = await fetch('https://knowledge.vegvisr.org/patchNode', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Token': readAuthToken() },
        body: JSON.stringify({ graphId, nodeId, fields: { info: working }, expectedVersion }),
      });
      if (res.status === 409) {
        expectedVersion = Number((await (await fetch(`https://knowledge.vegvisr.org/getknowgraph?id=${encodeURIComponent(graphId)}`)).json())?.metadata?.version || 0);
        res = await fetch('https://knowledge.vegvisr.org/patchNode', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Token': readAuthToken() },
          body: JSON.stringify({ graphId, nodeId, fields: { info: working }, expectedVersion }),
        });
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) { setVisualMsg(data?.error || `Lagring feilet (${res.status})`); setVisualSaving(false); return; }
      onHtmlChange?.(working); // re-renders the iframe from clean bytes; handleIframeLoad re-arms edit mode + recaptures baseline
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
      let expectedVersion = Number(g?.metadata?.version || 0);
      let res = await fetch('https://knowledge.vegvisr.org/patchNode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Token': readAuthToken() },
        body: JSON.stringify({ graphId, nodeId, fields: { info: newHtml }, expectedVersion }),
      });
      if (res.status === 409) {
        const latest = await (await fetch(`https://knowledge.vegvisr.org/getknowgraph?id=${encodeURIComponent(graphId)}`)).json();
        expectedVersion = Number(latest?.metadata?.version || 0);
        res = await fetch('https://knowledge.vegvisr.org/patchNode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Token': readAuthToken() },
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
        headers: { 'Content-Type': 'application/json', 'X-API-Token': readAuthToken() },
        body: JSON.stringify({ graphId, nodeId, fields: { info: versionHtml }, expectedVersion }),
      });

      if (res.status === 409) {
        const latestRes = await fetch(`https://knowledge.vegvisr.org/getknowgraph?id=${encodeURIComponent(graphId)}`);
        if (!latestRes.ok) return;
        const latestGraph = await latestRes.json();
        const retryVersion = Number(latestGraph?.metadata?.version || 0);
        const retryRes = await fetch('https://knowledge.vegvisr.org/patchNode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Token': readAuthToken() },
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
          {graphId && nodeId && anchorIds.length > 0 && activeVersion === null && (
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
        srcDoc={injectBridge(versionHtml || html, graphId, nodeId)}
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
