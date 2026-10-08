-- Existing quantities stay exact. Unit precision is explicit and invoice lines
-- retain a snapshot so later dictionary edits cannot reinterpret a receipt.
ALTER TABLE inventory_dictionary_entries ADD COLUMN quantity_precision integer NOT NULL DEFAULT 0 CHECK(quantity_precision BETWEEN 0 AND 3);
ALTER TABLE inventory_dictionary_entries ADD CONSTRAINT category_quantity_precision CHECK(kind='unit' OR quantity_precision=0);
UPDATE inventory_dictionary_entries SET quantity_precision=3,version=version+1 WHERE kind='unit' AND name IN ('m','kg');

ALTER TABLE inventory_items ALTER COLUMN stock TYPE numeric(13,3), ALTER COLUMN minimal_stock TYPE numeric(13,3);
ALTER TABLE invoice_items ALTER COLUMN quantity TYPE numeric(13,3);
ALTER TABLE invoice_items ADD COLUMN quantity_precision integer NOT NULL DEFAULT 0 CHECK(quantity_precision BETWEEN 0 AND 3);
UPDATE invoice_items it SET quantity_precision=d.quantity_precision FROM inventory_dictionary_entries d WHERE it.inventory_item_id IS NOT NULL AND d.kind='unit' AND d.name=it.unit;
ALTER TABLE delivery_items ALTER COLUMN quantity TYPE numeric(13,3);
ALTER TABLE inventory_transactions ALTER COLUMN delta TYPE numeric(13,3), ALTER COLUMN balance_after TYPE numeric(13,3);

CREATE FUNCTION protect_unit_precision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.kind='unit' AND NEW.quantity_precision<OLD.quantity_precision AND
    (EXISTS(SELECT 1 FROM inventory_items WHERE unit=OLD.name) OR EXISTS(SELECT 1 FROM invoice_items WHERE unit=OLD.name AND inventory_item_id IS NOT NULL)) THEN
  RAISE EXCEPTION 'Used unit precision cannot decrease' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_unit_precision BEFORE UPDATE OF quantity_precision ON inventory_dictionary_entries FOR EACH ROW EXECUTE FUNCTION protect_unit_precision();

CREATE FUNCTION validate_inventory_quantities() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE precision integer;
BEGIN
 SELECT quantity_precision INTO precision FROM inventory_dictionary_entries WHERE kind='unit' AND name=NEW.unit FOR SHARE;
 IF precision IS NULL OR NEW.stock<>round(NEW.stock,precision) OR NEW.minimal_stock<>round(NEW.minimal_stock,precision) THEN
  RAISE EXCEPTION 'Quantity does not match unit precision' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
-- Alphabetically after register_inventory_dictionaries, including legacy imports.
CREATE TRIGGER validate_inventory_quantities BEFORE INSERT OR UPDATE OF stock,minimal_stock,unit ON inventory_items FOR EACH ROW EXECUTE FUNCTION validate_inventory_quantities();

CREATE FUNCTION validate_purchase_quantities() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE precision integer;
BEGIN
 IF TG_TABLE_NAME='invoice_items' THEN
  precision=CASE WHEN NEW.inventory_item_id IS NULL THEN 0 ELSE NEW.quantity_precision END;
 ELSE
  SELECT quantity_precision INTO precision FROM invoice_items WHERE id=NEW.invoice_item_id;
 END IF;
 IF precision IS NULL OR NEW.quantity<>round(NEW.quantity,precision) THEN
  RAISE EXCEPTION 'Quantity does not match purchase unit precision' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_invoice_quantities BEFORE INSERT OR UPDATE OF quantity,quantity_precision ON invoice_items FOR EACH ROW EXECUTE FUNCTION validate_purchase_quantities();
CREATE TRIGGER validate_delivery_quantities BEFORE INSERT OR UPDATE OF quantity ON delivery_items FOR EACH ROW EXECUTE FUNCTION validate_purchase_quantities();

CREATE FUNCTION validate_movement_quantities() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE precision integer;
BEGIN
 SELECT d.quantity_precision INTO precision FROM inventory_items n JOIN inventory_dictionary_entries d ON d.kind='unit' AND d.name=n.unit WHERE n.id=NEW.inventory_item_id;
 IF precision IS NULL OR NEW.delta<>round(NEW.delta,precision) OR NEW.balance_after<>round(NEW.balance_after,precision) THEN
  RAISE EXCEPTION 'Quantity does not match movement unit precision' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_movement_quantities BEFORE INSERT ON inventory_transactions FOR EACH ROW EXECUTE FUNCTION validate_movement_quantities();
