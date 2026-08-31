/**
 * Capabilities advertised by the browser runtime on `runtime.register`.
 * `nativeBinaries` is always false in Nodepod: tools needing it fail with
 * UNSUPPORTED_CAPABILITY instead of falling back to a microVM (phase 5).
 */
export interface RuntimeCapabilities {
  filesystem: boolean;
  npm: boolean;
  previewInspection: boolean;
  nativeBinaries: boolean;
}

export const DEFAULT_RUNTIME_CAPABILITIES: RuntimeCapabilities = {
  filesystem: false,
  npm: false,
  previewInspection: false,
  nativeBinaries: false,
};

/** Tool names as exposed by the Runtime MCP, without the `yellowruntime` prefix. */
export const TOOL_REQUIRED_CAPABILITY: Record<string, keyof RuntimeCapabilities> = {
  list: 'filesystem',
  read: 'filesystem',
  search: 'filesystem',
  write: 'filesystem',
  apply_patch: 'filesystem',
  delete: 'filesystem',
  diff: 'filesystem',
  finalize: 'filesystem',
  run: 'npm',
  dev_server: 'npm',
  preview_inspect: 'previewInspection',
  preview_action: 'previewInspection',
};

/** Same set as `_MUTATING_TOOLS` in the APImanus runtime broker. */
export const MUTATING_TOOLS: ReadonlySet<string> = new Set([
  'write',
  'apply_patch',
  'delete',
]);

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
