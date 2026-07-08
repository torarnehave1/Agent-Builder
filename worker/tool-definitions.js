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
    description: 'Add any type of node to a knowledge graph. Use this for fulltext (markdown), markdown-image, link, video, audio, or css-node types. For html-node pages, use create_html_from_template instead. The graph must already exist (use create_graph first). For image nodes, use nodeType "markdown-image", put the alt text in content, and set path to the HTTPS image URL. Call get_node_types_reference first if creating non-fulltext node types.',
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
          enum: ['fulltext', 'markdown-image', 'image', 'link', 'video', 'audio', 'css-node', 'html-node', 'mermaid-diagram', 'youtube-video', 'cloudflare-video', 'cloudflare-live', 'chart', 'linechart', 'bubblechart', 'notes', 'worknote', 'map', 'agent-contract', 'agent-config', 'agent-run', 'data-node'],
          description: 'Node type. Prefer "markdown-image" for normal images. Call get_node_types_reference for data format details.'
        },
        content: {
          type: 'string',
          description: 'Node content (stored in info field). Format depends on nodeType. For markdown-image this is the alt text/description. For fulltext this is markdown.'
        },
        path: {
          type: 'string',
          description: 'File/media URL. Required for markdown-image, link, video, and audio node types. For markdown-image use a full HTTPS image URL.'
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
    description: 'Update specific fields on an existing node. Only the provided fields are changed; others are preserved. Use read_graph or read_node first to see current values. Use this to modify an existing fulltext node, including inserting inline Header, Leftside, or Rightside image markdown into the info field.',
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
    name: 'create_subdomain',
    description: "Create a new subdomain (CNAME + worker route -> brand-worker) so an html-node page can be published to it, e.g. fonemer.vegvisr.org. Wraps api-worker's /create-custom-domain. Zone is auto-resolved for norsegong.com, xyzvibe.com, vegvisr.org, slowyou.training, vegr.ai and alivenesslab.org — pass zone_id ONLY for a root domain outside that list (found in the Cloudflare dashboard, domain Overview). Protected subdomains (api, www, admin, knowledge, auth, brand, ...) are rejected by the endpoint. After creation, publish content with the viewer's Publish button on an html-node (or the publish flow) — the new host serves html:<hostname> from brand-worker's HTML_PAGES KV. Superadmin only. Code-hardcoded (not in registry).",
    input_schema: {
      type: 'object',
      properties: {
        subdomain: { type: 'string', description: "The subdomain label only, e.g. 'fonemer' for fonemer.vegvisr.org" },
        root_domain: { type: 'string', description: "The root domain, e.g. 'vegvisr.org'" },
        zone_id: { type: 'string', description: 'Cloudflare Zone ID — required only for root domains outside the built-in mapping (norsegong.com, xyzvibe.com, vegvisr.org, slowyou.training)' }
      },
      required: ['subdomain', 'root_domain']
    }
  },
  {
    name: 'publish_html_node',
    description: "Publish an html-node (or css-node) to a LIVE host so it actually serves on the web, e.g. fonemer.vegvisr.org. This is the step AFTER editing: editing changes the node in the graph; publishing pushes that HTML to the live site. Reads the node's current HTML, signs a host-scoped token with agent-worker's HTML_PUBLISH_SECRET, and POSTs to https://<host>/__html/publish — writing html:<host> into brand-worker's HTML_PAGES KV (the same key the viewer's Publish button writes). Use this whenever the user says 'publish', 'push it live', 'make it live', or 'update the live site' for a page whose html-node you edited. The host must already route to brand-worker — run create_subdomain first if it doesn't exist. To refresh a live page after edits, just call this again (overwrite defaults true). Superadmin only. Code-hardcoded (not in registry).",
    input_schema: {
      type: 'object',
      properties: {
        graphId: { type: 'string', description: 'The graph ID containing the html-node' },
        nodeId: { type: 'string', description: 'The html-node (or css-node) ID to publish' },
        host: { type: 'string', description: "The live target host, e.g. 'fonemer.vegvisr.org'. Do NOT invent or guess this — use the host the node is already associated with (from its references, or a host you created/published earlier in the conversation). If unsure, ask the user rather than typing a host. Must already route to brand-worker (create_subdomain first)." },
        overwrite: { type: 'boolean', description: 'Overwrite an existing published page at this host. Default true — republish in place after edits.' },
        force: { type: 'boolean', description: "Override the wrong-host guard. By default publishing is REJECTED if the host does not match the node's associated host(s) (its references) — this catches typos like 'ponemer' for 'fonemer'. Only set force:true when you deliberately intend a new/different host." },
        gate: { type: 'boolean', description: "Publish the page login-GATED: a full-screen <vegvisr-auth require-auth> login card blocks the whole page until the visitor signs in (magic-link), then reveals it. Injected into the SERVED copy only — the node's stored HTML stays clean, so republishing WITHOUT gate reverts it. Use when the user wants a members-only / private page. Default false (public)." },
        gateRole: { type: 'string', description: "With gate:true, restrict access to these roles (comma-separated, e.g. 'Admin,Superadmin'); signed-in users with another role see 'Ingen tilgang'. Omit to allow any signed-in user." },
        gateAppName: { type: 'string', description: "With gate:true, the title shown on the login card (e.g. the app/world name)." },
        gateLogo: { type: 'string', description: "With gate:true, an optional logo image URL for the login card." },
        gateRegisterMode: { type: 'string', enum: ['invite', 'open'], description: "With gate:true, 'open' shows a Register button on the login card (email → creates a ViewOnly account → magic link) for self-signup; 'invite' (default) is login-only (new accounts provisioned elsewhere)." }
      },
      required: ['graphId', 'nodeId', 'host']
    }
  },
  {
    name: 'replace_html_section',
    description: "OVERWRITES a whole anchored section of an html-node — the tool deletes EVERYTHING between <!-- edit:<anchorId>:start --> and <!-- edit:<anchorId>:end --> and puts your `html` there instead. Anything you do not retype is GONE (this is how a theme-toggle script+style once got silently deleted while 'adding a card'). THEREFORE: to ADD to a section, do NOT use this — use insert_html_at (additive). To CHANGE a section, FIRST call read_html_section(anchorId) to get the exact current bytes, keep everything you want to preserve, then send the full new region. The tool matches on the named marker so it cannot miss the target. It REFUSES the write if your new content drops a <script>/<style>/<video>/<iframe> block or shrinks the section hard — read the section and include what you dropped, or pass force:true to confirm an intentional removal. Run list_html_anchors first. Returns changed + charDelta (verified). Superadmin only. Code-hardcoded (not in registry).",
    input_schema: {
      type: 'object',
      properties: {
        graphId: { type: 'string', description: 'The graph ID' },
        nodeId: { type: 'string', description: 'The html-node ID' },
        anchorId: { type: 'string', description: "The anchor slug between the markers, e.g. 'om-prosjektet' for <!-- edit:om-prosjektet:start -->" },
        html: { type: 'string', description: 'The FULL new inner HTML for the whole region between the markers (it replaces everything currently there — include content you want to keep). Read it first with read_html_section.' },
        force: { type: 'boolean', description: 'Set true ONLY to confirm a deliberate removal — bypasses the content-loss guard that blocks dropping a script/style/video/iframe block or a hard shrink. Default false.' }
      },
      required: ['graphId', 'nodeId', 'anchorId', 'html']
    }
  },
  {
    name: 'append_to_section',
    description: "ADD content INSIDE an edit-anchored section WITHOUT rewriting it — the loss-proof way to 'add a card / row / list item / episode to this section'. It splices your `html` in just before the anchor's :end marker (position:'end', default) or right after :start (position:'start'), so EVERYTHING already in the section — sibling cards, <style>, <script> — is preserved by construction. PREFER THIS over replace_html_section whenever you are ADDING to a section rather than rewriting it: no need to read or retype the existing content, so nothing can be dropped. Run list_html_anchors to find the anchorId. Returns version + charDelta + blocksPreserved (verified). Superadmin only. Code-hardcoded (not in registry).",
    input_schema: {
      type: 'object',
      properties: {
        graphId: { type: 'string', description: 'The graph ID' },
        nodeId: { type: 'string', description: 'The html-node ID' },
        anchorId: { type: 'string', description: "The anchor slug to add into, e.g. 'video-section' (run list_html_anchors to see anchors)." },
        html: { type: 'string', description: 'The new HTML to add inside the section (e.g. one more card). It is inserted without removing anything already there.' },
        position: { type: 'string', enum: ['end', 'start'], description: "'end' (default) appends after the last existing item; 'start' prepends before the first." }
      },
      required: ['graphId', 'nodeId', 'anchorId', 'html']
    }
  },
  {
    name: 'insert_in_element',
    description: "ADD content INSIDE a specific element chosen by tag or id — the placement-aware, loss-proof way to put a button in the <nav>, an item in a <ul>, a widget in '#header', etc. `target` is a bare tag name ('nav','header','footer','main') for the FIRST such element, or '#id' for the element with that id. position 'end' (default) splices just before the element's closing tag; 'start' just after its open tag. Nesting-aware (finds the MATCHING close), purely additive — nothing existing is removed, so no read is needed first. Use this together with read_html_head + insert_html_at to add a theme toggle with NO read_node: read_html_head for the CSS vars, insert_in_element('nav', button) for placement, insert_html_at('append_to_style', css) and ('before_body_end', script). Superadmin only. Code-hardcoded (not in registry).",
    input_schema: {
      type: 'object',
      properties: {
        graphId: { type: 'string', description: 'The graph ID' },
        nodeId: { type: 'string', description: 'The html-node ID' },
        target: { type: 'string', description: "The element to insert into: a bare tag name like 'nav'/'header'/'footer'/'main' (first match), or '#id' for a specific element." },
        html: { type: 'string', description: 'The HTML to insert inside that element (e.g. a <button>).' },
        position: { type: 'string', enum: ['end', 'start'], description: "'end' (default) inserts before the element's closing tag; 'start' just after its opening tag." }
      },
      required: ['graphId', 'nodeId', 'target', 'html']
    }
  },
  {
    name: 'insert_html_at',
    description: "RELIABLE way to ADD new HTML/CSS/JS to an existing page — use this instead of edit_html_node whenever you are INSERTING (not replacing) something: a new button, a <script>, extra CSS, a nav bar, a widget. It inserts at a named structural position keyed to the page's own <head>/<body>/<style> tags, so it CANNOT mismatch the way edit_html_node does on large pages. No anchor comments needed and it works on any existing page. Positions: 'before_body_end' (just before </body> — for scripts and body-level widgets/buttons), 'after_body_start' (right after <body> — for top-of-page bars), 'before_head_end' (just before </head> — for <link>/<meta>/<style> blocks), 'append_to_style' (just before the last </style> — to add CSS rules/variables to the existing stylesheet), 'after_head_start' (right after <head>). A multi-region change like a theme toggle is three calls: append_to_style for the CSS, before_body_end for the button, before_body_end for the script — no exact-string matching, no thrash. Returns version + charDelta (verified). Superadmin only. Code-hardcoded (not in registry).",
    input_schema: {
      type: 'object',
      properties: {
        graphId: { type: 'string', description: 'The graph ID' },
        nodeId: { type: 'string', description: 'The html-node ID' },
        position: {
          type: 'string',
          enum: ['before_body_end', 'after_body_start', 'before_head_end', 'append_to_style', 'after_head_start'],
          description: "Where to insert. 'before_body_end' for scripts & body widgets; 'append_to_style' to add CSS to the existing <style>; 'before_head_end' for <link>/<meta>/<style>."
        },
        html: { type: 'string', description: 'The HTML/CSS/JS to insert at that position (for append_to_style, give raw CSS rules — no <style> wrapper).' }
      },
      required: ['graphId', 'nodeId', 'position', 'html']
    }
  },
  {
    name: 'read_html_section',
    description: "Return the EXACT current inner HTML (verbatim bytes) between an anchor's <!-- edit:<id>:start --> / :end markers, plus a count of the script/style/video/iframe blocks it contains. ALWAYS call this before replace_html_section on a section you did not just write — replace_html_section overwrites the whole region, so you must see what is there to avoid deleting it. Read-only. Superadmin not required. Code-hardcoded (not in registry).",
    input_schema: {
      type: 'object',
      properties: {
        graphId: { type: 'string', description: 'The graph ID' },
        nodeId: { type: 'string', description: 'The html-node ID' },
        anchorId: { type: 'string', description: "The anchor slug to read, e.g. 'video-section' (run list_html_anchors to see available anchors)." }
      },
      required: ['graphId', 'nodeId', 'anchorId']
    }
  },
  {
    name: 'read_html_head',
    description: "Return ONLY an html-node's styling context — the <head> markup, every <style> block, the declared CSS custom properties (as a {name:value} map), and the existing <link> tags — WITHOUT the whole node. Call this (NOT read_node) before a theme-toggle / Google-font / icon / CSS edit: it gives you the existing variables, font-family, selectors and links you need to write MATCHING styles, in a few hundred bytes instead of dumping the entire page (cheap on large nodes). After it, insert_html_at your CSS/links/scripts. Read-only. Code-hardcoded (not in registry).",
    input_schema: {
      type: 'object',
      properties: {
        graphId: { type: 'string', description: 'The graph ID' },
        nodeId: { type: 'string', description: 'The html-node ID' }
      },
      required: ['graphId', 'nodeId']
    }
  },
  {
    name: 'list_html_anchors',
    description: "List the edit-anchor ids present in an html-node (the <!-- edit:<id>:start --> markers). Use this BEFORE replace_html_section to see which sections are anchor-editable, then read_html_section to see a section's content. Read-only. Code-hardcoded (not in registry).",
    input_schema: {
      type: 'object',
      properties: {
        graphId: { type: 'string', description: 'The graph ID' },
        nodeId: { type: 'string', description: 'The html-node ID' }
      },
      required: ['graphId', 'nodeId']
    }
  },
  {
    name: 'list_graph_versions',
    description: 'List the saved version history of a knowledge graph (up to the 20 most recent versions, newest first). Each entry has version and timestamp. Use this before get_graph_version / restore_graph_version / restore_html_node_version to pick a version. Code-hardcoded (not in registry).',
    input_schema: {
      type: 'object',
      properties: {
        graphId: { type: 'string', description: 'The graph ID to list versions for' }
      },
      required: ['graphId']
    }
  },
  {
    name: 'get_graph_version',
    description: 'Fetch a SPECIFIC historical version of a knowledge graph (full graphData: metadata, nodes, edges as they were at that version). Use list_graph_versions first to see which versions exist. Read-only — does not change anything. Code-hardcoded (not in registry).',
    input_schema: {
      type: 'object',
      properties: {
        graphId: { type: 'string', description: 'The graph ID' },
        version: { type: 'number', description: 'The version number to fetch (from list_graph_versions)' }
      },
      required: ['graphId', 'version']
    }
  },
  {
    name: 'restore_graph_version',
    description: 'Restore an ENTIRE knowledge graph to a prior version. Fetches the historical version and saves it back via saveGraphWithHistory, so the restore itself becomes a NEW version (no history is destroyed — you can restore forward again). metadata.restoredFrom records the source version. Superadmin only. For rolling back a single html-node without touching the rest of the graph, use restore_html_node_version instead. Code-hardcoded (not in registry).',
    input_schema: {
      type: 'object',
      properties: {
        graphId: { type: 'string', description: 'The graph ID to restore' },
        version: { type: 'number', description: 'The version number to restore the graph to' }
      },
      required: ['graphId', 'version']
    }
  },
  {
    name: 'restore_html_node_version',
    description: "Roll back a SINGLE html-node (or css-node) to its content from a prior graph version, without touching any other node. Fetches the historical version, extracts the node's info, and patches it into the current graph (becomes a new version; nothing destroyed). Records restoredFromVersion + updatedBy on the node. Superadmin only. To make a LIVE published page show the restored content, publish the node afterwards (viewer Publish button or the publish flow). Code-hardcoded (not in registry).",
    input_schema: {
      type: 'object',
      properties: {
        graphId: { type: 'string', description: 'The graph ID containing the node' },
        nodeId: { type: 'string', description: 'The html-node (or css-node) ID to roll back' },
        version: { type: 'number', description: 'The graph version to take the node content FROM' }
      },
      required: ['graphId', 'nodeId', 'version']
    }
  },
  {
    name: 'patch_node_metadata',
    description: "Set or update specific keys in a node's metadata WITHOUT clobbering the rest (merge-safe). Use this instead of patch_node when changing metadata: patch_node replaces the whole metadata object, this merges. Provide only the keys to change, e.g. metadata: { capabilities_summary: '...', highlights: ['...'] }. Reads current metadata, shallow-merges your keys, writes back.",
    input_schema: {
      type: 'object',
      properties: {
        graphId: { type: 'string', description: 'The graph ID containing the node' },
        nodeId: { type: 'string', description: 'The node ID to update' },
        metadata: { type: 'object', description: 'Metadata keys to merge into the node (only the keys you want to change).' },
      },
      required: ['graphId', 'nodeId', 'metadata'],
    },
  },
  {
    name: 'edit_html_node',
    description: 'Surgically edit an html-node by finding and replacing an exact string in its HTML content. Unlike patch_node (which replaces the entire info field), this tool only changes the specific part you target — all other code stays untouched. Use this instead of patch_node when modifying existing HTML apps to avoid accidentally breaking working code. You can make multiple edits by calling this tool multiple times. GUARDED: a content-loss check REJECTS an edit whose new_string drops a <script>/<style>/<video>/<iframe>, drops an HTML element (a card/div/section/list item), or hard-shrinks the node — i.e. when new_string deletes content that was inside old_string. A normal in-place text change keeps all blocks and elements and is never blocked. If the deletion is intentional (you really mean to remove that element), pass force:true. To ADD content, prefer append_to_section/insert_html_at over a big edit.',
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
        },
        force: {
          type: 'boolean',
          description: 'Set true ONLY to confirm a deliberate removal — bypasses the content-loss guard that blocks dropping a script/style/video/iframe, an HTML element, or a hard shrink. Default false.'
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
    description: 'Search the web using Perplexity AI sonar-pro with real-time results and citations. Returns detailed answers WITH source URLs and titles. Use this for in-depth research, recent news, or when you need cited sources. The tier is fixed to sonar-pro (deep search with citations) — you cannot downgrade it.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query'
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
  // -------------------------------------------------------------------------
  // Album & Photo subagent tools (delegate_to_albums calls these via the
  // album-subagent). Each wraps an endpoint on albums-worker (albums.vegvisr.org)
  // or photos-worker (photos-api.vegvisr.org). Auth: X-API-Token = the user's
  // emailVerificationToken, plumbed via authContext.authToken.
  // -------------------------------------------------------------------------
  {
    name: 'album_list',
    description: 'List all photo albums. Returns just names by default; pass includeMeta:true to get an array of {name, createdBy, createdAt, updatedAt}. NOT owner-filtered server-side — every authenticated user sees every album. Filter client-side by createdBy if you only want the current user\'s albums.',
    input_schema: {
      type: 'object',
      properties: {
        includeMeta: { type: 'boolean', description: 'If true, return metadata per album instead of just names.' },
        authToken: { type: 'string', description: 'User emailVerificationToken. Auto-forwarded by the chat client.' }
      }
    }
  },
  {
    name: 'album_get',
    description: 'Get one photo album by name. Returns the full album record: images (R2 keys), createdBy, createdAt, updatedAt, isShared, shareId, seoTitle, seoDescription, seoImageKey, auditLog.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Album name.' },
        authToken: { type: 'string', description: 'User emailVerificationToken. Auto-forwarded by the chat client.' }
      },
      required: ['name']
    }
  },
  {
    name: 'album_create_or_update',
    description: 'Create a new photo album or fully upsert an existing one. The images array, if provided, REPLACES the existing list — use album_add_images for incremental adds. Setting isShared:true mints a shareId UUID if none exists.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Album name (required).' },
        images: { type: 'array', items: { type: 'string' }, description: 'R2 image keys to set as the album\'s image list. REPLACES existing array if provided.' },
        seoTitle: { type: 'string', description: 'Optional SEO title (nullable).' },
        seoDescription: { type: 'string', description: 'Optional SEO description (nullable).' },
        seoImageKey: { type: 'string', description: 'Optional R2 key of the cover image (nullable).' },
        isShared: { type: 'boolean', description: 'If true, publishes the album and mints a shareId UUID if none exists.' },
        regenerateShareId: { type: 'boolean', description: 'If true, rotates the shareId to a new UUID (invalidates old share URLs).' },
        authToken: { type: 'string', description: 'User emailVerificationToken. Auto-forwarded by the chat client.' }
      },
      required: ['name']
    }
  },
  {
    name: 'album_delete',
    description: 'Delete a photo album entirely. Writes one final audit entry before removal. Does NOT delete the underlying R2 images — those remain in the bucket and may be referenced by other albums.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Album name to delete.' },
        authToken: { type: 'string', description: 'User emailVerificationToken. Auto-forwarded by the chat client.' }
      },
      required: ['name']
    }
  },
  {
    name: 'album_add_images',
    description: 'Add one or more R2 image keys to an existing album. Deduped (re-adding the same key is a no-op, not an error).',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Album name.' },
        images: { type: 'array', items: { type: 'string' }, description: 'R2 image keys to add. Use this for multiple.' },
        image: { type: 'string', description: 'Single R2 image key to add. Use this for a single image instead of the images array.' },
        authToken: { type: 'string', description: 'User emailVerificationToken. Auto-forwarded by the chat client.' }
      },
      required: ['name']
    }
  },
  {
    name: 'album_remove_images',
    description: 'Remove one or more R2 image keys from an album. If a removed image was the seoImageKey (cover), the worker auto-rewrites seoImageKey to the first remaining image (or null if none).',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Album name.' },
        images: { type: 'array', items: { type: 'string' }, description: 'R2 image keys to remove. Use this for multiple.' },
        image: { type: 'string', description: 'Single R2 image key to remove. Use this for a single image.' },
        authToken: { type: 'string', description: 'User emailVerificationToken. Auto-forwarded by the chat client.' }
      },
      required: ['name']
    }
  },
  {
    name: 'album_publish',
    description: 'Publish an album for public sharing. Sets isShared:true and mints a shareId UUID if none exists. The shared album is then readable without auth via photos_list with the shareId, or in a browser at https://seo.vegvisr.org/album/{shareId}.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Album name to publish.' },
        authToken: { type: 'string', description: 'User emailVerificationToken. Auto-forwarded by the chat client.' }
      },
      required: ['name']
    }
  },
  {
    name: 'album_rotate_share',
    description: 'Rotate the shareId of a shared album to a fresh UUID. Invalidates any previously-distributed share URL. Use when a share link needs to be revoked.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Album name whose shareId should be rotated.' },
        authToken: { type: 'string', description: 'User emailVerificationToken. Auto-forwarded by the chat client.' }
      },
      required: ['name']
    }
  },
  {
    name: 'photos_list',
    description: 'List images from the photos R2 bucket. No params → all images in the bucket (auth not required for that mode). With ?album=<name> → images in that album (auth required unless album.isShared). With ?share=<shareId> → public read of a shared album (no auth). Returns image keys + imgix CDN URLs + optional metadata.',
    input_schema: {
      type: 'object',
      properties: {
        album: { type: 'string', description: 'Optional: list only images in this album.' },
        share: { type: 'string', description: 'Optional: public read of a shared album by shareId (no auth needed).' },
        authToken: { type: 'string', description: 'User emailVerificationToken. Auto-forwarded by the chat client.' }
      }
    }
  },
  {
    name: 'photos_upload_from_url',
    description: 'Upload an image to the photos R2 bucket by fetching it from a public URL. Optionally attaches it to an album in the same call. Returns the new R2 image key (and the album name if any). Useful for "save this URL into my album" flows.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Publicly fetchable URL of the image to upload.' },
        album: { type: 'string', description: 'Optional: album name to attach the resulting key to (deduped).' },
        filename: { type: 'string', description: 'Optional base filename. If omitted, a timestamp-based key is generated.' },
        displayName: { type: 'string', description: 'Optional human-friendly name stored under image-meta.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags stored under image-meta.' }
      },
      required: ['url']
    }
  },
  {
    name: 'photos_delete',
    description: 'Soft-delete an image. Moves the object to trash/{timestamp}-{key} (recoverable) AND CASCADES: walks every album in KV and removes this key from each album.images array. Returns counts so you can confirm the cascade. Use carefully — confirm with the user before calling on a key referenced by multiple albums.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'R2 image key to soft-delete.' }
      },
      required: ['key']
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
    name: 'get_vemotion_reference',
    description: 'Get the full Vemotion composition cookbook — every layer type (text/shape/math-shape/image/kg-shape/card) with properties, **the shape-vs-math-shape decision rule (filled disc vs stroked outline — math-shape is the right primitive for mandalas, rosettes, stars, scalloped borders, any traceable line art)**, the animation discriminated union (kind: layer / char-stagger / mask-wipe) with worked examples, text image-fill modes (letters as a window onto an image), the math-shape x0/y0 footgun rule with context-variable table, **position semantics (position = bounding-box top-left, NOT circle centre)**, **radial-layout worked examples for mandalas / rings / orbits including Venn-style overlap formulas**, **a parametric curve library organised by EIGHT META-PATTERNS (parametric circle / polar / Fourier sum / Fourier product / rolling-circle / exponential / rational / implicit algebraic) with 25+ named curves you reach for BY NAME instead of inventing — roses, hypocycloid, epicycloid, astroid, deltoid, nephroid, cardioid, limacon, lemniscate, heart, egg, Witch of Agnesi, Cassini oval, scalloped rings, Lissajous, spirals**, **the FORMULA EVALUATOR VOCABULARY (only sin/cos/tan/abs/min/max/pow/sqrt/pi — NO exp/log/cosh/atan2, with identity workarounds for hyperbolic functions)**, **when-to-leave-math-shape boundary (switch to type:path for explicit anchors / corners, type:image for non-mathematical outlines)**, and common compositions (title-card-with-photo, type-on title, iris reveal). Call this BEFORE composing a custom Vemotion composition (i.e. before passing `composition` to vemotion_save_composition) — especially for any decorative / symmetric / pattern-based layout where you might be tempted to hand-pick coordinates or guess at formulas. Not needed for the album-slideshow shortcut (passing `albumName` to vemotion_save_composition).',
    input_schema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'list_recordings',
    description: 'List audio recordings from the current user\'s audio portfolio AND their Contact-app recordings. Automatically uses the logged-in user\'s email. Returns recording metadata including titles, durations, tags, transcription status, `recordingId`, and `audioUrl`. Use this to find recordings before transcribing them. IMPORTANT: to transcribe or otherwise act on a recording returned here, pass its `audioUrl` field to transcribe_audio EXACTLY as returned — this always works. Use the returned `recordingId` verbatim if you use it at all; NEVER construct, guess, or derive a recordingId from a filename or timestamp.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max recordings to return (default 20)' },
        query: { type: 'string', description: 'Optional search query to filter recordings by name, tags, or transcription text' }
      }
    }
  },
  {
    name: 'list_realtime_videos',
    description: 'List the current user\'s video recordings from their R2 bucket. Returns TWO kinds, distinguished by the `type` field on each result: (1) `type:"realtime"` — MP4s from RealtimeKit video/meeting sessions (stored under recordings/); (2) `type:"stream"` — Cloudflare Stream LIVE BROADCAST recordings synced into the SAME bucket under stream-recordings/, each carrying `title` (the meeting title), `duration` (seconds), `streamVideoId`, and `liveInputId`. Use this tool when the user asks about their "realtime recording", "realtime video", "video recording", "stream recording", "live stream recording", or "broadcast recording" — it covers all of them. DIFFERENT from list_recordings (which is for audio voice memos). Each user\'s videos live in their own R2 bucket; this tool automatically resolves the correct bucket/path from the logged-in user\'s config row — do not ask the user for a path. Each returned video has a permanent public `playUrl` — use it EXACTLY as returned; never construct, guess, or modify a recording URL/key, and never combine a session id with a timestamp from another entry. To embed a recording in a graph, create a `video` node with `path` = that exact `playUrl`. Do NOT route these recordings to delegate_to_video / Cloudflare Stream (they already have a permanent URL), and never hand the user terminal/wrangler/curl commands.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max videos to return (default 20, sorted newest first)' }
      }
    }
  },
  {
    name: 'vemotion_save_composition',
    description: 'Save a Vemotion video composition to the user\'s cloud library. Vemotion is the layer-based video composer at vemotion.vegvisr.org. TWO USAGE MODES: (1) Pass `composition` — the full CompositionData object you assembled yourself (text / shape / math-shape / image / kg-shape / card layers with animations). Use this when you need custom styling. (2) Pass `albumName` — server-side shortcut that resolves the album to its real image keys and builds a default cross-fade slideshow (one image per slide). Use this when the user just wants a simple slideshow of an existing album. CREATE vs UPDATE: omit `compositionId` to create a NEW composition; pass `compositionId` to UPDATE that existing composition in place (versioned, keeps the same id). **To edit a composition the user already has, you MUST first call `vemotion_get_composition` to load its current layers, modify them in-context, then save back with the same `compositionId`.** Never rebuild a composition from memory and save without an id — that forks a new composition and silently drops the layers you forgot. Returns the compositionId and a URL to open/edit in the Vemotion app. Does NOT render to MP4 — the user renders from the editor.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short title shown in the user\'s Vemotion composition list (e.g. "Hello World intro", "Summer 2026 slideshow").' },
        compositionId: { type: 'string', description: 'UPDATE mode: id of an existing composition to overwrite in place (e.g. "comp_abc123"). Omit to create a new composition. Always pass this when editing a composition the user already has — load it first with vemotion_get_composition, then save back with this same id.' },
        composition: {
          type: 'object',
          description: 'Full Vemotion CompositionData. Required if albumName is NOT provided. Must include a non-empty layers array. duration / fps / width / height fall back to 5s / 30fps / 1280x720 if omitted.',
          properties: {
            duration: { type: 'number', description: 'Total duration in seconds. If omitted, derived from the maximum layer.startTime + layer.layerDuration, or 5.' },
            fps: { type: 'number', description: 'Frames per second. Default 30.' },
            width: { type: 'number', description: 'Canvas width in pixels. Default 1280.' },
            height: { type: 'number', description: 'Canvas height in pixels. Default 720.' },
            fontFamily: { type: 'string', description: 'Composition-level default font (e.g. "Inter", "Poppins", "Caveat"). Optional.' },
            layers: {
              type: 'array',
              description: 'Ordered list of layers, back-to-front. Each layer needs id (string), type ("text"|"shape"|"math-shape"|"image"|"kg-shape"|"card"), position {x, y}, size {width, height}, properties (type-specific). Optional: startTime (s), layerDuration (s), animation { property: "opacity"|"offsetX"|"offsetY"|"drawProgress", keyframes: [{time, value}] }.',
              items: { type: 'object' }
            }
          },
          required: ['layers']
        },
        albumName: { type: 'string', description: 'SHORTCUT mode: name of an existing Vemotion album. When set (and `composition` is omitted), the executor fetches the real image keys from the album server-side and builds a default 1280x720 cross-fade slideshow — one image per slide. No LLM is involved in the fetch. Use for simple "slideshow of my X album" requests. Skip this and use `composition` for custom styling.' },
        secondsPerImage: { type: 'number', description: 'Seconds each image is fully visible in albumName-shortcut mode (default 3). Ignored when `composition` is provided.' },
        transitionSeconds: { type: 'number', description: 'Cross-fade duration in albumName-shortcut mode (default 0.5). Ignored when `composition` is provided.' },
        authToken: { type: 'string', description: 'User emailVerificationToken. Usually auto-forwarded by the chat client; omit unless calling manually.' }
      },
      required: ['name']
    }
  },
  {
    name: 'vemotion_get_composition',
    description: 'Load a saved Vemotion composition by id and return its FULL current CompositionData (all layers, exactly as stored). This is the read half of non-destructive editing. ALWAYS call this before editing a composition the user already has ("add an animation to that video", "make the slides longer", "remove the text", "tweak the composition you just made"). Workflow: vemotion_get_composition(compositionId) → modify the returned layers in-context → vemotion_save_composition with the SAME compositionId to update in place. Do NOT reconstruct a composition from memory — read it first so no layers are lost.',
    input_schema: {
      type: 'object',
      properties: {
        compositionId: { type: 'string', description: 'Id of the composition to load (e.g. "comp_abc123"). This is the id returned by a prior vemotion_save_composition or shown in the editor URL.' },
        authToken: { type: 'string', description: 'User emailVerificationToken. Auto-forwarded by the chat client; omit unless calling manually.' }
      },
      required: ['compositionId']
    }
  },
  {
    name: 'vemotion_refit_composition',
    description: 'Reformat a Vemotion composition for a new canvas aspect ratio (e.g. 1280x720 landscape → 1080x1080 Instagram Square → 1080x1920 Reels). Server-side transformation — the Vemotion worker runs the canonical refit algorithm (src/lib/refit.ts); zero LLM in the math. Use whenever the user asks to "make this for Instagram", "version this for Reels", "square version", "vertical version", etc. Provide EXACTLY ONE of `compositionId` (refit a saved composition; owner check applies) or `composition` (refit an inline body). Mode `fill` is the default for most reformats. If `name` is provided, the result is saved as a NEW composition and `compositionId` is returned; if `name` is omitted, the refit composition body is returned inline (use for chaining downstream without persisting).',
    input_schema: {
      type: 'object',
      properties: {
        compositionId: { type: 'string', description: 'Refit a saved composition by id. Provide this OR composition, not both.' },
        composition: { type: 'object', description: 'Refit an inline CompositionData body. Provide this OR compositionId, not both. Must include width, height, layers[].' },
        targetWidth: { type: 'number', description: 'New canvas width in pixels (e.g. 1080 for Square/Reels, 1920 for FHD landscape).' },
        targetHeight: { type: 'number', description: 'New canvas height in pixels (e.g. 1080 for Square, 1920 for Reels, 1080 for FHD landscape).' },
        mode: { type: 'string', enum: ['fit', 'fill', 'stretch'], description: 'fit = uniform scale + letterbox bars (nothing clipped). fill = uniform scale + centred offset, edges may clip (DEFAULT for most reformats). stretch = non-uniform scale, no clip but distorts circles/text.' },
        name: { type: 'string', description: 'Optional. If provided, saves the refit result as a new composition under this name and returns its id. If omitted, returns the refit composition body inline without saving (useful when chaining).' },
        authToken: { type: 'string', description: 'User emailVerificationToken. Auto-forwarded by the chat client.' }
      },
      required: ['targetWidth', 'targetHeight', 'mode']
    }
  },
  {
    name: 'vemotion_list_compositions',
    description: 'List the logged-in user\'s saved Vemotion compositions (their personal cloud library — NOT a knowledge graph). Use this whenever the user wants to FIND, search, browse, or pick one of their existing compositions ("find a composition about X", "what compositions do I have", "open my vegvisr video", "list my videos"). Vemotion compositions are NOT stored in knowledge graphs — do NOT use search_graphs/read_graph for them; this is the correct tool. Each item returns compositionId, name, updatedAt, duration, dimensions, layerCount and an editorUrl. Optionally pass `query` to filter by name (case-insensitive substring) when the user is looking for a specific topic. After finding the one they mean, load its full content with vemotion_get_composition.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional case-insensitive substring to filter compositions by name (e.g. "vegvisr"). Omit to list all.' },
        limit: { type: 'number', description: 'Max compositions to return (1-200). Default 50.' },
        authToken: { type: 'string', description: 'User emailVerificationToken. Auto-forwarded by the chat client.' }
      }
    }
  },
  {
    name: 'vemotion_generate_structure',
    description: 'Generate a Vemotion composition from REAL, computed geometry — for parametric technical structures that a language model cannot draw accurately by hand. The Vemotion worker runs the deterministic math server-side and returns a fully rendered composition. Use this INSTEAD of assembling math-shape formulas yourself whenever the user asks for one of the supported structures — hand-written parametric formulas produce noise, not real geometry. Supported structureType: "geodesic-dome" (animated icosahedron wireframe dome that builds triangle-by-triangle, split-view strut-dimensions panel, true mm lengths) and "vastu-mandala" (Hindu-temple Vastu Purusha Mandala floor plan — the N×N pada grid with the central Brahmasthana/Garbhagriha, concentric zones, diagonals, cardinal directions, and a pada-dimensions panel in mm). The result is saved to the user\'s cloud library; returns the compositionId, an editorUrl to open it, and a summary. Pass `compositionId` to overwrite an existing composition in place. Does NOT render to MP4 — the user renders from the editor.',
    input_schema: {
      type: 'object',
      properties: {
        structureType: { type: 'string', enum: ['geodesic-dome', 'vastu-mandala'], description: 'Which parametric structure to generate. "geodesic-dome" = geodesic dome wireframe; "vastu-mandala" = Hindu temple Vastu Purusha Mandala floor plan. Default "geodesic-dome".' },
        name: { type: 'string', description: 'Title shown in the user\'s Vemotion list. If omitted, a default name is generated from the parameters.' },
        compositionId: { type: 'string', description: 'UPDATE mode: id of an existing composition to overwrite in place (e.g. "comp_abc123"). Omit to create a new one.' },
        params: {
          type: 'object',
          description: 'Structure parameters. Only the params for the chosen structureType are used; the rest are ignored.',
          properties: {
            frequency: { type: 'number', description: '[geodesic-dome] Geodesic frequency (icosahedron subdivision, 1-8). Higher = more triangles / smoother. Default 4. A request for a very high frequency like "24V" should still use 4-6 here — the geometry stays visually equivalent at screen scale while remaining legible.' },
            diameterMeters: { type: 'number', description: '[geodesic-dome] Dome diameter in metres (default 8, i.e. ~50 m² footprint).' },
            animationStyle: { type: 'string', enum: ['triangle-by-triangle', 'band', 'all-at-once'], description: '[geodesic-dome] How the dome builds on screen. "triangle-by-triangle" (default) reveals one triangle at a time; "band" reveals a whole latitude ring at once; "all-at-once" fades the full mesh in. Ignored when spin is true.' },
            spin: { type: 'boolean', description: '[geodesic-dome] When true, renders a rotating 3D wireframe dome (a lat/long globe orbiting about its vertical axis) instead of the static icosahedron mesh. Use when the user wants to "see it in 3D", "rotate", "spin", or "orbit" the dome. The rotating mode has no strut-dimension tables. Default false.' },
            orbitSeconds: { type: 'number', description: '[geodesic-dome, spin only] Seconds for one full revolution (2-60). Default 8. Sets the composition duration.' },
            gridN: { type: 'number', description: '[vastu-mandala] Grid size N (4-9). 8 = Manduka (64 padas, most common for temples), 9 = Paramasayika (81 padas). Default 8.' },
            sideMeters: { type: 'number', description: '[vastu-mandala] Temple side length in metres (default 9). Sets the pada size (side ÷ N) shown in mm.' },
            showEnclosures: { type: 'boolean', description: '[vastu-mandala] When true (default), draws the concentric zone belts (Paiśācika / Mānuṣa / Daivika / Brahma).' },
            showDiagonals: { type: 'boolean', description: '[vastu-mandala] When true (default), draws the mandala\'s corner-to-corner diagonals.' },
            splitView: { type: 'boolean', description: 'When true (default), the structure sits on the left and a dimensions panel on the right.' },
            showDimensions: { type: 'boolean', description: 'When true (default), draws the dimension panel, mm labels and annotations. Requires splitView.' },
            width: { type: 'number', description: 'Canvas width px (default 1280).' },
            height: { type: 'number', description: 'Canvas height px (default 720).' },
            fps: { type: 'number', description: 'Frames per second (default 30).' }
          }
        },
        authToken: { type: 'string', description: 'User emailVerificationToken. Auto-forwarded by the chat client; omit unless calling manually.' }
      }
    }
  },
  {
    name: 'get_carousel_reference',
    description: 'Get the Instagram-carousel cookbook — the slide templates supported by vemotion_create_carousel (cover / statement / word-parts / pronunciation / ritual / outro) with the content fields each template uses, the default "ponemer" brand profile (colors, fonts, @tor.arne.have handle, ponemer.vegvisr.org site), and authoring guidance (slide order, text lengths, Devanagari support). Call this BEFORE calling vemotion_create_carousel.',
    input_schema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'vemotion_create_carousel',
    description: 'Create an Instagram carousel as a Vemotion composition — a set of branded 1080×1350 (4:5) slides the user exports as a PNG set and posts as a carousel. The Vemotion worker lays every slide out DETERMINISTICALLY from templates server-side; you supply CONTENT only (headings, body text, word-part items, Devanagari strings) — never coordinates or layer JSON. Each slide becomes one second of the composition with meta.carousel capture markers; the user opens the editorUrl, reviews, and clicks "Export slides (PNG set)" to download one PNG per slide. Default brand profile is "ponemer" (Tor Arne\'s phoneme series: cream/sand/burnt-orange palette, Playfair Display + Poppins + Noto Sans Devanagari, byline "Tor Arne Håve", handle "@tor.arne.have", site "ponemer.vegvisr.org") — pass `brand` only to override parts of it. Call get_carousel_reference first for the template catalogue. Max 10 slides (Instagram limit). Pass `compositionId` to regenerate an existing carousel in place.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Composition title shown in the user\'s Vemotion list, also used (slugified) as the exported PNG filename base (e.g. "avahana-ha-lydreisen" → avahana-ha-lydreisen-01.png).' },
        compositionId: { type: 'string', description: 'UPDATE mode: id of an existing carousel composition to overwrite in place. Omit to create a new one.' },
        slides: {
          type: 'array',
          description: 'The carousel slides in order (1-10). Each slide picks a template and fills only that template\'s content fields — see get_carousel_reference. Fields: template ("cover"|"statement"|"word-parts"|"pronunciation"|"ritual"|"outro"), kicker (small uppercase label), heading, body, devanagari (Devanagari-script string), latin (transliteration, pronunciation template), phonetic (e.g. "aa-VAA-ha-na"), note (accent-colored aside), items (word-parts template: up to 4 of {term, gloss}).',
          items: { type: 'object' }
        },
        description: { type: 'string', description: 'Optional composition meta.description (what the carousel is about, for future agents).' },
        brand: {
          type: 'object',
          description: 'Optional partial override of the ponemer brand profile. Any field omitted keeps the default. colors: {bg, bgAlt, card, ink, body, accent, dark, light, lightBody, muted} hex strings. fonts: {serif, sans, devanagari} font family names. byline / handle / site: strings.',
          properties: {
            colors: { type: 'object' },
            fonts: { type: 'object' },
            byline: { type: 'string' },
            handle: { type: 'string' },
            site: { type: 'string' }
          }
        },
        authToken: { type: 'string', description: 'User emailVerificationToken. Auto-forwarded by the chat client; omit unless calling manually.' }
      },
      required: ['name', 'slides']
    }
  },
  {
    name: 'transcribe_audio',
    description: 'Transcribe an audio file. PREFERRED: pass the `audioUrl` copied EXACTLY from a list_recordings result — this always works, including for Contact-app recordings. Alternatively pass a `recordingId`, but ONLY the exact string returned by list_recordings (e.g. an audio-portfolio id or a `contactlog:<id>` id) — NEVER construct, guess, or derive a recordingId from a filename or timestamp. Automatically uses the logged-in user\'s email for portfolio lookups. Returns the transcription text. Use saveToGraph to create a graph with the transcription as a fulltext node directly — this saves directly without sending the full text through the LLM, so it is much faster for large transcriptions. ALWAYS use saveToGraph:true when the user asks to transcribe and save/create a graph.',
    input_schema: {
      type: 'object',
      properties: {
        recordingId: { type: 'string', description: 'The EXACT recordingId string from a list_recordings result (audio-portfolio id or `contactlog:<id>`). Do NOT invent or derive one from a filename/timestamp. Prefer passing audioUrl instead.' },
        audioUrl: { type: 'string', description: 'Direct URL to the audio file — copy the `audioUrl` field from a list_recordings result verbatim. This is the preferred, most reliable input.' },
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
    name: 'store_user_api_key',
    description: 'Store (or replace) an encrypted provider API key for a user. The key is encrypted server-side (AES-256-GCM) by the user-keys-worker and never stored in plaintext. By default the key is stored for the CURRENT logged-in user (self-service). To store a key on behalf of ANOTHER user, pass that user\'s email as `targetEmail` — this requires the caller to be Superadmin and will be rejected otherwise. Re-storing the same provider overwrites the previous key. Use this when the user asks to add, set, save, or update their (or another user\'s) OpenAI / Anthropic / Google / Grok / Perplexity / Proff API key. Never echoes the key value back.',
    input_schema: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          enum: ['openai', 'anthropic', 'google', 'grok', 'perplexity', 'proff'],
          description: 'Which provider the key belongs to (required).'
        },
        apiKey: {
          type: 'string',
          description: 'The API key value to store (required). E.g. "sk-..." for OpenAI, "sk-ant-..." for Anthropic. Encrypted at rest; never returned to clients.'
        },
        targetEmail: {
          type: 'string',
          description: 'Optional. Email of the user to store the key FOR. Omit to store for the current user. If set to a different user than the caller, the caller must be Superadmin.'
        },
        keyName: {
          type: 'string',
          description: 'Optional friendly name for the key, e.g. "Production OpenAI Key".'
        }
      },
      required: ['provider', 'apiKey']
    }
  },
  {
    name: 'remove_user_api_key',
    description: 'Delete a stored provider API key. By default removes the key for the CURRENT logged-in user. To remove a key for ANOTHER user, pass that user\'s email as `targetEmail` — this requires the caller to be Superadmin. Idempotent: succeeds even if no such key existed. Use this when the user asks to remove, delete, revoke, or clear a stored provider API key. To see which keys are configured, use who_am_i.',
    input_schema: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          enum: ['openai', 'anthropic', 'google', 'grok', 'perplexity', 'proff'],
          description: 'Which provider key to delete (required).'
        },
        targetEmail: {
          type: 'string',
          description: 'Optional. Email of the user whose key to remove. Omit for the current user. If different from the caller, the caller must be Superadmin.'
        }
      },
      required: ['provider']
    }
  },
  {
    name: 'add_email_destination',
    description: 'Register a new RECIPIENT email address in Cloudflare Email Routing so the platform is allowed to send mail to it. Cloudflare will email the recipient a verification link; the address can only receive mail through env.EMAIL.send() AFTER the recipient clicks that link. Use this when the user asks to "add a destination", "register a recipient", "allow sending to X", or when a send fails with "destination not verified". This is different from add_email_account — that registers a SENDER (From: address) in the user\'s profile; this registers a RECIPIENT (To: address) at the account level.',
    input_schema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'The recipient email address to register as a verified destination (required). E.g., "post@universi.no". Cloudflare will send a verification email to this address.'
        }
      },
      required: ['email']
    }
  },
  {
    name: 'list_email_accounts',
    description: 'List the user\'s configured SENDER email accounts (the addresses they can use as From: when calling send_email). Optionally filter to a single address with the `email` parameter — useful for "is this address already configured?" checks before calling add_email_account. THIS IS THE CANONICAL SOURCE for "does sender email X exist?" questions. DO NOT use db_query against the `config` table to answer this — sender accounts live inside the `data` JSON blob at `data.settings.emailAccounts[]`, and direct SQL on `config.email` returns the user\'s LOGIN email, not their sender list. The returned list contains the bare metadata (no passwords).',
    input_schema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Optional. If provided, returns only the matching account (or empty list if not configured). If omitted, returns all sender accounts for the user.'
        }
      },
      required: []
    }
  },
  {
    name: 'add_email_account',
    description: 'Add a new sender email account to the user\'s profile so it can be used by send_email. For @vegvisr.org addresses, no password is needed — the email is sent via Cloudflare Email Service automatically. For Gmail addresses, an app password is required (the user generates one at https://myaccount.google.com/apppasswords). Use this when the user asks to add, register, or configure a new From address. Dedupes by email — fails clearly if the address is already configured.',
    input_schema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'The email address to register as a sender (required). E.g., "noreply@vegvisr.org", "torarnehave@vegr.ai", or "you@gmail.com".'
        },
        name: {
          type: 'string',
          description: 'Optional human-readable display name for the account, e.g. "Vegvisr no-reply".'
        },
        isDefault: {
          type: 'boolean',
          description: 'Make this the default sender account when send_email is called without an explicit fromEmail. Default: false.'
        },
        accountType: {
          type: 'string',
          enum: ['smtp', 'gmail'],
          description: 'Sender backend. "smtp" routes through Cloudflare Email Service (vegvisr.org and any other CF-verified domain — no password needed). "gmail" routes through Gmail SMTP (requires appPassword). If omitted, defaults to "gmail" for @gmail.com addresses and "smtp" otherwise.'
        },
        appPassword: {
          type: 'string',
          description: 'Gmail app password. REQUIRED if accountType is "gmail". Never needed for "smtp". Stored server-side and never returned to clients.'
        },
        forUserEmail: {
          type: 'string',
          description: 'OPERATOR USE (Superadmin only). Configure this sender in ANOTHER user\'s profile instead of your own — pass the target user\'s login email (e.g. "iamazing.page@gmail.com"). Omit to add to your own profile. A non-Superadmin caller passing this gets an error.'
        }
      },
      required: ['email']
    }
  },
  {
    name: 'set_email_password',
    description: 'Set or update the Gmail app password on an EXISTING sender email account in the user\'s profile. Use this when the user pastes an app password for an address that is ALREADY configured (add_email_account refuses to touch an existing account; this updates it in place). Finds the account by email and stores the new app password server-side (never returned). After this, send_email from that address works.',
    input_schema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'The existing sender email address to set the app password on (required). E.g. "msneeggen@gmail.com".'
        },
        appPassword: {
          type: 'string',
          description: 'The Gmail app password to store (required). Generated at https://myaccount.google.com/apppasswords. Stored server-side, never returned.'
        },
        forUserEmail: {
          type: 'string',
          description: 'OPERATOR USE (Superadmin only). Set the password on ANOTHER user\'s existing sender instead of your own — pass the target user\'s login email. Omit to target your own profile. A non-Superadmin caller passing this gets an error.'
        }
      },
      required: ['email', 'appPassword']
    }
  },
  {
    name: 'send_email',
    description: 'Send an email on behalf of the user. Uses the user\'s configured email account (Gmail or SMTP/vegvisr.org). Requires the user to have at least one email account set up in their profile settings. Use this when the user asks to send, write, or compose an email. A Superadmin can pass forUserEmail to send from a DIFFERENT user account (e.g. to trigger a verified send for a founder, which stamps last_verified_at on that founder).',
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
        },
        forUserEmail: {
          type: 'string',
          description: 'Superadmin only. Send from ANOTHER user account (their configured sender) instead of your own. Use to trigger a verified send on a founder behalf without them logging in; the email-worker stamps last_verified_at on that founder. The sender must already be configured on that user with an app password.'
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
        model: { type: 'string', description: 'Optional: specific model name (e.g., "claude-sonnet-4-6", "gpt-4o", "grok-4-latest", "gemini-2.5-flash"). If omitted, uses the provider default.' },
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
    description: 'Run a read-only SQL SELECT query against the main vegvisr_org database. Use this to inspect config, user_api_keys, graphs, and other tables. Only SELECT queries are allowed. NOTE: for any "onboarding status / client status / is X ready / how is X doing" question, use the onboarding_status tool instead — a raw config row does NOT contain the registrar, DNS-move state, chat engagement, knowledge-graph count, or engagement verdict.',
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
    name: 'onboarding_status',
    description: 'Get the COMPLETE onboarding status for a client by email (and optional domain). Returns role, registrar, dns_move state (not_started/propagating/active), RealtimeKit (app + meeting rooms), R2 recording, telemetry KV, knowledge graphs, chat engagement, routine graph, and an engagement verdict on a 5-level ladder (lowest→highest: PARK < ON WAIT < NUDGE < DEVELOPING < GO — PARK=dormant, ON WAIT=engaged but blocked on DNS propagation, NUDGE=some signal but stalled, DEVELOPING=actively building but not yet live, GO=shipped a live published page; with a reason). ALWAYS use this for any "onboarding status / is X ready / how is client X doing / what is the status for X" question. DO NOT use db_query against the config table for onboarding status — this tool aggregates many sources (config, chat DB, RDAP registrar, live DNS) that a single config row does not have. Pass the domain when the email is on a custom domain (e.g. kristoffer@vitalinnsikt.no -> vitalinnsikt.no); the domain also auto-derives from the email when omitted. The response ALSO includes a `world` block — the collective World activity across identities: its chat group, KGs tagged with the World (#<DOMAIN-STEM>), contributors, and a World-level verdict. ALWAYS present the `world` block when it is non-null (chat group name + message count, KG count, contributors, World verdict) — it captures work done under a different identity than the account-holder email (e.g. a project owner who created the group and graphs under their personal email). Report BOTH the personal capabilities AND the World aggregate. The response also includes `published_pages` (in both capabilities and world) — a live HTTP probe of the brand-proxy for the apex, www, and any assigned subdomain; each entry is {host, live, published_at}. A live published page is the FINAL step of the onboarding journey, so it pushes BOTH verdicts to GO (engagement.published / world.published are true). ALWAYS mention which hosts are live when any published_pages entry has live=true. published_pages AUTO-DISCOVERS every published page including arbitrary subdomains (e.g. claude.iamazing.page, ua.iamazing.page) — not just apex/www. The World may be resolved via the World Founder registry: when result.domain_source=\'world-founder-registry\' the founder\'s email did not reveal the domain (e.g. msneeggen@gmail.com founds iamazing.page), and result.founder_of lists the Worlds they found ({world_name, domain, cf_account_id, meta_area_tag, account_holder_email}) — state the founder→World relationship in your answer. result.ownership is the ORGANIZATIONAL stack for this person: {system_owner:{org_name,scope}|null, orgs:[{name,function,percent}], worlds:[{world_name,domain,org_name,hosting_model}], domains_operated:[{domain,kind,org_name}]}. When present, OPEN your answer with it — e.g. "Tor Arne Håve represents Universi AS (System Owner, 80% owner) and co-owns AlivenessLAB AS (20%)". A role (System Owner / World Founder) is held by an ORG and represented by the person; orgs[].percent is their ownership share. Always frame Worlds as founded by the ORG (org_name), not the person. The OVERALL verdict is engagement.verdict — it is the HIGHER of the personal and World ladders: when the World is further along than the account-holder identity (whose activity often lives under other identities, e.g. iamazing.page work is Maiken\'s), engagement.verdict is lifted to the World level and engagement.personal_verdict holds the raw account-only signal. So ALWAYS present engagement.verdict as the overall status; if it differs from personal_verdict, briefly note the World is being actively worked on under other identities. Never report the lower personal_verdict as the overall. capabilities.email_sending reports whether the account can SEND mail — {ok, verified, accounts, with_password, senders[], verified_senders[], last_verified_at}. TWO distinct levels: ok=true = CONFIGURED (≥1 sender has a stored Gmail app password — the "machine password"); verified=true = PROVEN (a real test send actually succeeded, stamped at last_verified_at). Present it as a provisioning step like RealtimeKit/R2, and STATE THE LEVEL: "verified sender (proven by a real send on <last_verified_at>)" when verified=true, "configured but not yet verified — no successful send on record" when ok=true but verified=false, or "email sending not set up" when ok=false. capabilities.email_routing reports whether the domain RECEIVES mail via Cloudflare Email Routing — {enabled, mx[]}; enabled=true means MX points to route*.mx.cloudflare.net, enabled=false with a non-empty mx means the domain uses other mail (e.g. Google smtp.google.com — say which), enabled=null means no domain/lookup failed. Note email_sending (can SEND as the account) and email_routing (can RECEIVE on the domain via Cloudflare) are independent steps; report both.',
    input_schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Client email (the config-row email), e.g. kristoffer@vitalinnsikt.no' },
        domain: { type: 'string', description: 'Optional domain for the registrar/DNS/zone/routine-graph checks, e.g. vitalinnsikt.no' }
      },
      required: ['email']
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
    description: 'Check occupied time slots for a specific date. Returns free/busy blocks from both D1 bookings and Google Calendar events. Use this to find free time or answer availability questions, not to list named appointments.',
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
    description: 'List bookings for a user with guest details, times, sources, and meeting type info. Supports optional date filter in YYYY-MM-DD. Use this for questions like "what bookings do I have today", "do you see my Irene meeting", or when the user expects meeting names/titles rather than just busy slots.',
    input_schema: {
      type: 'object',
      properties: {
        userEmail: { type: 'string', description: 'The calendar owner\'s email address' },
        date: { type: 'string', description: 'Optional filter for a single day in YYYY-MM-DD format' }
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
    description: 'Trigger a chatbot to GENERATE its own reply based on recent group context. The bot uses its chatbot subagent (with tools like search_knowledge, web_search) to author a fresh response, which is then posted to the group. The bot decides what to say — there is NO parameter for custom message text and any verbatim text you might want it to say is IGNORED. Use this only when you want the bot to react autonomously to the conversation. If the user asked you to make a bot SAY a specific message (e.g. "tell the group X", "post Y as @botname"), DO NOT use this tool — use `bot_send_message` instead, which posts the literal text you provide.',
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
    name: 'get_secure_worker_template',
    description: 'Return the canonical Vegvisr server-side auth pattern and worker template for new Cloudflare Workers. ALWAYS call this before deploy_worker when creating or modifying a privileged worker that updates data, deletes data, reads private user data, or deploys infrastructure. Includes secure admin and user-scoped templates plus mandatory rules.',
    input_schema: {
      type: 'object',
      properties: {
        templateType: {
          type: 'string',
          enum: ['admin', 'user-scoped', 'public-readonly', 'all'],
          description: 'Which secure worker template to return. Use "admin" for privileged mutations, "user-scoped" for logged-in user actions, "public-readonly" for public data. Default: "all".'
        }
      }
    }
  },
  {
    name: 'create_capability_blueprint',
    description: 'Classify a natural-language capability request and return the governed implementation plan. Use this FIRST when the user asks to add/create/build a new capability for the agent. It determines whether the capability is public-readonly, user-scoped, or privileged/admin; recommends the implementation path; tells you which secure template flow to use; and indicates when the capability should be treated as a worker-plus-template package with ordered phases.',
    input_schema: {
      type: 'object',
      required: ['request'],
      properties: {
        request: {
          type: 'string',
          description: 'The user\'s natural-language capability request.'
        },
        preferredImplementation: {
          type: 'string',
          enum: ['worker', 'tool', 'html-app', 'graph-template', 'auto'],
          description: 'Optional implementation hint. Default: auto.'
        },
        answers: {
          type: 'object',
          description: 'Optional structured answers from a prior clarification step. Use this when the user has already answered follow-up questions.',
          properties: {
            deliveryMode: {
              type: 'string',
              enum: ['backend-only', 'simple-admin-form', 'reusable-template'],
              description: 'How the capability should be delivered.'
            },
            targetScope: {
              type: 'string',
              enum: ['self', 'selected-user', 'both'],
              description: 'Whether the action affects only the current user, another selected user, or both.'
            },
            mutableFields: {
              type: 'array',
              items: { type: 'string' },
              description: 'Editable fields such as ["bio"].'
            },
            identifierField: {
              type: 'string',
              description: 'Primary lookup field, e.g. "email".'
            },
            tableName: {
              type: 'string',
              description: 'Target D1 table if already known, e.g. "config".'
            }
          }
        }
      }
    }
  },
  {
    name: 'build_capability_worker_scaffold',
    description: 'Generate a governed Worker scaffold from a capability blueprint. Use this after create_capability_blueprint when the recommended implementation is a worker. It applies the canonical secure worker template and produces scaffold code for a specific endpoint and D1 action, reducing freeform worker generation.',
    input_schema: {
      type: 'object',
      required: ['workerName', 'templateType', 'endpointPath', 'actionType'],
      properties: {
        workerName: {
          type: 'string',
          description: 'Worker script name, e.g. "user-bio-admin".'
        },
        templateType: {
          type: 'string',
          enum: ['admin', 'user-scoped', 'public-readonly'],
          description: 'Template chosen from the capability blueprint.'
        },
        endpointPath: {
          type: 'string',
          description: 'Endpoint path such as "/update-bio".'
        },
        method: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'DELETE'],
          description: 'HTTP method. Default: POST.'
        },
        actionType: {
          type: 'string',
          enum: ['update', 'insert', 'delete', 'select'],
          description: 'CRUD action to scaffold.'
        },
        tableName: {
          type: 'string',
          description: 'D1 table name if the worker uses D1.'
        },
        identifierField: {
          type: 'string',
          description: 'Primary lookup field, e.g. "email".'
        },
        mutableFields: {
          type: 'array',
          items: { type: 'string' },
          description: 'Fields the endpoint may update or insert.'
        },
        responseFields: {
          type: 'array',
          items: { type: 'string' },
          description: 'Fields to return in the success response.'
        },
        capabilitySummary: {
          type: 'string',
          description: 'Short human description of what the capability does.'
        },
        allowEmptyFields: {
          type: 'array',
          items: { type: 'string' },
          description: 'Fields that may legally be empty string, e.g. ["bio"].'
        }
      }
    }
  },
  {
    name: 'deploy_worker',
    description: 'Deploy or modify a Cloudflare Worker via the API. Can create new workers or update existing ones. The worker code (ES module JavaScript) is uploaded and deployed instantly — no wrangler or git needed. Use when the user asks to create a new worker, modify an existing endpoint, add functionality to a worker, or fix a bug in a deployed worker. Requires Superadmin role. For new capabilities, first call create_capability_blueprint, then build_capability_worker_scaffold or get_secure_worker_template before deploy_worker. Never trust x-user-role or other client-supplied identity headers.',
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
        description: {
          type: 'string',
          description: 'Human-readable description of what this worker does. Stored in graph_system_registry info field so other agents can understand when to invoke it.'
        },
        domain: {
          type: 'string',
          description: 'Custom domain for this worker (e.g. "admin-bio-updater.vegvisr.org"). Defaults to workerName.torarnehave.workers.dev'
        },
        binding: {
          type: 'string',
          description: 'Cloudflare service binding name if this worker is wired as a binding (e.g. "KG_WORKER"). Leave blank for API-only workers.'
        },
        endpoints: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of endpoint paths this worker exposes (e.g. ["/update-bio", "/get-bio"]). Helps agents know what to call.'
        },
      }
    }
  },
  {
    name: 'register_deployed_worker',
    description: 'Register or update a worker in graph_system_registry without deploying it. Use this to register workers that were deployed outside this agent, fix stale registry entries, or add missing registry nodes after a deploy. Requires Superadmin role.',
    input_schema: {
      type: 'object',
      required: ['workerName'],
      properties: {
        workerName: {
          type: 'string',
          description: 'The worker script name (e.g. "admin-bio-updater")'
        },
        description: {
          type: 'string',
          description: 'Human-readable description of what this worker does'
        },
        domain: {
          type: 'string',
          description: 'Domain for this worker. Defaults to workerName.torarnehave.workers.dev'
        },
        binding: {
          type: 'string',
          description: 'Cloudflare service binding name if applicable'
        },
        endpoints: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of endpoint paths this worker exposes'
        },
      }
    }
  },
  {
    name: 'register_capability_worker',
    description: 'Register an OpenAPI-publishing worker as a first-class capability provider for the Agent Builder. After registration, the worker\'s OpenAPI operations are auto-discovered on the next /tools fetch and become callable tools — no agent-worker code change needed. Use this any time you want a deployed worker that exposes /openapi.json (or any /<prefix>/openapi.json) to extend the agent\'s capabilities. Upserts by `binding`: if a system-worker node with the same binding already exists in graph_system_registry, its metadata is updated in place; otherwise a new node is added. The in-isolate OpenAPI cache is cleared so the worker\'s tools appear on the next request.',
    input_schema: {
      type: 'object',
      required: ['binding', 'name', 'openapi_url'],
      properties: {
        binding: {
          type: 'string',
          description: 'The Cloudflare service-binding name as configured in the agent-worker\'s wrangler.toml (e.g. "VEMOTION_WORKER", "ALBUMS_WORKER"). Must already be bound — registration without a matching env binding is allowed but the worker\'s tools won\'t actually be reachable until the binding exists.'
        },
        name: {
          type: 'string',
          description: 'The Cloudflare worker script name (matches the binding\'s target — e.g. "vemotion-worker"). Used as the URL host for service-binding fetches: https://<name>/<path>.'
        },
        openapi_url: {
          type: 'string',
          description: 'Where the worker serves its OpenAPI spec. Either an absolute URL (https://...) or a path relative to the worker base. For workers whose spec lives at the root use "/openapi.json"; for workers that prefix their routes (e.g. Vemotion at api.vegvisr.org/vemotion/*) use the matching path like "/vemotion/openapi.json".'
        },
        label: {
          type: 'string',
          description: 'Human-readable label for the registry node (e.g. "Vemotion Worker"). Defaults to the binding name.'
        },
        domain: {
          type: 'string',
          description: 'Public domain the worker is reachable on (e.g. "api.vegvisr.org"). Informational; not used for tool dispatch.'
        },
        description: {
          type: 'string',
          description: 'Brief description of what capabilities this worker provides. Shown to the agent and to humans browsing the registry.'
        },
        tool_prefix: {
          type: 'string',
          description: 'Optional prefix prepended to every tool name derived from the worker\'s operationIds (e.g. "kg_"). Omit for no prefix — operation IDs are used as-is (snake_cased). Useful to namespace tool names and avoid collisions with existing tools.'
        },
        auth: {
          type: 'string',
          enum: ['service-binding-superadmin', 'x-api-token', 'none'],
          description: 'How the agent should authenticate calls to this worker. service-binding-superadmin (default): sends `x-user-role: Superadmin` header via the service binding. x-api-token: forwards the calling user\'s emailVerificationToken as X-API-Token. none: no auth header.'
        },
        tool_blocklist: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of fully-qualified tool names (after tool_prefix is applied) to exclude from discovery. Use to prevent collisions with hardcoded tools or to hide internal endpoints.'
        }
      }
    }
  },
  {
    name: 'read_worker',
    description: 'List all deployed Cloudflare Workers or get details about a specific worker. Use to inspect current state before modifying. Superadmin only.',
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
    description: 'Delete a Cloudflare Worker. Requires Superadmin role. Use with caution — this removes the worker from Cloudflare entirely. For privileged workers, confirm the replacement path before deleting.',
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
    name: 'invoke_registry_worker',
    description: 'Call a deployed worker that exists in graph_system_registry, even when it is not available as a first-class tool in the current model path. Use this for deployed capability workers such as admin-bio-updater. Pass the worker name, endpoint path, HTTP method, and JSON body. For update-style workers, read the current value first and send the full merged replacement value unless the worker explicitly supports patch semantics.',
    input_schema: {
      type: 'object',
      required: ['workerName'],
      properties: {
        workerName: {
          type: 'string',
          description: 'Registered worker name, id, or label (for example "admin-bio-updater").'
        },
        endpointPath: {
          type: 'string',
          description: 'Worker endpoint path. Default: "/". Example: "/update-bio".'
        },
        method: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
          description: 'HTTP method to use. Default: POST.'
        },
        query: {
          type: 'object',
          description: 'Optional query parameters as key-value pairs.'
        },
        body: {
          type: 'object',
          description: 'Optional JSON body to send to the worker.'
        }
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
    description: 'Delegate bot MANAGEMENT tasks to the specialized Bot Management subagent. Use this for: list/create/update/delete bots, get bot details, add/remove bots from groups, change bot configuration (model, temperature, tools, personality graph), or asking the bot to GENERATE a contextual reply from conversation. DO NOT use this when the user asks you to make a bot post a SPECIFIC, verbatim message (e.g. "tell the group X", "post Y as @botname", "have @creative say Z") — for that, call `bot_send_message` directly, which posts the literal text. delegate_to_bot uses trigger_bot_response under the hood and that auto-generates the bot\'s reply, DISCARDING any verbatim text.',
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
        model: { type: 'string', description: 'LLM model ID. Use stable names so Anthropic snapshot retirements do not break the agent. Options: claude-haiku-4-5-20251001 (fast/cheap), claude-sonnet-4-6 (balanced), claude-opus-4-8 (most capable).' },
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
    name: 'delegate_to_albums',
    description: 'Delegate photo album / image management tasks to the Albums subagent. Use for: listing the user\'s albums, browsing album contents, creating/renaming/deleting albums, adding or removing images from an album, uploading new images from URLs, publishing an album for public sharing (with shareId), or soft-deleting images (with cascade across all albums). The subagent knows the auth + cascade gotchas and the two backing workers (albums.vegvisr.org + photos-api.vegvisr.org).',
    input_schema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'What to do. Include all relevant details: which album, which images (URLs or R2 keys), whether to publish, etc. Examples: "List my albums", "Add these 3 URLs to my Summer-2025 album", "Show what is in album Norse-Gongs", "Publish album Summer-2025 for sharing", "Remove image 1730000000000-1.png from Summer-2025".'
        },
        albumName: {
          type: 'string',
          description: 'Optional: a specific album name the task targets, if the user already named one.'
        }
      },
      required: ['task']
    }
  },
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
    description: 'Delegate video and streaming tasks to the Video & Streaming subagent. Use this when the user asks to: upload/list/delete Cloudflare Stream videos, create/manage live streams, create cloudflare-video or cloudflare-live nodes, get Stream video playback URLs, or set up RTMP streaming. The subagent talks to the Cloudflare Stream API via videostream-worker. **DO NOT use this for realtime/meeting recordings** — those come from `list_realtime_videos`, already live in the user\'s R2 with a permanent `playUrl`, and are embedded directly as a `video` node. Never upload a realtime recording to Cloudflare Stream.',
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
    name: 'delegate_to_youtube_graph',
    description: 'Delegate YouTube-to-knowledge-graph creation to the YouTube Graph subagent. Use this when the user provides a YouTube URL (youtu.be/..., youtube.com/watch?v=..., shorts) and asks to create / turn it into / generate a knowledge graph from it. The subagent fetches the transcript via Transcript IO, processes it through the grok-worker, and creates a brand-new graph (never merges into an existing one). Defaults: sourceLanguage=auto, targetLanguage=norwegian.',
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The YouTube URL (or bare 11-char videoId) the user supplied.'
        },
        task: {
          type: 'string',
          description: 'What the user asked for, in their own words. Include any language override if they requested one.'
        }
      },
      required: ['url']
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
  },
  {
    name: 'register_world_founder',
    description:
      'Register (or confirm) a World Founder in the world_founders + domains registry. This makes their domain resolve in onboarding-status (domain_source=world-founder-registry), permits them in the me.<domain> login allowlist (system owner + founder), and links the World content tag. Superadmin only. Idempotent — safe to re-run. Pure D1 registry write; does NOT touch Cloudflare.',
    input_schema: {
      type: 'object',
      properties: {
        founder_email: { type: 'string', description: "The founder's Vegvisr login email, e.g. kristoffer@vitalinnsikt.no" },
        domain: { type: 'string', description: "The World's domain, e.g. vitalinnsikt.no" },
        world_name: { type: 'string', description: 'Display name for the World, e.g. Vitalinnsikt. Defaults to the capitalized domain stem.' },
        meta_area_tag: { type: 'string', description: "Content tag, e.g. '#VITALINNSIKT'. Defaults to '#' + the uppercased domain stem." },
        cf_account_id: { type: 'string', description: "The founder's Cloudflare account id (32 hex chars). Optional." },
        hosting_model: { type: 'string', description: "'own_account' (founder hosts in their own CF account) or 'central'. Default 'own_account'." },
        account_holder_email: { type: 'string', description: 'CF account-holder email if different from founder_email. Optional.' },
      },
      required: ['founder_email', 'domain'],
    },
  },
  {
    name: 'get_world_app_interests',
    description:
      "Get the apps a World Founder marked as interested in — read from their config.data.app_interests, which they set via the Apps tab on me.<domain>. Returns the selected app ids with human-readable titles from the App Catalog. Superadmin only. Read-only.",
    input_schema: {
      type: 'object',
      properties: {
        founder_email: { type: 'string', description: "The founder's Vegvisr login email, e.g. lydmorah.net@gmail.com" },
      },
      required: ['founder_email'],
    },
  },
  {
    name: 'list_challenge_templates',
    description:
      "List available challenge page templates — reads all template-meta:challenge-* entries from WORLD_TEMPLATES KV and returns their name, description, key, and preview_html. Use this when a World Founder is choosing a visual style for their challenge page. The result includes preview_html for each template so the UI can render a side-by-side picker. Superadmin only. Code-hardcoded (not in registry).",
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'backup_challenge_templates_to_kg',
    description:
      "Backup all challenge page templates from WORLD_TEMPLATES KV into the knowledge graph graph_challenge_templates_backup. Each template is stored as a fulltext node containing its full HTML. Run this before editing templates or any time you want a restore point. Superadmin only. Code-hardcoded (not in registry).",
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'restore_challenge_template_from_kg',
    description:
      "Restore a single challenge page template from the KG backup graph back into WORLD_TEMPLATES KV. Use template_key to specify which template to restore (e.g. 'template:challenge-page' or 'template:challenge-page-gamified'). Optionally specify graph_id to restore from a different graph (defaults to graph_challenge_templates_backup). Superadmin only. Code-hardcoded (not in registry).",
    input_schema: {
      type: 'object',
      properties: {
        template_key: { type: 'string', description: "KV key of the template to restore, e.g. 'template:challenge-page'" },
        graph_id: { type: 'string', description: "KG graph ID to restore from (default: graph_challenge_templates_backup)" },
      },
      required: ['template_key'],
    },
  },
  {
    name: 'publish_challenge_page',
    description:
      "Publish the challenge participant page to challenge.<domain> — reads the challenge's template_key from D1 (falls back to template:challenge-page) from WORLD_TEMPLATES KV, mints a host-scoped publish token, and POSTs to challenge.<domain>/__html/publish. The challenge.<domain> custom domain must already be attached to the brand proxy (provision_world_kv does this automatically). Superadmin only. Code-hardcoded (not in registry).",
    input_schema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: "The World Founder's domain, e.g. lydmorah.net — the page publishes to challenge.<domain>" },
        host: { type: 'string', description: 'Override the target host (default: challenge.<domain>)' },
        proxy_url: { type: 'string', description: 'Override the brand-proxy publish endpoint (default: https://challenge.<domain>/__html/publish). Use the .workers.dev URL if the custom domain is not yet routed.' },
      },
      required: ['domain'],
    },
  },
  {
    name: 'create_challenge',
    description:
      "Create a new Challenge for a World Founder — writes a row to the `challenges` table in vegvisr_org. A Challenge is bound to a chat group (group_id = the group whose members are the participants) and a shared KG graph (main_graph_id = the journey graph). Participants access it at challenge.<domain>. Superadmin only. Code-hardcoded (not in registry).",
    input_schema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: "The World Founder's domain, e.g. lydmorah.net" },
        group_id: { type: 'string', description: 'The hallo_vegvisr_chat group_id whose members are the challenge participants (= the membership gate)' },
        main_graph_id: { type: 'string', description: 'KG graph ID for the shared challenge journey (the main content / weekly tasks graph)' },
        title: { type: 'string', description: 'Human-readable challenge title' },
        slug: { type: 'string', description: 'URL-safe slug (optional)' },
        weeks: { type: 'number', description: 'Duration in weeks (optional, default 0 = open-ended)' },
        hero_image_url: { type: 'string', description: 'HTTPS URL for the challenge hero image shown at the top of the participant page (e.g. an imgix URL or Pexels/Unsplash URL the user provided in chat)' },
        template_key: { type: 'string', description: "KV key of the chosen challenge page template (from list_challenge_templates). Defaults to 'template:challenge-page' if omitted." },
      },
      required: ['domain', 'group_id', 'main_graph_id'],
    },
  },
  {
    name: 'list_challenge_participants',
    description:
      "List all participants enrolled in a Challenge — reads the `challenge_participants` table. Returns each participant's user_id, personal_graph_id, progress, and status. Superadmin only. Code-hardcoded (not in registry).",
    input_schema: {
      type: 'object',
      properties: {
        challenge_id: { type: 'string', description: 'The UUID of the challenge (from the challenges table, returned by create_challenge)' },
      },
      required: ['challenge_id'],
    },
  },
  {
    name: 'get_participant_graph',
    description:
      "Get a single participant's personal graph ID and progress for a given Challenge. Useful for the founder to review a specific participant's build-up or progress state. Superadmin only. Code-hardcoded (not in registry).",
    input_schema: {
      type: 'object',
      properties: {
        challenge_id: { type: 'string', description: 'The UUID of the challenge' },
        participant_user_id: { type: 'string', description: "The participant's user_id (from config.userId or their email)" },
      },
      required: ['challenge_id', 'participant_user_id'],
    },
  },
  {
    name: 'publish_world_page',
    description:
      "Publish the World-Founder page so it serves at me.<domain>. Reads the central template (template:world-founder-page in WORLD_TEMPLATES), mints a host-scoped publish token signed with agent-worker's own HTML_PUBLISH_SECRET, then POSTs the page to the brand proxy's /__html/publish, which writes html:<host> into its own KV. Superadmin only. The page self-brands from its own host. The brand proxy must hold the SAME secret — provision_world_kv (or set_world_publish_secret) sets it. If a World returns 'Invalid or missing publish token', run provision_world_kv for it first.",
    input_schema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: "The World's domain, e.g. lydmorah.net" },
        host: { type: 'string', description: 'Host to publish at. Defaults to me.<domain>.' },
        proxy_url: { type: 'string', description: "Override the publish endpoint, e.g. https://<brand-proxy>.workers.dev/__html/publish." },
        template_key: { type: 'string', description: "Template key in WORLD_TEMPLATES. Default 'template:world-founder-page'." },
      },
      required: ['domain'],
    },
  },
  {
    name: 'list_world_founder_templates',
    description:
      "List all world-founder page templates in WORLD_TEMPLATES KV (keys starting with 'template:world-founder'). Returns the key, byte length, and full HTML for each. Use this to see what templates exist, read their current HTML, and decide what to edit. After editing, save with save_world_founder_template, then publish with publish_world_page or publish_all_world_pages. Superadmin only. Code-hardcoded (not in registry).",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'save_world_founder_template',
    description:
      "Save (create or overwrite) a world-founder page template in WORLD_TEMPLATES KV. Provide the template_key (must start with 'template:world-founder') and the full html string. Use this after editing a template retrieved via list_world_founder_templates. After saving, run publish_world_page or publish_all_world_pages to push the change live to all me.<domain> sites. Superadmin only. Code-hardcoded (not in registry).",
    input_schema: {
      type: 'object',
      properties: {
        template_key: { type: 'string', description: "KV key for the template, e.g. 'template:world-founder-page' or 'template:world-founder-page-v2'" },
        html: { type: 'string', description: 'The full HTML string to save as the template.' },
      },
      required: ['template_key', 'html'],
    },
  },
  {
    name: 'backup_world_founder_templates_to_kg',
    description:
      "Backup all world-founder page templates from WORLD_TEMPLATES KV into knowledge graph graph_world_founder_templates_backup. Each template is stored as a fulltext node with its full HTML. Run before editing any template. Restore with restore_world_founder_template_from_kg. Superadmin only. Code-hardcoded (not in registry).",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'restore_world_founder_template_from_kg',
    description:
      "Restore a world-founder page template from the KG backup graph back into WORLD_TEMPLATES KV. Specify template_key (e.g. 'template:world-founder-page'). Optionally specify graph_id to restore from a non-default graph (defaults to graph_world_founder_templates_backup). After restoring, run publish_world_page or publish_all_world_pages to push live. Superadmin only. Code-hardcoded (not in registry).",
    input_schema: {
      type: 'object',
      properties: {
        template_key: { type: 'string', description: "KV key of the template to restore, e.g. 'template:world-founder-page'" },
        graph_id: { type: 'string', description: "KG graph ID to restore from (default: graph_world_founder_templates_backup)" },
      },
      required: ['template_key'],
    },
  },
  {
    name: 'publish_all_world_pages',
    description:
      "Re-publish the World-Founder page to EVERY active World in the world_founders registry — use this after editing the shared template (template:world-founder-page in WORLD_TEMPLATES) so all live me.<domain> pages pick up the change in ONE call. For each active domain it mints a host-scoped token (signed with agent-worker's HTML_PUBLISH_SECRET) and POSTs to me.<domain>/__html/publish. Superadmin only. Returns a per-World result list with published/failed counts. Worlds not yet provisioned (no me.<domain> route / publish secret) fail individually with their error and are reported — they do NOT stop the rest; run provision_world_kv for those.",
    input_schema: {
      type: 'object',
      properties: {
        template_key: { type: 'string', description: "Template key in WORLD_TEMPLATES. Default 'template:world-founder-page'." },
      },
      required: [],
    },
  },
  {
    name: 'deploy_world_proxy',
    description:
      "Create (deploy) a World's brand-proxy worker (<stem>-brand-proxy) in the founder's OWN Cloudflare account — the piece that serves me.<domain> plus the /__html/publish + /__html/check endpoints. This is the step that fixes 'HTTP 530 (worker not reachable)', i.e. when no brand proxy exists yet. It uploads the canonical brand-proxy script (template:brand-proxy in WORLD_TEMPLATES), creates the HTML_PAGES + BRAND_CONFIG KV namespaces if missing, binds them, stamps HTML_PUBLISH_SECRET at deploy, and attaches me.<domain> as a custom domain. After this the World is publishable — run publish_world_page. Superadmin only; requires the founder's stored token (set_world_credentials) with Workers Scripts edit + Workers KV Storage edit + DNS/Routes edit + Zone read. Idempotent: skips an existing worker (still (re)attaches the route); pass force=true to redeploy the script.",
    input_schema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: "The World's domain, e.g. movemetime.com" },
        founder_email: { type: 'string', description: 'Optional — resolved from the domain via world_founders if omitted.' },
        worker_name: { type: 'string', description: 'Override the brand-proxy worker name (default <stem>-brand-proxy).' },
        host: { type: 'string', description: 'Host to attach (default me.<domain>).' },
        force: { type: 'boolean', description: 'Redeploy the script even if the worker already exists.' },
      },
      required: ['domain'],
    },
  },
  {
    name: 'set_world_credentials',
    description:
      "Store a founder's Cloudflare account id + API token in their config so the World-provisioning tools (provision_world_kv, publish_world_page, deploy_world_proxy, set_world_route_dns) can act in the founder's OWN Cloudflare account. Superadmin only. The token is stored server-side and never echoed. It must have Workers KV Storage edit scope (plus Workers Scripts + DNS edit for the deploy/route tools).",
    input_schema: {
      type: 'object',
      properties: {
        founder_email: { type: 'string', description: "The founder's email (or pass domain to resolve it from world_founders)." },
        domain: { type: 'string', description: "The World's domain, used to resolve the founder if founder_email is omitted." },
        cf_account_id: { type: 'string', description: "The founder's Cloudflare account id (32 hex). Optional if already set." },
        cf_api_token: { type: 'string', description: "The founder's Cloudflare API token (scoped to their account). Required. Stored, never returned." },
      },
      required: ['cf_api_token'],
    },
  },
  {
    name: 'check_world_credentials',
    description:
      "Read-only: report whether a World's Cloudflare credentials (cf_account_id + cf_api_token) are stored in config — presence ONLY, the token is never returned (just a last-6 suffix to identify it). Checks every candidate email for the domain: the registry founder, the registry account_holder_email, and any founder_email you pass. Use it to answer 'are the World credentials set, and under which account?' — e.g. iamazing.page's token may live under iamazing.page@gmail.com, not the founder msneeggen@gmail.com. Superadmin only.",
    input_schema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: "The World's domain, e.g. iamazing.page — checks the registry founder + account_holder for it." },
        founder_email: { type: 'string', description: 'Also check this specific email/account, e.g. iamazing.page@gmail.com.' },
      },
      required: [],
    },
  },
  {
    name: 'provision_world_kv',
    description:
      "Make a World publishable in one step: (1) create/find the HTML_PAGES KV namespace in the founder's OWN Cloudflare account (idempotent) and record its id in config.cf_kv_namespace_id, and (2) set the brand proxy's HTML_PUBLISH_SECRET to agent-worker's value so publish_world_page works. This is the routine that was previously only printed as a manual step (Lesson 44). Superadmin only. Requires the founder's stored token (set_world_credentials) to have Workers KV Storage edit + Workers Scripts edit scope, agent-worker to have its HTML_PUBLISH_SECRET set, and the brand proxy to exist. Reports KV + publish_secret results separately.",
    input_schema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: "The World's domain, e.g. iamazing.page (resolves the founder)." },
        founder_email: { type: 'string', description: 'Override the founder email (else resolved from the domain via world_founders).' },
        cf_account_id: { type: 'string', description: "Override the founder's Cloudflare account id (else from config)." },
        worker_name: { type: 'string', description: "Brand-proxy worker name for the secret step. Defaults to <stem>-brand-proxy." },
        title: { type: 'string', description: "KV namespace title. Default 'HTML_PAGES'." },
      },
      required: [],
    },
  },
  {
    name: 'check_world_publish',
    description:
      "Read-only readiness check for a World's publish path. Stores nothing and creates no token. Asks the World's own brand proxy (GET /__html/check) whether HTML_PAGES is enabled+bound and whether the host(s) route to the brand proxy, and whether the Superadmin publish-token mint works. Use this to see if a World (e.g. lydmorah.net) has HTML_PAGES set up before publishing. HTML_PAGES is enabled per-World from the Cloudflare dashboard; this only reports status. Superadmin only.",
    input_schema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: "The World's domain, e.g. lydmorah.net" },
        host: { type: 'string', description: 'Check a single host. Defaults to checking both me.<domain> and <domain>.' },
      },
      required: ['domain'],
    },
  },
  {
    name: 'set_world_publish_secret',
    description:
      "Set a World's brand-proxy HTML_PUBLISH_SECRET to agent-worker's own value, so publish_world_page works for that World. Standalone version of the secret step that provision_world_kv also does. Uses the World's stored Cloudflare token (needs Workers Scripts edit scope) to write the secret into the brand proxy worker via the CF API; the value is held on agent-worker (env.HTML_PUBLISH_SECRET, set once by the operator via `wrangler secret put` — a value they generate) and never passes through chat. Superadmin only. Prereqs: register_world_founder + set_world_credentials (stored token) for the domain.",
    input_schema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: "The World's domain, e.g. lydmorah.net" },
        founder_email: { type: 'string', description: 'Override the founder email (else resolved from world_founders for the domain).' },
        cf_account_id: { type: 'string', description: "Override the founder's Cloudflare account id (else from config)." },
        worker_name: { type: 'string', description: "Brand-proxy worker script name. Defaults to <stem>-brand-proxy (e.g. lydmorah-brand-proxy). If wrong, the tool lists the account's scripts." },
      },
      required: ['domain'],
    },
  },
  {
    name: 'generate_app_showcase',
    description:
      "Build or refresh the World-Founder-facing app showcase on the Vegr.ai App Catalog graph (default 6074a2bf-082b-4e92-a91d-eeab94c69b66). For each app node it embeds the app logo (resolved from the 'Assets' photo album by the semantic label '<app-slug>-logo', served via imgix) and a generated benefit pitch laid out as logo, then app name, then a one-line tagline, then three benefit cards — written for a World Founder who does not know the apps. The showcase becomes the node body; the original catalog content is preserved losslessly in the node's showcaseSourceInfo field, so a manual edit or a re-run never loses it. Idempotent: nodes that already have a showcase are left untouched unless regenerate:true. Apps with no '<slug>-logo' image in the Assets album are skipped and reported so the operator knows which logos to add. Superadmin only. Run with app:'all' for every app, or app:'<name or slug>' (e.g. 'Vemotion') for one.",
    input_schema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: "App name or slug to (re)build, e.g. 'Vemotion' or 'vemotion', or 'all' for every app node in the catalog. Default 'all'." },
        regenerate: { type: 'boolean', description: 'If true, rewrite the showcase for apps that already have one. If false (default), apps that already have a showcase are left untouched.' },
        graphId: { type: 'string', description: 'Override the catalog graph id. Defaults to the App Catalog 6074a2bf-082b-4e92-a91d-eeab94c69b66.' },
        albumName: { type: 'string', description: "Photo album holding the logos. Defaults to 'Assets'." },
        authToken: { type: 'string', description: 'User emailVerificationToken. Auto-forwarded by the chat client.' }
      }
    }
  }
]

/**
 * Proff.no tools for Norwegian business/person lookups (Brønnøysundregistrene)
 */
const PROFF_TOOLS = [
  {
    name: 'proff_search_companies',
    description: 'Search for Norwegian companies in Brønnøysundregistrene using name, industry/NACE code, company type, location, and other register filters. Returns the current page of companies plus totalResults across all pages. Use this for filtered search and count questions.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Company name to search for (e.g., "Equinor", "Spotify Norway")'
        },
        industryCode: {
          type: 'string',
          description: 'Industry/NACE code, e.g. "64.312"'
        },
        industry: {
          type: 'string',
          description: 'Industry text filter'
        },
        location: {
          type: 'string',
          description: 'Location filter, e.g. "Oslo" or "Vestland"'
        },
        companyType: {
          type: 'array',
          items: {
            type: 'string'
          },
          description: 'Company type codes like AS, ANS, EP or NUF'
        },
        filter: {
          type: 'string',
          description: 'Custom Proff filter string, e.g. "status:AKTIVT"'
        },
        sort: {
          type: 'string',
          description: 'Sort order such as relevance, profitDesc, revenueDesc or companyNameDesc'
        },
        pageSize: {
          type: 'integer',
          description: 'Results per page'
        },
        pageNumber: {
          type: 'integer',
          description: 'Page number'
        },
        numEmployeesFrom: {
          type: 'string',
          description: 'Minimum number of employees'
        },
        numEmployeesTo: {
          type: 'string',
          description: 'Maximum number of employees'
        },
        revenueFrom: {
          type: 'string',
          description: 'Minimum revenue'
        },
        revenueTo: {
          type: 'string',
          description: 'Maximum revenue'
        },
        profitFrom: {
          type: 'string',
          description: 'Minimum profit'
        },
        profitTo: {
          type: 'string',
          description: 'Maximum profit'
        },
        establishedYearFrom: {
          type: 'string',
          description: 'Earliest establishment year'
        },
        establishedYearTo: {
          type: 'string',
          description: 'Latest establishment year'
        }
      }
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
    name: 'proff_get_public_company_info',
    description: 'Get public foretaksinformasjon for a Norwegian company: name, org.nr, purpose, company type, NACE, managing director, phone numbers, addresses, registration statuses, share capital, and status. Requires the org.nr from proff_search_companies.',
    input_schema: {
      type: 'object',
      properties: {
        orgNr: {
          type: 'string',
          description: 'Norwegian organization number (org.nr) from proff_search_companies, e.g., "892545642"'
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
