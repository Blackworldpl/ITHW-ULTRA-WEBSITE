-- Partial opening data never confirms a physical inventory or replaces existing records.
CREATE SEQUENCE import_fixed_number_seq MINVALUE 1 MAXVALUE 99999999 NO CYCLE;
ALTER TABLE inventory_transactions DROP CONSTRAINT inventory_transactions_action_check;
ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_action_check
  CHECK(action IN ('WITHDRAWAL','RETURN','DELIVERY','OPENING_BALANCE'));
CREATE TABLE inventory_import_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id uuid NOT NULL REFERENCES users(id),
 source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 sheet text NOT NULL,
 mode text NOT NULL CHECK(mode IN ('assets','inventory')),
 request_id uuid NOT NULL UNIQUE,
 payload_hash text NOT NULL,
 result jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE inventory_import_rows (
 batch_id uuid NOT NULL REFERENCES inventory_import_batches(id),
 source_hash text NOT NULL,
 sheet text NOT NULL,
 source_row integer NOT NULL CHECK(source_row > 0),
 mode text NOT NULL CHECK(mode IN ('assets','inventory')),
 asset_ids uuid[] NOT NULL DEFAULT '{}',
 inventory_item_id uuid REFERENCES inventory_items(id),
 verification_status text NOT NULL DEFAULT 'UNVERIFIED' CHECK(verification_status='UNVERIFIED'),
 PRIMARY KEY(source_hash,sheet,source_row),
 CHECK((mode='assets' AND cardinality(asset_ids)>0 AND inventory_item_id IS NULL)
    OR (mode='inventory' AND cardinality(asset_ids)=0 AND inventory_item_id IS NOT NULL))
);
