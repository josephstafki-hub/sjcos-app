-- Website/owner login only: no new grants to narrow database logins.
ALTER TABLE users ADD COLUMN phone text;
ALTER TABLE users ADD CONSTRAINT users_phone_e164 CHECK (phone IS NULL OR phone ~ '^\+1[2-9][0-9]{9}$');
COMMENT ON COLUMN users.phone IS 'Personal cell for outbound business-line call bridging, normalized US E.164; null uses owner fallback only.';
