-- Quick meetings: short-lived voice/video rooms anyone can join from a link like
-- infimeety.pages.dev/gyus-768g-hsf. A meeting is a channel (kind = 'meeting') with one chat
-- room and one call room; invite_code holds its 4-4-3 code. Everything in it is deleted when it
-- ends: 24 h after it starts, once the call has been empty for an hour, or when the host ends it.
ALTER TABLE channels ADD COLUMN expires_at INTEGER;
CREATE INDEX idx_channels_expiry ON channels(expires_at) WHERE expires_at IS NOT NULL;

-- Browser guests: account-less users that exist only inside one meeting (guest_of = its channel id).
ALTER TABLE users ADD COLUMN guest_of TEXT;
CREATE INDEX idx_users_guest ON users(guest_of) WHERE guest_of IS NOT NULL;

-- Guests waiting in a meeting's lobby, guests who were turned away, and anyone the host removed
-- (who can't come back to that meeting). Admitted people are plain channel_members.
CREATE TABLE meeting_access (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('waiting', 'denied', 'removed')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (channel_id, user_id)
);
