-- One row per Instagram conversation (option A: group per conversation).
-- Lives in vegvisr_org (env.DB) beside instagram_connections; the group itself
-- lives in hallo_vegvisr_chat. This table is the join between the two, and the
-- only place the reply target and the messaging window are recorded.
CREATE TABLE IF NOT EXISTS instagram_threads (
  group_id TEXT PRIMARY KEY,
  ig_user_id TEXT NOT NULL,              -- the connected professional account
  participant_igsid TEXT NOT NULL,       -- app-scoped id of the other person; the reply target
  participant_username TEXT,             -- best-effort, may be null
  last_inbound_at INTEGER,               -- ms. Updated ONLY by genuine inbound messages —
                                         -- our own echoes must not extend the 24h window.
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One conversation per (account, participant). This is what makes ingestion
-- idempotent: a second message from the same person finds the same group.
CREATE UNIQUE INDEX IF NOT EXISTS idx_instagram_threads_pair
  ON instagram_threads (ig_user_id, participant_igsid);
