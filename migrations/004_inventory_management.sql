-- Preserve labels and history while enabling edits and counted-stock corrections.
ALTER TABLE inventory_items ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
CREATE FUNCTION bump_inventory_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inventory_version BEFORE UPDATE ON inventory_items
  FOR EACH ROW EXECUTE FUNCTION bump_inventory_version();
ALTER TABLE inventory_transactions DROP CONSTRAINT inventory_transactions_action_check;
ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_action_check
  CHECK(action IN ('WITHDRAWAL','RETURN','DELIVERY','OPENING_BALANCE','ADJUSTMENT'));
