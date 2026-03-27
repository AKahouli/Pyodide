import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { StarsBackground } from '@/modules/conversation/effects/stars-background';
import Input from '@/components/ai-elements/input';
import { Shimmer } from '@/components/ai-elements/shimmer';
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';
import { useConversationStore } from './store';
import { useConversationFileUpload } from './hooks/useConversationFileUpload';
import { ACCEPT_EXTENSIONS } from '@/modules/workspace/utils';
import { useModuleTranslation } from '@/modules/localization';
import { GroupChatButton } from './components/GroupChatButton';
 
export function NewConversationPage() {
  const createConversation = useConversationStore((s) => s.createConversation);
  const sendMessage = useConversationStore((s) => s.sendMessage);
  const navigate = useNavigate();
  const [isSending, setIsSending] = useState(false);
  const [silentConvId, setSilentConvId] = useState<string | null>(null);
  const { t } = useModuleTranslation('conversation');

  const createConversationForUpload = useCallback(async () => {
    const conv = await createConversation();
    setSilentConvId(conv.id);
    return conv;
  }, [createConversation]);

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

  const handleSubmit = async (message: PromptInputMessage, modelId: string, agentIds?: string[]) => {
    if (!message.text?.trim() && !completedFileIds.length) return;
    setIsSending(true);

    try {
      // Use existing conversation (from file upload) or create new one
      const convId = resolvedConvId || silentConvId || (await createConversation()).id;
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
          <Input onSubmit={handleSubmit} status={isSending ? 'submitted' : 'ready'} disabled={isSending} submitDisabled={isUploading} onFilesAdded={handleFilesAdded} onFileRemoved={handleFileRemoved} uploadingFiles={uploadFiles} accept={ACCEPT_EXTENSIONS} maxFiles={5} />
        </div>
        <GroupChatButton />
      </div>
    </>
  );
}
