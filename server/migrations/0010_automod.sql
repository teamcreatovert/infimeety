-- AutoMod: each channel's rules (blocked words, links, mention limit, spam), as JSON.
CREATE TABLE automod (
  channel_id TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  rules      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
