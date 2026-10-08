-- Paired browser displays are separate from interactive user sessions.
CREATE TABLE managed_devices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(length(name) BETWEEN 2 AND 120),
 kind text NOT NULL CHECK(kind IN ('TV','SCANNER')),
 asset_id uuid REFERENCES assets(id),
 enabled boolean NOT NULL DEFAULT true,
 configuration jsonb NOT NULL CHECK(jsonb_typeof(configuration)='object'),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 pairing_code_hash text,
 pairing_expires_at timestamptz,
 token_hash text,
 csrf_token text,
 session_expires_at timestamptz,
 paired_at timestamptz,
 last_seen_at timestamptz,
 created_by uuid NOT NULL REFERENCES users(id),
 configured_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((pairing_code_hash IS NULL)=(pairing_expires_at IS NULL)),
 CHECK ((token_hash IS NULL)=(csrf_token IS NULL)),
 CHECK ((token_hash IS NULL)=(session_expires_at IS NULL))
);
CREATE INDEX managed_devices_asset ON managed_devices(asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX managed_devices_seen ON managed_devices(last_seen_at DESC);
