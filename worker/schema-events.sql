-- Write-ahead event log for the agent loop (agent-loop.js).
--
-- Apply to the agent-stats-db D1 (STATS_DB binding in worker/wrangler.toml):
--   wrangler d1 execute agent-stats-db --remote --file=worker/schema-events.sql
--
-- WHY this exists next to session_tools: session_tools records what FINISHED.
-- If the isolate dies mid-tool (CPU limit, eviction, an executor that never
-- returns) nothing is written at all, so the most interesting failures are the
-- invisible ones. session_events is written BEFORE each model call and tool run,
-- so a crash leaves a durable row with status='started'.
CREATE TABLE IF NOT EXISTS session_events (
  id          TEXT PRIMARY KEY,               -- UUID per event
  session_id  TEXT NOT NULL,                  -- matches sessions.id
  seq         INTEGER NOT NULL,               -- monotonic within the session — replay order
  turn        INTEGER,                        -- agent-loop turn number
  kind        TEXT NOT NULL,                  -- 'model_call' | 'tool_call'
  name        TEXT,                           -- model id, or tool name
  payload     TEXT,                           -- JSON intent, clipped: what we were ABOUT to do
  started_at  TEXT NOT NULL,                  -- ISO 8601, written before the attempt
  status      TEXT NOT NULL DEFAULT 'started',-- 'started' | 'ok' | 'error' | 'blocked'
  ended_at    TEXT,
  duration_ms INTEGER,
  outcome     TEXT,                           -- summary / error message, clipped
  user_id     TEXT,
  UNIQUE (session_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_events_session ON session_events(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_events_started ON session_events(started_at);
-- The index that pays for the table: find work that began and never settled.
CREATE INDEX IF NOT EXISTS idx_events_status  ON session_events(status, started_at);

-- Crashed / hung work (anything still 'started' after 5 minutes):
--   SELECT session_id, seq, kind, name, started_at, payload
--     FROM session_events
--    WHERE status = 'started' AND started_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes')
--    ORDER BY started_at DESC;
--
-- Replay one session in order:
--   SELECT seq, turn, kind, name, status, duration_ms, outcome
--     FROM session_events WHERE session_id = ? ORDER BY seq;
