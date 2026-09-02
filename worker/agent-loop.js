/**
 * Agent loop — streaming and non-streaming execution loops
 *
 * streamingAgentLoop: SSE-based for /chat endpoint
 * executeAgent: log-based for /execute endpoint
 */

import { TOOL_DEFINITIONS, PROFF_TOOLS } from './tool-definitions.js'
import { loadOpenAPITools } from './openapi-tools.js'
import { executeTool } from './tool-executors.js'
import { DEFAULT_MODEL, MODELS } from './models.js'
import { repairToolPairing } from './message-history.js'
import { detectFunctionalGaps, detectDeadEndpoints, fetchNodeHtmlForGate, executeValidateHtmlSyntax } from './html-builder-subagent.js'

/**
 * PLAN MODE — read-only allowlist (fail-closed).
 *
 * When the chat runs in Plan mode (options.mode === 'plan'), ONLY the tools in
 * this set may execute. Every other tool — every create/patch/delete/add/send,
 * every generate_*, every delegate_to_* (subagents write on the agent's behalf),
 * and any tool added in the future — is blocked at the gate and returned to the
 * model as "blocked, propose a plan instead".
 *
 * Allowlist, not blocklist, on purpose: a new write tool added later is blocked
 * by default. The only failure mode is a genuine read tool being momentarily
 * unavailable in Plan mode — an annoyance, never a safety hole.
 */
const READ_ONLY_TOOLS = new Set([
  // Knowledge-graph reads
  'read_graph', 'read_graph_content', 'read_node', 'kg_get_know_graph',
  'list_graphs', 'list_meta_areas', 'search_graphs',
  // App-data / DB reads
  'query_data_nodes', 'query_app_table', 'get_app_table_schema',
  'db_list_tables', 'db_query',
  'calendar_list_tables', 'calendar_query', 'chat_db_list_tables', 'chat_db_query',
  // Reference docs (pure reads)
  'get_formatting_reference', 'get_node_types_reference',
  'get_html_builder_reference', 'get_vemotion_reference', 'get_contract',
  // Web / media lookups
  'perplexity_search', 'fetch_url', 'search_pexels', 'search_unsplash',
  'get_album_images', 'album_list', 'album_get', 'photos_list', 'analyze_image',
  // Recordings / video reads
  'list_recordings', 'list_realtime_videos', 'vemotion_get_composition', 'vemotion_list_compositions',
  // Audio upload (writes bytes to voice-worker R2 / the audio portfolio R2)
  'upload_audio', 'upload_portfolio_recording',
  // Analysis (read-only — reasons over existing content, writes nothing)
  'analyze_node', 'analyze_graph', 'analyze_transcription',
  // Identity / discovery / status
  'who_am_i', 'onboarding_status', 'describe_capabilities',
  'get_system_registry', 'get_secure_worker_template', 'read_worker',
  // Component registry (verified reusable UI components + page layouts)
  'list_components', 'get_component', 'list_layouts', 'get_layout',
  // Capability planning (classifies + returns a plan; mutates nothing)
  'create_capability_blueprint',
  // Calendar reads
  'calendar_get_settings', 'calendar_check_availability',
  'calendar_list_bookings', 'calendar_get_status',
  // Chat reads
  'list_chat_groups', 'get_group_messages', 'get_group_stats',
  'get_group_members', 'get_poll_results', 'list_bots', 'get_bot',
  // Agent reads
  'list_agents', 'get_agent',
  // Contact reads
  'list_contacts', 'search_contacts', 'get_contact_logs',
  // Email reads
  'list_email_accounts',
  // Proff (external business-registry lookups — read-only)
  'proff_search_companies', 'proff_get_financials', 'proff_get_company_details',
  'proff_get_public_company_info', 'proff_search_persons', 'proff_get_person_details',
  'proff_find_business_network',
])

/**
 * Calculate cost in USD for a completed session.
 * Prices per million tokens (as of 2026-03).
 * Cache tokens cost 10% of input price — we don't distinguish here, so this is a conservative estimate.
 */
function calculateCost(model, inputTokens, outputTokens) {
  if (typeof model === 'string' && model.startsWith('openai/')) return 0
  const PRICES = {
    // Haiku 4.5
    'claude-haiku-4-5-20251001': { in: 0.80, out: 4.00 },
    'claude-haiku-4-5':          { in: 0.80, out: 4.00 },
    // Sonnet 4.6 — stable name preferred. Old -20250514 snapshot was retired
    // by Anthropic on 2026-06-15; keep the entry for historical cost-tracking
    // of older runs but no live caller should resolve to that name.
    'claude-sonnet-4-6':         { in: 3.00, out: 15.00 },
    'claude-sonnet-4-20250514':  { in: 3.00, out: 15.00 },
    // Opus 4.8 — stable name. Same retirement story for the old snapshot.
    'claude-opus-4-8':           { in: 15.00, out: 75.00 },
    'claude-opus-4-6':           { in: 15.00, out: 75.00 },
    'claude-opus-4-20250514':    { in: 15.00, out: 75.00 },
    // Fable
    'claude-fable-5':            { in: 3.00, out: 15.00 },
    // xAI Grok chat path. Keep provider-prefixed IDs in session stats.
    'grok/grok-4.5':             { in: 2.00, out: 6.00 },
    'grok/grok-4.3':             { in: 1.25, out: 2.50 },
    // Fast path
    'fast-path':                 { in: 0, out: 0 },
  }
  const price = PRICES[model] || PRICES[MODELS.HAIKU]
  return ((inputTokens / 1_000_000) * price.in) + ((outputTokens / 1_000_000) * price.out)
}

/**
 * WRITE-AHEAD EVENT LOG — durability for the agent loop.
 *
 * Every model call and every tool run is recorded in STATS_DB.session_events
 * *before* it is attempted, then settled with its outcome afterwards.
 *
 * WHY, given session_tools already exists: session_tools records what FINISHED.
 * When the isolate dies mid-tool (CPU limit, eviction, an executor that never
 * returns) nothing is written at all — the most interesting failures are exactly
 * the invisible ones. A row written ahead of the attempt survives the crash with
 * status='started', so the intent is recoverable and hung tools are queryable
 * (see the queries at the bottom of schema-events.sql).
 *
 * Rules this helper enforces:
 *  - begin() is AWAITED. A log written after the fact is not write-ahead.
 *  - settle() is fire-and-forget. Nothing in the loop waits on an outcome write.
 *  - Every failure is swallowed and logged. Telemetry must never break a run,
 *    and a missing session_events table must not take the agent down — which is
 *    why begin() degrades to a no-op handle instead of throwing.
 *  - Payloads are clipped: tool inputs routinely carry whole HTML documents.
 */
const WAL_PAYLOAD_MAX = 2000

function createEventLog(env, { sessionId, userId, log }) {
  const db = env.STATS_DB || null
  let seq = 0

  const clip = (value) => {
    if (value === undefined || value === null) return null
    let s
    try { s = typeof value === 'string' ? value : JSON.stringify(value) } catch { s = String(value) }
    if (typeof s !== 'string') return null
    return s.length > WAL_PAYLOAD_MAX ? `${s.slice(0, WAL_PAYLOAD_MAX)}… [clipped from ${s.length}]` : s
  }

  // Handle returned when the WAL is unavailable — callers never branch on it.
  const NOOP_HANDLE = { settle: () => {} }

  return {
    /**
     * Record the intent to run something, before running it. Awaited.
     * @returns handle with settle(status, outcome); status ∈ ok | error | blocked
     */
    async begin(kind, name, payload) {
      if (!db) return NOOP_HANDLE
      const id = crypto.randomUUID()
      const mySeq = ++seq
      const started = Date.now()
      try {
        await db.prepare(
          `INSERT INTO session_events (id, session_id, seq, turn, kind, name, payload, started_at, status, user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'started', ?)`
        ).bind(
          id, sessionId, mySeq,
          payload && typeof payload.turn === 'number' ? payload.turn : null,
          kind, name || null, clip(payload),
          new Date(started).toISOString(), userId || null,
        ).run()
      } catch (e) {
        log?.(`[wal] begin ${kind}:${name} failed (non-fatal): ${e.message}`)
        return NOOP_HANDLE
      }
      return {
        settle(status, outcome) {
          try {
            db.prepare(
              `UPDATE session_events SET status = ?, ended_at = ?, duration_ms = ?, outcome = ? WHERE id = ?`
            ).bind(status, new Date().toISOString(), Date.now() - started, clip(outcome), id)
              .run()
              .catch(e => log?.(`[wal] settle ${kind}:${name} failed (non-fatal): ${e.message}`))
          } catch (e) {
            log?.(`[wal] settle ${kind}:${name} threw (non-fatal): ${e.message}`)
          }
        },
      }
    },
  }
}

const OPENAI_MODEL_PREFIX = 'openai/'
const GROK_MODEL_PREFIX = 'grok/'
const OPENAI_AGENT_TOOL_NAMES = [
  // Knowledge graph core
  'read_graph', 'read_graph_content', 'read_node', 'list_graphs', 'list_meta_areas', 'search_graphs',
  'create_graph', 'create_node', 'create_html_node', 'create_html_from_template',
  'patch_node', 'patch_graph_metadata', 'add_edge', 'reorder_nodes',
  // References and HTML node work
  'get_contract', 'get_formatting_reference', 'get_node_types_reference',
  'get_html_builder_reference', 'get_vemotion_reference', 'get_carousel_reference',
  'read_html_section', 'read_html_head', 'list_html_anchors', 'list_html_text',
  'replace_html_section', 'append_to_section', 'insert_in_element', 'insert_html_at',
  'translate_html_node',
  // publish's prerequisite must ride along — a loop with publish but no create_subdomain
  // strands the user on an unroutable host (2026-07-24 themetest failure on the Grok path).
  'publish_html_node', 'create_subdomain', 'list_graph_versions', 'get_graph_version',
  'restore_graph_version', 'restore_html_node_version',
  // Search, media, albums, photos
  'perplexity_search', 'fetch_url', 'search_pexels', 'search_unsplash', 'analyze_image',
  'get_album_images', 'photos_list', 'photos_upload_from_url',
  'album_list', 'album_get', 'album_create_or_update', 'album_add_images',
  'album_remove_images', 'album_publish',
  // Audio, analysis, generation
  'transcribe_audio', 'list_recordings', 'analyze_transcription',
  'upload_audio', 'upload_portfolio_recording',
  'analyze_node', 'analyze_graph', 'generate_with_ai', 'generate_image',
  // Vemotion
  'vemotion_list_compositions', 'vemotion_get_composition', 'vemotion_save_composition',
  'vemotion_refit_composition', 'vemotion_generate_structure', 'vemotion_create_carousel',
  // Data/app tables
  'query_data_nodes', 'get_app_table_schema', 'query_app_table',
  'create_app_table', 'insert_app_record', 'delete_app_records', 'add_app_table_column',
  // Identity, discovery, components, capability workers
  'who_am_i', 'onboarding_status', 'describe_capabilities', 'get_system_registry',
  'run_cloudflare_selftest',
  'list_components', 'get_component', 'list_layouts', 'get_layout',
  'get_secure_worker_template', 'create_capability_blueprint',
  'build_capability_worker_scaffold', 'deploy_worker', 'register_deployed_worker',
  'register_capability_worker', 'read_worker', 'delete_worker', 'invoke_registry_worker',
  // Calendar and email
  'calendar_get_settings', 'calendar_check_availability', 'calendar_list_bookings',
  'calendar_create_booking', 'calendar_reschedule_booking', 'calendar_delete_booking',
  'calendar_get_status',
  'list_email_accounts', 'send_email', 'add_email_account', 'set_email_password',
  'add_email_destination',
  // Challenges
  'list_challenge_templates', 'create_challenge', 'list_challenge_participants',
  'get_participant_graph', 'publish_challenge_page',
  // Subagents
  'delegate_to_kg', 'delegate_to_html_builder', 'delegate_to_albums', 'delegate_to_video',
  'delegate_to_youtube_graph', 'delegate_to_meeting_graph', 'delegate_to_contact', 'delegate_to_chat',
  'delegate_to_bot', 'delegate_to_agent_builder',
  // Norwegian business registry
  'proff_search_companies', 'proff_get_financials', 'proff_get_company_details',
  'proff_get_public_company_info', 'proff_search_persons', 'proff_get_person_details',
  'proff_find_business_network',
]
const OPENAI_AGENT_TOOLS = new Set(OPENAI_AGENT_TOOL_NAMES)

// Tools that MUTATE a knowledge-graph node/graph (they read the version, edit, then patch
// with expectedVersion). These MUST run one-at-a-time — running two on the SAME node in
// parallel races optimistic concurrency (409) and, for nth-based tools, mis-targets after
// the first edit shifts indices. Every code path that batches tool_use blocks filters
// against THIS single set (no per-loop copies that can drift). A test
// (test-sequential-tools.mjs) fails if any KG-writing tool is missing here.
export const SEQUENTIAL_TOOLS = new Set([
  'create_graph', 'create_node', 'create_html_node', 'add_edge',
  'patch_node', 'patch_graph_metadata', 'edit_html_node', 'save_form_data',
  // Deterministic html-node edit/structure tools (node-content mutations).
  'replace_html_section', 'append_to_section', 'insert_html_at', 'insert_in_element',
  'move_html_element', 'remove_html_element', 'apply_layout', 'fill_slot_with_component', 'bind_node_text',
  'translate_html_node',
  'restore_html_node_version', 'restore_graph_version', 'patch_node_metadata', 'remove_node',
  'create_html_from_template', 'save_component', 'save_layout',
  'create_app_table', 'insert_app_record', 'add_user_to_chat_group', 'send_group_message', 'create_chat_group',
  'register_chat_bot', 'trigger_bot_response',
  // Other KG-writing tools (registry writes, analysis-node writes, suggestions, publish/reorder,
  // learnings, world email template) — all patch/add/save a node or graph and therefore race on
  // concurrent same-target execution. Surfaced by test-sequential-tools.mjs (Lesson 65).
  'save_learning', 'reorder_nodes', 'publish_html_node', 'set_world_email_template',
  'add_user_suggestion', 'update_suggestion_status', 'add_whats_new', 'generate_app_showcase',
  'analyze_node', 'analyze_graph', 'analyze_transcription',
  'deploy_worker', 'delete_worker', 'register_capability_worker', 'register_deployed_worker',
  'delegate_to_html_builder', 'delegate_to_kg', 'delegate_to_chat', 'delegate_to_bot',
  'delegate_to_agent_builder', 'delegate_to_video', 'delegate_to_contact', 'delegate_to_youtube_graph',
  'delegate_to_meeting_graph',
  // Both confirmed writers by reading the executors (2026-08-13), not by trusting the test:
  // migrate_app_markers loops patchNodeWithVersionRetry over every app-catalog node, and
  // run_cloudflare_selftest saveGraphWithHistory's its whole fixed report graph with
  // override:true — two concurrent runs of the latter overwrite each other wholesale.
  'migrate_app_markers', 'run_cloudflare_selftest',
])

function isOpenAIModel(model) {
  return typeof model === 'string' && model.startsWith(OPENAI_MODEL_PREFIX)
}

function isGrokModel(model) {
  return typeof model === 'string' && model.startsWith(GROK_MODEL_PREFIX)
}

function isOpenAICompatibleModel(model) {
  return isOpenAIModel(model) || isGrokModel(model)
}

function stripProviderModelPrefix(model, prefix) {
  return String(model || '').startsWith(prefix)
    ? String(model).slice(prefix.length)
    : String(model || '')
}

/**
 * Load and merge all tools: hardcoded + OpenAPI dynamic + web_search
 */
async function loadAllTools(env) {
  let openAPITools = []
  let operationMap = {}
  try {
    const loaded = await loadOpenAPITools(env)
    openAPITools = loaded.tools
    operationMap = loaded.operationMap
  } catch (err) {
    console.error('Failed to load OpenAPI tools:', err)
  }

  const hardcodedNames = new Set(TOOL_DEFINITIONS.map(t => t.name))
  const dynamicTools = openAPITools.filter(t => !hardcodedNames.has(t.name))

  // Remove tools that subagents handle — forces orchestrator to delegate
  // edit_html_node → delegate_to_html_builder
  // KG write tools → delegate_to_kg (reads kept for quick lookups)
  // Chat tools → delegate_to_chat (all chat group management)
  const ORCHESTRATOR_BLOCKED_TOOLS = new Set([
    'edit_html_node',
    'create_graph', 'create_node', 'patch_node', 'add_edge',
    'patch_graph_metadata',
    'list_chat_groups', 'create_chat_group', 'update_chat_group',
    'delete_chat_group', 'restore_chat_group',
    'add_user_to_chat_group', 'get_group_members', 'get_group_messages',
    'get_group_stats', 'send_group_message',
    'create_poll', 'close_poll', 'get_poll_results',
    'chat_db_list_tables', 'chat_db_query',
    'register_chat_bot', 'remove_chat_bot', 'trigger_bot_response',
    'list_bots', 'get_bot', 'update_chat_bot',
    'list_agents', 'get_agent', 'create_agent', 'update_agent',
    'deactivate_agent', 'upload_agent_avatar',
    'list_contacts', 'search_contacts', 'get_contact_logs', 'add_contact_log', 'create_contact',
  ])
  const filteredTools = TOOL_DEFINITIONS.filter(t => !ORCHESTRATOR_BLOCKED_TOOLS.has(t.name))
  // NOTE: WEB_SEARCH_TOOL (Anthropic's native server-side web_search_20250305) is
  // deliberately NOT included. streamingAgentLoop has no server-tool handling — it
  // doesn't resume `pause_turn` and persists bare `server_tool_use` blocks without
  // their `web_search_tool_result`, which the API then rejects on the next turn
  // ("server_tool_use ... without corresponding web_search_tool_result"). The agent
  // uses the client-side perplexity_search tool for web search instead.
  const allTools = [...filteredTools, ...dynamicTools, ...PROFF_TOOLS]

  return { allTools, operationMap }
}

/**
 * Truncate large tool results to prevent context window overflow
 */
function truncateResult(result) {
  let resultStr = JSON.stringify(result)
  const MAX_RESULT_SIZE = 12000

  // Composition payloads (vemotion_get_composition, refit inline) MUST reach
  // Claude intact — a partially-sliced composition would be saved back
  // corrupted, dropping the very layers the user wants preserved. Give them a
  // much larger ceiling and never blind-slice; if a composition is genuinely
  // enormous, surface that as an explicit error instead of silent truncation.
  if (result && typeof result === 'object' && result.composition && Array.isArray(result.composition.layers)) {
    const COMPOSITION_MAX = 120000
    if (resultStr.length <= COMPOSITION_MAX) return resultStr
    return JSON.stringify({
      message: result.message || 'Composition loaded',
      compositionId: result.compositionId || null,
      name: result.name || null,
      version: result.version ?? null,
      layerCount: result.composition.layers.length,
      error: `Composition JSON is ${resultStr.length} chars, over the ${COMPOSITION_MAX}-char limit for in-context editing. Do NOT attempt to rebuild it from memory. Tell the user to edit this one in the Vemotion editor, or ask which specific layers to change.`,
    })
  }

  if (resultStr.length > MAX_RESULT_SIZE) {
    const truncated = JSON.parse(resultStr)
    if (truncated.nodes) {
      truncated.nodes = truncated.nodes.map(n => ({
        ...n,
        info: n.info && n.info.length > 300 ? n.info.slice(0, 300) + '... [truncated]' : n.info,
      }))
    }
    resultStr = JSON.stringify(truncated)
    if (resultStr.length > MAX_RESULT_SIZE) {
      resultStr = resultStr.slice(0, MAX_RESULT_SIZE) + '... [truncated — result too large]'
    }
  }
  return resultStr
}

function buildCapabilityToolPayload(toolName, result) {
  if (!result || typeof result !== 'object') return null

  // Theme picker: when list_theme_graphs returns the themes inside a graph, surface them so the
  // frontend can render clickable theme CARDS (name + colour swatches) instead of a numbered list.
  if (toolName === 'list_theme_graphs' && Array.isArray(result.themes) && result.themes.length) {
    return {
      themeOptions: {
        graphId: result.graphId || null,
        themes: result.themes.map((t) => ({
          nodeId: t.nodeId,
          name: t.name,
          palette: Array.isArray(t.palette) ? t.palette.slice(0, 8) : [],
        })),
      },
    }
  }

  if (toolName === 'create_capability_blueprint') {
    return {
      request: result.request || null,
      capabilityType: result.capabilityType || null,
      templateType: result.templateType || null,
      deliveryMode: result.deliveryMode || null,
      targetScope: result.targetScope || null,
      readyToScaffold: result.readyToScaffold === true,
      requiredQuestions: Array.isArray(result.requiredQuestions) ? result.requiredQuestions : [],
      optionalQuestions: Array.isArray(result.optionalQuestions) ? result.optionalQuestions : [],
      scaffoldDefaults: result.scaffoldDefaults || null,
    }
  }

  if (toolName === 'build_capability_worker_scaffold') {
    return {
      workerName: result.workerName || null,
      templateType: result.templateType || null,
      endpointPath: result.endpointPath || null,
      actionType: result.actionType || null,
      capabilitySummary: result.capabilitySummary || null,
    }
  }

  if (toolName === 'deploy_worker') {
    return {
      workerName: result.workerName || null,
      url: result.url || null,
      deploymentId: result.deploymentId || null,
      modifiedOn: result.modifiedOn || null,
    }
  }

  if (toolName === 'vemotion_save_composition') {
    return {
      compositionId: result.compositionId || null,
      updated: result.updated === true,
      name: result.name || null,
      duration: result.duration ?? null,
      layerCount: result.layerCount ?? null,
      editorUrl: result.editorUrl || null,
      sourceMode: result.sourceMode || null,
      sourceAlbum: result.sourceAlbum || null,
    }
  }

  if (toolName === 'vemotion_get_composition') {
    // Only the lightweight fields reach the frontend; the full composition body
    // is large and is consumed by Claude (for editing), not the chat UI.
    return {
      compositionId: result.compositionId || null,
      name: result.name || null,
      version: result.version ?? null,
      layerCount: result.layerCount ?? null,
      editorUrl: result.editorUrl || null,
    }
  }

  if (toolName === 'vemotion_refit_composition') {
    // mode='saved' has compositionId + editorUrl. mode='inline' has neither
    // (the refit body is on result.composition, large — frontend can show the
    // composition via the existing tc.result truncation if it wants).
    return {
      mode: result.mode || null,
      compositionId: result.compositionId || null,
      name: result.name || null,
      duration: result.duration ?? null,
      layerCount: result.layerCount ?? null,
      width: result.width ?? null,
      height: result.height ?? null,
      editorUrl: result.editorUrl || null,
    }
  }

  return null
}

function getTextContent(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
  }
  return ''
}

function getLatestUserText(messages) {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === 'user') {
      return getTextContent(messages[index].content)
    }
  }
  return ''
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVE TASK TRACKING (L55) — the fix for "the agent forgets what we were doing"
//
// The old code used getLatestUserText() as THE goal and re-injected it in the
// self-check. That breaks the moment the user's latest message is a bare
// acknowledgement: "kjør", "ja", "Jeg er i auto mode". The goal became the
// acknowledgement, the real task (with its graph/node ids) was gone from the
// 10-message window, and the agent asked "what do you want me to do?" while
// standing on a fully specified task (observed 2026-08-21).
//
// deriveActiveTask() separates ACKNOWLEDGEMENT from TASK: it walks the real user
// turns backwards, drops pure acks, and keeps the last few substantive ones.
// buildTaskSlot() renders that (plus every id the user has named) into an
// explicit block the worker fills in — so the ids can never scroll out of the
// history window.
// ─────────────────────────────────────────────────────────────────────────────

// Whole-message acknowledgements. Must match the ENTIRE normalized message —
// "Ja, kopier menyen til node X" is a task, "Ja" is not.
const CONTINUATION_ACK_RE = new RegExp(
  '^(?:' + [
    'ja', 'nei', 'jo', 'ok', 'ok[ae]y', 'yes', 'no', 'yep', 'jepp', 'greit',
    'bra', 'flott', 'perfekt', 'supert', 'fint', 'takk', 'tusen takk',
    'thanks', 'thank you', 'stemmer', 'det stemmer', 'riktig', 'correct',
    'det virker', 'it works', 'works', 'virker', 'den virker',
    'fortsett', 'fortsett da', 'fortsett n[åa]', 'continue', 'proceed',
    'go', 'go ahead', 'go on', 'kj[øo]r', 'kj[øo]r p[åa]', 'run', 'do it',
    'gj[øo]r det', 'vent', 'auto', 'auto mode', 'jeg er i auto mode',
    'ja takk', 'nei takk', 'ok takk', 'ja da', 'det er riktig',
    "i am in auto mode", "i'm in auto mode", 'plan mode',
  ].join('|') + ')[\\s.!?,…]*$',
  'i'
)

function normalizeUserText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

function isContinuationAck(text) {
  const t = normalizeUserText(text)
  if (!t) return true
  // Cheap length guard first: a long message is never a bare ack.
  if (t.length > 40) return false
  return CONTINUATION_ACK_RE.test(t)
}

// Real user turns only. A message with role "user" that carries tool_result
// blocks is the loop feeding itself — not something the human said.
function getUserTurnTexts(messages) {
  const out = []
  for (const m of messages || []) {
    if (!m || m.role !== 'user') continue
    if (Array.isArray(m.content) && m.content.some((b) => b && b.type === 'tool_result')) continue
    const text = normalizeUserText(getTextContent(m.content))
    if (text) out.push(text)
  }
  return out
}

// Ids the user has named, newest first. Node ids are arbitrary slugs
// ("html-interactive-viewer"), so they only count when explicitly labelled.
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const LABELLED_ID_RE = /\b(node|graf|graph)[\s_-]*(?:id)?\s*[:=]\s*`?([A-Za-z0-9][\w.-]{2,80})`?/gi

function collectUserIds(userTexts, limit = 8) {
  const seen = new Map()
  // Newest first: walk the turns in reverse.
  for (let i = userTexts.length - 1; i >= 0; i--) {
    const text = userTexts[i]
    let m
    LABELLED_ID_RE.lastIndex = 0
    while ((m = LABELLED_ID_RE.exec(text)) !== null) {
      const kind = m[1].toLowerCase().startsWith('node') ? 'node' : 'graph'
      const value = m[2]
      if (!seen.has(value)) seen.set(value, kind)
    }
    UUID_RE.lastIndex = 0
    while ((m = UUID_RE.exec(text)) !== null) {
      if (!seen.has(m[0])) seen.set(m[0], 'graph')
    }
    if (seen.size >= limit) break
  }
  return [...seen.entries()].slice(0, limit).map(([value, kind]) => ({ kind, value }))
}

/**
 * The task the user is actually on — not merely their last message.
 *
 * @returns {{ primary: string, priorSteps: string[], latest: string,
 *             latestIsAck: boolean, ids: {kind: string, value: string}[] }}
 *   primary      — the most recent SUBSTANTIVE user request (the goal)
 *   priorSteps   — up to 2 earlier substantive turns, oldest first (the setup)
 *   latest       — the raw latest user text (may be "kjør")
 *   latestIsAck  — true when the latest message only says "go ahead"
 */
function deriveActiveTask(messages, options = {}) {
  const maxPriorSteps = options.maxPriorSteps ?? 3
  const userTexts = getUserTurnTexts(messages)
  const latest = userTexts.length ? userTexts[userTexts.length - 1] : ''
  const substantive = userTexts.filter((t) => !isContinuationAck(t))
  // Fallback: if the user has ONLY ever acknowledged, the ack is the request.
  const primary = substantive.length ? substantive[substantive.length - 1] : latest
  const priorSteps = substantive.slice(Math.max(0, substantive.length - 1 - maxPriorSteps), substantive.length - 1)
  return {
    primary,
    priorSteps,
    latest,
    latestIsAck: isContinuationAck(latest),
    ids: collectUserIds(userTexts),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HISTORY WINDOW (L88) — count TOKENS, not messages, and guarantee user turns
//
// The old window was `messages.slice(-10)`. A message is not a unit of meaning:
// every tool call costs TWO of them (assistant tool_use + user tool_result), so
// five reads evicted the entire conversation while a ten-turn chat of one-liners
// used a fraction of the same budget. Worse, the eviction was blind to WHAT was
// being dropped — a 12KB tool_result and the user's correction cost the same one
// slot, and the tool_result usually won on recency.
//
// buildHistoryWindow() fixes both halves:
//   C — size the window by estimated tokens, and compact the payloads of OLDER
//       tool_results first, so verbose reads stop evicting conversation.
//   B — never close the window before it holds MIN_USER_TURNS real user turns,
//       regardless of how many tool messages sit between them.
//
// We still do NOT pin messages[0] (L54: a pinned one-shot imperative gets
// re-executed every turn). The goal travels in the ACTIVE TASK system block.
// ─────────────────────────────────────────────────────────────────────────────

// ~4 chars per token. Deliberately rough: this budgets a window, it does not bill.
function estimateTokens(content) {
  if (content == null) return 0
  const text = typeof content === 'string' ? content : JSON.stringify(content)
  return Math.ceil(text.length / 4)
}

// A real user turn. A "user" message carrying tool_result blocks is the loop
// feeding itself, and must not count toward the user-turn guarantee.
function isCleanUserTurn(message) {
  if (!message || message.role !== 'user') return false
  return !(Array.isArray(message.content) && message.content.some((b) => b && b.type === 'tool_result'))
}

// Older tool_results are evidence already acted upon: the decision they drove is
// in the assistant text that followed. Keep the head of the payload (ids, status,
// error) and drop the body.
function compactToolResults(message, maxChars) {
  if (!message || !Array.isArray(message.content)) return message
  let changed = false
  const content = message.content.map((block) => {
    if (!block || block.type !== 'tool_result') return block
    const text = typeof block.content === 'string' ? block.content : null
    if (text === null || text.length <= maxChars) return block
    changed = true
    return { ...block, content: text.slice(0, maxChars) + `… [${text.length - maxChars} chars trimmed from history]` }
  })
  return changed ? { ...message, content } : message
}

// The OpenAI/Grok path keeps its own flat message array and never dropped anything.
// Dropping messages there is riskier (an assistant `tool_calls` must keep its matching
// `tool` replies), so apply only the safe half of C: shrink the payload of OLDER tool
// replies. No message is removed, nothing is reordered, the system message stays first.
function compactOpenAIToolMessages(messages, options = {}) {
  const recentFull = options.recentFull ?? 6
  const maxChars = options.maxChars ?? 400
  const cutoff = messages.length - recentFull
  return messages.map((m, i) => {
    if (i >= cutoff || !m || m.role !== 'tool') return m
    if (typeof m.content !== 'string' || m.content.length <= maxChars) return m
    return { ...m, content: m.content.slice(0, maxChars) + `… [${m.content.length - maxChars} chars trimmed from history]` }
  })
}

/**
 * The message window sent to the model.
 *
 * @returns {{ messages: object[], tokens: number, userTurns: number, dropped: number, compacted: boolean }}
 */
function buildHistoryWindow(messages, options = {}) {
  const tokenBudget = options.tokenBudget ?? 24000
  const minUserTurns = options.minUserTurns ?? 3
  const maxMessages = options.maxMessages ?? 40
  const recentFull = options.recentFull ?? 6
  const oldToolResultChars = options.oldToolResultChars ?? 400

  // C: compact the payloads of tool_results outside the most recent exchanges.
  const cutoff = messages.length - recentFull
  let compacted = false
  const prepared = messages.map((m, i) => {
    if (i >= cutoff) return m
    const next = compactToolResults(m, oldToolResultChars)
    if (next !== m) compacted = true
    return next
  })

  // Walk backwards. Stop only once BOTH the token budget is spent AND the
  // user-turn floor is met — the floor is what keeps the human in the window.
  let tokens = 0
  let userTurns = 0
  let start = prepared.length
  for (let i = prepared.length - 1; i >= 0; i--) {
    const kept = prepared.length - i
    const cost = estimateTokens(prepared[i].content)
    const budgetSpent = tokens + cost > tokenBudget && userTurns >= minUserTurns
    if (kept > 1 && (budgetSpent || kept > maxMessages)) break
    tokens += cost
    start = i
    if (isCleanUserTurn(prepared[i])) userTurns++
  }

  // The Anthropic API requires the window to begin on a "user" message and
  // forbids an orphaned tool_result whose tool_use parent was trimmed away.
  while (start < prepared.length && !isCleanUserTurn(prepared[start])) start++

  let window = prepared.slice(start)
  if (window.length === 0) {
    // Fallback: everything from the last clean user turn, else the last message.
    for (let i = prepared.length - 1; i >= 0; i--) {
      if (isCleanUserTurn(prepared[i])) { window = prepared.slice(i); break }
    }
    if (window.length === 0) window = prepared.slice(-1)
  }

  return {
    messages: window,
    tokens: window.reduce((sum, m) => sum + estimateTokens(m.content), 0),
    userTurns: window.filter(isCleanUserTurn).length,
    dropped: messages.length - window.length,
    compacted,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHANTOM-WRITE DETECTION (2026-09-02)
//
// "Image 2 appended to the gallery grid — Urd no 2. Now at v35." — no tool was
// called. The graph was untouched, v35 already belonged to an earlier edit, and the
// user only found out by looking at the page ("I can not see the 2 images"). It
// happened three times in one session.
//
// The other guards ask whether the USER requested a write. This asks whether the
// ASSISTANT claimed one, which catches the fabrication however the request was
// phrased. Both signals are required — a version claim AND an action verb — so
// reporting a version that was merely read ("the page is on v37") does not trip it.
// ─────────────────────────────────────────────────────────────────────────────
const WRITE_TOOL_PREFIX_RE = /^(create_|add_|patch_|insert_|append_|replace_|remove_|move_|edit_|delete_|apply_layout|translate_html_node|restore_|publish_|save_|set_|upload_|setup_|deploy_|delegate_to_kg|delegate_to_html_builder)/

function claimsUnbackedWrite(text, toolCallNames) {
  const t = String(text || '')
  // The emphasis characters matter: every real fabrication was written "now at **v35**",
  // and a pattern that did not step over the markdown matched none of them.
  const claimsVersion = /\b(?:now at|now on|nå på|saved as|lagret som|updated to|oppdatert til)\s*[*_`~\s]*v(?:ersion)?[.\s*_`~]*\d+/i.test(t)
  if (!claimsVersion) return false
  const claimsAction = /\b(added|appended|inserted|updated|replaced|removed|saved|created|fixed|corrected|lagt til|lagret|oppdatert|fikset|endret)\b/i.test(t)
  if (!claimsAction) return false
  return !(toolCallNames || []).some((name) => WRITE_TOOL_PREFIX_RE.test(String(name || '')))
}

const TASK_SLOT_HEADING = '## ACTIVE TASK (filled in by the worker — this is fact, do not guess)'

/**
 * The explicit task slot (fix D). Rendered into the system prompt every request
 * so the goal and its ids survive the MAX_HISTORY window, which a long tool loop
 * fills with its own messages in ~5 calls.
 */
function buildTaskSlot(activeTask, options = {}) {
  if (!activeTask || !activeTask.primary) return ''
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
  const lines = [TASK_SLOT_HEADING]
  lines.push(`Current request: "${clip(activeTask.primary, 500)}"`)
  if (activeTask.priorSteps.length) {
    lines.push('Earlier steps of the same task (oldest first):')
    for (const step of activeTask.priorSteps) lines.push(`  - "${clip(step, 300)}"`)
  }
  if (activeTask.ids.length) {
    lines.push('IDs the user has named (newest first): ' +
      activeTask.ids.map((id) => `${id.kind}=${id.value}`).join(' · '))
  }
  const ctx = []
  if (options.graphId) ctx.push(`graphId=${options.graphId}`)
  if (options.activeHtmlNodeId) ctx.push(`activeHtmlNodeId=${options.activeHtmlNodeId}`)
  if (ctx.length) lines.push(`Selected context in the UI: ${ctx.join(' ')} (this is the UI selection, NOT necessarily the task target — the IDs above win)`)
  if (activeTask.latestIsAck) {
    lines.push(`The user's latest message ("${clip(activeTask.latest, 60)}") is an acknowledgement, not a new request. It means: proceed with the current request above.`)
  }
  lines.push('This block is authoritative. Never answer "what do you want me to do?" or ask the user to repeat ids while it is filled in — the task and its ids are right here.')
  return lines.join('\n')
}

function isGraphWriteIntent(userText) {
  const text = String(userText || '').toLowerCase()
  if (!text) return false
  const writeVerb = /(create|build|make|generate|add|write|compose|patch|update|modify)/
  const graphTarget = /(graph|knowledge graph|node|nodes)/
  return writeVerb.test(text) && graphTarget.test(text)
}

function isExplicitCreateGraphIntent(userText) {
  const text = String(userText || '').toLowerCase()
  if (!text) return false
  const createVerb = /(create|build|make|generate)/
  const graphTarget = /(graph|knowledge graph)/
  const discoveryOnly = /(find|search|list|show|browse|explore|retrieve)/
  return createVerb.test(text) && graphTarget.test(text) && !discoveryOnly.test(text)
}

// Calendar detection is two-tier on purpose. The old single regex matched bare substrings,
// so ordinary English tripped it: "List the tools AVAILABLE on the MCP server" was classified
// as a calendar question, the guard below then demanded a calendar_ tool that would never be
// called, and the turn budget burned out emitting nothing (observed 2026-07-28).
//
// STRONG = unambiguous calendar vocabulary; triggers on its own.
const CALENDAR_STRONG = /\b(calendar|calandar|appointment|appointments)\b/
// WEAK = everyday words that only mean "calendar" alongside a time reference or a personal
// possessive. "tools available" must NOT trigger; "available on Friday" / "my schedule" must.
const CALENDAR_WEAK = /\b(meeting|meetings|booking|bookings|schedule|scheduled|scheduling|availability|available|busy|free time)\b/
const CALENDAR_PERSONAL = /\b(my|our|i|me)\b/

function textMentionsCalendar(text) {
  const s = String(text || '').toLowerCase()
  if (CALENDAR_STRONG.test(s)) return true
  if (!CALENDAR_WEAK.test(s)) return false
  return textMentionsDateOrRelativeTime(s) || CALENDAR_PERSONAL.test(s)
}

function textMentionsDateOrRelativeTime(text) {
  return /(today|tomorrow|tonight|yesterday|this week|next week|this month|next month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2})/.test(String(text || '').toLowerCase())
}

function hasRecentCalendarContext(messages) {
  const recent = messages.slice(-8)
  for (const message of recent) {
    if (message.role === 'user' && textMentionsCalendar(getTextContent(message.content))) {
      return true
    }
    if (!Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (block?.type === 'tool_use' && typeof block.name === 'string' && block.name.startsWith('calendar_')) {
        return true
      }
    }
  }
  return false
}

function isCalendarQueryIntent(messages) {
  const latest = getLatestUserText(messages)
  if (!latest) return false
  if (textMentionsCalendar(latest)) return true
  if (textMentionsDateOrRelativeTime(latest) && hasRecentCalendarContext(messages.slice(0, -1))) {
    return true
  }
  return false
}

function hasCalendarToolUseSince(messages, startIndex = 0) {
  for (const message of messages.slice(startIndex)) {
    if (!Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (block?.type === 'tool_use' && typeof block.name === 'string' && block.name.startsWith('calendar_')) {
        return true
      }
    }
  }
  return false
}

function countGraphWriteCompletions(messages) {
  let count = 0
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue
    for (const block of m.content) {
      if (!block || block.type !== 'tool_result') continue
      if (typeof block.content !== 'string') continue
      try {
        const parsed = JSON.parse(block.content)
        if (parsed && (parsed.graphId || parsed.nodeId || parsed.viewUrl)) {
          count++
        }
      } catch {
        // ignore malformed tool payloads
      }
    }
  }
  return count
}

function hasGraphWriteVerification(messages, startIndex = 0) {
  const GRAPH_WRITE_TOOLS = new Set([
    'delegate_to_kg',
    'create_graph',
    'create_node',
    'patch_node',
    'add_edge',
    'remove_node',
    'patch_graph_metadata',
    'kg_add_node',
    'kg_patch_node',
    'kg_remove_node',
  ])
  const GRAPH_VERIFY_TOOLS = new Set(['read_graph', 'read_node', 'read_graph_content', 'kg_get_know_graph'])

  let needsVerification = false

  for (const message of messages.slice(startIndex)) {
    if (!Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (!block || block.type !== 'tool_use') continue
      const toolName = block.name
      if (GRAPH_WRITE_TOOLS.has(toolName)) {
        needsVerification = true
        continue
      }
      if (needsVerification && GRAPH_VERIFY_TOOLS.has(toolName)) {
        return true
      }
    }
  }

  return !needsVerification
}

function hasGraphWriteCompletion(messages) {
  return countGraphWriteCompletions(messages) > 0
}

function sanitizeOpenAIJsonSchema(schema, depth = 0) {
  if (!schema || typeof schema !== 'object') return { type: 'object', properties: {} }
  if (Array.isArray(schema)) return schema.map((item) => sanitizeOpenAIJsonSchema(item, depth + 1))

  const allowedKeys = new Set([
    'type', 'description', 'properties', 'required', 'items', 'enum',
    'additionalProperties', 'minimum', 'maximum', 'minLength', 'maxLength',
    'minItems', 'maxItems',
  ])
  const out = {}
  for (const [key, value] of Object.entries(schema)) {
    if (value === undefined) continue
    if (!allowedKeys.has(key)) continue
    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      out.properties = {}
      for (const [propName, propSchema] of Object.entries(value)) {
        out.properties[propName] = sanitizeOpenAIJsonSchema(propSchema, depth + 1)
      }
      continue
    }
    if (key === 'items') {
      out.items = sanitizeOpenAIJsonSchema(value, depth + 1)
      continue
    }
    if (key === 'additionalProperties' && value && typeof value === 'object') {
      out.additionalProperties = sanitizeOpenAIJsonSchema(value, depth + 1)
      continue
    }
    out[key] = value
  }

  if (depth === 0) {
    out.type = 'object'
    if (!out.properties || typeof out.properties !== 'object' || Array.isArray(out.properties)) out.properties = {}
    if (Array.isArray(out.required)) {
      const props = new Set(Object.keys(out.properties))
      out.required = out.required.filter((name) => props.has(name))
    }
  }
  return out
}

function toOpenAITool(tool) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || tool.name,
      parameters: sanitizeOpenAIJsonSchema(tool.input_schema || { type: 'object', properties: {} }),
    },
  }
}

function toOpenAIMessage(message) {
  const content = getTextContent(message.content)
  if (message.role === 'assistant') return { role: 'assistant', content }
  return { role: message.role === 'user' ? 'user' : 'user', content }
}

function parseOpenAIToolArgs(raw) {
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function streamingOpenAIAgentLoop(writer, encoder, messages, systemPrompt, userId, env, options) {
  const maxTurns = options.maxTurns || 6
  const selectedModel = options.model || `${OPENAI_MODEL_PREFIX}gpt-5.6-luna`
  const provider = isGrokModel(selectedModel)
    ? {
        name: 'grok',
        label: 'Grok',
        binding: env.GROK_WORKER,
        bindingName: 'GROK_WORKER',
        url: 'https://grok.vegvisr.org/chat',
        prefix: GROK_MODEL_PREFIX,
        maxTokenField: 'max_tokens',
      }
    : {
        name: 'openai',
        label: 'OpenAI',
        binding: env.OPENAI_WORKER,
        bindingName: 'OPENAI_WORKER',
        url: 'https://openai.vegvisr.org/chat',
        prefix: OPENAI_MODEL_PREFIX,
        maxTokenField: 'max_completion_tokens',
      }
  const providerModel = stripProviderModelPrefix(selectedModel, provider.prefix)
  const authContext = options?.authContext || null
  const planMode = options.mode === 'plan'
  const startTime = Date.now()
  const sessionId = crypto.randomUUID()
  let turn = 0
  const stats = { inputTokens: 0, outputTokens: 0, toolCalls: [], success: true, error: null, maxTurnsReached: false }

  // "Create a new graph" protection for the OpenAI/Grok path. Unlike the Claude path (which
  // removes create_node/patch_* from the orchestrator → delegate_to_kg mints a fresh graph),
  // this path exposes those write tools DIRECTLY. With the current context graphId injected in
  // the prompt, the model would otherwise patch the context graph's title + add nodes to it
  // instead of making a NEW graph. contextGraphId = the currently-selected graph; requiresNewGraph
  // = the user explicitly asked to create a graph (tightened regex so "create a NODE in this
  // graph" does NOT trigger); createdGraphId = the id create_graph returns this turn.
  const contextGraphId = options.graphId || null
  // Same active-task treatment as the Claude path (L55): an ack must not become the goal.
  const activeTask = deriveActiveTask(messages)
  const taskSlot = buildTaskSlot(activeTask, {
    graphId: options.graphId,
    activeHtmlNodeId: options.activeHtmlNodeId,
  })
  const latestUserText = activeTask.latestIsAck ? activeTask.primary : (activeTask.latest || getLatestUserText(messages))
  const requiresNewGraph = /\b(create|build|make|generate|start)\s+(a\s+|an\s+|the\s+)?(new\s+)?(knowledge\s+)?graph\b/i.test(latestUserText) || /\bnew graph\b/i.test(latestUserText)
  let createdGraphId = null
  const GRAPH_WRITE_TOOLS = new Set(['create_node', 'create_html_node', 'add_edge', 'patch_node', 'patch_graph_metadata'])

  const log = (msg) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`[${provider.name}-agent-loop +${elapsed}s] ${msg}`)
  }
  const wal = createEventLog(env, { sessionId, userId, log })

  try {
    if (!provider.binding) throw new Error(`${provider.bindingName} service binding is not configured.`)

    let { allTools, operationMap } = await loadAllTools(env)
    allTools = allTools.filter((tool) => OPENAI_AGENT_TOOLS.has(tool.name))
    const openAIAllowedTools = new Set(allTools.map((tool) => tool.name))
    const openAITools = allTools.map(toOpenAITool)

    const openAIToolPrompt =
      `${systemPrompt}\n\n` +
      `## ${provider.label} AgentChat Tooling\n` +
      `You are running through the ${provider.label} provider path. This path exposes an expanded but curated AgentChat toolbox (${allTools.length} tools) across knowledge graphs, HTML editing, media, Vemotion, data, calendar, email, capability workers, subagents, and Proff lookup.\n` +
      `Use the available function tools when they are needed. If a user asks for a capability that is not available in this ${provider.label} tool list, say that this provider path does not expose that specific tool yet and offer to switch to a Claude model for the full orchestrator toolbox.` +
      (taskSlot ? `\n\n${taskSlot}` : '')

    const openAIMessages = [
      { role: 'system', content: openAIToolPrompt },
      ...messages.map(toOpenAIMessage).filter((m) => m.content && m.content.trim()),
    ]

    log(`started | model=${selectedModel} providerModel=${providerModel} maxTurns=${maxTurns} mode=${planMode ? 'PLAN' : 'auto'} tools=${allTools.length}`)

    while (turn < maxTurns) {
      turn++
      writer.write(encoder.encode(`event: thinking\ndata: ${JSON.stringify({ turn })}\n\n`))

      const requestBody = {
        userId,
        model: providerModel,
        messages: compactOpenAIToolMessages(openAIMessages),
        temperature: 0.3,
        tools: openAITools,
        tool_choice: 'auto',
        [provider.maxTokenField]: 4096,
      }

      // Write-ahead: the intent to call the model lands before the call is made,
      // so a turn that never returns is still visible as status='started'.
      const modelEvent = await wal.begin('model_call', selectedModel, {
        turn,
        provider: provider.name,
        providerModel,
        messages: openAIMessages.length,
        tools: openAITools.length,
        mode: planMode ? 'plan' : 'auto',
      })

      const response = await provider.binding.fetch(provider.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })

      const data = await response.json().catch(() => ({}))
      modelEvent.settle(response.ok ? 'ok' : 'error', response.ok
        ? {
            finish_reason: data.choices?.[0]?.finish_reason ?? null,
            tool_calls: (data.choices?.[0]?.message?.tool_calls || []).length,
            prompt_tokens: data.usage?.prompt_tokens ?? data.usage?.input_tokens ?? null,
            completion_tokens: data.usage?.completion_tokens ?? data.usage?.output_tokens ?? null,
          }
        : { status: response.status, error: data.error ?? null })
      if (data.usage) {
        stats.inputTokens += data.usage.prompt_tokens || data.usage.input_tokens || 0
        stats.outputTokens += data.usage.completion_tokens || data.usage.output_tokens || 0
      }

      if (!response.ok) {
        const detail = typeof data.error === 'string' ? data.error : JSON.stringify(data.error || data)
        stats.success = false
        stats.error = detail || `${provider.label} API error`
        writer.write(encoder.encode(`event: text\ndata: ${JSON.stringify({ content: `The ${provider.label} provider returned an error: ${stats.error}` })}\n\n`))
        writer.write(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: stats.error })}\n\n`))
        writer.write(encoder.encode(`event: done\ndata: ${JSON.stringify({ turns: turn, error: true })}\n\n`))
        break
      }

      const choice = data.choices?.[0] || {}
      const message = choice.message || {}
      const assistantText = typeof message.content === 'string' ? message.content : ''
      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : []

      if (assistantText.trim()) {
        writer.write(encoder.encode(`event: text\ndata: ${JSON.stringify({ content: assistantText })}\n\n`))
      }

      openAIMessages.push({
        role: 'assistant',
        content: assistantText || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      })

      if (!toolCalls.length) {
        writer.write(encoder.encode(`event: done\ndata: ${JSON.stringify({ turns: turn })}\n\n`))
        break
      }

      for (const call of toolCalls) {
        const functionCall = call.function || {}
        const toolName = functionCall.name
        const input = parseOpenAIToolArgs(functionCall.arguments)
        stats.toolCalls.push(toolName)

        // Write-ahead: the model's PROPOSED call is logged before any gate runs, so
        // blocked intent is on the record too (a gate that fires unexpectedly is a
        // failure mode worth seeing).
        const toolEvent = await wal.begin('tool_call', toolName, { turn, input })

        if (!openAIAllowedTools.has(toolName)) {
          const message = `The OpenAI AgentChat path did not expose "${toolName}" in this request. Available OpenAI tools include: ${Array.from(openAIAllowedTools).slice(0, 40).join(', ')}${openAIAllowedTools.size > 40 ? ', ...' : ''}.`
          toolEvent.settle('blocked', `not exposed on the ${provider.name} path`)
          writer.write(encoder.encode(`event: tool_result\ndata: ${JSON.stringify({ callId: call.id, tool: toolName, success: false, summary: message })}\n\n`))
          openAIMessages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: message }) })
          continue
        }

        if (planMode && !READ_ONLY_TOOLS.has(toolName)) {
          const message = `PLAN MODE is active (read-only). The "${toolName}" tool was not executed. Present a concise plan instead.`
          toolEvent.settle('blocked', 'Plan mode (read-only)')
          writer.write(encoder.encode(`event: tool_result\ndata: ${JSON.stringify({ callId: call.id, tool: toolName, success: false, summary: 'Blocked — Plan mode (read-only).' })}\n\n`))
          openAIMessages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ blocked: true, planMode: true, message }) })
          continue
        }

        // Once create_graph has run this turn, redirect any graph-write that has no graphId
        // (or still points at the context graph) to the NEW graph — so the model can't keep
        // appending nodes to the context graph after making a new one.
        if (createdGraphId && GRAPH_WRITE_TOOLS.has(toolName) && (!input.graphId || input.graphId === contextGraphId)) {
          log(`redirected ${toolName} from ${input.graphId || 'unset'} to new graph ${createdGraphId}`)
          input.graphId = createdGraphId
        }
        // On an explicit "create a new graph" request, refuse to mutate the CONTEXT graph before
        // create_graph has run — otherwise the model overwrites the current graph's title and adds
        // nodes to it instead of making a new one.
        if (requiresNewGraph && !createdGraphId && GRAPH_WRITE_TOOLS.has(toolName) && (!input.graphId || input.graphId === contextGraphId)) {
          const message = `This request is to create a NEW graph, but "${toolName}" would modify the current context graph${contextGraphId ? ` (${contextGraphId})` : ''}. Call create_graph FIRST — it returns a new graphId — then use THAT id for create_node / add_edge / patch_node. Do NOT patch or add to the context graph.`
          log(`blocked ${toolName} on context graph before create_graph (explicit new-graph intent)`)
          toolEvent.settle('blocked', 'would mutate the context graph before create_graph ran')
          writer.write(encoder.encode(`event: tool_result\ndata: ${JSON.stringify({ callId: call.id, tool: toolName, success: false, summary: message })}\n\n`))
          openAIMessages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: message }) })
          continue
        }

        const toolStart = Date.now()
        // callId is the model's own tool-call id, echoed on tool_call/tool_progress/
        // tool_result so the UI can pair them exactly. Without it the client matched a
        // result to the last RUNNING call of the same name, which rotates results
        // between parallel calls (three read_graph_content calls showed each other's
        // graphs — 2026-09-02).
        writer.write(encoder.encode(`event: tool_call\ndata: ${JSON.stringify({ callId: call.id, tool: toolName, input })}\n\n`))
        const onProgress = (msg) => {
          writer.write(encoder.encode(`event: tool_progress\ndata: ${JSON.stringify({ callId: call.id, tool: toolName, message: msg })}\n\n`))
        }

        try {
          const result = await executeTool(toolName, { ...input, userId, authContext }, env, operationMap, onProgress)
          // Capture a freshly-created graph id so subsequent writes this turn target it, not the context graph.
          if (toolName === 'create_graph' && result && result.success !== false && result.graphId) {
            createdGraphId = result.graphId
            log(`create_graph → new graphId ${createdGraphId} (subsequent writes will target it)`)
          }
          if (result.inputTokens) stats.inputTokens += result.inputTokens
          if (result.outputTokens) stats.outputTokens += result.outputTokens

          const toolFailed = !!(result && result.success === false)
          const summary = (typeof result.message === 'string' && result.message.trim())
            ? result.message
            : (typeof result.summary === 'string' && result.summary.trim())
              ? result.summary
              : (toolFailed && typeof result.error === 'string' && result.error.trim())
                ? result.error
                : `${toolName} ${toolFailed ? 'failed' : 'completed'}`

          toolEvent.settle(toolFailed ? 'error' : 'ok', summary)

          if (env.STATS_DB) {
            const toolDuration = Date.now() - toolStart
            env.STATS_DB.prepare(
              `INSERT INTO session_tools (id, session_id, tool_name, subagent, template_id, graph_id, node_id, success, duration_ms, occurred_at, model)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
              crypto.randomUUID(), sessionId, toolName,
              null, null,
              result.graphId || input.graphId || null,
              result.nodeId || input.nodeId || null,
              toolFailed ? 0 : 1,
              toolDuration, new Date().toISOString(), selectedModel,
            ).run().catch(e => console.error('[stats] openai tool insert failed:', e.message))
          }

          const ssePayload = { callId: call.id, tool: toolName, success: !toolFailed, summary }
          if (toolFailed && typeof result.error === 'string') ssePayload.error = result.error
          const capabilityPayload = buildCapabilityToolPayload(toolName, result)
          if (capabilityPayload) Object.assign(ssePayload, capabilityPayload)
          if (result.nodeId) ssePayload.nodeId = result.nodeId
          if (result.graphId) ssePayload.graphId = result.graphId
          if ((toolName === 'edit_html_node' || toolName === 'replace_html_section') && result.updatedHtml) {
            ssePayload.updatedHtml = result.updatedHtml
          }
          if (toolName === 'set_world_email_template' && result.html) {
            ssePayload.html = result.html
          }
          if (result.clientSideRequired) {
            ssePayload.clientSideRequired = true
            ssePayload.audioUrl = result.audioUrl
            ssePayload.language = result.language
            ssePayload.recordingId = result.recordingId
            ssePayload.saveToGraph = result.saveToGraph || false
            ssePayload.graphTitle = result.graphTitle || null
          }
          if (toolName === 'list_challenge_templates' && Array.isArray(result.templates)) {
            ssePayload.templates = result.templates
          }
          writer.write(encoder.encode(`event: tool_result\ndata: ${JSON.stringify(ssePayload)}\n\n`))
          const resultForOpenAI = { ...result }
          delete resultForOpenAI.updatedHtml
          openAIMessages.push({ role: 'tool', tool_call_id: call.id, content: truncateResult(resultForOpenAI) })
        } catch (error) {
          const toolDuration = Date.now() - toolStart
          toolEvent.settle('error', error.message)
          if (env.STATS_DB) {
            env.STATS_DB.prepare(
              `INSERT INTO session_tools (id, session_id, tool_name, subagent, success, duration_ms, occurred_at, model)
               VALUES (?, ?, ?, ?, 0, ?, ?, ?)`
            ).bind(
              crypto.randomUUID(), sessionId, toolName, null,
              toolDuration, new Date().toISOString(), selectedModel,
            ).run().catch(e => console.error('[stats] openai tool insert failed:', e.message))
          }
          writer.write(encoder.encode(`event: tool_result\ndata: ${JSON.stringify({ callId: call.id, tool: toolName, success: false, error: error.message })}\n\n`))
          openAIMessages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: error.message }) })
        }
      }
    }

    if (turn >= maxTurns) {
      stats.maxTurnsReached = true
      const stopMsg = `Stopped after ${turn} turns (the limit for this request) — the task may not be finished. Reply "continue" to resume, or tell me what to do differently.`
      writer.write(encoder.encode(`event: text\ndata: ${JSON.stringify({ content: stopMsg })}\n\n`))
      writer.write(encoder.encode(`event: done\ndata: ${JSON.stringify({ turns: turn, maxReached: true })}\n\n`))
    }
  } catch (err) {
    stats.success = false
    stats.error = err.message
    log(`FATAL ERROR: ${err.message}`)
    writer.write(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`))
  } finally {
    const durationMs = Date.now() - startTime
    if (env.STATS_DB) {
      const now = new Date().toISOString()
      await env.STATS_DB.prepare(
        `INSERT INTO sessions (id, user_id, started_at, ended_at, duration_ms, turns, fast_path, model,
          input_tokens, output_tokens, tool_calls, success, error, agent_id, max_turns_reached, version, version_note, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        sessionId, userId || 'unknown',
        new Date(startTime).toISOString(), now, durationMs,
        turn, selectedModel,
        stats.inputTokens, stats.outputTokens,
        JSON.stringify(stats.toolCalls),
        stats.success ? 1 : 0,
        stats.error || null,
        options.agentId || null,
        stats.maxTurnsReached ? 1 : 0,
        options.version || null,
        options.versionNote || null,
        calculateCost(selectedModel, stats.inputTokens, stats.outputTokens),
      ).run()
    }
    writer.close()
  }
}

/**
 * Streaming agent loop — writes SSE events to a TransformStream writer
 */
async function streamingAgentLoop(writer, encoder, messages, systemPrompt, userId, env, options) {
  const maxTurns = options.maxTurns || 8
  const model = options.model || DEFAULT_MODEL
  if (isOpenAICompatibleModel(model)) {
    return streamingOpenAIAgentLoop(writer, encoder, messages, systemPrompt, userId, env, options)
  }
  const authContext = options?.authContext || null
  const planMode = options.mode === 'plan'
  let turn = 0
  let functionalGateRetries = 0
  const startTime = Date.now()
  const sessionId = crypto.randomUUID()
  // Fix A: the GOAL is the latest SUBSTANTIVE user request, not the latest message.
  // "kjør" / "ja" / "Jeg er i auto mode" are acknowledgements of the standing task.
  const activeTask = deriveActiveTask(messages, { graphId: options.graphId })
  const latestUserRequest = activeTask.primary || getLatestUserText(messages)
  // Intent detection reads the acknowledged task only when the latest message IS an
  // ack — otherwise a new message always wins, so a finished task can never re-fire.
  const intentText = activeTask.latestIsAck ? activeTask.primary : activeTask.latest
  const requiresGraphWrite = isGraphWriteIntent(intentText)
  const requiresCreateGraph = isExplicitCreateGraphIntent(intentText)
  const requiresCalendarQuery = isCalendarQueryIntent(messages)
  const graphWriteCompletionBaseline = countGraphWriteCompletions(messages)
  const graphWriteVerificationStartIndex = messages.length
  const calendarQueryStartIndex = messages.length
  const taskSlot = buildTaskSlot(activeTask, {
    graphId: options.graphId,
    activeHtmlNodeId: options.activeHtmlNodeId,
  })

  // Stats accumulation — written to STATS_DB in finally block
  const stats = { inputTokens: 0, outputTokens: 0, toolCalls: [], success: true, error: null, maxTurnsReached: false }

  const log = (msg) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`[agent-loop +${elapsed}s] ${msg}`)
  }
  const wal = createEventLog(env, { sessionId, userId, log })

  let { allTools, operationMap } = await loadAllTools(env)

  // Filter tools per-agent if toolFilter provided
  if (options.toolFilter && options.toolFilter.length > 0) {
    const allowed = new Set(options.toolFilter)
    allTools = allTools.filter(t => allowed.has(t.name))
    log(`tool filter applied: ${options.toolFilter.length} allowed → ${allTools.length} tools`)
  }

  // A guard that DEMANDS a tool must not fire when that tool isn't in the toolbox.
  // The intent flags above are computed from the user's text alone, before toolFilter is
  // applied — so in a restricted context (EXCLUSIVE_CONTEXTS) they can demand a tool the
  // model was never given. That is unsatisfiable: the guard blocks end_turn every turn,
  // burns the whole turn budget, and emits NO text, so the user sees silence instead of a
  // refusal. Gate each guard on the tool actually being available.
  const availableToolNames = new Set(allTools.map(t => t.name))
  const GRAPH_WRITE_TOOLS = ['delegate_to_kg', 'create_graph', 'create_node', 'patch_node', 'add_edge', 'remove_node', 'create_html_node', 'create_html_from_template']
  const canWriteGraph = GRAPH_WRITE_TOOLS.some(n => availableToolNames.has(n))
  const canQueryCalendar = [...availableToolNames].some(n => n.startsWith('calendar_'))
  if (requiresGraphWrite && !canWriteGraph) {
    log('graph-write guard DISABLED — no graph-write tool in this toolbox (restricted context)')
  }
  if (requiresCalendarQuery && !canQueryCalendar) {
    log('calendar guard DISABLED — no calendar_ tool in this toolbox (restricted context)')
  }
  const enforceGraphWrite = requiresGraphWrite && canWriteGraph
  const enforceCalendarQuery = requiresCalendarQuery && canQueryCalendar

  // Retry caps. An end_turn guard nudges the model once or twice — it must never be able to
  // consume the whole turn budget, because a blocked end_turn also SKIPS text emission, so an
  // over-eager guard shows the user nothing at all while costing a full run of model calls.
  // After the cap the guard stands down and the turn is allowed to finish and speak.
  const MAX_GUARD_RETRIES = 2
  let phantomWriteRetries = 0
  let graphWriteGuardRetries = 0
  let graphVerifyGuardRetries = 0
  let calendarGuardRetries = 0

  log(`started | model=${model} maxTurns=${maxTurns} mode=${planMode ? 'PLAN' : 'auto'} tools=${allTools.length} userId=${userId?.slice(0,8)}...`)
  log(`active task${activeTask.latestIsAck ? ' (latest msg is an ACK — carrying the standing task)' : ''}: "${activeTask.primary.slice(0, 120)}" | ids=[${activeTask.ids.map(i => `${i.kind}=${i.value}`).join(', ')}]`)

  try {
    // Emit agent identity info if available (avatar, etc.)
    if (options.avatarUrl) {
      writer.write(encoder.encode(`event: agent_info\ndata: ${JSON.stringify({ avatarUrl: options.avatarUrl })}\n\n`))
    }

    while (turn < maxTurns) {
      turn++
      log(`turn ${turn}/${maxTurns} — calling Anthropic`)
      writer.write(encoder.encode(`event: thinking\ndata: ${JSON.stringify({ turn })}\n\n`))

      // Size the history window by estimated TOKENS, not message count, and never close
      // it before it holds a floor of real user turns — a tool call costs two messages, so
      // the old slice(-10) let five reads evict the whole conversation (L88).
      // We intentionally DO NOT pin messages[0]: when the first conversation message is a
      // one-shot imperative (e.g. "set the token on post@universi.no"), pinning it makes the
      // model re-execute that command on every later turn and narrate "re-read the original
      // request" (observed 2026-07-13, L54). Goal continuity instead comes from the ACTIVE
      // TASK slot in the system prompt (built once per request, OUTSIDE this window) plus the
      // self-check below — both carry the latest SUBSTANTIVE request, not merely the latest
      // message. See deriveActiveTask()/buildTaskSlot() (L55).
      // The Anthropic API rejects the ENTIRE conversation when a tool_use went
      // unanswered — one bad turn poisons every later request until the run dies
      // (2026-09-02). Repair the live history first, so both this call and the
      // window built from it are well-formed. Idempotent; no-op when clean.
      const repairedPairs = repairToolPairing(messages)
      if (repairedPairs > 0) log(`repaired ${repairedPairs} unanswered tool_use block(s) before send`)

      const historyWindow = buildHistoryWindow(messages, {
        tokenBudget: options.historyTokenBudget ?? 24000,
        minUserTurns: options.historyMinUserTurns ?? 3,
      })
      let cappedMessages = [...historyWindow.messages]
      if (historyWindow.dropped > 0 || historyWindow.compacted) {
        log(`history window: ${historyWindow.messages.length}/${messages.length} msgs, ~${historyWindow.tokens} tok, ${historyWindow.userTurns} user turn(s)${historyWindow.compacted ? ', old tool_results compacted' : ''}`)
      }

      // Self-check at every 3rd turn: inject a progress review instruction.
      // No extra API call — appended to the last user message so the next response includes reflection.
      if (turn > 1 && (turn % 3 === 0 || turn === 2)) {
        const last = cappedMessages[cappedMessages.length - 1]
        const selfCheck = `\n\n[SELF-CHECK turn ${turn}: Review progress against the user's latest unresolved request: "${latestUserRequest.slice(0, 300)}". If you are repeating the same failed pattern, switch approach now. Do not drift back to older questions from earlier in the conversation. Do not narrate internal process like "I have not done anything yet" or "now I will" unless you are blocked. If the task is done, summarize only the completed result.]`
        if (last && last.role === 'user') {
          if (typeof last.content === 'string') {
            cappedMessages[cappedMessages.length - 1] = { ...last, content: last.content + selfCheck }
          } else if (Array.isArray(last.content)) {
            cappedMessages[cappedMessages.length - 1] = { ...last, content: [...last.content, { type: 'text', text: selfCheck }] }
          }
          log(`injected self-check at turn ${turn}`)
        }
      }

      // Write-ahead: the intent to call the model lands before the call is made, so a
      // turn that never returns (isolate death, upstream hang) is still visible as
      // status='started'. Message BODIES are deliberately not logged — count only.
      const modelEvent = await wal.begin('model_call', model, {
        turn,
        messages: cappedMessages.length,
        tools: allTools.length,
        maxTokens: 16384,
        mode: planMode ? 'plan' : 'auto',
      })

      const response = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          apiKey: env.ANTHROPIC_API_KEY || undefined,
          messages: cappedMessages,
          model,
          max_tokens: 16384,
          temperature: 0.3,
          system: taskSlot
            ? [
                { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
                { type: 'text', text: taskSlot },
              ]
            : systemPrompt,
          tools: allTools,
        }),
      })

      const data = await response.json()
      modelEvent.settle(response.ok ? 'ok' : 'error', response.ok
        ? {
            stop_reason: data.stop_reason ?? null,
            blocks: (data.content || []).length,
            input_tokens: data.usage?.input_tokens ?? null,
            output_tokens: data.usage?.output_tokens ?? null,
          }
        : { status: response.status, error: data.error ?? null })
      log(`turn ${turn} response: status=${response.status} stop_reason=${data.stop_reason} content_blocks=${(data.content||[]).length}`)

      // Accumulate token usage across turns
      if (data.usage) {
        stats.inputTokens += data.usage.input_tokens || 0
        stats.outputTokens += data.usage.output_tokens || 0
      }

      if (!response.ok) {
        log(`ERROR: Anthropic API error — ${JSON.stringify(data.error || 'unknown')}`)
        stats.success = false
        stats.error = JSON.stringify(data.error || 'Anthropic API error')
        // Surface a READABLE message in the chat (event: text renders as assistant content; event:
        // error does not). For the out-of-credits case show "API Refund needed" so the operator
        // knows it's billing, not a bug. Then close cleanly with done so the UI doesn't show a bare
        // stream error.
        // data.error shape varies by failure path (object with .message, plain string, or
        // something else entirely) — assuming .message always exists silently swallowed the
        // real reason and fell back to the generic "Anthropic API error" (2026-07-31, same
        // bug class as the kg-subagent.js fix, just not caught here until now).
        const errMsg = typeof data.error === 'string'
          ? data.error
          : (data.error && typeof data.error.message === 'string' && data.error.message)
            ? data.error.message
            : JSON.stringify(data.error || {})
        const isCredit = /credit balance is too low|insufficient.*credit|too low to access/i.test(errMsg)
        const friendly = isCredit
          ? '⚠️ API Refund needed — the Anthropic API credit balance is too low to run the agent. Top up at console.anthropic.com (Plans & Billing), then retry. This is a billing issue, not a code error.'
          : `⚠️ The AI service returned an error: ${errMsg || 'Anthropic API error'}`
        writer.write(encoder.encode(`event: text\ndata: ${JSON.stringify({ content: friendly })}\n\n`))
        writer.write(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: data.error || 'Anthropic API error', refundNeeded: isCredit })}\n\n`))
        writer.write(encoder.encode(`event: done\ndata: ${JSON.stringify({ turns: turn, error: true })}\n\n`))
        break
      }

      if (data.stop_reason === 'end_turn') {
        // PHANTOM-WRITE GUARD (2026-09-02). Three times in one session the agent
        // answered "Image 2 appended to the gallery — now at v35" having called no
        // tool at all; the user had to notice each time ("I can not see the 2 images",
        // "You did not add the last one"). The existing guards ask "did the USER ask
        // for a write?" — this one asks "did the ASSISTANT claim one?", which catches
        // the fabrication regardless of how the request was phrased. Fires only when a
        // version/save claim AND an action verb are both present, so reporting a
        // version read from the graph ("the page is on v37") does not trip it.
        if (phantomWriteRetries < MAX_GUARD_RETRIES) {
          const finalText = (data.content || []).filter(c => c.type === 'text').map(b => b.text).join('\n')
          if (claimsUnbackedWrite(finalText, stats.toolCalls)) {
            phantomWriteRetries++
            log(`end_turn blocked: claimed a saved version with NO write tool this request (retry ${phantomWriteRetries}/${MAX_GUARD_RETRIES})`)
            messages.push(
              { role: 'assistant', content: data.content },
              { role: 'user', content: 'STOP — you just told the user something was saved at a version number, but you did not call a single write tool during this request. Nothing was written and that version does not exist. Do the actual write now with the right tool (insert_in_element / replace_html_section / append_to_section / create_node …), read the tool result, and report ONLY the version the tool actually returned. If you cannot do the write, say plainly that nothing was saved.' }
            )
            continue
          }
        }

        // Guardrail: if user asked for graph creation/modification but no write was completed,
        // force one continuation turn with a direct tool-routing reminder.
        if (enforceGraphWrite && graphWriteGuardRetries < MAX_GUARD_RETRIES && countGraphWriteCompletions(messages) <= graphWriteCompletionBaseline) {
          graphWriteGuardRetries++
          log(`end_turn blocked: graph write requested but no graph-write completion detected; forcing continuation (retry ${graphWriteGuardRetries}/${MAX_GUARD_RETRIES})`)
          messages.push(
            { role: 'assistant', content: data.content },
            { role: 'user', content: 'You have not completed the requested graph write yet. Use delegate_to_kg now to perform the creation/update action before ending your turn.' }
          )
          continue
        }

        if (enforceGraphWrite && graphVerifyGuardRetries < MAX_GUARD_RETRIES && !hasGraphWriteVerification(messages, graphWriteVerificationStartIndex)) {
          graphVerifyGuardRetries++
          log(`end_turn blocked: graph write completed but no verification read detected; forcing continuation (retry ${graphVerifyGuardRetries}/${MAX_GUARD_RETRIES})`)
          messages.push(
            { role: 'assistant', content: data.content },
            { role: 'user', content: 'The graph write is not verified yet. Read the affected graph or node now with read_node, read_graph, or read_graph_content and confirm the exact change before ending your turn.' }
          )
          continue
        }

        if (enforceCalendarQuery && calendarGuardRetries < MAX_GUARD_RETRIES && !hasCalendarToolUseSince(messages, calendarQueryStartIndex)) {
          calendarGuardRetries++
          log(`end_turn blocked: calendar/date question answered without fresh calendar tool call; forcing continuation (retry ${calendarGuardRetries}/${MAX_GUARD_RETRIES})`)
          messages.push(
            { role: 'assistant', content: data.content },
            { role: 'user', content: 'This calendar answer is not grounded yet. Call the appropriate calendar_ tool now for the requested date or follow-up date and answer from that result only.' }
          )
          continue
        }

        // FUNCTIONAL COHERENCE GATE (Lesson 48) — direct-edit path counterpart of the
        // subagent's gate. If the active html-node has a feature that is PRESENT but not
        // WIRED (dead theme toggle, loaded-but-unapplied font, unused icon font), block
        // end_turn and force the agent to fix it before finishing. Only fires when this
        // turn actually touched an html-node tool, so it never nags on non-HTML chats.
        if (options.graphId && options.activeHtmlNodeId && functionalGateRetries < 2 &&
            stats.toolCalls.some(t => /html|append_to_section|insert_in_element|insert_html_at/i.test(t))) {
          let gaps = []
          try {
            const gateHtml = await fetchNodeHtmlForGate(env, options.graphId, options.activeHtmlNodeId)
            gaps = detectFunctionalGaps(gateHtml)
            const dead = await detectDeadEndpoints(gateHtml)
            if (dead.length) gaps = gaps.concat(dead)
          }
          catch (e) { log(`functional gate read failed: ${e.message}`) }
          if (gaps.length) {
            functionalGateRetries++
            log(`functional gate: ${gaps.length} gap(s) on ${options.activeHtmlNodeId} — forcing continuation (retry ${functionalGateRetries})`)
            messages.push(
              { role: 'assistant', content: data.content },
              { role: 'user', content: `Not done — a functional check found feature(s) that are PRESENT but do NOT WORK on "${options.activeHtmlNodeId}". Fix each on the node, then finish:\n${gaps.map(g => '- ' + g).join('\n')}\nMake the actual change so the feature functions (wire the handler / apply the font / add the glyphs) — do not just reply that it is done.` }
            )
            continue
          }
        }

        const textBlocks = (data.content || []).filter(c => c.type === 'text')
        const textLen = textBlocks.reduce((sum, b) => sum + b.text.length, 0)
        log(`end_turn — ${textBlocks.length} text blocks (${textLen} chars)`)
        for (const block of textBlocks) {
          writer.write(encoder.encode(`event: text\ndata: ${JSON.stringify({ content: block.text })}\n\n`))
        }

        // Generate follow-up suggestions using a fast Haiku call
        // Skip if no assistant text (pure tool-call turns produce no useful suggestions)
        try {
          const lastAssistantText = textBlocks.map(b => b.text).join('\n')
          if (!lastAssistantText.trim()) throw new Error('no text — skip suggestions')
          const recentContext = messages.slice(-4).map(m => {
            let content
            if (typeof m.content === 'string') {
              content = m.content
            } else if (Array.isArray(m.content)) {
              content = m.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
              const imgCount = m.content.filter(b => b.type === 'image').length
              if (imgCount > 0) content = `[${imgCount} image(s)] ${content}`
            } else {
              content = JSON.stringify(m.content)
            }
            return `${m.role}: ${content.slice(0, 300)}`
          }).join('\n')

          // The suggestions call is a real model call and a real token spend — it belongs
          // in the log like any other, so a session's cost reconciles against its events.
          const suggestEvent = await wal.begin('model_call', MODELS.HAIKU, { turn, purpose: 'suggestions' })
          const suggestRes = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId,
              apiKey: env.ANTHROPIC_API_KEY || undefined,
              messages: [{
                role: 'user',
                content: `Based on this conversation context and the assistant's last response, suggest exactly 3 short follow-up prompts the user might want to ask next. Each should be a natural next step, question, or action. Return ONLY a JSON array of 3 strings, no explanation.\n\nRecent conversation:\n${recentContext}\n\nAssistant's response:\n${lastAssistantText.slice(0, 500)}`
              }],
              model: MODELS.HAIKU,
              max_tokens: 256,
              temperature: 0.7,
            }),
          })

          suggestEvent.settle(suggestRes.ok ? 'ok' : 'error', { status: suggestRes.status })

          if (suggestRes.ok) {
            const suggestData = await suggestRes.json()
            const suggestText = (suggestData.content || []).find(c => c.type === 'text')?.text || ''
            const jsonMatch = suggestText.match(/\[[\s\S]*\]/)
            if (jsonMatch) {
              const suggestions = JSON.parse(jsonMatch[0])
              if (Array.isArray(suggestions) && suggestions.length > 0) {
                const cleaned = suggestions.slice(0, 3).map(s => String(s).trim()).filter(s => s.length > 0)
                if (cleaned.length > 0) {
                  log(`suggestions generated: ${cleaned.length}`)
                  writer.write(encoder.encode(`event: suggestions\ndata: ${JSON.stringify({ suggestions: cleaned })}\n\n`))
                }
              }
            }
          }
        } catch (sugErr) {
          log(`suggestions generation failed (non-fatal): ${sugErr.message}`)
        }

        writer.write(encoder.encode(`event: done\ndata: ${JSON.stringify({ turns: turn })}\n\n`))
        break
      }

      if (data.stop_reason === 'tool_use') {
        const toolUses = (data.content || []).filter(c => c.type === 'tool_use')
        const textBlocks = (data.content || []).filter(c => c.type === 'text')

        // Accumulate tool calls for stats
        for (const t of toolUses) stats.toolCalls.push(t.name)

        log(`tool_use — ${toolUses.length} tools: [${toolUses.map(t => t.name).join(', ')}]`)

        for (const block of textBlocks) {
          writer.write(encoder.encode(`event: text\ndata: ${JSON.stringify({ content: block.text })}\n\n`))
        }

        // Graph-mutating tools must run sequentially to avoid D1 read-modify-write race conditions
        // SEQUENTIAL_TOOLS is the single module-level set (defined near the top) — no per-loop copy.
        const sequentialTools = toolUses.filter(t => SEQUENTIAL_TOOLS.has(t.name))
        const parallelTools = toolUses.filter(t => !SEQUENTIAL_TOOLS.has(t.name))
        let inferredGraphId = null

        const GRAPH_ID_AWARE_TOOLS = new Set([
          'create_node',
          'create_html_node',
          'add_edge',
          'patch_node',
          'patch_graph_metadata',
          'read_graph',
          'read_graph_content',
          'read_node',
          'delegate_to_kg',
        ])

        const executeAndStream = async (toolUse) => {
          // Write-ahead: the model's PROPOSED call is logged before any gate runs and
          // before the input is rewritten by the auto-injection below — the record is
          // what the model asked for, which is what you need when diagnosing a run.
          // Blocked intent is logged too: a gate firing unexpectedly is a failure mode.
          const toolEvent = await wal.begin('tool_call', toolUse.name, { turn, input: toolUse.input })

          // PLAN MODE gate — fail-closed. Block anything not on the read-only allowlist.
          // The tool never runs; the model is told to propose a plan and stop.
          if (planMode && !READ_ONLY_TOOLS.has(toolUse.name)) {
            const message = `PLAN MODE is active (read-only). The "${toolUse.name}" tool makes changes and was NOT executed. Do not retry it or any other write/create/modify/generate/delegate tool. Instead, present a concise step-by-step PLAN of exactly what you would do — which tools, in what order, on which graph/nodes/data — and then STOP and wait. The user will switch to Auto mode to approve and run it.`
            log(`PLAN MODE blocked ${toolUse.name}`)
            toolEvent.settle('blocked', 'Plan mode (read-only)')
            writer.write(encoder.encode(`event: tool_result\ndata: ${JSON.stringify({ callId: toolUse.id, tool: toolUse.name, success: false, summary: 'Blocked — Plan mode (read-only). Proposed, not executed.' })}\n\n`))
            return { type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify({ blocked: true, planMode: true, message }) }
          }

          const GRAPH_DISCOVERY_TOOLS = new Set(['search_graphs', 'list_graphs'])
          if (
            requiresCreateGraph
            && countGraphWriteCompletions(messages) <= graphWriteCompletionBaseline
            && GRAPH_DISCOVERY_TOOLS.has(toolUse.name)
          ) {
            const message = 'This request is to create a new graph. Call create_graph first, then create_node/add_edge as needed. Do not search existing graphs first.'
            log(`blocked ${toolUse.name} before create_graph for explicit create request`)
            toolEvent.settle('blocked', 'graph discovery before create_graph on an explicit create request')
            writer.write(encoder.encode(`event: tool_result\ndata: ${JSON.stringify({ callId: toolUse.id, tool: toolUse.name, success: false, summary: message })}\n\n`))
            return { type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify({ error: message }) }
          }

          if (!toolUse.input) toolUse.input = {}
          if (!toolUse.input.graphId && inferredGraphId && GRAPH_ID_AWARE_TOOLS.has(toolUse.name)) {
            toolUse.input.graphId = inferredGraphId
            log(`auto-injected graphId=${inferredGraphId} into ${toolUse.name} (same-turn carry-over)`)
          }

          // Auto-inject nodeId into HTML builder delegation (HTML edits always target a specific node)
          const DELEGATION_TOOLS = new Set(['delegate_to_kg', 'delegate_to_html_builder', 'delegate_to_chat', 'delegate_to_bot', 'delegate_to_agent_builder', 'delegate_to_video', 'delegate_to_youtube_graph', 'delegate_to_meeting_graph'])
          if (DELEGATION_TOOLS.has(toolUse.name)) {
            // NOTE: Do NOT auto-inject graphId into delegations. The LLM must explicitly include graphId
            // when it wants the subagent to work on a specific graph. If omitted, the subagent is free to
            // create new graphs. Auto-injection was causing "create new graph" requests to silently
            // add content to the last-used graph instead.
            if (!toolUse.input.nodeId && options.activeHtmlNodeId && toolUse.name === 'delegate_to_html_builder') {
              toolUse.input.nodeId = options.activeHtmlNodeId
              log(`auto-injected nodeId=${options.activeHtmlNodeId} into ${toolUse.name}`)
            }
            // Auto-inject transcription content into delegate_to_kg tasks
            // The KG subagent is stateless and cannot see conversation history,
            // so we must pass transcription text explicitly in the task field.
            if (toolUse.name === 'delegate_to_kg') {
              for (let mi = messages.length - 1; mi >= 0; mi--) {
                const msgContent = getTextContent(messages[mi].content)
                // Match tagged messages (new frontend) OR legacy "**Audio Transcription**" messages
                const hasTag = msgContent.includes('[TRANSCRIPTION_AVAILABLE')
                const hasLegacy = msgContent.includes('**Audio Transcription**')
                if (hasTag || hasLegacy) {
                  let transcriptionText = ''
                  if (hasTag) {
                    const tagEnd = msgContent.indexOf(']\n', msgContent.indexOf('[TRANSCRIPTION_AVAILABLE'))
                    transcriptionText = tagEnd >= 0 ? msgContent.slice(tagEnd + 2).trim() : ''
                  } else {
                    // Legacy format: skip the first line (header) and extract the rest
                    const lines = msgContent.split('\n')
                    const bodyStart = lines.findIndex((l, i) => i > 0 && l.trim().length > 0)
                    transcriptionText = bodyStart >= 0 ? lines.slice(bodyStart).join('\n').trim() : ''
                  }
                  if (transcriptionText.length > 100) {
                    toolUse.input.task += '\n\n## TRANSCRIPTION CONTENT (from conversation — use this as the node info field):\n' + transcriptionText
                    log(`auto-injected ${transcriptionText.length} chars of transcription into delegate_to_kg task`)
                  }
                  break
                }
              }
            }
          }
          const toolStart = Date.now()
          log(`executing ${toolUse.name} (input: ${JSON.stringify(toolUse.input).slice(0, 200)})`)
          // callId is the model's own tool_use id, echoed on tool_call/tool_progress/
          // tool_result so the UI can pair them exactly. Without it the client matched a
          // result to the last RUNNING call of the same name — with tools running in
          // parallel that rotates the results between calls, and the chat log shows each
          // call carrying another call's answer (2026-09-02).
          writer.write(encoder.encode(`event: tool_call\ndata: ${JSON.stringify({ callId: toolUse.id, tool: toolUse.name, input: toolUse.input })}\n\n`))
          // Progress callback for long-running tools
          const onProgress = (msg) => {
            writer.write(encoder.encode(`event: tool_progress\ndata: ${JSON.stringify({ callId: toolUse.id, tool: toolUse.name, message: msg })}\n\n`))
          }
          try {
            const result = await executeTool(toolUse.name, { ...toolUse.input, userId, authContext }, env, operationMap, onProgress)
            if (result?.graphId) {
              inferredGraphId = result.graphId
            }
            // Summary must be a string. Some tools (e.g. bot_send_message) return
            // result.message as an OBJECT (the created chat-message record), which
            // would crash the frontend renderer (React #31). Fall through to the
            // tool name when result.message isn't a usable string.
            // Executors signal failure by RETURNING { success: false, error } (not throwing).
            // Propagate that — never report a non-throwing failure as success (Lesson 1).
            const toolFailed = !!(result && result.success === false)
            const summary = (typeof result.message === 'string' && result.message.trim())
              ? result.message
              : (typeof result.summary === 'string' && result.summary.trim())
                ? result.summary
                : (toolFailed && typeof result.error === 'string' && result.error.trim())
                  ? result.error
                  : `${toolUse.name} ${toolFailed ? 'failed' : 'completed'}`
            const resultLen = JSON.stringify(result).length
            const toolDuration = Date.now() - toolStart
            log(`${toolUse.name} ${toolFailed ? 'returned FAILURE' : 'OK'} (${(toolDuration / 1000).toFixed(1)}s, ${resultLen} chars)`)
            toolEvent.settle(toolFailed ? 'error' : 'ok', summary)

            // Roll subagent tokens into parent session totals
            if (result.inputTokens) stats.inputTokens += result.inputTokens
            if (result.outputTokens) stats.outputTokens += result.outputTokens

            // Record tool call in session_tools
            if (env.STATS_DB) {
              const subagent = toolUse.name.startsWith('delegate_to_') ? toolUse.name.replace('delegate_to_', '') : null
              const templateId = toolUse.name === 'create_html_from_template' ? (toolUse.input.templateId || null) : null
              // For delegation tools use the subagent's model; for direct tools use the orchestrator model
              const toolModel = result.model || model
              env.STATS_DB.prepare(
                `INSERT INTO session_tools (id, session_id, tool_name, subagent, template_id, graph_id, node_id, success, duration_ms, occurred_at, model)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).bind(
                crypto.randomUUID(), sessionId, toolUse.name,
                subagent, templateId,
                result.graphId || toolUse.input.graphId || null,
                result.nodeId || toolUse.input.nodeId || null,
                toolFailed ? 0 : 1,
                toolDuration, new Date().toISOString(), toolModel
              ).run().catch(e => console.error('[stats] tool insert failed:', e.message))
            }

            const ssePayload = { callId: toolUse.id, tool: toolUse.name, success: !toolFailed, summary }
            if (toolFailed && typeof result.error === 'string') ssePayload.error = result.error
            const capabilityPayload = buildCapabilityToolPayload(toolUse.name, result)
            if (capabilityPayload) Object.assign(ssePayload, capabilityPayload)
            // Pass nodeId and graphId for tools that create or edit HTML nodes
            if (result.nodeId) ssePayload.nodeId = result.nodeId
            if (result.graphId) ssePayload.graphId = result.graphId
            // Pass updatedHtml for every html-editing tool that returns it so the frontend
            // can refresh the preview. Previously only edit_html_node/replace_html_section were
            // wired, so the section/structural tools the prompt now recommends (append_to_section,
            // insert_html_at, insert_in_element, move/remove_html_element, apply_layout) saved but
            // left the preview stale — reading to the user as "the agent did nothing".
            const HTML_EDIT_TOOLS_WITH_HTML = new Set([
              'edit_html_node', 'replace_html_section', 'append_to_section',
              'insert_html_at', 'insert_in_element', 'move_html_element',
              'remove_html_element', 'apply_layout', 'fill_slot_with_component',
              'bind_node_text', 'translate_html_node', 'delegate_to_html_builder',
            ])
            if (HTML_EDIT_TOOLS_WITH_HTML.has(toolUse.name) && result.updatedHtml) {
              ssePayload.updatedHtml = result.updatedHtml
            }

            // Syntax-check the page after every mutation, and tell the MODEL, not just the user.
            // The subagent has done this since it was written; the main loop never did, so an
            // agent editing directly got "saved as vNN — verified by splice" for a page whose
            // JavaScript no longer parsed. It read that as success and moved on; the breakage
            // surfaced later as a blank tab or a console error the agent could not see.
            // Costs no extra turn: the verdict rides along on the tool result it belongs to.
            if (HTML_EDIT_TOOLS_WITH_HTML.has(toolUse.name) && result.success !== false && toolUse.input?.graphId && toolUse.input?.nodeId) {
              try {
                const val = await executeValidateHtmlSyntax(
                  { graphId: toolUse.input.graphId, nodeId: toolUse.input.nodeId }, env,
                )
                if (val && val.valid === false) {
                  result.syntaxValid = false
                  result.syntaxIssues = (val.issues || []).slice(0, 5).map(i => i.message)
                  result.message = `${result.message || ''}\n\n⚠ SYNTAX BROKEN after this edit — ${val.issueCount} issue(s): ${result.syntaxIssues.join('; ')}. The page will NOT run as written. Fix this before doing anything else, and before telling the user it is done.`
                  log(`auto-validate after ${toolUse.name}: ${val.issueCount} issue(s)`)
                } else if (val) {
                  result.syntaxValid = true
                }
              } catch (e) {
                log(`auto-validate after ${toolUse.name} failed: ${e.message}`)
              }
            }
            // Pass the email body for set_world_email_template so the frontend can open it in HtmlPreview
            if (toolUse.name === 'set_world_email_template' && result.html) {
              ssePayload.html = result.html
            }
            // Pass clientSideRequired data to frontend so it can handle transcription
            if (result.clientSideRequired) {
              ssePayload.clientSideRequired = true
              ssePayload.audioUrl = result.audioUrl
              ssePayload.language = result.language
              ssePayload.recordingId = result.recordingId
              ssePayload.saveToGraph = result.saveToGraph || false
              ssePayload.graphTitle = result.graphTitle || null
            }
            // Pass templates array so AgentChat can render the iframe picker
            if (toolUse.name === 'list_challenge_templates' && Array.isArray(result.templates)) {
              ssePayload.templates = result.templates
            }
            writer.write(encoder.encode(`event: tool_result\ndata: ${JSON.stringify(ssePayload)}\n\n`))
            // Strip large fields that are only for the frontend (not needed by Claude)
            const resultForClaude = { ...result }
            delete resultForClaude.updatedHtml
            const resultStr = truncateResult(resultForClaude)
            return { type: 'tool_result', tool_use_id: toolUse.id, content: resultStr }
          } catch (error) {
            const toolDuration = Date.now() - toolStart
            log(`${toolUse.name} FAILED (${(toolDuration / 1000).toFixed(1)}s): ${error.message}`)
            toolEvent.settle('error', error.message)
            if (env.STATS_DB) {
              env.STATS_DB.prepare(
                `INSERT INTO session_tools (id, session_id, tool_name, subagent, success, duration_ms, occurred_at, model)
                 VALUES (?, ?, ?, ?, 0, ?, ?, ?)`
              ).bind(
                crypto.randomUUID(), sessionId, toolUse.name,
                toolUse.name.startsWith('delegate_to_') ? toolUse.name.replace('delegate_to_', '') : null,
                toolDuration, new Date().toISOString(), model
              ).run().catch(e => console.error('[stats] tool insert failed:', e.message))
            }
            writer.write(encoder.encode(`event: tool_result\ndata: ${JSON.stringify({ callId: toolUse.id, tool: toolUse.name, success: false, error: error.message })}\n\n`))
            return { type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify({ error: error.message }) }
          }
        }

        // Phase 1: Run graph-mutating tools sequentially (one at a time) to prevent race conditions
        const sequentialResults = []
        for (const toolUse of sequentialTools) {
          sequentialResults.push(await executeAndStream(toolUse))
        }
        // Phase 2: Run all other tools in parallel (safe — they don't mutate graph state concurrently)
        const parallelResults = await Promise.all(parallelTools.map(executeAndStream))
        const toolResults = [...sequentialResults, ...parallelResults]

        // Fix 4: Strip large `info` fields from graph read results before storing in history.
        // Graph nodes can be 10-50K chars each; keeping them in history inflates every subsequent turn.
        const trimmedResults = toolResults.map(r => {
          try {
            const parsed = JSON.parse(r.content)
            if (parsed.nodes) {
              parsed.nodes = parsed.nodes.map(n => n.info && n.info.length > 500
                ? { ...n, info: n.info.slice(0, 500) + '… [trimmed from history]' }
                : n)
              return { ...r, content: JSON.stringify(parsed) }
            }
          } catch {}
          return r
        })

        messages.push(
          { role: 'assistant', content: data.content },
          { role: 'user', content: trimmedResults },
        )
      } else if (data.stop_reason === 'max_tokens') {
        log(`max_tokens hit on turn ${turn} — sending continuation`)
        const textBlocks = (data.content || []).filter(c => c.type === 'text')
        for (const block of textBlocks) {
          writer.write(encoder.encode(`event: text\ndata: ${JSON.stringify({ content: block.text })}\n\n`))
        }
        messages.push(
          { role: 'assistant', content: data.content },
          { role: 'user', content: 'Continue. Do not repeat what you already said.' },
        )
      } else {
        log(`unexpected stop_reason: ${data.stop_reason}`)
        writer.write(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: 'Unexpected stop: ' + data.stop_reason })}\n\n`))
        break
      }
    }

    if (turn >= maxTurns) {
      stats.maxTurnsReached = true
      log(`max turns reached (${maxTurns})`)
      // Silently closing here reads as the agent just stopping with no explanation —
      // the user has no way to tell "finished" from "ran out of budget mid-task"
      // (2026-07-31, recurring confusion). State it plainly and ask.
      const stopMsg = `Stopped after ${turn} turns (the limit for this request) — the task may not be finished. Reply "continue" to resume, or tell me what to do differently.`
      writer.write(encoder.encode(`event: text\ndata: ${JSON.stringify({ content: stopMsg })}\n\n`))
      writer.write(encoder.encode(`event: done\ndata: ${JSON.stringify({ turns: turn, maxReached: true })}\n\n`))
    }
  } catch (err) {
    stats.success = false
    stats.error = err.message
    log(`FATAL ERROR: ${err.message}\n${err.stack}`)
    writer.write(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`))
  } finally {
    const durationMs = Date.now() - startTime
    log(`stream closed — ${turn} turns, ${(durationMs / 1000).toFixed(1)}s total, tokens in=${stats.inputTokens} out=${stats.outputTokens}`)
    writer.close()

    // Write session stats to STATS_DB — awaited so it completes before waitUntil context closes
    if (env.STATS_DB) {
      const now = new Date().toISOString()
      const costUsd = calculateCost(model, stats.inputTokens, stats.outputTokens)
      await env.STATS_DB.prepare(
        `INSERT INTO sessions (id, user_id, started_at, ended_at, duration_ms, turns, fast_path, model,
          input_tokens, output_tokens, tool_calls, success, error, agent_id, max_turns_reached, version, version_note, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        sessionId, userId || 'unknown',
        new Date(startTime).toISOString(), now, durationMs,
        turn, model,
        stats.inputTokens, stats.outputTokens,
        JSON.stringify(stats.toolCalls),
        stats.success ? 1 : 0,
        stats.error || null,
        options.agentId || null,
        stats.maxTurnsReached ? 1 : 0,
        options.version || null,
        options.versionNote || null,
        costUsd
      ).run()
    }
  }
}

/**
 * Execute agent with task (non-streaming, returns execution log)
 */
async function executeAgent(agentConfig, userTask, userId, env, options = {}) {
  let taskWithContract = userTask
  if (agentConfig.default_contract_id) {
    taskWithContract = `${userTask}\n\n[Default contract: ${agentConfig.default_contract_id}]`
  }

  const messages = [{ role: 'user', content: taskWithContract }]
  const requiresGraphWrite = isGraphWriteIntent(taskWithContract)
  const requiresCreateGraph = isExplicitCreateGraphIntent(taskWithContract)
  const requiresCalendarQuery = isCalendarQueryIntent(messages)
  const graphWriteVerificationStartIndex = messages.length
  const calendarQueryStartIndex = messages.length
  const graphWriteCompletionBaseline = countGraphWriteCompletions(messages)

  const { allTools, operationMap } = await loadAllTools(env)
  const authContext = options?.authContext || null

  const executionLog = []
  let turn = 0
  const maxTurns = agentConfig.max_turns || 5
  const model = agentConfig.model || DEFAULT_MODEL

  // The in-memory executionLog above is returned to the caller and dies with the
  // request. The WAL is the durable half: /execute runs unattended (cron, automation),
  // so when one dies mid-tool the session_events rows are the only surviving trace.
  const sessionId = crypto.randomUUID()
  const wal = createEventLog(env, {
    sessionId,
    userId,
    log: (m) => console.log(`[execute-agent] ${m}`),
  })

  while (turn < maxTurns) {
    turn++

    executionLog.push({
      turn,
      type: 'agent_thinking',
      timestamp: new Date().toISOString()
    })

    // Same invariant as the /chat loop: no unanswered tool_use may reach the API.
    repairToolPairing(messages)

    const modelEvent = await wal.begin('model_call', model, {
      turn,
      messages: messages.length,
      tools: allTools.length,
      maxTokens: agentConfig.max_tokens || 4096,
      agentId: agentConfig.id || null,
    })

    const response = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userId,
        apiKey: env.ANTHROPIC_API_KEY || undefined,
        messages: messages,
        model,
        max_tokens: agentConfig.max_tokens || 4096,
        temperature: agentConfig.temperature ?? 0.3,
        system: agentConfig.system_prompt,
        tools: allTools
      })
    })

    const data = await response.json()
    modelEvent.settle(response.ok ? 'ok' : 'error', response.ok
      ? {
          stop_reason: data.stop_reason ?? null,
          blocks: (data.content || []).length,
          input_tokens: data.usage?.input_tokens ?? null,
          output_tokens: data.usage?.output_tokens ?? null,
        }
      : { status: response.status, error: data.error ?? null })

    if (!response.ok) {
      executionLog.push({
        turn,
        type: 'error',
        error: data.error || 'Anthropic API error',
        timestamp: new Date().toISOString()
      })
      break
    }

    if (data.stop_reason === 'end_turn') {
      if (requiresGraphWrite && !hasGraphWriteCompletion(messages)) {
        executionLog.push({
          turn,
          type: 'forced_continuation',
          reason: 'Graph-write request not completed before end_turn',
          timestamp: new Date().toISOString(),
        })
        messages.push(
          { role: 'assistant', content: data.content },
          { role: 'user', content: 'You have not completed the requested graph write yet. Use delegate_to_kg now before ending your turn.' }
        )
        continue
      }

      if (requiresGraphWrite && !hasGraphWriteVerification(messages, graphWriteVerificationStartIndex)) {
        executionLog.push({
          turn,
          type: 'forced_continuation',
          reason: 'Graph write completed but was not verified with a read tool',
          timestamp: new Date().toISOString(),
        })
        messages.push(
          { role: 'assistant', content: data.content },
          { role: 'user', content: 'The graph write is not verified yet. Read the affected graph or node now with read_node, read_graph, or read_graph_content and confirm the exact change before ending your turn.' }
        )
        continue
      }

      if (requiresCalendarQuery && !hasCalendarToolUseSince(messages, calendarQueryStartIndex)) {
        executionLog.push({
          turn,
          type: 'forced_continuation',
          reason: 'Calendar/date question answered without a fresh calendar tool call',
          timestamp: new Date().toISOString(),
        })
        messages.push(
          { role: 'assistant', content: data.content },
          { role: 'user', content: 'This calendar answer is not grounded yet. Call the appropriate calendar_ tool now for the requested date or follow-up date and answer from that result only.' }
        )
        continue
      }

      const serverSearches = data.content.filter(c => c.type === 'server_tool_use')
      for (const search of serverSearches) {
        executionLog.push({
          turn,
          type: 'web_search',
          tool: 'web_search',
          query: search.input?.query,
          timestamp: new Date().toISOString()
        })
      }

      const textContent = data.content.find(c => c.type === 'text')
      executionLog.push({
        turn,
        type: 'agent_complete',
        response: textContent ? textContent.text : '',
        timestamp: new Date().toISOString()
      })
      break
    }

    if (data.stop_reason === 'tool_use') {
      const toolUses = data.content.filter(c => c.type === 'tool_use')
      const serverSearches = data.content.filter(c => c.type === 'server_tool_use')

      for (const search of serverSearches) {
        executionLog.push({
          turn,
          type: 'web_search',
          tool: 'web_search',
          query: search.input?.query,
          timestamp: new Date().toISOString()
        })
      }

      if (toolUses.length > 0) {
        executionLog.push({
          turn,
          type: 'tool_calls',
          tools: toolUses.map(t => ({ name: t.name, input: t.input })),
          timestamp: new Date().toISOString()
        })
      }

      // Graph-mutating tools must run sequentially to avoid D1 read-modify-write race conditions
      // SEQUENTIAL_TOOLS is the single module-level set (defined near the top) — no per-loop copy.
      const sequentialTools = toolUses.filter(t => SEQUENTIAL_TOOLS.has(t.name))
      const parallelTools = toolUses.filter(t => !SEQUENTIAL_TOOLS.has(t.name))
      let inferredGraphId = null

      const GRAPH_ID_AWARE_TOOLS = new Set([
        'create_node',
        'create_html_node',
        'add_edge',
        'patch_node',
        'patch_graph_metadata',
        'read_graph',
        'read_graph_content',
        'read_node',
        'delegate_to_kg',
      ])

      // Phase 1: Run graph-mutating tools sequentially (one at a time)
      const sequentialResults = []
      for (const toolUse of sequentialTools) {
        const toolEvent = await wal.begin('tool_call', toolUse.name, { turn, input: toolUse.input })
        const GRAPH_DISCOVERY_TOOLS = new Set(['search_graphs', 'list_graphs'])
        if (
          requiresCreateGraph
          && countGraphWriteCompletions(messages) <= graphWriteCompletionBaseline
          && GRAPH_DISCOVERY_TOOLS.has(toolUse.name)
        ) {
          const message = 'This request is to create a new graph. Call create_graph first, then create_node/add_edge as needed. Do not search existing graphs first.'
          toolEvent.settle('blocked', 'graph discovery before create_graph on an explicit create request')
          executionLog.push({ turn, type: 'tool_error', tool: toolUse.name, error: message, timestamp: new Date().toISOString() })
          sequentialResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify({ error: message }) })
          continue
        }

        if (!toolUse.input) toolUse.input = {}
        if (!toolUse.input.graphId && inferredGraphId && GRAPH_ID_AWARE_TOOLS.has(toolUse.name)) {
          toolUse.input.graphId = inferredGraphId
        }
        try {
          const result = await executeTool(toolUse.name, { ...toolUse.input, userId, authContext }, env, operationMap)
          if (result?.graphId) {
            inferredGraphId = result.graphId
          }
          const toolFailed = !!(result && result.success === false)
          toolEvent.settle(toolFailed ? 'error' : 'ok', result?.message || result?.summary || result?.error || `${toolUse.name} ${toolFailed ? 'failed' : 'completed'}`)
          executionLog.push({ turn, type: 'tool_result', tool: toolUse.name, success: !toolFailed, result, timestamp: new Date().toISOString() })
          sequentialResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(result) })
        } catch (error) {
          toolEvent.settle('error', error.message)
          executionLog.push({ turn, type: 'tool_error', tool: toolUse.name, error: error.message, timestamp: new Date().toISOString() })
          sequentialResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify({ error: error.message }) })
        }
      }

      // Phase 2: Run non-mutating tools in parallel
      const parallelResults = await Promise.all(parallelTools.map(async (toolUse) => {
        const toolEvent = await wal.begin('tool_call', toolUse.name, { turn, input: toolUse.input })
        try {
          const result = await executeTool(toolUse.name, { ...toolUse.input, userId, authContext }, env, operationMap)
          const toolFailed = !!(result && result.success === false)
          toolEvent.settle(toolFailed ? 'error' : 'ok', result?.message || result?.summary || result?.error || `${toolUse.name} ${toolFailed ? 'failed' : 'completed'}`)
          executionLog.push({ turn, type: 'tool_result', tool: toolUse.name, success: !toolFailed, result, timestamp: new Date().toISOString() })
          return { type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(result) }
        } catch (error) {
          toolEvent.settle('error', error.message)
          executionLog.push({ turn, type: 'tool_error', tool: toolUse.name, error: error.message, timestamp: new Date().toISOString() })
          return { type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify({ error: error.message }) }
        }
      }))

      const toolResults = [...sequentialResults, ...parallelResults]

      messages.push(
        { role: 'assistant', content: data.content },
        { role: 'user', content: toolResults }
      )
    } else if (data.stop_reason === 'pause_turn') {
      executionLog.push({
        turn,
        type: 'pause_turn',
        timestamp: new Date().toISOString()
      })

      const serverSearches = data.content.filter(c => c.type === 'server_tool_use')
      for (const search of serverSearches) {
        executionLog.push({
          turn,
          type: 'web_search',
          tool: 'web_search',
          query: search.input?.query,
          timestamp: new Date().toISOString()
        })
      }

      messages.push(
        { role: 'assistant', content: data.content },
        { role: 'user', content: 'Continue.' }
      )
    } else if (data.stop_reason === 'max_tokens') {
      executionLog.push({
        turn,
        type: 'max_tokens_continuation',
        timestamp: new Date().toISOString()
      })

      messages.push(
        { role: 'assistant', content: data.content },
        { role: 'user', content: 'You hit the token limit. Do NOT repeat what you already said. Continue by making your next tool call (create_node, add_edge, etc.) to finish the task.' }
      )
    } else {
      executionLog.push({
        turn,
        type: 'unexpected_stop',
        stop_reason: data.stop_reason,
        timestamp: new Date().toISOString()
      })
      break
    }
  }

  if (turn >= maxTurns) {
    executionLog.push({
      type: 'max_turns_reached',
      timestamp: new Date().toISOString()
    })
  }

  return {
    success: turn < maxTurns,
    turns: turn,
    // Correlates this run with its durable session_events rows.
    sessionId,
    executionLog: executionLog
  }
}

export { streamingAgentLoop, executeAgent, claimsUnbackedWrite }
