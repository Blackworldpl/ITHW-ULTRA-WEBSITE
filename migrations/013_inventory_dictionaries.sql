CREATE TABLE inventory_dictionary_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK(kind IN ('category','unit')),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 160),
 active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 UNIQUE(kind,name),
 CHECK(kind<>'unit' OR length(name)<=30)
);
-- Preserve every existing spelling, without merging private catalogue values.
INSERT INTO inventory_dictionary_entries(kind,name,label)
 SELECT 'category',category,category FROM inventory_items GROUP BY category;
INSERT INTO inventory_dictionary_entries(kind,name,label)
 SELECT 'unit',unit,unit FROM inventory_items GROUP BY unit;
INSERT INTO inventory_dictionary_entries(kind,name,label) VALUES
 ('category','Akcesoria','Akcesoria'),('category','Kable i przewody','Kable i przewody'),
 ('category','Materiały eksploatacyjne','Materiały eksploatacyjne'),('category','Zasilanie','Zasilanie'),
 ('unit','szt.','sztuka'),('unit','kpl.','komplet'),('unit','opak.','opakowanie'),('unit','m','metr'),('unit','kg','kilogram')
 ON CONFLICT(kind,name) DO NOTHING;
-- Authorized bulk imports and direct migration fixtures retain their catalogue
-- labels. Interactive product writes validate choices before reaching this trigger.
CREATE FUNCTION register_inventory_dictionaries() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.category IS DISTINCT FROM OLD.category THEN
  INSERT INTO inventory_dictionary_entries(kind,name,label) VALUES('category',NEW.category,NEW.category) ON CONFLICT(kind,name) DO NOTHING;
 END IF;
 IF TG_OP='INSERT' OR NEW.unit IS DISTINCT FROM OLD.unit THEN
  INSERT INTO inventory_dictionary_entries(kind,name,label) VALUES('unit',NEW.unit,NEW.unit) ON CONFLICT(kind,name) DO NOTHING;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER register_inventory_dictionaries BEFORE INSERT OR UPDATE OF category,unit ON inventory_items
 FOR EACH ROW EXECUTE FUNCTION register_inventory_dictionaries();
