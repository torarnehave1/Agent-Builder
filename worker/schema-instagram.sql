-- Instagram connector: one row per user's linked Instagram professional account.
-- Mirrors schema-github.sql. Lives in env.DB (vegvisr_org), beside github_connections.
CREATE TABLE IF NOT EXISTS instagram_connections (
  user_id TEXT PRIMARY KEY,
  ig_user_id TEXT NOT NULL,
  username TEXT,
  access_token TEXT NOT NULL,
  token_expires_at TEXT,
  permissions TEXT,
  connected_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Webhooks identify the account by its Instagram-scoped id, never by this app's
-- internal userId — this index is how an inbound delivery finds its owner.
CREATE UNIQUE INDEX IF NOT EXISTS idx_instagram_connections_ig_user_id
  ON instagram_connections (ig_user_id);
