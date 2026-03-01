import { useState, useEffect, useRef } from 'react';

interface AgentInfo {
  id: string;
  name: string;
  description?: string;
  avatar_url?: string;
}

interface Props {
  agentId: string | null;
  onAgentChange: (agentId: string | null) => void;
  onNewAgent: () => void;
}

const AGENT_API = 'https://agent.vegvisr.org';

export default function AgentSelector({ agentId, onAgentChange, onNewAgent }: Props) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Load available agents
  useEffect(() => {
    fetch(`${AGENT_API}/agents`)
      .then(res => res.json())
      .then(data => {
        if (data.agents) setAgents(data.agents);
      })
      .catch(() => {});
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as HTMLElement)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const currentAgent = agents.find(a => a.id === agentId);
  const displayName = currentAgent?.name || (agentId ? agentId : 'Default Agent');

  return (
    <div className="relative ml-2" ref={ref}>
      <button
        onClick={() => setOpen(prev => !prev)}
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
      >
        {currentAgent?.avatar_url ? (
          <img src={currentAgent.avatar_url} alt="" className="w-4 h-4 rounded-full object-cover" />
        ) : (
          <div className="w-4 h-4 rounded-full bg-emerald-600/40 flex items-center justify-center text-[8px] text-emerald-300 font-bold">
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}
        <span className="max-w-[140px] truncate">{displayName}</span>
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-[280px] rounded-lg border border-white/10 bg-slate-900/95 backdrop-blur-sm shadow-2xl z-50 overflow-hidden">
          {/* New agent button */}
          <button
            onClick={() => { onNewAgent(); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-emerald-400 hover:bg-emerald-600/10 border-b border-white/5"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Agent
          </button>

          {/* Default agent option */}
          <button
            onClick={() => { onAgentChange(null); setOpen(false); }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/5 transition-colors ${
              !agentId ? 'bg-emerald-600/10 border-l-2 border-emerald-500' : ''
            }`}
          >
            <div className="w-6 h-6 rounded-full bg-purple-600/30 flex items-center justify-center text-[9px] text-purple-300 font-bold flex-shrink-0">
              D
            </div>
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-[11px] text-white truncate">Default Agent</span>
              <span className="text-[9px] text-gray-500">All tools, standard prompt</span>
            </div>
          </button>

          {/* Agent list */}
          <div className="max-h-[280px] overflow-y-auto">
            {agents.map(a => (
              <button
                key={a.id}
                onClick={() => { onAgentChange(a.id); setOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/5 transition-colors ${
                  a.id === agentId ? 'bg-emerald-600/10 border-l-2 border-emerald-500' : ''
                }`}
              >
                {a.avatar_url ? (
                  <img src={a.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-emerald-600/30 flex items-center justify-center text-[9px] text-emerald-300 font-bold flex-shrink-0">
                    {a.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[11px] text-white truncate">{a.name}</span>
                  {a.description && (
                    <span className="text-[9px] text-gray-500 truncate">{a.description}</span>
                  )}
                </div>
              </button>
            ))}
            {agents.length === 0 && (
              <div className="px-3 py-4 text-[11px] text-gray-600 text-center">
                No agents created yet
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
