-- Channel moderators, between admins and members. SQLite can't change a CHECK constraint in
-- place, so the members table is rebuilt with the same columns, rows and index.
PRAGMA defer_foreign_keys = true;

CREATE TABLE channel_members_new (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'moderator', 'member')),
  joined_at  INTEGER NOT NULL,
  PRIMARY KEY (channel_id, user_id)
);
INSERT INTO channel_members_new (channel_id, user_id, role, joined_at)
  SELECT channel_id, user_id, role, joined_at FROM channel_members;
DROP TABLE channel_members;
ALTER TABLE channel_members_new RENAME TO channel_members;
CREATE INDEX idx_members_user ON channel_members(user_id);
