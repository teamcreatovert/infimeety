-- Scheduled and repeating meetings: when one is meant to start, and how it repeats.
ALTER TABLE channels ADD COLUMN starts_at INTEGER;
ALTER TABLE channels ADD COLUMN repeat TEXT;
