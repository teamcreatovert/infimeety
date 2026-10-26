-- Sessions unused for 90 days are signed out; this records when each was last used.
ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER;
