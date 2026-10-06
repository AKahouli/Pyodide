-- get_related_records now returns the linked records' values on request and the exact number of linked records
-- per relationship, and every read tool reports how complete its answer is (completeness) and why a query matched
-- nothing (diagnostics). Updates the sentence of Yellowmind's stored instruction that said it only names linked
-- records, and adds the completeness rule after the "never invent" rule, once; an administrator can edit both.
SET LOCAL lock_timeout = '5s';

UPDATE agents
SET instruction = replace(
      replace(instruction,
        'get_related_records only names the linked records: use it to see which links exist.',
        $rule$get_related_records shows which links a record has, with the exact number of linked records per relationship (linkCounts) and, with fields=[...], their values; it returns at most 100 records, so read longer lists with query_records and linked_to.$rule$),
      'Never invent a value that is not in a field of a returned record.',
      'Never invent a value that is not in a field of a returned record.' || E'\n' ||
      $rule$Every data answer carries completeness: say "all" or "every" only when complete is true; otherwise say how many records were returned out of how many (total, linkCounts) and why (reasons). When query_records finds nothing, read diagnostics: retry with a stored value it suggests (didYouMean) or ask the user before saying that nothing exists.$rule$),
    updated_at = now()
WHERE slug = 'platform-copilot'
  AND agent_type_slug = 'platform_copilot'
  AND is_default = true
  AND position('[Semantic model chat]' in coalesce(instruction, '')) > 0
  AND position('completeness' in instruction) = 0;
