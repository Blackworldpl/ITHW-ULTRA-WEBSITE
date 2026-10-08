ALTER TABLE locations DROP CONSTRAINT locations_kind_check;
ALTER TABLE locations ADD CONSTRAINT locations_kind_check CHECK(kind IN ('FOLDER','SITE','BUILDING','ZONE','ROOM','RACK','SHELF','BIN','DESK'));
ALTER TABLE invoices ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE invoices ADD COLUMN notes text;
ALTER TABLE invoice_items DROP CONSTRAINT invoice_items_check;
ALTER TABLE invoice_items ADD CONSTRAINT invoice_items_check CHECK(NOT (inventory_item_id IS NOT NULL AND category_id IS NOT NULL));

CREATE TABLE equipment_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 employee_id uuid REFERENCES employees(id),
 location_id uuid REFERENCES locations(id),
 kind text NOT NULL CHECK(kind IN ('equipment','clearance','workstation')),
 reference text NOT NULL UNIQUE,
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 request_id uuid NOT NULL UNIQUE,
 CHECK((kind IN ('equipment','clearance') AND employee_id IS NOT NULL AND location_id IS NULL) OR (kind='workstation' AND employee_id IS NULL AND location_id IS NOT NULL))
);
CREATE INDEX equipment_documents_employee_idx ON equipment_documents(employee_id,created_at DESC);
CREATE INDEX equipment_documents_location_idx ON equipment_documents(location_id,created_at DESC);
CREATE TRIGGER equipment_documents_immutable BEFORE UPDATE OR DELETE ON equipment_documents FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();
CREATE TRIGGER equipment_documents_no_truncate BEFORE TRUNCATE ON equipment_documents FOR EACH STATEMENT EXECUTE FUNCTION prevent_history_mutation();
