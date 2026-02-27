/**
 * Static catalog of all agent tools — extracted from worker/tool-definitions.js
 * Used by the Contract Canvas to display tools as visual nodes.
 */

export interface ToolCatalogEntry {
  name: string
  displayName: string
  description: string
}

export const TOOL_CATALOG: ToolCatalogEntry[] = [
  { name: 'create_graph', displayName: 'Create Graph', description: 'Create a new knowledge graph' },
  { name: 'create_node', displayName: 'Create Node', description: 'Add any node type to a graph' },
  { name: 'create_html_node', displayName: 'Create HTML Node', description: 'Create a custom HTML app/page' },
  { name: 'add_edge', displayName: 'Add Edge', description: 'Connect two nodes with an edge' },
  { name: 'get_contract', displayName: 'Get Contract', description: 'Retrieve a content generation contract' },
  { name: 'create_html_from_template', displayName: 'Create From Template', description: 'Create HTML from predefined template' },
  { name: 'read_graph', displayName: 'Read Graph', description: 'Read graph metadata and nodes' },
  { name: 'read_node', displayName: 'Read Node', description: 'Read a single node in full' },
  { name: 'patch_node', displayName: 'Patch Node', description: 'Update fields on an existing node' },
  { name: 'list_graphs', displayName: 'List Graphs', description: 'List graphs with summaries' },
  { name: 'list_meta_areas', displayName: 'List Meta Areas', description: 'List all meta areas and categories' },
  { name: 'perplexity_search', displayName: 'Perplexity Search', description: 'Deep web search with citations' },
  { name: 'search_pexels', displayName: 'Search Pexels', description: 'Search free stock photos (Pexels)' },
  { name: 'search_unsplash', displayName: 'Search Unsplash', description: 'Search free stock photos (Unsplash)' },
  { name: 'get_album_images', displayName: 'Get Album Images', description: 'Get images from a photo album' },
  { name: 'get_formatting_reference', displayName: 'Formatting Reference', description: 'Get fulltext formatting syntax' },
  { name: 'get_node_types_reference', displayName: 'Node Types Reference', description: 'Get node type data formats' },
  { name: 'who_am_i', displayName: 'Who Am I', description: 'Get current user profile information' },
  { name: 'list_recordings', displayName: 'List Recordings', description: 'Browse audio portfolio recordings' },
  { name: 'transcribe_audio', displayName: 'Transcribe Audio', description: 'Transcribe audio from portfolio or URL' },
  { name: 'analyze_node', displayName: 'Analyze Node', description: 'Semantic analysis of a single node' },
  { name: 'analyze_graph', displayName: 'Analyze Graph', description: 'Full graph semantic analysis' },
]
