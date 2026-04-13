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
          enum: ['fulltext', 'image', 'link', 'video', 'audio', 'css-node', 'html-node', 'mermaid-diagram', 'youtube-video', 'cloudflare-video', 'cloudflare-live', 'chart', 'linechart', 'bubblechart', 'notes', 'worknote', 'map', 'agent-contract', 'agent-config', 'agent-run', 'data-node'],
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
        defaultTheme: {
          type: 'string',
          description: 'Default theme ID or label to auto-apply (e.g. "warm-cream", "Dark Glass"). When set, the theme picker is hidden for non-Superadmin users and this theme loads automatically.'
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
    description: 'Read graph STRUCTURE: metadata, node list (id, label, type, truncated info preview), and edges. Use this to see what a graph contains. Content nodes (fulltext, info) show up to 2000 chars; HTML/CSS nodes show 200 chars. If info_truncated=true, use read_node or read_graph_content to get the full text.',
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
    name: 'read_graph_content',
    description: 'Read FULL CONTENT of all nodes in a graph — no truncation. Use this when you need to analyze, compare, or work with the actual text content. Optionally filter by node type. WARNING: can return large results for graphs with many nodes.',
    input_schema: {
      type: 'object',
      properties: {
        graphId: {
          type: 'string',
          description: 'The graph ID to read'
        },
        nodeTypes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: only return nodes of these types (e.g. ["fulltext", "info"]). Omit to get all nodes.'
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
    name: 'edit_html_node',
    description: 'Surgically edit an html-node by finding and replacing an exact string in its HTML content. Unlike patch_node (which replaces the entire info field), this tool only changes the specific part you target — all other code stays untouched. Use this instead of patch_node when modifying existing HTML apps to avoid accidentally breaking working code. You can make multiple edits by calling this tool multiple times.',
    input_schema: {
      type: 'object',
      properties: {
        graphId: {
          type: 'string',
          description: 'The graph ID containing the html-node'
        },
        nodeId: {
          type: 'string',
          description: 'The html-node ID to edit'
        },
        old_string: {
          type: 'string',
          description: 'The exact string to find in the HTML. Must be unique in the document. Include enough surrounding context to make it unique.'
        },
        new_string: {
          type: 'string',
          description: 'The replacement string. Can be larger than old_string (for adding code) or empty string (for removing code).'
        },
        replace_all: {
          type: 'boolean',
          description: 'If true, replace ALL occurrences of old_string. Default false (replaces only the first match).'
        }
      },
      required: ['graphId', 'nodeId', 'old_string', 'new_string']
    }
  },
  {
    name: 'patch_graph_metadata',
    description: 'Update graph-level metadata fields (title, description, category, metaArea, etc.) without re-sending all nodes and edges. Only the provided fields are changed; others are preserved.',
    input_schema: {
      type: 'object',
      properties: {
        graphId: {
          type: 'string',
          description: 'The graph ID to update'
        },
        fields: {
          type: 'object',
          description: 'Metadata fields to update. Valid keys: title, description, category, metaArea, createdBy, graphType, seoSlug, publicationState.',
          properties: {
            title: { type: 'string', description: 'Graph title' },
            description: { type: 'string', description: 'Graph description' },
            category: { type: 'string', description: 'Category tags (e.g. "#AI #Research")' },
            metaArea: { type: 'string', description: 'Meta area tag in ALL CAPS (e.g. "#NINE", "#SANSKRIT")' }
          }
        }
      },
      required: ['graphId', 'fields']
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
    name: 'search_graphs',
    description: 'Search graph content by text (searches across ALL nodes in ALL graphs) OR filter by node type/category. Fast direct search without using LLM tokens. Use when user asks "find where X is mentioned", "search for X in my graphs", "what graph contains X?", or "find graphs with node type Y". For meta area filtering, use list_graphs with metaArea instead. Returns matching graph IDs, titles, and which nodes matched.',
    input_schema: {
      type: 'object',
      properties: {
        q: {
          type: 'string',
          description: 'Search text to find. Supports * wildcard for unknown middle words (e.g., "Per * Stilling" matches "Per Egenæss Stilling"). Examples: "Areopagos", "revenue", "Per * Stilling".'
        },
        nodeType: {
          type: 'string',
          description: 'Optional: filter by node type (e.g., "fulltext", "html-node", "mermaid-diagram")'
        },
        category: {
          type: 'string',
          description: 'Optional: filter by category tag (e.g., "#PROFF")'
        },
        limit: {
          type: 'number',
          description: 'Max number of results (default 20, max 100)'
        },
        offset: {
          type: 'number',
          description: 'Offset for pagination (default 0)'
        }
      }
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
    name: 'fetch_url',
    description: 'Fetch a public URL directly and return cleaned text plus metadata. Use this when the user provides a specific URL and asks for analysis or extraction. Prefer this over search tools when the exact page URL is known.',
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Public HTTPS URL to fetch'
        },
        maxChars: {
          type: 'number',
          description: 'Optional max number of text characters to return (default 12000, max 40000).'
        }
      },
      required: ['url']
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
    name: 'analyze_image',
    description: 'Analyze an image by URL. Useful for describing photos, extracting text (OCR), identifying objects, or answering questions about visual content. Works with imgix CDN URLs (vegvisr.imgix.net) and any public image URL.',
    input_schema: {
      type: 'object',
      properties: {
        imageUrl: {
          type: 'string',
          description: 'URL of the image to analyze (must be publicly accessible, e.g. https://vegvisr.imgix.net/<key>)'
        },
        question: {
          type: 'string',
          description: 'What to analyze or ask about the image. Default: "Describe this image in detail."'
        }
      },
      required: ['imageUrl']
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
    description: 'Get data format reference for node types (mermaid-diagram, youtube-video, cloudflare-video, cloudflare-live, chart, linechart, bubblechart, notes, worknote, map). Call this when creating nodes other than fulltext, image, or link.',
    input_schema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'get_html_builder_reference',
    description: 'Get the complete HTML app builder reference — editing rules (edit_html_node scoping, matching tips), Drizzle API (all endpoints with request/response formats), CSS design system variables, error handling and logging conventions, preview error debugging process, and proactive coding rules. Call this BEFORE creating, editing, or debugging any HTML app.',
    input_schema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'list_recordings',
    description: 'List audio recordings from the current user\'s audio portfolio. Automatically uses the logged-in user\'s email. Returns recording metadata including titles, durations, tags, and transcription status. Use this to find recordings before transcribing them.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max recordings to return (default 20)' },
        query: { type: 'string', description: 'Optional search query to filter recordings by name, tags, or transcription text' }
      }
    }
  },
  {
    name: 'transcribe_audio',
    description: 'Transcribe an audio file. Provide either a recordingId (to transcribe from the audio portfolio) or an audioUrl (direct R2/public URL). Automatically uses the logged-in user\'s email for portfolio lookups. Returns the transcription text. Use saveToGraph to create a graph with the transcription as a fulltext node directly — this saves directly without sending the full text through the LLM, so it is much faster for large transcriptions. ALWAYS use saveToGraph:true when the user asks to transcribe and save/create a graph.',
    input_schema: {
      type: 'object',
      properties: {
        recordingId: { type: 'string', description: 'Portfolio recording ID (e.g. rec_1709123456_abc). If provided, fetches the audio URL from portfolio metadata.' },
        audioUrl: { type: 'string', description: 'Direct URL to audio file (e.g. https://audio.vegvisr.org/audio/...). Use this for files not in the portfolio.' },
        service: { type: 'string', enum: ['openai', 'cloudflare'], description: 'Transcription service. Default: openai (higher quality)' },
        language: { type: 'string', description: 'Language code hint (e.g. "en", "no"). Improves accuracy.' },
        saveToPortfolio: { type: 'boolean', description: 'If true and recordingId provided, save transcription text back to portfolio metadata. Default: false' },
        saveToGraph: { type: 'boolean', description: 'If true, after transcription the frontend creates a new graph with the transcription as a fulltext node directly (no LLM round-trip). Default: false' },
        graphTitle: { type: 'string', description: 'Title for the new graph when saveToGraph is true. Auto-generated from recording name if not provided.' }
      }
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
  },
  {
    name: 'who_am_i',
    description: 'Get the current logged-in user\'s profile information including email, role, bio, branding, profile image, and configured API keys. No parameters needed — automatically uses the current user context. The bio field contains the user\'s full biography — always output it verbatim when asked.',
    input_schema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'admin_register_user',
    description: 'Register a new user in the Vegvisr platform. Superadmin only. Creates a user record with email, phone, and role. The new user can then log in via magic link at login.vegvisr.org using their email. Returns the generated user_id and emailVerificationToken.',
    input_schema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address for the new user (required)'
        },
        name: {
          type: 'string',
          description: 'Full name of the new user (optional)'
        },
        phone: {
          type: 'string',
          description: 'Phone number for the new user (optional)'
        },
        role: {
          type: 'string',
          enum: ['Admin', 'user', 'Subscriber', 'Superadmin'],
          description: 'Role to assign. Default: "Admin"'
        }
      },
      required: ['email']
    }
  },
  {
    name: 'send_email',
    description: 'Send an email on behalf of the user. Uses the user\'s configured email account (Gmail or SMTP/vegvisr.org). Requires the user to have at least one email account set up in their profile settings. Use this when the user asks to send, write, or compose an email.',
    input_schema: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Recipient email address (required)'
        },
        subject: {
          type: 'string',
          description: 'Email subject line (required)'
        },
        html: {
          type: 'string',
          description: 'Email body as HTML (required). Wrap plain text in <p> tags.'
        },
        fromEmail: {
          type: 'string',
          description: 'Sender email address (optional). If omitted, uses the user\'s default email account.'
        }
      },
      required: ['to', 'subject', 'html']
    }
  },
  {
    name: 'analyze_transcription',
    description: 'Analyze a conversation transcription from the Enkel Endring program. Fetches the transcription from a graph node and produces a structured Norwegian-language report with: key themes, success indicators, powerful quotes, action points, and mentor feedback. Use this when the user asks for a "vurdering", "analyse", or "rapport" of a transcription.',
    input_schema: {
      type: 'object',
      properties: {
        graphId: { type: 'string', description: 'The graph containing the transcription node' },
        nodeId: { type: 'string', description: 'The node with the transcription text. If not provided, uses the first fulltext node in the graph.' },
        conversationType: {
          type: 'string',
          enum: ['1-1', 'group'],
          description: 'Type of conversation. "1-1" for individual sessions, "group" for group sessions. Affects analysis focus. Default: "1-1"'
        },
        saveToGraph: {
          type: 'boolean',
          description: 'If true, save the analysis as a new fulltext node in the same graph. Default: true'
        }
      },
      required: ['graphId']
    }
  },
  {
    name: 'save_form_data',
    description: 'Append a data record to a data-node in a knowledge graph. Creates the data-node if it does not exist. Data is encrypted at rest automatically by the KG worker. The node ID is always a UUID.',
    input_schema: {
      type: 'object',
      properties: {
        graphId: { type: 'string', description: 'Graph ID containing (or to contain) the data-node' },
        nodeId: { type: 'string', description: 'data-node UUID. If omitted, a new UUID is auto-generated.' },
        record: { type: 'object', description: 'Key-value record to append (e.g., {"name":"John","email":"john@example.com","message":"Hello"})' },
        schema: {
          type: 'object',
          description: 'Column schema (required when creating a new data-node). Example: { "columns": [{"key":"name","label":"Name","type":"text"},{"key":"email","label":"Email","type":"email"}] }'
        },
        label: { type: 'string', description: 'Node label (required when creating). Start with # for landing page visibility (e.g., "#Contact Submissions").' },
        formTitle: { type: 'string', description: 'Title shown above the submission form in the landing page (e.g., "Contact Us").' }
      },
      required: ['graphId', 'record']
    }
  },
  {
    name: 'query_data_nodes',
    description: 'Read records from a data-node. Returns the decrypted data as a JSON array with schema information.',
    input_schema: {
      type: 'object',
      properties: {
        graphId: { type: 'string', description: 'Graph ID' },
        nodeId: { type: 'string', description: 'data-node UUID' },
        limit: { type: 'number', description: 'Max records to return (default 50, max 200)' },
        offset: { type: 'number', description: 'Skip first N records (default 0)' },
        filterKey: { type: 'string', description: 'Optional: filter by this field key' },
        filterValue: { type: 'string', description: 'Optional: match this value (case-insensitive contains)' }
      },
      required: ['graphId', 'nodeId']
    }
  },
  {
    name: 'create_app_table',
    description: 'Create a new relational database table (D1) for structured app data. Use this instead of data-node when you need proper relational storage with SQL queries. Tables are linked to a graphId.',
    input_schema: {
      type: 'object',
      properties: {
        graphId: { type: 'string', description: 'Graph ID that owns this table' },
        displayName: { type: 'string', description: 'Human-readable table name (e.g., "Contact Submissions")' },
        columns: {
          type: 'array',
          description: 'Column definitions. Each column has name (lowercase, e.g. "email"), label (display name), type (text|integer|real|boolean|datetime), and optional required (boolean).',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Column name (lowercase alphanumeric + underscores, e.g., "first_name")' },
              label: { type: 'string', description: 'Display label (e.g., "First Name")' },
              type: { type: 'string', enum: ['text', 'integer', 'real', 'boolean', 'datetime'], description: 'Column data type' },
              required: { type: 'boolean', description: 'Whether this column is required' }
            },
            required: ['name', 'type']
          }
        }
      },
      required: ['graphId', 'displayName', 'columns']
    }
  },
  {
    name: 'insert_app_record',
    description: 'Insert a record into an app data table. The table must have been created with create_app_table first.',
    input_schema: {
      type: 'object',
      properties: {
        tableId: { type: 'string', description: 'Table UUID, table name, or display name' },
        record: { type: 'object', description: 'Key-value pairs matching the table columns (e.g., {"name":"John","email":"john@test.com"})' }
      },
      required: ['tableId', 'record']
    }
  },
  {
    name: 'query_app_table',
    description: 'Query records from an app data table with optional filtering, ordering, and pagination.',
    input_schema: {
      type: 'object',
      properties: {
        tableId: { type: 'string', description: 'Table UUID, table name, or display name' },
        where: { type: 'object', description: 'Optional filter conditions as key-value pairs (e.g., {"email":"john@test.com"})' },
        orderBy: { type: 'string', description: 'Column to order by (default: _created_at)' },
        order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction (default: desc)' },
        limit: { type: 'number', description: 'Max records to return (default 50, max 1000)' },
        offset: { type: 'number', description: 'Skip first N records (default 0)' }
      },
      required: ['tableId']
    }
  },
  {
    name: 'add_app_table_column',
    description: 'Add a new column to an existing app data table. Alters the D1 table and registers the column in metadata. Use when the user wants a new field (e.g. "add a birthday field").',
    input_schema: {
      type: 'object',
      properties: {
        tableId: { type: 'string', description: 'Table UUID, table name, or display name' },
        name: { type: 'string', description: 'Column name (lowercase, alphanumeric with underscores, e.g. "birthday")' },
        type: { type: 'string', enum: ['text', 'integer', 'real', 'boolean', 'datetime'], description: 'Column data type' },
        label: { type: 'string', description: 'Display label (e.g. "Bursdag")' },
        required: { type: 'boolean', description: 'Whether the column is required (default false)' }
      },
      required: ['tableId', 'name', 'type']
    }
  },
  {
    name: 'get_app_table_schema',
    description: 'Get the schema of an app data table — returns column names, types, labels, and constraints. Use to understand what data a table stores before querying, inserting, or building UI for it.',
    input_schema: {
      type: 'object',
      properties: {
        tableId: { type: 'string', description: 'Table UUID, table name, or display name' }
      },
      required: ['tableId']
    }
  },
  {
    name: 'delete_app_records',
    description: 'Delete records from an app data table. Can delete all records (clear table), delete by specific IDs, or delete by filter conditions.',
    input_schema: {
      type: 'object',
      properties: {
        tableId: { type: 'string', description: 'Table UUID, table name, or display name' },
        ids: { type: 'array', items: { type: 'string' }, description: 'Optional: array of _id values to delete specific records' },
        where: { type: 'object', description: 'Optional: filter conditions as key-value pairs (e.g., {"worker":"kg-worker"}). Omit both ids and where to delete ALL records.' }
      },
      required: ['tableId']
    }
  },
  {
    name: 'generate_with_ai',
    description: 'Generate text content using a specific AI provider. Use this when the user asks to generate content with a particular AI (Claude, OpenAI/GPT, Grok, Gemini). Returns the generated text. For bulk operations (e.g., filling a table), call this once per item and insert the result with insert_app_record.',
    input_schema: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: ['claude', 'openai', 'grok', 'gemini'], description: 'Which AI provider to use' },
        prompt: { type: 'string', description: 'The prompt/instruction for content generation' },
        model: { type: 'string', description: 'Optional: specific model name (e.g., "claude-sonnet-4-5", "gpt-4o", "grok-4-latest", "gemini-2.5-flash"). If omitted, uses the provider default.' },
        maxTokens: { type: 'number', description: 'Max tokens to generate (default: 2048)' }
      },
      required: ['provider', 'prompt']
    }
  },
  {
    name: 'save_learning',
    description: 'Save a learned behavior or self-knowledge to graph_system_prompt so it persists across conversations. Use this when: (1) the user corrects your behavior, (2) the user teaches you something about how your own system works (architecture, tools, databases, workers, data sources), (3) you discover something about yourself that should be remembered. The learning becomes a permanent rule loaded at every conversation start.',
    input_schema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Short name for the learning (e.g., "Don\'t use Perplexity for data generation", "get_node_types_reference reads from system-prompt.js")' },
        rule: { type: 'string', description: 'The full description of what was learned — behavior rule, architecture fact, tool data source, or system insight' },
        category: { type: 'string', enum: ['routing', 'behavior', 'error', 'formatting', 'architecture', 'self-knowledge'], description: 'Category of the learning. Use architecture/self-knowledge for facts about your own system.' }
      },
      required: ['label', 'rule']
    }
  },
  {
    name: 'db_list_tables',
    description: 'List all tables in the main vegvisr_org database with their columns. Use this to explore the database schema (config, user_api_keys, graphs, etc.).',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'db_query',
    description: 'Run a read-only SQL SELECT query against the main vegvisr_org database. Use this to inspect config, user_api_keys, graphs, and other tables. Only SELECT queries are allowed.',
    input_schema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'SQL SELECT query to execute (e.g., "SELECT email, Role FROM config LIMIT 10")' },
        params: {
          type: 'array',
          description: 'Optional bind parameters for the query (e.g., ["torarnehave@gmail.com"])',
          items: { type: 'string' }
        }
      },
      required: ['sql']
    }
  },
  {
    name: 'calendar_list_tables',
    description: 'List all tables in the calendar database (calendar_db). Returns table names so you can explore the calendar schema.',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'calendar_query',
    description: 'Run a read-only SQL query against the calendar database (calendar_db). Use this to view bookings, settings, availability, meeting types, and group meetings. Only SELECT queries are allowed.',
    input_schema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'SQL SELECT query to execute (e.g., "SELECT * FROM bookings LIMIT 10")' },
        params: {
          type: 'array',
          description: 'Optional bind parameters for the query (e.g., ["torarnehave@gmail.com"])',
          items: { type: 'string' }
        }
      },
      required: ['sql']
    }
  },
  {
    name: 'chat_db_list_tables',
    description: 'List all tables in the chat database (hallo_vegvisr_chat). Returns table names so you can explore the chat schema — groups, group_messages, group_members, chat_bots, polls, etc.',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'chat_db_query',
    description: 'Run a read-only SQL SELECT query against the chat database (hallo_vegvisr_chat). Use this to count messages, analyze chat data, check group membership, inspect bots, etc. Only SELECT queries are allowed. Key tables: groups, group_messages, group_members, chat_bots, polls, poll_votes, message_reactions.',
    input_schema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'SQL SELECT query to execute (e.g., "SELECT COUNT(*) FROM group_messages WHERE group_id = ?")' },
        params: {
          type: 'array',
          description: 'Optional bind parameters for the query (e.g., ["66229483-281d-4be2-86d7-c63858f8fdc6"])',
          items: { type: 'string' }
        }
      },
      required: ['sql']
    }
  },
  {
    name: 'add_whats_new',
    description: "Add a feature entry to any Vegvisr app's What's New page. Creates a node in graph_<app>_new_features (auto-creates the graph if it doesn't exist). Users see new entries via the info icon in each app. Use after deploying a feature or when the user asks to document a change.",
    input_schema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'Target app: "chat", "calendar", "photos", "aichat", "vemail", "connect". Determines which graph to update (graph_<app>_new_features).' },
        title: { type: 'string', description: 'Short feature title (e.g., "Voice Message Titles")' },
        description: { type: 'string', description: 'One-paragraph explanation of the feature and how users benefit from it' },
        color: { type: 'string', description: 'Hex color for the feature dot (e.g., "#38bdf8" for blue, "#a78bfa" for purple, "#34d399" for green, "#f59e0b" for amber). Optional, defaults to sky blue.' }
      },
      required: ['app', 'title', 'description']
    }
  },
  {
    name: 'add_user_suggestion',
    description: "Add a user suggestion to any Vegvisr app's Suggestions board. Creates a node in graph_<app>_user_suggestions (auto-creates the graph if it doesn't exist). Use when a user asks to submit a feature request, bug report, or improvement idea.",
    input_schema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'Target app: "chat", "calendar", "photos", "aichat", "vemail", "connect". Determines which graph to update (graph_<app>_user_suggestions).' },
        title: { type: 'string', description: 'Short suggestion title (e.g., "Add dark mode")' },
        description: { type: 'string', description: 'Detailed description of the suggestion' },
        category: { type: 'string', description: 'Category: "feature", "bug", "ux", "integration", "other". Defaults to "feature".' }
      },
      required: ['app', 'title', 'description']
    }
  },
  {
    name: 'update_suggestion_status',
    description: "Update the status of an existing user suggestion. Use when an admin wants to mark a suggestion as reviewed, planned, or shipped. Requires the suggestion node ID (e.g., 'suggestion-1710000000000').",
    input_schema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'Target app: "chat", "calendar", "photos", "aichat", "vemail", "connect". Determines which graph to query (graph_<app>_user_suggestions).' },
        suggestionId: { type: 'string', description: 'The node ID of the suggestion to update (e.g., "suggestion-1710000000000")' },
        status: { type: 'string', enum: ['new', 'reviewed', 'planned', 'shipped'], description: 'New status for the suggestion' }
      },
      required: ['app', 'suggestionId', 'status']
    }
  },
  {
    name: 'calendar_get_settings',
    description: 'Get a user\'s booking profile — availability hours, available days of the week, meeting types (with durations), and upcoming group meetings. Use this before booking to understand what slots and meeting types are available.',
    input_schema: {
      type: 'object',
      properties: {
        userEmail: { type: 'string', description: 'The calendar owner\'s email address' }
      },
      required: ['userEmail']
    }
  },
  {
    name: 'calendar_check_availability',
    description: 'Check booked time slots for a specific date. Returns occupied slots from both D1 bookings and Google Calendar events. Use this to find free time before creating a booking.',
    input_schema: {
      type: 'object',
      properties: {
        userEmail: { type: 'string', description: 'The calendar owner\'s email address' },
        date: { type: 'string', description: 'Date to check in YYYY-MM-DD format (e.g., "2026-03-10")' }
      },
      required: ['userEmail', 'date']
    }
  },
  {
    name: 'calendar_list_bookings',
    description: 'List all bookings for a user with guest details, times, and meeting type info. Use this to see upcoming and past appointments.',
    input_schema: {
      type: 'object',
      properties: {
        userEmail: { type: 'string', description: 'The calendar owner\'s email address' }
      },
      required: ['userEmail']
    }
  },
  {
    name: 'calendar_create_booking',
    description: 'Book a meeting for a user. Automatically syncs to Google Calendar if connected. Returns conflict error if the time slot is already taken. Times must be ISO 8601 format.',
    input_schema: {
      type: 'object',
      properties: {
        ownerEmail: { type: 'string', description: 'The calendar owner\'s email address (who is being booked)' },
        guestName: { type: 'string', description: 'Full name of the guest booking the meeting' },
        guestEmail: { type: 'string', description: 'Email address of the guest' },
        startTime: { type: 'string', description: 'Meeting start time in ISO 8601 format (e.g., "2026-03-10T10:00:00.000Z")' },
        endTime: { type: 'string', description: 'Meeting end time in ISO 8601 format (e.g., "2026-03-10T10:30:00.000Z")' },
        description: { type: 'string', description: 'Optional meeting description or notes' },
        meetingTypeId: { type: 'number', description: 'Optional meeting type ID (from calendar_get_settings)' }
      },
      required: ['ownerEmail', 'guestName', 'guestEmail', 'startTime', 'endTime']
    }
  },
  {
    name: 'calendar_reschedule_booking',
    description: 'Reschedule an existing booking to a new time. Updates both D1 and Google Calendar (if synced). Returns conflict error (409) if the new time overlaps another booking.',
    input_schema: {
      type: 'object',
      properties: {
        userEmail: { type: 'string', description: 'The calendar owner\'s email address' },
        bookingId: { type: 'number', description: 'The booking ID to reschedule (from calendar_list_bookings)' },
        newStartTime: { type: 'string', description: 'New start time in ISO 8601 format (e.g., "2026-03-12T14:00:00.000Z")' },
        newEndTime: { type: 'string', description: 'New end time in ISO 8601 format (e.g., "2026-03-12T14:30:00.000Z")' }
      },
      required: ['userEmail', 'bookingId', 'newStartTime', 'newEndTime']
    }
  },
  {
    name: 'calendar_delete_booking',
    description: 'Cancel/delete a booking. Removes it from D1 and from Google Calendar (if synced). This action cannot be undone.',
    input_schema: {
      type: 'object',
      properties: {
        userEmail: { type: 'string', description: 'The calendar owner\'s email address' },
        bookingId: { type: 'number', description: 'The booking ID to delete (from calendar_list_bookings)' }
      },
      required: ['userEmail', 'bookingId']
    }
  },
  {
    name: 'calendar_get_status',
    description: 'Check if a user\'s Google Calendar is connected. Returns connected: true/false.',
    input_schema: {
      type: 'object',
      properties: {
        userEmail: { type: 'string', description: 'The calendar owner\'s email address' }
      },
      required: ['userEmail']
    }
  },
  {
    name: 'list_chat_groups',
    description: 'List all chat groups in Hallo Vegvisr. Returns group IDs and names. Use this to find a group before adding users.',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'add_user_to_chat_group',
    description: 'Add a vegvisr.org user (by email) to a chat group in Hallo Vegvisr. Looks up the user in the vegvisr_org config table, then adds them to the specified group.',
    input_schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'User email address (must exist in vegvisr.org)' },
        groupId: { type: 'string', description: 'Chat group UUID (use list_chat_groups to find it)' },
        groupName: { type: 'string', description: 'Chat group name — used to find groupId if groupId is not provided' },
        role: { type: 'string', enum: ['member', 'admin'], description: 'Role in the group (default: member)' }
      },
      required: ['email']
    }
  },
  {
    name: 'get_group_messages',
    description: 'Get ALL messages from a Hallo Vegvisr chat group. Automatically paginates to fetch the complete history. Returns message text, sender email, and timestamp. Use this to read, analyze, summarize, or do sentiment analysis on group conversations.',
    input_schema: {
      type: 'object',
      properties: {
        groupId: { type: 'string', description: 'Chat group UUID' },
        groupName: { type: 'string', description: 'Chat group name (resolves to groupId if groupId not provided)' },
        limit: { type: 'number', description: 'Max messages to return (default 200, max 4000). Fetches all by paginating automatically.' }
      },
      required: []
    }
  },
  {
    name: 'get_group_stats',
    description: 'Get activity statistics for all Hallo Vegvisr chat groups. Returns message count, member count, last message time, and creator for each group, sorted by most active.',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'send_group_message',
    description: 'Send a text or voice message to a Hallo Vegvisr chat group on behalf of a user. The user must be a member of the group. For voice messages, use list_recordings to get the audioUrl first.',
    input_schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Sender email address (must exist in vegvisr.org and be a group member)' },
        groupId: { type: 'string', description: 'Chat group UUID' },
        groupName: { type: 'string', description: 'Chat group name (resolves to groupId if groupId not provided)' },
        body: { type: 'string', description: 'Message text to send (required for text, optional for voice)' },
        messageType: { type: 'string', enum: ['text', 'voice'], description: 'Message type (default: text)' },
        audioUrl: { type: 'string', description: 'URL to audio file (required for voice messages). Get from list_recordings.' },
        audioDurationMs: { type: 'number', description: 'Audio duration in milliseconds' },
        transcriptText: { type: 'string', description: 'Transcription of the voice message' },
        transcriptLang: { type: 'string', description: 'Language code of transcript (e.g. "en", "no")' }
      },
      required: ['email']
    }
  },
  {
    name: 'create_chat_group',
    description: 'Create a new Hallo Vegvisr chat group. The creator (identified by email) becomes the owner. Use this when the user asks to create or set up a new chat group.',
    input_schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Email of the user creating the group (becomes owner)' },
        name: { type: 'string', description: 'Name for the new chat group' },
        graphId: { type: 'string', description: 'Optional knowledge graph ID to link to the group' }
      },
      required: ['email', 'name']
    }
  },
  {
    name: 'register_chat_bot',
    description: 'Register an AI chatbot in a Hallo Vegvisr chat group. Creates the bot and optionally adds it to a group. Only Superadmin can do this. The bot can be @mentioned by users in the group to trigger responses.',
    input_schema: {
      type: 'object',
      properties: {
        botName: { type: 'string', description: 'Display name for the bot (e.g. "SIMULA")' },
        username: { type: 'string', description: 'Unique @username for the bot (lowercase, alphanumeric, - or _). Users @mention this to trigger the bot.' },
        graphId: { type: 'string', description: 'Knowledge graph ID containing bot personality (fulltext nodes become personality context)' },
        systemPrompt: { type: 'string', description: 'System prompt for the bot (optional, used alongside graph personality)' },
        avatarUrl: { type: 'string', description: 'URL to bot avatar image' },
        model: { type: 'string', description: 'Claude model to use (default: claude-haiku-4-5-20251001)' },
        temperature: { type: 'number', description: 'Response temperature 0-1 (default: 0.7)' },
        maxTurns: { type: 'number', description: 'Max tool-use turns per response (default: 10, max: 20)' },
        tools: { type: 'array', items: { type: 'string' }, description: 'Bot tools to enable: search_knowledge, read_node, web_search, translate' },
        groupId: { type: 'string', description: 'Chat group UUID to add the bot to (optional — can add later)' },
      },
      required: ['botName', 'username']
    }
  },
  {
    name: 'get_group_members',
    description: 'Get all members of a chat group with their names, emails, IDs, roles, and profile images. Also shows which members are bots.',
    input_schema: {
      type: 'object',
      properties: {
        groupId: { type: 'string', description: 'Chat group UUID' },
        groupName: { type: 'string', description: 'Chat group name (use this or groupId)' }
      },
      required: []
    }
  },
  {
    name: 'trigger_bot_response',
    description: 'Trigger a chatbot to respond in its group. The bot uses the chatbot subagent (with tools like search_knowledge, web_search). Posts the response back to the group automatically.',
    input_schema: {
      type: 'object',
      properties: {
        groupId: { type: 'string', description: 'Chat group UUID' },
        botId: { type: 'string', description: 'Specific bot ID to trigger. If omitted, triggers all bots in the group.' },
        messageCount: { type: 'number', description: 'Number of recent messages to include as context (default 20, max 50)' }
      },
      required: ['groupId']
    }
  },
  {
    name: 'delete_chat_group',
    description: 'Archive (soft-delete) a Hallo Vegvisr chat group. Only Superadmin can do this. The group can be restored later with restore_chat_group.',
    input_schema: {
      type: 'object',
      properties: {
        groupId: { type: 'string', description: 'Chat group UUID to archive' },
        groupName: { type: 'string', description: 'Chat group name (resolves to groupId if groupId not provided)' }
      },
      required: []
    }
  },
  {
    name: 'restore_chat_group',
    description: 'Restore a previously archived Hallo Vegvisr chat group. Only Superadmin can do this.',
    input_schema: {
      type: 'object',
      properties: {
        groupId: { type: 'string', description: 'Chat group UUID to restore' }
      },
      required: ['groupId']
    }
  },
  {
    name: 'update_chat_group',
    description: 'Update a Hallo Vegvisr chat group name or image. Only the group owner or admin can do this.',
    input_schema: {
      type: 'object',
      properties: {
        groupId: { type: 'string', description: 'Chat group UUID' },
        groupName: { type: 'string', description: 'Chat group name (resolves to groupId if groupId not provided)' },
        name: { type: 'string', description: 'New group name' },
        imageUrl: { type: 'string', description: 'New group image URL (empty string to remove)' }
      },
      required: []
    }
  },
  {
    name: 'remove_chat_bot',
    description: 'Remove an AI chatbot from a Hallo Vegvisr chat group, or deactivate the bot entirely. Only Superadmin can do this.',
    input_schema: {
      type: 'object',
      properties: {
        botId: { type: 'string', description: 'Bot ID to remove' },
        groupId: { type: 'string', description: 'Group UUID to remove the bot from. If omitted, deactivates the bot entirely.' }
      },
      required: ['botId']
    }
  },
  {
    name: 'create_poll',
    description: 'Create a poll in a Hallo Vegvisr chat group. The poll appears as a message that members can vote on.',
    input_schema: {
      type: 'object',
      properties: {
        groupId: { type: 'string', description: 'Chat group UUID' },
        groupName: { type: 'string', description: 'Chat group name (resolves to groupId if groupId not provided)' },
        question: { type: 'string', description: 'Poll question' },
        options: { type: 'array', items: { type: 'string' }, description: 'Array of poll options (2-6 choices)' }
      },
      required: ['question', 'options']
    }
  },
  {
    name: 'close_poll',
    description: 'Close a poll so no more votes can be cast. Only the poll creator or Superadmin can close it.',
    input_schema: {
      type: 'object',
      properties: {
        pollId: { type: 'string', description: 'Poll UUID to close' }
      },
      required: ['pollId']
    }
  },
  {
    name: 'get_poll_results',
    description: 'Get the current results of a poll, including vote counts per option and who voted.',
    input_schema: {
      type: 'object',
      properties: {
        pollId: { type: 'string', description: 'Poll UUID' }
      },
      required: ['pollId']
    }
  },
  {
    name: 'describe_capabilities',
    description: 'Describe this agent\'s capabilities — returns a structured list of all available tools (with descriptions), all HTML templates (with descriptions and placeholders), and supported node types. Use this when the user asks "what can you do?", "what tools do you have?", "describe yourself", or "what are your capabilities?".',
    input_schema: {
      type: 'object',
      properties: {
        include_tools: {
          type: 'boolean',
          description: 'Include the full list of available tools (default true)',
          default: true
        },
        include_templates: {
          type: 'boolean',
          description: 'Include the list of HTML templates (default true)',
          default: true
        }
      },
      required: []
    }
  },
  {
    name: 'get_system_registry',
    description: 'Dynamically discover the full system at runtime. Queries all 13 service-bound workers for health/OpenAPI, introspects D1 database schemas (PRAGMA table_info), lists user-created agents, knowledge graph inventory, templates (graph/AI/tool/HTML), frontend apps, configured API keys, and storage stats. Returns live data. Use for "what can you do?", "what tables exist?", "how many graphs?", "what agents exist?", etc.',
    input_schema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          description: 'Return only one section. Pass "all" or omit for everything. Available filters are returned dynamically in the response under availableFilters.'
        },
        include_endpoints: {
          type: 'boolean',
          description: 'Include full endpoint lists from each worker OpenAPI spec. Default: true. Set false for a lighter summary.'
        }
      }
    }
  },
  {
    name: 'deploy_worker',
    description: 'Deploy or modify a Cloudflare Worker via the API. Can create new workers or update existing ones. The worker code (ES module JavaScript) is uploaded and deployed instantly — no wrangler or git needed. Use when the user asks to create a new worker, modify an existing endpoint, add functionality to a worker, or fix a bug in a deployed worker. Requires Superadmin role.',
    input_schema: {
      type: 'object',
      required: ['workerName', 'code'],
      properties: {
        workerName: {
          type: 'string',
          description: 'The worker script name (e.g., "my-new-worker"). Used in the URL: https://<name>.torarnehave.workers.dev'
        },
        code: {
          type: 'string',
          description: 'Full ES module JavaScript code for the worker. Must export default with a fetch handler.'
        },
        enableSubdomain: {
          type: 'boolean',
          description: 'Enable workers.dev subdomain route. Default: true'
        },
        compatibilityDate: {
          type: 'string',
          description: 'Cloudflare compatibility date. Default: 2024-11-01'
        },
        registerInGraph: {
          type: 'boolean',
          description: 'Register the worker as a system-worker node in graph_system_registry. Default: true'
        },
      }
    }
  },
  {
    name: 'read_worker',
    description: 'List all deployed Cloudflare Workers or get details about a specific worker. Use to inspect the current state before modifying.',
    input_schema: {
      type: 'object',
      properties: {
        workerName: {
          type: 'string',
          description: 'If provided, get details for this specific worker. If omitted, lists all workers.'
        },
      }
    }
  },
  {
    name: 'delete_worker',
    description: 'Delete a Cloudflare Worker. Requires Superadmin role. Use with caution — this removes the worker from Cloudflare entirely.',
    input_schema: {
      type: 'object',
      required: ['workerName'],
      properties: {
        workerName: {
          type: 'string',
          description: 'The worker script name to delete'
        },
        removeFromGraph: {
          type: 'boolean',
          description: 'Also remove the system-worker node from graph_system_registry. Default: true'
        },
      }
    }
  },
  {
    name: 'delegate_to_html_builder',
    description: 'Delegate an HTML building or editing task to the specialized HTML Builder subagent. Use this when the user asks to create, edit, debug, fix, or redesign an HTML app. The subagent has focused HTML expertise and tools for reading specific sections of large HTML files. Use this instead of calling edit_html_node directly.',
    input_schema: {
      type: 'object',
      properties: {
        graphId: {
          type: 'string',
          description: 'The graph containing the HTML node'
        },
        nodeId: {
          type: 'string',
          description: 'The html-node ID to work on. Omit for new HTML creation.'
        },
        task: {
          type: 'string',
          description: 'What to do: create, edit, fix errors, redesign, etc. Include all user requirements and any error messages from the console.'
        },
        consoleErrors: {
          type: 'array',
          items: { type: 'string' },
          description: 'Console error messages from the HTML preview, if any.'
        }
      },
      required: ['graphId', 'task']
    }
  },
  {
    name: 'delegate_to_kg',
    description: 'Delegate knowledge graph operations to the specialized KG subagent. Use this when the user asks to: create a graph, add/edit/remove nodes, manage edges, export data to a graph, search for graphs, organize content, or read/analyze graph content. The subagent knows all KG API conventions, node types, and formatting rules. Use this instead of calling graph/node tools directly.',
    input_schema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'What to do: create graph, add nodes, export data, read content, search, etc. Include all context the subagent needs.'
        },
        graphId: {
          type: 'string',
          description: 'The graph ID to work with. Omit for new graph creation or search tasks.'
        },
        nodeId: {
          type: 'string',
          description: 'A specific node ID to work with, if applicable.'
        }
      },
      required: ['task']
    }
  },
  {
    name: 'list_bots',
    description: 'List all active AI chatbots in the Hallo Vegvisr system. Returns bot names, usernames, models, graph IDs, and creation dates.',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'get_bot',
    description: 'Get detailed information about a specific AI chatbot, including its configuration and which groups it belongs to.',
    input_schema: {
      type: 'object',
      properties: {
        botId: { type: 'string', description: 'Bot UUID' }
      },
      required: ['botId']
    }
  },
  {
    name: 'update_chat_bot',
    description: 'Update an AI chatbot configuration. Can change name, system prompt, knowledge graph, avatar, model, temperature, tools, and active status. Superadmin only.',
    input_schema: {
      type: 'object',
      properties: {
        botId: { type: 'string', description: 'Bot UUID to update' },
        name: { type: 'string', description: 'New display name' },
        systemPrompt: { type: 'string', description: 'New system prompt' },
        graphId: { type: 'string', description: 'Knowledge graph ID for bot personality' },
        avatarUrl: { type: 'string', description: 'Avatar image URL' },
        model: { type: 'string', description: 'Claude model to use' },
        temperature: { type: 'number', description: 'Response temperature 0-1' },
        maxTurns: { type: 'number', description: 'Max tool-use turns per response' },
        tools: { type: 'array', items: { type: 'string' }, description: 'Bot tools: search_knowledge, read_node, web_search, translate' },
        isActive: { type: 'boolean', description: 'Set to false to deactivate' }
      },
      required: ['botId']
    }
  },
  {
    name: 'delegate_to_chat',
    description: 'Delegate chat group tasks to the Chat Groups subagent. Use this for: list/create/delete/update groups, list members, add/remove members, send messages, read messages, create/close/view polls, get group statistics. Do NOT use this for bot management — use delegate_to_bot instead.',
    input_schema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'What to do: create group, add members, create poll, get stats, etc. Include all context the subagent needs.'
        },
        groupId: {
          type: 'string',
          description: 'The chat group UUID to work with, if known.'
        },
        groupName: {
          type: 'string',
          description: 'The chat group name to work with. The subagent resolves it to a UUID.'
        }
      },
      required: ['task']
    }
  },
  {
    name: 'delegate_to_bot',
    description: 'Delegate ANY bot management task to the specialized Bot Management subagent. Use this for ALL questions about AI chatbots — including: list/create/update/delete bots, get bot details, add/remove bots from groups, trigger bot responses, change bot configuration (model, temperature, tools, personality graph). If the user asks anything about bots, bot creation, bot configuration, or triggering bot responses, ALWAYS delegate here.',
    input_schema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'What to do: list bots, create bot, update bot config, remove bot, trigger response, etc. Include all context the subagent needs.'
        },
        botId: {
          type: 'string',
          description: 'The bot UUID to work with, if known.'
        },
        groupId: {
          type: 'string',
          description: 'The chat group UUID, if relevant.'
        }
      },
      required: ['task']
    }
  },
  {
    name: 'list_agents',
    description: 'List all active AI agents configured in the Agent Builder. Returns agent names, descriptions, models, tools, and avatar URLs.',
    input_schema: {
      type: 'object',
      properties: {},
    }
  },
  {
    name: 'get_agent',
    description: 'Get detailed configuration for a specific agent by ID. Returns name, description, system prompt, model, temperature, tools, metadata (including chatBotId), and avatar URL.',
    input_schema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID (e.g. "agent_abc12345")'
        }
      },
      required: ['agentId']
    }
  },
  {
    name: 'create_agent',
    description: 'Create a new AI agent with a name and optional configuration. Returns the new agent ID.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Display name for the agent (required)' },
        description: { type: 'string', description: 'Short description of what the agent does' },
        systemPrompt: { type: 'string', description: 'System prompt that defines the agent behavior' },
        model: { type: 'string', description: 'LLM model ID. Options: claude-haiku-4-5-20251001, claude-sonnet-4-20250514, claude-opus-4-20250514' },
        temperature: { type: 'number', description: 'Temperature (0.0–1.0). Default 0.3' },
        maxTokens: { type: 'integer', description: 'Max response tokens. Default 4096' },
        tools: { type: 'array', items: { type: 'string' }, description: 'Array of tool names the agent can use' },
        avatarUrl: { type: 'string', description: 'URL to avatar image' },
      },
      required: ['name']
    }
  },
  {
    name: 'update_agent',
    description: 'Update an existing agent configuration. Only provided fields are changed.',
    input_schema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'The agent ID to update' },
        name: { type: 'string', description: 'New display name' },
        description: { type: 'string', description: 'New description' },
        systemPrompt: { type: 'string', description: 'New system prompt' },
        model: { type: 'string', description: 'New model ID' },
        temperature: { type: 'number', description: 'New temperature' },
        maxTokens: { type: 'integer', description: 'New max tokens' },
        tools: { type: 'array', items: { type: 'string' }, description: 'New tool list' },
        avatarUrl: { type: 'string', description: 'New avatar URL' },
        metadata: { type: 'object', description: 'New metadata object' },
      },
      required: ['agentId']
    }
  },
  {
    name: 'deactivate_agent',
    description: 'Soft-delete an agent by setting is_active = 0. The agent can be reactivated later.',
    input_schema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'The agent ID to deactivate' }
      },
      required: ['agentId']
    }
  },
  {
    name: 'upload_agent_avatar',
    description: 'Upload a base64-encoded image as an agent avatar. The image is stored in R2 via photos-worker and the URL is saved on the agent.',
    input_schema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'The agent ID to set the avatar for' },
        base64: { type: 'string', description: 'Base64-encoded image data (PNG, JPG, or WebP)' },
        mediaType: { type: 'string', description: 'MIME type (e.g. "image/png"). Default: image/png' },
        filename: { type: 'string', description: 'Optional filename for the image' },
      },
      required: ['agentId', 'base64']
    }
  },
  {
    name: 'delegate_to_agent_builder',
    description: 'Delegate agent management tasks to the Agent Builder subagent. Use this for ALL questions about AI agents — including: list/create/update/delete agents, get agent details, change agent configuration (model, temperature, tools, system prompt), upload agent avatars. If the user asks anything about agents, agent creation, agent configuration, how many agents they have, or agent avatars, ALWAYS delegate here. Do NOT use this for chatbot/bot management — use delegate_to_bot instead.',
    input_schema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'What to do: list agents, create agent, update config, upload avatar, etc. Include all context.'
        },
        agentId: {
          type: 'string',
          description: 'The agent ID to work with, if known.'
        }
      },
      required: ['task']
    }
  },
  // -------------------------------------------------------------------------
  // Contact Management
  // -------------------------------------------------------------------------
  {
    name: 'delegate_to_contact',
    description: 'Delegate contact management tasks to the Contact subagent. Use for: listing/searching contacts, viewing contact details, adding interaction logs (text or transcribed voice notes), creating or updating contacts. The subagent knows the exact table IDs and column names.',
    input_schema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'What to do: search contacts, get contact details, add a log entry, list recent interactions, create a contact, etc. Include all relevant details (contact name, note text, interaction type, etc.)'
        },
        contactId: {
          type: 'string',
          description: 'Optional: the _id of a specific contact to work with'
        },
        contactName: {
          type: 'string',
          description: 'Optional: name of the contact (used to look up the contactId if not known)'
        }
      },
      required: ['task']
    }
  },
  {
    name: 'list_contacts',
    description: 'List contacts from the contacts table. Supports filtering by label/tag and pagination.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results (default 50)' },
        offset: { type: 'number', description: 'Pagination offset' },
        label: { type: 'string', description: 'Filter by label/tag value' }
      },
      required: []
    }
  },
  {
    name: 'search_contacts',
    description: 'Search contacts by name, company, email, or phone. Returns matching contacts with their IDs.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search string to match against name, company, email, phone' },
        limit: { type: 'number', description: 'Max results (default 20)' }
      },
      required: ['query']
    }
  },
  {
    name: 'get_contact_logs',
    description: 'Get interaction log entries for a specific contact. Returns all logged interactions ordered by most recent first.',
    input_schema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'The _id of the contact' },
        limit: { type: 'number', description: 'Max log entries to return (default 20)' }
      },
      required: ['contactId']
    }
  },
  {
    name: 'add_contact_log',
    description: 'Add an interaction log entry for a contact. Use after a meeting, call, or any interaction. Can include voice transcription text.',
    input_schema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', description: 'The _id of the contact' },
        contactName: { type: 'string', description: 'Display name of the contact' },
        contact_type: {
          type: 'string',
          enum: ['Møte', 'Telefon', 'E-post', 'Melding', 'Annet'],
          description: 'Type of interaction'
        },
        notes: { type: 'string', description: 'Notes or transcribed voice content from the interaction' },
        logged_at: { type: 'string', description: 'ISO datetime of the interaction (defaults to now if omitted)' }
      },
      required: ['contactId', 'contactName', 'contact_type', 'notes']
    }
  },
  {
    name: 'create_contact',
    description: 'Create a new contact record.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Full name (required)' },
        email: { type: 'string', description: 'Email address' },
        phone: { type: 'string', description: 'Phone number' },
        company: { type: 'string', description: 'Company/organisation name' },
        job_title: { type: 'string', description: 'Job title / role' },
        tags: { type: 'string', description: 'Comma-separated tags' },
        labels: { type: 'string', description: 'Comma-separated labels (e.g. "Aktiv,Kunde")' },
        notes: { type: 'string', description: 'General notes about the contact' }
      },
      required: ['name']
    }
  },
  {
    name: 'delegate_to_video',
    description: 'Delegate video and streaming tasks to the Video & Streaming subagent. Use this when the user asks to: upload/list/delete videos, create/manage live streams, create cloudflare-video or cloudflare-live nodes, get video playback URLs, set up RTMP streaming, or add video nodes to a graph. The subagent talks to the Cloudflare Stream API via videostream-worker and can create proper video/live node types in knowledge graphs.',
    input_schema: {
      type: 'object',
      properties: {
        graphId: {
          type: 'string',
          description: 'The graph to add video nodes to. Omit if just managing videos/streams without a graph.'
        },
        nodeId: {
          type: 'string',
          description: 'An existing video node ID to update. Omit for new operations.'
        },
        task: {
          type: 'string',
          description: 'What to do: upload video, list videos, create live stream, add video to graph, etc. Include all user requirements.'
        }
      },
      required: ['task']
    }
  },
  {
    name: 'reorder_nodes',
    description: 'Reorder the nodes in a knowledge graph to a specific sequence. Fetches the full graph, reorders the nodes array to match the provided list of node IDs, and saves it back. Use this when the user asks to reorganise, reorder, or sort nodes. You MUST read_graph first to get the exact node IDs.',
    input_schema: {
      type: 'object',
      properties: {
        graphId: {
          type: 'string',
          description: 'The ID of the graph whose nodes you want to reorder'
        },
        nodeOrder: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ordered list of node IDs. Nodes will appear in this sequence. Any node IDs not listed will be appended at the end in their original order.'
        }
      },
      required: ['graphId', 'nodeOrder']
    }
  }
]

/**
 * Proff.no tools for Norwegian business/person lookups (Brønnøysundregistrene)
 */
const PROFF_TOOLS = [
  {
    name: 'proff_search_companies',
    description: 'Search for Norwegian companies in Brønnøysundregistrene. Returns company name, org number, address, and other basic info. Use this to find the org.nr (organisasjonsnummer) needed for other Proff tools.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Company name to search for (e.g., "Equinor", "Spotify Norway")'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'proff_get_financials',
    description: 'Get financial data for a Norwegian company: revenue (omsetning), profit (resultat), EBITDA, and other key metrics. Requires the org.nr from proff_search_companies.',
    input_schema: {
      type: 'object',
      properties: {
        orgNr: {
          type: 'string',
          description: 'Norwegian organization number (org.nr) from proff_search_companies, e.g., "910298372"'
        }
      },
      required: ['orgNr']
    }
  },
  {
    name: 'proff_get_company_details',
    description: 'Get detailed company info: board members, shareholders, company status, addresses. Requires the org.nr from proff_search_companies.',
    input_schema: {
      type: 'object',
      properties: {
        orgNr: {
          type: 'string',
          description: 'Norwegian organization number (org.nr) from proff_search_companies, e.g., "910298372"'
        }
      },
      required: ['orgNr']
    }
  },
  {
    name: 'proff_search_persons',
    description: 'Search for a person by name in the Norwegian business registry. Returns personId needed for other Proff person tools. Use this to find connections between people.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Person name to search for (e.g., "Maiken Sneeggen", "Tor Arne Håve")'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'proff_get_person_details',
    description: 'Get detailed person info: board positions, roles, connected companies, roles and titles. Requires the personId from proff_search_persons.',
    input_schema: {
      type: 'object',
      properties: {
        personId: {
          type: 'string',
          description: 'Proff personId from proff_search_persons'
        }
      },
      required: ['personId']
    }
  },
  {
    name: 'generate_image',
    description: 'Generate an image from a text prompt using Stable Diffusion XL Lightning (Workers AI). Returns an imgix URL. Use when the user asks to "generate", "create", "draw", or "make" an image. After generation, always display the image URL as a markdown image in your response: ![description](url)',
    input_schema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Detailed description of the image to generate'
        },
        negative_prompt: {
          type: 'string',
          description: 'Elements to avoid in the image (e.g., "blurry, low quality, text")'
        },
        width: {
          type: 'integer',
          description: 'Width in pixels (256–1024, default 1024)'
        },
        height: {
          type: 'integer',
          description: 'Height in pixels (256–1024, default 1024)'
        },
        seed: {
          type: 'integer',
          description: 'Random seed for reproducibility'
        }
      },
      required: ['prompt']
    }
  },
  {
    name: 'proff_find_business_network',
    description: 'Find the shortest path/connection between two people in the Norwegian business network. Shows how they are connected through companies and roles. Requires personIds from proff_search_persons.',
    input_schema: {
      type: 'object',
      properties: {
        fromPersonId: {
          type: 'string',
          description: 'Proff personId of the first person (from proff_search_persons)'
        },
        toPersonId: {
          type: 'string',
          description: 'Proff personId of the second person (from proff_search_persons)'
        }
      },
      required: ['fromPersonId', 'toPersonId']
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

export { TOOL_DEFINITIONS, WEB_SEARCH_TOOL, PROFF_TOOLS }
