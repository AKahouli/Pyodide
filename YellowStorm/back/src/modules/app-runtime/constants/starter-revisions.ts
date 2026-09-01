import {
  STARTER_REACT_VITE_V1_FILES,
  STARTER_REACT_VITE_V1_MANIFEST_KEY,
  STARTER_REACT_VITE_V1_REVISION_ID,
  type StarterManifestFile,
} from './starter-react-vite-v1';
import {
  STARTER_REACT_VITE_V3_FILES,
  STARTER_REACT_VITE_V3_MANIFEST_KEY,
  STARTER_REACT_VITE_V3_REVISION_ID,
} from './starter-react-vite-v3';
import {
  STARTER_REACT_VITE_V4_FILES,
  STARTER_REACT_VITE_V4_MANIFEST_KEY,
  STARTER_REACT_VITE_V4_REVISION_ID,
} from './starter-react-vite-v4';

export type { StarterManifestFile } from './starter-react-vite-v1';

export const SYSTEM_STARTER_REVISION_IDS = [
  STARTER_REACT_VITE_V1_REVISION_ID,
  STARTER_REACT_VITE_V3_REVISION_ID,
  STARTER_REACT_VITE_V4_REVISION_ID,
] as const;

export type SystemStarterRevisionId = (typeof SYSTEM_STARTER_REVISION_IDS)[number];

export function isSystemStarterRevisionId(revisionId: string): boolean {
  return (SYSTEM_STARTER_REVISION_IDS as readonly string[]).includes(revisionId);
}

export interface EmbeddedStarterDefinition {
  revisionId: string;
  manifestKey: string;
  files: readonly StarterManifestFile[];
}

const STARTERS: Record<string, EmbeddedStarterDefinition> = {
  [STARTER_REACT_VITE_V1_REVISION_ID]: {
    revisionId: STARTER_REACT_VITE_V1_REVISION_ID,
    manifestKey: STARTER_REACT_VITE_V1_MANIFEST_KEY,
    files: STARTER_REACT_VITE_V1_FILES,
  },
  [STARTER_REACT_VITE_V3_REVISION_ID]: {
    revisionId: STARTER_REACT_VITE_V3_REVISION_ID,
    manifestKey: STARTER_REACT_VITE_V3_MANIFEST_KEY,
    files: STARTER_REACT_VITE_V3_FILES,
  },
  [STARTER_REACT_VITE_V4_REVISION_ID]: {
    revisionId: STARTER_REACT_VITE_V4_REVISION_ID,
    manifestKey: STARTER_REACT_VITE_V4_MANIFEST_KEY,
    files: STARTER_REACT_VITE_V4_FILES,
  },
};

export function resolveEmbeddedStarter(revisionId: string): EmbeddedStarterDefinition | null {
  return STARTERS[revisionId] ?? null;
}

/** Default system starter for new App Builder sessions. */
export const DEFAULT_STARTER_REVISION_ID = STARTER_REACT_VITE_V4_REVISION_ID;
export const DEFAULT_STARTER_MANIFEST_KEY = STARTER_REACT_VITE_V4_MANIFEST_KEY;
