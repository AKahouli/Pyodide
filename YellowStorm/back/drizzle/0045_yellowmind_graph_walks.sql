-- Yellowmind can walk several links at once (traverse_records), filter or group on a record several links away in
-- query_records, and explain how two records are connected (connect_records). Adds one rule to its stored
-- instruction, after the linked_to rule when it is there, otherwise at the end, once; an administrator can edit it.
SET LOCAL lock_timeout = '5s';

UPDATE agents
SET instruction = CASE
      WHEN position('and give the total.' in instruction) > 0
        THEN regexp_replace(instruction, 'and give the total\.', 'and give the total.' || E'\n' || $rule$For a question across several links (facts per correspondent, e-mails whose attachment states a penalty, customers of a sales rep's region), call traverse_records: a start (record_ids, or a concept with filters), then each relationship step by step with conditions on the records it reaches; it counts, lists or groups the records reached exactly (group_by with step=0 groups them by start record). A field several links away can also be filtered or grouped in query_records as "<relation>.<relation>.<field>". To explain how two records are related, call connect_records: it returns the shortest chains of real links between them; say they are not connected only when completeness.complete is true.$rule$)
      ELSE concat_ws(E'\n', btrim(instruction), $rule$For a question across several links (facts per correspondent, e-mails whose attachment states a penalty, customers of a sales rep's region), call traverse_records: a start (record_ids, or a concept with filters), then each relationship step by step with conditions on the records it reaches; it counts, lists or groups the records reached exactly (group_by with step=0 groups them by start record). A field several links away can also be filtered or grouped in query_records as "<relation>.<relation>.<field>". To explain how two records are related, call connect_records: it returns the shortest chains of real links between them; say they are not connected only when completeness.complete is true.$rule$)
    END,
    updated_at = now()
WHERE slug = 'platform-copilot'
  AND agent_type_slug = 'platform_copilot'
  AND is_default = true
  AND position('[Semantic model chat]' in coalesce(instruction, '')) > 0
  AND position('traverse_records' in instruction) = 0;
