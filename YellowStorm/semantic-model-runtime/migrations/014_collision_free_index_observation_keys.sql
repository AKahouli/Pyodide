-- Keep one observation for unresolved documents without reserving a valid text key.
DROP INDEX semantic_datasource.semantic_datasource_index_observations_uidx;

CREATE UNIQUE INDEX semantic_datasource_index_observations_uidx
  ON semantic_datasource.index_observations (asset_version_id, document_pk)
  NULLS NOT DISTINCT;
