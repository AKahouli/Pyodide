/**
 * Product default agent that performs LLM attribute extraction for the semantic
 * model population pipeline. It is seeded once and then owned by the admin agent
 * library, so an administrator controls enablement and the model it runs on.
 */
export const SEMANTIC_EXTRACTION_AGENT_TYPE_SLUG = 'semantic_extraction' as const;
export const SEMANTIC_EXTRACTION_AGENT_SLUG = 'semantic-field-extraction' as const;
export const SEMANTIC_EXTRACTION_AGENT_NAME = 'Semantic field extraction' as const;

/**
 * The agent always carries an explicit model so extraction never silently falls
 * back to the ADK's environment default: the effective model is part of revision
 * identity, so it must be knowable at fingerprint time.
 */
export const SEMANTIC_EXTRACTION_DEFAULT_MODEL =
  process.env.SEMANTIC_MODEL_AI_EXTRACTION_MODEL || 'gpt-5.4-nano';

export const SEMANTIC_EXTRACTION_DEFAULT_INSTRUCTION = `[Semantic field extraction]
Read the requested attributes for one business record from the supplied document evidence.
Return only values that appear in the evidence, verbatim or lightly normalized. Never invent a value.
Attach evidenceReferences copied exactly from the supplied evidence entries; omit any attribute you cannot ground.` as const;
