/**
 * Tool Definitions for Agent Builder
 * These define the schemas that agents use to interact with the Knowledge Graph API
 */

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required: string[];
  };
}

/**
 * Tool: create_graph
 * Creates a new knowledge graph with metadata
 */
export const createGraphTool: ToolDefinition = {
  name: 'create_graph',
  description: 'Create a new knowledge graph with metadata. Returns the graph ID and initial version.',
  input_schema: {
    type: 'object',
    properties: {
      graphId: {
        type: 'string',
        description: 'Unique identifier for the graph (e.g., "graph_my_topic")'
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
      }
    },
    required: ['graphId', 'title']
  }
};

/**
 * Tool: create_html_node
 * Creates an HTML node in the knowledge graph
 */
export const createHtmlNodeTool: ToolDefinition = {
  name: 'create_html_node',
  description: 'Add an HTML node to the knowledge graph. Use this for interactive content, code examples with syntax highlighting, or custom visualizations.',
  input_schema: {
    type: 'object',
    properties: {
      graphId: {
        type: 'string',
        description: 'The ID of the graph to add this node to'
      },
      nodeId: {
        type: 'string',
        description: 'Unique identifier for this node (e.g., "node-example-code")'
      },
      label: {
        type: 'string',
        description: 'Title/label for this node'
      },
      htmlContent: {
        type: 'string',
        description: 'HTML content for the node. Can include divs, code blocks, tables, etc. The system will inject GRAPH_ID and NODE_ID into the content.'
      },
      references: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional bibliography/references for this node'
      }
    },
    required: ['graphId', 'nodeId', 'label', 'htmlContent']
  }
};

/**
 * Registry of all available tools
 */
export const toolRegistry: Record<string, ToolDefinition> = {
  create_graph: createGraphTool,
  create_html_node: createHtmlNodeTool
};

/**
 * Get all tool definitions as an array (for Claude API)
 */
export function getAllTools(): ToolDefinition[] {
  return Object.values(toolRegistry);
}

/**
 * Get a specific tool definition by name
 */
export function getTool(name: string): ToolDefinition | undefined {
  return toolRegistry[name];
}
