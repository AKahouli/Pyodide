import { conversationV2Api } from '@/modules/conversation-v2/api';
import {
  getOrCreateHost,
  removeHost,
  type BrowserRuntimeHost,
} from '@/modules/conversation-v2/runtime/BrowserRuntimeHost';
import type { ValidationStep, ValidationStepContext } from './pipeline';

/** NodePod boot (hydrate → install → dev server) can take a while for a cold project. */
const READY_TIMEOUT_MS = 240_000;

class AbortedError extends Error {
  constructor() {
    super('Validation cancelled.');
    this.name = 'AbortedError';
  }
}

/**
 * The single validation step: open the template revision in a real NodePod
 * preview via the existing BrowserRuntimeHost (a transient session seeded with
 * the template revision). Resolves once the host reaches `ready`; rejects on
 * `error`/`disconnected`, timeout, or abort.
 */
export function createNodepodValidationStep(): ValidationStep {
  return {
    id: 'nodepod',
    labelKey: 'validation.nodepod',
    async run(ctx) {
      if (ctx.signal.aborted) throw new AbortedError();

      const { sessionId } = await conversationV2Api.createSession([], ctx.templateId);
      ctx.setSessionId(sessionId);

      if (ctx.signal.aborted) {
        await cleanup(sessionId);
        throw new AbortedError();
      }

      const host = getOrCreateHost(sessionId);
      try {
        await waitForReady(host, sessionId, ctx.signal);
      } catch (err) {
        // Failed / timed out / aborted → drop the transient session + pod.
        await cleanup(sessionId);
        ctx.setSessionId(null);
        throw err;
      }
      // Success: host stays alive so the preview keeps running; the panel owns
      // final teardown (removeHost + deleteSession) when the dialog closes.
    },
  };
}

function waitForReady(host: BrowserRuntimeHost, sessionId: string, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      signal.removeEventListener('abort', onAbort);
      fn();
    };

    const unsubscribe = host.subscribe((state) => {
      if (state.status === 'ready') finish(resolve);
      else if (state.status === 'error' || state.status === 'disconnected') {
        finish(() => reject(new Error(state.error || 'The template could not be started in NodePod.')));
      }
    });

    const onAbort = () => finish(() => reject(new AbortedError()));
    signal.addEventListener('abort', onAbort, { once: true });

    const timer = setTimeout(
      () => finish(() => reject(new Error('NodePod validation timed out before the preview became ready.'))),
      READY_TIMEOUT_MS,
    );

    void host.start(sessionId);
  });
}

async function cleanup(sessionId: string): Promise<void> {
  removeHost(sessionId);
  try {
    await conversationV2Api.deleteSession(sessionId);
  } catch {
    // Best-effort: a throwaway validation session must never block the UI.
  }
}
