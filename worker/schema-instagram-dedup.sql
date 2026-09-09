-- Idempotency keys for Instagram message flow, in vegvisr_org (env.DB).
--
-- Inbound: Meta retries any webhook delivery it does not get a prompt 200 for.
-- Without a key, a retry inserts the same message into the chat twice. The key
-- is Meta's own message id: `in:<mid>`.
--
-- Outbound: the relay fires from ctx.waitUntil after a chat message is stored,
-- so a client retry means two inserts and two sends. The key is the chat
-- message's row id: `out:<messageId>`.
CREATE TABLE IF NOT EXISTS instagram_message_keys (
  key TEXT PRIMARY KEY,
  group_id TEXT,
  kind TEXT NOT NULL,          -- 'in' | 'out'
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_instagram_message_keys_created
  ON instagram_message_keys (created_at);
