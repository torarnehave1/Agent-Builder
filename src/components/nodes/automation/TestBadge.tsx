// Small pass/fail/testing badge shown on a testable step node (top-right corner).
export default function TestBadge({ status }: { status?: string }) {
  if (!status) return null;
  const map: Record<string, { label: string; cls: string }> = {
    testing: { label: '…', cls: 'bg-sky-500/80 text-white animate-pulse' },
    passed: { label: '✓', cls: 'bg-emerald-500 text-white' },
    failed: { label: '✗', cls: 'bg-rose-500 text-white' },
  };
  const m = map[status];
  if (!m) return null;
  return (
    <div
      className={`absolute -top-2 -right-2 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold shadow ${m.cls}`}
      title={`Test: ${status}`}
    >
      {m.label}
    </div>
  );
}
