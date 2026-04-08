/**
 * Tool executors — runtime functions that execute each tool
 *
 * Each execute* function calls service bindings (KG_WORKER, ANTHROPIC, etc.)
 * and returns a result object. The executeTool() dispatcher routes by name.
 */

import { getTemplate, getTemplateVersion, listTemplates, DEFAULT_TEMPLATE_ID } from './template-registry.js'
import { isOpenAPITool, executeOpenAPITool, loadOpenAPITools } from './openapi-tools.js'
import { FORMATTING_REFERENCE, NODE_TYPES_REFERENCE, HTML_BUILDER_REFERENCE } from './system-prompt.js'
import { TOOL_DEFINITIONS, PROFF_TOOLS } from './tool-definitions.js'
import { runHtmlBuilderSubagent, executeValidateHtmlSyntax, executeGetHtmlStructure } from './html-builder-subagent.js'
import { runKgSubagent } from './kg-subagent.js'
import { runChatbotSubagent } from './chatbot-subagent.js'
import { runChatSubagent } from './chat-subagent.js'
import { runBotSubagent } from './bot-subagent.js'
import { runAgentBuilderSubagent } from './agent-builder-subagent.js'
import { runVideoSubagent } from './video-subagent.js'
import { runContactSubagent } from './contact-subagent.js'

// ── Graph operations ──────────────────────────────────────────────

// Valid UUID v4 pattern
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function executeCreateGraph(input, env) {
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
      title: input.title,
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
    message: `Graph "${input.title}" created successfully`,
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
  const res = await env.KG_WORKER.fetch('https://knowledge-graph-worker/patchNode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      graphId: input.graphId,
      nodeId: input.nodeId,
      fields: input.fields,
    }),
  })
  const data = await res.json()
  if (!res.ok) {
    const errMsg = data.error || `patchNode failed (${res.status})`
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
  return {
    graphId: input.graphId,
    nodeId: input.nodeId,
    updatedFields: Object.keys(input.fields),
    version: data.newVersion,
    message: `Node "${input.nodeId}" updated: ${Object.keys(input.fields).join(', ')}`,
  }
}

async function executeEditHtmlNode(input, env) {
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
  let oldString = input.old_string
  let newString = input.new_string
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

  // 5. Patch the node with the edited content
  const patchRes = await env.KG_WORKER.fetch('https://knowledge-graph-worker/patchNode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      graphId: input.graphId,
      nodeId: input.nodeId,
      fields: { info: newHtml },
    }),
  })
  const patchData = await patchRes.json()
  if (!patchRes.ok) {
    throw new Error(patchData.error || `patchNode failed (${patchRes.status})`)
  }

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

async function executePatchGraphMetadata(input, env) {
  const res = await env.KG_WORKER.fetch('https://knowledge-graph-worker/patchGraphMetadata', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      graphId: input.graphId,
      fields: input.fields,
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `patchGraphMetadata failed (${res.status})`)
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
  const node = {
    id: input.nodeId,
    label: input.label,
    type: input.nodeType || 'fulltext',
    info: input.content || '',
    bibl: input.references || [],
    position: { x: input.positionX || 0, y: input.positionY || 0 },
    visible: true
  }
  if (input.path) node.path = input.path
  if (input.imageWidth) node.imageWidth = input.imageWidth
  if (input.imageHeight) node.imageHeight = input.imageHeight
  if (input.color) node.color = input.color
  if (input.metadata) node.metadata = input.metadata

  const response = await env.KG_WORKER.fetch('https://knowledge-graph-worker/addNode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ graphId: input.graphId, node })
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error || `Failed to add node (status: ${response.status})`)
  }
  return {
    graphId: input.graphId,
    nodeId: input.nodeId,
    nodeType: node.type,
    version: data.newVersion,
    message: `Node "${input.label}" (${node.type}) added successfully`
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

  const model = input.model || 'sonar'
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
      model: 'claude-haiku-4-5-20251001',
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
  const userId = input.userId
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

  const email = profile?.email || (userId.includes('@') ? userId : null)

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

// ── Email operations ──────────────────────────────────────────────

async function executeSendEmail(input, env) {
  const callerUserId = input.userId
  if (!callerUserId) throw new Error('No user context available')

  // Resolve user profile to find their email accounts
  const profile = await resolveUserProfile(callerUserId, env)
  if (!profile) throw new Error('Could not resolve user profile')

  // Parse the data column to get email accounts
  let userData = {}
  if (profile.data) {
    try { userData = JSON.parse(profile.data) } catch { /* ignore */ }
  }
  const accounts = userData?.settings?.emailAccounts || []
  if (accounts.length === 0) {
    throw new Error('No email accounts configured. Please set up an email account in vemail.vegvisr.org first.')
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

  const res = await env.EMAIL_WORKER.fetch(`https://email-worker.internal${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

const ANALYSIS_MODEL = 'claude-sonnet-4-20250514'

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
    await env.KG_WORKER.fetch('https://knowledge-graph-worker/patchNode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graphId,
        nodeId,
        fields: {
          metadata: { ...existingMeta, analysis: { ...analysis, analyzedAt: new Date().toISOString() } }
        }
      }),
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
      await env.KG_WORKER.fetch('https://knowledge-graph-worker/patchNode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graphId,
          nodeId: ranking.nodeId,
          fields: {
            metadata: {
              ...existingMeta,
              analysis: {
                weight: ranking.weight,
                reason: ranking.reason,
                analyzedAt: new Date().toISOString()
              }
            }
          }
        }),
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

    const patchRes = await env.KG_WORKER.fetch('https://knowledge-graph-worker/patchNode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graphId,
        nodeId,
        fields: { info: JSON.stringify(records) }
      })
    })
    if (!patchRes.ok) {
      const err = await patchRes.json().catch(() => ({}))
      throw new Error(err.error || 'Failed to update data-node')
    }

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
    claude:  { binding: env.ANTHROPIC,       url: 'https://anthropic.vegvisr.org/chat',  defaultModel: 'claude-sonnet-4-5' },
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

  // Sort chronologically (oldest first) and trim to requested limit
  allMessages.sort((a, b) => a.id - b.id)
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
    input.model || 'claude-haiku-4-5-20251001',
    input.maxTokens || 4096,
    input.temperature ?? 0.3,
    JSON.stringify(input.tools || []),
    JSON.stringify({}),
    input.avatarUrl || null
  ).run()

  return {
    agentId: id,
    name: input.name,
    model: input.model || 'claude-haiku-4-5-20251001',
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
        'SELECT id, user_id, name, description, model, tools, is_active, created_at FROM agent_configs WHERE is_active = 1 ORDER BY created_at DESC'
      ).all()
      userAgents = agentsRes.results.map(a => {
        let toolCount = 0
        try { toolCount = JSON.parse(a.tools || '[]').length } catch {}
        return { id: a.id, name: a.name, description: a.description, model: a.model, toolCount, createdBy: a.user_id, createdAt: a.created_at }
      })
    } catch {
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

async function executeDeployWorker(input, env) {
  const token = env.CLOUDFLARE_API_TOKEN
  if (!token) return { error: 'CLOUDFLARE_API_TOKEN not configured. Add it as a secret: wrangler secret put CLOUDFLARE_API_TOKEN' }

  const { workerName, code } = input
  if (!workerName || !code) return { error: 'workerName and code are required' }

  const CF_API_BASE = getCfApiBase(env)
  const enableSubdomain = input.enableSubdomain !== false
  const compatDate = input.compatibilityDate || '2024-11-01'
  const registerInGraph = input.registerInGraph !== false

  // Step 1: Deploy the worker code via multipart form
  const metadata = JSON.stringify({ main_module: 'index.js', compatibility_date: compatDate })
  const formData = new FormData()
  formData.append('metadata', new Blob([metadata], { type: 'application/json' }))
  formData.append('index.js', new Blob([code], { type: 'application/javascript+module' }), 'index.js')

  const deployRes = await fetch(`${CF_API_BASE}/scripts/${workerName}`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData,
  })
  const deployData = await deployRes.json()
  if (!deployData.success) {
    return { error: 'Deploy failed', details: deployData.errors }
  }

  // Step 2: Enable workers.dev subdomain
  let subdomainResult = null
  if (enableSubdomain) {
    const subRes = await fetch(`${CF_API_BASE}/scripts/${workerName}/subdomain`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    })
    subdomainResult = await subRes.json()
  }

  // Step 3: Register in graph_system_registry
  let graphResult = null
  if (registerInGraph && env.KG_WORKER) {
    try {
      const nodePayload = {
        graphId: 'graph_system_registry',
        node: {
          id: `worker-${workerName}`,
          label: workerName,
          type: 'system-worker',
          color: '#f59e0b',
          info: `Deployed via Cloudflare API. Last deployed: ${new Date().toISOString()}`,
          metadata: {
            binding: null,
            name: workerName,
            domain: `${workerName}.torarnehave.workers.dev`,
            deployedVia: 'cloudflare-api',
            deployedAt: new Date().toISOString(),
          },
        },
      }
      const gRes = await env.KG_WORKER.fetch('https://knowledge-graph-worker/addNode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nodePayload),
      })
      graphResult = await gRes.json()
    } catch (e) {
      graphResult = { error: e.message }
    }
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
    message: `Worker "${workerName}" deployed successfully. Live at https://${workerName}.torarnehave.workers.dev`,
  }
}

async function executeReadWorker(input, env) {
  const token = env.CLOUDFLARE_API_TOKEN
  if (!token) return { error: 'CLOUDFLARE_API_TOKEN not configured' }

  const CF_API_BASE = getCfApiBase(env)
  const { workerName } = input

  if (workerName) {
    // Get details for a specific worker
    const res = await fetch(`${CF_API_BASE}/scripts/${workerName}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
    const data = await res.json()
    if (!data.success) return { error: `Worker "${workerName}" not found`, details: data.errors }

    const r = data.result
    return {
      name: r.id,
      modifiedOn: r.modified_on,
      createdOn: r.created_on,
      deploymentId: r.deployment_id,
      lastDeployedFrom: r.last_deployed_from,
      hasModules: r.has_modules,
      compatibilityDate: r.compatibility_date,
      handlers: r.handlers,
    }
  }

  // List all workers
  const res = await fetch(`${CF_API_BASE}/scripts`, {
    headers: { 'Authorization': `Bearer ${token}` },
  })
  const data = await res.json()
  if (!data.success) return { error: 'Failed to list workers', details: data.errors }

  const workers = data.result.map(w => ({
    name: w.id,
    modifiedOn: w.modified_on,
    lastDeployedFrom: w.last_deployed_from,
  }))

  return { total: workers.length, workers }
}

async function executeDeleteWorker(input, env) {
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
    message: `Worker "${workerName}" deleted.`,
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
  const patchRes = await env.KG_WORKER.fetch('https://knowledge-graph-worker/patchNode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      graphId,
      nodeId: suggestionId,
      fields: {
        color: STATUS_COLORS[status],
        metadata: { ...meta, status },
      },
    }),
  })

  const data = await patchRes.json()
  if (!patchRes.ok) throw new Error(data.error || 'Failed to update suggestion status')

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
  if (!userEmail) throw new Error('userEmail is required')

  const res = await env.CALENDAR_WORKER.fetch(
    'https://calendar-worker/api/admin/bookings',
    { headers: { 'X-User-Email': userEmail } }
  )
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to list bookings')

  const bookings = data.bookings || []
  return {
    bookings,
    count: bookings.length,
    message: bookings.length === 0
      ? `No bookings found for ${userEmail}`
      : `Found ${bookings.length} booking(s) for ${userEmail}`
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
  if (!query) throw new Error('query is required')
  const params = new URLSearchParams({ q: query })
  if (input.nodeType) params.set('nodeType', input.nodeType)
  if (input.limit) params.set('limit', String(input.limit))
  const res = await env.KG_WORKER.fetch(`https://knowledge-graph-worker/searchGraphs?${params}`)
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
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      temperature: 0,
    })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Translation failed')
  const translated = (data.content || []).find(c => c.type === 'text')?.text || ''
  return { original: text, translated, target_language: targetLang, source_language: input.source_language || 'auto' }
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
    case 'edit_html_node':
      return await executeEditHtmlNode(toolInput, env)
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
    case 'analyze_image':
      return await executeAnalyzeImage(toolInput, env)
    case 'get_formatting_reference':
      return { reference: FORMATTING_REFERENCE }
    case 'get_node_types_reference':
      return { reference: NODE_TYPES_REFERENCE }
    case 'get_html_builder_reference':
      return { reference: HTML_BUILDER_REFERENCE }
    case 'who_am_i':
      return await executeWhoAmI(toolInput, env)
    case 'list_recordings':
      return await executeListRecordings(toolInput, env)
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
    case 'send_email':
      return await executeSendEmail(toolInput, env)
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
    case 'deploy_worker':
      return await executeDeployWorker(toolInput, env)
    case 'read_worker':
      return await executeReadWorker(toolInput, env)
    case 'delete_worker':
      return await executeDeleteWorker(toolInput, env)
    case 'db_list_tables':
      return await executeDbListTables(env)
    case 'db_query':
      return await executeDbQuery(toolInput, env)
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
      const result = await runHtmlBuilderSubagent(enrichedInput, env, progress, executeTool)
      return {
        success: result.success,
        summary: result.summary,
        graphId: result.graphId,
        nodeId: result.nodeId,
        turns: result.turns,
        model: result.model,
        inputTokens: result.inputTokens || 0,
        outputTokens: result.outputTokens || 0,
        actionsPerformed: (result.actions || []).map(a => ({
          tool: a.tool, success: a.success, summary: a.summary || a.error,
        })),
        message: result.success
          ? `HTML Builder completed: ${(result.summary || '').slice(0, 500)}`
          : `HTML Builder failed: ${result.error || 'Unknown error'}`,
        viewUrl: result.graphId
          ? `https://www.vegvisr.org/gnew-viewer?graphId=${result.graphId}`
          : undefined,
      }
    }
    case 'delegate_to_kg': {
      const result = await runKgSubagent(toolInput, env, progress, executeTool)
      return {
        success: result.success,
        summary: result.summary,
        graphId: result.graphId,
        nodeId: result.nodeId,
        turns: result.turns,
        model: result.model,
        inputTokens: result.inputTokens || 0,
        outputTokens: result.outputTokens || 0,
        actionsPerformed: (result.actions || []).map(a => ({
          tool: a.tool, success: a.success, summary: a.summary || a.error,
        })),
        message: result.success
          ? `KG subagent completed: ${(result.summary || '').slice(0, 500)}`
          : `KG subagent failed: ${result.error || 'Unknown error'}`,
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
    case 'proff_search_persons':
      return await executeProffTool('persons', toolInput)
    case 'proff_get_person_details':
      return await executeProffTool('person', toolInput)
    case 'proff_find_business_network':
      return await executeProffTool('network', toolInput)
    default:
      if (isOpenAPITool(toolName) && operationMap) {
        return await executeOpenAPITool(toolName, toolInput, env, operationMap)
      }
      throw new Error(`Unknown tool: ${toolName}`)
  }
}

async function executeProffTool(endpoint, input) {
  const PROFF_API_BASE = 'https://proff-worker.torarnehave.workers.dev'
  const userId = input.userId || 'unknown'

  try {
    let url = `${PROFF_API_BASE}/${endpoint}`

    // Build URL with query params based on endpoint
    if (endpoint === 'search' && input.query) {
      url += `?query=${encodeURIComponent(input.query)}&userId=${encodeURIComponent(userId)}`
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

export { executeTool, executeCreateHtmlFromTemplate, executeAnalyzeNode, executeAnalyzeGraph }
