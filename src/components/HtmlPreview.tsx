import { useState, useEffect, useRef, useCallback } from 'react';

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
      const res = await fetch('https://knowledge.vegvisr.org/patchNode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graphId, nodeId, fields: { info: versionHtml } }),
      });
      if (!res.ok) return;
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
