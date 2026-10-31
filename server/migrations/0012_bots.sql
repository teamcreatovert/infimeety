-- AI bots. A bot is a user (so its replies are ordinary messages) marked is_bot, with a bots row
-- holding what it does. channel_id NULL: available everywhere (the built-in Nova); otherwise
-- one server's own bot, made by its admins.
ALTER TABLE users ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0;

CREATE TABLE bots (
  user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  channel_id   TEXT REFERENCES channels(id) ON DELETE CASCADE,
  instructions TEXT NOT NULL,
  created_by   TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_bots_channel ON bots(channel_id);

INSERT OR IGNORE INTO users (id, name, username, onboarded, created_at, is_bot) VALUES ('bot-nova', 'Nova', NULL, 1, 0, 1);
INSERT OR IGNORE INTO bots (user_id, channel_id, instructions, created_by, created_at)
VALUES ('bot-nova', NULL, 'You answer questions and explain things clearly: facts, how-tos, ideas, homework help, quick math. If you are not sure, say so.', NULL, 0);
