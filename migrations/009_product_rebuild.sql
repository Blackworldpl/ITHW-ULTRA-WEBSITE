-- Additive product modules; all existing operational records and roles are retained.
CREATE TABLE permission_roles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL UNIQUE CHECK(length(name) BETWEEN 2 AND 100),
 base_role text NOT NULL REFERENCES roles(code) CHECK(base_role<>'ADMIN'),permissions text[] NOT NULL,
 version integer NOT NULL DEFAULT 1,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN permission_role_id uuid REFERENCES permission_roles(id);
ALTER TABLE users ADD COLUMN last_login_at timestamptz;
CREATE TABLE user_invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),token_hash text NOT NULL UNIQUE,name text NOT NULL,email text NOT NULL,
 role text NOT NULL REFERENCES roles(code) CHECK(role<>'ADMIN'),created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,accepted_at timestamptz
);
CREATE UNIQUE INDEX active_invitation_email ON user_invitations(lower(email)) WHERE accepted_at IS NULL;

ALTER TABLE attachments DROP CONSTRAINT attachments_content_valid;
ALTER TABLE attachments ADD CONSTRAINT attachments_content_valid CHECK(content IS NULL OR (
 octet_length(content)=size_bytes AND size_bytes BETWEEN 1 AND 10485760 AND
 ((invoice_id IS NOT NULL AND asset_id IS NULL AND mime_type='application/pdf') OR
  (invoice_id IS NULL AND mime_type IN ('application/pdf','text/plain')))
));
ALTER TABLE configurations ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE configurations ADD COLUMN latest_version integer NOT NULL DEFAULT 0;
ALTER TABLE configurations ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX configurations_search ON configurations USING gin((name||' '||coalesce(model,'')||' '||coalesce(manufacturer,'')||' '||description) gin_trgm_ops);

ALTER TABLE inventory_scans ADD COLUMN snapshot jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE inventory_scans ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE inventory_scans ADD COLUMN summary jsonb;
ALTER TABLE inventory_scans ADD COLUMN request_id uuid UNIQUE;
CREATE TABLE inventory_scan_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),scan_id uuid NOT NULL REFERENCES inventory_scans(id),
 asset_id uuid REFERENCES assets(id),code text NOT NULL CHECK(length(code) BETWEEN 1 AND 2048),
 result text NOT NULL CHECK(result IN ('EXPECTED','UNEXPECTED','UNKNOWN','DUPLICATE')),
 request_id uuid NOT NULL UNIQUE,actor_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_scan_events_session ON inventory_scan_events(scan_id,created_at,id);
CREATE TRIGGER inventory_events_immutable BEFORE UPDATE OR DELETE ON inventory_scan_events FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();
CREATE TRIGGER inventory_events_no_truncate BEFORE TRUNCATE ON inventory_scan_events FOR EACH STATEMENT EXECUTE FUNCTION prevent_history_mutation();

CREATE TABLE incidents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),number text NOT NULL UNIQUE,
 title text NOT NULL CHECK(length(title) BETWEEN 3 AND 200),description text NOT NULL DEFAULT '',
 asset_id uuid REFERENCES assets(id),assigned_to uuid REFERENCES users(id),
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','ASSIGNED','WAITING','RESOLVED')),
 priority text NOT NULL DEFAULT 'NORMAL' CHECK(priority IN ('LOW','NORMAL','HIGH','CRITICAL')),
 external_reference text,version integer NOT NULL DEFAULT 1,created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX incidents_open ON incidents(priority,updated_at DESC) WHERE status<>'RESOLVED';
CREATE INDEX incidents_asset ON incidents(asset_id);
CREATE INDEX incidents_search ON incidents USING gin((number||' '||title||' '||description||' '||coalesce(external_reference,'')) gin_trgm_ops);
CREATE TABLE system_settings (key text PRIMARY KEY,value jsonb NOT NULL,version integer NOT NULL DEFAULT 1,updated_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now());
CREATE VIEW location_summary AS
 WITH RECURSIVE branches AS (
  SELECT id AS ancestor,id AS child FROM locations
  UNION ALL SELECT b.ancestor,l.id FROM branches b JOIN locations l ON l.parent_id=b.child
 ),counts AS (SELECT b.ancestor,count(a.id)::integer AS asset_count FROM branches b LEFT JOIN assets a ON a.location_id=b.child GROUP BY b.ancestor)
 SELECT l.*,COALESCE(c.asset_count,0) AS asset_count,
  (SELECT count(*)::integer FROM locations s WHERE s.parent_id=l.id) AS child_count
 FROM location_paths l LEFT JOIN counts c ON c.ancestor=l.id;
