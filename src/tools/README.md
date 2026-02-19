# Agent Builder Tools

This directory contains tool definitions and executors for the Agent Builder app.

## Overview

Tools allow agents to interact with external systems. Each tool has:
1. **Definition** - Schema that tells Claude what the tool does and what inputs it needs
2. **Executor** - Implementation that actually performs the action

## Available Tools

### `create_graph`

Creates a new knowledge graph.

**Inputs:**
- `graphId` (required) - Unique identifier like "graph_my_topic"
- `title` (required) - Human-readable title
- `description` (optional) - Detailed description
- `tags` (optional) - Array of tags for categorization

**Returns:**
```json
{
  "graphId": "graph_my_topic",
  "version": 1,
  "message": "Graph created successfully",
  "viewUrl": "https://www.vegvisr.org/gnew-viewer?graphId=graph_my_topic"
}
```

### `create_html_node`

Adds an HTML node to a knowledge graph.

**Inputs:**
- `graphId` (required) - The graph to add the node to
- `nodeId` (required) - Unique identifier like "node-example-code"
- `label` (required) - Title for the node
- `htmlContent` (required) - HTML content (divs, code blocks, tables, etc.)
- `references` (optional) - Array of bibliography references

**Returns:**
```json
{
  "graphId": "graph_my_topic",
  "nodeId": "node-example-code",
  "version": 2,
  "message": "HTML node added successfully"
}
```

## Usage

### In Agent Configuration

Tools are registered in the agent's configuration (stored in D1):

```typescript
const agentConfig = {
  id: 'agent_kg_builder',
  name: 'Knowledge Graph Builder',
  system_prompt: 'You build knowledge graphs...',
  model: 'claude-sonnet-4-5',
  tools: [
    {
      name: 'create_graph',
      description: 'Create a new knowledge graph with metadata',
      input_schema: { ... }
    },
    {
      name: 'create_html_node',
      description: 'Add an HTML node to the knowledge graph',
      input_schema: { ... }
    }
  ]
};
```

### In Agent Execution Loop

```typescript
import { getAllTools, executeTool } from './tools';

// Get all tool definitions
const tools = getAllTools();

// Call Claude API with tools
const response = await client.messages.create({
  model: 'claude-sonnet-4-5',
  tools: tools,
  messages: messages
});

// Execute tools when agent requests them
if (response.stop_reason === 'tool_use') {
  for (const toolUse of response.content) {
    if (toolUse.type === 'tool_use') {
      const result = await executeTool(
        toolUse.name,
        toolUse.input,
        { userId: 'user_id' }
      );
    }
  }
}
```

## Adding New Tools

1. **Define the tool** in `toolDefinitions.ts`:
```typescript
export const myNewTool: ToolDefinition = {
  name: 'my_new_tool',
  description: 'What this tool does',
  input_schema: {
    type: 'object',
    properties: {
      param1: { type: 'string', description: '...' }
    },
    required: ['param1']
  }
};
```

2. **Implement the executor** in `toolExecutor.ts`:
```typescript
export async function executeMyNewTool(
  input: { param1: string },
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  // Implementation here
  return { success: true, data: { ... } };
}
```

3. **Register in the switch** in `executeTool()`:
```typescript
case 'my_new_tool':
  return executeMyNewTool(toolInput, context);
```

4. **Add to registry** in `toolDefinitions.ts`:
```typescript
export const toolRegistry = {
  // ...
  my_new_tool: myNewTool
};
```

## Testing

Run the example:
```bash
export ANTHROPIC_API_KEY="your-key"
npm run dev -- --run tools/example
```

## Architecture

```
┌─────────────────┐
│  Claude Agent   │
│  (Makes LLM     │
│   calls with    │
│   tool schemas) │
└────────┬────────┘
         │
         │ tool_use request
         ▼
┌─────────────────┐
│ Tool Executor   │
│ - Routes to     │
│   handler       │
│ - Calls KG API  │
│ - Returns result│
└────────┬────────┘
         │
         │ HTTP POST
         ▼
┌─────────────────┐
│ Knowledge Graph │
│ Worker Endpoint │
│ (knowledge.     │
│  vegvisr.org)   │
└─────────────────┘
```

## Next Steps

Add more tools:
- `create_fulltext_node` - Add text documentation nodes
- `create_mermaid_node` - Add diagram nodes
- `link_nodes` - Create edges between nodes
- `update_node` - Modify existing nodes
- `search_graph` - Query graph content
