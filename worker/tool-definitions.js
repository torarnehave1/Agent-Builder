/**
 * Tool definitions for the Vegvisr Agent
 *
 * Pure data — tool schemas that tell Claude what tools are available
 * and how to call them. No runtime logic here.
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
          description: 'MUST be a UUID (e.g. "550e8400-e29b-41d4-a716-446655440000"). Generate a random UUID — NEVER use human-readable names.'
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
    description: 'Add any type of node to a knowledge graph. Use this for fulltext (markdown), image, link, video, audio, or css-node types. For html-node pages, use create_html_from_template instead. The graph must already exist (use create_graph first). Call get_node_types_reference first if creating non-fulltext node types.',
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
          enum: ['fulltext', 'image', 'link', 'video', 'audio', 'css-node', 'html-node', 'mermaid-diagram', 'youtube-video', 'chart', 'linechart', 'bubblechart', 'notes', 'worknote', 'map', 'agent-contract', 'agent-config', 'agent-run'],
          description: 'Node type. Call get_node_types_reference for data format details.'
        },
        content: {
          type: 'string',
          description: 'Node content (stored in info field). Format depends on nodeType.'
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
    name: 'create_html_node',
    description: 'Create a custom HTML app/page as a node in a knowledge graph. Use this when the user wants a custom app that does NOT fit the 4 predefined templates (landing-page, editable-page, theme-builder, agent-chat). Generate a complete, standalone HTML document with inline CSS and JavaScript. The HTML is stored as an html-node and viewable at vegvisr.org/gnew-viewer?graphId=GRAPH_ID. Examples: portfolio gallery, dashboard, interactive tool, quiz, calculator, custom form.',
    input_schema: {
      type: 'object',
      properties: {
        graphId: {
          type: 'string',
          description: 'Graph ID (UUID). Create the graph first with create_graph.'
        },
        nodeId: {
          type: 'string',
          description: 'Unique node ID (kebab-case, e.g. "node-portfolio-app")'
        },
        label: {
          type: 'string',
          description: 'Display title for this app/page'
        },
        htmlContent: {
          type: 'string',
          description: 'Complete HTML document. Must be standalone — include all CSS inline in <style> and all JS inline in <script>. Use the KG API (knowledge.vegvisr.org) to fetch data at runtime if needed (e.g. album images, graph nodes).'
        },
        references: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional source URLs'
        }
      },
      required: ['graphId', 'nodeId', 'label', 'htmlContent']
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
    description: 'Create an HTML app from a template. Available templates: "landing-page" (single-page landing with sticky nav, renders all graph nodes as scrollable sections — best for marketing/showcase pages), "editable-page" (full page with navigation, markdown rendering, edit mode — best for content/docs), "theme-builder" (CSS variable editor for design tokens), "agent-chat" (conversational AI chat interface). The worker creates the html-node and content nodes. For editable-page, nodes whose label starts with # are discovered by the page. For landing-page, all nodes render as sections automatically.',
    input_schema: {
      type: 'object',
      properties: {
        graphId: {
          type: 'string',
          description: 'MUST be a UUID (e.g. "550e8400-e29b-41d4-a716-446655440000"). Generate a random UUID — NEVER use human-readable names.'
        },
        templateId: {
          type: 'string',
          enum: ['landing-page', 'editable-page', 'theme-builder', 'agent-chat'],
          description: 'Which HTML app template to use. "landing-page" for marketing/showcase pages, "editable-page" for content/docs (default), "theme-builder" for CSS editing, "agent-chat" for AI chat.'
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
    description: 'Read a knowledge graph: metadata, nodes (with type, label, and truncated info), and edges. Use this to inspect a graph before making changes. The response includes each node\'s type field — check this to find specific node types without re-fetching.',
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
    description: 'List available knowledge graphs with summaries. Returns graph IDs, titles, categories, meta areas, and node counts. Use metaArea to filter by a specific meta area (e.g. "NEUROSCIENCE", "AI TECHNOLOGY").',
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
        },
        metaArea: {
          type: 'string',
          description: 'Filter by meta area (e.g. "NEUROSCIENCE", "AI TECHNOLOGY"). Case-insensitive partial match.'
        }
      }
    }
  },
  {
    name: 'list_meta_areas',
    description: 'List all unique meta areas and categories across knowledge graphs. Returns sorted lists with graph counts for each. Use this when the user asks "what topics exist?", "what meta areas are available?", or wants to browse/discover content by topic.',
    input_schema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'perplexity_search',
    description: 'Search the web using Perplexity AI with real-time results and citations. Returns detailed answers with source URLs. Use this for in-depth research, recent news, or when you need cited sources. Choose model: "sonar" (fast), "sonar-pro" (deep search), or "sonar-reasoning" (complex analysis).',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query'
        },
        model: {
          type: 'string',
          enum: ['sonar', 'sonar-pro', 'sonar-reasoning'],
          description: 'Perplexity model: sonar (fast, default), sonar-pro (deep search), sonar-reasoning (complex analysis)'
        },
        search_recency_filter: {
          type: 'string',
          enum: ['day', 'week', 'month', 'year'],
          description: 'Filter results by recency (optional)'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'search_pexels',
    description: 'Search Pexels for free stock photos. Returns image URLs, photographer credits, and dimensions. Use the returned URLs in image nodes or as header images in templates.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query for images (e.g. "mountain landscape", "team collaboration")'
        },
        count: {
          type: 'number',
          description: 'Number of images to return (default 5, max 20)'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'search_unsplash',
    description: 'Search Unsplash for free stock photos. Returns image URLs, photographer credits, and dimensions. Use the returned URLs in image nodes or as header images in templates.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query for images (e.g. "nature sunset", "office workspace")'
        },
        count: {
          type: 'number',
          description: 'Number of images to return (default 5, max 20)'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'get_album_images',
    description: 'Get images from a user photo album stored in Vegvisr. Returns image URLs served via imgix CDN. Use these images in graphs, templates, or content nodes.',
    input_schema: {
      type: 'object',
      properties: {
        albumName: {
          type: 'string',
          description: 'Name of the photo album to retrieve'
        }
      },
      required: ['albumName']
    }
  },
  {
    name: 'get_formatting_reference',
    description: 'Get the fulltext formatting syntax reference (SECTION, FANCY, QUOTE, IMAGEQUOTE, positioned images, FLEXBOX layouts). Call this BEFORE creating styled/formatted content in fulltext nodes.',
    input_schema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'get_node_types_reference',
    description: 'Get data format reference for node types (mermaid-diagram, youtube-video, chart, linechart, bubblechart, notes, worknote, map). Call this when creating nodes other than fulltext, image, or link.',
    input_schema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'analyze_node',
    description: 'Analyze semantic content of a single knowledge graph node using Claude. Returns sentiment, importance weight (0-1), keywords, and a brief summary. Optionally stores results in node metadata.',
    input_schema: {
      type: 'object',
      properties: {
        graphId: { type: 'string', description: 'The graph containing the node' },
        nodeId: { type: 'string', description: 'The node to analyze' },
        analysisType: {
          type: 'string',
          enum: ['sentiment', 'keywords', 'weight', 'summary', 'all'],
          description: 'What to analyze. Default: "all"'
        },
        store: {
          type: 'boolean',
          description: 'If true, store results in node.metadata.analysis. Default: false'
        }
      },
      required: ['graphId', 'nodeId']
    }
  },
  {
    name: 'analyze_graph',
    description: 'Analyze all nodes in a knowledge graph using Claude. Returns graph-level sentiment, topic clusters, node importance rankings, and an overall summary. Best for understanding the full meaning of a graph.',
    input_schema: {
      type: 'object',
      properties: {
        graphId: { type: 'string', description: 'The graph to analyze' },
        store: {
          type: 'boolean',
          description: 'If true, store per-node weights in each node metadata. Default: false'
        }
      },
      required: ['graphId']
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

export { TOOL_DEFINITIONS, WEB_SEARCH_TOOL }
