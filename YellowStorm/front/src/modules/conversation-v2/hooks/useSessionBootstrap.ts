import { useEffect, useState } from 'react';
import { conversationV2Api } from '../api';
import { useFileViewerStore } from '@/modules/file-viewer';
import { useModelsStore } from '@/modules/models';
import {
  canWriteConversationV2Session,
  ConversationV2SessionPermissions,
  hasConversationV2SessionPermission,
  type ConversationV2SessionPermission,
} from '../session-permissions';
import { useConversationV2Store } from '../store';
import type { AgentEvent } from '../types';
import { isTurnOpen } from '../utils/session-reducer';
import { useShallow } from 'zustand/react/shallow';

/**
 * Load / switch session pointer + event history for ConversationV2SessionPage.
 */
export function useSessionBootstrap(sessionId: string | null) {
  const {
    switchToSession,
    setSystemWorkspaceId,
    setWorkspaceIds,
    setDeployState,
    setSelectedSkillIds,
    setSelectedConnectorIds,
    replayEvents,
    loadFinalizedVersions,
    setStreaming,
    streamError,
    events,
    hydrateSelectedModelForSession,
    sendMessage,
    pendingQuestion,
    streaming,
    selectedModelId,
    workspaceIds,
  } = useConversationV2Store(
    useShallow((s) => ({
      switchToSession: s.switchToSession,
      setSystemWorkspaceId: s.setSystemWorkspaceId,
      setWorkspaceIds: s.setWorkspaceIds,
      setDeployState: s.setDeployState,
      setSelectedSkillIds: s.setSelectedSkillIds,
      setSelectedConnectorIds: s.setSelectedConnectorIds,
      replayEvents: s.replayEvents,
      loadFinalizedVersions: s.loadFinalizedVersions,
      setStreaming: s.setStreaming,
      streamError: s.streamError,
      events: s.events,
      hydrateSelectedModelForSession: s.hydrateSelectedModelForSession,
      sendMessage: s.sendMessage,
      pendingQuestion: s.pendingQuestion,
      streaming: s.streaming,
      selectedModelId: s.selectedModelId,
      workspaceIds: s.workspaceIds,
    })),
  );

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [sessionPermissions, setSessionPermissions] = useState<
    ConversationV2SessionPermission[]
  >([]);
  const [starterRevisionId, setStarterRevisionId] = useState<string | null>(null);

  const canWrite = canWriteConversationV2Session(sessionPermissions);
  const canReadFiles = hasConversationV2SessionPermission(
    sessionPermissions,
    ConversationV2SessionPermissions.FILES_READ,
  );
  const canBrowseFiles = hasConversationV2SessionPermission(
    sessionPermissions,
    ConversationV2SessionPermissions.WORKSPACE_DOCUMENTS_READ,
  );
  const isReadOnlyViewer = !canWrite;

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    // Close the file viewer too — it's a global Zustand store, so a tab opened
    // in conversation A would otherwise stay open when navigating to B.
    useFileViewerStore.getState().closeViewer();
    // Switch the on-screen conversation. If this session is streaming in the
    // background (its live state is cached), we hydrate instantly and skip the
    // server reload + spinner — that's what makes switching between concurrent
    // conversations feel instant. Otherwise we fall through to a fresh load.
    const hydratedFromCache = switchToSession(sessionId);
    // After switchToSession so the model-persistence path knows which session
    // to write under. New conversations leave selectedModelId null → the
    // Composer falls back to the admin default.
    hydrateSelectedModelForSession(sessionId);
    // Idempotent: a no-op if models are already cached (≤ 5 min old).
    void useModelsStore.getState().fetchModels().catch(() => undefined);
    setNotFound(false);
    setSessionPermissions([]);

    const applyPointer = (pointer: Awaited<ReturnType<typeof conversationV2Api.getSession>>) => {
      setSessionPermissions(pointer.permissions ?? []);
      setSystemWorkspaceId(pointer.systemWorkspaceId);
      setWorkspaceIds(pointer.workspaceIds ?? []);
      setDeployState({
        deployStatus: pointer.deployStatus ?? 'idle',
        deployedUrl: pointer.deployedUrl ?? null,
        lastDeployedAt: pointer.lastDeployedAt ?? null,
      });
      setSelectedSkillIds(pointer.selectedSkillIds ?? []);
      setSelectedConnectorIds(pointer.selectedConnectorIds ?? []);
      setStarterRevisionId(pointer.starterRevisionId ?? null);
    };

    if (hydratedFromCache) {
      // Live state already in memory; just refresh pointer metadata.
      setLoading(false);
      (async () => {
        try {
          const pointer = await conversationV2Api.getSession(sessionId);
          if (cancelled) return;
          applyPointer(pointer);
        } catch {
          /* keep the cached view */
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    (async () => {
      try {
        const pointer = await conversationV2Api.getSession(sessionId);
        if (cancelled) return;

        applyPointer(pointer);

        const collected: AgentEvent[] = [];
        let since = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { items, nextSince } = await conversationV2Api.listEvents(sessionId, since, 200);
          if (cancelled) return;
          collected.push(...items);
          if (items.length === 0) break;
          since = nextSince;
        }
        replayEvents(collected);
        void loadFinalizedVersions(sessionId);

        // If the session is mid-turn server-side, show the thinking state; the
        // per-user pipe delivers the rest (and a done/error to clear it).
        const last = collected[collected.length - 1];
        const lastIsTerminal = last?.type === 'done' || last?.type === 'error';
        setStreaming(
          canWriteConversationV2Session(pointer.permissions)
            ? isTurnOpen(collected) ||
                (pointer.status === 'active' && collected.length > 0 && !lastIsTerminal)
            : false,
        );
      } catch {
        if (cancelled) return;
        setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    sessionId,
    switchToSession,
    setSystemWorkspaceId,
    setWorkspaceIds,
    setDeployState,
    setSelectedSkillIds,
    setSelectedConnectorIds,
    replayEvents,
    loadFinalizedVersions,
    setStreaming,
    hydrateSelectedModelForSession,
  ]);

  return {
    loading,
    notFound,
    sessionPermissions,
    canWrite,
    canReadFiles,
    canBrowseFiles,
    isReadOnlyViewer,
    starterRevisionId,
    streamError,
    events,
    sendMessage,
    pendingQuestion,
    streaming,
    selectedModelId,
    workspaceIds,
    setSelectedSkillIds,
    setSelectedConnectorIds,
  };
}
