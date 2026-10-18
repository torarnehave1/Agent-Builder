import { useEffect, useMemo, useState } from 'react'
import { RegisteredTypeNode, loadEngine } from '../lib/vegvisrNode'
import { kgJsonHeaders } from '../lib/kgAuth'

// The "Nodetyper" preview card (PLAN-nodetyper-chat.md, 2026-10-18). Shown for the results of
// create_node_type and change_node_type_look: the type's name, fields, a preview of its DRAFT look
// with sample values (engine v4 previewImpl — same sandbox, nothing fetched), and the founder's own
// "Ta i bruk" button. That button is the ONLY way a look is put to use (V1 A): it calls the KG
// worker as the signed-in user, never through the agent.

export interface NodeTypeField { key: string; label: string; kind: string }
export interface NodeTypeCardData {
  type: string
  title: string
  description?: string
  fields: NodeTypeField[]
  world: string
  look: { version: number; status: string; impl: string | null } | null
  sample?: Record<string, unknown> | null
  sampleLabel?: string | null
}

const KG_API = 'https://knowledge.vegvisr.org'

const KIND_LABEL: Record<string, string> = {
  text: 'tekst', longtext: 'lang tekst', number: 'tall', date: 'dato', link: 'lenke', image: 'bilde',
}

/** Example values for fields the agent gave no sample for, so the preview is never empty. */
function sampleFor(fields: NodeTypeField[], given: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    if (given && given[f.key] !== undefined) { out[f.key] = given[f.key]; continue }
    out[f.key] = f.kind === 'number' ? 42
      : f.kind === 'date' ? new Date().toISOString().slice(0, 10)
      : f.kind === 'link' ? 'https://www.vegr.ai'
      : f.kind === 'image' ? ''
      : f.kind === 'longtext' ? `Eksempeltekst for ${f.label.toLowerCase()}.`
      : f.label
  }
  return out
}

export function NodeTypeCard({ card, onSend }: { card: NodeTypeCardData; onSend?: (text: string) => void }) {
  const [engineReady, setEngineReady] = useState(false)
  const [state, setState] = useState<'idle' | 'saving' | 'used' | 'error'>(card.look?.status === 'approved' ? 'used' : 'idle')
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    loadEngine().then(() => { if (live) setEngineReady(true) }).catch(() => {})
    return () => { live = false }
  }, [])

  const previewNode = useMemo(() => ({
    id: `preview-${card.type}`,
    label: card.sampleLabel || card.title,
    type: card.type,
    info: card.description || '',
    metadata: sampleFor(card.fields, card.sample),
  }), [card])

  const putToUse = async () => {
    if (!card.look) return
    setState('saving'); setError('')
    try {
      const res = await fetch(`${KG_API}/node-types/world/use`, {
        method: 'POST',
        headers: kgJsonHeaders(),
        body: JSON.stringify({ world: card.world, type: card.type, version: card.look.version, verifyMethod: 'Previewed and put to use by the founder in Agent-Builder (Nodetyper card)' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        setState('error')
        setError(data.code === 'VERSION_CONFLICT'
          ? 'Utseendet er endret etter dette kortet. Bruk det nyeste kortet.'
          : (data.error || `Kunne ikke ta i bruk (HTTP ${res.status}).`))
        return
      }
      setState('used')
    } catch (e) {
      setState('error')
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const badge = state === 'used'
    ? { text: 'I bruk', cls: 'bg-emerald-600/20 text-emerald-300 border-emerald-500/30' }
    : card.look
      ? { text: 'Utkast', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' }
      : { text: 'Uten utseende', cls: 'bg-white/5 app-text-soft app-border' }

  return (
    <div className="mx-3 my-3 border app-border rounded-xl app-surface p-4 flex flex-col gap-3" data-node-type-card={card.type}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold app-text">Nodetype: {card.title}</span>
        <span className={`ml-auto text-[11px] px-2 py-0.5 rounded border ${badge.cls}`} data-status={state === 'used' ? 'in-use' : card.look ? 'draft' : 'no-look'}>{badge.text}</span>
      </div>
      {card.description && <div className="text-xs app-text-soft">{card.description}</div>}

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <div>
          <div className="text-[11px] app-text-soft mb-1">Felter</div>
          {card.fields.length === 0
            ? <div className="text-xs app-text-soft">Ingen felter ennå.</div>
            : (
              <ul className="text-xs app-text flex flex-col gap-0.5">
                {card.fields.map((f) => <li key={f.key}>{f.label} <span className="app-text-soft">· {KIND_LABEL[f.kind] || f.kind}</span></li>)}
              </ul>
            )}
        </div>
        <div>
          <div className="text-[11px] app-text-soft mb-1">Forhåndsvisning med eksempeldata</div>
          {card.look?.impl && engineReady
            ? <div className="rounded-lg overflow-hidden bg-white/0" data-preview><RegisteredTypeNode node={previewNode} theme="dark" world={card.world} previewImpl={card.look.impl} /></div>
            : <div className="text-xs app-text-soft">{card.look?.impl ? 'Laster…' : 'Typen har ikke noe utseende ennå.'}</div>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        {onSend && (
          <>
            <button type="button" onClick={() => onSend(`Jeg vil endre utseendet på «${card.title}».`)} className="px-3 py-1.5 text-xs rounded border app-border app-text hover:bg-white/5">Endre utseendet</button>
            <button type="button" onClick={() => onSend(`Jeg vil endre feltene i «${card.title}».`)} className="px-3 py-1.5 text-xs rounded border app-border app-text hover:bg-white/5">Endre feltene</button>
          </>
        )}
        {card.look && state !== 'used' && (
          <button
            type="button"
            onClick={putToUse}
            disabled={state === 'saving'}
            className="ml-auto px-3 py-1.5 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-500 font-medium disabled:opacity-60"
            data-action="use"
          >
            {state === 'saving' ? 'Tar i bruk…' : `Ta i bruk i ${card.world}`}
          </button>
        )}
      </div>
      {state === 'used' && <div className="text-xs text-emerald-300">I bruk i {card.world}. Typen finnes nå i typevelgeren i Knowledge Editor.</div>}
      {state === 'error' && <div className="text-xs text-red-300">{error}</div>}
      {state !== 'used' && card.look && <div className="text-[11px] app-text-soft">Bare for {card.world}. Endrer du utseendet senere, må det tas i bruk på nytt.</div>}
    </div>
  )
}
