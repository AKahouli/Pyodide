-- Yellowmind reads the records linked to a record (the 60 facts an e-mail states) with query_records and
-- linked_to, which returns their fields and an exact total; get_related_records only names linked records.
-- Inserted once into the existing Yellowmind instruction, after its find_records / get_related_records rule
-- when that sentence is still there, otherwise at the end; an administrator can then edit it like the rest.
SET LOCAL lock_timeout = '5s';

UPDATE agents
SET instruction = CASE
      WHEN position('follow the real links between records.' in instruction) > 0
        THEN replace(instruction, 'follow the real links between records.', 'follow the real links between records.' || E'\n' || $rule$To read or summarise the records linked to a record (the facts an e-mail states, the lines of an invoice), call query_records on the linked concept with linked_to=[{"relation": <the relationship>, "record_ids": [<the record's entityId>]}] and only the fields you need; page with offset=nextOffset until every record is read, and give the total. get_related_records only names the linked records: use it to see which links exist.$rule$)
      ELSE concat_ws(E'\n', btrim(instruction), $rule$To read or summarise the records linked to a record (the facts an e-mail states, the lines of an invoice), call query_records on the linked concept with linked_to=[{"relation": <the relationship>, "record_ids": [<the record's entityId>]}] and only the fields you need; page with offset=nextOffset until every record is read, and give the total. get_related_records only names the linked records: use it to see which links exist.$rule$)
    END,
    updated_at = now()
WHERE slug = 'platform-copilot'
  AND agent_type_slug = 'platform_copilot'
  AND is_default = true
  AND position('[Semantic model chat]' in coalesce(instruction, '')) > 0
  AND position('linked_to=' in instruction) = 0;
