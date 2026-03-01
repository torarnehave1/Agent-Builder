# Agent-Builder — Claude Code Instructions

## What This Project Is

The Agent-Builder is a full-stack AI agent system built on Cloudflare Workers + React/Vite (Pages).
It gives users a chat interface (AgentChat) where they talk to a Claude-powered agent that can
create, read, modify, and analyze **Knowledge Graphs** stored in a D1 database.

**Knowledge Graphs** are the core data structure in the Vegvisr ecosystem. Every piece of content —
documents, HTML pages, images, diagrams, audio transcriptions — is a **node** in a graph. Nodes
have types (fulltext, html-node, markdown-image, mermaid-diagram, css-node, etc.), and edges
connect them. Graphs have metadata (title, description, category, metaArea).

## Architecture

```
AgentChat.tsx (React) → POST /chat → agent-worker (SSE) → Claude (anthropic-worker)
                                          ↕ tool calls
                              knowledge-graph-worker (D1)
                              albums-worker (R2 photos)
                              perplexity-worker (web search)
                              openai-worker (Whisper transcription)
                              audio-portfolio-worker (recordings)
```

### Key Files

**Worker (backend):**
- `worker/index.js` — HTTP router: /chat (SSE), /execute, /upload-image, /analyze, /build-html-page
- `worker/agent-loop.js` — Agentic loop: calls Claude, executes tools, streams SSE events
- `worker/tool-definitions.js` — Tool schemas sent to Claude (what tools the agent has)
- `worker/tool-executors.js` — Tool implementations (what each tool actually does)
- `worker/system-prompt.js` — System prompt sent to Claude every turn
- `worker/openapi-tools.js` — Dynamically loads tools from KG worker's OpenAPI spec
- `worker/wrangler.toml` — Service bindings, D1, routes

**Frontend (React/Vite):**
- `src/components/AgentChat.tsx` — Main chat UI: SSE parsing, tool call rendering, image attachments, audio transcription
- `src/components/AgentBuilder.tsx` — Contract editor UI
- `src/components/ContractCanvas.tsx` — React Flow canvas for contracts

### Service Bindings (wrangler.toml)

| Binding | Worker | Purpose |
|---------|--------|---------|
| KG_WORKER | knowledge-graph-worker | All graph/node CRUD |
| ANTHROPIC | anthropic-worker | Claude API calls (passes messages through to api.anthropic.com) |
| PERPLEXITY | perplexity-worker | Web search via Perplexity Sonar |
| API_WORKER | vegvisr-api-worker | Pexels/Unsplash image search |
| ALBUMS_WORKER | vegvisr-albums-worker | Photo album access |
| OPENAI_WORKER | openai-worker | Whisper transcription |
| AUDIO_PORTFOLIO | audio-portfolio-worker | Recording metadata |
| DB | D1: vegvisr_org | User profiles, API keys, agent contracts |

## Knowledge Graph API (knowledge.vegvisr.org)

Source: `vegvisr-frontend/dev-worker/index.js`

### Graph CRUD
- **saveGraphWithHistory**: `POST { id, graphData: { nodes, edges, metadata }, override: true }`
  - Field is `id` NOT `graphId`, and `graphData` NOT `data`
- **getknowgraph**: `GET ?id=<graphId>` — Full graph (nodes, edges, metadata)
- **getknowgraphsummaries**: `GET ?offset=0&limit=80&metaArea=TERM` — List graphs (metaArea is SQL LIKE filter)
- **searchGraphs**: `GET ?q=text&nodeType=type&limit=20&offset=0` — Search graphs
- **deleteknowgraph**: `POST { graphId }`

### Node CRUD
- **addNode**: `POST { graphId, node: { id, label, type, info, path, color, metadata, bibl } }`
- **patchNode**: `POST { graphId, nodeId, fields: { info, label, path, color, metadata } }`
- **removeNode**: `POST { graphId, nodeId }`

### History
- **getknowgraphhistory**: `GET ?id=<graphId>` — Version history
- **getknowgraphversion**: `GET ?id=<graphId>&version=<n>` — Specific version

## Node Types

- **fulltext**: Markdown content in `info` field. Label prefixed with `#` for discovery.
- **html-node**: Full HTML page in `info` field. GRAPH_ID and NODE_ID injected.
- **markdown-image**: Image reference. URL in `path` field, alt text in `info`.
- **mermaid-diagram**: Mermaid syntax in `info` field (raw, NO markdown fencing).
- **css-node**: CSS in `info` field, linked to html-node via `styles` edge.
- **video/audio/link**: Media types.

## Agent Tools (tool-definitions.js → tool-executors.js)

### Graph Reading (3 tools — different purposes)
- **read_graph**: Structure overview. Type-aware truncation (fulltext=2000, html=200). Returns `info_truncated` flag.
- **read_graph_content**: Full content, no truncation. Optional `nodeTypes` filter.
- **read_node**: Single node, full content.

### Graph Writing
- **create_graph**, **create_node**, **create_html_node**, **create_html_from_template**
- **patch_node**, **patch_graph_metadata**, **add_edge**, **remove_node**

### Search & Media
- **list_graphs**, **list_meta_areas**, **search_pexels**, **search_unsplash**
- **get_album_images**, **analyze_image** (Haiku vision)
- **perplexity_search** (web search)
- **transcribe_audio**, **list_recordings**, **analyze_transcription**

### Analysis
- **analyze_node** (Sonnet), **analyze_graph** (Sonnet)

## SSE Events (agent-loop.js → AgentChat.tsx)

| Event | Data | Purpose |
|-------|------|---------|
| thinking | { turn } | Agent loop turn started |
| text | { content } | Text from Claude |
| tool_call | { tool, input } | Tool invocation started |
| tool_progress | { tool, message } | Long-running tool progress |
| tool_result | { tool, success, summary } | Tool completed |
| suggestions | { suggestions: string[] } | Follow-up prompt suggestions (Haiku) |
| done | { turns } | Agent loop finished |
| error | { error } | Fatal error |

## How The User Works — Workflow & Conventions

### Development Process
1. **Plan before code**: Use plan mode for non-trivial features. The user prefers to understand the approach before implementation.
2. **Read before write**: ALWAYS read existing code on BOTH sides (caller + callee) before writing.
3. **Follow existing patterns**: The codebase has working patterns for everything. Never invent new approaches.
4. **Test with curl**: After API changes, verify with curl. Log curls in `vegvisr-frontend/cursl.md`.
5. **Deploy only when asked**: NEVER deploy or push without the user explicitly asking.

### Deployment
- **Workers**: `cd worker && wrangler deploy` — ALL workers, including those in other repos.
- **Pages apps** (Agent-Builder, photos, aichat, vemail): `git push` — auto-deploys via GitHub integration.
- **Check wrangler.toml** for routes BEFORE deploying workers with custom domains.
- **Use `--remote` flag** with all `wrangler kv` commands (CLI defaults to preview KV, not production).

### Cloudflare Setup
- ALL workers are in the SAME account. Never question service bindings or cross-account issues.
- Service bindings work between ALL workers. Routes work with zone_name = "vegvisr.org".

### Knowledge Graph Conventions
- **NEVER filter paginated results client-side**. Add server-side SQL filtering.
- Response field is `data.results` (NOT `data.graphs`). Metadata is nested: `g.metadata.title`.
- Image nodes use type `markdown-image` with URL in `path` field (NOT type `image`).
- Images are served via `https://vegvisr.imgix.net/{key}` — append `?w=800&h=400&fit=crop` for resizing.

### Memory & Session Recovery
- **Auto-memory**: `/Users/torarnehave/.claude/projects/-Users-torarnehave-Documents-GitHub-my-test-app/memory/MEMORY.md` loads every session.
- **Deep reference**: `agent-builder-architecture.md` in the same memory directory has tool mappings, API formats, SSE events.
- **Patterns**: `patterns.md` has mandatory rules (read before write, never client-filter, test with curl).
- **Current work graph**: `graph_current_work` at `https://knowledge.vegvisr.org/getknowgraph?id=graph_current_work`
- **Curl log**: `vegvisr-frontend/cursl.md`

### Key Knowledge Graphs for Reference
- `graph_agent_sdk_architecture` — SDK architecture, agents, system flow diagrams
- `graph_agent_builder_development` — Development docs, terminology, UI, tools, contracts (33 nodes)
- `graph_agent_chat_plan` — Chat system implementation plan
- `graph_current_work` — Current work tracker (update this when completing features)

### Image Handling
- Pasted/dropped images are auto-uploaded to photos API → get imgix URL.
- Drag & drop from photos-vegvisr app uses `application/x-photo-keys` data transfer.
- `analyze_image` tool requires HTTPS URLs — do NOT pass base64 data URIs.
- Images attached in chat are visible to Claude directly — no need to call `analyze_image` on them.

### Vegvisr Theme Contract System
- Contract version: `vegvisr-theme-v1` (in domain-worker/src/index.js)
- Required CSS classes: `v-page`, `v-container`, `v-section`, `v-title`, `v-text`
- CSS custom properties: `--v-bg`, `--v-surface`, `--v-text`, `--v-muted`, `--v-primary`, etc.
- html-node + css-node linked by `styles` edge
