import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
import {
  SessionLoadingSkeleton,
  SessionNotFound,
} from './components/SessionPlaceholderStates';
import { useConversationV2Translation } from './translation';
import { FileViewerSidebar, useFileViewerStore } from '@/modules/file-viewer';
import { useModels, useDefaultModel, useConversationV2DefaultModel, useModelsStore } from '@/modules/models';
import type { AgentEvent } from './types';
import {
  commitCloneDraftSession,
  type AgentSessionSource,
} from './startAgentSession';
import { isCloneDraftSearch } from './template-clone-draft';
import {
  canWriteConversationV2Session,
  ConversationV2SessionPermissions,
  hasConversationV2SessionPermission,
  type ConversationV2SessionPermission,
} from './session-permissions';
import { getOrCreateHost, removeHost } from './runtime/BrowserRuntimeHost';
import { mapHostStatusToRuntimeUi } from './runtime/runtime.types';
import { waitForHostReady } from './runtime/wait-for-host-ready';
import { appRuntimeEnabled } from './features';
import { isTurnOpen } from './utils/session-reducer';
import {
  hasUserMessage,
  isTemplateCloneNavigation,
  isTemplateCloneSession as resolveTemplateCloneSession,
  shouldGateTemplateClonePreview,
} from './templateCloneGate';
import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';

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
  /** App Market template id when cloning without an auto-prompt. */
  templateId?: string;
}

export default function ConversationV2SessionPage() {
  const { sessionId: routeSessionId } = useParams<{ sessionId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as LocationState | null;

  const sessionId = routeSessionId?.trim() || null;
  /** Draft until first Send: `/conversation-v2/{sessionId}?action=clone`. */
  const isDraftClone = isCloneDraftSearch(searchParams);

  const initialMessage = locationState?.initialMessage;
  const initialModel = locationState?.model;
  const initialSkillIds = locationState?.skillIds;
  const initialConnectorIds = locationState?.connectorIds;
  const [showAppBuilderBanner, setShowAppBuilderBanner] = useState(false);
  /** Clone draft: gate Send immediately; other sessions wait for the gate effect. */
  const [waitingForPreview, setWaitingForPreview] = useState(
    () => isDraftClone && appRuntimeEnabled,
  );
  /** Clone-App / template-seeded sessions gate Send until NodePod is ready. */
  const [previewPhase, setPreviewPhase] = useState<'none' | 'waiting' | 'ready'>(() =>
    isDraftClone && appRuntimeEnabled ? 'waiting' : 'none',
  );
  const [starterRevisionId, setStarterRevisionId] = useState<string | null>(null);
  /** Latched from nav so replaceState does not lose clone mode before getSession returns. */
  const [latchedTemplateClone, setLatchedTemplateClone] = useState(
    () => isDraftClone || isTemplateCloneNavigation(locationState),
  );

  useEffect(() => {
    const state = location.state as LocationState | null;
    setShowAppBuilderBanner(state?.source === 'app-builder');
    setLatchedTemplateClone(isDraftClone || isTemplateCloneNavigation(state));
    if (isDraftClone && appRuntimeEnabled) {
      setPreviewPhase('waiting');
      setWaitingForPreview(true);
    } else if (!isDraftClone) {
      setPreviewPhase('none');
      setWaitingForPreview(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: route key only
  }, [sessionId, isDraftClone]);

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
  const [sessionPermissions, setSessionPermissions] = useState<ConversationV2SessionPermission[]>(
    [],
  );
  const sentInitialForSession = useRef<string | null>(null);
  const gatedPreviewForSession = useRef<string | null>(null);
  const committedCloneDraftRef = useRef(false);
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

  const handleSend = async (text: string) => {
    // First Send on draft: same session URL, drop ?action=clone, add History.
    if (isDraftClone && sessionId && !committedCloneDraftRef.current) {
      committedCloneDraftRef.current = true;
      commitCloneDraftSession(sessionId, navigate, workspaceIds);
    }
    if (previewPhase === 'ready') setPreviewPhase('none');
    await sendMessage(text, activeModel?.litellmModel || undefined);
  };

  const latestPlan = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const ev: AgentEvent = events[i];
      if (ev.type === 'plan') return ev;
    }
    return null;
  }, [events]);

  const isTemplateCloneSession = resolveTemplateCloneSession({
    latchedFromNav: latchedTemplateClone,
    starterRevisionId,
  });

  useEffect(() => {
    if (!sessionId) return;
    committedCloneDraftRef.current = false;
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
    gatedPreviewForSession.current = null;

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
        setWaitingForPreview(false);
        setPreviewPhase('none');
      }
      return;
    }
    if (gatedPreviewForSession.current === sessionId) return;
    gatedPreviewForSession.current = sessionId;

    let cancelled = false;

    const gateUntilReady = async () => {
      if (!appRuntimeEnabled) {
        setWaitingForPreview(false);
        setPreviewPhase('ready');
        return;
      }
      setWaitingForPreview(true);
      setPreviewPhase('waiting');
      const host = getOrCreateHost(sessionId);
      const outcome = await waitForHostReady(host);
      if (cancelled) return;
      setWaitingForPreview(false);
      if (outcome === 'ready') {
        setPreviewPhase('ready');
        return;
      }
      setPreviewPhase('none');
      if (outcome === 'error') {
        useConversationV2Store.setState(
          { streaming: false, streamError: t('session.previewBootFailed') },
          false,
          'templateClone/preview-error',
        );
      } else if (outcome === 'timeout') {
        useConversationV2Store.setState(
          { streaming: false, streamError: t('session.previewBootTimeout') },
          false,
          'templateClone/preview-timeout',
        );
      }
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
    t,
  ]);

  // Safety net: if NodePod already reports ready/Live but the gate wait was
  // cancelled (e.g. Strict Mode), unlock Send from the mirrored runtime status.
  const runtimeStatus = useConversationV2Store((s) => s.runtimeStatus);
  useEffect(() => {
    if (!isDraftClone || !waitingForPreview) return;
    if (runtimeStatus === 'browser_active') {
      setWaitingForPreview(false);
      setPreviewPhase('ready');
    } else if (runtimeStatus === 'error') {
      setWaitingForPreview(false);
      setPreviewPhase('none');
    }
  }, [isDraftClone, waitingForPreview, runtimeStatus]);

  // Fire the landing-page initial message only after NodePod has registered
  // (host status `ready`), so the first agent tools do not hit RUNTIME_OFFLINE
  // while npm install / Vite are still running.
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
        setWaitingForPreview(true);
        setPreviewPhase('waiting');
        const host = getOrCreateHost(sessionId);
        const outcome = await waitForHostReady(host);
        if (cancelled) return;
        setWaitingForPreview(false);
        setPreviewPhase('none');
        if (outcome === 'error') {
          useConversationV2Store.setState(
            { streaming: false, streamError: t('session.previewBootFailed') },
            false,
            'initialMessage/preview-error',
          );
          return;
        }
        if (outcome === 'timeout') {
          useConversationV2Store.setState(
            { streaming: false, streamError: t('session.previewBootTimeout') },
            false,
            'initialMessage/preview-timeout',
          );
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
      setWaitingForPreview(false);
    };
  }, [loading, notFound, isReadOnlyViewer, sessionId, initialMessage, initialModel, initialSkillIds, setSelectedSkillIds, initialConnectorIds, setSelectedConnectorIds, sendMessage, t]);

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
    return <SessionLoadingSkeleton />;
  }
  if (notFound) {
    return <SessionNotFound onRetry={() => window.location.reload()} />;
  }

  const waitingCopy =
    previewPhase === 'waiting' && isTemplateCloneSession
      ? {
          title: t('session.templateClone.waitingTitle'),
          body: isDraftClone
            ? t('session.templateClone.waitingBodyDraft')
            : t('session.templateClone.waitingBody'),
        }
      : {
          title: t('session.waitingForPreview.title'),
          body: t('session.waitingForPreview.body'),
        };

  // Gate Send until NodePod preview is ready for clone sessions.
  const lockSendForPreview = waitingForPreview;

  return (
    <div className='relative flex w-full min-h-0 flex-1'>
      <ErrorBoundary label={t('session.conversationError')}>
        <div key={sessionId} className='flex min-w-0 flex-1 flex-col'>
        <ConversationV2Header
          readOnly={isReadOnlyViewer}
          permissions={sessionPermissions}
        />
        {previewPhase === 'waiting' && (
          <div
            className='border-b border-border/60 bg-muted/40 px-4 py-3'
            role='status'
            data-testid='template-preview-waiting'
          >
            <p className='text-sm font-medium'>{waitingCopy.title}</p>
            <p className='mt-0.5 text-xs text-muted-foreground sm:text-sm'>{waitingCopy.body}</p>
          </div>
        )}
        {previewPhase === 'ready' && isTemplateCloneSession && (
          <div
            className='flex items-start gap-3 border-b border-border/60 bg-muted/40 px-4 py-3'
            role='status'
            data-testid='template-preview-ready'
          >
            <div className='min-w-0 flex-1'>
              <p className='text-sm font-medium'>{t('session.templateClone.readyTitle')}</p>
              <p className='mt-0.5 text-xs text-muted-foreground sm:text-sm'>
                {t('session.templateClone.readyBody')}
              </p>
            </div>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='shrink-0'
              onClick={() => setPreviewPhase('none')}
            >
              <X className='mr-1 h-3.5 w-3.5' aria-hidden />
              {t('session.templateClone.dismiss')}
            </Button>
          </div>
        )}
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
            disabled={streaming || lockSendForPreview}
            onSelect={handleSend}
          />
        )}
        {canWrite && <Composer onSend={handleSend} sendDisabled={lockSendForPreview} />}
        </div>
      </ErrorBoundary>
      <ErrorBoundary label={t('session.previewError')}>
        {canWrite && <RightPanel />}
      </ErrorBoundary>
      <FileViewerSidebar />
      {canBrowseFiles && <FilesSheet readOnly={isReadOnlyViewer} />}
    </div>
  );
}
