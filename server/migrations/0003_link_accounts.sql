-- "Connect Google/Discord" from Settings: a login request can attach the new identity
-- to an existing (signed-in) user instead of signing in.
ALTER TABLE login_requests ADD COLUMN link_user_id TEXT;
