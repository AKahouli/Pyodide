import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { X } from 'lucide-react';
import { conversationV2Api } from './api';
import { useConversationV2Store } from './store';
import { MessageList } from './components/MessageList';
import { Composer } from './components/Composer';
import { QuestionChoices } from './components/QuestionChoices';
import { ConversationV2Header } from './components/ConversationV2Header';
import { FilesSheet } from './components/FilesSheet';
import { PlanPanel } from './components/PlanPanel';
import { RightPanel } from './components/RightPanel/RightPanel';
import { useConversationV2Translation } from './translation';
import { FileViewerSidebar, useFileViewerStore } from '@/modules/file-viewer';
import { useModels, useDefaultModel, useConversationV2DefaultModel, useModelsStore } from '@/modules/models';
import type { AgentEvent } from './types';
import type { AgentSessionSource } from './startAgentSession';
import {
  canWriteConversationV2Session,
  ConversationV2SessionPermissions,
  hasConversationV2SessionPermission,
  type ConversationV2SessionPermission,
} from './session-permissions';
import { getOrCreateHost, removeHost } from './runtime/BrowserRuntimeHost';
import { mapHostStatusToRuntimeUi } from './runtime/runtime.types';
import { isTurnOpen } from './utils/session-reducer';
import { Button } from '@/components/ui/button';

interface LocationState {
  initialMessage?: string;
  /**
   * LiteLLM model identifier (e.g. "azure/gpt-4.1") resolved on the
   * new-conversation page. Avoids waiting for the models cache to load before
   * we can fire off the first message.
   */
  model?: string;
  /** Skill selection carried from the new-conversation page for the initial send. */
  skillIds?: string[];
  /** Connector selection carried from the new-conversation page for the initial send. */
  connectorIds?: string[];
  /** Entry point that created this session — drives transition UX. */
  source?: AgentSessionSource;
}

export default function ConversationV2SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const location = useLocation();
  const initialMessage = (location.state as LocationState | null)?.initialMessage;
  const initialModel = (location.state as LocationState | null)?.model;
  const initialSkillIds = (location.state as LocationState | null)?.skillIds;
  const initialConnectorIds = (location.state as LocationState | null)?.connectorIds;
  const entrySource = (location.state as LocationState | null)?.source;
  const [showAppBuilderBanner, setShowAppBuilderBanner] = useState(false);

  // Latch from navigation state once per session. Do not depend on entrySource
  // continuously — the initial-message effect clears history state and would
  // otherwise dismiss the banner immediately.
  useEffect(() => {
    setShowAppBuilderBanner(entrySource === 'app-builder');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: read source only when session changes
  }, [sessionId]);

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
    })),
  );
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [sessionPermissions, setSessionPermissions] = useState<ConversationV2SessionPermission[]>([]);
  const sentInitialForSession = useRef<string | null>(null);
  const { t } = useConversationV2Translation();
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
  const models = useModels();
  const defaultModel = useDefaultModel();
  const conversationV2DefaultModel = useConversationV2DefaultModel();
  const activeModel =
    (selectedModelId && models.find((m) => m.id === selectedModelId)) ||
    conversationV2DefaultModel ||
    defaultModel ||
    null;

  const handleSend = (text: string) => {
    void sendMessage(text, activeModel?.litellmModel || undefined);
  };

  const latestPlan = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const ev: AgentEvent = events[i];
      if (ev.type === 'plan') return ev;
    }
    return null;
  }, [events]);

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

    if (hydratedFromCache) {
      // Live state already in memory; just refresh pointer metadata.
      setLoading(false);
      (async () => {
        try {
          const pointer = await conversationV2Api.getSession(sessionId);
          if (cancelled) return;
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
                (pointer.status === 'active' &&
                  collected.length > 0 &&
                  !lastIsTerminal)
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
  }, [sessionId, switchToSession, setSystemWorkspaceId, setWorkspaceIds, setDeployState, setSelectedSkillIds, setSelectedConnectorIds, replayEvents, loadFinalizedVersions, setStreaming, hydrateSelectedModelForSession]);

  // Fire off the initial message handed in from the landing page once the
  // session is loaded. Guarded by sentInitialForSession so we don't re-send
  // when the user navigates back to a session that was created with a state.
  useEffect(() => {
    if (loading || notFound || isReadOnlyViewer) return;
    if (!sessionId || !initialMessage) return;
    if (sentInitialForSession.current === sessionId) return;
    sentInitialForSession.current = sessionId;
    // Re-apply the skill selection carried from the landing page. The loader
    // ran first and reset selectedSkillIds from the (empty) new-session pointer;
    // restore it here so sendMessage (which reads it from the store) ships it.
    if (initialSkillIds?.length) setSelectedSkillIds(initialSkillIds);
    if (initialConnectorIds?.length) setSelectedConnectorIds(initialConnectorIds);
    void sendMessage(initialMessage, initialModel);
    // Wipe the location state so a refresh doesn't replay the same prompt.
    if (window.history.replaceState) {
      window.history.replaceState({}, '');
    }
  }, [loading, notFound, isReadOnlyViewer, sessionId, initialMessage, initialModel, initialSkillIds, setSelectedSkillIds, initialConnectorIds, setSelectedConnectorIds, sendMessage]);

  // Boot BrowserRuntimeHost at session open so Nodepod is long-lived.
  // Read-only viewers don't get a runtime (no ticket request).
  // ApplicationComponentView / useNodepodPreview only subscribe — they must not call start().
  useEffect(() => {
    if (!sessionId || loading || isReadOnlyViewer) return;
    const appComp = useConversationV2Store.getState().applicationComponent;
    const host = getOrCreateHost(sessionId);
    const syncRuntime = () => {
      useConversationV2Store
        .getState()
        .setRuntimeStatus(mapHostStatusToRuntimeUi(host.state.status));
    };
    syncRuntime();
    const unsubscribe = host.subscribe(syncRuntime);
    if (host.state.status === 'idle') {
      void host.start(
        sessionId,
        appComp?.cephPath ?? null,
        appComp?.filesTree ?? null,
      );
    }
    return () => {
      unsubscribe();
      removeHost(sessionId);
      useConversationV2Store.getState().setRuntimeStatus('idle');
    };
  }, [sessionId, loading, isReadOnlyViewer]);

  // While a turn is in flight, periodically gap-fill events in case the SSE
  // pipe missed the terminal `done` (backend already completed via gRPC).
  useEffect(() => {
    if (!sessionId || loading || !streaming || isReadOnlyViewer) return;
    const reconcile = () => {
      void useConversationV2Store.getState().reconcileCurrentSession();
    };
    reconcile();
    const timer = window.setInterval(reconcile, 8_000);
    return () => window.clearInterval(timer);
  }, [sessionId, loading, streaming, isReadOnlyViewer]);

  if (loading) {
    return (
      <div className='flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground'>
        {t('session.loading')}
      </div>
    );
  }
  if (notFound) {
    return (
      <div className='flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground'>
        {t('session.notFound')}
      </div>
    );
  }

  return (
    <div className='relative flex w-full min-h-0 flex-1'>
      <div key={sessionId} className='flex min-w-0 flex-1 flex-col'>
        <ConversationV2Header
          readOnly={isReadOnlyViewer}
          permissions={sessionPermissions}
        />
        {showAppBuilderBanner && (
          <div className='flex items-start gap-3 border-b border-border/60 bg-muted/40 px-4 py-3'>
            <div className='min-w-0 flex-1'>
              <p className='text-sm font-medium'>{t('session.fromAppBuilder.title')}</p>
              <p className='mt-0.5 text-xs text-muted-foreground sm:text-sm'>
                {t('session.fromAppBuilder.body')}
              </p>
            </div>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='shrink-0'
              onClick={() => setShowAppBuilderBanner(false)}
            >
              <X className='mr-1 h-3.5 w-3.5' aria-hidden />
              {t('session.fromAppBuilder.dismiss')}
            </Button>
          </div>
        )}
        {streamError && (
          <div className='bg-destructive p-2 text-sm text-destructive-foreground'>
            {t('session.errorTitle')}: {streamError}
          </div>
        )}
        <MessageList canOpenAttachments={canReadFiles} />
        {latestPlan && (
          <div className='shrink-0 pb-2'>
            <PlanPanel steps={latestPlan.steps} />
          </div>
        )}
        {pendingQuestion && canWrite && (
          <QuestionChoices
            pendingQuestion={pendingQuestion}
            disabled={streaming}
            onSelect={handleSend}
          />
        )}
        {canWrite && <Composer onSend={handleSend} />}
      </div>
      {canWrite && <RightPanel />}
      <FileViewerSidebar />
      {canBrowseFiles && <FilesSheet readOnly={isReadOnlyViewer} />}
    </div>
  );
}
