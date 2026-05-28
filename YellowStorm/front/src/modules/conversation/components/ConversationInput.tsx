import { useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { X, Reply } from 'lucide-react';
import Input from '@/components/ai-elements/input';
import { Button } from '@/components/ui/button';
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';
import { useConversationStore, useIsAwaitingFirstChunk, useInputDisabled, useReplyingToMessage, useSelectedWorkspaceIds } from '../store';
import { UsageLimitBanner, useUsage } from '@/modules/usage';
import { useConversationFileUpload } from '../hooks/useConversationFileUpload';
import { ACCEPT_EXTENSIONS } from '@/modules/workspace/utils';
import { useModuleTranslation } from '@/modules/localization';
import { useAuth } from '@/modules/auth/useAuth';
import { ComposerSuggestionChips } from './ComposerSuggestionChips';
import { SelectedConnectorRepo } from './SelectedConnectorRepo';

interface ConversationInputProps {
  conversationId: string;
  onWorkspaceUpdate?: (workspaceIds: string[]) => void;
}

export function ConversationInput({ conversationId, onWorkspaceUpdate }: ConversationInputProps) {
  const sendMessage = useConversationStore((s) => s.sendMessage);
  const stopStream = useConversationStore((s) => s.stopStream);
  const replyingToMessage = useReplyingToMessage();
  const clearReplyingTo = useConversationStore((s) => s.clearReplyingTo);
  const isAwaitingFirstChunk = useIsAwaitingFirstChunk();
  const isStreaming = useConversationStore((s) => s.isStreaming);
  const inputDisabled = useInputDisabled();
  const selectedWorkspaceIds = useSelectedWorkspaceIds();
  const currentConversation = useConversationStore((s) => s.currentConversation);
  const { status: usageStatus } = useUsage();
  const { t } = useModuleTranslation('conversation');
  const { user } = useAuth();

  const isLimitExceeded = usageStatus?.isLimitExceeded ?? false;

  const membersToTag = useMemo(() => {
    if (!currentConversation?.groupMeta?.isGroup || !user?.id) return undefined;

    const m = currentConversation.groupMeta.members
      .filter((m) => m.userId !== user.id)
      .map((m) => ({ id: m.userId, name: m.name || m.email?.split('@')[0] || 'Unknown' }));

    return m.length > 0 ? m : undefined;
  }, [currentConversation, user?.id]);

  const { files: uploadFiles, addFiles, removeFile, completedFileIds, isUploading, clearAll } = useConversationFileUpload({ conversationId, onError: (msg) => toast.error(msg) });

  const status = isAwaitingFirstChunk || isStreaming ? ('streaming' as const) : ('ready' as const);

  // Calculate countdown for placeholder
  const getLimitPlaceholder = useMemo(() => {
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
  }, [usageStatus?.resetsAt, t]);

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

  const handleSubmit = useCallback(
    async (message: PromptInputMessage, modelId: string, agentIds?: string[], memberIds?: string[], workspaceIds?: string[], connectorRepo?: { connectorId: string; connectorName: string; repoId: string; repoName: string; repoUrl?: string }) => {
      if (!message.text?.trim() && !completedFileIds.length) return;

      // Update conversation workspaces if workspaces are selected
      if (workspaceIds && workspaceIds.length > 0 && onWorkspaceUpdate) {
        onWorkspaceUpdate(workspaceIds);
      }

      // Build optimistic attachedFiles from the upload hook state
      const attachedFiles = uploadFiles
        .filter((f) => f.status === 'completed' && f.documentId)
        .map((f) => ({
          id: f.documentId!,
          originalName: f.file.name,
          mimeType: f.file.type,
          size: f.file.size,
          downloadUrl: '', // Will be populated by backend on next fetch
        }));

      await sendMessage(conversationId, {
        content: message.text || '',
        attachedFileIds: completedFileIds.length ? completedFileIds : undefined,
        attachedFiles: attachedFiles.length ? attachedFiles : undefined,
        modelId: modelId || undefined,
        agentIds: agentIds?.length ? agentIds : undefined,
        memberIds: memberIds?.length ? memberIds : undefined,
        parentMessageId: replyingToMessage?.id,
        connectorRepo: connectorRepo,
      });

      clearAll();
      clearReplyingTo();
    },
    [completedFileIds, uploadFiles, sendMessage, conversationId, clearAll, clearReplyingTo, replyingToMessage?.id, onWorkspaceUpdate],
  );

  const senderDisplayName = useMemo(() => {
    if (!replyingToMessage) return '';
    if (replyingToMessage.senderId === user?.id) return t('newConversation.groupDialog.you');

    if (currentConversation?.groupMeta?.isGroup) {
      const member = currentConversation.groupMeta.members.find((m) => m.userId === replyingToMessage.senderId);
      if (member) return member.name || member.email?.split('@')[0] || 'User';
    }

    return 'User';
  }, [replyingToMessage, user?.id, currentConversation, t]);

  const autoMention = useMemo(() => {
    if (!replyingToMessage) return undefined;
    if (replyingToMessage.senderId === user?.id) return undefined;

    if (currentConversation?.groupMeta?.isGroup) {
      const member = currentConversation.groupMeta.members.find((m) => m.userId === replyingToMessage.senderId);
      if (member) {
        return {
          id: member.userId,
          name: member.name || member.email?.split('@')[0] || 'User',
          isMember: true,
          _msgId: replyingToMessage.id
        };
      }
    }
    return undefined;
  }, [replyingToMessage, user?.id, currentConversation]);

  return (
    <div className='shrink-0 z-10 p-4 bg-background/80 backdrop-blur-xs border-t border-border/50'>
      {isLimitExceeded && <UsageLimitBanner />}

      {replyingToMessage && (
        <div className='flex items-center gap-3 p-3 mb-3 bg-muted/40 rounded-xl border border-border/40 animate-in slide-in-from-bottom-2 duration-200'>
          <div className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary'>
            <Reply className='h-4 w-4' />
          </div>
          <div className='flex-1 min-w-0'>
            <div className='flex items-center gap-2 mb-0.5'>
              <span className='text-xs font-semibold text-primary'>
                {senderDisplayName}
              </span>
            </div>
            <p className='text-sm text-muted-foreground line-clamp-1 break-all'>
              {replyingToMessage.content || (replyingToMessage.components?.[0]?.data?.content as string) || '...'}
            </p>
          </div>
          <Button
            variant='ghost'
            size='icon'
            className='h-8 w-8 shrink-0 rounded-full hover:bg-muted-foreground/10'
            onClick={clearReplyingTo}
            aria-label='Cancel reply'
          >
            <X className='h-4 w-4' />
          </Button>
        </div>
      )}

      <Input
        onSubmit={handleSubmit}
        onStop={stopStream}
        status={status}
        disabled={inputDisabled || isLimitExceeded}
        submitDisabled={isUploading || isStreaming || isAwaitingFirstChunk}
        placeholder={isLimitExceeded ? getLimitPlaceholder : undefined}
        onFilesAdded={handleFilesAdded}
        onFileRemoved={handleFileRemoved}
        uploadingFiles={uploadFiles}
        accept={ACCEPT_EXTENSIONS}
        maxFiles={5}
        members={membersToTag}
        autoMention={autoMention}
        showWorkspaceSelect={false}
        belowTextarea={
          <ComposerSuggestionChips
            fetchDisabled={
              inputDisabled || isLimitExceeded || isStreaming || isAwaitingFirstChunk || isUploading
            }
          />
        }
      />
      <SelectedConnectorRepo />
    </div>
  );
}
