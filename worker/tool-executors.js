/**
 * Tool executors — runtime functions that execute each tool
 *
 * Each execute* function calls service bindings (KG_WORKER, ANTHROPIC, etc.)
 * and returns a result object. The executeTool() dispatcher routes by name.
 */

import { getTemplate, getTemplateVersion, listTemplates, DEFAULT_TEMPLATE_ID } from './template-registry.js'
import { isOpenAPITool, executeOpenAPITool, loadOpenAPITools } from './openapi-tools.js'
import { FORMATTING_REFERENCE, NODE_TYPES_REFERENCE, HTML_BUILDER_REFERENCE } from './system-prompt.js'
import { TOOL_DEFINITIONS } from './tool-definitions.js'
import { runHtmlBuilderSubagent } from './html-builder-subagent.js'

// ── Graph operations ──────────────────────────────────────────────

async function executeCreateGraph(input, env) {
  const existsRes = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(input.graphId)}`
  )

  if (existsRes.ok) {
    const existing = await existsRes.json()
    if (existing && existing.nodes) {
      return {
        graphId: input.graphId,
        version: existing.metadata?.version || 0,
        alreadyExists: true,
        nodeCount: existing.nodes.length,
        edgeCount: existing.edges?.length || 0,
        message: `Graph "${input.graphId}" already exists (${existing.nodes.length} nodes). You can add nodes to it directly.`,
        viewUrl: `https://www.vegvisr.org/gnew-viewer?graphId=${input.graphId}`
      }
    }
  }

  const graphData = {
    metadata: {
      title: input.title,
      description: input.description || '',
      category: input.category || '',
      metaArea: input.metaArea || '',
      createdBy: input.userId || 'agent-worker',
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
    body: JSON.stringify({ id: input.graphId, graphData })
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error || `Failed to create graph (status: ${response.status})`)
  }
  return {
    graphId: data.id || input.graphId,
    version: data.newVersion || 1,
    message: `Graph "${input.title}" created successfully`,
    viewUrl: `https://www.vegvisr.org/gnew-viewer?graphId=${input.graphId}`
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
  const res = await env.KG_WORKER.fetch(apiUrl)
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
    `https://knowledge-graph-worker/getknowgraphsummaries?offset=0&limit=500`
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

// ── Drizzle worker executors (relational D1 tables) ──────────────

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
  const tableId = (input.tableId || '').trim()
  if (!tableId) throw new Error('tableId is required')
  if (!input.record || typeof input.record !== 'object') {
    throw new Error('record object is required')
  }

  const res = await env.DRIZZLE_WORKER.fetch('https://drizzle-worker/insert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tableId,
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

async function executeQueryAppTable(input, env) {
  const tableId = (input.tableId || '').trim()
  if (!tableId) throw new Error('tableId is required')

  const res = await env.DRIZZLE_WORKER.fetch('https://drizzle-worker/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tableId,
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

async function executeListChatGroups(input, env) {
  const res = await env.DRIZZLE_WORKER.fetch('https://drizzle-worker/chat-groups', {
    method: 'GET'
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to list chat groups')

  return {
    groups: data.groups,
    count: data.groups.length,
    message: `Found ${data.groups.length} chat groups`
  }
}

async function executeAddUserToChatGroup(input, env) {
  const email = (input.email || '').trim()
  if (!email) throw new Error('email is required')
  if (!input.groupId && !input.groupName) throw new Error('groupId or groupName is required')

  const res = await env.DRIZZLE_WORKER.fetch('https://drizzle-worker/add-user-to-group', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      groupId: input.groupId || undefined,
      groupName: input.groupName || undefined,
      role: input.role || undefined
    })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to add user to group')

  return {
    success: true,
    user_id: data.user_id,
    email: data.email,
    group_id: data.group_id,
    groupName: data.groupName,
    role: data.role,
    message: `Added ${data.email} to group "${data.groupName}" as ${data.role}`
  }
}

async function executeGetGroupMessages(input, env) {
  const params = new URLSearchParams()
  if (input.groupId) params.set('groupId', input.groupId)
  if (input.groupName) params.set('groupName', input.groupName)
  if (input.limit) params.set('limit', String(input.limit))

  const res = await env.DRIZZLE_WORKER.fetch(
    `https://drizzle-worker/group-messages?${params}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to get group messages')

  return {
    groupName: data.groupName,
    groupId: data.groupId,
    messages: data.messages,
    count: data.count,
    message: `Retrieved ${data.count} messages from "${data.groupName}"`
  }
}

async function executeGetGroupStats(input, env) {
  const res = await env.DRIZZLE_WORKER.fetch('https://drizzle-worker/group-stats')
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to get group stats')

  const mostActive = data.groups[0]
  return {
    groups: data.groups,
    count: data.groups.length,
    message: mostActive
      ? `${data.groups.length} groups. Most active: "${mostActive.name}" with ${mostActive.messageCount} messages`
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

  const payload = {
    email,
    groupId: input.groupId || undefined,
    groupName: input.groupName || undefined,
    body,
    messageType
  }
  if (messageType === 'voice') {
    payload.audioUrl = input.audioUrl
    if (input.audioDurationMs) payload.audioDurationMs = input.audioDurationMs
    if (input.transcriptText) payload.transcriptText = input.transcriptText
    if (input.transcriptLang) payload.transcriptLang = input.transcriptLang
  }

  const res = await env.DRIZZLE_WORKER.fetch('https://drizzle-worker/send-group-message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to send message')

  const result = {
    success: true,
    messageId: data.messageId,
    groupId: data.groupId,
    groupName: data.groupName,
    email: data.email,
    body: data.body,
    messageType: data.messageType,
    createdAt: data.createdAt,
    message: messageType === 'voice'
      ? `Sent voice message to "${data.groupName}" as ${data.email}`
      : `Sent message to "${data.groupName}" as ${data.email}`
  }
  if (messageType === 'voice') {
    result.audioUrl = data.audioUrl
    result.transcriptText = data.transcriptText
    result.transcriptionStatus = data.transcriptionStatus
  }
  return result
}

async function executeCreateChatGroup(input, env) {
  const email = (input.email || '').trim()
  const name = (input.name || '').trim()
  if (!email) throw new Error('email is required')
  if (!name) throw new Error('name (group name) is required')

  const res = await env.DRIZZLE_WORKER.fetch('https://drizzle-worker/create-chat-group', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      name,
      graphId: input.graphId || undefined
    })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to create chat group')

  return {
    success: true,
    groupId: data.groupId,
    groupName: data.groupName,
    createdBy: data.createdBy,
    role: data.role,
    graphId: data.graphId,
    createdAt: data.createdAt,
    message: `Created chat group "${data.groupName}" with ${data.createdBy} as owner`
  }
}

async function executeRegisterChatBot(input, env) {
  const graphId = (input.graphId || '').trim()
  const botName = (input.botName || '').trim()
  if (!graphId) throw new Error('graphId is required')
  if (!botName) throw new Error('botName is required')
  if (!input.groupId && !input.groupName) throw new Error('groupId or groupName is required')

  const res = await env.DRIZZLE_WORKER.fetch('https://drizzle-worker/register-chat-bot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      graphId,
      botName,
      groupId: input.groupId || undefined,
      groupName: input.groupName || undefined
    })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to register chat bot')

  return {
    success: true,
    botUserId: data.botUserId,
    botEmail: data.botEmail,
    botName: data.botName,
    groupId: data.groupId,
    groupName: data.groupName,
    graphId: data.graphId,
    message: `Registered bot "${data.botName}" in group "${data.groupName}" (personality graph: ${data.graphId})`
  }
}

async function executeGetGroupMembers(input, env) {
  if (!input.groupId && !input.groupName) throw new Error('groupId or groupName is required')
  const params = new URLSearchParams()
  if (input.groupId) params.set('groupId', input.groupId)
  if (input.groupName) params.set('groupName', input.groupName)
  const res = await env.DRIZZLE_WORKER.fetch(`https://drizzle-worker/group-members?${params}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to get group members')
  return data
}

async function executeTriggerBotResponse(input, env) {
  if (!input.groupId && !input.groupName) throw new Error('groupId or groupName is required')
  const messageCount = Math.min(input.messageCount || 10, 50)

  // 1. Get bots in group
  const botParams = new URLSearchParams()
  if (input.groupId) botParams.set('groupId', input.groupId)
  if (input.groupName) botParams.set('groupName', input.groupName)
  const botRes = await env.DRIZZLE_WORKER.fetch(`https://drizzle-worker/group-bots?${botParams}`)
  const botData = await botRes.json()
  if (!botRes.ok) throw new Error(botData.error || 'Failed to get group bots')
  if (!botData.bots || botData.bots.length === 0) throw new Error(`No bots registered in group "${botData.groupName}"`)

  // Filter to specific bot if requested
  let bots = botData.bots
  if (input.botGraphId) {
    bots = bots.filter(b => b.graphId === input.botGraphId)
    if (bots.length === 0) throw new Error(`Bot with graph "${input.botGraphId}" not found in group`)
  }

  // 2. Get recent messages
  const msgParams = new URLSearchParams()
  msgParams.set('groupId', botData.groupId)
  msgParams.set('limit', String(messageCount))
  const msgRes = await env.DRIZZLE_WORKER.fetch(`https://drizzle-worker/group-messages?${msgParams}`)
  const msgData = await msgRes.json()
  if (!msgRes.ok) throw new Error(msgData.error || 'Failed to get group messages')

  // Format messages as conversation context
  const now = Date.now()
  const formattedMessages = (msgData.messages || []).reverse().map(m => {
    const ago = Math.round((now - new Date(m.createdAt).getTime()) / 60000)
    const timeStr = ago < 1 ? 'just now' : ago < 60 ? `${ago}m ago` : `${Math.round(ago / 60)}h ago`
    const text = m.messageType === 'voice' && m.transcriptText ? `[voice] ${m.transcriptText}` : m.body
    return `[${m.email}, ${timeStr}]: ${text}`
  }).join('\n')

  // 3. For each bot, generate and post response
  const results = []
  for (const bot of bots) {
    const isAgentBot = bot.userId.startsWith('bot-agent-')
    let botTitle = bot.botName || bot.email
    let personality = ''
    let botModel = 'claude-haiku-4-5-20251001'
    let botTemp = 0.7
    let systemPromptOverride = ''

    let botAvatarUrl = null

    if (isAgentBot) {
      // Agent-based bot: load agent_config for model/temp, then knowledge graph for personality
      const agentId = bot.userId.replace('bot-agent-', '')
      const agentConfig = await env.DB.prepare('SELECT * FROM agent_configs WHERE id = ?').bind(agentId).first()
      if (agentConfig) {
        botTitle = agentConfig.name || botTitle
        botModel = agentConfig.model || botModel
        botTemp = agentConfig.temperature ?? botTemp
        botAvatarUrl = agentConfig.avatar_url || null
        if (agentConfig.system_prompt) systemPromptOverride = agentConfig.system_prompt
        // Get graphId from agent metadata
        try {
          const meta = JSON.parse(agentConfig.metadata || '{}')
          if (meta.botGraphId && !bot.graphId) bot.graphId = meta.botGraphId
        } catch {}
      }
    }

    // Load knowledge graph for personality (both agent-based and graph-only bots)
    if (bot.graphId) {
      const kgRes = await env.KG_WORKER.fetch(`https://knowledge-graph-worker/getknowgraph?id=${bot.graphId}`)
      const kgData = await kgRes.json()
      if (kgRes.ok && kgData.nodes) {
        if (!isAgentBot) botTitle = kgData.metadata?.title || botTitle
        const fulltextNodes = kgData.nodes.filter(n => n.type === 'fulltext' && n.info)
        personality = fulltextNodes.map(n => n.info).join('\n\n---\n\n')
      } else if (!isAgentBot) {
        results.push({ bot: bot.email, error: `Failed to load graph ${bot.graphId}` })
        continue
      }
    } else if (!systemPromptOverride) {
      results.push({ bot: bot.email, error: 'No knowledge graph or system prompt configured' })
      continue
    }

    const systemPrompt = `${systemPromptOverride ? systemPromptOverride + '\n\n' : ''}You are ${botTitle}, a chatbot in the "${botData.groupName}" chat group.

${personality}

Below are recent messages from the group. Respond naturally as ${botTitle}.
Keep your response concise and conversational. Do not repeat what others said.
Do not prefix your response with your name or any label.`

    const userMessage = `Here are the recent messages in the group:\n\n${formattedMessages}\n\nPlease respond as ${botTitle}.`

    // Call Claude
    const aiRes = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: bot.userId,
        messages: [{ role: 'user', content: userMessage }],
        system: systemPrompt,
        model: botModel,
        max_tokens: 1024,
        temperature: botTemp
      })
    })
    const aiData = await aiRes.json()
    if (!aiRes.ok) {
      results.push({ bot: bot.email, error: `Claude API error: ${aiData.error || 'unknown'}` })
      continue
    }

    const textBlock = (aiData.content || []).find(c => c.type === 'text')
    const responseText = textBlock?.text || ''
    if (!responseText) {
      results.push({ bot: bot.email, error: 'Empty response from Claude' })
      continue
    }

    // Post bot response to group
    const sendPayload = {
      email: bot.email,
      groupId: botData.groupId,
      body: responseText
    }
    if (botAvatarUrl) sendPayload.senderAvatarUrl = botAvatarUrl
    const sendRes = await env.DRIZZLE_WORKER.fetch('https://drizzle-worker/send-group-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sendPayload)
    })
    const sendData = await sendRes.json()
    if (!sendRes.ok) {
      results.push({ bot: bot.email, error: sendData.error || 'Failed to post response' })
      continue
    }

    results.push({
      bot: bot.email,
      botName: botTitle,
      messageId: sendData.messageId,
      response: responseText,
      success: true
    })
  }

  return {
    groupId: botData.groupId,
    groupName: botData.groupName,
    messagesAnalyzed: msgData.messages?.length || 0,
    botResponses: results,
    message: results.map(r => r.success ? `${r.botName}: "${r.response.substring(0, 100)}..."` : `${r.bot}: ERROR - ${r.error}`).join('\n')
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

    // Dynamic KG API tools
    let dynamic = []
    try {
      const loaded = await loadOpenAPITools(env)
      const hardcodedNames = new Set(TOOL_DEFINITIONS.map(t => t.name))
      dynamic = loaded.tools
        .filter(t => !hardcodedNames.has(t.name))
        .map(t => ({ name: t.name, description: t.description }))
    } catch { /* ignore */ }

    result.tools = {
      hardcoded,
      dynamic,
      builtin: [{ name: 'web_search', description: 'Quick web search (Claude built-in, lightweight)' }],
      total: hardcoded.length + dynamic.length + 1
    }
  }

  if (includeTemplates) {
    result.templates = listTemplates()
  }

  result.summary = `This agent has ${result.tools?.total || '?'} tools and ${result.templates?.length || '?'} HTML templates available. Tools cover knowledge graph management, web search, image search & analysis, audio transcription, semantic analysis, email, and HTML app creation.`

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
    case 'perplexity_search':
      return await executePerplexitySearch(toolInput, env)
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
    case 'describe_capabilities':
      return await executeDescribeCapabilities(toolInput, env)
    case 'db_list_tables':
      return await executeDbListTables(env)
    case 'db_query':
      return await executeDbQuery(toolInput, env)
    case 'calendar_list_tables':
      return await executeCalendarListTables(env)
    case 'calendar_query':
      return await executeCalendarQuery(toolInput, env)
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
      const result = await runHtmlBuilderSubagent(toolInput, env, progress, executeTool)
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
          ? `HTML Builder completed: ${(result.summary || '').slice(0, 500)}`
          : `HTML Builder failed: ${result.error || 'Unknown error'}`,
        viewUrl: result.graphId
          ? `https://www.vegvisr.org/gnew-viewer?graphId=${result.graphId}`
          : undefined,
      }
    }
    default:
      if (isOpenAPITool(toolName) && operationMap) {
        return await executeOpenAPITool(toolName, toolInput, env, operationMap)
      }
      throw new Error(`Unknown tool: ${toolName}`)
  }
}

export { executeTool, executeCreateHtmlFromTemplate, executeAnalyzeNode, executeAnalyzeGraph }
