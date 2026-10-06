import { useEffect, useRef, useState } from 'react';
import { appRuntimeEnabled } from '../features';
import type { AgentSessionLocationState, AgentEvent } from '../types';
import {
  hasUserMessage,
  isTemplateCloneNavigation,
  isTemplateCloneSession as resolveTemplateCloneSession,
  shouldGateTemplateClonePreview,
} from '../template-clone-gate';
import { useConversationV2Store } from '../store';
import { useWaitForPreviewHost } from './useWaitForPreviewHost';

export type PreviewPhase = 'none' | 'waiting' | 'ready';

export interface UseTemplateClonePreviewArgs {
  sessionId: string | null;
  isDraftClone: boolean;
  locationState: AgentSessionLocationState | null;
  loading: boolean;
  notFound: boolean;
  isReadOnlyViewer: boolean;
  events: AgentEvent[];
  initialMessage?: string;
  starterRevisionId: string | null;
}

/**
 * Clone-App / template-seeded preview gate: wait for NodePod, lock Send until ready.
 * Uses `previewPhase` alone (`lockSend = phase === 'waiting'`).
 */
export function useTemplateClonePreview({
  sessionId,
  isDraftClone,
  locationState,
  loading,
  notFound,
  isReadOnlyViewer,
  events,
  initialMessage,
  starterRevisionId,
}: UseTemplateClonePreviewArgs) {
  const waitForPreviewHost = useWaitForPreviewHost();
  const [showAppBuilderBanner, setShowAppBuilderBanner] = useState(false);
  const [previewPhase, setPreviewPhase] = useState<PreviewPhase>(() =>
    isDraftClone && appRuntimeEnabled ? 'waiting' : 'none',
  );
  /** Latched from nav so replaceState does not lose clone mode before getSession returns. */
  const [latchedTemplateClone, setLatchedTemplateClone] = useState(
    () => isDraftClone || isTemplateCloneNavigation(locationState),
  );
  const gatedPreviewForSession = useRef<string | null>(null);

  useEffect(() => {
    gatedPreviewForSession.current = null;
    const state = locationState;
    setShowAppBuilderBanner(state?.source === 'app-builder');
    setLatchedTemplateClone(isDraftClone || isTemplateCloneNavigation(state));
    if (isDraftClone && appRuntimeEnabled) {
      setPreviewPhase('waiting');
    } else if (!isDraftClone) {
      setPreviewPhase('none');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: route key only
  }, [sessionId, isDraftClone]);

  const isTemplateCloneSession = resolveTemplateCloneSession({
    latchedFromNav: latchedTemplateClone,
    starterRevisionId,
  });

  // Template clone: wait for NodePod ready, enable Send, do NOT auto-stream.
  useEffect(() => {
    if (loading || notFound || isReadOnlyViewer) return;
    if (!sessionId) return;
    if (
      !shouldGateTemplateClonePreview({
        isTemplateCloneSession,
        hasInitialMessage: Boolean(initialMessage),
        hasUserMessage: hasUserMessage(events),
        canWrite: !isReadOnlyViewer,
      })
    ) {
      if (isTemplateCloneSession && hasUserMessage(events)) {
        setPreviewPhase('none');
      }
      return;
    }
    if (gatedPreviewForSession.current === sessionId) return;
    gatedPreviewForSession.current = sessionId;

    let cancelled = false;

    const gateUntilReady = async () => {
      setPreviewPhase('waiting');
      const outcome = await waitForPreviewHost(sessionId, 'templateClone');
      if (cancelled) return;
      if (outcome === 'ready' || outcome === 'skipped') {
        setPreviewPhase('ready');
        return;
      }
      setPreviewPhase('none');
    };

    void gateUntilReady();

    if (window.history.replaceState) {
      window.history.replaceState({}, '');
    }

    return () => {
      cancelled = true;
      // Allow a remount (Strict Mode / dep change) to start a fresh wait.
      // Without this, Send stays locked forever after a cancelled first wait.
      if (gatedPreviewForSession.current === sessionId) {
        gatedPreviewForSession.current = null;
      }
    };
  }, [
    loading,
    notFound,
    isReadOnlyViewer,
    sessionId,
    isTemplateCloneSession,
    initialMessage,
    events,
    waitForPreviewHost,
  ]);

  // Safety net: if NodePod already reports ready/Live but the gate wait was
  // cancelled (e.g. Strict Mode), unlock Send from the mirrored runtime status.
  const runtimeStatus = useConversationV2Store((s) => s.runtimeStatus);
  useEffect(() => {
    if (!isDraftClone || previewPhase !== 'waiting') return;
    if (runtimeStatus === 'browser_active') {
      setPreviewPhase('ready');
    } else if (runtimeStatus === 'error') {
      setPreviewPhase('none');
    }
  }, [isDraftClone, previewPhase, runtimeStatus]);

  return {
    previewPhase,
    setPreviewPhase,
    isTemplateCloneSession,
    /** Gate Send until NodePod preview is ready for clone sessions. */
    lockSendForPreview: previewPhase === 'waiting',
    showAppBuilderBanner,
    setShowAppBuilderBanner,
  };
}
