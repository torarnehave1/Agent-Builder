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
  progress?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
}

interface StreamEvent {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'tool_progress' | 'text' | 'done' | 'error';
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

function ToolCallCard({ tc, userId }: { tc: ToolCall; userId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [savedAsTemplate, setSavedAsTemplate] = useState(false);
  let inputStr = '';
  try { inputStr = JSON.stringify(tc.input, null, 2); } catch { inputStr = String(tc.input); }
  let resultStr = '';
  if (tc.result) {
    try { resultStr = JSON.stringify(tc.result, null, 2).slice(0, 1000); } catch { resultStr = String(tc.result); }
  }

  const input = tc.input as Record<string, unknown>;
  const isHtmlNode = tc.tool === 'create_html_node'
    || (tc.tool === 'create_node' && (input.nodeType === 'html-node' || input.type === 'html-node'))
    || tc.tool === 'create_html_from_template';
  const canSaveAsTemplate = isHtmlNode && tc.status === 'success';

  const saveAsTemplate = async () => {
    // Get the HTML content from whichever tool was used
    const htmlContent = (input.htmlContent || input.content || input.info || '') as string;
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
      {canSaveAsTemplate && !savedAsTemplate && (
        <button type="button" onClick={saveAsTemplate}
          className="mx-3 my-2 px-2 py-1 text-xs rounded bg-violet-600/20 text-violet-300 hover:bg-violet-600/30 border border-violet-500/20">
          Save as Template
        </button>
      )}
      {savedAsTemplate && (
        <span className="mx-3 my-2 inline-block text-xs text-emerald-400">Saved as template</span>
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
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

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

  // Load graph list
  useEffect(() => {
    fetch(`${KG_API}/getknowgraphsummaries?offset=0&limit=50`)
      .then(r => r.json())
      .then(data => { if (data.results) setGraphs(data.results); })
      .catch(() => {});
  }, []);

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

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    setInput('');
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

    const userMsg: ChatMessage = { role: 'user', content: text };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);

    // Persist user message
    if (activeSession) {
      historyFetch('/messages', userId, {
        method: 'POST',
        body: JSON.stringify({ sessionId: activeSession, role: 'user', content: text }),
      }).catch(() => {});
    }

    const state: AssistantState = { text: '', toolCalls: [], thinking: false };
    setCurrent(state);

    let finalToolCalls: ToolCall[] = [];
    let pendingClientTranscription: { audioUrl: string; recordingId: string | null; language: string | null; saveToGraph: boolean; graphTitle: string | null } | null = null;

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
                headers: { 'Content-Type': 'application/json' },
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
  }, [input, streaming, messages, userId, graphId, parseSSE, current, splitAudioIntoChunks, callWhisperTranscription, formatChunkTimestamp, audioAutoDetect, audioLanguage]);

  const hasMessages = messages.length > 0 || current !== null;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Graph selector bar + Sessions + Copy Log */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-slate-950/80">
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
              <div className="absolute top-full mt-1 left-0 w-72 max-h-64 overflow-y-auto bg-slate-900 border border-white/10 rounded-lg z-50 shadow-xl">
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
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => loadSession(s.id)}
                    className={`w-full px-3 py-2 text-left text-xs hover:bg-white/[0.06] flex items-center gap-2 ${s.id === sessionId ? 'text-sky-400 bg-sky-400/[0.06]' : 'text-white/60'}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{s.title}</div>
                      {s.updatedAt && <div className="text-white/30 text-[10px]">{new Date(s.updatedAt).toLocaleDateString()}</div>}
                    </div>
                    <span
                      onClick={(e) => deleteSession(s.id, e)}
                      className="flex-shrink-0 text-white/20 hover:text-rose-400 text-sm px-1 cursor-pointer"
                      title="Delete session"
                    >
                      &times;
                    </span>
                  </button>
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
                  <ToolCallCard key={tc.id} tc={tc} userId={userId} />
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
            )}
          </div>
        ))}

        {/* Current streaming assistant response */}
        {current && (
          <div className="self-start max-w-[80%] px-4 py-3 rounded-[14px] bg-white/[0.06] border border-white/[0.12] text-white text-[0.95rem] leading-relaxed">
            {current.thinking && <ThinkingIndicator />}
            {current.toolCalls.map(tc => (
              <ToolCallCard key={tc.id} tc={tc} userId={userId} />
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

      {/* Input area */}
      <div className="px-4 py-3 border-t border-white/10 bg-slate-950/80 flex-shrink-0">
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
        <input
          ref={audioInputRef}
          type="file"
          accept=".wav,.mp3,.m4a,.aac,.ogg,.opus,.mp4,.webm"
          disabled={audioProcessing}
          onChange={handleAudioFileSelect}
          className="hidden"
        />
      </div>
    </div>
  );
}
