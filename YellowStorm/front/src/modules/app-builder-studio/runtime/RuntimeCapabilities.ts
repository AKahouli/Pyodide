import type { RuntimeCapabilities } from './runtime.types';

/** Nodepod can do filesystem, npm, and preview, but not native binaries. */
export const NODEPOD_CAPABILITIES: RuntimeCapabilities = {
  filesystem: true,
  npm: true,
  previewInspection: true,
  nativeBinaries: false,
};

export function normalizeCapabilities(
  raw: Partial<RuntimeCapabilities> | null | undefined,
): RuntimeCapabilities {
  return {
    filesystem: raw?.filesystem === true,
    npm: raw?.npm === true,
    previewInspection: raw?.previewInspection === true,
    nativeBinaries: raw?.nativeBinaries === true,
  };
}
