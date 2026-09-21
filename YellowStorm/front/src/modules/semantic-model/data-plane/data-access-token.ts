// P2.SB17: existing-auth bridge client. The browser keeps its Yellowmind
// session; NestJS mints short-lived model-scoped tokens. Single-flight fetch
// so N mounted components share one renewal. Memory only: no storage, no
// Supabase Auth, no shadow users, no service_role anywhere near the browser.
import { AUTH_LOST_EVENT } from '@/lib/api/client';
import { semanticModelApi } from '../api';
import type { EnabledSemanticDataGrant } from './semantic-api.types';

interface CachedGrant {
  modelId: string;
  response: EnabledSemanticDataGrant;
  // Refresh well before expiry; revocation still enforced server-side per call.
  refreshAtMs: number;
  inflight: Promise<EnabledSemanticDataGrant> | null;
}

const RENEW_FRACTION = 0.75;
const grants = new Map<string, CachedGrant>();
// Generation bumped on every clear: late resolutions from a previous session
// must never repopulate the cache (logout / account switch race).
let generation = 0;

export class SemanticDataApiDisabledError extends Error {}

async function fetchGrant(modelId: string, gen: number): Promise<EnabledSemanticDataGrant> {
  // Domain command client (existing auth); never a direct PostgREST call.
  const grant = await semanticModelApi.dataToken(modelId);
  if (gen !== generation) throw new Error('data grant superseded by logout or model switch');
  if (!grant.capabilities.dataApi || !grant.token || !grant.restUrl || !grant.expiresAt) {
    throw new SemanticDataApiDisabledError('semantic data API is disabled');
  }
  const enabledGrant = grant as EnabledSemanticDataGrant;
  const ttlMs = Math.max(
    10_000,
    new Date(enabledGrant.expiresAt).getTime() - Date.now(),
  );
  grants.set(modelId, {
    modelId,
    response: enabledGrant,
    refreshAtMs: Date.now() + ttlMs * RENEW_FRACTION,
    inflight: null,
  });
  return enabledGrant;
}

function clearInflight(modelId: string, inflight: Promise<EnabledSemanticDataGrant>): void {
  if (grants.get(modelId)?.inflight === inflight) {
    const current = grants.get(modelId);
    if (current) current.inflight = null;
  }
}

/** Current grant for a model, refreshing single-flight before expiry. */
export function getDataGrant(modelId: string): Promise<EnabledSemanticDataGrant> {
  const cached = grants.get(modelId);
  if (cached && Date.now() < cached.refreshAtMs) return Promise.resolve(cached.response);
  if (cached?.inflight) return cached.inflight;
  const inflight = fetchGrant(modelId, generation);
  grants.set(modelId, {
    modelId,
    response: cached?.response as EnabledSemanticDataGrant,
    refreshAtMs: cached?.refreshAtMs ?? 0,
    inflight,
  });
  // Dual-handler .then: clears bookkeeping on settle without creating an
  // unhandled rejection when the fetch itself fails or is superseded.
  void inflight.then(
    () => clearInflight(modelId, inflight),
    () => clearInflight(modelId, inflight),
  );
  return inflight;
}

/** Drop cached grants: logout, model switch, permission loss. Unsubscribes happen in the channel hook. */
export function clearDataGrants(modelId?: string): void {
  generation += 1;
  if (modelId) grants.delete(modelId);
  else grants.clear();
}

// Central logout/account-switch lifecycle (see apiClient safeRedirectToLogin).
if (typeof window !== 'undefined' && !(globalThis as Record<string, unknown>).__semanticGrantsHooked) {
  (globalThis as Record<string, unknown>).__semanticGrantsHooked = true;
  window.addEventListener(AUTH_LOST_EVENT, () => clearDataGrants());
}
