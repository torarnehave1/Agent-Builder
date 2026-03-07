import { useState } from 'react';
import { AuthBar, LanguageSelector } from 'vegvisr-ui-kit';
import AgentChat from './AgentChat';

interface Props {
  userId: string;
  userEmail: string;
  role?: string | null;
  language: string;
  onLanguageChange: (lang: 'en' | 'no') => void;
  onLogout: () => void;
}

export default function AgentBuilder({ userId, userEmail, language, onLanguageChange, onLogout }: Props) {
  const [graphId, setGraphId] = useState('graph_agent_builder_development');
  const [selectedAgentId] = useState<string | null>(null);

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-white">
      <header className="flex items-center justify-between px-4 h-[48px] border-b border-white/10 bg-slate-950/95 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold text-white">Vegvisr</span>
          <span className="text-sm text-purple-400">Agent</span>
        </div>
        <div className="flex items-center gap-3">
          <LanguageSelector value={language} onChange={onLanguageChange} />
          <AuthBar
            userEmail={userEmail}
            badgeLabel="Agent"
            signInLabel="Sign in"
            onSignIn={() => {}}
            logoutLabel="Log out"
            onLogout={onLogout}
          />
        </div>
      </header>

      <AgentChat userId={userId} graphId={graphId} onGraphChange={setGraphId} agentId={selectedAgentId} agentAvatarUrl={null} />
    </div>
  );
}
