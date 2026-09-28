-- WhatsApp was removed from the backend, front and ADK (PR #317). Drop its three empty tables.
-- Refuses to run if any of them still holds rows, so it can never silently destroy data:
-- export them first. Nothing references these tables (their only FK points out, to public.agents).
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['whatsapp_chat_bindings', 'whatsapp_auth_sessions', 'whatsapp_integrations'] LOOP
    IF to_regclass('channels.' || t) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM channels.%I', t) INTO n;
      IF n > 0 THEN
        RAISE EXCEPTION 'channels.% still holds % rows; export them before dropping', t, n;
      END IF;
    END IF;
  END LOOP;
END $$;

DROP TABLE IF EXISTS channels.whatsapp_chat_bindings;
DROP TABLE IF EXISTS channels.whatsapp_auth_sessions;
DROP TABLE IF EXISTS channels.whatsapp_integrations;
