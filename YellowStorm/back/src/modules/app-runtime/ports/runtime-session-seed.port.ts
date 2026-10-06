/**
 * Read port for the revision a conversation session was created from.
 *
 * Conversation V2 owns the session rows. App Runtime needs only the seed
 * revision to bootstrap a workspace binding, so it depends on this port
 * instead of the session store.
 */
export const RUNTIME_SESSION_SEED_SOURCE = Symbol('RUNTIME_SESSION_SEED_SOURCE');

export interface RuntimeSessionSeed {
  /** Revision the session was created from; null when it has no seed yet. */
  starterRevisionId: string | null;
}

export interface RuntimeSessionSeedSource {
  findSeedByAiSessionId(aiSessionId: string): Promise<RuntimeSessionSeed | null>;
}