import fs from 'node:fs/promises';
import path from 'node:path';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const ROOT = '/Users/torarnehave/Documents/GitHub/Agent-Builder';
const INPUT_JSON = path.join(ROOT, 'tmp', 'plugin_templates.json');
const OUTPUT_DIR = path.join(ROOT, 'outputs', 'plugin-template-inventory-2026-04-28');
const OUTPUT_XLSX = path.join(OUTPUT_DIR, 'vegvisr-plugin-template-inventory.xlsx');
const OUTPUT_JSON = path.join(OUTPUT_DIR, 'vegvisr-plugin-template-inventory.json');

const SYSTEM_PROMPT_PATH = path.join(ROOT, 'worker', 'system-prompt.js');
const TOOL_DEFS_PATH = path.join(ROOT, 'worker', 'tool-definitions.js');
const AGENT_PATH = path.join(ROOT, 'worker', 'agent.js');

function parseWranglerResult(raw) {
  const payload = JSON.parse(raw);
  if (!Array.isArray(payload) || !payload[0]?.results) {
    throw new Error('Unexpected wrangler D1 JSON shape');
  }
  return payload[0].results;
}

function parseNodes(nodesText) {
  try {
    const parsed = JSON.parse(nodesText || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function truncate(value, max = 140) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function extractTrigger(aiInstructions) {
  if (!aiInstructions) return '';
  try {
    const parsed = JSON.parse(aiInstructions);
    return parsed.trigger || parsed.format || '';
  } catch {
    return aiInstructions;
  }
}

function extractFormat(aiInstructions) {
  if (!aiInstructions) return '';
  try {
    const parsed = JSON.parse(aiInstructions);
    return parsed.format || '';
  } catch {
    return aiInstructions;
  }
}

function normalizeName(name) {
  return String(name || '').toLowerCase().trim();
}

function buildEvidenceContext(systemPrompt, toolDefs, agentText) {
  return {
    hasFormattingReferenceTool: toolDefs.includes("name: 'get_formatting_reference'"),
    hasPatchNodeTool: toolDefs.includes("name: 'patch_node'"),
    hasCreateNodeTool: toolDefs.includes("name: 'create_node'"),
    hasMarkdownImageGuidance: agentText.includes('markdown-image'),
    formattingPrompt: systemPrompt,
    nodeTypesPrompt: systemPrompt,
  };
}

function classifyFulltextElement(row, ctx) {
  const id = row.id;
  const name = normalizeName(row.name);
  const format = extractFormat(row.ai_instructions);
  const sources = [];
  let status = 'No';
  let rationale = 'Stored in D1 template table, but not explicitly exposed in current Gemma prompt/tool references.';

  const hasPrompt = (needle) => ctx.formattingPrompt.includes(needle);

  if (name === 'section' && hasPrompt('**SECTION**')) {
    status = 'Yes';
    sources.push('Formatting reference');
    rationale = 'Explicit SECTION syntax is documented in get_formatting_reference.';
  } else if ((name === 'fancy' || name === 'fancy-grad' || name === 'fancy-img') && hasPrompt('**FANCY**')) {
    status = 'Yes';
    sources.push('Formatting reference');
    rationale = name === 'fancy'
      ? 'FANCY syntax is explicit in get_formatting_reference.'
      : 'FANCY plus gradient/background-image variants are explicit in get_formatting_reference.';
  } else if (name === 'quote' && hasPrompt('**QUOTE**')) {
    status = 'Yes';
    sources.push('Formatting reference');
    rationale = 'QUOTE syntax is explicit in get_formatting_reference.';
  } else if (name === 'wnote' && hasPrompt('**WNOTE**')) {
    status = 'Yes';
    sources.push('Formatting reference');
    rationale = 'WNOTE syntax is explicit in get_formatting_reference.';
  } else if (name === 'comment' && hasPrompt('**COMMENT**')) {
    status = 'Yes';
    sources.push('Formatting reference');
    rationale = 'COMMENT syntax is explicit in get_formatting_reference.';
  } else if (name === 'imagequote' && hasPrompt('**IMAGEQUOTE**')) {
    status = 'Yes';
    sources.push('Formatting reference');
    rationale = 'IMAGEQUOTE syntax is explicit in get_formatting_reference.';
  } else if (id === 'elt-image-header' && hasPrompt('**Header**')) {
    status = 'Yes';
    sources.push('Formatting reference', 'patch_node guidance');
    rationale = 'Header image grammar is explicit and patch_node guidance tells Gemma to use it inside fulltext nodes.';
  } else if (id.startsWith('elt-image-leftside-') && hasPrompt('**Leftside-N**')) {
    status = 'Partial';
    sources.push('Formatting reference', 'patch_node guidance');
    rationale = 'Gemma knows the generic Leftside-N grammar, but the exact size/circle preset IDs are only stored in D1.';
  } else if (id.startsWith('elt-image-rightside-') && hasPrompt('**Rightside-N**')) {
    status = 'Partial';
    sources.push('Formatting reference', 'patch_node guidance');
    rationale = 'Gemma knows the generic Rightside-N grammar, but the exact size/circle preset IDs are only stored in D1.';
  } else if (id === 'elt-image-center') {
    status = 'No';
    sources.push('D1 only');
    rationale = 'Centered image grammar exists in D1, but is not named in the current formatting reference.';
  } else if (name === 'page break') {
    status = 'No';
    sources.push('D1 only');
    rationale = 'The [pb] marker exists in D1, but is not surfaced in the current formatting reference.';
  } else if (name === 'flexbox-cards' && hasPrompt('FLEXBOX-CARDS')) {
    status = 'Yes';
    sources.push('Formatting reference');
    rationale = 'FLEXBOX-CARDS is explicitly shown in get_formatting_reference.';
  } else if (name === 'flexbox-gallery' && hasPrompt('FLEXBOX-GALLERY')) {
    status = 'Yes';
    sources.push('Formatting reference');
    rationale = 'FLEXBOX-GALLERY is explicitly shown in get_formatting_reference.';
  } else if (name === 'flexbox-grid' && hasPrompt('FLEXBOX-GRID')) {
    status = 'Yes';
    sources.push('Formatting reference');
    rationale = 'FLEXBOX-GRID is explicitly shown in get_formatting_reference.';
  } else if (name === 'flexbox' || name === 'flexbox-row') {
    status = 'Partial';
    sources.push('Formatting reference');
    rationale = 'Gemma is told about flexbox-style fulltext layouts, but these exact presets are not explicitly named in the prompt.';
  } else if (name === 'youtube' && ctx.nodeTypesPrompt.includes('**youtube-video**')) {
    status = 'Partial';
    sources.push('Node types reference');
    rationale = 'Gemma knows YouTube embed handling as a node type, but the fulltext template preset is not explicitly documented as a formatting element.';
  } else if (format && (format.includes('Leftside-1') || format.includes('Rightside-1') || format.includes('Header|')) && ctx.hasPatchNodeTool) {
    status = 'Partial';
    sources.push('Formatting reference', 'patch_node guidance');
    rationale = 'The family is known, but this exact preset is not directly named.';
  }

  return {
    status,
    evidence: sources.join(' + ') || 'D1 only',
    rationale,
  };
}

function classifyTemplate(row, ctx) {
  const nodes = parseNodes(row.nodes);
  const primaryNode = nodes[0] || {};
  const nodeType = primaryNode.type || '';
  const name = row.name || '';
  const categories = [];
  let status = 'No';
  let rationale = 'Stored as a plugin template in D1, but not explicitly described in current Gemma prompt/tool references.';

  const promptHas = (needle) => ctx.nodeTypesPrompt.includes(needle);

  if (nodeType === 'fulltext' && name === 'FullTextNode') {
    status = 'Yes';
    categories.push('Node types reference');
    rationale = 'fulltext is the default node type and is explicitly documented.';
  } else if (nodeType === 'markdown-image') {
    status = 'Yes';
    categories.push('create_node guidance');
    rationale = 'markdown-image creation is explicitly documented in the Workers AI prompt and tool definitions.';
  } else if (nodeType === 'mermaid-diagram') {
    if (promptHas('**mermaid-diagram**')) {
      status = 'Yes';
      categories.push('Node types reference');
      rationale = 'Mermaid diagram node creation is explicitly documented, including flowchart, gantt, timeline, and quadrant examples.';
    }
  } else if (nodeType === 'youtube-video' && promptHas('**youtube-video**')) {
    status = 'Yes';
    categories.push('Node types reference');
    rationale = 'youtube-video node creation is explicitly documented.';
  } else if (nodeType === 'linechart' && promptHas('**linechart**')) {
    status = 'Yes';
    categories.push('Node types reference');
    rationale = 'linechart creation is explicitly documented, including multi-series examples.';
  } else if (nodeType === 'bubblechart' && promptHas('**bubblechart**')) {
    status = 'Yes';
    categories.push('Node types reference');
    rationale = 'bubblechart creation is explicitly documented.';
  } else if (nodeType === 'chart' && promptHas('**chart**')) {
    status = 'Yes';
    categories.push('Node types reference');
    rationale = 'chart creation is explicitly documented.';
  } else if (nodeType === 'notes' && promptHas('**notes**')) {
    status = 'Yes';
    categories.push('Node types reference');
    rationale = 'notes node creation is explicitly documented.';
  } else if (nodeType === 'worknote' && promptHas('**worknote**')) {
    status = 'Yes';
    categories.push('Node types reference');
    rationale = 'worknote node creation is explicitly documented.';
  } else if (nodeType === 'map' && promptHas('**map**')) {
    status = 'Yes';
    categories.push('Node types reference');
    rationale = 'map node creation is explicitly documented.';
  } else if (nodeType === 'audio') {
    status = 'No';
    categories.push('D1 only');
    rationale = 'Audio node template exists in D1, but audio is not explicitly included in the node types reference for Gemma.';
  } else if (nodeType === 'portfolio-image') {
    status = 'No';
    categories.push('D1 only');
    rationale = 'portfolio-image exists as a template but is not explicitly documented in the current prompt/tool references.';
  } else if (nodeType === 'title') {
    status = 'Partial';
    categories.push('fulltext formatting');
    rationale = 'The title node type itself is not documented, but Gemma does know the FANCY formatting used inside it.';
  } else if (row.category === 'Layout Templates') {
    if (/FLEXBOX-(CARDS|GALLERY|GRID)/.test(name)) {
      status = 'Yes';
      categories.push('Formatting reference');
      rationale = 'This layout template uses a fulltext element family explicitly shown in get_formatting_reference.';
    } else {
      status = 'Partial';
      categories.push('Formatting reference');
      rationale = 'Gemma knows the general layout family, but this exact saved template is only in D1.';
    }
  } else if (nodeType === 'fulltext') {
    const fulltextStatus = classifyFulltextElement(row, ctx);
    status = fulltextStatus.status;
    categories.push(fulltextStatus.evidence);
    rationale = fulltextStatus.rationale;
  }

  return {
    status,
    evidence: categories.join(' + ') || 'D1 only',
    rationale,
    primaryNodeType: nodeType || '(unknown)',
    sampleLabel: primaryNode.label || '',
  };
}

function sortStatus(rows) {
  const order = { Yes: 0, Partial: 1, No: 2 };
  return [...rows].sort((a, b) => {
    const delta = (order[a.gemmaStatus] ?? 9) - (order[b.gemmaStatus] ?? 9);
    if (delta !== 0) return delta;
    return String(a.name).localeCompare(String(b.name));
  });
}

function sheetMatrix(headers, rows, keys) {
  return [
    headers,
    ...rows.map((row) => keys.map((key) => row[key] ?? '')),
  ];
}

function address(colCount, rowCount) {
  function colName(index) {
    let n = index;
    let out = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      out = String.fromCharCode(65 + rem) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
  }
  return `A1:${colName(colCount)}${rowCount}`;
}

async function main() {
  const [rawJson, systemPrompt, toolDefs, agentText] = await Promise.all([
    fs.readFile(INPUT_JSON, 'utf8'),
    fs.readFile(SYSTEM_PROMPT_PATH, 'utf8'),
    fs.readFile(TOOL_DEFS_PATH, 'utf8'),
    fs.readFile(AGENT_PATH, 'utf8'),
  ]);

  const rows = parseWranglerResult(rawJson);
  const ctx = buildEvidenceContext(systemPrompt, toolDefs, agentText);

  const fulltextElements = [];
  const pluginTemplates = [];

  for (const row of rows) {
    const nodes = parseNodes(row.nodes);
    const primaryNode = nodes[0] || {};
    const base = {
      id: row.id,
      name: row.name,
      category: row.category,
      plugin: row.plugin,
      toolFlag: row.tool,
      geminiFlag: row.gemini,
      standardQuestion: row.standard_question || '',
      trigger: truncate(extractTrigger(row.ai_instructions), 90),
      formatPreview: truncate(extractFormat(row.ai_instructions) || primaryNode.info || '', 180),
    };

    if (row.id.startsWith('elt-')) {
      const classification = classifyFulltextElement(row, ctx);
      fulltextElements.push({
        ...base,
        gemmaStatus: classification.status,
        evidence: classification.evidence,
        rationale: classification.rationale,
      });
    } else {
      const classification = classifyTemplate(row, ctx);
      pluginTemplates.push({
        ...base,
        primaryNodeType: classification.primaryNodeType,
        sampleLabel: classification.sampleLabel,
        gemmaStatus: classification.status,
        evidence: classification.evidence,
        rationale: classification.rationale,
      });
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    totalPluginRows: rows.length,
    totalFulltextElements: fulltextElements.length,
    totalPluginTemplates: pluginTemplates.length,
    fulltextStatusCounts: countStatuses(fulltextElements),
    templateStatusCounts: countStatuses(pluginTemplates),
  };

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(OUTPUT_JSON, JSON.stringify({ summary, fulltextElements, pluginTemplates }, null, 2));

  const workbook = Workbook.create();

  const summarySheet = workbook.worksheets.add('Summary');
  const summaryRows = [
    ['Vegvisr Plugin Template Inventory', '', ''],
    ['Generated', `UTC ${summary.generatedAt.replace('T', ' ').replace('.000Z', 'Z')}`, ''],
    ['Source', 'D1 graphTemplates WHERE plugin = 1', ''],
    ['Current Gemma evidence', 'worker/system-prompt.js + worker/tool-definitions.js + worker/agent.js', ''],
    ['', '', ''],
    ['Metric', 'Value', 'Notes'],
    ['Total plugin rows', summary.totalPluginRows, 'All D1 rows with plugin = 1'],
    ['Fulltext elements', summary.totalFulltextElements, 'Rows where id starts with elt-'],
    ['Other plugin templates', summary.totalPluginTemplates, 'All remaining plugin templates'],
    ['', '', ''],
    ['Fulltext: Yes', summary.fulltextStatusCounts.Yes, 'Explicitly described in current Gemma prompt/reference'],
    ['Fulltext: Partial', summary.fulltextStatusCounts.Partial, 'Generic family known, exact preset not explicit'],
    ['Fulltext: No', summary.fulltextStatusCounts.No, 'Only stored in D1 today'],
    ['', '', ''],
    ['Templates: Yes', summary.templateStatusCounts.Yes, 'Explicit node type or formatting family documented'],
    ['Templates: Partial', summary.templateStatusCounts.Partial, 'Only partially implied by current exposure'],
    ['Templates: No', summary.templateStatusCounts.No, 'Not explicitly surfaced to Gemma today'],
  ];
  const summaryRange = summarySheet.getRange(address(3, summaryRows.length));
  summaryRange.values = summaryRows;
  summaryRange.format.autofitColumns();
  summaryRange.format.autofitRows();

  const fulltextSheet = workbook.worksheets.add('Fulltext Elements');
  const fulltextRows = sortStatus(fulltextElements);
  const fulltextMatrix = sheetMatrix(
    ['Gemma Status', 'ID', 'Name', 'Trigger / Prompt', 'Format Preview', 'Evidence', 'Rationale', 'Tool Flag', 'Gemini Flag'],
    fulltextRows,
    ['gemmaStatus', 'id', 'name', 'trigger', 'formatPreview', 'evidence', 'rationale', 'toolFlag', 'geminiFlag'],
  );
  const fulltextRange = fulltextSheet.getRange(address(9, fulltextMatrix.length));
  fulltextRange.values = fulltextMatrix;
  fulltextRange.format.autofitColumns();
  fulltextRange.format.autofitRows();

  const templateSheet = workbook.worksheets.add('Plugin Templates');
  const templateRows = sortStatus(pluginTemplates);
  const templateMatrix = sheetMatrix(
    ['Gemma Status', 'ID', 'Name', 'Category', 'Primary Node Type', 'Sample Label', 'Standard Question', 'Evidence', 'Rationale', 'Tool Flag', 'Gemini Flag'],
    templateRows,
    ['gemmaStatus', 'id', 'name', 'category', 'primaryNodeType', 'sampleLabel', 'standardQuestion', 'evidence', 'rationale', 'toolFlag', 'geminiFlag'],
  );
  const templateRange = templateSheet.getRange(address(11, templateMatrix.length));
  templateRange.values = templateMatrix;
  templateRange.format.autofitColumns();
  templateRange.format.autofitRows();

  const evidenceSheet = workbook.worksheets.add('Evidence');
  const evidenceRows = [
    ['File', 'Evidence'],
    ['worker/agent.js', "Workers AI allowlist includes read_graph, read_graph_content, create_node, patch_node, get_formatting_reference, search_pexels, search_unsplash, get_album_images, analyze_image, delegate_to_kg."],
    ['worker/agent.js', "Workers AI prompt instructs Gemma to use create_node with nodeType markdown-image for standalone images and patch_node plus get_formatting_reference for inline fulltext images."],
    ['worker/tool-definitions.js', "patch_node description explicitly mentions inline Header, Leftside, and Rightside image markdown edits inside fulltext nodes."],
    ['worker/system-prompt.js', 'Formatting reference explicitly documents SECTION, FANCY, QUOTE, WNOTE, COMMENT, IMAGEQUOTE, Leftside/Rightside/Header image grammar, and FLEXBOX Grid/Gallery/Cards examples.'],
    ['worker/system-prompt.js', 'Node types reference explicitly documents mermaid-diagram, youtube-video, chart, linechart, bubblechart, notes, worknote, map, fulltext, image, and link.'],
    ['Classification rule', 'Yes = explicit evidence in prompt/reference/tools. Partial = generic family known but exact D1 preset not explicit. No = D1-only today.'],
  ];
  const evidenceRange = evidenceSheet.getRange(address(2, evidenceRows.length));
  evidenceRange.values = evidenceRows;
  evidenceRange.format.autofitColumns();
  evidenceRange.format.autofitRows();

  const lucidSheet = workbook.worksheets.add('Lucid Analysis');
  const lucidRows = [
    [
      'Topic',
      'Observed Behavior',
      'Expected Behavior',
      'Gap',
      'Recommended UX Change',
      'Code Evidence',
    ],
    [
      'Execution path',
      'When Lucid Origin is selected, every message goes through a direct image-generation branch in the chat UI and bypasses the normal SSE agent/tool loop.',
      'Users should clearly understand that this model is running in direct image mode, not in graph-editing or agent-planning mode.',
      'The model appears in the same chat surface as agent models, but its execution model is fundamentally different.',
      'Show an explicit “Image generation mode” state in the composer when Lucid Origin is selected, including a short note that every message becomes an image prompt.',
      'src/components/VegvisrAgentChat.tsx:1290-1317',
    ],
    [
      'Prompt pass-through',
      'The full user message is sent as the prompt with no structured parsing layer for formats, styles, or prompt components.',
      'Natural prompting should still work, but supported controls like format and seed should have explicit UI affordances instead of relying only on free-text conventions.',
      'The graph documents rich prompting strategies, but the chat UI exposes only a raw prompt box.',
      'Add optional prompt controls beneath the composer for aspect ratio, seed, and maybe style presets, while still allowing raw prompt text.',
      'src/components/VegvisrAgentChat.tsx:1292-1303 and worker/index.js:2826-2834',
    ],
    [
      'Aspect ratio handling',
      'The worker can parse `--ar W:H` from the prompt, but the frontend sends hardcoded `width: 1120` and `height: 630` for Lucid Origin, which overrides prompt-level aspect ratio handling.',
      'If the user writes `--ar 4:2`, or chooses another format in the UI, the generated dimensions should follow that choice consistently.',
      'The worker supports aspect-ratio inference, but the frontend default dimensions currently win.',
      'Do not send fixed width/height when `--ar` is present. Better: expose an aspect-ratio selector and only send explicit dimensions from the selector.',
      'src/components/VegvisrAgentChat.tsx:1297-1299 and worker/index.js:2803-2832',
    ],
    [
      'Advanced params',
      'The worker accepts `guidance`, `seed`, `width`, and `height`, but the Lucid chat UI does not expose those controls.',
      'Users should be able to intentionally reproduce results, tune guidance, and choose output framing when using an image model.',
      'Backend capability exists, but the frontend does not surface it.',
      'Add an expandable “Image options” panel for seed, guidance, and format controls when an image model is selected.',
      'worker/index.js:2831-2834',
    ],
    [
      'Transcript contamination',
      'Pending transcription context is prepended before the image-model branch check, so transcript text can accidentally become part of the Lucid prompt.',
      'Image prompts should be isolated from unrelated transcript context unless the user explicitly asks to use the transcript as prompt material.',
      'A cross-feature text-prepend behavior leaks into image generation.',
      'Skip transcript prefixing for image-generation models, or ask the user whether to use the transcript as prompt input.',
      'src/components/VegvisrAgentChat.tsx:1274-1293',
    ],
    [
      'Text rendering expectations',
      'The model label promises strong text rendering, but the UI offers no dedicated guidance or helper for quoted text, typography style, or short-text best practices.',
      'A user asking for words or a poster title should get lightweight prompting guidance, because text rendering is one of Lucid Origin’s key strengths.',
      'Capability is communicated in model description, but not supported with task-specific prompt assistance.',
      'Add inline helper text or examples for “quoted text”, typography prompts, and poster/logo use cases when Lucid Origin is active.',
      'src/components/ModelSettings.tsx:75-77 and graph_1776140641487 content',
    ],
    [
      'Meta token usage',
      'The graph documents meta tokens that should appear early in the prompt, but the UI offers no way to preserve, suggest, or structure those patterns.',
      'Advanced users should be able to use meta tokens intentionally, and less advanced users should be able to discover them without leaving the chat.',
      'Knowledge exists in the graph, but is disconnected from the active image-generation interface.',
      'Add a prompt helper or reference drawer for Lucid meta-token categories, or a “Use prompt cheat sheet” action that inserts examples.',
      'graph_1776140641487 nodes 4037128d-ce16-48ad-9ad7-c6edecfbb5ce and chapter_3/chapter_5',
    ],
    [
      'Output handling',
      'The generated image is returned as a URL in chat, but there is no first-class next step for saving that image into the active graph as a node or inline fulltext element.',
      'Users working inside Agent Builder likely expect a smooth path from generation to graph insertion.',
      'Image generation and graph authoring are adjacent workflows but currently disconnected in the Lucid path.',
      'Add post-generation actions such as “Add as markdown-image node”, “Use as Header”, “Use as Leftside”, and “Save to album/graph”.',
      'src/components/VegvisrAgentChat.tsx:1304-1312 and existing add-image flows in the same component',
    ],
    [
      'Mode ambiguity',
      'Other models can also trigger image generation through regex interception of phrases like “generate image of…”, while Lucid Origin always interprets the whole message as an image prompt.',
      'The behavior difference between image-first models and text-first models should be visible and predictable.',
      'Two different image-generation behaviors exist in the same chat surface.',
      'Make the mode explicit in the UI and avoid hidden interception rules when a dedicated image model is selected.',
      'src/components/VegvisrAgentChat.tsx:1290-1346',
    ],
  ];
  const lucidRange = lucidSheet.getRange(address(6, lucidRows.length));
  lucidRange.values = lucidRows;
  lucidRange.format.autofitColumns();
  lucidRange.format.autofitRows();

  const lucidUxSheet = workbook.worksheets.add('Lucid UX Proposal');
  const lucidUxRows = [
    [
      'Control',
      'Type',
      'Options',
      'Maps to',
      'Why it helps',
      'Power-user fallback',
      'Priority',
    ],
    [
      'Prompt',
      'Textarea',
      'Free text scene / concept / subject description',
      'Direct `prompt` body sent to `/generate-image`',
      'Keeps the creative core of image generation simple and flexible.',
      'Users can still write full advanced prompts manually.',
      'P1',
    ],
    [
      'Format',
      'Segmented control / select',
      'Landscape 16:9, Cinematic 4:2, Square 1:1, Portrait 4:5, Story 9:16',
      'Maps to `width`/`height` or prompt-level `--ar` equivalent',
      'Makes aspect ratio visible and removes the need for most users to remember `--ar` syntax.',
      'Keep manual `--ar` support and let manual prompt syntax override the selector.',
      'P1',
    ],
    [
      'Use prompt `--ar`',
      'Automatic rule',
      'If prompt contains `--ar`, disable or visually override the Format selector',
      'Frontend request assembly logic',
      'Prevents ambiguity and preserves power-user intent.',
      'Exact prompt syntax remains valid for advanced users.',
      'P1',
    ],
    [
      'Style',
      'Select',
      'Photoreal, Cinematic, Editorial, Poster, Illustration, Pixar/3D, Concept Art',
      'Prompt helper tokens prepended or appended deterministically',
      'Lets non-expert users guide image type without needing prompt-engineering knowledge.',
      'User can ignore the selector and write style directly in the prompt.',
      'P1',
    ],
    [
      'Lighting',
      'Select',
      'Golden Hour, Soft Studio, Low Key, Overcast, Neon, Candlelight, Nordic Twilight',
      'Prompt helper tokens',
      'Lighting is a high-value visual lever that users often want but struggle to phrase consistently.',
      'User may still describe lighting directly in the prompt.',
      'P2',
    ],
    [
      'Camera / Render',
      'Multi-select',
      'Long Exposure, 35mm Lens, 85mm Portrait, Shallow Depth of Field, Film Grain, Anamorphic Lens Flare',
      'Prompt helper tokens',
      'Turns advanced photographic language into reusable UI selections.',
      'Experts can still write custom camera language and meta tokens manually.',
      'P2',
    ],
    [
      'Text in image',
      'Toggle + text input',
      'Off / On, with fields for text content and treatment: Poster Title, Logo, Neon, Gold Serif, Carved Stone',
      'Prompt composition using quoted text and typography hints',
      'Text rendering is one of Lucid Origin’s headline strengths and deserves first-class support.',
      'Users can still type exact quoted text directly in the prompt.',
      'P1',
    ],
    [
      'Prompt helper presets',
      'Button group',
      'Photo Real, Poster With Text, Cinematic Wide, Long Exposure, Peaceful Landscape, Sacred Atmosphere',
      'Preloads multiple control values and optional helper prompt text',
      'Gives fast starting points and reduces blank-page friction.',
      'Power users can bypass presets entirely.',
      'P1',
    ],
    [
      'Meta token helper',
      'Drawer / cheat-sheet panel',
      'Camera Simulation, Archive & Studio, Cinematic, Lighting, Editorial, Typography',
      'Reference only or one-click token insertion into the prompt',
      'Connects the knowledge graph research to the active image-generation workflow.',
      'Users can still paste or type tokens themselves.',
      'P2',
    ],
    [
      'Seed',
      'Number input',
      'Integer value + “reuse last seed” action',
      'Maps to `seed` in `/generate-image`',
      'Important for reproducibility and controlled iterations.',
      'Can stay hidden in an advanced panel for most users.',
      'P2',
    ],
    [
      'Guidance',
      'Slider / number input',
      'Low to High prompt adherence',
      'Maps to `guidance` in `/generate-image`',
      'Gives users a controlled way to trade off freedom vs prompt precision.',
      'Advanced users can leave it unset and rely on prompt quality.',
      'P3',
    ],
    [
      'Prompt preview',
      'Read-only preview box',
      'Final composed prompt with helper tokens and quoted text visible before generation',
      'Frontend composed request preview',
      'Builds trust, makes the system legible, and helps users learn prompting by example.',
      'Experts can ignore it, but it should remain visible for debugging and confidence.',
      'P1',
    ],
    [
      'Mode banner',
      'Inline status card',
      '“Lucid Origin is in image generation mode. Every message becomes an image prompt.”',
      'UI-only explanation',
      'Clarifies that this model does not behave like the normal agent chat loop.',
      'No fallback needed; this is purely clarity.',
      'P1',
    ],
    [
      'Post-generation actions',
      'Action buttons under generated image',
      'Regenerate, Use Same Seed, Add as Image Node, Insert as Header, Insert as Leftside, Save to Graph',
      'Existing graph/image insertion flows plus image-generation response URL',
      'Closes the gap between image generation and graph authoring.',
      'Users can still copy the URL manually if they want.',
      'P1',
    ],
    [
      'Transcript isolation',
      'Automatic rule',
      'Do not prepend transcription context when an image model is selected',
      'Frontend prompt assembly logic',
      'Prevents cross-feature contamination of image prompts.',
      'If transcript-to-image is wanted later, make it an explicit action like “Use transcript as prompt material”.',
      'P1',
    ],
  ];
  const lucidUxRange = lucidUxSheet.getRange(address(7, lucidUxRows.length));
  lucidUxRange.values = lucidUxRows;
  lucidUxRange.format.autofitColumns();
  lucidUxRange.format.autofitRows();

  const lucidImplSheet = workbook.worksheets.add('Lucid UI Implementation');
  const lucidImplRows = [
    [
      'Field / Feature',
      'UI Location in VegvisrAgentChat',
      'Component State',
      'Render Rule',
      'Request Mapping',
      'Validation / Interaction Rules',
      'Post-Generation Behavior',
      'Implementation Notes',
      'Priority',
    ],
    [
      'Image mode banner',
      'Above the composer, below graph context / action bar',
      '`const isLucidModel = model === "@cf/leonardo/lucid-origin"`',
      'Render only when Lucid Origin is the selected model',
      'No request mapping; explanatory only',
      'Must not appear for non-image models. Copy should explain that every message becomes an image prompt.',
      'Remains visible while Lucid is selected',
      'Use the same visual language as the existing active-graph context strip so the mode feels native to the current UI.',
      'P1',
    ],
    [
      'Prompt textarea',
      'Existing main textarea in the composer',
      '`inputText`',
      'Always render, but update placeholder when Lucid is selected',
      'Maps directly to `prompt` in `/generate-image`',
      'Keep Enter-to-send behavior. Do not prepend transcript context when Lucid is selected.',
      'User message echoes the final prompt that was actually sent',
      'This should remain the primary control; all other Lucid fields support this input rather than replacing it.',
      'P1',
    ],
    [
      'Format selector',
      'Inline row above the textarea or between textarea and send button',
      '`imageFormatPreset` such as `\"16:9\" | \"4:2\" | \"1:1\" | \"4:5\" | \"9:16\" | null`',
      'Render only for image models, default to `16:9` for Lucid',
      'Translate to explicit `width`/`height` unless the prompt contains `--ar`',
      'If prompt contains `--ar`, show that manual aspect ratio overrides the selector. Avoid sending conflicting dimensions.',
      'Store the used format in local UI state for quick regenerate flows',
      'This is the visible replacement for hidden prompt syntax, but must coexist with power-user `--ar` usage.',
      'P1',
    ],
    [
      'Prompt `--ar` override handling',
      'No dedicated control; inline helper below Format selector',
      '`hasAspectRatioInPrompt = /--ar\\s+\\d+\\s*:\\s*\\d+/i.test(inputText)`',
      'When true, visually mute or annotate the format selector',
      'Suppress Lucid default dimensions and let worker-side aspect-ratio parsing apply',
      'Never override explicit prompt-level `--ar` with frontend defaults.',
      'Return generated dimensions in the result card so users can confirm the final format',
      'This behavior already partially exists in the Lucid send path after the `--ar` fix; the UI now needs to expose it clearly.',
      'P1',
    ],
    [
      'Style selector',
      'Optional control row under Format',
      '`imageStylePreset`',
      'Render only for image models',
      'Maps to deterministic helper tokens appended/prepended to the composed prompt before send',
      'If the user already includes strong style language manually, do not aggressively duplicate or rewrite it.',
      'Display the chosen style in the prompt preview',
      'Start simple with one select rather than many chips. The goal is legible prompt construction, not endless controls.',
      'P1',
    ],
    [
      'Lighting selector',
      'Optional control row under Style',
      '`imageLightingPreset`',
      'Render only for image models',
      'Maps to helper tokens in the composed prompt',
      'One lighting preset at a time is enough initially; avoid multi-select complexity unless needed.',
      'Display chosen lighting in prompt preview',
      'This is valuable because users often want mood changes more than technical parameter changes.',
      'P2',
    ],
    [
      'Camera / Render controls',
      'Advanced options panel',
      '`imageRenderTraits: string[]`',
      'Collapsed by default; visible on “Advanced” expand',
      'Maps to additive prompt tokens like `long exposure`, `35mm lens`, `film grain`',
      'Use additive chips. Keep the list curated to avoid contradictory combinations.',
      'Include selected traits in regenerate / reuse flows',
      'This is where graph-derived knowledge like long exposure and cinematic tokens should become reusable UI.',
      'P2',
    ],
    [
      'Text in image toggle',
      'Primary control row near Style because it is a headline Lucid capability',
      '`includeImageText: boolean`, `imageTextValue`, `imageTextTreatment`',
      'When enabled, reveal text fields and typography treatment options',
      'Compose quoted text plus helper typography terms into the final prompt',
      'Require short text guidance. Show helper text like “Short phrases render best”.',
      'Generated result card should keep the exact prompt visible or reusable for iteration',
      'This should be first-class because Lucid’s model description explicitly calls out text rendering.',
      'P1',
    ],
    [
      'Prompt helper presets',
      'Button row above advanced options',
      '`imagePromptPreset`',
      'Render only for image models',
      'Sets multiple UI fields at once and may append starter prompt scaffolding',
      'Presets should be editable after selection and must never lock the user into one path.',
      'Allow “Use same preset” on regenerate',
      'Presets are the main beginner-onboarding layer: fast results without teaching prompt engineering first.',
      'P1',
    ],
    [
      'Meta token helper drawer',
      'Secondary panel or side drawer launched from the composer',
      '`isMetaTokenDrawerOpen`',
      'Render only for Lucid Origin, because it is tied to the researched prompting strategy',
      'One-click insert tokens into the textarea at cursor position or prepend them to prompt start',
      'Inserted tokens should preserve order and should not be auto-normalized away.',
      'Keep recently used tokens available for quick reuse',
      'This is the bridge between the knowledge graph research and the actual chat UX.',
      'P2',
    ],
    [
      'Seed input',
      'Advanced options panel',
      '`imageSeed: number | ""` and optionally `lastImageSeed`',
      'Collapsed by default',
      'Maps to `seed` in `/generate-image`',
      'Must accept blank/unset. Include “Reuse last seed” only when a previous generation returned one or used one.',
      'Persist last-used value for iteration',
      'Do not overcomplicate this. A simple number input plus reuse action is enough.',
      'P2',
    ],
    [
      'Guidance input',
      'Advanced options panel',
      '`imageGuidance: number | ""`',
      'Collapsed by default',
      'Maps to `guidance` in `/generate-image`',
      'Allow unset. Add a short explanation that higher guidance means stronger prompt adherence.',
      'Include in prompt preview metadata or result details if set',
      'This is useful but secondary; hide it until the basics are stable.',
      'P3',
    ],
    [
      'Prompt preview',
      'Between advanced options and send button, or directly above the send row',
      '`composedImagePrompt` derived from `inputText` plus selected controls',
      'Show only for image models and only when there is prompt content or selected modifiers',
      'Preview mirrors exactly what is sent in request body',
      'Must reflect precedence rules: user text first, selected helpers added deterministically, `--ar` respected.',
      'Use “Send this prompt” semantics so the preview becomes a trust mechanism',
      'This is critical for making the system understandable and debuggable.',
      'P1',
    ],
    [
      'Transcript isolation rule',
      'No visible control unless you later add an explicit transcript-to-image feature',
      'Adjust send-path logic around `lastTranscriptRef`',
      'For Lucid, do not prepend transcript context automatically',
      'Keep image request body focused on the composed image prompt only',
      'If transcript exists, either ignore it for image mode or show an explicit “Use transcript as prompt material” action.',
      'None by default',
      'This is an implementation rule rather than a user-facing widget, but it belongs in the plan because it affects prompt quality directly.',
      'P1',
    ],
    [
      'Result card action row',
      'Inside or directly below `GenerateImageCard`',
      '`lastGeneratedImage` / action-specific local state',
      'Render only when a generated image URL exists',
      'Uses generated image URL plus existing graph/image insertion helpers',
      'Only show graph-insertion actions when there is an active graph or a clear graph target path.',
      'Buttons: Regenerate, Use Same Seed, Add as Image Node, Insert as Header, Insert as Leftside, Save to Graph',
      'This is where Lucid stops being a side tool and becomes part of Agent Builder’s core workflow.',
      'P1',
    ],
  ];
  const lucidImplRange = lucidImplSheet.getRange(address(9, lucidImplRows.length));
  lucidImplRange.values = lucidImplRows;
  lucidImplRange.format.autofitColumns();
  lucidImplRange.format.autofitRows();

  const testSheet = workbook.worksheets.add('Test Cases');
  const testRows = [
    [
      'Case ID',
      'Priority',
      'Area',
      'Template / Element',
      'User Prompt',
      'Expected Intent',
      'Expected Route',
      'Expected Write Shape',
      'Gemma Today',
      'Pass Criteria',
      'Why This Test Matters',
    ],
    [
      'IM-1',
      'P1',
      'Inline image',
      'Leftside Image Medium',
      'Add this image as a Leftside element inside the first fulltext node of the current graph: https://vegvisr.imgix.net/sdxl-1777033601803.jpg',
      'Recognize: existing fulltext node + leftside placement + current graph + image URL',
      'Prefer deterministic image-in-fulltext tool or server-side formatter, not free-written markdown',
      "Patch existing node info with canonical syntax like ![Leftside-1|width: 200px; height: 200px; object-fit: 'cover'; object-position: 'center'](...)",
      'Partial',
      'Gemma selects the correct node and placement, and the saved node contains canonical Leftside syntax rather than generic markdown.',
      'This is the exact failure mode you reported.',
    ],
    [
      'IM-2',
      'P1',
      'Inline image',
      'Header Image',
      'Insert this image as a header image at the top of the node \"Mennesket er ikke rasjonelt av natur\": https://vegvisr.imgix.net/sdxl-1777033601803.jpg',
      'Recognize: target node by label + header placement + image URL',
      'patch_node after reading the node, optionally using formatting reference',
      "Patch node info with canonical Header syntax like ![Header|height: 200px; object-fit: 'cover'; object-position: 'center'](...)",
      'Yes',
      'The image appears as a full-width decorative header, with no stray [Header] label or plain markdown syntax.',
      'Confirms the current best-supported inline image path.',
    ],
    [
      'IM-3',
      'P1',
      'Standalone image node',
      'markdown-image',
      'Create a standalone image node called \"Freud header image\" using this URL: https://vegvisr.imgix.net/sdxl-1777033601803.jpg',
      'Recognize: create node, type markdown-image, label and path',
      'create_node',
      'Create markdown-image node with label, alt text/info, and path field populated',
      'Yes',
      'Node type is markdown-image and path is set; no empty image node is created.',
      'Verifies the clean non-inline image case.',
    ],
    [
      'CTX-1',
      'P1',
      'Current graph resolution',
      'Graph context',
      'What is the current graph?',
      'Recognize that the active UI graph is already known',
      'Use current graph context directly; do not list graphs to guess',
      'Answer with active graphId and metadata from read_graph if needed',
      'Yes',
      'Response references the selected graph without first drifting into list_graphs or “Graph not found” loops.',
      'Prevents wasted turns and broken UX in the current graph flow.',
    ],
    [
      'FT-1',
      'P2',
      'Fulltext styled block',
      'SECTION',
      'Add a SECTION block summarizing Freud’s view in the first fulltext node.',
      'Recognize styled fulltext request + existing node edit',
      'Read node, call get_formatting_reference if needed, then patch_node',
      'Canonical [SECTION ...][END SECTION] block inserted into fulltext content',
      'Yes',
      'Saved text uses Vegvisr SECTION syntax, not plain markdown headings or ad hoc HTML.',
      'Checks that the formatting reference path is working for styled prose.',
    ],
    [
      'FT-2',
      'P2',
      'Flex layout preset',
      'FLEXBOX-CARDS',
      'Insert a FLEXBOX-CARDS block with three short cards about Freud.',
      'Recognize a known layout family but still generate structured content safely',
      'Prefer formatting reference plus deterministic block assembly if added later',
      'Saved fulltext uses [FLEXBOX-CARDS] ... [END FLEXBOX] structure',
      'Yes',
      'Block structure is valid and closes correctly; no broken mixed markdown layout.',
      'Tests a layout family Gemma explicitly knows today.',
    ],
    [
      'IM-4',
      'P2',
      'Preset identity gap',
      'Center Image',
      'Insert this image as a centered image in the node: https://vegvisr.imgix.net/sdxl-1777033601803.jpg',
      'Recognize centered inline image intent',
      'Should become deterministic if this preset is important; today Gemma lacks explicit exposure',
      "Either canonical Center syntax is inserted or the system declines/asks precisely instead of inventing unsupported syntax",
      'No',
      'No malformed syntax is saved. If unsupported, the response is explicit rather than pretending success.',
      'This is a real D1 preset that Gemma does not explicitly know.',
    ],
    [
      'FT-3',
      'P2',
      'Preset identity gap',
      'PAGE BREAK',
      'Insert a page break before the final section.',
      'Recognize page-break marker intent',
      'Should be deterministic if retained as a supported authoring feature',
      'Insert [pb] exactly at the requested position',
      'No',
      'The saved content contains the exact [pb] marker or the system clearly states that it is not supported in chat.',
      'Covers another D1-only preset currently invisible to Gemma.',
    ],
    [
      'TPL-1',
      'P2',
      'Template vs node type',
      'TitleNode',
      'Create a title node for this graph that says \"Freud and the Unconscious\".',
      'Recognize that this is more than a generic fulltext block; it refers to a saved template identity',
      'Either map to a deterministic TitleNode template or intentionally fall back to a documented alternative',
      'Create the intended title-style node consistently',
      'Partial',
      'Result is consistent across runs; Gemma does not silently drift between title node and generic fulltext.',
      'Shows where template identity is only partially implied today.',
    ],
    [
      'TPL-2',
      'P3',
      'Unsupported template exposure',
      'AudioPath',
      'Create an AudioPath node for this MP3 URL: https://example.com/audio.mp3',
      'Recognize a D1 template that is not currently surfaced in Gemma references',
      'Should either use a deterministic template mapping or explicitly state limited support',
      'If created, node type/path must match the template; otherwise fail clearly',
      'No',
      'No hallucinated node shape. Either correct audio node creation or an explicit limitation message.',
      'Good regression test for D1-only templates.',
    ],
    [
      'YT-1',
      'P3',
      'YouTube ambiguity',
      'elt-youtube vs youtube-video node',
      'Add a YouTube video about Freud to the current graph.',
      'Decide whether the request means standalone youtube-video node or inline fulltext YOUTUBE element',
      'Disambiguate or apply a deterministic default rule',
      'One consistent route is chosen and reflected in the saved graph',
      'Partial',
      'The system does not randomly alternate between inline template and standalone node across runs.',
      'This is exactly the kind of ambiguity that creates noisy UX if left model-only.',
    ],
    [
      'LO-1',
      'P1',
      'Lucid Origin prompt path',
      'Raw scenic prompt',
      'With Lucid Origin selected: `a peaceful sea turtle floating on a glassy still lake at sunrise, soft golden light, cinematic wide angle`',
      'Recognize this as direct image generation, not chat/SSE/tool mode',
      'Frontend direct POST to /generate-image with full prompt as entered',
      'Prompt is passed through raw; response returns uploaded image URL and dimensions',
      'Partial',
      'An image is generated without the request entering the normal agent loop, and the assistant response contains the rendered image URL.',
      'Confirms the actual Lucid branch in VegvisrAgentChat.',
    ],
    [
      'LO-2',
      'P1',
      'Lucid Origin prompt path',
      'Aspect ratio via prompt',
      'With Lucid Origin selected: `a turtle on a Norwegian fjord at sunset --ar 4:2`',
      'Recognize aspect ratio intent from the prompt itself',
      'Should either honor prompt-level aspect ratio or expose a separate format control explicitly',
      'Returned image dimensions should reflect 4:2 rather than the hardcoded Lucid default',
      'No',
      'The generated image dimensions match the requested aspect ratio. Today this likely fails because the frontend forces 1120×630.',
      'This catches the current frontend/worker mismatch for Lucid formatting.',
    ],
    [
      'LO-3',
      'P1',
      'Lucid Origin capability',
      'Typography rendering',
      'With Lucid Origin selected: `vintage travel poster, bold slab serif title reading \"SLOW IS SACRED\", illustrated sea turtle as the central graphic, aged paper texture`',
      'Preserve quoted text and typography instructions exactly',
      'Direct image POST with the prompt unchanged apart from transport',
      'Generated image should attempt literal text rendering, not paraphrase or strip the quoted phrase',
      'Partial',
      'The output contains the intended short text phrase with a recognisable poster treatment, and the prompt text shown in chat matches the user input.',
      'Your graph documents Lucid Origin as strong on text rendering; this should be a first-class test.',
    ],
    [
      'LO-4',
      'P2',
      'Lucid Origin capability',
      'Meta tokens at prompt start',
      'With Lucid Origin selected: `stills archive, disney .com, a hyper-real Little Mermaid portrait emerging from the sea, cinematic realism`',
      'Preserve meta tokens at the beginning of the prompt because they carry weighting',
      'Direct image POST; no chat rewriting or “helpful” normalization of token phrases',
      'Prompt reaches the worker intact and the generated result is returned as an image URL',
      'Partial',
      'No prompt rewriting removes or rearranges the leading meta tokens before generation.',
      'The graph explicitly says these tokens should be placed early in the prompt.',
    ],
    [
      'LO-5',
      'P2',
      'Lucid Origin capability',
      'Long exposure / slow shutter style',
      'With Lucid Origin selected: `long exposure photograph, ancient stone turtle statue beside a roaring bonfire at night, silky flowing flame trails, luminous orange streaks, 4-second exposure, smoky atmosphere`',
      'Preserve camera-technique tokens and treat the whole message as the image prompt',
      'Direct image POST',
      'Generated output should be returned with no attempt to convert the request into a graph or text answer',
      'Yes',
      'The result is an image response only, and the prompt shown in chat still contains the long-exposure vocabulary.',
      'This uses the long-exposure prompt language documented in the graph.',
    ],
    [
      'LO-6',
      'P2',
      'Lucid Origin prompt contamination',
      'Transcript + image model',
      'Start with a pending transcription context, then with Lucid Origin selected send: `a calm church poster with the text \"areopagos.no\" in elegant gold letters`',
      'The image prompt should not be polluted by transcript context unless explicitly intended',
      'Should strip or isolate transcription context before image generation',
      'Only the user’s visual prompt should reach the image model',
      'No',
      'The generated prompt sent to /generate-image excludes the `[Transcription context]: ...` prefix. Today the code likely includes it.',
      'This is a hidden cross-feature bug in the current prompt assembly path.',
    ],
  ];
  const testRange = testSheet.getRange(address(11, testRows.length));
  testRange.values = testRows;
  testRange.format.autofitColumns();
  testRange.format.autofitRows();

  const exportBlob = await SpreadsheetFile.exportXlsx(workbook);
  await exportBlob.save(OUTPUT_XLSX);

  const summaryCheck = await workbook.inspect({
    kind: 'table',
    range: 'Summary!A1:C17',
    include: 'values',
    tableMaxRows: 20,
    tableMaxCols: 5,
  });

  const fulltextCheck = await workbook.inspect({
    kind: 'table',
    range: `Fulltext Elements!A1:I${Math.min(fulltextMatrix.length, 12)}`,
    include: 'values',
    tableMaxRows: 12,
    tableMaxCols: 9,
  });

  console.log(JSON.stringify({
    outputXlsx: OUTPUT_XLSX,
    outputJson: OUTPUT_JSON,
    summary,
    summaryCheck: summaryCheck.ndjson,
    fulltextCheck: fulltextCheck.ndjson,
  }, null, 2));
}

function countStatuses(rows) {
  return rows.reduce((acc, row) => {
    acc[row.gemmaStatus] = (acc[row.gemmaStatus] || 0) + 1;
    return acc;
  }, { Yes: 0, Partial: 0, No: 0 });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
