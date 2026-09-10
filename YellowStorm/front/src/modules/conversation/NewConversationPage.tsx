import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
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
import { PlaybooksCarousel } from '@/modules/playbook/components/playbook-swiper';
import { GovernedScopesCarousel } from '@/modules/governance/components/consumer/GovernedScopesCarousel';
import { WebSearchConnectorToggle } from './components/WebSearchConnectorToggle';

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
  const { t } = useModuleTranslation('conversation');
  const inputDisabled = useInputDisabled();
  const { status: usageStatus } = useUsage();
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
    // Create conversation with currently selected workspaces if any
    const data = selectedWorkspaceIds?.length ? { workspaces: selectedWorkspaceIds } : undefined;
    const conv = await createConversation(data);
    setSilentConvId(conv.id);
    return conv;
  }, [createConversation, selectedWorkspaceIds]);

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

    try {
      // Use existing conversation (from file upload) or create new one
      let convId = resolvedConvId || silentConvId;
      let conversation = convId
        ? useConversationStore.getState().conversations.find((candidate) => candidate.id === convId)
        : undefined;

      if (!convId) {
        // Create new conversation with workspaces if provided
        conversation = await createConversation(workspaceIds?.length ? { workspaces: workspaceIds } : undefined);
        convId = conversation.id;
      } else {
        // Uploads can create the conversation before workspace selection is final.
        await updateConversation(convId, { workspaces: workspaceIds ?? [] });
        conversation = useConversationStore.getState().conversations.find((candidate) => candidate.id === convId);
      }

      claimCurrentConversation(convId, conversation, {
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
        webConnectorAccessEnabled,
        modelId: modelId || undefined,
        semanticModelId: selectedSemanticModelId || undefined,
        agentIds: agentIds?.length ? agentIds : undefined,
        teamIds: teamIds?.length ? teamIds : undefined,
        ...(!agentIds?.length && !memberIds?.length && !teamIds?.length && effectiveReasoningEffort
          ? { reasoningEffort: effectiveReasoningEffort }
          : {}),
        connectorRepo: connectorRepo ?? useConversationStore.getState().selectedConnectorRepo ?? undefined,
        skillIds: useConversationStore.getState().selectedSkillIds.length
          ? useConversationStore.getState().selectedSkillIds
          : undefined,
      });

      clearAll();
    } catch {
      toast.error(t('toasts.conversation.createError'));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      <StarsBackground />
      <div className='flex min-h-0 w-full flex-1 flex-col items-center justify-center-safe overflow-y-auto py-8'>
        <div className='mb-8 text-center'>
          <Shimmer as='h1' className='font-bold text-4xl pb-4' duration={5} spread={7}>
            {t('newConversation.heroTitle')}
          </Shimmer>
        </div>
        <div className='w-full max-w-3xl px-4'>
          <Input
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
            showWorkspaceSelect={true}
            preserveWorkspaceSelectionOnSubmit
            showModelSelector
            extraTools={<><ReasoningEffortSelect /><WebSearchConnectorToggle /><ReliabilityCheckToggle /></>}
            belowTextarea={
              <ComposerSuggestionChips
                fetchDisabled={inputDisabled || isLimitExceeded || isUploading || isSending}
              />
            }
          />
          <SelectedConnectorRepo />
        </div>
        <div className='w-full max-w-7xl px-4'>
          <PlaybooksCarousel />
        </div>
        <div className='mt-6 w-full max-w-7xl px-4'><GovernedScopesCarousel /></div>
      </div>
    </>
  );
}
