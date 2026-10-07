-- Logical-index document ids are opaque varchar keys in the deployed index.
DROP INDEX IF EXISTS semantic_datasource.semantic_datasource_index_observations_uidx;

ALTER TABLE semantic_datasource.index_observations
  ALTER COLUMN document_pk TYPE TEXT USING document_pk::text;

CREATE UNIQUE INDEX semantic_datasource_index_observations_uidx
  ON semantic_datasource.index_observations
  (asset_version_id, COALESCE(document_pk, '__unresolved__'));
