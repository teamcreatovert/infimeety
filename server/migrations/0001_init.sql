-- Infimeety schema. Only text + metadata lives here; media files stay on users' PCs.

CREATE TABLE users (
  id                  TEXT PRIMARY KEY,
  email               TEXT,
  name                TEXT NOT NULL,
  username            TEXT UNIQUE COLLATE NOCASE,
  avatar_url          TEXT,
  avatar_key          TEXT,
  provider_avatar_url TEXT,
  onboarded           INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL
);
CREATE INDEX idx_users_email ON users(email);

CREATE TABLE identities (
  provider    TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (provider, provider_id)
);
CREATE INDEX idx_identities_user ON identities(user_id);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Desktop sign-in handoff: the app polls with a verifier whose hash was sent as the challenge.
CREATE TABLE login_requests (
  state         TEXT PRIMARY KEY,
  challenge     TEXT NOT NULL UNIQUE,
  provider      TEXT NOT NULL,
  session_token TEXT,
  error         TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE channels (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  emoji       TEXT NOT NULL DEFAULT '✨',
  color       TEXT NOT NULL DEFAULT 'blue',
  owner_id    TEXT NOT NULL REFERENCES users(id),
  invite_code TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL
);

CREATE TABLE channel_members (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at  INTEGER NOT NULL,
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX idx_members_user ON channel_members(user_id);

CREATE TABLE rooms (
  id         TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('text', 'voice')),
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_rooms_channel ON rooms(channel_id, position);

CREATE TABLE messages (
  id          TEXT PRIMARY KEY,           -- time-sortable
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id),
  content     TEXT NOT NULL DEFAULT '',
  attachments TEXT,                       -- JSON metadata only
  reply_to    TEXT,
  reactions   TEXT,                       -- JSON { emoji: [userId] }
  created_at  INTEGER NOT NULL,
  edited_at   INTEGER
);
CREATE INDEX idx_messages_room ON messages(room_id, id);
CREATE INDEX idx_messages_user ON messages(user_id);
