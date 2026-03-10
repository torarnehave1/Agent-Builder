import { useState, useEffect, useRef, useCallback } from 'react';

interface Props {
  html: string | null;
  onClose: () => void;
  onConsoleErrors?: (errors: string[]) => void;
  graphId?: string | null;
  nodeId?: string | null;
}

interface ConsoleEntry {
  level: 'log' | 'warn' | 'error' | 'info' | 'network';
  message: string;
  timestamp: number;
}

const CONSOLE_BRIDGE = `<script>
(function() {
  var MSG_KEY = '__vegvisr_console__';
  function send(level, args) {
    try {
      var parts = [];
      for (var i = 0; i < args.length; i++) {
        try { parts.push(typeof args[i] === 'string' ? args[i] : JSON.stringify(args[i])); }
        catch(e) { parts.push(String(args[i])); }
      }
      window.parent.postMessage({ type: MSG_KEY, level: level, message: parts.join(' ') }, '*');
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

function injectBridge(html: string): string {
  const headIdx = html.indexOf('<head>');
  if (headIdx !== -1) {
    return html.slice(0, headIdx + 6) + CONSOLE_BRIDGE + html.slice(headIdx + 6);
  }
  const htmlIdx = html.indexOf('<html');
  if (htmlIdx !== -1) {
    const closeTag = html.indexOf('>', htmlIdx);
    if (closeTag !== -1) {
      return html.slice(0, closeTag + 1) + '<head>' + CONSOLE_BRIDGE + '</head>' + html.slice(closeTag + 1);
    }
  }
  return CONSOLE_BRIDGE + html;
}

const LEVEL_STYLE: Record<string, { icon: string; color: string }> = {
  log: { icon: '○', color: 'text-white/60' },
  info: { icon: '●', color: 'text-sky-400' },
  warn: { icon: '▲', color: 'text-amber-400' },
  error: { icon: '✕', color: 'text-rose-400' },
  network: { icon: '↔', color: 'text-orange-400' },
};

export default function HtmlPreview({ html, onClose, onConsoleErrors, graphId, nodeId }: Props) {
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [consoleOpen, setConsoleOpen] = useState(true);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const reportedRef = useRef<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMessage = useCallback((e: MessageEvent) => {
    if (e.data?.type === '__vegvisr_console__') {
      setEntries(prev => [...prev, {
        level: e.data.level,
        message: e.data.message,
        timestamp: Date.now(),
      }]);
    }
  }, []);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  // Clear console and reported errors when html changes
  useEffect(() => {
    setEntries([]);
    reportedRef.current = new Set();
  }, [html]);

  // Debounced error reporting to parent
  useEffect(() => {
    if (!onConsoleErrors) return;
    const errors = entries
      .filter(e => e.level === 'error' || e.level === 'network')
      .map(e => e.message)
      .filter(msg => !reportedRef.current.has(msg));
    if (errors.length === 0) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const newErrors = errors.filter(msg => !reportedRef.current.has(msg));
      if (newErrors.length > 0) {
        newErrors.forEach(msg => reportedRef.current.add(msg));
        // Append graph/node context to each error so the agent always knows where to look
        const ctx = graphId && nodeId ? ` [graphId: ${graphId}, nodeId: ${nodeId}]` : '';
        onConsoleErrors(newErrors.map(msg => msg + ctx));
      }
    }, 2000);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
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
          {errorCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-400">
              {errorCount} {errorCount === 1 ? 'error' : 'errors'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
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
      <iframe
        srcDoc={injectBridge(html)}
        sandbox="allow-scripts allow-forms allow-same-origin allow-modals allow-popups"
        className={`w-full bg-white border-0 ${consoleOpen ? 'flex-[3]' : 'flex-1'}`}
        title="HTML Preview"
      />
      {consoleOpen && (
        <div className="flex-1 min-h-[120px] max-h-[200px] border-t border-white/10 bg-slate-950 flex flex-col">
          <div className="px-2 py-1 border-b border-white/10 flex-shrink-0">
            <span className="text-[10px] text-white/30 font-mono">Console</span>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-1 font-mono text-[11px]">
            {entries.length === 0 && (
              <div className="text-white/20 text-[10px] py-1">No output yet</div>
            )}
            {entries.map((entry, i) => {
              const style = LEVEL_STYLE[entry.level] || LEVEL_STYLE.log;
              return (
                <div key={i} className={`${style.color} py-[1px] flex gap-1.5 leading-tight`}>
                  <span className="flex-shrink-0 w-3 text-center">{style.icon}</span>
                  <span className="break-all">{entry.message}</span>
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
