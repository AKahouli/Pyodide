DO $$
DECLARE
  identity_count integer;
  canonical_id character(24);
  canonical_agent_type_id character(24);
  canonical_agent_type_slug varchar(100);
  canonical_is_active boolean;
BEGIN
  LOCK TABLE agents IN SHARE ROW EXCLUSIVE MODE;

  SELECT count(*) INTO identity_count
  FROM agents
  WHERE slug IN ('my-second-brain', 'platform_copilot', 'platform-copilot')
    AND is_default = true;

  IF identity_count = 0 THEN
    RETURN;
  ELSIF identity_count > 1 THEN
    RAISE EXCEPTION 'Platform Copilot agent identity is not unique; resolve manually';
  END IF;

  SELECT id, agent_type_id, agent_type_slug, is_active
  INTO canonical_id, canonical_agent_type_id, canonical_agent_type_slug, canonical_is_active
  FROM agents
  WHERE slug = 'platform-copilot' AND is_default = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Platform Copilot agent still uses a legacy identity; apply identity migrations first';
  ELSIF canonical_is_active = false THEN
    RAISE EXCEPTION 'Platform Copilot agent is inactive; resolve manually';
  ELSIF btrim(canonical_agent_type_id) !~ '^[0-9a-f]{24}$' THEN
    RAISE EXCEPTION 'Platform Copilot agent type identity is invalid; resolve manually';
  ELSIF btrim(coalesce(canonical_agent_type_slug, '')) = '' THEN
    UPDATE agents
    SET agent_type_slug = 'platform_copilot',
        updated_at = now()
    WHERE id = canonical_id;
  ELSIF canonical_agent_type_slug <> 'platform_copilot' THEN
    RAISE EXCEPTION 'Platform Copilot agent type slug conflicts with the canonical identity; resolve manually';
  END IF;
END $$;
