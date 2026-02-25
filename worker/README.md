# Agent Worker

Cloudflare Worker that executes autonomous agents with Knowledge Graph tools.

## Architecture

```
User Request
    ↓
Agent Worker (/execute)
    ↓
    ├─→ Anthropic Worker (service binding)
    │   └─→ Gets encrypted API key from D1
    │   └─→ Calls Anthropic API
    │   └─→ Returns Claude response
    ↓
Execute Tools (create_graph, create_html_node)
    ↓
Knowledge Graph API (knowledge.vegvisr.org)
```

## Service Binding

The agent-worker uses a **service binding** to anthropic-worker:
- **No direct API key needed** in agent-worker
- **userId-based encryption** - Each user's API key is encrypted in D1
- **Secure** - Keys never exposed to client or agent-worker

## Endpoints

### POST /execute

Execute an agent with a task.

**Request:**
```json
{
  "agentId": "agent_kg_researcher",
  "task": "Create a knowledge graph about TypeScript best practices",
  "userId": "ca3d9d93-3b02-4e49-a4ee-43552ec4ca2b"
}
```

**Response:**
```json
{
  "success": true,
  "turns": 4,
  "executionLog": [
    {
      "turn": 1,
      "type": "agent_thinking",
      "timestamp": "2026-02-19T..."
    },
    {
      "turn": 1,
      "type": "tool_calls",
      "tools": [
        {
          "name": "create_graph",
          "input": {
            "graphId": "graph_typescript_best_practices",
            "title": "TypeScript Best Practices"
          }
        }
      ]
    },
    {
      "turn": 1,
      "type": "tool_result",
      "tool": "create_graph",
      "success": true,
      "result": {
        "graphId": "graph_typescript_best_practices",
        "version": 1,
        "viewUrl": "https://www.vegvisr.org/gnew-viewer?graphId=..."
      }
    },
    {
      "turn": 2,
      "type": "tool_calls",
      "tools": [
        {
          "name": "create_html_node",
          "input": {
            "graphId": "graph_typescript_best_practices",
            "nodeId": "node-code-example",
            "label": "Code Example",
            "htmlContent": "<pre><code>...</code></pre>"
          }
        }
      ]
    },
    {
      "turn": 4,
      "type": "agent_complete",
      "response": "I've created a knowledge graph about TypeScript best practices with code examples. View it at: https://www.vegvisr.org/gnew-viewer?graphId=graph_typescript_best_practices"
    }
  ]
}
```

### GET /health

Health check.

**Response:**
```json
{
  "status": "healthy",
  "worker": "agent-worker",
  "timestamp": "2026-02-19T..."
}
```

## Available Tools

The agent can use these tools:

1. **create_graph** - Create a new knowledge graph
2. **create_html_node** - Add HTML node to graph

## Deployment

```bash
cd /Users/torarnehave/Documents/GitHub/Agent-Builder/worker
wrangler deploy
```

**Requirements:**
- anthropic-worker must be deployed first
- Service binding automatically connects to anthropic-worker
- D1 database vegvisr_org must exist
- agent_configs table must exist (see migrations)

## Environment

Configured in `wrangler.toml`:
- `ANTHROPIC` service binding → anthropic-worker
- `DB` D1 binding → vegvisr_org database
- `KG_ENDPOINT_BASE` → https://knowledge.vegvisr.org

## How It Works

1. **Agent Config Retrieval**
   - Query D1 for agent config by `agentId`
   - Load system_prompt, model, temperature, etc.

2. **Agent Loop**
   - Send task + tools to anthropic-worker via service binding
   - anthropic-worker gets encrypted API key using `userId`
   - Claude decides which tools to use
   - Agent-worker executes tools (calls KG API)
   - Results fed back to Claude
   - Loop continues until agent completes task

3. **Tool Execution**
   - `create_graph` → calls `/saveGraphWithHistory`
   - `create_html_node` → calls `/addNode` with type `html-node`
   - Results returned to agent loop

## Example Usage

```bash
# Create agent config first (in D1)
# Then execute:

curl -X POST https://agent.vegvisr.org/execute \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "agent_kg_researcher",
    "task": "Create a knowledge graph about Claude Agents SDK",
    "userId": "ca3d9d93-3b02-4e49-a4ee-43552ec4ca2b"
  }'
```

## Next Steps

Add more tools:
- `create_fulltext_node`
- `create_mermaid_node`
- `link_nodes`
- `update_node`
