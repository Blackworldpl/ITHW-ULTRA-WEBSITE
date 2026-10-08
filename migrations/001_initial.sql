-- All operational data starts empty. Only stable lookup values are seeded.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE roles (
  code text PRIMARY KEY CHECK (code IN ('VIEWER','IT_USER','IT_ADVANCED','ADMIN')),
  name text NOT NULL
);
INSERT INTO roles(code,name) VALUES
  ('VIEWER','Tylko odczyt'),('IT_USER','IT User'),('IT_ADVANCED','IT Advanced'),('ADMIN','Administrator');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  email text NOT NULL,
  password_hash text,
  role text NOT NULL REFERENCES roles(code),
  active boolean NOT NULL DEFAULT true,
  external_identity text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users(lower(email));
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE auth_rate_limits (
  key text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  window_start timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE asset_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  field_definitions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(field_definitions)='array'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX categories_name_unique ON asset_categories(lower(name));
INSERT INTO asset_categories(name) VALUES
 ('Laptop'),('Komputer'),('Monitor'),('Telefon'),('Tablet'),('Drukarka'),('Drukarka Zebra'),
 ('Skaner'),('Access point'),('Switch'),('Router'),('Firewall'),('Telewizor'),('Urządzenie magazynowe'),('Inny sprzęt IT');

CREATE TABLE asset_statuses (code text PRIMARY KEY, name text NOT NULL);
INSERT INTO asset_statuses VALUES
 ('AVAILABLE','Dostępny'),('ASSIGNED','Wydany'),('DAMAGED','Uszkodzony'),('REPAIR','W naprawie'),
 ('PREPARATION','Do przygotowania'),('DISPOSAL','Do utylizacji'),('RETIRED','Zutylizowany');

CREATE TABLE locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  kind text NOT NULL CHECK(kind IN ('SITE','BUILDING','ZONE','ROOM','RACK','SHELF','BIN')),
  parent_id uuid REFERENCES locations(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX locations_parent_idx ON locations(parent_id);
CREATE UNIQUE INDEX locations_sibling_unique ON locations(coalesce(parent_id,'00000000-0000-0000-0000-000000000000'::uuid),lower(name));
CREATE VIEW location_paths AS
 WITH RECURSIVE paths AS (
   SELECT id,name,kind,parent_id,name::text AS path FROM locations WHERE parent_id IS NULL
   UNION ALL
   SELECT l.id,l.name,l.kind,l.parent_id,p.path || ' / ' || l.name
   FROM locations l JOIN paths p ON l.parent_id=p.id
 ) SELECT * FROM paths;

CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX suppliers_name_unique ON suppliers(lower(name));

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL CHECK(length(number) BETWEEN 1 AND 160),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  date date NOT NULL,
  amount numeric(14,2) NOT NULL DEFAULT 0 CHECK(amount >= 0),
  currency char(3) NOT NULL DEFAULT 'PLN' CHECK(currency ~ '^[A-Z]{3}$'),
  order_number text,
  received_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(supplier_id,number)
);
CREATE INDEX invoices_date_idx ON invoices(date DESC);
CREATE INDEX invoices_number_search_idx ON invoices USING gin (number gin_trgm_ops);

CREATE SEQUENCE asset_number_seq MINVALUE 1 MAXVALUE 99999999 NO CYCLE;
CREATE TABLE assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id text NOT NULL UNIQUE DEFAULT ('ITHW-' || lpad(nextval('asset_number_seq')::text,8,'0')),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  category_id uuid NOT NULL REFERENCES asset_categories(id),
  manufacturer text,
  model text,
  serial_number text,
  mac_address macaddr,
  ip_address inet,
  hostname text,
  location_id uuid REFERENCES locations(id),
  status text NOT NULL DEFAULT 'PREPARATION' REFERENCES asset_statuses(code),
  owner text,
  purchased_at date,
  purchase_price numeric(14,2) CHECK(purchase_price >= 0),
  invoice_id uuid REFERENCES invoices(id),
  warranty_until date,
  received_at timestamptz NOT NULL DEFAULT now(),
  issued_at timestamptz,
  is_fixed_asset boolean NOT NULL DEFAULT false,
  fixed_asset_number text,
  rfid_tag text,
  notes text,
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(custom_fields)='object'),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT is_fixed_asset OR nullif(trim(fixed_asset_number),'') IS NOT NULL),
  CHECK (status <> 'ASSIGNED' OR nullif(trim(owner),'') IS NOT NULL),
  CHECK (warranty_until IS NULL OR purchased_at IS NULL OR warranty_until >= purchased_at)
);
CREATE UNIQUE INDEX assets_serial_unique ON assets(lower(serial_number)) WHERE serial_number IS NOT NULL;
CREATE UNIQUE INDEX assets_rfid_unique ON assets(lower(rfid_tag)) WHERE rfid_tag IS NOT NULL;
CREATE UNIQUE INDEX assets_fixed_number_unique ON assets(lower(fixed_asset_number)) WHERE fixed_asset_number IS NOT NULL;
CREATE INDEX assets_category_idx ON assets(category_id);
CREATE INDEX assets_location_idx ON assets(location_id);
CREATE INDEX assets_status_idx ON assets(status);
CREATE INDEX assets_invoice_idx ON assets(invoice_id);
CREATE INDEX assets_purchase_idx ON assets(purchased_at);
CREATE INDEX assets_warranty_idx ON assets(warranty_until);
CREATE INDEX assets_created_idx ON assets(created_at DESC,id);
CREATE INDEX assets_search_idx ON assets USING gin (
 (coalesce(asset_id,'') || ' ' || coalesce(name,'') || ' ' || coalesce(serial_number,'') || ' ' ||
  coalesce(model,'') || ' ' || coalesce(manufacturer,'') || ' ' || coalesce(hostname,'') || ' ' ||
  coalesce(owner,'') || ' ' || coalesce(rfid_tag,'')) gin_trgm_ops
);

CREATE TABLE inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  sku text NOT NULL,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  category text NOT NULL CHECK(length(category) BETWEEN 1 AND 120),
  unit text NOT NULL DEFAULT 'szt.',
  stock integer NOT NULL DEFAULT 0 CHECK(stock BETWEEN 0 AND 10000000),
  minimal_stock integer NOT NULL DEFAULT 0 CHECK(minimal_stock BETWEEN 0 AND 10000000),
  location_id uuid REFERENCES locations(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX inventory_sku_unique ON inventory_items(lower(sku));
CREATE INDEX inventory_location_idx ON inventory_items(location_id);
CREATE INDEX inventory_search_idx ON inventory_items USING gin (
 (name || ' ' || sku || ' ' || slug || ' ' || category) gin_trgm_ops
);
CREATE INDEX inventory_low_stock_idx ON inventory_items(stock,minimal_stock) WHERE stock <= minimal_stock;

CREATE TABLE invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  name text NOT NULL,
  quantity integer NOT NULL CHECK(quantity > 0),
  unit_price numeric(14,2) NOT NULL CHECK(unit_price >= 0),
  inventory_item_id uuid REFERENCES inventory_items(id),
  category_id uuid REFERENCES asset_categories(id),
  CHECK((inventory_item_id IS NOT NULL)::integer + (category_id IS NOT NULL)::integer = 1)
);
CREATE INDEX invoice_items_invoice_idx ON invoice_items(invoice_id);
CREATE TABLE invoice_item_assets (
  invoice_item_id uuid NOT NULL REFERENCES invoice_items(id),
  asset_id uuid NOT NULL UNIQUE REFERENCES assets(id),
  PRIMARY KEY(invoice_item_id,asset_id)
);
CREATE TABLE deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL UNIQUE REFERENCES invoices(id),
  received_at timestamptz NOT NULL DEFAULT now(),
  received_by uuid NOT NULL REFERENCES users(id),
  notes text
);
CREATE INDEX deliveries_received_idx ON deliveries(received_at DESC,id);
CREATE TABLE delivery_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES deliveries(id),
  invoice_item_id uuid NOT NULL UNIQUE REFERENCES invoice_items(id),
  quantity integer NOT NULL CHECK(quantity > 0)
);
CREATE INDEX delivery_items_delivery_idx ON delivery_items(delivery_id);

CREATE TABLE asset_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL,
  description text NOT NULL,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX asset_history_asset_idx ON asset_history(asset_id,created_at DESC,id);
CREATE TABLE inventory_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id uuid NOT NULL REFERENCES inventory_items(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  delta integer NOT NULL CHECK(delta <> 0),
  balance_after integer NOT NULL CHECK(balance_after >= 0),
  action text NOT NULL CHECK(action IN ('WITHDRAWAL','RETURN','DELIVERY')),
  description text NOT NULL,
  invoice_id uuid REFERENCES invoices(id),
  delivery_id uuid REFERENCES deliveries(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_transactions_item_idx ON inventory_transactions(inventory_item_id,created_at DESC,id);
CREATE INDEX inventory_transactions_created_idx ON inventory_transactions(created_at DESC,id);
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  description text NOT NULL,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs(created_at DESC,id);
CREATE INDEX audit_logs_entity_idx ON audit_logs(entity_type,entity_id,created_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs(actor_id,created_at DESC);
CREATE TABLE idempotency_requests (
  request_id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES users(id),
  operation text NOT NULL,
  payload_hash text NOT NULL,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idempotency_created_idx ON idempotency_requests(created_at);

-- Extension points. No reader, SaaS integration, or file upload is simulated by the MVP.
CREATE TABLE rfid_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_uid text NOT NULL UNIQUE,
  asset_id uuid UNIQUE REFERENCES assets(id),
  assigned_by uuid REFERENCES users(id),
  assigned_at timestamptz,
  technology text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE qr_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid REFERENCES assets(id),
  inventory_item_id uuid REFERENCES inventory_items(id),
  location_id uuid REFERENCES locations(id),
  target_path text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(num_nonnulls(asset_id,inventory_item_id,location_id)=1)
);
CREATE TABLE attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid REFERENCES assets(id),
  invoice_id uuid REFERENCES invoices(id),
  storage_key text NOT NULL UNIQUE,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK(size_bytes > 0),
  sha256 char(64) NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(num_nonnulls(asset_id,invoice_id) <= 1)
);
CREATE TABLE configurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category_id uuid REFERENCES asset_categories(id),
  manufacturer text,
  model text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE configuration_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  configuration_id uuid NOT NULL REFERENCES configurations(id),
  version text NOT NULL,
  attachment_id uuid NOT NULL REFERENCES attachments(id),
  release_notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(configuration_id,version)
);
CREATE TABLE asset_configurations (
  asset_id uuid NOT NULL REFERENCES assets(id),
  configuration_version_id uuid NOT NULL REFERENCES configuration_versions(id),
  applied_by uuid NOT NULL REFERENCES users(id),
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(asset_id,configuration_version_id)
);
CREATE TABLE inventory_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id),
  started_by uuid NOT NULL REFERENCES users(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  reader_reference text,
  status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','COMPLETED','CANCELLED'))
);
CREATE TABLE inventory_scan_items (
  scan_id uuid NOT NULL REFERENCES inventory_scans(id),
  asset_id uuid NOT NULL REFERENCES assets(id),
  expected boolean NOT NULL DEFAULT false,
  observed boolean NOT NULL DEFAULT false,
  observed_at timestamptz,
  PRIMARY KEY(scan_id,asset_id)
);

CREATE FUNCTION prevent_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'History is append-only' USING ERRCODE='42501';
END;
$$;
CREATE TRIGGER asset_history_immutable BEFORE UPDATE OR DELETE ON asset_history FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();
CREATE TRIGGER inventory_history_immutable BEFORE UPDATE OR DELETE ON inventory_transactions FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();
CREATE TRIGGER config_versions_immutable BEFORE UPDATE OR DELETE ON configuration_versions FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();
