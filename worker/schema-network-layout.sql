-- Saved node positions for the network view, per viewer.
-- The layout is one person's reading of their own network, so it is scoped to
-- the user who arranged it rather than shared.
CREATE TABLE IF NOT EXISTS network_layout (
  user_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, node_id)
);
