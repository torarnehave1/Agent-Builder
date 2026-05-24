import { useEffect, useState, useCallback } from 'react';

interface Props {
  open: boolean;
  title?: string;
  value: unknown;
  onClose: () => void;
}

export default function JsonViewerModal({ open, title = 'JSON', value, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  let formatted = '';
  try {
    formatted = JSON.stringify(value, null, 2);
  } catch {
    formatted = String(value);
  }

  // Close on Esc
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(formatted);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback: select-all in the pre (user can Ctrl+C)
      setCopied(false);
    }
  }, [formatted]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-4xl max-h-[85vh] flex flex-col bg-slate-950 border border-white/10 rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-slate-900/80">
          <div className="text-white/80 text-sm font-medium truncate" title={title}>{title}</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="px-2.5 py-1 rounded text-xs bg-sky-500/20 border border-sky-500/40 text-sky-200 hover:bg-sky-500/30"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-2 py-1 rounded text-white/50 hover:text-white/80 hover:bg-white/[0.06] text-sm"
              title="Close (Esc)"
            >
              ×
            </button>
          </div>
        </div>
        <pre className="flex-1 min-h-0 overflow-auto px-4 py-3 m-0 text-xs text-white/80 font-mono whitespace-pre-wrap break-all">
          {formatted}
        </pre>
        <div className="px-4 py-2 border-t border-white/10 bg-slate-900/40 text-[10px] text-white/30">
          Esc to close. Click outside to dismiss.
        </div>
      </div>
    </div>
  );
}
