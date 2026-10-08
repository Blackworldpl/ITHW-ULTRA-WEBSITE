-- The TV proves possession of a browser nonce; an administrator confirms its code.
CREATE TABLE device_pairing_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 device_id uuid NOT NULL REFERENCES managed_devices(id) ON DELETE CASCADE,
 code_hash text NOT NULL UNIQUE,
 browser_token_hash text NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL,
 approved_at timestamptz,
 claimed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX device_pairing_requests_device ON device_pairing_requests(device_id);
CREATE INDEX device_pairing_requests_expiry ON device_pairing_requests(expires_at);
