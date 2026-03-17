-- Agent session stats — for benchmarking agent-builder improvements over time
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,               -- UUID per chat request
  user_id      TEXT NOT NULL,
  started_at   TEXT NOT NULL,                  -- ISO 8601
  ended_at     TEXT,
  duration_ms  INTEGER,
  turns        INTEGER DEFAULT 0,              -- LLM turns used
  fast_path    INTEGER DEFAULT 0,              -- 1 = bypassed Claude entirely
  fast_path_action TEXT,                       -- e.g. 'list_graphs', 'list_meta_areas'
  model        TEXT,
  input_tokens  INTEGER DEFAULT 0,             -- accumulated across all turns
  output_tokens INTEGER DEFAULT 0,
  tool_calls   TEXT DEFAULT '[]',              -- JSON array of tool names called
  success      INTEGER DEFAULT 1,              -- 1 = done, 0 = error/timeout
  error        TEXT,
  agent_id     TEXT,                           -- custom agent if used
  max_turns_reached INTEGER DEFAULT 0          -- 1 = hit turn limit
);

CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_model   ON sessions(model);
