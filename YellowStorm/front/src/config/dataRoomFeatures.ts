const enabled = (value: unknown): boolean => value === 'true';

/** Single, typed access point for staged Governed Data Room UI rollout. */
export const dataRoomFeatures = Object.freeze({
  governanceEnabled: enabled(import.meta.env.VITE_DATA_ROOM_GOVERNANCE_ENABLED),
  workspaceBindingEnabled: enabled(import.meta.env.VITE_DATA_ROOM_WORKSPACE_BINDING_ENABLED),
  reconciliationEnabled: enabled(import.meta.env.VITE_DATA_ROOM_RECONCILIATION_ENABLED),
  validityIntelligenceEnabled: enabled(import.meta.env.VITE_DATA_ROOM_VALIDITY_INTELLIGENCE_ENABLED),
  knowledgeAssessmentEnabled: enabled(import.meta.env.VITE_DATA_ROOM_KNOWLEDGE_ASSESSMENT_ENABLED),
});
