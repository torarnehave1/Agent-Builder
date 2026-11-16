/**
 * Which provider answers a chat on the OpenAI-format agent loop (streamingOpenAIAgentLoop), by the
 * prefix of the model id the picker sends — and how that provider is asked.
 *
 *   openai/…   openai-worker   (binding OPENAI_WORKER)   the platform's OpenAI key
 *   grok/…     grok-worker     (binding GROK_WORKER)     the platform's xAI key
 *   gemini/…   gemini-worker   (binding GEMINI_WORKER)   the USER's own Gemini key (userId is sent)
 *   kimi/…     Cloudflare's model catalog through the AI binding (env.AI.run), id moonshotai/<model>.
 *              A third-party model there: no Moonshot key, paid from the account's prepaid
 *              AI Gateway credits (Unified Billing). Added 2026-11-16.
 *
 * All four answer in OpenAI chat-completion format ({ choices: [{ message: { content, tool_calls } }],
 * usage }), so the loop reads them the same way. send() returns { ok, status, data } with the
 * provider's own error text in data.error.
 *
 * Bare ids ("claude-…") and "@cf/…" ids are not handled here — they have their own paths.
 */

export const OPENAI_MODEL_PREFIX = 'openai/'
export const GROK_MODEL_PREFIX = 'grok/'
export const GEMINI_MODEL_PREFIX = 'gemini/'
export const KIMI_MODEL_PREFIX = 'kimi/'

const WORKER_PROVIDERS = {
  [OPENAI_MODEL_PREFIX]: {
    name: 'openai', label: 'OpenAI', bindingName: 'OPENAI_WORKER',
    url: 'https://openai.vegvisr.org/chat', maxTokenField: 'max_completion_tokens', maxTokens: 4096,
  },
  [GROK_MODEL_PREFIX]: {
    name: 'grok', label: 'Grok', bindingName: 'GROK_WORKER',
    url: 'https://grok.vegvisr.org/chat', maxTokenField: 'max_tokens', maxTokens: 4096,
  },
  // Gemini's thinking is paid out of the same output budget as the answer, so 4096 can be spent
  // before a word is written (the same trap that emptied Claude 5.5 answers in the flow engine).
  [GEMINI_MODEL_PREFIX]: {
    name: 'gemini', label: 'Gemini', bindingName: 'GEMINI_WORKER',
    url: 'https://gemini.vegvisr.org/chat', maxTokenField: 'max_tokens', maxTokens: 8192,
  },
}

/** The author segment of the Cloudflare catalog id for each catalog-backed prefix. */
const CATALOG_PROVIDERS = {
  [KIMI_MODEL_PREFIX]: { name: 'kimi', label: 'Kimi', author: 'moonshotai', maxTokens: 8192 },
}

const PREFIXES = [...Object.keys(WORKER_PROVIDERS), ...Object.keys(CATALOG_PROVIDERS)]

/** True for every model id this module can route. */
export function isOpenAICompatibleModel(model) {
  return typeof model === 'string' && PREFIXES.some((p) => model.startsWith(p))
}

function errorText(e) {
  if (!e) return 'unknown error'
  if (typeof e === 'string') return e
  return e.message || JSON.stringify(e)
}

/**
 * The provider for a model id, or null when the id carries none of the prefixes above.
 * `configured` is false when the binding it needs is missing on this worker; `missing` then says
 * which one, so the user reads the real reason instead of a failed call.
 */
export function resolveChatProvider(model, env) {
  const id = String(model || '')

  for (const [prefix, p] of Object.entries(WORKER_PROVIDERS)) {
    if (!id.startsWith(prefix)) continue
    const binding = env?.[p.bindingName]
    return {
      name: p.name,
      label: p.label,
      prefix,
      providerModel: id.slice(prefix.length),
      keepReasoning: false,
      configured: !!binding?.fetch,
      missing: `${p.bindingName} service binding is not configured.`,
      // A thrown fetch is left to the loop's own crash handling, as before this module existed.
      async send({ userId, messages, tools, temperature }) {
        const res = await binding.fetch(p.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            model: id.slice(prefix.length),
            messages,
            temperature,
            tools,
            tool_choice: 'auto',
            [p.maxTokenField]: p.maxTokens,
          }),
        })
        const data = await res.json().catch(() => ({}))
        return { ok: res.ok, status: res.status, data }
      },
    }
  }

  for (const [prefix, p] of Object.entries(CATALOG_PROVIDERS)) {
    if (!id.startsWith(prefix)) continue
    const catalogId = `${p.author}/${id.slice(prefix.length)}`
    const ai = env?.AI
    return {
      name: p.name,
      label: p.label,
      prefix,
      providerModel: catalogId,
      // Kimi K3 always reasons and returns it as message.reasoning_content; the loop hands it back
      // with the assistant's tool calls so the model keeps its own thread between steps.
      keepReasoning: true,
      configured: typeof ai?.run === 'function',
      missing: 'The Workers AI binding (AI) is not configured.',
      async send({ messages, tools, temperature }) {
        try {
          // No userId and nothing else beside the model's own fields: AI Gateway rejects fields a
          // third-party model does not accept.
          const data = await ai.run(
            catalogId,
            { messages, tools, tool_choice: 'auto', temperature, max_tokens: p.maxTokens },
            { gateway: { id: env.AI_GATEWAY_ID || 'default' } },
          )
          if (!data || typeof data !== 'object' || !Array.isArray(data.choices)) {
            return { ok: false, status: 502, data: { error: `${p.label} answered in an unexpected format: ${JSON.stringify(data ?? null).slice(0, 300)}` } }
          }
          return { ok: true, status: 200, data }
        } catch (e) {
          return { ok: false, status: 0, data: { error: `${p.label} (Cloudflare model catalog, ${catalogId}): ${errorText(e)}` } }
        }
      },
    }
  }

  return null
}
