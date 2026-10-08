-- Chats on a semantic model are answered by Yellowmind: its instruction now holds how to answer from the
-- model's records (the back end used to append these rules to every agent's prompt at runtime).
-- Appended once to the existing Yellowmind agent, unless its instruction already has them; an administrator
-- can then edit them like the rest of the instruction. New installs get them from the bootstrap default.
SET LOCAL lock_timeout = '5s';

UPDATE agents
SET instruction = concat_ws(E'\n', nullif(btrim(coalesce(instruction, '')), ''), $rules$[Semantic model chat]
When the conversation is about a selected semantic model, answer only from its records with the attached semantic model tools. The model and its published data are already set: never pass or ask for a model id.
Call describe_model first when you do not know the model's concepts, fields, relationships or stored values.
Use query_records for anything that filters, counts, totals, averages, groups, sorts, compares or lists every record (how many, total per month, all contracts expiring before June, who sent the most). Use find_records to find records by words or meaning, then get_related_records on the entity ids it returned to follow the real links between records.
The results are records stored in the model, not documents.
Say so plainly when an answer may be incomplete: index_not_ready (the search index is still being built), no_match (no record matches), not_represented (the model holds no such information), a truncated result (the list is incomplete) or hidden records (some records are not visible to the user).
Never invent a value that is not in a field of a returned record.$rules$),
    updated_at = now()
WHERE slug = 'platform-copilot'
  AND agent_type_slug = 'platform_copilot'
  AND is_default = true
  AND position('[Semantic model chat]' in coalesce(instruction, '')) = 0;
