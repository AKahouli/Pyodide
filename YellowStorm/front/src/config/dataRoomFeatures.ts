const enabled = (value: unknown): boolean => value === 'true';

/** Single, typed access point for staged Governed Data Room UI rollout. */
export const dataRoomFeatures = Object.freeze({
  governanceEnabled: enabled(import.meta.env.VITE_DATA_ROOM_GOVERNANCE_ENABLED),
  sourceVersionsEnabled: enabled(import.meta.env.VITE_DATA_ROOM_SOURCE_VERSIONS_ENABLED),
  workspaceBindingEnabled: enabled(import.meta.env.VITE_DATA_ROOM_WORKSPACE_BINDING_ENABLED),
});
