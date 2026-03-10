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
          enum: ['fulltext', 'image', 'link', 'video', 'audio', 'css-node', 'html-node', 'mermaid-diagram', 'youtube-video', 'chart', 'linechart', 'bubblechart', 'notes', 'worknote', 'map', 'agent-contract', 'agent-config', 'agent-run', 'data-node'],
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
    description: 'Get data format reference for node types (mermaid-diagram, youtube-video, chart, linechart, bubblechart, notes, worknote, map). Call this when creating nodes other than fulltext, image, or link.',
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
        tableId: { type: 'string', description: 'Table UUID (returned by create_app_table)' },
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
        tableId: { type: 'string', description: 'Table UUID' },
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
    description: 'Get recent messages from a Hallo Vegvisr chat group. Returns message text, sender email, and timestamp. Use this to read, analyze, summarize, or do sentiment analysis on group conversations.',
    input_schema: {
      type: 'object',
      properties: {
        groupId: { type: 'string', description: 'Chat group UUID' },
        groupName: { type: 'string', description: 'Chat group name (resolves to groupId if groupId not provided)' },
        limit: { type: 'number', description: 'Number of messages to return (default 10, max 100)' }
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
    description: 'Register an AI chatbot in a chat group. The bot personality is defined by a knowledge graph (fulltext nodes become the system prompt). Use this to add a bot to a group.',
    input_schema: {
      type: 'object',
      properties: {
        graphId: { type: 'string', description: 'Knowledge graph ID containing bot personality and guidelines' },
        groupId: { type: 'string', description: 'Chat group UUID' },
        groupName: { type: 'string', description: 'Chat group name' },
        botName: { type: 'string', description: 'Display name for the bot (e.g. "SIMULA")' }
      },
      required: ['graphId', 'botName']
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
    description: 'Trigger a chatbot to respond to recent messages in its group. Loads bot personality from its knowledge graph, reads recent messages, generates a response via Claude, and posts it to the group.',
    input_schema: {
      type: 'object',
      properties: {
        groupId: { type: 'string', description: 'Chat group UUID' },
        groupName: { type: 'string', description: 'Chat group name' },
        botGraphId: { type: 'string', description: 'Specific bot graph ID (if group has multiple bots). If omitted, triggers all bots.' },
        messageCount: { type: 'number', description: 'Number of recent messages to include as context (default 10, max 50)' }
      },
      required: []
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
