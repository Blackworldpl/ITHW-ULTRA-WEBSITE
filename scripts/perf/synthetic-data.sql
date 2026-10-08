-- Synthetic data at the scale of the 2026-10-08 performance audit:
-- 50 000 assets, 15 000 products, 785 locations in 4 levels, 2 000 employees,
-- 5 000 invoices, 200 000 asset history rows and 500 000 audit rows.
-- Fictional values only. Run on an empty, migrated database created for this
-- purpose (never on a company database):
--   psql "$PERF_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/perf/synthetic-data.sql
SELECT setseed(0.20261008);
BEGIN;
INSERT INTO users(name,email,password_hash,role)
 VALUES('Perf operator','perf-operator@example.test','scrypt:disabled','ADMIN');

INSERT INTO suppliers(name) SELECT 'Dostawca '||g||' sp. z o.o.' FROM generate_series(1,40) g;
INSERT INTO asset_categories(name)
 SELECT c FROM unnest(ARRAY['Laptopy','Monitory','Drukarki','Telefony','Stacje dokujące','Serwery','Przełączniki','Tablety']) c
 ON CONFLICT DO NOTHING;

-- Location tree: 5 sites / 6 buildings / 5 zones / 4 rooms.
INSERT INTO locations(name,kind) SELECT 'Oddział '||s||' Łódź-Żoliborz','SITE' FROM generate_series(1,5) s;
INSERT INTO locations(name,kind,parent_id) SELECT 'Budynek '||chr(64+b),'BUILDING',p.id FROM locations p,generate_series(1,6) b WHERE p.kind='SITE';
INSERT INTO locations(name,kind,parent_id) SELECT 'Strefa '||z||' piętro','ZONE',p.id FROM locations p,generate_series(1,5) z WHERE p.kind='BUILDING';
INSERT INTO locations(name,kind,parent_id) SELECT 'Pokój '||(100*z+r),'ROOM',p.id FROM locations p,generate_series(1,4) r,LATERAL (SELECT (random()*9)::int+1 AS z) q WHERE p.kind='ZONE';

INSERT INTO employees(name,employee_number,department,email,location_id)
SELECT f.first||' '||l.last||' '||g, 'EMP-'||lpad(g::text,5,'0'),
 (ARRAY['IT','Księgowość','Logistyka','Sprzedaż','Produkcja'])[1+g%5],
 'pracownik'||g||'@example.test',
 (SELECT id FROM locations WHERE kind='ROOM' ORDER BY id OFFSET (g%600) LIMIT 1)
FROM generate_series(1,2000) g
CROSS JOIN LATERAL (SELECT (ARRAY['Łukasz','Zofia','Paweł','Małgorzata','Jan','Anna','Michał','Żaneta','Grzegorz','Ewa'])[1+g%10] AS first) f
CROSS JOIN LATERAL (SELECT (ARRAY['Żółkiewski','Nowak','Wiśniewska','Kowalczyk','Śliwiński','Dąbrowska','Lewandowski','Zieliński'])[1+(g/10)%8] AS last) l;

INSERT INTO invoices(number,supplier_id,date,amount,received_by)
SELECT 'FV/'||(2020+g%6)||'/'||lpad(g::text,5,'0'),
 (SELECT id FROM suppliers ORDER BY name OFFSET (g%40) LIMIT 1),
 date '2020-01-01'+(g%2100),(random()*20000)::numeric(14,2),(SELECT id FROM users LIMIT 1)
FROM generate_series(1,5000) g;

CREATE TEMP TABLE perf_rooms AS SELECT row_number() OVER (ORDER BY id) AS n,id FROM locations WHERE kind='ROOM';
CREATE TEMP TABLE perf_employees AS SELECT row_number() OVER (ORDER BY id) AS n,id,name FROM employees;
CREATE TEMP TABLE perf_invoices AS SELECT row_number() OVER (ORDER BY id) AS n,id FROM invoices;
CREATE TEMP TABLE perf_categories AS SELECT row_number() OVER (ORDER BY id) AS n,id FROM asset_categories;

INSERT INTO assets(name,category_id,manufacturer,model,serial_number,mac_address,ip_address,hostname,location_id,status,owner,employee_id,
 purchased_at,purchase_price,invoice_id,warranty_until,is_fixed_asset,fixed_asset_number,rfid_tag,created_at,updated_at)
SELECT m.kind||' '||m.maker||' '||m.model, c.id, m.maker, m.model||' '||(g%40),
 'SN'||upper(substr(md5(g::text),1,10)),
 CASE WHEN g%3=0 THEN ('02:00:'||lpad(to_hex((g>>16)&255),2,'0')||':'||lpad(to_hex((g>>8)&255),2,'0')||':'||lpad(to_hex(g&255),2,'0')||':01')::macaddr END,
 CASE WHEN g%4=0 THEN ('10.'||((g>>16)&255)||'.'||((g>>8)&255)||'.'||(g&255))::inet END,
 CASE WHEN g%2=0 THEN 'ROB-'||lpad(g::text,6,'0') END,
 CASE WHEN g%25<>0 THEN r.id END,
 CASE WHEN g%5 IN (0,1) THEN 'ASSIGNED' WHEN g%5=2 THEN 'AVAILABLE' WHEN g%5=3 THEN 'PREPARATION' ELSE (ARRAY['REPAIR','DAMAGED','RETIRED'])[1+g%3] END,
 CASE WHEN g%5=0 THEN e.name WHEN g%5=1 THEN 'Gość konferencyjny '||(g%97) END,
 CASE WHEN g%5=0 THEN e.id END,
 date '2020-01-01'+(g%2100),(random()*9000)::numeric(14,2),
 CASE WHEN g%5<>4 THEN i.id END,
 CASE WHEN g%3<>0 THEN date '2020-01-01'+(g%2100)+365*(1+g%4) END,
 g%11=0, CASE WHEN g%11=0 THEN 'ST/'||lpad(g::text,7,'0') END,
 CASE WHEN g%7=0 THEN 'RFID'||lpad(to_hex(g),8,'0') END,
 timestamptz '2021-01-01'+(g||' minutes')::interval*25, timestamptz '2021-01-01'+(g||' minutes')::interval*25
FROM generate_series(1,50000) g
JOIN perf_categories c ON c.n=1+g%8
JOIN perf_rooms r ON r.n=1+g%600
JOIN perf_employees e ON e.n=1+g%2000
JOIN perf_invoices i ON i.n=1+g%5000
CROSS JOIN LATERAL (SELECT (ARRAY['Laptop','Monitor','Drukarka','Telefon','Stacja dokująca','Serwer','Przełącznik','Tablet'])[1+g%8] AS kind,
 (ARRAY['Dell','Lenovo','HP','Samsung','Cisco','Apple','Zebra','Brother'])[1+(g/8)%8] AS maker,
 (ARRAY['Latitude 5440','ThinkPad T14','EliteBook 840','Galaxy Tab S9','Catalyst 9200','MacBook Air','ZT411','HL-L5100'])[1+(g/64)%8] AS model) m;

-- A few renamed employees: stored owner text differs from the current name.
UPDATE employees SET name=name||' (zmiana nazwiska)' WHERE id IN (SELECT id FROM perf_employees WHERE n%97=0);

INSERT INTO inventory_items(name,slug,sku,product_code,category,unit,stock,minimal_stock,location_id)
SELECT p.kind||' '||p.detail||' '||g, 'produkt-'||g,
 CASE WHEN g%9<>0 THEN 'SKU-'||lpad(g::text,6,'0') END,
 CASE WHEN g%4=0 THEN 'PC-'||upper(substr(md5((g*7)::text),1,8)) END,
 (ARRAY['Akcesoria','Kable i przewody','Materiały eksploatacyjne','Zasilanie'])[1+g%4],
 (ARRAY['szt.','m','opak.','kpl.'])[1+g%4], (g%120), (g%30),
 CASE WHEN g%10<>0 THEN r.id END
FROM generate_series(1,15000) g
JOIN perf_rooms r ON r.n=1+(g*7)%600
CROSS JOIN LATERAL (SELECT (ARRAY['Kabel','Toner','Zasilacz','Mysz','Klawiatura','Przejściówka','Bęben','Listwa'])[1+g%8] AS kind,
 (ARRAY['HDMI 2.1','USB-C żeński','czarny','biały','zielony','łączący','sieciowy','świetlny'])[1+(g/8)%8] AS detail) p;

INSERT INTO asset_history(asset_id,actor_id,action,description,after_data)
SELECT a.id,(SELECT id FROM users LIMIT 1),'UPDATE_ASSET','Synthetic history '||g,'{}'::jsonb
FROM generate_series(1,200000) g JOIN (SELECT row_number() OVER (ORDER BY id) AS n,id FROM assets) a ON a.n=1+g%50000;
INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description)
SELECT (SELECT id FROM users LIMIT 1),'SYNTHETIC','asset',g::text,'Synthetic audit '||g FROM generate_series(1,500000) g;
COMMIT;
ANALYZE;
