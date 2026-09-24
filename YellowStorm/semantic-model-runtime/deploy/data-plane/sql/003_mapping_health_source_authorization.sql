-- Mapping health leaks source shape: missing_fields, available_fields and state describe
-- columns of the underlying asset. Model membership alone is therefore not enough — the row
-- must also be covered by a live, actor-bound source grant, exactly like the mapping itself.
--
-- mapping_health carries no workspace_id/asset_id, so the grant is checked through the
-- mapping the health row belongs to.
DROP POLICY IF EXISTS mapping_health_api_access ON semantic_datasource.mapping_health;
CREATE POLICY mapping_health_api_access ON semantic_datasource.mapping_health
  FOR SELECT TO semantic_api_user
  USING (
    model_id::text = (current_setting('request.jwt.claims', true)::json ->> 'model_id')
    AND semantic_model.is_member(
      model_id,
      current_setting('request.jwt.claims', true)::json ->> 'sub'
    )
    AND EXISTS (
      SELECT 1
      FROM semantic_model.source_mappings mapping
      WHERE mapping.id = mapping_health.mapping_id
        AND mapping.model_id = mapping_health.model_id
        AND semantic_access.is_source_allowed(
          NULLIF(current_setting('request.jwt.claims', true)::json ->> 'grant_id', '')::uuid,
          current_setting('request.jwt.claims', true)::json ->> 'sub',
          mapping.model_id,
          mapping.workspace_id,
          mapping.document_id
        )
    )
  );

NOTIFY pgrst, 'reload schema';
