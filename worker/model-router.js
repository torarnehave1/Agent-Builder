/**
 * Automatic model choice per user message (decided 2026-10-28).
 *
 * Why: Haiku 4.5 was the default for everything. On 2026-10-28 it took a plain "publish this
 * node" request, obeyed a false functional-gate report, broke the CSS twice and reported a dead
 * theme button as fixed. Simple requests do not need a strong model; code changes do.
 *
 * How: one small classifier call (Haiku 4.5, no thinking, ~100 output tokens) labels the request
 * `simple` or `complex` before the agent loop starts. The picker value is the CEILING:
 *   - 'auto'              → simple: Haiku 5.5, complex: Sonnet 5.5
 *   - a Claude model      → simple: Haiku 5.5 (when the ceiling is stronger), complex: the ceiling
 *   - a Haiku ceiling     → always that Haiku (never upgrade past what the user chose)
 *   - non-Claude models   → not routed (OpenAI/Workers AI/Ollama paths are separate)
 * A failed classifier call routes to the complex tier: a wrong "complex" costs a little money,
 * a wrong "simple" costs a broken page.
 */
import { MODELS, AUTO_MODEL } from './models.js'

export const ROUTER_SIMPLE = MODELS.HAIKU_55
export const ROUTER_COMPLEX_DEFAULT = MODELS.SONNET_55
const CLASSIFIER_MODEL = MODELS.HAIKU

const CLASSIFIER_PROMPT = `You route requests for an agent that edits knowledge graphs, HTML pages and websites through tools.
Label the user's request:
- "simple": run one named tool with the parameters given, publish/deploy something as-is, read/show/list/search/look up, answer a question, send a message, a greeting or acknowledgement, a one-word/one-value change the user spelled out.
- "complex": write or change code/HTML/CSS/JavaScript, build or redesign a page or app, debug or fix something that does not work, a task with several dependent steps, a design decision, anything where a careless mistake damages existing content.
When unsure, answer "complex".
Reply with ONLY JSON: {"tier":"simple"|"complex","reason":"<max 8 words>"}`

/** Strip the UI-context suffix /chat appends, so it does not colour the label. */
function cleanRequest(text) {
  return String(text || '').replace(/\n*\[Current UI context:[^\]]*\]\s*$/, '').trim().slice(0, 4000)
}

export function isRoutable(selected) {
  const s = String(selected || '')
  return s === AUTO_MODEL || s.startsWith('claude-')
}

/** Pure: which model a tier maps to under a given picker selection. */
export function modelForTier(tier, selected) {
  const ceiling = selected === AUTO_MODEL || !selected ? ROUTER_COMPLEX_DEFAULT : selected
  if (/haiku/.test(ceiling)) return ceiling
  return tier === 'simple' ? ROUTER_SIMPLE : ceiling
}

/** Pure: parse the classifier's text; null when it is not a usable label. */
export function parseTier(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const j = JSON.parse(m[0])
    if (j.tier === 'simple' || j.tier === 'complex') return { tier: j.tier, reason: String(j.reason || '').slice(0, 80) }
  } catch { /* fall through */ }
  return null
}

/**
 * Decide the model for this message. Never throws.
 * @returns {{ model, tier, reason, via: 'classifier'|'fallback'|'ceiling' }}
 */
export async function routeModel(env, { userId, selected, requestText, hasActiveHtml }) {
  const ceiling = selected || AUTO_MODEL
  if (/haiku/.test(ceiling)) return { model: ceiling, tier: 'simple', reason: 'Haiku chosen in settings', via: 'ceiling' }
  const request = cleanRequest(requestText)
  if (!request) return { model: modelForTier('complex', ceiling), tier: 'complex', reason: 'empty request', via: 'fallback' }
  try {
    const res = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        apiKey: env.ANTHROPIC_API_KEY || undefined,
        model: CLASSIFIER_MODEL,
        max_tokens: 100,
        temperature: 0,
        system: CLASSIFIER_PROMPT,
        messages: [{ role: 'user', content: `${hasActiveHtml ? '[An HTML page is open in the editor]\n' : ''}${request}` }],
      }),
    })
    if (!res.ok) throw new Error(`classifier HTTP ${res.status}`)
    const data = await res.json()
    const text = (data.content || []).find(c => c.type === 'text')?.text || ''
    const parsed = parseTier(text)
    if (!parsed) throw new Error(`classifier gave no label: ${text.slice(0, 80)}`)
    return { model: modelForTier(parsed.tier, ceiling), tier: parsed.tier, reason: parsed.reason, via: 'classifier' }
  } catch (e) {
    return { model: modelForTier('complex', ceiling), tier: 'complex', reason: `classifier failed — ${e.message}`.slice(0, 120), via: 'fallback' }
  }
}
