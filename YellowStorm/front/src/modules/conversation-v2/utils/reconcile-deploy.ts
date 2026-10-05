import { isAxiosError } from 'axios';
import type { DeployState } from '../interfaces';
import type { SessionPointer } from '../interfaces';
import { deployLog, deployWarn } from './deploy-log';

/** Deploy HTTP can outlive proxies; connection drops while Nest still finishes. */
export const DEPLOY_RECONCILE_INTERVAL_MS = 5_000;
export const DEPLOY_RECONCILE_MAX_WAIT_MS = 240_000;

export function isDeployConnectionLost(error: unknown): boolean {
  if (!isAxiosError(error)) return false;
  return error.code === 'ERR_NETWORK' || error.code === 'ECONNABORTED';
}

function pointerToDeployState(pointer: SessionPointer): DeployState {
  return {
    deployStatus: pointer.deployStatus,
    deployedUrl: pointer.deployedUrl,
    lastDeployedAt: pointer.lastDeployedAt,
  };
}

export async function pollDeployStateFromSession(
  sessionId: string,
  getSession: (id: string) => Promise<SessionPointer>,
  options: { intervalMs?: number; maxWaitMs?: number } = {},
): Promise<DeployState | null> {
  const intervalMs = options.intervalMs ?? DEPLOY_RECONCILE_INTERVAL_MS;
  const maxWaitMs = options.maxWaitMs ?? DEPLOY_RECONCILE_MAX_WAIT_MS;
  const startedAt = Date.now();

  deployLog('reconcile:start', { sessionId, intervalMs, maxWaitMs });

  while (Date.now() - startedAt < maxWaitMs) {
    await sleep(intervalMs);
    try {
      const pointer = await getSession(sessionId);
      deployLog('reconcile:tick', {
        sessionId,
        deployStatus: pointer.deployStatus,
        hasUrl: Boolean(pointer.deployedUrl),
        elapsedMs: Date.now() - startedAt,
      });

      if (pointer.deployStatus === 'deployed' && pointer.deployedUrl) {
        deployLog('reconcile:ok', {
          sessionId,
          deployedUrl: pointer.deployedUrl,
          elapsedMs: Date.now() - startedAt,
        });
        return pointerToDeployState(pointer);
      }

      if (pointer.deployStatus === 'error') {
        deployWarn('reconcile:backend-error', { sessionId });
        return null;
      }
    } catch (pollErr) {
      deployWarn('reconcile:tick-failed', {
        sessionId,
        message: pollErr instanceof Error ? pollErr.message : String(pollErr),
      });
    }
  }

  deployWarn('reconcile:timeout', { sessionId, maxWaitMs });
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
