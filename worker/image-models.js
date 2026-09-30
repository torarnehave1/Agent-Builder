/**
 * Image-generation models — the one place that says what each model actually takes.
 *
 * The three models do NOT share a parameter set, and the differences are not cosmetic.
 * Transcribed from the Cloudflare model pages and then CHECKED against the live API on
 * 2026-09-30 (one real generation per model):
 *
 *   @cf/bytedance/stable-diffusion-xl-lightning
 *       negative_prompt yes · guidance default 7.5, no documented range · num_steps 1-20
 *       · width/height 256-2048 · returns a ReadableStream of raw JPEG bytes
 *   @cf/leonardo/lucid-origin
 *       negative_prompt NO · guidance 0-10 (default 4.5) · num_steps 1-40
 *       · width/height up to 2500 (default 1120) · returns { image: '<base64 JPEG>' }
 *   @cf/leonardo/phoenix-1.0
 *       negative_prompt yes · guidance 2-10 (default 2) · num_steps 1-50 (default 25)
 *       · width/height up to 2048 (default 1024) · returns raw JPEG bytes, like SDXL
 *
 * Why the gate matters, measured rather than assumed: Lucid Origin does not REJECT a
 * negative_prompt it has no field for — it answers 200 and silently ignores it. A control that
 * looks like it works and does nothing is the exact failure this file exists to prevent, the
 * same class as the width/height that were advertised in a tool schema and then dropped by the
 * executor (see the comment on executeGenerateImage in tool-executors.js).
 *
 * This module is pure so a test can assert the gating without a Workers runtime. The chat UI
 * (src/components/VegvisrAgentChat.tsx) mirrors this table to decide which controls to show;
 * THIS file is the authority, so a stale frontend cannot smuggle an unsupported field through.
 *
 * guidance: null means the model documents a default but no range, so a value is passed through
 * untouched rather than clamped against a range invented here.
 * minSide is 256 for all three: the Leonardo pages state 0 as the schema minimum, but a
 * zero-pixel side is not a real request, so SDXL's documented floor is applied across the board.
 */

export const IMAGE_MODEL_LIMITS = {
  '@cf/bytedance/stable-diffusion-xl-lightning': {
    label: 'SDXL Lightning',
    negativePrompt: true,
    baseSize: 1024,
    minSide: 256,
    maxSide: 2048,
    guidance: null,
    steps: { min: 1, max: 20 },
  },
  '@cf/leonardo/lucid-origin': {
    label: 'Lucid Origin',
    negativePrompt: false,
    baseSize: 1120,
    minSide: 256,
    maxSide: 2500,
    guidance: { min: 0, max: 10 },
    steps: { min: 1, max: 40 },
  },
  '@cf/leonardo/phoenix-1.0': {
    label: 'Phoenix 1.0',
    negativePrompt: true,
    baseSize: 1024,
    minSide: 256,
    maxSide: 2048,
    guidance: { min: 2, max: 10 },
    steps: { min: 1, max: 50 },
  },
}

export const DEFAULT_IMAGE_MODEL = '@cf/bytedance/stable-diffusion-xl-lightning'

/**
 * Pull `--ar W:H` out of the prompt and turn it into dimensions at the same pixel area as the
 * model's own default square, rounded to a multiple of 8 (diffusion latents are 1/8 scale).
 * baseSize is per-model — it used to be a shared 1120, which is Lucid Origin's default and
 * nobody else's.
 */
export function parseAspectRatio(rawPrompt, baseSize) {
  const match = String(rawPrompt).match(/--ar\s+(\d+)\s*:\s*(\d+)/i)
  if (!match) return { cleanPrompt: rawPrompt, width: baseSize, height: baseSize }
  const ratioW = parseInt(match[1], 10)
  const ratioH = parseInt(match[2], 10)
  if (!ratioW || !ratioH) return { cleanPrompt: rawPrompt, width: baseSize, height: baseSize }
  const baseArea = baseSize * baseSize
  const w = Math.round(Math.sqrt(baseArea * ratioW / ratioH) / 8) * 8
  const h = Math.round(Math.sqrt(baseArea * ratioH / ratioW) / 8) * 8
  const cleanPrompt = rawPrompt.replace(/--ar\s+\d+\s*:\s*\d+/i, '').trim()
  return { cleanPrompt, width: w, height: h }
}

/**
 * Build the exact object handed to env.AI.run for `model`, from an untrusted request body.
 *
 * Returns { error, supported } for an unknown model, otherwise
 * { model, limits, prompt, input, negativePromptIgnored }. `input` contains ONLY fields the
 * model documents, every numeric one clamped to its range — so what the caller is told was sent
 * is what was sent.
 */
export function buildImageInput(model, body = {}) {
  const resolved = model || DEFAULT_IMAGE_MODEL
  const limits = IMAGE_MODEL_LIMITS[resolved]
  if (!limits) {
    return { error: `Unsupported image model "${resolved}"`, supported: Object.keys(IMAGE_MODEL_LIMITS) }
  }

  const { cleanPrompt, width: arWidth, height: arHeight } = parseAspectRatio(body.prompt, limits.baseSize)
  const clampSide = (v) => Math.min(limits.maxSide, Math.max(limits.minSide, Math.round(v)))

  // `Number(body.width) || arWidth` looks equivalent and is not: a width of 0 is falsy, so it
  // fell through to the --ar default instead of being clamped, while a width of 1 was clamped to
  // 256. Same falsy-zero trap as the guidance read below, caught by test-image-models.mjs.
  const pickSide = (raw, fallback) => {
    if (raw === undefined || raw === null || raw === '') return fallback
    const n = Number(raw)
    return Number.isFinite(n) ? n : fallback
  }

  const input = { prompt: cleanPrompt }
  input.width = clampSide(pickSide(body.width, arWidth))
  input.height = clampSide(pickSide(body.height, arHeight))

  const negativePrompt = typeof body.negative_prompt === 'string' ? body.negative_prompt.trim() : ''
  const negativePromptIgnored = Boolean(negativePrompt) && !limits.negativePrompt
  if (negativePrompt && limits.negativePrompt) input.negative_prompt = negativePrompt

  // Read with Number.isFinite, not truthiness: guidance 0 is a legal value for Lucid Origin and
  // `if (body.guidance)` discarded it as if it had never been sent.
  const guidance = Number(body.guidance)
  if (body.guidance !== undefined && body.guidance !== null && body.guidance !== '' && Number.isFinite(guidance)) {
    input.guidance = limits.guidance
      ? Math.min(limits.guidance.max, Math.max(limits.guidance.min, guidance))
      : guidance
  }

  const rawSteps = body.num_steps ?? body.steps
  const numSteps = Number(rawSteps)
  if (rawSteps !== undefined && rawSteps !== null && rawSteps !== '' && Number.isFinite(numSteps)) {
    input.num_steps = Math.min(limits.steps.max, Math.max(limits.steps.min, Math.round(numSteps)))
  }

  const seed = Number(body.seed)
  if (body.seed !== undefined && body.seed !== null && body.seed !== '' && Number.isFinite(seed)) {
    input.seed = Math.max(0, Math.round(seed))
  }

  return { model: resolved, limits, prompt: cleanPrompt, input, negativePromptIgnored }
}
