interface Props {
  html: string | null;
  onClose: () => void;
}

export default function HtmlPreview({ html, onClose }: Props) {
  if (!html) {
    return (
      <div className="flex-1 flex items-center justify-center text-white/30 text-sm px-8 text-center">
        Click <span className="mx-1 px-1.5 py-0.5 bg-white/10 rounded text-white/50 text-xs">Preview</span> on an HTML tool result to see it here.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="flex items-center justify-between px-3 h-[36px] border-b border-white/10 bg-slate-900/50 flex-shrink-0">
        <span className="text-xs text-white/50">Preview</span>
        <button
          type="button"
          onClick={onClose}
          className="text-white/40 hover:text-white text-sm px-1.5 py-0.5 rounded hover:bg-white/10 transition-colors"
          title="Close preview"
        >
          ✕
        </button>
      </div>
      <iframe
        srcDoc={html}
        sandbox="allow-scripts allow-forms"
        className="flex-1 w-full bg-white border-0"
        title="HTML Preview"
      />
    </div>
  );
}
