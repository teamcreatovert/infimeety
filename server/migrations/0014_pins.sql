-- Pinned messages: moderators and admins pin messages; each room lists its pins.
ALTER TABLE messages ADD COLUMN pinned_at INTEGER;
ALTER TABLE messages ADD COLUMN pinned_by TEXT;
CREATE INDEX idx_messages_pins ON messages(room_id, pinned_at) WHERE pinned_at IS NOT NULL;
