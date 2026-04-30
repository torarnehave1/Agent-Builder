/**
 * VegvisrAgent — Cloudflare Agents SDK (AIChatAgent) implementation
 *
 * NEW WebSocket/HTTP path: agent.vegvisr.org/agents/VegvisrAgent/{userId}
 * - One Durable Object instance per userId
 * - Conversation history stored automatically in SQLite
 * - Model routing: Workers AI (Gemma) or Anthropic (Claude)
 *
 * DOES NOT affect the existing /chat SSE path — fully additive.
 * agent-loop.js and all existing routes are untouched.
 *
 * Model routing:
 *   @cf/* prefix        → Workers AI (Gemma 4, Llama, etc.)
 *   gemma / llama       → Workers AI
 *   default             → @cf/google/gemma-4-26b-a4b-it
 *
 * Claude models stay on the existing /chat SSE path (agent-loop.js). Not here.
 */

import { AIChatAgent } from '@cloudflare/ai-chat'
import { createWorkersAI } from 'workers-ai-provider'
import { streamText, tool, jsonSchema, convertToModelMessages, pruneMessages, stepCountIs } from 'ai'
import { getCurrentAgent } from 'agents'
import { z } from 'zod'
import { executeTool } from './tool-executors.js'
import { TOOL_DEFINITIONS } from './tool-definitions.js'
import { CHAT_SYSTEM_PROMPT } from './system-prompt.js'
import { resolveAuthorizedCaller, resolveAuthorizedCallerWithCredentials } from './auth.js'

// ---------------------------------------------------------------------------
// JSON Schema → Zod converter
// Handles the subset of JSON Schema used in TOOL_DEFINITIONS (Anthropic format).
// ---------------------------------------------------------------------------

function schemaFieldToZod(prop) {
  if (!prop) return z.unknown()

  // Enum: use z.enum for multiple values, z.literal for single value
  if (prop.enum && Array.isArray(prop.enum) && prop.enum.length > 0) {
    if (prop.enum.length === 1) return z.literal(prop.enum[0])
    // z.enum requires at least 2 string values — pass as spread tuple
    const [first, second, ...rest] = prop.enum
    return z.enum([first, second, ...rest])
  }

  switch (prop.type) {
    case 'string':  return z.string()
    case 'number':  return z.number()
    case 'integer': return z.number()
    case 'boolean': return z.boolean()
    case 'array':   return z.array(prop.items ? schemaFieldToZod(prop.items) : z.unknown())
    case 'object':  return jsonSchemaToZod(prop)
    default:        return z.unknown()
  }
}

function jsonSchemaToZod(schema) {
  if (!schema || schema.type !== 'object') {
    return z.object({})
  }
  const properties = schema.properties || {}
  const required = schema.required || []
  const shape = {}

  for (const [key, prop] of Object.entries(properties)) {
    let field = schemaFieldToZod(prop)
    if (!required.includes(key)) {
      field = field.optional()
    }
    shape[key] = field
  }

  return z.object(shape)
}

// ---------------------------------------------------------------------------
// Build AI SDK tool set from TOOL_DEFINITIONS
// Wraps each existing tool definition so executeTool() handles all runtime logic.
// ---------------------------------------------------------------------------

const WORKERS_AI_TOOLS = new Set([
  'who_am_i',
  'list_graphs',
  'list_meta_areas',
  'search_graphs',
  'read_graph',
  'read_graph_content',
  'read_node',
  'create_graph',
  'create_node',
  'patch_node',
  'patch_graph_metadata',
  'add_edge',
  'get_formatting_reference',
  'get_node_types_reference',
  'search_pexels',
  'search_unsplash',
  'get_album_images',
  'analyze_image',
  'get_system_registry',
  'save_learning',
  'get_secure_worker_template',
  'create_capability_blueprint',
  'build_capability_worker_scaffold',
  'deploy_worker',
  'read_worker',
  'delete_worker',
  'invoke_registry_worker',
  'db_list_tables',
  'db_query',
  'calendar_list_tables',
  'calendar_query',
  'chat_db_list_tables',
  'chat_db_query',
  'create_app_table',
  'insert_app_record',
  'query_app_table',
  'add_app_table_column',
  'get_app_table_schema',
  'delete_app_records',
  'delegate_to_kg',
  'delegate_to_youtube_graph',
  'generate_image',
])

const GRAPH_AWARE_TOOLS = new Set([
  'read_graph',
  'read_graph_content',
  'read_node',
  'create_node',
  'patch_node',
  'patch_graph_metadata',
  'add_edge',
  'delegate_to_kg',
])

const GRAPH_ID_RE = /^(graph_[\w-]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
const EMPTY_AUTH_CONTEXT = {
  authenticated: false,
  session: null,
  profile: null,
  userId: null,
  email: null,
  role: null,
}

function relaxJsonSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema
  if (Array.isArray(schema)) return schema.map(relaxJsonSchema)

  const next = { ...schema }

  if (next.type === 'number' || next.type === 'integer') {
    next.type = ['number', 'string']
  } else if (next.type === 'boolean') {
    next.type = ['boolean', 'string']
  }

  if (next.properties && typeof next.properties === 'object') {
    next.properties = Object.fromEntries(
      Object.entries(next.properties).map(([key, value]) => [key, relaxJsonSchema(value)])
    )
  }

  if (next.items) next.items = relaxJsonSchema(next.items)
  if (next.type === 'object') next.additionalProperties = true

  return next
}

function normalizeToolArgs(toolName, args, currentGraphId) {
  const next = { ...(args || {}) }

  if (next.graph_id && !next.graphId) next.graphId = next.graph_id
  if (next.node_id && !next.nodeId) next.nodeId = next.node_id

  if (toolName === 'create_node') {
    if (next.type && !next.nodeType) next.nodeType = next.type
    if (next.info != null && next.content == null) next.content = next.info
  }

  if (toolName === 'patch_node') {
    if (!next.fields || typeof next.fields !== 'object') {
      const directFields = {}
      for (const key of ['info', 'label', 'path', 'color', 'type', 'visible', 'metadata', 'bibl', 'position', 'imageWidth', 'imageHeight']) {
        if (next[key] !== undefined) directFields[key] = next[key]
      }
      if (Object.keys(directFields).length > 0) next.fields = directFields
    }
  }

  if (currentGraphId && GRAPH_AWARE_TOOLS.has(toolName)) {
    const candidate = typeof next.graphId === 'string' ? next.graphId.trim() : ''
    const shouldInject =
      !candidate ||
      /^(this|current|active)\s+graph$/i.test(candidate) ||
      candidate === 'graphId' ||
      !GRAPH_ID_RE.test(candidate)
    if (shouldInject) {
      next.graphId = currentGraphId
    }
  }

  return next
}

function buildTools(env, userId, currentGraphId, authContext, authToken = '') {
  const tools = {}
  for (const def of TOOL_DEFINITIONS) {
    if (!WORKERS_AI_TOOLS.has(def.name)) continue
    const relaxedSchema = jsonSchema(relaxJsonSchema(def.input_schema || { type: 'object', additionalProperties: true }))
    tools[def.name] = tool({
      description: def.description,
      inputSchema: relaxedSchema,
      execute: async (args) => {
        const normalizedArgs = normalizeToolArgs(def.name, args, currentGraphId)
        console.log(`[buildTools] ENTER ${def.name}`, JSON.stringify(normalizedArgs).slice(0, 200))
        try {
          const result = await executeTool(def.name, { ...normalizedArgs, userId, authContext, authToken }, env)
          console.log(`[buildTools] ${def.name} SUCCESS:`, JSON.stringify(result).slice(0, 300))
          return result
        } catch (err) {
          console.error(`[buildTools] ${def.name} ERROR:`, err.message, err.stack?.slice(0, 300))
          return { error: err.message }
        }
      },
    })
  }
  return tools
}

// ---------------------------------------------------------------------------
// VegvisrAgent — Durable Object backed by AIChatAgent
//
// One instance per userId. SQLite history, WebSocket transport, hibernation.
// ---------------------------------------------------------------------------

export class VegvisrAgent extends AIChatAgent {
  authContext = EMPTY_AUTH_CONTEXT

  async onConnect(_connection, ctx) {
    const request = ctx?.request
    this.authContext = request
      ? await resolveAuthorizedCaller(request, this.env).catch(() => EMPTY_AUTH_CONTEXT)
      : EMPTY_AUTH_CONTEXT
  }

  async onChatMessage(_onFinish, options) {
    const modelId = options?.body?.model || this.env.DEFAULT_MODEL || '@cf/meta/llama-4-scout-17b-16e-instruct'
    const currentGraphId = options?.body?.graphId || null
    console.log(`[VegvisrAgent] onChatMessage model=${modelId} graphId=${currentGraphId || 'none'} messages=${this.messages.length}`)

    const startTime = Date.now()
    const sessionId = crypto.randomUUID()
    const env = this.env
    const userId = this.name
    const request = getCurrentAgent()?.request
    const requestAuthContext = request
      ? await resolveAuthorizedCaller(request, env).catch(() => this.authContext || EMPTY_AUTH_CONTEXT)
      : (this.authContext || EMPTY_AUTH_CONTEXT)
    const bodyAuthToken = typeof options?.body?.authToken === 'string' ? options.body.authToken.trim() : ''
    const authContext = requestAuthContext.authenticated || !bodyAuthToken
      ? requestAuthContext
      : await resolveAuthorizedCallerWithCredentials({ authToken: bodyAuthToken }, env).catch(() => requestAuthContext)

    const workersai = createWorkersAI({ binding: this.env.AI })
    const model = workersai(modelId)

    const workersAiPrompt = `
## WORKERS AI TOOLING
This conversation is running on the Workers AI tool path. Use only the tools that are actually available in this session.
- For existing graph content edits, use \`patch_node\`.
- For standalone image nodes, use \`create_node\` with \`nodeType: "markdown-image"\`, \`content\` as alt text, and \`path\` as the image URL.
- For inline images inside a \`fulltext\` node, read the node first, then patch its \`info\` field with the full markdown. Use \`get_formatting_reference\` if you need the exact \`Header\`, \`Leftside\`, or \`Rightside\` grammar.
- If the user refers to "this graph", "the current graph", or "current graph", prefer the active UI graph context.
`

    const systemPrompt = currentGraphId
      ? `${CHAT_SYSTEM_PROMPT}\n${workersAiPrompt}\n\n## CURRENT GRAPH CONTEXT\nThe user has selected graph \`${currentGraphId}\` as the current/active graph. When they say "this graph", "the current graph", "current graph", or ask graph-scoped questions without naming one, use this graphId. Call \`read_graph\` with this id to inspect it. Do NOT call \`list_graphs\` to answer "what is the current graph" — the answer is \`${currentGraphId}\`.`
      : `${CHAT_SYSTEM_PROMPT}\n${workersAiPrompt}`

    const result = streamText({
      model,
      system: systemPrompt,
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: 'before-last-2-messages',
      }),
      tools: buildTools(this.env, userId, currentGraphId, authContext, bodyAuthToken),
      stopWhen: stepCountIs(5),
      maxTokens: 2048,
      onFinish: async ({ usage, steps }) => {
        if (!env.STATS_DB) return
        const now = new Date().toISOString()
        const toolCalls = (steps || []).flatMap(s => s.toolCalls || []).map(tc => tc.toolName)
        const WORKERS_AI_PRICES = {
          '@cf/nvidia/nemotron-3-120b-a12b': { in: 0.50, out: 1.50 },
        }
        const waiPrice = WORKERS_AI_PRICES[modelId]
        const inputTokens = usage?.promptTokens || 0
        const outputTokens = usage?.completionTokens || 0
        const costUsd = waiPrice
          ? ((inputTokens / 1_000_000) * waiPrice.in) + ((outputTokens / 1_000_000) * waiPrice.out)
          : 0
        await env.STATS_DB.prepare(
          `INSERT INTO sessions (id, user_id, started_at, ended_at, duration_ms, turns, fast_path, model,
            input_tokens, output_tokens, tool_calls, success, agent_id, version, version_note, cost_usd)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 1, 'workers-ai', 'v-wai-1', 'Workers AI AIChatAgent', ?)`
        ).bind(
          sessionId, userId || 'unknown',
          new Date(startTime).toISOString(), now, Date.now() - startTime,
          (steps || []).length, modelId,
          inputTokens, outputTokens,
          JSON.stringify(toolCalls), costUsd
        ).run().catch(e => console.error('[stats] session insert failed:', e.message))
      },
    })

    return result.toUIMessageStreamResponse()
  }
}
