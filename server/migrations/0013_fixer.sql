-- Fixer: a built-in bot in every channel and DM (like Nova) that troubleshoots calls. Its
-- answers come from the asker's own app, which checks that device; the server never answers it.
INSERT OR IGNORE INTO users (id, name, username, onboarded, created_at, is_bot) VALUES ('bot-fixer', 'Fixer', NULL, 1, 0, 1);
INSERT OR IGNORE INTO bots (user_id, channel_id, instructions, created_by, created_at)
VALUES ('bot-fixer', NULL, 'Fixes call problems on your own device: your mic, hearing others, camera, screen sharing and connection.', NULL, 1);
