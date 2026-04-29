import { useState } from 'react';
import { AuthBar, LanguageSelector } from 'vegvisr-ui-kit';
import AgentChat from './AgentChat';
import VegvisrAgentChat from './VegvisrAgentChat';
import AgentSettings from './AgentSettings';
import DataExplorer from './DataExplorer';
import GraphPortfolioTab from './GraphPortfolioTab';
import HtmlPreview from './HtmlPreview';
import ModelSettings, { getStoredModel, isWorkersAIModel } from './ModelSettings';
import UsageDashboard from './UsageDashboard';
import type { ResolvedTheme, ThemeMode } from '../lib/theme';

type View = 'chat' | 'graphs' | 'data' | 'agents' | 'settings' | 'usage';

interface Props {
  userId: string;
  userEmail: string;
  role?: string | null;
  language: string;
  onLanguageChange: (lang: 'en' | 'no') => void;
  onLogout: () => void;
  themeMode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  onThemeChange: (mode: ThemeMode) => void;
}

interface PendingGraphContext {
  id: string;
  title: string;
}

export default function AgentBuilder({ userId, userEmail, language, onLanguageChange, onLogout, themeMode, resolvedTheme, onThemeChange }: Props) {
  const [graphId, setGraphId] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [view, setView] = useState<View>('chat');
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [consoleErrors, setConsoleErrors] = useState<string[] | null>(null);
  const [activeHtmlNodeId, setActiveHtmlNodeId] = useState<string | null>(null);
  const [model, setModel] = useState(getStoredModel);
  const [pendingGraphContext, setPendingGraphContext] = useState<PendingGraphContext | null>(null);

  const isLight = resolvedTheme === 'light';

  return (
    <div className={`flex flex-col flex-1 min-h-0 ${isLight ? 'bg-slate-50 text-slate-900' : 'bg-slate-950 text-white'}`}>
      <header className={`flex items-center justify-between px-4 h-[48px] border-b flex-shrink-0 ${isLight ? 'border-slate-200 bg-white/95' : 'border-white/10 bg-slate-950/95'}`}>
        <div className="flex items-center gap-2">
          <span className={`text-base font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>Vegvisr</span>
          <span className="text-sm text-purple-400">Agent</span>
          <nav className="flex items-center gap-1 ml-4">
            {(['chat', 'graphs', 'agents', 'data', 'usage', 'settings'] as const).map((tab) => (
              <button
                type="button"
                key={tab}
                onClick={() => setView(tab)}
                className={`relative px-3 py-1 text-xs rounded-md transition-colors ${
                  view === tab
                    ? isLight ? 'bg-slate-900 text-white' : 'bg-white/10 text-white'
                    : isLight ? 'text-slate-500 hover:text-slate-900' : 'text-white/50 hover:text-white/80'
                }`}
              >
                {tab === 'chat' ? 'Chat'
                  : tab === 'graphs' ? (
                    <>
                      Graphs
                      {graphId && (
                        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-purple-400" title="Graph context active" />
                      )}
                    </>
                  )
                  : tab === 'agents' ? 'Agents'
                  : tab === 'data' ? 'Data'
                  : tab === 'usage' ? 'Usage'
                  : 'Settings'}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <div className={`inline-flex rounded-full border ${isLight ? 'border-slate-300 bg-white' : 'border-white/10 bg-white/[0.04]'}`}>
            {(['light', 'dark', 'system'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onThemeChange(mode)}
                className={`px-3 py-1 text-xs rounded-full transition-colors ${
                  themeMode === mode
                    ? isLight ? 'bg-slate-900 text-white' : 'bg-white/15 text-white'
                    : isLight ? 'text-slate-500 hover:text-slate-900' : 'text-white/50 hover:text-white'
                }`}
              >
                {mode === 'system' ? 'Auto' : mode[0].toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
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

      {view === 'chat' && isWorkersAIModel(model) && (
        <div className="flex flex-1 min-h-0">
          <VegvisrAgentChat userId={userId} model={model} graphId={graphId} onGraphChange={setGraphId} resolvedTheme={resolvedTheme} />
        </div>
      )}
      {view === 'chat' && !isWorkersAIModel(model) && (
        <div className={`flex flex-1 min-h-0 ${previewHtml ? '' : ''}`}>
          <div className={previewHtml ? 'w-[40%] min-w-[320px] flex flex-col min-h-0 border-r border-white/10' : 'flex-1 flex flex-col min-h-0'}>
            <AgentChat
              userId={userId}
              userEmail={userEmail}
              graphId={graphId}
              onGraphChange={setGraphId}
              agentId={selectedAgentId}
              agentAvatarUrl={null}
              onPreview={setPreviewHtml}
              consoleErrors={consoleErrors}
              onConsoleErrorsHandled={() => setConsoleErrors(null)}
              onActiveHtmlNode={setActiveHtmlNodeId}
              model={model}
              pendingGraphContext={pendingGraphContext}
              onPendingGraphContextProcessed={() => setPendingGraphContext(null)}
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
      {view === 'graphs' && (
        <GraphPortfolioTab
          graphId={graphId}
          onGraphChange={setGraphId}
          onNavigateToChat={() => setView('chat')}
          onGraphSelected={(id: string, title: string) => {
            setPendingGraphContext({ id, title });
            setTimeout(() => setView('chat'), 100);
          }}
        />
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
        <ModelSettings model={model} onChange={setModel} resolvedTheme={resolvedTheme} />
      )}
    </div>
  );
}
