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

const IMAGE_FORMAT_PRESETS = [
  { id: '16:9', label: 'Landscape 16:9', width: 1120, height: 630 },
  { id: '4:2', label: 'Cinematic 4:2', width: 1200, height: 600 },
  { id: '1:1', label: 'Square 1:1', width: 1024, height: 1024 },
  { id: '4:5', label: 'Portrait 4:5', width: 896, height: 1120 },
  { id: '9:16', label: 'Story 9:16', width: 630, height: 1120 },
] as const;

const IMAGE_STYLE_PRESETS = [
  { id: 'none', label: 'No style preset', token: '' },
  { id: 'photoreal', label: 'Photoreal', token: 'photorealistic rendering, professional clarity, rich textures' },
  { id: 'cinematic', label: 'Cinematic', token: 'cinematic precision, dramatic composition, widescreen film still' },
  { id: 'editorial', label: 'Editorial', token: 'editorial photography, magazine-quality composition, clean subject separation' },
  { id: 'poster', label: 'Poster', token: 'poster design, strong composition, striking visual hierarchy' },
  { id: 'illustration', label: 'Illustration', token: 'illustrated style, crafted visual storytelling, clean shapes' },
  { id: 'pixar', label: 'Pixar / 3D', token: 'internal test render, Pixar style, polished 3D animated look' },
  { id: 'concept-art', label: 'Concept Art', token: 'concept art, artstation quality, atmospheric visual development' },
] as const;

const IMAGE_LIGHTING_PRESETS = [
  { id: 'none', label: 'No lighting preset', token: '' },
  { id: 'golden-hour', label: 'Golden Hour', token: 'golden hour, warm diffused natural light' },
  { id: 'soft-studio', label: 'Soft Studio', token: 'softbox lighting, clean studio illumination' },
  { id: 'low-key', label: 'Low Key', token: 'low key lighting, moody high contrast shadows' },
  { id: 'overcast', label: 'Overcast', token: 'diffused overcast light, matte editorial tone' },
  { id: 'candlelight', label: 'Candlelight', token: 'candlelight glow, warm amber practical lighting' },
  { id: 'nordic-twilight', label: 'Nordic Twilight', token: 'Nordic twilight, cool blue hour atmosphere' },
] as const;

const IMAGE_TEXT_TREATMENTS = [
  { id: 'poster-title', label: 'Poster Title', token: 'bold poster title, clean edges' },
  { id: 'logo', label: 'Logo', token: 'logo design, crisp letterforms, balanced mark composition' },
  { id: 'neon', label: 'Neon', token: 'neon glowing outline, illuminated signage' },
  { id: 'gold-serif', label: 'Gold Serif', token: 'elegant serif lettering, gold foil embossed look' },
  { id: 'carved-stone', label: 'Carved Stone', token: 'chiseled stone inscription, carved letterforms' },
] as const;

interface ImagePromptPreset {
  id: string;
  label: string;
  prompt: string;
  format: (typeof IMAGE_FORMAT_PRESETS)[number]['id'];
  style: (typeof IMAGE_STYLE_PRESETS)[number]['id'];
  lighting: (typeof IMAGE_LIGHTING_PRESETS)[number]['id'];
  renderTraits: string[];
  includeText: boolean;
  textTreatment?: (typeof IMAGE_TEXT_TREATMENTS)[number]['id'];
}

const IMAGE_PROMPT_PRESETS: ImagePromptPreset[] = [
  {
    id: 'photo-real',
    label: 'Photo Real',
    prompt: '',
    format: '16:9',
    style: 'photoreal',
    lighting: 'golden-hour',
    renderTraits: [] as string[],
    includeText: false,
  },
  {
    id: 'poster-with-text',
    label: 'Poster With Text',
    prompt: '',
    format: '4:5',
    style: 'poster',
    lighting: 'soft-studio',
    renderTraits: [] as string[],
    includeText: true,
    textTreatment: 'poster-title',
  },
  {
    id: 'cinematic-wide',
    label: 'Cinematic Wide',
    prompt: '',
    format: '4:2',
    style: 'cinematic',
    lighting: 'golden-hour',
    renderTraits: ['Anamorphic Lens Flare'],
    includeText: false,
  },
  {
    id: 'long-exposure',
    label: 'Long Exposure',
    prompt: '',
    format: '16:9',
    style: 'photoreal',
    lighting: 'low-key',
    renderTraits: ['Long Exposure', 'Film Grain'],
    includeText: false,
  },
  ];

const IMAGE_RENDER_TRAITS = ['Long Exposure', '35mm Lens', '85mm Portrait', 'Shallow Depth of Field', 'Film Grain', 'Anamorphic Lens Flare'] as const;

function isImageGenerationModel(model: string) {
  return model === '@cf/bytedance/stable-diffusion-xl-lightning' || model === '@cf/leonardo/lucid-origin';
}

function getFormatPresetById(formatId: string) {
  return IMAGE_FORMAT_PRESETS.find((preset) => preset.id === formatId) || IMAGE_FORMAT_PRESETS[0];
}

function composeImagePrompt({
  basePrompt,
  stylePreset,
  lightingPreset,
  renderTraits,
  includeText,
  imageText,
  textTreatment,
}: {
  basePrompt: string;
  stylePreset: string;
  lightingPreset: string;
  renderTraits: string[];
  includeText: boolean;
  imageText: string;
  textTreatment: string;
}) {
  const parts: string[] = [];
  const trimmedPrompt = basePrompt.trim();
  if (trimmedPrompt) parts.push(trimmedPrompt);

  const styleToken = IMAGE_STYLE_PRESETS.find((preset) => preset.id === stylePreset)?.token;
  if (styleToken) parts.push(styleToken);

  const lightingToken = IMAGE_LIGHTING_PRESETS.find((preset) => preset.id === lightingPreset)?.token;
  if (lightingToken) parts.push(lightingToken);

  if (renderTraits.includes('Long Exposure')) parts.push('long exposure photograph');
  if (renderTraits.includes('35mm Lens')) parts.push('35mm lens');
  if (renderTraits.includes('85mm Portrait')) parts.push('85mm portrait lens');
  if (renderTraits.includes('Shallow Depth of Field')) parts.push('shallow depth of field');
  if (renderTraits.includes('Film Grain')) parts.push('film grain');
  if (renderTraits.includes('Anamorphic Lens Flare')) parts.push('anamorphic lens flare');

  if (includeText && imageText.trim()) {
    parts.push(`the text "${imageText.trim()}"`);
    const treatmentToken = IMAGE_TEXT_TREATMENTS.find((treatment) => treatment.id === textTreatment)?.token;
    if (treatmentToken) parts.push(treatmentToken);
  }

  return parts.filter(Boolean).join(', ').replace(/\s+,/g, ',').trim();
}

// ---------- Created-graph card (delegate_to_youtube_graph / create_graph) ----------

const KG_API = 'https://knowledge.vegvisr.org';
const GRAPH_CONTEXT_TOOL_NAMES = new Set([
  'read_graph',
  'read_graph_content',
  'read_node',
  'create_graph',
  'create_node',
  'patch_node',
  'patch_graph_metadata',
  'delegate_to_kg',
]);

function buildHeaderImageMarkup(imageUrl: string) {
  return `![Header|height: 260px; object-fit: 'cover'; object-position: 'center'](${imageUrl})`;
}

function buildWrappedImageMarkup(mode: 'leftside' | 'rightside', imageUrl: string) {
  if (mode === 'leftside') {
    return `![Leftside-1|width: 200px; height: 200px; object-fit: 'cover'; object-position: 'center'; margin: '0 20px 15px 0'](${imageUrl})`;
  }
  return `![Rightside-1|width: 200px; height: 200px; object-fit: 'cover'; object-position: 'center'; margin: '0 0 15px 20px'](${imageUrl})`;
}

function insertWrappedImageIntoMarkdown(markdown: string, mode: 'leftside' | 'rightside', imageUrl: string) {
  const normalized = String(markdown || '').replace(/\r\n/g, '\n').trim();
  const imageMarkup = buildWrappedImageMarkup(mode, imageUrl);
  if (!normalized) return imageMarkup;

  const blocks = normalized.split(/\n{2,}/);
  const paragraphIndex = blocks.findIndex((block) => {
    const trimmed = block.trim();
    if (!trimmed) return false;
    if (/^!\[/.test(trimmed)) return false;
    if (/^#+\s/.test(trimmed)) return false;
    if (/^\[[A-Z-]+/.test(trimmed)) return false;
    return true;
  });

  if (paragraphIndex === -1) {
    return `${normalized}\n\n${imageMarkup}`;
  }

  const paragraph = blocks[paragraphIndex].trim();
  blocks[paragraphIndex] = `${imageMarkup} ${paragraph}`.trim();
  return blocks.join('\n\n');
}

async function fetchGraphData(graphId: string) {
  const res = await fetch(`${KG_API}/getknowgraph?id=${encodeURIComponent(graphId)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `Failed to load graph (${res.status})`);
  return data;
}

async function patchNodeWithVersionRetry(graphId: string, nodeId: string, fields: Record<string, unknown>) {
  let graphData = await fetchGraphData(graphId);
  let expectedVersion = Number(graphData?.metadata?.version || 0);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await fetch(`${KG_API}/patchNode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin' },
      body: JSON.stringify({ graphId, nodeId, fields, expectedVersion }),
    });
    const data = await res.json();
    if (res.ok) return data;

    const isConflict = res.status === 409 || String(data?.error || '').toLowerCase().includes('version mismatch');
    if (!isConflict || attempt === 1) {
      throw new Error(data?.error || `Failed to patch node (${res.status})`);
    }

    graphData = await fetchGraphData(graphId);
    expectedVersion = Number(graphData?.metadata?.version || 0);
  }
}

async function addStandaloneImageNodeToGraph(graphId: string, imageUrl: string, label = 'Generated Image', altText = 'Generated image') {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'image';
  const nodeId = `node-${slug}-${Math.random().toString(36).slice(2, 10)}`;
  const node = {
    id: nodeId,
    label,
    type: 'markdown-image',
    color: '#6d7a4f',
    info: altText,
    path: imageUrl,
    imageWidth: '100%',
    imageHeight: 'auto',
    visible: true,
    position: { x: 0, y: 0 },
  };
  const res = await fetch(`${KG_API}/addNode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin' },
    body: JSON.stringify({ graphId, node }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Failed to add image node (${res.status})`);
  return { nodeId, label };
}

async function insertGeneratedImageIntoFulltextNode(graphId: string, imageUrl: string, mode: 'header' | 'leftside' | 'rightside') {
  const graphData = await fetchGraphData(graphId);
  const targetNode = (graphData.nodes || []).find((node: { type?: string }) => node.type === 'fulltext');
  if (!targetNode) throw new Error('No fulltext node found in the active graph');

  const currentInfo = String(targetNode.info || '');
  let nextInfo = currentInfo;
  if (mode === 'header') {
    nextInfo = `${buildHeaderImageMarkup(imageUrl)}\n\n${currentInfo.trimStart()}`.trim();
  } else {
    nextInfo = insertWrappedImageIntoMarkdown(currentInfo, mode, imageUrl);
  }

  await patchNodeWithVersionRetry(graphId, targetNode.id, { info: nextInfo });
  return { nodeId: targetNode.id, label: targetNode.label || targetNode.id };
}

function CreatedGraphCard({ graphId, fallbackTitle }: { graphId: string; fallbackTitle?: string }) {
  const [meta, setMeta] = useState<{ title: string; description: string; nodeCount: number; nodeTypes: string[] } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const viewHref = `https://www.vegvisr.org/gnew-viewer?graphId=${graphId}`;

  useEffect(() => {
    if (!graphId) return;
    fetch(`${KG_API}/getknowgraph?id=${encodeURIComponent(graphId)}`)
      .then(r => r.json())
      .then(data => {
        const nodes = data.nodes || [];
        const types = [...new Set(nodes.map((n: { type?: string }) => n.type).filter(Boolean))] as string[];
        setMeta({
          title: data.metadata?.title || fallbackTitle || graphId,
          description: data.metadata?.description || '',
          nodeCount: nodes.length,
          nodeTypes: types,
        });
      })
      .catch(() => {});
  }, [graphId, fallbackTitle]);

  return (
    <>
      <div className="mt-2 p-3 rounded-lg border border-sky-400/20 bg-sky-400/[0.06]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-white font-semibold text-sm">{meta?.title || fallbackTitle || 'New graph'}</div>
            {meta?.description && (
              <div className="text-white/50 text-xs mt-1 line-clamp-2">{meta.description}</div>
            )}
            <div className="flex flex-wrap gap-1.5 mt-2">
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
        <GraphPreviewLazy graphId={graphId} title={meta?.title || fallbackTitle || graphId} onClose={() => setPreviewing(false)} />
      )}
    </>
  );
}

// ── Direct Graph Action Bar ─────────────────────────────────────
// Bypasses the LLM for deterministic graph operations.
// Calls knowledge.vegvisr.org directly so models like Gemma that
// struggle with tool-call payloads can still create graphs/nodes.

const NODE_TYPES: Array<{ type: string; label: string; color: string; defaultInfo: string }> = [
  { type: 'fulltext', label: 'Fulltext (markdown)', color: '#4f6d7a', defaultInfo: '# New section\n\nContent…' },
  { type: 'html-node', label: 'HTML page', color: '#7a4f6d', defaultInfo: '<!DOCTYPE html>\n<html><body><h1>Hello</h1></body></html>' },
  { type: 'mermaid-diagram', label: 'Mermaid diagram', color: '#0ea5e9', defaultInfo: 'graph TB\n  A[Start] --> B[End]' },
  { type: 'markdown-image', label: 'Image', color: '#6d7a4f', defaultInfo: 'Image alt text' },
  { type: 'youtube-video', label: 'YouTube video', color: '#FF0000', defaultInfo: '# Video description' },
  { type: 'css-node', label: 'CSS styles', color: '#4f7a6d', defaultInfo: '.v-page { background: #fff; }' },
];

interface GraphActionBarProps {
  onGraphCreated: (graphId: string, title: string) => void;
  onNodeAdded: (graphId: string, nodeId: string, label: string, type: string) => void;
  onNodeUpdated: (graphId: string, nodeId: string, label: string, summary: string) => void;
  onError: (message: string) => void;
  recentGraphId: string | null;
  activeGraphId?: string;
  activeGraphTitle?: string;
  onGraphContextChange?: (graphId: string) => void;
}

function GraphActionBar({
  onGraphCreated,
  onNodeAdded,
  onNodeUpdated,
  onError,
  recentGraphId,
  activeGraphId,
  activeGraphTitle,
  onGraphContextChange,
}: GraphActionBarProps) {
  const [showNewGraph, setShowNewGraph] = useState(false);
  const [showAddNode, setShowAddNode] = useState(false);
  const [showAddImage, setShowAddImage] = useState(false);
  const [busy, setBusy] = useState(false);

  // New graph fields
  const [graphTitle, setGraphTitle] = useState('');
  const [graphDescription, setGraphDescription] = useState('');
  const [graphCategory, setGraphCategory] = useState('');
  const [graphMetaArea, setGraphMetaArea] = useState('');

  // Add node fields
  const [nodeGraphId, setNodeGraphId] = useState(recentGraphId || '');
  const [nodeType, setNodeType] = useState(NODE_TYPES[0].type);
  const [nodeLabel, setNodeLabel] = useState('');
  const [nodeInfo, setNodeInfo] = useState(NODE_TYPES[0].defaultInfo);
  const [nodePath, setNodePath] = useState('');
  const [imageGraphId, setImageGraphId] = useState(activeGraphId || recentGraphId || '');
  const [imageMode, setImageMode] = useState<'standalone' | 'header' | 'leftside' | 'rightside'>('standalone');
  const [imageNodeLabel, setImageNodeLabel] = useState('Header Image');
  const [imageAltText, setImageAltText] = useState('Header image');
  const [imageUrl, setImageUrl] = useState('');
  const [targetNodeId, setTargetNodeId] = useState('');
  const [fulltextNodes, setFulltextNodes] = useState<Array<{ id: string; label: string; info: string }>>([]);
  const [loadingFulltextNodes, setLoadingFulltextNodes] = useState(false);

  useEffect(() => {
    if (activeGraphId) setNodeGraphId(activeGraphId);
    else if (recentGraphId && !nodeGraphId) setNodeGraphId(recentGraphId);
  }, [activeGraphId, recentGraphId, nodeGraphId]);

  useEffect(() => {
    if (activeGraphId) setImageGraphId(activeGraphId);
    else if (recentGraphId && !imageGraphId) setImageGraphId(recentGraphId);
  }, [activeGraphId, recentGraphId, imageGraphId]);

  useEffect(() => {
    if (!showAddImage || imageMode === 'standalone') return;
    const gid = imageGraphId.trim();
    if (!gid) {
      setFulltextNodes([]);
      setTargetNodeId('');
      return;
    }

    let cancelled = false;
    setLoadingFulltextNodes(true);
    fetchGraphData(gid)
      .then((graphData) => {
        if (cancelled) return;
        const nodes = (graphData.nodes || [])
          .filter((node: { type?: string }) => node.type === 'fulltext')
          .map((node: { id: string; label?: string; info?: string }) => ({
            id: node.id,
            label: node.label || node.id,
            info: node.info || '',
          }));
        setFulltextNodes(nodes);
        setTargetNodeId((prev) => (prev && nodes.some((node: { id: string }) => node.id === prev) ? prev : (nodes[0]?.id || '')));
      })
      .catch(() => {
        if (cancelled) return;
        setFulltextNodes([]);
        setTargetNodeId('');
      })
      .finally(() => {
        if (!cancelled) setLoadingFulltextNodes(false);
      });

    return () => {
      cancelled = true;
    };
  }, [showAddImage, imageMode, imageGraphId]);

  function selectType(t: string) {
    setNodeType(t);
    const def = NODE_TYPES.find(n => n.type === t);
    if (def) setNodeInfo(def.defaultInfo);
  }

  async function createGraph() {
    const title = graphTitle.trim();
    if (!title) { onError('Title is required'); return; }
    setBusy(true);
    const graphId = `graph_${Date.now()}`;
    try {
      const res = await fetch(`${KG_API}/saveGraphWithHistory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin' },
        body: JSON.stringify({
          id: graphId,
          override: true,
          graphData: {
            nodes: [],
            edges: [],
            metadata: {
              title,
              description: graphDescription.trim(),
              category: graphCategory.trim(),
              metaArea: graphMetaArea.trim(),
              version: 1,
              createdBy: 'VegvisrAgentChat',
            },
          },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onGraphCreated(graphId, title);
      onGraphContextChange?.(graphId);
      setGraphTitle(''); setGraphDescription(''); setGraphCategory(''); setGraphMetaArea('');
      setShowNewGraph(false);
      setNodeGraphId(graphId);
      setImageGraphId(graphId);
    } catch (e) {
      onError(`Failed to create graph: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setBusy(false);
    }
  }

  async function addNode() {
    const gid = nodeGraphId.trim();
    const label = nodeLabel.trim();
    if (!gid) { onError('Graph ID is required'); return; }
    if (!label) { onError('Node label is required'); return; }
    setBusy(true);
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'node';
    const nid = `node-${slug}-${Math.random().toString(36).slice(2, 10)}`;
    const def = NODE_TYPES.find(n => n.type === nodeType);
    const node: Record<string, unknown> = {
      id: nid,
      label,
      type: nodeType,
      color: def?.color || '#4f6d7a',
      info: nodeInfo,
      visible: true,
      position: { x: 0, y: 0 },
    };
    if (nodeType === 'markdown-image' || nodeType === 'youtube-video') {
      node.path = nodePath.trim();
      if (nodeType === 'markdown-image') {
        node.imageWidth = '100%';
        node.imageHeight = 'auto';
      }
    }
    if (nodeType === 'mermaid-diagram') {
      node.path = 'https://vegvisr.imgix.net/mermaid.png';
      node.imageWidth = '400';
      node.imageHeight = '300';
    }
    try {
      const res = await fetch(`${KG_API}/addNode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin' },
        body: JSON.stringify({ graphId: gid, node }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onNodeAdded(gid, nid, label, nodeType);
      onGraphContextChange?.(gid);
      setNodeLabel(''); setNodePath('');
      const d = NODE_TYPES.find(n => n.type === nodeType);
      if (d) setNodeInfo(d.defaultInfo);
      setShowAddNode(false);
    } catch (e) {
      onError(`Failed to add node: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setBusy(false);
    }
  }

  async function addImageAction() {
    const gid = imageGraphId.trim();
    const url = imageUrl.trim();
    if (!gid) { onError('Graph ID is required'); return; }
    if (!url) { onError('Image URL is required'); return; }

    setBusy(true);
    try {
      if (imageMode === 'standalone') {
        const label = imageNodeLabel.trim() || 'Image';
        const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'image';
        const nodeId = `node-${slug}-${Math.random().toString(36).slice(2, 10)}`;
        const node = {
          id: nodeId,
          label,
          type: 'markdown-image',
          color: '#6d7a4f',
          info: imageAltText.trim() || label,
          path: url,
          imageWidth: '100%',
          imageHeight: 'auto',
          visible: true,
          position: { x: 0, y: 0 },
        };
        const res = await fetch(`${KG_API}/addNode`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-role': 'Superadmin' },
          body: JSON.stringify({ graphId: gid, node }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        onNodeAdded(gid, nodeId, label, 'markdown-image');
        onGraphContextChange?.(gid);
      } else {
        const nodeId = targetNodeId.trim();
        if (!nodeId) throw new Error('Select a target fulltext node');
        const graphData = await fetchGraphData(gid);
        const targetNode = (graphData.nodes || []).find((node: { id?: string }) => node.id === nodeId);
        if (!targetNode) throw new Error(`Node "${nodeId}" not found`);
        if (targetNode.type !== 'fulltext') throw new Error('Target node must be a fulltext node');

        const currentInfo = String(targetNode.info || '');
        let nextInfo = currentInfo;
        if (imageMode === 'header') {
          nextInfo = `${buildHeaderImageMarkup(url)}\n\n${currentInfo.trimStart()}`.trim();
        } else {
          nextInfo = insertWrappedImageIntoMarkdown(currentInfo, imageMode, url);
        }

        await patchNodeWithVersionRetry(gid, nodeId, { info: nextInfo });
        onNodeUpdated(
          gid,
          nodeId,
          targetNode.label || nodeId,
          imageMode === 'header'
            ? 'Inserted Header image into fulltext node'
            : `Inserted ${imageMode === 'leftside' ? 'Leftside' : 'Rightside'} image into fulltext node`
        );
        onGraphContextChange?.(gid);
      }

      setImageUrl('');
      setImageAltText('Header image');
      setImageNodeLabel('Header Image');
      setShowAddImage(false);
    } catch (e) {
      onError(`Failed to add image: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-shrink-0 border-t border-white/10 px-4 py-2 bg-slate-950/60">
      <div className="max-w-[900px] mx-auto flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold text-white/40 uppercase tracking-wide">Direct graph actions</span>
        {activeGraphId && (
          <span className="px-2 py-1 rounded-md border border-purple-400/20 bg-purple-500/10 text-[10px] text-purple-200 max-w-[260px] truncate">
            Active: {activeGraphTitle || activeGraphId}
          </span>
        )}
        <button
          type="button"
          onClick={() => { setShowNewGraph(p => !p); setShowAddNode(false); setShowAddImage(false); }}
          disabled={busy}
          className="px-3 py-1 rounded-md border border-emerald-400/30 bg-emerald-400/10 text-emerald-300 text-xs hover:bg-emerald-400/20 disabled:opacity-40"
        >+ New Graph</button>
        <button
          type="button"
          onClick={() => { setShowAddNode(p => !p); setShowNewGraph(false); setShowAddImage(false); }}
          disabled={busy}
          className="px-3 py-1 rounded-md border border-sky-400/30 bg-sky-400/10 text-sky-300 text-xs hover:bg-sky-400/20 disabled:opacity-40"
        >+ Add Node</button>
        <button
          type="button"
          onClick={() => { setShowAddImage(p => !p); setShowNewGraph(false); setShowAddNode(false); }}
          disabled={busy}
          className="px-3 py-1 rounded-md border border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-300 text-xs hover:bg-fuchsia-400/20 disabled:opacity-40"
        >+ Add Image</button>
        {recentGraphId && (
          <span className="text-[10px] text-white/40 font-mono truncate max-w-[260px]">last: {recentGraphId}</span>
        )}
      </div>

      {showNewGraph && (
        <div className="max-w-[900px] mx-auto mt-2 p-3 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.04] space-y-2">
          <input value={graphTitle} onChange={e => setGraphTitle(e.target.value)} placeholder="Title (required)"
            className="w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded text-white text-sm placeholder-white/30 focus:outline-none focus:border-emerald-400/40" />
          <input value={graphDescription} onChange={e => setGraphDescription(e.target.value)} placeholder="Description"
            className="w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded text-white text-sm placeholder-white/30 focus:outline-none focus:border-emerald-400/40" />
          <div className="flex gap-2">
            <input value={graphCategory} onChange={e => setGraphCategory(e.target.value)} placeholder="Category (#tag1 #tag2)"
              className="flex-1 px-2 py-1.5 bg-white/5 border border-white/10 rounded text-white text-sm placeholder-white/30 focus:outline-none focus:border-emerald-400/40" />
            <input value={graphMetaArea} onChange={e => setGraphMetaArea(e.target.value)} placeholder="Meta area"
              className="flex-1 px-2 py-1.5 bg-white/5 border border-white/10 rounded text-white text-sm placeholder-white/30 focus:outline-none focus:border-emerald-400/40" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowNewGraph(false)} disabled={busy}
              className="px-3 py-1 rounded-md border border-white/10 bg-white/[0.04] text-white/60 text-xs hover:bg-white/[0.08]">Cancel</button>
            <button type="button" onClick={createGraph} disabled={busy || !graphTitle.trim()}
              className="px-3 py-1 rounded-md border border-emerald-400/40 bg-emerald-500/20 text-emerald-200 text-xs hover:bg-emerald-500/30 disabled:opacity-40">
              {busy ? 'Creating…' : 'Create graph'}
            </button>
          </div>
        </div>
      )}

      {showAddNode && (
        <div className="max-w-[900px] mx-auto mt-2 p-3 rounded-lg border border-sky-400/20 bg-sky-400/[0.04] space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {NODE_TYPES.map(n => (
              <button key={n.type} type="button" onClick={() => selectType(n.type)} disabled={busy}
                className={`px-2 py-1 rounded-md text-[11px] border transition-colors ${nodeType === n.type ? 'border-sky-400/60 bg-sky-400/20 text-white' : 'border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08]'}`}>
                {n.label}
              </button>
            ))}
          </div>
          <input value={nodeGraphId} onChange={e => setNodeGraphId(e.target.value)} placeholder="Graph ID (required)"
            className="w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded text-white text-sm font-mono placeholder-white/30 focus:outline-none focus:border-sky-400/40" />
          <input value={nodeLabel} onChange={e => setNodeLabel(e.target.value)} placeholder="Node label (required)"
            className="w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded text-white text-sm placeholder-white/30 focus:outline-none focus:border-sky-400/40" />
          {(nodeType === 'markdown-image' || nodeType === 'youtube-video') && (
            <input value={nodePath} onChange={e => setNodePath(e.target.value)} placeholder={nodeType === 'youtube-video' ? 'YouTube URL' : 'Image URL'}
              className="w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded text-white text-sm placeholder-white/30 focus:outline-none focus:border-sky-400/40" />
          )}
          <textarea value={nodeInfo} onChange={e => setNodeInfo(e.target.value)} placeholder="Content / info"
            rows={4}
            className="w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded text-white text-sm font-mono placeholder-white/30 resize-y focus:outline-none focus:border-sky-400/40" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowAddNode(false)} disabled={busy}
              className="px-3 py-1 rounded-md border border-white/10 bg-white/[0.04] text-white/60 text-xs hover:bg-white/[0.08]">Cancel</button>
            <button type="button" onClick={addNode} disabled={busy || !nodeGraphId.trim() || !nodeLabel.trim()}
              className="px-3 py-1 rounded-md border border-sky-400/40 bg-sky-500/20 text-sky-200 text-xs hover:bg-sky-500/30 disabled:opacity-40">
              {busy ? 'Adding…' : 'Add node'}
            </button>
          </div>
        </div>
      )}

      {showAddImage && (
        <div className="max-w-[900px] mx-auto mt-2 p-3 rounded-lg border border-fuchsia-400/20 bg-fuchsia-400/[0.04] space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {[
              { id: 'standalone', label: 'Standalone node' },
              { id: 'header', label: 'Header in fulltext' },
              { id: 'leftside', label: 'Leftside in fulltext' },
              { id: 'rightside', label: 'Rightside in fulltext' },
            ].map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => setImageMode(mode.id as 'standalone' | 'header' | 'leftside' | 'rightside')}
                disabled={busy}
                className={`px-2 py-1 rounded-md text-[11px] border transition-colors ${imageMode === mode.id ? 'border-fuchsia-400/60 bg-fuchsia-400/20 text-white' : 'border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08]'}`}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <input
            value={imageGraphId}
            onChange={e => setImageGraphId(e.target.value)}
            placeholder="Graph ID (required)"
            className="w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded text-white text-sm font-mono placeholder-white/30 focus:outline-none focus:border-fuchsia-400/40"
          />
          {imageMode === 'standalone' ? (
            <input
              value={imageNodeLabel}
              onChange={e => setImageNodeLabel(e.target.value)}
              placeholder="Node label"
              className="w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded text-white text-sm placeholder-white/30 focus:outline-none focus:border-fuchsia-400/40"
            />
          ) : (
            <div className="space-y-1">
              <div className="text-[11px] text-white/40">Target fulltext node</div>
              <select
                value={targetNodeId}
                onChange={e => setTargetNodeId(e.target.value)}
                disabled={busy || loadingFulltextNodes || fulltextNodes.length === 0}
                className="w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded text-white text-sm focus:outline-none focus:border-fuchsia-400/40"
              >
                {loadingFulltextNodes && <option value="">Loading fulltext nodes…</option>}
                {!loadingFulltextNodes && fulltextNodes.length === 0 && <option value="">No fulltext nodes found</option>}
                {!loadingFulltextNodes && fulltextNodes.map((node) => (
                  <option key={node.id} value={node.id} className="bg-slate-900 text-white">
                    {node.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <input
            value={imageUrl}
            onChange={e => setImageUrl(e.target.value)}
            placeholder="https://vegvisr.imgix.net/..."
            className="w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded text-white text-sm placeholder-white/30 focus:outline-none focus:border-fuchsia-400/40"
          />
          {imageMode === 'standalone' ? (
            <input
              value={imageAltText}
              onChange={e => setImageAltText(e.target.value)}
              placeholder="Alt text / description"
              className="w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded text-white text-sm placeholder-white/30 focus:outline-none focus:border-fuchsia-400/40"
            />
          ) : (
            <div className="text-[11px] text-white/45">
              The image markup is inserted directly into the selected fulltext node. Leftside and Rightside wrap the first paragraph beside the image.
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAddImage(false)}
              disabled={busy}
              className="px-3 py-1 rounded-md border border-white/10 bg-white/[0.04] text-white/60 text-xs hover:bg-white/[0.08]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={addImageAction}
              disabled={busy || !imageGraphId.trim() || !imageUrl.trim() || (imageMode !== 'standalone' && !targetNodeId)}
              className="px-3 py-1 rounded-md border border-fuchsia-400/40 bg-fuchsia-500/20 text-fuchsia-200 text-xs hover:bg-fuchsia-500/30 disabled:opacity-40"
            >
              {busy ? 'Saving…' : 'Save image'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolResultCard({ toolName, output }: { toolName: string; output: unknown }) {
  if (toolName === 'who_am_i') return <WhoAmICard data={output as WhoAmIResult} />;
  if (toolName === 'list_graphs' || toolName === 'search_graphs') return <ListGraphsResultCard data={output as ListGraphsOutput} />;
  if (toolName === 'list_meta_areas') return <ListMetaAreasResultCard data={output as ListMetaAreasOutput} />;
  if (toolName === 'generate_image') return <GenerateImageCard output={output} />;
  // Graph-creating tools: show a preview card when the result includes a graphId
  const out = (output && typeof output === 'object') ? output as { graphId?: unknown; viewUrl?: unknown; success?: unknown } : null;
  if (out && typeof out.graphId === 'string' && out.graphId && out.success !== false) {
    return <CreatedGraphCard graphId={out.graphId} />;
  }
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
  graphId?: string;
  onGraphChange?: (graphId: string) => void;
  resolvedTheme?: 'light' | 'dark';
}

interface GeneratedImageResult {
  url: string;
  prompt: string;
  width?: number;
  height?: number;
}

interface LocalMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  graphId?: string;
  generatedImage?: GeneratedImageResult;
}

export default function VegvisrAgentChat({ userId, model = '@cf/meta/llama-4-scout-17b-16e-instruct', graphId, onGraphChange, resolvedTheme = 'dark' }: Props) {
  const isLight = resolvedTheme === 'light';
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
  const [localMessages, setLocalMessages] = useState<LocalMessage[]>([]);
  const [loadedMessages, setLoadedMessages] = useState<Array<{ id: string; role: 'user' | 'assistant'; text: string }>>([]);
  const [recentGraphId, setRecentGraphId] = useState<string | null>(null);
  const [activeGraphTitle, setActiveGraphTitle] = useState('');
  const lastTranscriptRef = useRef<string | null>(null);
  const lastTrackedGraphRef = useRef<string | null>(null);
  const [imageFormatPreset, setImageFormatPreset] = useState<(typeof IMAGE_FORMAT_PRESETS)[number]['id']>('16:9');
  const [imageStylePreset, setImageStylePreset] = useState<(typeof IMAGE_STYLE_PRESETS)[number]['id']>('none');
  const [imageLightingPreset, setImageLightingPreset] = useState<(typeof IMAGE_LIGHTING_PRESETS)[number]['id']>('none');
  const [imageRenderTraits, setImageRenderTraits] = useState<string[]>([]);
  const [includeImageText, setIncludeImageText] = useState(false);
  const [imageTextValue, setImageTextValue] = useState('');
  const [imageTextTreatment, setImageTextTreatment] = useState<(typeof IMAGE_TEXT_TREATMENTS)[number]['id']>('poster-title');
  const [showImageAdvanced, setShowImageAdvanced] = useState(false);

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
    body: { model, graphId },
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
      setLoadedMessages([]);
      lastTranscriptRef.current = null;
    }
  }, [model, clearHistory]);

  const isImageModel = isImageGenerationModel(model);
  const hasAspectRatioInPrompt = /--ar\s+\d+\s*:\s*\d+/i.test(inputText);
  const composedImagePrompt = composeImagePrompt({
    basePrompt: inputText,
    stylePreset: imageStylePreset,
    lightingPreset: imageLightingPreset,
    renderTraits: imageRenderTraits,
    includeText: includeImageText,
    imageText: imageTextValue,
    textTreatment: imageTextTreatment,
  });

  function applyImagePromptPreset(presetId: (typeof IMAGE_PROMPT_PRESETS)[number]['id']) {
    const preset = IMAGE_PROMPT_PRESETS.find((entry) => entry.id === presetId);
    if (!preset) return;
    setImageFormatPreset(preset.format as (typeof IMAGE_FORMAT_PRESETS)[number]['id']);
    setImageStylePreset(preset.style as (typeof IMAGE_STYLE_PRESETS)[number]['id']);
    setImageLightingPreset(preset.lighting as (typeof IMAGE_LIGHTING_PRESETS)[number]['id']);
    setImageRenderTraits([...preset.renderTraits]);
    setIncludeImageText(Boolean(preset.includeText));
    setImageTextTreatment((preset.textTreatment || 'poster-title') as (typeof IMAGE_TEXT_TREATMENTS)[number]['id']);
  }

  function toggleRenderTrait(trait: string) {
    setImageRenderTraits((prev) => prev.includes(trait) ? prev.filter((entry) => entry !== trait) : [...prev, trait]);
  }

  useEffect(() => {
    if (!graphId) {
      setActiveGraphTitle('');
      return;
    }
    setRecentGraphId(graphId);
    fetchGraphData(graphId)
      .then((data) => {
        setActiveGraphTitle(data?.metadata?.title || graphId);
      })
      .catch(() => {
        setActiveGraphTitle(graphId);
      });
  }, [graphId]);

  useEffect(() => {
    let nextGraphId: string | null = null;

    for (const msg of [...messages].reverse()) {
      for (const part of [...msg.parts].reverse()) {
        if (!isToolUIPart(part)) continue;
        const toolName = getToolName(part);
        const state = getToolPartState(part);
        if (state !== 'complete') continue;

        const output = getToolOutput(part);
        if (output && typeof output === 'object' && typeof (output as { graphId?: unknown }).graphId === 'string') {
          nextGraphId = (output as { graphId: string }).graphId;
          break;
        }

        if (GRAPH_CONTEXT_TOOL_NAMES.has(toolName)) {
          const input = getToolInput(part);
          if (input && typeof input === 'object' && typeof (input as { graphId?: unknown }).graphId === 'string') {
            nextGraphId = (input as { graphId: string }).graphId;
            break;
          }
        }
      }
      if (nextGraphId) break;
    }

    if (nextGraphId && nextGraphId !== lastTrackedGraphRef.current) {
      lastTrackedGraphRef.current = nextGraphId;
      setRecentGraphId(nextGraphId);
      onGraphChange?.(nextGraphId);
    }
  }, [messages, onGraphChange]);

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
          body: JSON.stringify({ graphId: graphId || recentGraphId || null, provider: 'workers-ai', title }),
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
    setLoadedMessages([]);
    lastTranscriptRef.current = null;
    setSessionsOpen(false);
  }

  async function loadSession(sid: string) {
    try {
      const res = await historyFetch(`/messages?sessionId=${sid}&decrypt=1&limit=200`, userId);
      const data = await res.json();
      const loaded = (data.messages || [])
        .reverse()
        .map((m: { role: string; content?: string }, idx: number) => ({
          id: `loaded-${sid}-${idx}`,
          role: m.role as 'user' | 'assistant',
          text: m.content || '',
        }));
      clearHistory();
      setLocalMessages([]);
      lastTranscriptRef.current = null;
      sessionIdRef.current = sid;
      setLoadedMessages(loaded);
      setSessionsOpen(false);
    } catch { /* ignore */ }
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

  async function runDirectImageGeneration({
    prompt,
    userMessageId,
    originalUserText,
    explicitWidth,
    explicitHeight,
  }: {
    prompt: string;
    userMessageId: string;
    originalUserText: string;
    explicitWidth?: number;
    explicitHeight?: number;
  }) {
    try {
      const requestBody: Record<string, unknown> = { prompt, userId, model };
      if (explicitWidth) requestBody.width = explicitWidth;
      if (explicitHeight) requestBody.height = explicitHeight;

      const res = await fetch('https://agent.vegvisr.org/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const data = await res.json() as { url?: string; error?: string; width?: number; height?: number; prompt?: string };
      if (!res.ok || !data.url) throw new Error(data.error || 'Generation failed');
      const imageUrl = data.url;

      setLocalMessages(prev => [...prev, {
        id: `${userMessageId}-r`,
        role: 'assistant',
        text: originalUserText,
        generatedImage: {
          url: imageUrl,
          prompt: data.prompt || prompt,
          width: data.width,
          height: data.height,
        },
      }]);
    } catch (e) {
      setLocalMessages(prev => [...prev, {
        id: `${userMessageId}-r`,
        role: 'assistant',
        text: `Failed to generate image: ${e instanceof Error ? e.message : 'unknown error'}`,
      }]);
    }
  }

  async function handleGeneratedImageAction(action: 'image-node' | 'header' | 'leftside' | 'regenerate', image: GeneratedImageResult) {
    try {
      if (action === 'regenerate') {
        const hasManualAspectRatio = /--ar\s+\d+\s*:\s*\d+/i.test(image.prompt);
        const formatPreset = getFormatPresetById(imageFormatPreset);
        const userMsgId = `${Date.now()}-regen`;
        setLocalMessages(prev => [...prev, { id: userMsgId, role: 'user', text: image.prompt }]);
        await runDirectImageGeneration({
          prompt: image.prompt,
          userMessageId: userMsgId,
          originalUserText: image.prompt,
          explicitWidth: hasManualAspectRatio ? undefined : formatPreset.width,
          explicitHeight: hasManualAspectRatio ? undefined : formatPreset.height,
        });
        return;
      }

      const targetGraphId = graphId || recentGraphId;
      if (!targetGraphId) throw new Error('Select or create a graph first');

      if (action === 'image-node') {
        await addStandaloneImageNodeToGraph(targetGraphId, image.url, 'Generated Image', image.prompt);
      } else {
        await insertGeneratedImageIntoFulltextNode(targetGraphId, image.url, action);
      }

      setRecentGraphId(targetGraphId);
      onGraphChange?.(targetGraphId);
      setActiveGraphTitle((prev) => prev || targetGraphId);
      setLocalMessages(prev => [...prev, {
        id: `${Date.now()}-${action}`,
        role: 'assistant',
        text: action === 'image-node'
          ? `Saved generated image to graph \`${targetGraphId}\` as a markdown-image node.`
          : `Inserted generated image into graph \`${targetGraphId}\` as ${action === 'header' ? 'a Header image' : 'a Leftside image'}.`,
      }]);
    } catch (e) {
      setLocalMessages(prev => [...prev, {
        id: `${Date.now()}-${action}-error`,
        role: 'assistant',
        text: `Failed to apply generated image: ${e instanceof Error ? e.message : 'unknown error'}`,
      }]);
    }
  }

  async function doSend() {
    const text = inputText.trim();
    const hasImages = pendingImages.length > 0;
    if (!text && !hasImages) return;
    const imageModelSelected = isImageGenerationModel(model);
    // If there's a pending transcript, prepend it as context for text/chat models only.
    const transcript = lastTranscriptRef.current;
    lastTranscriptRef.current = null;
    const contextPrefix = transcript && !imageModelSelected ? `[Transcription context]:\n${transcript}\n\n` : '';
    const fullText = `${contextPrefix}${text}`.trim();

    // Image generation models — every message is an image prompt
    if (imageModelSelected && !hasImages) {
      const prompt = composeImagePrompt({
        basePrompt: text,
        stylePreset: imageStylePreset,
        lightingPreset: imageLightingPreset,
        renderTraits: imageRenderTraits,
        includeText: includeImageText,
        imageText: imageTextValue,
        textTreatment: imageTextTreatment,
      });
      if (!prompt) return;
      setInputText('');
      const userMsgId = Date.now().toString();
      setLocalMessages(prev => [...prev, { id: userMsgId, role: 'user', text: prompt }]);
      const formatPreset = getFormatPresetById(imageFormatPreset);
      await runDirectImageGeneration({
        prompt,
        userMessageId: userMsgId,
        originalUserText: prompt,
        explicitWidth: /--ar\s+\d+\s*:\s*\d+/i.test(prompt) ? undefined : formatPreset.width,
        explicitHeight: /--ar\s+\d+\s*:\s*\d+/i.test(prompt) ? undefined : formatPreset.height,
      });
      return;
    }

    // Intercept image generation requests on other models too
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
          body: JSON.stringify({ prompt, userId }),
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

  function pushActionMessage(text: string, graphId?: string) {
    const id = `action-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setLocalMessages(prev => [...prev, { id, role: 'assistant', text, graphId }]);
  }

  function handleGraphCreated(graphId: string, title: string) {
    setRecentGraphId(graphId);
    setActiveGraphTitle(title);
    onGraphChange?.(graphId);
    pushActionMessage(`✅ Created graph **${title}**\n\nGraph ID: \`${graphId}\``, graphId);
  }

  function handleNodeAdded(graphId: string, nodeId: string, label: string, type: string) {
    setRecentGraphId(graphId);
    onGraphChange?.(graphId);
    pushActionMessage(`➕ Added **${type}** node "${label}" to graph\n\nNode ID: \`${nodeId}\``, graphId);
  }

  function handleNodeUpdated(graphId: string, nodeId: string, label: string, summary: string) {
    setRecentGraphId(graphId);
    onGraphChange?.(graphId);
    pushActionMessage(`📝 ${summary}\n\nNode: **${label}**\n\nNode ID: \`${nodeId}\``, graphId);
  }

  function handleActionError(message: string) {
    pushActionMessage(`⚠️ ${message}`);
  }

  return (
    <div className={`flex flex-col flex-1 min-h-0 ${isLight ? 'bg-slate-50 text-slate-900' : 'bg-slate-950 text-white'}`}>
      {/* Top bar — matches AgentChat style */}
      <div className={`flex items-center justify-between px-3 py-2 border-b flex-wrap gap-2 ${isLight ? 'border-slate-200 bg-white/90' : 'border-white/10 bg-slate-950/80'}`}>
        <div className="flex items-center gap-2">
          {/* Sessions picker */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setSessionsOpen(p => !p)}
              className={`px-3 py-1 rounded-md border text-xs transition-colors ${isLight ? 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900' : 'border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white/80'}`}
            >
              Sessions ({sessions.length})
            </button>
            {sessionsOpen && (
              <div className={`absolute top-full mt-1 left-0 w-64 max-h-64 overflow-y-auto border rounded-lg z-50 shadow-xl ${isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-white/10'}`}>
                <button
                  type="button"
                  onClick={startNewSession}
                  className="w-full px-3 py-2 text-left text-xs text-sky-400 hover:bg-white/[0.06] border-b border-white/10"
                >
                  + New Session
                </button>
                {sessions.length === 0 && (
                  <div className={`px-3 py-3 text-xs ${isLight ? 'text-slate-400' : 'text-white/30'}`}>No saved sessions</div>
                )}
                {sessions.map(s => (
                  <div
                    key={s.id}
                    className={`px-3 py-2 text-xs cursor-pointer ${isLight ? 'text-slate-600 hover:bg-slate-100' : 'text-white/60 hover:bg-white/[0.06]'}`}
                    onClick={() => loadSession(s.id)}
                  >
                    <div className="truncate">{s.title}</div>
                    {s.updatedAt && <div className={`text-[10px] ${isLight ? 'text-slate-400' : 'text-white/30'}`}>{new Date(s.updatedAt).toLocaleDateString()}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300">Workers AI</span>
          <span className={`text-xs font-mono ${isLight ? 'text-slate-500' : 'text-white/40'}`}>{model}</span>
        </div>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={copyLog}
              className={`px-3 py-1 rounded-md border text-xs transition-colors ${isLight ? 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900' : 'border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white/80'}`}
            >
              {copied ? 'Copied!' : 'Copy Log'}
            </button>
          )}
        </div>
      </div>
      {graphId && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-purple-600/10 border-b border-purple-500/20 text-purple-300 text-xs flex-shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-purple-400 flex-shrink-0 animate-pulse" />
          <span className="font-medium text-purple-200">Active context:</span>
          <span className="truncate text-purple-300/90">{activeGraphTitle || graphId}</span>
          {onGraphChange && (
            <button
              type="button"
              onClick={() => onGraphChange('')}
              className="ml-auto text-purple-400/40 hover:text-purple-300 transition-colors flex-shrink-0 leading-none"
              title="Clear graph context"
            >
              ✕
            </button>
          )}
        </div>
      )}
      {isImageModel && (
        <div className="flex items-start gap-2 px-4 py-2 bg-pink-500/10 border-b border-pink-400/20 text-pink-200 text-xs flex-shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-pink-400 flex-shrink-0 mt-1" />
          <div>
            <div className="font-medium">Image generation mode</div>
            <div className="text-pink-200/70">
              Every message becomes an image prompt. Use the controls below for format, style, and text rendering. Power users can still write <span className="font-mono">--ar</span> directly in the prompt.
            </div>
          </div>
        </div>
      )}
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && loadedMessages.length === 0 && (
          <div className={`text-sm text-center mt-8 ${isLight ? 'text-slate-400' : 'text-white/30'}`}>
            Start a conversation with the Vegvisr Agent
          </div>
        )}
        {/* Historical messages loaded from a saved session */}
        {loadedMessages.map(m => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-xl px-4 py-2 text-sm opacity-90 ${m.role === 'user' ? 'bg-purple-600 text-white' : isLight ? 'bg-white border border-slate-200 text-slate-800' : 'bg-white/10 text-white/90'}`}>
              <div className={`prose prose-sm max-w-none prose-p:my-2 prose-p:leading-relaxed ${isLight ? 'prose-slate' : 'prose-invert'}`}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
              </div>
              {m.role === 'user' && (
                <button
                  type="button"
                  onClick={() => setInputText(m.text)}
                  disabled={status === 'streaming'}
                  className="mt-1 float-right text-white/40 hover:text-white transition-colors disabled:opacity-30 text-base leading-none"
                  title="Use this prompt again"
                >
                  +
                </button>
              )}
            </div>
          </div>
        ))}
        {loadedMessages.length > 0 && messages.length === 0 && (
          <div className={`text-[11px] text-center border-t pt-3 ${isLight ? 'text-slate-300 border-slate-200' : 'text-white/20 border-white/10'}`}>
            — end of saved session — continue below —
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
                  : isLight ? 'bg-white border border-slate-200 text-slate-800' : 'bg-white/10 text-white/90'
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
                              <a href={seg} target="_blank" rel="noopener noreferrer" className={`text-[11px] underline break-all ${isLight ? 'text-slate-500 hover:text-slate-700' : 'text-white/30 hover:text-white/60'}`}>{seg}</a>
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
                        <pre className={`text-xs mb-2 overflow-auto ${isLight ? 'text-slate-700' : 'text-white/70'}`}>{JSON.stringify(input, null, 2)}</pre>
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
                      <div key={toolCallId} className={`mt-1 text-xs italic ${isLight ? 'text-slate-400' : 'text-white/30'}`}>
                        Running {toolName}…
                      </div>
                    );
                  }
                }

                return null;
              })}
              {msg.role === 'user' && (
                <button
                  type="button"
                  onClick={() => setInputText(msg.parts.filter(isTextUIPart).map(p => p.text).join(''))}
                  disabled={status === 'streaming'}
                  className="mt-1 float-right text-white/40 hover:text-white transition-colors disabled:opacity-30 text-base leading-none"
                  title="Use this prompt again"
                >
                  +
                </button>
              )}
            </div>
          </div>
        ))}
        {status === 'streaming' && (
          <div className="flex justify-start">
            <div className={`rounded-xl px-4 py-2 text-sm animate-pulse ${isLight ? 'bg-slate-200 text-slate-500' : 'bg-white/10 text-white/50'}`}>
              Thinking…
            </div>
          </div>
        )}
        {/* Local-only transcription messages */}
        {localMessages.map(m => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-xl px-4 py-2 text-sm ${m.role === 'user' ? 'bg-purple-600 text-white' : isLight ? 'bg-white border border-slate-200 text-slate-800' : 'bg-white/10 text-white/90'}`}>
              {m.generatedImage ? (
                <div>
                  <div className={`text-xs mb-2 break-words ${isLight ? 'text-slate-500' : 'text-white/50'}`}>{m.generatedImage.prompt}</div>
                  <img
                    src={m.generatedImage.url}
                    alt={m.generatedImage.prompt}
                    className="rounded-lg max-w-full max-h-[400px] object-contain border border-white/10"
                  />
                  <div className={`mt-1 text-[11px] break-all ${isLight ? 'text-slate-500' : 'text-white/30'}`}>
                    <a href={m.generatedImage.url} target="_blank" rel="noopener noreferrer" className={`underline ${isLight ? 'hover:text-slate-700' : 'hover:text-white/60'}`}>Open full size</a>
                    {m.generatedImage.width && m.generatedImage.height && <span className="ml-2">{m.generatedImage.width}×{m.generatedImage.height}px</span>}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleGeneratedImageAction('regenerate', m.generatedImage!)}
                      className="px-3 py-1 rounded-md border border-sky-400/30 bg-sky-400/10 text-sky-300 text-xs hover:bg-sky-400/20 transition-colors"
                    >
                      Regenerate
                    </button>
                    <button
                      type="button"
                      onClick={() => handleGeneratedImageAction('image-node', m.generatedImage!)}
                      disabled={!graphId && !recentGraphId}
                      className="px-3 py-1 rounded-md border border-emerald-400/30 bg-emerald-400/10 text-emerald-300 text-xs hover:bg-emerald-400/20 transition-colors disabled:opacity-40"
                    >
                      Add as Image Node
                    </button>
                    <button
                      type="button"
                      onClick={() => handleGeneratedImageAction('header', m.generatedImage!)}
                      disabled={!graphId && !recentGraphId}
                      className="px-3 py-1 rounded-md border border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-300 text-xs hover:bg-fuchsia-400/20 transition-colors disabled:opacity-40"
                    >
                      Insert as Header
                    </button>
                    <button
                      type="button"
                      onClick={() => handleGeneratedImageAction('leftside', m.generatedImage!)}
                      disabled={!graphId && !recentGraphId}
                      className="px-3 py-1 rounded-md border border-amber-400/30 bg-amber-400/10 text-amber-300 text-xs hover:bg-amber-400/20 transition-colors disabled:opacity-40"
                    >
                      Insert as Leftside
                    </button>
                  </div>
                  {!graphId && !recentGraphId && (
                    <div className={`mt-2 text-[11px] ${isLight ? 'text-slate-400' : 'text-white/35'}`}>
                      Select or create a graph to enable graph insertion actions.
                    </div>
                  )}
                </div>
              ) : (
                <div className={`prose prose-sm max-w-none prose-p:my-2 prose-p:leading-relaxed ${isLight ? 'prose-slate' : 'prose-invert'}`}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
                </div>
              )}
              {m.graphId && <CreatedGraphCard graphId={m.graphId} />}
              {m.role === 'user' && (
                <button
                  type="button"
                  onClick={() => setInputText(m.text)}
                  disabled={status === 'streaming'}
                  className="mt-1 float-right text-white/40 hover:text-white transition-colors disabled:opacity-30 text-base leading-none"
                  title="Use this prompt again"
                >
                  +
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Audio file panel */}
      {selectedAudioFile && (
        <div className={`flex-shrink-0 px-4 py-3 border-t ${isLight ? 'border-slate-200 bg-slate-100/90' : 'border-white/10 bg-slate-950/80'}`}>
          <div className={`max-w-[900px] mx-auto rounded-xl border p-4 text-xs ${isLight ? 'border-slate-200 bg-white text-slate-700' : 'border-white/10 bg-white/[0.04] text-white/70'}`}>
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
        <div className={`flex-shrink-0 px-4 py-2 border-t ${isLight ? 'border-slate-200 bg-slate-100/90' : 'border-white/10 bg-slate-950/60'}`}>
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

      {/* Direct graph actions — bypasses the LLM for deterministic operations */}
      <GraphActionBar
        recentGraphId={recentGraphId}
        activeGraphId={graphId}
        activeGraphTitle={activeGraphTitle}
        onGraphCreated={handleGraphCreated}
        onNodeAdded={handleNodeAdded}
        onNodeUpdated={handleNodeUpdated}
        onError={handleActionError}
        onGraphContextChange={onGraphChange}
      />

      {/* Input */}
      <div
        className={`flex-shrink-0 border-t px-3 py-3 ${isLight ? 'border-slate-200 bg-white' : 'border-white/10 bg-slate-950'}`}
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
        {isImageModel && (
          <div className={`max-w-[900px] mx-auto mb-3 rounded-xl border p-3 space-y-3 ${isLight ? 'border-pink-200 bg-pink-50' : 'border-pink-400/15 bg-pink-400/[0.05]'}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-[11px] font-semibold uppercase tracking-wide ${isLight ? 'text-pink-700' : 'text-pink-200/70'}`}>Prompt presets</span>
              {IMAGE_PROMPT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyImagePromptPreset(preset.id)}
                  className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${isLight ? 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100 hover:text-slate-900' : 'border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white'}`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className={`text-xs ${isLight ? 'text-slate-700' : 'text-white/70'}`}>
                <span className={`block mb-1 ${isLight ? 'text-slate-500' : 'text-white/50'}`}>Format</span>
                <select
                  value={imageFormatPreset}
                  onChange={(e) => setImageFormatPreset(e.target.value as (typeof IMAGE_FORMAT_PRESETS)[number]['id'])}
                  className={`w-full rounded-lg border px-3 py-2 ${isLight ? 'border-slate-300 bg-white text-slate-900' : 'border-white/10 bg-white/[0.04] text-white'}`}
                >
                  {IMAGE_FORMAT_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id} className="bg-slate-900 text-white">
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className={`text-xs ${isLight ? 'text-slate-700' : 'text-white/70'}`}>
                <span className={`block mb-1 ${isLight ? 'text-slate-500' : 'text-white/50'}`}>Style</span>
                <select
                  value={imageStylePreset}
                  onChange={(e) => setImageStylePreset(e.target.value as (typeof IMAGE_STYLE_PRESETS)[number]['id'])}
                  className={`w-full rounded-lg border px-3 py-2 ${isLight ? 'border-slate-300 bg-white text-slate-900' : 'border-white/10 bg-white/[0.04] text-white'}`}
                >
                  {IMAGE_STYLE_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id} className="bg-slate-900 text-white">
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className={`text-xs ${isLight ? 'text-slate-700' : 'text-white/70'}`}>
                <span className={`block mb-1 ${isLight ? 'text-slate-500' : 'text-white/50'}`}>Lighting</span>
                <select
                  value={imageLightingPreset}
                  onChange={(e) => setImageLightingPreset(e.target.value as (typeof IMAGE_LIGHTING_PRESETS)[number]['id'])}
                  className={`w-full rounded-lg border px-3 py-2 ${isLight ? 'border-slate-300 bg-white text-slate-900' : 'border-white/10 bg-white/[0.04] text-white'}`}
                >
                  {IMAGE_LIGHTING_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id} className="bg-slate-900 text-white">
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="space-y-2">
              <label className={`flex items-center gap-2 text-xs ${isLight ? 'text-slate-700' : 'text-white/70'}`}>
                <input
                  type="checkbox"
                  checked={includeImageText}
                  onChange={(e) => setIncludeImageText(e.target.checked)}
                  className="h-4 w-4 rounded border-white/30 bg-white/10"
                />
                Text in image
              </label>
              {includeImageText && (
                <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-3">
                  <input
                    value={imageTextValue}
                    onChange={(e) => setImageTextValue(e.target.value)}
                    placeholder='Short phrase, e.g. "SLOW IS SACRED"'
                    className={`w-full rounded-lg border px-3 py-2 text-sm ${isLight ? 'border-slate-300 bg-white text-slate-900 placeholder:text-slate-400' : 'border-white/10 bg-white/[0.04] text-white placeholder-white/30'}`}
                  />
                  <select
                    value={imageTextTreatment}
                    onChange={(e) => setImageTextTreatment(e.target.value as (typeof IMAGE_TEXT_TREATMENTS)[number]['id'])}
                    className={`w-full rounded-lg border px-3 py-2 ${isLight ? 'border-slate-300 bg-white text-slate-900' : 'border-white/10 bg-white/[0.04] text-white'}`}
                  >
                    {IMAGE_TEXT_TREATMENTS.map((treatment) => (
                      <option key={treatment.id} value={treatment.id} className="bg-slate-900 text-white">
                        {treatment.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {includeImageText && (
                <div className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-white/40'}`}>Short phrases render best. The exact text is added in quotes to the prompt preview.</div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowImageAdvanced((prev) => !prev)}
                className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${isLight ? 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100 hover:text-slate-900' : 'border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white'}`}
              >
                {showImageAdvanced ? 'Hide advanced' : 'Show advanced'}
              </button>
              {hasAspectRatioInPrompt && (
                <span className="text-[11px] text-amber-300/80">
                  Prompt contains <span className="font-mono">--ar</span>; prompt aspect ratio overrides the format selector.
                </span>
              )}
            </div>

            {showImageAdvanced && (
              <div className={`space-y-3 rounded-lg border p-3 ${isLight ? 'border-slate-200 bg-white' : 'border-white/10 bg-white/[0.03]'}`}>
                <div>
                  <div className={`text-[11px] mb-2 ${isLight ? 'text-slate-500' : 'text-white/50'}`}>Camera / Render</div>
                  <div className="flex flex-wrap gap-2">
                    {IMAGE_RENDER_TRAITS.map((trait) => {
                      const active = imageRenderTraits.includes(trait);
                      return (
                        <button
                          key={trait}
                          type="button"
                          onClick={() => toggleRenderTrait(trait)}
                          className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${active ? 'border-sky-400/40 bg-sky-400/15 text-sky-200' : isLight ? 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100 hover:text-slate-900' : 'border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white/80'}`}
                        >
                          {trait}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {(inputText.trim() || imageStylePreset !== 'none' || imageLightingPreset !== 'none' || imageRenderTraits.length > 0 || (includeImageText && imageTextValue.trim())) && (
              <div className={`rounded-lg border p-3 ${isLight ? 'border-slate-200 bg-white' : 'border-white/10 bg-black/20'}`}>
                <div className={`text-[11px] uppercase tracking-wide mb-1 ${isLight ? 'text-slate-500' : 'text-white/40'}`}>Prompt preview</div>
                <div className={`text-sm break-words ${isLight ? 'text-slate-800' : 'text-white/85'}`}>{composedImagePrompt || 'Start typing to build a prompt preview.'}</div>
              </div>
            )}
          </div>
        )}
        <div className="flex gap-2 max-w-[900px] mx-auto items-end">
          {/* Audio upload */}
          <button
            type="button"
            onClick={() => audioInputRef.current?.click()}
            disabled={audioProcessing}
            className={`px-3 py-2.5 rounded-xl border transition-colors disabled:opacity-40 flex-shrink-0 ${isLight ? 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900' : 'border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white/80'}`}
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
            className={`px-3 py-2.5 rounded-xl border transition-colors flex-shrink-0 ${isLight ? 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900' : 'border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white/80'}`}
            title="Attach image"
          >🖼</button>
          {/* File attach */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={`px-3 py-2.5 rounded-xl border transition-colors flex-shrink-0 ${isLight ? 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900' : 'border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white/80'}`}
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
              placeholder={pendingImages.length > 0 ? 'Ask about the image…' : isImageModel ? 'Describe the image you want to create…' : 'Type your message or @bot…'}
              rows={1}
              className={`w-full px-3 py-2.5 border rounded-xl text-[0.9rem] font-[inherit] resize-none leading-relaxed max-h-[200px] overflow-y-auto focus:outline-none focus:border-sky-400/50 focus:ring-[3px] focus:ring-sky-400/15 ${isLight ? 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-400' : 'bg-white/[0.04] border-white/10 text-white placeholder-white/30'}`}
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
