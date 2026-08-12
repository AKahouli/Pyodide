WITH duplicates AS (
  SELECT version_id, id,
         ROW_NUMBER() OVER (
           PARTITION BY version_id, relation_type_id, source_record_id, target_record_id
           ORDER BY created_at, id
         ) AS duplicate_number
  FROM semantic_model.record_relations
)
DELETE FROM semantic_model.record_relations relation
USING duplicates
WHERE relation.version_id = duplicates.version_id
  AND relation.id = duplicates.id
  AND duplicates.duplicate_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS semantic_record_relation_identity_uidx
  ON semantic_model.record_relations (version_id, relation_type_id, source_record_id, target_record_id);
