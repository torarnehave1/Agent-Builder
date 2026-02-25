/**
 * Agent Worker - Autonomous Agent Execution
 *
 * Executes agents configured in agent_configs table
 * Service bindings:
 *   - KG_WORKER: knowledge-graph-worker (KG operations)
 *   - ANTHROPIC: anthropic-worker (encrypted API key LLM calls)
 */

import { getTemplate, getTemplateVersion, extractTemplateId, listTemplates, DEFAULT_TEMPLATE_ID } from './template-registry.js'

/**
 * Tool executors - Call knowledge-graph-worker via service binding
 */
async function executeCreateGraph(input, env) {
  // Check if graph already exists
  const existsRes = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(input.graphId)}`
  )

  if (existsRes.ok) {
    const existing = await existsRes.json()
    if (existing && existing.nodes) {
      // Graph already exists — return it so the agent can add nodes to it
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

  // Create new graph
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
    body: JSON.stringify({
      id: input.graphId,
      graphData
    })
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

async function executeGetContract(input, env) {
  let contract = null

  // Try agent_contracts table first
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

    // Resolve parent contract for composition
    if (contract.parent_contract_id) {
      const parent = await env.DB.prepare(
        'SELECT contract_json FROM agent_contracts WHERE id = ?1'
      ).bind(contract.parent_contract_id).first()
      if (parent) {
        const parentJson = JSON.parse(parent.contract_json)
        // Merge: parent as base, child overrides
        contractJson = deepMerge(parentJson, contractJson)
      }
    }

    // Include template example if linked
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

  // Fallback: check graphTemplates.ai_instructions
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

/**
 * Deep merge two objects (target overrides source)
 */
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
        visible: true
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
    version: data.newVersion,
    message: `HTML node "${input.label}" added successfully`
  }
}

/**
 * Generic node creator — supports any node type (fulltext, image, link, video, audio, etc.)
 */
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
  // Optional fields for specific node types
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

/**
 * Add edge between two nodes in a graph
 */
async function executeAddEdge(input, env) {
  // Read graph, add edge, save back
  const getRes = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(input.graphId)}`
  )
  const graphData = await getRes.json()
  if (!getRes.ok || !graphData.nodes) {
    throw new Error(graphData.error || 'Graph not found')
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
    body: JSON.stringify({
      id: input.graphId,
      graphData,
      override: true
    })
  })

  const saveData = await saveRes.json()
  if (!saveRes.ok) {
    throw new Error(saveData.error || `Failed to save edge (status: ${saveRes.status})`)
  }
  return {
    graphId: input.graphId,
    edgeId,
    version: saveData.newVersion,
    message: `Edge ${input.sourceId} → ${input.targetId} added`
  }
}

/**
 * Read a graph's metadata and nodes (info truncated for overview)
 */
async function executeReadGraph(input, env) {
  const res = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(input.graphId)}`
  )
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Graph not found: ${err}`)
  }
  const graphData = await res.json()
  const nodes = (graphData.nodes || []).map(n => ({
    id: n.id,
    label: n.label,
    type: n.type,
    info: n.info ? n.info.slice(0, 500) + (n.info.length > 500 ? '...' : '') : '',
    path: n.path || undefined,
    color: n.color || undefined,
  }))
  return {
    graphId: input.graphId,
    metadata: graphData.metadata || {},
    nodeCount: nodes.length,
    edgeCount: (graphData.edges || []).length,
    nodes,
    edges: (graphData.edges || []).slice(0, 50),
  }
}

/**
 * Read a single node's full content (not truncated)
 */
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

/**
 * Patch specific fields on a node (lightweight update)
 */
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
  if (!res.ok) throw new Error(data.error || `patchNode failed (${res.status})`)
  return {
    graphId: input.graphId,
    nodeId: input.nodeId,
    updatedFields: Object.keys(input.fields),
    version: data.newVersion,
    message: `Node "${input.nodeId}" updated: ${Object.keys(input.fields).join(', ')}`,
  }
}

/**
 * List graphs with summaries
 */
async function executeListGraphs(input, env) {
  const limit = input.limit || 20
  const offset = input.offset || 0
  const res = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraphsummaries?offset=${offset}&limit=${limit}`
  )
  if (!res.ok) throw new Error('Failed to fetch graph summaries')
  const data = await res.json()
  const results = (data.results || []).map(g => ({
    id: g.id,
    title: g.metadata_title || g.id,
    description: g.metadata_description || '',
    category: g.metadata_category || '',
    nodeCount: g.node_count || 0,
    updatedAt: g.updated_at || '',
  }))
  return {
    total: data.total || results.length,
    offset,
    limit,
    graphs: results,
  }
}

/**
 * Get the editable HTML template info (placeholders only — template is too large to return to agent)
 */
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

  return {
    templateId: entry.id,
    templateSize: entry.template.length,
    placeholders: entry.placeholders,
    description: entry.description,
    version: getTemplateVersion(templateId),
    instructions: 'Use create_html_from_template to create the HTML node. Pass the placeholder values and the worker fills them into the template server-side. CSS must be created as a SEPARATE css-node.',
    contractInfo,
    availableTemplates: listTemplates(),
  }
}

/**
 * Create an HTML node from the editable template with placeholder values filled in server-side
 */
async function executeCreateHtmlFromTemplate(input, env) {
  // Resolve template: explicit param > contract > default
  const templateId = input.templateId || DEFAULT_TEMPLATE_ID
  const entry = getTemplate(templateId)

  // Fill in placeholders
  let html = entry.template
  html = html.replaceAll('{{TITLE}}', input.title || 'Untitled')
  html = html.replaceAll('{{DESCRIPTION}}', input.description || '')
  html = html.replaceAll('{{FOOTER_TEXT}}', input.footerText || '')
  html = html.replaceAll('{{GRAPH_ID_DEFAULT}}', input.graphId || '')

  // Create the html-node via KG worker
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
        visible: true
      }
    })
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error || `Failed to create HTML node (status: ${response.status})`)
  }

  // Create content nodes from sections array
  // The html-node page discovers nodes whose label starts with '#'
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

  // Create markdown-image node for header image
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
    version: data.newVersion,
    htmlSize: html.length,
    sectionsCreated: createdSections.length,
    headerImageNodeId: headerImageNodeId,
    message: `Editable HTML page "${input.title}" created (${html.length} bytes) with ${createdSections.length} content sections${headerImageNodeId ? ' and a header image node' : ''}. The page discovers nodes with # prefix labels.`,
    viewUrl: `https://www.vegvisr.org/gnew-viewer?graphId=${input.graphId}`
  }
}

/**
 * Execute tool by name (custom tools only — web_search is handled server-side by Claude API)
 */
async function executeTool(toolName, toolInput, env) {
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
    case 'read_node':
      return await executeReadNode(toolInput, env)
    case 'patch_node':
      return await executePatchNode(toolInput, env)
    case 'list_graphs':
      return await executeListGraphs(toolInput, env)
    default:
      throw new Error(`Unknown tool: ${toolName}`)
  }
}

/**
 * Tool definitions (matching src/tools/toolDefinitions.ts)
 */
const TOOL_DEFINITIONS = [
  {
    name: 'create_graph',
    description: 'Create a new knowledge graph with metadata. Returns the graph ID and initial version.',
    input_schema: {
      type: 'object',
      properties: {
        graphId: {
          type: 'string',
          description: 'UUID for the graph. Use the exact graphId provided in the task context.'
        },
        title: {
          type: 'string',
          description: 'Human-readable title for the graph'
        },
        description: {
          type: 'string',
          description: 'Detailed description of what this graph contains'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization and discovery'
        },
        category: {
          type: 'string',
          description: 'Hashtag categories for the graph, e.g. "#Health #Neuroscience #Biology". Use 3-5 relevant hashtags separated by spaces.'
        },
        metaArea: {
          type: 'string',
          description: 'A single community-relevant meta area tag in ALL CAPS, e.g. "NEUROSCIENCE", "AI TECHNOLOGY", "NORSE MYTHOLOGY". Should be a proper noun or well-known field of study.'
        }
      },
      required: ['graphId', 'title']
    }
  },
  {
    name: 'create_node',
    description: 'Add any type of node to a knowledge graph. Use this for fulltext (markdown), image, link, video, audio, or css-node types. For html-node pages, use create_html_from_template instead. The graph must already exist (use create_graph first).',
    input_schema: {
      type: 'object',
      properties: {
        graphId: {
          type: 'string',
          description: 'The ID of the graph to add this node to'
        },
        nodeId: {
          type: 'string',
          description: 'Unique node ID (lowercase-kebab-case, e.g., "node-intro")'
        },
        label: {
          type: 'string',
          description: 'Display title for this node'
        },
        nodeType: {
          type: 'string',
          enum: ['fulltext', 'image', 'link', 'video', 'audio', 'css-node', 'html-node', 'agent-contract', 'agent-config', 'agent-run'],
          description: 'Node type. fulltext=markdown, image=image URL, link=external URL, video=video embed, audio=audio file, css-node=CSS theme, agent-contract=contract JSON, agent-config=config JSON, agent-run=execution log JSON'
        },
        content: {
          type: 'string',
          description: 'Node content. For fulltext: markdown text. For link/video: URL. For css-node: CSS text. For image: alt text/caption.'
        },
        path: {
          type: 'string',
          description: 'File/media URL (used for image, audio node types)'
        },
        color: {
          type: 'string',
          description: 'Node color as hex (e.g., "#7c3aed"). Optional.'
        },
        metadata: {
          type: 'object',
          description: 'Optional metadata object. For css-node: use { "appliesTo": ["html-node-id"], "priority": 10 } to link CSS to an HTML node.',
          properties: {
            appliesTo: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of node IDs this css-node applies to'
            },
            priority: {
              type: 'number',
              description: 'CSS priority (lower = higher priority). Default: 999'
            }
          }
        },
        references: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional bibliography/source URLs'
        }
      },
      required: ['graphId', 'nodeId', 'label', 'nodeType', 'content']
    }
  },
  {
    name: 'add_edge',
    description: 'Connect two nodes in a knowledge graph with a directed edge. Both nodes must already exist in the graph.',
    input_schema: {
      type: 'object',
      properties: {
        graphId: {
          type: 'string',
          description: 'The ID of the graph containing both nodes'
        },
        sourceId: {
          type: 'string',
          description: 'The ID of the source node (edge starts here)'
        },
        targetId: {
          type: 'string',
          description: 'The ID of the target node (edge points here)'
        },
        label: {
          type: 'string',
          description: 'Optional label for the edge relationship'
        }
      },
      required: ['graphId', 'sourceId', 'targetId']
    }
  },
  {
    name: 'get_contract',
    description: 'Retrieve a contract that specifies how to generate content. The contract contains node type descriptions, templates, CSS design tokens, feature flags, validation rules, and guidelines. Always fetch the contract BEFORE generating content.',
    input_schema: {
      type: 'object',
      properties: {
        contractId: {
          type: 'string',
          description: 'Contract ID to fetch (e.g., "contract_dark_glass", "contract_open")'
        },
        templateName: {
          type: 'string',
          description: 'Or fetch by name (e.g., "Dark Glass Design System", "Open Knowledge Graph")'
        }
      }
    }
  },
  {
    name: 'create_html_from_template',
    description: 'Create an HTML app from a template. Available templates: "editable-page" (full page with navigation, markdown, edit mode), "theme-builder" (CSS variable editor for design tokens). The worker creates the html-node and content nodes. For editable-page, nodes whose label starts with # are discovered by the page.',
    input_schema: {
      type: 'object',
      properties: {
        graphId: {
          type: 'string',
          description: 'UUID for the graph. Use the exact graphId from the task context.'
        },
        templateId: {
          type: 'string',
          description: 'Which HTML app template to use. Options: "editable-page" (default), "theme-builder". Defaults to "editable-page".'
        },
        title: {
          type: 'string',
          description: 'Page title'
        },
        description: {
          type: 'string',
          description: 'Page description/subtitle'
        },
        headerImage: {
          type: 'string',
          description: 'URL for the header image. Creates a markdown-image node in the graph that the template discovers dynamically. Use Unsplash URLs like https://images.unsplash.com/photo-ID?w=1200&h=400&fit=crop'
        },
        footerText: {
          type: 'string',
          description: 'Footer text'
        },
        sections: {
          type: 'array',
          description: 'Content sections to create as fulltext nodes. Each section becomes a navigable node in the page. Use 3-6 sections.',
          items: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'Section title (will be prefixed with # automatically)'
              },
              content: {
                type: 'string',
                description: 'Section content in Markdown format. Include headings, paragraphs, lists, etc.'
              }
            },
            required: ['title', 'content']
          }
        }
      },
      required: ['graphId', 'title', 'sections']
    }
  },
  {
    name: 'read_graph',
    description: 'Read a knowledge graph: metadata, nodes (info truncated to 500 chars), and edges. Use this to inspect a graph before making changes.',
    input_schema: {
      type: 'object',
      properties: {
        graphId: {
          type: 'string',
          description: 'The graph ID to read'
        }
      },
      required: ['graphId']
    }
  },
  {
    name: 'read_node',
    description: 'Read a single node with FULL content (not truncated). Use after read_graph to get the complete info field of a specific node.',
    input_schema: {
      type: 'object',
      properties: {
        graphId: {
          type: 'string',
          description: 'The graph ID containing the node'
        },
        nodeId: {
          type: 'string',
          description: 'The node ID to read in full'
        }
      },
      required: ['graphId', 'nodeId']
    }
  },
  {
    name: 'patch_node',
    description: 'Update specific fields on an existing node. Only the provided fields are changed; others are preserved. Use read_graph or read_node first to see current values.',
    input_schema: {
      type: 'object',
      properties: {
        graphId: {
          type: 'string',
          description: 'The graph ID containing the node'
        },
        nodeId: {
          type: 'string',
          description: 'The node ID to update'
        },
        fields: {
          type: 'object',
          description: 'Fields to update. Valid keys: info (content), label, path, color, type, metadata, bibl, visible, position, imageWidth, imageHeight.',
          properties: {
            info: { type: 'string', description: 'Node content (markdown, HTML, CSS, etc.)' },
            label: { type: 'string', description: 'Display title' },
            path: { type: 'string', description: 'File/media URL' },
            color: { type: 'string', description: 'Node color hex' },
            type: { type: 'string', description: 'Node type' },
            visible: { type: 'boolean', description: 'Show/hide node' }
          }
        }
      },
      required: ['graphId', 'nodeId', 'fields']
    }
  },
  {
    name: 'list_graphs',
    description: 'List available knowledge graphs with summaries. Returns graph IDs, titles, categories, and node counts.',
    input_schema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Max number of graphs to return (default 20)'
        },
        offset: {
          type: 'number',
          description: 'Offset for pagination (default 0)'
        }
      }
    }
  }
]

/**
 * Claude API native web search tool (server-side — no API key needed from us)
 */
const WEB_SEARCH_TOOL = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 5
}

/**
 * System prompt for the conversational chat agent
 */
const CHAT_SYSTEM_PROMPT = `You are the Vegvisr Agent — a conversational AI assistant built into the Vegvisr platform.
You help users manage knowledge graphs, create and modify HTML apps, and build content.

## Available Tools
- **list_graphs**: List available knowledge graphs with summaries
- **read_graph**: Read a graph's metadata and nodes (info truncated). Always read before modifying.
- **read_node**: Read a single node's full content (not truncated)
- **patch_node**: Update specific fields on a node (info, label, path, color, etc.)
- **create_graph**: Create a new knowledge graph
- **create_node**: Add any type of node (fulltext, image, link, css-node, etc.)
- **create_html_node**: Add a raw HTML node
- **create_html_from_template**: Create an HTML app from a template (editable-page, theme-builder, landing-page, agent-chat)
- **add_edge**: Connect two nodes with a directed edge
- **get_contract**: Retrieve a contract for content generation
- **web_search**: Search the web for current information

## Guidelines
1. **Read before writing**: Always use read_graph before modifying a graph so you understand its current state.
2. **Confirm destructive changes**: Before overwriting node content, tell the user what you plan to change.
3. **Be concise**: Give clear, actionable responses. Use markdown for formatting.
4. **Use the right tool**: Pick the most specific tool for the job.
5. **Graph context**: If the user has selected a graph in the UI, use that graphId for operations.`

/**
 * Streaming agent loop — writes SSE events to a TransformStream writer
 */
async function streamingAgentLoop(writer, encoder, messages, systemPrompt, userId, env, options) {
  const maxTurns = options.maxTurns || 8
  const model = options.model || 'claude-haiku-4-5-20251001'
  let turn = 0

  try {
    while (turn < maxTurns) {
      turn++
      writer.write(encoder.encode(`event: thinking\ndata: ${JSON.stringify({ turn })}\n\n`))

      const response = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          messages,
          model,
          max_tokens: 4096,
          temperature: 0.3,
          system: systemPrompt,
          tools: [...TOOL_DEFINITIONS, WEB_SEARCH_TOOL],
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        writer.write(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: data.error || 'Anthropic API error' })}\n\n`))
        break
      }

      if (data.stop_reason === 'end_turn') {
        // Extract text content
        const textBlocks = (data.content || []).filter(c => c.type === 'text')
        for (const block of textBlocks) {
          writer.write(encoder.encode(`event: text\ndata: ${JSON.stringify({ content: block.text })}\n\n`))
        }
        writer.write(encoder.encode(`event: done\ndata: ${JSON.stringify({ turns: turn })}\n\n`))
        break
      }

      if (data.stop_reason === 'tool_use') {
        const toolUses = (data.content || []).filter(c => c.type === 'tool_use')
        const textBlocks = (data.content || []).filter(c => c.type === 'text')

        // Send any text before tool calls
        for (const block of textBlocks) {
          writer.write(encoder.encode(`event: text\ndata: ${JSON.stringify({ content: block.text })}\n\n`))
        }

        // Execute tools and stream events
        const graphTools = toolUses.filter(t => t.name === 'create_graph')
        const otherTools = toolUses.filter(t => t.name !== 'create_graph')

        const executeAndStream = async (toolUse) => {
          writer.write(encoder.encode(`event: tool_call\ndata: ${JSON.stringify({ tool: toolUse.name, input: toolUse.input })}\n\n`))
          try {
            const result = await executeTool(toolUse.name, { ...toolUse.input, userId }, env)
            const summary = result.message || `${toolUse.name} completed`
            writer.write(encoder.encode(`event: tool_result\ndata: ${JSON.stringify({ tool: toolUse.name, success: true, summary })}\n\n`))
            return { type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(result) }
          } catch (error) {
            writer.write(encoder.encode(`event: tool_result\ndata: ${JSON.stringify({ tool: toolUse.name, success: false, error: error.message })}\n\n`))
            return { type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify({ error: error.message }) }
          }
        }

        // Phase 1: create_graph first
        const phase1Results = await Promise.all(graphTools.map(executeAndStream))
        // Phase 2: everything else
        const phase2Results = await Promise.all(otherTools.map(executeAndStream))
        const toolResults = [...phase1Results, ...phase2Results]

        messages.push(
          { role: 'assistant', content: data.content },
          { role: 'user', content: toolResults },
        )
      } else if (data.stop_reason === 'max_tokens') {
        // Partial text — send what we have and continue
        const textBlocks = (data.content || []).filter(c => c.type === 'text')
        for (const block of textBlocks) {
          writer.write(encoder.encode(`event: text\ndata: ${JSON.stringify({ content: block.text })}\n\n`))
        }
        messages.push(
          { role: 'assistant', content: data.content },
          { role: 'user', content: 'Continue. Do not repeat what you already said.' },
        )
      } else {
        writer.write(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: 'Unexpected stop: ' + data.stop_reason })}\n\n`))
        break
      }
    }

    if (turn >= maxTurns) {
      writer.write(encoder.encode(`event: done\ndata: ${JSON.stringify({ turns: turn, maxReached: true })}\n\n`))
    }
  } catch (err) {
    writer.write(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`))
  } finally {
    writer.close()
  }
}

/**
 * Execute agent with task
 */
async function executeAgent(agentConfig, userTask, userId, env) {
  // Inject default contract reference if the agent has one
  let taskWithContract = userTask
  if (agentConfig.default_contract_id) {
    taskWithContract = `${userTask}\n\n[Default contract: ${agentConfig.default_contract_id}]`
  }

  const messages = [
    {
      role: 'user',
      content: taskWithContract
    }
  ]

  const executionLog = []
  let turn = 0
  const maxTurns = agentConfig.max_turns || 5

  while (turn < maxTurns) {
    turn++

    executionLog.push({
      turn,
      type: 'agent_thinking',
      timestamp: new Date().toISOString()
    })

    // Call anthropic-worker with userId for encrypted key retrieval
    // Include both custom tools and Claude's native web search tool
    const response = await env.ANTHROPIC.fetch('https://anthropic.vegvisr.org/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userId,
        messages: messages,
        model: agentConfig.model || 'claude-haiku-4-5-20251001',
        max_tokens: agentConfig.max_tokens || 4096,
        temperature: agentConfig.temperature ?? 0.3,
        system: agentConfig.system_prompt,
        tools: [...TOOL_DEFINITIONS, WEB_SEARCH_TOOL]
      })
    })

    const data = await response.json()

    if (!response.ok) {
      executionLog.push({
        turn,
        type: 'error',
        error: data.error || 'Anthropic API error',
        timestamp: new Date().toISOString()
      })
      break
    }

    // Check stop reason
    if (data.stop_reason === 'end_turn') {
      // Agent finished — may include web search results and citations
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
      // Agent wants to use custom tools
      // Response may also contain server_tool_use (web search) already executed by Claude API
      const toolUses = data.content.filter(c => c.type === 'tool_use')
      const serverSearches = data.content.filter(c => c.type === 'server_tool_use')

      // Log any server-side web searches that happened
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

      // Execute custom tools in parallel (web_search is already handled server-side)
      // create_graph must run before tools that depend on it (create_html_from_template, create_node)
      const graphTools = toolUses.filter(t => t.name === 'create_graph')
      const otherTools = toolUses.filter(t => t.name !== 'create_graph')

      // Phase 1: create_graph tools first (if any)
      const phase1Results = await Promise.all(graphTools.map(async (toolUse) => {
        try {
          const result = await executeTool(toolUse.name, { ...toolUse.input, userId }, env)
          executionLog.push({ turn, type: 'tool_result', tool: toolUse.name, success: true, result, timestamp: new Date().toISOString() })
          return { type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(result) }
        } catch (error) {
          executionLog.push({ turn, type: 'tool_error', tool: toolUse.name, error: error.message, timestamp: new Date().toISOString() })
          return { type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify({ error: error.message }) }
        }
      }))

      // Phase 2: all other tools in parallel (graph exists now)
      const phase2Results = await Promise.all(otherTools.map(async (toolUse) => {
        try {
          const result = await executeTool(toolUse.name, { ...toolUse.input, userId }, env)
          executionLog.push({ turn, type: 'tool_result', tool: toolUse.name, success: true, result, timestamp: new Date().toISOString() })
          return { type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(result) }
        } catch (error) {
          executionLog.push({ turn, type: 'tool_error', tool: toolUse.name, error: error.message, timestamp: new Date().toISOString() })
          return { type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify({ error: error.message }) }
        }
      }))

      const toolResults = [...phase1Results, ...phase2Results]

      // Add to conversation
      messages.push(
        { role: 'assistant', content: data.content },
        { role: 'user', content: toolResults }
      )
    } else if (data.stop_reason === 'pause_turn') {
      // Claude paused a long-running turn (e.g., during web search)
      executionLog.push({
        turn,
        type: 'pause_turn',
        timestamp: new Date().toISOString()
      })

      // Log any web searches in the paused response
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

      // Continue the turn by sending the response back
      messages.push(
        { role: 'assistant', content: data.content },
        { role: 'user', content: 'Continue.' }
      )
    } else if (data.stop_reason === 'max_tokens') {
      // Agent hit token limit mid-response — continue the conversation
      executionLog.push({
        turn,
        type: 'max_tokens_continuation',
        timestamp: new Date().toISOString()
      })

      // Add partial response and ask agent to continue with tool calls
      messages.push(
        { role: 'assistant', content: data.content },
        { role: 'user', content: 'You hit the token limit. Do NOT repeat what you already said. Continue by making your next tool call (create_node, add_edge, etc.) to finish the task.' }
      )
    } else {
      // Unexpected stop reason
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
    executionLog: executionLog
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const pathname = url.pathname

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Content-Type': 'application/json'
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    try {
      // POST /execute - Execute an agent
      if (pathname === '/execute' && request.method === 'POST') {
        const body = await request.json()
        const { agentId, task, userId, contractId, graphId } = body

        if (!agentId || !task || !userId) {
          return new Response(JSON.stringify({
            error: 'agentId, task, and userId are required'
          }), {
            status: 400,
            headers: corsHeaders
          })
        }

        // Get agent config from D1
        const agentConfig = await env.DB.prepare(`
          SELECT * FROM agent_configs WHERE id = ?1 AND is_active = 1
        `).bind(agentId).first()

        if (!agentConfig) {
          return new Response(JSON.stringify({
            error: 'Agent not found or inactive'
          }), {
            status: 404,
            headers: corsHeaders
          })
        }

        // Parse JSON fields, allow contractId override from request
        const config = {
          ...agentConfig,
          tools: JSON.parse(agentConfig.tools || '[]'),
          metadata: JSON.parse(agentConfig.metadata || '{}'),
          default_contract_id: contractId || agentConfig.default_contract_id
        }

        // Auto-generate UUID graph ID if none provided
        const targetGraphId = graphId || crypto.randomUUID()

        // Build task with graph context so the agent knows which graph to target
        let enrichedTask = `${task}\n\n[Target graph ID: ${targetGraphId}] — Use this exact graphId when calling create_graph and create_html_from_template.`

        // Execute agent
        const result = await executeAgent(config, enrichedTask, userId, env)

        return new Response(JSON.stringify(result), {
          headers: corsHeaders
        })
      }

      // POST /chat - Streaming conversational agent chat (SSE)
      if (pathname === '/chat' && request.method === 'POST') {
        const body = await request.json()
        const { userId, messages: userMessages, graphId, model, maxTurns } = body

        if (!userId || !userMessages || !Array.isArray(userMessages)) {
          return new Response(JSON.stringify({
            error: 'userId and messages[] are required'
          }), { status: 400, headers: corsHeaders })
        }

        // Build system prompt with optional graph context
        let systemPrompt = CHAT_SYSTEM_PROMPT
        if (graphId) {
          systemPrompt += `\n\n## Current Context\nThe user has selected graph "${graphId}". Use this graphId for operations unless they specify otherwise.`
        }

        // Clone messages for the loop (don't mutate input)
        const chatMessages = userMessages.map(m => ({ role: m.role, content: m.content }))

        const { readable, writable } = new TransformStream()
        const writer = writable.getWriter()
        const encoder = new TextEncoder()

        // Run the streaming loop in the background
        ctx.waitUntil(
          streamingAgentLoop(writer, encoder, chatMessages, systemPrompt, userId, env, {
            model: model || 'claude-haiku-4-5-20251001',
            maxTurns: maxTurns || 8,
          })
        )

        return new Response(readable, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          },
        })
      }

      // GET /layout?contractId=xxx - Get saved node layout
      if (pathname === '/layout' && request.method === 'GET') {
        const contractId = url.searchParams.get('contractId')
        if (!contractId) {
          return new Response(JSON.stringify({ error: 'contractId required' }), {
            status: 400, headers: corsHeaders
          })
        }
        const row = await env.DB.prepare(
          'SELECT layout FROM agent_contracts WHERE id = ?1'
        ).bind(contractId).first()
        return new Response(JSON.stringify({
          contractId,
          layout: row?.layout ? JSON.parse(row.layout) : null
        }), { headers: corsHeaders })
      }

      // PUT /layout - Save node layout positions
      if (pathname === '/layout' && request.method === 'PUT') {
        const body = await request.json()
        const { contractId, layout } = body
        if (!contractId || !layout) {
          return new Response(JSON.stringify({ error: 'contractId and layout required' }), {
            status: 400, headers: corsHeaders
          })
        }
        await env.DB.prepare(
          'UPDATE agent_contracts SET layout = ?1, updated_at = datetime(\'now\') WHERE id = ?2'
        ).bind(JSON.stringify(layout), contractId).run()
        return new Response(JSON.stringify({
          contractId, saved: true
        }), { headers: corsHeaders })
      }

      // POST /build-html-page — Create html-node directly (no agent needed)
      if (pathname === '/build-html-page' && request.method === 'POST') {
        const body = await request.json()
        const { graphId, title, userId } = body

        if (!graphId || !title || !userId) {
          return new Response(JSON.stringify({ error: 'graphId, title, and userId required' }), {
            status: 400, headers: corsHeaders
          })
        }

        try {
          const result = await executeCreateHtmlFromTemplate({
            graphId,
            title,
            templateId: body.templateId || DEFAULT_TEMPLATE_ID,
            description: body.description || '',
            footerText: body.footerText || '',
            sections: body.sections || [],
            headerImage: body.headerImage || null,
          }, env)

          return new Response(JSON.stringify(result), { headers: corsHeaders })
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500, headers: corsHeaders
          })
        }
      }

      // GET /template-version — Return current template version(s)
      if (pathname === '/template-version' && request.method === 'GET') {
        const templateId = url.searchParams.get('templateId')
        if (templateId) {
          return new Response(JSON.stringify({
            templateId,
            version: getTemplateVersion(templateId),
          }), { headers: corsHeaders })
        }
        // No templateId → return default version + all templates (backward compat)
        return new Response(JSON.stringify({
          version: getTemplateVersion(DEFAULT_TEMPLATE_ID),
          templates: listTemplates(),
        }), { headers: corsHeaders })
      }

      // GET /templates — List all available templates
      if (pathname === '/templates' && request.method === 'GET') {
        return new Response(JSON.stringify({
          templates: listTemplates(),
        }), { headers: corsHeaders })
      }

      // POST /upgrade-html-node — Upgrade existing html-node to latest template
      if (pathname === '/upgrade-html-node' && request.method === 'POST') {
        const body = await request.json()
        const { graphId, nodeId } = body

        if (!graphId || !nodeId) {
          return new Response(JSON.stringify({ error: 'graphId and nodeId required' }), {
            status: 400, headers: corsHeaders
          })
        }

        try {
          // Fetch the graph
          const getRes = await env.KG_WORKER.fetch(
            `https://knowledge-graph-worker/getknowgraph?id=${encodeURIComponent(graphId)}`
          )
          if (!getRes.ok) throw new Error(`Graph not found (${graphId}, status ${getRes.status})`)
          const graphData = await getRes.json()

          if (!graphData.nodes || !Array.isArray(graphData.nodes)) {
            throw new Error(`Invalid graph data: nodes missing or not array (keys: ${Object.keys(graphData).join(',')})`)
          }

          // Find the html-node
          const nodeIndex = graphData.nodes.findIndex(n => String(n.id) === String(nodeId))
          if (nodeIndex === -1) {
            const nodeIds = graphData.nodes.filter(n => n.type === 'html-node').map(n => n.id)
            throw new Error(`Node ${nodeId} not found in graph ${graphId}. Html-nodes: [${nodeIds.join(', ')}]`)
          }
          const oldNode = graphData.nodes[nodeIndex]
          if (oldNode.type !== 'html-node') throw new Error('Node is not an html-node')

          // Extract metadata from old HTML
          const oldHtml = oldNode.info || ''
          const titleMatch = oldHtml.match(/<title>([^<]*)<\/title>/)
          const descMatch = oldHtml.match(/<p\s+class="muted[^"]*"[^>]*>([^<]*)<\/p>/)
          const footerMatch = oldHtml.match(/footer-text[^>]*>([^<]*)</)
          const oldVersionMatch = oldHtml.match(/<meta\s+name="template-version"\s+content="([^"]+)"/)

          const title = titleMatch ? titleMatch[1] : oldNode.label || 'Untitled'
          const description = descMatch ? descMatch[1] : ''
          const footerText = footerMatch ? footerMatch[1] : ''
          const oldVersion = oldVersionMatch ? oldVersionMatch[1] : 'none'

          // Detect which template this node was built from
          const templateId = extractTemplateId(oldHtml)
          const entry = getTemplate(templateId)

          // Extract header image from old HTML
          const headerImgMatch = oldHtml.match(/class="header-image"[^>]*style="[^"]*url\('([^']+)'\)/)
          const headerImage = headerImgMatch ? headerImgMatch[1] : null

          // Extract saved theme style from old HTML
          const themeStyleMatch = oldHtml.match(/<style data-vegvisr-theme="[^"]*">[^<]*<\/style>/)
          const savedThemeStyle = themeStyleMatch ? themeStyleMatch[0] : null

          // Generate new HTML from latest version of the SAME template
          let newHtml = entry.template
          newHtml = newHtml.replaceAll('{{TITLE}}', title)
          newHtml = newHtml.replaceAll('{{DESCRIPTION}}', description)
          newHtml = newHtml.replaceAll('{{FOOTER_TEXT}}', footerText)
          newHtml = newHtml.replaceAll('{{GRAPH_ID_DEFAULT}}', graphId)
          newHtml = newHtml.replaceAll('{{NODE_ID}}', nodeId)

          // Re-inject saved theme style into <head>
          if (savedThemeStyle) {
            newHtml = newHtml.replace('</head>', savedThemeStyle + '\n</head>')
          }

          // Re-inject header image
          if (headerImage) {
            newHtml = newHtml.replace(
              /class="header-image"[^>]*>/,
              `class="header-image" style="background-image:url('${headerImage}');background-size:cover;background-position:center;height:200px;">`
            )
          }

          // Get new version
          const newVersion = getTemplateVersion(templateId)

          // Patch the node's info with the new HTML
          const saveRes = await env.KG_WORKER.fetch('https://knowledge-graph-worker/patchNode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              graphId,
              nodeId,
              fields: { info: newHtml }
            })
          })

          if (!saveRes.ok) {
            const errData = await saveRes.text()
            throw new Error('Failed to save upgraded graph: ' + errData)
          }

          return new Response(JSON.stringify({
            success: true,
            nodeId,
            templateId,
            oldVersion,
            newVersion,
            title,
            htmlSize: newHtml.length,
            message: `Upgraded ${templateId} from v${oldVersion} to v${newVersion}`
          }), { headers: corsHeaders })
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500, headers: corsHeaders
          })
        }
      }

      // GET /health - Health check
      if (pathname === '/health' && request.method === 'GET') {
        return new Response(JSON.stringify({
          status: 'healthy',
          worker: 'agent-worker',
          timestamp: new Date().toISOString()
        }), {
          headers: corsHeaders
        })
      }

      return new Response(JSON.stringify({
        error: 'Not found',
        available_endpoints: ['/execute', '/chat', '/layout', '/build-html-page', '/template-version', '/templates', '/upgrade-html-node', '/health']
      }), {
        status: 404,
        headers: corsHeaders
      })

    } catch (error) {
      return new Response(JSON.stringify({
        error: error.message,
        stack: error.stack
      }), {
        status: 500,
        headers: corsHeaders
      })
    }
  }
}
