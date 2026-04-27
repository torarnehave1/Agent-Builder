import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
// rehype-sanitize removed: agent-generated content is trusted,
// and the sanitizer was stripping graph viewer hrefs from links


const AGENT_API = 'https://agent.vegvisr.org';
const KG_API = 'https://knowledge.vegvisr.org';
const CHAT_HISTORY_API = 'https://api.vegvisr.org/chat-history';
const AUDIO_ENDPOINT = 'https://openai.vegvisr.org/audio';
const CHUNK_DURATION_SECONDS = 120;

interface AudioFileInfo {
  file: File;
  name: string;
  size: number;
  type: string;
  duration: number | null;
}

function historyFetch(path: string, userId: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers as HeadersInit || {});
  headers.set('x-user-id', userId);
  headers.set('Content-Type', 'application/json');
  return fetch(`${CHAT_HISTORY_API}${path}`, { ...options, headers });
}

interface SessionInfo {
  id: string;
  title: string;
  updatedAt: string;
}

interface Props {
  userId: string;
  userEmail?: string;
  graphId: string;
  onGraphChange: (graphId: string) => void;
  agentId?: string | null;
  agentAvatarUrl?: string | null;
  onPreview?: (html: string) => void;
  consoleErrors?: string[] | null;
  onConsoleErrorsHandled?: () => void;
  onActiveHtmlNode?: (nodeId: string | null) => void;
  model?: string;
  pendingGraphContext?: { id: string; title: string } | null;
  onPendingGraphContextProcessed?: () => void;
}

interface ToolCall {
  id: string;
  tool: string;
  input: unknown;
  status: 'running' | 'success' | 'error';
  summary?: string;
  result?: unknown;
  progress?: string;
}

interface ImageAttachment {
  type: 'url' | 'base64';
  url?: string;
  mediaType?: string;
  data?: string;
  label?: string;
}

interface FileAttachment {
  name: string;
  mediaType: string;
  data: string; // base64 for PDF, plain text for text files
  size: number;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  images?: ImageAttachment[];
  files?: FileAttachment[];
  toolCalls?: ToolCall[];
}

interface StreamEvent {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'tool_progress' | 'text' | 'done' | 'error' | 'suggestions' | 'agent_info';
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

function ToolCallCard({ tc, userId, onPreview, onActiveHtmlNode }: { tc: ToolCall; userId: string; onPreview?: (html: string) => void; onActiveHtmlNode?: (nodeId: string | null) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [savedAsTemplate, setSavedAsTemplate] = useState(false);
  let inputStr = '';
  try { inputStr = JSON.stringify(tc.input, null, 2); } catch { inputStr = String(tc.input); }
  let resultStr = '';
  if (tc.result) {
    try { resultStr = JSON.stringify(tc.result, null, 2).slice(0, 1000); } catch { resultStr = String(tc.result); }
  }

  const input = tc.input as Record<string, unknown>;
  const fields = (input.fields || {}) as Record<string, unknown>;
  const isPatchWithHtml = tc.tool === 'patch_node' && typeof fields.info === 'string' && (fields.info as string).includes('<html');
  const isHtmlNode = tc.tool === 'create_html_node'
    || (tc.tool === 'create_node' && (input.nodeType === 'html-node' || input.type === 'html-node'))
    || tc.tool === 'create_html_from_template'
    || isPatchWithHtml;
  const canPreview = isHtmlNode && tc.status === 'success';

  const saveAsTemplate = async () => {
    // Get the HTML content from whichever tool was used
    const htmlContent = (input.htmlContent || input.content || input.info || fields.info || '') as string;
    const label = (input.label || input.title || 'Custom App Template') as string;
    const nodeId = (input.nodeId || input.node_id || `node-${Date.now()}`) as string;
    try {
      const res = await fetch('https://knowledge.vegvisr.org/addTemplate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Token': userId },
        body: JSON.stringify({
          name: label,
          node: { id: nodeId, label, type: 'html-node', info: htmlContent },
          category: 'Custom Apps',
          userId,
          ai_instructions: { description: `Custom HTML app template: ${label}`, sourceGraphId: input.graphId },
        }),
      });
      if (res.ok) setSavedAsTemplate(true);
    } catch { /* silently fail */ }
  };

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
          {tc.status === 'running' ? (tc.progress || 'Running...') : tc.status === 'success' ? (tc.summary || 'Done') : 'Failed'}
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
      {canPreview && (
        <div className="flex items-center gap-2 mx-3 my-2">
          {onPreview && (
            <button type="button" onClick={() => {
              const html = (input.htmlContent || input.content || input.info || fields.info || '') as string;
              const result = (tc.result || {}) as Record<string, unknown>;
              const nId = (input.nodeId || input.node_id || result.nodeId || '') as string;
              if (nId) onActiveHtmlNode?.(nId);
              if (html) onPreview(html);
            }}
              className="px-2 py-1 text-xs rounded bg-sky-600/20 text-sky-300 hover:bg-sky-600/30 border border-sky-500/20">
              Preview
            </button>
          )}
          {canPreview && !savedAsTemplate && (
            <button type="button" onClick={saveAsTemplate}
              className="px-2 py-1 text-xs rounded bg-violet-600/20 text-violet-300 hover:bg-violet-600/30 border border-violet-500/20">
              Save as Template
            </button>
          )}
          {savedAsTemplate && (
            <span className="inline-block text-xs text-emerald-400">Saved as template</span>
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
    return extractText((children as React.ReactElement<{ children?: React.ReactNode }>).props.children);
  }
  return String(children || '');
}

interface GraphMeta {
  title: string;
  description: string;
  category: string;
  metaArea?: string;
  nodeCount: number;
  nodeTypes: string[];
}

function GraphCard({ graphId, title, href }: { graphId: string; title: string; href: string }) {
  const [meta, setMeta] = useState<GraphMeta | null>(null);
  const [previewing, setPreviewing] = useState(false);

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
          metaArea: data.metadata?.metaArea || '',
          nodeCount: nodes.length,
          nodeTypes: types,
        });
      })
      .catch(() => {});
  }, [graphId, title]);

  const categoryTags = meta?.category ? meta.category.split(/\s+/).filter(t => t.startsWith('#')) : [];

  return (
    <>
      <div className="my-3 p-4 rounded-lg border border-sky-400/20 bg-sky-400/[0.06]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-white font-semibold text-sm">{meta?.title || title}</div>
            {meta?.description && (
              <div className="text-white/50 text-xs mt-1 line-clamp-2">{meta.description}</div>
            )}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {meta?.metaArea && (
                <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-semibold">#{meta.metaArea}</span>
              )}
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
          <div className="flex flex-col gap-1.5 flex-shrink-0 mt-1">
            <button
              type="button"
              onClick={() => setPreviewing(true)}
              className="px-3 py-1.5 rounded-md bg-emerald-600/20 text-emerald-400 text-xs font-medium hover:bg-emerald-600/30 transition-colors"
            >
              Preview
            </button>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-md bg-sky-400/20 text-sky-400 text-xs font-medium hover:bg-sky-400/30 transition-colors text-center no-underline"
            >
              View →
            </a>
          </div>
        </div>
      </div>
      {previewing && (
        <GraphPreviewLazy graphId={graphId} title={meta?.title || title} onClose={() => setPreviewing(false)} />
      )}
    </>
  );
}

// Lazy-load GraphPreview to keep initial bundle small
import { lazy, Suspense } from 'react';
const GraphPreviewComponent = lazy(() => import('./GraphPreview'));
function GraphPreviewLazy(props: { graphId: string; title: string; onClose: () => void }) {
  return (
    <Suspense fallback={null}>
      <GraphPreviewComponent {...props} />
    </Suspense>
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
        // Audio URLs → inline player
        if (url.hostname === 'audio.vegvisr.org' || (url.hostname.includes('vegvisr') && /\.(webm|wav|mp3|m4a|ogg|flac)$/i.test(url.pathname))) {
          return (
            <span className="block my-2">
              <audio controls preload="none" className="w-full max-w-md" src={href} />
              <span className="block text-[11px] text-white/40 mt-0.5 truncate">{extractText(children) || url.pathname.split('/').pop()}</span>
            </span>
          );
        }
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

// ---------- Node type palette definition ----------

const NODE_TYPES = [
  { type: 'fulltext',        icon: '📝', label: 'Article',    description: 'Markdown text content' },
  { type: 'mermaid-diagram', icon: '📊', label: 'Diagram',    description: 'Mermaid flow/sequence diagram' },
  { type: 'markdown-image',  icon: '🖼️', label: 'Image',      description: 'Image with caption' },
  { type: 'youtube-video',   icon: '▶️', label: 'Video',      description: 'YouTube video embed' },
  { type: 'link',            icon: '🔗', label: 'Link',       description: 'External URL reference' },
  { type: 'notes',           icon: '🗒️', label: 'Note',       description: 'Short note or annotation' },
] as const;

type NodeTypeKey = typeof NODE_TYPES[number]['type'];

// ---------- GraphActionBar ----------

interface GraphActionBarProps {
  userId: string;
  activeGraphId: string;
  onGraphCreated: (graphId: string, title: string) => void;
  onNodeAdded: (graphId: string, nodeId: string, label: string) => void;
  onMessage: (msg: string) => void;
  model?: string;
  disabled?: boolean;
}

function GraphActionBar({ userId, activeGraphId, onGraphCreated, onNodeAdded, onMessage, model, disabled }: GraphActionBarProps) {
  const [newGraphTitle, setNewGraphTitle] = useState('');
  const [showNewGraph, setShowNewGraph] = useState(false);
  const [creatingGraph, setCreatingGraph] = useState(false);

  const [showNodePalette, setShowNodePalette] = useState(false);
  const [selectedNodeType, setSelectedNodeType] = useState<NodeTypeKey>('fulltext');
  const [nodeTopic, setNodeTopic] = useState('');
  const [addingNode, setAddingNode] = useState(false);

  const createGraph = async () => {
    const title = newGraphTitle.trim();
    if (!title) return;
    setCreatingGraph(true);
    try {
      const graphId = crypto.randomUUID();
      const res = await fetch('https://knowledge.vegvisr.org/saveGraphWithHistory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin' },
        body: JSON.stringify({
          id: graphId,
          graphData: {
            metadata: {
              title,
              description: '',
              category: '',
              metaArea: '',
              createdBy: userId,
              version: 0,
              userId,
              tags: [],
            },
            nodes: [],
            edges: [],
          },
        }),
      });
      if (!res.ok) throw new Error(`KG error ${res.status}`);
      onGraphCreated(graphId, title);
      onMessage(`Graph "${title}" created. Graph ID: ${graphId}\nView it at https://www.vegvisr.org/gnew-viewer?graphId=${graphId}`);
      setNewGraphTitle('');
      setShowNewGraph(false);
    } catch (err) {
      onMessage(`Failed to create graph: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setCreatingGraph(false);
    }
  };

  const addNode = async () => {
    const topic = nodeTopic.trim();
    if (!topic || !activeGraphId) return;
    setAddingNode(true);
    try {
      // Ask the model to generate the node content only — no tool calls, just JSON
      const nodeType = selectedNodeType;
      const prompt = [
        `Generate content for a knowledge graph node of type "${nodeType}" about: ${topic}.`,
        nodeType === 'mermaid-diagram'
          ? 'Return a raw Mermaid diagram (no markdown fences, no explanation), just the diagram syntax starting with graph or sequenceDiagram etc.'
          : nodeType === 'markdown-image'
          ? 'Return a valid HTTPS image URL on the first line, and a short caption on the second line.'
          : nodeType === 'link'
          ? 'Return a valid URL on the first line and a short description on the second line.'
          : nodeType === 'youtube-video'
          ? 'Return a valid YouTube watch URL on the first line and a short description on the second line.'
          : 'Return only the markdown content for the node. No explanation, no preamble — just the content.',
      ].join('\n');

      const res = await fetch('https://agent.vegvisr.org/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          messages: [{ role: 'user', content: prompt }],
          model: model || 'claude-haiku-4-5-20251001',
          max_tokens: 2048,
          stream: false,
        }),
      });

      let content = topic; // fallback
      if (res.ok) {
        const data = await res.json();
        const text = (data.content || []).find((b: { type: string }) => b.type === 'text')?.text || '';
        if (text.trim()) content = text.trim();
      }

      // Build the node object based on type
      const nodeId = `node-${nodeType}-${crypto.randomUUID().slice(0, 8)}`;
      const label = topic.slice(0, 80);

      const nodeBody: Record<string, unknown> = {
        id: nodeId,
        label,
        type: nodeType,
        info: nodeType === 'link' || nodeType === 'youtube-video' ? content.split('\n').slice(1).join('\n').trim() || topic : content,
        bibl: [],
        position: { x: 0, y: 0 },
        visible: true,
      };
      if (nodeType === 'markdown-image' || nodeType === 'link' || nodeType === 'youtube-video') {
        nodeBody.path = content.split('\n')[0].trim();
      }

      const addRes = await fetch('https://knowledge.vegvisr.org/addNode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin' },
        body: JSON.stringify({ graphId: activeGraphId, node: nodeBody }),
      });

      if (!addRes.ok) throw new Error(`addNode error ${addRes.status}`);

      onNodeAdded(activeGraphId, nodeId, label);
      onMessage(`Node "${label}" (${nodeType}) added to graph.\nView: https://www.vegvisr.org/gnew-viewer?graphId=${activeGraphId}`);
      setNodeTopic('');
      setShowNodePalette(false);
    } catch (err) {
      onMessage(`Failed to add node: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setAddingNode(false);
    }
  };

  return (
    <div className="max-w-[900px] mx-auto mb-2">
      {/* Action buttons row */}
      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => { setShowNewGraph(p => !p); setShowNodePalette(false); }}
          disabled={disabled}
          className="px-3 py-1.5 rounded-lg border border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-300 text-xs font-medium hover:bg-emerald-400/[0.16] transition-colors disabled:opacity-40"
        >
          + New Graph
        </button>
        <button
          type="button"
          onClick={() => { setShowNodePalette(p => !p); setShowNewGraph(false); }}
          disabled={disabled || !activeGraphId}
          title={!activeGraphId ? 'Select a graph first' : ''}
          className="px-3 py-1.5 rounded-lg border border-violet-400/30 bg-violet-400/[0.08] text-violet-300 text-xs font-medium hover:bg-violet-400/[0.16] transition-colors disabled:opacity-40"
        >
          + Add Node
        </button>
      </div>

      {/* New Graph panel */}
      {showNewGraph && (
        <div className="mt-2 p-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04]">
          <p className="text-xs text-white/50 mb-2">Graph title — created directly, no AI needed.</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={newGraphTitle}
              onChange={e => setNewGraphTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') createGraph(); }}
              placeholder="e.g. Strawberry Farming Guide"
              className="flex-1 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-white text-xs placeholder-white/30 focus:outline-none focus:border-emerald-400/50"
              autoFocus
            />
            <button
              type="button"
              onClick={createGraph}
              disabled={creatingGraph || !newGraphTitle.trim()}
              className="px-4 py-2 rounded-lg bg-emerald-500/20 text-emerald-300 text-xs font-medium hover:bg-emerald-500/30 disabled:opacity-40 transition-colors"
            >
              {creatingGraph ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* Node palette panel */}
      {showNodePalette && (
        <div className="mt-2 p-3 rounded-xl border border-violet-400/20 bg-violet-400/[0.04]">
          <p className="text-xs text-white/50 mb-2">Pick a node type, describe the topic — AI generates the content.</p>

          {/* Node type grid */}
          <div className="grid grid-cols-3 gap-1.5 mb-3">
            {NODE_TYPES.map(n => (
              <button
                key={n.type}
                type="button"
                onClick={() => setSelectedNodeType(n.type)}
                className={`px-2 py-1.5 rounded-lg border text-left transition-colors ${
                  selectedNodeType === n.type
                    ? 'border-violet-400/60 bg-violet-400/20 text-violet-200'
                    : 'border-white/10 bg-white/[0.03] text-white/60 hover:border-violet-400/30 hover:text-white/80'
                }`}
              >
                <span className="text-sm mr-1">{n.icon}</span>
                <span className="text-xs font-medium">{n.label}</span>
              </button>
            ))}
          </div>

          {/* Topic input */}
          <div className="flex gap-2">
            <input
              type="text"
              value={nodeTopic}
              onChange={e => setNodeTopic(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addNode(); }}
              placeholder={`Topic for ${NODE_TYPES.find(n => n.type === selectedNodeType)?.label || 'node'}…`}
              className="flex-1 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-white text-xs placeholder-white/30 focus:outline-none focus:border-violet-400/50"
              autoFocus
            />
            <button
              type="button"
              onClick={addNode}
              disabled={addingNode || !nodeTopic.trim()}
              className="px-4 py-2 rounded-lg bg-violet-500/20 text-violet-300 text-xs font-medium hover:bg-violet-500/30 disabled:opacity-40 transition-colors"
            >
              {addingNode ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Main Component ----------

export default function AgentChat({ userId, userEmail, graphId, onGraphChange, agentId, agentAvatarUrl, onPreview, consoleErrors, onConsoleErrorsHandled, onActiveHtmlNode, model, pendingGraphContext, onPendingGraphContextProcessed }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [current, setCurrent] = useState<AssistantState | null>(null);
  const [graphs, setGraphs] = useState<GraphInfo[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [htmlNodePicker, setHtmlNodePicker] = useState<Array<{ id: string; label: string; info: string }> | null>(null);
  const lastAgentGraphRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  // Bot @mention state
  const [bots, setBots] = useState<Array<{ id: string; name: string; username: string; avatar_url?: string }>>([]);
  useEffect(() => {
    if (!userId) return;
    fetch(`${AGENT_API}/bots?userId=${encodeURIComponent(userId)}`)
      .then(r => r.json())
      .then(data => { if (data.bots) { const filtered = data.bots.filter((b: { is_active?: boolean }) => b.is_active !== false); console.log('[AgentChat] bots loaded:', filtered.map((b: { username: string }) => b.username)); setBots(filtered); } })
      .catch(() => {});
  }, [userId]);

  // Prompt suggestions state
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // Subagent progress badge — shown above input while active
  const [subagentProgress, setSubagentProgress] = useState<string | null>(null);

  // Agent avatar state (from props or SSE agent_info event)
  const [agentAvatar, setAgentAvatar] = useState<string | null>(agentAvatarUrl || null);

  // Display graph context from portfolio selection
  const [displayGraphContext, setDisplayGraphContext] = useState<{ id: string; title: string } | null>(null);
  const [previewingGraphContext, setPreviewingGraphContext] = useState(false);

  // Image attachment state
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);
  const [imageDragActive, setImageDragActive] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // File attachment state (PDF, text files)
  const [pendingFiles, setPendingFiles] = useState<FileAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Audio transcription state (same UX as GrokChatPanel)
  const [selectedAudioFile, setSelectedAudioFile] = useState<AudioFileInfo | null>(null);
  const [audioProcessing, setAudioProcessing] = useState(false);
  const [audioTranscriptionStatus, setAudioTranscriptionStatus] = useState('');
  const [audioChunkProgress, setAudioChunkProgress] = useState({ current: 0, total: 0 });
  const [audioAutoDetect, setAudioAutoDetect] = useState(true);
  const [audioLanguage, setAudioLanguage] = useState('no');

  const audioLanguageOptions = [
    { code: 'no', label: 'Norwegian' },
    { code: 'en', label: 'English' },
    { code: 'sv', label: 'Swedish' },
    { code: 'da', label: 'Danish' },
    { code: 'de', label: 'German' },
    { code: 'fr', label: 'French' },
    { code: 'es', label: 'Spanish' },
    { code: 'it', label: 'Italian' },
  ];

  // Keep ref in sync for use inside callbacks
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  // --- Manual fix: user clicks "Fix" button in HtmlPreview to send errors to agent ---
  const lastHtmlNodeIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!consoleErrors || consoleErrors.length === 0 || streaming) return;

    onConsoleErrorsHandled?.();

    const nodeRef = lastHtmlNodeIdRef.current;
    const graphRef = lastAgentGraphRef.current || graphId;
    const errorMsg = [
      'The HTML preview is showing these runtime errors:',
      '',
      ...[...new Set(consoleErrors)].map(e => `- ${e}`),
      '',
      ...(nodeRef && graphRef ? [
        `The HTML source is in graph "${graphRef}", node "${nodeRef}".`,
        'Use delegate_to_html_builder to fix these errors. Pass the graphId, nodeId, task description, and consoleErrors.',
      ] : [
        'Use delegate_to_html_builder to fix these errors. Pass the graphId, nodeId (from the error context), task description, and consoleErrors.',
      ]),
    ].join('\n');

    setTimeout(() => sendMessage(errorMsg), 100);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consoleErrors, streaming]);

  // Handle pending graph context from portfolio selection
  useEffect(() => {
    if (!pendingGraphContext) return;
    // Display graph link as a visual reference (doesn't count toward message tokens)
    setDisplayGraphContext(pendingGraphContext);
    setTimeout(() => {
      textareaRef.current?.focus();
      onPendingGraphContextProcessed?.();
    }, 100);
  }, [pendingGraphContext, onPendingGraphContextProcessed]);

  // Load graph list
  useEffect(() => {
    fetch(`${KG_API}/getknowgraphsummaries?offset=0&limit=200`)
      .then(r => r.json())
      .then(data => { if (data.results) setGraphs(data.results); })
      .catch(() => {});
  }, []);

  // If the selected graph is not in the fetched list (e.g. user has >200 graphs),
  // fetch its metadata so the dropdown and banner can display its title.
  useEffect(() => {
    if (!graphId) return;
    setGraphs(prev => {
      if (prev.some(g => g.id === graphId)) return prev;
      fetch(`${KG_API}/getknowgraph?id=${encodeURIComponent(graphId)}`)
        .then(r => r.json())
        .then(data => {
          const title = (data.metadata?.title as string) || graphId;
          setGraphs(p => p.some(g => g.id === graphId) ? p : [...p, { id: graphId, metadata_title: title }]);
        })
        .catch(() => {});
      return prev;
    });
  }, [graphId]);

  // Load agent chat sessions
  useEffect(() => {
    if (!userId) return;
    historyFetch('/sessions', userId)
      .then(r => r.json())
      .then(data => {
        const agentSessions = (data.sessions || [])
          .filter((s: { provider?: string }) => s.provider === 'agent')
          .map((s: { id: string; title?: string; updated_at?: string }) => ({
            id: s.id,
            title: s.title || 'Untitled',
            updatedAt: s.updated_at || '',
          }));
        setSessions(agentSessions);
      })
      .catch(() => {});
  }, [userId]);

  // Load a saved session's messages
  const loadSession = useCallback(async (sid: string) => {
    try {
      const res = await historyFetch(`/messages?sessionId=${sid}&decrypt=1&limit=200`, userId);
      const data = await res.json();
      const loaded: ChatMessage[] = (data.messages || [])
        .reverse()
        .map((m: { role: string; content?: string; proffData?: { toolCalls?: ToolCall[] } }) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content || '',
          toolCalls: m.proffData?.toolCalls || undefined,
        }));
      setMessages(loaded);
      setSessionId(sid);
      setSessionsOpen(false);
    } catch { /* ignore */ }
  }, [userId]);

  // Delete a session
  const deleteSession = useCallback(async (sid: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await historyFetch(`/sessions/${sid}`, userId, { method: 'DELETE' });
      setSessions(prev => prev.filter(s => s.id !== sid));
      if (sessionIdRef.current === sid) { setSessionId(null); setMessages([]); }
    } catch { /* ignore */ }
  }, [userId]);

  // Rename a session
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameSession = useCallback(async (sid: string) => {
    const title = renameValue.trim();
    if (!title) { setRenamingSessionId(null); return; }
    try {
      await historyFetch(`/sessions/${sid}`, userId, { method: 'PATCH', body: JSON.stringify({ title }) });
      setSessions(prev => prev.map(s => s.id === sid ? { ...s, title } : s));
    } catch { /* ignore */ }
    setRenamingSessionId(null);
  }, [userId, renameValue]);

  // Close sessions dropdown on outside click
  useEffect(() => {
    if (!sessionsOpen) return;
    const close = () => setSessionsOpen(false);
    const timer = setTimeout(() => document.addEventListener('click', close), 0);
    return () => { clearTimeout(timer); document.removeEventListener('click', close); };
  }, [sessionsOpen]);

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
    let eventCount = 0;
    let lastEventType = '';
    let gotDone = false;
    const sseStart = Date.now();

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
            eventCount++;
            lastEventType = currentEvent;
            if (currentEvent === 'done') gotDone = true;
            onEvent({ type: currentEvent as StreamEvent['type'], data });
          } catch {
            console.warn('[AgentChat SSE] malformed JSON:', line.slice(6).slice(0, 200));
          }
        }
      }
    }

    const elapsed = ((Date.now() - sseStart) / 1000).toFixed(1);
    console.log(`[AgentChat SSE] stream ended — ${eventCount} events, ${elapsed}s, lastEvent=${lastEventType}, gotDone=${gotDone}`);
    if (!gotDone) {
      console.warn('[AgentChat SSE] stream ended WITHOUT done event — possible timeout or error');
    }
  }, []);

  // ── Audio helpers (ported from GrokChatPanel) ──────────────────

  const getAudioDurationSeconds = useCallback((file: File) => {
    return new Promise<number>((resolve, reject) => {
      try {
        const audio = document.createElement('audio');
        audio.preload = 'metadata';
        audio.onloadedmetadata = () => {
          URL.revokeObjectURL(audio.src);
          resolve(audio.duration || 0);
        };
        audio.onerror = (event) => {
          URL.revokeObjectURL(audio.src);
          reject((event as ErrorEvent).error || new Error('Unable to read audio metadata'));
        };
        audio.src = URL.createObjectURL(file);
      } catch (err) {
        reject(err as Error);
      }
    });
  }, []);

  const formatFileSize = useCallback((bytes: number) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, exponent);
    return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
  }, []);

  const formatDuration = useCallback((seconds: number | null) => {
    if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return 'unknown';
    const totalSeconds = Math.floor(seconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }, []);

  const formatChunkTimestamp = useCallback((seconds = 0) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  const handleAudioFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setAudioTranscriptionStatus('');
    setAudioChunkProgress({ current: 0, total: 0 });

    try {
      const duration = await getAudioDurationSeconds(file).catch(() => null);
      setSelectedAudioFile({
        file,
        name: file.name || 'audio-file',
        size: file.size,
        type: file.type || 'audio/wav',
        duration: typeof duration === 'number' && Number.isFinite(duration) ? duration : null,
      });
      setAudioAutoDetect(true);
      setAudioLanguage('no');
    } catch {
      setSelectedAudioFile(null);
      setAudioTranscriptionStatus('Failed to read audio file');
    }
  }, [getAudioDurationSeconds]);

  const clearSelectedAudio = useCallback(() => {
    setSelectedAudioFile(null);
    setAudioProcessing(false);
    setAudioTranscriptionStatus('');
    setAudioChunkProgress({ current: 0, total: 0 });
  }, []);

  const audioBufferToWavBlob = useCallback((audioBuffer: AudioBuffer) => {
    return new Promise<Blob>((resolve) => {
      const numberOfChannels = audioBuffer.numberOfChannels;
      const sampleRate = audioBuffer.sampleRate;
      const length = audioBuffer.length;
      const buffer = new ArrayBuffer(44 + length * numberOfChannels * 2);
      const view = new DataView(buffer);

      const writeString = (offset: number, str: string) => {
        for (let i = 0; i < str.length; i++) {
          view.setUint8(offset + i, str.charCodeAt(i));
        }
      };

      writeString(0, 'RIFF');
      view.setUint32(4, 36 + length * numberOfChannels * 2, true);
      writeString(8, 'WAVE');
      writeString(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, numberOfChannels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * numberOfChannels * 2, true);
      view.setUint16(32, numberOfChannels * 2, true);
      view.setUint16(34, 16, true);
      writeString(36, 'data');
      view.setUint32(40, length * numberOfChannels * 2, true);

      let offset = 44;
      for (let i = 0; i < length; i++) {
        for (let channel = 0; channel < numberOfChannels; channel++) {
          const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(channel)[i]));
          view.setInt16(offset, sample * 0x7fff, true);
          offset += 2;
        }
      }

      resolve(new Blob([buffer], { type: 'audio/wav' }));
    });
  }, []);

  const splitAudioIntoChunks = useCallback(async (
    file: File,
    chunkDurationSeconds = CHUNK_DURATION_SECONDS,
    onProgress?: (progress: { phase: string; current?: number; total?: number }) => void,
  ) => {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) throw new Error('Browser does not support audio processing');

    const arrayBuffer = await file.arrayBuffer();
    const audioContext = new AudioContextClass();

    try {
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const sampleRate = audioBuffer.sampleRate;
      const chunkSamples = chunkDurationSeconds * sampleRate;
      const totalSamples = audioBuffer.length;
      const totalChunks = Math.max(Math.ceil(totalSamples / chunkSamples), 1);

      onProgress?.({ phase: 'info', total: totalChunks });

      const chunks: Array<{ blob: Blob; startTime: number; endTime: number }> = [];
      for (let i = 0; i < totalChunks; i++) {
        const startSample = i * chunkSamples;
        const endSample = Math.min(startSample + chunkSamples, totalSamples);
        const chunkLength = endSample - startSample;
        const chunkBuffer = audioContext.createBuffer(
          audioBuffer.numberOfChannels,
          chunkLength,
          sampleRate,
        );

        for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
          const channelData = audioBuffer.getChannelData(channel);
          const chunkData = chunkBuffer.getChannelData(channel);
          for (let sample = 0; sample < chunkLength; sample++) {
            chunkData[sample] = channelData[startSample + sample];
          }
        }

        const blob = await audioBufferToWavBlob(chunkBuffer);
        chunks.push({
          blob,
          startTime: startSample / sampleRate,
          endTime: endSample / sampleRate,
        });

        onProgress?.({ phase: 'creating', current: i + 1, total: totalChunks });
      }

      return chunks;
    } finally {
      await audioContext.close();
    }
  }, [audioBufferToWavBlob]);

  const callWhisperTranscription = useCallback(async (blob: Blob, fileName: string) => {
    const formData = new FormData();
    formData.append('file', blob, fileName);
    formData.append('model', 'whisper-1');
    formData.append('userId', userId);
    if (!audioAutoDetect && audioLanguage) {
      formData.append('language', audioLanguage);
    }

    const response = await fetch(AUDIO_ENDPOINT, {
      method: 'POST',
      body: formData,
    });

    const payloadText = await response.text();
    let parsed: Record<string, unknown> | null;
    try {
      parsed = JSON.parse(payloadText);
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      const detail = (parsed?.error as string) || (parsed?.message as string) || payloadText || 'Audio transcription failed';
      throw new Error(typeof detail === 'string' ? detail : 'Audio transcription failed');
    }

    return parsed || { text: payloadText };
  }, [userId, audioAutoDetect, audioLanguage]);

  const startAudioTranscription = useCallback(async () => {
    if (!selectedAudioFile || audioProcessing) return;

    setAudioProcessing(true);
    setAudioTranscriptionStatus('Preparing audio...');
    setAudioChunkProgress({ current: 0, total: 0 });

    const { file, name } = selectedAudioFile;

    // Add user message to chat
    const userMsg: ChatMessage = { role: 'user', content: `Transcribe audio: "${name}"` };
    setMessages(prev => [...prev, userMsg]);

    try {
      const duration = selectedAudioFile.duration ?? (await getAudioDurationSeconds(file).catch(() => null));
      const hasDuration = typeof duration === 'number' && Number.isFinite(duration);
      const shouldChunk = hasDuration ? duration > CHUNK_DURATION_SECONDS : file.size > 8 * 1024 * 1024;

      let transcriptText: string;

      if (shouldChunk) {
        // Chunked transcription with progress
        setAudioTranscriptionStatus('Splitting audio into chunks...');
        const chunks = await splitAudioIntoChunks(file, CHUNK_DURATION_SECONDS, (progress) => {
          if (progress.phase === 'creating') {
            setAudioTranscriptionStatus(`Preparing chunk ${progress.current}/${progress.total}...`);
          }
        });

        if (!chunks.length) throw new Error('Audio could not be chunked');

        setAudioChunkProgress({ current: 0, total: chunks.length });
        const segments: string[] = [];
        const baseName = name.includes('.') ? name.substring(0, name.lastIndexOf('.')) : name;

        for (let i = 0; i < chunks.length; i++) {
          setAudioChunkProgress({ current: i + 1, total: chunks.length });
          setAudioTranscriptionStatus(`Processing chunk ${i + 1}/${chunks.length}...`);

          try {
            const chunkResult = await callWhisperTranscription(
              chunks[i].blob,
              `${baseName || 'audio'}_chunk_${i + 1}.wav`,
            );
            const chunkText = ((chunkResult.text as string) || '').trim();
            const chunkLabel = `[${formatChunkTimestamp(chunks[i].startTime)} - ${formatChunkTimestamp(chunks[i].endTime)}]`;
            if (chunkText) {
              segments.push(`${chunkLabel} ${chunkText}`);
            }
            setAudioTranscriptionStatus(`Completed chunk ${i + 1}/${chunks.length}`);
          } catch (error) {
            const chunkLabel = `[${formatChunkTimestamp(chunks[i].startTime)} - ${formatChunkTimestamp(chunks[i].endTime)}]`;
            segments.push(`${chunkLabel} [Error: ${error instanceof Error ? error.message : 'unknown'}]`);
            setAudioTranscriptionStatus(`Chunk ${i + 1}/${chunks.length} failed`);
          }
        }

        transcriptText = segments.join('\n\n');
      } else {
        // Single file transcription
        setAudioTranscriptionStatus('Uploading and transcribing...');
        const result = await callWhisperTranscription(file, name);
        transcriptText = ((result.text as string) || '').trim();
      }

      // Detect language label
      const langLabel = audioAutoDetect ? 'Auto-detected' : (audioLanguageOptions.find(o => o.code === audioLanguage)?.label || audioLanguage);

      // Add assistant message with transcription
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: `**Transcription of "${name}"**\nLanguage: ${langLabel}\n\n${transcriptText || '(No speech detected)'}`,
      };
      setMessages(prev => [...prev, assistantMsg]);

      clearSelectedAudio();
    } catch (error) {
      setAudioTranscriptionStatus(`Transcription failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Transcription failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      }]);
    } finally {
      setAudioProcessing(false);
      setAudioTranscriptionStatus('');
      setAudioChunkProgress({ current: 0, total: 0 });
    }
  }, [selectedAudioFile, audioProcessing, userId, audioAutoDetect, audioLanguage, audioLanguageOptions, getAudioDurationSeconds, splitAudioIntoChunks, callWhisperTranscription, formatChunkTimestamp, clearSelectedAudio]);

  // ── Image attachment helpers ──────────────────────────────────────
  const isImageUrl = useCallback((url: string) => /\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)(\?|$)/i.test(url) || url.includes('imgix.net'), []);

  const addImageFromUrl = useCallback((url: string, label?: string) => {
    setPendingImages(prev => [...prev, { type: 'url', url, label: label || url.split('/').pop() || 'image' }]);
  }, []);

  const addImageFromFile = useCallback(async (file: File) => {
    // Show a temporary preview while uploading
    const tempUrl = URL.createObjectURL(file);
    setPendingImages(prev => [...prev, { type: 'url', url: tempUrl, label: `Uploading ${file.name}...` }]);

    try {
      // Read file as base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });

      // Upload to photos API via agent-worker
      const res = await fetch(`${AGENT_API}/upload-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, base64, mediaType: file.type || 'image/png', filename: file.name }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(err.error || `Upload failed (${res.status})`);
      }

      const data = await res.json();
      const imgixUrl = data.url;

      // Replace temp preview with real imgix URL
      setPendingImages(prev => prev.map(img =>
        img.url === tempUrl ? { type: 'url', url: imgixUrl, label: file.name } : img
      ));
    } catch (err) {
      // Remove failed upload from pending and show error
      setPendingImages(prev => prev.filter(img => img.url !== tempUrl));
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setUploadError(msg);
      setTimeout(() => setUploadError(null), 5000);
      console.error('Image upload failed:', err);
    } finally {
      URL.revokeObjectURL(tempUrl);
    }
  }, [userId]);

  const handleImageDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setImageDragActive(false);

    // Check for photos-vegvisr app drag data (application/x-photo-keys or application/x-photo-key)
    const keysJson = e.dataTransfer.getData('application/x-photo-keys');
    const singleKey = e.dataTransfer.getData('application/x-photo-key');
    if (keysJson || singleKey) {
      const keys: string[] = keysJson ? JSON.parse(keysJson) : [singleKey].filter(Boolean);
      for (const key of keys) {
        addImageFromUrl(`https://vegvisr.imgix.net/${key}`, key);
      }
      return;
    }

    // Check for URL drops
    const textData = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (textData) {
      const urls = textData.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
      const imageUrls = urls.filter(u => isImageUrl(u));
      if (imageUrls.length > 0) {
        for (const url of imageUrls) addImageFromUrl(url);
        return;
      }
    }

    // Check for file drops
    const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/'));
    for (const file of files) addImageFromFile(file);
  }, [addImageFromUrl, addImageFromFile, isImageUrl]);

  const handleImagePaste = useCallback((e: React.ClipboardEvent) => {
    const clipboard = e.clipboardData;
    if (!clipboard) return;

    // Check for pasted image files
    const files: File[] = [];
    for (const item of Array.from(clipboard.items || [])) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      for (const file of files) addImageFromFile(file);
      return;
    }

    // Check for pasted image URL
    const text = clipboard.getData('text/plain');
    if (text && isImageUrl(text.trim())) {
      e.preventDefault();
      addImageFromUrl(text.trim());
    }
  }, [addImageFromFile, addImageFromUrl, isImageUrl]);

  const handleImageFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'));
    for (const file of files) addImageFromFile(file);
    if (e.target) e.target.value = '';
  }, [addImageFromFile]);

  const removeImage = useCallback((index: number) => {
    setPendingImages(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      const isPdf = file.type === 'application/pdf';
      const isText = file.type === 'text/plain' || file.name.endsWith('.txt') || file.name.endsWith('.md') || file.name.endsWith('.csv') || file.name.endsWith('.json') || file.name.endsWith('.xml') || file.name.endsWith('.html') || file.name.endsWith('.css') || file.name.endsWith('.js') || file.name.endsWith('.ts');
      if (!isPdf && !isText) continue;

      const reader = new FileReader();
      if (isPdf) {
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          setPendingFiles(prev => [...prev, {
            name: file.name,
            mediaType: 'application/pdf',
            data: base64,
            size: file.size,
          }]);
        };
        reader.readAsDataURL(file);
      } else {
        reader.onload = () => {
          setPendingFiles(prev => [...prev, {
            name: file.name,
            mediaType: file.type || 'text/plain',
            data: reader.result as string,
            size: file.size,
          }]);
        };
        reader.readAsText(file);
      }
    }
    if (e.target) e.target.value = '';
  }, []);

  const removeFile = useCallback((index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleGraphCreated = useCallback((newGraphId: string, title: string) => {
    onGraphChange(newGraphId);
    lastAgentGraphRef.current = newGraphId;
    setGraphs(prev => prev.some(g => g.id === newGraphId) ? prev : [{ id: newGraphId, metadata_title: title }, ...prev]);
  }, [onGraphChange]);

  const handleNodeAdded = useCallback((_gId: string, _nId: string, _label: string) => {
    // nothing extra needed — message is shown via onMessage
  }, []);

  const pushActionMessage = useCallback((msg: string) => {
    setMessages(prev => [...prev, { role: 'assistant', content: msg }]);
  }, []);

  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText || input).trim();
    const images = pendingImages;
    const files = pendingFiles;
    if ((!text && images.length === 0 && files.length === 0) || streaming) return;

    setInput('');
    setSuggestions([]);
    setPendingImages([]);
    setPendingFiles([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setStreaming(true);

    // Lazy session creation
    let activeSession = sessionIdRef.current;
    if (!activeSession) {
      try {
        const sRes = await historyFetch('/sessions', userId, {
          method: 'POST',
          body: JSON.stringify({
            graphId: graphId || null,
            provider: 'agent',
            title: text.slice(0, 60),
          }),
        });
        const sData = await sRes.json();
        activeSession = sData.session?.id || null;
        if (activeSession) {
          setSessionId(activeSession);
          setSessions(prev => [{ id: activeSession!, title: text.slice(0, 60), updatedAt: new Date().toISOString() }, ...prev]);
        }
      } catch { /* continue without persistence */ }
    }

    const fileLabel = files.length > 0 ? `(${files.map(f => f.name).join(', ')} attached)` : '';
    const contentLabel = text || (images.length > 0 ? '(image attached)' : fileLabel || '(file attached)');
    const userMsg: ChatMessage = { role: 'user', content: contentLabel, images: images.length > 0 ? images : undefined, files: files.length > 0 ? files : undefined };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);

    // Build multimodal content for the API when images or files are present
    const apiMessages = updatedMessages.map(m => {
      // Strip transcription body from messages sent to Claude — saves tokens.
      // The full text is available locally for direct KG save via the button.
      if (m.role === 'assistant' && typeof m.content === 'string' && m.content.startsWith('**Audio Transcription**')) {
        const firstNewline = m.content.indexOf('\n\n');
        const summary = firstNewline > 0 ? m.content.slice(0, firstNewline) : m.content.slice(0, 120);
        return { role: m.role, content: summary + '\n\n(Full transcription text available locally — use the "Save to Graph" button to save directly.)' };
      }
      const hasImages = m.images && m.images.length > 0;
      const hasFiles = m.files && m.files.length > 0;
      if (hasImages || hasFiles) {
        const contentBlocks: unknown[] = [];

        // Add image blocks
        if (m.images) {
          for (const img of m.images) {
            contentBlocks.push({ type: 'image', source: { type: 'url', url: img.url } });
          }
        }

        // Add file blocks (PDF as document, text inline)
        if (m.files) {
          for (const file of m.files) {
            if (file.mediaType === 'application/pdf') {
              contentBlocks.push({
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: file.data },
              });
            } else {
              // Text files: include content inline
              contentBlocks.push({
                type: 'text',
                text: `--- File: ${file.name} ---\n${file.data}\n--- End of ${file.name} ---`,
              });
            }
          }
        }

        // Add user text
        const imageMeta = m.images ? m.images.map((img, i) =>
          `[Image ${i + 1}: ${img.url} — use this URL for graph nodes (type: markdown-image, path: "${img.url}")]`
        ).join('\n') : '';
        const fileMeta = m.files ? m.files.map((f, i) =>
          `[File ${i + 1}: ${f.name} (${(f.size / 1024).toFixed(1)} KB)]`
        ).join('\n') : '';
        const meta = [imageMeta, fileMeta].filter(Boolean).join('\n');
        const userText = m.content || (hasImages ? 'What do you see in this image?' : 'Please analyze the attached file(s).');
        contentBlocks.push({ type: 'text', text: meta ? `${meta}\n\n${userText}` : userText });
        return { role: m.role, content: contentBlocks };
      }
      return { role: m.role, content: m.content };
    });

    // Persist user message
    if (activeSession) {
      historyFetch('/messages', userId, {
        method: 'POST',
        body: JSON.stringify({ sessionId: activeSession, role: 'user', content: text || '(image attached)' }),
      }).catch(() => {});
    }

    const state: AssistantState = { text: '', toolCalls: [], thinking: false };
    setCurrent(state);

    let finalToolCalls: ToolCall[] = [];
    let pendingClientTranscription: { audioUrl: string; recordingId: string | null; language: string | null; saveToGraph: boolean; graphTitle: string | null } | null = null;

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      // Detect @botname at the start of the message
      const botMention = text.match(/^@(\S+)\s*([\s\S]*)$/);
      const mentionedBot = botMention ? bots.find(b => b.username.toLowerCase() === botMention[1].toLowerCase()) : null;
      const botMessage = mentionedBot ? (botMention![2] || '').trim() || text : null;
      console.log('[AgentChat] bot detection:', { text: text.slice(0, 50), botsLoaded: bots.length, botMention: botMention?.[1], mentionedBot: mentionedBot?.username, botMessage, routeTo: mentionedBot ? '/bot-chat' : '/chat' });

      // ── Local Ollama path ──────────────────────────────────────────────────
      if (model?.startsWith('ollama/')) {
        const ollamaModel = model.replace('ollama/', '');
        const KG_BASE = 'https://knowledge.vegvisr.org';

        // KG tool definitions (Ollama / OpenAI function-calling format)
        const ollamaTools = [
          {
            type: 'function',
            function: {
              name: 'create_graph',
              description: 'Create a new knowledge graph. The graph ID is assigned automatically — do not choose one.',
              parameters: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Title of the graph' },
                  description: { type: 'string', description: 'Short description (optional)' },
                },
                required: ['title'],
              },
            },
          },
          {
            type: 'function',
            function: {
              name: 'create_node',
              description: 'Add a fulltext node (markdown content) to an existing knowledge graph',
              parameters: {
                type: 'object',
                properties: {
                  graphId: { type: 'string', description: 'The graph ID to add the node to' },
                  label: { type: 'string', description: 'Title/label for the node' },
                  content: { type: 'string', description: 'Markdown content for the node' },
                },
                required: ['graphId', 'label', 'content'],
              },
            },
          },
          {
            type: 'function',
            function: {
              name: 'read_graph',
              description: 'Read the contents of an existing knowledge graph by its ID',
              parameters: {
                type: 'object',
                properties: {
                  graphId: { type: 'string', description: 'The ID of the graph to read' },
                },
                required: ['graphId'],
              },
            },
          },
        ];

        // Auto-load Gemma Rules graph as system context (best-effort, silent on failure)
        let rulesSystemMessage = '';
        try {
          const rulesRes = await fetch(`${KG_BASE}/getknowgraph?id=gemma_rules`);
          if (rulesRes.ok) {
            const rulesGraph = await rulesRes.json() as { nodes?: Array<{ label?: string; info?: string }> };
            const ruleNodes = (rulesGraph.nodes || [])
              .filter(n => n.info)
              .map(n => `### ${n.label || 'Rule'}\n${n.info}`)
              .join('\n\n');
            if (ruleNodes) {
              rulesSystemMessage = `You are an AI agent with the following operating rules:\n\n${ruleNodes}\n\nFollow these rules for every response.`;
            }
          }
        } catch { /* rules graph not found — proceed without */ }

        // Flatten messages for Ollama (no multimodal blocks)
        const ollamaMessages: Array<{ role: string; content: string }> = apiMessages.map(m => ({
          role: m.role as string,
          content: Array.isArray(m.content)
            ? (m.content as Array<{ type: string; text?: string }>).map(c => c.text ?? '').join('')
            : (m.content as string),
        }));

        // Prepend rules as system message if loaded
        if (rulesSystemMessage) {
          ollamaMessages.unshift({ role: 'system', content: rulesSystemMessage });
        }

        // Agentic loop — up to 5 turns to handle tool calls
        let assistantText = '';
        let toolCallsForUI: ToolCall[] = [];

        for (let turn = 0; turn < 5; turn++) {
          setCurrent({ text: assistantText, toolCalls: toolCallsForUI, thinking: turn > 0 });

          const ollamaRes = await fetch('http://localhost:11434/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: ollamaModel, messages: ollamaMessages, tools: ollamaTools, stream: false }),
            signal: abort.signal,
          });

          if (!ollamaRes.ok) throw new Error(`Ollama request failed: ${ollamaRes.status}. Is Ollama running at localhost:11434?`);

          const ollamaData = await ollamaRes.json() as {
            message: {
              role: string;
              content: string;
              tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
            };
          };

          const msg = ollamaData.message;
          // Add assistant turn to conversation history
          ollamaMessages.push({ role: msg.role, content: msg.content || '' });

          // No tool calls → final text answer
          if (!msg.tool_calls || msg.tool_calls.length === 0) {
            assistantText = msg.content || '';
            setCurrent({ text: assistantText, toolCalls: toolCallsForUI, thinking: false });
            break;
          }

          // Execute each tool call against the KG API
          for (const tc of msg.tool_calls) {
            const { name, arguments: args } = tc.function;
            const tcId = `tc_${Date.now()}_${toolCallsForUI.length}`;
            toolCallsForUI = [...toolCallsForUI, { id: tcId, tool: name, input: args, status: 'running' }];
            setCurrent({ text: '', toolCalls: toolCallsForUI, thinking: false });

            let toolResult: Record<string, unknown>;
            try {
              if (name === 'create_graph') {
                const graphId = `graph_${Date.now()}`;
                const kgRes = await fetch(`${KG_BASE}/saveGraphWithHistory`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin' },
                  body: JSON.stringify({
                    id: graphId,
                    graphData: {
                      nodes: [],
                      edges: [],
                      metadata: { title: args.title as string, description: (args.description as string) || '', metaArea: 'GENERAL' },
                    },
                    override: true,
                  }),
                });
                const kgData = await kgRes.json() as Record<string, unknown>;
                toolResult = { success: true, graphId, ...kgData };
                lastAgentGraphRef.current = graphId;
                onGraphChange(graphId);
              } else if (name === 'create_node') {
                const nodeId = `node_${Date.now()}`;
                const kgRes = await fetch(`${KG_BASE}/addNode`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin' },
                  body: JSON.stringify({
                    graphId: args.graphId,
                    node: { id: nodeId, label: args.label, type: 'fulltext', info: args.content, visible: true, position: { x: 0, y: 0 } },
                  }),
                });
                const kgData = await kgRes.json() as Record<string, unknown>;
                toolResult = { success: true, nodeId, ...kgData };
              } else if (name === 'read_graph') {
                const kgRes = await fetch(`${KG_BASE}/getknowgraph?id=${encodeURIComponent(args.graphId as string)}`);
                const kgData = await kgRes.json() as { nodes?: unknown[]; edges?: unknown[]; metadata?: Record<string, unknown> };
                const nodeSummaries = (kgData.nodes || []).map((n: unknown) => {
                  const node = n as Record<string, unknown>;
                  return { id: node.id, label: node.label, type: node.type, info: typeof node.info === 'string' ? node.info.slice(0, 500) : '' };
                });
                toolResult = { success: true, graphId: args.graphId, metadata: kgData.metadata, nodes: nodeSummaries };
              } else {
                toolResult = { error: `Unknown tool: ${name}` };
              }
            } catch (toolErr) {
              toolResult = { error: toolErr instanceof Error ? toolErr.message : String(toolErr) };
            }

            // Update tool status in UI
            const tcStatus: 'success' | 'error' = toolResult.error ? 'error' : 'success';
            const tcSummary = toolResult.error ? String(toolResult.error)
              : toolResult.graphId && name === 'create_graph' ? `Created graph: ${toolResult.graphId}`
              : toolResult.nodeId ? `Created node: ${toolResult.nodeId}`
              : name === 'read_graph' ? `Read graph: ${args.graphId} (${(toolResult.nodes as unknown[])?.length ?? 0} nodes)`
              : 'Done';
            toolCallsForUI = toolCallsForUI.map(t => t.id === tcId ? { ...t, status: tcStatus, summary: tcSummary } : t);
            setCurrent({ text: '', toolCalls: toolCallsForUI, thinking: false });

            // Feed tool result back into the conversation
            ollamaMessages.push({ role: 'tool', content: JSON.stringify(toolResult) });
          }
        }

        setMessages(prev => [...prev, { role: 'assistant', content: assistantText, toolCalls: toolCallsForUI.length > 0 ? toolCallsForUI : undefined }]);
        if (activeSession) {
          historyFetch('/messages', userId, {
            method: 'POST',
            body: JSON.stringify({ sessionId: activeSession, role: 'assistant', content: assistantText, provider: 'ollama' }),
          }).catch(() => {});
        }

        abortRef.current = null;
        setCurrent(null);
        setStreaming(false);
        setSubagentProgress(null);
        return;
      }
      // ── End Ollama path ────────────────────────────────────────────────────

      const res = mentionedBot ? await fetch(`${AGENT_API}/bot-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          botId: mentionedBot.id,
          message: botMessage,
          conversationHistory: messages.filter(m => !m.images).map(m => ({ role: m.role, content: m.content })),
        }),
        signal: abort.signal,
      }) : await fetch(`${AGENT_API}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          messages: apiMessages,
          graphId: lastAgentGraphRef.current || graphId || undefined,
          agentId: agentId || undefined,
          activeHtmlNodeId: lastHtmlNodeIdRef.current || undefined,
          model: model || undefined,
        }),
        signal: abort.signal,
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
        // Auto-switch graph context when agent reads or creates in a graph
        if (ev.type === 'tool_call') {
          const toolName = ev.data.tool as string;
          const inp = ev.data.input as Record<string, unknown>;
          if (inp.graphId && typeof inp.graphId === 'string') {
            if (['read_graph', 'read_graph_content', 'create_graph', 'create_html_node', 'create_node', 'create_html_from_template', 'edit_html_node'].includes(toolName)) {
              lastAgentGraphRef.current = inp.graphId as string;
              onGraphChange(inp.graphId as string);
            }
          }
        }

        // Auto-open preview when an HTML node is created or patched
        // Also enable the dev loop so console errors get fed back to the agent
        if (ev.type === 'tool_result' && ev.data.success && onPreview) {
          const toolName = ev.data.tool as string;
          if (toolName === 'create_html_node' || toolName === 'create_html_from_template') {
            // Read nodeId from result first (executor may auto-generate it), fall back to input
            const resultNodeId = (ev.data as Record<string, unknown>).nodeId as string | undefined;
            if (resultNodeId) { lastHtmlNodeIdRef.current = resultNodeId; onActiveHtmlNode?.(resultNodeId); }
            setCurrent(prev => {
              if (!prev) return prev;
              const tc = [...prev.toolCalls].reverse().find(t => t.tool === toolName && t.status === 'running');
              if (tc) {
                const inp = tc.input as Record<string, unknown>;
                if (!resultNodeId && inp.nodeId) { lastHtmlNodeIdRef.current = inp.nodeId as string; onActiveHtmlNode?.(inp.nodeId as string); }
                const html = (inp.htmlContent || inp.content || inp.info || '') as string;
                if (html) setTimeout(() => onPreview(html), 0);
              }
              return prev;
            });
          } else if (toolName === 'patch_node') {
            setCurrent(prev => {
              if (!prev) return prev;
              const tc = [...prev.toolCalls].reverse().find(t => t.tool === 'patch_node' && t.status === 'running');
              if (tc) {
                const inp = tc.input as Record<string, unknown>;
                if (inp.nodeId) { lastHtmlNodeIdRef.current = inp.nodeId as string; onActiveHtmlNode?.(inp.nodeId as string); }
                const flds = (inp.fields || {}) as Record<string, unknown>;
                const html = flds.info as string;
                if (html && html.includes('<html')) setTimeout(() => onPreview(html), 0);
              }
              return prev;
            });
          } else if (toolName === 'edit_html_node') {
            const resultData = ev.data as Record<string, unknown>;
            if (resultData.nodeId) { lastHtmlNodeIdRef.current = resultData.nodeId as string; onActiveHtmlNode?.(resultData.nodeId as string); }
            const updatedHtml = resultData.updatedHtml as string;
            if (updatedHtml && updatedHtml.includes('<html')) {
              setTimeout(() => onPreview(updatedHtml), 0);
            }
          } else if (toolName === 'delegate_to_html_builder') {
            const resultData = ev.data as Record<string, unknown>;
            const subNodeId = resultData.nodeId as string;
            const subGraphId = resultData.graphId as string;
            if (subNodeId) { lastHtmlNodeIdRef.current = subNodeId; onActiveHtmlNode?.(subNodeId); }
            if (subGraphId) { lastAgentGraphRef.current = subGraphId; onGraphChange(subGraphId); }
            // Fetch the updated HTML from the node to show in preview
            if (subGraphId && subNodeId) {
              fetch(`https://knowledge.vegvisr.org/getknowgraph?id=${encodeURIComponent(subGraphId)}`)
                .then(r => r.json())
                .then(graph => {
                  const node = (graph.nodes || []).find((n: Record<string, unknown>) => n.id === subNodeId);
                  if (node?.info && typeof node.info === 'string' && node.info.includes('<html')) {
                    setTimeout(() => onPreview(node.info as string), 0);
                  }
                })
                .catch(() => {});
            }
          } else if (toolName === 'delegate_to_kg' || toolName === 'delegate_to_video') {
            // Track graphId from KG/video delegation results so the dropdown stays in sync
            const resultData = ev.data as Record<string, unknown>;
            const subGraphId = resultData.graphId as string;
            if (subGraphId) { lastAgentGraphRef.current = subGraphId; onGraphChange(subGraphId); }
          }
        }

        // Detect clientSideRequired from transcribe_audio tool result
        if (ev.type === 'tool_result' && ev.data.tool === 'transcribe_audio' && ev.data.clientSideRequired) {
          pendingClientTranscription = {
            audioUrl: ev.data.audioUrl as string,
            recordingId: (ev.data.recordingId as string) || null,
            language: (ev.data.language as string) || null,
            saveToGraph: !!ev.data.saveToGraph,
            graphTitle: (ev.data.graphTitle as string) || null,
          };
        }

        // Accumulate text OUTSIDE setCurrent so it's available immediately for finalization
        // (React 18 batches state updaters — they may not run before parseSSE returns)
        if (ev.type === 'text') {
          const content = ev.data.content;
          assistantText += typeof content === 'string' ? content : JSON.stringify(content);
        }

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

            case 'tool_progress': {
              const progressTool = ev.data.tool as string;
              const progressMsg = ev.data.message as string;
              if (
                progressTool === 'delegate_to_html_builder' ||
                progressTool === 'delegate_to_kg' ||
                progressTool === 'delegate_to_youtube_graph'
              ) {
                setSubagentProgress(progressMsg);
              }
              for (let i = next.toolCalls.length - 1; i >= 0; i--) {
                if (next.toolCalls[i].tool === progressTool && next.toolCalls[i].status === 'running') {
                  next.toolCalls[i] = { ...next.toolCalls[i], progress: progressMsg };
                  break;
                }
              }
              break;
            }

            case 'tool_result': {
              const tool = ev.data.tool as string;
              for (let i = next.toolCalls.length - 1; i >= 0; i--) {
                if (next.toolCalls[i].tool === tool && next.toolCalls[i].status === 'running') {
                  next.toolCalls[i] = {
                    ...next.toolCalls[i],
                    status: ev.data.success ? 'success' : 'error',
                    summary: (ev.data.summary as string) || undefined,
                    result: ev.data,
                    progress: undefined,
                  };
                  break;
                }
              }
              break;
            }

            case 'text':
              next.thinking = false;
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

        // Handle agent_info event (avatar, etc.)
        if (ev.type === 'agent_info' && ev.data.avatarUrl) {
          setAgentAvatar(ev.data.avatarUrl as string);
        }

        // Handle suggestions event outside setCurrent (separate state)
        if (ev.type === 'suggestions' && Array.isArray(ev.data.suggestions)) {
          setSuggestions(ev.data.suggestions as string[]);
        }
      });

      // Finalize: move current into messages — preserve tool calls AND text
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: assistantText,
        toolCalls: finalToolCalls.length > 0 ? finalToolCalls : undefined,
      }]);

      // Persist assistant message with tool metadata
      if (activeSession) {
        historyFetch('/messages', userId, {
          method: 'POST',
          body: JSON.stringify({
            sessionId: activeSession,
            role: 'assistant',
            content: assistantText,
            provider: 'agent',
            proffData: finalToolCalls.length > 0 ? { toolCalls: finalToolCalls } : null,
          }),
        }).catch(() => {});
      }

      // Handle client-side transcription if the tool requested it
      // (TypeScript can't track mutation inside callbacks, so cast to check)
      const clientTx = pendingClientTranscription as { audioUrl: string; recordingId: string | null; language: string | null; saveToGraph: boolean; graphTitle: string | null } | null;
      if (clientTx) {
        const txAudioUrl = clientTx.audioUrl;
        const txLang = clientTx.language;
        setCurrent({ text: 'Downloading audio for browser-based transcription...', toolCalls: [], thinking: false });

        try {
          // Download audio as File
          const audioResponse = await fetch(txAudioUrl);
          const audioArrayBuffer = await audioResponse.arrayBuffer();
          const txContentType = audioResponse.headers.get('content-type') || 'audio/webm';
          const txFileName = txAudioUrl.split('/').pop() || 'audio.webm';
          const audioFile = new File([audioArrayBuffer], txFileName, { type: txContentType });

          // Split into 120s WAV chunks using AudioContext
          setCurrent(prev => prev ? { ...prev, text: 'Splitting audio into 2-minute chunks...' } : prev);
          const chunks = await splitAudioIntoChunks(audioFile, CHUNK_DURATION_SECONDS, (progress) => {
            if (progress.phase === 'creating' && progress.current && progress.total) {
              setCurrent(prev => prev ? { ...prev, text: `Preparing chunk ${progress.current}/${progress.total}...` } : prev);
            }
          });

          if (!chunks.length) throw new Error('Audio could not be chunked');

          // Transcribe each WAV chunk via openai.vegvisr.org/audio
          const segments: string[] = [];
          const baseName = txFileName.includes('.') ? txFileName.substring(0, txFileName.lastIndexOf('.')) : txFileName;

          // Temporarily set language if the tool provided one
          const prevAutoDetect = audioAutoDetect;
          const prevLang = audioLanguage;
          if (txLang) {
            setAudioAutoDetect(false);
            setAudioLanguage(txLang);
          }

          for (let i = 0; i < chunks.length; i++) {
            setCurrent(prev => prev ? { ...prev, text: `Transcribing chunk ${i + 1}/${chunks.length}...` } : prev);

            try {
              const chunkResult = await callWhisperTranscription(
                chunks[i].blob,
                `${baseName}_chunk_${i + 1}.wav`,
              );
              const chunkText = ((chunkResult.text as string) || '').trim();
              const chunkLabel = `[${formatChunkTimestamp(chunks[i].startTime)} - ${formatChunkTimestamp(chunks[i].endTime)}]`;
              if (chunkText) {
                segments.push(`${chunkLabel} ${chunkText}`);
              }
            } catch (chunkErr) {
              const chunkLabel = `[${formatChunkTimestamp(chunks[i].startTime)} - ${formatChunkTimestamp(chunks[i].endTime)}]`;
              segments.push(`${chunkLabel} [Error: ${chunkErr instanceof Error ? chunkErr.message : 'unknown'}]`);
            }
          }

          // Restore language settings
          setAudioAutoDetect(prevAutoDetect);
          setAudioLanguage(prevLang);

          const txText = segments.join('\n\n');

          // If saveToGraph requested, create graph + fulltext node directly (no LLM round-trip)
          let graphLink = '';
          if (clientTx.saveToGraph && txText) {
            setCurrent(prev => prev ? { ...prev, text: 'Saving transcription to graph...' } : prev);
            const newGraphId = crypto.randomUUID();
            const title = clientTx.graphTitle || `Transcription - ${txFileName.replace(/\.[^.]+$/, '')}`;
            try {
              await fetch(`${KG_API}/saveGraphWithHistory`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin', ...(userEmail ? { 'x-user-email': userEmail } : {}) },
                body: JSON.stringify({
                  id: newGraphId,
                  graphData: {
                    nodes: [{
                      id: 'node-transcription',
                      label: '# Full Transcription',
                      type: 'fulltext',
                      info: txText,
                      color: '#4A90D9',
                    }],
                    edges: [],
                    metadata: { title, description: `Audio transcription (${chunks.length} chunks)`, category: '#Transcription #Audio' },
                  },
                  override: true,
                }),
              });
              graphLink = `\n\n[View Graph: ${title}](https://www.vegvisr.org/gnew-viewer?graphId=${newGraphId})`;
            } catch {
              graphLink = '\n\n(Failed to save graph)';
            }
          }

          const txContent = `**Audio Transcription** (${chunks.length} chunks, processed on your device)${graphLink}\n\n${txText || '(No speech detected)'}`;

          setMessages(prev => [...prev, { role: 'assistant', content: txContent }]);

          if (activeSession) {
            historyFetch('/messages', userId, {
              method: 'POST',
              body: JSON.stringify({ sessionId: activeSession, role: 'assistant', content: txContent, provider: 'agent' }),
            }).catch(() => {});
          }
        } catch (txErr) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `Client-side transcription failed: ${txErr instanceof Error ? txErr.message : String(txErr)}`,
          }]);
        }
      }
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      setCurrent(prev => prev ? { ...prev, thinking: false, error: isAbort ? undefined : (err instanceof Error ? err.message : String(err)) } : prev);
      // Save what we have — show "Stopped by user" for aborts
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: current?.text || (isAbort ? '*(Stopped by user)*' : `Error: ${err instanceof Error ? err.message : String(err)}`),
        toolCalls: finalToolCalls.length > 0 ? finalToolCalls : undefined,
      }]);
    }

    abortRef.current = null;
    setCurrent(null);
    setStreaming(false);
    setSubagentProgress(null);
  }, [input, streaming, messages, userId, graphId, bots, parseSSE, current, splitAudioIntoChunks, callWhisperTranscription, formatChunkTimestamp, audioAutoDetect, audioLanguage]);

  const stopStreaming = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const hasMessages = messages.length > 0 || current !== null;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Graph selector bar + Sessions + Copy Log */}
      <div className="flex items-center justify-between px-3 sm:px-4 py-2 border-b border-white/10 bg-slate-950/80 flex-wrap gap-2">
        <div className="flex-1 flex items-center gap-2">
          {/* Session picker */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setSessionsOpen(p => !p)}
              className="px-3 py-1 rounded-md border border-white/10 bg-white/[0.04] text-white/60 text-xs hover:bg-white/[0.08] hover:text-white/80 transition-colors"
            >
              Sessions ({sessions.length})
            </button>
            {sessionsOpen && (
              <div className="absolute top-full mt-1 left-0 w-[calc(100vw-2rem)] sm:w-72 max-h-64 overflow-y-auto bg-slate-900 border border-white/10 rounded-lg z-50 shadow-xl">
                <button
                  type="button"
                  onClick={() => { setMessages([]); setSessionId(null); setSessionsOpen(false); }}
                  className="w-full px-3 py-2 text-left text-xs text-sky-400 hover:bg-white/[0.06] border-b border-white/10"
                >
                  + New Session
                </button>
                {sessions.length === 0 && (
                  <div className="px-3 py-3 text-white/30 text-xs">No saved sessions</div>
                )}
                {sessions.map(s => (
                  <div
                    key={s.id}
                    className={`w-full px-3 py-2 text-left text-xs hover:bg-white/[0.06] flex items-center gap-1 ${s.id === sessionId ? 'text-sky-400 bg-sky-400/[0.06]' : 'text-white/60'}`}
                  >
                    {renamingSessionId === s.id ? (
                      <input
                        autoFocus
                        title="Rename session"
                        className="flex-1 min-w-0 bg-white/10 text-white text-xs px-1 py-0.5 rounded outline-none"
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') renameSession(s.id); if (e.key === 'Escape') setRenamingSessionId(null); }}
                        onBlur={() => renameSession(s.id)}
                      />
                    ) : (
                      <button
                        type="button"
                        className="flex-1 min-w-0 text-left"
                        onClick={() => loadSession(s.id)}
                        onDoubleClick={(e) => { e.stopPropagation(); setRenamingSessionId(s.id); setRenameValue(s.title); }}
                      >
                        <div className="truncate">{s.title}</div>
                        {s.updatedAt && <div className="text-white/30 text-[10px]">{new Date(s.updatedAt).toLocaleDateString()}</div>}
                      </button>
                    )}
                    <span
                      onClick={(e) => { e.stopPropagation(); setRenamingSessionId(s.id); setRenameValue(s.title); }}
                      className="flex-shrink-0 text-white/20 hover:text-sky-400 text-[10px] px-0.5 cursor-pointer"
                      title="Rename session"
                    >
                      &#9998;
                    </span>
                    <span
                      onClick={(e) => deleteSession(s.id, e)}
                      className="flex-shrink-0 text-white/20 hover:text-rose-400 text-sm px-0.5 cursor-pointer"
                      title="Delete session"
                    >
                      &times;
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
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
          {(graphId || lastAgentGraphRef.current) && onPreview && (
            <div className="relative">
              <button
                type="button"
                onClick={async () => {
                  if (htmlNodePicker) { setHtmlNodePicker(null); return; }
                  const targetGraph = graphId || lastAgentGraphRef.current;
                  if (!targetGraph) return;
                  try {
                    const res = await fetch(`https://knowledge.vegvisr.org/getknowgraph?id=${encodeURIComponent(targetGraph)}`);
                    if (!res.ok) return;
                    const data = await res.json();
                    const nodes = (data.nodes || []).filter((n: { type?: string }) => n.type === 'html-node');
                    if (nodes.length === 0) { alert('No HTML app nodes found in this graph.'); return; }
                    if (nodes.length === 1) {
                      lastAgentGraphRef.current = targetGraph;
                      lastHtmlNodeIdRef.current = nodes[0].id;
                      onActiveHtmlNode?.(nodes[0].id);
                      onPreview(nodes[0].info);
                    } else {
                      setHtmlNodePicker(nodes.map((n: { id: string; label?: string; info: string }) => ({ id: n.id, label: n.label || n.id, info: n.info })));
                    }
                  } catch { /* ignore */ }
                }}
                className="px-3 py-1 rounded-md border border-sky-500/20 bg-sky-600/20 text-sky-300 text-xs hover:bg-sky-600/30 transition-colors"
                title="Load HTML app from selected graph into preview"
              >
                Develop
              </button>
              {htmlNodePicker && (
                <div className="absolute top-full mt-1 right-0 w-64 bg-slate-900 border border-white/10 rounded-lg z-50 shadow-xl">
                  {htmlNodePicker.map(n => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => { lastAgentGraphRef.current = lastAgentGraphRef.current || graphId; lastHtmlNodeIdRef.current = n.id; onActiveHtmlNode?.(n.id); onPreview(n.info); setHtmlNodePicker(null); }}
                      className="w-full px-3 py-2 text-left text-xs text-white/60 hover:bg-white/[0.06] hover:text-white"
                    >
                      {n.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
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

      {/* Active graph context banner */}
      {graphId && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-purple-600/10 border-b border-purple-500/20 text-purple-300 text-xs flex-shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-purple-400 flex-shrink-0 animate-pulse" />
          <span className="font-medium text-purple-200">Active context:</span>
          <span className="truncate text-purple-300/90">
            {graphs.find(g => g.id === graphId)?.metadata_title || graphId}
          </span>
          <button
            type="button"
            onClick={() => onGraphChange('')}
            className="ml-auto text-purple-400/40 hover:text-purple-300 transition-colors flex-shrink-0 leading-none"
            title="Clear graph context"
          >
            ✕
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 sm:py-5 flex flex-col gap-4">
        {!hasMessages && (
          <div className="text-center py-10 sm:py-16 px-4 text-white/60">
            <h2 className="text-white text-xl sm:text-2xl font-semibold mb-2 sm:mb-3">Agent Chat</h2>
            <p className="text-sm sm:text-base leading-relaxed max-w-[500px] mx-auto">
              I can help you create knowledge graphs, build HTML pages, modify content, and manage your apps. What would you like to do?
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex gap-2 sm:gap-2.5 max-w-[92%] sm:max-w-[80%] ${
              msg.role === 'user' ? 'self-end flex-row-reverse' : 'self-start'
            }`}
          >
            {/* Agent avatar for assistant messages */}
            {msg.role === 'assistant' && (
              <div className="flex-shrink-0 mt-1">
                {agentAvatar ? (
                  <img src={agentAvatar} alt="" className="w-7 h-7 rounded-full border border-white/20 object-cover" />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-purple-600/30 border border-purple-500/30 flex items-center justify-center text-purple-300 text-[10px] font-bold">
                    A
                  </div>
                )}
              </div>
            )}
          <div
            className={`px-3 sm:px-4 py-2.5 sm:py-3 rounded-[14px] text-[0.9rem] sm:text-[0.95rem] leading-relaxed break-words overflow-x-auto ${
              msg.role === 'user'
                ? 'bg-sky-400/[0.16] border border-sky-400/30 text-white'
                : 'bg-white/[0.06] border border-white/[0.12] text-white'
            }`}
          >
            {/* Show tool calls for completed assistant messages */}
            {msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0 && (
              <div className="mb-2">
                {msg.toolCalls.map(tc => (
                  <ToolCallCard key={tc.id} tc={tc} userId={userId} onPreview={onPreview} onActiveHtmlNode={onActiveHtmlNode} />
                ))}
              </div>
            )}
            {msg.role === 'assistant' ? (
              <div>
                <div className="prose prose-invert prose-sm max-w-none [&_a]:text-sky-400 [&_code]:bg-black/30 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[0.85em] sm:[&_code]:text-[0.9em] [&_pre]:bg-black/30 [&_pre]:p-2 sm:[&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_blockquote]:border-l-[3px] [&_blockquote]:border-sky-400 [&_blockquote]:pl-3 [&_blockquote]:text-white/60">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {preprocessGraphLinks(msg.content || '_(completed with tool calls only)_')}
                  </ReactMarkdown>
                </div>
                {typeof msg.content === 'string' && msg.content.startsWith('**Audio Transcription**') && !msg.content.includes('[View Graph:') && (() => {
                  const ctxGraphId = lastAgentGraphRef.current || graphId;
                  const saveToGraph = async (targetGraphId: string | null) => {
                    const txBody = msg.content.split('\n\n').slice(1).join('\n\n').trim();
                    if (!txBody || txBody.length < 50) return;
                    const nodeId = `node-tx-${Date.now()}`;
                    try {
                      if (targetGraphId) {
                        // Add node to existing graph
                        await fetch(`${KG_API}/addNode`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin', ...(userEmail ? { 'x-user-email': userEmail } : {}) },
                          body: JSON.stringify({
                            graphId: targetGraphId,
                            node: { id: nodeId, label: '# Audio Transcription', type: 'fulltext', info: txBody, color: '#4A90D9' },
                          }),
                        });
                        setMessages(prev => prev.map((m, mi) => mi === i
                          ? { ...m, content: m.content + `\n\n[Saved to Graph](https://www.vegvisr.org/gnew-viewer?graphId=${targetGraphId})` }
                          : m
                        ));
                      } else {
                        // Create new graph
                        const gId = crypto.randomUUID();
                        const title = `Transcription - ${new Date().toISOString().slice(0, 10)}`;
                        await fetch(`${KG_API}/saveGraphWithHistory`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin', ...(userEmail ? { 'x-user-email': userEmail } : {}) },
                          body: JSON.stringify({
                            id: gId,
                            graphData: {
                              nodes: [{ id: nodeId, label: '# Full Transcription', type: 'fulltext', info: txBody, color: '#4A90D9' }],
                              edges: [],
                              metadata: { title, description: 'Audio transcription', category: '#Transcription #Audio' },
                            },
                            override: true,
                          }),
                        });
                        onGraphChange(gId);
                        setMessages(prev => prev.map((m, mi) => mi === i
                          ? { ...m, content: m.content + `\n\n[View Graph: ${title}](https://www.vegvisr.org/gnew-viewer?graphId=${gId})` }
                          : m
                        ));
                      }
                    } catch (err) {
                      console.error('Failed to save transcription:', err);
                    }
                  };
                  return (
                    <div className="mt-2 flex gap-2 flex-wrap">
                      <button
                        type="button"
                        className="px-3 py-1.5 rounded-lg bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 text-xs font-medium hover:bg-emerald-600/50 transition-colors disabled:opacity-40"
                        disabled={streaming}
                        onClick={() => saveToGraph(null)}
                      >
                        📊 New Graph
                      </button>
                      {ctxGraphId && (
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded-lg bg-sky-600/30 border border-sky-500/40 text-sky-300 text-xs font-medium hover:bg-sky-600/50 transition-colors disabled:opacity-40"
                          disabled={streaming}
                          onClick={() => saveToGraph(ctxGraphId)}
                        >
                          📎 Add to Current Graph
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {msg.images && msg.images.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {msg.images.map((img, imgIdx) => (
                      <img
                        key={imgIdx}
                        src={img.url}
                        alt={img.label || 'attached'}
                        className="max-h-40 max-w-[200px] rounded-lg border border-white/20 object-cover"
                      />
                    ))}
                  </div>
                )}
                <div className="flex items-start gap-2">
                  <span className="flex-1">{msg.content}</span>
                  <button
                    type="button"
                    onClick={() => handleInput(msg.content)}
                    disabled={streaming}
                    className="flex-shrink-0 mt-0.5 text-white/30 hover:text-sky-400 transition-colors disabled:opacity-30"
                    title="Use this prompt again"
                  >
                  +
                  </button>
                </div>
              </div>
            )}
          </div>
          </div>
        ))}

        {/* Current streaming assistant response */}
        {current && (
          <div className="flex gap-2.5 self-start max-w-[80%]">
            {/* Agent avatar */}
            <div className="flex-shrink-0 mt-1">
              {agentAvatar ? (
                <img src={agentAvatar} alt="" className="w-7 h-7 rounded-full border border-white/20 object-cover" />
              ) : (
                <div className="w-7 h-7 rounded-full bg-purple-600/30 border border-purple-500/30 flex items-center justify-center text-purple-300 text-[10px] font-bold">
                  A
                </div>
              )}
            </div>
          <div className="px-4 py-3 rounded-[14px] bg-white/[0.06] border border-white/[0.12] text-white text-[0.95rem] leading-relaxed">
            {current.thinking && <ThinkingIndicator />}
            {current.toolCalls.map(tc => (
              <ToolCallCard key={tc.id} tc={tc} userId={userId} onPreview={onPreview} onActiveHtmlNode={onActiveHtmlNode} />
            ))}
            {current.text && (
              <div className="prose prose-invert prose-sm max-w-none [&_a]:text-sky-400 [&_code]:bg-black/30 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[0.85em] sm:[&_code]:text-[0.9em] [&_pre]:bg-black/30 [&_pre]:p-2 sm:[&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_blockquote]:border-l-[3px] [&_blockquote]:border-sky-400 [&_blockquote]:pl-3 [&_blockquote]:text-white/60">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {preprocessGraphLinks(current.text)}
                </ReactMarkdown>
              </div>
            )}
            {current.error && (
              <p className="text-rose-400">Error: {current.error}</p>
            )}
          </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Audio file panel */}
      {selectedAudioFile && (
        <div className="px-4 py-3 border-t border-white/10 bg-slate-950/80">
          <div className="max-w-[900px] mx-auto rounded-xl border border-white/10 bg-white/[0.04] p-4 text-xs text-white/70">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-white">{selectedAudioFile.name}</div>
                <div className="mt-1 text-white/60">
                  {formatFileSize(selectedAudioFile.size)}
                  {selectedAudioFile.duration !== null && (
                    <> &bull; Duration: {formatDuration(selectedAudioFile.duration)}</>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={clearSelectedAudio}
                disabled={audioProcessing}
                className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/70 hover:bg-white/10 disabled:opacity-60"
              >
                &times;
              </button>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-white/70">
                <input
                  type="checkbox"
                  checked={audioAutoDetect}
                  onChange={e => setAudioAutoDetect(e.target.checked)}
                  disabled={audioProcessing}
                  aria-label="Auto-detect language"
                  className="h-4 w-4 rounded border-white/30 bg-white/10"
                />
                Auto-detect language
              </label>
              <select
                value={audioLanguage}
                onChange={e => setAudioLanguage(e.target.value)}
                disabled={audioAutoDetect || audioProcessing}
                className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-white"
                aria-label="Audio language"
              >
                {audioLanguageOptions.map(lang => (
                  <option key={lang.code} value={lang.code} className="bg-slate-900 text-white">
                    {lang.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={startAudioTranscription}
                disabled={audioProcessing}
                className="rounded-full border border-white/20 bg-white/10 px-4 py-1 text-xs text-white/80 hover:bg-white/20 disabled:opacity-60"
              >
                {audioProcessing ? 'Transcribing...' : 'Transcribe'}
              </button>
            </div>
            {audioTranscriptionStatus && (
              <div className="mt-3 text-xs text-white/60">
                {audioTranscriptionStatus}
                {audioChunkProgress.total > 0 && (
                  <span> &bull; Chunk {audioChunkProgress.current}/{audioChunkProgress.total}</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Suggestion chips */}
      {suggestions.length > 0 && !streaming && (
        <div className="px-4 py-2 border-t border-white/10 bg-slate-950/60 flex-shrink-0">
          <div className="flex gap-2 max-w-[900px] mx-auto flex-wrap">
            {suggestions.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => sendMessage(s)}
                className="px-3 py-1.5 rounded-full border border-sky-400/30 bg-sky-400/[0.08] text-sky-300 text-sm hover:bg-sky-400/[0.16] hover:border-sky-400/50 transition-all cursor-pointer"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Upload error banner */}
      {uploadError && (
        <div className="px-4 py-2 border-t border-red-500/30 bg-red-500/10 flex-shrink-0">
          <div className="max-w-[900px] mx-auto flex items-center gap-2 text-[12px] text-red-300">
            <span>Image upload failed: {uploadError}</span>
            <button type="button" onClick={() => setUploadError(null)} className="text-red-400 hover:text-red-200 ml-auto">&times;</button>
          </div>
        </div>
      )}

      {/* Pending file attachments */}
      {pendingFiles.length > 0 && (
        <div className="px-4 py-2 border-t border-white/10 bg-slate-950/60 flex-shrink-0">
          <div className="flex gap-2 max-w-[900px] mx-auto flex-wrap">
            {pendingFiles.map((file, i) => (
              <div key={i} className="relative group flex items-center gap-2 px-3 py-1.5 bg-white/[0.06] border border-white/10 rounded-lg">
                <span className="text-lg">{file.mediaType === 'application/pdf' ? '\u{1F4D1}' : '\u{1F4C4}'}</span>
                <div className="text-xs text-white/70">
                  <div className="font-medium truncate max-w-[150px]">{file.name}</div>
                  <div className="text-white/40">{(file.size / 1024).toFixed(1)} KB</div>
                </div>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  className="w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity ml-1"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pending image thumbnails */}
      {pendingImages.length > 0 && (
        <div className="px-4 py-2 border-t border-white/10 bg-slate-950/60 flex-shrink-0">
          <div className="flex gap-2 max-w-[900px] mx-auto flex-wrap">
            {pendingImages.map((img, i) => (
              <div key={i} className="relative group">
                <img
                  src={img.url}
                  alt={img.label || 'attached'}
                  className="h-16 w-16 object-cover rounded-lg border border-white/20"
                />
                <button
                  type="button"
                  onClick={() => removeImage(i)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  &times;
                </button>
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-[9px] text-white/80 px-1 py-0.5 rounded-b-lg truncate">
                  {img.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Subagent progress badge */}
      {subagentProgress && (
        <div className="px-3 sm:px-4 flex justify-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-400/20 text-indigo-300 text-sm italic animate-pulse">
            <span className="opacity-70">&#x2728;</span>
            {subagentProgress}
          </div>
        </div>
      )}

      {/* Input area */}
      <div
        className={`px-3 sm:px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t bg-slate-950/80 flex-shrink-0 transition-colors ${imageDragActive ? 'border-sky-400 bg-sky-400/[0.06]' : 'border-white/10'}`}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setImageDragActive(true); }}
        onDragLeave={() => setImageDragActive(false)}
        onDrop={handleImageDrop}
      >
        {imageDragActive && (
          <div className="text-center text-sky-300 text-sm py-1 mb-2">Drop images here</div>
        )}

        {/* Graph context badge */}
        {displayGraphContext && (
          <>
            <div className="mb-2 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-400/20 max-w-[900px] mx-auto">
              <span className="text-xs text-purple-300 font-medium">📊 Graph context:</span>
              <a
                href={`https://www.vegvisr.org/gnew-viewer?graphId=${displayGraphContext.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-purple-400 hover:text-purple-300 underline flex-1 truncate"
              >
                {displayGraphContext.title}
              </a>
              <button
                type="button"
                onClick={() => setPreviewingGraphContext(true)}
                className="px-2 py-0.5 text-xs rounded bg-purple-600/30 text-purple-300 hover:bg-purple-600/50 transition-colors whitespace-nowrap"
                title="Preview graph"
              >
                Preview
              </button>
              <button
                type="button"
                onClick={() => setDisplayGraphContext(null)}
                className="text-purple-300 hover:text-purple-200 transition-colors text-xs"
                title="Clear graph context"
              >
                ✕
              </button>
            </div>
            {previewingGraphContext && (
              <GraphPreviewLazy graphId={displayGraphContext.id} title={displayGraphContext.title} onClose={() => setPreviewingGraphContext(false)} />
            )}
          </>
        )}

        <GraphActionBar
          userId={userId}
          activeGraphId={graphId}
          onGraphCreated={handleGraphCreated}
          onNodeAdded={handleNodeAdded}
          onMessage={pushActionMessage}
          model={model}
          disabled={streaming}
        />

        <div className="flex gap-2 max-w-[900px] mx-auto items-end">
          <button
            type="button"
            onClick={() => audioInputRef.current?.click()}
            disabled={audioProcessing}
            className="px-3 py-2.5 rounded-xl border border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white/80 transition-colors disabled:opacity-40"
            title="Upload audio file for transcription"
          >
            &#x1F3A4;
          </button>
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            className="px-3 py-2.5 rounded-xl border border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white/80 transition-colors"
            title="Attach image"
          >
            &#x1F5BC;
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-2.5 rounded-xl border border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white/80 transition-colors"
            title="Attach PDF or text file"
          >
            &#x1F4CE;
          </button>
          <div className="flex-1 min-w-0 relative">
            {/* Bot @mention dropdown */}
            {input.match(/^@\S*$/) && bots.length > 0 && (
              <div className="absolute bottom-full mb-1 left-0 w-full max-h-40 overflow-y-auto bg-slate-900 border border-white/10 rounded-lg z-50 shadow-xl">
                {bots
                  .filter(b => !input.slice(1) || b.username.toLowerCase().startsWith(input.slice(1).toLowerCase()) || b.name.toLowerCase().startsWith(input.slice(1).toLowerCase()))
                  .map(b => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => { setInput(`@${b.username} `); textareaRef.current?.focus(); }}
                      className="w-full px-3 py-2 text-left text-xs hover:bg-white/[0.06] text-white/70 flex items-center gap-2"
                    >
                      {b.avatar_url && <img src={b.avatar_url} className="w-5 h-5 rounded-full" alt="" />}
                      <span className="font-medium text-white/90">@{b.username}</span>
                      <span className="text-white/40">{b.name}</span>
                    </button>
                  ))}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => handleInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
              }}
              onPaste={handleImagePaste}
              placeholder={pendingFiles.length > 0 ? 'Ask about the file(s)...' : pendingImages.length > 0 ? 'Ask about the image(s)...' : bots.length > 0 ? 'Type your message or @bot...' : 'Type your message...'}
              rows={1}
              className="w-full px-3 sm:px-3.5 py-2.5 bg-white/[0.04] border border-white/10 rounded-xl text-white text-[0.9rem] sm:text-[0.95rem] font-[inherit] resize-none leading-relaxed max-h-[200px] overflow-y-auto focus:outline-none focus:border-sky-400/50 focus:ring-[3px] focus:ring-sky-400/15"
            />
          </div>
          {streaming ? (
            <button
              type="button"
              onClick={stopStreaming}
              className="px-3 sm:px-5 py-2.5 rounded-xl border border-rose-400/40 bg-rose-400/[0.16] text-rose-300 text-[0.9rem] sm:text-[0.95rem] font-medium cursor-pointer whitespace-nowrap transition-all hover:bg-rose-400/[0.24]"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => sendMessage()}
              disabled={!input.trim() && pendingImages.length === 0 && pendingFiles.length === 0}
              className="px-3 sm:px-5 py-2.5 rounded-xl border border-sky-400/40 bg-sky-400/[0.16] text-white text-[0.9rem] sm:text-[0.95rem] font-medium cursor-pointer whitespace-nowrap transition-all hover:bg-sky-400/[0.24] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Send
            </button>
          )}
        </div>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleImageFileSelect}
          className="hidden"
        />
        <input
          ref={audioInputRef}
          type="file"
          accept=".wav,.mp3,.m4a,.aac,.ogg,.opus,.mp4,.webm"
          disabled={audioProcessing}
          onChange={handleAudioFileSelect}
          className="hidden"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt,.md,.csv,.json,.xml,.html,.css,.js,.ts"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>
    </div>
  );
}
