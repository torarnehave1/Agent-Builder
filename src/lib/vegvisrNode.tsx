import { createElement, useEffect, useRef, useState } from 'react'

// The rendering engine for registered node types (phase 1, 2026-10-18). A node whose type has an
// APPROVED renderer in graph_system_registry is shown by the <vegvisr-node> element, which runs that
// renderer in an isolated iframe (no cookies, storage, parent access or network). The element is a
// Component Registry component served from api.vegvisr.org — loaded once, on first need.
const SCRIPT_URL = 'https://api.vegvisr.org/components/vegvisr-node.js'

type VegvisrNodeCtor = { approvedTypes: (api?: string, world?: string) => Promise<Set<string>> }
let loading: Promise<void> | null = null
const approved = new Map<string, Promise<Set<string>>>() // world ('' = platform) -> types

function loadEngine(): Promise<void> {
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
      .then(() => undefined)
  }
  return loading
}

/**
 * Types with an approved renderer — the platform's, plus `world`'s own types when the graph lives
 * in a World (phase 2: the World comes from getknowgraph's X-Graph-World header). An empty set if
 * the engine cannot load — callers fall back.
 */
export function loadApprovedTypes(world: string | null = null): Promise<Set<string>> {
  const key = world || ''
  if (!approved.has(key)) {
    approved.set(key, loadEngine()
      .then(() => (window as unknown as { VegvisrNode: VegvisrNodeCtor }).VegvisrNode.approvedTypes(undefined, key))
      .catch(() => new Set<string>()))
  }
  return approved.get(key)!
}

export function useApprovedTypes(world: string | null = null): Set<string> {
  const [types, setTypes] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    let live = true
    loadApprovedTypes(world).then((t) => { if (live) setTypes(t) })
    return () => { live = false }
  }, [world])
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

/**
 * One node drawn by its registered renderer. `node` is set as a property, not an attribute; `world`
 * (the graph's World, or null) is set before it, so the engine asks for that World's renderer.
 */
export function RegisteredTypeNode({ node, theme = 'dark', world = null }: { node: RenderableNode; theme?: 'light' | 'dark'; world?: string | null }) {
  const ref = useRef<HTMLElement & { node?: unknown; theme?: string; world?: string }>(null)
  useEffect(() => {
    if (!ref.current) return
    ref.current.world = world || ''
    ref.current.theme = theme
    ref.current.node = node
  }, [node, theme, world])
  return createElement('vegvisr-node', { ref, style: { display: 'block' } })
}
