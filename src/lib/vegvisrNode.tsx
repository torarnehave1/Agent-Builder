import { createElement, useEffect, useRef, useState } from 'react'

// The rendering engine for registered node types (phase 1, 2026-10-18). A node whose type has an
// APPROVED renderer in graph_system_registry is shown by the <vegvisr-node> element, which runs that
// renderer in an isolated iframe (no cookies, storage, parent access or network). The element is a
// Component Registry component served from api.vegvisr.org — loaded once, on first need.
const SCRIPT_URL = 'https://api.vegvisr.org/components/vegvisr-node.js'

type VegvisrNodeCtor = { approvedTypes: () => Promise<Set<string>> }
let loading: Promise<Set<string>> | null = null

/** Types with an approved renderer. An empty set if the engine cannot load — callers fall back. */
export function loadApprovedTypes(): Promise<Set<string>> {
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      if (customElements.get('vegvisr-node')) return resolve()
      const s = document.createElement('script')
      s.src = SCRIPT_URL
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => reject(new Error('vegvisr-node.js failed to load'))
      document.head.appendChild(s)
    })
      .then(() => customElements.whenDefined('vegvisr-node'))
      .then(() => (window as unknown as { VegvisrNode: VegvisrNodeCtor }).VegvisrNode.approvedTypes())
      .catch(() => new Set<string>())
  }
  return loading
}

export function useApprovedTypes(): Set<string> {
  const [types, setTypes] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    let live = true
    loadApprovedTypes().then((t) => { if (live) setTypes(t) })
    return () => { live = false }
  }, [])
  return types
}

export interface RenderableNode {
  id: string
  label: string
  type: string
  info?: string
  color?: string
  metadata?: Record<string, unknown>
}

/** One node drawn by its registered renderer. `node` is set as a property, not an attribute. */
export function RegisteredTypeNode({ node, theme = 'dark' }: { node: RenderableNode; theme?: 'light' | 'dark' }) {
  const ref = useRef<HTMLElement & { node?: unknown; theme?: string }>(null)
  useEffect(() => {
    if (!ref.current) return
    ref.current.theme = theme
    ref.current.node = node
  }, [node, theme])
  return createElement('vegvisr-node', { ref, style: { display: 'block' } })
}
