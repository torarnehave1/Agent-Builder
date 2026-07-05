/**
 * Tool executors — runtime functions that execute each tool
 *
 * Each execute* function calls service bindings (KG_WORKER, ANTHROPIC, etc.)
 * and returns a result object. The executeTool() dispatcher routes by name.
 */

import { getTemplate, getTemplateVersion, listTemplates, DEFAULT_TEMPLATE_ID } from './template-registry.js'
import { isOpenAPITool, executeOpenAPITool, loadOpenAPITools, clearOpenAPICache } from './openapi-tools.js'
import { FORMATTING_REFERENCE, NODE_TYPES_REFERENCE, HTML_BUILDER_REFERENCE, VEMOTION_REFERENCE, CAROUSEL_REFERENCE } from './system-prompt.js'
import { TOOL_DEFINITIONS, PROFF_TOOLS } from './tool-definitions.js'
import { runHtmlBuilderSubagent, executeValidateHtmlSyntax, executeGetHtmlStructure } from './html-builder-subagent.js'
import { runKgSubagent } from './kg-subagent.js'
import { runChatbotSubagent } from './chatbot-subagent.js'
import { runChatSubagent } from './chat-subagent.js'
import { DEFAULT_MODEL, MODELS } from './models.js'
import { runBotSubagent } from './bot-subagent.js'
import { runAgentBuilderSubagent } from './agent-builder-subagent.js'
import { runVideoSubagent } from './video-subagent.js'
import { runContactSubagent } from './contact-subagent.js'
import { runAlbumSubagent } from './album-subagent.js'
import { runYoutubeGraphSubagent } from './youtube-graph-subagent.js'

// ── Graph operations ──────────────────────────────────────────────

// Valid UUID v4 pattern
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const NETWORK_TIMEOUT_MS = 45000

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = NETWORK_TIMEOUT_MS, fetchImpl = fetch) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs)
  try {
    const res = await fetchImpl(url, { ...options, signal: controller.signal })
    const text = await res.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = text
    }
    return { res, data, text }
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchGraphForVersion(graphId, env) {
  const res = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(graphId)}`
  )
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `Failed to fetch graph (${res.status})`)
  return {
    graph: data,
    version: Number(data?.metadata?.version || 0),
  }
}

async function patchNodeWithVersionRetry(env, graphId, nodeId, fields, options = {}) {
  let expectedVersion = Number.isInteger(options.expectedVersion)
    ? options.expectedVersion
    : (await fetchGraphForVersion(graphId, env)).version

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await env.KG_WORKER.fetch('https://knowledge-graph-worker/patchNode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphId, nodeId, fields, expectedVersion }),
    })
    const data = await res.json()
    if (res.ok) return data

    const isConflict = res.status === 409 || String(data?.error || '').toLowerCase().includes('version mismatch')
    if (!isConflict || attempt === 1) {
      throw new Error(data.error || `patchNode failed (${res.status})`)
    }

    expectedVersion = Number(data.currentVersion || (await fetchGraphForVersion(graphId, env)).version)
  }
}

async function patchGraphMetadataWithVersionRetry(env, graphId, fields, options = {}) {
  let expectedVersion = Number.isInteger(options.expectedVersion)
    ? options.expectedVersion
    : (await fetchGraphForVersion(graphId, env)).version

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await env.KG_WORKER.fetch('https://knowledge-graph-worker/patchGraphMetadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphId, fields, expectedVersion }),
    })
    const data = await res.json()
    if (res.ok) return data

    const isConflict = res.status === 409 || String(data?.error || '').toLowerCase().includes('version mismatch')
    if (!isConflict || attempt === 1) {
      throw new Error(data.error || `patchGraphMetadata failed (${res.status})`)
    }

    expectedVersion = Number(data.currentVersion || (await fetchGraphForVersion(graphId, env)).version)
  }
}

async function executeCreateGraph(input, env) {
  const title = input.title || input.name || input.graphTitle || 'Untitled Graph'

  // Resolve email for createdBy — userId may be a UUID, we always want an email
  let createdByEmail = input.userId || 'agent-worker'
  if (createdByEmail && !createdByEmail.includes('@')) {
    const profile = await resolveUserProfile(createdByEmail, env).catch(() => null)
    if (profile?.email) {
      createdByEmail = profile.email
    } else {
      // User not found in DB (non-existent UUID) — fall back to agent identity
      // rather than leaving a bare UUID that renders as "Unknown" in the viewer
      createdByEmail = 'agent@vegvisr.org'
    }
  }

  // Always generate the graph ID server-side — never trust the LLM to invent one.
  // The LLM often hallucinates known test UUIDs (e.g. a1b2c3d4-...). We ignore
  // any LLM-supplied graphId and always generate a fresh one to prevent
  // accidentally overwriting existing graphs.
  const graphId = crypto.randomUUID()

  const graphData = {
    metadata: {
      title,
      description: input.description || '',
      category: input.category || '',
      metaArea: input.metaArea || '',
      createdBy: createdByEmail,
      version: 0,
      userId: input.userId || 'agent-system',
      tags: input.tags || []
    },
    nodes: [],
    edges: []
  }

  const response = await env.KG_WORKER.fetch('https://knowledge-graph-worker/saveGraphWithHistory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: graphId, graphData })
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error || `Failed to create graph (status: ${response.status})`)
  }
  return {
    graphId: data.id || graphId,
    version: data.newVersion || 1,
    message: `Graph "${title}" created successfully`,
    viewUrl: `https://www.vegvisr.org/gnew-viewer?graphId=${graphId}`
  }
}

// Type-aware truncation for read_graph (structure overview)
// html-node/css-node kept short here — use read_node for full content
function truncateNodeInfo(info, type) {
  if (!info) return { text: '', truncated: false }
  const limits = {
    'html-node': 200,
    'css-node': 200,
    'fulltext': 2000,
    'info': 2000,
    'mermaid-diagram': 500,
  }
  const limit = limits[type] || 500
  if (info.length <= limit) return { text: info, truncated: false }
  return { text: info.slice(0, limit) + '...', truncated: true }
}

async function executeReadGraph(input, env) {
  const res = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(input.graphId)}`
  )
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Graph not found: ${err}`)
  }
  const graphData = await res.json()
  const nodes = (graphData.nodes || []).map(n => {
    const { text, truncated } = truncateNodeInfo(n.info, n.type)
    const node = {
      id: n.id,
      label: n.label,
      type: n.type,
      info: text,
      path: n.path || undefined,
      color: n.color || undefined,
    }
    if (truncated) {
      node.info_truncated = true
      node.info_full_length = n.info.length
    }
    return node
  })
  return {
    graphId: input.graphId,
    metadata: graphData.metadata || {},
    nodeCount: nodes.length,
    edgeCount: (graphData.edges || []).length,
    nodes,
    edges: (graphData.edges || []).slice(0, 50),
  }
}

async function executeReadGraphContent(input, env) {
  const res = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(input.graphId)}`
  )
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Graph not found: ${err}`)
  }
  const graphData = await res.json()
  let nodes = graphData.nodes || []

  // Optional: filter to specific node types
  if (input.nodeTypes && Array.isArray(input.nodeTypes) && input.nodeTypes.length > 0) {
    nodes = nodes.filter(n => input.nodeTypes.includes(n.type))
  }

  return {
    graphId: input.graphId,
    metadata: graphData.metadata || {},
    nodeCount: nodes.length,
    nodes: nodes.map(n => ({
      id: n.id,
      label: n.label,
      type: n.type,
      info: n.info || '',
      path: n.path || undefined,
      color: n.color || undefined,
      metadata: n.metadata || undefined,
    })),
  }
}

async function executeReadNode(input, env) {
  const res = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(input.graphId)}`
  )
  if (!res.ok) throw new Error('Graph not found')
  const graphData = await res.json()
  const node = (graphData.nodes || []).find(n => String(n.id) === String(input.nodeId))
  if (!node) throw new Error(`Node "${input.nodeId}" not found in graph "${input.graphId}"`)
  return {
    graphId: input.graphId,
    node: {
      id: node.id,
      label: node.label,
      type: node.type,
      info: node.info || '',
      path: node.path || undefined,
      color: node.color || undefined,
      metadata: node.metadata || undefined,
      bibl: node.bibl || [],
      position: node.position || {},
      visible: node.visible,
    },
  }
}

async function executePatchNode(input, env) {
  try {
    const data = await patchNodeWithVersionRetry(env, input.graphId, input.nodeId, input.fields)
    return {
      graphId: input.graphId,
      nodeId: input.nodeId,
      updatedFields: Object.keys(input.fields),
      version: data.newVersion,
      message: `Node "${input.nodeId}" updated: ${Object.keys(input.fields).join(', ')}`,
    }
  } catch (error) {
    const errMsg = error.message || 'patchNode failed'
    // If node not found, fetch graph to show valid node IDs for self-correction
    if (errMsg.toLowerCase().includes('not found')) {
      try {
        const graphRes = await env.KG_WORKER.fetch(
          `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(input.graphId)}`
        )
        const graphData = await graphRes.json()
        if (graphRes.ok && graphData.nodes) {
          const nodeIds = graphData.nodes.map(n => `"${n.id}" (${n.label})`).join(', ')
          throw new Error(`${errMsg}. Valid node IDs in this graph: ${nodeIds}`)
        }
      } catch (e) {
        if (e.message.includes('Valid node IDs')) throw e
      }
    }
    throw new Error(errMsg)
  }
}

// Merge-safe metadata update. patch_node does Object.assign(node, fields), so
// passing fields.metadata REPLACES the whole metadata object. This reads the
// node's current metadata, shallow-merges the provided keys, and writes the
// merged result back — so editing one key (e.g. capabilities_summary) keeps the
// others (icon, highlights, …). Code-hardcoded tool, NOT in the registry.
async function executePatchNodeMetadata(input, env) {
  const graphId = input.graphId
  const nodeId = input.nodeId
  const patch = (input.metadata && typeof input.metadata === 'object') ? input.metadata : null
  if (!graphId || !nodeId || !patch) {
    return { success: false, error: 'graphId, nodeId, and metadata (object) are required' }
  }
  let graph
  try {
    const res = await env.KG_WORKER.fetch(`https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(graphId)}`)
    if (!res.ok) return { success: false, error: `Graph ${graphId} not found (${res.status})` }
    graph = await res.json()
  } catch (e) {
    return { success: false, error: `Could not read graph: ${e.message}` }
  }
  const node = (graph.nodes || []).find(n => n.id === nodeId)
  if (!node) {
    const ids = (graph.nodes || []).map(n => `"${n.id}"`).join(', ')
    return { success: false, error: `Node ${nodeId} not found. Valid node IDs: ${ids}` }
  }
  const merged = { ...(node.metadata || {}), ...patch }
  try {
    const data = await patchNodeWithVersionRetry(env, graphId, nodeId, { metadata: merged })
    return {
      success: true, graphId, nodeId,
      updatedKeys: Object.keys(patch),
      metadata: merged,
      version: data.newVersion,
      message: `Node "${nodeId}" metadata merged: ${Object.keys(patch).join(', ')}`,
    }
  } catch (e) {
    return { success: false, error: e.message || 'patchNode failed' }
  }
}

async function executeEditHtmlNode(input, env) {
  // Superadmin gate — same caller resolution as executeRegisterWorldFounder. Structured
  // error (not throw) so the agent narrates the reason.
  const ac = input.authContext || {}
  const callerUserId = input.userId || ac.userId || ac.profile?.user_id || ac.session?.id || null
  let callerRole = String(ac.role || ac.profile?.role || ac.session?.role || '').trim()
  let callerEmail = String(ac.email || ac.profile?.email || ac.session?.email || '').trim()
  if ((!callerRole || !callerEmail) && callerUserId) {
    try {
      const p = await resolveUserProfile(callerUserId, env)
      if (!callerRole) callerRole = String(p?.Role || p?.role || '').trim()
      if (!callerEmail) callerEmail = String(p?.email || '').trim()
    } catch (e) { /* fall through to role check */ }
  }
  if (callerRole.toLowerCase() !== 'superadmin') {
    return { success: false, error: `Superadmin role required to edit an html-node. Resolved caller userId=${callerUserId || 'none'}, role=${callerRole || 'unknown'}.` }
  }

  // 1. Read the current node content
  const readRes = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(input.graphId)}`
  )
  const graphData = await readRes.json()
  if (!readRes.ok) {
    throw new Error(graphData.error || `Failed to read graph (${readRes.status})`)
  }

  const node = graphData.nodes?.find(n => n.id === input.nodeId)
  if (!node) {
    const validIds = graphData.nodes?.map(n => `"${n.id}" (${n.label})`).join(', ') || 'none'
    throw new Error(`Node "${input.nodeId}" not found. Valid node IDs: ${validIds}`)
  }

  if (node.type !== 'html-node' && node.type !== 'css-node') {
    throw new Error(`edit_html_node only works on html-node or css-node types. Node "${input.nodeId}" is type "${node.type}". Use patch_node instead.`)
  }

  // 2. Normalize line endings in the source — \r\n → \n
  const currentHtml = (node.info || '').replace(/\r\n/g, '\n')

  // 3. Normalize escaped sequences — LLMs often send \\n instead of real \n
  // Accept both old_string/new_string and oldText/newText (LLMs sometimes use either)
  let oldString = input.old_string || input.oldText
  let newString = input.new_string ?? input.newText ?? ''
  if (!oldString) {
    throw new Error('old_string is required. Provide the exact text to find and replace.')
  }
  // Escaped newlines/tabs from JSON serialization
  if (oldString.includes('\\n')) oldString = oldString.replace(/\\n/g, '\n')
  if (newString.includes('\\n')) newString = newString.replace(/\\n/g, '\n')
  if (oldString.includes('\\t')) oldString = oldString.replace(/\\t/g, '\t')
  if (newString.includes('\\t')) newString = newString.replace(/\\t/g, '\t')
  // Windows line endings in agent input
  oldString = oldString.replace(/\r\n/g, '\n')
  newString = newString.replace(/\r\n/g, '\n')

  // 3. Check that old_string exists in the content
  const occurrences = currentHtml.split(oldString).length - 1
  if (occurrences === 0) {
    // Try a whitespace-flexible match as a hint
    const flexPattern = oldString.replace(/\s+/g, '\\s+')
    let flexMatch = null
    try {
      const regex = new RegExp(flexPattern)
      flexMatch = currentHtml.match(regex)
    } catch (e) { /* regex may fail on special chars, that's ok */ }

    const preview = currentHtml.substring(0, 500)
    let errorMsg = `old_string not found in node "${input.nodeId}". The string must match EXACTLY (including whitespace and newlines).`
    if (flexMatch) {
      errorMsg += `\n\nA similar string was found with different whitespace. The actual text is:\n${flexMatch[0].substring(0, 300)}`
    }
    errorMsg += `\n\nFirst 500 chars of current content:\n${preview}`
    throw new Error(errorMsg)
  }

  if (occurrences > 1 && !input.replace_all) {
    throw new Error(`old_string found ${occurrences} times in node "${input.nodeId}". Either provide more context to make it unique, or set replace_all: true to replace all occurrences.`)
  }

  // 4. Perform the replacement
  let newHtml
  if (input.replace_all) {
    newHtml = currentHtml.split(oldString).join(newString)
  } else {
    // Replace only the first occurrence
    const idx = currentHtml.indexOf(oldString)
    newHtml = currentHtml.substring(0, idx) + newString + currentHtml.substring(idx + oldString.length)
  }

  // 5. Patch the node with the edited content (+ who/when attribution)
  const patchData = await patchNodeWithVersionRetry(env, input.graphId, input.nodeId, {
    info: newHtml,
    updatedAt: new Date().toISOString(),
    updatedBy: callerEmail || null,
  })

  const replacements = input.replace_all ? occurrences : 1
  return {
    graphId: input.graphId,
    nodeId: input.nodeId,
    replacements,
    oldLength: currentHtml.length,
    newLength: newHtml.length,
    version: patchData.newVersion,
    message: `Edited node "${input.nodeId}": replaced ${replacements} occurrence(s). HTML ${newHtml.length > currentHtml.length ? 'grew' : 'shrank'} from ${currentHtml.length} to ${newHtml.length} chars.`,
    updatedHtml: newHtml,
  }
}

// ---- Anchor-based section replace (Lesson 34) ---------------------------------
// Reliable HTML edits that don't depend on the model reproducing an exact text string.
// Editable regions are delimited by HTML COMMENT markers:
//   <!-- edit:<anchorId>:start -->  ...content...  <!-- edit:<anchorId>:end -->
// To change a region the agent names the anchorId; the tool swaps everything between the
// markers. Comments can't be confused with content, need no tag-balancing, and there is
// exactly one of each marker — so the edit cannot "miss" the way exact-string match does.
const ANCHOR_ID_RE = /^[a-z0-9][a-z0-9-]*$/

function anchorMarkers(anchorId) {
  return { start: `<!-- edit:${anchorId}:start -->`, end: `<!-- edit:${anchorId}:end -->` }
}

function listAnchorIds(html) {
  const ids = []
  const re = /<!--\s*edit:([a-z0-9][a-z0-9-]*):start\s*-->/gi
  let m
  while ((m = re.exec(html)) !== null) ids.push(m[1])
  return ids
}

async function fetchHtmlNode(env, graphId, nodeId) {
  const res = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(graphId)}`
  )
  const graphData = await res.json()
  if (!res.ok) throw new Error(graphData.error || `Failed to read graph (${res.status})`)
  const node = (graphData.nodes || []).find(n => n.id === nodeId)
  return { node, graphData }
}

async function executeListHtmlAnchors(input, env) {
  if (!input.graphId || !input.nodeId) return { success: false, error: 'graphId and nodeId are required.' }
  const { node } = await fetchHtmlNode(env, input.graphId, input.nodeId)
  if (!node) return { success: false, error: `Node "${input.nodeId}" not found.` }
  const html = (node.info || '').replace(/\r\n/g, '\n')
  const anchors = listAnchorIds(html)
  return {
    success: true,
    graphId: input.graphId,
    nodeId: input.nodeId,
    anchors,
    count: anchors.length,
    message: anchors.length
      ? `Editable anchors in "${input.nodeId}": ${anchors.join(', ')}. Use replace_html_section(anchorId, html) to change one.`
      : `No edit anchors found in "${input.nodeId}". Wrap a section once with <!-- edit:<id>:start --> … <!-- edit:<id>:end --> (via edit_html_node) to make it anchor-editable.`,
  }
}

async function executeReplaceHtmlSection(input, env) {
  const gate = await resolveSuperadminCaller(input, env, 'edit an html-node')
  if (!gate.ok) return { success: false, error: gate.error }

  const anchorId = String(input.anchorId || input.anchor || '').trim().toLowerCase()
  if (!ANCHOR_ID_RE.test(anchorId)) {
    return { success: false, error: "anchorId must be a slug (a-z, 0-9, '-'), e.g. 'om-prosjektet'." }
  }
  if (!input.graphId || !input.nodeId) return { success: false, error: 'graphId and nodeId are required.' }
  const newInner = String(input.html ?? input.newHtml ?? input.content ?? '')
  if (input.html === undefined && input.newHtml === undefined && input.content === undefined) {
    return { success: false, error: 'html (the replacement content for the section) is required.' }
  }

  const { node } = await fetchHtmlNode(env, input.graphId, input.nodeId)
  if (!node) return { success: false, error: `Node "${input.nodeId}" not found.` }
  if (node.type !== 'html-node' && node.type !== 'css-node') {
    return { success: false, error: `replace_html_section only works on html-node/css-node. "${input.nodeId}" is type "${node.type}".` }
  }

  const currentHtml = (node.info || '').replace(/\r\n/g, '\n')
  const { start, end } = anchorMarkers(anchorId)
  const s = currentHtml.indexOf(start)
  const e = currentHtml.indexOf(end)
  if (s === -1 || e === -1 || e < s) {
    const available = listAnchorIds(currentHtml)
    return {
      success: false,
      error: `Anchor "${anchorId}" not found in "${input.nodeId}".${available.length ? ` Available anchors: ${available.join(', ')}.` : ' This page has no edit anchors yet — wrap the target section once with <!-- edit:' + anchorId + ':start --> … <!-- edit:' + anchorId + ':end --> using edit_html_node, then retry.'}`,
      availableAnchors: available,
    }
  }

  const innerStart = s + start.length
  const before = currentHtml.slice(0, innerStart)
  const after = currentHtml.slice(e)
  const newHtml = `${before}\n${newInner}\n${after}`

  if (newHtml === currentHtml) {
    return { success: true, graphId: input.graphId, nodeId: input.nodeId, anchorId, changed: false, charDelta: 0, message: `Section "${anchorId}" already matched the given content — no change.` }
  }

  const patchData = await patchNodeWithVersionRetry(env, input.graphId, input.nodeId, {
    info: newHtml,
    updatedAt: new Date().toISOString(),
    updatedBy: gate.email || null,
  })

  return {
    success: true,
    graphId: input.graphId,
    nodeId: input.nodeId,
    anchorId,
    changed: true,
    charDelta: newHtml.length - currentHtml.length,
    version: patchData.newVersion,
    updatedHtml: newHtml,
    savedNotLive: true,
    publishHostHints: Array.isArray(node.references) ? node.references : [],
    publishReminder: `Saved as v${patchData.newVersion} in the graph, NOT live on any domain until published. Tell the user the new version ("nå på v${patchData.newVersion}", roll back any time with restore_html_node_version) AND that it is saved-but-not-live — ask whether to publish (publish_html_node). Do not auto-publish.`,
    message: `Replaced section "${anchorId}" in "${input.nodeId}" (${newHtml.length > currentHtml.length ? '+' : ''}${newHtml.length - currentHtml.length} chars) — saved as v${patchData.newVersion}. Verified: content between the anchors was swapped. Tell the user "nå på v${patchData.newVersion}" and that it is saved in the graph, not live until published.`,
  }
}

// Publish a graph html-node (or css-node) to a live host served by the shared brand-worker,
// e.g. fonemer.vegvisr.org. Mirrors the World-Founder publish path (executePublishWorldPage):
// signs a host-scoped token with agent-worker's own HTML_PUBLISH_SECRET and POSTs the node's
// HTML to https://<host>/__html/publish, which writes html:<host> into the brand-worker's
// HTML_PAGES KV — the SAME key the viewer's Publish button writes. This closes the gap where
// the agent could edit the node in the graph but not push it to the live site. Superadmin only.
// Code-hardcoded (not in registry).
async function executePublishHtmlNode(input, env) {
  const gate = await resolveSuperadminCaller(input, env, 'publish an html-node')
  if (!gate.ok) return { success: false, error: gate.error }

  const host = String(input.host || '').trim().toLowerCase()
  if (!host || !host.includes('.')) {
    return { success: false, error: "host is required — the live target, e.g. 'fonemer.vegvisr.org'. Create it first with create_subdomain if it doesn't exist." }
  }
  if (!input.graphId || !input.nodeId) {
    return { success: false, error: 'graphId and nodeId are required (the html-node to publish).' }
  }

  // 1. Read the node's current HTML from the graph
  const readRes = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(input.graphId)}`
  )
  const graphData = await readRes.json()
  if (!readRes.ok) return { success: false, error: graphData.error || `Failed to read graph (${readRes.status})` }

  const node = graphData.nodes?.find(n => n.id === input.nodeId)
  if (!node) {
    const validIds = graphData.nodes?.filter(n => n.type === 'html-node').map(n => `"${n.id}" (${n.label})`).join(', ') || 'none'
    return { success: false, error: `Node "${input.nodeId}" not found. html-nodes in this graph: ${validIds}` }
  }
  if (node.type !== 'html-node' && node.type !== 'css-node') {
    return { success: false, error: `publish_html_node only publishes html-node or css-node types. Node "${input.nodeId}" is type "${node.type}".` }
  }
  const html = node.info || ''
  if (!html.trim()) return { success: false, error: `Node "${input.nodeId}" has no HTML content to publish.` }

  // 2. Mint a host-scoped publish token via api-worker's canonical minter, NOT by signing locally.
  //    The shared brand-worker verifies tokens against api-worker's HTML_PUBLISH_SECRET (tokens are
  //    normally minted by api-worker's /api/html/publish-token — same path the viewer's Publish button
  //    uses). agent-worker's own HTML_PUBLISH_SECRET differs from that, so a locally-signed token is
  //    rejected 401. Minting through api-worker (reached via the API_WORKER service binding) needs no
  //    secret parity: api-worker signs with the secret brand-worker trusts. The caller's own
  //    emailVerificationToken authenticates the mint; Superadmin may publish to any host.
  const ac = input.authContext || {}
  const callerToken = String(ac.profile?.emailVerificationToken || ac.authToken || input.userToken || '').trim()
  if (!callerToken) {
    return { success: false, error: 'No caller API token available to mint a publish token. Sign in (or pass authToken) and retry.' }
  }
  if (!env.API_WORKER) {
    return { success: false, error: 'API_WORKER service binding missing on agent-worker — cannot mint a publish token. Add it to wrangler.toml + redeploy.' }
  }
  let publishToken
  try {
    const mintRes = await env.API_WORKER.fetch('https://vegvisr-api-worker/api/html/publish-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': callerToken },
      body: JSON.stringify({ appId: input.nodeId, hostname: host, ttlDays: 30 }),
    })
    const mintJson = await mintRes.json().catch(() => null)
    if (!mintRes.ok || !mintJson?.success || !mintJson?.token) {
      const detail = (mintJson && mintJson.error) || `HTTP ${mintRes.status}`
      return { success: false, error: `Could not mint publish token via api-worker: ${detail}` }
    }
    publishToken = mintJson.token
  } catch (e) {
    return { success: false, error: `Publish-token mint failed: ${e.message}` }
  }

  // 3. POST the HTML to the brand-worker's publish endpoint.
  //    Prefer the BRAND_WORKER service binding: agent-worker and vegvisr.org subdomains share the
  //    vegvisr.org zone, so a public-hostname fetch loopback-fails with HTTP 522. The binding routes
  //    worker→worker internally, bypassing DNS/zone entirely. brand-worker keys the KV entry off the
  //    BODY hostname (not the request Host), so the internal URL host is irrelevant. Public fetch is
  //    the fallback for a foreign host passed via proxy_url (e.g. a cross-zone domain).
  const overwrite = input.overwrite !== false // default true — republish in place
  const publishBody = JSON.stringify({ hostname: host, html, overwrite, graphId: input.graphId, nodeId: input.nodeId })
  const publishHeaders = { 'Content-Type': 'application/json', 'X-Publish-Token': publishToken }
  const useBinding = env.BRAND_WORKER && !input.proxy_url
  const proxyUrl = useBinding ? 'brand-worker service binding' : (input.proxy_url || `https://${host}/__html/publish`).trim()
  let pubRes, pubJson
  try {
    pubRes = useBinding
      ? await env.BRAND_WORKER.fetch('https://brand-worker/__html/publish', { method: 'POST', headers: publishHeaders, body: publishBody })
      : await fetch(proxyUrl, { method: 'POST', headers: publishHeaders, body: publishBody })
    pubJson = await pubRes.json().catch(() => null)
  } catch (e) {
    return { success: false, error: `Could not reach ${proxyUrl}: ${e.message}. If ${host} does not route to brand-worker yet, run create_subdomain first.` }
  }
  if (!pubRes.ok || !pubJson || !pubJson.ok) {
    const detail = (pubJson && pubJson.error) || `HTTP ${pubRes.status}`
    // 409 = a page already exists and overwrite was not set; surface it plainly.
    if (pubRes.status === 409 || pubJson?.exists) {
      return { success: false, error: `${host} already has a published page. Re-run with overwrite:true to replace it.` }
    }
    return { success: false, error: `Publish rejected by ${host}: ${detail}` }
  }

  return {
    success: true,
    graphId: input.graphId,
    nodeId: input.nodeId,
    host,
    key: `html:${host}`,
    url: `https://${host}/`,
    html_bytes: html.length,
    via: proxyUrl,
    message: `Published node "${input.nodeId}" (${html.length} chars) to https://${host}/. It is now live.`,
  }
}

// ---- Graph version tools (list / fetch / restore) ----------------------------
// Thin wrappers over knowledge-graph-worker's existing history endpoints:
//   GET /getknowgraphhistory?id=   -> { graphId, history: { results: [{version,timestamp}] } }
//   GET /getknowgraphversion?id=&version= -> full graphData { metadata, nodes, edges }
// Restores re-save via saveGraphWithHistory / patchNode, so a restore is itself a
// new version — history is never destroyed.

// Shared Superadmin gate for the restore tools (same caller resolution as
// executeRegisterWorldFounder). Returns { ok, error, email } .
async function resolveSuperadminCaller(input, env, action) {
  const ac = input.authContext || {}
  const callerUserId = input.userId || ac.userId || ac.profile?.user_id || ac.session?.id || null
  let callerRole = String(ac.role || ac.profile?.role || ac.session?.role || '').trim()
  let callerEmail = String(ac.email || ac.profile?.email || ac.session?.email || '').trim()
  if ((!callerRole || !callerEmail) && callerUserId) {
    try {
      const p = await resolveUserProfile(callerUserId, env)
      if (!callerRole) callerRole = String(p?.Role || p?.role || '').trim()
      if (!callerEmail) callerEmail = String(p?.email || '').trim()
    } catch (e) { /* fall through */ }
  }
  if (callerRole.toLowerCase() !== 'superadmin') {
    return { ok: false, error: `Superadmin role required to ${action}. Resolved caller userId=${callerUserId || 'none'}, role=${callerRole || 'unknown'}.` }
  }
  return { ok: true, email: callerEmail || null }
}

// Create a subdomain (CNAME + route -> brand-worker) via api-worker's /create-custom-domain.
// Superadmin only. Zone auto-resolves for the domains in api-worker's DOMAIN_ZONE_MAPPING;
// other root domains need input.zone_id.
async function executeCreateSubdomain(input, env) {
  const gate = await resolveSuperadminCaller(input, env, 'create a subdomain')
  if (!gate.ok) return { success: false, error: gate.error }

  const subdomain = String(input.subdomain || '').trim().toLowerCase()
  const rootDomain = String(input.root_domain || '').trim().toLowerCase()
  const zoneId = String(input.zone_id || '').trim()
  if (!subdomain || /[^a-z0-9-]/.test(subdomain)) {
    return { success: false, error: "subdomain must be a bare label (a-z, 0-9, '-'), e.g. 'fonemer'" }
  }
  if (!rootDomain || !rootDomain.includes('.')) {
    return { success: false, error: "root_domain must be a domain like 'vegvisr.org'" }
  }

  const body = JSON.stringify({ subdomain, rootDomain, ...(zoneId ? { zoneId } : {}) })
  const doFetch = (target) => target.fetch('https://vegvisr-api-worker/create-custom-domain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  let res
  if (env.API_WORKER?.fetch) {
    res = await doFetch(env.API_WORKER)
  } else {
    res = await fetch('https://api.vegvisr.org/create-custom-domain', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    })
  }
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.overallSuccess) {
    return {
      success: false,
      error: data?.error || `create-custom-domain failed (${res.status})`,
      details: data,
      hint: zoneId ? undefined : 'If the root domain is outside the built-in zone mapping (norsegong.com, xyzvibe.com, vegvisr.org, slowyou.training), pass zone_id.',
    }
  }
  const host = `${subdomain}.${rootDomain}`
  return {
    success: true,
    host,
    dns: { id: data?.dnsSetup?.result?.id, created: data?.dnsSetup?.success },
    route: { id: data?.workerSetup?.result?.id, pattern: data?.workerSetup?.result?.pattern, script: data?.workerSetup?.result?.script },
    createdBy: gate.email,
    next: `https://${host} is provisioned (routes to brand-worker). Publish an html-node to it with the viewer's Publish button — the page will serve from html:${host}. DNS may take a minute to propagate.`,
  }
}

async function executeListGraphVersions(input, env) {
  const res = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraphhistory?id=${encodeURIComponent(input.graphId)}`
  )
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `getknowgraphhistory failed (${res.status})`)
  const versions = (data?.history?.results || []).map((r) => ({
    version: Number(r.version),
    timestamp: r.timestamp,
  }))
  return {
    graphId: input.graphId,
    versions,
    count: versions.length,
    note: 'Newest first. The history endpoint returns at most the 20 most recent versions.',
  }
}

async function executeGetGraphVersion(input, env) {
  const res = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraphversion?id=${encodeURIComponent(input.graphId)}&version=${encodeURIComponent(input.version)}`
  )
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `getknowgraphversion failed (${res.status})`)
  const nodes = (data.nodes || []).map((n) => ({
    id: n.id, label: n.label, type: n.type, infoLength: (n.info || '').length,
  }))
  return {
    graphId: input.graphId,
    version: Number(input.version),
    metadata: data.metadata,
    nodeSummaries: nodes,
    graphData: data,
    message: `Version ${input.version}: ${nodes.length} node(s). Full graphData included.`,
  }
}

async function executeRestoreGraphVersion(input, env) {
  const gate = await resolveSuperadminCaller(input, env, 'restore a graph version')
  if (!gate.ok) return { success: false, error: gate.error }

  const res = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraphversion?id=${encodeURIComponent(input.graphId)}&version=${encodeURIComponent(input.version)}`
  )
  const old = await res.json()
  if (!res.ok) throw new Error(old.error || `getknowgraphversion failed (${res.status})`)
  if (!old?.nodes) throw new Error(`Version ${input.version} of graph ${input.graphId} has no graphData`)

  const graphData = {
    metadata: {
      ...(old.metadata || {}),
      restoredFrom: Number(input.version),
      restoredBy: gate.email,
      restoredAt: new Date().toISOString(),
    },
    nodes: old.nodes,
    edges: old.edges || [],
  }
  const saveRes = await env.KG_WORKER.fetch('https://knowledge-graph-worker/saveGraphWithHistory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: input.graphId, graphData, override: true }),
  })
  const saved = await saveRes.json()
  if (!saveRes.ok) throw new Error(saved.error || `saveGraphWithHistory failed (${saveRes.status})`)
  return {
    success: true,
    graphId: input.graphId,
    restoredFrom: Number(input.version),
    newVersion: saved.newVersion,
    message: `Graph restored to the content of version ${input.version} (saved as new version ${saved.newVersion}; no history destroyed).`,
  }
}

async function executeRestoreHtmlNodeVersion(input, env) {
  const gate = await resolveSuperadminCaller(input, env, 'restore an html-node version')
  if (!gate.ok) return { success: false, error: gate.error }

  const res = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraphversion?id=${encodeURIComponent(input.graphId)}&version=${encodeURIComponent(input.version)}`
  )
  const old = await res.json()
  if (!res.ok) throw new Error(old.error || `getknowgraphversion failed (${res.status})`)
  const oldNode = (old.nodes || []).find((n) => n.id === input.nodeId)
  if (!oldNode) {
    const ids = (old.nodes || []).map((n) => n.id).join(', ') || 'none'
    throw new Error(`Node "${input.nodeId}" not found in version ${input.version}. Nodes in that version: ${ids}`)
  }
  if (oldNode.type !== 'html-node' && oldNode.type !== 'css-node') {
    throw new Error(`restore_html_node_version only works on html-node/css-node. Node "${input.nodeId}" was type "${oldNode.type}" in version ${input.version}. Use restore_graph_version for full-graph restore.`)
  }

  const patchData = await patchNodeWithVersionRetry(env, input.graphId, input.nodeId, {
    info: oldNode.info || '',
    updatedAt: new Date().toISOString(),
    updatedBy: gate.email,
    restoredFromVersion: Number(input.version),
  })
  return {
    success: true,
    graphId: input.graphId,
    nodeId: input.nodeId,
    restoredFrom: Number(input.version),
    newVersion: patchData.newVersion,
    infoLength: (oldNode.info || '').length,
    message: `Node "${input.nodeId}" rolled back to its content from version ${input.version} (saved as new version ${patchData.newVersion}). To update a LIVE published page, publish the node again.`,
  }
}

async function executePatchGraphMetadata(input, env) {
  const data = await patchGraphMetadataWithVersionRetry(env, input.graphId, input.fields)
  return {
    graphId: input.graphId,
    updatedFields: data.updatedFields || Object.keys(input.fields),
    version: data.newVersion,
    message: `Graph metadata updated: ${Object.keys(input.fields).join(', ')}`,
  }
}

async function executeListGraphs(input, env) {
  const limit = Math.max(input.limit || 20, 10)
  const offset = input.offset || 0
  let apiUrl = `https://knowledge-graph-worker/getknowgraphsummaries?offset=${offset}&limit=${limit}`
  if (input.metaArea) {
    apiUrl += `&metaArea=${encodeURIComponent(input.metaArea)}`
  }
  const res = await env.KG_WORKER.fetch(apiUrl, { headers: { 'x-user-role': 'Superadmin' } })
  if (!res.ok) throw new Error('Failed to fetch graph summaries')
  const data = await res.json()
  const results = (data.results || []).map(g => {
    const meta = g.metadata || {}
    return {
      id: g.id,
      title: meta.title || g.title || g.id,
      description: meta.description || '',
      category: meta.category || '',
      metaArea: meta.metaArea || '',
      nodeCount: g.nodeCount || g.node_count || 0,
      updatedAt: meta.updatedAt || g.updatedAt || '',
    }
  })

  return {
    total: data.total || results.length,
    offset,
    limit,
    graphs: results,
  }
}

async function executeListMetaAreas(input, env) {
  // Fetch a large batch of summaries to aggregate meta areas and categories
  const res = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraphsummaries?offset=0&limit=500`,
    { headers: { 'x-user-role': 'Superadmin' } }
  )
  if (!res.ok) throw new Error('Failed to fetch graph summaries')
  const data = await res.json()

  const metaAreaCounts = {}
  const categoryCounts = {}

  for (const g of (data.results || [])) {
    // metadata is a nested object: g.metadata.metaArea, g.metadata.category
    const meta = g.metadata || {}

    // Parse meta areas (stored as "TAG1" or "TAG1 TAG2")
    const rawMeta = meta.metaArea || ''
    const areas = rawMeta.split('#').map(s => s.trim().toUpperCase()).filter(Boolean)
    // If no # delimiters, treat the whole string as one area
    if (areas.length === 0 && rawMeta.trim()) {
      areas.push(rawMeta.trim().toUpperCase())
    }
    for (const area of areas) {
      metaAreaCounts[area] = (metaAreaCounts[area] || 0) + 1
    }

    // Parse categories (stored as "#Cat1 #Cat2")
    const rawCat = meta.category || ''
    const cats = rawCat.split('#').map(s => s.trim()).filter(Boolean)
    for (const cat of cats) {
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1
    }
  }

  // Sort by count descending
  const metaAreas = Object.entries(metaAreaCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }))

  const categories = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }))

  return {
    message: `Found ${metaAreas.length} meta areas and ${categories.length} categories`,
    metaAreas,
    categories,
  }
}

// ── Node operations ───────────────────────────────────────────────

async function executeCreateHtmlNode(input, env) {
  const response = await env.KG_WORKER.fetch('https://knowledge-graph-worker/addNode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      graphId: input.graphId,
      node: {
        id: input.nodeId,
        label: input.label,
        type: 'html-node',
        info: input.htmlContent,
        bibl: input.references || [],
        position: { x: 0, y: 0 },
        visible: true,
        metadata: { origin: 'custom', createdAt: new Date().toISOString() }
      }
    })
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error || `Failed to add node (status: ${response.status})`)
  }
  return {
    graphId: input.graphId,
    nodeId: input.nodeId,
    origin: 'custom',
    version: data.newVersion,
    message: `HTML node "${input.label}" added successfully`,
    viewUrl: `https://www.vegvisr.org/gnew-viewer?graphId=${input.graphId}`
  }
}

async function executeCreateNode(input, env) {
  const parseMaybeJsonObject = (value) => {
    if (!value) return null
    if (typeof value === 'object') return value
    if (typeof value !== 'string') return null
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  }

  const toKebab = (value) => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  const legacyNode = parseMaybeJsonObject(input.node)
  const graphId = input.graphId || input.graph_id
  const label = input.label || legacyNode?.label || 'Untitled Node'
  const generatedNodeId = `node-${toKebab(label || input.content || legacyNode?.info || 'item') || 'item'}-${crypto.randomUUID().slice(0, 8)}`
  const nodeId = input.nodeId || input.node_id || legacyNode?.id || generatedNodeId
  const nodeType = input.nodeType || input.type || legacyNode?.type || 'fulltext'
  const content =
    input.content ??
    input.info ??
    legacyNode?.content ??
    legacyNode?.info ??
    ''
  const references = input.references || input.bibl || legacyNode?.references || legacyNode?.bibl || []
  const path = input.path || legacyNode?.path
  const imageWidth = input.imageWidth || legacyNode?.imageWidth
  const imageHeight = input.imageHeight || legacyNode?.imageHeight
  const color = input.color || legacyNode?.color
  const metadata = input.metadata || legacyNode?.metadata

  if (!graphId) {
    const providedKeys = Object.keys(input || {}).join(', ')
    throw new Error(`create_node requires graphId. Received keys: [${providedKeys}]`)
  }

  const node = {
    id: nodeId,
    label,
    type: nodeType,
    info: content,
    bibl: references,
    position: { x: input.positionX || 0, y: input.positionY || 0 },
    visible: true
  }
  if (path) node.path = path
  if (imageWidth) node.imageWidth = imageWidth
  if (imageHeight) node.imageHeight = imageHeight
  if (color) node.color = color
  if (metadata) node.metadata = metadata

  const response = await env.KG_WORKER.fetch('https://knowledge-graph-worker/addNode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ graphId, node })
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error || `Failed to add node (status: ${response.status})`)
  }
  return {
    graphId,
    nodeId,
    nodeType: node.type,
    version: data.newVersion,
    message: `Node "${label}" (${node.type}) added successfully`
  }
}

async function executeAddEdge(input, env) {
  const getRes = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(input.graphId)}`
  )
  const graphData = await getRes.json()
  if (!getRes.ok || !graphData.nodes) {
    throw new Error(graphData.error || 'Graph not found')
  }

  // Validate that source and target nodes exist
  const nodeIds = graphData.nodes.map(n => n.id)
  const missing = []
  if (!nodeIds.includes(input.sourceId)) missing.push(`sourceId "${input.sourceId}"`)
  if (!nodeIds.includes(input.targetId)) missing.push(`targetId "${input.targetId}"`)
  if (missing.length > 0) {
    const validIds = graphData.nodes.map(n => `"${n.id}" (${n.label})`).join(', ')
    throw new Error(`${missing.join(' and ')} not found in graph. Valid node IDs: ${validIds}`)
  }

  const edgeId = `${input.sourceId}_${input.targetId}`
  const existingEdge = graphData.edges.find(e => e.id === edgeId)
  if (existingEdge) {
    return { graphId: input.graphId, edgeId, message: 'Edge already exists' }
  }

  graphData.edges.push({
    id: edgeId,
    source: input.sourceId,
    target: input.targetId,
    label: input.label || ''
  })

  const saveRes = await env.KG_WORKER.fetch('https://knowledge-graph-worker/saveGraphWithHistory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: input.graphId, graphData, override: true })
  })

  const saveData = await saveRes.json()
  if (!saveRes.ok) {
    throw new Error(saveData.error || `Failed to save edge (status: ${saveRes.status})`)
  }
  return {
    graphId: input.graphId,
    edgeId,
    version: saveData.newVersion,
    message: `Edge ${input.sourceId} -> ${input.targetId} added`
  }
}

// ── Contract & template operations ────────────────────────────────

function deepMerge(source, target) {
  const result = { ...source }
  for (const key of Object.keys(target)) {
    if (target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
        && source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(source[key], target[key])
    } else {
      result[key] = target[key]
    }
  }
  return result
}

async function executeGetContract(input, env) {
  let contract = null

  if (input.contractId) {
    contract = await env.DB.prepare(
      'SELECT * FROM agent_contracts WHERE id = ?1'
    ).bind(input.contractId).first()
  } else if (input.templateName) {
    contract = await env.DB.prepare(
      'SELECT * FROM agent_contracts WHERE name = ?1'
    ).bind(input.templateName).first()
  }

  if (contract) {
    let contractJson = JSON.parse(contract.contract_json)

    if (contract.parent_contract_id) {
      const parent = await env.DB.prepare(
        'SELECT contract_json FROM agent_contracts WHERE id = ?1'
      ).bind(contract.parent_contract_id).first()
      if (parent) {
        const parentJson = JSON.parse(parent.contract_json)
        contractJson = deepMerge(parentJson, contractJson)
      }
    }

    if (contract.template_id) {
      const template = await env.DB.prepare(
        'SELECT name, nodes, ai_instructions FROM graphTemplates WHERE id = ?1'
      ).bind(contract.template_id).first()
      if (template) {
        contractJson._templateExample = {
          name: template.name,
          nodes: template.nodes ? JSON.parse(template.nodes) : null
        }
      }
    }

    return contractJson
  }

  if (input.templateName) {
    const template = await env.DB.prepare(
      'SELECT name, nodes, ai_instructions FROM graphTemplates WHERE name = ?1'
    ).bind(input.templateName).first()
    if (template && template.ai_instructions) {
      try {
        return JSON.parse(template.ai_instructions)
      } catch {
        return { rawInstructions: template.ai_instructions }
      }
    }
  }

  return { error: 'Contract not found' }
}

async function executeGetHtmlTemplate(input, env) {
  let contractInfo = null
  let templateId = input.templateId || DEFAULT_TEMPLATE_ID

  if (input.contractId) {
    const row = await env.DB.prepare(
      'SELECT contract_json FROM agent_contracts WHERE id = ?1'
    ).bind(input.contractId).first()
    if (row) {
      contractInfo = JSON.parse(row.contract_json)
      if (contractInfo.node?.templateId && !input.templateId) {
        templateId = contractInfo.node.templateId
      }
    }
  }

  const entry = getTemplate(templateId)

  // Extract CSS variables from the template's :root block
  let cssVariables = null
  const rootMatch = entry.template.match(/:root\s*\{([^}]+)\}/)
  if (rootMatch) {
    cssVariables = {}
    const re = /--([\w-]+)\s*:\s*([^;]+)/g
    let m
    while ((m = re.exec(rootMatch[1])) !== null) {
      cssVariables['--' + m[1].trim()] = m[2].trim()
    }
  }

  return {
    templateId: entry.id,
    templateSize: entry.template.length,
    placeholders: entry.placeholders,
    description: entry.description,
    version: getTemplateVersion(templateId),
    cssVariables,
    instructions: 'Use create_html_from_template to create the HTML node. Pass the placeholder values and the worker fills them into the template server-side. CSS must be created as a SEPARATE css-node. Use the cssVariables to match this template\'s visual style in custom apps.',
    contractInfo,
    availableTemplates: listTemplates(),
  }
}

async function executeCreateHtmlFromTemplate(input, env) {
  const templateId = input.templateId || DEFAULT_TEMPLATE_ID
  const entry = getTemplate(templateId)

  let html = entry.template
  html = html.replaceAll('{{TITLE}}', input.title || 'Untitled')
  html = html.replaceAll('{{DESCRIPTION}}', input.description || '')
  html = html.replaceAll('{{FOOTER_TEXT}}', input.footerText || '')
  html = html.replaceAll('{{DEFAULT_THEME}}', input.defaultTheme || '')
  html = html.replaceAll('{{GRAPH_ID_DEFAULT}}', input.graphId || '')

  const nodeId = input.nodeId || `html-node-${Date.now()}`
  html = html.replaceAll('{{NODE_ID}}', nodeId)
  const response = await env.KG_WORKER.fetch('https://knowledge-graph-worker/addNode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      graphId: input.graphId,
      node: {
        id: nodeId,
        label: input.title || 'Untitled Page',
        type: 'html-node',
        info: html,
        bibl: [],
        position: { x: 0, y: 0 },
        visible: true,
        metadata: { origin: 'template', templateId, createdAt: new Date().toISOString() }
      }
    })
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error || `Failed to create HTML node (status: ${response.status})`)
  }

  const createdSections = []
  if (Array.isArray(input.sections) && input.sections.length > 0) {
    for (let i = 0; i < input.sections.length; i++) {
      const section = input.sections[i]
      const sectionTitle = section.title || `Section ${i + 1}`
      const sectionContent = section.content || ''
      const sectionId = `section-${i + 1}-${Date.now()}`

      const sectionRes = await env.KG_WORKER.fetch('https://knowledge-graph-worker/addNode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graphId: input.graphId,
          node: {
            id: sectionId,
            label: `# ${sectionTitle}`,
            type: 'fulltext',
            info: sectionContent,
            bibl: [],
            position: { x: 200, y: 100 + (i * 150) },
            visible: true
          }
        })
      })

      if (sectionRes.ok) {
        createdSections.push({ id: sectionId, label: `# ${sectionTitle}` })
      }
    }
  }

  let headerImageNodeId = null
  if (input.headerImage) {
    headerImageNodeId = `header-image-${Date.now()}`
    const imgRes = await env.KG_WORKER.fetch('https://knowledge-graph-worker/addNode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graphId: input.graphId,
        node: {
          id: headerImageNodeId,
          label: 'Header Image',
          type: 'markdown-image',
          info: `![Header Image|width:100%;height:400px;object-fit:cover](${input.headerImage})`,
          path: input.headerImage,
          bibl: [],
          position: { x: -200, y: 0 },
          visible: true,
          imageWidth: '1536',
          imageHeight: '400'
        }
      })
    })
    if (!imgRes.ok) {
      console.warn('Failed to create header image node')
      headerImageNodeId = null
    }
  }

  return {
    graphId: input.graphId,
    nodeId: nodeId,
    origin: 'template',
    templateId,
    version: data.newVersion,
    htmlSize: html.length,
    sectionsCreated: createdSections.length,
    headerImageNodeId: headerImageNodeId,
    message: `Editable HTML page "${input.title}" created from template "${templateId}" (${html.length} bytes) with ${createdSections.length} content sections${headerImageNodeId ? ' and a header image node' : ''}. The page discovers nodes with # prefix labels.`,
    viewUrl: `https://www.vegvisr.org/gnew-viewer?graphId=${input.graphId}`
  }
}

// ── Search & media operations ─────────────────────────────────────

async function executePerplexitySearch(input, env) {
  const query = input.query
  if (!query) throw new Error('query is required')

  // FORCE sonar-pro. The basic `sonar` tier returns terse non-cited text
  // that lets the model fall back to training data and skip the citations
  // the user actually asked for. We do not let the model downgrade — even
  // if it puts model: 'sonar' in the tool input, we override here.
  const model = 'sonar-pro'
  const validModels = ['sonar', 'sonar-pro', 'sonar-reasoning']
  if (!validModels.includes(model)) {
    throw new Error(`Invalid model: ${model}. Use one of: ${validModels.join(', ')}`)
  }

  const endpoint = model === 'sonar' ? '/sonar' : model === 'sonar-pro' ? '/sonar-pro' : '/sonar-reasoning'

  const body = {
    userId: input.userId,
    messages: [{ role: 'user', content: query }],
  }
  if (input.search_recency_filter) body.search_recency_filter = input.search_recency_filter

  const res = await env.PERPLEXITY.fetch(`https://perplexity-worker${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.error || `Perplexity API error (${res.status})`)
  }

  const choice = data.choices?.[0]?.message?.content || ''
  const citations = data.citations || []
  const searchResults = data.search_results || []

  return {
    message: `Perplexity search completed (${model})`,
    model: data.model,
    content: choice,
    citations,
    sources: searchResults.map(s => ({ title: s.title, url: s.url, snippet: s.snippet })),
    usage: data.usage,
  }
}

async function executeFetchUrl(input, env) {
  const url = String(input.url || '').trim()
  if (!url) throw new Error('url is required')
  if (!/^https:\/\//i.test(url)) {
    throw new Error('fetch_url only supports HTTPS URLs')
  }

  const res = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'user-agent': 'VegvisrAgent/1.0 (+https://agent.vegvisr.org)',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
    },
  })

  if (!res.ok) {
    throw new Error(`Failed to fetch URL (${res.status} ${res.statusText})`)
  }

  const contentType = (res.headers.get('content-type') || '').toLowerCase()
  const maxChars = Math.min(Math.max(Number(input.maxChars || 12000), 1000), 40000)
  const raw = await res.text()

  let text = raw
  if (contentType.includes('text/html') || /<html[\s>]/i.test(raw)) {
    // Remove scripts/styles and collapse tags to readable text.
    text = raw
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/\s+/g, ' ')
      .trim()
  }

  const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : null
  const truncated = text.length > maxChars

  return {
    url,
    finalUrl: res.url,
    status: res.status,
    contentType,
    title,
    text: truncated ? text.slice(0, maxChars) + '... [truncated]' : text,
    textLength: text.length,
    truncated,
    message: `Fetched ${res.url} (${contentType || 'unknown content type'})`,
  }
}

async function executeSearchPexels(input, env) {
  const query = input.query
  if (!query) throw new Error('query is required')

  const res = await env.API_WORKER.fetch('https://vegvisr-api-worker/pexels-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, count: input.count || 5 }),
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `Pexels API error (${res.status})`)

  return {
    message: `Found ${data.total || 0} Pexels images for "${query}"`,
    query: data.query,
    total: data.total,
    images: (data.images || []).map(img => ({
      url: img.src?.large || img.url,
      alt: img.alt,
      photographer: img.photographer,
      width: img.width,
      height: img.height,
      pexels_url: img.pexels_url,
    })),
  }
}

async function executeSearchUnsplash(input, env) {
  const query = input.query
  if (!query) throw new Error('query is required')

  const res = await env.API_WORKER.fetch('https://vegvisr-api-worker/unsplash-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, count: input.count || 5 }),
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `Unsplash API error (${res.status})`)

  return {
    message: `Found ${data.total || 0} Unsplash images for "${query}"`,
    query: data.query,
    total: data.total,
    images: (data.images || []).map(img => ({
      url: img.urls?.regular || img.url,
      alt: img.alt,
      photographer: img.photographer,
      width: img.width,
      height: img.height,
      unsplash_url: img.unsplash_url,
    })),
  }
}

async function executeGetAlbumImages(input, env) {
  const albumName = input.albumName
  if (!albumName) throw new Error('albumName is required')

  const userId = input.userId
  if (!userId) throw new Error('userId is required for album access')

  // Look up the user's API token from D1 config table
  const userRecord = await env.DB.prepare(
    'SELECT emailVerificationToken FROM config WHERE user_id = ?'
  ).bind(userId).first()

  if (!userRecord?.emailVerificationToken) {
    throw new Error('No API token found for user — please log in again')
  }

  const res = await env.ALBUMS_WORKER.fetch(
    `https://vegvisr-albums-worker/photo-album?name=${encodeURIComponent(albumName)}`,
    { headers: { 'X-API-Token': userRecord.emailVerificationToken } }
  )

  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `Albums API error (${res.status})`)

  const images = (data.images || []).map(key => ({
    key,
    url: `https://vegvisr.imgix.net/${key}`,
  }))

  return {
    message: `Album "${albumName}" has ${images.length} images`,
    albumName,
    imageCount: images.length,
    images,
  }
}

// ── album & photo subagent tool implementations ──────────────────
// Wrap the albums-worker (KV album records) and photos-worker (R2 + trash).
// Auth: X-API-Token = emailVerificationToken, read via getAuthTokenFromToolInput.
// Service bindings: env.ALBUMS_WORKER, env.PHOTOS_WORKER.

async function albumsApiFetch({ env, authToken, method = 'GET', path, body = null }) {
  if (!env.ALBUMS_WORKER) throw new Error('ALBUMS_WORKER service binding is not configured')
  const headers = { 'X-API-Token': authToken }
  const init = { method, headers }
  if (body !== null) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  const res = await env.ALBUMS_WORKER.fetch(`https://vegvisr-albums-worker${path}`, init)
  const text = await res.text()
  let data = {}
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
  if (!res.ok) throw new Error(data.error || `albums-worker ${res.status}: ${text.slice(0, 200)}`)
  return data
}

async function photosApiFetch({ env, authToken, method = 'GET', path, body = null, formData = null }) {
  if (!env.PHOTOS_WORKER) throw new Error('PHOTOS_WORKER service binding is not configured')
  const headers = {}
  if (authToken) headers['X-API-Token'] = authToken
  const init = { method, headers }
  if (formData) {
    // Do NOT set Content-Type when sending FormData — runtime sets the multipart boundary
    init.body = formData
  } else if (body !== null) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  const res = await env.PHOTOS_WORKER.fetch(`https://vegvisr-photos-worker${path}`, init)
  const text = await res.text()
  let data = {}
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
  if (!res.ok) throw new Error(data.error || `photos-worker ${res.status}: ${text.slice(0, 200)}`)
  return data
}

async function executeAlbumList(input, env) {
  const authToken = getAuthTokenFromToolInput(input)
  if (!authToken) throw new Error('You must be logged in to list albums.')
  const path = input?.includeMeta ? '/photo-albums?includeMeta=1' : '/photo-albums'
  const data = await albumsApiFetch({ env, authToken, path })
  const albums = data?.albums || data?.names || data
  const count = Array.isArray(albums) ? albums.length : 0
  return { message: `Found ${count} album(s)`, count, albums }
}

async function executeAlbumGet(input, env) {
  const authToken = getAuthTokenFromToolInput(input)
  if (!authToken) throw new Error('You must be logged in to read an album.')
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  if (!name) throw new Error('name is required')
  const data = await albumsApiFetch({ env, authToken, path: `/photo-album?name=${encodeURIComponent(name)}` })
  return {
    message: `Album "${name}" loaded`,
    name,
    album: data,
    imageCount: Array.isArray(data?.images) ? data.images.length : 0,
  }
}

async function executeAlbumCreateOrUpdate(input, env) {
  const authToken = getAuthTokenFromToolInput(input)
  if (!authToken) throw new Error('You must be logged in to modify an album.')
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  if (!name) throw new Error('name is required')
  const body = { name }
  if (Array.isArray(input.images)) body.images = input.images
  if (typeof input.seoTitle === 'string') body.seoTitle = input.seoTitle
  if (typeof input.seoDescription === 'string') body.seoDescription = input.seoDescription
  if (typeof input.seoImageKey === 'string') body.seoImageKey = input.seoImageKey
  if (typeof input.isShared === 'boolean') body.isShared = input.isShared
  if (input.regenerateShareId === true) body.regenerateShareId = true
  const data = await albumsApiFetch({ env, authToken, method: 'POST', path: '/photo-album', body })
  return {
    message: `Album "${name}" saved`,
    name,
    album: data,
    shareId: data?.shareId || data?.album?.shareId || null,
  }
}

async function executeAlbumDelete(input, env) {
  const authToken = getAuthTokenFromToolInput(input)
  if (!authToken) throw new Error('You must be logged in to delete an album.')
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  if (!name) throw new Error('name is required')
  const data = await albumsApiFetch({
    env, authToken, method: 'DELETE',
    path: `/photo-album?name=${encodeURIComponent(name)}`,
  })
  return { message: `Album "${name}" deleted`, name, result: data }
}

async function executeAlbumAddImages(input, env) {
  const authToken = getAuthTokenFromToolInput(input)
  if (!authToken) throw new Error('You must be logged in to modify an album.')
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  if (!name) throw new Error('name is required')
  const images = Array.isArray(input.images)
    ? input.images
    : (typeof input.image === 'string' ? [input.image] : [])
  if (images.length === 0) throw new Error('images or image is required')
  const body = images.length === 1 ? { name, image: images[0] } : { name, images }
  const data = await albumsApiFetch({ env, authToken, method: 'POST', path: '/photo-album/add', body })
  return {
    message: `Added ${images.length} image(s) to "${name}"`,
    name,
    addedCount: images.length,
    album: data,
  }
}

async function executeAlbumRemoveImages(input, env) {
  const authToken = getAuthTokenFromToolInput(input)
  if (!authToken) throw new Error('You must be logged in to modify an album.')
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  if (!name) throw new Error('name is required')
  const images = Array.isArray(input.images)
    ? input.images
    : (typeof input.image === 'string' ? [input.image] : [])
  if (images.length === 0) throw new Error('images or image is required')
  const body = images.length === 1 ? { name, image: images[0] } : { name, images }
  const data = await albumsApiFetch({ env, authToken, method: 'POST', path: '/photo-album/remove', body })
  return {
    message: `Removed ${images.length} image(s) from "${name}"`,
    name,
    removedCount: images.length,
    album: data,
  }
}

async function executeAlbumPublish(input, env) {
  const authToken = getAuthTokenFromToolInput(input)
  if (!authToken) throw new Error('You must be logged in to publish an album.')
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  if (!name) throw new Error('name is required')
  const data = await albumsApiFetch({
    env, authToken, method: 'POST', path: '/photo-album',
    body: { name, isShared: true },
  })
  const shareId = data?.shareId || data?.album?.shareId || null
  return {
    message: shareId ? `Album "${name}" published` : `Publish requested for "${name}" (shareId not in response)`,
    name,
    shareId,
    shareUrl: shareId ? `https://seo.vegvisr.org/album/${shareId}` : null,
    album: data,
  }
}

async function executeAlbumRotateShare(input, env) {
  const authToken = getAuthTokenFromToolInput(input)
  if (!authToken) throw new Error('You must be logged in to rotate a share link.')
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  if (!name) throw new Error('name is required')
  const data = await albumsApiFetch({
    env, authToken, method: 'POST', path: '/photo-album',
    body: { name, isShared: true, regenerateShareId: true },
  })
  const shareId = data?.shareId || data?.album?.shareId || null
  return {
    message: `ShareId rotated for "${name}"`,
    name,
    shareId,
    shareUrl: shareId ? `https://seo.vegvisr.org/album/${shareId}` : null,
    album: data,
  }
}

async function executePhotosList(input, env) {
  const authToken = getAuthTokenFromToolInput(input)
  const params = new URLSearchParams()
  if (typeof input?.album === 'string' && input.album.trim()) params.set('album', input.album.trim())
  if (typeof input?.share === 'string' && input.share.trim()) params.set('share', input.share.trim())
  const qs = params.toString() ? `?${params.toString()}` : ''
  // share mode is auth-not-required; bucket-listing is also auth-not-required.
  // album mode needs auth unless the album is shared. Pass token if we have one.
  const data = await photosApiFetch({
    env,
    authToken: authToken || null,
    path: `/list-r2-images${qs}`,
  })
  const images = Array.isArray(data?.images) ? data.images : []
  return {
    message: `Listed ${images.length} image(s)` + (input?.album ? ` in album "${input.album}"` : input?.share ? ` from shared album` : ''),
    count: images.length,
    images,
    album: data?.album || null,
  }
}

async function executePhotosUploadFromUrl(input, env) {
  const authToken = getAuthTokenFromToolInput(input)
  const url = typeof input?.url === 'string' ? input.url.trim() : ''
  if (!url) throw new Error('url is required')
  if (!/^https?:\/\//i.test(url)) throw new Error('url must be HTTP(S)')

  const imgRes = await fetch(url)
  if (!imgRes.ok) throw new Error(`Failed to fetch source image (${imgRes.status})`)
  const blob = await imgRes.blob()
  const contentType = imgRes.headers.get('content-type') || blob.type || 'application/octet-stream'

  // Derive filename: explicit input.filename → from URL path → fallback
  let filename = (typeof input?.filename === 'string' && input.filename.trim()) ? input.filename.trim() : ''
  if (!filename) {
    try {
      const u = new URL(url)
      const last = u.pathname.split('/').filter(Boolean).pop() || 'image'
      filename = last.includes('.') ? last : `${last}.${(contentType.split('/')[1] || 'bin').split(';')[0]}`
    } catch {
      filename = 'image.bin'
    }
  }

  const formData = new FormData()
  formData.append('file', new File([blob], filename, { type: contentType }))
  if (typeof input?.album === 'string' && input.album.trim()) formData.append('album', input.album.trim())
  if (typeof input?.filename === 'string' && input.filename.trim()) formData.append('filename', input.filename.trim())
  if (typeof input?.displayName === 'string' && input.displayName.trim()) formData.append('displayName', input.displayName.trim())
  if (Array.isArray(input?.tags) && input.tags.length > 0) {
    try { formData.append('tags', JSON.stringify(input.tags)) } catch { /* ignore */ }
  }

  const data = await photosApiFetch({
    env,
    authToken: authToken || null,
    method: 'POST',
    path: '/upload',
    formData,
  })

  const keys = Array.isArray(data?.keys) ? data.keys : []
  const urls = Array.isArray(data?.urls) ? data.urls : []
  return {
    message: keys.length > 0
      ? `Uploaded ${keys.length} image(s) to ${data?.album ? `album "${data.album}"` : 'bucket'}`
      : 'Upload returned no keys',
    keys,
    urls,
    key: keys[0] || null,
    url: urls[0] || null,
    album: data?.album || null,
  }
}

async function executePhotosDelete(input, env) {
  const authToken = getAuthTokenFromToolInput(input)
  const key = typeof input?.key === 'string' ? input.key.trim() : ''
  if (!key) throw new Error('key is required')
  // Note: cascade — the worker walks every album in KV and removes this key.
  const data = await photosApiFetch({
    env,
    authToken: authToken || null,
    method: 'DELETE',
    path: `/delete-r2-image?key=${encodeURIComponent(key)}`,
  })
  return {
    message: `Image "${key}" soft-deleted (cascaded across albums)`,
    key,
    deleted: data?.deleted ?? null,
    trashed: data?.trashed ?? null,
    deletedAt: data?.deletedAt ?? null,
  }
}

// ── analyze_image: vision analysis via Haiku ─────────────────────

async function executeAnalyzeImage(input, env) {
  const imageUrl = input.imageUrl
  if (!imageUrl) throw new Error('imageUrl is required')
  if (!imageUrl.startsWith('https://')) {
    throw new Error('analyze_image requires an HTTPS URL (e.g. https://vegvisr.imgix.net/...). If the image was pasted directly in chat, you can already see it — no need to call this tool. For base64/data URIs, the user must upload the image to their photo album first.')
  }
  const question = input.question || 'Describe this image in detail.'

  const res = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: input.userId,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: imageUrl } },
          { type: 'text', text: question }
        ]
      }],
      model: MODELS.HAIKU,
      max_tokens: 2048,
    })
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Image analysis failed (${res.status}): ${errText}`)
  }

  const data = await res.json()
  const analysis = (data.content || []).find(c => c.type === 'text')?.text || 'No analysis available'

  return { imageUrl, question, analysis }
}

// ── Shared: resolve userId (UUID or email) to profile via D1 ─────

async function resolveUserProfile(userId, env) {
  // Retry up to 3 times with increasing delay (handles D1 cold-start timeouts)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Try by email first
      let profile = await env.DB.prepare(
        'SELECT email, user_id, bio, profileimage, Role AS role, phone, phone_verified_at, data FROM config WHERE email = ?'
      ).bind(userId).first()
      // If not found, try by user_id (UUID)
      if (!profile) {
        profile = await env.DB.prepare(
          'SELECT email, user_id, bio, profileimage, Role AS role, phone, phone_verified_at, data FROM config WHERE user_id = ?'
        ).bind(userId).first()
      }
      return profile // may be null if user not in config
    } catch (err) {
      if (attempt < 2) {
        // Wait with increasing delay: 300ms, 600ms
        await new Promise(r => setTimeout(r, 300 * (attempt + 1)))
        continue
      }
      // All attempts failed — give up
      return null
    }
  }
  return null
}

// ── User profile operations ───────────────────────────────────────

async function executeWhoAmI(input, env) {
  const verifiedUserId = input?.authContext?.authenticated
    ? (input.authContext.userId || input.authContext.email || null)
    : null
  const userId = verifiedUserId || input.userId
  if (!userId) throw new Error('No user context available')

  // 1. Query D1 config table — userId may be an email or a UUID
  const profile = await resolveUserProfile(userId, env)

  // Parse the JSON `data` column for branding etc.
  let extraData = {}
  if (profile?.data) {
    try { extraData = JSON.parse(profile.data) } catch { /* ignore */ }
  }

  // 2. Query D1 for configured API keys (try both userId formats)
  let apiKeys = []
  try {
    let keysResult = await env.DB.prepare(
      'SELECT provider, enabled, last_used FROM user_api_keys WHERE user_id = ?'
    ).bind(userId).all()
    // If no keys found and we have a different identifier from profile, try that
    if ((!keysResult.results || keysResult.results.length === 0) && profile?.user_id && profile.user_id !== userId) {
      keysResult = await env.DB.prepare(
        'SELECT provider, enabled, last_used FROM user_api_keys WHERE user_id = ?'
      ).bind(profile.user_id).all()
    }
    if ((!keysResult.results || keysResult.results.length === 0) && profile?.email && profile.email !== userId) {
      keysResult = await env.DB.prepare(
        'SELECT provider, enabled, last_used FROM user_api_keys WHERE user_id = ?'
      ).bind(profile.email).all()
    }
    apiKeys = (keysResult.results || []).map(k => ({
      provider: k.provider,
      enabled: !!k.enabled,
      lastUsed: k.last_used || null,
    }))
  } catch {
    // Table may not exist yet — continue without keys
  }

  const email = profile?.email || (typeof userId === 'string' && userId.includes('@') ? userId : null)

  return {
    email,
    userId: profile?.user_id || userId,
    role: profile?.role || 'user',
    bio: profile?.bio || null,
    phone: profile?.phone || null,
    phoneVerifiedAt: profile?.phone_verified_at || null,
    profileImage: profile?.profileimage || null,
    branding: {
      mySite: extraData?.branding?.mySite || null,
      myLogo: extraData?.branding?.myLogo || null,
    },
    apiKeys,
    verifiedSession: !!input?.authContext?.authenticated,
    message: `User: ${email || userId}, Role: ${profile?.role || 'user'}, API keys: ${apiKeys.length} configured${profile?.bio ? ', Bio: included (output it verbatim when the user asks)' : ''}`,
  }
}

// ── Admin operations ──────────────────────────────────────────────

async function executeAdminRegisterUser(input, env) {
  const callerUserId = input.userId
  if (!callerUserId) throw new Error('No user context available')

  // Verify caller is Superadmin
  const callerProfile = await resolveUserProfile(callerUserId, env)
  const callerRole = (callerProfile?.Role || callerProfile?.role || '').trim()
  if (callerRole !== 'Superadmin') {
    throw new Error('Superadmin role required to register users')
  }

  const email = (input.email || '').trim().toLowerCase()
  if (!email) throw new Error('Email is required')

  const name = (input.name || '').trim() || null
  const phone = (input.phone || '').trim() || null
  const role = (input.role || 'Admin').trim()

  // Check if user already exists
  const existing = await env.DB.prepare('SELECT email FROM config WHERE email = ?').bind(email).first()
  if (existing) {
    return { success: false, error: 'User with this email already exists', email }
  }

  // Generate user_id and emailVerificationToken
  const user_id = crypto.randomUUID()
  const emailVerificationToken = Array.from(crypto.getRandomValues(new Uint8Array(20)))
    .map(b => b.toString(16).padStart(2, '0')).join('')

  const data = JSON.stringify({ profile: { user_id, email, name, phone }, settings: {} })

  await env.DB.prepare(`
    INSERT INTO config (user_id, email, emailVerificationToken, Role, phone, data)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(user_id, email, emailVerificationToken, role, phone, data).run()

  return {
    success: true,
    user_id,
    email,
    name,
    phone,
    role,
    emailVerificationToken,
    loginUrl: `https://login.vegvisr.org`,
    message: `User ${email} (${name || 'no name'}) registered with role "${role}". They can log in at login.vegvisr.org by entering their email.`
  }
}

// Register a World Founder in the world_founders + domains registry (Superadmin only, idempotent).
// Makes the domain resolve in onboarding-status, permits the founder in the login allowlist, and
// links the World content tag. Does NOT touch Cloudflare — pure D1 registry write.
async function executeRegisterWorldFounder(input, env) {
  // Superadmin gate — resolve the caller robustly. The agent loop injects input.userId +
  // input.authContext; read role from authContext first, else look up the profile by userId.
  // Return structured errors (do NOT throw) so the agent narrates the reason instead of a silent
  // SSE stream error.
  const ac = input.authContext || {}
  const callerUserId = input.userId || ac.userId || ac.profile?.user_id || ac.session?.id || null
  let callerRole = String(ac.role || ac.profile?.role || ac.session?.role || '').trim()
  if (!callerRole && callerUserId) {
    try {
      const p = await resolveUserProfile(callerUserId, env)
      callerRole = String(p?.Role || p?.role || '').trim()
    } catch (e) { /* fall through to role check */ }
  }
  if (callerRole.toLowerCase() !== 'superadmin') {
    return { success: false, error: `Superadmin role required to register a World Founder. Resolved caller userId=${callerUserId || 'none'}, role=${callerRole || 'unknown'}.` }
  }

  const founderEmail = (input.founder_email || '').trim().toLowerCase()
  const domain = (input.domain || '').trim().toLowerCase()
  if (!founderEmail || !founderEmail.includes('@')) return { success: false, error: 'founder_email (a valid email) is required' }
  if (!domain || !domain.includes('.')) return { success: false, error: 'domain (e.g. example.com) is required' }

  const stem = domain.split('.')[0]
  const worldName = (input.world_name || '').trim() || (stem.charAt(0).toUpperCase() + stem.slice(1))
  const metaTag = (input.meta_area_tag || '').trim() || ('#' + stem.toUpperCase())
  const cfAccount = (input.cf_account_id || '').trim() || null
  const hostingModel = (input.hosting_model || 'own_account').trim()
  const holder = (input.account_holder_email || '').trim().toLowerCase() || founderEmail

  const existingWF = await env.DB
    .prepare('SELECT id FROM world_founders WHERE founder_email = ? AND domain = ?')
    .bind(founderEmail, domain).first()
  let wfCreated = false
  if (!existingWF) {
    await env.DB.prepare(
      `INSERT INTO world_founders (id, founder_email, world_name, domain, cf_account_id, meta_area_tag, account_holder_email, hosting_model, founder_role, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'World Founder', 'active')`
    ).bind(crypto.randomUUID(), founderEmail, worldName, domain, cfAccount, metaTag, holder, hostingModel).run()
    wfCreated = true
  }

  const existingDom = await env.DB.prepare('SELECT id FROM domains WHERE domain = ?').bind(domain).first()
  let domCreated = false
  if (!existingDom) {
    await env.DB.prepare(
      `INSERT INTO domains (id, domain, cf_account_id, hosting_model, kind, status)
       VALUES (?, ?, ?, ?, 'world', 'active')`
    ).bind(crypto.randomUUID(), domain, cfAccount, hostingModel).run()
    domCreated = true
  }

  return {
    success: true,
    founder_email: founderEmail,
    domain,
    world_name: worldName,
    meta_area_tag: metaTag,
    cf_account_id: cfAccount,
    hosting_model: hostingModel,
    world_founders: wfCreated ? 'created' : 'already present',
    domains: domCreated ? 'created' : 'already present',
    next: `Verify with onboarding_status for ${founderEmail} — domain should resolve via world-founder-registry and the login allowlist now permits this founder.`,
  }
}

// Publish the World-Founder page (central template:world-founder-page from WORLD_TEMPLATES) into a
// founder's HTML_PAGES KV so it serves at me.<domain>. Superadmin only. Uses the FOUNDER's own
// cf_api_token (from config) to act in the founder's Cloudflare account. Returns structured errors.
async function executePublishWorldPage(input, env) {
  const callerUserId = input.userId
  if (!callerUserId) return { success: false, error: 'No user context available — sign in and retry.' }
  const callerProfile = await resolveUserProfile(callerUserId, env)
  const callerRole = (callerProfile?.Role || callerProfile?.role || '').trim()
  if (callerRole !== 'Superadmin') return { success: false, error: 'Superadmin role required to publish a World page.' }

  const domain = (input.domain || '').trim().toLowerCase()
  if (!domain || !domain.includes('.')) return { success: false, error: 'domain (e.g. lydmorah.net) is required' }
  const host = (input.host || ('me.' + domain)).trim().toLowerCase()

  if (!env.WORLD_TEMPLATES) return { success: false, error: 'WORLD_TEMPLATES KV is not bound on agent-worker (add it to wrangler.toml + redeploy).' }
  const templateKey = (input.template_key || 'template:world-founder-page').trim()
  const html = await env.WORLD_TEMPLATES.get(templateKey)
  if (!html) return { success: false, error: `Template "${templateKey}" not found in WORLD_TEMPLATES.` }

  // Mint the publish token LOCALLY with agent-worker's own HTML_PUBLISH_SECRET, then POST the page
  // to /__html/publish. agent-worker is the single owner of the publish secret: it signs here AND
  // stamps the same secret into each brand proxy (provision_world_kv / set_world_publish_secret),
  // so signer and verifier never drift and no unreadable api-worker value is needed (Lesson 44).
  const secret = env.HTML_PUBLISH_SECRET
  if (!secret) {
    return { success: false, error: 'agent-worker has no HTML_PUBLISH_SECRET binding. One-time: run `wrangler secret put HTML_PUBLISH_SECRET` in the Agent-Builder/worker dir with a value you generate (e.g. `openssl rand -hex 32`). The same secret is stamped into each World brand proxy by provision_world_kv / set_world_publish_secret.' }
  }
  const uid = callerProfile?.user_id || callerProfile?.email || 'agent-worker'
  const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
  const publishToken = await signPublishToken({ uid, appId: 'world-founder-page', hostname: host, scope: ['save', 'load', 'loadAll', 'delete'], exp }, secret)

  const proxyUrl = (input.proxy_url || `https://${host}/__html/publish`).trim()
  let pubRes, pubJson
  try {
    pubRes = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Publish-Token': publishToken },
      body: JSON.stringify({ hostname: host, html, overwrite: true }),
    })
    pubJson = await pubRes.json().catch(() => null)
  } catch (e) {
    return { success: false, error: `Could not reach ${proxyUrl}: ${e.message}. Pass proxy_url=<brand-proxy>.workers.dev/__html/publish if ${host} doesn't route to the brand proxy yet.` }
  }
  if (!pubRes.ok || !pubJson || !pubJson.ok) {
    const detail = (pubJson && pubJson.error) || `HTTP ${pubRes.status}`
    return { success: false, error: `Publish rejected: ${detail}` }
  }

  return {
    success: true,
    domain,
    host,
    key: `html:${host}`,
    url: `https://${host}/`,
    template_bytes: html.length,
    via: proxyUrl,
    next: `Published html:${host} via /__html/publish. Open https://${host}/ to see it.`,
  }
}

// Re-publish the World-Founder page to EVERY active World in the world_founders registry. Use after
// editing the shared template so all live me.<domain> pages pick up the change in one call. Reads the
// template + secret ONCE, then loops the distinct active domains minting a host-scoped token per host
// and POSTing to me.<domain>/__html/publish. Per-World failures (e.g. a World not yet provisioned —
// no me. route / publish secret) are captured and reported; they do NOT abort the run. Superadmin only.
async function executePublishAllWorldPages(input, env) {
  const callerUserId = input.userId
  if (!callerUserId) return { success: false, error: 'No user context available — sign in and retry.' }
  const callerProfile = await resolveUserProfile(callerUserId, env)
  const callerRole = (callerProfile?.Role || callerProfile?.role || '').trim()
  if (callerRole !== 'Superadmin') return { success: false, error: 'Superadmin role required to publish all World pages.' }

  if (!env.WORLD_TEMPLATES) return { success: false, error: 'WORLD_TEMPLATES KV is not bound on agent-worker.' }
  const templateKey = (input.template_key || 'template:world-founder-page').trim()
  const html = await env.WORLD_TEMPLATES.get(templateKey)
  if (!html) return { success: false, error: `Template "${templateKey}" not found in WORLD_TEMPLATES.` }
  const secret = env.HTML_PUBLISH_SECRET
  if (!secret) return { success: false, error: 'agent-worker has no HTML_PUBLISH_SECRET binding — set it once via `wrangler secret put HTML_PUBLISH_SECRET`.' }

  // Distinct active World domains from the registry.
  let domains = []
  try {
    const rows = await env.DB.prepare("SELECT DISTINCT domain FROM world_founders WHERE status = 'active' AND domain IS NOT NULL AND domain != '' ORDER BY domain").all()
    domains = ((rows && rows.results) || []).map((r) => String(r.domain || '').trim().toLowerCase()).filter(Boolean)
  } catch (e) {
    return { success: false, error: `Could not read world_founders: ${e.message}` }
  }
  if (!domains.length) return { success: false, error: 'No active Worlds found in world_founders.' }

  const uid = callerProfile?.user_id || callerProfile?.email || 'agent-worker'
  const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
  const results = []
  for (const domain of domains) {
    const host = 'me.' + domain
    try {
      const publishToken = await signPublishToken({ uid, appId: 'world-founder-page', hostname: host, scope: ['save', 'load', 'loadAll', 'delete'], exp }, secret)
      const proxyUrl = `https://${host}/__html/publish`
      const pubRes = await fetch(proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Publish-Token': publishToken },
        body: JSON.stringify({ hostname: host, html, overwrite: true }),
      })
      const pubJson = await pubRes.json().catch(() => null)
      if (pubRes.ok && pubJson && pubJson.ok) results.push({ domain, host, ok: true, url: `https://${host}/` })
      else results.push({ domain, host, ok: false, error: (pubJson && pubJson.error) || `HTTP ${pubRes.status}` })
    } catch (e) {
      results.push({ domain, host, ok: false, error: e.message })
    }
  }

  const published = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok)
  return {
    success: true,
    template_key: templateKey,
    total: domains.length,
    published,
    failed: failed.length,
    results,
    next: failed.length
      ? `Published ${published}/${domains.length}. Not published (likely not provisioned — run provision_world_kv): ${failed.map((f) => f.domain).join(', ')}.`
      : `Published ${published}/${domains.length} World pages.`,
  }
}

// Store a founder's Cloudflare account id + API token in their config row, so the World-provisioning
// tools can act in the founder's own CF account. Superadmin only. Token is stored server-side (D1)
// and never echoed back. The token needs Workers KV Storage edit scope (and Workers Scripts + DNS
// for the full deploy/route tools).
async function executeSetWorldCredentials(input, env) {
  const callerUserId = input.userId
  if (!callerUserId) return { success: false, error: 'No user context available — sign in and retry.' }
  const callerProfile = await resolveUserProfile(callerUserId, env)
  const callerRole = (callerProfile?.Role || callerProfile?.role || '').trim()
  if (callerRole !== 'Superadmin') return { success: false, error: 'Superadmin role required to set World credentials.' }

  let founderEmail = (input.founder_email || '').trim().toLowerCase()
  const domain = (input.domain || '').trim().toLowerCase()
  if (!founderEmail && domain) {
    let wf = await env.DB.prepare("SELECT founder_email FROM world_founders WHERE domain = ? AND cf_account_id IS NOT NULL AND cf_account_id != '' ORDER BY created_at LIMIT 1").bind(domain).first()
    if (!wf) wf = await env.DB.prepare('SELECT founder_email FROM world_founders WHERE domain = ? ORDER BY created_at LIMIT 1').bind(domain).first()
    founderEmail = String((wf && wf.founder_email) || '').toLowerCase()
  }
  if (!founderEmail) return { success: false, error: 'founder_email (or a domain with a registered founder) is required' }

  const cfToken = (input.cf_api_token || '').trim()
  const cfAccount = (input.cf_account_id || '').trim()
  if (!cfToken) return { success: false, error: 'cf_api_token is required' }

  // Validate the token against the CF API before storing. /user/tokens/verify ONLY recognizes
  // USER-owned tokens — an ACCOUNT-owned token (scoped to "Entire account", which is what the
  // World accounts use) fails it with "Invalid API Token" even though it is valid and works for
  // real operations. So: try user-verify; if it fails and we have an account id, fall back to the
  // account-scoped verify (/accounts/<id>/tokens/verify). Accept if either reports active.
  const verifyTokenAt = async (url) => {
    try { return await (await fetch(url, { headers: { Authorization: `Bearer ${cfToken}` } })).json() }
    catch { return {} }
  }
  let verifyData = await verifyTokenAt('https://api.cloudflare.com/client/v4/user/tokens/verify')
  let tokenActive = verifyData.success && verifyData.result?.status === 'active'
  if (!tokenActive && cfAccount) {
    verifyData = await verifyTokenAt(`https://api.cloudflare.com/client/v4/accounts/${cfAccount}/tokens/verify`)
    tokenActive = verifyData.success && verifyData.result?.status === 'active'
  }
  if (!tokenActive) {
    const cfErr = (verifyData.errors || []).map(e => e.message).join('; ') || 'token rejected by Cloudflare'
    return { success: false, error: `CF token validation failed: ${cfErr}. Check the token and retry.`, token_suffix: cfToken.slice(-6) }
  }
  // The token is active — but /accounts/<id>/tokens/verify only checks the BEARER token, it ignores
  // the path account id, so a TYPO'd cf_account_id passes token-verify and stores silently. Confirm
  // the account id itself is real with a direct account read: GET /accounts/<id> returns code 9109
  // "Invalid account identifier" for a wrong id. Reject ONLY on 9109 (the typo case) — a scope/403
  // (token can't read account details) is NOT a reason to reject, since the token already verified.
  if (cfAccount) {
    const acct = await verifyTokenAt(`https://api.cloudflare.com/client/v4/accounts/${cfAccount}`)
    const invalidAccount = (acct.errors || []).some(e => e.code === 9109 || /invalid account identifier/i.test(e.message || ''))
    if (invalidAccount) {
      return { success: false, error: `cf_account_id "${cfAccount}" is invalid — Cloudflare returned "Invalid account identifier". Check for a typo in the account id.`, cf_account_id: cfAccount }
    }
  }

  const existing = await env.DB.prepare('SELECT email FROM config WHERE email = ?').bind(founderEmail).first()
  if (!existing) return { success: false, error: `No config row for ${founderEmail} — register the user first.` }

  if (cfAccount) {
    await env.DB.prepare('UPDATE config SET cf_api_token = ?, cf_account_id = ? WHERE email = ?').bind(cfToken, cfAccount, founderEmail).run()
  } else {
    await env.DB.prepare('UPDATE config SET cf_api_token = ? WHERE email = ?').bind(cfToken, founderEmail).run()
  }
  return {
    success: true,
    founder_email: founderEmail,
    cf_account_id: cfAccount || '(unchanged)',
    cf_api_token: 'stored (never echoed)',
    token_suffix: `...${cfToken.slice(-6)}`,
    token_status: verifyData.result?.status,
    next: 'You can now run provision_world_kv / publish_world_page for this founder.',
  }
}

// Read-only: report whether a World's Cloudflare credentials (cf_account_id + cf_api_token) are
// stored in config — presence ONLY, the token is never echoed (last-6 suffix to identify it).
// Checks every candidate email for the domain: the registry founder, the registry account_holder,
// and any founder_email passed. Answers "are the credentials set, and under which account row?"
async function executeCheckWorldCredentials(input, env) {
  const callerProfile = await resolveUserProfile(input.userId, env)
  const callerRole = (callerProfile?.Role || callerProfile?.role || '').trim()
  if (callerRole !== 'Superadmin') return { success: false, error: 'Superadmin role required to check World credentials.' }

  const domain = (input.domain || '').trim().toLowerCase()
  const explicitEmail = (input.founder_email || '').trim().toLowerCase()

  const candidates = new Set()
  if (explicitEmail) candidates.add(explicitEmail)
  let registry = null
  if (domain) {
    registry = await env.DB.prepare(
      'SELECT founder_email, account_holder_email, cf_account_id FROM world_founders WHERE domain = ? ORDER BY created_at LIMIT 1'
    ).bind(domain).first()
    if (registry && registry.founder_email) candidates.add(String(registry.founder_email).toLowerCase())
    if (registry && registry.account_holder_email) candidates.add(String(registry.account_holder_email).toLowerCase())
  }
  if (!candidates.size) return { success: false, error: 'Provide a domain (with a registered founder) or a founder_email.' }

  const accounts = []
  for (const email of candidates) {
    const r = await env.DB.prepare('SELECT email, cf_account_id, cf_api_token FROM config WHERE email = ?').bind(email).first()
    const tokenSet = !!(r && r.cf_api_token)
    accounts.push({
      email,
      config_row: !!r,
      cf_account_id: (r && r.cf_account_id) || null,
      cf_api_token_set: tokenSet,
      token_suffix: tokenSet ? `...${String(r.cf_api_token).slice(-6)}` : null,
    })
  }
  const ready = accounts.filter((a) => a.cf_api_token_set && a.cf_account_id)
  return {
    success: true,
    domain: domain || null,
    registry: registry ? { founder_email: registry.founder_email, account_holder_email: registry.account_holder_email || null, registry_cf_account_id: registry.cf_account_id || null } : null,
    accounts,
    ready_account: ready.length ? ready[0].email : null,
    summary: accounts.map((a) =>
      `${a.email}: ${a.config_row ? '' : 'NO config row, '}${a.cf_api_token_set ? `token SET ${a.token_suffix}` : 'token NOT set'}${a.cf_account_id ? `, account ${a.cf_account_id}` : ', no account id'}`
    ).join(' | '),
  }
}

// Read a World Founder's app selections (config.data.app_interests, set by the
// founder via the Apps tab on me.<domain>). Superadmin only, read-only. Resolves
// titles from the App Catalog so the result is human-readable.
async function executeGetWorldAppInterests(input, env) {
  const callerUserId = input.userId
  if (!callerUserId) return { success: false, error: 'No user context available — sign in and retry.' }
  const callerProfile = await resolveUserProfile(callerUserId, env)
  const callerRole = (callerProfile?.Role || callerProfile?.role || '').trim()
  if (callerRole !== 'Superadmin') return { success: false, error: 'Superadmin role required to read World app interests.' }

  const founderEmail = (input.founder_email || '').trim().toLowerCase()
  if (!founderEmail) return { success: false, error: 'founder_email is required' }

  const row = await env.DB.prepare('SELECT data FROM config WHERE email = ?').bind(founderEmail).first()
  if (!row) return { success: false, error: `No config row for ${founderEmail}.` }
  let selectedIds = []
  try { const d = JSON.parse(row.data || '{}'); if (Array.isArray(d.app_interests)) selectedIds = d.app_interests } catch { selectedIds = [] }

  // Resolve app titles from the App Catalog (best-effort).
  const titles = {}
  try {
    const res = await env.KG_WORKER.fetch('https://knowledge-graph-worker/getknowgraph?id=6074a2bf-082b-4e92-a91d-eeab94c69b66')
    if (res.ok) {
      const g = await res.json()
      for (const n of (g.nodes || [])) if (/^app-\d+$/.test(n.id || '')) titles[n.id] = n.label || n.id
    }
  } catch { /* titles stay empty — ids still returned */ }

  const selected = selectedIds.map((id) => ({ id, title: titles[id] || id }))
  return {
    success: true,
    founder_email: founderEmail,
    count: selected.length,
    selected,
    summary: selected.length
      ? `${founderEmail} selected ${selected.length} app(s): ${selected.map((s) => s.title).join(', ')}`
      : `${founderEmail} has no apps selected yet.`,
  }
}

// Shared by the World infra tools (provision_world_kv / deploy_world_proxy / set_world_route_dns):
// Superadmin-gate the caller, then resolve the founder's stored Cloudflare account id + API token
// (set via set_world_credentials). Returns { error } on any failure, else { founderEmail, cfAccount, cfToken }.
async function resolveWorldInfraContext(input, env) {
  const callerUserId = input.userId
  if (!callerUserId) return { error: 'No user context available — sign in and retry.' }
  const callerProfile = await resolveUserProfile(callerUserId, env)
  const callerRole = (callerProfile?.Role || callerProfile?.role || '').trim()
  if (callerRole !== 'Superadmin') return { error: 'Superadmin role required for World infrastructure operations.' }

  const domain = (input.domain || '').trim().toLowerCase()
  let founderEmail = (input.founder_email || '').trim().toLowerCase()
  let wfAccount = ''
  if (domain) {
    let wf = await env.DB.prepare("SELECT founder_email, cf_account_id FROM world_founders WHERE domain = ? AND cf_account_id IS NOT NULL AND cf_account_id != '' ORDER BY created_at LIMIT 1").bind(domain).first()
    if (!wf) wf = await env.DB.prepare('SELECT founder_email, cf_account_id FROM world_founders WHERE domain = ? ORDER BY created_at LIMIT 1').bind(domain).first()
    if (!founderEmail) founderEmail = String((wf && wf.founder_email) || '').toLowerCase()
    wfAccount = String((wf && wf.cf_account_id) || '').trim()
  }
  if (!founderEmail) return { error: 'founder_email (or a domain with a registered founder) is required' }

  const row = await env.DB.prepare('SELECT cf_account_id, cf_api_token FROM config WHERE email = ?').bind(founderEmail).first()
  // Fall back to the world_founders registry's cf_account_id when config doesn't carry it, so a bare
  // `set_world_credentials … token` (no account id) still resolves — the registry is authoritative.
  const cfAccount = (input.cf_account_id || (row && row.cf_account_id) || wfAccount || '').trim()
  const cfToken = row && row.cf_api_token
  if (!cfAccount) return { error: `No cf_account_id for ${founderEmail} — run set_world_credentials first.` }
  if (!cfToken) return { error: `No cf_api_token stored for ${founderEmail} — run set_world_credentials first.` }
  return { founderEmail, cfAccount, cfToken, domain }
}

const cfApi = async (path, token, init = {}) => {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  })
  const json = await res.json().catch(() => null)
  const errMsg = json && json.errors && json.errors[0] && (json.errors[0].message || json.errors[0].code)
  return { ok: res.ok && json && json.success, status: res.status, json, error: errMsg }
}

// HS256 publish-token signing (same shape api-worker/html-publish-token.js mints). agent-worker is
// the SINGLE owner of the publish secret: it SIGNS the token here AND STAMPS the same secret into
// each World's brand proxy (setBrandProxySecret), so signer and verifier can never drift and no
// unreadable api-worker value is ever needed (Lesson 44).
const b64url = (bytes) => {
  let bin = ''
  const u = new Uint8Array(bytes)
  for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
async function signPublishToken(payload, secret) {
  const enc = new TextEncoder()
  const header = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body = b64url(enc.encode(JSON.stringify(payload)))
  const data = `${header}.${body}`
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data))
  return `${data}.${b64url(sig)}`
}

// Write HTML_PUBLISH_SECRET onto a World's brand-proxy worker via the CF API (Workers Scripts edit).
// Returns { ok, workerName, status?, detail?, scripts? }. workerName defaults to <stem>-brand-proxy.
async function setBrandProxySecret(cfAccount, cfToken, domain, secret, workerNameOverride) {
  const stem = (domain || '').split('.')[0]
  const workerName = (workerNameOverride || `${stem}-brand-proxy`).trim()
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cfAccount}/workers/scripts/${workerName}/secrets`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${cfToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'HTML_PUBLISH_SECRET', text: secret, type: 'secret_text' }),
  })
  const json = await res.json().catch(() => null)
  if (res.ok && json && json.success) return { ok: true, workerName }
  const detail = (json && json.errors && json.errors[0] && (json.errors[0].message || json.errors[0].code)) || `HTTP ${res.status}`
  let scripts = null
  if (res.status === 404) {
    const list = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cfAccount}/workers/scripts`, { headers: { Authorization: `Bearer ${cfToken}` } })
    const lj = await list.json().catch(() => null)
    scripts = (lj && lj.success && (lj.result || []).map((s) => s.id)) || []
  }
  return { ok: false, workerName, status: res.status, detail, scripts }
}

// Bind the HTML_PAGES KV namespace to a World's brand-proxy worker via the CF API (Workers Scripts
// edit). This is the step that previously had to be done by hand in the Cloudflare dashboard. It is
// idempotent (skips when already bound to the same namespace) and PRESERVES every other binding —
// it reads the current settings, keeps all existing bindings (including the HTML_PUBLISH_SECRET
// secret_text entry, which CF keeps by name), and appends/repairs only the HTML_PAGES binding
// (Lesson 21: merge, never rebuild). Callers MUST run setBrandProxySecret AFTER this so the publish
// secret is always (re-)stamped last — that makes a secret wipe by the settings PATCH impossible to
// observe even if CF's semantics ever changed. Returns { ok, workerName, alreadyBound?, bound? } or
// { ok:false, status, detail } — a failure is non-fatal (the manual dashboard step still works).
async function bindKvNamespaceToBrandProxy(cfAccount, cfToken, domain, nsId, workerNameOverride) {
  const stem = (domain || '').split('.')[0]
  const workerName = (workerNameOverride || `${stem}-brand-proxy`).trim()
  const base = `https://api.cloudflare.com/client/v4/accounts/${cfAccount}/workers/scripts/${workerName}/settings`

  const getRes = await fetch(base, { headers: { Authorization: `Bearer ${cfToken}` } })
  const getJson = await getRes.json().catch(() => null)
  if (!getRes.ok || !getJson || !getJson.success) {
    const detail = (getJson && getJson.errors && getJson.errors[0] && (getJson.errors[0].message || getJson.errors[0].code)) || `HTTP ${getRes.status}`
    return { ok: false, workerName, status: getRes.status, detail, note: getRes.status === 404 ? 'brand proxy worker not found — pass worker_name.' : 'could not read worker settings — token likely lacks Workers Scripts edit.' }
  }
  const settings = getJson.result || {}
  const bindings = Array.isArray(settings.bindings) ? settings.bindings : []
  const existing = bindings.find((b) => b.type === 'kv_namespace' && b.name === 'HTML_PAGES')
  if (existing && existing.namespace_id === nsId) {
    return { ok: true, workerName, alreadyBound: true }
  }
  // Keep every other binding verbatim (secret_text entries are preserved by name); drop any stale
  // HTML_PAGES kv binding pointing at a different namespace, then append the correct one.
  const nextBindings = bindings
    .filter((b) => !(b.type === 'kv_namespace' && b.name === 'HTML_PAGES'))
    .concat([{ type: 'kv_namespace', name: 'HTML_PAGES', namespace_id: nsId }])

  const form = new FormData()
  form.append('settings', JSON.stringify({ bindings: nextBindings }))
  const patchRes = await fetch(base, { method: 'PATCH', headers: { Authorization: `Bearer ${cfToken}` }, body: form })
  const patchJson = await patchRes.json().catch(() => null)
  if (patchRes.ok && patchJson && patchJson.success) return { ok: true, workerName, bound: true }
  const detail = (patchJson && patchJson.errors && patchJson.errors[0] && (patchJson.errors[0].message || patchJson.errors[0].code)) || `HTTP ${patchRes.status}`
  return { ok: false, workerName, status: patchRes.status, detail }
}

// Attach the me.<domain> hostname to the brand-proxy worker as a Workers Custom Domain (creates the
// proxied DNS record + edge cert and routes the host to the worker). This is the step that makes
// publish_world_page's POST to https://me.<domain>/__html/publish actually reach the worker —
// without it the host is NXDOMAIN and publish 530s. Needs Zone:Read (resolve zone_id) + Workers
// Routes/Domains edit on the founder token. Idempotent: skips when already attached to this worker.
// Returns { ok, host, workerName, alreadyAttached?|attached? } or { ok:false, status, detail, note }.
async function attachBrandProxyDomain(cfAccount, cfToken, domain, workerNameOverride, hostOverride) {
  const stem = (domain || '').split('.')[0]
  const workerName = (workerNameOverride || `${stem}-brand-proxy`).trim()
  const host = (hostOverride || `me.${domain}`).trim().toLowerCase()

  // Already attached? (idempotent)
  const existing = await cfApi(`/accounts/${cfAccount}/workers/domains?hostname=${encodeURIComponent(host)}`, cfToken)
  if (existing.ok && Array.isArray(existing.json.result) && existing.json.result.length) {
    const cur = existing.json.result[0]
    if ((cur.service || '') === workerName) return { ok: true, host, workerName, alreadyAttached: true }
  }

  // Resolve the zone id for the apex domain (the custom-domain API requires zone_id).
  const zr = await cfApi(`/zones?name=${encodeURIComponent(domain)}`, cfToken)
  const zoneId = zr.ok && Array.isArray(zr.json.result) && zr.json.result[0] && zr.json.result[0].id
  if (!zoneId) {
    return { ok: false, host, workerName, status: zr.status, detail: zr.error || 'zone not found', note: 'could not resolve zone_id — token likely lacks Zone:Read, or the domain is not on this Cloudflare account.' }
  }

  // PUT is upsert for Workers custom domains.
  const put = await cfApi(`/accounts/${cfAccount}/workers/domains`, cfToken, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone_id: zoneId, hostname: host, service: workerName, environment: 'production' }),
  })
  if (put.ok) return { ok: true, host, workerName, attached: true }
  return { ok: false, host, workerName, status: put.status, detail: put.error || `HTTP ${put.status}`, note: 'could not attach custom domain — token likely lacks Workers Routes/Domains edit, or the worker name is wrong (pass worker_name).' }
}

// Create (deploy) a World's brand-proxy worker in the founder's own Cloudflare account — the piece
// that serves me.<domain> + the /__html/publish + /__html/check endpoints. Uploads the canonical
// brand-proxy script (template:brand-proxy in WORLD_TEMPLATES) with HTML_PAGES + BRAND_CONFIG KV
// bindings (created if missing) and HTML_PUBLISH_SECRET, then attaches me.<domain>. Fixes the
// "HTTP 530 (worker not reachable)" case where no brand proxy exists yet. Idempotent: skips an
// existing worker unless force=true (protects working proxies — Lesson 11). Superadmin only.
async function executeDeployWorldProxy(input, env) {
  const ctx = await resolveWorldInfraContext(input, env)
  if (ctx.error) return { success: false, error: ctx.error }
  const { founderEmail, cfAccount, cfToken, domain } = ctx
  const stem = (domain || '').split('.')[0]
  const workerName = (input.worker_name || `${stem}-brand-proxy`).trim()

  if (!env.WORLD_TEMPLATES) return { success: false, error: 'WORLD_TEMPLATES KV is not bound on agent-worker.' }
  const script = await env.WORLD_TEMPLATES.get('template:brand-proxy')
  if (!script) return { success: false, error: 'Brand-proxy script not found in WORLD_TEMPLATES (key "template:brand-proxy").' }
  const secret = env.HTML_PUBLISH_SECRET
  if (!secret) return { success: false, error: 'agent-worker has no HTML_PUBLISH_SECRET binding — set it once via `wrangler secret put HTML_PUBLISH_SECRET`.' }

  const scriptUrl = `https://api.cloudflare.com/client/v4/accounts/${cfAccount}/workers/scripts/${workerName}`

  // Idempotent: don't overwrite an existing proxy unless force=true. Still (re)attach the route.
  const existing = await fetch(scriptUrl, { headers: { Authorization: `Bearer ${cfToken}` } })
  if (existing.ok && !input.force) {
    const dom = await attachBrandProxyDomain(cfAccount, cfToken, domain, workerName, input.host)
    return {
      success: true, domain, worker_name: workerName, created: false,
      route: dom.ok ? { ok: true, host: dom.host } : { ok: false, host: dom.host, error: `${dom.status}: ${dom.detail}` },
      note: `Brand proxy ${workerName} already exists — left as is (pass force=true to redeploy).`,
      next: `Run provision_world_kv for ${domain} (confirms KV + secret), then publish_world_page.`,
    }
  }

  // Ensure both KV namespaces the proxy binds exist (idempotent create-or-find).
  const ensureNs = async (title) => {
    const list = await cfApi(`/accounts/${cfAccount}/storage/kv/namespaces?per_page=100`, cfToken)
    if (!list.ok) return { error: `Could not list KV namespaces (${list.status}): ${list.error || 'unknown'} — token likely lacks Workers KV Storage scope.` }
    let ns = (list.json.result || []).find((n) => n.title === title)
    if (!ns) {
      const mk = await cfApi(`/accounts/${cfAccount}/storage/kv/namespaces`, cfToken, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) })
      if (!mk.ok) return { error: `Could not create KV namespace "${title}" (${mk.status}): ${mk.error || 'unknown'}` }
      ns = mk.json.result
    }
    return { id: ns && ns.id }
  }
  const htmlNs = await ensureNs('HTML_PAGES')
  if (htmlNs.error) return { success: false, error: htmlNs.error }
  const brandNs = await ensureNs('BRAND_CONFIG')
  if (brandNs.error) return { success: false, error: brandNs.error }
  try { await env.DB.prepare('UPDATE config SET cf_kv_namespace_id = ? WHERE email = ?').bind(htmlNs.id, founderEmail).run() } catch (e) { console.error('record kv ns failed:', e) }

  // Upload the ESM module worker with its bindings + the publish secret stamped in at deploy.
  const defaultOrigin = (input.default_origin || `https://${domain}`).trim()
  const metadata = {
    main_module: 'index.js',
    compatibility_date: '2025-01-15',
    bindings: [
      { type: 'kv_namespace', name: 'HTML_PAGES', namespace_id: htmlNs.id },
      { type: 'kv_namespace', name: 'BRAND_CONFIG', namespace_id: brandNs.id },
      { type: 'secret_text', name: 'HTML_PUBLISH_SECRET', text: secret },
      { type: 'plain_text', name: 'DEFAULT_ORIGIN', text: defaultOrigin },
    ],
  }
  const form = new FormData()
  form.append('metadata', JSON.stringify(metadata))
  form.append('index.js', new File([script], 'index.js', { type: 'application/javascript+module' }))
  const up = await fetch(scriptUrl, { method: 'PUT', headers: { Authorization: `Bearer ${cfToken}` }, body: form })
  const upJson = await up.json().catch(() => null)
  if (!up.ok || !upJson || !upJson.success) {
    const detail = (upJson && upJson.errors && upJson.errors[0] && (upJson.errors[0].message || upJson.errors[0].code)) || `HTTP ${up.status}`
    return { success: false, error: `Worker upload failed: ${detail}`, worker_name: workerName, note: 'token needs Workers Scripts edit + Workers KV Storage edit.' }
  }

  const route = await attachBrandProxyDomain(cfAccount, cfToken, domain, workerName, input.host)
  return {
    success: true,
    domain,
    worker_name: workerName,
    created: true,
    kv: { HTML_PAGES: htmlNs.id, BRAND_CONFIG: brandNs.id },
    publish_secret: 'set',
    route: route.ok ? { ok: true, host: route.host } : { ok: false, host: route.host, error: `${route.status}: ${route.detail}`, note: route.note },
    next: route.ok
      ? `Brand proxy ${workerName} deployed + ${route.host} routed + secret set. Run publish_world_page for ${domain}.`
      : `Brand proxy ${workerName} deployed + secret set, but ${route.host} not routed: ${route.note} Then run publish_world_page.`,
  }
}

// Create (idempotently) the HTML_PAGES KV namespace in the founder's own Cloudflare account, and
// record its id in config.cf_kv_namespace_id. Mirrors `world.sh provision` step 1, but via the CF
// API using the founder's stored token (Workers KV Storage edit scope required).
async function executeProvisionWorldKv(input, env) {
  const ctx = await resolveWorldInfraContext(input, env)
  if (ctx.error) return { success: false, error: ctx.error }
  const { founderEmail, cfAccount, cfToken, domain } = ctx
  const title = (input.title || 'HTML_PAGES').trim()

  const list = await cfApi(`/accounts/${cfAccount}/storage/kv/namespaces?per_page=100`, cfToken)
  if (!list.ok) {
    return { success: false, error: `Could not list KV namespaces in ${cfAccount} (${list.status}): ${list.error || 'unknown'}. The token likely lacks Workers KV Storage scope.` }
  }
  let ns = (list.json.result || []).find((n) => n.title === title)
  let created = false
  if (!ns) {
    const mk = await cfApi(`/accounts/${cfAccount}/storage/kv/namespaces`, cfToken, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    if (!mk.ok) return { success: false, error: `Could not create KV namespace "${title}" (${mk.status}): ${mk.error || 'unknown'}` }
    ns = mk.json.result
    created = true
  }
  const nsId = ns && ns.id
  if (!nsId) return { success: false, error: 'KV namespace id missing from CF response.' }

  await env.DB.prepare('UPDATE config SET cf_kv_namespace_id = ? WHERE email = ?').bind(nsId, founderEmail).run()

  // Bind HTML_PAGES to the brand proxy (the step that used to be a manual Cloudflare dashboard
  // action). Runs BEFORE the secret step below so setBrandProxySecret always (re-)stamps
  // HTML_PUBLISH_SECRET last — a settings PATCH can therefore never leave the secret wiped.
  // Non-fatal: a failure here just means the operator falls back to the manual binding step.
  let kv_binding
  {
    const b = await bindKvNamespaceToBrandProxy(cfAccount, cfToken, domain, nsId, input.worker_name)
    kv_binding = b.ok
      ? { ok: true, worker_name: b.workerName, note: b.alreadyBound ? 'HTML_PAGES already bound to the brand proxy.' : 'HTML_PAGES bound to the brand proxy.' }
      : { ok: false, worker_name: b.workerName, error: `${b.status}: ${b.detail}`, note: b.note || 'could not bind HTML_PAGES — bind it manually in the dashboard (Workers & Pages → brand proxy → Settings → Bindings → KV Namespace: HTML_PAGES).' }
  }

  // Also set the brand-proxy publish secret so the World is immediately publishable — the step that
  // world.sh only PRINTED and was never run, which is why lydmorah had HTML_PAGES but no secret
  // (Lesson 44). Uses agent-worker's HTML_PUBLISH_SECRET — the exact secret publish_world_page mints
  // with. Needs Workers Scripts edit scope on the token + the brand proxy to exist.
  let publish_secret
  const secret = env.HTML_PUBLISH_SECRET
  if (!secret) {
    publish_secret = { ok: false, note: 'agent-worker has no HTML_PUBLISH_SECRET binding — set it once via `wrangler secret put HTML_PUBLISH_SECRET` (e.g. `openssl rand -hex 32`), then re-run to configure the brand-proxy secret.' }
  } else {
    const r = await setBrandProxySecret(cfAccount, cfToken, domain, secret, input.worker_name)
    publish_secret = r.ok
      ? { ok: true, worker_name: r.workerName, note: 'HTML_PUBLISH_SECRET set on the brand proxy — World is publishable.' }
      : { ok: false, worker_name: r.workerName, error: `${r.status}: ${r.detail}`, scripts: r.scripts || undefined, note: r.status === 404 ? 'brand proxy worker not found — pass worker_name (see scripts list).' : 'could not set secret — token likely lacks Workers Scripts edit scope.' }
  }

  // Attach me.<domain> to the brand proxy so the host actually resolves + routes to the worker.
  // Without this, publish_world_page POSTs to a NXDOMAIN host and 530s. Non-fatal: a failure just
  // means the operator attaches the custom domain manually (Cloudflare dashboard → the worker →
  // Settings → Domains & Routes → Add Custom Domain: me.<domain>).
  let route
  {
    const r = await attachBrandProxyDomain(cfAccount, cfToken, domain, input.worker_name, input.host)
    route = r.ok
      ? { ok: true, host: r.host, worker_name: r.workerName, note: r.alreadyAttached ? `${r.host} already routed to the brand proxy.` : `${r.host} attached to the brand proxy (DNS + cert provisioning may take a few seconds).` }
      : { ok: false, host: r.host, worker_name: r.workerName, error: `${r.status}: ${r.detail}`, note: r.note || `could not attach ${r.host} — add it manually as a Workers custom domain on the brand proxy.` }
  }

  // Also attach challenge.<domain> so the challenge participant page can be published.
  // Non-fatal: if it fails, the founder can add the domain manually or run publish_challenge_page later.
  let challenge_route
  {
    const r = await attachBrandProxyDomain(cfAccount, cfToken, domain, input.worker_name, `challenge.${domain}`)
    challenge_route = r.ok
      ? { ok: true, host: r.host, note: r.alreadyAttached ? `challenge.${domain} already routed.` : `challenge.${domain} attached to the brand proxy.` }
      : { ok: false, host: `challenge.${domain}`, error: `${r.status}: ${r.detail}`, note: `Could not attach challenge.${domain} — add it manually as a Workers custom domain on the brand proxy, then run publish_challenge_page.` }
  }

  const allReady = publish_secret.ok && kv_binding.ok && route.ok
  return {
    success: true,
    founder_email: founderEmail,
    cf_account_id: cfAccount,
    title,
    kv_namespace_id: nsId,
    created,
    note: created ? 'HTML_PAGES KV created.' : 'HTML_PAGES KV already existed — reused.',
    kv_binding,
    publish_secret,
    route,
    challenge_route,
    next: allReady
      ? `HTML_PAGES created + bound, publish secret set, ${route.host} routed. Run publish_world_page for ${domain}. Run publish_challenge_page for ${domain} to activate the participant page.`
      : !kv_binding.ok
        ? `HTML_PAGES ready but NOT bound to the brand proxy: ${kv_binding.note} Then run publish_world_page for ${domain}.`
        : !route.ok
          ? `HTML_PAGES bound + secret set, but ${route.host} is NOT routed to the brand proxy: ${route.note} Then run publish_world_page for ${domain}.`
          : `HTML_PAGES ready + bound + routed, but publish secret NOT set: ${publish_secret.note}`,
  }
}

async function executePublishChallengePage(input, env) {
  const callerUserId = input.userId
  if (!callerUserId) return { success: false, error: 'No user context available — sign in and retry.' }
  const callerProfile = await resolveUserProfile(callerUserId, env)
  const callerRole = (callerProfile?.Role || callerProfile?.role || '').trim()
  if (callerRole !== 'Superadmin') return { success: false, error: 'Superadmin role required to publish the challenge page.' }

  const domain = (input.domain || '').trim().toLowerCase()
  if (!domain || !domain.includes('.')) return { success: false, error: 'domain (e.g. lydmorah.net) is required' }
  const host = (input.host || ('challenge.' + domain)).trim().toLowerCase()

  if (!env.WORLD_TEMPLATES) return { success: false, error: 'WORLD_TEMPLATES KV is not bound on agent-worker.' }
  const challengeRow = await env.DB.prepare(
    'SELECT template_key FROM challenges WHERE domain = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(domain).first()
  const templateKey = challengeRow?.template_key || 'template:challenge-page'
  const html = await env.WORLD_TEMPLATES.get(templateKey)
  if (!html) return { success: false, error: `Template "${templateKey}" not found in WORLD_TEMPLATES. Push it with: wrangler kv key put "${templateKey}" --path challenge-page.html --namespace-id <WORLD_TEMPLATES id> --remote` }

  const secret = env.HTML_PUBLISH_SECRET
  if (!secret) return { success: false, error: 'agent-worker has no HTML_PUBLISH_SECRET binding — run `wrangler secret put HTML_PUBLISH_SECRET` first.' }

  const uid = callerProfile?.user_id || callerProfile?.email || 'agent-worker'
  const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
  const publishToken = await signPublishToken({ uid, appId: 'challenge-page', hostname: host, scope: ['save', 'load', 'loadAll', 'delete'], exp }, secret)

  const proxyUrl = (input.proxy_url || `https://${host}/__html/publish`).trim()
  let pubRes, pubJson
  try {
    pubRes = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Publish-Token': publishToken },
      body: JSON.stringify({ hostname: host, html, overwrite: true }),
    })
    pubJson = await pubRes.json().catch(() => null)
  } catch (e) {
    return { success: false, error: `Could not reach ${proxyUrl}: ${e.message}. Pass proxy_url=<brand-proxy>.workers.dev/__html/publish if ${host} does not route to the brand proxy yet.` }
  }
  if (!pubRes.ok || !pubJson || !pubJson.ok) {
    const detail = (pubJson && pubJson.error) || `HTTP ${pubRes.status}`
    return { success: false, error: `Publish rejected: ${detail}` }
  }

  return {
    success: true,
    domain,
    host,
    key: `html:${host}`,
    url: `https://${host}/`,
    template_key: templateKey,
    template_bytes: html.length,
    via: proxyUrl,
    next: `Published challenge page to html:${host} using template "${templateKey}". Open https://${host}/ — participants sign in with their magic link.`,
  }
}

// Read-only readiness check for a World's publish path. Stores NOTHING and creates NO token.
// Asks the World's own brand proxy (/__html/check) whether HTML_PAGES is enabled+bound and the
// host routes, and whether the Superadmin publish-token mint works. The publish-secret match can
// only be confirmed by an actual publish_world_page run (a check cannot write).
async function executeCheckWorldPublish(input, env) {
  const callerUserId = input.userId
  if (!callerUserId) return { success: false, error: 'No user context available — sign in and retry.' }
  const callerProfile = await resolveUserProfile(callerUserId, env)
  const callerRole = (callerProfile?.Role || callerProfile?.role || '').trim()
  if (callerRole !== 'Superadmin') return { success: false, error: 'Superadmin role required.' }

  const domain = (input.domain || '').trim().toLowerCase()
  if (!domain || !domain.includes('.')) return { success: false, error: 'domain (e.g. lydmorah.net) is required' }
  const hosts = input.host ? [String(input.host).trim().toLowerCase()] : [`me.${domain}`, domain]

  const results = []
  for (const h of hosts) {
    const entry = { host: h, routes_to_proxy: false, html_pages_enabled: false, has_page: false, detail: '' }
    try {
      const r = await fetch(`https://${h}/__html/check?hostname=${encodeURIComponent(h)}`, { headers: { Accept: 'application/json' } })
      entry.http = r.status
      const j = r.ok ? await r.json().catch(() => null) : null
      if (j && typeof j.ok !== 'undefined') {
        entry.routes_to_proxy = true
        entry.html_pages_enabled = !!j.ok
        entry.has_page = !!j.exists
        entry.detail = j.ok
          ? (j.exists ? 'HTML_PAGES enabled; a page is already published here' : 'HTML_PAGES enabled; no page yet — ready to publish')
          : 'brand proxy reachable but HTML_PAGES not enabled/bound'
      } else if (r.ok) {
        entry.detail = 'host returned 200 but not the brand-proxy check shape — host likely does not route to the brand proxy'
      } else {
        entry.detail = `no brand-proxy check (HTTP ${r.status}) — brand proxy/HTML_PAGES not enabled for this host`
      }
    } catch (e) {
      entry.detail = `could not reach ${h}: ${e.message}`
    }
    results.push(entry)
  }

  // Is agent-worker's publish secret configured? publish_world_page mints with it, and
  // provision_world_kv / set_world_publish_secret stamp the same value into each brand proxy.
  const mint_ok = !!env.HTML_PUBLISH_SECRET
  const mint_detail = mint_ok
    ? 'agent-worker HTML_PUBLISH_SECRET is set (publish can mint)'
    : 'agent-worker HTML_PUBLISH_SECRET NOT set — run `wrangler secret put HTML_PUBLISH_SECRET` once'

  return {
    success: true,
    domain,
    hosts: results,
    mint_ok,
    mint_detail,
    note: 'Read-only — stores nothing and creates no token. HTML_PAGES is enabled per-World from the Cloudflare dashboard (create + bind the namespace to the brand proxy). Whether the publish secret on the brand proxy matches can only be confirmed by an actual publish_world_page run.',
  }
}

// Set a World's brand-proxy worker secret HTML_PUBLISH_SECRET to the SHARED value held on
// agent-worker (env.HTML_PUBLISH_SECRET), using the World's stored Cloudflare token (Workers
// Scripts edit scope). This is the routine that makes /__html/publish work for the World — the
// step world.sh only printed as a manual instruction. The secret value never appears in chat:
// it lives on agent-worker (operator sets it once via `wrangler secret put`) and is written
// straight into the brand proxy via the CF API.
async function executeSetWorldPublishSecret(input, env) {
  const ctx = await resolveWorldInfraContext(input, env)
  if (ctx.error) return { success: false, error: ctx.error }
  const { founderEmail, cfAccount, cfToken, domain } = ctx

  const secret = env.HTML_PUBLISH_SECRET
  if (!secret) {
    return { success: false, error: 'agent-worker has no HTML_PUBLISH_SECRET binding. One-time setup: in the Agent-Builder/worker dir run `wrangler secret put HTML_PUBLISH_SECRET` with a value you generate (e.g. `openssl rand -hex 32`). publish_world_page mints with this same secret.' }
  }

  const r = await setBrandProxySecret(cfAccount, cfToken, domain, secret, input.worker_name)
  if (!r.ok) {
    if (r.status === 404) {
      return { success: false, error: `Worker "${r.workerName}" not found in ${cfAccount}. Scripts in this account: ${(r.scripts || []).join(', ') || '(none, or token lacks Workers Scripts read)'}. Pass worker_name with the correct brand-proxy name.` }
    }
    return { success: false, error: `Could not set HTML_PUBLISH_SECRET on ${r.workerName} (${r.status}): ${r.detail} — the token likely lacks Workers Scripts edit scope.` }
  }

  return {
    success: true,
    domain,
    founder_email: founderEmail,
    cf_account_id: cfAccount,
    worker_name: r.workerName,
    secret: "set to agent-worker's shared value (never echoed)",
    next: `HTML_PUBLISH_SECRET set on ${r.workerName}. Now run publish_world_page for ${domain}.`,
  }
}

// ── User API key operations ───────────────────────────────────────

const VALID_KEY_PROVIDERS = ['openai', 'anthropic', 'google', 'grok', 'perplexity', 'proff']

// Resolve the target user (self by default; another user requires Superadmin caller).
// Returns { targetUserId, targetEmail, onBehalf }.
async function resolveKeyTarget(input, env) {
  const callerUserId = input.userId
  if (!callerUserId) throw new Error('No user context available')

  const callerProfile = await resolveUserProfile(callerUserId, env)
  const callerEmail = (callerProfile?.email || (typeof callerUserId === 'string' && callerUserId.includes('@') ? callerUserId : '')).toLowerCase()
  const callerRole = (callerProfile?.Role || callerProfile?.role || '').trim()

  const targetEmail = (input.targetEmail || '').trim().toLowerCase()

  // Self-service: no target, or target is the caller's own email
  if (!targetEmail || targetEmail === callerEmail) {
    return {
      targetUserId: callerProfile?.user_id || callerUserId,
      targetEmail: callerEmail || null,
      onBehalf: false,
    }
  }

  // Admin-on-behalf: another user — Superadmin required
  if (callerRole !== 'Superadmin') {
    throw new Error('Superadmin role required to manage API keys for another user')
  }
  const targetProfile = await resolveUserProfile(targetEmail, env)
  if (!targetProfile?.user_id) {
    throw new Error(`No user found with email ${targetEmail}`)
  }
  return {
    targetUserId: targetProfile.user_id,
    targetEmail: targetProfile.email || targetEmail,
    onBehalf: true,
  }
}

async function executeStoreUserApiKey(input, env) {
  const provider = (input.provider || '').trim().toLowerCase()
  const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : ''

  if (!provider) throw new Error('provider is required')
  if (!VALID_KEY_PROVIDERS.includes(provider)) {
    throw new Error(`Invalid provider. Must be one of: ${VALID_KEY_PROVIDERS.join(', ')}`)
  }
  if (!apiKey) throw new Error('apiKey is required')

  const { targetUserId, targetEmail, onBehalf } = await resolveKeyTarget(input, env)

  const res = await env.USER_KEYS_WORKER.fetch('https://user-keys-worker/user-api-keys', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: targetUserId,
      provider,
      apiKey,
      metadata: { keyName: input.keyName || null, displayName: provider },
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error) {
    throw new Error(data.error || `Failed to store API key (HTTP ${res.status})`)
  }

  return {
    success: true,
    provider,
    onBehalf,
    targetUserId,
    targetEmail,
    message: `${provider} API key stored${onBehalf ? ` for ${targetEmail}` : ''}.`,
  }
}

async function executeRemoveUserApiKey(input, env) {
  const provider = (input.provider || '').trim().toLowerCase()
  if (!provider) throw new Error('provider is required')
  if (!VALID_KEY_PROVIDERS.includes(provider)) {
    throw new Error(`Invalid provider. Must be one of: ${VALID_KEY_PROVIDERS.join(', ')}`)
  }

  const { targetUserId, targetEmail, onBehalf } = await resolveKeyTarget(input, env)

  const res = await env.USER_KEYS_WORKER.fetch(
    `https://user-keys-worker/user-api-keys/${encodeURIComponent(provider)}?userId=${encodeURIComponent(targetUserId)}`,
    { method: 'DELETE' }
  )

  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error) {
    throw new Error(data.error || `Failed to delete API key (HTTP ${res.status})`)
  }

  return {
    success: true,
    provider,
    onBehalf,
    targetUserId,
    targetEmail,
    message: `${provider} API key removed${onBehalf ? ` for ${targetEmail}` : ''}.`,
  }
}

// ── Email operations ──────────────────────────────────────────────

async function executeListEmailAccounts(input, env) {
  const callerUserId = input.userId
  if (!callerUserId) throw new Error('No user context available')

  const profile = await resolveUserProfile(callerUserId, env)
  if (!profile?.email) throw new Error('Could not resolve user profile')

  const headers = {}
  if (env.INTERNAL_SHARED_SECRET) {
    headers['x-internal-auth'] = env.INTERNAL_SHARED_SECRET
    headers['x-internal-caller'] = profile.email
  }

  const res = await env.EMAIL_WORKER.fetch(
    `https://email-worker.internal/email-accounts?user=${encodeURIComponent(profile.email)}`,
    { method: 'GET', headers }
  )

  const responseText = await res.text()
  let result
  try { result = JSON.parse(responseText) } catch { result = { raw: responseText } }

  if (!res.ok || result.success === false) {
    throw new Error(`Failed to list email accounts: ${result.error || responseText}`)
  }

  let accounts = Array.isArray(result.accounts) ? result.accounts : []
  const filterEmail = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : ''
  if (filterEmail) {
    accounts = accounts.filter(a => (a.email || '').toLowerCase() === filterEmail)
  }

  let message
  if (filterEmail) {
    if (accounts.length > 0) {
      const a = accounts[0]
      message = `Email account ${filterEmail} IS configured (id: ${a.id}, accountType: ${a.accountType}, isDefault: ${a.isDefault}, hasPassword: ${a.hasPassword}). It can be used as a sender via send_email with fromEmail="${a.email}".`
    } else {
      message = `Email account ${filterEmail} is NOT configured for this user. Use add_email_account to register it.`
    }
  } else {
    message = `Found ${accounts.length} configured sender account(s) for ${profile.email}.`
  }

  return {
    success: true,
    accounts,
    count: accounts.length,
    message,
  }
}

async function executeAddEmailDestination(input, env) {
  const callerUserId = input.userId
  if (!callerUserId) throw new Error('No user context available')

  const profile = await resolveUserProfile(callerUserId, env)
  if (!profile?.email) throw new Error('Could not resolve user profile')

  const email = typeof input?.email === 'string' ? input.email.trim() : ''
  if (!email || !email.includes('@')) {
    throw new Error('A valid recipient email address is required')
  }

  const headers = { 'Content-Type': 'application/json' }
  if (env.INTERNAL_SHARED_SECRET) {
    headers['x-internal-auth'] = env.INTERNAL_SHARED_SECRET
    headers['x-internal-caller'] = profile.email
  }

  const res = await env.EMAIL_WORKER.fetch('https://email-worker.internal/email-destinations', {
    method: 'POST',
    headers,
    body: JSON.stringify({ email }),
  })

  const responseText = await res.text()
  let result
  try { result = JSON.parse(responseText) } catch { result = { raw: responseText } }

  if (!res.ok || result.success === false) {
    throw new Error(`Failed to add email destination: ${result.error || responseText}`)
  }

  const addr = result.address || {}
  const isVerified = !!addr.verified
  return {
    success: true,
    address: addr,
    message:
      `Destination ${email} registered with Cloudflare Email Routing. ` +
      (isVerified
        ? `Already verified — env.EMAIL.send() can send to this address now.`
        : `Cloudflare has sent a verification email to ${email}. Once the recipient clicks the link, sends to this address will succeed. Until then, attempts will fail.`),
  }
}

async function executeAddEmailAccount(input, env) {
  const callerUserId = input.userId
  if (!callerUserId) throw new Error('No user context available')

  const profile = await resolveUserProfile(callerUserId, env)
  if (!profile?.email) throw new Error('Could not resolve user profile')

  const email = (input.email || '').trim()
  if (!email || !email.includes('@')) {
    throw new Error('A valid email address is required')
  }
  const emailLower = email.toLowerCase()

  // Smart default for accountType: gmail for @gmail.com, smtp otherwise.
  // smtp routes through /send-email → Cloudflare Email Service (no password).
  // gmail routes through /send-gmail-email → requires appPassword.
  let accountType = (input.accountType || '').trim().toLowerCase()
  if (!accountType) {
    accountType = emailLower.endsWith('@gmail.com') ? 'gmail' : 'smtp'
  }
  if (accountType !== 'gmail' && accountType !== 'smtp') {
    throw new Error(`accountType must be "smtp" or "gmail" (got "${accountType}")`)
  }

  const appPassword = typeof input.appPassword === 'string' ? input.appPassword.trim() : ''
  if (accountType === 'gmail' && !appPassword) {
    throw new Error('appPassword is required for Gmail accounts. Generate one at https://myaccount.google.com/apppasswords')
  }
  if (accountType === 'smtp' && appPassword) {
    // Not fatal — server stores it — but the SMTP path doesn't use it. Warn upstream.
    console.warn(`[add_email_account] appPassword provided for smtp account ${email} — will be stored but unused by Cloudflare Email Service path.`)
  }

  // Optional operator override: configure a sender in ANOTHER user's profile (Superadmin only).
  // The email-worker's requireOwnership demands x-internal-caller === target, so set the caller
  // header to the target email when an operator is acting for someone else.
  let targetEmail = profile.email
  const forUser = (input.forUserEmail || '').trim().toLowerCase()
  if (forUser && forUser !== (profile.email || '').toLowerCase()) {
    if ((profile.role || '').toLowerCase() !== 'superadmin') {
      throw new Error('forUserEmail requires Superadmin — you can only configure your own sender accounts.')
    }
    if (!forUser.includes('@')) throw new Error('forUserEmail must be a valid email address')
    targetEmail = forUser
  }

  const internalHeaders = {}
  if (env.INTERNAL_SHARED_SECRET) {
    internalHeaders['x-internal-auth'] = env.INTERNAL_SHARED_SECRET
    internalHeaders['x-internal-caller'] = targetEmail
  }

  // Dedup: check existing accounts via GET /email-accounts to avoid silent duplicates
  // (POST upserts by id, so a fresh uuid would create a second entry for the same email).
  const listRes = await env.EMAIL_WORKER.fetch(
    `https://email-worker.internal/email-accounts?user=${encodeURIComponent(targetEmail)}`,
    { method: 'GET', headers: internalHeaders }
  )
  if (listRes.ok) {
    const listJson = await listRes.json().catch(() => ({ accounts: [] }))
    const existing = (listJson.accounts || []).find(a => (a.email || '').toLowerCase() === emailLower)
    if (existing) {
      throw new Error(
        `Email account "${email}" is already configured (id: ${existing.id}, accountType: ${existing.accountType}, isDefault: ${!!existing.isDefault}). ` +
        `Delete or update the existing entry first if you want to change it.`
      )
    }
  }
  // GET failure is non-fatal — fall through to POST. POST will still succeed; user just
  // doesn't get the friendly duplicate-detection error.

  const accountId = crypto.randomUUID()
  const payload = {
    userEmail: targetEmail,
    account: {
      id: accountId,
      email,
      name: (input.name || '').trim(),
      accountType,
      isDefault: input.isDefault === true,
    },
  }
  if (appPassword) payload.appPassword = appPassword

  const res = await env.EMAIL_WORKER.fetch('https://email-worker.internal/email-accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...internalHeaders },
    body: JSON.stringify(payload),
  })

  const responseText = await res.text()
  let result
  try { result = JSON.parse(responseText) } catch { result = { raw: responseText } }

  if (!res.ok || result.error) {
    throw new Error(`Failed to add email account: ${result.error || responseText}`)
  }

  const stored = result.account || payload.account
  const sendPath = accountType === 'gmail' ? '/send-gmail-email (Gmail SMTP)' : '/send-email (Cloudflare Email Service)'

  return {
    success: true,
    account: stored,
    message:
      `Added email account ${email} (id: ${stored.id}, accountType: ${accountType}, isDefault: ${stored.isDefault}). ` +
      `Sender path: ${sendPath}. Use send_email with fromEmail="${email}" to send from this address.`,
  }
}

// Set / update the Gmail app password on an EXISTING sender account (add_email_account refuses
// to touch an account that already exists). Finds the account by email, reuses its id so the
// email-worker POST upserts (updates) it, and stores the new appPassword.
async function executeSetEmailPassword(input, env) {
  const callerUserId = input.userId
  if (!callerUserId) throw new Error('No user context available')

  const profile = await resolveUserProfile(callerUserId, env)
  if (!profile?.email) throw new Error('Could not resolve user profile')

  const email = (input.email || '').trim()
  if (!email || !email.includes('@')) throw new Error('A valid email address is required')
  const emailLower = email.toLowerCase()

  const appPassword = typeof input.appPassword === 'string' ? input.appPassword.trim() : ''
  if (!appPassword) throw new Error('appPassword is required')

  // Optional operator override: set the password on ANOTHER user's existing sender (Superadmin only).
  let targetEmail = profile.email
  const forUser = (input.forUserEmail || '').trim().toLowerCase()
  if (forUser && forUser !== (profile.email || '').toLowerCase()) {
    if ((profile.role || '').toLowerCase() !== 'superadmin') {
      throw new Error('forUserEmail requires Superadmin — you can only configure your own sender accounts.')
    }
    if (!forUser.includes('@')) throw new Error('forUserEmail must be a valid email address')
    targetEmail = forUser
  }

  const internalHeaders = {}
  if (env.INTERNAL_SHARED_SECRET) {
    internalHeaders['x-internal-auth'] = env.INTERNAL_SHARED_SECRET
    internalHeaders['x-internal-caller'] = targetEmail
  }

  // Find the EXISTING account by email to reuse its id (POST upserts by id).
  const listRes = await env.EMAIL_WORKER.fetch(
    `https://email-worker.internal/email-accounts?user=${encodeURIComponent(targetEmail)}`,
    { method: 'GET', headers: internalHeaders }
  )
  if (!listRes.ok) throw new Error('Could not load existing email accounts')
  const listJson = await listRes.json().catch(() => ({ accounts: [] }))
  const existing = (listJson.accounts || []).find(a => (a.email || '').toLowerCase() === emailLower)
  if (!existing) {
    throw new Error(`Email account "${email}" is not configured. Use add_email_account to create it first.`)
  }

  const payload = {
    userEmail: targetEmail,
    account: {
      id: existing.id,
      email: existing.email || email,
      name: existing.name || '',
      accountType: existing.accountType || (emailLower.endsWith('@gmail.com') ? 'gmail' : 'smtp'),
      isDefault: !!existing.isDefault,
    },
    appPassword,
  }

  const res = await env.EMAIL_WORKER.fetch('https://email-worker.internal/email-accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...internalHeaders },
    body: JSON.stringify(payload),
  })
  const responseText = await res.text()
  let result
  try { result = JSON.parse(responseText) } catch { result = { raw: responseText } }
  if (!res.ok || result.error) throw new Error(`Failed to set email password: ${result.error || responseText}`)

  const stored = result.account || payload.account
  return {
    success: true,
    account: { id: stored.id, email: stored.email, accountType: stored.accountType, hasPassword: true },
    message: `Updated the app password on existing sender ${email} (id: ${stored.id}). Use send_email with fromEmail="${email}" to send from this address.`,
  }
}

async function executeSendEmail(input, env) {
  const callerUserId = input.userId
  if (!callerUserId) throw new Error('No user context available')

  // Resolve the CALLER's profile
  const callerProfile = await resolveUserProfile(callerUserId, env)
  if (!callerProfile) throw new Error('Could not resolve user profile')

  // Optional operator override: send from ANOTHER user's configured sender (Superadmin only).
  // Mirrors set_email_password's forUserEmail. Lets a Superadmin trigger a real send — which the
  // email-worker stamps as a verified send (last_verified_at) — on a founder's behalf, without the
  // founder having to log in. The effective sender below becomes that target user.
  let profile = callerProfile
  const forUser = (input.forUserEmail || '').trim().toLowerCase()
  if (forUser && forUser !== (callerProfile.email || '').toLowerCase()) {
    if ((callerProfile.role || '').toLowerCase() !== 'superadmin') {
      throw new Error('forUserEmail requires Superadmin — you can only send from your own sender accounts.')
    }
    if (!forUser.includes('@')) throw new Error('forUserEmail must be a valid email address')
    const targetProfile = await resolveUserProfile(forUser, env)
    if (!targetProfile?.email) throw new Error(`No user found with email ${forUser}`)
    profile = targetProfile
  }

  // Parse the data column to get email accounts (of the EFFECTIVE sender — caller, or the
  // forUserEmail target when a Superadmin is sending on someone's behalf).
  let userData = {}
  if (profile.data) {
    try { userData = JSON.parse(profile.data) } catch { /* ignore */ }
  }
  const accounts = userData?.settings?.emailAccounts || []
  if (accounts.length === 0) {
    throw new Error(`No email accounts configured for ${profile.email}. Set one up in vemail.vegvisr.org first.`)
  }

  // Find the right account: use fromEmail if specified, otherwise default account
  const requestedFrom = (input.fromEmail || '').trim().toLowerCase()
  let account
  if (requestedFrom) {
    account = accounts.find(a => a.email.toLowerCase() === requestedFrom)
    if (!account) throw new Error(`No configured account matches "${requestedFrom}". Available: ${accounts.map(a => a.email).join(', ')}`)
  } else {
    // Prefer @vegvisr.org accounts (SMTP relay, no app password needed)
    account = accounts.find(a => a.email.endsWith('@vegvisr.org')) || accounts.find(a => a.isDefault) || accounts[0]
  }

  const toEmail = (input.to || '').trim()
  const subject = (input.subject || '').trim()
  const html = input.html || ''

  if (!toEmail) throw new Error('Recipient email (to) is required')
  if (!subject) throw new Error('Subject is required')
  if (!html) throw new Error('Email body (html) is required')

  // Determine endpoint based on account type
  const isGmail = (account.accountType || '').toLowerCase() === 'gmail' || account.email.endsWith('@gmail.com')
  const endpoint = isGmail ? '/send-gmail-email' : '/send-email'

  const payload = {
    userEmail: profile.email,
    accountId: account.id,
    fromEmail: account.email,
    toEmail,
    subject,
    html,
  }

  const headers = { 'Content-Type': 'application/json' }
  if (env.INTERNAL_SHARED_SECRET) {
    headers['x-internal-auth'] = env.INTERNAL_SHARED_SECRET
    headers['x-internal-caller'] = profile.email
  }
  const res = await env.EMAIL_WORKER.fetch(`https://email-worker.internal${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })

  const responseText = await res.text()
  let result
  try { result = JSON.parse(responseText) } catch { result = { raw: responseText } }

  if (!res.ok || result.success === false) {
    throw new Error(`Failed to send email: ${result.error || result.details || responseText}`)
  }

  return {
    success: true,
    from: account.email,
    to: toEmail,
    subject,
    message: `Email sent successfully from ${account.email} to ${toEmail} with subject "${subject}".`
  }
}

// ── Audio operations ──────────────────────────────────────────────

async function executeListRecordings(input, env) {
  const { limit = 20, query } = input
  // Resolve UUID to email — audio-portfolio-worker expects email
  let userEmail = input.userEmail || input.userId
  if (!userEmail) throw new Error('userEmail is required')
  if (!userEmail.includes('@')) {
    const profile = await resolveUserProfile(userEmail, env)
    if (profile?.email) {
      userEmail = profile.email
    } else {
      throw new Error('Could not resolve user identity. Please try again.')
    }
  }

  // Agent-worker is a trusted internal service (service binding) — always use
  // Superadmin + ownerEmail to bypass broken user index and scan KV directly
  const fetchUrl = `https://audio-portfolio-worker/list-recordings?userEmail=${encodeURIComponent(userEmail)}&limit=200&userRole=Superadmin&ownerEmail=${encodeURIComponent(userEmail)}`

  const res = await env.AUDIO_PORTFOLIO.fetch(fetchUrl)
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Failed to list recordings: ${err}`)
  }

  const data = await res.json()
  let allRecordings = data.recordings || []

  // Also include Sonic Wisdom recordings (saved under sonic-wisdom@vegvisr.org)
  const sonicEmail = 'sonic-wisdom@vegvisr.org'
  if (userEmail.toLowerCase() !== sonicEmail) {
    try {
      const sonicUrl = `https://audio-portfolio-worker/list-recordings?userEmail=${encodeURIComponent(sonicEmail)}&limit=200&userRole=Superadmin&ownerEmail=${encodeURIComponent(sonicEmail)}`
      const sonicRes = await env.AUDIO_PORTFOLIO.fetch(sonicUrl)
      if (sonicRes.ok) {
        const sonicData = await sonicRes.json()
        const sonicRecordings = (sonicData.recordings || []).map(r => ({ ...r, source: 'Sonic Wisdom' }))
        allRecordings = allRecordings.concat(sonicRecordings)
      }
    } catch (e) {
      // Sonic Wisdom fetch failed — continue with user's recordings only
    }
  }

  // Client-side filtering if query provided (search-recordings endpoint also has broken index)
  if (query) {
    const q = query.toLowerCase().trim()
    allRecordings = allRecordings.filter(r => {
      const searchable = [
        r.recordingId || '',
        r.displayName || '',
        r.fileName || '',
        r.transcriptionText || '',
        (r.tags || []).join(' '),
        r.category || '',
      ].join(' ').toLowerCase()
      return searchable.includes(q)
    })
  }

  // Sort by newest first so "last N recordings" returns the most recent
  allRecordings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

  const recordings = allRecordings.slice(0, limit).map(r => ({
    recordingId: r.recordingId,
    displayName: r.displayName || r.fileName,
    fileName: r.fileName,
    duration: r.duration,
    fileSize: r.fileSize,
    tags: r.tags || [],
    category: r.category || '',
    hasTranscription: !!(r.transcriptionText),
    audioUrl: r.r2Url || '',
    createdAt: r.createdAt || '',
  }))

  return {
    message: `Found ${recordings.length} recording(s) for ${userEmail}`,
    total: recordings.length,
    recordings,
  }
}

// ── Realtime video recordings (RealtimeKit MP4 sessions) ──────────────────
async function executeListRealtimeVideos(input, env) {
  const limit = typeof input?.limit === 'number' && input.limit > 0 ? input.limit : 20

  // Pull authToken (the user's emailVerificationToken from localStorage,
  // forwarded by AgentChat / VegvisrAgentChat in the chat body).
  const authToken = (typeof input?.authToken === 'string' && input.authToken.trim())
    ? input.authToken.trim()
    : (typeof input?.authContext?.authToken === 'string' && input.authContext.authToken.trim()
      ? input.authContext.authToken.trim()
      : '')

  if (!authToken) {
    throw new Error('You must be logged in to list realtime videos. Please refresh the page and try again.')
  }

  if (!env.REALTIME_WORKER) {
    throw new Error('REALTIME_WORKER service binding is not configured')
  }

  const res = await env.REALTIME_WORKER.fetch('https://realtime-worker/realtime/recordings', {
    headers: { 'X-API-Token': authToken },
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Failed to list realtime videos (${res.status}): ${errText}`)
  }

  const data = await res.json()
  const all = Array.isArray(data?.recordings) ? data.recordings : []

  // Sort newest-first by uploaded timestamp when present, otherwise leave order from worker
  const sorted = [...all].sort((a, b) => {
    const ta = a.uploaded ? new Date(a.uploaded).getTime() : 0
    const tb = b.uploaded ? new Date(b.uploaded).getTime() : 0
    return tb - ta
  })

  const REALTIME_VIDEO_BASE = 'https://realtimevideos.vegvisr.org'
  const buildPlayUrl = (key, source) => {
    if (!key) return null
    // Per-user R2 ('r2-own') is not served by the public realtimevideos.vegvisr.org host.
    if (source === 'r2-own') return null
    const normalized = String(key).replace(/^\/+/, '')
    const path = normalized.startsWith('recordings/') ? normalized : `recordings/${normalized}`
    return `${REALTIME_VIDEO_BASE}/${path}`
  }

  const videos = sorted.slice(0, limit).map((r) => ({
    name: r.name,
    key: r.key,
    size: r.size || 0,
    uploaded: r.uploaded || null,
    source: r.source || null,
    // Prefer the playUrl the worker computed (presigned for r2-own, public for shared);
    // fall back to legacy public-host construction for older worker versions.
    playUrl: r.playUrl || buildPlayUrl(r.key, r.source),
  }))

  return {
    message: `Found ${videos.length} realtime video(s). Use the exact playUrl field as the playback link — do not invent or modify URLs.`,
    total: videos.length,
    videos,
  }
}

function getAuthTokenFromToolInput(input) {
  return (typeof input?.authToken === 'string' && input.authToken.trim())
    ? input.authToken.trim()
    : (typeof input?.authContext?.authToken === 'string' && input.authContext.authToken.trim()
      ? input.authContext.authToken.trim()
      : '')
}

// ---------------------------------------------------------------------------
// Vemotion — save a composition to the user's cloud library.
// Two modes:
//   1) composition provided → save it as-is (with default fps/width/height/duration).
//   2) albumName provided (and no composition) → server-side shortcut: fetch the
//      album's real image keys from photos-worker, build a default cross-fade
//      slideshow (one image per slide), save it. Zero LLM in the fetch path.
// The user opens editorUrl in the Vemotion app to view/edit/render.
// ---------------------------------------------------------------------------

function buildSlideshowFromImageKeys(imageKeys, { secondsPerImage, transitionSeconds }) {
  const spi = (typeof secondsPerImage === 'number' && secondsPerImage > 0) ? secondsPerImage : 3
  const fade = (typeof transitionSeconds === 'number' && transitionSeconds >= 0) ? Math.min(transitionSeconds, spi / 2) : 0.5
  const width = 1280
  const height = 720
  const layers = [
    {
      id: 'bg',
      type: 'shape',
      position: { x: 0, y: 0 },
      size: { width, height },
      properties: { shape: 'rect', color: '#000000' },
    },
  ]
  let cursor = 0
  imageKeys.forEach((key, idx) => {
    const layerDuration = spi
    const startTime = cursor
    // Cross-fade keyframes layer-relative
    const keyframes = [
      { time: 0, value: 0 },
      { time: fade, value: 1 },
      { time: Math.max(fade, layerDuration - fade), value: 1 },
      { time: layerDuration, value: 0 },
    ]
    layers.push({
      id: `img-${idx + 1}`,
      type: 'image',
      position: { x: 0, y: 0 },
      size: { width, height },
      startTime,
      layerDuration,
      properties: {
        src: `https://vegvisr.imgix.net/${key}`,
        fit: 'cover',
      },
      animation: { property: 'opacity', keyframes },
    })
    // Overlap slides by the fade duration so the cross-fade is continuous
    cursor += layerDuration - fade
  })
  const duration = imageKeys.length === 0
    ? 5
    : cursor + fade // tail covers the last image's fade-out
  return { duration, fps: 30, width, height, layers }
}

async function fetchAlbumImageKeys({ env, authToken, albumName }) {
  if (!env.PHOTOS_WORKER) throw new Error('PHOTOS_WORKER service binding is not configured')
  const headers = {}
  if (authToken) headers['X-API-Token'] = authToken
  const res = await env.PHOTOS_WORKER.fetch(
    `https://vegvisr-photos-worker/list-r2-images?album=${encodeURIComponent(albumName)}`,
    { headers }
  )
  const text = await res.text()
  let data = {}
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
  if (!res.ok) throw new Error(data.error || `photos-worker ${res.status}: ${text.slice(0, 200)}`)
  const images = Array.isArray(data?.images) ? data.images : []
  return images.map(img => img?.key).filter(k => typeof k === 'string' && k.length > 0)
}

async function executeVemotionSaveComposition(input, env) {
  const authToken = getAuthTokenFromToolInput(input)
  if (!authToken) {
    throw new Error('You must be logged in to save a Vemotion composition. Please refresh the page and try again.')
  }
  if (!env.VEMOTION_WORKER) {
    throw new Error('VEMOTION_WORKER service binding is not configured')
  }

  const name = typeof input?.name === 'string' && input.name.trim()
    ? input.name.trim()
    : 'Untitled composition'

  // When a compositionId is supplied, the Vemotion worker updates that row
  // in place (versioned) instead of minting a new composition. This is what
  // makes "tweak the composition you just made" non-destructive — without it,
  // every save forks a new id and prior edits are lost.
  const requestedId = (typeof input?.compositionId === 'string' && input.compositionId.trim())
    ? input.compositionId.trim()
    : (typeof input?.id === 'string' && input.id.trim() ? input.id.trim() : '')

  const albumName = typeof input?.albumName === 'string' && input.albumName.trim()
    ? input.albumName.trim()
    : ''
  const hasComposition = input?.composition && typeof input.composition === 'object'

  let composition
  let sourceMode = 'custom'

  if (!hasComposition && albumName) {
    // SHORTCUT MODE: server-side resolve album → slideshow. Zero LLM in the fetch.
    sourceMode = 'album-slideshow'
    const imageKeys = await fetchAlbumImageKeys({ env, authToken, albumName })
    if (imageKeys.length === 0) {
      throw new Error(`Album "${albumName}" has no images — nothing to put in a slideshow.`)
    }
    composition = buildSlideshowFromImageKeys(imageKeys, {
      secondsPerImage: input.secondsPerImage,
      transitionSeconds: input.transitionSeconds,
    })
  } else {
    // CUSTOM MODE: caller supplied a full composition.
    const inputComp = hasComposition ? input.composition : {}
    const layers = Array.isArray(inputComp.layers) ? inputComp.layers : []
    if (layers.length === 0) {
      throw new Error('Provide either `composition` (with non-empty layers) OR `albumName` (shortcut for a slideshow).')
    }

    // Derive duration from layers (max of startTime + layerDuration) if not provided.
    let derivedDuration = 5
    for (const layer of layers) {
      const start = typeof layer?.startTime === 'number' ? layer.startTime : 0
      const dur = typeof layer?.layerDuration === 'number' ? layer.layerDuration : null
      if (dur !== null) {
        const candidate = start + dur
        if (candidate > derivedDuration) derivedDuration = candidate
      }
    }

    composition = {
      duration: typeof inputComp.duration === 'number' ? inputComp.duration : derivedDuration,
      fps: typeof inputComp.fps === 'number' ? inputComp.fps : 30,
      width: typeof inputComp.width === 'number' ? inputComp.width : 1280,
      height: typeof inputComp.height === 'number' ? inputComp.height : 720,
      layers,
    }
    if (typeof inputComp.fontFamily === 'string') composition.fontFamily = inputComp.fontFamily
    if (Array.isArray(inputComp.groups)) composition.groups = inputComp.groups
  }

  const saveBody = { name, composition }
  if (requestedId) saveBody.id = requestedId

  const res = await env.VEMOTION_WORKER.fetch('https://vemotion-worker/vemotion/composition/save', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Token': authToken,
    },
    body: JSON.stringify(saveBody),
  })

  // /composition/save returns 201 on create, 200 on update; both are success.
  if (res.status !== 200 && res.status !== 201) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Failed to save Vemotion composition (${res.status}): ${errText.slice(0, 300)}`)
  }
  const wasUpdate = res.status === 200

  const data = await res.json().catch(() => ({}))
  const savedId = data?.id || data?.summary?.id
  if (!savedId) {
    throw new Error(`Vemotion save returned no id: ${JSON.stringify(data).slice(0, 200)}`)
  }

  return {
    message: sourceMode === 'album-slideshow'
      ? `Vemotion slideshow built from album "${albumName}" (${composition.layers.length - 1} image(s))`
      : (wasUpdate
        ? `Vemotion composition updated in place (id ${savedId})`
        : 'Vemotion composition saved'),
    compositionId: savedId,
    updated: wasUpdate,
    name: data?.summary?.name || name,
    duration: data?.summary?.duration ?? composition.duration,
    layerCount: data?.summary?.layerCount ?? composition.layers.length,
    sourceMode,
    sourceAlbum: sourceMode === 'album-slideshow' ? albumName : undefined,
    editorUrl: `https://vemotion.vegvisr.org/?compositionId=${savedId}`,
  }
}

// Generate a composition from REAL computed geometry — POST /vemotion/generate/structure.
// Thin pass-through: the agent supplies PARAMETERS only; the Vemotion worker runs
// the deterministic math (icosahedron subdivision, projection, strut clustering),
// saves the composition, and returns { id, editorUrl, summary }. This exists because
// an LLM cannot hand-author correct parametric geometry — it produces noise-wave
// formulas. Keep this executor dumb: forward params, surface the result.
async function executeVemotionGenerateStructure(input, env) {
  const authToken = getAuthTokenFromToolInput(input)
  if (!authToken) {
    throw new Error('You must be logged in to generate a Vemotion structure. Please refresh the page and try again.')
  }
  if (!env.VEMOTION_WORKER) {
    throw new Error('VEMOTION_WORKER service binding is not configured')
  }

  const body = {
    structureType: (typeof input?.structureType === 'string' && input.structureType.trim()) ? input.structureType.trim() : 'geodesic-dome',
    params: (input?.params && typeof input.params === 'object' && !Array.isArray(input.params)) ? input.params : {},
  }
  if (typeof input?.name === 'string' && input.name.trim()) body.name = input.name.trim()
  const requestedId = (typeof input?.compositionId === 'string' && input.compositionId.trim())
    ? input.compositionId.trim()
    : (typeof input?.id === 'string' && input.id.trim() ? input.id.trim() : '')
  if (requestedId) body.compositionId = requestedId

  const res = await env.VEMOTION_WORKER.fetch('https://vemotion-worker/vemotion/generate/structure', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Token': authToken,
    },
    body: JSON.stringify(body),
  })

  // /generate/structure returns 201 on create, 200 on update; both are success.
  if (res.status !== 200 && res.status !== 201) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Failed to generate Vemotion structure (${res.status}): ${errText.slice(0, 300)}`)
  }
  const data = await res.json().catch(() => ({}))
  const savedId = data?.id
  if (!savedId) {
    throw new Error(`Vemotion generate returned no id: ${JSON.stringify(data).slice(0, 200)}`)
  }

  const summary = data?.summary || {}
  const strutBits = Array.isArray(summary.strutTypes)
    ? summary.strutTypes.map((s) => `${s.label}=${s.mm}mm×${s.count}`).join(', ')
    : ''
  return {
    message: `Vemotion ${body.structureType} generated (${summary.triangles ?? '?'} triangles, ${summary.layerCount ?? '?'} layers)${strutBits ? ` — struts: ${strutBits}` : ''}`,
    compositionId: savedId,
    updated: res.status === 200,
    structureType: data?.structureType || body.structureType,
    summary,
    editorUrl: data?.editorUrl || `https://vemotion.vegvisr.org/?compositionId=${savedId}`,
  }
}

// Create an Instagram carousel — thin forwarder to POST /vemotion/generate/structure
// with structureType "carousel". The Vemotion worker owns ALL layout math
// (templates, brand palette, slide windows, meta.carousel capture markers);
// the agent supplies content only. Same pattern as executeVemotionGenerateStructure.
async function executeVemotionCreateCarousel(input, env) {
  const authToken = getAuthTokenFromToolInput(input)
  if (!authToken) {
    throw new Error('You must be logged in to create a carousel. Please refresh the page and try again.')
  }
  if (!env.VEMOTION_WORKER) {
    throw new Error('VEMOTION_WORKER service binding is not configured')
  }
  const slides = Array.isArray(input?.slides) ? input.slides : []
  if (slides.length === 0) throw new Error('Provide a non-empty `slides` array (see get_carousel_reference).')
  if (slides.length > 10) throw new Error('Instagram carousels max out at 10 slides.')

  const name = (typeof input?.name === 'string' && input.name.trim()) ? input.name.trim() : 'Instagram carousel'
  const params = { name, slides }
  if (typeof input?.description === 'string' && input.description.trim()) params.description = input.description.trim()
  if (input?.brand && typeof input.brand === 'object' && !Array.isArray(input.brand)) params.brand = input.brand

  const body = { structureType: 'carousel', name, params }
  const requestedId = (typeof input?.compositionId === 'string' && input.compositionId.trim()) ? input.compositionId.trim() : ''
  if (requestedId) body.compositionId = requestedId

  const res = await env.VEMOTION_WORKER.fetch('https://vemotion-worker/vemotion/generate/structure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Token': authToken },
    body: JSON.stringify(body),
  })
  if (res.status !== 200 && res.status !== 201) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Failed to create carousel (${res.status}): ${errText.slice(0, 300)}`)
  }
  const data = await res.json().catch(() => ({}))
  const savedId = data?.id
  if (!savedId) throw new Error(`Carousel create returned no id: ${JSON.stringify(data).slice(0, 200)}`)

  const summary = data?.summary || {}
  return {
    message: `Instagram carousel "${name}" created — ${summary.slides ?? slides.length} slides at 1080×1350. Open the editor and click "Export slides (PNG set)" to download one PNG per slide, then post them to Instagram in order.`,
    compositionId: savedId,
    updated: res.status === 200,
    slides: summary.slides ?? slides.length,
    templates: summary.templates,
    summary,
    editorUrl: data?.editorUrl || `https://vemotion.vegvisr.org/?compositionId=${savedId}`,
  }
}

// Read a saved composition by id — GET /vemotion/composition?id=<id>.
// This is the load half of non-destructive editing: read the FULL current
// composition, modify the layers you need in-context, then call
// vemotion_save_composition with the same compositionId to update in place.
// Never rebuild a composition from memory — read it first.
async function executeVemotionGetComposition(input, env) {
  const authToken = getAuthTokenFromToolInput(input)
  if (!authToken) throw new Error('You must be logged in to read a Vemotion composition.')
  if (!env.VEMOTION_WORKER) throw new Error('VEMOTION_WORKER service binding is not configured')

  const id = (typeof input?.compositionId === 'string' && input.compositionId.trim())
    ? input.compositionId.trim()
    : (typeof input?.id === 'string' && input.id.trim() ? input.id.trim() : '')
  if (!id) throw new Error('compositionId is required to read a composition.')

  const res = await env.VEMOTION_WORKER.fetch(
    `https://vemotion-worker/vemotion/composition?id=${encodeURIComponent(id)}`,
    { headers: { 'X-API-Token': authToken } }
  )
  const text = await res.text()
  let data = {}
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }

  if (res.status === 404) throw new Error(`No Vemotion composition found with id "${id}".`)
  if (res.status !== 200) {
    throw new Error(`vemotion get ${res.status}: ${data.error || text.slice(0, 300)}`)
  }

  const composition = data?.composition || null
  if (!composition || !Array.isArray(composition.layers)) {
    throw new Error(`Composition "${id}" came back without a valid layers array.`)
  }

  return {
    message: `Loaded composition "${data?.name || id}" (${composition.layers.length} layer(s), v${data?.version ?? 1})`,
    compositionId: id,
    name: data?.name || null,
    version: data?.version ?? null,
    composition,
    layerCount: composition.layers.length,
    editorUrl: `https://vemotion.vegvisr.org/?compositionId=${id}`,
  }
}

// List the user's saved Vemotion compositions — GET /vemotion/compositions.
// The worker owner-filters by the X-API-Token caller, so this only returns the
// logged-in user's library. Optional `query` filters by name client-side (the
// endpoint has no q param; libraries are small so list-then-filter is fine).
async function executeVemotionListCompositions(input, env) {
  const authToken = getAuthTokenFromToolInput(input)
  if (!authToken) throw new Error('You must be logged in to list your Vemotion compositions.')
  if (!env.VEMOTION_WORKER) throw new Error('VEMOTION_WORKER service binding is not configured')

  const limit = Math.min(Math.max(Number(input?.limit) || 50, 1), 200)
  const res = await env.VEMOTION_WORKER.fetch(
    `https://vemotion-worker/vemotion/compositions?limit=${limit}`,
    { headers: { 'X-API-Token': authToken } }
  )
  const text = await res.text()
  let data = {}
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
  if (res.status !== 200) {
    throw new Error(`vemotion list ${res.status}: ${data.error || text.slice(0, 300)}`)
  }

  let compositions = Array.isArray(data?.compositions) ? data.compositions : []
  const query = (typeof input?.query === 'string' && input.query.trim()) ? input.query.trim().toLowerCase() : ''
  if (query) {
    compositions = compositions.filter(c => String(c?.name || '').toLowerCase().includes(query))
  }

  const items = compositions.map(c => ({
    compositionId: c.id || c.compositionId || null,
    name: c.name || '(untitled)',
    updatedAt: c.updatedAt || null,
    duration: c.duration ?? null,
    width: c.width ?? null,
    height: c.height ?? null,
    layerCount: c.layerCount ?? null,
    editorUrl: (c.id || c.compositionId) ? `https://vemotion.vegvisr.org/?compositionId=${c.id || c.compositionId}` : null,
  }))

  const scope = query ? ` matching "${input.query.trim()}"` : ''
  return {
    message: items.length
      ? `Found ${items.length} composition(s)${scope}.`
      : `No compositions${scope} in your Vemotion library.`,
    count: items.length,
    query: input?.query || null,
    compositions: items,
  }
}

// Thin wrapper for POST /vemotion/composition/refit — the Vemotion worker
// runs the canonical refit algorithm (src/lib/refit.ts). Zero LLM in the math.
async function executeVemotionRefitComposition(input, env) {
  const authToken = getAuthTokenFromToolInput(input)
  if (!authToken) throw new Error('You must be logged in to refit a Vemotion composition.')
  if (!env.VEMOTION_WORKER) throw new Error('VEMOTION_WORKER service binding is not configured')

  const hasId = typeof input?.compositionId === 'string' && input.compositionId.trim()
  const hasInline = input?.composition && typeof input.composition === 'object'
  if (hasId && hasInline) throw new Error('Provide compositionId OR composition, not both.')
  if (!hasId && !hasInline) throw new Error('Provide compositionId or an inline composition.')

  const targetWidth = Number(input?.targetWidth)
  const targetHeight = Number(input?.targetHeight)
  if (!Number.isFinite(targetWidth) || targetWidth <= 0) throw new Error('targetWidth (positive number) is required')
  if (!Number.isFinite(targetHeight) || targetHeight <= 0) throw new Error('targetHeight (positive number) is required')

  const mode = typeof input?.mode === 'string' ? input.mode : ''
  if (!['fit', 'fill', 'stretch'].includes(mode)) {
    throw new Error('mode must be one of "fit" | "fill" | "stretch"')
  }

  const body = { targetWidth, targetHeight, mode }
  if (hasId) body.compositionId = input.compositionId.trim()
  if (hasInline) body.composition = input.composition
  if (typeof input?.name === 'string' && input.name.trim()) body.name = input.name.trim()

  const res = await env.VEMOTION_WORKER.fetch('https://vemotion-worker/vemotion/composition/refit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Token': authToken },
    body: JSON.stringify(body),
  })

  const text = await res.text()
  let data = {}
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }

  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`vemotion refit ${res.status}: ${data.error || text.slice(0, 300)}`)
  }

  // 201 = saved (name was provided); 200 = inline transform (no save)
  if (res.status === 201) {
    const compositionId = data?.id || data?.summary?.id
    return {
      message: `Refit saved as new composition (${targetWidth}x${targetHeight}, ${mode})`,
      mode: 'saved',
      compositionId,
      name: data?.summary?.name || body.name,
      duration: data?.summary?.duration,
      width: data?.summary?.width ?? targetWidth,
      height: data?.summary?.height ?? targetHeight,
      layerCount: data?.summary?.layerCount,
      editorUrl: compositionId ? `https://vemotion.vegvisr.org/?compositionId=${compositionId}` : null,
    }
  }

  // 200 inline
  const refitComp = data?.composition || null
  return {
    message: `Refit computed (${targetWidth}x${targetHeight}, ${mode}); not saved`,
    mode: 'inline',
    composition: refitComp,
    layerCount: Array.isArray(refitComp?.layers) ? refitComp.layers.length : null,
    width: refitComp?.width ?? targetWidth,
    height: refitComp?.height ?? targetHeight,
  }
}

async function executeTranscribeAudio(input, env) {
  const { recordingId, audioUrl, language, saveToPortfolio = false, saveToGraph = false, graphTitle } = input
  // Resolve UUID to email if needed — audio-portfolio-worker expects email
  let userEmail = input.userEmail || input.userId
  if (userEmail && !userEmail.includes('@')) {
    const profile = await resolveUserProfile(userEmail, env)
    if (profile?.email) {
      userEmail = profile.email
    } else {
      throw new Error('Could not resolve user identity. Please try again.')
    }
  }

  let resolvedUrl = audioUrl
  let resolvedRecordingId = recordingId

  // 1. Resolve audio URL from portfolio if recordingId provided
  if (recordingId && userEmail && !audioUrl) {
    const listRes = await env.AUDIO_PORTFOLIO.fetch(
      `https://audio-portfolio-worker/list-recordings?userEmail=${encodeURIComponent(userEmail)}&limit=200&userRole=Superadmin&ownerEmail=${encodeURIComponent(userEmail)}`
    )
    if (!listRes.ok) throw new Error('Failed to fetch recordings from portfolio')
    const listData = await listRes.json()
    const recording = (listData.recordings || []).find(r => r.recordingId === recordingId)
    if (!recording) throw new Error(`Recording "${recordingId}" not found in portfolio`)
    resolvedUrl = recording.r2Url
    if (!resolvedUrl) throw new Error(`Recording "${recordingId}" has no audio URL`)
  }

  if (!resolvedUrl) {
    throw new Error('Provide either recordingId + userEmail or audioUrl')
  }

  // 2. Always delegate transcription to the frontend browser.
  //    The browser has AudioContext which can decode ANY audio format,
  //    split into 120s WAV chunks, and send each to /audio — same as GrokChatPanel.
  return {
    clientSideRequired: true,
    audioUrl: resolvedUrl,
    recordingId: resolvedRecordingId || null,
    language: language || null,
    saveToPortfolio,
    saveToGraph,
    graphTitle: graphTitle || null,
    userEmail,
    message: saveToGraph
      ? `Audio file found. Transcribing on your device and saving to a new graph...`
      : `Audio file found. Transcribing on your device...`,
  }
}

// ── Semantic analysis operations ──────────────────────────────────

// Stable model name — no -YYYYMMDD snapshot.
const ANALYSIS_MODEL = 'claude-sonnet-4-6'

async function executeAnalyzeNode(input, env) {
  const { graphId, nodeId, analysisType = 'all', store = false } = input

  // 1. Fetch the graph and find the node
  const graphRes = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${graphId}`
  )
  if (!graphRes.ok) throw new Error('Failed to fetch graph')
  const graphData = await graphRes.json()
  const node = (graphData.nodes || []).find(n => n.id === nodeId)
  if (!node) throw new Error(`Node "${nodeId}" not found in graph`)

  // 2. Prepare content (truncate for cost control)
  const content = (node.info || '').slice(0, 4000)
  if (!content.trim()) {
    return { graphId, nodeId, analysis: null, message: 'Node has no content to analyze' }
  }

  // 3. Call Claude for analysis
  const analysisPrompt = `Analyze this content and return a JSON object with:
- sentiment: "positive", "negative", "neutral", or "mixed"
- sentimentScore: number from -1.0 to 1.0
- weight: number from 0.0 to 1.0 (importance/significance of this content)
- keywords: array of 3-8 key terms extracted from the content
- summary: 1-2 sentence summary of the content's meaning
- language: detected language code (e.g. "en", "no", "de")

Content type: ${node.type || 'unknown'}
Title: ${node.label || 'Untitled'}
Content:
${content}

Return ONLY the JSON object, no markdown fences or explanation.`

  const claudeRes = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: input.userId || 'system-analysis',
      messages: [{ role: 'user', content: analysisPrompt }],
      model: ANALYSIS_MODEL,
      max_tokens: 1000,
      temperature: 0.1,
    }),
  })

  if (!claudeRes.ok) throw new Error(`Claude analysis failed (status: ${claudeRes.status})`)
  const claudeData = await claudeRes.json()

  // 4. Parse response
  const textBlock = (claudeData.content || []).find(b => b.type === 'text')
  if (!textBlock) throw new Error('No analysis response from Claude')

  let analysis
  try {
    analysis = JSON.parse(textBlock.text.trim())
  } catch {
    // If Claude didn't return clean JSON, wrap it
    analysis = { raw: textBlock.text.trim(), parseError: true }
  }

  // Filter to requested type
  if (analysisType !== 'all' && !analysis.parseError) {
    const filtered = {}
    if (analysisType === 'sentiment') {
      filtered.sentiment = analysis.sentiment
      filtered.sentimentScore = analysis.sentimentScore
    } else if (analysisType === 'keywords') {
      filtered.keywords = analysis.keywords
    } else if (analysisType === 'weight') {
      filtered.weight = analysis.weight
    } else if (analysisType === 'summary') {
      filtered.summary = analysis.summary
    }
    analysis = filtered
  }

  // 5. Optionally store in node metadata
  if (store && !analysis.parseError) {
    const existingMeta = node.metadata || {}
    await patchNodeWithVersionRetry(env, graphId, nodeId, {
      metadata: { ...existingMeta, analysis: { ...analysis, analyzedAt: new Date().toISOString() } }
    })
  }

  return {
    graphId,
    nodeId,
    nodeLabel: node.label,
    analysis,
    stored: store,
    message: `Analyzed node "${node.label}" — sentiment: ${analysis.sentiment || 'n/a'}, weight: ${analysis.weight || 'n/a'}`
  }
}

async function executeAnalyzeGraph(input, env) {
  const { graphId, store = false } = input

  // 1. Fetch full graph
  const graphRes = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${graphId}`
  )
  if (!graphRes.ok) throw new Error('Failed to fetch graph')
  const graphData = await graphRes.json()
  const nodes = graphData.nodes || []

  if (nodes.length === 0) {
    return { graphId, analysis: null, message: 'Graph has no nodes to analyze' }
  }

  // 2. Build condensed node list for Claude (limit content preview)
  const nodeDescriptions = nodes.map(n => {
    const preview = (n.info || '').replace(/<[^>]*>/g, '').slice(0, 200)
    return `- [${n.id}] ${n.label || 'Untitled'} (${n.type || 'unknown'}): ${preview}`
  }).join('\n')

  // 3. Call Claude for graph-level analysis
  const analysisPrompt = `Analyze this knowledge graph and return a JSON object with:
- sentiment: overall sentiment ("positive", "negative", "neutral", "mixed")
- summary: 2-3 sentence summary of what this graph is about
- topicClusters: array of { "topic": string, "nodeIds": string[], "description": string } grouping related nodes
- nodeRankings: array of { "nodeId": string, "label": string, "weight": number (0.0-1.0), "sentiment": "positive"|"negative"|"neutral"|"mixed", "reason": string } sorted by weight descending (most important first). Each node MUST have its own sentiment.
- language: primary language code of the content

Graph title: ${graphData.title || graphData.metadata?.title || 'Untitled'}
Total nodes: ${nodes.length}
Total edges: ${(graphData.edges || []).length}

Nodes:
${nodeDescriptions}

Return ONLY the JSON object, no markdown fences or explanation.`

  const claudeRes = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: input.userId || 'system-analysis',
      messages: [{ role: 'user', content: analysisPrompt }],
      model: ANALYSIS_MODEL,
      max_tokens: 4000,
      temperature: 0.1,
    }),
  })

  if (!claudeRes.ok) throw new Error(`Claude analysis failed (status: ${claudeRes.status})`)
  const claudeData = await claudeRes.json()

  // 4. Parse response
  const textBlock = (claudeData.content || []).find(b => b.type === 'text')
  if (!textBlock) throw new Error('No analysis response from Claude')

  let analysis
  try {
    analysis = JSON.parse(textBlock.text.trim())
  } catch {
    analysis = { raw: textBlock.text.trim(), parseError: true }
  }

  // 5. Optionally store per-node weights
  if (store && !analysis.parseError && analysis.nodeRankings) {
    for (const ranking of analysis.nodeRankings) {
      const node = nodes.find(n => n.id === ranking.nodeId)
      if (!node) continue
      const existingMeta = node.metadata || {}
      await patchNodeWithVersionRetry(env, graphId, ranking.nodeId, {
        metadata: {
          ...existingMeta,
          analysis: {
            weight: ranking.weight,
            reason: ranking.reason,
            analyzedAt: new Date().toISOString()
          }
        }
      })
    }
  }

  return {
    graphId,
    nodeCount: nodes.length,
    edgeCount: (graphData.edges || []).length,
    analysis,
    stored: store,
    message: `Analyzed graph "${graphData.title || graphId}" — ${analysis.topicClusters?.length || 0} topic clusters, ${analysis.nodeRankings?.length || 0} nodes ranked`
  }
}

// ── Transcription analysis (Enkel Endring) ──────────────────────

const TRANSCRIPTION_PROMPT_1_1 = `Analyser denne samtalen fra Enkel Endring-programmet og gi en strukturert rapport
på norsk med følgende fem seksjoner:

---

## 1. 🔑 Nøkkeltemaer
Hvilke hovedtemaer ble berørt i samtalen?
List opp 3–6 temaer med en kort forklaring (2–3 setninger) for hvert tema.

---

## 2. ✅ Suksessmålinger
Identifiser tegn på innsikt, fremgang eller positiv endring hos deltageren.
Se etter:
- Uttrykk for ny forståelse eller innsikt
- Tegn på mer ro, harmoni eller lettelse
- Utsagn om mindre stress eller bekymring
- Øyeblikk der deltager opplever en "shift" i tankegang

For hvert suksessmoment: beskriv hva som skjedde og hva det kan bety for deltagerens utvikling.

---

## 3. 🌟 Gullkorn
Plukk ut 3–7 kraftfulle sitater fra samtalen – både fra mentor og deltager.
Format:
> "Sitat her" — [Mentor / Deltager]

Velg sitater som er:
- Innsiktsfulle eller tankevekkende
- Morsomme eller menneskelige
- Beskriver en viktig sannhet eller vendepunkt

---

## 4. 🎯 Handlingspunkter
Hva er de konkrete neste stegene som kom frem i samtalen?
List opp handlingspunkter for:
- Deltager: hva de skal gjøre, utforske eller reflektere over
- Mentor (Tor Arne): oppfølgingspunkter eller ting å ta med til neste samtale

---

## 5. 🪞 Mentorfeedback – Selvrefleksjon
Gi konstruktiv tilbakemelding til Tor Arne som mentor.
Vurder:
- Hva fungerte bra? (lytting, spørsmål, timing, rom for innsikt)
- Hva kan gjøres annerledes eller bedre neste gang?
- Ble Tre Prinsippene (Sinn, Bevissthet, Tanke) brukt naturlig og effektivt?
- Var det øyeblikk der samtalens retning kunne vært annerledes?

Hold tilbakemeldingen støttende, konkret og fremadrettet.`

const TRANSCRIPTION_PROMPT_GROUP = `Analyser denne gruppesamtalen fra Enkel Endring-programmet og gi en strukturert rapport
på norsk med følgende fem seksjoner:

---

## 1. 🔑 Nøkkeltemaer
Hvilke hovedtemaer ble berørt i gruppesamtalen?
List opp 3–6 temaer med en kort forklaring (2–3 setninger) for hvert tema.
Merk hvilke temaer som engasjerte flere deltagere.

---

## 2. ✅ Suksessmålinger
Identifiser tegn på innsikt, fremgang eller positiv endring hos deltagerne.
Se etter:
- Uttrykk for ny forståelse eller innsikt hos enkeltpersoner
- Tegn på mer ro, harmoni eller lettelse i gruppen
- Øyeblikk der en deltagers deling utløste gjenkjennelse hos andre
- Gruppedynamikk som fremmet åpenhet og trygghet

For hvert suksessmoment: beskriv hva som skjedde, hvem som var involvert, og hva det kan bety.

---

## 3. 🌟 Gullkorn
Plukk ut 3–7 kraftfulle sitater fra samtalen – fra mentor og deltagere.
Format:
> "Sitat her" — [Mentor / Deltager]

Velg sitater som er:
- Innsiktsfulle eller tankevekkende
- Morsomme eller menneskelige
- Beskriver en viktig sannhet eller vendepunkt
- Skapte resonans i gruppen

---

## 4. 🎯 Handlingspunkter
Hva er de konkrete neste stegene som kom frem i samtalen?
List opp handlingspunkter for:
- Deltagerne: felles og individuelle refleksjoner eller oppgaver
- Mentor (Tor Arne): oppfølgingspunkter, temaer å ta videre, eller individuelle behov å følge opp

---

## 5. 🪞 Mentorfeedback – Selvrefleksjon
Gi konstruktiv tilbakemelding til Tor Arne som mentor/fasilitator.
Vurder:
- Hva fungerte bra? (rommet som ble skapt, balanse mellom deltagere, timing)
- Ble alle deltagere inkludert og sett?
- Ble Tre Prinsippene (Sinn, Bevissthet, Tanke) brukt naturlig og effektivt?
- Hva kan gjøres annerledes for å styrke gruppedynamikken neste gang?

Hold tilbakemeldingen støttende, konkret og fremadrettet.`

async function executeAnalyzeTranscription(input, env, progress = () => {}) {
  const { graphId, nodeId, conversationType = '1-1', saveToGraph = true } = input

  // 1. Fetch graph and find transcription node
  progress('Henter transkripsjon fra graf...')
  const graphRes = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${graphId}`
  )
  if (!graphRes.ok) throw new Error('Failed to fetch graph')
  const graphData = await graphRes.json()
  const nodes = graphData.nodes || []

  let node
  if (nodeId) {
    node = nodes.find(n => n.id === nodeId)
    if (!node) throw new Error(`Node "${nodeId}" not found in graph`)
  } else {
    // Find first fulltext node
    node = nodes.find(n => n.type === 'fulltext')
    if (!node) throw new Error('No fulltext node found in graph. Provide a nodeId.')
  }

  const transcriptionText = (node.info || '').trim()
  if (!transcriptionText) {
    return { graphId, nodeId: node.id, message: 'Node has no transcription text to analyze' }
  }

  // 2. Select prompt template based on conversation type
  const systemPrompt = conversationType === 'group'
    ? TRANSCRIPTION_PROMPT_GROUP
    : TRANSCRIPTION_PROMPT_1_1

  // 3. Send to Claude for analysis
  progress('Analyserer samtalen med Claude...')
  const claudeRes = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: input.userId || 'system-analysis',
      messages: [{ role: 'user', content: `${systemPrompt}\n\n---\n\nTranskripsjon:\n\n${transcriptionText}` }],
      model: ANALYSIS_MODEL,
      max_tokens: 4000,
      temperature: 0.3,
    }),
  })

  if (!claudeRes.ok) throw new Error(`Claude analysis failed (status: ${claudeRes.status})`)
  const claudeData = await claudeRes.json()

  const textBlock = (claudeData.content || []).find(b => b.type === 'text')
  if (!textBlock) throw new Error('No analysis response from Claude')

  const analysisText = textBlock.text.trim()

  // 4. Optionally save analysis as a new fulltext node in the same graph
  if (saveToGraph) {
    progress('Lagrer analyse i grafen...')
    const analysisNodeId = `node-analysis-${Date.now()}`
    const typeLabel = conversationType === 'group' ? 'Gruppesamtale' : '1-1 Samtale'
    await env.KG_WORKER.fetch('https://knowledge-graph-worker/addNode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graphId,
        node: {
          id: analysisNodeId,
          label: `# Analyse – ${typeLabel}`,
          type: 'fulltext',
          info: analysisText,
          color: '#E8A838',
        }
      }),
    })
  }

  return {
    graphId,
    nodeId: node.id,
    conversationType,
    savedToGraph: saveToGraph,
    analysisText,
    message: `Analyserte ${conversationType === 'group' ? 'gruppesamtale' : '1-1 samtale'} transkripsjon${saveToGraph ? ' og lagret analysen i grafen' : ''}`
  }
}

// ── data-node tools ──────────────────────────────────────────────

async function executeSaveFormData(input, env) {
  const graphId = (input.graphId || '').trim()
  if (!graphId) throw new Error('graphId is required')

  const record = input.record
  if (!record || typeof record !== 'object') throw new Error('record must be an object')

  const nodeId = (input.nodeId || '').trim() || crypto.randomUUID()

  // Add metadata to record
  record._id = crypto.randomUUID()
  record._ts = new Date().toISOString()

  // Fetch graph to check if data-node exists
  const getRes = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(graphId)}`
  )
  if (!getRes.ok) {
    const err = await getRes.json().catch(() => ({}))
    throw new Error(err.error || 'Failed to fetch graph')
  }
  const graphData = await getRes.json()
  const existingNode = (graphData.nodes || []).find(n => n.id === nodeId)

  if (existingNode) {
    // Append to existing data-node
    let records = []
    try { records = JSON.parse(existingNode.info || '[]') } catch { records = [] }
    if (!Array.isArray(records)) records = []
    records.push(record)

    await patchNodeWithVersionRetry(env, graphId, nodeId, { info: JSON.stringify(records) })

    return {
      success: true,
      graphId,
      nodeId,
      recordId: record._id,
      recordCount: records.length,
      message: `Record appended to data-node "${nodeId}" (${records.length} total records)`
    }
  } else {
    // Create new data-node
    const schema = input.schema || { columns: Object.keys(record).filter(k => !k.startsWith('_')).map(k => ({ key: k, label: k, type: 'text' })) }
    const label = input.label || '#Data'
    const metadata = { schema, encrypted: true }
    if (input.formTitle) metadata.formTitle = input.formTitle

    const addRes = await env.KG_WORKER.fetch('https://knowledge-graph-worker/addNode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graphId,
        node: {
          id: nodeId,
          label,
          type: 'data-node',
          info: JSON.stringify([record]),
          color: '#2563eb',
          position: { x: 0, y: 0 },
          visible: true,
          metadata
        }
      })
    })
    if (!addRes.ok) {
      const err = await addRes.json().catch(() => ({}))
      throw new Error(err.error || 'Failed to create data-node')
    }

    return {
      success: true,
      graphId,
      nodeId,
      recordId: record._id,
      recordCount: 1,
      message: `Created new data-node "${nodeId}" with label "${label}" and 1 record`
    }
  }
}

async function executeQueryDataNodes(input, env) {
  const graphId = (input.graphId || '').trim()
  const nodeId = (input.nodeId || '').trim()
  if (!graphId) throw new Error('graphId is required')
  if (!nodeId) throw new Error('nodeId is required')

  const limit = Math.min(Math.max(input.limit || 50, 1), 200)
  const offset = Math.max(input.offset || 0, 0)

  // Fetch graph (KG worker decrypts data-node info automatically)
  const getRes = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(graphId)}`
  )
  if (!getRes.ok) {
    const err = await getRes.json().catch(() => ({}))
    throw new Error(err.error || 'Failed to fetch graph')
  }
  const graphData = await getRes.json()
  const node = (graphData.nodes || []).find(n => n.id === nodeId)
  if (!node) throw new Error(`Node "${nodeId}" not found in graph "${graphId}"`)
  if (node.type !== 'data-node') throw new Error(`Node "${nodeId}" is type "${node.type}", not data-node`)

  let records = []
  try { records = JSON.parse(node.info || '[]') } catch { records = [] }
  if (!Array.isArray(records)) records = []

  const total = records.length

  // Apply optional filter
  if (input.filterKey && input.filterValue) {
    const fk = input.filterKey
    const fv = input.filterValue.toLowerCase()
    records = records.filter(r => {
      const val = r[fk]
      return val != null && String(val).toLowerCase().includes(fv)
    })
  }

  const filtered = records.length
  records = records.slice(offset, offset + limit)

  return {
    graphId,
    nodeId,
    records,
    total,
    filtered,
    returned: records.length,
    schema: node.metadata?.schema || null,
    message: `Returned ${records.length} of ${total} records from data-node "${nodeId}"${input.filterKey ? ` (filtered: ${filtered} matches)` : ''}`
  }
}

// ── Contact Management ───────────────────────────────────────────
// Table IDs are resolved dynamically per user via the Drizzle API.
// We use env.DRIZZLE_WORKER service binding (same pattern as other tools in this file).

async function drizzleFetch(env, path, body) {
  // Always use service binding — no external HTTP
  const res = await env.DRIZZLE_WORKER.fetch(`https://drizzle-worker${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`Drizzle ${path} failed (${res.status}): ${err}`)
  }
  return res.json()
}

async function resolveContactTableIds(userId, env) {
  if (!userId) throw new Error('userId required to resolve contact tables')
  const res = await env.DRIZZLE_WORKER.fetch(
    `https://drizzle-worker/tables?graphId=${encodeURIComponent(userId)}`
  )
  if (!res.ok) throw new Error(`Failed to list Drizzle tables for user (${res.status})`)
  const data = await res.json()
  const tables = data.tables || []
  const contacts = tables.find(t => t.displayName === 'contacts')
  const logs = tables.find(t => t.displayName === 'contact_logs')
  if (!contacts) throw new Error(`No contacts table found for user ${userId}. Import contacts first.`)
  return {
    contactsTableId: contacts.id,
    logsTableId: logs?.id || null
  }
}

async function executeListContacts(input, env) {
  const { limit = 50, offset = 0, label, userId } = input
  const { contactsTableId } = await resolveContactTableIds(userId, env)
  const body = { tableId: contactsTableId, limit, offset, orderBy: 'full_name', order: 'asc' }
  if (label) body.where = { labels: label }
  const data = await drizzleFetch(env, '/query', body)
  return { contacts: data.records || data.rows || data, total: data.total }
}

async function executeSearchContacts(input, env) {
  const { query, limit = 20, userId } = input
  if (!query) throw new Error('query is required')
  const { contactsTableId } = await resolveContactTableIds(userId, env)
  // Fetch broad set and filter client-side (Drizzle /query only supports equality where)
  const data = await drizzleFetch(env, '/query', {
    tableId: contactsTableId, limit: 1000, orderBy: 'full_name', order: 'asc'
  })
  const q = query.toLowerCase()
  const all = data.records || data.rows || data
  const filtered = all.filter(c =>
    (c.full_name || c.name || '').toLowerCase().includes(q) ||
    (c.organization || '').toLowerCase().includes(q) ||
    (c.emails || '').toLowerCase().includes(q) ||
    (c.phones || '').includes(q)
  ).slice(0, limit)
  return { contacts: filtered, query, count: filtered.length }
}

async function executeGetContactLogs(input, env) {
  const { contactId, limit = 20, userId } = input
  if (!contactId) throw new Error('contactId is required')
  const { logsTableId } = await resolveContactTableIds(userId, env)
  if (!logsTableId) return { logs: [], contactId, message: 'No contact log table found' }
  const data = await drizzleFetch(env, '/query', {
    tableId: logsTableId, where: { contact_id: contactId }, limit, orderBy: 'logged_at', order: 'desc'
  })
  return { logs: data.records || data.rows || data, contactId }
}

async function executeAddContactLog(input, env) {
  const { contactId, contactName, contact_type, notes, logged_at, userId } = input
  if (!contactId || !contactName || !notes) throw new Error('contactId, contactName, and notes are required')
  const { logsTableId } = await resolveContactTableIds(userId, env)
  if (!logsTableId) throw new Error('No contact_logs table found for this user')
  const record = {
    contact_id: contactId,
    contact_name: contactName,
    contact_type: contact_type || 'Annet',
    notes,
    logged_at: logged_at || new Date().toISOString()
  }
  const data = await drizzleFetch(env, '/insert', { tableId: logsTableId, record })
  return { success: true, logId: data._id || data.id, message: `Log entry added for ${contactName}` }
}

async function executeCreateContact(input, env) {
  const { name, email, phone, company, job_title, tags, labels, notes, userId } = input
  if (!name) throw new Error('name is required')
  const { contactsTableId } = await resolveContactTableIds(userId, env)
  const record = { full_name: name }
  if (email) record.emails = JSON.stringify([{ label: 'home', value: email }])
  if (phone) record.phones = JSON.stringify([{ label: 'mobile', value: phone }])
  if (company) record.organization = JSON.stringify({ name: company, title: job_title || '', department: '' })
  if (tags) record.labels = JSON.stringify(tags.split(',').map(t => t.trim()).filter(Boolean))
  if (labels) record.labels = JSON.stringify(labels.split(',').map(t => t.trim()).filter(Boolean))
  if (notes) record.notes = notes
  const data = await drizzleFetch(env, '/insert', { tableId: contactsTableId, record })
  return { success: true, contactId: data._id || data.id, name, message: `Contact "${name}" created` }
}

// ── AI content generation (multi-provider) ───────────────────────

async function executeSaveLearning(input, env) {
  const label = (input.label || '').trim()
  const rule = (input.rule || '').trim()
  const category = input.category || 'behavior'
  if (!label || !rule) throw new Error('label and rule are required')

  // Deduplication: check if a system-learning node with this label or rule already exists.
  // Normalize for comparison: lowercase, strip punctuation, collapse whitespace.
  const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
  const normLabel = normalize(label)
  const normRule = normalize(rule)

  const existingRes = await env.KG_WORKER.fetch(
    'https://knowledge-graph-worker/getknowgraph?id=graph_system_prompt'
  ).catch(() => null)
  if (existingRes && existingRes.ok) {
    const existingGraph = await existingRes.json().catch(() => null)
    const nodes = existingGraph?.nodes || []
    const duplicate = nodes.find(n => {
      if (n.type !== 'system-learning') return false
      if (normalize(n.label || '') === normLabel) return true
      // Also match on rule content (stored as "LEARNED: <rule>")
      const existingRule = normalize((n.info || '').replace(/^learned:\s*/i, ''))
      return existingRule === normRule
    })
    if (duplicate) {
      return { saved: false, nodeId: duplicate.id, label, message: `Learning already exists (nodeId: ${duplicate.id}). Skipped duplicate.` }
    }
  }

  const nodeId = 'learning-' + Date.now()
  const today = new Date().toISOString().split('T')[0]

  const res = await env.KG_WORKER.fetch('https://knowledge-graph-worker/addNode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      graphId: 'graph_system_prompt',
      node: {
        id: nodeId,
        label: label,
        type: 'system-learning',
        color: '#ef4444',
        info: `LEARNED: ${rule}`,
        metadata: { source: 'agent-self', category, date: today },
      }
    }),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`Failed to save learning: ${res.status} ${err}`)
  }

  return { saved: true, nodeId, label, message: `Learning saved to graph_system_prompt. It will be loaded in all future conversations.` }
}

async function executeGenerateWithAi(input, env) {
  const provider = (input.provider || '').toLowerCase()
  const prompt = (input.prompt || '').trim()
  const maxTokens = input.maxTokens || 2048
  if (!prompt) throw new Error('prompt is required')

  // Map provider to service binding and default model
  const providers = {
    claude:  { binding: env.ANTHROPIC,       url: 'https://anthropic.vegvisr.org/chat',  defaultModel: 'claude-sonnet-4-6' },
    openai:  { binding: env.OPENAI_WORKER,   url: 'https://openai.vegvisr.org/chat',     defaultModel: 'gpt-4o' },
    grok:    { binding: env.GROK_WORKER,     url: 'https://grok.vegvisr.org/chat',       defaultModel: 'grok-4-latest' },
    gemini:  { binding: env.GEMINI_WORKER,   url: 'https://gemini.vegvisr.org/chat',     defaultModel: 'gemini-2.5-flash' },
  }

  const cfg = providers[provider]
  if (!cfg) throw new Error(`Unknown provider "${provider}". Use: claude, openai, grok, or gemini.`)
  if (!cfg.binding) throw new Error(`Service binding for "${provider}" is not configured.`)

  const model = input.model || cfg.defaultModel

  const res = await cfg.binding.fetch(cfg.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      model,
      max_tokens: maxTokens,
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`${provider} returned ${res.status}: ${errText.slice(0, 500)}`)
  }

  const data = await res.json()

  // Anthropic returns content[0].text, OpenAI/Grok/Gemini return choices[0].message.content
  const text = data.content?.[0]?.text
    || data.choices?.[0]?.message?.content
    || data.text
    || JSON.stringify(data)

  return { provider, model, text, tokenCount: text.length }
}

// ── Drizzle worker executors (relational D1 tables) ──────────────

// Resolve tableId from UUID, table_name, or display_name
async function resolveTableId(input, env) {
  const tableId = (input.tableId || '').trim()
  const tableName = (input.tableName || '').trim()
  const nameToFind = tableId || tableName
  if (!nameToFind) throw new Error('tableId or tableName is required')

  // If it looks like a UUID, use directly
  if (/^[0-9a-f]{8}-/.test(nameToFind)) return nameToFind

  // Look up by name — scope to the current user's tables when userId is available
  const userId = (input.userId || '').trim()
  const scopeParam = userId ? `?userId=${encodeURIComponent(userId)}` : ''
  const res = await env.DRIZZLE_WORKER.fetch(`https://drizzle-worker/tables${scopeParam}`)
  if (!res.ok) throw new Error('Failed to list tables')
  const data = await res.json()
  const tableList = data.tables || data || []
  const match = tableList.find(t =>
    t.tableName === nameToFind || t.displayName === nameToFind ||
    t.tableName?.toLowerCase() === nameToFind.toLowerCase() ||
    t.displayName?.toLowerCase() === nameToFind.toLowerCase()
  )
  if (match) return match.id
  throw new Error(`Table not found: "${nameToFind}". Available tables: ${tableList.map(t => t.displayName || t.tableName).join(', ')}`)
}

async function executeCreateAppTable(input, env) {
  const graphId = (input.graphId || '').trim()
  const displayName = (input.displayName || '').trim()
  if (!graphId) throw new Error('graphId is required')
  if (!displayName) throw new Error('displayName is required')
  if (!Array.isArray(input.columns) || input.columns.length === 0) {
    throw new Error('columns array is required and must not be empty')
  }

  const res = await env.DRIZZLE_WORKER.fetch('https://drizzle-worker/create-table', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      graphId,
      displayName,
      columns: input.columns
    })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to create table')

  return {
    success: true,
    tableId: data.id,
    tableName: data.tableName,
    displayName: data.displayName,
    columnCount: data.columnCount,
    message: `Created table "${displayName}" (${data.tableName}) with ${data.columnCount} columns. Table ID: ${data.id}`
  }
}

async function executeInsertAppRecord(input, env) {
  const tableId = await resolveTableId(input, env)
  if (!input.record || typeof input.record !== 'object') {
    throw new Error('record object is required')
  }

  const res = await env.DRIZZLE_WORKER.fetch('https://drizzle-worker/insert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tableId,
      userId: input.userId || undefined,
      record: input.record
    })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to insert record')

  return {
    success: true,
    _id: data._id,
    _created_at: data._created_at,
    message: `Inserted record ${data._id} into table ${tableId}`
  }
}

async function executeDeleteAppRecords(input, env) {
  const tableId = await resolveTableId(input, env)

  const body = { tableId, userId: input.userId || undefined }
  if (input.ids) body.ids = input.ids
  if (input.where) body.where = input.where

  const res = await env.DRIZZLE_WORKER.fetch('https://drizzle-worker/delete-records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to delete records')

  return {
    success: true,
    deleted: data.deleted,
    message: `Deleted ${data.deleted} record(s) from table ${tableId}`
  }
}

async function executeQueryAppTable(input, env) {
  const tableId = await resolveTableId(input, env)

  const res = await env.DRIZZLE_WORKER.fetch('https://drizzle-worker/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tableId,
      userId: input.userId || undefined,
      where: input.where || undefined,
      orderBy: input.orderBy || undefined,
      order: input.order || undefined,
      limit: input.limit || 50,
      offset: input.offset || 0
    })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to query table')

  return {
    records: data.records,
    total: data.total,
    returned: data.records.length,
    columns: data.columns,
    message: `Returned ${data.records.length} of ${data.total} records from table ${tableId}`
  }
}

async function executeAddAppTableColumn(input, env) {
  const tableId = await resolveTableId(input, env)
  if (!input.name || !input.type) throw new Error('name and type are required')

  const res = await env.DRIZZLE_WORKER.fetch('https://drizzle-worker/add-column', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tableId,
      userId: input.userId || undefined,
      name: input.name,
      type: input.type,
      label: input.label || input.name,
      required: input.required || false
    })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to add column')

  return {
    success: true,
    columnName: data.columnName,
    displayName: data.displayName,
    columnType: data.columnType,
    message: data.message
  }
}

async function executeGetAppTableSchema(input, env) {
  const tableId = await resolveTableId(input, env)

  const userParam = input.userId ? `?userId=${encodeURIComponent(input.userId)}` : ''
  const res = await env.DRIZZLE_WORKER.fetch(`https://drizzle-worker/table/${tableId}${userParam}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to get table schema')

  return {
    id: data.id,
    displayName: data.displayName,
    tableName: data.tableName,
    graphId: data.graphId,
    columns: data.columns,
    message: `Table "${data.displayName}" has ${data.columns.length} columns: ${data.columns.map(c => c.name).join(', ')}`
  }
}

// ── Shared: resolve caller profile + build auth query string for CHAT_WORKER
async function chatAuth(userId, env) {
  const profile = await resolveUserProfile(userId, env)
  if (!profile) throw new Error('Could not resolve your user profile')
  if (!profile.phone) throw new Error('Your profile has no phone number')
  const qs = `user_id=${encodeURIComponent(profile.user_id || userId)}&phone=${encodeURIComponent(profile.phone)}&email=${encodeURIComponent(profile.email || '')}`
  return { profile, qs, body: { user_id: profile.user_id || userId, phone: profile.phone, email: profile.email || '' } }
}

async function executeListChatGroups(input, env) {
  const auth = await chatAuth(input.userId, env)
  const res = await env.CHAT_WORKER.fetch(`https://group-chat-worker/groups?${auth.qs}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to list chat groups')

  const groups = data.groups || []
  return {
    groups,
    count: groups.length,
    message: `Found ${groups.length} chat groups`
  }
}

async function executeAddUserToChatGroup(input, env) {
  const email = (input.email || '').trim()
  if (!email) throw new Error('email is required')
  if (!input.groupId && !input.groupName) throw new Error('groupId or groupName is required')

  let groupId = input.groupId
  if (!groupId && input.groupName) {
    groupId = await resolveGroupIdByName(input.groupName, input.userId, env)
  }

  // Look up the target user by email to get their user_id and phone
  const targetProfile = await resolveUserProfile(email, env)
  if (!targetProfile) throw new Error(`User not found: ${email}`)
  if (!targetProfile.phone) throw new Error(`User ${email} has no phone number`)

  const res = await env.CHAT_WORKER.fetch(`https://group-chat-worker/groups/${groupId}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: targetProfile.user_id,
      phone: targetProfile.phone,
      email: targetProfile.email || email,
      role: input.role || 'member',
    })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to add user to group')

  return {
    success: true,
    user_id: targetProfile.user_id,
    email,
    group_id: groupId,
    role: input.role || 'member',
    message: `Added ${email} to group ${groupId} as ${input.role || 'member'}`
  }
}

async function executeGetGroupMessages(input, env) {
  if (!input.groupId && !input.groupName) throw new Error('groupId or groupName is required')

  let groupId = input.groupId
  if (!groupId && input.groupName) {
    groupId = await resolveGroupIdByName(input.groupName, input.userId, env)
  }

  const auth = await chatAuth(input.userId, env)
  const requestedLimit = input.limit || 200
  const allMessages = []
  let before = 0
  const pageSize = 200 // max per API call
  const maxPages = 20 // safety limit: 20 * 200 = 4000 messages max

  for (let page = 0; page < maxPages; page++) {
    const params = `${auth.qs}&latest=1&limit=${pageSize}${before > 0 ? `&before=${before}` : ''}`
    const res = await env.CHAT_WORKER.fetch(
      `https://group-chat-worker/groups/${groupId}/messages?${params}`
    )
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to get group messages')

    const messages = data.messages || []
    allMessages.push(...messages)

    // Stop if we have enough or no more pages
    if (!data.paging?.has_more || allMessages.length >= requestedLimit) break
    before = data.paging.next_before
    if (!before) break
  }

  // Sort newest-first (b.id - a.id). The downstream subagent loop truncates
  // tool results at ~8000 chars; "newest first" means the truncation drops
  // OLDEST messages, which is what callers asking "latest" want.
  // The previous order (oldest-first) silently lost the most recent messages
  // when results were truncated — readers asking for "the latest" got the
  // latest of the surviving window, not the actual latest.
  allMessages.sort((a, b) => b.id - a.id)
  const trimmed = allMessages.slice(0, requestedLimit)

  return {
    groupId,
    messages: trimmed,
    count: trimmed.length,
    totalFetched: allMessages.length,
    message: `Retrieved ${trimmed.length} messages from group ${groupId}`
  }
}

async function executeGetGroupStats(input, env) {
  const auth = await chatAuth(input.userId, env)
  const res = await env.CHAT_WORKER.fetch(`https://group-chat-worker/groups?${auth.qs}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to get groups')

  const groups = data.groups || []
  // Build stats by fetching member counts per group
  const stats = []
  for (const g of groups) {
    try {
      const membersRes = await env.CHAT_WORKER.fetch(
        `https://group-chat-worker/groups/${g.id}/members?${auth.qs}`
      )
      const membersData = await membersRes.json()
      const members = membersData.members || []
      const botCount = members.filter(m => m.is_bot || (m.user_id && m.user_id.startsWith('bot:'))).length
      stats.push({
        id: g.id,
        name: g.name,
        memberCount: members.length,
        botCount,
        humanCount: members.length - botCount,
        createdBy: g.created_by,
        createdAt: g.created_at,
        updatedAt: g.updated_at,
      })
    } catch {
      stats.push({ id: g.id, name: g.name, memberCount: '?', createdBy: g.created_by })
    }
  }

  const mostActive = stats[0]
  return {
    groups: stats,
    count: stats.length,
    message: mostActive
      ? `${stats.length} groups. First: "${mostActive.name}" with ${mostActive.memberCount} members (${mostActive.botCount} bots)`
      : 'No groups found'
  }
}

async function executeSendGroupMessage(input, env) {
  const email = (input.email || '').trim()
  const body = (input.body || '').trim()
  const messageType = (input.messageType || 'text').trim()
  if (!email) throw new Error('email is required')
  if (messageType === 'voice') {
    if (!input.audioUrl) throw new Error('audioUrl is required for voice messages')
  } else {
    if (!body) throw new Error('body (message text) is required')
  }
  if (!input.groupId && !input.groupName) throw new Error('groupId or groupName is required')

  let groupId = input.groupId
  if (!groupId && input.groupName) {
    groupId = await resolveGroupIdByName(input.groupName, input.userId, env)
  }

  // Resolve the sender by email
  const senderProfile = await resolveUserProfile(email, env)
  if (!senderProfile) throw new Error(`User not found: ${email}`)
  if (!senderProfile.phone) throw new Error(`User ${email} has no phone number`)

  const payload = {
    user_id: senderProfile.user_id,
    phone: senderProfile.phone,
    email: senderProfile.email || email,
    body,
    message_type: messageType,
  }
  if (messageType === 'voice') {
    payload.audio_url = input.audioUrl
    if (input.audioDurationMs) payload.audio_duration_ms = input.audioDurationMs
    if (input.transcriptText) payload.transcript_text = input.transcriptText
    if (input.transcriptLang) payload.transcript_lang = input.transcriptLang
  }

  const res = await env.CHAT_WORKER.fetch(`https://group-chat-worker/groups/${groupId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to send message')

  const result = {
    success: true,
    messageId: data.id || data.message_id,
    groupId,
    email,
    body,
    messageType,
    message: messageType === 'voice'
      ? `Sent voice message to group ${groupId} as ${email}`
      : `Sent message to group ${groupId} as ${email}`
  }
  return result
}

async function executeCreateChatGroup(input, env) {
  const email = (input.email || '').trim()
  const name = (input.name || '').trim()
  if (!email) throw new Error('email is required')
  if (!name) throw new Error('name (group name) is required')

  // Resolve creator by email
  const creatorProfile = await resolveUserProfile(email, env)
  if (!creatorProfile) throw new Error(`User not found: ${email}`)
  if (!creatorProfile.phone) throw new Error(`User ${email} has no phone number`)

  const res = await env.CHAT_WORKER.fetch('https://group-chat-worker/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      created_by: creatorProfile.user_id,
      phone: creatorProfile.phone,
      email: creatorProfile.email || email,
      graph_id: input.graphId || undefined,
    })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to create chat group')

  return {
    success: true,
    groupId: data.id,
    groupName: data.name,
    createdBy: email,
    createdAt: data.created_at,
    graphId: data.graph_id,
    message: `Created chat group "${data.name}" with ${email} as owner`
  }
}

async function executeRegisterChatBot(input, env) {
  const botName = (input.botName || '').trim()
  const username = (input.username || '').trim().toLowerCase().replace(/^@/, '')
  if (!botName) throw new Error('botName is required')
  if (!username) throw new Error('username is required')

  // Resolve caller's profile for auth (Superadmin check happens in group-chat-worker)
  const callerProfile = await resolveUserProfile(input.userId, env)
  if (!callerProfile) throw new Error('Could not resolve your user profile')
  if (!callerProfile.phone) throw new Error('Your profile has no phone number — required for bot management')

  // 1. Create the bot via group-chat-worker
  const createRes = await env.CHAT_WORKER.fetch('https://group-chat-worker/bots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: callerProfile.user_id || input.userId,
      phone: callerProfile.phone,
      email: callerProfile.email,
      name: botName,
      username,
      graph_id: input.graphId || undefined,
      system_prompt: input.systemPrompt || undefined,
      avatar_url: input.avatarUrl || undefined,
      model: input.model || undefined,
      temperature: input.temperature,
      max_turns: input.maxTurns || undefined,
      tools: input.tools || [],
    })
  })
  const createData = await createRes.json()
  if (!createRes.ok) throw new Error(createData.error || 'Failed to create bot')

  const bot = createData.bot
  const result = {
    success: true,
    botId: bot.id,
    botName: bot.name,
    username: bot.username,
    graphId: bot.graph_id,
    model: bot.model,
    message: `Created bot "${bot.name}" (@${bot.username})`,
  }

  // 2. If groupId provided, also add bot to the group
  if (input.groupId) {
    const addRes = await env.CHAT_WORKER.fetch(`https://group-chat-worker/groups/${input.groupId}/bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: callerProfile.user_id || input.userId,
        phone: callerProfile.phone,
        email: callerProfile.email,
        bot_id: bot.id,
      })
    })
    const addData = await addRes.json()
    if (addRes.ok) {
      result.groupId = input.groupId
      result.message += ` and added to group ${input.groupId}`
    } else {
      result.groupWarning = addData.error || 'Failed to add bot to group'
      result.message += ` (warning: could not add to group — ${result.groupWarning})`
    }
  }

  return result
}

async function executeListAgents(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, name, description, avatar_url, model, tools, is_active, metadata
     FROM agent_configs WHERE is_active = 1 ORDER BY name`
  ).all()

  const agents = (results || []).map(a => ({
    id: a.id,
    name: a.name,
    description: a.description,
    model: a.model,
    avatar_url: a.avatar_url,
    tools: a.tools ? JSON.parse(a.tools) : [],
    chatBotId: a.metadata ? (JSON.parse(a.metadata).chatBotId || null) : null,
  }))

  return {
    agents,
    count: agents.length,
    message: agents.length === 0
      ? 'No active agents configured.'
      : `${agents.length} active agents: ${agents.map(a => a.name).join(', ')}`,
  }
}

async function executeGetAgent(input, env) {
  if (!input.agentId) throw new Error('agentId is required')
  const agent = await env.DB.prepare(
    'SELECT * FROM agent_configs WHERE id = ?'
  ).bind(input.agentId).first()
  if (!agent) throw new Error(`Agent "${input.agentId}" not found`)

  let meta = {}
  try { meta = agent.metadata ? JSON.parse(agent.metadata) : {} } catch { /* ignore */ }

  return {
    agent: {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      system_prompt: (agent.system_prompt || '').slice(0, 500) + (agent.system_prompt?.length > 500 ? '...' : ''),
      model: agent.model,
      temperature: agent.temperature,
      max_tokens: agent.max_tokens,
      tools: agent.tools ? JSON.parse(agent.tools) : [],
      avatar_url: agent.avatar_url,
      is_active: agent.is_active,
      chatBotId: meta.chatBotId || null,
      botGraphId: meta.botGraphId || null,
    },
    message: `Agent "${agent.name}" — model: ${agent.model}, tools: ${agent.tools ? JSON.parse(agent.tools).length : 0}, active: ${agent.is_active ? 'yes' : 'no'}`,
  }
}

async function executeCreateAgent(input, env) {
  if (!input.name) throw new Error('name is required')
  const id = `agent_${crypto.randomUUID().slice(0, 8)}`
  await env.DB.prepare(
    `INSERT INTO agent_configs (id, name, description, system_prompt, model, max_tokens, temperature, tools, metadata, is_active, avatar_url)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10)`
  ).bind(
    id,
    input.name,
    input.description || '',
    input.systemPrompt || '',
    input.model || DEFAULT_MODEL,
    input.maxTokens || 4096,
    input.temperature ?? 0.3,
    JSON.stringify(input.tools || []),
    JSON.stringify({}),
    input.avatarUrl || null
  ).run()

  return {
    agentId: id,
    name: input.name,
    model: input.model || DEFAULT_MODEL,
    message: `Created agent "${input.name}" with ID ${id}`,
  }
}

async function executeUpdateAgent(input, env) {
  if (!input.agentId) throw new Error('agentId is required')

  // Verify agent exists
  const existing = await env.DB.prepare('SELECT id FROM agent_configs WHERE id = ?').bind(input.agentId).first()
  if (!existing) throw new Error(`Agent "${input.agentId}" not found`)

  const fieldMap = {
    name: input.name,
    description: input.description,
    system_prompt: input.systemPrompt,
    model: input.model,
    max_tokens: input.maxTokens,
    temperature: input.temperature,
    avatar_url: input.avatarUrl,
  }

  const sets = []
  const values = []
  for (const [col, val] of Object.entries(fieldMap)) {
    if (val !== undefined) {
      sets.push(`${col} = ?`)
      values.push(val)
    }
  }
  if (input.tools !== undefined) {
    sets.push('tools = ?')
    values.push(JSON.stringify(input.tools))
  }
  if (input.metadata !== undefined) {
    sets.push('metadata = ?')
    values.push(JSON.stringify(input.metadata))
  }

  if (sets.length === 0) throw new Error('No fields to update')

  values.push(input.agentId)
  await env.DB.prepare(
    `UPDATE agent_configs SET ${sets.join(', ')} WHERE id = ?`
  ).bind(...values).run()

  const updated = await env.DB.prepare('SELECT * FROM agent_configs WHERE id = ?').bind(input.agentId).first()
  return {
    agentId: input.agentId,
    name: updated?.name,
    message: `Updated agent "${updated?.name || input.agentId}" — changed: ${sets.map(s => s.split(' = ')[0]).join(', ')}`,
  }
}

async function executeDeactivateAgent(input, env) {
  if (!input.agentId) throw new Error('agentId is required')
  const agent = await env.DB.prepare('SELECT name FROM agent_configs WHERE id = ?').bind(input.agentId).first()
  if (!agent) throw new Error(`Agent "${input.agentId}" not found`)

  await env.DB.prepare('UPDATE agent_configs SET is_active = 0 WHERE id = ?').bind(input.agentId).run()
  return {
    agentId: input.agentId,
    name: agent.name,
    message: `Deactivated agent "${agent.name}" (${input.agentId})`,
  }
}

async function executeGenerateImage(input, env) {
  if (!input.prompt) throw new Error('prompt is required')
  if (!env.AI) throw new Error('Workers AI binding (AI) is not configured')
  if (!env.PHOTOS_WORKER) throw new Error('PHOTOS_WORKER binding is not configured')

  const startTime = Date.now()

  // Run Stable Diffusion XL Lightning — returns a ReadableStream of JPEG bytes
  const aiInput = {
    prompt: input.prompt,
    ...(input.negative_prompt ? { negative_prompt: input.negative_prompt } : {}),
  }

  // env.AI.run() returns a ReadableStream of JPEG bytes — use Response.arrayBuffer() to buffer it
  // (matches the official CF example pattern: new Response(response, { headers: { "content-type": "image/jpg" } }))
  let imageResponse
  try {
    imageResponse = await env.AI.run('@cf/bytedance/stable-diffusion-xl-lightning', aiInput)
  } catch (aiErr) {
    console.error('[generate_image] env.AI.run() threw:', aiErr?.name, aiErr?.message)
    throw new Error(`Workers AI error: ${aiErr?.message || String(aiErr)}`)
  }

  if (!imageResponse) throw new Error('Workers AI returned null/undefined')

  const arrayBuffer = await new Response(imageResponse).arrayBuffer()
  const buffer = new Uint8Array(arrayBuffer)

  // Validate JPEG magic bytes: 0xFF 0xD8
  console.log(`[generate_image] buffer size=${buffer.length} firstBytes=[${buffer[0]},${buffer[1]},${buffer[2]}]`)
  if (buffer.length < 100 || buffer[0] !== 0xFF || buffer[1] !== 0xD8) {
    const preview = new TextDecoder().decode(buffer.slice(0, 200))
    console.error('[generate_image] Not a JPEG — got:', preview)
    throw new Error(`Workers AI returned non-image data: ${preview.slice(0, 100)}`)
  }

  // Upload via FormData — photos-worker /upload expects multipart form with a 'file' field
  const filename = `sdxl-${Date.now()}.jpg`
  const formData = new FormData()
  formData.append('file', new File([buffer], filename, { type: 'image/jpeg' }))
  formData.append('filename', `sdxl-${Date.now()}`)
  formData.append('album', 'agent-generated')

  const uploadRes = await env.PHOTOS_WORKER.fetch('https://vegvisr-photos-worker/upload', {
    method: 'POST',
    body: formData,
  })
  const uploadData = await uploadRes.json()
  if (!uploadRes.ok) throw new Error(uploadData.error || `Upload failed (${uploadRes.status})`)

  const url = uploadData.urls?.[0]
  if (!url) throw new Error('Upload succeeded but no URL returned')

  // Record stats so image generations appear in the usage dashboard
  if (env.STATS_DB) {
    const now = new Date().toISOString()
    env.STATS_DB.prepare(
      `INSERT INTO sessions (id, user_id, started_at, ended_at, duration_ms,
        turns, fast_path, model, input_tokens, output_tokens, tool_calls, success,
        agent_id, version, version_note, cost_usd)
       VALUES (?, ?, ?, ?, ?, 1, 0, ?, 0, 0, '[]', 1, 'workers-ai', 'v-wai-1', 'Image generation', 0)`
    ).bind(
      crypto.randomUUID(),
      input.userId || 'unknown',
      new Date(startTime).toISOString(),
      now,
      Date.now() - startTime,
      '@cf/bytedance/stable-diffusion-xl-lightning'
    ).run().catch(e => console.error('[stats] image gen insert failed:', e.message))
  }

  return {
    url,
    prompt: input.prompt,
    message: `Generated image: ${url}`,
  }
}

async function executeUploadAgentAvatar(input, env) {
  if (!input.agentId) throw new Error('agentId is required')
  if (!input.base64) throw new Error('base64 image data is required')

  // Verify agent exists
  const agent = await env.DB.prepare('SELECT name FROM agent_configs WHERE id = ?').bind(input.agentId).first()
  if (!agent) throw new Error(`Agent "${input.agentId}" not found`)

  // Upload via photos-worker
  const uploadRes = await env.PHOTOS_WORKER.fetch('https://vegvisr-photos-worker/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: input.userId || 'agent-builder',
      base64: input.base64,
      mediaType: input.mediaType || 'image/png',
      filename: input.filename || `avatar-${input.agentId}.png`,
    }),
  })
  const uploadData = await uploadRes.json()
  if (!uploadRes.ok) throw new Error(uploadData.error || 'Failed to upload avatar')

  const avatarUrl = uploadData.url
  if (!avatarUrl) throw new Error('Upload succeeded but no URL returned')

  // Update agent with avatar URL
  await env.DB.prepare('UPDATE agent_configs SET avatar_url = ? WHERE id = ?').bind(avatarUrl, input.agentId).run()

  return {
    agentId: input.agentId,
    avatarUrl,
    message: `Uploaded avatar for agent "${agent.name}" — ${avatarUrl}`,
  }
}

async function executeListBots(input, env) {
  const auth = await chatAuth(input.userId, env)
  const res = await env.CHAT_WORKER.fetch(`https://group-chat-worker/bots?${auth.qs}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to list bots')

  const bots = (data.bots || []).map(b => ({
    id: b.id,
    name: b.name,
    username: b.username,
    model: b.model,
    graph_id: b.graph_id,
    avatar_url: b.avatar_url,
    is_active: b.is_active,
    created_at: b.created_at,
  }))

  return {
    bots,
    count: bots.length,
    message: bots.length === 0
      ? 'No active bots found.'
      : `${bots.length} active bots: ${bots.map(b => `${b.name} (@${b.username})`).join(', ')}`,
  }
}

async function executeGetBot(input, env) {
  if (!input.botId) throw new Error('botId is required')
  const auth = await chatAuth(input.userId, env)
  const res = await env.CHAT_WORKER.fetch(`https://group-chat-worker/bots/${input.botId}?${auth.qs}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Bot not found')

  const bot = data.bot
  const groups = data.groups || []

  return {
    bot,
    groups,
    message: `Bot "${bot.name}" (@${bot.username}) — model: ${bot.model}, graph: ${bot.graph_id || 'none'}, groups: ${groups.length === 0 ? 'none' : groups.map(g => g.name).join(', ')}`,
  }
}

async function executeUpdateChatBot(input, env) {
  if (!input.botId) throw new Error('botId is required')

  const callerProfile = await resolveUserProfile(input.userId, env)
  if (!callerProfile) throw new Error('Could not resolve your user profile')
  if (!callerProfile.phone) throw new Error('Your profile has no phone number')

  const body = {
    user_id: callerProfile.user_id || input.userId,
    phone: callerProfile.phone,
    email: callerProfile.email || '',
  }
  if (input.name !== undefined) body.name = input.name
  if (input.systemPrompt !== undefined) body.system_prompt = input.systemPrompt
  if (input.graphId !== undefined) body.graph_id = input.graphId
  if (input.avatarUrl !== undefined) body.avatar_url = input.avatarUrl
  if (input.model !== undefined) body.model = input.model
  if (input.temperature !== undefined) body.temperature = input.temperature
  if (input.maxTurns !== undefined) body.max_turns = input.maxTurns
  if (input.tools !== undefined) body.tools = input.tools
  if (input.isActive !== undefined) body.is_active = input.isActive

  const res = await env.CHAT_WORKER.fetch(`https://group-chat-worker/bots/${input.botId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to update bot')

  const bot = data.bot
  return {
    success: true,
    botId: input.botId,
    bot,
    message: `Updated bot "${bot.name}" (@${bot.username})`,
  }
}

async function executeGetGroupMembers(input, env) {
  if (!input.groupId && !input.groupName) throw new Error('groupId or groupName is required')

  let groupId = input.groupId
  if (!groupId && input.groupName) {
    groupId = await resolveGroupIdByName(input.groupName, input.userId, env)
  }

  const auth = await chatAuth(input.userId, env)

  // Fetch members and bots in parallel from CHAT_WORKER
  const [membersRes, botsRes] = await Promise.all([
    env.CHAT_WORKER.fetch(`https://group-chat-worker/groups/${groupId}/members?${auth.qs}`),
    env.CHAT_WORKER.fetch(`https://group-chat-worker/groups/${groupId}/bots?${auth.qs}`),
  ])

  const membersData = await membersRes.json()
  if (!membersRes.ok) throw new Error(membersData.error || 'Failed to get group members')

  const members = membersData.members || []

  // Build bot lookup map
  const botMap = {}
  if (botsRes.ok) {
    const botsData = await botsRes.json()
    for (const b of (botsData.bots || [])) {
      botMap[b.id] = b
      botMap[`bot:${b.id}`] = b
    }
  }

  // Enrich members: bot names + human profile lookup
  for (const m of members) {
    const bot = botMap[m.user_id] || botMap[m.bot_id]
    if (bot) {
      m.bot_name = bot.name
      m.bot_username = bot.username
      m.bot_model = bot.model
      m.bot_graph_id = bot.graph_id
      m.is_bot = true
    }
    // Try to resolve human member names from config
    if (!bot && m.user_id && !m.email) {
      try {
        const profile = await resolveUserProfile(m.user_id, env)
        if (profile) {
          m.email = profile.email
          m.phone = profile.phone
        }
      } catch { /* skip */ }
    }
  }

  const humans = members.filter(m => !m.is_bot)
  const bots = members.filter(m => m.is_bot)
  const memberList = humans.map(m => `${m.email || m.phone || m.user_id} (${m.role})`).join(', ')
  const botList = bots.map(m => m.bot_name ? `${m.bot_name} (@${m.bot_username})` : (m.user_id || m.bot_id)).join(', ')

  return {
    groupId,
    members,
    count: members.length,
    humanCount: humans.length,
    botCount: bots.length,
    message: `${members.length} members (${humans.length} humans, ${bots.length} bots). Humans: ${memberList || 'none'}. Bots: ${botList || 'none'}`,
  }
}

async function executeTriggerBotResponse(input, env) {
  if (!input.groupId) throw new Error('groupId is required')
  const messageCount = Math.min(input.messageCount || 20, 50)

  // Resolve caller for auth on group-chat-worker endpoints
  const callerProfile = await resolveUserProfile(input.userId, env)
  if (!callerProfile) throw new Error('Could not resolve your user profile')
  if (!callerProfile.phone) throw new Error('Your profile has no phone number')
  const authQS = `user_id=${encodeURIComponent(callerProfile.user_id || input.userId)}&phone=${encodeURIComponent(callerProfile.phone)}&email=${encodeURIComponent(callerProfile.email || '')}`

  // 1. Get bots in the group via group-chat-worker
  const botsRes = await env.CHAT_WORKER.fetch(
    `https://group-chat-worker/groups/${input.groupId}/bots?${authQS}`
  )
  const botsData = await botsRes.json()
  if (!botsRes.ok) throw new Error(botsData.error || 'Failed to get group bots')
  if (!botsData.bots || botsData.bots.length === 0) throw new Error('No bots in this group')

  let bots = botsData.bots
  if (input.botId) {
    bots = bots.filter(b => b.id === input.botId)
    if (bots.length === 0) throw new Error(`Bot ${input.botId} not found in group`)
  }

  // 2. Get recent messages from the group
  const msgRes = await env.CHAT_WORKER.fetch(
    `https://group-chat-worker/groups/${input.groupId}/messages?${authQS}&limit=${messageCount}`
  )
  const msgData = await msgRes.json()
  if (!msgRes.ok) throw new Error(msgData.error || 'Failed to get messages')
  const recentMessages = (msgData.messages || []).reverse() // oldest first

  // 3. Get group name from groups list
  const groupsRes = await env.CHAT_WORKER.fetch(
    `https://group-chat-worker/groups?${authQS}`
  )
  const groupsData = await groupsRes.json()
  const matchingGroup = (groupsData.groups || []).find(g => g.id === input.groupId)
  const groupName = matchingGroup?.name || input.groupId

  // 4. For each bot, run the chatbot subagent
  const results = []
  for (const bot of bots) {
    try {
      const subagentResult = await runChatbotSubagent({
        bot: {
          id: bot.id,
          name: bot.name,
          username: bot.username,
          system_prompt: bot.system_prompt,
          graph_id: bot.graph_id,
          tools: bot.tools,
          model: bot.model,
          max_turns: bot.max_turns,
          temperature: bot.temperature,
        },
        groupId: input.groupId,
        groupName,
        triggerMessage: null,
        recentMessages,
      }, env, executeTool)

      if (subagentResult.success && subagentResult.response) {
        // Post the response to the group via bot-message endpoint
        const postRes = await env.CHAT_WORKER.fetch('https://group-chat-worker/bot-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bot_id: bot.id,
            group_id: input.groupId,
            body: subagentResult.response,
          })
        })
        const postData = await postRes.json()

        results.push({
          botName: bot.name,
          username: bot.username,
          response: subagentResult.response,
          turns: subagentResult.turns,
          messageId: postData.message_id,
          success: true,
        })
      } else {
        results.push({ botName: bot.name, error: subagentResult.error || 'No response', success: false })
      }
    } catch (err) {
      results.push({ botName: bot.name, error: err.message, success: false })
    }
  }

  return {
    groupId: input.groupId,
    groupName,
    messagesAnalyzed: recentMessages.length,
    botResponses: results,
    message: results.map(r => r.success
      ? `@${r.username}: "${r.response.substring(0, 100)}..." (${r.turns} turns)`
      : `@${r.botName}: ERROR — ${r.error}`
    ).join('\n'),
  }
}

// ── Chat group management (new tools) ─────────────────────────────

async function executeDeleteChatGroup(input, env) {
  if (!input.groupId && !input.groupName) throw new Error('groupId or groupName is required')

  // Resolve groupId from groupName if needed
  let groupId = input.groupId
  if (!groupId && input.groupName) {
    groupId = await resolveGroupIdByName(input.groupName, input.userId, env)
  }

  const callerProfile = await resolveUserProfile(input.userId, env)
  if (!callerProfile) throw new Error('Could not resolve your user profile')
  if (!callerProfile.phone) throw new Error('Your profile has no phone number')

  const res = await env.CHAT_WORKER.fetch(`https://group-chat-worker/groups/${groupId}/archive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: callerProfile.user_id || input.userId,
      phone: callerProfile.phone,
      email: callerProfile.email || '',
    })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to archive group')

  return {
    success: true,
    groupId,
    message: `Archived group ${groupId}. Use restore_chat_group to undo.`,
  }
}

async function executeRestoreChatGroup(input, env) {
  if (!input.groupId) throw new Error('groupId is required')

  const callerProfile = await resolveUserProfile(input.userId, env)
  if (!callerProfile) throw new Error('Could not resolve your user profile')
  if (!callerProfile.phone) throw new Error('Your profile has no phone number')

  const res = await env.CHAT_WORKER.fetch(`https://group-chat-worker/groups/${input.groupId}/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: callerProfile.user_id || input.userId,
      phone: callerProfile.phone,
      email: callerProfile.email || '',
    })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to restore group')

  return {
    success: true,
    groupId: input.groupId,
    message: `Restored group ${input.groupId}`,
  }
}

async function executeUpdateChatGroup(input, env) {
  if (!input.groupId && !input.groupName) throw new Error('groupId or groupName is required')
  if (!input.name && input.imageUrl === undefined) throw new Error('At least one of name or imageUrl must be provided')

  let groupId = input.groupId
  if (!groupId && input.groupName) {
    groupId = await resolveGroupIdByName(input.groupName, input.userId, env)
  }

  const callerProfile = await resolveUserProfile(input.userId, env)
  if (!callerProfile) throw new Error('Could not resolve your user profile')
  if (!callerProfile.phone) throw new Error('Your profile has no phone number')

  const body = {
    user_id: callerProfile.user_id || input.userId,
    phone: callerProfile.phone,
    email: callerProfile.email || '',
  }
  if (input.name) body.name = input.name
  if (input.imageUrl !== undefined) body.image_url = input.imageUrl

  const res = await env.CHAT_WORKER.fetch(`https://group-chat-worker/groups/${groupId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to update group')

  return {
    success: true,
    groupId,
    name: data.name,
    imageUrl: data.image_url,
    message: `Updated group "${data.name || groupId}"`,
  }
}

async function executeRemoveChatBot(input, env) {
  if (!input.botId) throw new Error('botId is required')

  const callerProfile = await resolveUserProfile(input.userId, env)
  if (!callerProfile) throw new Error('Could not resolve your user profile')
  if (!callerProfile.phone) throw new Error('Your profile has no phone number')
  const authQS = `user_id=${encodeURIComponent(callerProfile.user_id || input.userId)}&phone=${encodeURIComponent(callerProfile.phone)}&email=${encodeURIComponent(callerProfile.email || '')}`

  if (input.groupId) {
    // Remove bot from specific group
    const res = await env.CHAT_WORKER.fetch(
      `https://group-chat-worker/groups/${input.groupId}/bots/${input.botId}?${authQS}`,
      { method: 'DELETE' }
    )
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to remove bot from group')

    return {
      success: true,
      botId: input.botId,
      groupId: input.groupId,
      message: `Removed bot ${input.botId} from group ${input.groupId}`,
    }
  } else {
    // Deactivate bot entirely
    const res = await env.CHAT_WORKER.fetch(
      `https://group-chat-worker/bots/${input.botId}?${authQS}`,
      { method: 'DELETE' }
    )
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to deactivate bot')

    return {
      success: true,
      botId: input.botId,
      message: `Deactivated bot ${input.botId}`,
    }
  }
}

async function executeCreatePoll(input, env) {
  if (!input.question) throw new Error('question is required')
  if (!input.options || !Array.isArray(input.options) || input.options.length < 2) {
    throw new Error('options must be an array with at least 2 choices')
  }
  if (!input.groupId && !input.groupName) throw new Error('groupId or groupName is required')

  let groupId = input.groupId
  if (!groupId && input.groupName) {
    groupId = await resolveGroupIdByName(input.groupName, input.userId, env)
  }

  const callerProfile = await resolveUserProfile(input.userId, env)
  if (!callerProfile) throw new Error('Could not resolve your user profile')
  if (!callerProfile.phone) throw new Error('Your profile has no phone number')

  const res = await env.CHAT_WORKER.fetch(`https://group-chat-worker/groups/${groupId}/polls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: callerProfile.user_id || input.userId,
      phone: callerProfile.phone,
      email: callerProfile.email || '',
      question: input.question,
      options: input.options,
    })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to create poll')

  return {
    success: true,
    pollId: data.id || data.poll_id,
    groupId,
    question: input.question,
    options: input.options,
    message: `Created poll "${input.question}" with ${input.options.length} options in group ${groupId}`,
  }
}

async function executeClosePoll(input, env) {
  if (!input.pollId) throw new Error('pollId is required')

  const callerProfile = await resolveUserProfile(input.userId, env)
  if (!callerProfile) throw new Error('Could not resolve your user profile')
  if (!callerProfile.phone) throw new Error('Your profile has no phone number')

  const res = await env.CHAT_WORKER.fetch(`https://group-chat-worker/polls/${input.pollId}/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: callerProfile.user_id || input.userId,
      phone: callerProfile.phone,
      email: callerProfile.email || '',
    })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to close poll')

  return {
    success: true,
    pollId: input.pollId,
    message: `Closed poll ${input.pollId} — no more votes accepted`,
  }
}

async function executeGetPollResults(input, env) {
  if (!input.pollId) throw new Error('pollId is required')

  const callerProfile = await resolveUserProfile(input.userId, env)
  if (!callerProfile) throw new Error('Could not resolve your user profile')
  if (!callerProfile.phone) throw new Error('Your profile has no phone number')
  const authQS = `user_id=${encodeURIComponent(callerProfile.user_id || input.userId)}&phone=${encodeURIComponent(callerProfile.phone)}&email=${encodeURIComponent(callerProfile.email || '')}`

  const res = await env.CHAT_WORKER.fetch(
    `https://group-chat-worker/polls/${input.pollId}?${authQS}`
  )
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to get poll results')

  return {
    pollId: input.pollId,
    question: data.question,
    options: data.options,
    closed: !!data.closed_at,
    createdBy: data.created_by,
    message: `Poll "${data.question}" — ${data.options?.length || 0} options${data.closed_at ? ' (closed)' : ' (open)'}`,
  }
}

// Helper: resolve groupName → groupId via CHAT_WORKER
async function resolveGroupIdByName(groupName, userId, env) {
  const auth = await chatAuth(userId, env)
  const res = await env.CHAT_WORKER.fetch(`https://group-chat-worker/groups?${auth.qs}`)
  const data = await res.json()
  if (!res.ok) throw new Error('Failed to list groups for name resolution')
  const match = (data.groups || []).find(
    g => g.name && g.name.toLowerCase() === groupName.toLowerCase()
  )
  if (!match) throw new Error(`No group found with name "${groupName}"`)
  return match.id
}

// ── System Registry (Dynamic — reads config from graph_system_registry KG) ──

// Fetch the registry graph and extract nodes by type
async function fetchRegistryGraph(env) {
  try {
    const kgFetcher = env.KG_WORKER
    if (!kgFetcher) return { nodes: [], edges: [] }
    const res = await kgFetcher.fetch('https://knowledge-graph-worker/getknowgraph?id=graph_system_registry')
    if (!res.ok) return { nodes: [], edges: [] }
    return await res.json()
  } catch {
    return { nodes: [], edges: [] }
  }
}

function registryNodesByType(graph, type) {
  return (graph.nodes || []).filter(n => n.type === type)
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

async function fetchWorkerHealth(fetcher, baseUrl) {
  try {
    let res = await fetcher.fetch(`${baseUrl}/health`)
    if (!res.ok) res = await fetcher.fetch(`${baseUrl}/api/health`)
    if (!res.ok) return { status: 'unreachable' }
    const data = await res.json()
    // Normalize varying health response formats
    if (data.status === 'healthy' || data.status === 'ok' || data.ok === true || data.endpoints) {
      return { ...data, status: 'healthy' }
    }
    return { ...data, status: data.status || 'healthy' }
  } catch {
    return { status: 'unreachable' }
  }
}

async function executeGetSystemRegistry(input, env) {
  const filter = input.filter || 'all'
  const includeEndpoints = input.include_endpoints !== false

  // Helper: only run a section if filter is 'all' or matches the section name
  const need = (section) => filter === 'all' || filter === section

  // ── 0. Read config from graph_system_registry (single source of truth) ──
  const registry = await fetchRegistryGraph(env)
  const regWorkers     = registryNodesByType(registry, 'system-worker')
  const regSubagents   = registryNodesByType(registry, 'system-subagent')
  const regNodeTypes   = registryNodesByType(registry, 'system-nodetype')
  const regTemplates   = registryNodesByType(registry, 'system-template')
  const regDatabases   = registryNodesByType(registry, 'system-database')
  const regApps        = registryNodesByType(registry, 'system-app')
  const regCredentials = registryNodesByType(registry, 'system-credential')

  // ── 1. Workers: health + OpenAPI from graph-defined bindings ──
  let workers = []
  if (need('workers')) {
    const workerPromises = regWorkers.map(async (node) => {
      const meta = node.metadata || {}
      const binding = meta.binding
      if (!binding || binding === 'self') return { id: node.id, label: node.label, binding, name: meta.name || node.label, domain: meta.domain || meta.url || null, status: 'self', endpointCount: 0 }
      const fetcher = env[binding]
      if (!fetcher) return { id: node.id, label: node.label, binding, name: meta.name || node.label, domain: meta.domain || null, status: 'no-binding', endpointCount: 0 }

      const workerName = meta.name || node.label
      const baseUrl = `https://${workerName}`
      const [health, spec] = await Promise.all([
        fetchWorkerHealth(fetcher, baseUrl),
        fetchWorkerSpec(fetcher, baseUrl),
      ])

      const endpoints = []
      if (spec?.paths) {
        for (const [path, methods] of Object.entries(spec.paths)) {
          for (const [method, detail] of Object.entries(methods)) {
            endpoints.push({ method: method.toUpperCase(), path, summary: detail.summary || detail.description || '' })
          }
        }
      }

      return {
        id: node.id, label: node.label, binding, name: workerName,
        domain: meta.domain || null,
        status: health.status || 'unknown',
        apiTitle: spec?.info?.title || null,
        apiVersion: spec?.info?.version || null,
        endpointCount: endpoints.length,
        endpoints: includeEndpoints ? endpoints : undefined,
      }
    })
    workers = await Promise.all(workerPromises)
  }

  // ── 2. Tools from code (still introspected — tool defs are in JS) ──
  const tools = TOOL_DEFINITIONS.map(t => ({ name: t.name, description: t.description }))

  // ── 3. Subagents from graph ──
  const subagents = regSubagents.map(n => ({
    name: n.label, delegationTool: n.metadata?.delegationTool, model: n.metadata?.model,
    tools: n.metadata?.tools || [], file: n.metadata?.file,
  }))

  // ── 4. Node types from graph ──
  const nodeTypes = regNodeTypes.map(n => n.label)

  // ── 5. Databases from graph ──
  const dbNodes = regDatabases.map(n => ({
    binding: n.metadata?.binding, name: n.metadata?.name || n.label, purpose: n.info,
  }))

  // ── 6. D1 Database Schemas (live introspection using graph-defined DBs) ──
  let schemas = undefined
  if (need('schemas')) {
    schemas = await Promise.all(dbNodes.map(async (db) => {
      const d1 = env[db.binding]
      if (!d1) return { ...db, tables: [], tableCount: 0, error: 'no-binding' }
      try {
        const tablesRes = await d1.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all()
        const tableNames = tablesRes.results.map(r => r.name)
        const tables = await Promise.all(tableNames.map(async (tbl) => {
          try {
            const colsRes = await d1.prepare(`PRAGMA table_info(${tbl})`).all()
            const countRes = await d1.prepare(`SELECT COUNT(*) as cnt FROM "${tbl}"`).first()
            return {
              name: tbl,
              columns: colsRes.results.map(c => ({ name: c.name, type: c.type, pk: c.pk === 1, notNull: c.notnull === 1 })),
              rowCount: countRes?.cnt || 0,
            }
          } catch {
            return { name: tbl, columns: [], rowCount: 0, error: 'introspection-failed' }
          }
        }))
        return { binding: db.binding, name: db.name, purpose: db.purpose, tableCount: tables.length, tables }
      } catch (e) {
        return { ...db, tables: [], tableCount: 0, error: e.message }
      }
    }))
  }

  // ── 7. User-Created Agents (from agent_configs D1 table) ──
  let userAgents = undefined
  if (need('agents')) {
    try {
      const agentsRes = await env.DB.prepare(
        'SELECT id, created_by, name, description, model, tools, is_active, created_at FROM agent_configs WHERE is_active = 1 ORDER BY created_at DESC'
      ).all()
      userAgents = agentsRes.results.map(a => {
        let toolCount = 0
        try { toolCount = JSON.parse(a.tools || '[]').length } catch {}
        return { id: a.id, name: a.name, description: a.description, model: a.model, toolCount, createdBy: a.created_by, createdAt: a.created_at }
      })
    } catch (e) {
      console.error('[get_system_registry] agent_configs query failed:', e?.message || e)
      userAgents = []
    }
  }

  // ── 8. Knowledge Graph Inventory (via KG_WORKER) ──
  let knowledgeGraphs = undefined
  if (need('graphs')) {
    try {
      const kgFetcher = env.KG_WORKER
      if (kgFetcher) {
        const res = await kgFetcher.fetch('https://knowledge-graph-worker/getknowgraphsummaries?offset=0&limit=500', { headers: { 'x-user-role': 'Superadmin' } })
        if (res.ok) {
          const data = await res.json()
          const graphs = data.graphs || data || []
          const byMetaArea = {}
          const recentlyUpdated = []
          for (const g of graphs) {
            const area = g.metaArea || g.metadata?.metaArea || 'uncategorized'
            byMetaArea[area] = (byMetaArea[area] || 0) + 1
            recentlyUpdated.push({
              id: g.id, title: g.title || g.metadata?.title || g.id, metaArea: area,
              nodeCount: g.nodeCount || g.nodes?.length || 0,
              updatedAt: g.updatedAt || g.metadata?.updatedAt || null,
            })
          }
          recentlyUpdated.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
          knowledgeGraphs = { total: graphs.length, byMetaArea, recentlyUpdated: recentlyUpdated.slice(0, 10) }
        }
      }
    } catch {
      knowledgeGraphs = { total: 0, byMetaArea: {}, recentlyUpdated: [], error: 'fetch-failed' }
    }
  }

  // ── 9. Templates (dynamic from KG_WORKER + graph-defined templates) ──
  let templates = undefined
  if (need('templates')) {
    try {
      const kgFetcher = env.KG_WORKER
      const [graphTplRes, aiTplRes, toolTplRes] = kgFetcher ? await Promise.all([
        kgFetcher.fetch('https://knowledge-graph-worker/getTemplates').then(r => r.ok ? r.json() : []).catch(() => []),
        kgFetcher.fetch('https://knowledge-graph-worker/getAITemplates').then(r => r.ok ? r.json() : []).catch(() => []),
        kgFetcher.fetch('https://knowledge-graph-worker/getToolTemplates').then(r => r.ok ? r.json() : []).catch(() => []),
      ]) : [[], [], []]
      const graphTemplates = Array.isArray(graphTplRes) ? graphTplRes : graphTplRes.templates || []
      const aiTemplates = Array.isArray(aiTplRes) ? aiTplRes : aiTplRes.templates || []
      const toolTemplates = Array.isArray(toolTplRes) ? toolTplRes : toolTplRes.templates || []
      // HTML templates from code
      let htmlTemplates = []
      try { htmlTemplates = listTemplates() } catch {}
      // Also include any templates registered in the graph
      const graphRegTemplates = regTemplates.map(t => ({ id: t.id, name: t.label, description: t.info || '' }))
      templates = {
        graph: graphTemplates.map(t => ({ id: t.id, name: t.name || t.title, description: t.description || '' })),
        ai: aiTemplates.map(t => ({ id: t.id, name: t.name || t.title, description: t.description || '' })),
        tool: toolTemplates.map(t => ({ id: t.id, name: t.name || t.title, description: t.description || '' })),
        html: htmlTemplates.map(t => ({ id: t.id || t.name, name: t.name || t.label, description: t.description || '' })),
        registered: graphRegTemplates,
        total: graphTemplates.length + aiTemplates.length + toolTemplates.length + htmlTemplates.length + graphRegTemplates.length,
      }
    } catch {
      templates = { graph: [], ai: [], tool: [], html: [], registered: [], total: 0, error: 'fetch-failed' }
    }
  }

  // ── 10. Vegvisr Ecosystem Apps (READ-ONLY — these are the platform apps, NOT modifiable by the agent) ──
  let ecosystemApps = undefined
  if (need('apps')) {
    try {
      const kgFetcher = env.KG_WORKER
      if (kgFetcher) {
        const ecoRes = await kgFetcher.fetch('https://knowledge-graph-worker/getknowgraph?id=graph_vegvisr_ecosystem_apps')
        if (ecoRes.ok) {
          const ecoData = await ecoRes.json()
          const appNodes = (ecoData.nodes || []).filter(n => n.id.startsWith('app-'))
          ecosystemApps = {
            _note: 'READ-ONLY reference. These are platform apps built in React/Vue/Flutter/Node. The agent cannot modify them.',
            apps: appNodes.map(n => ({
              id: n.id,
              name: n.label?.replace(/^#\s*/, ''),
              description: (n.info || '').split('\n').find(l => l.startsWith('- **Description**'))?.replace('- **Description**: ', '') || '',
              domain: (n.info || '').split('\n').find(l => l.startsWith('- **Domain**'))?.replace('- **Domain**: ', '') || null,
              stack: (n.info || '').split('\n').find(l => l.startsWith('- **Stack**'))?.replace('- **Stack**: ', '') || null,
              deploy: (n.info || '').split('\n').find(l => l.startsWith('- **Deploy**'))?.replace('- **Deploy**: ', '') || null,
              repo: (n.info || '').split('\n').find(l => l.startsWith('- **Repo**'))?.replace('- **Repo**: ', '') || null,
            })),
            source: 'graph_vegvisr_ecosystem_apps',
          }
        }
      }
    } catch {
      ecosystemApps = { _note: 'READ-ONLY. Failed to load graph_vegvisr_ecosystem_apps.', apps: [] }
    }
  }

  // ── 11. Credentials Check (from graph + env inspection) ──
  let credentials = undefined
  if (need('credentials')) {
    credentials = regCredentials.map(n => ({
      name: n.label, envName: n.metadata?.envName || n.label,
      configured: !!(n.metadata?.envName && env[n.metadata.envName]),
      usedBy: n.metadata?.usedBy,
    }))
  }

  // ── 12. Storage Inventory (query workers that have storage) ──
  let storage = undefined
  if (need('storage')) {
    // Use workers that have storage — identified by having a binding we can query
    const storageWorkers = regWorkers.filter(n => {
      const b = n.metadata?.binding
      return b && b !== 'self' && env[b]
    })
    storage = await Promise.all(storageWorkers.map(async (node) => {
      const binding = node.metadata.binding
      const workerName = node.metadata.name || node.label
      const fetcher = env[binding]
      try {
        const res = await fetcher.fetch(`https://${workerName}/storage-stats`)
        if (res.ok) {
          const stats = await res.json()
          return { binding, name: workerName, stats }
        }
        return null // no storage-stats endpoint = no storage to report
      } catch {
        return null
      }
    }))
    storage = storage.filter(Boolean) // only include workers that responded
  }

  // ── Build sections + discover available filters dynamically ──
  const sections = {
    workers:         need('workers') ? workers : undefined,
    subagents:       need('subagents') ? subagents : undefined,
    tools:           need('tools') ? { count: tools.length, list: tools } : undefined,
    nodeTypes:       need('nodeTypes') ? nodeTypes : undefined,
    databases:       need('databases') ? dbNodes : undefined,
    schemas:         schemas,
    userAgents:      userAgents,
    knowledgeGraphs: knowledgeGraphs,
    templates:       templates,
    apps:            ecosystemApps,
    credentials:     credentials,
    storage:         storage,
  }

  // Filter aliases: what the agent passes → key in sections
  // Built dynamically from what sections exist
  const filterAliases = {}
  for (const key of Object.keys(sections)) {
    filterAliases[key] = key // direct name works
  }
  // Friendlier aliases
  filterAliases.agents = 'userAgents'
  filterAliases.graphs = 'knowledgeGraphs'
  const availableFilters = ['all', ...Object.keys(filterAliases)]

  const totalEndpoints = workers.reduce((sum, w) => sum + (w.endpointCount || 0), 0)
  const healthyCount = workers.filter(w => w.status === 'healthy').length
  const totalTables = schemas ? schemas.reduce((sum, db) => sum + (db.tableCount || 0), 0) : 0

  const summary = {
    workers: workers.length || regWorkers.length,
    workersHealthy: healthyCount,
    totalEndpoints,
    subagents: subagents.length,
    tools: tools.length,
    nodeTypes: nodeTypes.length,
    databases: dbNodes.length,
    totalTables,
    userAgents: userAgents?.length || 0,
    knowledgeGraphs: knowledgeGraphs?.total || 0,
    templates: templates?.total || 0,
    ecosystemApps: ecosystemApps?.apps?.length || regApps.length,
    credentialsConfigured: credentials ? credentials.filter(c => c.configured).length : 0,
    credentialsTotal: credentials?.length || regCredentials.length,
    registrySource: 'graph_system_registry',
  }

  const message = `System has ${summary.workers} workers (${healthyCount} healthy, ${totalEndpoints} total API endpoints), ${subagents.length} subagents, ${summary.userAgents} user agents, ${tools.length} agent tools, ${nodeTypes.length} node types, ${dbNodes.length} databases (${totalTables} tables), ${summary.knowledgeGraphs} knowledge graphs, ${summary.templates} templates, ${summary.ecosystemApps} ecosystem apps (read-only), ${summary.credentialsConfigured}/${summary.credentialsTotal} API keys configured. Config source: graph_system_registry. All data is live.`

  // Apply filter
  if (filter !== 'all') {
    const key = filterAliases[filter]
    if (key && sections[key] !== undefined) {
      return { [key]: sections[key], availableFilters, summary, message }
    }
    return { error: `Unknown filter "${filter}"`, availableFilters, summary, message }
  }

  return { ...sections, availableFilters, summary, message }
}

// ── Worker Management (Cloudflare API) ───────────────────────────

// CF_ACCOUNT_ID comes from env — hardcoded value is last-resort fallback only
function getCfApiBase(env) {
  const accountId = env?.CF_ACCOUNT_ID || '5d9b2060ef095c777711a8649c24914e'
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers`
}

function getVerifiedWorkerAdmin(toolInput) {
  const authContext = toolInput?.authContext
  if (!authContext?.authenticated) {
    throw new Error('Worker management requires a verified logged-in session. Sign in again and retry.')
  }

  const role = String(authContext.role || authContext.profile?.role || authContext.session?.role || '').trim().toLowerCase()
  if (role !== 'superadmin') {
    throw new Error('Worker management requires Superadmin role.')
  }

  return {
    userId: authContext.userId || toolInput?.userId || null,
    email: authContext.email || authContext.profile?.email || authContext.session?.email || null,
    role: authContext.role || authContext.profile?.role || authContext.session?.role || null,
  }
}

async function executeDeployWorker(input, env) {
  const caller = getVerifiedWorkerAdmin(input)
  const token = env.CLOUDFLARE_API_TOKEN
  if (!token) return { error: 'CLOUDFLARE_API_TOKEN not configured. Add it as a secret: wrangler secret put CLOUDFLARE_API_TOKEN' }

  const { workerName, code } = input
  if (!workerName || !code) return { error: 'workerName and code are required' }

  const CF_API_BASE = getCfApiBase(env)
  const enableSubdomain = input.enableSubdomain !== false
  const compatDate = input.compatibilityDate || '2024-11-01'
  const registerInGraph = input.registerInGraph !== false

  // Step 1: Deploy the worker code via multipart form.
  // A1: bind D1 (DB → vegvisr_org) + the internal shared secret so an agent-deployed admin worker
  // can role-check the caller and mutate config. deploy_worker reads its OWN env.INTERNAL_SHARED_SECRET
  // (no value needed from the user) and stamps it as a secret_text binding. Opt out with bindAdmin:false.
  const bindings = []
  if (input.bindAdmin !== false) {
    bindings.push({ type: 'd1', name: 'DB', id: '507d1efd-1dda-45ef-971f-52d2c8e8afe8' })
    if (env.INTERNAL_SHARED_SECRET) {
      bindings.push({ type: 'secret_text', name: 'INTERNAL_SHARED_SECRET', text: env.INTERNAL_SHARED_SECRET })
    }
  }
  const metadata = JSON.stringify({
    main_module: 'index.js',
    compatibility_date: compatDate,
    ...(bindings.length ? { bindings } : {}),
  })
  const formData = new FormData()
  formData.append('metadata', new Blob([metadata], { type: 'application/json' }))
  formData.append('index.js', new Blob([code], { type: 'application/javascript+module' }), 'index.js')

  const { data: deployData } = await fetchJsonWithTimeout(`${CF_API_BASE}/scripts/${workerName}`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData,
  })
  if (!deployData.success) {
    return { error: 'Deploy failed', details: deployData.errors }
  }

  // Step 2: Enable workers.dev subdomain
  let subdomainResult = null
  if (enableSubdomain) {
    const { data: subData } = await fetchJsonWithTimeout(`${CF_API_BASE}/scripts/${workerName}/subdomain`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    })
    subdomainResult = subData
  }

  // Step 3: Register in graph_system_registry (non-blocking)
  let graphResult = null
  if (registerInGraph && env.KG_WORKER) {
    const nodePayload = {
      graphId: 'graph_system_registry',
      node: {
        id: `worker-${workerName}`,
        label: workerName,
        type: 'system-worker',
        color: '#f59e0b',
        info: input.description || `Deployed via Cloudflare API. Last deployed: ${new Date().toISOString()}`,
        metadata: {
          binding: input.binding || null,
          name: workerName,
          domain: input.domain || `${workerName}.torarnehave.workers.dev`,
          endpoints: Array.isArray(input.endpoints) ? input.endpoints : [],
          deployedVia: 'cloudflare-api',
          deployedAt: new Date().toISOString(),
          deployedBy: caller.email || caller.userId || 'unknown',
        },
      },
    }
    env.KG_WORKER.fetch('https://knowledge-graph-worker/addNode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nodePayload),
    }).then(res => res.json()).then(data => { graphResult = data }).catch(e => { graphResult = { error: e.message } })
    graphResult = { pending: true }
  }

  return {
    success: true,
    workerName,
    url: `https://${workerName}.torarnehave.workers.dev`,
    deploymentId: deployData.result?.deployment_id,
    deployedFrom: deployData.result?.last_deployed_from,
    modifiedOn: deployData.result?.modified_on,
    subdomainEnabled: subdomainResult?.success || false,
    registeredInGraph: graphResult?.ok || false,
    deployedBy: caller.email || caller.userId || null,
    message: `Worker "${workerName}" deployed successfully. Live at https://${workerName}.torarnehave.workers.dev`,
  }
}

async function executeRegisterDeployedWorker(input, env) {
  const caller = getVerifiedWorkerAdmin(input)
  const { workerName } = input
  if (!workerName) return { error: 'workerName is required' }

  if (!env.KG_WORKER) return { error: 'KG_WORKER binding not available' }

  const node = {
    id: `worker-${workerName}`,
    label: workerName,
    type: 'system-worker',
    color: '#f59e0b',
    info: input.description || `Worker registered manually. Updated: ${new Date().toISOString()}`,
    metadata: {
      binding: input.binding || null,
      name: workerName,
      domain: input.domain || `${workerName}.torarnehave.workers.dev`,
      endpoints: input.endpoints || [],
      deployedVia: 'manual-registration',
      deployedAt: new Date().toISOString(),
      deployedBy: caller.email || caller.userId || 'unknown',
    },
  }

  try {
    const { data: result } = await fetchJsonWithTimeout('https://knowledge-graph-worker/addNode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphId: 'graph_system_registry', node }),
    }, NETWORK_TIMEOUT_MS, env.KG_WORKER.fetch.bind(env.KG_WORKER))

    return {
      success: result?.ok || false,
      workerName,
      nodeId: `worker-${workerName}`,
      domain: node.metadata.domain,
      registeredBy: caller.email || caller.userId || null,
      message: result?.ok
        ? `Worker "${workerName}" registered in system registry.`
        : `Registration may have failed: ${JSON.stringify(result)}`,
    }
  } catch (e) {
    return {
      success: false,
      workerName,
      nodeId: `worker-${workerName}`,
      error: e.message,
      registeredBy: caller.email || caller.userId || null,
    }
  }
}

/**
 * Register or update a worker as a first-class capability provider for the
 * Agent Builder. After this runs, the worker's OpenAPI operations are
 * auto-discovered on the next /tools fetch (Phase 1's registry-walking
 * loadOpenAPITools picks them up).
 *
 * Upsert semantics: keyed by `binding`. If a system-worker node with the same
 * binding already exists, its metadata is merged in place. Otherwise a new
 * node is added. We always clear the in-isolate OpenAPI cache so the next
 * /tools fetch sees the registered worker immediately.
 */
async function executeRegisterCapabilityWorker(input, env) {
  if (!env.KG_WORKER) throw new Error('KG_WORKER binding not available')

  const binding = typeof input?.binding === 'string' && input.binding.trim() ? input.binding.trim() : ''
  const name = typeof input?.name === 'string' && input.name.trim() ? input.name.trim() : ''
  const openapi_url = typeof input?.openapi_url === 'string' && input.openapi_url.trim() ? input.openapi_url.trim() : ''
  if (!binding) throw new Error('binding is required')
  if (!name) throw new Error('name is required')
  if (!openapi_url) throw new Error('openapi_url is required')

  const label = typeof input?.label === 'string' && input.label.trim() ? input.label.trim() : binding
  const domain = typeof input?.domain === 'string' ? input.domain.trim() : ''
  const description = typeof input?.description === 'string' ? input.description.trim() : ''
  const tool_prefix = typeof input?.tool_prefix === 'string' ? input.tool_prefix : ''
  const auth = ['service-binding-superadmin', 'x-api-token', 'none'].includes(input?.auth)
    ? input.auth
    : 'service-binding-superadmin'
  const tool_blocklist = Array.isArray(input?.tool_blocklist)
    ? input.tool_blocklist.filter(t => typeof t === 'string')
    : []

  // 1. Probe the OpenAPI spec so we can refuse to register an unreachable one
  //    and tell the caller how many operations they'll get.
  let probedOpCount = null
  let probedTitle = null
  const fetcher = env[binding]
  if (fetcher) {
    let probeUrl
    if (/^https?:\/\//i.test(openapi_url)) {
      probeUrl = openapi_url
    } else {
      const path = openapi_url.startsWith('/') ? openapi_url : `/${openapi_url}`
      probeUrl = `https://${name}${path}`
    }
    try {
      const res = await fetcher.fetch(probeUrl)
      if (res.ok) {
        const spec = await res.json().catch(() => null)
        if (spec && spec.paths) {
          probedTitle = spec?.info?.title || null
          probedOpCount = 0
          for (const methods of Object.values(spec.paths)) {
            for (const op of Object.values(methods)) {
              if (typeof op === 'object' && op?.operationId) probedOpCount++
            }
          }
        }
      }
    } catch {
      // probe failure is non-fatal — register anyway, the registry walk will retry on next load
    }
  }

  // 2. Read the current registry graph, find/replace the matching node by binding.
  const graphRes = await env.KG_WORKER.fetch('https://knowledge-graph-worker/getknowgraph?id=graph_system_registry')
  if (!graphRes.ok) {
    const t = await graphRes.text().catch(() => '')
    throw new Error(`Failed to read graph_system_registry (${graphRes.status}): ${t.slice(0, 200)}`)
  }
  const graph = await graphRes.json()
  const nodes = Array.isArray(graph.nodes) ? graph.nodes.slice() : []
  const edges = Array.isArray(graph.edges) ? graph.edges.slice() : []
  const metadata = graph.metadata || {}

  const existingIdx = nodes.findIndex(n =>
    n?.type === 'system-worker' && n?.metadata && n.metadata.binding === binding
  )

  const newMetadata = {
    // Preserve any fields already on the node, then overwrite with the new values.
    ...(existingIdx >= 0 ? (nodes[existingIdx].metadata || {}) : {}),
    binding,
    name,
    openapi_url,
    tool_prefix,
    auth,
    ...(tool_blocklist.length > 0 ? { tool_blocklist } : {}),
    ...(domain ? { domain } : {}),
    registeredVia: 'register_capability_worker',
    registeredAt: new Date().toISOString(),
  }

  const nodeId = existingIdx >= 0
    ? nodes[existingIdx].id
    : `worker-${name}`

  const node = {
    id: nodeId,
    label,
    type: 'system-worker',
    color: existingIdx >= 0 ? (nodes[existingIdx].color || '#38bdf8') : '#38bdf8',
    info: description || (existingIdx >= 0 ? nodes[existingIdx].info : '') || `Capability worker — ${name}`,
    metadata: newMetadata,
  }

  if (existingIdx >= 0) {
    nodes[existingIdx] = node
  } else {
    nodes.push(node)
  }

  const saveRes = await env.KG_WORKER.fetch('https://knowledge-graph-worker/saveGraphWithHistory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 'graph_system_registry',
      graphData: { nodes, edges, metadata },
      override: true,
    }),
  })
  if (!saveRes.ok) {
    const t = await saveRes.text().catch(() => '')
    throw new Error(`Failed to save graph_system_registry (${saveRes.status}): ${t.slice(0, 200)}`)
  }
  const saveData = await saveRes.json().catch(() => ({}))

  // 3. Invalidate the in-isolate OpenAPI cache so the next /tools fetch re-walks.
  clearOpenAPICache()

  return {
    message: existingIdx >= 0
      ? `Updated capability worker "${name}" (binding ${binding}) in graph_system_registry`
      : `Registered capability worker "${name}" (binding ${binding}) in graph_system_registry`,
    action: existingIdx >= 0 ? 'updated' : 'created',
    nodeId,
    binding,
    name,
    openapi_url,
    tool_prefix,
    auth,
    probedTitle,
    probedOpCount,
    probeReachable: probedOpCount !== null,
    serviceBindingPresent: !!fetcher,
    registryVersion: saveData?.newVersion ?? null,
    viewUrl: 'https://www.vegvisr.org/gnew-viewer?graphId=graph_system_registry',
    note: probedOpCount === null
      ? 'Spec was not reachable from the agent-worker isolate during probe. Registration saved anyway — the next /tools fetch will retry.'
      : `Spec probed: ${probedOpCount} operation(s) found in "${probedTitle || 'untitled'}". They will appear in /tools on the next fetch.`,
  }
}

async function executeReadWorker(input, env) {
  getVerifiedWorkerAdmin(input)
  const token = env.CLOUDFLARE_API_TOKEN
  if (!token) return { error: 'CLOUDFLARE_API_TOKEN not configured' }

  const CF_API_BASE = getCfApiBase(env)
  const { workerName } = input

  // CF `GET /scripts` returns a JSON envelope ({success, result:[...]}); each
  // entry carries the per-worker metadata we report. `GET /scripts/{name}`,
  // by contrast, returns the SCRIPT BODY itself (multipart/form-data for module
  // workers, whose boundary starts with `--`) — calling res.json() on it throws
  // "No number after minus sign in JSON at position 1". So resolve a single
  // worker by filtering the list, never by hitting /scripts/{name}.
  const res = await fetch(`${CF_API_BASE}/scripts`, {
    headers: { 'Authorization': `Bearer ${token}` },
  })
  const listText = await res.text()
  let data
  try {
    data = JSON.parse(listText)
  } catch {
    return { error: 'Cloudflare returned a non-JSON worker list', details: listText.slice(0, 300) }
  }
  if (!data.success) return { error: 'Failed to list workers', details: data.errors }

  if (workerName) {
    const r = (data.result || []).find(w => w.id === workerName)
    if (!r) return { error: `Worker "${workerName}" not found` }
    return {
      name: r.id,
      modifiedOn: r.modified_on,
      createdOn: r.created_on,
      lastDeployedFrom: r.last_deployed_from,
      hasModules: r.has_modules,
      compatibilityDate: r.compatibility_date,
    }
  }

  const workers = data.result.map(w => ({
    name: w.id,
    modifiedOn: w.modified_on,
    lastDeployedFrom: w.last_deployed_from,
  }))

  return { total: workers.length, workers }
}

async function executeDeleteWorker(input, env) {
  const caller = getVerifiedWorkerAdmin(input)
  const token = env.CLOUDFLARE_API_TOKEN
  if (!token) return { error: 'CLOUDFLARE_API_TOKEN not configured' }

  const CF_API_BASE = getCfApiBase(env)
  const { workerName } = input
  if (!workerName) return { error: 'workerName is required' }

  const removeFromGraph = input.removeFromGraph !== false

  // Delete the worker
  const res = await fetch(`${CF_API_BASE}/scripts/${workerName}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
  })
  const data = await res.json()
  if (!data.success) return { error: `Failed to delete "${workerName}"`, details: data.errors }

  // Remove from graph
  let graphResult = null
  if (removeFromGraph && env.KG_WORKER) {
    try {
      const gRes = await env.KG_WORKER.fetch('https://knowledge-graph-worker/removeNode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graphId: 'graph_system_registry', nodeId: `worker-${workerName}` }),
      })
      graphResult = await gRes.json()
    } catch (e) {
      graphResult = { error: e.message }
    }
  }

  return {
    success: true,
    workerName,
    deleted: true,
    removedFromGraph: graphResult?.ok || false,
    deletedBy: caller.email || caller.userId || null,
    message: `Worker "${workerName}" deleted.`,
  }
}

function normalizeRegistryWorkerUrl(domainOrUrl, workerName) {
  const raw = String(domainOrUrl || '').trim()
  if (raw) {
    if (/^https?:\/\//i.test(raw)) return raw
    return `https://${raw}`
  }
  return `https://${workerName}.torarnehave.workers.dev`
}

async function executeInvokeRegistryWorker(input, env) {
  const authContext = input?.authContext
  if (!authContext?.authenticated) {
    throw new Error('invoke_registry_worker requires a verified logged-in session.')
  }

  const workerName = String(input?.workerName || '').trim()
  if (!workerName) throw new Error('workerName is required')

  const registry = await fetchRegistryGraph(env)
  const workers = registryNodesByType(registry, 'system-worker')
  const match = workers.find((node) => {
    const meta = node.metadata || {}
    const candidates = [
      node.id,
      node.label,
      meta.name,
      meta.domain,
    ].filter(Boolean).map((value) => String(value).toLowerCase())
    const needle = workerName.toLowerCase()
    return candidates.includes(needle) || candidates.includes(`worker-${needle}`)
  })

  if (!match) {
    throw new Error(`Worker "${workerName}" was not found in graph_system_registry.`)
  }

  const meta = match.metadata || {}
  const resolvedName = String(meta.name || match.label || workerName).trim()
  const baseUrl = normalizeRegistryWorkerUrl(meta.domain || meta.url, resolvedName)
  const endpointPath = String(input?.endpointPath || '/').trim() || '/'
  const normalizedPath = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`
  const method = String(input?.method || 'POST').trim().toUpperCase()
  const query = input?.query && typeof input.query === 'object' ? input.query : null
  const body = input?.body && typeof input.body === 'object' ? input.body : null
  const url = new URL(`${baseUrl}${normalizedPath}`)

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue
      url.searchParams.set(key, String(value))
    }
  }

  const headers = { 'Content-Type': 'application/json' }
  const authToken = typeof input?.authToken === 'string' && input.authToken.trim()
    ? input.authToken.trim()
    : (typeof authContext?.authToken === 'string' && authContext.authToken.trim()
      ? authContext.authToken.trim()
      : '')
  if (authToken) {
    headers.authorization = `Bearer ${authToken}`
    headers.cookie = `vegvisr_token=${encodeURIComponent(authToken)}`
  }
  // Internal-auth contract (A1): present the shared secret + the VERIFIED caller email so a
  // deployed admin worker (built from get_secure_worker_template) can trust the call and
  // role-check the caller in D1 — without the worker needing to resolve a session itself.
  if (env.INTERNAL_SHARED_SECRET) {
    headers['x-internal-auth'] = env.INTERNAL_SHARED_SECRET
    const callerEmail = authContext?.email || authContext?.profile?.email || authContext?.session?.email || ''
    if (callerEmail) headers['x-internal-caller'] = String(callerEmail).toLowerCase()
  }

  const fetchOptions = { method, headers }
  if (body && method !== 'GET') fetchOptions.body = JSON.stringify(body)

  const response = await fetch(url.toString(), fetchOptions)
  const contentType = response.headers.get('content-type') || ''
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => '')

  if (!response.ok) {
    const detail = typeof payload === 'string' ? payload : (payload?.error || JSON.stringify(payload))
    throw new Error(`Worker "${resolvedName}" call failed (${response.status}): ${detail}`)
  }

  return {
    workerName: resolvedName,
    endpointPath: normalizedPath,
    method,
    status: response.status,
    response: payload,
    message: `Worker "${resolvedName}" responded successfully from ${normalizedPath}.`,
  }
}

async function executeGetSecureWorkerTemplate(input) {
  const templateType = input?.templateType || 'all'

  const sharedRules = [
    'Never trust x-user-role, x-user-email, or any other client-supplied role/identity header.',
    'Validate the incoming session server-side via https://auth.vegvisr.org/auth/openauth/session.',
    'After session validation, resolve the real user from vegvisr_org.config and read Role from D1.',
    'Use parameterized D1 queries and await all run()/first()/all() calls.',
    'For browser calls from vegvisr.org, use credentialed CORS: reflect trusted origin and set Access-Control-Allow-Credentials: true.',
    'Do not expose phone or other unnecessary private fields in public responses.',
  ]

  const sharedAuthHelper = `const TRUSTED_ORIGIN_RE = /^https?:\\/\\/(?:(?:localhost|127\\\\.0\\\\.0\\\\.1)(?::\\\\d+)?|(?:[\\\\w-]+\\\\.)*vegvisr\\\\.org)$/i;

function buildCorsHeaders(request) {
  const origin = request.headers.get('origin') || '';
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
    'Vary': 'Origin',
  };
  if (origin && TRUSTED_ORIGIN_RE.test(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  } else {
    headers['Access-Control-Allow-Origin'] = '*';
  }
  return headers;
}

async function resolveSession(request) {
  const cookie = request.headers.get('cookie') || '';
  const authorization = request.headers.get('authorization') || '';
  if (!cookie && !authorization) return null;
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (authorization) headers.authorization = authorization;
  const res = await fetch('https://auth.vegvisr.org/auth/openauth/session', { method: 'GET', headers });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (!data?.success || !data?.subject) return null;
  return data.subject;
}

async function resolveCallerProfile(subject, env) {
  if (!subject) return null;
  let profile = null;
  if (subject.email) {
    profile = await env.DB.prepare(
      'SELECT email, user_id, Role AS role, bio FROM config WHERE email = ?'
    ).bind(subject.email).first();
  }
  if (!profile && subject.id) {
    profile = await env.DB.prepare(
      'SELECT email, user_id, Role AS role, bio FROM config WHERE user_id = ?'
    ).bind(subject.id).first();
  }
  return profile;
}

async function requireSuperadmin(request, env) {
  // Internal-auth fast-path: the agent-builder presents x-internal-auth (shared secret, set by
  // deploy_worker as a binding) + x-internal-caller (the VERIFIED session email). The secret cannot
  // be client-forged, so trust the caller and role-check it in D1. Everything else uses the session.
  const internalAuth = request.headers.get('x-internal-auth') || '';
  if (internalAuth && env.INTERNAL_SHARED_SECRET && internalAuth === env.INTERNAL_SHARED_SECRET) {
    const caller = (request.headers.get('x-internal-caller') || '').toLowerCase();
    if (!caller) return { ok: false, status: 400, error: 'x-internal-caller required' };
    const profile = await resolveCallerProfile({ email: caller }, env);
    const role = String(profile?.role || '').toLowerCase();
    if (role !== 'superadmin') return { ok: false, status: 403, error: 'Superadmin required (caller ' + caller + ')' };
    return { ok: true, subject: { email: caller }, profile };
  }
  const subject = await resolveSession(request);
  if (!subject) return { ok: false, status: 401, error: 'Authentication required' };
  const profile = await resolveCallerProfile(subject, env);
  const role = String(profile?.role || subject.role || '').toLowerCase();
  if (role !== 'superadmin') return { ok: false, status: 403, error: 'Superadmin required' };
  return { ok: true, subject, profile };
}`

  const adminTemplate = `export default {
  async fetch(request, env) {
    const corsHeaders = buildCorsHeaders(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

    const auth = await requireSuperadmin(request, env);
    if (!auth.ok) {
      return new Response(JSON.stringify({ success: false, error: auth.error }), {
        status: auth.status,
        headers: corsHeaders,
      });
    }

    if (request.method === 'POST' && new URL(request.url).pathname === '/update-bio') {
      const { email, bio } = await request.json();
      if (!email || bio === undefined) {
        return new Response(JSON.stringify({ success: false, error: 'Missing email or bio' }), { status: 400, headers: corsHeaders });
      }

      const update = await env.DB.prepare(
        'UPDATE config SET bio = ? WHERE email = ?'
      ).bind(bio, email).run();

      if (!update.meta?.changes) {
        return new Response(JSON.stringify({ success: false, error: 'User not found' }), { status: 404, headers: corsHeaders });
      }

      const user = await env.DB.prepare(
        'SELECT email, bio, Role AS role FROM config WHERE email = ?'
      ).bind(email).first();

      return new Response(JSON.stringify({ success: true, user }), { headers: corsHeaders });
    }

    return new Response(JSON.stringify({ success: false, error: 'Not found' }), { status: 404, headers: corsHeaders });
  }
};`

  const userScopedTemplate = `export default {
  async fetch(request, env) {
    const corsHeaders = buildCorsHeaders(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

    const subject = await resolveSession(request);
    if (!subject) {
      return new Response(JSON.stringify({ success: false, error: 'Authentication required' }), { status: 401, headers: corsHeaders });
    }

    const profile = await resolveCallerProfile(subject, env);
    if (!profile?.email) {
      return new Response(JSON.stringify({ success: false, error: 'User profile not found' }), { status: 404, headers: corsHeaders });
    }

    // Add user-scoped logic here. Never accept target email from the client for self-service actions.
    return new Response(JSON.stringify({
      success: true,
      user: { email: profile.email, role: profile.role || 'user' }
    }), { headers: corsHeaders });
  }
};`

  const publicReadonlyTemplate = `export default {
  async fetch(request) {
    const corsHeaders = buildCorsHeaders(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

    // Public-readonly worker: no session required, no mutations, no private data.
    return new Response(JSON.stringify({ success: true, message: 'Public readonly worker starter' }), {
      headers: corsHeaders,
    });
  }
};`

  const templates = {
    sharedAuthHelper,
    admin: adminTemplate,
    'user-scoped': userScopedTemplate,
    'public-readonly': publicReadonlyTemplate,
  }

  if (templateType !== 'all') {
    return {
      templateType,
      mandatoryRules: sharedRules,
      sharedAuthHelper,
      template: templates[templateType],
      message: `Returned canonical secure worker template: ${templateType}`,
    }
  }

  return {
    templateType: 'all',
    mandatoryRules: sharedRules,
    sharedAuthHelper,
    templates,
    message: 'Returned canonical secure worker templates for admin, user-scoped, and public-readonly workers.',
  }
}

function slugifyCapabilityName(text) {
  return String(text || 'new-capability')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'new-capability'
}

async function executeCreateCapabilityBlueprint(input) {
  const request = String(input?.request || '').trim()
  if (!request) throw new Error('request is required')

  const text = request.toLowerCase()
  const preferred = input?.preferredImplementation || 'auto'
  const answers = input?.answers && typeof input.answers === 'object' ? input.answers : {}
  const uiSurfaceRequested = /(app|viewer|generator|template|ui|page|dashboard|portal|studio|form)/.test(text)
  const explicitCompositeRequest = /(worker.+template|template.+worker|both.+template.+worker|both.+worker.+template)/.test(text)

  const privilegedPatterns = [
    /update .*bio/,
    /update .*profile/,
    /\buser\b/,
    /\bconfig\b/,
    /\bprivate\b/,
    /\badmin\b/,
    /\bsuperadmin\b/,
    /\bdelete\b/,
    /\brole\b/,
    /\bapi key\b/,
    /\bcredential\b/,
    /\bdeploy\b/,
    /\bworker\b/,
  ]
  const userScopedPatterns = [
    /\bmy\b/,
    /\bcurrent user\b/,
    /\bown\b/,
    /\bself\b/,
    /\bprofile\b/,
    /\bpreferences\b/,
    /\bsettings\b/,
  ]
  const publicReadonlyPatterns = [
    /\blist\b/,
    /\bshow\b/,
    /\bview\b/,
    /\bread\b/,
    /\bsearch\b/,
    /\blookup\b/,
    /\bstatus\b/,
  ]

  let capabilityType = 'public-readonly'
  if (privilegedPatterns.some((pattern) => pattern.test(text))) {
    capabilityType = 'privileged/admin'
  } else if (userScopedPatterns.some((pattern) => pattern.test(text))) {
    capabilityType = 'user-scoped'
  } else if (publicReadonlyPatterns.some((pattern) => pattern.test(text))) {
    capabilityType = 'public-readonly'
  }

  let implementation = preferred === 'auto' ? 'worker' : preferred
  if (preferred === 'auto') {
    if (/dashboard|ui|screen|page|form|html/.test(text)) implementation = 'html-app'
    else if (/template|graph node|fulltext|section/.test(text)) implementation = 'graph-template'
    else implementation = 'worker'
  }

  const inferredFields = []
  if (/\bbios?\b/.test(text)) inferredFields.push('bio')
  if (/\btitle\b/.test(text)) inferredFields.push('title')
  if (/\bphone\b/.test(text)) inferredFields.push('phone')
  if (/\bbranding\b/.test(text) || /\blogo\b/.test(text) || /\bsite\b/.test(text)) inferredFields.push('branding')

  const requestedFields = Array.isArray(answers.mutableFields)
    ? answers.mutableFields.map((value) => String(value).trim()).filter(Boolean)
    : inferredFields

  const selfScopePattern = /\bown\b|\bmy own\b|\blogged-?in user\b|\bhimself\b|\bherself\b|\bthemselves\b|\bmyself\b/
  const selectedScopePattern = /\banother user\b|\bother users?\b|\bothers\b|\bany user\b|\bselected user\b/
  const targetScope = answers.targetScope
    ? String(answers.targetScope)
    : selfScopePattern.test(text) && selectedScopePattern.test(text)
      ? 'both'
      : selectedScopePattern.test(text)
        ? 'selected-user'
        : selfScopePattern.test(text)
          ? 'self'
          : 'both'

  const deliveryMode = answers.deliveryMode
    ? String(answers.deliveryMode)
    : implementation === 'worker'
      ? uiSurfaceRequested
        ? 'reusable-template'
        : 'backend-only'
      : implementation === 'html-app'
        ? 'simple-admin-form'
        : 'backend-only'

  const templateType = capabilityType === 'privileged/admin'
    ? 'admin'
    : capabilityType === 'user-scoped'
      ? 'user-scoped'
      : 'public-readonly'

  const companionTemplateRecommended =
    implementation === 'worker' && (deliveryMode === 'simple-admin-form' || deliveryMode === 'reusable-template' || uiSurfaceRequested || explicitCompositeRequest)
  const companionTemplateCategory = companionTemplateRecommended ? 'My Apps' : null
  const companionTemplateNodeType = companionTemplateRecommended ? 'app-viewer' : null

  const workerNameSuggestion = slugifyCapabilityName(
    request
      .replace(/\b(add|create|build|make|capability|to|for|a|an|the)\b/gi, ' ')
      .trim()
  )

  const endpointSuggestion = `/${workerNameSuggestion.replace(/^user-/, '').replace(/-admin$/, '')}`.slice(0, 64)

  const tableName = answers.tableName
    ? String(answers.tableName).trim()
    : /\bconfig table\b|\bconfig\b/.test(text) || requestedFields.includes('bio')
      ? 'config'
      : ''
  const identifierField = answers.identifierField
    ? String(answers.identifierField).trim()
    : tableName === 'config'
      ? 'email'
      : ''
  const responseFields = tableName === 'config'
    ? ['email', ...requestedFields, 'role'].filter((value, index, arr) => arr.indexOf(value) === index)
    : requestedFields
  const allowEmptyFields = requestedFields.includes('bio') ? ['bio'] : []

  const requiredQuestions = []
  if (implementation === 'worker' && !tableName) {
    requiredQuestions.push({
      id: 'table_name',
      question: 'Which table should this capability update?',
      kind: 'short-text',
      reason: 'The worker scaffold needs a concrete D1 table target.',
    })
  }
  if (implementation === 'worker' && requestedFields.length === 0) {
    requiredQuestions.push({
      id: 'mutable_fields',
      question: 'Which profile fields should be editable?',
      kind: 'choices',
      options: ['bio', 'title', 'phone', 'branding'],
      reason: 'The worker scaffold needs the editable fields before it can generate code.',
    })
  }

  const optionalQuestions = []
  const needsDeliveryChoice = implementation === 'worker'
    && !answers.deliveryMode
    && (uiSurfaceRequested || explicitCompositeRequest)
  if (needsDeliveryChoice) {
    optionalQuestions.push({
      id: 'delivery_mode',
      question: 'Do you want backend only, a simple admin form, or a reusable template?',
      kind: 'choices',
      options: ['backend-only', 'simple-admin-form', 'reusable-template'],
      recommended: 'backend-only',
      reason: 'This changes whether the capability should also create a UI surface.',
    })
  }

  const scaffoldDefaults = implementation === 'worker' && tableName && identifierField && requestedFields.length > 0
    ? {
        workerName: requestedFields.length === 1 && requestedFields[0] === 'bio' && capabilityType === 'privileged/admin'
          ? 'admin-bio-updater'
          : workerNameSuggestion.slice(0, 64),
        templateType,
        endpointPath: requestedFields.length === 1 && requestedFields[0] === 'bio'
          ? '/update-bio'
          : endpointSuggestion,
        actionType: 'update',
        tableName,
        identifierField,
        mutableFields: requestedFields,
        responseFields,
        allowEmptyFields,
        capabilitySummary: request,
      }
    : null

  const nextTools = implementation === 'worker'
    ? [
        'create_capability_blueprint',
        'build_capability_worker_scaffold',
        'deploy_worker',
        ...(companionTemplateRecommended ? ['kg_add_template'] : []),
      ]
    : ['create_capability_blueprint']
  const deliveryPhases = implementation === 'worker'
    ? [
        'Design the capability package and classify its security level.',
        'Generate the worker scaffold.',
        'Deploy the worker and confirm deployment success.',
        ...(companionTemplateRecommended
          ? ['Only after deployment succeeds, create the dependent graph template/app that points to the deployed worker URL.']
          : []),
        'Report exact success or failure for each completed phase.',
      ]
    : [
        'Design the capability package and classify its implementation.',
        'Create the requested non-worker artifact.',
        'Report exact success or failure for each completed phase.',
      ]

  return {
    request,
    capabilityType,
    templateType,
    implementation,
    deliveryMode,
    targetScope,
    workerNameSuggestion,
    endpointSuggestion,
    companionTemplateRecommended,
    companionTemplateCategory,
    companionTemplateNodeType,
    requiresSecureTemplate: templateType !== 'public-readonly',
    readyToScaffold: Boolean(scaffoldDefaults && requiredQuestions.length === 0),
    inferredAnswers: {
      tableName: tableName || null,
      identifierField: identifierField || null,
      mutableFields: requestedFields,
      responseFields,
      allowEmptyFields,
      targetScope,
      deliveryMode,
    },
    requiredQuestions,
    optionalQuestions,
    scaffoldDefaults,
    deliveryPhases,
    safetyChecks: capabilityType === 'privileged/admin'
      ? [
          'Validate session server-side via auth.vegvisr.org',
          'Resolve role from vegvisr_org.config',
          'Require Superadmin',
          'Do not trust client role headers',
          'Keep deploy credentials server-side only',
        ]
      : capabilityType === 'user-scoped'
        ? [
            'Validate session server-side via auth.vegvisr.org',
            'Resolve caller profile from vegvisr_org.config',
            'Do not let the client choose another user identity',
          ]
        : [
            'No private data exposure',
            'No mutation endpoints unless reclassified',
          ],
    nextTools,
    message: `Capability classified as ${capabilityType} with ${implementation} implementation. Use template type "${templateType}"${companionTemplateRecommended ? ' and treat this as a worker-plus-template package.' : '.'}`,
  }
}

function sqlColumnList(columns) {
  return (columns || []).filter(Boolean).map((col) => String(col).trim()).filter(Boolean)
}

function normalizePotentialIdentifier(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(raw)) return raw

  const tokens = raw.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []
  const uniqueTokens = [...new Set(tokens)]
  if (uniqueTokens.length !== 1) return raw

  const punctuationOnly = raw.replace(/[A-Za-z_][A-Za-z0-9_]*/g, '')
  if (/^[\s<>{}\[\]\(\)\|"'`,.:;!?\\/-]*$/.test(punctuationOnly)) {
    return uniqueTokens[0]
  }

  return raw
}

function assertSafeSqlIdentifier(value, fieldName) {
  const identifier = normalizePotentialIdentifier(value)
  if (!identifier) throw new Error(`${fieldName} is required`)
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`${fieldName} contains invalid identifier: "${identifier}"`)
  }
  return identifier
}

function assertSafeSqlIdentifierList(values, fieldName) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`${fieldName} is required`)
  }
  return values.map((value, index) => assertSafeSqlIdentifier(value, `${fieldName}[${index}]`))
}

function inferScaffoldResponseKey(tableName) {
  if (!tableName) return 'record'
  if (tableName === 'config') return 'user'
  if (tableName.endsWith('ies')) return `${tableName.slice(0, -3)}y`
  if (tableName.endsWith('s') && tableName.length > 1) return tableName.slice(0, -1)
  return 'record'
}

function buildMutationValidation(fields, allowEmptyFields) {
  const allowEmpty = new Set((allowEmptyFields || []).map((v) => String(v)))
  return fields.map((field) => {
    const check = allowEmpty.has(field)
      ? `if (${field} === undefined) missing.push('${field}');`
      : `if (!${field} && ${field} !== 0) missing.push('${field}');`
    return `      ${check}`
  }).join('\n')
}

async function executeBuildCapabilityWorkerScaffold(input) {
  const workerName = String(input?.workerName || '').trim()
  const templateType = String(input?.templateType || '').trim()
  const endpointPath = String(input?.endpointPath || '').trim()
  const method = String(input?.method || 'POST').toUpperCase()
  const actionType = String(input?.actionType || '').trim()
  const tableNameRaw = String(input?.tableName || '').trim()
  const identifierFieldRaw = String(input?.identifierField || '').trim()
  const mutableFieldsRaw = sqlColumnList(input?.mutableFields || [])
  const responseFieldsRaw = sqlColumnList(input?.responseFields || [])
  const capabilitySummary = String(input?.capabilitySummary || '').trim()
  const allowEmptyFieldsRaw = sqlColumnList(input?.allowEmptyFields || [])

  if (!workerName || !templateType || !endpointPath || !actionType) {
    throw new Error('workerName, templateType, endpointPath, and actionType are required')
  }

  const secureTemplate = await executeGetSecureWorkerTemplate({ templateType })
  const sharedAuthHelper = secureTemplate.sharedAuthHelper
  const pathLiteral = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`

  let body = ''
  if (actionType === 'update') {
    if (!tableNameRaw || !identifierFieldRaw || mutableFieldsRaw.length === 0) {
      throw new Error('update scaffold requires tableName, identifierField, and mutableFields')
    }
    const tableName = assertSafeSqlIdentifier(tableNameRaw, 'tableName')
    const identifierField = assertSafeSqlIdentifier(identifierFieldRaw, 'identifierField')
    const mutableFields = assertSafeSqlIdentifierList(mutableFieldsRaw, 'mutableFields')
    const responseFields = responseFieldsRaw.length > 0
      ? assertSafeSqlIdentifierList(responseFieldsRaw, 'responseFields')
      : [identifierField, ...mutableFields]
    const allowEmptyFields = allowEmptyFieldsRaw.length > 0
      ? assertSafeSqlIdentifierList(allowEmptyFieldsRaw, 'allowEmptyFields')
      : []
    const allInputs = [identifierField, ...mutableFields]
    const validation = buildMutationValidation(allInputs, allowEmptyFields)
    const setClause = mutableFields.map((field) => `${field} = ?`).join(', ')
    const bindArgs = [...mutableFields, identifierField].join(', ')
    const responseCols = responseFields.join(', ')
    const responseKey = inferScaffoldResponseKey(tableName)
    body = `export default {
  async fetch(request, env) {
    ${sharedAuthHelper}
    const corsHeaders = buildCorsHeaders(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

    ${templateType === 'admin'
      ? `const auth = await requireSuperadmin(request, env);
    if (!auth.ok) {
      return new Response(JSON.stringify({ success: false, error: auth.error }), { status: auth.status, headers: corsHeaders });
    }`
      : `const subject = await resolveSession(request);
    if (!subject) {
      return new Response(JSON.stringify({ success: false, error: 'Authentication required' }), { status: 401, headers: corsHeaders });
    }
    const profile = await resolveCallerProfile(subject, env);
    if (!profile) {
      return new Response(JSON.stringify({ success: false, error: 'User profile not found' }), { status: 404, headers: corsHeaders });
    }`}

    const url = new URL(request.url);
    if (request.method === '${method}' && url.pathname === '${pathLiteral}') {
      const { ${allInputs.join(', ')} } = await request.json();
      const missing = [];
${validation}
      if (missing.length > 0) {
        return new Response(JSON.stringify({ success: false, error: 'Missing required fields', missing }), { status: 400, headers: corsHeaders });
      }

      const update = await env.DB.prepare(
        'UPDATE ${tableName} SET ${setClause} WHERE ${identifierField} = ?'
      ).bind(${bindArgs}).run();

      if (!update.meta?.changes) {
        return new Response(JSON.stringify({ success: false, error: 'Record not found' }), { status: 404, headers: corsHeaders });
      }

      const row = await env.DB.prepare(
        'SELECT ${responseCols} FROM ${tableName} WHERE ${identifierField} = ?'
      ).bind(${identifierField}).first();

      return new Response(JSON.stringify({ success: true, ${responseKey}: row }), { headers: corsHeaders });
    }

    return new Response(JSON.stringify({ success: false, error: 'Not found' }), { status: 404, headers: corsHeaders });
  }
};`
  } else if (actionType === 'select' && !tableNameRaw) {
    body = `export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

    const url = new URL(request.url);
    if (url.pathname === '${pathLiteral}') {
      return new Response(JSON.stringify({ success: true, message: 'HELLO TEST' }), { headers: corsHeaders });
    }
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), { headers: corsHeaders });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: corsHeaders });
  }
};`
  } else {
    body = `${sharedAuthHelper}

export default {
  async fetch(request, env) {
    const corsHeaders = buildCorsHeaders(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

    return new Response(JSON.stringify({
      success: false,
      error: 'Scaffold created, but ${actionType} handler still needs to be filled in.'
    }), { status: 501, headers: corsHeaders });
  }
};`
  }

  return {
    workerName,
    templateType,
    endpointPath: pathLiteral,
    actionType,
    capabilitySummary: capabilitySummary || null,
    code: body,
    message: `Generated ${templateType} worker scaffold for ${method} ${pathLiteral}.`,
  }
}

// ── Describe capabilities ─────────────────────────────────────────

async function executeDescribeCapabilities(input, env) {
  const includeTools = input.include_tools !== false
  const includeTemplates = input.include_templates !== false

  const result = {}

  if (includeTools) {
    // Hardcoded tools
    const hardcoded = TOOL_DEFINITIONS.map(t => ({ name: t.name, description: t.description }))

    // Proff Norwegian business registry tools
    const proff = PROFF_TOOLS.map(t => ({ name: t.name, description: t.description }))

    // Dynamic KG API tools
    let dynamic = []
    try {
      const loaded = await loadOpenAPITools(env)
      const hardcodedNames = new Set(TOOL_DEFINITIONS.map(t => t.name))
      dynamic = loaded.tools
        .filter(t => !hardcodedNames.has(t.name))
        .map(t => ({ name: t.name, description: t.description }))
    } catch { /* ignore */ }

    // Identify search-specific tools
    const searchTools = hardcoded.filter(t => t.name === 'search_graphs' || t.name === 'list_graphs' || t.name === 'list_meta_areas')
    const otherHardcoded = hardcoded.filter(t => !searchTools.some(st => st.name === t.name))

    result.tools = {
      search: searchTools,
      hardcoded: otherHardcoded,
      proff,
      dynamic,
      builtin: [{ name: 'web_search', description: 'Quick web search (Claude built-in, lightweight)' }],
      total: hardcoded.length + proff.length + dynamic.length + 1
    }
  }

  if (includeTemplates) {
    result.templates = listTemplates()
  }

  result.summary = `This agent has ${result.tools?.total || '?'} tools and ${result.templates?.length || '?'} HTML templates available. **SEARCH FIRST**: Use search_graphs for fast text search across all graphs (NO token cost). Tools cover knowledge graph management, web search, image search & analysis, audio transcription, semantic analysis, email, HTML app creation, and Norwegian business registry (Proff.no) lookups.`

  return result
}

// ── Main DB tools (vegvisr_org) ───────────────────────────────────

async function executeDbListTables(env) {
  const db = env.DB
  if (!db) throw new Error('DB binding not available')

  const result = await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name"
  ).all()

  const tables = []
  for (const row of result.results) {
    const info = await db.prepare(`PRAGMA table_info(${row.name})`).all()
    tables.push({
      name: row.name,
      columns: info.results.map(c => ({ name: c.name, type: c.type, notnull: !!c.notnull, pk: !!c.pk }))
    })
  }

  return { tables, message: `Found ${tables.length} tables in vegvisr_org` }
}

async function executeDbQuery(input, env) {
  const db = env.DB
  if (!db) throw new Error('DB binding not available')

  const sql = (input.sql || '').trim()
  if (!sql) throw new Error('sql is required')

  // Only allow SELECT queries
  if (!/^SELECT\b/i.test(sql)) {
    throw new Error('Only SELECT queries are allowed on vegvisr_org.')
  }

  const params = input.params || []
  let stmt = db.prepare(sql)
  if (params.length > 0) stmt = stmt.bind(...params)

  const result = await stmt.all()
  return {
    records: result.results,
    count: result.results.length,
    message: `Returned ${result.results.length} records`
  }
}

// Full onboarding status for a client (aggregates config + chat + RDAP + DNS).
// Calls the knowledge-graph-worker /onboarding-status endpoint (Superadmin-gated).
async function executeOnboardingStatus(input, env) {
  const email = (input.email || '').trim()
  if (!email) throw new Error('email is required')
  const domain = (input.domain || '').trim()
  const url = `https://knowledge.vegvisr.org/onboarding-status?email=${encodeURIComponent(email)}` +
    (domain ? `&domain=${encodeURIComponent(domain)}` : '')
  const req = new Request(url, { headers: { 'x-user-role': 'Superadmin' } })
  // Use the service binding (direct worker-to-worker) — fetching the public vegvisr.org
  // hostname from a same-zone worker 522s. Fall back to public fetch only if the binding is absent.
  const res = env.KG_WORKER ? await env.KG_WORKER.fetch(req) : await fetch(req)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`onboarding-status ${res.status}: ${text.slice(0, 200)}`)
  }
  return await res.json()
}

// ── Chat DB tools ─────────────────────────────────────────────────

async function executeChatDbListTables(env) {
  const db = env.CHAT_DB
  if (!db) throw new Error('CHAT_DB binding not available')

  const result = await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name"
  ).all()

  const tables = []
  for (const row of result.results) {
    const info = await db.prepare(`PRAGMA table_info(${row.name})`).all()
    tables.push({
      name: row.name,
      columns: info.results.map(c => ({ name: c.name, type: c.type, notnull: !!c.notnull, pk: !!c.pk }))
    })
  }

  return { tables, message: `Found ${tables.length} tables in hallo_vegvisr_chat` }
}

async function executeChatDbQuery(input, env) {
  const db = env.CHAT_DB
  if (!db) throw new Error('CHAT_DB binding not available')

  const sql = (input.sql || '').trim()
  if (!sql) throw new Error('sql is required')

  // Only allow SELECT queries
  if (!/^SELECT\b/i.test(sql)) {
    throw new Error('Only SELECT queries are allowed on chat_db. Use chat tools for modifications.')
  }

  const params = input.params || []
  let stmt = db.prepare(sql)
  if (params.length > 0) stmt = stmt.bind(...params)

  const result = await stmt.all()
  return {
    records: result.results,
    count: result.results.length,
    message: `Returned ${result.results.length} records from chat_db`
  }
}

// ── What's New (per-app release notes) ───────────────────────────

const VALID_APPS = new Set(['chat', 'calendar', 'photos', 'aichat', 'vemail', 'connect'])

const APP_TITLES = {
  chat: 'Vegvisr Chat',
  calendar: 'Vegvisr Calendar',
  photos: 'Vegvisr Photos',
  aichat: 'Vegvisr AI Chat',
  vemail: 'Vegvisr Email',
  connect: 'Vegvisr Connect',
}

async function executeAddWhatsNew(input, env) {
  const app = (input.app || '').trim().toLowerCase()
  const title = (input.title || '').trim()
  const description = (input.description || '').trim()

  if (!app || !VALID_APPS.has(app)) {
    throw new Error(`app must be one of: ${[...VALID_APPS].join(', ')}. Got: "${app}"`)
  }
  if (!title || !description) throw new Error('title and description are required')

  const graphId = `graph_${app}_new_features`
  const nodeId = `feature-${Date.now()}`
  const color = input.color || '#38bdf8'

  // Check if graph exists — auto-create if not
  const existsRes = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(graphId)}`
  )
  if (!existsRes.ok) {
    // Graph doesn't exist — create it
    const createRes = await env.KG_WORKER.fetch('https://knowledge-graph-worker/saveGraphWithHistory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: graphId,
        graphData: {
          nodes: [],
          edges: [],
          metadata: {
            title: `${APP_TITLES[app] || app} New Features`,
            description: `Release notes and new features for ${APP_TITLES[app] || app}`,
            metaArea: app,
          }
        },
        override: true,
      })
    })
    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}))
      throw new Error(err.error || `Failed to create graph ${graphId}`)
    }
    console.log(`[add_whats_new] Auto-created graph ${graphId}`)
  }

  // Add the feature node
  const response = await env.KG_WORKER.fetch('https://knowledge-graph-worker/addNode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      graphId,
      node: {
        id: nodeId,
        label: title,
        type: 'fulltext',
        info: description,
        color,
      }
    })
  })

  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to add feature node')

  return {
    message: `Added "${title}" to ${APP_TITLES[app] || app} What's New (node ${nodeId})`,
    nodeId,
    graphId,
    app,
    version: data.newVersion,
  }
}

async function executeAddUserSuggestion(input, env) {
  const app = (input.app || '').trim().toLowerCase()
  const title = (input.title || '').trim()
  const description = (input.description || '').trim()
  const category = (input.category || 'feature').trim().toLowerCase()

  if (!app || !VALID_APPS.has(app)) {
    throw new Error(`app must be one of: ${[...VALID_APPS].join(', ')}. Got: "${app}"`)
  }
  if (!title || !description) throw new Error('title and description are required')

  const graphId = `graph_${app}_user_suggestions`
  const nodeId = `suggestion-${Date.now()}`
  const validCategories = new Set(['feature', 'bug', 'ux', 'integration', 'other'])
  const safeCategory = validCategories.has(category) ? category : 'feature'

  const STATUS_COLORS = { new: '#38bdf8', reviewed: '#f59e0b', planned: '#a78bfa', shipped: '#34d399' }

  // Check if graph exists — auto-create if not
  const existsRes = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(graphId)}`
  )
  if (!existsRes.ok) {
    const createRes = await env.KG_WORKER.fetch('https://knowledge-graph-worker/saveGraphWithHistory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: graphId,
        graphData: {
          nodes: [],
          edges: [],
          metadata: {
            title: `${APP_TITLES[app] || app} User Suggestions`,
            description: `User suggestions for ${APP_TITLES[app] || app}`,
            metaArea: app,
          }
        },
        override: true,
      })
    })
    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}))
      throw new Error(err.error || `Failed to create graph ${graphId}`)
    }
    console.log(`[add_user_suggestion] Auto-created graph ${graphId}`)
  }

  // Add the suggestion node
  const response = await env.KG_WORKER.fetch('https://knowledge-graph-worker/addNode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      graphId,
      node: {
        id: nodeId,
        label: title,
        type: 'fulltext',
        info: description,
        color: STATUS_COLORS.new,
        metadata: {
          status: 'new',
          category: safeCategory,
          submittedBy: 'agent',
          submittedByEmail: 'agent@vegvisr.org',
          votes: 0,
          votedBy: [],
          createdAt: new Date().toISOString(),
        },
      }
    })
  })

  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to add suggestion node')

  return {
    message: `Added suggestion "${title}" to ${APP_TITLES[app] || app} Suggestions (node ${nodeId})`,
    nodeId,
    graphId,
    app,
    category: safeCategory,
    version: data.newVersion,
  }
}

async function executeUpdateSuggestionStatus(input, env) {
  const app = (input.app || '').trim().toLowerCase()
  const suggestionId = (input.suggestionId || '').trim()
  const status = (input.status || '').trim().toLowerCase()

  if (!app || !VALID_APPS.has(app)) {
    throw new Error(`app must be one of: ${[...VALID_APPS].join(', ')}. Got: "${app}"`)
  }
  if (!suggestionId) throw new Error('suggestionId is required')

  const validStatuses = new Set(['new', 'reviewed', 'planned', 'shipped'])
  if (!validStatuses.has(status)) {
    throw new Error(`status must be one of: ${[...validStatuses].join(', ')}. Got: "${status}"`)
  }

  const STATUS_COLORS = { new: '#38bdf8', reviewed: '#f59e0b', planned: '#a78bfa', shipped: '#34d399' }
  const graphId = `graph_${app}_user_suggestions`

  // Fetch the graph to get the current node
  const graphRes = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(graphId)}`
  )
  if (!graphRes.ok) throw new Error(`Graph ${graphId} not found`)

  const graphData = await graphRes.json()
  const node = (graphData.nodes || []).find(n => n.id === suggestionId)
  if (!node) throw new Error(`Suggestion ${suggestionId} not found in ${graphId}`)

  const meta = node.metadata || {}
  const oldStatus = meta.status || 'new'

  // Patch the node with new status and color
  await patchNodeWithVersionRetry(env, graphId, suggestionId, {
    color: STATUS_COLORS[status],
    metadata: { ...meta, status },
  })

  return {
    message: `Updated suggestion "${node.label}" status from ${oldStatus} to ${status}`,
    suggestionId,
    graphId,
    oldStatus,
    newStatus: status,
  }
}

// ── Calendar DB tools ─────────────────────────────────────────────

async function executeCalendarListTables(env) {
  const db = env.CALENDAR_DB
  if (!db) throw new Error('CALENDAR_DB binding not available')

  const result = await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name"
  ).all()

  const tables = []
  for (const row of result.results) {
    const info = await db.prepare(`PRAGMA table_info(${row.name})`).all()
    tables.push({
      name: row.name,
      columns: info.results.map(c => ({ name: c.name, type: c.type, notnull: !!c.notnull, pk: !!c.pk }))
    })
  }

  return { tables, message: `Found ${tables.length} tables in calendar_db` }
}

async function executeCalendarQuery(input, env) {
  const db = env.CALENDAR_DB
  if (!db) throw new Error('CALENDAR_DB binding not available')

  const sql = (input.sql || '').trim()
  if (!sql) throw new Error('sql is required')

  // Only allow SELECT queries
  if (!/^SELECT\b/i.test(sql)) {
    throw new Error('Only SELECT queries are allowed on calendar_db. Use the calendar app for modifications.')
  }

  const params = input.params || []
  let stmt = db.prepare(sql)
  if (params.length > 0) stmt = stmt.bind(...params)

  const result = await stmt.all()
  return {
    records: result.results,
    count: result.results.length,
    message: `Returned ${result.results.length} records`
  }
}

// ── Calendar booking tools (via CALENDAR_WORKER service binding) ──

async function executeCalendarGetSettings(input, env) {
  const userEmail = (input.userEmail || '').trim()
  if (!userEmail) throw new Error('userEmail is required')

  const res = await env.CALENDAR_WORKER.fetch(
    `https://calendar-worker/api/public/settings?user=${encodeURIComponent(userEmail)}`
  )
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to get calendar settings')

  return {
    settings: data.settings,
    availability: data.availability,
    meetingTypes: data.meetingTypes,
    groupMeetings: data.groupMeetings,
    message: `Retrieved calendar settings for ${userEmail}: available ${data.settings.availability_start}-${data.settings.availability_end}, ${data.meetingTypes?.length || 0} meeting types`
  }
}

async function executeCalendarCheckAvailability(input, env) {
  const userEmail = (input.userEmail || '').trim()
  const date = (input.date || '').trim()
  if (!userEmail) throw new Error('userEmail is required')
  if (!date) throw new Error('date is required (YYYY-MM-DD)')

  const res = await env.CALENDAR_WORKER.fetch(
    `https://calendar-worker/api/public/bookings?user=${encodeURIComponent(userEmail)}&date=${date}`
  )
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to check availability')

  const bookings = data.bookings || []
  return {
    date,
    bookedSlots: bookings,
    count: bookings.length,
    message: bookings.length === 0
      ? `No bookings on ${date} — all slots are free`
      : `${bookings.length} occupied slot(s) on ${date}`
  }
}

async function executeCalendarListBookings(input, env) {
  const userEmail = (input.userEmail || '').trim()
  const date = (input.date || '').trim()
  if (!userEmail) throw new Error('userEmail is required')
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date must be YYYY-MM-DD if provided')

  const res = await env.CALENDAR_WORKER.fetch(
    'https://calendar-worker/api/admin/bookings',
    { headers: { 'X-User-Email': userEmail } }
  )
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to list bookings')

  const allBookings = data.bookings || []
  const toDateKey = (value) => {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return ''
    return parsed.toISOString().slice(0, 10)
  }

  const bookings = date
    ? allBookings.filter(booking => toDateKey(booking.start_time) === date)
    : allBookings

  const today = new Date().toISOString().slice(0, 10)
  const startOfToday = new Date(`${today}T00:00:00.000Z`)
  const todayBookings = allBookings.filter(booking => toDateKey(booking.start_time) === today)
  const upcomingBookings = allBookings
    .filter(booking => {
      const start = new Date(booking.start_time)
      return !Number.isNaN(start.getTime()) && start >= startOfToday
    })
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
  const nextBooking = upcomingBookings[0] || null

  return {
    bookings,
    count: bookings.length,
    date: date || null,
    today,
    todayBookings,
    todayCount: todayBookings.length,
    nextBooking,
    message: date
      ? (bookings.length === 0
          ? `No bookings found for ${userEmail} on ${date}`
          : `Found ${bookings.length} booking(s) for ${userEmail} on ${date}`)
      : (bookings.length === 0
          ? `No bookings found for ${userEmail}`
          : `Found ${bookings.length} booking(s) for ${userEmail}; ${todayBookings.length} on ${today}`)
  }
}

async function executeCalendarCreateBooking(input, env) {
  const ownerEmail = (input.ownerEmail || '').trim()
  const guestName = (input.guestName || '').trim()
  const guestEmail = (input.guestEmail || '').trim()
  const startTime = (input.startTime || '').trim()
  const endTime = (input.endTime || '').trim()
  if (!ownerEmail) throw new Error('ownerEmail is required')
  if (!guestName) throw new Error('guestName is required')
  if (!guestEmail) throw new Error('guestEmail is required')
  if (!startTime) throw new Error('startTime is required (ISO 8601)')
  if (!endTime) throw new Error('endTime is required (ISO 8601)')

  const res = await env.CALENDAR_WORKER.fetch(
    'https://calendar-worker/api/bookings',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        owner_email: ownerEmail,
        guest_name: guestName,
        guest_email: guestEmail,
        start_time: startTime,
        end_time: endTime,
        description: input.description || '',
        meeting_type_id: input.meetingTypeId || null
      })
    }
  )
  const data = await res.json()

  if (res.status === 409) {
    return {
      success: false,
      conflict: true,
      message: data.error || 'This time slot is already booked. Please choose a different time.'
    }
  }
  if (!res.ok) throw new Error(data.error || 'Failed to create booking')

  return {
    success: true,
    bookingId: data.bookingId,
    googleSynced: data.google_synced,
    message: `Booking created (ID: ${data.bookingId}). ${data.google_synced ? 'Synced to Google Calendar.' : 'Google Calendar not connected — booking saved in D1 only.'}`
  }
}

async function executeCalendarRescheduleBooking(input, env) {
  const userEmail = (input.userEmail || '').trim()
  const bookingId = input.bookingId
  const newStartTime = (input.newStartTime || '').trim()
  const newEndTime = (input.newEndTime || '').trim()

  if (!userEmail) throw new Error('userEmail is required')
  if (!bookingId) throw new Error('bookingId is required')
  if (!newStartTime) throw new Error('newStartTime is required (ISO 8601)')
  if (!newEndTime) throw new Error('newEndTime is required (ISO 8601)')

  const res = await env.CALENDAR_WORKER.fetch(
    'https://calendar-worker/api/admin/bookings',
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Email': userEmail
      },
      body: JSON.stringify({
        id: bookingId,
        start_time: newStartTime,
        end_time: newEndTime
      })
    }
  )
  const data = await res.json()

  if (res.status === 409) {
    return {
      success: false,
      conflict: true,
      message: data.error || 'The new time slot conflicts with an existing booking. Please choose a different time.'
    }
  }
  if (res.status === 404) {
    return {
      success: false,
      message: data.error || 'Booking not found. It may have been deleted.'
    }
  }
  if (!res.ok) throw new Error(data.error || 'Failed to reschedule booking')

  return {
    success: true,
    bookingId: data.bookingId,
    googleUpdated: data.google_updated,
    message: `Booking ${data.bookingId} rescheduled to ${newStartTime} — ${newEndTime}. ${data.google_updated ? 'Google Calendar updated.' : 'Google Calendar not updated (not synced or not connected).'}`
  }
}

async function executeCalendarDeleteBooking(input, env) {
  const userEmail = (input.userEmail || '').trim()
  const bookingId = input.bookingId

  if (!userEmail) throw new Error('userEmail is required')
  if (!bookingId) throw new Error('bookingId is required')

  const res = await env.CALENDAR_WORKER.fetch(
    `https://calendar-worker/api/admin/bookings?id=${bookingId}`,
    {
      method: 'DELETE',
      headers: { 'X-User-Email': userEmail }
    }
  )
  const data = await res.json()

  if (res.status === 404) {
    return {
      success: false,
      message: data.error || 'Booking not found. It may have already been deleted.'
    }
  }
  if (!res.ok) throw new Error(data.error || 'Failed to delete booking')

  return {
    success: true,
    googleDeleted: data.google_deleted,
    message: `Booking ${bookingId} has been cancelled and removed. ${data.google_deleted ? 'Also removed from Google Calendar.' : ''}`
  }
}

async function executeCalendarGetStatus(input, env) {
  const userEmail = (input.userEmail || '').trim()
  if (!userEmail) throw new Error('userEmail is required')

  const res = await env.CALENDAR_WORKER.fetch(
    'https://calendar-worker/api/auth/calendar-status',
    { headers: { 'X-User-Email': userEmail } }
  )
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to check calendar status')

  return {
    connected: data.connected,
    message: data.connected
      ? `Google Calendar is connected for ${userEmail}`
      : `Google Calendar is NOT connected for ${userEmail}`
  }
}

// ── Bot tools (used by chatbot subagent) ──────────────────────────

async function executeSearchKnowledge(input, env) {
  // Accept both 'query' (from search_knowledge) and 'q' (from search_graphs)
  const query = (input.query || input.q || '').trim()
  const nodeType = (input.nodeType || '').trim()
  const category = (input.category || '').trim()
  if (!query && !nodeType && !category) throw new Error('query, nodeType, or category is required')
  const params = new URLSearchParams()
  if (query) params.set('q', query)
  if (nodeType) params.set('nodeType', nodeType)
  if (category) params.set('category', category)
  if (input.limit) params.set('limit', String(input.limit))
  if (input.offset) params.set('offset', String(input.offset))
  const res = await env.KG_WORKER.fetch(`https://knowledge-graph-worker/searchGraphs?${params}`, { headers: { 'x-user-role': 'Superadmin' } })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Search failed')
  return { results: data.results || data.graphs || [], count: (data.results || data.graphs || []).length }
}

async function executeTranslate(input, env) {
  const text = (input.text || '').trim()
  const targetLang = (input.target_language || '').trim()
  if (!text) throw new Error('text is required')
  if (!targetLang) throw new Error('target_language is required')

  // Use Anthropic to translate via a simple prompt
  const res = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: 'system:translate',
      messages: [{ role: 'user', content: `Translate the following text to ${targetLang}. Return ONLY the translated text, nothing else.\n\n${text}` }],
      model: MODELS.HAIKU,
      max_tokens: 2048,
      temperature: 0,
    })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Translation failed')
  const translated = (data.content || []).find(c => c.type === 'text')?.text || ''
  return { original: text, translated, target_language: targetLang, source_language: input.source_language || 'auto' }
}

// ── App showcase (Vegr.ai App Catalog) ───────────────────────────
// Build/refresh the World-Founder-facing showcase on each app node of the
// App Catalog graph: logo (from the Assets album, label '<slug>-logo') +
// a generated benefit pitch. Idempotent; original catalog content is kept
// losslessly in the node's showcaseSourceInfo field. Superadmin only.

const APP_CATALOG_GRAPH_ID = '6074a2bf-082b-4e92-a91d-eeab94c69b66'

function slugifyAppName(label) {
  return String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function extractDevLinks(text) {
  const urls = String(text || '').match(/https?:\/\/[^\s)\]]+/g) || []
  const repo = urls.find(u => /github\.com/i.test(u)) || null
  const live = urls.find(u => !/github\.com/i.test(u)) || null
  return { live, repo }
}

function buildShowcaseInfo({ name, logoUrl, tagline, cards, live, repo }) {
  const cardBlock = cards.slice(0, 3).map(c => `**${c.title}**\n${c.body}`).join('\n\n')
  let info = ''
  info += `![${name} logo|width:120px; height:auto; margin: '0 auto'](${logoUrl}?w=240&auto=format)\n\n`
  info += `[FANCY | font-size: 2.4em; color: #0f2a43; text-align: center]\n${name}\n[END FANCY]\n\n`
  info += `[SECTION | background-color: #f4f8fb; color: #1a1a1a; padding: 18px; border-radius: 10px; font-size: 1.15em]\n${tagline}\n[END SECTION]\n\n`
  info += `[FLEXBOX-CARDS]\n${cardBlock}\n[END FLEXBOX]`
  const footerBits = []
  if (live) footerBits.push(`Live: ${live}`)
  if (repo) footerBits.push(`Repo: ${repo}`)
  if (footerBits.length) {
    info += `\n\n[SECTION | background-color: #ffffff; color: #555555; padding: 10px; border-radius: 8px; font-size: 0.95em]\n${footerBits.join('  ·  ')}\n[END SECTION]`
  }
  return info
}

async function generateAppPitch(env, { name, sourceInfo, userId }) {
  const prompt = `You are writing a short product pitch for "${name}", one app in the Vegr.ai platform. The reader is a "World Founder" — a non-technical community builder who does NOT know this app and is deciding whether to add it to their own branded online space (their "World"). Write benefit-first, plain language, no jargon, no developer terms. Frame everything as what it gives THEIR World and members.

Source description (may be technical — translate it into founder benefits):
${String(sourceInfo || '').slice(0, 1500)}

Return ONLY a JSON object, no markdown fences:
{
  "tagline": "one line, max ~90 chars, what this gives your World",
  "cards": [
    { "title": "2-3 words", "body": "max ~110 chars benefit" },
    { "title": "2-3 words", "body": "max ~110 chars benefit" },
    { "title": "2-3 words", "body": "max ~110 chars benefit" }
  ]
}`
  const res = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: userId || 'system:app-showcase',
      messages: [{ role: 'user', content: prompt }],
      model: 'claude-sonnet-4-6',
      max_tokens: 700,
      temperature: 0.4,
    }),
  })
  if (!res.ok) throw new Error(`pitch generation failed (status ${res.status})`)
  const data = await res.json()
  const textBlock = (data.content || []).find(b => b.type === 'text')
  if (!textBlock) throw new Error('no pitch returned from Claude')
  let parsed
  try {
    parsed = JSON.parse(textBlock.text.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim())
  } catch {
    throw new Error('Claude returned non-JSON pitch')
  }
  const tagline = String(parsed.tagline || '').trim()
  const cards = Array.isArray(parsed.cards)
    ? parsed.cards.filter(c => c && c.title && c.body).slice(0, 3)
    : []
  if (!tagline || cards.length < 3) throw new Error('pitch missing tagline or 3 cards')
  return { tagline, cards }
}

async function executeGenerateAppShowcase(input, env) {
  // Superadmin gate
  const callerId = input?.authContext?.email || input?.authContext?.userId || input?.userId
  const profile = callerId ? await resolveUserProfile(callerId, env) : null
  const role = String(profile?.role || input?.authContext?.role || '').toLowerCase()
  if (role !== 'superadmin') throw new Error('generate_app_showcase requires Superadmin.')

  const authToken = getAuthTokenFromToolInput(input)
  if (!authToken) throw new Error('You must be logged in (no API token) to read the Assets album.')

  const graphId = (typeof input.graphId === 'string' && input.graphId.trim()) || APP_CATALOG_GRAPH_ID
  const albumName = (typeof input.albumName === 'string' && input.albumName.trim()) || 'Assets'
  const regenerate = input.regenerate === true
  const target = (typeof input.app === 'string' && input.app.trim()) ? input.app.trim() : 'all'
  const targetSlug = target.toLowerCase() === 'all' ? 'all' : slugifyAppName(target)

  // 1. Logo index from the Assets album: label '<slug>-logo' -> imgix url
  const albumData = await photosApiFetch({ env, authToken, path: `/list-r2-images?album=${encodeURIComponent(albumName)}` })
  const logoByLabel = {}
  for (const img of (albumData.images || [])) {
    const label = String(img.name || img.displayName || '').trim().toLowerCase()
    if (label.endsWith('-logo') && img.url) logoByLabel[label] = img.url
  }

  // 2. Catalog graph
  const { graph } = await fetchGraphForVersion(graphId, env)
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []
  if (!nodes.length) throw new Error(`Catalog graph ${graphId} has no nodes`)

  const updated = []
  const skipped = []

  for (const node of nodes) {
    const slug = slugifyAppName(node.label)
    if (!slug) continue
    if (targetSlug !== 'all' && slug !== targetSlug) continue

    const logoUrl = logoByLabel[`${slug}-logo`]
    if (!logoUrl) {
      // No logo in Assets — never touch the node (covers + logo-less apps).
      skipped.push({ app: node.label, slug, reason: `no '${slug}-logo' image in album '${albumName}'` })
      continue
    }

    const alreadyHasShowcase = Number(node.showcaseVersion || 0) > 0
    if (alreadyHasShowcase && !regenerate) {
      skipped.push({ app: node.label, slug, reason: 'already has showcase (pass regenerate:true to rewrite)' })
      continue
    }

    // Lossless source — the original catalog content, preserved across regenerations.
    const sourceInfo = (alreadyHasShowcase && typeof node.showcaseSourceInfo === 'string')
      ? node.showcaseSourceInfo
      : (node.info || '')

    let pitch
    try {
      pitch = await generateAppPitch(env, { name: node.label, sourceInfo, userId: callerId })
    } catch (err) {
      skipped.push({ app: node.label, slug, reason: `pitch failed: ${err.message}` })
      continue
    }

    const { live, repo } = extractDevLinks(sourceInfo)
    const info = buildShowcaseInfo({ name: node.label, logoUrl, tagline: pitch.tagline, cards: pitch.cards, live, repo })
    const fields = {
      info,
      showcaseVersion: Number(node.showcaseVersion || 0) + 1,
      showcaseUpdatedAt: new Date().toISOString(),
    }
    if (!alreadyHasShowcase) fields.showcaseSourceInfo = sourceInfo

    try {
      await patchNodeWithVersionRetry(env, graphId, node.id, fields)
      updated.push({ app: node.label, slug, logoUrl, nodeId: node.id })
    } catch (err) {
      skipped.push({ app: node.label, slug, reason: `patch failed: ${err.message}` })
    }
  }

  if (targetSlug !== 'all' && !updated.length && !skipped.length) {
    throw new Error(`No catalog node matched app '${target}' (slug '${targetSlug}')`)
  }

  return {
    message: `App showcase: ${updated.length} updated, ${skipped.length} skipped`,
    graphId,
    album: albumName,
    updated,
    skipped,
    viewUrl: `https://www.vegvisr.org/gnew-viewer?graphId=${graphId}`,
  }
}

// ── Tool dispatcher ───────────────────────────────────────────────

async function executeTool(toolName, toolInput, env, operationMap, onProgress) {
  const progress = typeof onProgress === 'function' ? onProgress : () => {}
  switch (toolName) {
    case 'create_graph':
      return await executeCreateGraph(toolInput, env)
    case 'create_html_node':
      return await executeCreateHtmlNode(toolInput, env)
    case 'create_node':
      return await executeCreateNode(toolInput, env)
    case 'add_edge':
      return await executeAddEdge(toolInput, env)
    case 'get_contract':
      return await executeGetContract(toolInput, env)
    case 'get_html_template':
      return await executeGetHtmlTemplate(toolInput, env)
    case 'create_html_from_template':
      return await executeCreateHtmlFromTemplate(toolInput, env)
    case 'read_graph':
      return await executeReadGraph(toolInput, env)
    case 'read_graph_content':
      return await executeReadGraphContent(toolInput, env)
    case 'read_node':
      return await executeReadNode(toolInput, env)
    case 'patch_node':
      return await executePatchNode(toolInput, env)
    case 'patch_node_metadata':
      return await executePatchNodeMetadata(toolInput, env)
    case 'edit_html_node':
      return await executeEditHtmlNode(toolInput, env)
    case 'create_subdomain':
      return await executeCreateSubdomain(toolInput, env)
    case 'publish_html_node':
      return await executePublishHtmlNode(toolInput, env)
    case 'replace_html_section':
      return await executeReplaceHtmlSection(toolInput, env)
    case 'list_html_anchors':
      return await executeListHtmlAnchors(toolInput, env)
    case 'list_graph_versions':
      return await executeListGraphVersions(toolInput, env)
    case 'get_graph_version':
      return await executeGetGraphVersion(toolInput, env)
    case 'restore_graph_version':
      return await executeRestoreGraphVersion(toolInput, env)
    case 'restore_html_node_version':
      return await executeRestoreHtmlNodeVersion(toolInput, env)
    case 'patch_graph_metadata':
      return await executePatchGraphMetadata(toolInput, env)
    case 'list_graphs':
      return await executeListGraphs(toolInput, env)
    case 'list_meta_areas':
      return await executeListMetaAreas(toolInput, env)
    case 'search_knowledge':
    case 'search_graphs':
      return await executeSearchKnowledge(toolInput, env)
    case 'translate':
      return await executeTranslate(toolInput, env)
    case 'perplexity_search':
      return await executePerplexitySearch(toolInput, env)
    case 'fetch_url':
      return await executeFetchUrl(toolInput, env)
    case 'search_pexels':
      return await executeSearchPexels(toolInput, env)
    case 'search_unsplash':
      return await executeSearchUnsplash(toolInput, env)
    case 'get_album_images':
      return await executeGetAlbumImages(toolInput, env)
    case 'generate_app_showcase':
      return await executeGenerateAppShowcase(toolInput, env)
    case 'album_list':
      return await executeAlbumList(toolInput, env)
    case 'album_get':
      return await executeAlbumGet(toolInput, env)
    case 'album_create_or_update':
      return await executeAlbumCreateOrUpdate(toolInput, env)
    case 'album_delete':
      return await executeAlbumDelete(toolInput, env)
    case 'album_add_images':
      return await executeAlbumAddImages(toolInput, env)
    case 'album_remove_images':
      return await executeAlbumRemoveImages(toolInput, env)
    case 'album_publish':
      return await executeAlbumPublish(toolInput, env)
    case 'album_rotate_share':
      return await executeAlbumRotateShare(toolInput, env)
    case 'photos_list':
      return await executePhotosList(toolInput, env)
    case 'photos_upload_from_url':
      return await executePhotosUploadFromUrl(toolInput, env)
    case 'photos_delete':
      return await executePhotosDelete(toolInput, env)
    case 'analyze_image':
      return await executeAnalyzeImage(toolInput, env)
    case 'get_formatting_reference':
      return { reference: FORMATTING_REFERENCE }
    case 'get_node_types_reference': {
      // Hybrid: hardcoded reference + live graphTemplates from D1
      const result = { reference: NODE_TYPES_REFERENCE }
      try {
        const kgResp = await env.KG_WORKER.fetch('https://knowledge.vegvisr.org/getTemplates', {
          headers: { 'x-user-role': 'Superadmin' }
        })
        if (kgResp.ok) {
          const tplData = await kgResp.json()
          const templates = Array.isArray(tplData) ? tplData : (tplData.templates || tplData.results || [])
          result.graphTemplates = templates.map(t => {
            const entry = {
              id: t.id, name: t.name || t.title, category: t.category || '',
              description: t.description || ''
            }
            // Include ai_instructions so the agent knows HOW to use each template
            if (t.ai_instructions) entry.ai_instructions = t.ai_instructions
            // Include node type summary so the agent knows WHAT nodes a template creates
            if (t.nodes) {
              try {
                const nodes = typeof t.nodes === 'string' ? JSON.parse(t.nodes) : t.nodes
                if (Array.isArray(nodes)) {
                  entry.nodeTypes = nodes.map(n => ({ id: n.id, type: n.type, label: n.label }))
                }
              } catch (e) { /* skip unparseable nodes */ }
            }
            return entry
          })
          result.graphTemplatesCount = result.graphTemplates.length
          result.source = 'Hardcoded node type reference from system-prompt.js + live graphTemplates from D1 database (vegvisr_org)'
        } else {
          result.graphTemplatesError = `Could not fetch graphTemplates: ${kgResp.status}`
          result.source = 'Hardcoded node type reference from system-prompt.js (graphTemplates query failed)'
        }
      } catch (e) {
        result.graphTemplatesError = e.message
        result.source = 'Hardcoded node type reference from system-prompt.js (graphTemplates query failed)'
      }
      return result
    }
    case 'get_html_builder_reference':
      return { reference: HTML_BUILDER_REFERENCE }
    case 'get_vemotion_reference':
      return { reference: VEMOTION_REFERENCE }
    case 'who_am_i':
      return await executeWhoAmI(toolInput, env)
    case 'list_recordings':
      return await executeListRecordings(toolInput, env)
    case 'list_realtime_videos':
      return await executeListRealtimeVideos(toolInput, env)
    case 'vemotion_save_composition':
      return await executeVemotionSaveComposition(toolInput, env)
    case 'vemotion_get_composition':
      return await executeVemotionGetComposition(toolInput, env)
    case 'vemotion_list_compositions':
      return await executeVemotionListCompositions(toolInput, env)
    case 'vemotion_refit_composition':
      return await executeVemotionRefitComposition(toolInput, env)
    case 'vemotion_generate_structure':
      return await executeVemotionGenerateStructure(toolInput, env)
    case 'vemotion_create_carousel':
      return await executeVemotionCreateCarousel(toolInput, env)
    case 'get_carousel_reference':
      return { reference: CAROUSEL_REFERENCE }
    case 'transcribe_audio':
      return await executeTranscribeAudio(toolInput, env)
    case 'analyze_node':
      return await executeAnalyzeNode(toolInput, env)
    case 'analyze_graph':
      return await executeAnalyzeGraph(toolInput, env)
    case 'analyze_transcription':
      return await executeAnalyzeTranscription(toolInput, env, progress)
    case 'admin_register_user':
      return await executeAdminRegisterUser(toolInput, env)
    case 'register_world_founder':
      return await executeRegisterWorldFounder(toolInput, env)
    case 'publish_world_page':
      return await executePublishWorldPage(toolInput, env)
    case 'publish_all_world_pages':
      return await executePublishAllWorldPages(toolInput, env)
    case 'deploy_world_proxy':
      return await executeDeployWorldProxy(toolInput, env)
    case 'set_world_credentials':
      return await executeSetWorldCredentials(toolInput, env)
    case 'check_world_credentials':
      return await executeCheckWorldCredentials(toolInput, env)
    case 'provision_world_kv':
      return await executeProvisionWorldKv(toolInput, env)
    case 'check_world_publish':
      return await executeCheckWorldPublish(toolInput, env)
    case 'get_world_app_interests':
      return await executeGetWorldAppInterests(toolInput, env)
    case 'list_challenge_templates':
      return await executeListChallengeTemplates(toolInput, env)
    case 'backup_challenge_templates_to_kg':
      return await executeBackupChallengeTemplatesToKg(toolInput, env)
    case 'restore_challenge_template_from_kg':
      return await executeRestoreChallengeTemplateFromKg(toolInput, env)
    case 'list_world_founder_templates':
      return await executeListWorldFounderTemplates(toolInput, env)
    case 'save_world_founder_template':
      return await executeSaveWorldFounderTemplate(toolInput, env)
    case 'backup_world_founder_templates_to_kg':
      return await executeBackupWorldFounderTemplatesToKg(toolInput, env)
    case 'restore_world_founder_template_from_kg':
      return await executeRestoreWorldFounderTemplateFromKg(toolInput, env)
    case 'publish_challenge_page':
      return await executePublishChallengePage(toolInput, env)
    case 'create_challenge':
      return await executeCreateChallenge(toolInput, env)
    case 'list_challenge_participants':
      return await executeListChallengeParticipants(toolInput, env)
    case 'get_participant_graph':
      return await executeGetParticipantGraph(toolInput, env)
    case 'set_world_publish_secret':
      return await executeSetWorldPublishSecret(toolInput, env)
    case 'store_user_api_key':
      return await executeStoreUserApiKey(toolInput, env)
    case 'remove_user_api_key':
      return await executeRemoveUserApiKey(toolInput, env)
    case 'send_email':
      return await executeSendEmail(toolInput, env)
    case 'add_email_account':
      return await executeAddEmailAccount(toolInput, env)
    case 'set_email_password':
      return await executeSetEmailPassword(toolInput, env)
    case 'list_email_accounts':
      return await executeListEmailAccounts(toolInput, env)
    case 'add_email_destination':
      return await executeAddEmailDestination(toolInput, env)
    case 'save_form_data':
      return await executeSaveFormData(toolInput, env)
    case 'query_data_nodes':
      return await executeQueryDataNodes(toolInput, env)
    case 'create_app_table':
      return await executeCreateAppTable(toolInput, env)
    case 'insert_app_record':
      return await executeInsertAppRecord(toolInput, env)
    case 'query_app_table':
      return await executeQueryAppTable(toolInput, env)
    case 'delete_app_records':
      return await executeDeleteAppRecords(toolInput, env)
    case 'generate_with_ai':
      return await executeGenerateWithAi(toolInput, env)
    case 'save_learning':
      return await executeSaveLearning(toolInput, env)
    case 'list_contacts':
      return await executeListContacts(toolInput, env)
    case 'search_contacts':
      return await executeSearchContacts(toolInput, env)
    case 'get_contact_logs':
      return await executeGetContactLogs(toolInput, env)
    case 'add_contact_log':
      return await executeAddContactLog(toolInput, env)
    case 'create_contact':
      return await executeCreateContact(toolInput, env)
    case 'get_app_table_schema':
      return await executeGetAppTableSchema(toolInput, env)
    case 'add_app_table_column':
      return await executeAddAppTableColumn(toolInput, env)
    case 'list_chat_groups':
      return await executeListChatGroups(toolInput, env)
    case 'add_user_to_chat_group':
      return await executeAddUserToChatGroup(toolInput, env)
    case 'get_group_messages':
      return await executeGetGroupMessages(toolInput, env)
    case 'get_group_stats':
      return await executeGetGroupStats(toolInput, env)
    case 'send_group_message':
      return await executeSendGroupMessage(toolInput, env)
    case 'create_chat_group':
      return await executeCreateChatGroup(toolInput, env)
    case 'register_chat_bot':
      return await executeRegisterChatBot(toolInput, env)
    case 'get_group_members':
      return await executeGetGroupMembers(toolInput, env)
    case 'trigger_bot_response':
      return await executeTriggerBotResponse(toolInput, env)
    case 'delete_chat_group':
      return await executeDeleteChatGroup(toolInput, env)
    case 'restore_chat_group':
      return await executeRestoreChatGroup(toolInput, env)
    case 'update_chat_group':
      return await executeUpdateChatGroup(toolInput, env)
    case 'remove_chat_bot':
      return await executeRemoveChatBot(toolInput, env)
    case 'list_bots':
      return await executeListBots(toolInput, env)
    case 'get_bot':
      return await executeGetBot(toolInput, env)
    case 'update_chat_bot':
      return await executeUpdateChatBot(toolInput, env)
    case 'list_agents':
      return await executeListAgents(env)
    case 'get_agent':
      return await executeGetAgent(toolInput, env)
    case 'create_agent':
      return await executeCreateAgent(toolInput, env)
    case 'update_agent':
      return await executeUpdateAgent(toolInput, env)
    case 'deactivate_agent':
      return await executeDeactivateAgent(toolInput, env)
    case 'upload_agent_avatar':
      return await executeUploadAgentAvatar(toolInput, env)
    case 'generate_image':
      return await executeGenerateImage(toolInput, env)
    case 'delegate_to_agent_builder': {
      const result = await runAgentBuilderSubagent(toolInput, env, progress, executeTool)
      return {
        success: result.success,
        summary: result.summary,
        agentId: result.agentId,
        turns: result.turns,
        model: result.model,
        inputTokens: result.inputTokens || 0,
        outputTokens: result.outputTokens || 0,
        actionsPerformed: (result.actions || []).map(a => ({
          tool: a.tool, success: a.success, summary: a.summary || a.error,
        })),
        message: result.success
          ? `Agent builder subagent completed: ${(result.summary || '').slice(0, 500)}`
          : `Agent builder subagent failed: ${result.error || 'Unknown error'}`,
      }
    }
    case 'create_poll':
      return await executeCreatePoll(toolInput, env)
    case 'close_poll':
      return await executeClosePoll(toolInput, env)
    case 'get_poll_results':
      return await executeGetPollResults(toolInput, env)
    case 'delegate_to_chat': {
      const result = await runChatSubagent(toolInput, env, progress, executeTool)
      return {
        success: result.success,
        summary: result.summary,
        groupId: result.groupId,
        turns: result.turns,
        model: result.model,
        inputTokens: result.inputTokens || 0,
        outputTokens: result.outputTokens || 0,
        actionsPerformed: (result.actions || []).map(a => ({
          tool: a.tool, success: a.success, summary: a.summary || a.error,
        })),
        message: result.success
          ? `Chat subagent completed: ${(result.summary || '').slice(0, 500)}`
          : `Chat subagent failed: ${result.error || 'Unknown error'}`,
      }
    }
    case 'describe_capabilities':
      return await executeDescribeCapabilities(toolInput, env)
    case 'get_system_registry':
      return await executeGetSystemRegistry(toolInput, env)
    case 'get_secure_worker_template':
      return await executeGetSecureWorkerTemplate(toolInput, env)
    case 'create_capability_blueprint':
      return await executeCreateCapabilityBlueprint(toolInput, env)
    case 'build_capability_worker_scaffold':
      return await executeBuildCapabilityWorkerScaffold(toolInput, env)
    case 'deploy_worker':
      return await executeDeployWorker(toolInput, env)
    case 'register_deployed_worker':
      return await executeRegisterDeployedWorker(toolInput, env)
    case 'register_capability_worker':
      return await executeRegisterCapabilityWorker(toolInput, env)
    case 'read_worker':
      return await executeReadWorker(toolInput, env)
    case 'delete_worker':
      return await executeDeleteWorker(toolInput, env)
    case 'invoke_registry_worker':
      return await executeInvokeRegistryWorker(toolInput, env)
    case 'db_list_tables':
      return await executeDbListTables(env)
    case 'db_query':
      return await executeDbQuery(toolInput, env)
    case 'onboarding_status':
      return await executeOnboardingStatus(toolInput, env)
    case 'calendar_list_tables':
      return await executeCalendarListTables(env)
    case 'calendar_query':
      return await executeCalendarQuery(toolInput, env)
    case 'chat_db_list_tables':
      return await executeChatDbListTables(env)
    case 'chat_db_query':
      return await executeChatDbQuery(toolInput, env)
    case 'add_whats_new':
      return await executeAddWhatsNew(toolInput, env)
    case 'add_user_suggestion':
      return await executeAddUserSuggestion(toolInput, env)
    case 'update_suggestion_status':
      return await executeUpdateSuggestionStatus(toolInput, env)
    case 'reorder_nodes':
      return await executeReorderNodes(toolInput, env)
    case 'calendar_get_settings':
      return await executeCalendarGetSettings(toolInput, env)
    case 'calendar_check_availability':
      return await executeCalendarCheckAvailability(toolInput, env)
    case 'calendar_list_bookings':
      return await executeCalendarListBookings(toolInput, env)
    case 'calendar_create_booking':
      return await executeCalendarCreateBooking(toolInput, env)
    case 'calendar_reschedule_booking':
      return await executeCalendarRescheduleBooking(toolInput, env)
    case 'calendar_delete_booking':
      return await executeCalendarDeleteBooking(toolInput, env)
    case 'calendar_get_status':
      return await executeCalendarGetStatus(toolInput, env)
    case 'delegate_to_html_builder': {
      // Pre-validate & pre-analyze before delegating — gives the subagent a head start
      const enrichedInput = { ...toolInput }
      if (toolInput.graphId && toolInput.nodeId) {
        try {
          const [structure, validation] = await Promise.all([
            executeGetHtmlStructure({ graphId: toolInput.graphId, nodeId: toolInput.nodeId }, env),
            executeValidateHtmlSyntax({ graphId: toolInput.graphId, nodeId: toolInput.nodeId }, env),
          ])
          // Prepend analysis to the task so the subagent starts informed
          let preContext = `\n\n## Pre-analysis (from orchestrator)\n`
          preContext += `**File structure**: ${structure.summary}\n`
          if (structure.scriptBlocks?.length > 0) {
            preContext += `**Script blocks**:\n`
            for (const block of structure.scriptBlocks) {
              preContext += `  - Lines ${block.startLine}-${block.endLine} (${block.lineCount} lines): ${block.functions.map(f => f.name).join(', ') || 'no named functions'}\n`
            }
          }
          if (validation.valid) {
            preContext += `**Syntax**: All brackets balanced ✓\n`
          } else {
            preContext += `**Syntax issues** (${validation.issueCount}):\n`
            for (const issue of (validation.issues || []).slice(0, 5)) {
              preContext += `  - ${issue.message}\n`
            }
            preContext += `Fix these FIRST. Use read_html_section with startLine/endLine around the reported lines.\n`
          }
          enrichedInput.task = (toolInput.task || '') + preContext
        } catch (e) {
          console.log(`[delegate_to_html_builder] pre-analysis failed: ${e.message}`)
        }
      }
      // GROUND-TRUTH VERIFICATION GATE (Lesson 33): the subagent's free-text summary
      // has repeatedly claimed "✅ edited/verified" for edits that never changed the
      // node — a phantom success the parent then relays to the user. The model's word
      // is NOT proof. Read the node content BEFORE and AFTER; if an edit was attempted
      // but the bytes are identical, the edit did NOT land — force success:false no
      // matter what the summary says.
      const readNodeInfo = async (gId, nId) => {
        if (!gId || !nId) return null
        try {
          const r = await env.KG_WORKER.fetch(`https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(gId)}`)
          if (!r.ok) return null
          const g = await r.json()
          const n = (g.nodes || []).find(x => x.id === nId)
          return n ? String(n.info || '') : null
        } catch { return null }
      }
      const beforeInfo = await readNodeInfo(toolInput.graphId, toolInput.nodeId)

      const result = await runHtmlBuilderSubagent(enrichedInput, env, progress, executeTool)

      const verifyGraphId = result.graphId || toolInput.graphId
      const verifyNodeId = result.nodeId || toolInput.nodeId
      const afterInfo = await readNodeInfo(verifyGraphId, verifyNodeId)
      const editAttempted = (result.actions || []).some(a =>
        ['edit_html_node', 'create_html_node', 'create_html_from_template', 'rollback_html_node'].includes(a.tool))
      const haveBothReads = beforeInfo !== null && afterInfo !== null
      const contentChanged = haveBothReads ? (beforeInfo !== afterInfo) : null
      const charDelta = haveBothReads ? (afterInfo.length - beforeInfo.length) : null
      // Graph version AFTER the edit — surfaced so the agent can always report "now on vN"
      // and the user knows exactly which version to roll back to.
      let graphVersion = null
      try { graphVersion = Number((await fetchGraphForVersion(verifyGraphId, env)).version) } catch { /* non-fatal */ }

      // Phantom-success detection: subagent claims success + tried to edit, but the
      // node is byte-identical → the change did not persist. Override to failure.
      const phantomSuccess = result.success === true && editAttempted && contentChanged === false
      // FALSE-NEGATIVE fix (L36): the subagent can run out of turns AFTER its edit
      // already landed, returning success:false — but the bytes DID change. Reporting a
      // flat failure then (a) lies the other way and (b) blocks the frontend from
      // refreshing the preview (it only refreshes on success), so the user sees a STALE
      // page and concludes nothing happened. Treat "changed but not cleanly finished" as
      // a success WITH a verify-caveat, so the preview refreshes and the truth shows.
      const landedButUnconfirmed = result.success === false && contentChanged === true
      const finalSuccess = phantomSuccess ? false : (result.success || landedButUnconfirmed)

      let message
      if (phantomSuccess) {
        message = `HTML Builder reported success but the node content DID NOT CHANGE (still ${afterInfo.length} chars, byte-identical). The edit did NOT land — do NOT tell the user it is done. Re-run with an exact old→new instruction (quote the precise text to replace), or the change genuinely made no difference.`
      } else if (landedButUnconfirmed) {
        message = `HTML Builder did NOT finish cleanly (${result.error || 'ran out of turns'}), BUT the node content DID change (${charDelta >= 0 ? '+' : ''}${charDelta} chars${graphVersion !== null ? `, now v${graphVersion}` : ''}). The edit landed but was not fully confirmed by the builder — tell the user exactly what changed and to verify it matches the request, and re-run if it looks incomplete. Do NOT claim the preview auto-refreshed unless you know it did.`
      } else if (finalSuccess) {
        const proof = contentChanged === true ? ` [verified: content changed, ${charDelta >= 0 ? '+' : ''}${charDelta} chars${graphVersion !== null ? `, now v${graphVersion}` : ''}]` : ''
        message = `HTML Builder completed: ${(result.summary || '').slice(0, 500)}${proof}`
      } else {
        message = `HTML Builder failed: ${result.error || 'Unknown error'}`
      }

      return {
        success: finalSuccess,
        summary: result.summary,
        graphId: result.graphId,
        nodeId: result.nodeId,
        turns: result.turns,
        model: result.model,
        inputTokens: result.inputTokens || 0,
        outputTokens: result.outputTokens || 0,
        contentChanged,
        charDelta,
        version: graphVersion,
        phantomSuccess,
        savedNotLive: finalSuccess && contentChanged === true,
        publishReminder: (finalSuccess && contentChanged === true)
          ? `Change saved${graphVersion !== null ? ` as v${graphVersion}` : ''} in the graph, NOT live on any domain until published. Tell the user the new version${graphVersion !== null ? ` ("nå på v${graphVersion}", roll back any time with restore_html_node_version)` : ''} AND that it is saved-but-not-live — ask whether to publish (publish_html_node). Do not auto-publish.`
          : undefined,
        actionsPerformed: (result.actions || []).map(a => ({
          tool: a.tool, success: a.success, summary: a.summary || a.error,
        })),
        message,
        viewUrl: result.graphId
          ? `https://www.vegvisr.org/gnew-viewer?graphId=${result.graphId}`
          : undefined,
      }
    }
    case 'delegate_to_kg': {
      // GROUND-TRUTH VERIFICATION GATE (Lesson 33/35): the KG subagent has the same
      // phantom-success pattern as the HTML builder — it can report "✅ Task completed"
      // for a patch/edit that changed nothing. The existing in-subagent check only
      // catches a NEW graph left with 0 nodes; it does NOT catch a no-op edit to an
      // existing graph (the graph still has nodes, so it "passes"). Every real KG write
      // bumps the graph version, so compare version BEFORE and AFTER: if a write was
      // attempted on an existing graph but the version did not increase, nothing landed.
      const KG_WRITE_TOOLS = new Set(['create_graph', 'create_node', 'patch_node', 'add_edge', 'remove_node', 'patch_graph_metadata', 'create_html_node', 'create_html_from_template'])
      const readVersion = async (gId) => {
        if (!gId) return null
        try { return Number((await fetchGraphForVersion(gId, env)).version) } catch { return null }
      }
      const beforeVersion = await readVersion(toolInput.graphId)

      const result = await runKgSubagent(toolInput, env, progress, executeTool)

      const sameGraph = result.graphId && toolInput.graphId && result.graphId === toolInput.graphId
      const afterVersion = sameGraph ? await readVersion(result.graphId) : null
      const writeAttempted = (result.actions || []).some(a => KG_WRITE_TOOLS.has(a.tool))
      // Only judge phantom on an EXISTING graph we could version both sides of. A newly
      // created graph is already covered by the subagent's own 0-nodes check.
      const versionComparable = beforeVersion !== null && afterVersion !== null
      const phantomSuccess = result.success === true && writeAttempted && versionComparable && afterVersion <= beforeVersion
      const finalSuccess = phantomSuccess ? false : result.success

      let message
      if (phantomSuccess) {
        message = `KG subagent reported success but the graph version did NOT advance (still v${afterVersion}) — no write landed. Do NOT tell the user it is done. Re-run with an exact instruction (which node, which field, exact new content).`
      } else if (finalSuccess) {
        const proof = versionComparable && afterVersion > beforeVersion ? ` [verified: graph v${beforeVersion}→v${afterVersion}]` : ''
        message = `KG subagent completed: ${(result.summary || '').slice(0, 500)}${proof}`
      } else {
        message = `KG subagent failed: ${result.error || 'Unknown error'}`
      }

      return {
        success: finalSuccess,
        summary: result.summary,
        graphId: result.graphId,
        nodeId: result.nodeId,
        turns: result.turns,
        model: result.model,
        inputTokens: result.inputTokens || 0,
        outputTokens: result.outputTokens || 0,
        graphVersionBefore: beforeVersion,
        graphVersionAfter: afterVersion,
        phantomSuccess,
        actionsPerformed: (result.actions || []).map(a => ({
          tool: a.tool, success: a.success, summary: a.summary || a.error,
        })),
        message,
        viewUrl: result.graphId
          ? `https://www.vegvisr.org/gnew-viewer?graphId=${result.graphId}`
          : undefined,
      }
    }
    case 'delegate_to_bot': {
      const result = await runBotSubagent(toolInput, env, progress, executeTool)
      return {
        success: result.success,
        summary: result.summary,
        botId: result.botId,
        turns: result.turns,
        model: result.model,
        inputTokens: result.inputTokens || 0,
        outputTokens: result.outputTokens || 0,
        actionsPerformed: (result.actions || []).map(a => ({
          tool: a.tool, success: a.success, summary: a.summary || a.error,
        })),
        message: result.success
          ? `Bot subagent completed: ${(result.summary || '').slice(0, 500)}`
          : `Bot subagent failed: ${result.error || 'Unknown error'}`,
      }
    }
    case 'delegate_to_video': {
      const result = await runVideoSubagent(toolInput, env, progress, executeTool)
      return {
        success: result.success,
        summary: result.summary,
        graphId: result.graphId,
        nodeId: result.nodeId,
        turns: result.turns,
        actionsPerformed: (result.actions || []).map(a => ({
          tool: a.tool, success: a.success, summary: a.summary || a.error,
        })),
        message: result.success
          ? `Video subagent completed: ${(result.summary || '').slice(0, 500)}`
          : `Video subagent failed: ${result.error || 'Unknown error'}`,
        viewUrl: result.graphId
          ? `https://www.vegvisr.org/gnew-viewer?graphId=${result.graphId}`
          : undefined,
      }
    }
    case 'delegate_to_youtube_graph': {
      const result = await runYoutubeGraphSubagent(toolInput, env, progress, executeTool)
      return {
        success: result.success,
        summary: result.summary,
        graphId: result.graphId,
        turns: result.turns,
        actionsPerformed: (result.actions || []).map(a => ({
          tool: a.tool, success: a.success, summary: a.summary || a.error,
        })),
        message: result.success
          ? `YouTube graph subagent completed: ${(result.summary || '').slice(0, 500)}`
          : `YouTube graph subagent failed: ${result.error || 'Unknown error'}`,
        viewUrl: result.viewUrl,
      }
    }
    case 'delegate_to_albums': {
      const result = await runAlbumSubagent(toolInput, env, progress, executeTool)
      return {
        success: result.success,
        summary: result.summary,
        albumName: result.albumName,
        turns: result.turns,
        model: result.model,
        inputTokens: result.inputTokens || 0,
        outputTokens: result.outputTokens || 0,
        actionsPerformed: (result.actions || []).map(a => ({
          tool: a.tool, success: a.success, summary: a.summary || a.error,
        })),
        message: result.success
          ? `Album subagent completed: ${(result.summary || '').slice(0, 500)}`
          : `Album subagent failed: ${result.error || 'Unknown error'}`,
      }
    }
    case 'delegate_to_contact': {
      const result = await runContactSubagent(toolInput, env, progress, executeTool)
      return {
        success: result.success,
        summary: result.summary,
        contactId: result.contactId,
        turns: result.turns,
        model: result.model,
        inputTokens: result.inputTokens || 0,
        outputTokens: result.outputTokens || 0,
        actionsPerformed: (result.actions || []).map(a => ({
          tool: a.tool, success: a.success, summary: a.summary || a.error,
        })),
        message: result.success
          ? `Contact subagent completed: ${(result.summary || '').slice(0, 500)}`
          : `Contact subagent failed: ${result.error || 'Unknown error'}`,
      }
    }
    case 'proff_search_companies':
      return await executeProffTool('search', toolInput)
    case 'proff_get_financials':
      return await executeProffTool('financials', toolInput)
    case 'proff_get_company_details':
      return await executeProffTool('company', toolInput)
    case 'proff_get_public_company_info':
      return await executeProffTool('public-company', toolInput)
    case 'proff_search_persons':
      return await executeProffTool('persons', toolInput)
    case 'proff_get_person_details':
      return await executeProffTool('person', toolInput)
    case 'proff_find_business_network':
      return await executeProffTool('network', toolInput)
    default:
      // Fall through to the OpenAPI dispatcher for any tool registered via
      // the registry walk in loadOpenAPITools (not just kg_*). The presence
      // of the tool in operationMap is what matters.
      if (operationMap && isOpenAPITool(toolName, operationMap)) {
        return await executeOpenAPITool(toolName, toolInput, env, operationMap)
      }
      throw new Error(`Unknown tool: ${toolName}`)
  }
}

async function executeProffTool(endpoint, input) {
  const PROFF_API_BASE = 'https://proff-worker.torarnehave.workers.dev'
  const userId = input.userId || 'unknown'
  const registerSearchKeys = [
    'query',
    'industryCode',
    'industry',
    'location',
    'companyType',
    'filter',
    'sort',
    'pageSize',
    'pageNumber',
    'numEmployeesFrom',
    'numEmployeesTo',
    'revenueFrom',
    'revenueTo',
    'profitFrom',
    'profitTo',
    'establishedYearFrom',
    'establishedYearTo'
  ]

  try {
    let url = `${PROFF_API_BASE}/${endpoint}`

    // Build URL with query params based on endpoint
    if (endpoint === 'search') {
      const params = new URLSearchParams()
      params.set('userId', userId)

      for (const key of registerSearchKeys) {
        const value = input[key]
        if (value === undefined || value === null || value === '') {
          continue
        }

        if (Array.isArray(value)) {
          for (const item of value) {
            if (item !== undefined && item !== null && item !== '') {
              params.append(key, String(item))
            }
          }
          continue
        }

        params.set(key, String(value))
      }

      const hasSearchCriteria = registerSearchKeys.some((key) => {
        const value = input[key]
        return Array.isArray(value)
          ? value.length > 0
          : value !== undefined && value !== null && value !== ''
      })

      if (!hasSearchCriteria) {
        throw new Error('Missing required search criteria for Proff endpoint: search')
      }

      url += `?${params.toString()}`
    } else if (endpoint === 'public-company' && input.orgNr) {
      url += `/${input.orgNr}?userId=${encodeURIComponent(userId)}`
    } else if (endpoint === 'financials' && input.orgNr) {
      url += `/${input.orgNr}?userId=${encodeURIComponent(userId)}`
    } else if (endpoint === 'company' && input.orgNr) {
      url += `/${input.orgNr}?userId=${encodeURIComponent(userId)}`
    } else if (endpoint === 'persons' && input.query) {
      url += `?query=${encodeURIComponent(input.query)}&userId=${encodeURIComponent(userId)}`
    } else if (endpoint === 'person' && input.personId) {
      url += `/${input.personId}?userId=${encodeURIComponent(userId)}`
    } else if (endpoint === 'network' && input.fromPersonId && input.toPersonId) {
      url += `?from=${encodeURIComponent(input.fromPersonId)}&to=${encodeURIComponent(input.toPersonId)}&userId=${encodeURIComponent(userId)}`
    } else {
      throw new Error(`Missing required parameters for Proff endpoint: ${endpoint}`)
    }

    const res = await fetch(url)
    if (!res.ok) {
      const error = await res.text()
      throw new Error(`Proff API error: ${res.status} - ${error}`)
    }

    const data = await res.json()
    return data
  } catch (err) {
    console.error(`[executeProffTool] ${endpoint} failed:`, err.message)
    throw err
  }
}

async function executeReorderNodes(input, env) {
  const res = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(input.graphId)}`
  )
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Failed to fetch graph: ${err}`)
  }
  const graphData = await res.json()
  if (graphData.error) {
    throw new Error(graphData.error || 'Graph not found')
  }

  const nodeMap = {}
  for (const n of graphData.nodes) nodeMap[n.id] = n

  // Build reordered list: requested IDs first, then any remaining in original order
  const seen = new Set(input.nodeOrder)
  const reordered = input.nodeOrder
    .filter(id => nodeMap[id]) // only include IDs that actually exist
    .map(id => nodeMap[id])
  for (const n of graphData.nodes) {
    if (!seen.has(n.id)) reordered.push(n)
  }

  const saveRes = await env.KG_WORKER.fetch('https://knowledge-graph-worker/saveGraphWithHistory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: input.graphId, graphData: { ...graphData, nodes: reordered }, override: true })
  })
  const saveData = await saveRes.json()
  if (!saveRes.ok) {
    throw new Error(saveData.error || `Failed to save (status: ${saveRes.status})`)
  }
  return {
    graphId: input.graphId,
    version: saveData.newVersion,
    nodeCount: reordered.length,
    order: reordered.map(n => n.id),
    message: `Nodes reordered successfully (${reordered.length} nodes, version ${saveData.newVersion})`
  }
}

// ── Challenge tools (Lesson 25: code-hardcoded, NOT in registry) ──────────────

async function executeListChallengeTemplates(input, env) {
  const callerUserId = input.userId
  if (!callerUserId) return { success: false, error: 'No user context available — sign in and retry.' }
  const callerProfile = await resolveUserProfile(callerUserId, env)
  const callerRole = (callerProfile?.Role || callerProfile?.role || '').trim()
  if (callerRole !== 'Superadmin') return { success: false, error: 'Superadmin role required to list challenge templates.' }

  if (!env.WORLD_TEMPLATES) return { success: false, error: 'WORLD_TEMPLATES KV is not bound on agent-worker.' }
  const { keys } = await env.WORLD_TEMPLATES.list({ prefix: 'template-meta:challenge-' })
  const templates = []
  for (const k of keys) {
    const meta = await env.WORLD_TEMPLATES.get(k.name, { type: 'json' })
    if (meta) templates.push(meta)
  }
  return { success: true, count: templates.length, templates }
}

async function executeBackupChallengeTemplatesToKg(input, env) {
  const callerUserId = input.userId
  if (!callerUserId) return { success: false, error: 'No user context available — sign in and retry.' }
  const callerProfile = await resolveUserProfile(callerUserId, env)
  const callerRole = (callerProfile?.Role || callerProfile?.role || '').trim()
  if (callerRole !== 'Superadmin') return { success: false, error: 'Superadmin role required.' }

  if (!env.WORLD_TEMPLATES) return { success: false, error: 'WORLD_TEMPLATES KV is not bound on agent-worker.' }
  const callerEmail = callerProfile?.email || 'torarnehave@gmail.com'

  // Collect all template-meta entries to find template keys
  const { keys: metaKeys } = await env.WORLD_TEMPLATES.list({ prefix: 'template-meta:challenge-' })
  if (!metaKeys.length) return { success: false, error: 'No challenge templates found in WORLD_TEMPLATES.' }

  // Use a fixed graph ID so repeated backups overwrite the same graph
  const graphId = 'graph_challenge_templates_backup'
  const nodes = []
  const edges = []
  const backedUp = []

  for (const k of metaKeys) {
    const meta = await env.WORLD_TEMPLATES.get(k.name, { type: 'json' })
    if (!meta) continue
    const html = await env.WORLD_TEMPLATES.get(meta.key)
    if (!html) continue

    const nodeId = 'template_' + meta.key.replace(/[^a-zA-Z0-9]/g, '_')
    nodes.push({
      id: nodeId,
      label: meta.name || meta.key,
      type: 'fulltext',
      color: '#0f2a43',
      bibl: [],
      position: {},
      visible: true,
      info: `## ${meta.name}\n\n**Key:** \`${meta.key}\`\n\n**Description:** ${meta.description || ''}\n\n---\n\n\`\`\`html\n${html}\n\`\`\``,
      metadata: { templateKey: meta.key, backedUpAt: new Date().toISOString() }
    })
    backedUp.push(meta.key)
  }

  if (!nodes.length) return { success: false, error: 'Could not read HTML for any templates.' }

  const graphData = {
    metadata: {
      title: 'Challenge Page Templates Backup',
      description: 'Auto-backup of all challenge page templates from WORLD_TEMPLATES KV. Restore any template by running restore_challenge_template_from_kg.',
      createdBy: callerEmail,
      metaArea: '#ChallengeTemplates #Backup',
      category: 'System',
      version: 0
    },
    nodes,
    edges
  }

  const kgRes = await fetch('https://knowledge.vegvisr.org/saveGraphWithHistory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-user-email': callerEmail, 'x-user-role': 'Superadmin' },
    body: JSON.stringify({ id: graphId, graphData, override: true })
  })
  if (!kgRes.ok) {
    const err = await kgRes.text()
    return { success: false, error: `KG save failed: ${err}` }
  }
  const kgData = await kgRes.json()
  return {
    success: true,
    graphId,
    backedUp,
    nodeCount: nodes.length,
    version: kgData.newVersion,
    viewer: `https://www.vegvisr.org/gnew-viewer?graphId=${graphId}`,
    message: `Backed up ${nodes.length} template(s) to knowledge graph "${graphId}" (version ${kgData.newVersion}).`
  }
}

async function executeRestoreChallengeTemplateFromKg(input, env) {
  const callerUserId = input.userId
  if (!callerUserId) return { success: false, error: 'No user context available — sign in and retry.' }
  const callerProfile = await resolveUserProfile(callerUserId, env)
  const callerRole = (callerProfile?.Role || callerProfile?.role || '').trim()
  if (callerRole !== 'Superadmin') return { success: false, error: 'Superadmin role required.' }

  if (!env.WORLD_TEMPLATES) return { success: false, error: 'WORLD_TEMPLATES KV is not bound on agent-worker.' }
  const callerEmail = callerProfile?.email || 'torarnehave@gmail.com'

  const { template_key } = input
  if (!template_key) return { success: false, error: 'template_key is required (e.g. "template:challenge-page").' }

  // Read backup graph from KG
  const graphId = input.graph_id || 'graph_challenge_templates_backup'
  const kgRes = await fetch(`https://knowledge.vegvisr.org/getknowgraph?id=${encodeURIComponent(graphId)}`, {
    headers: { 'x-user-email': callerEmail, 'x-user-role': 'Superadmin' }
  })
  if (!kgRes.ok) return { success: false, error: `KG fetch failed (${kgRes.status})` }
  const kg = await kgRes.json()

  const nodes = kg?.graphData?.nodes || kg?.nodes || []
  const nodeId = 'template_' + template_key.replace(/[^a-zA-Z0-9]/g, '_')
  const node = nodes.find(n => n.id === nodeId)
  if (!node) return { success: false, error: `Node "${nodeId}" not found in backup graph. Available: ${nodes.map(n => n.id).join(', ')}` }

  // Extract HTML: try fenced block first, fall back to raw HTML if fence is missing/broken
  let html
  const fenceMatch = node.info.match(/```html\n([\s\S]+?)\n```/)
  if (fenceMatch) {
    html = fenceMatch[1]
  } else if (node.info.trim().startsWith('<!DOCTYPE') || node.info.trim().startsWith('<html')) {
    html = node.info.trim()
  } else {
    // Last resort: strip any leading markdown prose (lines before the first '<') and use the rest
    const htmlStart = node.info.indexOf('<')
    if (htmlStart === -1) return { success: false, error: 'Could not extract HTML from node info — no fenced block and no raw HTML found.' }
    html = node.info.slice(htmlStart)
  }

  await env.WORLD_TEMPLATES.put(template_key, html)

  return {
    success: true,
    template_key,
    restoredBytes: html.length,
    graphId,
    message: `Restored "${template_key}" from KG backup graph (${html.length} bytes). The template is now live in WORLD_TEMPLATES KV.`
  }
}

// ── World-Founder template tools ─────────────────────────────────────────────

async function executeListWorldFounderTemplates(input, env) {
  const callerUserId = input.userId
  if (!callerUserId) return { success: false, error: 'No user context available.' }
  const callerProfile = await resolveUserProfile(callerUserId, env)
  const callerRole = (callerProfile?.Role || callerProfile?.role || '').trim()
  if (callerRole !== 'Superadmin') return { success: false, error: 'Superadmin role required.' }
  if (!env.WORLD_TEMPLATES) return { success: false, error: 'WORLD_TEMPLATES KV not bound.' }

  const { keys } = await env.WORLD_TEMPLATES.list({ prefix: 'template:world-founder' })
  const templates = []
  for (const k of keys) {
    const html = await env.WORLD_TEMPLATES.get(k.name)
    templates.push({ key: k.name, length: html ? html.length : 0, preview_html: html ? html.slice(0, 500) : null, full_html: html })
  }
  return { success: true, count: templates.length, templates }
}

async function executeSaveWorldFounderTemplate(input, env) {
  const callerUserId = input.userId
  if (!callerUserId) return { success: false, error: 'No user context available.' }
  const callerProfile = await resolveUserProfile(callerUserId, env)
  const callerRole = (callerProfile?.Role || callerProfile?.role || '').trim()
  if (callerRole !== 'Superadmin') return { success: false, error: 'Superadmin role required.' }
  if (!env.WORLD_TEMPLATES) return { success: false, error: 'WORLD_TEMPLATES KV not bound.' }

  const { template_key, html } = input
  if (!template_key) return { success: false, error: 'template_key is required (e.g. "template:world-founder-page").' }
  if (!html) return { success: false, error: 'html is required — the full HTML string to save.' }
  if (!template_key.startsWith('template:world-founder')) return { success: false, error: 'template_key must start with "template:world-founder" to prevent accidental overwrites.' }

  await env.WORLD_TEMPLATES.put(template_key, html)
  return {
    success: true,
    template_key,
    savedBytes: html.length,
    message: `Saved ${html.length} bytes to WORLD_TEMPLATES["${template_key}"]. Run publish_world_page or republish_all_world_pages to push the change live.`
  }
}

async function executeBackupWorldFounderTemplatesToKg(input, env) {
  const callerUserId = input.userId
  if (!callerUserId) return { success: false, error: 'No user context available.' }
  const callerProfile = await resolveUserProfile(callerUserId, env)
  const callerRole = (callerProfile?.Role || callerProfile?.role || '').trim()
  if (callerRole !== 'Superadmin') return { success: false, error: 'Superadmin role required.' }
  if (!env.WORLD_TEMPLATES) return { success: false, error: 'WORLD_TEMPLATES KV not bound.' }
  const callerEmail = callerProfile?.email || 'torarnehave@gmail.com'

  const { keys } = await env.WORLD_TEMPLATES.list({ prefix: 'template:world-founder' })
  if (!keys.length) return { success: false, error: 'No world-founder templates found in WORLD_TEMPLATES.' }

  const graphId = 'graph_world_founder_templates_backup'
  const nodes = []
  const backedUp = []

  for (const k of keys) {
    const html = await env.WORLD_TEMPLATES.get(k.name)
    if (!html) continue
    const nodeId = 'template_' + k.name.replace(/[^a-zA-Z0-9]/g, '_')
    nodes.push({
      id: nodeId,
      label: k.name,
      type: 'fulltext',
      color: '#0f2a43',
      bibl: [],
      position: {},
      visible: true,
      info: `## ${k.name}\n\n**Key:** \`${k.name}\`\n\n**Bytes:** ${html.length}\n\n---\n\n\`\`\`html\n${html}\n\`\`\``,
      metadata: { templateKey: k.name, backedUpAt: new Date().toISOString() }
    })
    backedUp.push(k.name)
  }

  if (!nodes.length) return { success: false, error: 'Could not read HTML for any world-founder templates.' }

  const graphData = {
    metadata: {
      title: 'World Founder Page Templates Backup',
      description: 'Auto-backup of all world-founder page templates from WORLD_TEMPLATES KV. Restore with restore_world_founder_template_from_kg.',
      createdBy: callerEmail,
      metaArea: '#WorldFounderTemplates #Backup',
      category: 'System',
      version: 0
    },
    nodes,
    edges: []
  }

  const kgRes = await fetch('https://knowledge.vegvisr.org/saveGraphWithHistory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-user-email': callerEmail, 'x-user-role': 'Superadmin' },
    body: JSON.stringify({ id: graphId, graphData, override: true })
  })
  if (!kgRes.ok) return { success: false, error: `KG save failed: ${await kgRes.text()}` }
  const kgData = await kgRes.json()
  return {
    success: true,
    graphId,
    backedUp,
    nodeCount: nodes.length,
    version: kgData.newVersion,
    viewer: `https://www.vegvisr.org/gnew-viewer?graphId=${graphId}`,
    message: `Backed up ${nodes.length} world-founder template(s) to KG graph "${graphId}" (version ${kgData.newVersion}).`
  }
}

async function executeRestoreWorldFounderTemplateFromKg(input, env) {
  const callerUserId = input.userId
  if (!callerUserId) return { success: false, error: 'No user context available.' }
  const callerProfile = await resolveUserProfile(callerUserId, env)
  const callerRole = (callerProfile?.Role || callerProfile?.role || '').trim()
  if (callerRole !== 'Superadmin') return { success: false, error: 'Superadmin role required.' }
  if (!env.WORLD_TEMPLATES) return { success: false, error: 'WORLD_TEMPLATES KV not bound.' }
  const callerEmail = callerProfile?.email || 'torarnehave@gmail.com'

  const { template_key, graph_id } = input
  if (!template_key) return { success: false, error: 'template_key is required (e.g. "template:world-founder-page").' }

  const graphId = graph_id || 'graph_world_founder_templates_backup'
  const kgRes = await fetch(`https://knowledge.vegvisr.org/getknowgraph?id=${encodeURIComponent(graphId)}`, {
    headers: { 'x-user-email': callerEmail, 'x-user-role': 'Superadmin' }
  })
  if (!kgRes.ok) return { success: false, error: `KG fetch failed (${kgRes.status})` }
  const kg = await kgRes.json()

  const nodes = kg?.graphData?.nodes || kg?.nodes || []
  const nodeId = 'template_' + template_key.replace(/[^a-zA-Z0-9]/g, '_')
  const node = nodes.find(n => n.id === nodeId)
  if (!node) return { success: false, error: `Node "${nodeId}" not found. Available: ${nodes.map(n => n.id).join(', ')}` }

  // Extract HTML: fenced block first, then raw HTML fallback
  let html
  const fenceMatch = node.info.match(/```html\n([\s\S]+?)\n```/)
  if (fenceMatch) {
    html = fenceMatch[1]
  } else if (node.info.trim().startsWith('<!DOCTYPE') || node.info.trim().startsWith('<html')) {
    html = node.info.trim()
  } else {
    const htmlStart = node.info.indexOf('<')
    if (htmlStart === -1) return { success: false, error: 'Could not extract HTML from node info.' }
    html = node.info.slice(htmlStart)
  }

  await env.WORLD_TEMPLATES.put(template_key, html)
  return {
    success: true,
    template_key,
    restoredBytes: html.length,
    graphId,
    message: `Restored "${template_key}" from KG backup (${html.length} bytes). Run publish_world_page or republish_all_world_pages to push live.`
  }
}

async function executeCreateChallenge(input, env) {
  const callerUserId = input.userId
  if (!callerUserId) return { success: false, error: 'No user context available — sign in and retry.' }
  const callerProfile = await resolveUserProfile(callerUserId, env)
  const callerRole = (callerProfile?.Role || callerProfile?.role || '').trim()
  if (callerRole !== 'Superadmin') return { success: false, error: 'Superadmin role required to create a challenge.' }

  const { domain, group_id, main_graph_id, title, slug, weeks, hero_image_url, template_key } = input
  if (!domain || !group_id || !main_graph_id) return { success: false, error: 'domain, group_id, and main_graph_id are required' }
  // Idempotent: one challenge per (domain, group_id). Re-running the same command returns the
  // EXISTING row (so the challenge_id is retrievable) instead of inserting a duplicate.
  const existing = await env.DB.prepare(
    'SELECT id, main_graph_id, title, status, hero_image_url, template_key FROM challenges WHERE domain = ? AND group_id = ?'
  ).bind(domain, group_id).first()
  if (existing) {
    return { success: true, challenge_id: existing.id, domain, group_id, main_graph_id: existing.main_graph_id, title: existing.title, status: existing.status, hero_image_url: existing.hero_image_url || null, template_key: existing.template_key || null, already_existed: true, message: `Challenge already exists for ${domain} (group ${group_id}) — challenge_id: ${existing.id}` }
  }
  const id = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO challenges (id, domain, group_id, main_graph_id, slug, title, status, weeks, hero_image_url, template_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, domain, group_id, main_graph_id, slug || null, title || null, 'active', weeks || 0, hero_image_url || null, template_key || null).run()
  return { success: true, challenge_id: id, domain, group_id, main_graph_id, title, hero_image_url: hero_image_url || null, template_key: template_key || null, message: `Challenge created for ${domain} — challenge_id: ${id}` }
}

async function executeListChallengeParticipants(input, env) {
  const callerUserId = input.userId
  if (!callerUserId) return { success: false, error: 'No user context available — sign in and retry.' }
  const callerProfile = await resolveUserProfile(callerUserId, env)
  const callerRole = (callerProfile?.Role || callerProfile?.role || '').trim()
  if (callerRole !== 'Superadmin') return { success: false, error: 'Superadmin role required to list challenge participants.' }

  const { challenge_id } = input
  if (!challenge_id) return { success: false, error: 'challenge_id is required' }
  const rows = await env.DB.prepare(
    'SELECT challenge_id, participant_user_id, personal_graph_id, progress, joined_at, status FROM challenge_participants WHERE challenge_id = ? ORDER BY joined_at'
  ).bind(challenge_id).all()
  const participants = (rows.results || []).map(r => {
    let progress = {}
    try { progress = JSON.parse(r.progress || '{}') } catch { progress = {} }
    return { ...r, progress }
  })
  return { success: true, challenge_id, count: participants.length, participants }
}

async function executeGetParticipantGraph(input, env) {
  const callerUserId = input.userId
  if (!callerUserId) return { success: false, error: 'No user context available — sign in and retry.' }
  const callerProfile = await resolveUserProfile(callerUserId, env)
  const callerRole = (callerProfile?.Role || callerProfile?.role || '').trim()
  if (callerRole !== 'Superadmin') return { success: false, error: 'Superadmin role required to view participant graphs.' }

  const { challenge_id, participant_user_id } = input
  if (!challenge_id || !participant_user_id) return { success: false, error: 'challenge_id and participant_user_id are required' }
  const row = await env.DB.prepare(
    'SELECT * FROM challenge_participants WHERE challenge_id = ? AND participant_user_id = ?'
  ).bind(challenge_id, participant_user_id).first()
  if (!row) return { success: false, error: `No participant row found for ${participant_user_id} in challenge ${challenge_id}` }
  let progress = {}
  try { progress = JSON.parse(row.progress || '{}') } catch { progress = {} }
  return { success: true, challenge_id, participant_user_id, personal_graph_id: row.personal_graph_id, status: row.status, joined_at: row.joined_at, progress }
}

export { executeTool, executeCreateHtmlFromTemplate, executeAnalyzeNode, executeAnalyzeGraph }
