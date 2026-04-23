import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { StarsBackground } from '@/modules/conversation/effects/stars-background';
import Input from '@/components/ai-elements/input';
import { Shimmer } from '@/components/ai-elements/shimmer';
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';
import {
  useConversationStore,
  useInputDisabled,
  useSelectedWorkspaceIds,
  useResetSelectedWorkspaceIds,
} from './store';
import { useConversationFileUpload } from './hooks/useConversationFileUpload';
import { ACCEPT_EXTENSIONS } from '@/modules/workspace/utils';
import { useModuleTranslation } from '@/modules/localization';
import { useUsage } from '@/modules/usage';
import { GroupChatButton } from './components/GroupChatButton';
import { ComposerSuggestionChips } from './components/ComposerSuggestionChips';
import { PlaybooksCarousel } from '@/modules/playbook/components/playbook-swiper';
 
export function NewConversationPage() {
  const createConversation = useConversationStore((s) => s.createConversation);
  const updateConversation = useConversationStore((s) => s.updateConversation);
  const sendMessage = useConversationStore((s) => s.sendMessage);
  const selectedWorkspaceIds = useSelectedWorkspaceIds();
  const resetSelectedWorkspaceIds = useResetSelectedWorkspaceIds();
  const navigate = useNavigate();
  const [isSending, setIsSending] = useState(false);
  const [silentConvId, setSilentConvId] = useState<string | null>(null);
  const { t } = useModuleTranslation('conversation');
  const inputDisabled = useInputDisabled();
  const { status: usageStatus } = useUsage();
  const isLimitExceeded = usageStatus?.isLimitExceeded ?? false;

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

  const handleSubmit = async (message: PromptInputMessage, modelId: string, agentIds?: string[], workspaceIds?: string[]) => {
    if (!message.text?.trim() && !completedFileIds.length) return;
    setIsSending(true);

    try {
      // Use existing conversation (from file upload) or create new one
      let convId = resolvedConvId || silentConvId;

      if (!convId) {
        // Create new conversation with workspaces if provided
        const conv = await createConversation(workspaceIds?.length ? { workspaces: workspaceIds } : undefined);
        convId = conv.id;
      } else if (workspaceIds?.length && workspaceIds.join() !== selectedWorkspaceIds.join()) {
        // Update existing conversation with workspaces only if they changed
        await updateConversation(convId, { workspaces: workspaceIds });
      }

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
        modelId: modelId || undefined,
        agentIds: agentIds?.length ? agentIds : undefined,
      });

      clearAll();
      resetSelectedWorkspaceIds();
    } catch {
      toast.error(t('toasts.conversation.createError'));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      <StarsBackground />
      <div className='flex w-full flex-1 flex-col items-center justify-center min-h-0 '>
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
            accept={ACCEPT_EXTENSIONS}
            maxFiles={5}
            showWorkspaceSelect={true}
            belowTextarea={
              <ComposerSuggestionChips
                fetchDisabled={inputDisabled || isLimitExceeded || isUploading || isSending}
              />
            }
          />
          <GroupChatButton />
          <PlaybooksCarousel />
        </div>
      </div>
    </>
  );
}
