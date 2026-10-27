// A World's brand as a graph (decided 2026-10-27, «1A 2A»).
//
// The brand graph is the single source of a World's look: name, slogan, logos, colours, fonts and
// language. It lives in the World's OWN graph storage (1A), tagged #BRAND-<domain>, with one node of
// the registered data type `world-brand` (metadata = what programs read) and a fulltext node about
// how the brand is used (for people). Its id is derived from the domain, so it is found without a
// lookup table.
//
// The brand proxy never reads the graph (2A): publish_world_brand writes a snapshot of it as
// brand:<domain> into the World's BRAND_CONFIG, which every host of the World falls back to when it
// has no brand:<host> of its own.
//
//   save_world_brand     create the graph or merge new values into it
//   get_world_brand      read it (Agent-Builder reads it before it builds a page for the World)
//   publish_world_brand  write it to the brand proxy (Superadmin, via set_world_brand)

import { mayBuildIn } from './world-course.js'

export const BRAND_NODE_ID = 'brand'
export const BRAND_ABOUT_NODE_ID = 'om-merkevaren'
export const COLOR_KEYS = ['accent', 'accentDark', 'ink', 'muted', 'surface', 'card']

// A UUID v4-shaped id derived from the domain (the KG worker requires UUID v4 for new graphs).
export async function brandGraphId(domain) {
  const d = String(domain || '').trim().toLowerCase()
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`world-brand:${d}`))).slice(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const h = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const httpsUrl = (v) => (typeof v === 'string' && /^https:\/\/\S+$/.test(v.trim()) ? v.trim() : undefined)
const hex = (v) => (typeof v === 'string' && /^#[0-9a-f]{3}([0-9a-f]{3})?([0-9a-f]{2})?$/i.test(v.trim()) ? v.trim().toLowerCase() : undefined)
const fontFamily = (v) => (typeof v === 'string' && v.trim() && !/[;{}<>]/.test(v) ? v.trim() : undefined)
const prune = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !(v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)))

// Validate the tool input and merge it over what the graph already holds. Returns { brand } or
// { error } naming the first bad value — never stores a value it could not use.
export function mergeBrand(prior, input) {
  const p = prior || {}
  const errors = []
  const pick = (key, value, check, label) => {
    if (value === undefined || value === null || value === '') return undefined
    const ok = check(value)
    if (ok === undefined) errors.push(`${label} is not valid: ${JSON.stringify(value).slice(0, 80)}`)
    return ok
  }
  const colorsIn = input.colors && typeof input.colors === 'object' ? input.colors : {}
  for (const k of Object.keys(colorsIn)) if (!COLOR_KEYS.includes(k)) errors.push(`unknown colour "${k}" — use ${COLOR_KEYS.join(', ')}`)
  const fontsIn = input.fonts && typeof input.fonts === 'object' ? input.fonts : {}
  const cssUrl = pick('cssUrl', fontsIn.css_url ?? fontsIn.cssUrl, (v) => (httpsUrl(v) && /^https:\/\/fonts\.googleapis\.com\//.test(v.trim()) ? v.trim() : undefined), 'fonts.css_url (a https://fonts.googleapis.com/ stylesheet)')
  const next = {
    name: pick('name', input.name, str, 'name') ?? p.name,
    slogan: pick('slogan', input.slogan, str, 'slogan') ?? p.slogan,
    logoUrl: pick('logoUrl', input.logo_url, httpsUrl, 'logo_url') ?? p.logoUrl,
    logoSquareUrl: pick('logoSquareUrl', input.logo_square_url, httpsUrl, 'logo_square_url') ?? p.logoSquareUrl,
    faviconUrl: pick('faviconUrl', input.favicon_url, httpsUrl, 'favicon_url') ?? p.faviconUrl,
    lang: pick('lang', input.lang, (v) => (v === 'no' || v === 'en' ? v : undefined), 'lang (no or en)') ?? p.lang,
    scheme: pick('scheme', input.scheme, (v) => (v === 'light' || v === 'dark' ? v : undefined), 'scheme (light or dark)') ?? p.scheme,
    emailFromName: pick('emailFromName', input.email_from_name, str, 'email_from_name') ?? p.emailFromName,
    colors: prune(Object.fromEntries(COLOR_KEYS.map((k) => [k, pick(k, colorsIn[k], hex, `colors.${k} (hex, e.g. #a3386b)`) ?? (p.colors || {})[k]]))),
    fonts: prune({
      display: pick('display', fontsIn.display, fontFamily, 'fonts.display') ?? (p.fonts || {}).display,
      body: pick('body', fontsIn.body, fontFamily, 'fonts.body') ?? (p.fonts || {}).body,
      cssUrl: cssUrl ?? (p.fonts || {}).cssUrl,
    }),
  }
  if (errors.length) return { error: errors.join('; ') }
  const brand = prune(next)
  if (!brand.name) return { error: 'name is required the first time (the brand name, e.g. "Stine Oksvold Design").' }
  return { brand }
}

// What publish writes: the set_world_brand input for brand:<domain>.
export function brandToSetWorldBrandInput(domain, b) {
  const c = b.colors || {}
  const f = b.fonts || {}
  return prune({
    domain,
    host: domain,
    name: b.name,
    slogan: b.slogan,
    title: b.name,
    logo_url: b.logoUrl,
    favicon_url: b.faviconUrl || b.logoSquareUrl,
    editor: prune({
      fontsCssUrl: f.cssUrl,
      fontSans: f.body,
      fontDisplay: f.display,
      accent: c.accent,
      ink: c.ink,
      surface: c.surface,
      scheme: b.scheme,
      lang: b.lang,
    }),
  })
}

function aboutMarkdown(domain, b) {
  return [
    `## Merkevaren til ${b.name}`,
    '',
    `Denne grafen er den ene kilden til hvordan ${domain} ser ut: navn, logo, farger, fonter og språk.`,
    'Agent-Builder leser den før den bygger en side, og publiserer den til alle adressene i World-en.',
    '',
    '## Slik endres den',
    '',
    '- Be Agent-Builder: «oppdater merkevaren til ' + domain + '» med de nye verdiene (verktøyet `save_world_brand`).',
    '- Deretter «publiser merkevaren» (`publish_world_brand`), så får alle adressene den nye looken innen fem minutter.',
    '- Ikke rediger tallene i noden «Merkevare» for hånd: verktøyet sjekker at farger, fonter og adresser er gyldige.',
  ].join('\n')
}

function kgFetch(env, email, path, init = {}) {
  const headers = { ...(init.headers || {}), 'x-acting-user-email': String(email).toLowerCase() }
  return env.KG_WORKER.fetch(`https://knowledge-graph-worker${path}`, { ...init, headers })
}

async function whoFrom(env, input) {
  if (!input.userId) return { error: 'No user context available — sign in and retry.' }
  const row = await env.DB.prepare('SELECT email, Role FROM config WHERE user_id = ? OR LOWER(email) = LOWER(?) LIMIT 1').bind(input.userId, input.userId).first().catch(() => null)
  if (!row || !row.email) return { error: 'Could not resolve the signed-in user.' }
  return { who: { email: String(row.email).toLowerCase(), role: row.Role, userId: input.userId } }
}

async function readBrandGraph(env, founderEmail, graphId) {
  const res = await kgFetch(env, founderEmail, `/getknowgraph?id=${encodeURIComponent(graphId)}`)
  if (res.status === 404) return { missing: true }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    // The KG worker answers a missing id with 404 or with an error body; treat "not found" as missing.
    if (/not found|does not exist/i.test(String(j.error || ''))) return { missing: true }
    return { error: `Could not read the brand graph (${res.status}): ${j.error || res.statusText}` }
  }
  const g = await res.json().catch(() => null)
  if (!g || !Array.isArray(g.nodes)) return { missing: true }
  return { graph: g, world: res.headers.get('X-Graph-World') || null }
}

const brandNodeOf = (g) => (g.nodes || []).find((n) => n.type === 'world-brand') || null
const links = (graphId) => ({ editorUrl: `https://editor.vegvisr.org/?graphId=${graphId}` })

export async function executeWorldBrandTool(toolName, input, env, { setWorldBrand } = {}) {
  const w = await whoFrom(env, input)
  if (w.error) return { success: false, error: w.error }
  const domain = String(input.domain || input.world || '').trim().toLowerCase()
  const gate = await mayBuildIn(env, w.who, domain)
  if (!gate.ok) return { success: false, error: gate.error.replace('build its courses', 'change its brand') }
  const graphId = await brandGraphId(gate.domain)
  const read = await readBrandGraph(env, gate.founderEmail, graphId)
  if (read.error) return { success: false, error: read.error }

  if (toolName === 'get_world_brand') {
    if (read.missing) return { success: true, domain: gate.domain, exists: false, graphId, message: `${gate.domain} has no brand graph yet. Create it with save_world_brand (name, logo, colours, fonts).` }
    const node = brandNodeOf(read.graph)
    const brand = (node && node.metadata) || {}
    const c = brand.colors || {}
    return {
      success: true, domain: gate.domain, exists: true, graphId, version: read.graph.metadata?.version ?? null, ...links(graphId),
      brand,
      message: `Brand of ${gate.domain}: ${brand.name || '(no name)'} — accent ${c.accent || 'not set'}, fonts ${(brand.fonts || {}).display || '?'} / ${(brand.fonts || {}).body || '?'}. Use these exact values when building pages for this World.`,
    }
  }

  if (toolName === 'save_world_brand') {
    const priorNode = read.missing ? null : brandNodeOf(read.graph)
    const merged = mergeBrand(priorNode && priorNode.metadata, input)
    if (merged.error) return { success: false, error: merged.error }
    const b = merged.brand
    const g = read.missing
      ? {
          metadata: { title: `Merkevare – ${b.name}`, description: `Merkevaren til ${gate.domain}: farger, fonter, logo og språk. Kilde for /branding.json på alle adressene i World-en.`, metaArea: `#BRAND-${gate.domain}`, category: 'Brand', version: 0 },
          nodes: [],
          edges: [],
        }
      : read.graph
    const nodes = (g.nodes || []).filter((n) => n.id !== BRAND_NODE_ID && n.type !== 'world-brand')
    const brandNode = { ...(priorNode || {}), id: priorNode ? priorNode.id : BRAND_NODE_ID, label: 'Merkevare', type: 'world-brand', info: (priorNode && priorNode.info) || '', metadata: b, visible: true, color: b.colors?.accent || '#4f6d7a', position: (priorNode && priorNode.position) || { x: 0, y: 0 }, bibl: (priorNode && priorNode.bibl) || [] }
    if (!nodes.some((n) => n.id === BRAND_ABOUT_NODE_ID)) {
      nodes.push({ id: BRAND_ABOUT_NODE_ID, label: 'Om merkevaren', type: 'fulltext', info: aboutMarkdown(gate.domain, b), visible: true, color: '#0f2a43', position: { x: -340, y: 0 }, bibl: [] })
    }
    nodes.unshift(brandNode)
    const graphData = { ...g, nodes, edges: g.edges || [] }
    const body = read.missing ? { id: graphId, graphData, override: false, world: gate.domain } : { id: graphId, graphData, override: false }
    const res = await kgFetch(env, gate.founderEmail, '/saveGraphWithHistory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) return { success: false, error: `Could not save the brand graph (${res.status}): ${j.error || j.message || res.statusText}` }
    const back = await readBrandGraph(env, gate.founderEmail, graphId)
    const stored = back.graph ? (brandNodeOf(back.graph) || {}).metadata : null
    const same = stored && JSON.stringify(stored) === JSON.stringify(b)
    return {
      success: Boolean(same), domain: gate.domain, graphId, created: Boolean(read.missing), version: j.newVersion ?? null, world: back.world, ...links(graphId),
      brand: stored || b,
      message: same
        ? `${read.missing ? 'Created' : 'Updated'} the brand graph of ${gate.domain} (version ${j.newVersion}) and read it back. Run publish_world_brand to put it on the World's hosts.`
        : 'Saved, but reading the brand graph back did not match what was written.',
    }
  }

  if (toolName === 'publish_world_brand') {
    if (read.missing) return { success: false, error: `${gate.domain} has no brand graph yet — run save_world_brand first.` }
    const b = (brandNodeOf(read.graph) || {}).metadata
    if (!b || !b.name) return { success: false, error: 'The brand graph has no world-brand node with a name. Run save_world_brand first.' }
    if (typeof setWorldBrand !== 'function') return { success: false, error: 'publish_world_brand is not wired to set_world_brand.' }
    const r = await setWorldBrand({ ...brandToSetWorldBrandInput(gate.domain, b), userId: input.userId }, env)
    if (!r || !r.success) return { success: false, error: `Publishing the brand failed: ${(r && r.error) || 'unknown error'}` }
    return {
      success: true, domain: gate.domain, graphId, key: r.key, brand_proxy: r.brand_proxy,
      message: `Published the brand of ${gate.domain} from its brand graph as ${r.key}. Every host of the World without a brand of its own shows it within about 5 minutes (/branding.json is cached).`,
    }
  }

  return { success: false, error: `unknown brand tool ${toolName}` }
}

export const WORLD_BRAND_TOOLS = ['save_world_brand', 'get_world_brand', 'publish_world_brand']
