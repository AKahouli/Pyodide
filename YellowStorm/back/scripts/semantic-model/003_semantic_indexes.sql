CREATE INDEX IF NOT EXISTS semantic_node_types_model_version_idx
  ON semantic_model.node_types (model_id, version_id);
CREATE INDEX IF NOT EXISTS semantic_relation_types_model_version_idx
  ON semantic_model.relation_types (model_id, version_id);
CREATE INDEX IF NOT EXISTS semantic_records_model_version_idx
  ON semantic_model.records (model_id, version_id);
CREATE INDEX IF NOT EXISTS semantic_record_relations_version_idx
  ON semantic_model.record_relations (version_id);
CREATE INDEX IF NOT EXISTS semantic_versions_model_status_idx
  ON semantic_model.versions (model_id, status, version_number DESC);
