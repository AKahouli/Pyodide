import { nanoid } from 'nanoid';
import {
  getOrCreateHost,
  removeHost,
  type BrowserRuntimeHost,
} from '@/modules/conversation-v2/runtime/BrowserRuntimeHost';
import type { ValidationStep, ValidationStepContext } from './pipeline';
import { extractTemplateZipFromFile } from './extract-template-zip';

const READY_TIMEOUT_MS = 300_000;
/** Local-only NodePod sessions — no Conversation v2 / Ceph staging. */
export const LOCAL_TEMPLATE_VALIDATION_PREFIX = 'validate-local-';

class AbortedError extends Error {
  constructor() {
    super('Validation cancelled.');
    this.name = 'AbortedError';
  }
}

export function createZipNodepodValidationStep(zipFile: File): ValidationStep {
  return {
    id: 'nodepod',
    labelKey: 'validation.nodepod',
    async run(ctx) {
      if (ctx.signal.aborted) throw new AbortedError();

      const sessionId = `${LOCAL_TEMPLATE_VALIDATION_PREFIX}${nanoid()}`;
      ctx.setSessionId(sessionId);
      ctx.setStagingTemplateId(null);

      const files = await extractTemplateZipFromFile(zipFile);
      if (ctx.signal.aborted) throw new AbortedError();

      const host = getOrCreateHost(sessionId);
      try {
        await waitForReady(host, sessionId, files, ctx.signal);
      } catch (err) {
        await cleanup(sessionId);
        ctx.setSessionId(null);
        throw err;
      }
    },
  };
}

function waitForReady(
  host: BrowserRuntimeHost,
  sessionId: string,
  files: Awaited<ReturnType<typeof extractTemplateZipFromFile>>,
  signal: AbortSignal,
): Promise<void> {
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
      if (state.status === 'ready' && state.previewUrl) finish(resolve);
      else if (state.status === 'error' || state.status === 'disconnected') {
        finish(() => reject(new Error(state.error || 'The template could not be started in NodePod.')));
      }
    });

    const onAbort = () => finish(() => reject(new AbortedError()));
    signal.addEventListener('abort', onAbort, { once: true });

    const timer = setTimeout(
      () =>
        finish(() =>
          reject(new Error('NodePod validation timed out before the preview became ready.')),
        ),
      READY_TIMEOUT_MS,
    );

    void host.startFromLocalFiles(sessionId, files);
  });
}

async function cleanup(sessionId: string): Promise<void> {
  removeHost(sessionId);
}

export async function disposeZipValidationSession(
  sessionId: string | null,
  stagingTemplateId: string | null,
): Promise<void> {
  if (sessionId) {
    removeHost(sessionId);
  }
  if (stagingTemplateId) {
    const { adminTemplateApi } = await import('../../../api');
    await adminTemplateApi.discardStagingZip(stagingTemplateId).catch(() => undefined);
  }
}
