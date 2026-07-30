-- Adds a per-connection read-only switch: a hard, config-level backstop that
-- disables all GitHub write tools outright, independent of the per-call
-- confirmed:true gate already in place on those tools.
ALTER TABLE github_connections ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0;
