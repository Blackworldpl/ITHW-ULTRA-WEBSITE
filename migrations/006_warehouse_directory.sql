ALTER TABLE asset_categories ADD COLUMN description text;
ALTER TABLE asset_categories ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE suppliers ADD COLUMN tax_id text;
ALTER TABLE suppliers ADD COLUMN regon text;
ALTER TABLE suppliers ADD COLUMN street text;
ALTER TABLE suppliers ADD COLUMN postal_code text;
ALTER TABLE suppliers ADD COLUMN city text;
ALTER TABLE suppliers ADD COLUMN country text;
ALTER TABLE suppliers ADD COLUMN contact_name text;
ALTER TABLE suppliers ADD COLUMN email text;
ALTER TABLE suppliers ADD COLUMN phone text;
ALTER TABLE suppliers ADD COLUMN website text;
ALTER TABLE suppliers ADD COLUMN bank_account text;
ALTER TABLE suppliers ADD COLUMN notes text;
ALTER TABLE suppliers ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
CREATE UNIQUE INDEX suppliers_tax_unique ON suppliers(lower(tax_id)) WHERE tax_id IS NOT NULL;
ALTER TABLE locations ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
CREATE OR REPLACE VIEW location_paths AS
 WITH RECURSIVE paths AS (
  SELECT id,name,kind,parent_id,name::text AS path,version FROM locations WHERE parent_id IS NULL
  UNION ALL
  SELECT l.id,l.name,l.kind,l.parent_id,p.path||' / '||l.name,l.version FROM locations l JOIN paths p ON l.parent_id=p.id
 ) SELECT * FROM paths;
CREATE TABLE employees (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(length(name) BETWEEN 2 AND 200),
 employee_number text, email text, phone text, department text, position text,
 location_id uuid REFERENCES locations(id),
 user_id uuid UNIQUE REFERENCES users(id) ON DELETE SET NULL,
 active boolean NOT NULL DEFAULT true, notes text,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX employees_number_unique ON employees(lower(employee_number)) WHERE employee_number IS NOT NULL;
CREATE UNIQUE INDEX employees_email_unique ON employees(lower(email)) WHERE email IS NOT NULL;
ALTER TABLE assets ADD COLUMN employee_id uuid REFERENCES employees(id);
ALTER TABLE assets ADD COLUMN sku text;
ALTER TABLE assets ADD COLUMN product_code text;
CREATE INDEX assets_employee_idx ON assets(employee_id);
ALTER TABLE inventory_items ADD COLUMN product_code text;
ALTER TABLE inventory_items ALTER COLUMN sku DROP NOT NULL;
ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_sku_check;
