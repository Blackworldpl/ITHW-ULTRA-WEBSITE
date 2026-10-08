-- Additive indexes for indexed candidate lookup, fuzzy names, and scan counters.
CREATE INDEX assets_extended_search_idx ON assets USING gin(
 (coalesce(asset_id,'')||' '||coalesce(name,'')||' '||coalesce(serial_number,'')||' '||coalesce(model,'')||' '||coalesce(manufacturer,'')||' '||coalesce(hostname,'')||' '||coalesce(owner,'')||' '||coalesce(rfid_tag,'')||' '||coalesce(sku,'')||' '||coalesce(product_code,'')||' '||coalesce(fixed_asset_number,'')) gin_trgm_ops);
CREATE INDEX assets_name_fuzzy_idx ON assets USING gin(name gin_trgm_ops);
CREATE INDEX assets_model_fuzzy_idx ON assets USING gin(lower(model) gin_trgm_ops);
CREATE INDEX assets_mac_search_idx ON assets USING gin(coalesce(mac_address::text,'') gin_trgm_ops);
CREATE INDEX assets_ip_search_idx ON assets USING gin(coalesce(host(ip_address),'') gin_trgm_ops);
CREATE INDEX employees_name_search_idx ON employees USING gin(name gin_trgm_ops);
CREATE INDEX locations_name_search_idx ON locations USING gin(name gin_trgm_ops);
CREATE INDEX users_name_search_idx ON users USING gin(name gin_trgm_ops);
CREATE INDEX attachments_name_search_idx ON attachments USING gin(original_name gin_trgm_ops);
CREATE INDEX inventory_name_search_idx ON inventory_items USING gin(name gin_trgm_ops);
CREATE INDEX incidents_title_search_idx ON incidents USING gin(title gin_trgm_ops);
CREATE INDEX configurations_name_search_idx ON configurations USING gin(name gin_trgm_ops);
CREATE INDEX inventory_scan_event_result_idx ON inventory_scan_events(scan_id,result);
CREATE INDEX inventory_scan_observed_idx ON inventory_scan_items(scan_id,expected,observed);
