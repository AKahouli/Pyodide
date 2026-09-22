import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { readLibraryDraft } from './utils/library-draft';
import Input from '@/components/ai-elements/input';
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';
import { useUsage } from '@/modules/usage/UsageContext';
import {
  useConversationStore,
  useInputDisabled,
  useSelectedWorkspaceIds,
  useSelectedSemanticModelId,
  useWebConnectorAccessEnabled,
} from './store';
import { ReliabilityCheckToggle, useReasoningEffortState } from './components/ReasoningEffortSelect';
import { useConversationFileUpload } from './hooks/useConversationFileUpload';
import { useAllowedUploadExtensions } from '@/modules/workspace/hooks/useAllowedUploadExtensions';
import { useConversationSettings } from './hooks/useConversationSettings';
import { useModuleTranslation } from '@/modules/localization';
import { SelectedConnectorRepo } from './components/SelectedConnectorRepo';
import { ComposerSuggestionChips } from './components/ComposerSuggestionChips';
import { WebSearchConnectorToggle } from './components/WebSearchConnectorToggle';
import { useAuth } from '@/modules/auth/useAuth';
import { useAvailableGovernedScopes, type AvailableGovernedScope } from '@/modules/governance';
import { useFeatureVisibilityStore } from '@/modules/admin/featureVisibilityStore';
import { createGovernedConversation } from './api';
import type { Conversation } from './types';
import { ConversationHomePanels } from './components/ConversationHomePanels';
import { ConversationScopeHeader } from './components/ConversationScopeHeader';
import { useHomeMotion } from './hooks/useHomeMotion';
import './conversation-home.css';
import './conversation-home-motion.css';

const GOVERNANCE_SCOPE_STORAGE_KEY = 'yellowmind.home.governance-scope';

export function NewConversationPage() {
  const homeMotion = useHomeMotion();
  const { accept } = useAllowedUploadExtensions();
  const conversationSettings = useConversationSettings();
  const attachmentsDisabled = conversationSettings?.attachmentIntelligence?.enabled !== true;
  const createConversation = useConversationStore((s) => s.createConversation);
  const updateConversation = useConversationStore((s) => s.updateConversation);
  const claimCurrentConversation = useConversationStore((s) => s.claimCurrentConversation);
  const sendMessage = useConversationStore((s) => s.sendMessage);
  const selectedWorkspaceIds = useSelectedWorkspaceIds();
  const { effectiveEffort: effectiveReasoningEffort } = useReasoningEffortState();
  const selectedSemanticModelId = useSelectedSemanticModelId();
  const webConnectorAccessEnabled = useWebConnectorAccessEnabled();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const libraryDraft = readLibraryDraft(location.state);
  const governanceScopeStorageKey = user?.id ? `${GOVERNANCE_SCOPE_STORAGE_KEY}:${user.id}` : null;
  const [isSending, setIsSending] = useState(false);
  const [silentConvId, setSilentConvId] = useState<string | null>(null);
  const [silentConversation, setSilentConversation] = useState<Conversation | null>(null);
  const [selectedScopeId, setSelectedScopeId] = useState(() => governanceScopeStorageKey ? localStorage.getItem(governanceScopeStorageKey) ?? '' : '');
  const [creationStarted, setCreationStarted] = useState(false);
  const conversationScopeRef = useRef<AvailableGovernedScope | null>();
  const governedCreationRequestId = useRef(crypto.randomUUID());
  const { t } = useModuleTranslation('conversation');
  const inputDisabled = useInputDisabled();
  const { status: usageStatus } = useUsage();
  const governedScopesEnabled = useFeatureVisibilityStore((state) => state.visibility.governedScopeCarousel);
  const { data: governedScopes = [], isError: governedScopesError, isSuccess: governedScopesLoaded, refetch: refetchGovernedScopes } = useAvailableGovernedScopes(governedScopesEnabled, user?.id);
  const selectedScope = governedScopes.find((scope) => scope.scopeId === selectedScopeId);
  const presentationScope = creationStarted ? conversationScopeRef.current : selectedScope;
  const isLimitExceeded = usageStatus?.isLimitExceeded ?? false;

  // Starting a brand-new conversation: no conversation is active yet, so clear
  // any workspace/skill selection (and stale conversation id) carried over from the
  // previously open conversation. Direct setState avoids PATCHing the old one.
  useEffect(() => {
    useConversationStore.setState({ currentConversationId: null, selectedSkillIds: [], selectedWorkspaceIds: [], selectedSemanticModelId: null });
  }, []);

  useEffect(() => {
    if (!governedScopesLoaded || creationStarted || !selectedScopeId || governedScopes.some((scope) => scope.scopeId === selectedScopeId)) return;
    setSelectedScopeId('');
    if (governanceScopeStorageKey) localStorage.removeItem(governanceScopeStorageKey);
  }, [creationStarted, governanceScopeStorageKey, governedScopes, governedScopesLoaded, selectedScopeId]);

  const limitPlaceholder = useMemo(() => {
    if (!isLimitExceeded) return undefined;
    if (!usageStatus?.resetsAt) return t('input.limitReached');
    const now = new Date();
    const reset = new Date(usageStatus.resetsAt);
    const diffMs = reset.getTime() - now.getTime();
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.max(0, Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60)));
    if (hours > 0) {
      return t('input.limitCountdownHours', { hours, minutes });
    }
    return t('input.limitCountdownMinutes', { minutes });
  }, [isLimitExceeded, usageStatus?.resetsAt, t]);

  const createConversationForUpload = useCallback(async () => {
    setCreationStarted(true);
    const conversationScope = conversationScopeRef.current === undefined
      ? (conversationScopeRef.current = selectedScope ?? null)
      : conversationScopeRef.current;
    if (conversationScope) {
      const conv = await createGovernedConversation(conversationScope.scopeId, governedCreationRequestId.current);
      setSilentConvId(conv.id);
      setSilentConversation(conv);
      return conv;
    }
    // Create conversation with currently selected workspaces if any
    const data = selectedWorkspaceIds?.length ? { workspaces: selectedWorkspaceIds } : undefined;
    const conv = await createConversation(data);
    setSilentConvId(conv.id);
    setSilentConversation(conv);
    return conv;
  }, [createConversation, selectedScope, selectedWorkspaceIds]);

  const {
    files: uploadFiles,
    addFiles,
    removeFile,
    completedFileIds,
    isUploading,
    conversationId: resolvedConvId,
    clearAll,
  } = useConversationFileUpload({
    conversationId: silentConvId,
    createConversation: createConversationForUpload,
    onError: (msg) => toast.error(msg),
  });

  const handleFilesAdded = useCallback(
    (rawFiles: File[], localIds: string[]) => {
      addFiles(rawFiles, localIds);
    },
    [addFiles],
  );

  const handleFileRemoved = useCallback(
    (localId: string) => {
      removeFile(localId);
    },
    [removeFile],
  );

  const handleSubmit = async (
    message: PromptInputMessage,
    modelId: string,
    agentIds?: string[],
    memberIds?: string[],
    workspaceIds?: string[],
    connectorRepo?: {
      connectorId: string;
      connectorName: string;
      repoId: string;
      repoName: string;
      repoUrl?: string;
    },
    teamIds?: string[],
  ) => {
    if (!message.text?.trim() && !completedFileIds.length) return;
    setIsSending(true);
    setCreationStarted(true);

    try {
      const conversationScope = conversationScopeRef.current === undefined
        ? (conversationScopeRef.current = selectedScope ?? null)
        : conversationScopeRef.current;
      // Use existing conversation (from file upload) or create new one
      let convId = resolvedConvId || silentConvId;
      let conversation = silentConversation ?? (convId
        ? useConversationStore.getState().conversations.find((candidate) => candidate.id === convId)
        : undefined);

      if (!convId) {
        conversation = conversationScope
          ? await createGovernedConversation(conversationScope.scopeId, governedCreationRequestId.current)
          : await createConversation(workspaceIds?.length ? { workspaces: workspaceIds } : undefined);
        convId = conversation.id;
      } else if (!conversationScope) {
        // Uploads can create the conversation before workspace selection is final.
        await updateConversation(convId, { workspaces: workspaceIds ?? [] });
        conversation = useConversationStore.getState().conversations.find((candidate) => candidate.id === convId);
      }

      claimCurrentConversation(convId, conversation, conversationScope ? undefined : {
          modelId: modelId || undefined,
          semanticModelId: selectedSemanticModelId || undefined,
          workspaceIds: workspaceIds ?? [],
        });
      navigate(`/conversation/${convId}`);

      // Build optimistic attachedFiles
      const attachedFiles = uploadFiles
        .filter((f) => f.status === 'completed' && f.documentId)
        .map((f) => ({
          id: f.documentId!,
          originalName: f.file.name,
          mimeType: f.file.type,
          size: f.file.size,
          downloadUrl: '',
        }));

      await sendMessage(convId, {
        content: message.text || '',
        attachedFileIds: completedFileIds.length ? completedFileIds : undefined,
        attachedFiles: attachedFiles.length ? attachedFiles : undefined,
        webConnectorAccessEnabled: conversationScope ? undefined : webConnectorAccessEnabled,
        modelId: conversationScope ? undefined : (modelId || undefined),
        semanticModelId: conversationScope ? undefined : (selectedSemanticModelId || undefined),
        agentIds: !conversationScope && agentIds?.length ? agentIds : undefined,
        teamIds: !conversationScope && teamIds?.length ? teamIds : undefined,
        ...(!conversationScope && !agentIds?.length && !memberIds?.length && !teamIds?.length && effectiveReasoningEffort
          ? { reasoningEffort: effectiveReasoningEffort }
          : {}),
        connectorRepo: conversationScope ? undefined : (connectorRepo ?? useConversationStore.getState().selectedConnectorRepo ?? undefined),
        skillIds: !conversationScope && useConversationStore.getState().selectedSkillIds.length
          ? useConversationStore.getState().selectedSkillIds
          : undefined,
      });

      clearAll();
    } catch (error) {
      toast.error(t('toasts.conversation.createError'));
      throw error;
    } finally {
      setIsSending(false);
    }
  };

  const greetingKey = new Date().getHours() < 12
    ? 'home.greeting.morning'
    : new Date().getHours() < 18
      ? 'home.greeting.afternoon'
      : 'home.greeting.evening';
  const displayName = user?.profile.firstName || user?.email.split('@')[0] || '';

  const handleScopeChange = (scopeId: string) => {
    setSelectedScopeId(scopeId);
    if (governanceScopeStorageKey) {
      if (scopeId) localStorage.setItem(governanceScopeStorageKey, scopeId);
      else localStorage.removeItem(governanceScopeStorageKey);
    }
    governedCreationRequestId.current = crypto.randomUUID();
  };

  return (
      <div className='conversation-home' data-motion={homeMotion.enabled ? 'on' : 'off'}>
        <div className='conversation-home-content'>
          <header className='conversation-home-greeting'>
            <div className='conversation-home-signature' aria-hidden='true'>
              <svg viewBox='0 0 120 80' fill='none'>
                <circle className='home-signature-dot' cx='24' cy='40' r='8' />
                <path className='home-signature-stroke' d='M44 58 66 22' strokeWidth='15' strokeLinecap='round' />
                <path className='home-signature-echo' d='M76 58 98 22' strokeWidth='2' strokeLinecap='round' />
              </svg>
            </div>
            <h1>{t(greetingKey, { name: displayName })}</h1>
            <p>{t('home.subtitle')}</p>
            <button type='button' className='conversation-home-motion-toggle' aria-pressed={homeMotion.enabled} onClick={homeMotion.toggle}>
              <span aria-hidden='true' className='home-motion-indicator'><span /><span /><span /></span>
              {t('home.motion.label')}
            </button>
          </header>

          <div className='conversation-home-compose-area'>
            <div className='conversation-home-composer' data-governed={Boolean(presentationScope)}>
            <ConversationScopeHeader
              enabled={governedScopesEnabled}
              scopes={governedScopes}
              scope={presentationScope}
              locked={creationStarted}
              isError={governedScopesError}
              onChange={handleScopeChange}
              onRetry={() => void refetchGovernedScopes()}
            />
            <Input
              key={libraryDraft?.key ?? 'new'}
              initialInput={libraryDraft ? `@${libraryDraft.name} ${libraryDraft.text}` : undefined}
              initialMention={presentationScope ? undefined : libraryDraft}
              draftKey={`${user?.id ?? 'anonymous'}:conversation:new${libraryDraft ? ':' + libraryDraft.key : ''}`}
              onSubmit={handleSubmit}
              status={isSending ? 'submitted' : 'ready'}
              disabled={isSending || inputDisabled || isLimitExceeded}
              submitDisabled={isUploading || isSending}
              requireContent
              placeholder={limitPlaceholder ?? t('home.input.placeholder')}
              toolLabels={{ attachments: t('home.input.attach'), knowledge: t('home.input.knowledge'), data: t('home.input.data') }}
              onFilesAdded={handleFilesAdded}
              onFileRemoved={handleFileRemoved}
              uploadingFiles={uploadFiles}
              accept={accept}
              maxFiles={5}
              attachmentsDisabled={attachmentsDisabled}
              showWorkspaceSelect={!presentationScope}
              preserveWorkspaceSelectionOnSubmit
              showModelSelector={!presentationScope}
              governedMode={Boolean(presentationScope)}
              enableTeamMentions={!presentationScope}
              autoFocus
              extraTools={presentationScope ? <ReliabilityCheckToggle /> : <><WebSearchConnectorToggle /><ReliabilityCheckToggle /></>}
              belowTextarea={
                <ComposerSuggestionChips fetchDisabled={inputDisabled || isLimitExceeded || isUploading || isSending} />
              }
            />
            </div>
            {!presentationScope && <SelectedConnectorRepo />}
          </div>

          <ConversationHomePanels />
        </div>
      </div>
  );
}
