/**
 * Pairing an incoming tool_progress / tool_result with the tool call it belongs to.
 *
 * The old rule was "the most recent RUNNING call with this tool name". That is wrong
 * the moment two calls to the same tool run in parallel: results come back in
 * completion order, and each one claims the LAST running slot, so the answers rotate
 * between the calls. On 2026-09-02 a chat log showed three read_graph_content calls
 * each displaying another call's graph, and two read_html_section calls with their
 * anchors swapped — while the model itself had received the correct results, because
 * the API pairs by tool_use id. Only the human-readable record lied, which is worse
 * than it sounds: that record is what gets pasted into a bug report.
 *
 * The worker now echoes the model's own call id on all three events, so pairing is
 * exact and order-independent. The name-based scan stays as the fallback for an older
 * worker or a replayed history that carries no id.
 */
export interface PairableToolCall {
  callId?: string;
  tool: string;
  status: 'running' | 'success' | 'error';
}

export function findToolCallIndex(
  calls: PairableToolCall[],
  callId: unknown,
  tool: string,
): number {
  if (typeof callId === 'string' && callId) {
    const byId = calls.findIndex((c) => c.callId === callId);
    if (byId !== -1) return byId;
  }
  for (let i = calls.length - 1; i >= 0; i--) {
    if (calls[i].tool === tool && calls[i].status === 'running') return i;
  }
  return -1;
}
