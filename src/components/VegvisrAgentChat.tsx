import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAgent } from 'agents/react';

// Lazy-load GraphPreview to keep initial bundle small
const GraphPreviewComponent = lazy(() => import('./GraphPreview'));
function GraphPreviewLazy(props: { graphId: string; title: string; onClose: () => void }) {
  return (
    <Suspense fallback={null}>
      <GraphPreviewComponent {...props} />
    </Suspense>
  );
}
import { useAgentChat, getToolPartState, getToolCallId, getToolInput, getToolOutput } from '@cloudflare/ai-chat/react';
import { isToolUIPart, isTextUIPart, getToolName } from 'ai';

const AGENT_HOST = 'agent.vegvisr.org';
const CHAT_HISTORY_API = 'https://api.vegvisr.org/chat-history';
const AUDIO_ENDPOINT = 'https://openai.vegvisr.org/audio';

// ── Tool result renderers ────────────────────────────────────────

interface WhoAmIResult {
  email: string | null;
  userId: string;
  role: string;
  bio: string | null;
  phone: string | null;
  phoneVerifiedAt: string | null;
  profileImage: string | null;
  branding: { mySite: string | null; myLogo: string | null };
  apiKeys: Array<{ provider: string; enabled: boolean; lastUsed: string | null }>;
  message: string;
}

function WhoAmICard({ data }: { data: WhoAmIResult }) {
  return (
    <div className="mt-2 rounded-xl bg-white/5 border border-white/10 overflow-hidden text-sm">
      <div className="flex items-center gap-3 px-4 py-3 bg-white/10">
        {data.profileImage ? (
          <img src={data.profileImage} alt="avatar" className="w-10 h-10 rounded-full object-cover" />
        ) : (
          <div className="w-10 h-10 rounded-full bg-purple-600 flex items-center justify-center text-white font-bold text-lg">
            {(data.email || '?')[0].toUpperCase()}
          </div>
        )}
        <div>
          <div className="font-semibold text-white">{data.email}</div>
          <div className="text-xs text-white/50 capitalize">{data.role}</div>
        </div>
      </div>
      {data.bio && (
        <div className="px-4 py-3 text-white/80 border-t border-white/10 leading-relaxed prose prose-invert prose-sm max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.bio}</ReactMarkdown>
        </div>
      )}
      {data.phone && (
        <div className="px-4 py-2 text-white/60 text-xs border-t border-white/10">
          📞 {data.phone}{data.phoneVerifiedAt ? <span> ✓ verified</span> : null}
        </div>
      )}
      {data.apiKeys?.length > 0 && (
        <div className="px-4 py-2 border-t border-white/10">
          <div className="text-xs text-white/40 mb-1">API Keys</div>
          <div className="flex flex-wrap gap-1">
            {data.apiKeys.map(k => (
              <span key={k.provider} className={`text-xs px-2 py-0.5 rounded-full ${k.enabled ? 'bg-emerald-600/30 text-emerald-300' : 'bg-white/10 text-white/30'}`}>
                {k.provider}
              </span>
            ))}
          </div>
        </div>
      )}
      {data.branding?.mySite && (
        <div className="px-4 py-2 text-xs text-white/50 border-t border-white/10">
          🌐 <a href={data.branding.mySite} target="_blank" rel="noreferrer" className="underline hover:text-white/80">{data.branding.mySite}</a>
        </div>
      )}
    </div>
  );
}

// ---------- Graph list card (list_graphs / search_graphs) ----------

interface GraphSummary {
  id: string;
  title: string;
  description: string;
  category: string;
  metaArea: string;
  nodeCount: number;
  updatedAt: string;
}

interface ListGraphsOutput {
  total?: number;
  offset?: number;
  limit?: number;
  graphs?: GraphSummary[];
  results?: GraphSummary[];
  count?: number;
}

function GraphCard({ g }: { g: GraphSummary }) {
  const [previewing, setPreviewing] = useState(false);
  const categoryTags = g.category ? g.category.split(/\s+/).filter(t => t.startsWith('#')) : [];
  const metaTags = g.metaArea ? g.metaArea.split(/[\s#]+/).filter(Boolean).map(t => `#${t}`) : [];
  const viewHref = `https://www.vegvisr.org/gnew-viewer?graphId=${g.id}`;
  return (
    <>
      <div className="p-3 rounded-lg border border-sky-400/20 bg-sky-400/[0.06]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-white font-semibold text-sm">{g.title}</div>
            {g.description && (
              <div className="text-white/50 text-xs mt-1 line-clamp-2">{g.description}</div>
            )}
            <div className="flex flex-wrap gap-1 mt-2">
              {metaTags.map(tag => (
                <span key={tag} className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-semibold">{tag}</span>
              ))}
              {categoryTags.map(tag => (
                <span key={tag} className="px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 text-[10px] font-medium">{tag}</span>
              ))}
              <span className="px-1.5 py-0.5 rounded-full bg-white/10 text-white/40 text-[10px]">{g.nodeCount} nodes</span>
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
              href={viewHref}
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
        <GraphPreviewLazy graphId={g.id} title={g.title} onClose={() => setPreviewing(false)} />
      )}
    </>
  );
}

function ListGraphsResultCard({ data }: { data: ListGraphsOutput }) {
  const graphs: GraphSummary[] = data.graphs || data.results || [];
  const total = data.total ?? data.count ?? graphs.length;

  return (
    <div className="mt-2">
      <div className="text-xs text-white/40 mb-2">
        {total} graph{total !== 1 ? 's' : ''} found
        {(data.offset ?? 0) > 0 ? ` (offset ${data.offset})` : ''}
      </div>
      <div className="flex flex-col gap-2">
        {graphs.map(g => <GraphCard key={g.id} g={g} />)}
      </div>
    </div>
  );
}

// ---------- Meta areas card (list_meta_areas) ----------

interface MetaAreaEntry { name: string; count: number }
interface ListMetaAreasOutput {
  message: string;
  metaAreas: MetaAreaEntry[];
  categories: MetaAreaEntry[];
}

function ListMetaAreasResultCard({ data }: { data: ListMetaAreasOutput }) {
  const metaAreas = data.metaAreas || [];
  const categories = (data.categories || []).slice(0, 20);
  return (
    <div className="mt-2">
      <div className="text-xs text-white/40 mb-2">{data.message}</div>
      {metaAreas.length > 0 && (
        <>
          <div className="text-xs text-white/50 mb-1.5 font-medium">Meta Areas</div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {metaAreas.map(a => (
              <span key={a.name} className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-semibold">
                #{a.name} <span className="text-amber-300/50">({a.count})</span>
              </span>
            ))}
          </div>
        </>
      )}
      {categories.length > 0 && (
        <>
          <div className="text-xs text-white/50 mb-1.5 font-medium">Top Categories</div>
          <div className="flex flex-wrap gap-1.5">
            {categories.map(c => (
              <span key={c.name} className="px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 text-[10px] font-medium">
                #{c.name} <span className="text-violet-300/50">({c.count})</span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function GenerateImageCard({ output }: { output: unknown }) {
  const data = output as { url?: string; prompt?: string; width?: number; height?: number };
  if (!data?.url) return null;
  return (
    <div className="mt-2">
      <img
        src={data.url}
        alt={data.prompt || 'Generated image'}
        className="rounded-lg max-w-full max-h-[400px] object-contain border border-white/10"
      />
      <div className="mt-1 text-[11px] text-white/30 break-all">
        <a href={data.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-white/60">Open full size</a>
        {data.width && data.height && <span className="ml-2">{data.width}×{data.height}px</span>}
      </div>
    </div>
  );
}

function ToolResultCard({ toolName, output }: { toolName: string; output: unknown }) {
  if (toolName === 'who_am_i') return <WhoAmICard data={output as WhoAmIResult} />;
  if (toolName === 'list_graphs' || toolName === 'search_graphs') return <ListGraphsResultCard data={output as ListGraphsOutput} />;
  if (toolName === 'list_meta_areas') return <ListMetaAreasResultCard data={output as ListMetaAreasOutput} />;
  if (toolName === 'generate_image') return <GenerateImageCard output={output} />;
  // Fallback: collapsible JSON
  return (
    <details className="mt-2 text-xs text-white/50">
      <summary className="cursor-pointer hover:text-white/80 select-none">{toolName} ▸ result</summary>
      <pre className="mt-1 overflow-auto bg-white/5 rounded p-2 max-h-60">{JSON.stringify(output, null, 2)}</pre>
    </details>
  );
}

function historyFetch(path: string, userId: string, options: RequestInit = {}) {
  const headers = new Headers((options.headers as HeadersInit) || {});
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
  model?: string;
}

export default function VegvisrAgentChat({ userId, model = '@cf/meta/llama-4-scout-17b-16e-instruct' }: Props) {
  const [copied, setCopied] = useState(false);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const prevModelRef = useRef(model);
  const prevStatusRef = useRef('idle');

  // Input state
  const [inputText, setInputText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImages, setPendingImages] = useState<Array<{ url: string; name: string; file: File }>>([]); 
  const [localMessages, setLocalMessages] = useState<Array<{ id: string; role: 'user' | 'assistant'; text: string }>>([]);
  const lastTranscriptRef = useRef<string | null>(null);

  // Audio transcription state
  interface AudioFileInfo { file: File; name: string; size: number; type: string; duration: number | null; }
  const [selectedAudioFile, setSelectedAudioFile] = useState<AudioFileInfo | null>(null);
  const [audioProcessing, setAudioProcessing] = useState(false);
  const [audioTranscriptionStatus, setAudioTranscriptionStatus] = useState('');
  const [audioChunkProgress, setAudioChunkProgress] = useState({ current: 0, total: 0 });
  const [audioAutoDetect, setAudioAutoDetect] = useState(true);
  const [audioLanguage, setAudioLanguage] = useState('no');
  const CHUNK_DURATION_SECONDS = 120; // 2-minute chunks = ~13MB WAV, matches AgentChat
  const audioLanguageOptions = [
    { code: 'no', label: 'Norwegian' },
    { code: 'en', label: 'English' },
    { code: 'sv', label: 'Swedish' },
    { code: 'da', label: 'Danish' },
    { code: 'de', label: 'German' },
    { code: 'fr', label: 'French' },
    { code: 'es', label: 'Spanish' },
  ];

  const agent = useAgent({
    agent: 'vegvisr-agent',
    name: userId,
    host: AGENT_HOST,
  });

  const { messages, sendMessage, clearHistory, addToolApprovalResponse, status } = useAgentChat({
    agent,
    body: { model },
    onToolCall: async ({ toolCall, addToolOutput }) => {
      if (toolCall.toolName === 'getUserTimezone') {
        addToolOutput({
          toolCallId: toolCall.toolCallId,
          output: {
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            localTime: new Date().toLocaleTimeString(),
          },
        });
      }
    },
  });

  // Auto-clear DO history when model changes
  useEffect(() => {
    if (prevModelRef.current !== model) {
      prevModelRef.current = model;
      clearHistory();
      sessionIdRef.current = null;
      setLocalMessages([]);
      lastTranscriptRef.current = null;
    }
  }, [model, clearHistory]);

  // Load sessions list on mount
  useEffect(() => {
    if (!userId) return;
    historyFetch('/sessions', userId)
      .then(r => r.json())
      .then(data => {
        const waiSessions = (data.sessions || [])
          .filter((s: { provider?: string }) => s.provider === 'workers-ai')
          .map((s: { id: string; title?: string; updated_at?: string }) => ({
            id: s.id,
            title: s.title || 'Untitled',
            updatedAt: s.updated_at || '',
          }));
        setSessions(waiSessions);
      })
      .catch(() => {});
  }, [userId]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [inputText]);

  // Close sessions dropdown on outside click
  useEffect(() => {
    if (!sessionsOpen) return;
    const close = () => setSessionsOpen(false);
    const timer = setTimeout(() => document.addEventListener('click', close), 0);
    return () => { clearTimeout(timer); document.removeEventListener('click', close); };
  }, [sessionsOpen]);

  // Save last exchange to chat-history when streaming completes
  useEffect(() => {
    if (prevStatusRef.current === 'streaming' && status !== 'streaming' && messages.length >= 2) {
      saveLastExchange();
    }
    prevStatusRef.current = status;
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveLastExchange() {
    const reversed = [...messages].reverse();
    const lastAssistant = reversed.find(m => m.role === 'assistant');
    const lastUser = reversed.find(m => m.role === 'user');
    if (!lastUser || !lastAssistant) return;

    let activeSession = sessionIdRef.current;
    if (!activeSession) {
      const userTextPart = lastUser.parts.find(p => isTextUIPart(p));
      const title = userTextPart ? (userTextPart as { text: string }).text.slice(0, 60) : 'Workers AI Chat';
      try {
        const sRes = await historyFetch('/sessions', userId, {
          method: 'POST',
          body: JSON.stringify({ graphId: null, provider: 'workers-ai', title }),
        });
        const sData = await sRes.json();
        activeSession = sData.session?.id || null;
        if (activeSession) {
          sessionIdRef.current = activeSession;
          setSessions(prev => [{ id: activeSession!, title, updatedAt: new Date().toISOString() }, ...prev]);
        }
      } catch { /* continue without persistence */ }
    }
    if (!activeSession) return;

    for (const msg of [lastUser, lastAssistant]) {
      const textPart = msg.parts.find(p => isTextUIPart(p));
      const text = textPart ? (textPart as { text: string }).text : '';
      if (!text) continue;
      historyFetch('/messages', userId, {
        method: 'POST',
        body: JSON.stringify({ sessionId: activeSession, role: msg.role, content: text }),
      }).catch(() => {});
    }
  }

  function startNewSession() {
    clearHistory();
    sessionIdRef.current = null;
    setLocalMessages([]);
    lastTranscriptRef.current = null;
    setSessionsOpen(false);
  }

  function clearSelectedAudio() {
    setSelectedAudioFile(null);
    setAudioProcessing(false);
    setAudioTranscriptionStatus('');
    setAudioChunkProgress({ current: 0, total: 0 });
  }

  function formatFileSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDuration(s: number | null) {
    if (!s) return '';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  function formatChunkTimestamp(s = 0) {
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  async function getAudioDuration(file: File): Promise<number | null> {
    return new Promise((resolve) => {
      const audio = document.createElement('audio');
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => { URL.revokeObjectURL(audio.src); resolve(audio.duration || 0); };
      audio.onerror = () => { URL.revokeObjectURL(audio.src); resolve(null); };
      audio.src = URL.createObjectURL(file);
    });
  }

  async function audioBufferToWavBlob(audioBuffer: AudioBuffer): Promise<Blob> {
    return new Promise((resolve) => {
      const nc = audioBuffer.numberOfChannels, sr = audioBuffer.sampleRate, len = audioBuffer.length;
      const buf = new ArrayBuffer(44 + len * nc * 2);
      const view = new DataView(buf);
      const ws = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
      ws(0, 'RIFF'); view.setUint32(4, 36 + len * nc * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, nc, true);
      view.setUint32(24, sr, true); view.setUint32(28, sr * nc * 2, true); view.setUint16(32, nc * 2, true);
      view.setUint16(34, 16, true); ws(36, 'data'); view.setUint32(40, len * nc * 2, true);
      let offset = 44;
      for (let i = 0; i < len; i++) {
        for (let ch = 0; ch < nc; ch++) {
          const s = Math.max(-1, Math.min(1, audioBuffer.getChannelData(ch)[i]));
          view.setInt16(offset, s * 0x7fff, true); offset += 2;
        }
      }
      resolve(new Blob([buf], { type: 'audio/wav' }));
    });
  }

  async function splitAudioIntoChunks(file: File, onProgress?: (p: { phase: string; current?: number; total?: number }) => void) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    try {
      const ab = await file.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(ab);
      const sr = audioBuffer.sampleRate;
      const chunkSamples = CHUNK_DURATION_SECONDS * sr;
      const total = Math.max(Math.ceil(audioBuffer.length / chunkSamples), 1);
      onProgress?.({ phase: 'info', total });
      const chunks: Array<{ blob: Blob; startTime: number; endTime: number }> = [];
      for (let i = 0; i < total; i++) {
        const start = i * chunkSamples, end = Math.min(start + chunkSamples, audioBuffer.length);
        const chunkLen = end - start;
        const chunkBuf = ctx.createBuffer(audioBuffer.numberOfChannels, chunkLen, sr);
        for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
          chunkBuf.getChannelData(ch).set(audioBuffer.getChannelData(ch).subarray(start, end));
        }
        chunks.push({ blob: await audioBufferToWavBlob(chunkBuf), startTime: start / sr, endTime: end / sr });
        onProgress?.({ phase: 'creating', current: i + 1, total });
      }
      return chunks;
    } finally { await ctx.close(); }
  }

  async function callWhisper(blob: Blob, fileName: string) {
    const formData = new FormData();
    formData.append('file', blob, fileName);
    formData.append('model', 'whisper-1');
    formData.append('userId', userId);
    if (!audioAutoDetect && audioLanguage) formData.append('language', audioLanguage);
    const res = await fetch(AUDIO_ENDPOINT, { method: 'POST', body: formData });
    const text = await res.text();
    let parsed: Record<string, unknown> | null = null;
    try { parsed = JSON.parse(text); } catch { /* */ }
    if (!res.ok) throw new Error((parsed?.error as string) || text || 'Transcription failed');
    return (parsed?.text as string) || text;
  }

  async function startAudioTranscription() {
    if (!selectedAudioFile || audioProcessing) return;
    setAudioProcessing(true);
    setAudioTranscriptionStatus('Preparing audio…');
    setAudioChunkProgress({ current: 0, total: 0 });
    const { file, name } = selectedAudioFile;
    try {
      const duration = selectedAudioFile.duration ?? await getAudioDuration(file);
      const shouldChunk = duration ? duration > CHUNK_DURATION_SECONDS : file.size > 8 * 1024 * 1024;
      let transcript: string;
      if (shouldChunk) {
        setAudioTranscriptionStatus('Splitting audio into chunks…');
        const chunks = await splitAudioIntoChunks(file, (p) => {
          if (p.phase === 'creating') setAudioTranscriptionStatus(`Preparing chunk ${p.current}/${p.total}…`);
        });
        setAudioChunkProgress({ current: 0, total: chunks.length });
        const baseName = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name;
        const segments: string[] = [];
        for (let i = 0; i < chunks.length; i++) {
          setAudioChunkProgress({ current: i + 1, total: chunks.length });
          setAudioTranscriptionStatus(`Transcribing chunk ${i + 1}/${chunks.length}…`);
          try {
            const t = await callWhisper(chunks[i].blob, `${baseName}_chunk_${i + 1}.wav`);
            const label = `[${formatChunkTimestamp(chunks[i].startTime)} - ${formatChunkTimestamp(chunks[i].endTime)}]`;
            if (t.trim()) segments.push(`${label} ${t.trim()}`);
          } catch (e) {
            segments.push(`[chunk ${i + 1} failed: ${e instanceof Error ? e.message : 'unknown'}]`);
          }
        }
        transcript = segments.join('\n\n');
      } else {
        setAudioTranscriptionStatus('Uploading and transcribing…');
        transcript = await callWhisper(file, name);
      }
      const langLabel = audioAutoDetect ? 'Auto-detected' : (audioLanguageOptions.find(o => o.code === audioLanguage)?.label || audioLanguage);
      // Display locally — do NOT send to AI model
      const id = Date.now().toString();
      setLocalMessages(prev => [
        ...prev,
        { id: id + '-u', role: 'user', text: `Transcribe audio: "${name}"` },
        { id: id + '-a', role: 'assistant', text: `**Transcription of "${name}"**\nLanguage: ${langLabel}\n\n${transcript || '(No speech detected)'}` },
      ]);
      // Store transcript so next user message can reference it
      lastTranscriptRef.current = `Transcription of "${name}" (${langLabel}):\n\n${transcript || '(No speech detected)'}`;
      clearSelectedAudio();
    } catch (e) {
      setAudioTranscriptionStatus(`Failed: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setAudioProcessing(false);
    }
  }

  async function handleAudioFileSelect(file: File | null) {
    if (!file) return;
    setAudioTranscriptionStatus('');
    setAudioChunkProgress({ current: 0, total: 0 });
    const duration = await getAudioDuration(file).catch(() => null);
    setSelectedAudioFile({ file, name: file.name || 'audio', size: file.size, type: file.type || 'audio/wav', duration });
    setAudioAutoDetect(true);
    setAudioLanguage('no');
  }

  function handleImageFiles(files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach(file => {
      const url = URL.createObjectURL(file);
      setPendingImages(prev => [...prev, { url, name: file.name, file }]);
    });
  }

  async function handleFileText(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      const text = await file.text();
      const snippet = `\n\n[File: ${file.name}]\n${text.slice(0, 4000)}${text.length > 4000 ? '\n…(truncated)' : ''}`;
      setInputText(prev => prev + snippet);
    }
    textareaRef.current?.focus();
  }

  async function doSend() {
    const text = inputText.trim();
    const hasImages = pendingImages.length > 0;
    if (!text && !hasImages) return;
    // If there's a pending transcript, prepend it as context for the model
    const transcript = lastTranscriptRef.current;
    lastTranscriptRef.current = null;
    const contextPrefix = transcript ? `[Transcription context]:\n${transcript}\n\n` : '';
    const fullText = `${contextPrefix}${text}`.trim();

    // Intercept image generation requests — call /generate-image directly, bypassing the AI model
    const imageGenMatch = fullText.match(/(?:generate|create|draw|make|design)\s+(?:an?\s+)?image\s+(?:of\s+)?(.+)/i);
    if (imageGenMatch && !hasImages) {
      const prompt = imageGenMatch[1].trim();
      setInputText('');
      const userMsgId = Date.now().toString();
      setLocalMessages(prev => [...prev, { id: userMsgId, role: 'user', text: fullText }]);
      try {
        const res = await fetch(`https://agent.vegvisr.org/generate-image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt }),
        });
        const data = await res.json() as { url?: string; error?: string };
        if (!res.ok || !data.url) throw new Error(data.error || 'Generation failed');
        setLocalMessages(prev => [...prev, {
          id: userMsgId + '-r',
          role: 'assistant',
          text: `![${prompt}](${data.url})\n\n[Open full size](${data.url})`,
        }]);
      } catch (e) {
        setLocalMessages(prev => [...prev, {
          id: userMsgId + '-r',
          role: 'assistant',
          text: `Failed to generate image: ${e instanceof Error ? e.message : 'unknown error'}`,
        }]);
      }
      return;
    }

    if (hasImages) {
      // Read each image as a base64 data URL so Workers AI (Gemma vision) can process it.
      // Workers AI does NOT support plain HTTPS URLs — base64 only.
      const imageParts = await Promise.all(
        pendingImages.map(async img => {
          const base64Url = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error(`Failed to read ${img.name}`));
            reader.readAsDataURL(img.file);
          });
          return {
            type: 'file' as const,
            mediaType: img.file.type || 'image/png',
            filename: img.name,
            url: base64Url,
          };
        })
      );
      const parts: Array<{ type: 'file'; mediaType: string; filename: string; url: string } | { type: 'text'; text: string }> = [
        ...imageParts,
        ...(fullText ? [{ type: 'text' as const, text: fullText }] : []),
      ];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendMessage({ parts } as any);
    } else {
      sendMessage({ text: fullText });
    }
    setInputText('');
    setPendingImages([]);
  }

  function copyLog() {
    const header = `=== Vegvisr Agent Chat Log ===\nModel: ${model}\nDate: ${new Date().toLocaleString()}\n\n`;
    const body = messages.map((msg) => {
      const role = msg.role === 'user' ? '[USER]' : '[AGENT]';
      const parts = msg.parts.map((part) => {
        if (isTextUIPart(part)) return part.text;
        if (isToolUIPart(part)) {
          const toolName = getToolName(part);
          const state = getToolPartState(part);
          if (state === 'complete') {
            const output = getToolOutput(part);
            return `  > Tool: ${toolName}\n  > Result: ${JSON.stringify(output)}`;
          }
          return `  > Tool: ${toolName} (${state})`;
        }
        return '';
      }).filter(Boolean).join('\n');
      return `${role}\n${parts}`;
    }).join('\n\n');

    navigator.clipboard.writeText(header + body).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-slate-950 text-white">
      {/* Top bar — matches AgentChat style */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-slate-950/80 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {/* Sessions picker */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setSessionsOpen(p => !p)}
              className="px-3 py-1 rounded-md border border-white/10 bg-white/[0.04] text-white/60 text-xs hover:bg-white/[0.08] hover:text-white/80 transition-colors"
            >
              Sessions ({sessions.length})
            </button>
            {sessionsOpen && (
              <div className="absolute top-full mt-1 left-0 w-64 max-h-64 overflow-y-auto bg-slate-900 border border-white/10 rounded-lg z-50 shadow-xl">
                <button
                  type="button"
                  onClick={startNewSession}
                  className="w-full px-3 py-2 text-left text-xs text-sky-400 hover:bg-white/[0.06] border-b border-white/10"
                >
                  + New Session
                </button>
                {sessions.length === 0 && (
                  <div className="px-3 py-3 text-white/30 text-xs">No saved sessions</div>
                )}
                {sessions.map(s => (
                  <div key={s.id} className="px-3 py-2 text-xs text-white/60 hover:bg-white/[0.06]">
                    <div className="truncate">{s.title}</div>
                    {s.updatedAt && <div className="text-white/30 text-[10px]">{new Date(s.updatedAt).toLocaleDateString()}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300">Workers AI</span>
          <span className="text-xs text-white/40 font-mono">{model}</span>
        </div>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={copyLog}
              className="px-3 py-1 rounded-md border border-white/10 bg-white/[0.04] text-white/60 text-xs hover:bg-white/[0.08] hover:text-white/80 transition-colors"
            >
              {copied ? 'Copied!' : 'Copy Log'}
            </button>
          )}
        </div>
      </div>
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-white/30 text-sm text-center mt-8">
            Start a conversation with the Vegvisr Agent
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-xl px-4 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-purple-600 text-white'
                  : 'bg-white/10 text-white/90'
              }`}
            >
              {msg.parts.map((part, i) => {
                if (isTextUIPart(part)) {
                  // Render imgix/image URLs as inline images within text
                  const imgixRe = /(https:\/\/vegvisr\.imgix\.net\/[^\s)"']+)/g;
                  const segments = part.text.split(imgixRe);
                  if (segments.length > 1) {
                    return (
                      <span key={i} className="whitespace-pre-wrap">
                        {segments.map((seg, j) =>
                          seg.startsWith('https://vegvisr.imgix.net/') ? (
                            <span key={j} className="block my-2">
                              <img src={seg} alt="generated" className="rounded-lg max-w-full max-h-[400px] object-contain border border-white/10" />
                              <a href={seg} target="_blank" rel="noopener noreferrer" className="text-[11px] text-white/30 underline hover:text-white/60 break-all">{seg}</a>
                            </span>
                          ) : (
                            <span key={j}>{seg}</span>
                          )
                        )}
                      </span>
                    );
                  }
                  return <span key={i} className="whitespace-pre-wrap">{part.text}</span>;
                }

                if (isToolUIPart(part)) {
                  const state = getToolPartState(part);
                  const toolCallId = getToolCallId(part);
                  const toolName = getToolName(part);

                  if (state === 'waiting-approval') {
                    const input = getToolInput(part);
                    return (
                      <div key={toolCallId} className="mt-2 p-3 bg-yellow-500/20 rounded-lg border border-yellow-500/40">
                        <p className="text-yellow-300 text-xs font-medium mb-1">
                          Approve <strong>{toolName}</strong>?
                        </p>
                        <pre className="text-xs text-white/70 mb-2 overflow-auto">{JSON.stringify(input, null, 2)}</pre>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => addToolApprovalResponse({ id: toolCallId, approved: true })}
                            className="px-3 py-1 text-xs bg-emerald-600 hover:bg-emerald-500 rounded-md"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => addToolApprovalResponse({ id: toolCallId, approved: false })}
                            className="px-3 py-1 text-xs bg-red-700 hover:bg-red-600 rounded-md"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    );
                  }

                  if (state === 'complete') {
                    const output = getToolOutput(part);
                    return <ToolResultCard key={toolCallId} toolName={toolName} output={output} />;
                  }

                  if (state === 'loading' || state === 'streaming') {
                    return (
                      <div key={toolCallId} className="mt-1 text-xs text-white/30 italic">
                        Running {toolName}…
                      </div>
                    );
                  }
                }

                return null;
              })}
            </div>
          </div>
        ))}
        {status === 'streaming' && (
          <div className="flex justify-start">
            <div className="bg-white/10 rounded-xl px-4 py-2 text-sm text-white/50 animate-pulse">
              Thinking…
            </div>
          </div>
        )}
        {/* Local-only transcription messages */}
        {localMessages.map(m => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-xl px-4 py-2 text-sm ${m.role === 'user' ? 'bg-purple-600 text-white' : 'bg-white/10 text-white/90'}`}>
              <div className="prose prose-invert prose-sm max-w-none prose-p:my-2 prose-p:leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Audio file panel */}
      {selectedAudioFile && (
        <div className="flex-shrink-0 px-4 py-3 border-t border-white/10 bg-slate-950/80">
          <div className="max-w-[900px] mx-auto rounded-xl border border-white/10 bg-white/[0.04] p-4 text-xs text-white/70">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-white">{selectedAudioFile.name}</div>
                <div className="mt-1 text-white/60">
                  {formatFileSize(selectedAudioFile.size)}
                  {selectedAudioFile.duration !== null && <> &bull; {formatDuration(selectedAudioFile.duration)}</>}
                </div>
              </div>
              <button type="button" onClick={clearSelectedAudio} disabled={audioProcessing}
                className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/70 hover:bg-white/10 disabled:opacity-60">
                &times;
              </button>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-white/70">
                <input type="checkbox" checked={audioAutoDetect} onChange={e => setAudioAutoDetect(e.target.checked)}
                  disabled={audioProcessing} className="h-4 w-4 rounded border-white/30 bg-white/10" />
                Auto-detect language
              </label>
              <select value={audioLanguage} onChange={e => setAudioLanguage(e.target.value)}
                disabled={audioAutoDetect || audioProcessing}
                className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-white">
                {audioLanguageOptions.map(l => (
                  <option key={l.code} value={l.code} className="bg-slate-900 text-white">{l.label}</option>
                ))}
              </select>
              <button type="button" onClick={startAudioTranscription} disabled={audioProcessing}
                className="rounded-full border border-white/20 bg-white/10 px-4 py-1 text-xs text-white/80 hover:bg-white/20 disabled:opacity-60">
                {audioProcessing ? 'Transcribing…' : 'Transcribe'}
              </button>
            </div>
            {audioTranscriptionStatus && (
              <div className="mt-3 text-xs text-white/60 animate-pulse">
                {audioTranscriptionStatus}
                {audioChunkProgress.total > 0 && <span> &bull; Chunk {audioChunkProgress.current}/{audioChunkProgress.total}</span>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pending image previews */}
      {pendingImages.length > 0 && (
        <div className="flex-shrink-0 px-4 py-2 border-t border-white/10 bg-slate-950/60">
          <div className="flex gap-2 max-w-[900px] mx-auto flex-wrap">
            {pendingImages.map((img, i) => (
              <div key={i} className="relative group">
                <img src={img.url} alt={img.name} className="h-16 w-16 object-cover rounded-lg border border-white/20" />
                <button
                  type="button"
                  onClick={() => setPendingImages(prev => prev.filter((_, j) => j !== i))}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >×</button>
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-[9px] text-white/80 px-1 py-0.5 rounded-b-lg truncate">{img.name}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div
        className="flex-shrink-0 border-t border-white/10 px-3 py-3 bg-slate-950"
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
        onDrop={(e) => {
          e.preventDefault();
          const files = e.dataTransfer.files;
          if (!files?.length) return;
          const images = Array.from(files).filter(f => f.type.startsWith('image/'));
          if (images.length) {
            images.forEach(f => setPendingImages(prev => [...prev, { url: URL.createObjectURL(f), name: f.name, file: f }]));
          }
        }}
      >
        <div className="flex gap-2 max-w-[900px] mx-auto items-end">
          {/* Audio upload */}
          <button
            type="button"
            onClick={() => audioInputRef.current?.click()}
            disabled={audioProcessing}
            className="px-3 py-2.5 rounded-xl border border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white/80 transition-colors disabled:opacity-40 flex-shrink-0"
            title="Upload audio for transcription"
          >
            {audioProcessing ? (
              <span className="animate-pulse">…</span>
            ) : '🎤'}
          </button>
          {/* Image attach */}
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            className="px-3 py-2.5 rounded-xl border border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white/80 transition-colors flex-shrink-0"
            title="Attach image"
          >🖼</button>
          {/* File attach */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-2.5 rounded-xl border border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white/80 transition-colors flex-shrink-0"
            title="Attach PDF or text file"
          >📎</button>

          {/* Textarea */}
          <div className="flex-1 min-w-0">
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
              }}
              onPaste={(e) => {
                const items = Array.from(e.clipboardData.items);
                const imageItems = items.filter(it => it.type.startsWith('image/'));
                if (imageItems.length) {
                  e.preventDefault();
                  imageItems.forEach(it => {
                    const file = it.getAsFile();
                    if (file) setPendingImages(prev => [...prev, { url: URL.createObjectURL(file), name: file.name || 'pasted-image.png', file }]);
                  });
                }
              }}
              placeholder={pendingImages.length > 0 ? 'Ask about the image…' : 'Type your message or @bot…'}
              rows={1}
              className="w-full px-3 py-2.5 bg-white/[0.04] border border-white/10 rounded-xl text-white text-[0.9rem] font-[inherit] resize-none leading-relaxed max-h-[200px] overflow-y-auto focus:outline-none focus:border-sky-400/50 focus:ring-[3px] focus:ring-sky-400/15 placeholder-white/30"
            />
          </div>

          {/* Send / Stop */}
          {status === 'streaming' ? (
            <button
              type="button"
              onClick={() => clearHistory()}
              className="px-4 py-2.5 rounded-xl border border-rose-400/40 bg-rose-400/[0.16] text-rose-300 text-sm font-medium hover:bg-rose-400/[0.24] transition-all flex-shrink-0"
            >Stop</button>
          ) : (
            <button
              type="button"
              onClick={doSend}
              disabled={!inputText.trim() && pendingImages.length === 0}
              className="px-4 py-2.5 rounded-xl border border-sky-400/40 bg-sky-400/[0.16] text-white text-sm font-medium hover:bg-sky-400/[0.24] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex-shrink-0"
            >Send</button>
          )}
        </div>

        {/* Hidden file inputs */}
        <input ref={audioInputRef} type="file" accept=".wav,.mp3,.m4a,.aac,.ogg,.opus,.mp4,.webm" className="hidden"
          onChange={e => { handleAudioFileSelect(e.target.files?.[0] || null); e.target.value = ''; }} />
        <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden"
          onChange={e => { handleImageFiles(e.target.files); e.target.value = ''; }} />
        <input ref={fileInputRef} type="file" accept=".pdf,.txt,.md,.csv,.json,.xml,.html,.css,.js,.ts" multiple className="hidden"
          onChange={e => { handleFileText(e.target.files); e.target.value = ''; }} />
      </div>
    </div>
  );
}
