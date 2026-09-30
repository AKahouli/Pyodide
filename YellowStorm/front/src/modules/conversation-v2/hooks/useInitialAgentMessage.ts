import { useEffect, useRef } from 'react';
import { appRuntimeEnabled } from '../features';
import type { PreviewPhase } from './useTemplateClonePreview';
import { useWaitForPreviewHost } from './useWaitForPreviewHost';

export interface UseInitialAgentMessageArgs {
  sessionId: string | null;
  loading: boolean;
  notFound: boolean;
  isReadOnlyViewer: boolean;
  initialMessage?: string;
  initialModel?: string;
  initialSkillIds?: string[];
  initialConnectorIds?: string[];
  setSelectedSkillIds: (ids: string[]) => void;
  setSelectedConnectorIds: (ids: string[]) => void;
  sendMessage: (text: string, model?: string) => Promise<void>;
  setPreviewPhase: (phase: PreviewPhase) => void;
}

/**
 * Fire the landing-page initial message after NodePod has registered.
 */
export function useInitialAgentMessage({
  sessionId,
  loading,
  notFound,
  isReadOnlyViewer,
  initialMessage,
  initialModel,
  initialSkillIds,
  initialConnectorIds,
  setSelectedSkillIds,
  setSelectedConnectorIds,
  sendMessage,
  setPreviewPhase,
}: UseInitialAgentMessageArgs) {
  const waitForPreviewHost = useWaitForPreviewHost();
  const sentInitialForSession = useRef<string | null>(null);

  useEffect(() => {
    if (loading || notFound || isReadOnlyViewer) return;
    if (!sessionId || !initialMessage) return;
    if (sentInitialForSession.current === sessionId) return;
    sentInitialForSession.current = sessionId;

    if (initialSkillIds?.length) setSelectedSkillIds(initialSkillIds);
    if (initialConnectorIds?.length) setSelectedConnectorIds(initialConnectorIds);

    let cancelled = false;

    const sendWhenReady = async () => {
      if (appRuntimeEnabled) {
        setPreviewPhase('waiting');
        const outcome = await waitForPreviewHost(sessionId, 'initialMessage');
        if (cancelled) return;
        setPreviewPhase('none');
        if (outcome === 'error' || outcome === 'timeout' || outcome === 'destroyed') {
          return;
        }
      }
      if (cancelled) return;
      await sendMessage(initialMessage, initialModel);
    };

    void sendWhenReady();

    if (window.history.replaceState) {
      window.history.replaceState({}, '');
    }

    return () => {
      cancelled = true;
      setPreviewPhase('none');
    };
  }, [
    loading,
    notFound,
    isReadOnlyViewer,
    sessionId,
    initialMessage,
    initialModel,
    initialSkillIds,
    setSelectedSkillIds,
    initialConnectorIds,
    setSelectedConnectorIds,
    sendMessage,
    setPreviewPhase,
    waitForPreviewHost,
  ]);
}
