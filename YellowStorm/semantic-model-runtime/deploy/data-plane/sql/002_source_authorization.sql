-- Source rows require both model membership and a live, actor-bound source grant.
-- semantic_access remains outside PostgREST's exposed semantic_api schema.
CREATE OR REPLACE FUNCTION semantic_access.is_source_allowed(
  p_grant_id uuid,
  p_actor text,
  p_model_id uuid,
  p_workspace_id text,
  p_asset_id text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = semantic_access, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM semantic_access.read_grants grant_row
    JOIN semantic_access.read_grant_sources source_row
      ON source_row.grant_id = grant_row.id
    WHERE grant_row.id = p_grant_id
      AND grant_row.actor_user_id = p_actor
      AND grant_row.model_id = p_model_id
      AND grant_row.revoked_at IS NULL
      AND grant_row.expires_at > now()
      AND source_row.workspace_id = p_workspace_id
      AND (source_row.asset_id IS NULL OR source_row.asset_id = p_asset_id)
  )
$$;

REVOKE ALL ON FUNCTION semantic_access.is_source_allowed(uuid, text, uuid, text, text) FROM PUBLIC;
GRANT USAGE ON SCHEMA semantic_access TO semantic_api_user;
GRANT EXECUTE ON FUNCTION semantic_access.is_source_allowed(uuid, text, uuid, text, text) TO semantic_api_user;

DROP POLICY IF EXISTS source_mapping_api_access ON semantic_model.source_mappings;
CREATE POLICY source_mapping_api_access ON semantic_model.source_mappings
  FOR SELECT TO semantic_api_user
  USING (
    model_id::text = (current_setting('request.jwt.claims', true)::json ->> 'model_id')
    AND semantic_model.is_member(
      model_id,
      current_setting('request.jwt.claims', true)::json ->> 'sub'
    )
    AND semantic_access.is_source_allowed(
      NULLIF(current_setting('request.jwt.claims', true)::json ->> 'grant_id', '')::uuid,
      current_setting('request.jwt.claims', true)::json ->> 'sub',
      model_id,
      workspace_id,
      document_id
    )
  );

NOTIFY pgrst, 'reload schema';
