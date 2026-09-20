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
    updated_at
  FROM semantic_model.models;
GRANT SELECT ON semantic_api.model_summary TO semantic_api_user;

-- RLS never grants access by itself: the data role needs table privileges,
-- and the policy narrows visible rows. Tables stay out of the exposed schema,
-- so PostgREST can never address them directly.
GRANT USAGE ON SCHEMA semantic_model TO semantic_api_user;
GRANT SELECT ON semantic_model.models TO semantic_api_user;
