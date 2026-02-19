/**
 * Tool Executor for Agent Builder
 * Implements the actual execution of tools by calling Knowledge Graph API endpoints
 */

export interface ToolExecutionContext {
  userId: string;
  endpointBase?: string;
}

export interface ToolExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
}

const DEFAULT_ENDPOINT = 'https://knowledge.vegvisr.org';

/**
 * Execute create_graph tool
 */
export async function executeCreateGraph(
  input: {
    graphId: string;
    title: string;
    description?: string;
    tags?: string[];
  },
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const endpoint = context.endpointBase || DEFAULT_ENDPOINT;

  try {
    const response = await fetch(`${endpoint}/saveGraphWithHistory`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        graphId: input.graphId,
        data: {
          nodes: [],
          edges: []
        },
        userId: context.userId,
        metadata: {
          title: input.title,
          description: input.description || '',
          created: new Date().toISOString(),
          tags: input.tags || []
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `API error: ${response.status} - ${errorText}`
      };
    }

    const data = await response.json();
    return {
      success: true,
      data: {
        graphId: data.graphId || input.graphId,
        version: data.version || 1,
        message: `Graph "${input.title}" created successfully`,
        viewUrl: `https://www.vegvisr.org/gnew-viewer?graphId=${input.graphId}`
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Execute create_html_node tool
 */
export async function executeCreateHtmlNode(
  input: {
    graphId: string;
    nodeId: string;
    label: string;
    htmlContent: string;
    references?: string[];
  },
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const endpoint = context.endpointBase || DEFAULT_ENDPOINT;

  try {
    const response = await fetch(`${endpoint}/addNode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        graphId: input.graphId,
        node: {
          id: input.nodeId,
          label: input.label,
          type: 'html-node',
          info: input.htmlContent,
          bibl: input.references || []
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `API error: ${response.status} - ${errorText}`
      };
    }

    const data = await response.json();
    return {
      success: true,
      data: {
        graphId: input.graphId,
        nodeId: input.nodeId,
        version: data.newVersion,
        message: `HTML node "${input.label}" added successfully`
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Main tool executor - routes tool calls to appropriate handlers
 */
export async function executeTool(
  toolName: string,
  toolInput: any,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  switch (toolName) {
    case 'create_graph':
      return executeCreateGraph(toolInput, context);

    case 'create_html_node':
      return executeCreateHtmlNode(toolInput, context);

    default:
      return {
        success: false,
        error: `Unknown tool: ${toolName}`
      };
  }
}

/**
 * Format tool result for Claude API
 * Converts our ToolExecutionResult to the format expected by the Claude API
 */
export function formatToolResultForClaude(result: ToolExecutionResult): string {
  if (result.success) {
    return JSON.stringify(result.data, null, 2);
  } else {
    return JSON.stringify({
      error: result.error
    }, null, 2);
  }
}
