/**
 * Automation model — the vocabulary of a drag-and-drop automation flow.
 *
 * An automation is a directed graph of steps. Each React Flow node is one step whose
 * `type` is the stepType below, and whose `data` holds that step's config. The flow is
 * persisted as a Knowledge Graph (one graph per automation) — see automationToGraph.ts.
 *
 * Scope note: this is the BUILDER + STORAGE slice. Nothing executes these steps yet.
 */
import type { Node } from '@xyflow/react';
import { TOOL_CATALOG } from './toolCatalog';

export type StepType = 'start' | 'action' | 'delay' | 'loop' | 'notify' | 'note';

// Per-step data shapes (also the React Flow node `data`). Index signature keeps
// them assignable to React Flow's Record<string, unknown> node data.
export interface StartData { label: string; [key: string]: unknown }
export interface ActionData { label: string; toolName: string; params: Record<string, unknown>; [key: string]: unknown }
export interface DelayData { label: string; amount: number; unit: 'seconds' | 'minutes' | 'hours'; [key: string]: unknown }
export interface LoopData { label: string; over: string; times: number; [key: string]: unknown }
export interface NotifyData { label: string; channel: string; message: string; [key: string]: unknown }
export interface NoteData { text: string; [key: string]: unknown }

export type StepData = StartData | ActionData | DelayData | LoopData | NotifyData | NoteData;

export interface PaletteItem {
  stepType: StepType;
  label: string;
  color: 'purple' | 'amber' | 'blue' | 'green' | 'rose' | 'slate';
}

// The drag-source palette. Order = display order.
export const AUTOMATION_PALETTE: PaletteItem[] = [
  { stepType: 'start', label: '▶ Start', color: 'purple' },
  { stepType: 'action', label: '⚙ Action', color: 'amber' },
  { stepType: 'delay', label: '⏱ Delay', color: 'blue' },
  { stepType: 'loop', label: '↻ Loop', color: 'green' },
  { stepType: 'notify', label: '🔔 Notify', color: 'rose' },
  { stepType: 'note', label: '📝 Note', color: 'slate' },
];

/** Minimap / accent colour per step type (hex, for the React Flow MiniMap). */
export const STEP_COLORS: Record<StepType, string> = {
  start: '#7c3aed',
  action: '#f59e0b',
  delay: '#3b82f6',
  loop: '#22c55e',
  notify: '#f43f5e',
  note: '#64748b',
};

const DEFAULT_TOOL = TOOL_CATALOG[0];

/** Build a fresh React Flow node for a step type, offset so drops don't stack. */
export function createAutomationNode(
  stepType: StepType,
  position: { x: number; y: number },
): Node {
  const id = `${stepType}-${Date.now()}`;
  switch (stepType) {
    case 'start':
      return { id, type: 'start', position, data: { label: 'Start' } satisfies StartData };
    case 'action':
      return {
        id,
        type: 'action',
        position,
        data: {
          label: DEFAULT_TOOL.displayName,
          toolName: DEFAULT_TOOL.name,
          params: {},
        } satisfies ActionData,
      };
    case 'delay':
      return { id, type: 'delay', position, data: { label: 'Delay', amount: 5, unit: 'minutes' } satisfies DelayData };
    case 'loop':
      return { id, type: 'loop', position, data: { label: 'Loop', over: '', times: 3 } satisfies LoopData };
    case 'notify':
      return { id, type: 'notify', position, data: { label: 'Notify', channel: 'email', message: '' } satisfies NotifyData };
    case 'note':
      return { id, type: 'note', position, data: { text: 'Note…' } satisfies NoteData };
    default:
      return { id, type: 'note', position, data: { text: '' } satisfies NoteData };
  }
}

/** One-line human summary of a step, stored in the KG node `info` for viewer readability. */
export function stepSummary(stepType: StepType, data: StepData): string {
  switch (stepType) {
    case 'start':
      return 'Automation start';
    case 'action': {
      const d = data as ActionData;
      const params = d.params && Object.keys(d.params).length ? ` (${Object.keys(d.params).join(', ')})` : '';
      return `Run tool: ${d.toolName}${params}`;
    }
    case 'delay': {
      const d = data as DelayData;
      return `Wait ${d.amount} ${d.unit}`;
    }
    case 'loop': {
      const d = data as LoopData;
      return `Loop ${d.times}×${d.over ? ` over ${d.over}` : ''}`;
    }
    case 'notify': {
      const d = data as NotifyData;
      return `Notify via ${d.channel}: ${d.message}`;
    }
    case 'note':
      return (data as NoteData).text || 'Note';
    default:
      return '';
  }
}
