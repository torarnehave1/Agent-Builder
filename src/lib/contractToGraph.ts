/**
 * Convert contract JSON ↔ React Flow nodes/edges
 * "The contract IS the graph"
 */
import type { Node, Edge } from '@xyflow/react';
import type { AgentContract } from '../types/contract';
import { TOOL_CATALOG } from './toolCatalog';

// Node data types for custom nodes
export interface ContractRootData { label: string; contractType: string; version?: string; [key: string]: unknown }
export interface CategoryData { label: string; description: string; color: string; [key: string]: unknown }
export interface TokenData { tokenKey: string; tokenValue: string; [key: string]: unknown }
export interface ToggleData { featureName: string; enabled: boolean; [key: string]: unknown }
export interface SectionData { sectionName: string; [key: string]: unknown }
export interface ToolNodeData { toolName: string; displayName: string; description: string; enabled: boolean; [key: string]: unknown }
export interface TemplateNodeData { templateId: string; templateName: string; category: string; [key: string]: unknown }

const POSITIONS = {
  root: { x: 400, y: 280 },
  css: { x: 80, y: 130 },
  features: { x: 80, y: 420 },
  content: { x: 620, y: 420 },
  validation: { x: 620, y: 130 },
  tools: { x: 1100, y: 130 },
  templates: { x: 1100, y: 420 },
};

/**
 * Convert a contract JSON into React Flow nodes and edges
 */
export function contractToReactFlow(
  contract: AgentContract,
  contractName: string = 'Untitled Contract',
  templates?: Array<{ id: string; name: string; category: string }>,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Root contract node
  nodes.push({
    id: 'contract-root',
    type: 'contractRoot',
    position: POSITIONS.root,
    data: {
      label: contractName,
      contractType: contract.type || 'html-node',
      version: contract.version || '1.0',
    } satisfies ContractRootData,
  });

  // CSS Design System category
  if (contract.node?.css) {
    const css = contract.node.css;
    nodes.push({
      id: 'cat-css',
      type: 'category',
      position: POSITIONS.css,
      data: {
        label: 'CSS Design System',
        description: [css.designSystem, css.borderRadius ? `radius: ${css.borderRadius}` : ''].filter(Boolean).join(', ') || 'custom',
        color: 'blue',
      } satisfies CategoryData,
    });
    edges.push({
      id: 'e-root-css',
      source: 'contract-root',
      target: 'cat-css',
      style: { stroke: 'rgba(124,58,237,0.4)', strokeWidth: 2 },
      animated: true,
    });

    // Color token child nodes — spread above the CSS category
    if (css.colorTokens) {
      const tokens = Object.entries(css.colorTokens);
      const startX = POSITIONS.css.x - 80;
      tokens.forEach(([key, value], i) => {
        const tokenId = `token-${key.replace(/[^a-zA-Z0-9]/g, '')}`;
        nodes.push({
          id: tokenId,
          type: 'token',
          position: { x: startX + i * 155, y: POSITIONS.css.y - 100 },
          data: { tokenKey: key, tokenValue: value } satisfies TokenData,
        });
        edges.push({
          id: `e-css-${tokenId}`,
          source: 'cat-css',
          target: tokenId,
          style: { stroke: 'rgba(59,130,246,0.3)', strokeWidth: 1.5 },
        });
      });
    }

    // Typography child — below-left of CSS category
    if (css.fontStack) {
      nodes.push({
        id: 'token-typography',
        type: 'token',
        position: { x: POSITIONS.css.x - 60, y: POSITIONS.css.y + 100 },
        data: { tokenKey: 'Typography', tokenValue: css.fontStack.split(',')[0].trim() } satisfies TokenData,
      });
      edges.push({
        id: 'e-css-typo',
        source: 'cat-css',
        target: 'token-typography',
        style: { stroke: 'rgba(59,130,246,0.3)', strokeWidth: 1.5 },
      });
    }

    // Effects child — below-right of CSS category
    if (css.borderRadius || css.designSystem) {
      nodes.push({
        id: 'token-effects',
        type: 'token',
        position: { x: POSITIONS.css.x + 160, y: POSITIONS.css.y + 100 },
        data: {
          tokenKey: 'Effects',
          tokenValue: [css.borderRadius ? `radius: ${css.borderRadius}` : '', css.designSystem ? css.designSystem : ''].filter(Boolean).join(', '),
        } satisfies TokenData,
      });
      edges.push({
        id: 'e-css-effects',
        source: 'cat-css',
        target: 'token-effects',
        style: { stroke: 'rgba(59,130,246,0.3)', strokeWidth: 1.5 },
      });
    }
  }

  // Features category
  if (contract.node?.features) {
    const features = contract.node.features;
    const enabledCount = Object.values(features).filter(Boolean).length;
    const totalCount = Object.keys(features).length;

    nodes.push({
      id: 'cat-features',
      type: 'category',
      position: POSITIONS.features,
      data: {
        label: 'Features',
        description: `${enabledCount}/${totalCount} enabled`,
        color: 'green',
      } satisfies CategoryData,
    });
    edges.push({
      id: 'e-root-features',
      source: 'contract-root',
      target: 'cat-features',
      style: { stroke: 'rgba(124,58,237,0.4)', strokeWidth: 2 },
      animated: true,
    });

    // Feature toggle child nodes — spread below the Features category
    let featureIndex = 0;
    for (const [key, value] of Object.entries(features)) {
      const featureId = `toggle-${key}`;
      nodes.push({
        id: featureId,
        type: 'toggle',
        position: {
          x: POSITIONS.features.x - 60 + (featureIndex % 2) * 170,
          y: POSITIONS.features.y + 90 + Math.floor(featureIndex / 2) * 65,
        },
        data: { featureName: key, enabled: value } satisfies ToggleData,
      });
      edges.push({
        id: `e-features-${key}`,
        source: 'cat-features',
        target: featureId,
        style: { stroke: 'rgba(34,197,94,0.3)', strokeWidth: 1.5 },
      });
      featureIndex++;
    }
  }

  // Content category
  if (contract.node?.content) {
    const content = contract.node.content;
    nodes.push({
      id: 'cat-content',
      type: 'category',
      position: POSITIONS.content,
      data: {
        label: 'Content',
        description: `${content.sections?.length || 0} sections, menu: ${content.menuMode || 'none'}`,
        color: 'blue',
      } satisfies CategoryData,
    });
    edges.push({
      id: 'e-root-content',
      source: 'contract-root',
      target: 'cat-content',
      style: { stroke: 'rgba(124,58,237,0.4)', strokeWidth: 2 },
      animated: true,
    });

    // Section child nodes — spread below/right of Content category
    if (content.sections) {
      content.sections.forEach((section, i) => {
        const sectionId = `section-${section}`;
        nodes.push({
          id: sectionId,
          type: 'section',
          position: { x: POSITIONS.content.x + 20 + i * 120, y: POSITIONS.content.y + 90 },
          data: { sectionName: section } satisfies SectionData,
        });
        edges.push({
          id: `e-content-${section}`,
          source: 'cat-content',
          target: sectionId,
          style: { stroke: 'rgba(59,130,246,0.3)', strokeWidth: 1.5 },
        });
      });
    }
  }

  // Validation category
  if (contract.node?.validation || contract.node?.safety) {
    const validation = contract.node?.validation;
    const safety = contract.node?.safety;

    nodes.push({
      id: 'cat-validation',
      type: 'category',
      position: POSITIONS.validation,
      data: {
        label: 'Validation',
        description: `${validation?.mustContain?.length || 0} rules, ${safety?.sanitizer || 'none'}`,
        color: 'green',
      } satisfies CategoryData,
    });
    edges.push({
      id: 'e-root-validation',
      source: 'contract-root',
      target: 'cat-validation',
      style: { stroke: 'rgba(124,58,237,0.4)', strokeWidth: 2 },
      animated: true,
    });

    // Safety child — above-right of Validation category
    if (safety) {
      nodes.push({
        id: 'token-safety',
        type: 'token',
        position: { x: POSITIONS.validation.x + 160, y: POSITIONS.validation.y - 80 },
        data: {
          tokenKey: 'Safety',
          tokenValue: [safety.sanitizer, safety.noExternalScripts ? 'no scripts' : ''].filter(Boolean).join(', '),
        } satisfies TokenData,
      });
      edges.push({
        id: 'e-validation-safety',
        source: 'cat-validation',
        target: 'token-safety',
        style: { stroke: 'rgba(34,197,94,0.3)', strokeWidth: 1.5 },
      });
    }

    // Required rules child — above-left of Validation category
    if (validation?.mustContain?.length) {
      nodes.push({
        id: 'token-required',
        type: 'token',
        position: { x: POSITIONS.validation.x - 40, y: POSITIONS.validation.y - 80 },
        data: {
          tokenKey: 'Required',
          tokenValue: validation.mustContain.map(r => r.replace(/[<>!/]/g, '')).join(', '),
        } satisfies TokenData,
      });
      edges.push({
        id: 'e-validation-required',
        source: 'cat-validation',
        target: 'token-required',
        style: { stroke: 'rgba(34,197,94,0.3)', strokeWidth: 1.5 },
      });
    }
  }

  // Tools category — always shown
  {
    const enabledTools = contract.tools?.enabled || [];
    const enabledCount = enabledTools.length;

    nodes.push({
      id: 'cat-tools',
      type: 'category',
      position: POSITIONS.tools,
      data: {
        label: 'Tools',
        description: `${enabledCount}/${TOOL_CATALOG.length} enabled`,
        color: 'amber',
      } satisfies CategoryData,
    });
    edges.push({
      id: 'e-root-tools',
      source: 'contract-root',
      target: 'cat-tools',
      style: { stroke: 'rgba(124,58,237,0.4)', strokeWidth: 2 },
      animated: true,
    });

    TOOL_CATALOG.forEach((tool, i) => {
      const toolId = `tool-${tool.name}`;
      nodes.push({
        id: toolId,
        type: 'tool',
        position: {
          x: POSITIONS.tools.x - 60 + (i % 2) * 180,
          y: POSITIONS.tools.y + 90 + Math.floor(i / 2) * 55,
        },
        data: {
          toolName: tool.name,
          displayName: tool.displayName,
          description: tool.description,
          enabled: enabledTools.includes(tool.name),
        } satisfies ToolNodeData,
      });
      edges.push({
        id: `e-tools-${tool.name}`,
        source: 'cat-tools',
        target: toolId,
        style: { stroke: 'rgba(245,158,11,0.3)', strokeWidth: 1.5 },
      });
    });
  }

  // Templates category — shown when template data is provided
  if (templates && templates.length > 0) {
    nodes.push({
      id: 'cat-templates',
      type: 'category',
      position: POSITIONS.templates,
      data: {
        label: 'Templates',
        description: `${templates.length} available`,
        color: 'rose',
      } satisfies CategoryData,
    });
    edges.push({
      id: 'e-root-templates',
      source: 'contract-root',
      target: 'cat-templates',
      style: { stroke: 'rgba(124,58,237,0.4)', strokeWidth: 2 },
      animated: true,
    });

    templates.forEach((tmpl, i) => {
      const tmplId = `template-${tmpl.id}`;
      nodes.push({
        id: tmplId,
        type: 'template',
        position: {
          x: POSITIONS.templates.x - 40 + (i % 3) * 140,
          y: POSITIONS.templates.y + 90 + Math.floor(i / 3) * 55,
        },
        data: {
          templateId: tmpl.id,
          templateName: tmpl.name,
          category: tmpl.category || 'General',
        } satisfies TemplateNodeData,
      });
      edges.push({
        id: `e-templates-${tmpl.id}`,
        source: 'cat-templates',
        target: tmplId,
        style: { stroke: 'rgba(244,63,94,0.3)', strokeWidth: 1.5 },
      });
    });
  }

  return { nodes, edges };
}

/**
 * Convert React Flow nodes/edges back to contract JSON
 */
export function reactFlowToContract(nodes: Node[], _edges: Edge[]): AgentContract {
  const contract: AgentContract = {
    version: '1.0',
    type: 'html-node',
    node: {
      css: { colorTokens: {} },
      features: {},
      content: { sections: [] },
      validation: { mustContain: [] },
      safety: {},
    },
  };

  // Extract root info
  const rootNode = nodes.find(n => n.type === 'contractRoot');
  if (rootNode) {
    contract.type = (rootNode.data as ContractRootData).contractType || 'html-node';
    contract.version = (rootNode.data as ContractRootData).version || '1.0';
  }

  // Extract tokens
  for (const node of nodes) {
    if (node.type === 'token') {
      const data = node.data as TokenData;
      if (data.tokenKey.startsWith('--') && contract.node?.css?.colorTokens) {
        contract.node.css.colorTokens[data.tokenKey] = data.tokenValue;
      }
    }
    if (node.type === 'toggle') {
      const data = node.data as ToggleData;
      if (contract.node?.features) {
        contract.node.features[data.featureName] = data.enabled;
      }
    }
    if (node.type === 'section') {
      const data = node.data as SectionData;
      contract.node?.content?.sections?.push(data.sectionName);
    }
    if (node.type === 'tool') {
      const data = node.data as ToolNodeData;
      if (data.enabled) {
        if (!contract.tools) contract.tools = { enabled: [] };
        contract.tools.enabled!.push(data.toolName);
      }
    }
  }

  return contract;
}

/**
 * Default "Dark Glass" contract for demo
 */
export const DEFAULT_CONTRACT: AgentContract = {
  version: '1.0',
  type: 'html-node',
  tools: {
    enabled: [
      'create_graph', 'create_node', 'create_html_node',
      'create_html_from_template', 'read_graph', 'read_node',
      'patch_node', 'add_edge', 'list_graphs',
    ],
  },
  node: {
    css: {
      designSystem: 'dark-glass',
      colorTokens: {
        '--bg1': '#070a0f',
        '--accent': '#7c3aed',
        '--text': '#e5e7eb',
      },
      fontStack: 'system-ui, sans-serif',
      borderRadius: '18px',
    },
    features: {
      login: false,
      editMode: false,
      responsiveBreakpoints: true,
      darkMode: true,
    },
    content: {
      sections: ['hero', 'body', 'footer'],
      menuMode: 'none',
      imageStrategy: 'pexels',
    },
    validation: {
      mustContain: ['<!doctype html>', '<html', '</html>'],
      maxSizeKb: 200,
    },
    safety: {
      sanitizer: 'DOMPurify',
      noExternalScripts: true,
    },
  },
};
