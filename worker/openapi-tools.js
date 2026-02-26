/**
 * OpenAPI-to-Tools — Dynamically converts an OpenAPI 3.x spec into
 * Claude tool definitions and executes them via service binding.
 *
 * Flow:
 *   1. loadOpenAPITools(env) — fetches /openapi.json from KG_WORKER,
 *      converts each operation into a Claude tool definition
 *   2. executeOpenAPITool(toolName, input, env) — looks up the operation
 *      and makes the corresponding HTTP request via the service binding
 *
 * Tool naming: operationId is converted to snake_case and prefixed with "kg_"
 *   e.g. "getKnowGraph" → "kg_get_know_graph"
 *   e.g. "saveGraphWithHistory" → "kg_save_graph_with_history"
 */

// Cache the parsed spec + tools in module scope (persists across requests in the same isolate)
let cachedTools = null
let cachedOperationMap = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Convert camelCase operationId to snake_case with kg_ prefix
 */
function toSnakeToolName(operationId) {
  const snake = operationId
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '')
  return 'kg_' + snake
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
 */
function operationToTool(path, method, operation, components) {
  const operationId = operation.operationId
  if (!operationId) return null

  const toolName = toSnakeToolName(operationId)
  const params = operation.parameters || []
  const requestBody = operation.requestBody

  // Build input_schema from query params + request body
  const properties = {}
  const required = []

  // Query/path parameters
  for (const param of params) {
    const paramSchema = param.schema || { type: 'string' }
    properties[param.name] = {
      type: paramSchema.type || 'string',
      description: param.description || `Parameter: ${param.name}`,
    }
    if (paramSchema.enum) properties[param.name].enum = paramSchema.enum
    if (param.required) required.push(param.name)
  }

  // Request body properties (merge into flat input)
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

  const toolDef = {
    name: toolName,
    description: `[KG API] ${operation.summary || operationId}. ${operation.description || ''}`.trim(),
    input_schema: {
      type: 'object',
      properties,
    },
  }
  if (required.length > 0) toolDef.input_schema.required = required

  // Execution metadata
  const execMeta = {
    toolName,
    path,
    method: method.toUpperCase(),
    queryParams: params.filter(p => p.in === 'query').map(p => p.name),
    hasBody: !!requestBody,
  }

  return { toolDef, execMeta }
}

/**
 * Fetch /openapi.json from KG_WORKER and convert to tool definitions.
 * Results are cached for CACHE_TTL_MS.
 */
export async function loadOpenAPITools(env) {
  const now = Date.now()
  if (cachedTools && cachedOperationMap && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return { tools: cachedTools, operationMap: cachedOperationMap }
  }

  const res = await env.KG_WORKER.fetch('https://knowledge-graph-worker/openapi.json')
  if (!res.ok) {
    console.error('Failed to fetch OpenAPI spec:', res.status)
    return { tools: cachedTools || [], operationMap: cachedOperationMap || {} }
  }

  const spec = await res.json()
  // Blocklist: dynamic tools that duplicate hardcoded ones
  const BLOCKLIST = new Set([
    'kg_get_know_graph',     // → read_graph
    'kg_get_know_graphs',    // → list_graphs
    'kg_get_contract',       // → get_contract
    'kg_patch_node',         // → patch_node
    'kg_add_node',           // → create_node
  ])

  const tools = []
  const operationMap = {}

  for (const [path, methods] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(methods)) {
      if (typeof operation !== 'object' || !operation.operationId) continue
      const result = operationToTool(path, method, operation, spec.components)
      if (result) {
        if (BLOCKLIST.has(result.toolDef.name)) continue
        tools.push(result.toolDef)
        operationMap[result.toolDef.name] = result.execMeta
      }
    }
  }

  cachedTools = tools
  cachedOperationMap = operationMap
  cacheTimestamp = now

  return { tools, operationMap }
}

/**
 * Execute a dynamically-generated OpenAPI tool.
 * Maps the tool input back to the correct HTTP request.
 */
export async function executeOpenAPITool(toolName, input, env, operationMap) {
  const meta = operationMap[toolName]
  if (!meta) throw new Error(`Unknown OpenAPI tool: ${toolName}`)

  let url = `https://knowledge-graph-worker${meta.path}`

  // Build query string from query params
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

  // Build request options
  const fetchOpts = {
    method: meta.method,
    headers: { 'Content-Type': 'application/json' },
  }

  // For POST/PUT/PATCH, send remaining fields as JSON body
  if (meta.hasBody && (meta.method === 'POST' || meta.method === 'PUT' || meta.method === 'PATCH' || meta.method === 'DELETE')) {
    // Remove query params from body
    const bodyFields = { ...input }
    for (const qp of meta.queryParams) {
      delete bodyFields[qp]
    }
    // Remove internal fields
    delete bodyFields.userId
    fetchOpts.body = JSON.stringify(bodyFields)
  }

  const res = await env.KG_WORKER.fetch(url, fetchOpts)
  const data = await res.json()

  if (!res.ok) {
    throw new Error(data.error || `KG API ${meta.path} failed (${res.status})`)
  }

  return data
}

/**
 * Check if a tool name is an OpenAPI-generated tool (starts with kg_)
 */
export function isOpenAPITool(toolName) {
  return toolName.startsWith('kg_')
}
