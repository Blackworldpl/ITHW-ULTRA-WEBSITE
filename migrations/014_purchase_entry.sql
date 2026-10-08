ALTER TABLE invoices ALTER COLUMN amount DROP NOT NULL;
ALTER TABLE invoice_items ALTER COLUMN unit_price DROP NOT NULL;
ALTER TABLE invoice_items ADD COLUMN position integer NOT NULL DEFAULT 1;
WITH numbered AS (SELECT id,row_number() OVER(PARTITION BY invoice_id ORDER BY name,id) AS n FROM invoice_items)
UPDATE invoice_items it SET position=n.n FROM numbered n WHERE n.id=it.id;
ALTER TABLE invoice_items ADD COLUMN unit text NOT NULL DEFAULT 'szt.';
UPDATE invoice_items it SET unit=n.unit FROM inventory_items n WHERE n.id=it.inventory_item_id;
ALTER TABLE invoice_items ADD COLUMN serial_numbers jsonb NOT NULL DEFAULT '[]';
ALTER TABLE invoice_items ADD COLUMN manufacturer text;
ALTER TABLE invoice_items ADD COLUMN model text;
ALTER TABLE invoice_items ADD COLUMN location_id uuid REFERENCES locations(id);
CREATE INDEX invoice_items_position_idx ON invoice_items(invoice_id,position,id);
