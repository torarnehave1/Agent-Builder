import { useState } from 'react';
import { AuthBar, LanguageSelector } from 'vegvisr-ui-kit';
import AgentChat from './AgentChat';
import DataExplorer from './DataExplorer';
import HtmlPreview from './HtmlPreview';

type View = 'chat' | 'data';

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
  const [view, setView] = useState<View>('chat');
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-white">
      <header className="flex items-center justify-between px-4 h-[48px] border-b border-white/10 bg-slate-950/95 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold text-white">Vegvisr</span>
          <span className="text-sm text-purple-400">Agent</span>
          <nav className="flex items-center gap-1 ml-4">
            {(['chat', 'data'] as const).map((tab) => (
              <button
                type="button"
                key={tab}
                onClick={() => setView(tab)}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  view === tab
                    ? 'bg-white/10 text-white'
                    : 'text-white/50 hover:text-white/80'
                }`}
              >
                {tab === 'chat' ? 'Chat' : 'Data'}
              </button>
            ))}
          </nav>
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

      {view === 'chat' && !previewHtml && (
        <AgentChat
          userId={userId}
          graphId={graphId}
          onGraphChange={setGraphId}
          agentId={selectedAgentId}
          agentAvatarUrl={null}
          onPreview={setPreviewHtml}
        />
      )}
      {view === 'chat' && previewHtml && (
        <div className="flex flex-1 min-h-0">
          <div className="w-[40%] min-w-[320px] flex flex-col min-h-0 border-r border-white/10">
            <AgentChat
              userId={userId}
              graphId={graphId}
              onGraphChange={setGraphId}
              agentId={selectedAgentId}
              agentAvatarUrl={null}
              onPreview={setPreviewHtml}
            />
          </div>
          <div className="flex-1 flex min-w-0">
            <HtmlPreview html={previewHtml} onClose={() => setPreviewHtml(null)} />
          </div>
        </div>
      )}
      {view === 'data' && <DataExplorer />}
    </div>
  );
}
