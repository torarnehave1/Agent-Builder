/**
 * Tool executors — runtime functions that execute each tool
 *
 * Each execute* function calls service bindings (KG_WORKER, ANTHROPIC, etc.)
 * and returns a result object. The executeTool() dispatcher routes by name.
 */

import { getTemplate, getTemplateVersion, listTemplates, DEFAULT_TEMPLATE_ID } from './template-registry.js'
import { isOpenAPITool, executeOpenAPITool } from './openapi-tools.js'
import { FORMATTING_REFERENCE, NODE_TYPES_REFERENCE } from './system-prompt.js'

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
  if (!res.ok) throw new Error(data.error || `patchNode failed (${res.status})`)
  return {
    graphId: input.graphId,
    nodeId: input.nodeId,
    updatedFields: Object.keys(input.fields),
    version: data.newVersion,
    message: `Node "${input.nodeId}" updated: ${Object.keys(input.fields).join(', ')}`,
  }
}

async function executeListGraphs(input, env) {
  const limit = input.limit || 20
  const offset = input.offset || 0
  const res = await env.KG_WORKER.fetch(
    `https://knowledge-graph-worker/getknowgraphsummaries?offset=${offset}&limit=${limit}`
  )
  if (!res.ok) throw new Error('Failed to fetch graph summaries')
  const data = await res.json()
  let results = (data.results || []).map(g => {
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

  // Filter by metaArea if provided (case-insensitive partial match)
  if (input.metaArea) {
    const filter = input.metaArea.toLowerCase()
    results = results.filter(g => g.metaArea.toLowerCase().includes(filter))
  }

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

async function executeCreateHtmlFromTemplate(input, env) {
  const templateId = input.templateId || DEFAULT_TEMPLATE_ID
  const entry = getTemplate(templateId)

  let html = entry.template
  html = html.replaceAll('{{TITLE}}', input.title || 'Untitled')
  html = html.replaceAll('{{DESCRIPTION}}', input.description || '')
  html = html.replaceAll('{{FOOTER_TEXT}}', input.footerText || '')
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

// ── Shared: resolve userId (UUID or email) to profile via D1 ─────

async function resolveUserProfile(userId, env) {
  // Retry up to 3 times with increasing delay (handles D1 cold-start timeouts)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Try by email first
      let profile = await env.DB.prepare(
        'SELECT email, user_id, bio, profileimage, role, phone, phone_verified_at, data FROM config WHERE email = ?'
      ).bind(userId).first()
      // If not found, try by user_id (UUID)
      if (!profile) {
        profile = await env.DB.prepare(
          'SELECT email, user_id, bio, profileimage, role, phone, phone_verified_at, data FROM config WHERE user_id = ?'
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
  const { recordingId, audioUrl, language, saveToPortfolio = false } = input
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

  // 2. Download audio to check format and size
  const audioRes = await fetch(resolvedUrl)
  if (!audioRes.ok) throw new Error(`Failed to download audio file: ${audioRes.status}`)
  const audioBlob = await audioRes.blob()
  const urlFileName = resolvedUrl.split('/').pop() || 'audio'
  const fileSize = audioBlob.size

  // Detect format from extension and content type
  const ext = (urlFileName.match(/\.(\w+)$/)?.[1] || '').toLowerCase()
  const contentType = (audioBlob.type || '').toLowerCase()
  const isContainerFormat = ['webm', 'ogg', 'opus', 'm4a', 'aac', 'mp4'].includes(ext)
    || contentType.includes('webm') || contentType.includes('ogg') || contentType.includes('mp4')
    || contentType.includes('m4a') || contentType.includes('aac')

  // 3. For large container formats that can't be split server-side,
  //    delegate to the frontend browser (which has AudioContext)
  if (isContainerFormat && fileSize > 25 * 1024 * 1024) {
    return {
      clientSideRequired: true,
      audioUrl: resolvedUrl,
      recordingId: resolvedRecordingId || null,
      format: ext || contentType,
      fileSize,
      language: language || null,
      message: `This ${(ext || 'audio').toUpperCase()} file (${(fileSize / 1024 / 1024).toFixed(1)}MB) needs browser-based processing. Transcribing on your device...`,
    }
  }

  // 4. For WAV, MP3, or small container files — use server-side chunked transcription
  const formData = new FormData()
  formData.append('file', audioBlob, urlFileName)
  formData.append('userId', userEmail || input.userId)
  formData.append('chunkDuration', '120')
  if (language) formData.append('language', language)

  const transcribeRes = await env.OPENAI_WORKER.fetch('https://openai-worker/audio/chunked-transcribe', {
    method: 'POST',
    body: formData,
  })

  if (!transcribeRes.ok) {
    const err = await transcribeRes.text()
    throw new Error(`Chunked transcription failed: ${err}`)
  }

  const transcription = await transcribeRes.json()
  if (transcription.error) throw new Error(transcription.error)

  const formatTime = (s) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const segments = []
  for (const seg of (transcription.segments || [])) {
    const segText = (seg.text || '').trim()
    if (!segText) continue
    if (transcription.totalChunks > 1) {
      segments.push(`[${formatTime(seg.startTime)} - ${formatTime(seg.endTime)}] ${segText}`)
    } else {
      segments.push(segText)
    }
  }

  const text = segments.join('\n\n')

  // 3. Optionally save back to portfolio
  let savedToPortfolio = false
  if (saveToPortfolio && resolvedRecordingId && userEmail && text) {
    const updateRes = await env.AUDIO_PORTFOLIO.fetch('https://audio-portfolio-worker/update-recording', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userEmail,
        recordingId: resolvedRecordingId,
        transcriptionText: text,
      }),
    })
    savedToPortfolio = updateRes.ok
  }

  return {
    text,
    chunks: transcription.totalChunks || 1,
    format: transcription.format || 'unknown',
    recordingId: resolvedRecordingId || null,
    audioUrl: resolvedUrl,
    savedToPortfolio,
    message: `Transcribed ${text.length} characters (${transcription.totalChunks || 1} chunk${(transcription.totalChunks || 1) > 1 ? 's' : ''}) via openai-worker${savedToPortfolio ? ' (saved to portfolio)' : ''}`,
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

// ── Tool dispatcher ───────────────────────────────────────────────

async function executeTool(toolName, toolInput, env, operationMap) {
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
    case 'get_formatting_reference':
      return { reference: FORMATTING_REFERENCE }
    case 'get_node_types_reference':
      return { reference: NODE_TYPES_REFERENCE }
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
    default:
      if (isOpenAPITool(toolName) && operationMap) {
        return await executeOpenAPITool(toolName, toolInput, env, operationMap)
      }
      throw new Error(`Unknown tool: ${toolName}`)
  }
}

export { executeTool, executeCreateHtmlFromTemplate, executeAnalyzeNode, executeAnalyzeGraph }
