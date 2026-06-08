/**
 * OpenAPI-to-Tools — discovers every worker registered in `graph_system_registry`,
 * fetches its `/openapi.json`, converts each operation into a Claude tool definition,
 * and dispatches calls back through the right service binding.
 *
 * Flow:
 *   1. loadOpenAPITools(env) — walks `graph_system_registry`, finds every system-worker
 *      node, fetches its OpenAPI spec, converts operations to tool definitions, and
 *      assembles an operationMap that records WHICH worker each tool routes to.
 *   2. executeOpenAPITool(toolName, input, env, operationMap) — looks up the tool in
 *      operationMap and dispatches via the correct service binding using each worker's
 *      own base URL.
 *
 * Tool naming:
 *   - Each registry node may declare `metadata.tool_prefix` (e.g. "kg_" for KG worker).
 *   - operationId is converted to snake_case and prefixed accordingly.
 *   - If no prefix is declared, operationId snake_case is used as-is.
 *   - Names that collide with the hardcoded TOOL_DEFINITIONS are dropped (existing
 *     hardcoded behavior wins for backwards compatibility).
 *
 * Backwards compatibility:
 *   - The historical KG-only behavior is preserved as long as the KG worker is
 *     registered in `graph_system_registry` with `tool_prefix: "kg_"`. If the
 *     registry walk yields zero usable workers, a safety-net fallback fetches the
 *     KG worker spec directly with the `kg_` prefix (so a missing/empty registry
 *     doesn't take the agent's tool surface to zero).
 *
 * Auth:
 *   - This module currently sends `x-user-role: Superadmin` for every dispatched
 *     call (legacy KG convention). Per-worker auth strategies (`x-api-token`, `none`,
 *     etc.) are a follow-up — see Phase 3 of the plan.
 */

// Cache the parsed spec + tools in module scope (persists across requests in the same isolate)
let cachedTools = null
let cachedOperationMap = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Convert camelCase operationId to snake_case, with an optional prefix.
 * @param {string} operationId  e.g. "getKnowGraph"
 * @param {string} prefix       e.g. "kg_" or "" — applied verbatim
 */
function toSnakeToolName(operationId, prefix = '') {
  const snake = operationId
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '')
  return (prefix || '') + snake
}

/**
 * Convert an OpenAPI schema object to a Claude tool input_schema.
 * Handles $ref by inlining from components.schemas.
 */
function resolveSchema(schema, components) {
  if (!schema) return { type: 'object', properties: {} }

  if (schema.$ref) {
    const refName = schema.$ref.replace('#/components/schemas/', '')
    const resolved = components?.schemas?.[refName]
    if (resolved) return resolveSchema(resolved, components)
    return { type: 'object', properties: {} }
  }

  if (schema.type === 'object' && schema.properties) {
    const props = {}
    for (const [key, prop] of Object.entries(schema.properties)) {
      props[key] = resolveSchema(prop, components)
    }
    const result = { type: 'object', properties: props }
    if (schema.required) result.required = schema.required
    return result
  }

  if (schema.type === 'array' && schema.items) {
    return { type: 'array', items: resolveSchema(schema.items, components) }
  }

  // Primitive types
  const result = {}
  if (schema.type) result.type = schema.type
  if (schema.description) result.description = schema.description
  if (schema.enum) result.enum = schema.enum
  if (schema.default !== undefined) result.default = schema.default
  return result
}

/**
 * Convert a single OpenAPI operation to a Claude tool definition + execution metadata.
 * `workerCtx` carries the registry-derived routing info: { binding, workerUrl, prefix, label }.
 */
function operationToTool(path, method, operation, components, workerCtx) {
  const operationId = operation.operationId
  if (!operationId) return null

  const toolName = toSnakeToolName(operationId, workerCtx.prefix)
  const params = operation.parameters || []
  const requestBody = operation.requestBody

  // Build input_schema from query params + request body
  const properties = {}
  const required = []

  for (const param of params) {
    const paramSchema = param.schema || { type: 'string' }
    properties[param.name] = {
      type: paramSchema.type || 'string',
      description: param.description || `Parameter: ${param.name}`,
    }
    if (paramSchema.enum) properties[param.name].enum = paramSchema.enum
    if (param.required) required.push(param.name)
  }

  if (requestBody) {
    const content = requestBody.content?.['application/json']
    if (content?.schema) {
      const bodySchema = resolveSchema(content.schema, components)
      if (bodySchema.properties) {
        for (const [key, prop] of Object.entries(bodySchema.properties)) {
          properties[key] = prop
        }
        if (bodySchema.required) {
          for (const r of bodySchema.required) {
            if (!required.includes(r)) required.push(r)
          }
        }
      }
    }
  }

  const sourceTag = workerCtx.label ? `[${workerCtx.label}] ` : ''
  const toolDef = {
    name: toolName,
    description: `${sourceTag}${operation.summary || operationId}. ${operation.description || ''}`.trim(),
    input_schema: {
      type: 'object',
      properties,
    },
  }
  if (required.length > 0) toolDef.input_schema.required = required

  // Execution metadata — now includes per-worker routing
  const execMeta = {
    toolName,
    path,
    method: method.toUpperCase(),
    queryParams: params.filter(p => p.in === 'query').map(p => p.name),
    hasBody: !!requestBody,
    binding: workerCtx.binding,
    workerUrl: workerCtx.workerUrl,
    auth: workerCtx.auth || 'service-binding-superadmin',
  }

  return { toolDef, execMeta }
}

/* ──────────────────────────────────────────────────────────────────
 * Registry helpers (inlined to avoid a circular import with tool-executors.js,
 * which itself imports loadOpenAPITools / executeOpenAPITool from here).
 * The equivalents in tool-executors.js are kept untouched.
 * ────────────────────────────────────────────────────────────────── */

async function fetchRegistryGraph(env) {
  try {
    const kg = env.KG_WORKER
    if (!kg) return { nodes: [], edges: [] }
    const res = await kg.fetch('https://knowledge-graph-worker/getknowgraph?id=graph_system_registry')
    if (!res.ok) return { nodes: [], edges: [] }
    return await res.json()
  } catch {
    return { nodes: [], edges: [] }
  }
}

function registrySystemWorkers(graph) {
  return (graph?.nodes || []).filter(n => n.type === 'system-worker')
}

async function fetchWorkerSpec(fetcher, baseUrl) {
  try {
    let res = await fetcher.fetch(`${baseUrl}/openapi.json`)
    if (!res.ok) res = await fetcher.fetch(`${baseUrl}/api/docs`)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/**
 * Extract tools + operationMap entries from a single worker's OpenAPI spec.
 * Returns { tools: [], operationMap: {} } scoped to that worker.
 */
function extractFromSpec(spec, workerCtx) {
  const tools = []
  const operationMap = {}
  for (const [path, methods] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(methods)) {
      if (typeof operation !== 'object' || !operation.operationId) continue
      const result = operationToTool(path, method, operation, spec.components, workerCtx)
      if (!result) continue
      tools.push(result.toolDef)
      operationMap[result.toolDef.name] = result.execMeta
    }
  }
  return { tools, operationMap }
}

/* ──────────────────────────────────────────────────────────────────
 * Public API
 * ────────────────────────────────────────────────────────────────── */

/**
 * Walk every system-worker in `graph_system_registry`, fetch each one's
 * OpenAPI spec, and merge into a single tools[] + operationMap.
 *
 * Workers that are skipped:
 *   - No binding set, or binding not in `env`
 *   - No reachable OpenAPI spec at `/openapi.json` (or `/api/docs`)
 *
 * Worker registry node fields read:
 *   - metadata.binding      service-binding name in env (e.g. "KG_WORKER")
 *   - metadata.name         used for the URL host (defaults to node.label)
 *   - metadata.tool_prefix  optional prefix prepended to every operationId-derived
 *                           tool name (e.g. "kg_"). Empty by default.
 *   - metadata.auth         optional auth strategy. Currently unused — all calls
 *                           still send `x-user-role: Superadmin` (Phase 3 work).
 *   - metadata.tool_blocklist  optional array of fully-qualified tool names
 *                              (after prefix) to skip — used to avoid duplication
 *                              with hardcoded TOOL_DEFINITIONS.
 *
 * Backwards compatibility safety net: if the walk yields zero tools, fall back to
 * the historical direct-KG fetch with `kg_` prefix.
 */
export async function loadOpenAPITools(env) {
  const now = Date.now()
  if (cachedTools && cachedOperationMap && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return { tools: cachedTools, operationMap: cachedOperationMap }
  }

  // Default blocklist — names that duplicate hardcoded TOOL_DEFINITIONS.
  // Kept as a per-tool exclusion so a worker registry node can extend it.
  const DEFAULT_KG_BLOCKLIST = new Set([
    'kg_get_know_graph',     // → read_graph
    'kg_get_know_graphs',    // → list_graphs
    'kg_get_contract',       // → get_contract
    'kg_patch_node',         // → patch_node
    'kg_add_node',           // → create_node
    'kg_add_a_i_template',   // broken handler
    'kg_get_a_i_templates',  // redundant
    'kg_get_tool_templates', // redundant
  ])

  const allTools = []
  const allOperationMap = {}
  const seenNames = new Set()
  const errors = []

  const registry = await fetchRegistryGraph(env)
  const workerNodes = registrySystemWorkers(registry)

  for (const node of workerNodes) {
    const meta = node.metadata || {}
    const binding = meta.binding
    if (!binding || binding === 'self') continue
    const fetcher = env[binding]
    if (!fetcher) continue

    const workerName = meta.name || node.label
    const workerUrl = `https://${workerName}`
    const prefix = meta.tool_prefix || ''
    const auth = meta.auth || 'service-binding-superadmin'
    const nodeBlocklist = Array.isArray(meta.tool_blocklist) ? new Set(meta.tool_blocklist) : null

    let spec
    try {
      spec = await fetchWorkerSpec(fetcher, workerUrl)
    } catch (err) {
      errors.push({ worker: workerName, error: err?.message || 'fetch failed' })
      continue
    }
    if (!spec) continue

    const workerCtx = { binding, workerUrl, prefix, auth, label: node.label || workerName }
    let extracted
    try {
      extracted = extractFromSpec(spec, workerCtx)
    } catch (err) {
      errors.push({ worker: workerName, error: err?.message || 'extract failed' })
      continue
    }

    for (const tool of extracted.tools) {
      // Per-node blocklist (operator-controlled exclusions)
      if (nodeBlocklist && nodeBlocklist.has(tool.name)) continue
      // Hardcoded-tool blocklist — keep the legacy KG dedup applying when the
      // KG worker is the source (recognised by the kg_ prefix).
      if (prefix === 'kg_' && DEFAULT_KG_BLOCKLIST.has(tool.name)) continue
      // Cross-worker collision: first writer wins, log and skip duplicates.
      if (seenNames.has(tool.name)) {
        errors.push({ worker: workerName, error: `name collision on ${tool.name} — already provided by another worker` })
        continue
      }
      seenNames.add(tool.name)
      allTools.push(tool)
      allOperationMap[tool.name] = extracted.operationMap[tool.name]
    }
  }

  // Safety net — if the registry walk produced nothing, fall back to direct KG
  // worker fetch so the agent never goes to zero dynamic tools because of a
  // misconfigured registry. Logs the fallback so it's visible.
  if (allTools.length === 0 && env.KG_WORKER) {
    console.warn('[openapi-tools] registry walk produced 0 tools; falling back to direct KG_WORKER fetch')
    const fallback = await fetchWorkerSpec(env.KG_WORKER, 'https://knowledge-graph-worker')
    if (fallback) {
      const workerCtx = {
        binding: 'KG_WORKER',
        workerUrl: 'https://knowledge-graph-worker',
        prefix: 'kg_',
        auth: 'service-binding-superadmin',
        label: 'KG',
      }
      const extracted = extractFromSpec(fallback, workerCtx)
      for (const tool of extracted.tools) {
        if (DEFAULT_KG_BLOCKLIST.has(tool.name)) continue
        allTools.push(tool)
        allOperationMap[tool.name] = extracted.operationMap[tool.name]
      }
    }
  }

  if (errors.length > 0) {
    console.warn('[openapi-tools] discovery errors:', JSON.stringify(errors).slice(0, 500))
  }

  cachedTools = allTools
  cachedOperationMap = allOperationMap
  cacheTimestamp = now

  return { tools: allTools, operationMap: allOperationMap }
}

/**
 * Invalidate the in-isolate cache so the next `loadOpenAPITools` call re-walks
 * the registry. Used by `register_capability_worker` (Phase 2) and any other
 * code that mutates the registry.
 */
export function clearOpenAPICache() {
  cachedTools = null
  cachedOperationMap = null
  cacheTimestamp = 0
}

/**
 * Execute a dynamically-generated OpenAPI tool via its registered worker.
 * Reads workerUrl + binding from operationMap so any registered worker is reachable.
 */
export async function executeOpenAPITool(toolName, input, env, operationMap) {
  const meta = operationMap[toolName]
  if (!meta) throw new Error(`Unknown OpenAPI tool: ${toolName}`)

  const binding = meta.binding || 'KG_WORKER'
  const fetcher = env[binding]
  if (!fetcher) throw new Error(`Service binding "${binding}" not configured for tool ${toolName}`)

  const workerUrl = meta.workerUrl || 'https://knowledge-graph-worker'
  let url = `${workerUrl}${meta.path}`

  if (meta.queryParams.length > 0) {
    const params = new URLSearchParams()
    for (const qp of meta.queryParams) {
      if (input[qp] !== undefined && input[qp] !== null) {
        params.set(qp, String(input[qp]))
      }
    }
    const qs = params.toString()
    if (qs) url += '?' + qs
  }

  // Auth — Phase 1 keeps the legacy Superadmin header for every worker. Per-worker
  // auth strategies (x-api-token, none, etc.) are a follow-up; see plan Phase 3.
  const headers = { 'Content-Type': 'application/json' }
  const auth = meta.auth || 'service-binding-superadmin'
  if (auth === 'service-binding-superadmin') {
    headers['x-user-role'] = 'Superadmin'
  } else if (auth === 'x-api-token') {
    const token = input.authToken || (input.authContext && input.authContext.authToken) || ''
    if (token) headers['X-API-Token'] = token
  }
  // auth === 'none' → no auth header added

  const fetchOpts = { method: meta.method, headers }

  if (meta.hasBody && (meta.method === 'POST' || meta.method === 'PUT' || meta.method === 'PATCH' || meta.method === 'DELETE')) {
    const bodyFields = { ...input }
    for (const qp of meta.queryParams) {
      delete bodyFields[qp]
    }
    delete bodyFields.userId
    delete bodyFields.authToken
    delete bodyFields.authContext
    fetchOpts.body = JSON.stringify(bodyFields)
  }

  const res = await fetcher.fetch(url, fetchOpts)
  let data
  try {
    data = await res.json()
  } catch {
    data = { ok: false, error: `Non-JSON response (${res.status})` }
  }

  if (!res.ok) {
    throw new Error((data && data.error) || `Worker ${binding} ${meta.path} failed (${res.status})`)
  }

  return data
}

/**
 * Check whether a tool is OpenAPI-routed. Now reads the operationMap rather than
 * gating on a hardcoded `kg_` prefix — any registered worker's tools route here.
 */
export function isOpenAPITool(toolName, operationMap) {
  if (!operationMap) return toolName.startsWith('kg_') // safe fallback when map unknown
  return !!operationMap[toolName]
}
