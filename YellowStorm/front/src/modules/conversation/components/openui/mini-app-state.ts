import { submissionSignature, typedActionData } from './actions';

export interface MiniAppStateIdentity {
  conversationId: string;
  messageId: string;
  componentId: string;
  programDigest: string;
  /** Included in the local lifecycle key; authentication remains owned by apiClient. */
  userId: string;
}

export interface MiniAppStateSnapshot {
  schemaVersion: 1;
  libraryVersion: 'yellowstorm-miniapp-v1';
  programDigest: string;
  stateRevision: number;
  state: Record<string, unknown>;
  updatedAt: string | null;
  canWrite?: boolean;
}

export interface MiniAppStateWrite {
  schemaVersion: 1;
  libraryVersion: 'yellowstorm-miniapp-v1';
  programDigest: string;
  expectedRevision: number;
  state: Record<string, unknown>;
}

type MiniAppExportGuard = (snapshot?: MiniAppStateSnapshot) => Promise<void>;
// Lifecycle callbacks only: private state remains owned by its mounted draft hook.
const exportGuards = new Map<string, Set<MiniAppExportGuard>>();
function exportIdentityKey(identity: MiniAppStateIdentity): string {
  return JSON.stringify([identity.userId, identity.conversationId, identity.messageId, identity.componentId, identity.programDigest]);
}
export function registerMiniAppExportGuard(identity: MiniAppStateIdentity, guard: MiniAppExportGuard): () => void {
  const key = exportIdentityKey(identity);
  const guards = exportGuards.get(key) ?? new Set<MiniAppExportGuard>();
  guards.add(guard);
  exportGuards.set(key, guards);
  return () => {
    guards.delete(guard);
    if (!guards.size && exportGuards.get(key) === guards) exportGuards.delete(key);
  };
}
/** Flush before fetching, then compare the authenticated snapshot before capture. */
export async function assertMiniAppExportReady(identity: MiniAppStateIdentity, snapshot?: MiniAppStateSnapshot): Promise<void> {
  if (snapshot) validateMiniAppSnapshot(snapshot, identity.programDigest);
  for (const guard of exportGuards.get(exportIdentityKey(identity)) ?? []) await guard(snapshot);
}

export function validateMiniAppState(value: unknown): ReturnType<typeof typedActionData> {
  const state = typedActionData(value);
  // PostgreSQL JSONB cannot represent NUL or unpaired UTF-16 surrogates.
  // Unicode mode treats a valid surrogate pair as one code point, outside this range.
  const unsupportedString = /[\u0000\uD800-\uDFFF]/u;
  const visit = (node: unknown): void => {
    if (typeof node === 'string') {
      if (unsupportedString.test(node)) throw new Error('Invalid mini-app state string');
    } else if (Array.isArray(node)) node.forEach(visit);
    else if (node !== null && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) { visit(key); visit(child); }
    }
  };
  visit(state);
  return state;
}
export const miniAppStateSignature = submissionSignature;

export function validateMiniAppSnapshot(value: MiniAppStateSnapshot, digest: string): MiniAppStateSnapshot {
  if (value.schemaVersion !== 1 || value.libraryVersion !== 'yellowstorm-miniapp-v1'
    || value.programDigest !== digest || !Number.isSafeInteger(value.stateRevision) || value.stateRevision < 0
    || (value.updatedAt !== null && typeof value.updatedAt !== 'string')
    || (value.canWrite !== undefined && typeof value.canWrite !== 'boolean')) throw new Error('Invalid mini-app state response');
  return { ...value, state: validateMiniAppState(value.state) };
}
