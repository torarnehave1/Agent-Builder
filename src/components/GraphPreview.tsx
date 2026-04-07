import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const KG_API = 'https://knowledge.vegvisr.org'

interface KgNode {
  id: string
  label: string
  type: string
  info?: string
  path?: string
  color?: string
  bibl?: string[]
}

interface Props {
  graphId: string
  title: string
  onClose: () => void
}

// Extract YouTube video ID from any YouTube URL format
function youtubeId(url: string): string | null {
  if (!url) return null
  const m =
    url.match(/youtu\.be\/([^?&/]+)/) ||
    url.match(/youtube\.com\/watch\?.*v=([^&]+)/) ||
    url.match(/youtube\.com\/embed\/([^?&/]+)/)
  return m ? m[1] : null
}

function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ref.current || !code.trim()) return
    import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' })
      const id = `mermaid-${Math.random().toString(36).slice(2)}`
      mermaid.render(id, code.trim())
        .then(({ svg }) => { if (ref.current) ref.current.innerHTML = svg })
        .catch(e => setError(String(e)))
    })
  }, [code])

  if (error) return <pre className="text-xs text-red-400 bg-red-900/20 p-3 rounded overflow-auto">{code}</pre>
  return <div ref={ref} className="my-2 flex justify-center overflow-auto" />
}

export default function GraphPreview({ graphId, title, onClose }: Props) {
  const [nodes, setNodes] = useState<KgNode[]>([])
  const [graphTitle, setGraphTitle] = useState(title)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`${KG_API}/getknowgraph?id=${encodeURIComponent(graphId)}`)
      .then(r => r.json())
      .then(data => {
        setGraphTitle(data.metadata?.title || title)
        setNodes(data.nodes || [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [graphId, title])

  const renderNodes = nodes

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative z-10 w-full max-w-2xl bg-slate-950 border-l border-white/10 flex flex-col h-full shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 flex-shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-white">{graphTitle}</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">{renderNodes.length} nodes · read-only preview</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors text-lg leading-none px-2"
          >
            ✕
          </button>
        </div>

        {/* Nodes */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-8">
          {loading && <p className="text-sm text-gray-500 text-center py-12">Loading graph...</p>}
          {!loading && renderNodes.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-12">No renderable nodes</p>
          )}
          {renderNodes.map(node => (
            <NodeBlock key={node.id} node={node} />
          ))}
        </div>
      </div>
    </div>
  )
}

// Process [FANCY] blocks: [FANCY | css_styles]content[END FANCY]
function processFancyBlocks(content: string): string {
  if (!content) return content
  const fancyRegex = /\[FANCY\s*\|\s*([^\]]*)\]\n?([\s\S]*?)\n?\[END FANCY\]/g
  return content.replace(fancyRegex, (_match: string, styles: string, innerContent: string) => {
    const cleanStyles = styles.trim()
    const htmlContent = innerContent.trim().replace(/\n/g, '<br/>')
    return `<div style="${cleanStyles}" class="fancy-block">${htmlContent}</div>`
  })
}

function NodeBlock({ node }: { node: KgNode }) {
  const type = node.type || 'unknown'
  const label = node.label?.startsWith('#') ? node.label.slice(1).trim() : node.label

  // ── Fulltext / notes / worknote — rendered markdown ──────────────────────
  if (['fulltext', 'info', 'notes', 'worknote', 'text'].includes(type)) {
    const processedInfo = processFancyBlocks(node.info || '')
    return (
      <div className="border-b border-white/5 pb-6 last:border-0 last:pb-0">
        {label && <h3 className="text-base font-semibold text-white mb-3">{label}</h3>}
        {node.info ? (
          <div className="
            prose prose-invert prose-sm max-w-none
            prose-headings:text-white prose-headings:font-semibold
            prose-h1:text-xl prose-h2:text-lg prose-h3:text-base
            prose-p:text-gray-300 prose-p:leading-relaxed
            prose-a:text-sky-400 prose-a:no-underline hover:prose-a:underline
            prose-strong:text-white prose-strong:font-semibold
            prose-code:text-amber-300 prose-code:bg-white/5 prose-code:px-1 prose-code:rounded prose-code:text-xs
            prose-pre:bg-slate-900 prose-pre:border prose-pre:border-white/10
            prose-blockquote:border-l-sky-500 prose-blockquote:text-gray-400
            prose-img:rounded-lg prose-img:border prose-img:border-white/10
            prose-ul:text-gray-300 prose-ol:text-gray-300
            prose-li:marker:text-gray-500
            prose-hr:border-white/10
            prose-table:text-gray-300 prose-th:text-white prose-th:border-white/20 prose-td:border-white/10
          ">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{processedInfo}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-xs text-gray-600 italic">No content</p>
        )}
      </div>
    )
  }

  // ── YouTube video ─────────────────────────────────────────────────────────
  if (type === 'youtube-video') {
    const url = node.path || node.bibl?.[0] || ''
    const vid = youtubeId(url)
    return (
      <div className="border-b border-white/5 pb-6 last:border-0 last:pb-0">
        {label && <h3 className="text-base font-semibold text-white mb-3">{label}</h3>}
        {node.info && <p className="text-sm text-gray-400 mb-3">{node.info}</p>}
        {vid ? (
          <div className="relative w-full aspect-video">
            <iframe
              className="absolute inset-0 w-full h-full rounded-lg border border-white/10"
              src={`https://www.youtube.com/embed/${vid}`}
              title={label || 'YouTube video'}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : (
          <a href={url} target="_blank" rel="noopener noreferrer" className="text-sky-400 text-sm hover:underline">{url}</a>
        )}
      </div>
    )
  }

  // ── Mermaid diagram ───────────────────────────────────────────────────────
  if (type === 'mermaid-diagram') {
    return (
      <div className="border-b border-white/5 pb-6 last:border-0 last:pb-0">
        {label && <h3 className="text-base font-semibold text-white mb-3">{label}</h3>}
        {node.info ? (
          <MermaidBlock code={node.info} />
        ) : node.path ? (
          <img src={node.path} alt={label} className="max-w-full rounded-lg" />
        ) : null}
      </div>
    )
  }

  // ── Image ─────────────────────────────────────────────────────────────────
  if (['markdown-image', 'image'].includes(type) && node.path) {
    return (
      <div className="border-b border-white/5 pb-6 last:border-0 last:pb-0">
        <img src={node.path} alt={label} className="max-w-full rounded-lg border border-white/10" />
        {node.info && <p className="text-xs text-gray-500 mt-2">{node.info}</p>}
      </div>
    )
  }

  // ── Link ──────────────────────────────────────────────────────────────────
  if (type === 'link' && node.path) {
    return (
      <div className="border-b border-white/5 pb-4 last:border-0 last:pb-0">
        <a href={node.path} target="_blank" rel="noopener noreferrer"
          className="text-sky-400 text-sm hover:underline">
          {label || node.path}
        </a>
        {node.info && <p className="text-xs text-gray-500 mt-1">{node.info}</p>}
      </div>
    )
  }

  // ── Charts / other typed nodes — label + badge only ───────────────────────
  if (['linechart', 'barchart', 'piechart', 'chart', 'video', 'audio', 'cloudflare-video'].includes(type)) {
    return (
      <div className="flex items-center gap-2 py-2 px-3 rounded bg-white/5 border border-white/5">
        <span className="text-xs text-gray-300">{label}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-gray-500">{type}</span>
      </div>
    )
  }

  // ── Fallback ──────────────────────────────────────────────────────────────
  return (
    <div className="flex items-center gap-2 py-1.5 px-3 rounded bg-white/5 border border-white/5">
      <span className="text-xs text-gray-400">{label}</span>
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-gray-600">{type}</span>
    </div>
  )
}
