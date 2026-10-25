-- Friends (Discord-style requests by @username) and direct messages.

-- One row per pair, stored with user_a < user_b. `requested_by` tells who asked.
CREATE TABLE friendships (
  user_a       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  requested_by TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  accepted_at  INTEGER,
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b)
);
CREATE INDEX idx_friendships_b ON friendships(user_b);

-- A DM is a private two-member channel (kind = 'dm') with one chat room and one call room,
-- so chat, reactions, P2P media and calls reuse the channel machinery. dm_key = "<a>:<b>".
ALTER TABLE channels ADD COLUMN kind TEXT NOT NULL DEFAULT 'space';
ALTER TABLE channels ADD COLUMN dm_key TEXT;
CREATE UNIQUE INDEX idx_channels_dm ON channels(dm_key) WHERE dm_key IS NOT NULL;
