# Agent-Builder — System Architecture Reference

> **Purpose.** This is the *reference* documentation: **how the system works and how to change
> it safely.** It is NOT the architecture *audit* (health/risk snapshot) — that lives in the
> knowledge graph `ba0d92cd-2224-4db8-a929-e792b9d29539` ("Agent-Builder Architecture Audit Report").
>
> **Source of truth is the code.** Every load-bearing claim is anchored `file:line`. The counts and
> exposure lists are machine-extracted and re-verifiable with `node scripts/doc-drift-check.mjs`.
> Sections marked **[NOT YET MAPPED]** are honest stubs — do not treat their absence as "no such
> concern"; they are unwritten, not verified-empty (L50).
>
> **Last verified against code:** 2026-08-03 (agent-worker). Structure follows arc42; depth is
> concentrated on the tool lifecycle + exposure topology, because that is where changes silently break.

Paths are relative to `Agent-Builder/worker/`.

---

## 1. Introduction & Goals
Agent-Builder is a multi-model agentic chat + build platform: a Vite/React SPA talking to one
Cloudflare Worker (`agent-worker`) that runs an agentic tool-loop and dispatches to service-bound
workers and D1. Primary quality goal (from the audit's ATAM utility tree): **the chat must not get
stuck mid-turn** — it must either succeed verifiably or fail visibly within a couple of turns.

## 2. Constraints
- Cloudflare Workers runtime (no Node APIs beyond nodejs_compat); D1 for relational data.
- Multi-model: Anthropic (Claude), xAI (Grok), OpenAI-compatible, and Cloudflare Workers AI — **three
  structurally separate execution paths** (this asymmetry is the #1 source of tool-wiring bugs, §8).
- `wrangler.toml` is gitignored; secrets/vars live there and in the CF dashboard.

## 3. Context & Scope (C4 Level 1)
User (browser) ↔ Agent-Builder SPA (Cloudflare Pages) ↔ `agent-worker` (this repo) ↔ service-bound
workers: `knowledge-graph-worker`, `anthropic-worker`, `grok-worker`, `openai-worker`,
`perplexity-worker`, `albums-worker`, `photos-worker`, `audio-portfolio-worker`, `email-worker`,
`group-chat-worker`, `calendar-worker`, `vemotion-worker`, `realtime-worker`, … (all `[[services]]`
in `wrangler.toml`). Data: D1 `vegvisr_org` (app data) + the KG worker's own D1 (graph data).

## 4. Solution Strategy
- **One fetch router** (`index.js`) selects an engine and builds the toolbox per request.
- **Tool-driven agentic loop:** the model is offered tools from `TOOL_DEFINITIONS`; each maps to an
  executor in `executeTool`; executors call service-bound workers.
- **Worker→worker only via service bindings** (`env.KG_WORKER.fetch('https://knowledge-graph-worker/…')`),
  never public URLs (L37).

## 5. Building Block View (C4 Level 2/3)
| File | Role |
|---|---|
| `index.js` | Fetch router; `/chat` (SSE) entry; per-agent config load; `EXCLUSIVE_CONTEXTS`; DO routing. |
| `agent.js` | `VegvisrAgent` Durable Object — the **Workers-AI** engine (AI-SDK). |
| `agent-loop.js` | `streamingAgentLoop` — the **Claude / OpenAI / Grok** engine (branches on model). |
| `tool-definitions.js` | `TOOL_DEFINITIONS` array (**214** tools, drift-check) + `PROFF_TOOLS`, `WEB_SEARCH_TOOL`. |
| `tool-executors.js` | `executeTool` switch (**217** cases, drift-check) → executor fns; `cfApi`, `assertMcpOwner`. |
| `system-prompt.js` | Behavioral rules injected into the system prompt. |
| `*-subagent.js` | Delegated sub-loops (kg, html-builder, chat, bot, contact, album, agent-builder, video). |
| `openapi-tools.js` | Dynamic registry-driven tools (the `default:` dispatch path). |

### 5.1 Frontend (SPA) building blocks
Paths in this subsection are relative to the repo `src/`. Auth gate `App.tsx` (checking/anonymous/authed)
mounts `AgentBuilder.tsx`, which owns the top-level tab switcher (`View` union `AgentBuilder.tsx:16`,
nav `:66`). `Sidebar.tsx` is NOT a top-level tab — it is the graph-editor inspector panel.

| Tab id | Label | Component | Role |
|---|---|---|---|
| `context` | Start | `WorkContextTab.tsx` (`AgentBuilder.tsx:126`) | Pick a work context, then jump to Chat |
| `chat` | Chat | **`VegvisrAgentChat.tsx`** (`:137`) — Workers-AI models | Chat over the **Agents SDK** (not the SSE contract, §6.2) |
| `chat` | Chat | **`AgentChat.tsx`** (`:143`, +`HtmlPreview.tsx` `:162`) — non-Workers-AI | The **only** raw `/chat` **SSE** consumer (§6.2) |
| `graphs` | Graphs | `GraphPortfolioTab.tsx` (`:177`) | Browse/select graphs, set graph context |
| `agents` | Agents | `AgentSettings.tsx` (`:188`) | Create/edit scoped bots (persona + tool set → `agent_configs`) |
| `automation` | Automation | `AutomationTab.tsx` (`:196`) | Build/inspect automation flows |
| `data` | Data | `DataExplorer.tsx` (`:197`) | Data browsing/exploration |
| `usage` | Usage | `UsageDashboard.tsx` (`:198`) | Usage/cost dashboard |
| `settings` | Settings | `GitHubConnect.tsx` + `ModelSettings.tsx` (`:199–203`) | GitHub connect + model selection |

Which chat client renders is decided by `isWorkersAIModel(model)` **[AgentBuilder.tsx:135/140]** — the
same model choice that selects the engine (§6.1) selects the client protocol (§6.2).

### 5.2 Data stores (D1) — schemas reconstructed from code usage
No `CREATE TABLE` lives in the worker; schemas are managed externally (D1 migrations/console). Columns
below are reconstructed from the SELECT/INSERT/UPDATE sites — authoritative for what the worker reads
and writes, not necessarily the full DDL. **Four D1 bindings** [wrangler.toml]:

| binding | database | role | accessed via |
|---|---|---|---|
| `DB` | `vegvisr_org` | primary app data (`agent_configs`, `chat_bots`, …) | direct + `db_query`/`db_list_tables` |
| `STATS_DB` | `agent-stats-db` | per-turn `sessions` telemetry | direct (6 writers) |
| `CHAT_DB` | `hallo_vegvisr_chat` | group-chat messages/bots | `chat_db_query`/`chat_db_list_tables` |
| `CALENDAR_DB` | `calendar_db` | calendar | `calendar_query`/`calendar_list_tables` |

**`agent_configs` (DB) — the per-agent config AND the DATA-side exposure filter (§8 row 5).**
[INSERT index.js:2495; load :1611–1627]

| column | type (inferred) | meaning |
|---|---|---|
| `id` | TEXT PK | `agent_<uuid8>` [:2493] |
| `name` | TEXT | required; **locked once registered as a chat bot** [:2562–2574] |
| `description` | TEXT | |
| `system_prompt` | TEXT | **prepended** to base+dynamic prompt, not replacing [:1619–1620] |
| `model` | TEXT | validated against `KNOWN_MODELS` on update — a retired model can't be saved [:2537] (→ §6.1) |
| `max_tokens` | INT | default 4096 [:2503] |
| `temperature` | REAL | default 0.3 [:2504] |
| `tools` | TEXT (JSON array) | **→ `toolFilter`**; `[]` = full toolbox, non-empty = only those tools [:1624–1625] |
| `metadata` | TEXT (JSON) | holds `chatBotId`, `botGraphId` [:2570,:2596] |
| `is_active` | INT | only `is_active=1` is loaded/listed [:1614] |
| `avatar_url` | TEXT | → `agent_info` (§6.2) / DO avatar |

**Data-side exposure rule:** a chat carrying an `agentId` loads this row; a non-empty `tools` becomes
`toolFilter`, which is then intersected with the engine's own whitelist/blocklist (§8) and can be
overridden by `EXCLUSIVE_CONTEXTS` [:1644]. **A tool must survive BOTH the code filter (§8) AND the
agent's data filter to reach the model** — this row is the sixth exposure gate.

**`config` (DB) — the user/role source of truth (read by `auth.js`, §8.5).** [auth.js:58–81] Columns
read: `email, user_id, Role, phone, bio, emailVerificationToken`. `emailVerificationToken` doubles as the
API/dev token (X-API-Token); a magic-link login resolves a user to this row.

**`chat_bots` (DB)** — the group-chat projection of an agent. On agent update the worker syncs
[:2583–2606]: `name, avatar_url, system_prompt, model, tools, temperature`, and `graph_id ← metadata.botGraphId`.
`username` (derived from `name`) and `max_turns` are NOT synced; the derived `username` is exactly why a
registered bot's `name` is immutable [:2562].

**`sessions` (STATS_DB)** — one row per turn, written by **every engine + fast-path** (6 sites:
agent.js:325, agent-loop.js:882/1493, index.js:107/3590, tool-executors.js:7000). Columns [agent.js:324–334]:
`id, user_id, started_at, ended_at, duration_ms, turns, fast_path, model, input_tokens, output_tokens,
tool_calls, success, agent_id, version, version_note, cost_usd`.

**[NOT YET MAPPED]** full column DDL of `chat_bots`, and the `CHAT_DB`/`CALENDAR_DB` tables — reached
generically via the `*_db_query` tools, so the worker never pins their columns in code.

## 6. Runtime View — one request's path
1. `index.js` receives `/chat`; loads per-agent config from D1 `agent_configs` **[index.js:1611–1627]**
   (`system_prompt`, `model`, and `tools` JSON → `toolFilter`).
2. Applies `EXCLUSIVE_CONTEXTS` **[index.js:1636–1646]** — a matching `workContext.title` HARD-LOCKS
   `toolFilter` (overrides the per-agent filter).
3. Selects engine: Workers-AI DO (`agent.js`) vs `streamingAgentLoop` (`agent-loop.js`), which itself
   branches Claude vs OpenAI/Grok on `isOpenAICompatibleModel` **[agent-loop.js:910]**. Full model→engine
   routing, registry, defaults, and snapshot-fallback are mapped in **§6.1**.
4. Builds the toolbox (§8 filters), runs the agentic loop, dispatches tool calls through `executeTool`.
5. Executors call service-bound workers; results stream back over SSE — the event catalogue + the
   frontend consumer are mapped in **§6.2**.
- **[NOT YET MAPPED]** detailed error-recovery/timeout/reconnection semantics (audit CH-02/CH-03); the
  event framing, catalogue, and the frontend allow-list are now in §6.2, turn-bounds in §6.1.

### 6.1 Model routing & engine selection — which loop, which filter, which fallback
Two structurally separate ENTRY points pick the engine before any tool filter applies:

| Entry | Trigger | Engine | File |
|---|---|---|---|
| `routeAgentRequest(request, env)` | WebSocket / agent DO requests | `VegvisrAgent` Durable Object = **Workers-AI** | index.js:190–191, agent.js |
| `/chat` (SSE) → `streamingAgentLoop` | HTTP chat turn | Claude **or** OpenAI/Grok | index.js:1743, agent-loop.js:907 |

Inside `streamingAgentLoop` the `model` string selects the sub-engine:
- `isOpenAICompatibleModel(model)` **[agent-loop.js:197]** → `streamingOpenAIAgentLoop` **[:619]**
  - `isGrokModel` = `grok/` prefix → `GROK_WORKER` (`grok.vegvisr.org/chat`) **[:622–628]**
  - else = `openai/` prefix → openai-worker
- else → the native **Claude** branch (in-line in `streamingAgentLoop`).

Prefixes `openai/` / `grok/` are `OPENAI_MODEL_PREFIX` / `GROK_MODEL_PREFIX` **[agent-loop.js:104–105]**;
`isOpenAIModel`/`isGrokModel`/`isOpenAICompatibleModel` **[agent-loop.js:189–199]**. Any model without a
known prefix is treated as a Claude model.

**Model registry** — the single source of valid Claude IDs is `MODELS` **[models.js:25–30]**. Live callers
and saved `agent_configs.model` MUST reference one of these; a hardcoded `-YYYYMMDD` snapshot silently
breaks every caller when Anthropic retires it (2026-06-15 incident, models.js header):

| Alias | ID | Note |
|---|---|---|
| HAIKU | `claude-haiku-4-5-20251001` | **DEFAULT_MODEL** — pinned snapshot (no stable alias published) |
| SONNET | `claude-sonnet-4-6` | stable auto-updating alias |
| OPUS | `claude-opus-4-8` | stable auto-updating alias |
| FABLE | `claude-fable-5` | stable auto-updating alias |

**Defaults & turn bounds** (the "must not get stuck" goal, §1): Claude `maxTurns` = 8 **[agent-loop.js:908]**;
OpenAI/Grok `maxTurns` = 6, default model `openai/gpt-5.6-luna` **[agent-loop.js:620–621]**;
`DEFAULT_MODEL = MODELS.HAIKU` **[models.js:33]**.

**Snapshot fallback:** `familyOf(id)` → family, `resolveToStable(id)` → `MODELS[family]` **[models.js:43–60]**.
anthropic-worker uses these to retry on the family's stable alias when a caller-pinned snapshot returns
`not_found_error` — the second line of defence behind keeping every caller on `MODELS`.

**Why this belongs before §8:** the engine chosen HERE fixes which exposure filter applies —
Claude → blocklist `ORCHESTRATOR_BLOCKED_TOOLS`; OpenAI/Grok → whitelist `OPENAI_AGENT_TOOL_NAMES`;
Workers-AI DO → whitelist `WORKERS_AI_TOOLS`. A tool that works on one model and not another almost
always fails right here, not in the executor.

### 6.2 The `/chat` SSE contract — worker emits, frontend consumes (the two-sided allow-list)
The **same model flag as §6.1** also picks which of two frontend chat clients renders, over two
*different* protocols:
- `isWorkersAIModel(model)` **[AgentBuilder.tsx:135]** → `VegvisrAgentChat.tsx` — **NOT this contract.**
  It speaks the Cloudflare Agents SDK (`useAgent`/`useAgentChat`, AI-SDK message parts) to the
  `VegvisrAgent` DO; it never parses `event:`/`data:` frames.
- else **[AgentBuilder.tsx:140]** → `AgentChat.tsx` — the **only** raw `/chat` SSE consumer.

**Frame format** (`parseSSE` **[AgentChat.tsx:1124–1166]**): the worker writes named SSE frames
`event: <name>\ndata: <json>\n\n`; the client splits the byte stream on `\n`, reads the `event: `
line as the **type** and `data: ` as JSON. **The type comes from the `event:` line, NOT from a
`.type` field inside the JSON** — a frame emitted without an `event:` prefix is mis-typed. `done`
flips an internal `gotDone`; a stream ending without it is logged as a probable timeout **[:1163]**.

**The event catalogue is a two-sided allow-list** — every worker-emitted event must be in the
frontend `StreamEvent` union **[AgentChat.tsx:89]** or it is silently dropped; a UI branch on an
event the worker never emits is dead code. Verified 1:1 today; the drift-check guards both directions.

| event | payload (worker) | frontend action | emit / handle |
|---|---|---|---|
| `agent_info` | `{avatarUrl,botName,botUsername}` | set agent avatar | agent-loop.js:977, index.js:1536 / AgentChat.tsx:2286 |
| `thinking` | `{turn}` | thinking indicator | :690,:983 / :2214 |
| `text` | `{content}` | append assistant text | both branches / :2204,:2264 |
| `tool_call` | `{tool,input}` | running tool card; auto-switch graph ctx from `input.graphId` | :783,:1310 / :2014,:2218 |
| `tool_progress` | `{tool,message}` | card progress + subagent banner | :785,:1313 / :2228 |
| `tool_result` | `{tool,success,summary}` **+ open capabilityPayload** | mark card; HTML preview / track graph+node / theme cards / audio | :822–845,:1361–1418 / :2027,:2247,:2296 |
| `suggestions` | `{suggestions:[]}` | set prompt suggestions | **:1196 (OpenAI/Grok ONLY)** / :2291 |
| `done` | `{turns,[error],[fastPath]}` | finalize turn (parseSSE, no switch case) | both+fast-path+bot / :1152,:2305 |
| `error` | `{error}` | clear thinking, show error | both branches / :2269 |

**Two asymmetries (same class as §8 tool exposure, on the wire instead of the toolbox):**
1. **`suggestions` is emitted only on the OpenAI/Grok branch** **[agent-loop.js:1196]** — a Claude chat
   never populates the suggestion UI. The handler exists; the emit doesn't.
2. **`tool_result` is an OPEN contract via `capabilityPayload`** (`Object.assign` **[agent-loop.js:825,:1364]**):
   `nodeId,graphId,html,updatedHtml,audioUrl,recordingId,language,saveToGraph,graphTitle,templates,
   clientSideRequired,themeOptions` ride it. A new capability field is invisible until `AgentChat.tsx`
   renders it — the frontend mirror of §8's "invisible until added".

Also: `AgentChat` has a non-SSE Ollama branch **[:1942]**; `@bot` mentions POST `/bot-chat` through the
same `parseSSE` **[:1958]** — same catalogue.

### 6.3 The Workers-AI engine — `VegvisrAgent` Durable Object + its Agents-SDK client
The OTHER chat path (Workers-AI models, §6.1) — **twin of §6.2, different wire.** No named-SSE here:
the Cloudflare Agents SDK owns the transport, so there is no hand-rolled event allow-list to drift.

**The Durable Object** `VegvisrAgent extends AIChatAgent` **[agent.js:249]** (`@cloudflare/ai-chat`):
- **One instance per `userId`**, reached at `agent.vegvisr.org/agents/VegvisrAgent/{userId}`; `userId = this.name`
  **[agent.js:267]**. Entry is `routeAgentRequest` **[index.js:190–191]** (WebSocket/HTTP), NOT `/chat`.
- **State:** conversation history is **SQLite-backed `this.messages`**, persisted automatically by the base
  class **[agent.js:262,:304]** (WebSocket transport + DO hibernation). Plus in-memory `this.authContext`
  set in `onConnect` via `resolveAuthorizedCaller` **[agent.js:252–257]**. History is wiped by the client
  calling `clearHistory()` on model change **[VegvisrAgentChat.tsx:1466]** — the only state reset.
- **`onChatMessage`** **[agent.js:259]** builds the loop: model = `body.model || env.DEFAULT_MODEL ||
  '@cf/meta/llama-4-scout-17b-16e-instruct'` **[:260]**; `currentGraphId = body.graphId` **[:261]**;
  `streamText({… stopWhen: stepCountIs(5), maxTokens: 2048 …})` **[:300–309]** — the Workers-AI turn bound
  is **5 steps** (vs Claude 8 / OpenAI 6, §6.1). Returns `result.toUIMessageStreamResponse()` **[:338]** —
  an **AI-SDK UI Message Stream**, the client contract.

**Four Workers-AI-specific adaptations** (why this path needs its own code, not just a model swap):
1. **Whitelist** — `buildTools` iterates `TOOL_DEFINITIONS` and skips anything not in `WORKERS_AI_TOOLS`
   (53) **[agent.js:218–221]**; same `executeTool` as every engine **[:230]**. (This is the §8 whitelist.)
2. **`relaxJsonSchema`** **[agent.js:158]** — Workers-AI models emit numbers/booleans as strings, so schemas
   are widened (`number|integer → ['number','string']`, `boolean → ['boolean','string']`, objects get
   `additionalProperties`) or tool calls reject valid input.
3. **`normalizeToolArgs`** **[agent.js:182]** — snake_case→camelCase (`graph_id→graphId`), `create_node`/
   `patch_node` field shaping, and **auto-injects `currentGraphId`** for `GRAPH_AWARE_TOOLS` when the model
   omits or hallucinates the id **[:203–213]**.
4. **`simulateStreamingMiddleware`** **[agent.js:282–285]** — **L59:** Workers-AI surfaces `tool_calls` only
   via the non-streaming `doGenerate`; the middleware makes `doStream` call `doGenerate` underneath so tools
   fire (else they leak as hallucinated text). Trade-off: the reply arrives as a block, not token-by-token.

**The client** (`VegvisrAgentChat.tsx`): `useAgent({agent:'vegvisr-agent', name:userId, host:'agent.vegvisr.org'})`
**[:1435]** + `useAgentChat({ body: () => ({model, graphId, authToken}), onToolCall })` **[:1441]**. It renders
AI-SDK message parts via `isToolUIPart`/`isTextUIPart`/`getToolName` **[:16]** — NOT `event:`/`data:` frames.
`onToolCall` runs one **client-side** tool `getUserTimezone` **[:1448]** (not in `WORKERS_AI_TOOLS`; executed
in the browser, not the DO).

**Downstream contract:** on finish the DO writes one row to `env.STATS_DB.sessions` **[agent.js:324–334]**
(`version_note='Workers AI AIChatAgent'`, `version='v-wai-1'`) — a partial view of the `sessions` schema
(cols: `id,user_id,started_at,ended_at,duration_ms,turns,fast_path,model,input_tokens,output_tokens,
tool_calls,success,agent_id,version,version_note,cost_usd`); the full D1 schema is still a separate slice.

## 7. Deployment View
- **Frontend SPA → Cloudflare Pages via `git push`** (production branch). NOT a wrangler worker.
- **`agent-worker` + all workers → `wrangler deploy`.** A git push does NOT ship a worker.
- `wrangler.toml` gitignored. (L35.)
- **[NOT YET MAPPED]** full binding inventory + which secrets each path needs (partial in `wrangler.toml`).

## 8. Crosscutting Concepts — **THE TOOL LIFECYCLE** (read this before adding/changing a tool)

### 8.1 Exposure is ASYMMETRIC — the #1 error source
A request hits exactly one engine, and each gates the toolbox differently:

| Surface | Gating | File | Effect of a NEW tool |
|---|---|---|---|
| Claude path | **BLOCKLIST** `ORCHESTRATOR_BLOCKED_TOOLS` (38) | agent-loop.js:228, filter :244 | **Auto-exposed** unless blocked |
| OpenAI/Grok | **WHITELIST** `OPENAI_AGENT_TOOL_NAMES` (121) | agent-loop.js:106, filter :671 | **Invisible until added** |
| Workers-AI | **WHITELIST** `WORKERS_AI_TOOLS` (53) | agent.js:81, filter :220 | **Invisible until added** |
| Locked context | `EXCLUSIVE_CONTEXTS` (keys: `Cloudflare MCP Server`) | index.js:1636 | **Uncallable unless listed** |
| Per user-agent | D1 `agent_configs.tools` JSON → `toolFilter` (schema §5.2) | index.js:1624 | Only if that agent's list includes it (data, not code) |
| Subagents | `*_TOOL_NAMES` per subagent | kg/html-builder/chat/bot/contact/album/agent-builder/video-subagent.js | Only inside that sub-loop if added |

### 8.2 Checklist — to add a tool so it is reachable everywhere
1. `TOOL_DEFINITIONS` (tool-definitions.js) — the schema `{name, description, input_schema}`.
2. `executeTool` dispatch `case` (tool-executors.js).
3. `WORKERS_AI_TOOLS` (agent.js) — else invisible on Workers-AI models.
4. `OPENAI_AGENT_TOOL_NAMES` (agent-loop.js) — else invisible on `openai/*` and `grok/*` models.
5. `EXCLUSIVE_CONTEXTS[<context>]` (index.js) — only if it must work inside that locked context.
6. `SEQUENTIAL_TOOLS` (agent-loop.js:168) — **only if it mutates a KG node/graph** (concurrency guard).
7. The relevant subagent `*_TOOL_NAMES` — only if callable inside that sub-loop.
8. A user-agent's `agent_configs.tools` in D1 — data change, only if that agent should have it.
- Verify with `node scripts/doc-drift-check.mjs <toolName>` — it prints reachability across all surfaces.
- *Counter-example (2026-08-02):* `run_cloudflare_selftest` was added to 1,2,3,4 but not 5 →
  still uncallable in the `Cloudflare MCP Server` context. That is the class of miss this section exists to kill.

### 8.3 Downstream contracts
- **KG graph-id:** a NEW graph MUST have a UUID v4 (the KG worker rejects non-UUID new ids). `create_graph`
  always mints `crypto.randomUUID()` **[tool-executors.js:127]**; any tool that writes its own graph must
  send a UUID (a human-readable id 400s on first create).
- **Service bindings:** `env.<WORKER>.fetch('https://<worker-name>/…')`, never public URLs (L37).
- **Owner gating:** `assertMcpOwner(input, env, what)` **[tool-executors.js:9947]** = `PLATFORM_OWNER_EMAIL`
  + role `Superadmin`; fail-closed via `isReadOnlyMcpTool` (only `_list`/`_get`/`search_`/… open to non-owners).

### 8.4 Dynamic (registry-driven) tools — the `default:` dispatch path
Not every tool is hardcoded. A worker registered in `graph_system_registry` has its whole OpenAPI
surface turned into tools at runtime — **no `TOOL_DEFINITIONS` entry, no `case`** (`openapi-tools.js`).

1. **Register:** `register_capability_worker` **[tool-executors.js:8567]** adds a worker node to
   `graph_system_registry` (metadata `binding`, `tool_prefix`, `openapi_url`) and calls `clearOpenAPICache()`.
2. **Load & convert:** `loadAllTools` **[agent-loop.js:210]** = `TOOL_DEFINITIONS` + `loadOpenAPITools(env)`
   **[openapi-tools.js:259]**, which walks the registry, fetches each worker's `/openapi.json`, and
   `operationToTool` **[:95]** converts each `operationId` operation into a Claude tool def prefixed by
   `metadata.tool_prefix` (e.g. `kg_`). Returns `{tools, operationMap}` where `operationMap[name]=execMeta`
   (binding+method+path). **5-min in-isolate cache** **[:261]**; names in `DEFAULT_KG_BLOCKLIST` /
   `metadata.tool_blocklist` are dropped to avoid duplicating hardcoded tools **[:267]**; an empty walk
   falls back to a direct KG fetch with `kg_` prefix **[:256]**.
3. **Offer:** `allTools = [...TOOL_DEFINITIONS−blocklist, ...dynamicTools, ...PROFF_TOOLS]` **[agent-loop.js:251]**;
   `operationMap` is threaded through the loop **[:670,:935,:1531]**.
4. **Dispatch:** a dynamic tool has NO `case`; it falls to `executeTool`'s `default:` **[tool-executors.js:11829]**
   → `isOpenAPITool(name, operationMap)` **[openapi-tools.js:479]** → `executeOpenAPITool` **[:391]**, which
   routes to the worker via its binding using `execMeta`. This is the mirror of §8.2: **a definition with
   no `case`, resolved at runtime**, rather than a `case` with no definition.

**3-way exposure asymmetry (extends §8.1) — dynamic tools are effectively Claude-only:**
- **Claude:** `loadAllTools` includes `dynamicTools`; the blocklist is name-based so prefixed tools pass → **offered.**
- **OpenAI/Grok:** the path filters `allTools` by the static `OPENAI_AGENT_TOOLS` whitelist **[agent-loop.js:671]**;
  a prefixed dynamic name is never in it → **filtered out.** (The system prompt even tells the model to
  "switch to a Claude model for the full orchestrator toolbox" **[:679]**.)
- **Workers-AI:** the DO never calls `loadOpenAPITools` (builds from `TOOL_DEFINITIONS` only, §6.3) → **absent.**

Note: the drift-check's `dispatch case but no definition` (3: `get_html_template`, `search_knowledge`,
`translate`) are NOT these — they are subagent-scoped/legacy **named** cases (e.g. bot-subagent tools
[bot-subagent.js:58]), dispatched through the shared switch. Dynamic OpenAPI tools are the opposite:
definitions with no case, via `default:`.

### 8.5 Authentication & authorization — identity → `authContext` → owner gate
Every entry (SSE `/chat`, the DO, the REST routes) resolves the caller to one `authContext`
`{authenticated, authToken, session, profile, userId, email, role}` before doing work. `auth.js` is the
single resolver; `EMPTY_AUTH_CONTEXT` is the unauthenticated shape **[agent.js:149]**.

**Two credential channels, one resolver** (`resolveAuthorizedCallerWithCredentials` **[auth.js:113]**):
1. **Session (SSO):** cookie or `Authorization: Bearer <session>` → `resolveAuthenticatedSession…` GETs
   `https://auth.vegvisr.org/auth/openauth/session` **[auth.js:89]** → `{subject{id,email,role}}`.
2. **Direct token:** `authToken` (or a Bearer) matched against `config.emailVerificationToken`
   **[auth.js:74–82]** — the same token the frontend stores (below) and the X-API-Token dev pattern.

Precedence: **session first, then token, then unauthenticated** **[auth.js:122,:136,:153]**. Either way the
identity is enriched from D1 `config` via `resolveUserProfileByIdentity` **[auth.js:54]**; `config` is the
user/role source of truth (§5.2).

**Enforcement** — every route uses the same token-first-else-request resolve (index.js:275,338,356,373,
407,460,1473,1590; DO agent.js:252 `onConnect`, :268 `onChatMessage`), then
`effectiveUserId = authContext.userId || userId` **[index.js:1476]**.

**Authorization — owner gate.** `assertMcpOwner(input, env, what)` **[tool-executors.js:9947]** restricts
account-mutating tools to `PLATFORM_OWNER_EMAIL` (default `torarnehave@gmail.com`) + role Superadmin —
guards MCP `execute` **[:10022]**, `cloudflare_pages_deploy` **[:12499]**, `run_cloudflare_selftest`
**[:9699]**. `isReadOnlyMcpTool` **[:9936]** lets read-only MCP tools bypass it (fail-open for reads,
fail-closed for writes — the §8.3 split).

**Frontend gate** (`App.tsx`): `authStatus: 'checking'|'authed'|'anonymous'` **[:18]**. A `?magic=<token>`
param → `verifyMagicToken` GETs `${MAGIC_BASE}/login/magic/verify` **[:120]**; the sign-in form POSTs
`/login/magic/send` **[:149]**. On success the user (incl. `emailVerificationToken`) is stored in
`localStorage` **[:76]** and mirrored to a `vegvisr_token` cookie **[:49,:78]**; that `emailVerificationToken`
is exactly what the chat clients send as `authToken` — closing the loop to channel 2.

## 9. Architecture Decisions (why)
- **Claude = blocklist, others = whitelist.** Claude is trusted with the full toolbox; the weaker/other
  paths are curated. (Cost/reliability tradeoff — see audit BE-02 "tool registry consolidation".)
- **`EXCLUSIVE_CONTEXTS`** deliberately hard-locks certain UI contexts to a minimal toolset (spoofing the
  title can only REMOVE capability, so it needs no auth) **[index.js:1629–1635]**.

## 10. Quality Scenarios & 11. Risks
See the audit graph `ba0d92cd` (ISO-25010/ATAM findings CH/BE/XM/FE/DOC + risk register). This reference
does not duplicate them; it is the "how it works" companion to that "how healthy is it" snapshot.

## 12. Glossary
- **Engine** — one of the two runtime loops (Workers-AI DO vs streamingAgentLoop).
- **Exposure filter** — a whitelist/blocklist/context-lock deciding which tools reach the model.
- **Subagent** — a delegated sub-loop with its own tool whitelist, reached via a `delegate_to_*` tool.
- **Drift-check** — `scripts/doc-drift-check.mjs`; extracts the load-bearing inventory from source.

---

### Verified inventory snapshot (drift-check, 2026-08-03)
TOOL_DEFINITIONS 214 · dispatch cases 217 · WORKERS_AI_TOOLS 53 · OPENAI_AGENT_TOOL_NAMES 121 ·
ORCHESTRATOR_BLOCKED_TOOLS 38 · SEQUENTIAL_TOOLS 55 · EXCLUSIVE_CONTEXTS: `Cloudflare MCP Server` ·
subagents: kg 12, html-builder 26, chat 18, bot 6, contact 5, album 11, agent-builder 7, video 7 ·
coherence: 0 tools defined-without-dispatch ·
MODELS (models.js): `claude-haiku-4-5-20251001` `claude-sonnet-4-6` `claude-opus-4-8` `claude-fable-5` ·
SSE events (worker↔AgentChat, 1:1): `agent_info` `thinking` `text` `tool_call` `tool_progress`
`tool_result` `suggestions` `done` `error` ·
Re-verify: `node scripts/doc-drift-check.mjs`.

### Still to map (before this reference is "complete")
detailed SSE error-recovery/timeout semantics · `chat_bots`/CHAT_DB/CALENDAR_DB full DDL. Each is a
separate mapping slice, verified against code. (Model routing & fallback → §6.1; SSE event contract +
frontend consumer → §6.2; Workers-AI DO + Agents-SDK client → §6.3; D1 bindings + `agent_configs`/`config`/
`sessions` schema → §5.2; dynamic registry-driven tools → §8.4; auth magic-link + session → §8.5.)
