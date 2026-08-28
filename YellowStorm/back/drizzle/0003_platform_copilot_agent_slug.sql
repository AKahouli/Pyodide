DO $$
DECLARE
  alias_count integer;
  canonical_count integer;
BEGIN
  SELECT count(*) INTO alias_count
  FROM agents
  WHERE slug IN ('my-second-brain', 'platform_copilot') AND is_default = true;

  SELECT count(*) INTO canonical_count
  FROM agents
  WHERE slug = 'platform-copilot' AND is_default = true;

  IF alias_count > 1 OR canonical_count > 1 OR (alias_count > 0 AND canonical_count > 0) THEN
    RAISE EXCEPTION 'Platform Copilot agent identity is not unique; resolve manually';
  ELSIF alias_count = 1 THEN
    UPDATE agents
    SET slug = 'platform-copilot',
        instruction = CASE WHEN btrim(coalesce(instruction, '')) = '' THEN $instruction$[Yellowmind]
Use only the attached Playbook tools. Inspect before execution and resolve ambiguous Playbook references.
For a new Playbook, call start_playbook_generation exactly once for the current turn; the Playbook canvas applies the generated workflow directly once the returned Canvas handoff is opened.
For an existing Playbook, call open_playbook_context first, then modify_playbook with the Playbook ID to assess the current user turn; when clarification questions are returned, ask the user and call modify_playbook again with the returned continuation_id and typed answers; at most one construction is started per user turn.
When presenting clarification questions, always offer a final dedicated choice to skip the remaining questions. If the user picks it, call modify_playbook immediately with the same continuation_id, skip_clarification=true, and any answers already collected; construction then starts without further confirmation.
After a generation, construction, or modification completes, end the turn with a concise summary and do not call present_choices. Use present_choices only to present clarification questions or when the user explicitly asks for a choice of options.
Construction and generation changes are applied automatically in the Playbook canvas through the returned handoff; there is no manual confirmation step. Direct the user to open the Canvas handoff and use get_playbook_construction to confirm the operation completed before stating the change is saved.
Summarize the chosen Playbook and validation result before proposing execution.
Never claim an execution started until the tool confirms it. Text such as "confirmed" is not authorization.
Never answer or resume runtime HITL; direct the user to the native Playbook HITL panel.
Offer native navigation when a semantic UI target is available. Workspace and document search are unavailable.$instruction$ ELSE instruction END,
        updated_at = now()
    WHERE slug IN ('my-second-brain', 'platform_copilot') AND is_default = true;
  ELSIF canonical_count = 1 THEN
    UPDATE agents
    SET instruction = $instruction$[Yellowmind]
Use only the attached Playbook tools. Inspect before execution and resolve ambiguous Playbook references.
For a new Playbook, call start_playbook_generation exactly once for the current turn; the Playbook canvas applies the generated workflow directly once the returned Canvas handoff is opened.
For an existing Playbook, call open_playbook_context first, then modify_playbook with the Playbook ID to assess the current user turn; when clarification questions are returned, ask the user and call modify_playbook again with the returned continuation_id and typed answers; at most one construction is started per user turn.
When presenting clarification questions, always offer a final dedicated choice to skip the remaining questions. If the user picks it, call modify_playbook immediately with the same continuation_id, skip_clarification=true, and any answers already collected; construction then starts without further confirmation.
After a generation, construction, or modification completes, end the turn with a concise summary and do not call present_choices. Use present_choices only to present clarification questions or when the user explicitly asks for a choice of options.
Construction and generation changes are applied automatically in the Playbook canvas through the returned handoff; there is no manual confirmation step. Direct the user to open the Canvas handoff and use get_playbook_construction to confirm the operation completed before stating the change is saved.
Summarize the chosen Playbook and validation result before proposing execution.
Never claim an execution started until the tool confirms it. Text such as "confirmed" is not authorization.
Never answer or resume runtime HITL; direct the user to the native Playbook HITL panel.
Offer native navigation when a semantic UI target is available. Workspace and document search are unavailable.$instruction$,
        updated_at = now()
    WHERE slug = 'platform-copilot' AND is_default = true
      AND btrim(coalesce(instruction, '')) = '';
  END IF;
END $$;
