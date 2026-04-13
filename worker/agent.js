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
import { streamText, tool, convertToModelMessages, pruneMessages, stepCountIs } from 'ai'
import { z } from 'zod'
import { executeTool } from './tool-executors.js'
import { TOOL_DEFINITIONS } from './tool-definitions.js'
import { CHAT_SYSTEM_PROMPT } from './system-prompt.js'

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

const WORKERS_AI_TOOLS = new Set(['who_am_i', 'list_graphs', 'list_meta_areas', 'search_graphs', 'generate_image'])

function buildTools(env, userId) {
  const tools = {}
  for (const def of TOOL_DEFINITIONS) {
    if (!WORKERS_AI_TOOLS.has(def.name)) continue
    tools[def.name] = tool({
      description: def.description,
      inputSchema: jsonSchemaToZod(def.input_schema),
      execute: async (args) => {
        try {
          return await executeTool(def.name, { ...args, userId }, env)
        } catch (err) {
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
  async onChatMessage(_onFinish, options) {
    const modelId = options?.body?.model || this.env.DEFAULT_MODEL || '@cf/meta/llama-4-scout-17b-16e-instruct'
    console.log(`[VegvisrAgent] onChatMessage model=${modelId} messages=${this.messages.length}`)

    const startTime = Date.now()
    const sessionId = crypto.randomUUID()
    const env = this.env
    const userId = this.name

    const workersai = createWorkersAI({ binding: this.env.AI })
    const model = workersai(modelId)

    const result = streamText({
      model,
      system: CHAT_SYSTEM_PROMPT,
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: 'before-last-2-messages',
      }),
      tools: buildTools(this.env, userId),
      stopWhen: stepCountIs(5),
      maxTokens: 1024,
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
