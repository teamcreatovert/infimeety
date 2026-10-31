-- Room permissions: the lowest role that can see a room, and that can post in it (chat rooms)
-- or join it (voice rooms). 'member' = everyone in the channel.
ALTER TABLE rooms ADD COLUMN view_role TEXT NOT NULL DEFAULT 'member';
ALTER TABLE rooms ADD COLUMN post_role TEXT NOT NULL DEFAULT 'member';

-- Audit log: who changed or removed what in a channel.
CREATE TABLE audit_log (
  id         TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  actor_id   TEXT,
  action     TEXT NOT NULL,
  target     TEXT,
  detail     TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_channel ON audit_log(channel_id, created_at);
