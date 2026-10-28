/**
 * Central Claude model registry.
 *
 * Why this exists
 * ---------------
 * Anthropic retires older -YYYYMMDD snapshot IDs without much notice. When a
 * snapshot ID is hardcoded in many places (subagent files, agent-loop, DB
 * defaults, tool-definition docs, agent-builder-subagent's instruction prompt),
 * a single deprecation silently breaks every caller. On 2026-06-15
 * `claude-sonnet-4-20250514` was retired and every chat bot pinned to it went
 * silent.
 *
 * Rule: live callers and saved agent configs MUST reference one of the values
 * in MODELS below. Where Anthropic publishes a stable, auto-updating name
 * (`claude-sonnet-4-6`, `claude-opus-4-8`), we use that — the upstream alias
 * follows the latest snapshot in the family, so we don't have to chase
 * deprecations. For Haiku we pin the current snapshot because no stable
 * "claude-haiku-4-5" alias is published; the safety-net fallback in
 * anthropic-worker is the second line of defence.
 *
 * If Anthropic ships a stable Haiku alias later, swap MODELS.HAIKU here once
 * and every caller picks it up.
 */

export const MODELS = Object.freeze({
  HAIKU:  'claude-haiku-4-5-20251001',
  SONNET: 'claude-sonnet-4-6',
  OPUS:   'claude-opus-4-8',
  FABLE:  'claude-fable-5',
  // 5.5 generation (added 2026-10-28 for the automatic model choice). Thinking is always on and
  // `temperature` is rejected — see acceptsSampling().
  HAIKU_55:  'claude-haiku-5-5',
  SONNET_55: 'claude-sonnet-5-5',
  OPUS_55:   'claude-opus-5-5',
})

/** Picker value meaning "let the worker choose per message" (model-router.js). */
export const AUTO_MODEL = 'auto'

/**
 * Only the older models take a `temperature`. The 5.x line (and Opus 4.7+) answers 400, which
 * anthropic-worker then retries without it — a wasted round trip on every turn.
 */
export function acceptsSampling(modelId) {
  return /^claude-(haiku-4-5|sonnet-4-6|sonnet-4-2025|opus-4-6|opus-4-2025)/.test(String(modelId || ''))
}

/** The fallback every subagent / loop should use when no model is specified. */
export const DEFAULT_MODEL = MODELS.HAIKU

/** Set of currently-valid model IDs for runtime validation. */
export const KNOWN_MODELS = new Set(Object.values(MODELS))

/**
 * Map a model ID to its model family. Used by anthropic-worker's
 * not_found_error fallback to retry on the family's stable name when the
 * caller-pinned snapshot is gone.
 */
export function familyOf(modelId) {
  if (!modelId || typeof modelId !== 'string') return null
  if (modelId.includes('haiku')) return 'HAIKU'
  if (modelId.includes('sonnet')) return 'SONNET'
  if (modelId.includes('opus')) return 'OPUS'
  if (modelId.includes('fable')) return 'FABLE'
  return null
}

/**
 * Resolve a possibly-stale snapshot name to the registry's current stable
 * name for that family. Returns null when the family is unknown.
 */
export function resolveToStable(modelId) {
  const family = familyOf(modelId)
  if (!family) return null
  return MODELS[family]
}
