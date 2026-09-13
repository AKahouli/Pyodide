import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ShieldCheck } from 'lucide-react';
import { StarsBackground } from '@/modules/conversation/effects/stars-background';
import Input from '@/components/ai-elements/input';
import { Shimmer } from '@/components/ai-elements/shimmer';
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';
import { useUsage } from '@/modules/usage/UsageContext';
import {
  useConversationStore,
  useInputDisabled,
  useSelectedWorkspaceIds,
  useSelectedSemanticModelId,
  useWebConnectorAccessEnabled,
} from './store';
import { ReasoningEffortSelect, ReliabilityCheckToggle, useReasoningEffortState } from './components/ReasoningEffortSelect';
import { useConversationFileUpload } from './hooks/useConversationFileUpload';
import { useAllowedUploadExtensions } from '@/modules/workspace/hooks/useAllowedUploadExtensions';
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

export function NewConversationPage() {
  const { accept } = useAllowedUploadExtensions();
  const createConversation = useConversationStore((s) => s.createConversation);
  const updateConversation = useConversationStore((s) => s.updateConversation);
  const claimCurrentConversation = useConversationStore((s) => s.claimCurrentConversation);
  const sendMessage = useConversationStore((s) => s.sendMessage);
  const selectedWorkspaceIds = useSelectedWorkspaceIds();
  const { effectiveEffort: effectiveReasoningEffort } = useReasoningEffortState();
  const selectedSemanticModelId = useSelectedSemanticModelId();
  const webConnectorAccessEnabled = useWebConnectorAccessEnabled();
  const navigate = useNavigate();
  const [isSending, setIsSending] = useState(false);
  const [silentConvId, setSilentConvId] = useState<string | null>(null);
  const [silentConversation, setSilentConversation] = useState<Conversation | null>(null);
  const [selectedScopeId, setSelectedScopeId] = useState('');
  const [creationStarted, setCreationStarted] = useState(false);
  const conversationScopeRef = useRef<AvailableGovernedScope | null>();
  const governedCreationRequestId = useRef(crypto.randomUUID());
  const { t } = useModuleTranslation('conversation');
  const inputDisabled = useInputDisabled();
  const { status: usageStatus } = useUsage();
  const { user } = useAuth();
  const governedScopesEnabled = useFeatureVisibilityStore((state) => state.visibility.governedScopeCarousel);
  const { data: governedScopes = [], isError: governedScopesError, refetch: refetchGovernedScopes } = useAvailableGovernedScopes(governedScopesEnabled);
  const selectedScope = governedScopes.find((scope) => scope.scopeId === selectedScopeId);
  const presentationScope = creationStarted ? conversationScopeRef.current : selectedScope;
  const isLimitExceeded = usageStatus?.isLimitExceeded ?? false;

  // Starting a brand-new conversation: no conversation is active yet, so clear
  // any workspace/skill selection (and stale conversation id) carried over from the
  // previously open conversation. Direct setState avoids PATCHing the old one.
  useEffect(() => {
    useConversationStore.setState({ currentConversationId: null, selectedSkillIds: [], selectedWorkspaceIds: [], selectedSemanticModelId: null });
  }, []);

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
    governedCreationRequestId.current = crypto.randomUUID();
  };

  return (
    <>
      <StarsBackground />
      <div className='flex min-h-0 w-full flex-1 flex-col items-center overflow-y-auto px-4 py-7'>
        <div className='relative z-10 w-full max-w-7xl space-y-7'>
          <header className='flex flex-col justify-between gap-4 sm:flex-row sm:items-end'>
            <div>
              <Shimmer as='h1' className='pb-1 text-2xl font-bold' duration={5} spread={7}>
                {t(greetingKey, { name: displayName })}
              </Shimmer>
              <p className='text-sm text-muted-foreground'>{t('home.subtitle')}</p>
            </div>
            {governedScopesEnabled && governedScopesError && <div role='alert' className='flex items-center gap-2 text-sm text-destructive'>
              <span>{t('home.scope.loadError')}</span>
              <button type='button' className='font-medium underline' onClick={() => void refetchGovernedScopes()}>{t('home.retry')}</button>
            </div>}
            {governedScopesEnabled && governedScopes.length > 0 && <label className='flex min-w-64 flex-col gap-1 text-xs font-medium text-muted-foreground'>
              {t('home.scope.label')}
              <select value={selectedScopeId} disabled={creationStarted} onChange={(event) => handleScopeChange(event.target.value)} className='h-10 rounded-xl border bg-background px-3 text-sm text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'>
                <option value=''>{t('home.scope.standard')}</option>
                {governedScopes.map((scope) => <option key={scope.scopeId} value={scope.scopeId}>{scope.name}</option>)}
              </select>
            </label>}
          </header>

          <div className='mx-auto w-full max-w-4xl space-y-3'>
            {presentationScope && <div className='flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm'>
              <ShieldCheck className='size-4 shrink-0 text-primary' />
              <div className='min-w-0 flex-1'>
                <p className='truncate font-medium'>{t('home.scope.governedBy', { name: presentationScope.name })}</p>
                <p className='text-xs text-muted-foreground'>{t('home.scope.description', { version: presentationScope.revisionNumber })}</p>
              </div>
              {!creationStarted && <button type='button' className='shrink-0 text-xs font-medium text-primary hover:underline' onClick={() => handleScopeChange('')}>{t('home.scope.switchStandard')}</button>}
            </div>}
            <Input
              draftKey={`${user?.id ?? 'anonymous'}:conversation:new`}
              onSubmit={handleSubmit}
              status={isSending ? 'submitted' : 'ready'}
              disabled={isSending || inputDisabled || isLimitExceeded}
              submitDisabled={isUploading || isSending}
              placeholder={limitPlaceholder}
              onFilesAdded={handleFilesAdded}
              onFileRemoved={handleFileRemoved}
              uploadingFiles={uploadFiles}
              accept={accept}
              maxFiles={5}
              showWorkspaceSelect={!presentationScope}
              preserveWorkspaceSelectionOnSubmit
              showModelSelector={!presentationScope}
              governedMode={Boolean(presentationScope)}
              enableTeamMentions={!presentationScope}
              extraTools={presentationScope ? <ReliabilityCheckToggle /> : <><ReasoningEffortSelect /><WebSearchConnectorToggle /><ReliabilityCheckToggle /></>}
              belowTextarea={<ComposerSuggestionChips fetchDisabled={inputDisabled || isLimitExceeded || isUploading || isSending} />}
            />
            {!presentationScope && <SelectedConnectorRepo />}
          </div>

          <ConversationHomePanels />
        </div>
      </div>
    </>
  );
}
