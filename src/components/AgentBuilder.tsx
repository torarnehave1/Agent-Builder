import { useState } from 'react';
import { AuthBar, LanguageSelector } from 'vegvisr-ui-kit';
import AgentChat from './AgentChat';
import AgentSettings from './AgentSettings';
import DataExplorer from './DataExplorer';
import HtmlPreview from './HtmlPreview';
import ModelSettings, { getStoredModel } from './ModelSettings';
import UsageDashboard from './UsageDashboard';

type View = 'chat' | 'data' | 'agents' | 'settings' | 'usage';

interface Props {
  userId: string;
  userEmail: string;
  role?: string | null;
  language: string;
  onLanguageChange: (lang: 'en' | 'no') => void;
  onLogout: () => void;
}

export default function AgentBuilder({ userId, userEmail, language, onLanguageChange, onLogout }: Props) {
  const [graphId, setGraphId] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [view, setView] = useState<View>('chat');
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [consoleErrors, setConsoleErrors] = useState<string[] | null>(null);
  const [activeHtmlNodeId, setActiveHtmlNodeId] = useState<string | null>(null);
  const [model, setModel] = useState(getStoredModel);

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-slate-950 text-white">
      <header className="flex items-center justify-between px-4 h-[48px] border-b border-white/10 bg-slate-950/95 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold text-white">Vegvisr</span>
          <span className="text-sm text-purple-400">Agent</span>
          <nav className="flex items-center gap-1 ml-4">
            {(['chat', 'agents', 'data', 'usage', 'settings'] as const).map((tab) => (
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
                {tab === 'chat' ? 'Chat' : tab === 'agents' ? 'Agents' : tab === 'data' ? 'Data' : tab === 'usage' ? 'Usage' : 'Settings'}
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

      {view === 'chat' && (
        <div className={`flex flex-1 min-h-0 ${previewHtml ? '' : ''}`}>
          <div className={previewHtml ? 'w-[40%] min-w-[320px] flex flex-col min-h-0 border-r border-white/10' : 'flex-1 flex flex-col min-h-0'}>
            <AgentChat
              userId={userId}
              graphId={graphId}
              onGraphChange={setGraphId}
              agentId={selectedAgentId}
              agentAvatarUrl={null}
              onPreview={setPreviewHtml}
              consoleErrors={consoleErrors}
              onConsoleErrorsHandled={() => setConsoleErrors(null)}
              onActiveHtmlNode={setActiveHtmlNodeId}
              model={model}
            />
          </div>
          {previewHtml && (
            <div className="flex-1 flex min-w-0">
              <HtmlPreview
                html={previewHtml}
                onClose={() => { setPreviewHtml(null); setActiveHtmlNodeId(null); }}
                onConsoleErrors={setConsoleErrors}
                onHtmlChange={setPreviewHtml}
                graphId={graphId}
                nodeId={activeHtmlNodeId}
              />
            </div>
          )}
        </div>
      )}
      {view === 'agents' && (
        <AgentSettings
          agentId={selectedAgentId}
          userId={userId}
          onSave={() => {}}
          onCancel={() => setSelectedAgentId(null)}
          onSelectAgent={setSelectedAgentId}
        />
      )}
      {view === 'data' && <DataExplorer />}
      {view === 'usage' && <UsageDashboard userId={userId} />}
      {view === 'settings' && (
        <ModelSettings model={model} onChange={setModel} />
      )}
    </div>
  );
}
