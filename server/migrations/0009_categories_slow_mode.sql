-- Categories: rooms grouped under collapsible headers, like Discord. A room without one
-- shows in the channel's plain Chat rooms / Voice rooms lists as before.
CREATE TABLE categories (
  id         TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_categories_channel ON categories(channel_id, position);

ALTER TABLE rooms ADD COLUMN category_id TEXT;
-- Slow mode: seconds each person waits between messages in a chat room (0 = off).
ALTER TABLE rooms ADD COLUMN slow_mode INTEGER NOT NULL DEFAULT 0;
