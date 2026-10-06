import { useCallback } from 'react';
import { appRuntimeEnabled } from '../features';
import { getOrCreateHost } from '../runtime/BrowserRuntimeHost';
import {
  waitForHostReady,
  type HostReadyOutcome,
} from '../runtime/wait-for-host-ready';
import { useConversationV2Store } from '../store';
import { useConversationV2Translation } from '../translation';

export type PreviewWaitOutcome = HostReadyOutcome | 'skipped';

/**
 * Shared NodePod wait used by template-clone gate and initial-message send.
 * Writes i18n stream errors on error/timeout; caller owns previewPhase.
 */
export function useWaitForPreviewHost() {
  const { t } = useConversationV2Translation();

  return useCallback(
    async (sessionId: string, actionTag: string): Promise<PreviewWaitOutcome> => {
      if (!appRuntimeEnabled) return 'skipped';
      const host = getOrCreateHost(sessionId);
      const outcome = await waitForHostReady(host);
      if (outcome === 'error') {
        useConversationV2Store.setState(
          { streaming: false, streamError: t('session.previewBootFailed') },
          false,
          `${actionTag}/preview-error`,
        );
      } else if (outcome === 'timeout') {
        useConversationV2Store.setState(
          { streaming: false, streamError: t('session.previewBootTimeout') },
          false,
          `${actionTag}/preview-timeout`,
        );
      }
      return outcome;
    },
    [t],
  );
}
