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
}

interface Props {
  graphId: string
  title: string
  onClose: () => void
}

function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ref.current || !code.trim()) return
    import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' })
      const id = `mermaid-${Math.random().toString(36).slice(2)}`
      mermaid.render(id, code.trim()).then(({ svg }) => {
        if (ref.current) ref.current.innerHTML = svg
      }).catch(e => setError(String(e)))
    })
  }, [code])

  if (error) return <pre className="text-xs text-red-400 bg-red-900/20 p-3 rounded">{code}</pre>
  return <div ref={ref} className="my-2 flex justify-center" />
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

  // Nodes we render — skip css-node, html-node (too large), system types
  const SKIP_TYPES = new Set(['css-node', 'html-node', 'system-rule', 'system-routing', 'system-learning'])
  const renderNodes = nodes.filter(n => !SKIP_TYPES.has(n.type))

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Panel */}
      <div
        className="relative z-10 w-full max-w-2xl bg-slate-950 border-l border-white/10 flex flex-col h-full shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 flex-shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-white">{graphTitle}</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">{renderNodes.length} nodes</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors text-lg leading-none px-2"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {loading && (
            <p className="text-sm text-gray-500 text-center py-12">Loading graph...</p>
          )}

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

function NodeBlock({ node }: { node: KgNode }) {
  const type = node.type || 'unknown'

  // fulltext / info / notes / worknote — render markdown
  if (['fulltext', 'info', 'notes', 'worknote', 'text'].includes(type)) {
    const label = node.label?.startsWith('#') ? node.label.slice(1).trim() : node.label
    return (
      <div>
        {label && (
          <h3 className="text-sm font-semibold text-white mb-2">{label}</h3>
        )}
        {node.info ? (
          <div className="prose prose-invert prose-sm max-w-none text-gray-300">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{node.info}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-xs text-gray-600 italic">No content</p>
        )}
      </div>
    )
  }

  // mermaid-diagram
  if (type === 'mermaid-diagram') {
    const label = node.label?.startsWith('#') ? node.label.slice(1).trim() : node.label
    return (
      <div>
        {label && <h3 className="text-sm font-semibold text-white mb-2">{label}</h3>}
        {node.info ? (
          <MermaidBlock code={node.info} />
        ) : node.path ? (
          <img src={node.path} alt={label} className="max-w-full rounded" />
        ) : null}
      </div>
    )
  }

  // markdown-image / image
  if (['markdown-image', 'image'].includes(type) && node.path) {
    return (
      <div>
        <img
          src={node.path}
          alt={node.label}
          className="max-w-full rounded-lg border border-white/10"
        />
        {node.info && (
          <p className="text-xs text-gray-500 mt-1">{node.info}</p>
        )}
      </div>
    )
  }

  // linechart, chart types — show label + type badge, no render
  if (['linechart', 'barchart', 'piechart', 'chart'].includes(type)) {
    return (
      <div className="flex items-center gap-2 py-2 px-3 rounded bg-white/5 border border-white/5">
        <span className="text-xs text-gray-300">{node.label}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-gray-500">{type}</span>
      </div>
    )
  }

  // link / video / audio
  if (['link', 'video', 'audio', 'youtube-video', 'cloudflare-video'].includes(type) && node.path) {
    return (
      <div className="flex items-center gap-2 py-2">
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-gray-500">{type}</span>
        <a href={node.path} target="_blank" rel="noopener noreferrer" className="text-xs text-sky-400 hover:underline truncate">
          {node.label || node.path}
        </a>
      </div>
    )
  }

  // Fallback — just show label + type
  return (
    <div className="flex items-center gap-2 py-1.5 px-3 rounded bg-white/5 border border-white/5">
      <span className="text-xs text-gray-400">{node.label}</span>
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-gray-600">{type}</span>
    </div>
  )
}
