-- Row-level immutability triggers do not cover TRUNCATE.
CREATE TRIGGER asset_history_no_truncate BEFORE TRUNCATE ON asset_history FOR EACH STATEMENT EXECUTE FUNCTION prevent_history_mutation();
CREATE TRIGGER inventory_history_no_truncate BEFORE TRUNCATE ON inventory_transactions FOR EACH STATEMENT EXECUTE FUNCTION prevent_history_mutation();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION prevent_history_mutation();
CREATE TRIGGER config_versions_no_truncate BEFORE TRUNCATE ON configuration_versions FOR EACH STATEMENT EXECUTE FUNCTION prevent_history_mutation();
