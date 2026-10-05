-- 028 - The e-mail archive reader's "apercu" column (first 500 characters of the new text) became
-- "corps" (the whole new text). Mappings of an e-mail archive's messages sheet read "corps" from now
-- on. Only the source column is renamed: the concept attribute it fills keeps its key, and populated
-- data is left as is until the next run. The runtime also reads "corps" for a mapping left on
-- "apercu", so a mapping this misses still works.
-- (migrate.mjs splits on a semicolon ending a line: the inner ones are kept mid-line.)
DO $$
BEGIN
  IF to_regclass('semantic_datasource.discovery_profiles') IS NULL THEN RETURN; END IF; UPDATE semantic_model.source_mappings m
     SET field_mappings = (
           SELECT jsonb_agg(CASE WHEN f->>'mode' = 'direct' AND f->>'sourceField' = 'apercu'
                                 THEN jsonb_set(f, '{sourceField}', '"corps"') ELSE f END
                            ORDER BY position)
             FROM jsonb_array_elements(m.field_mappings) WITH ORDINALITY AS item(f, position)),
         updated_at = now()
   WHERE m.sheet_name = 'messages'
     AND m.field_mappings @> '[{"mode": "direct", "sourceField": "apercu"}]'::jsonb
     AND NOT m.field_mappings @> '[{"sourceField": "corps"}]'::jsonb
     AND EXISTS (SELECT 1 FROM semantic_datasource.discovery_profiles p
                  WHERE p.asset_id = m.document_id
                    AND p.profile->'structure'->>'kind' = 'email_archive'); END
$$;
