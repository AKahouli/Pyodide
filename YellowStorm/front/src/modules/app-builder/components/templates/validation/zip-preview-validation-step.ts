import { nanoid } from 'nanoid';
import {
  getOrCreateHost,
  removeHost,
  type BrowserRuntimeHost,
} from '@/modules/conversation-v2/runtime/BrowserRuntimeHost';
import type { ValidationStep } from './pipeline';
import { extractTemplateZipFromFile } from './extract-template-zip';

const READY_TIMEOUT_MS = 300_000;
/** Local-only preview sessions — no Conversation v2 / Ceph staging. */
export const LOCAL_TEMPLATE_VALIDATION_PREFIX = 'validate-local-';

class AbortedError extends Error {
  constructor() {
    super('Validation cancelled.');
    this.name = 'AbortedError';
  }
}

export function createZipPreviewValidationStep(zipFile: File): ValidationStep {
  return {
    id: 'preview',
    labelKey: 'templateStudio.bootStep',
    async run(ctx) {
      if (ctx.signal.aborted) throw new AbortedError();

      const sessionId = `${LOCAL_TEMPLATE_VALIDATION_PREFIX}${nanoid()}`;
      ctx.setSessionId(sessionId);

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
        finish(() =>
          reject(new Error(state.error || 'The template could not be started for preview.')),
        );
      }
    });

    const onAbort = () => finish(() => reject(new AbortedError()));
    signal.addEventListener('abort', onAbort, { once: true });

    const timer = setTimeout(
      () =>
        finish(() =>
          reject(new Error('Template validation timed out before the preview became ready.')),
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
  _stagingTemplateId: string | null = null,
): Promise<void> {
  if (sessionId) {
    removeHost(sessionId);
  }
}
