import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
import { SessionStatusBanner } from './components/SessionStatusBanner';
import { useConversationV2Translation } from './translation';
import { FileViewerSidebar } from '@/modules/file-viewer';
import {
  useModels,
  useDefaultModel,
  useConversationV2DefaultModel,
} from '@/modules/models';
import type { AgentEvent, AgentSessionLocationState } from './types';
import { commitCloneDraftSession } from './startAgentSession';
import { isCloneDraftSearch } from './template-clone-draft';
import { useBrowserRuntimeBoot } from './hooks/useBrowserRuntimeBoot';
import { useInitialAgentMessage } from './hooks/useInitialAgentMessage';
import { useSessionBootstrap } from './hooks/useSessionBootstrap';
import { useStreamingReconcile } from './hooks/useStreamingReconcile';
import { useTemplateClonePreview } from './hooks/useTemplateClonePreview';
import { ErrorBoundary } from '@/components/ui/error-boundary';

export default function ConversationV2SessionPage() {
  const { sessionId: routeSessionId } = useParams<{ sessionId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as AgentSessionLocationState | null;

  const sessionId = routeSessionId?.trim() || null;
  /** Draft until first Send: `/studio/{sessionId}?action=clone`. */
  const isDraftClone = isCloneDraftSearch(searchParams);

  // Capture once: history.replaceState clears location.state after the first send.
  const [sessionCapability] = useState(
    () => locationState?.capability ?? 'web_app',
  );

  const initialMessage = locationState?.initialMessage;
  const initialModel = locationState?.model;
  const initialSkillIds = locationState?.skillIds;
  const initialConnectorIds = locationState?.connectorIds;

  const {
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
  } = useSessionBootstrap(sessionId);

  const {
    previewPhase,
    setPreviewPhase,
    isTemplateCloneSession,
    lockSendForPreview,
    showAppBuilderBanner,
    setShowAppBuilderBanner,
  } = useTemplateClonePreview({
    sessionId,
    isDraftClone,
    locationState,
    loading,
    notFound,
    isReadOnlyViewer,
    events,
    initialMessage,
    starterRevisionId,
  });

  useInitialAgentMessage({
    sessionId,
    loading,
    notFound,
    isReadOnlyViewer,
    initialMessage,
    initialModel,
    initialSkillIds,
    initialConnectorIds,
    capability: sessionCapability,
    setSelectedSkillIds,
    setSelectedConnectorIds,
    sendMessage,
    setPreviewPhase,
  });

  useBrowserRuntimeBoot(sessionId, loading, isReadOnlyViewer, sessionCapability);
  useStreamingReconcile(sessionId, loading, streaming, isReadOnlyViewer);

  const committedCloneDraftRef = useRef(false);
  useEffect(() => {
    committedCloneDraftRef.current = false;
  }, [sessionId]);

  const { t } = useConversationV2Translation();
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

  if (loading) {
    return <SessionLoadingSkeleton />;
  }
  if (notFound) {
    return <SessionNotFound onRetry={() => window.location.reload()} />;
  }

  return (
    <div className='relative flex min-h-0 w-full flex-1 overflow-hidden bg-background'>
      <div
        aria-hidden
        className='pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.06),transparent_70%)]'
      />
      <ErrorBoundary label={t('session.conversationError')}>
        <div key={sessionId} className='relative flex min-w-0 flex-1 flex-col'>
          <ConversationV2Header
            readOnly={isReadOnlyViewer}
            permissions={sessionPermissions}
          />
          <SessionStatusBanner
            previewPhase={previewPhase}
            isTemplateCloneSession={isTemplateCloneSession}
            isDraftClone={isDraftClone}
            showAppBuilderBanner={showAppBuilderBanner}
            streamError={streamError}
            onDismissReady={() => setPreviewPhase('none')}
            onDismissAppBuilder={() => setShowAppBuilderBanner(false)}
          />
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
