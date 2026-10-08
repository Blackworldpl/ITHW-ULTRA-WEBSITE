-- Existing accounts retain access; only newly provisioned temporary passwords
-- require completion. A credential version also closes in-flight login races.
ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN password_changed_at timestamptz;
ALTER TABLE users ADD COLUMN password_version integer NOT NULL DEFAULT 1 CHECK(password_version>0);
ALTER TABLE sessions ADD COLUMN password_version integer NOT NULL DEFAULT 1 CHECK(password_version>0);
