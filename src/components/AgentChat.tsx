import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
// rehype-sanitize removed: agent-generated content is trusted,
// and the sanitizer was stripping graph viewer hrefs from links


const AGENT_API = 'https://agent.vegvisr.org';
const KG_API = 'https://knowledge.vegvisr.org';

interface Props {
  userId: string;
  graphId: string;
  onGraphChange: (graphId: string) => void;
}

interface ToolCall {
  id: string;
  tool: string;
  input: unknown;
  status: 'running' | 'success' | 'error';
  summary?: string;
  result?: unknown;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
}

interface StreamEvent {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'text' | 'done' | 'error';
  data: Record<string, unknown>;
}

interface AssistantState {
  text: string;
  toolCalls: ToolCall[];
  thinking: boolean;
  error?: string;
}

interface GraphInfo {
  id: string;
  metadata_title?: string;
}

// ---------- Tool Call Card ----------

function ToolCallCard({ tc }: { tc: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  let inputStr = '';
  try { inputStr = JSON.stringify(tc.input, null, 2); } catch { inputStr = String(tc.input); }
  let resultStr = '';
  if (tc.result) {
    try { resultStr = JSON.stringify(tc.result, null, 2).slice(0, 1000); } catch { resultStr = String(tc.result); }
  }

  return (
    <div className="my-2 border border-white/10 rounded-lg overflow-hidden text-[13px]">
      <button
        type="button"
        onClick={() => setExpanded(p => !p)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-white/[0.04] hover:bg-white/[0.07] cursor-pointer select-none text-left"
      >
        <span className="text-sm">&#x1f527;</span>
        <span className="font-semibold text-white">{tc.tool}</span>
        <span className={`ml-auto text-xs ${tc.status === 'running' ? 'text-sky-400' : tc.status === 'success' ? 'text-emerald-400' : 'text-rose-400'}`}>
          {tc.status === 'running' ? 'Running...' : tc.status === 'success' ? (tc.summary || 'Done') : 'Failed'}
        </span>
        <span className={`text-[10px] text-white/50 transition-transform ${expanded ? 'rotate-90' : ''}`}>&#x25B6;</span>
      </button>
      {expanded && (
        <div className="px-3 py-2 border-t border-white/10 bg-black/15">
          <pre className="whitespace-pre-wrap break-all text-white/60 font-mono text-xs m-0">{inputStr}</pre>
          {resultStr && (
            <>
              <hr className="border-none border-t border-white/10 my-1.5" />
              <pre className="whitespace-pre-wrap break-all text-white/60 font-mono text-xs m-0">{resultStr}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Graph Card ----------

function extractText(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(extractText).join('');
  if (children && typeof children === 'object' && 'props' in children) {
    return extractText((children as React.ReactElement).props.children);
  }
  return String(children || '');
}

interface GraphMeta {
  title: string;
  description: string;
  category: string;
  nodeCount: number;
  nodeTypes: string[];
}

function GraphCard({ graphId, title, href }: { graphId: string; title: string; href: string }) {
  const [meta, setMeta] = useState<GraphMeta | null>(null);

  useEffect(() => {
    if (!graphId) return;
    fetch(`${KG_API}/getknowgraph?id=${encodeURIComponent(graphId)}`)
      .then(r => r.json())
      .then(data => {
        const nodes = data.nodes || [];
        const types = [...new Set(nodes.map((n: { type?: string }) => n.type).filter(Boolean))] as string[];
        setMeta({
          title: data.metadata?.title || title,
          description: data.metadata?.description || '',
          category: data.metadata?.category || '',
          nodeCount: nodes.length,
          nodeTypes: types,
        });
      })
      .catch(() => {});
  }, [graphId, title]);

  const categoryTags = meta?.category ? meta.category.split(/\s+/).filter(t => t.startsWith('#')) : [];

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="block my-3 p-4 rounded-lg border border-sky-400/20 bg-sky-400/[0.06] hover:bg-sky-400/[0.12] transition-colors no-underline group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-white font-semibold text-sm">{meta?.title || title}</div>
          {meta?.description && (
            <div className="text-white/50 text-xs mt-1 line-clamp-2">{meta.description}</div>
          )}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {categoryTags.map(tag => (
              <span key={tag} className="px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 text-[10px] font-medium">{tag}</span>
            ))}
            {meta?.nodeTypes.map(type => (
              <span key={type} className="px-1.5 py-0.5 rounded-full bg-white/10 text-white/50 text-[10px]">{type}</span>
            ))}
            {meta && (
              <span className="px-1.5 py-0.5 rounded-full bg-white/10 text-white/40 text-[10px]">{meta.nodeCount} nodes</span>
            )}
          </div>
        </div>
        <span className="flex-shrink-0 mt-1 px-3 py-1.5 rounded-md bg-sky-400/20 text-sky-400 text-xs font-medium group-hover:bg-sky-400/30 transition-colors">
          View Graph &rarr;
        </span>
      </div>
    </a>
  );
}

// Pre-process markdown: convert any link containing a UUID into a proper viewer URL
// so rehype-sanitize won't strip it and the custom component can detect it
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function preprocessGraphLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, title, url) => {
    const uuidMatch = url.match(UUID_RE);
    if (uuidMatch) {
      return `[${title}](https://www.vegvisr.org/gnew-viewer?graphId=${uuidMatch[0]})`;
    }
    return match;
  });
}

const markdownComponents = {
  a: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode }) => {
    if (href) {
      try {
        const url = new URL(href);
        if (url.hostname.includes('vegvisr.org')) {
          const graphId = url.searchParams.get('graphId') || url.searchParams.get('id');
          if (graphId) {
            const viewerHref = `https://www.vegvisr.org/gnew-viewer?graphId=${graphId}`;
            const title = extractText(children);
            return <GraphCard graphId={graphId} title={title} href={viewerHref} />;
          }
        }
      } catch { /* not a valid URL, render normally */ }
    }
    return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
  },
};

// ---------- Thinking Indicator ----------

function ThinkingIndicator() {
  return (
    <div className="flex gap-1 py-1">
      <span className="w-2 h-2 rounded-full bg-sky-400 opacity-40 animate-[pulse_1.4s_ease-in-out_infinite]" />
      <span className="w-2 h-2 rounded-full bg-sky-400 opacity-40 animate-[pulse_1.4s_ease-in-out_infinite_0.2s]" />
      <span className="w-2 h-2 rounded-full bg-sky-400 opacity-40 animate-[pulse_1.4s_ease-in-out_infinite_0.4s]" />
    </div>
  );
}

// ---------- Main Component ----------

export default function AgentChat({ userId, graphId, onGraphChange }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [current, setCurrent] = useState<AssistantState | null>(null);
  const [graphs, setGraphs] = useState<GraphInfo[]>([]);
  const [showLog, setShowLog] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load graph list
  useEffect(() => {
    fetch(`${KG_API}/getknowgraphsummaries?offset=0&limit=50`)
      .then(r => r.json())
      .then(data => { if (data.results) setGraphs(data.results); })
      .catch(() => {});
  }, []);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, current]);

  // Auto-resize textarea
  const handleInput = useCallback((value: string) => {
    setInput(value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, []);

  // Build copyable log from messages
  const buildLog = useCallback(() => {
    const lines: string[] = [];
    lines.push(`=== Agent Chat Log ===`);
    lines.push(`Time: ${new Date().toISOString()}`);
    lines.push(`Graph: ${graphId || '(none)'}`);
    lines.push(`User: ${userId}`);
    lines.push('');

    for (const msg of messages) {
      lines.push(`--- ${msg.role.toUpperCase()} ---`);
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const tc of msg.toolCalls) {
          lines.push(`  [TOOL] ${tc.tool} (${tc.status})`);
          try { lines.push(`    Input: ${JSON.stringify(tc.input)}`); } catch { /* skip */ }
          if (tc.summary) lines.push(`    Summary: ${tc.summary}`);
          if (tc.result) {
            try { lines.push(`    Result: ${JSON.stringify(tc.result).slice(0, 500)}`); } catch { /* skip */ }
          }
        }
      }
      lines.push(msg.content);
      lines.push('');
    }

    // Include current streaming state if active
    if (current) {
      lines.push(`--- ASSISTANT (streaming) ---`);
      if (current.toolCalls.length > 0) {
        for (const tc of current.toolCalls) {
          lines.push(`  [TOOL] ${tc.tool} (${tc.status})`);
          try { lines.push(`    Input: ${JSON.stringify(tc.input)}`); } catch { /* skip */ }
          if (tc.summary) lines.push(`    Summary: ${tc.summary}`);
          if (tc.result) {
            try { lines.push(`    Result: ${JSON.stringify(tc.result).slice(0, 500)}`); } catch { /* skip */ }
          }
        }
      }
      if (current.text) lines.push(current.text);
      if (current.error) lines.push(`  [ERROR] ${current.error}`);
    }

    return lines.join('\n');
  }, [messages, current, graphId, userId]);

  const copyLog = useCallback(() => {
    const log = buildLog();
    navigator.clipboard.writeText(log).then(() => {
      alert('Chat log copied to clipboard!');
    }).catch(() => {
      // Fallback: show in a prompt
      prompt('Copy this log:', log);
    });
  }, [buildLog]);

  // Parse SSE stream
  const parseSSE = useCallback(async (
    reader: ReadableStreamDefaultReader<Uint8Array>,
    onEvent: (ev: StreamEvent) => void,
  ) => {
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7);
        } else if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            onEvent({ type: currentEvent as StreamEvent['type'], data });
          } catch {
            // skip malformed JSON
          }
        }
      }
    }
  }, []);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setStreaming(true);

    const userMsg: ChatMessage = { role: 'user', content: text };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);

    const state: AssistantState = { text: '', toolCalls: [], thinking: false };
    setCurrent(state);

    let finalToolCalls: ToolCall[] = [];

    try {
      const res = await fetch(`${AGENT_API}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          messages: updatedMessages,
          graphId: graphId || undefined,
        }),
      });

      if (!res.ok) {
        let errMsg = `Request failed: ${res.status}`;
        try {
          const err = await res.json();
          const e = err.error;
          errMsg = typeof e === 'string' ? e : (e && typeof e === 'object' ? JSON.stringify(e) : errMsg);
        } catch { /* use default */ }
        throw new Error(errMsg);
      }

      const reader = res.body!.getReader();
      let assistantText = '';

      await parseSSE(reader, (ev) => {
        setCurrent(prev => {
          if (!prev) return prev;
          const next = { ...prev, toolCalls: [...prev.toolCalls] };

          switch (ev.type) {
            case 'thinking':
              next.thinking = true;
              break;

            case 'tool_call':
              next.thinking = false;
              next.toolCalls.push({
                id: `tc_${Date.now()}_${next.toolCalls.length}`,
                tool: ev.data.tool as string,
                input: ev.data.input,
                status: 'running',
              });
              break;

            case 'tool_result': {
              const tool = ev.data.tool as string;
              for (let i = next.toolCalls.length - 1; i >= 0; i--) {
                if (next.toolCalls[i].tool === tool && next.toolCalls[i].status === 'running') {
                  next.toolCalls[i] = {
                    ...next.toolCalls[i],
                    status: ev.data.success ? 'success' : 'error',
                    summary: (ev.data.summary as string) || undefined,
                    result: ev.data,
                  };
                  break;
                }
              }
              break;
            }

            case 'text':
              next.thinking = false;
              {
                const content = ev.data.content;
                assistantText += typeof content === 'string' ? content : JSON.stringify(content);
              }
              next.text = assistantText;
              break;

            case 'error':
              next.thinking = false;
              {
                const errVal = ev.data.error;
                next.error = typeof errVal === 'string' ? errVal
                  : (errVal && typeof errVal === 'object' && 'message' in errVal) ? String((errVal as { message: unknown }).message)
                  : JSON.stringify(errVal);
              }
              break;
          }

          // Keep a copy of tool calls for finalization
          finalToolCalls = next.toolCalls;
          return next;
        });
      });

      // Finalize: move current into messages — preserve tool calls AND text
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: assistantText,
        toolCalls: finalToolCalls.length > 0 ? finalToolCalls : undefined,
      }]);
    } catch (err) {
      setCurrent(prev => prev ? { ...prev, thinking: false, error: err instanceof Error ? err.message : String(err) } : prev);
      // Still save what we have
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: current?.text || `Error: ${err instanceof Error ? err.message : String(err)}`,
        toolCalls: finalToolCalls.length > 0 ? finalToolCalls : undefined,
      }]);
    }

    setCurrent(null);
    setStreaming(false);
  }, [input, streaming, messages, userId, graphId, parseSSE, current]);

  const hasMessages = messages.length > 0 || current !== null;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Graph selector bar + Copy Log */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-slate-950/80">
        <div className="flex-1" />
        <select
          value={graphId}
          onChange={e => onGraphChange(e.target.value)}
          className="px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.04] text-white text-[13px] max-w-[300px]"
        >
          <option value="">No graph context</option>
          {graphs.map(g => (
            <option key={g.id} value={g.id} className="bg-slate-900 text-white">
              {(g.metadata_title || g.id).slice(0, 50)}
            </option>
          ))}
        </select>
        <div className="flex-1 flex justify-end gap-2">
          {hasMessages && (
            <>
              <button
                type="button"
                onClick={copyLog}
                className="px-3 py-1 rounded-md border border-white/10 bg-white/[0.04] text-white/60 text-xs hover:bg-white/[0.08] hover:text-white/80 transition-colors"
                title="Copy chat log to clipboard"
              >
                Copy Log
              </button>
              <button
                type="button"
                onClick={() => setShowLog(p => !p)}
                className="px-3 py-1 rounded-md border border-white/10 bg-white/[0.04] text-white/60 text-xs hover:bg-white/[0.08] hover:text-white/80 transition-colors"
                title="Toggle raw log view"
              >
                {showLog ? 'Hide Log' : 'View Log'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Raw Log Panel */}
      {showLog && (
        <div className="max-h-[300px] overflow-y-auto border-b border-white/10 bg-black/40 px-4 py-3">
          <pre className="whitespace-pre-wrap break-all text-white/50 font-mono text-xs m-0">
            {buildLog()}
          </pre>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-5 flex flex-col gap-4">
        {!hasMessages && (
          <div className="text-center py-16 text-white/60">
            <h2 className="text-white text-2xl font-semibold mb-3">Agent Chat</h2>
            <p className="text-base leading-relaxed max-w-[500px] mx-auto">
              I can help you create knowledge graphs, build HTML pages, modify content, and manage your apps. What would you like to do?
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`max-w-[80%] px-4 py-3 rounded-[14px] text-[0.95rem] leading-relaxed break-words ${
              msg.role === 'user'
                ? 'self-end bg-sky-400/[0.16] border border-sky-400/30 text-white'
                : 'self-start bg-white/[0.06] border border-white/[0.12] text-white'
            }`}
          >
            {/* Show tool calls for completed assistant messages */}
            {msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0 && (
              <div className="mb-2">
                {msg.toolCalls.map(tc => (
                  <ToolCallCard key={tc.id} tc={tc} />
                ))}
              </div>
            )}
            {msg.role === 'assistant' ? (
              <div className="prose prose-invert prose-sm max-w-none [&_a]:text-sky-400 [&_code]:bg-black/30 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[0.9em] [&_pre]:bg-black/30 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_blockquote]:border-l-[3px] [&_blockquote]:border-sky-400 [&_blockquote]:pl-3 [&_blockquote]:text-white/60">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {preprocessGraphLinks(msg.content || '_(completed with tool calls only)_')}
                </ReactMarkdown>
              </div>
            ) : (
              msg.content
            )}
          </div>
        ))}

        {/* Current streaming assistant response */}
        {current && (
          <div className="self-start max-w-[80%] px-4 py-3 rounded-[14px] bg-white/[0.06] border border-white/[0.12] text-white text-[0.95rem] leading-relaxed">
            {current.thinking && <ThinkingIndicator />}
            {current.toolCalls.map(tc => (
              <ToolCallCard key={tc.id} tc={tc} />
            ))}
            {current.text && (
              <div className="prose prose-invert prose-sm max-w-none [&_a]:text-sky-400 [&_code]:bg-black/30 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[0.9em] [&_pre]:bg-black/30 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_blockquote]:border-l-[3px] [&_blockquote]:border-sky-400 [&_blockquote]:pl-3 [&_blockquote]:text-white/60">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {preprocessGraphLinks(current.text)}
                </ReactMarkdown>
              </div>
            )}
            {current.error && (
              <p className="text-rose-400">Error: {current.error}</p>
            )}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="px-4 py-3 border-t border-white/10 bg-slate-950/80 flex-shrink-0">
        <div className="flex gap-2 max-w-[900px] mx-auto items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => handleInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
            }}
            placeholder="Type your message..."
            rows={1}
            className="flex-1 px-3.5 py-2.5 bg-white/[0.04] border border-white/10 rounded-xl text-white text-[0.95rem] font-[inherit] resize-none leading-relaxed max-h-[200px] overflow-y-auto focus:outline-none focus:border-sky-400/50 focus:ring-[3px] focus:ring-sky-400/15"
          />
          <button
            type="button"
            onClick={sendMessage}
            disabled={streaming || !input.trim()}
            className="px-5 py-2.5 rounded-xl border border-sky-400/40 bg-sky-400/[0.16] text-white text-[0.95rem] font-medium cursor-pointer whitespace-nowrap transition-all hover:bg-sky-400/[0.24] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {streaming ? '...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
