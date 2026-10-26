-- A channel can have its own picture instead of an emoji.
ALTER TABLE channels ADD COLUMN icon_key TEXT;
ALTER TABLE channels ADD COLUMN icon_url TEXT;
