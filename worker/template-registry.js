/**
 * Template Registry — maps template IDs to HTML template constants.
 *
 * Each template entry has:
 *   id            – unique string (matches <meta name="template-id"> in the HTML)
 *   template      – the full HTML template string
 *   description   – human-readable summary for agent/UI
 *   placeholders  – { placeholder: description } so agents know what to fill
 */

import { EDITABLE_HTML_TEMPLATE } from './editable-template.js'
import { THEME_BUILDER_TEMPLATE } from './theme-builder-template.js'
import { LANDING_PAGE_TEMPLATE } from './landing-page-template.js'
import { AGENT_CHAT_TEMPLATE } from './agent-chat-template.js'

const TEMPLATES = {
  'editable-page': {
    id: 'editable-page',
    template: EDITABLE_HTML_TEMPLATE,
    description: 'Full-featured editable HTML page with navigation, markdown rendering, and edit mode.',
    placeholders: {
      '{{TITLE}}': 'Page title (in <title>, h1, and img alt)',
      '{{DESCRIPTION}}': 'Page description/subtitle shown below the title',
      '{{HEADER_IMAGE}}': 'URL for the header image',
      '{{FOOTER_TEXT}}': 'Footer text content',
      '{{GRAPH_ID_DEFAULT}}': 'Fallback graph ID',
    },
  },
  'theme-builder': {
    id: 'theme-builder',
    template: THEME_BUILDER_TEMPLATE,
    description: 'CSS variable/design token editor. Loads css-nodes from a knowledge graph, provides visual editing with color pickers, and saves back to KG.',
    placeholders: {
      '{{TITLE}}': 'Theme name / page title',
      '{{DESCRIPTION}}': 'Theme description',
      '{{GRAPH_ID_DEFAULT}}': 'Fallback graph ID for loading theme data',
    },
  },
  'landing-page': {
    id: 'landing-page',
    template: LANDING_PAGE_TEMPLATE,
    description: 'Single-page landing layout that renders all graph nodes as scrollable sections with sticky navigation.',
    placeholders: {
      '{{TITLE}}': 'Page title shown in hero section',
      '{{DESCRIPTION}}': 'Subtitle/tagline shown below the title',
      '{{FOOTER_TEXT}}': 'Footer text content',
      '{{GRAPH_ID_DEFAULT}}': 'Fallback graph ID for loading content',
    },
  },
  'agent-chat': {
    id: 'agent-chat',
    template: AGENT_CHAT_TEMPLATE,
    description: 'Conversational AI chat interface with real-time tool execution and streaming responses.',
    placeholders: {
      '{{TITLE}}': 'Chat title',
      '{{GRAPH_ID_DEFAULT}}': 'Default graph context',
    },
  },
}

const DEFAULT_TEMPLATE_ID = 'editable-page'

/**
 * Get a template entry by ID. Returns the default template if ID is unknown.
 */
export function getTemplate(templateId) {
  return TEMPLATES[templateId] || TEMPLATES[DEFAULT_TEMPLATE_ID]
}

/**
 * Extract the version string from a template's <meta name="template-version"> tag.
 */
export function getTemplateVersion(templateId) {
  const entry = getTemplate(templateId)
  const match = entry.template.match(/<meta\s+name="template-version"\s+content="([^"]+)"/)
  return match ? match[1] : 'unknown'
}

/**
 * Read the template-id from an existing HTML string.
 * Returns DEFAULT_TEMPLATE_ID when the tag is missing (backward compat for old nodes).
 */
export function extractTemplateId(html) {
  const match = (html || '').match(/<meta\s+name="template-id"\s+content="([^"]+)"/)
  return match ? match[1] : DEFAULT_TEMPLATE_ID
}

/**
 * List all registered templates with metadata (for API / UI consumption).
 */
export function listTemplates() {
  return Object.values(TEMPLATES).map(t => ({
    id: t.id,
    description: t.description,
    version: getTemplateVersion(t.id),
    placeholders: t.placeholders,
  }))
}

export { DEFAULT_TEMPLATE_ID }
