-- Query performance (audit 2026-10-08). Results of existing queries are unchanged:
-- the same rows and the same order, with less work per query.

-- 1. Stored location paths. location_paths was a recursive view evaluated in every
-- list, count, search and lookup. The path is now kept on the row by triggers and
-- the view keeps its columns, so existing queries read a plain table.
ALTER TABLE locations ADD COLUMN path text;
WITH RECURSIVE tree AS (
 SELECT id,name::text AS path FROM locations WHERE parent_id IS NULL
 UNION ALL
 SELECT l.id,t.path||' / '||l.name FROM locations l JOIN tree t ON l.parent_id=t.id
) UPDATE locations l SET path=tree.path FROM tree WHERE tree.id=l.id;
ALTER TABLE locations ALTER COLUMN path SET NOT NULL;

CREATE FUNCTION locations_set_path() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_path text;
BEGIN
 IF NEW.parent_id IS NOT NULL THEN
  -- FOR SHARE waits for a concurrent rename or move of the parent and then reads
  -- its committed path. A missing parent is reported by the foreign key.
  SELECT path INTO parent_path FROM locations WHERE id=NEW.parent_id FOR SHARE;
 END IF;
 NEW.path := coalesce(parent_path||' / ','')||NEW.name;
 RETURN NEW;
END $$;
CREATE TRIGGER locations_path BEFORE INSERT OR UPDATE OF name,parent_id ON locations
 FOR EACH ROW EXECUTE FUNCTION locations_set_path();

CREATE FUNCTION locations_cascade_path() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- Listing parent_id fires the BEFORE trigger on each child, which recomputes its
 -- path from the parent updated above; this trigger then repeats one level down.
 UPDATE locations SET parent_id=parent_id WHERE parent_id=NEW.id;
 RETURN NULL;
END $$;
CREATE TRIGGER locations_path_cascade AFTER UPDATE OF name,parent_id ON locations
 FOR EACH ROW WHEN (OLD.path IS DISTINCT FROM NEW.path) EXECUTE FUNCTION locations_cascade_path();

CREATE OR REPLACE VIEW location_paths AS SELECT id,name,kind,parent_id,path,version FROM locations;

-- 2. Branch device counts: count devices per location first (one row per location),
-- then add the counts up along each branch, instead of joining every branch with
-- every device.
CREATE OR REPLACE VIEW location_summary AS
 WITH RECURSIVE branches AS (
  SELECT id AS ancestor,id AS child FROM locations
  UNION ALL SELECT b.ancestor,l.id FROM branches b JOIN locations l ON l.parent_id=b.child
 ),direct AS (SELECT location_id,count(*)::integer AS asset_count FROM assets WHERE location_id IS NOT NULL GROUP BY location_id),
 counts AS (SELECT b.ancestor,sum(d.asset_count)::integer AS asset_count FROM branches b JOIN direct d ON d.location_id=b.child GROUP BY b.ancestor)
 SELECT l.*,COALESCE(c.asset_count,0) AS asset_count,
  (SELECT count(*)::integer FROM locations s WHERE s.parent_id=l.id) AS child_count
 FROM location_paths l LEFT JOIN counts c ON c.ancestor=l.id;

-- 3. Warehouse search text with Polish letters folded, stored and indexed. It is
-- exactly the product part of the expression the list used to compute per row;
-- each search word is matched against it or against the location path.
ALTER TABLE inventory_items ADD COLUMN search_text text GENERATED ALWAYS AS (
 translate(name||' '||coalesce(sku,'')||' '||coalesce(product_code,'')||' '||slug||' '||category,
  'ąćęłńóśźżĄĆĘŁŃÓŚŹŻ','acelnoszzACELNOSZZ')
) STORED;
CREATE INDEX inventory_search_text_idx ON inventory_items USING gin(search_text gin_trgm_ops);
-- Never matched by any query (and NULL for products without SKU since 006).
DROP INDEX inventory_search_idx;

-- 4. Superseded by assets_extended_search_idx (migration 010). No query uses this
-- expression any more; dropping it saves work on every asset write.
DROP INDEX assets_search_idx;
