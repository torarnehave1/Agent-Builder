-- GitHub connector: one row per user's linked GitHub App installation.
CREATE TABLE IF NOT EXISTS github_connections (
  user_id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  access_token_expires_at TEXT,
  refresh_token TEXT,
  refresh_token_expires_at TEXT,
  account_login TEXT,
  connected_at TEXT NOT NULL DEFAULT (datetime('now'))
);
