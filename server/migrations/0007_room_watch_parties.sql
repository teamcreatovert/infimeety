-- Channel admins can turn watch parties off for a voice room (on by default).
ALTER TABLE rooms ADD COLUMN allow_party INTEGER NOT NULL DEFAULT 1;
