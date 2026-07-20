import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlowProvider, type Node, type Edge, type NodeTypes } from '@xyflow/react';
import ContractCanvas from './ContractCanvas';
import AutomationNodePalette from './AutomationNodePalette';
import AutomationInspector from './AutomationInspector';
import StartNode from './nodes/automation/StartNode';
import ActionNode from './nodes/automation/ActionNode';
import DelayNode from './nodes/automation/DelayNode';
import LoopNode from './nodes/automation/LoopNode';
import NotifyNode from './nodes/automation/NotifyNode';
import NoteNode from './nodes/automation/NoteNode';
import {
  createAutomationNode,
  STEP_COLORS,
  type StepType,
} from '../lib/automation';
import {
  saveAutomation,
  loadAutomation,
  listAutomations,
  runAutomation,
  type AutomationSummary,
  type RunResult,
} from '../lib/automationToGraph';

interface Props {
  userEmail: string;
}

const AUTOMATION_NODE_TYPES: NodeTypes = {
  start: StartNode,
  action: ActionNode,
  delay: DelayNode,
  loop: LoopNode,
  notify: NotifyNode,
  note: NoteNode,
};

function minimapColor(node: Node): string {
  return STEP_COLORS[(node.type || 'note') as StepType] || '#64748b';
}

// A blank automation seeds a single Start anchor.
function seedNodes(): Node[] {
  return [createAutomationNode('start', { x: 320, y: 80 })];
}

export default function AutomationTab({ userEmail }: Props) {
  const [nodes, setNodes] = useState<Node[]>(seedNodes);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [automationId, setAutomationId] = useState<string | null>(null);
  const [title, setTitle] = useState('Untitled automation');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [summaries, setSummaries] = useState<AutomationSummary[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [runForReal, setRunForReal] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);

  // Latest nodes, read (not subscribed) by add handlers so we don't nest setState.
  const nodesRef = useRef(nodes);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

  const addNodeAt = useCallback((type: StepType, position: { x: number; y: number }) => {
    const node = createAutomationNode(type, position);
    setNodes((prev) => [...prev, node]);
    setSelectedNode(node);
  }, []);

  const handleAddNode = useCallback((type: StepType) => {
    // Click-to-add: drop near canvas centre with a per-count offset.
    const prev = nodesRef.current;
    const node = createAutomationNode(type, { x: 300 + prev.length * 20, y: 220 + prev.length * 20 });
    setNodes([...prev, node]);
    setSelectedNode(node);
  }, []);

  const handleUpdateNode = useCallback((id: string, data: Record<string, unknown>) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, data } : n)));
    setSelectedNode((prev) => (prev && prev.id === id ? { ...prev, data } : prev));
  }, []);

  const handleDeleteNode = useCallback((id: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.source !== id && e.target !== id));
    setSelectedNode((prev) => (prev && prev.id === id ? null : prev));
  }, []);

  const handleDeleteNodes = useCallback((deleted: Node[]) => {
    const ids = new Set(deleted.map((n) => n.id));
    setEdges((prev) => prev.filter((e) => !ids.has(e.source) && !ids.has(e.target)));
    setSelectedNode((prev) => (prev && ids.has(prev.id) ? null : prev));
  }, []);

  const handleNew = useCallback(() => {
    setNodes(seedNodes());
    setEdges([]);
    setSelectedNode(null);
    setAutomationId(null);
    setTitle('Untitled automation');
    setDescription('');
    setStatus(null);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setStatus(null);
    try {
      const id = automationId || crypto.randomUUID();
      const { newVersion } = await saveAutomation(id, nodes, edges, {
        title,
        description,
        createdBy: userEmail,
      });
      setAutomationId(id);
      setStatus(`Saved · v${newVersion ?? '?'}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [automationId, nodes, edges, title, description, userEmail]);

  const handleRun = useCallback(async () => {
    setRunning(true);
    setStatus(null);
    setRunResult(null);
    try {
      // Always persist the current canvas first, so the run reflects what's on screen.
      const id = automationId || crypto.randomUUID();
      await saveAutomation(id, nodes, edges, { title, description, createdBy: userEmail });
      setAutomationId(id);
      const result = await runAutomation(id, !runForReal, userEmail);
      setRunResult(result);
      setStatus(
        `Ran ${result.dryRun ? '(dry)' : '(live)'} · ${result.summary.executed} run / ${result.summary.simulated} sim / ${result.summary.errors} err`
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Run failed');
    } finally {
      setRunning(false);
    }
  }, [automationId, nodes, edges, title, description, userEmail, runForReal]);

  const openPicker = useCallback(async () => {
    setPickerOpen(true);
    setLoadingList(true);
    try {
      setSummaries(await listAutomations());
    } catch {
      setSummaries([]);
    } finally {
      setLoadingList(false);
    }
  }, []);

  const handleOpen = useCallback(async (id: string) => {
    setPickerOpen(false);
    setStatus('Loading…');
    try {
      const loaded = await loadAutomation(id);
      setNodes(loaded.nodes.length ? loaded.nodes : seedNodes());
      setEdges(loaded.edges);
      setSelectedNode(null);
      setAutomationId(id);
      setTitle(loaded.meta.title);
      setDescription(loaded.meta.description || '');
      setStatus('Loaded');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Load failed');
    }
  }, []);

  const nodeTypes = useMemo(() => AUTOMATION_NODE_TYPES, []);

  return (
    <div className="flex flex-1 min-h-0">
      {/* Canvas */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 h-[44px] border-b border-white/10 bg-slate-950/70 flex-shrink-0">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded bg-slate-900/60 border border-white/8 px-3 py-1 text-[13px] text-white w-[240px] focus:outline-none focus:border-purple-500/50"
            placeholder="Automation name"
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md border border-purple-500/40 bg-purple-500/20 px-3 py-1 text-[12px] font-semibold text-purple-200 hover:bg-purple-500/30 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={openPicker}
            className="rounded-md border border-white/10 bg-white/5 px-3 py-1 text-[12px] text-white/80 hover:bg-white/10"
          >
            Open
          </button>
          <button
            type="button"
            onClick={handleNew}
            className="rounded-md border border-white/10 bg-white/5 px-3 py-1 text-[12px] text-white/80 hover:bg-white/10"
          >
            New
          </button>
          <div className="mx-1 h-5 w-px bg-white/10" />
          <button
            type="button"
            onClick={handleRun}
            disabled={running}
            className={`rounded-md border px-3 py-1 text-[12px] font-semibold disabled:opacity-50 ${
              runForReal
                ? 'border-rose-500/50 bg-rose-500/20 text-rose-200 hover:bg-rose-500/30'
                : 'border-emerald-500/50 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30'
            }`}
            title={runForReal ? 'Execute steps for real' : 'Simulate — no side effects'}
          >
            {running ? 'Running…' : runForReal ? '▶ Run for real' : '▶ Run (dry)'}
          </button>
          <label className="flex items-center gap-1.5 text-[11px] text-white/60 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={runForReal}
              onChange={(e) => setRunForReal(e.target.checked)}
              className="w-3.5 h-3.5 accent-rose-500"
            />
            Run for real
          </label>
          {status && <span className="text-[11px] text-white/50">{status}</span>}
          {automationId && (
            <a
              href={`https://www.vegvisr.org/gnew-viewer?graphId=${automationId}`}
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-[11px] text-sky-400 hover:underline"
            >
              View graph ↗
            </a>
          )}
        </div>

        <ReactFlowProvider>
          <div className="flex flex-1 min-h-0 relative">
            <ContractCanvas
              initialNodes={nodes}
              initialEdges={edges}
              nodeTypes={nodeTypes}
              minimapNodeColor={minimapColor}
              onNodeSelect={setSelectedNode}
              onNodesChange={setNodes}
              onEdgesChange={setEdges}
              onDropNode={(type, position) => addNodeAt(type as StepType, position)}
              onDeleteNodes={handleDeleteNodes}
            />
          </div>
        </ReactFlowProvider>
      </div>

      {/* Right rail: palette + inspector */}
      <div className="w-[280px] flex-shrink-0 border-l border-white/10 bg-slate-950/85 overflow-y-auto flex flex-col">
        <div className="flex-1 px-3 py-4 space-y-5">
          <section>
            <SectionLabel>DRAG TO ADD</SectionLabel>
            <AutomationNodePalette onAddNode={handleAddNode} />
          </section>
          <div className="border-t border-white/8" />
          <section>
            <SectionLabel>STEP INSPECTOR</SectionLabel>
            <AutomationInspector
              selectedNode={selectedNode}
              onUpdateNode={handleUpdateNode}
              onDeleteNode={handleDeleteNode}
            />
          </section>
          <div className="border-t border-white/8" />
          <section>
            <SectionLabel>DESCRIPTION</SectionLabel>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What does this automation do?"
              className="w-full rounded bg-slate-950/60 border border-white/8 px-2 py-1.5 text-[11px] text-white focus:outline-none focus:border-purple-500/50"
            />
          </section>
          {runResult && (
            <>
              <div className="border-t border-white/8" />
              <section>
                <SectionLabel>
                  RUN LOG {runResult.dryRun ? '(dry-run)' : '(live)'}
                </SectionLabel>
                <div className="text-[10px] text-white/50 mb-2">
                  {runResult.summary.executed} run · {runResult.summary.simulated} sim · {runResult.summary.errors} err
                  {runResult.summary.capped && ' · capped'}
                </div>
                <div className="space-y-1">
                  {runResult.steps.map((s, i) => (
                    <div key={`${s.nodeId}-${i}`} className="rounded border border-white/8 bg-slate-950/50 px-2 py-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[9px] font-semibold uppercase ${statusColor(s.status)}`}>{s.status}</span>
                        <span className="text-[11px] text-white/80 truncate">{s.label}</span>
                      </div>
                      <div className="text-[10px] text-white/45 truncate">{s.detail}</div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>

      {/* Open picker */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setPickerOpen(false)}>
          <div className="w-[480px] max-h-[70vh] overflow-y-auto rounded-xl border border-white/10 bg-slate-900 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold text-white mb-3">Open automation</div>
            {loadingList && <div className="text-xs text-white/50">Loading…</div>}
            {!loadingList && summaries.length === 0 && (
              <div className="text-xs text-white/50">No saved automations yet.</div>
            )}
            <div className="space-y-1">
              {summaries.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => handleOpen(s.id)}
                  className="w-full text-left rounded-lg border border-white/8 bg-white/5 px-3 py-2 hover:bg-white/10"
                >
                  <div className="text-[13px] text-white">{s.title}</div>
                  {s.description && <div className="text-[11px] text-white/50 truncate">{s.description}</div>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold text-gray-500 tracking-[0.05em] mb-2">{children}</div>;
}

function statusColor(status: string): string {
  switch (status) {
    case 'ok': return 'text-emerald-400';
    case 'simulated': return 'text-sky-400';
    case 'error': return 'text-rose-400';
    default: return 'text-slate-500';
  }
}
