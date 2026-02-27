/** Contract JSON schema — matches agent_contracts.contract_json in D1 */

export interface ContractCSS {
  designSystem?: string;
  colorTokens?: Record<string, string>;
  fontStack?: string;
  borderRadius?: string;
  reuseThemeFrom?: string | null;
}

export interface ContractFeatures {
  [key: string]: boolean;
}

export interface ContractContent {
  sections?: string[];
  menuMode?: 'none' | 'hamburger' | 'sidebar' | 'top';
  imageStrategy?: 'pexels' | 'unsplash' | 'none' | 'custom';
  language?: string;
}

export interface ContractValidation {
  mustContain?: string[];
  maxSizeKb?: number;
  requiredFields?: string[];
}

export interface ContractSafety {
  sanitizer?: string;
  renderer?: string;
  noExternalScripts?: boolean;
}

export interface ContractNode {
  templateId?: string;
  type?: string;
  label?: string;
  css?: ContractCSS;
  features?: ContractFeatures;
  content?: ContractContent;
  validation?: ContractValidation;
  safety?: ContractSafety;
}

export interface ContractGraph {
  targetGraphId?: string;
  createNew?: boolean;
  title?: string;
  tags?: string[];
}

export interface ContractTools {
  enabled?: string[];
}

export interface AgentContract {
  version?: string;
  type?: string;
  graph?: ContractGraph;
  node?: ContractNode;
  tools?: ContractTools;
  userPrompt?: string;
  _templateExample?: {
    name: string;
    nodes: unknown[] | null;
  };
}

export interface AgentConfig {
  id: string;
  name: string;
  description?: string;
  system_prompt: string;
  model: string;
  max_tokens: number;
  temperature: number;
  tools: string[];
  metadata: Record<string, unknown>;
  default_contract_id?: string;
  is_active: boolean;
}

export interface ExecutionLogEntry {
  turn?: number;
  type: string;
  timestamp?: string;
  tools?: Array<{ name: string; input: unknown }>;
  tool?: string;
  success?: boolean;
  result?: unknown;
  error?: string;
  response?: string;
  stop_reason?: string;
  phase?: string;
  detail?: string;
  viewUrl?: string;
}

export interface AgentExecutionResult {
  success: boolean;
  turns: number;
  executionLog: ExecutionLogEntry[];
}
