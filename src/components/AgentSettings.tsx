import { useState, useEffect, useCallback } from 'react';

interface AgentConfig {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  model: string;
  max_tokens: number;
  temperature: number;
  tools: string[];
  avatar_url: string | null;
  is_active: number;
}

interface ToolInfo {
  name: string;
  description: string;
}

interface Props {
  agentId: string | null;
  userId: string;
  onSave: (agent: AgentConfig) => void;
  onCancel: () => void;
}

const AGENT_API = 'https://agent.vegvisr.org';

export default function AgentSettings({ agentId, userId, onSave, onCancel }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [model, setModel] = useState('claude-haiku-4-5-20251001');
  const [temperature, setTemperature] = useState(0.3);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [availableTools, setAvailableTools] = useState<ToolInfo[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [urlInput, setUrlInput] = useState('');

  // Load agent config if editing
  useEffect(() => {
    if (agentId) {
      fetch(`${AGENT_API}/agent?id=${agentId}`)
        .then(res => res.json())
        .then(data => {
          if (data.agent) {
            const a = data.agent;
            setName(a.name || '');
            setDescription(a.description || '');
            setSystemPrompt(a.system_prompt || '');
            setModel(a.model || 'claude-haiku-4-5-20251001');
            setTemperature(a.temperature ?? 0.3);
            setAvatarUrl(a.avatar_url || null);
            try {
              setSelectedTools(JSON.parse(a.tools || '[]'));
            } catch { setSelectedTools([]); }
          }
        })
        .catch(() => {});
    }
  }, [agentId]);

  // Load available tools
  useEffect(() => {
    fetch(`${AGENT_API}/tools`)
      .then(res => res.json())
      .then(data => {
        const tools: ToolInfo[] = [];
        if (data.hardcoded) tools.push(...data.hardcoded);
        if (data.dynamic) tools.push(...data.dynamic);
        setAvailableTools(tools);
      })
      .catch(() => {});
  }, []);

  // Upload image file → imgix URL
  const uploadAvatar = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });
      const res = await fetch(`${AGENT_API}/upload-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          base64,
          mediaType: file.type || 'image/png',
          filename: `avatar-${Date.now()}.${file.type.split('/')[1] || 'png'}`,
        }),
      });
      const data = await res.json();
      if (data.url) setAvatarUrl(data.url);
    } catch (err) {
      console.error('Avatar upload failed:', err);
    } finally {
      setUploading(false);
    }
  }, [userId]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length > 0) uploadAvatar(files[0]);
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        system_prompt: systemPrompt.trim(),
        model,
        temperature,
        tools: selectedTools,
        avatar_url: avatarUrl,
      };

      let res;
      if (agentId) {
        res = await fetch(`${AGENT_API}/agent`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: agentId, ...payload }),
        });
      } else {
        res = await fetch(`${AGENT_API}/agents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      const data = await res.json();
      const savedId = agentId || data.id;
      onSave({
        id: savedId,
        name: name.trim(),
        description: description.trim(),
        system_prompt: systemPrompt.trim(),
        model,
        max_tokens: 4096,
        temperature,
        tools: selectedTools,
        avatar_url: avatarUrl,
        is_active: 1,
      });
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const toggleTool = (toolName: string) => {
    setSelectedTools(prev =>
      prev.includes(toolName)
        ? prev.filter(t => t !== toolName)
        : [...prev, toolName]
    );
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">
            {agentId ? 'Edit Agent' : 'New Agent'}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-xs text-gray-400 hover:text-white border border-white/10 rounded-md hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!name.trim() || saving}
              className="px-4 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-md hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save Agent'}
            </button>
          </div>
        </div>

        {/* Avatar */}
        <div className="rounded-lg border border-white/10 bg-slate-900/60 p-4">
          <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3 block">Avatar</label>
          <div className="flex items-start gap-4">
            {/* Preview */}
            <div
              className={`w-20 h-20 rounded-full border-2 flex items-center justify-center overflow-hidden flex-shrink-0 cursor-pointer transition-colors ${
                dragOver ? 'border-emerald-400 bg-emerald-600/20' : 'border-white/20 bg-slate-800'
              }`}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => document.getElementById('avatar-file-input')?.click()}
            >
              {uploading ? (
                <span className="text-[10px] text-gray-400">Uploading...</span>
              ) : avatarUrl ? (
                <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <span className="text-2xl text-gray-500">
                  {name ? name.charAt(0).toUpperCase() : '?'}
                </span>
              )}
            </div>
            <input
              id="avatar-file-input"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) uploadAvatar(file);
              }}
            />
            <div className="flex-1 space-y-2">
              <p className="text-[11px] text-gray-500">
                Click or drag & drop an image to upload, or paste a URL below.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  placeholder="https://vegvisr.imgix.net/..."
                  className="flex-1 rounded-md bg-slate-950/60 border border-white/8 px-3 py-1.5 text-[11px] text-white placeholder:text-gray-600 focus:outline-none focus:border-emerald-500/40"
                />
                <button
                  onClick={() => {
                    if (urlInput.trim()) {
                      setAvatarUrl(urlInput.trim());
                      setUrlInput('');
                    }
                  }}
                  disabled={!urlInput.trim()}
                  className="px-3 py-1.5 text-[10px] font-semibold text-emerald-400 border border-emerald-600/30 rounded-md hover:bg-emerald-600/10 disabled:opacity-40"
                >
                  Set
                </button>
              </div>
              {avatarUrl && (
                <button
                  onClick={() => setAvatarUrl(null)}
                  className="text-[10px] text-red-400 hover:text-red-300"
                >
                  Remove avatar
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Name & Description */}
        <div className="rounded-lg border border-white/10 bg-slate-900/60 p-4 space-y-3">
          <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block">Identity</label>
          <div>
            <label className="text-[10px] text-gray-500 block mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Book Writer, Market Analyst..."
              className="w-full rounded-md bg-slate-950/60 border border-white/8 px-3 py-2 text-[11px] text-white placeholder:text-gray-600 focus:outline-none focus:border-emerald-500/40"
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500 block mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What this agent specializes in..."
              rows={2}
              className="w-full rounded-md bg-slate-950/60 border border-white/8 px-3 py-2 text-[11px] text-white placeholder:text-gray-600 focus:outline-none focus:border-emerald-500/40 resize-none"
            />
          </div>
        </div>

        {/* Model & Temperature */}
        <div className="rounded-lg border border-white/10 bg-slate-900/60 p-4 space-y-3">
          <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block">Model</label>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="text-[10px] text-gray-500 block mb-1">Model</label>
              <select
                value={model}
                onChange={e => setModel(e.target.value)}
                className="w-full rounded-md bg-slate-950/60 border border-white/8 px-3 py-2 text-[11px] text-white focus:outline-none focus:border-emerald-500/40"
              >
                <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 (fast)</option>
                <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                <option value="claude-opus-4-6">Claude Opus 4.6</option>
              </select>
            </div>
            <div className="w-32">
              <label className="text-[10px] text-gray-500 block mb-1">Temperature: {temperature}</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={temperature}
                onChange={e => setTemperature(parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
          </div>
        </div>

        {/* System Prompt */}
        <div className="rounded-lg border border-white/10 bg-slate-900/60 p-4 space-y-2">
          <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block">
            System Prompt
            <span className="text-[9px] text-gray-600 font-normal ml-2">
              Leave empty to use the default prompt
            </span>
          </label>
          <textarea
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            placeholder="You are a specialized agent that..."
            rows={8}
            className="w-full rounded-md bg-slate-950/60 border border-white/8 px-3 py-2 text-[11px] text-white placeholder:text-gray-600 focus:outline-none focus:border-emerald-500/40 resize-y font-mono"
          />
        </div>

        {/* Tools */}
        <div className="rounded-lg border border-white/10 bg-slate-900/60 p-4 space-y-2">
          <div className="flex items-center justify-between mb-2">
            <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
              Tools
              <span className="text-[9px] text-gray-600 font-normal ml-2">
                {selectedTools.length === 0 ? 'All tools enabled (default)' : `${selectedTools.length} selected`}
              </span>
            </label>
            {selectedTools.length > 0 && (
              <button
                onClick={() => setSelectedTools([])}
                className="text-[10px] text-gray-500 hover:text-white"
              >
                Clear all (use default)
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-1 max-h-[240px] overflow-y-auto">
            {availableTools.map(tool => (
              <label
                key={tool.name}
                className={`flex items-start gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-white/5 ${
                  selectedTools.includes(tool.name) ? 'bg-emerald-600/10' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedTools.includes(tool.name)}
                  onChange={() => toggleTool(tool.name)}
                  className="mt-0.5 rounded border-gray-600"
                />
                <div className="min-w-0">
                  <span className="text-[10px] text-white block truncate">{tool.name}</span>
                  <span className="text-[9px] text-gray-600 block truncate">{tool.description}</span>
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
