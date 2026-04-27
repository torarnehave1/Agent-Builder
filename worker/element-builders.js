/**
 * element-builders.js
 *
 * Shared, deterministic builders for fulltext-element grammars.
 * Each builder runs Gemma slot-fills, validates allowlists, and returns
 * a markup STRING (e.g. "[FANCY | ...]title[END FANCY]\n\nparagraph").
 *
 * Builders return raw markup, NOT complete nodes. Endpoints/tools assemble
 * nodes around the markup so multi-element nodes can compose freely.
 *
 * Used by:
 *   - /test-fancy, /test-section, ... endpoints in worker/index.js
 *   - (future) create_styled_node tool exposed to the chat agent
 */

const GEMMA_MODEL = '@cf/google/gemma-4-26b-a4b-it'

/**
 * Run a single Gemma slot-fill. Reads message.content ONLY (Gemma is a
 * reasoning model — never read message.reasoning, it biases parsing).
 * Returns { value, finishReason, raw }.
 */
async function askGemmaSlot(env, systemPrompt, userPrompt, maxTokens = 8192) {
  const resp = await env.AI.run(GEMMA_MODEL, {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    max_tokens: maxTokens,
  })
  const choice = resp?.choices?.[0]?.message || {}
  const finishReason = resp?.choices?.[0]?.finish_reason || null
  const value = (choice.content || resp?.response || '').toString().trim()
  return { value, finishReason, raw: choice }
}

/**
 * Pick the first allowlist token that appears (case-insensitive) in `text`.
 * Returns { match, ambiguous, hits }. `ambiguous` is true if >1 token matched
 * — useful for diagnostics; callers usually proceed with hits[0].
 */
function pickFromAllowlist(text, allowlist) {
  const lower = (text || '').toLowerCase()
  const hits = allowlist.filter((w) => lower.includes(w.toLowerCase()))
  return { match: hits[0] || null, ambiguous: hits.length > 1, hits }
}

/**
 * Sanitize an LLM-produced single-line title:
 *   - strip leading "#" (markdown heading)
 *   - strip surrounding straight/curly quotes
 *   - keep only first line
 *   - clamp length
 */
function sanitizeTitle(raw, maxLen = 100) {
  return (raw || '')
    .replace(/^#+\s*/, '')
    .replace(/^["“”']+|["“”']+$/g, '')
    .split('\n')[0]
    .trim()
    .slice(0, maxLen)
}

// ============================================================================
// FANCY
// ============================================================================

const FANCY_FONT_SIZES = ['2.5em', '3em', '3.5em', '4em', '4.5em', '5em']
const FANCY_COLORS     = ['#2c3e50', '#c0392b', '#16a085', '#d4a017', '#8e44ad', '#d35400']
const FANCY_ALIGNS     = ['left', 'center', 'right']

/**
 * Build a [FANCY] hero block + intro paragraph for a given topic.
 *
 * Runs 5 parallel Gemma slot-fills:
 *   - title (free text, sanitized)
 *   - font-size (allowlist)
 *   - color hex (allowlist)
 *   - text-align (allowlist)
 *   - intro paragraph (free text)
 *
 * Returns:
 *   {
 *     ok: true,
 *     markup: string,        // ready to embed in a fulltext node's `info`
 *     slots: { title, font, color, align, paragraph },
 *     slotReport,            // raw Gemma replies + allowlist parsing details
 *   }
 *   OR
 *   { ok: false, error, missing, slotReport }
 */
async function buildFancyElement(env, topic) {
  const [titleSlot, fontSlot, colorSlot, alignSlot, paraSlot] = await Promise.all([
    askGemmaSlot(env,
      'You write very short article titles. Reply with ONE plain title line (max 8 words), no quotes, no markdown, no extra text.',
      `Title for an article about: ${topic}`,
    ),
    askGemmaSlot(env,
      `You pick the most fitting font size for a hero title. Reply with EXACTLY ONE value from this list, nothing else: ${FANCY_FONT_SIZES.join(', ')}.`,
      `Font size for a hero title about: ${topic}`,
    ),
    askGemmaSlot(env,
      `You pick the most fitting hex color for a hero title. Reply with EXACTLY ONE value from this list, nothing else: ${FANCY_COLORS.join(', ')}.`,
      `Color for a hero title about: ${topic}`,
    ),
    askGemmaSlot(env,
      `You pick the most fitting text alignment for a hero title. Reply with EXACTLY ONE value from this list, nothing else: ${FANCY_ALIGNS.join(', ')}.`,
      `Text alignment for a hero title about: ${topic}`,
    ),
    askGemmaSlot(env,
      'You write concise prose. Reply with exactly ONE plain paragraph, plain text, no markdown headings, no quotes, no tags.',
      `Write one short opening paragraph introducing: ${topic}`,
    ),
  ])

  const fontPick  = pickFromAllowlist(fontSlot.value,  FANCY_FONT_SIZES)
  const colorPick = pickFromAllowlist(colorSlot.value, FANCY_COLORS)
  const alignPick = pickFromAllowlist(alignSlot.value, FANCY_ALIGNS)

  const slotReport = {
    title:     { value: titleSlot.value, finishReason: titleSlot.finishReason },
    font:      { value: fontSlot.value,  finishReason: fontSlot.finishReason,  pick: fontPick },
    color:     { value: colorSlot.value, finishReason: colorSlot.finishReason, pick: colorPick },
    align:     { value: alignSlot.value, finishReason: alignSlot.finishReason, pick: alignPick },
    paragraph: { value: paraSlot.value,  finishReason: paraSlot.finishReason },
  }

  const missing = []
  if (!titleSlot.value) missing.push('title')
  if (!paraSlot.value)  missing.push('paragraph')
  if (!fontPick.match)  missing.push('font')
  if (!colorPick.match) missing.push('color')
  if (!alignPick.match) missing.push('align')
  if (missing.length) {
    return { ok: false, error: 'Some slots came back empty or unmatched', missing, slotReport }
  }

  const title = sanitizeTitle(titleSlot.value)
  const fancyStyle = `font-size: ${fontPick.match}; color: ${colorPick.match}; text-align: ${alignPick.match}`
  const markup = [
    `[FANCY | ${fancyStyle}]`,
    title,
    '[END FANCY]',
    '',
    paraSlot.value,
  ].join('\n')

  return {
    ok: true,
    markup,
    slots: {
      title,
      font:      fontPick.match,
      color:     colorPick.match,
      align:     alignPick.match,
      paragraph: paraSlot.value,
    },
    slotReport,
  }
}

// ============================================================================
// SECTION
// ============================================================================

const SECTION_BG_ALLOWLIST = [
  'lightblue', 'lightyellow', 'lavender', 'mistyrose',
  'mintcream', 'peachpuff', 'beige', 'lightgray', 'thistle',
  'palegoldenrod', 'honeydew', 'aliceblue',
]

/**
 * Build a [SECTION | ...] block wrapping Gemma-written prose.
 *
 * opts:
 *   - paragraphs: number (1-5, default 2)
 *   - aiStyle: bool — if true, ask Gemma to pick a background color from the allowlist.
 *   - style: { background-color, color, text-align, font-size } — manual overrides.
 *
 * Returns:
 *   { ok: true, markup, prose, chosenBg, colorReason, colorRaw, slotReport }
 *   OR
 *   { ok: false, error, raw? }
 */
async function buildSectionElement(env, topic, opts = {}) {
  const paragraphs = Math.min(Math.max(parseInt(opts.paragraphs, 10) || 2, 1), 5)
  const aiStyle = opts.aiStyle === true

  let chosenBg = opts?.style?.['background-color'] || 'lightblue'
  let colorReason = null
  let colorRaw = null

  if (aiStyle) {
    const colorResp = await env.AI.run(GEMMA_MODEL, {
      messages: [
        { role: 'system', content: `Pick the most fitting CSS background color for a topic. Reply with ONE word from this list, exactly as written, nothing else: ${SECTION_BG_ALLOWLIST.join(', ')}.` },
        { role: 'user',   content: `Topic: ${topic}` },
      ],
      max_tokens: 1500,
    })
    const cChoice = colorResp?.choices?.[0]?.message || {}
    colorRaw = (cChoice.content || colorResp?.response || '').toString().trim()
    if (colorRaw && colorRaw.length <= 40) {
      const lc = colorRaw.toLowerCase()
      const hits = SECTION_BG_ALLOWLIST.filter(c => new RegExp(`\\b${c}\\b`, 'i').test(lc))
      if (hits.length === 1) {
        chosenBg = hits[0]
        colorReason = 'matched allowlist (clean content answer)'
      } else if (hits.length > 1) {
        colorReason = `ambiguous (matched ${hits.length}); fell back to default '${chosenBg}'`
      } else {
        colorReason = `no allowlist match in content; fell back to default '${chosenBg}'`
      }
    } else {
      colorReason = `content empty or too long (finish_reason=${colorResp?.choices?.[0]?.finish_reason || 'unknown'}); fell back to default '${chosenBg}'`
    }
  }

  const style = {
    'background-color': chosenBg,
    'color':            opts?.style?.color          || 'black',
    'text-align':       opts?.style?.['text-align'] || 'center',
    'font-size':        opts?.style?.['font-size']  || '1.1em',
  }

  const aiResp = await env.AI.run(GEMMA_MODEL, {
    messages: [
      { role: 'system', content: 'You are a concise prose writer. Reply with plain markdown only — no HTML, no code fences, no headings, no special tags. Just paragraphs. Do not show your reasoning. Output the final text only.' },
      { role: 'user',   content: `Write exactly ${paragraphs} short paragraphs about: ${topic}` },
    ],
    max_tokens: 2000,
  })
  const choice = aiResp?.choices?.[0]?.message || {}
  let prose = (aiResp?.response || choice.content || '').toString().trim()
  if (!prose && choice.reasoning) {
    const blocks = choice.reasoning.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean)
    const proseBlocks = blocks.filter(b => !/^[*\-\d]/.test(b) && b.length > 60)
    prose = proseBlocks.slice(-paragraphs).join('\n\n').trim()
  }
  if (!prose) {
    return { ok: false, error: 'Gemma returned empty response', raw: aiResp }
  }

  const styleStr = Object.entries(style).map(([k, v]) => `${k}: '${v}'`).join('; ')
  const markup = `[SECTION | ${styleStr}]\n${prose}\n[END SECTION]`

  return {
    ok: true,
    markup,
    prose,
    chosenBg,
    colorReason,
    colorRaw,
  }
}

// ============================================================================
// WNOTE  — work note (body + author), grammar: [WNOTE | Cited='...']…[END WNOTE]
// QUOTE  — quote (body + author),     grammar: [QUOTE | Cited='...']…[END QUOTE]
//
// Both share the same Gemma pattern, sanitization, and assembly. Generic
// internal helper drives both via element name.
// ============================================================================

/**
 * Sanitize an author/citation name:
 *   - strip leading "by " (Gemma sometimes prefixes)
 *   - strip surrounding quotes
 *   - strip trailing punctuation
 *   - drop apostrophes (would break Cited='...')
 *   - clamp length
 */
function sanitizeAuthor(raw, maxLen = 80) {
  return (raw || '')
    .replace(/^by\s+/i, '')
    .replace(/^["“”']+|["“”']+$/g, '')
    .replace(/[.,;]+$/, '')
    .replace(/'/g, '')
    .trim()
    .slice(0, maxLen)
}

/**
 * Strip wrapping quote marks (straight or curly) from a body string.
 */
function stripWrappingQuotes(raw) {
  return (raw || '').replace(/^["“”']+|["“”']+$/g, '').trim()
}

/**
 * Internal: builds either WNOTE or QUOTE.
 *   element: 'WNOTE' | 'QUOTE'
 *   bodyPrompt:   { system, user }   — instructions for the body slot
 *   authorPrompt: { system, user }   — instructions for the author slot
 */
async function buildCitedElement(env, element, bodyPrompt, authorPrompt) {
  const [bodySlot, authorSlot] = await Promise.all([
    askGemmaSlot(env, bodyPrompt.system, bodyPrompt.user),
    askGemmaSlot(env, authorPrompt.system, authorPrompt.user),
  ])

  const slotReport = {
    body:   { value: bodySlot.value,   finishReason: bodySlot.finishReason },
    author: { value: authorSlot.value, finishReason: authorSlot.finishReason },
  }
  const missing = []
  if (!bodySlot.value)   missing.push('body')
  if (!authorSlot.value) missing.push('author')
  if (missing.length) {
    return { ok: false, error: 'Some slots came back empty', missing, slotReport }
  }

  const author = sanitizeAuthor(authorSlot.value)
  const body   = stripWrappingQuotes(bodySlot.value)
  const markup = [
    `[${element} | Cited='${author}']`,
    body,
    `[END ${element}]`,
  ].join('\n')

  return {
    ok: true,
    markup,
    slots: { body, author },
    slotReport,
  }
}

/**
 * Build a [WNOTE] block for a topic (body + author slots).
 * Returns { ok, markup, slots, slotReport } or { ok:false, error, missing, slotReport }.
 */
async function buildWNoteElement(env, topic) {
  return buildCitedElement(env, 'WNOTE',
    {
      system: 'You write short professional work notes — practical observations, not quotes. Reply with exactly ONE paragraph, plain text, no quotes, no headings, no tags.',
      user:   `Write one short work note (a practical observation or reminder) about: ${topic}`,
    },
    {
      system: 'You name a plausible professional author for a work note. Reply with just the name, no quotes, no titles, no extra text.',
      user:   `Pick a fitting author name for a professional work note about: ${topic}`,
    },
  )
}

/**
 * Build a [QUOTE] block for a topic (body + author slots).
 * Returns { ok, markup, slots, slotReport } or { ok:false, error, missing, slotReport }.
 */
async function buildQuoteElement(env, topic) {
  return buildCitedElement(env, 'QUOTE',
    {
      system: 'You produce one short, evocative quoted sentence relevant to a topic. Reply with the sentence text only — no surrounding quote marks, no attribution, no extra text.',
      user:   `One quote relevant to: ${topic}`,
    },
    {
      system: 'You name a plausible author for a quote. Reply with just the name, no quotes, no titles, no extra text.',
      user:   `Pick a fitting author name for a quote about: ${topic}`,
    },
  )
}

// ============================================================================
// IMAGE POSITION ELEMENTS
//
// Pure assembly — no Gemma calls. Caller supplies the URL and any prose.
// Grammar lives in graphTemplates D1 (elt-image-header / leftside-medium / rightside-medium).
// ============================================================================

/**
 * Build an imgix CDN URL for an album key with crop sizing.
 */
function imgixUrl(key, w, h) {
  return `https://vegvisr.imgix.net/${key}?w=${w}&h=${h}&fit=crop`
}

/**
 * Header image — full-width band that sits at the top of a node.
 * Returns the inline grammar string only (no surrounding prose).
 *   imageUrl: full URL (use imgixUrl() to build from album key)
 *   opts.height: CSS height (default '200px')
 *   opts.objectFit / opts.objectPosition (defaults 'cover' / 'center')
 */
function buildHeaderImage(imageUrl, opts = {}) {
  const height         = opts.height         || '200px'
  const objectFit      = opts.objectFit      || 'cover'
  const objectPosition = opts.objectPosition || 'center'
  return `![Header|height: ${height}; object-fit: '${objectFit}'; object-position: '${objectPosition}'](${imageUrl})`
}

/**
 * Leftside-Medium image — left-aligned image that text wraps around to the right.
 * Returns markup that includes the image AND the paragraph (text MUST follow on same line per grammar).
 *   paragraph: text to wrap beside the image (required for proper wrap)
 *   opts.width / opts.height (default '200px')
 */
function buildLeftsideImage(imageUrl, paragraph, opts = {}) {
  const width  = opts.width  || '200px'
  const height = opts.height || '200px'
  const margin = opts.margin || '0 20px 15px 0'
  return `![Leftside-1|width: ${width}; height: ${height}; object-fit: 'cover'; object-position: 'center'; margin: '${margin}'](${imageUrl}) ${paragraph || ''}`.trim()
}

/**
 * Rightside-Medium image — right-aligned image that text wraps around to the left.
 *   paragraph: text to wrap beside the image (required for proper wrap)
 *   opts.width / opts.height (default '200px')
 */
function buildRightsideImage(imageUrl, paragraph, opts = {}) {
  const width  = opts.width  || '200px'
  const height = opts.height || '200px'
  const margin = opts.margin || '0 0 15px 20px'
  return `![Rightside-1|width: ${width}; height: ${height}; object-fit: 'cover'; object-position: 'center'; margin: '${margin}'](${imageUrl}) ${paragraph || ''}`.trim()
}

/**
 * Extract a YouTube videoId from any common URL form. Returns null on no match.
 */
function extractYoutubeVideoId(url) {
  if (!url) return null
  const patterns = [
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
  ]
  for (const re of patterns) {
    const m = url.match(re)
    if (m) return m[1]
  }
  return null
}

/**
 * Build the inline `[YOUTUBE src=...]Label[END YOUTUBE]` grammar for embedding
 * a YouTube video inside a fulltext node.
 *   videoId: 11-char YouTube ID
 *   label:   visible label/caption (single line)
 */
function buildYoutubeEmbed(videoId, label) {
  return `![YOUTUBE src=https://www.youtube.com/embed/${videoId}]${(label || '').toString().split('\n')[0].trim()}[END YOUTUBE]`
}

export {
  GEMMA_MODEL,
  askGemmaSlot,
  pickFromAllowlist,
  sanitizeTitle,
  buildFancyElement,
  buildSectionElement,
  buildWNoteElement,
  buildQuoteElement,
  buildHeaderImage,
  buildLeftsideImage,
  buildRightsideImage,
  buildYoutubeEmbed,
  extractYoutubeVideoId,
  imgixUrl,
  FANCY_FONT_SIZES,
  FANCY_COLORS,
  FANCY_ALIGNS,
  SECTION_BG_ALLOWLIST,
}
