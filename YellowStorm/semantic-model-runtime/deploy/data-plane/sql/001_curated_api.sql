-- Data-plane curated API (R1, REST Broadcast only).
-- Curated schema is semantic_api per the binding supplemental directives.
-- semantic_ui was created empty by early bootstrap and never referenced; drop it
-- so exactly one curated convention exists.
-- Run as the semantic_app owner role. No secrets in this file.

DROP SCHEMA IF EXISTS semantic_ui;

CREATE SCHEMA IF NOT EXISTS semantic_api AUTHORIZATION semantic_app;
REVOKE ALL ON SCHEMA semantic_api FROM PUBLIC;
GRANT USAGE ON SCHEMA semantic_api TO semantic_api_user;
ALTER DEFAULT PRIVILEGES FOR ROLE semantic_app IN SCHEMA semantic_api
  GRANT SELECT ON TABLES TO semantic_api_user;

-- Audited membership helper. The data role gets EXECUTE on this function only,
-- never direct SELECT on membership tables. Fixed search_path, read-only SQL.
CREATE OR REPLACE FUNCTION semantic_model.is_member(p_model_id uuid, p_user_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = semantic_model, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM semantic_model.memberships
    WHERE model_id = p_model_id AND user_id = p_user_id
  ) OR EXISTS (
    SELECT 1 FROM semantic_model.models
    WHERE id = p_model_id AND owner_user_id = p_user_id
  )
$$;
REVOKE ALL ON FUNCTION semantic_model.is_member(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION semantic_model.is_member(uuid, text) TO semantic_api_user;

-- Table owners bypass RLS; these policies bind only the data role.
ALTER TABLE semantic_model.models ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS model_api_access ON semantic_model.models;
CREATE POLICY model_api_access ON semantic_model.models
  FOR SELECT TO semantic_api_user
  USING (
    id::text = (current_setting('request.jwt.claims', true)::json ->> 'model_id')
    AND semantic_model.is_member(
      id,
      current_setting('request.jwt.claims', true)::json ->> 'sub'
    )
  );

-- First curated projection: model catalog summary. No evidence, counts, or secrets.
CREATE OR REPLACE VIEW semantic_api.model_summary WITH (security_invoker = true) AS
  SELECT
    id::text AS model_id,
    name,
    status,
    revision,
    binding.version AS active_data_revision,
    updated_at
  FROM semantic_model.models
  LEFT JOIN semantic_runtime.active_bindings binding
    ON binding.model_id = models.id::text AND binding.environment = 'production';
GRANT SELECT ON semantic_api.model_summary TO semantic_api_user;

-- RLS never grants access by itself: the data role needs table privileges,
-- and the policy narrows visible rows. Tables stay out of the exposed schema,
-- so PostgREST can never address them directly.
GRANT USAGE ON SCHEMA semantic_model TO semantic_api_user;
GRANT USAGE ON SCHEMA semantic_runtime TO semantic_api_user;
GRANT SELECT ON semantic_model.models TO semantic_api_user;
GRANT SELECT ON semantic_runtime.active_bindings TO semantic_api_user;

-- Mapped source status. Runtime source heads share this database by deployment
-- contract; raw event revisions and payloads remain outside the exposed schema.
ALTER TABLE semantic_model.source_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS source_mapping_api_access ON semantic_model.source_mappings;
CREATE POLICY source_mapping_api_access ON semantic_model.source_mappings
  FOR SELECT TO semantic_api_user
  USING (
    model_id::text = (current_setting('request.jwt.claims', true)::json ->> 'model_id')
    AND semantic_model.is_member(
      model_id,
      current_setting('request.jwt.claims', true)::json ->> 'sub'
    )
  );

CREATE OR REPLACE VIEW semantic_api.source_summary WITH (security_invoker = true) AS
  SELECT
    mapping.id::text AS mapping_id,
    mapping.model_id::text AS model_id,
    mapping.workspace_id,
    mapping.document_id,
    mapping.sheet_name,
    mapping.asset_kind,
    mapping.status AS mapping_status,
    head.revision AS source_revision,
    head.event_type,
    head.deleted,
    head.occurred_at,
    head.payload ->> 'originalName' AS original_name,
    head.payload ->> 'mimeType' AS mime_type,
    head.payload ->> 'documentStatus' AS document_status,
    head.payload ->> 'indexingStatus' AS indexing_status
  FROM semantic_model.source_mappings mapping
  LEFT JOIN semantic_jobs.source_heads head
    ON head.workspace_id = mapping.workspace_id AND head.asset_id = mapping.document_id;

GRANT SELECT ON semantic_model.source_mappings TO semantic_api_user;
GRANT USAGE ON SCHEMA semantic_jobs TO semantic_api_user;
GRANT SELECT ON semantic_jobs.source_heads TO semantic_api_user;
GRANT SELECT ON semantic_api.source_summary TO semantic_api_user;

-- Gate E bounded source analysis. Profiles are authorized through at least one
-- source mapping visible to the token's model; raw workbook cells are never stored.
ALTER TABLE semantic_datasource.discovery_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS discovery_profile_api_access ON semantic_datasource.discovery_profiles;
CREATE POLICY discovery_profile_api_access ON semantic_datasource.discovery_profiles
  FOR SELECT TO semantic_api_user
  USING (EXISTS (
    SELECT 1 FROM semantic_model.source_mappings mapping
    WHERE mapping.workspace_id = discovery_profiles.workspace_id
      AND mapping.document_id = discovery_profiles.asset_id
      AND mapping.model_id::text = (current_setting('request.jwt.claims', true)::json ->> 'model_id')
      AND semantic_model.is_member(
        mapping.model_id,
        current_setting('request.jwt.claims', true)::json ->> 'sub'
      )
  ));

ALTER TABLE semantic_datasource.mapping_health ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mapping_health_api_access ON semantic_datasource.mapping_health;
CREATE POLICY mapping_health_api_access ON semantic_datasource.mapping_health
  FOR SELECT TO semantic_api_user
  USING (
    model_id::text = (current_setting('request.jwt.claims', true)::json ->> 'model_id')
    AND semantic_model.is_member(
      model_id,
      current_setting('request.jwt.claims', true)::json ->> 'sub'
    )
  );

CREATE OR REPLACE VIEW semantic_api.source_profile_summary WITH (security_invoker = true) AS
  SELECT mapping.model_id::text AS model_id, mapping.id::text AS mapping_id,
    profile.workspace_id, profile.asset_id, profile.source_fingerprint,
    profile.source_version, profile.parser_version, profile.status,
    profile.profile->'structure' AS structure,
    profile.profile->'coverage' AS coverage,
    profile.profile->'warnings' AS warnings, profile.completed_at
  FROM semantic_model.source_mappings mapping
  JOIN semantic_datasource.discovery_profiles profile
    ON profile.workspace_id=mapping.workspace_id AND profile.asset_id=mapping.document_id;

CREATE OR REPLACE VIEW semantic_api.source_preview WITH (security_invoker = true) AS
  SELECT mapping.model_id::text AS model_id, mapping.id::text AS mapping_id,
    profile.workspace_id, profile.asset_id, profile.source_fingerprint,
    profile.options_fingerprint, profile.profile->'structure' AS structure,
    profile.profile->'samples' AS samples,
    profile.profile->'fieldProfiles' AS field_profiles,
    profile.preview, profile.completed_at
  FROM semantic_model.source_mappings mapping
  JOIN semantic_datasource.discovery_profiles profile
    ON profile.workspace_id=mapping.workspace_id AND profile.asset_id=mapping.document_id;

CREATE OR REPLACE VIEW semantic_api.mapping_health WITH (security_invoker = true) AS
  SELECT model_id::text AS model_id, mapping_id::text AS mapping_id,
    source_fingerprint, mapping_version, state, missing_fields,
    available_fields, warnings, checked_at
  FROM semantic_datasource.mapping_health;

GRANT USAGE ON SCHEMA semantic_datasource TO semantic_api_user;
GRANT SELECT ON semantic_datasource.discovery_profiles,
  semantic_datasource.mapping_health TO semantic_api_user;
GRANT SELECT ON semantic_api.source_profile_summary, semantic_api.source_preview,
  semantic_api.mapping_health TO semantic_api_user;

NOTIFY pgrst, 'reload schema';
