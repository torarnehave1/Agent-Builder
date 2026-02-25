import { useState, useRef, useEffect } from 'react';
import type { AgentExecutionResult, ExecutionLogEntry } from '../types/contract';

interface Props {
  userId: string;
  contractId: string;
  contractName: string;
  graphId: string;
}

type StreamPhase =
  | 'idle'
  | 'sending'
  | 'fetching_contract'
  | 'planning'
  | 'executing_tools'
  | 'generating'
  | 'saving'
  | 'complete'
  | 'error';

interface StreamStep {
  phase: StreamPhase;
  label: string;
  detail?: string;
  timestamp: number;
  done: boolean;
}

const AGENT_API = 'https://agent.vegvisr.org';

const PHASE_LABELS: Record<StreamPhase, string> = {
  idle: 'Ready',
  sending: 'Sending request to agent...',
  fetching_contract: 'Fetching contract...',
  planning: 'Agent is planning...',
  executing_tools: 'Executing tools...',
  generating: 'Generating content...',
  saving: 'Saving to graph...',
  complete: 'Done',
  error: 'Error',
};

export default function AgentExecutor({ userId, contractId, contractName, graphId }: Props) {
  const [task, setTask] = useState('');
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<AgentExecutionResult | null>(null);
  const [error, setError] = useState('');
  const [steps, setSteps] = useState<StreamStep[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const stepsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest step
  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [steps]);

  // Elapsed time ticker
  useEffect(() => {
    if (executing) {
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startTimeRef.current);
      }, 100);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [executing]);

  const addStep = (phase: StreamPhase, detail?: string) => {
    setSteps(prev => {
      // Mark previous steps as done
      const updated = prev.map(s => ({ ...s, done: true }));
      return [...updated, {
        phase,
        label: PHASE_LABELS[phase],
        detail,
        timestamp: Date.now(),
        done: phase === 'complete' || phase === 'error',
      }];
    });
  };

  const executeKnowledgeGraphMe = () => {
    const autoTask = `Document contract: ${contractId} ("${contractName}"). Fetch this contract using get_contract, then create an agent-contract node with the full contract JSON, an agent-config node with the agent configuration, and an agent-run node documenting this execution. Connect them with edges.`;
    setTask(autoTask);
    setTimeout(() => executeAgentWithTask(autoTask, 'contract_knowledge_graph_me'), 0);
  };

  const buildHtmlPage = async () => {
    setExecuting(true);
    setError('');
    setResult(null);
    setSteps([]);
    addStep('building', 'Creating HTML page...');

    try {
      const response = await fetch(`${AGENT_API}/build-html-page`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graphId,
          title: contractName || 'Untitled Page',
          userId,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to build HTML page');

      addStep('complete', `HTML page created: ${data.nodeId}`);
      setResult({
        success: true,
        turns: 0,
        executionLog: [{
          phase: 'complete',
          detail: data.message,
          viewUrl: data.viewUrl,
        }],
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      addStep('error', msg);
    } finally {
      setExecuting(false);
    }
  };

  const executeAgent = async () => {
    if (!task.trim()) return;
    executeAgentWithTask(task.trim());
  };

  const executeAgentWithTask = async (taskText: string, overrideContractId?: string) => {
    if (!taskText.trim()) return;
    setExecuting(true);
    setError('');
    setResult(null);
    setSteps([]);
    setElapsedMs(0);

    addStep('sending');

    try {
      // Simulate progress phases based on typical agent execution flow
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort('Agent execution timed out after 5 minutes'), 300_000);

      addStep('fetching_contract', `Contract: ${contractId}`);

      const response = await fetch(`${AGENT_API}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: 'agent_kg_html_builder',
          task: taskText,
          userId,
          contractId: overrideContractId || contractId || 'contract_dark_glass',
          graphId,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Agent error: ${response.status}`);
      }

      addStep('planning');

      const data: AgentExecutionResult = await response.json();

      // Parse execution log to show real progress
      if (data.executionLog) {
        for (const entry of data.executionLog) {
          if (entry.type === 'tool_calls') {
            const toolNames = entry.tools?.map(t => t.name).join(', ') || 'tools';
            addStep('executing_tools', toolNames);
          } else if (entry.type === 'tool_result' && entry.tool) {
            if (entry.tool === 'create_graph' || entry.tool === 'add_node') {
              addStep('saving', `${entry.tool}: ${entry.success ? 'OK' : 'failed'}`);
            }
          }
        }
      }

      addStep('complete', `${data.turns} turns, ${data.executionLog?.length || 0} events`);
      setResult(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Execution failed';
      addStep('error', msg);
      setError(msg);
    } finally {
      setExecuting(false);
    }
  };

  const copyLog = async () => {
    const lines: string[] = [];
    lines.push(`=== Agent Execution Log ===`);
    lines.push(`Task: ${task}`);
    lines.push(`Contract: ${contractId} ("${contractName}")`);
    lines.push(`Graph: ${graphId}`);
    lines.push(`Time: ${formatTime(elapsedMs)}`);
    lines.push('');

    // Streaming steps
    if (steps.length > 0) {
      lines.push('--- Streaming Progress ---');
      for (const step of steps) {
        const status = step.done ? (step.phase === 'error' ? 'ERR' : 'OK') : '...';
        lines.push(`${status} [${step.phase}] ${step.label}${step.detail ? ` — ${step.detail}` : ''}`);
      }
      lines.push('');
    }

    // Full API execution log
    if (result?.executionLog) {
      lines.push('--- Full Execution Log ---');
      for (const entry of result.executionLog) {
        const ts = entry.timestamp || '';
        if (entry.type === 'agent_thinking') {
          lines.push(`[turn ${entry.turn}] thinking ${ts}`);
        } else if (entry.type === 'tool_calls') {
          const tools = entry.tools?.map((t: { name: string; input?: unknown }) =>
            `${t.name}(${JSON.stringify(t.input)})`
          ).join(', ') || '';
          lines.push(`[turn ${entry.turn}] tool_calls: ${tools}`);
        } else if (entry.type === 'tool_result') {
          lines.push(`[turn ${entry.turn}] tool_result: ${entry.tool} ${entry.success ? 'OK' : 'FAIL'} ${JSON.stringify(entry.result ?? entry.error ?? '')}`);
        } else if (entry.type === 'tool_error') {
          lines.push(`[turn ${entry.turn}] tool_error: ${entry.tool} — ${entry.error}`);
        } else if (entry.type === 'agent_complete') {
          lines.push(`[turn ${entry.turn}] agent_complete: ${entry.response?.substring(0, 500) || ''}`);
        } else if (entry.type === 'error') {
          lines.push(`[turn ${entry.turn}] ERROR: ${entry.error}`);
        } else {
          lines.push(`[turn ${entry.turn}] ${entry.type}: ${JSON.stringify(entry)}`);
        }
      }
      lines.push('');
      lines.push(`Turns: ${result.turns}, Success: ${result.success}`);
    }

    // Error
    if (error) {
      lines.push(`\nERROR: ${error}`);
    }

    await navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const remainS = s % 60;
    return m > 0 ? `${m}m ${remainS}s` : `${s}.${Math.floor((ms % 1000) / 100)}s`;
  };

  return (
    <div className="space-y-3">
      {/* Task Input */}
      <textarea
        value={task}
        onChange={(e) => setTask(e.target.value)}
        placeholder="Create a landing page for my photography portfolio"
        rows={3}
        className="w-full rounded-lg bg-slate-950/60 border border-white/8 px-3 py-2.5 text-[11px] text-white placeholder:text-gray-600 focus:outline-none focus:border-purple-500/50 resize-none"
      />

      {/* Graph target indicator */}
      <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        Target: <span className="text-purple-400 font-mono truncate">{graphId}</span>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        <button
          onClick={executeAgent}
          disabled={executing || !task.trim()}
          className="flex-1 rounded-lg bg-gradient-to-r from-purple-600 to-purple-700 py-2.5 text-[13px] font-bold text-white shadow-lg shadow-purple-900/30 hover:from-purple-500 hover:to-purple-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          {executing ? (
            <span className="flex items-center justify-center gap-2">
              <Spinner />
              {formatTime(elapsedMs)}
            </span>
          ) : (
            'Execute'
          )}
        </button>
        <button
          onClick={executeKnowledgeGraphMe}
          disabled={executing}
          title={`Document "${contractName}" as a knowledge graph`}
          className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2.5 text-[11px] font-semibold text-cyan-400 hover:bg-cyan-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all whitespace-nowrap"
        >
          KG:ME
        </button>
        <button
          onClick={buildHtmlPage}
          disabled={executing}
          title={`Build HTML page for graph ${graphId}`}
          className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-[11px] font-semibold text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all whitespace-nowrap"
        >
          Build Page
        </button>
      </div>

      {/* Streaming Progress */}
      {steps.length > 0 && (
        <div className="space-y-0.5">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[10px] font-semibold text-gray-500 tracking-wide">
              EXECUTION LOG
            </div>
            <button
              onClick={copyLog}
              className="text-[9px] text-gray-500 hover:text-white transition-colors px-1.5 py-0.5 rounded border border-white/8 hover:border-white/20"
            >
              {copied ? 'Copied!' : 'Copy Log'}
            </button>
          </div>
          {steps.map((step, i) => (
            <StepRow key={i} step={step} index={i} />
          ))}
          <div ref={stepsEndRef} />
        </div>
      )}

      {/* Error */}
      {error && !executing && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
          {error}
        </div>
      )}

      {/* Final execution log from API */}
      {result && (
        <div className="space-y-1">
          {result.executionLog
            .filter((e: ExecutionLogEntry) => ['tool_calls', 'tool_result', 'agent_complete', 'error'].includes(e.type))
            .map((entry: ExecutionLogEntry, i: number) => (
              <LogEntry key={i} entry={entry} index={i} />
            ))}

          {/* View in GNewViewer link */}
          <a
            href={`https://www.vegvisr.org/gnew-viewer?graphId=${encodeURIComponent(graphId)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg border border-purple-600/20 bg-purple-600/5 px-3 py-2 text-[11px] text-purple-400 hover:bg-purple-600/10 transition-colors mt-2"
          >
            View in GNewViewer
          </a>
        </div>
      )}
    </div>
  );
}

function StepRow({ step, index }: { step: StreamStep; index: number }) {
  const phaseColors: Record<string, string> = {
    sending: 'text-blue-400',
    fetching_contract: 'text-sky-400',
    planning: 'text-amber-400',
    executing_tools: 'text-orange-400',
    generating: 'text-purple-400',
    saving: 'text-cyan-400',
    complete: 'text-emerald-400',
    error: 'text-red-400',
  };

  const dotColors: Record<string, string> = {
    sending: 'bg-blue-500',
    fetching_contract: 'bg-sky-500',
    planning: 'bg-amber-500',
    executing_tools: 'bg-orange-500',
    generating: 'bg-purple-500',
    saving: 'bg-cyan-500',
    complete: 'bg-emerald-500',
    error: 'bg-red-500',
  };

  return (
    <div className="flex items-start gap-2 py-1">
      {/* Timeline dot + line */}
      <div className="flex flex-col items-center pt-1">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColors[step.phase] || 'bg-gray-500'} ${!step.done ? 'animate-pulse' : ''}`} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-600 font-mono w-3">{index + 1}</span>
          <span className={`text-[10px] font-medium ${phaseColors[step.phase] || 'text-gray-400'}`}>
            {step.label}
          </span>
          {!step.done && <Spinner small />}
        </div>
        {step.detail && (
          <div className="text-[9px] text-gray-600 font-mono ml-[18px] truncate">
            {step.detail}
          </div>
        )}
      </div>
    </div>
  );
}

function LogEntry({ entry, index }: { entry: ExecutionLogEntry; index: number }) {
  const isOk = entry.type === 'agent_complete' || (entry.type === 'tool_result' && entry.success);
  const isError = entry.type === 'error' || (entry.type === 'tool_result' && !entry.success);

  let label = '';
  if (entry.type === 'tool_calls') {
    label = entry.tools?.map(t => t.name).join(', ') || 'tool call';
  } else if (entry.type === 'tool_result') {
    label = entry.tool || 'result';
  } else if (entry.type === 'agent_complete') {
    label = 'Complete';
  } else if (entry.type === 'error') {
    label = entry.error || 'Error';
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-white/6 bg-slate-900/30 px-3 py-1.5">
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
        isOk ? 'bg-emerald-500' : isError ? 'bg-red-500' : 'bg-amber-500'
      }`} />
      <span className="text-[10px] text-gray-500 font-mono w-4">{index + 1}.</span>
      <span className="text-[10px] text-gray-400 font-mono flex-1 truncate">{label}</span>
      <span className={`text-[9px] font-mono font-semibold ${
        isOk ? 'text-emerald-400' : isError ? 'text-red-400' : 'text-amber-400'
      }`}>
        {isOk ? 'OK' : isError ? 'ERR' : '...'}
      </span>
    </div>
  );
}

function Spinner({ small }: { small?: boolean }) {
  const size = small ? 'w-2.5 h-2.5' : 'w-3.5 h-3.5';
  return (
    <svg className={`${size} animate-spin text-purple-400`} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-20" />
      <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
