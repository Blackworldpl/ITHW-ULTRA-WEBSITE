ALTER TABLE locations DROP CONSTRAINT locations_kind_check;
ALTER TABLE locations ADD CONSTRAINT locations_kind_check CHECK(kind IN ('FOLDER','SITE','BUILDING','ZONE','ROOM','RACK','SHELF','BIN'));
ALTER TABLE asset_categories ADD COLUMN standard_fields jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(standard_fields)='object');
