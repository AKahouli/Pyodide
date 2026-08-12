import { memo } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Copy, Pencil, Reply } from 'lucide-react';
import { toast } from 'sonner';
import { useModuleTranslation } from '@/modules/localization';
import { useConversationStore } from '../store';
import type { Message } from '../types';
import { cn } from '@/lib/utils';

interface UserMessageActionsProps {
  message: Message;
  isLastUserMessage: boolean;
  currentUserId?: string;
  className?: string;
}

export const UserMessageActions = memo(function UserMessageActions({ message, isLastUserMessage, currentUserId, className }: UserMessageActionsProps) {
  const setEditingMessage = useConversationStore((s) => s.setEditingMessage);
  const setReplyingToMessage = useConversationStore((s) => s.setReplyingToMessage);
  const isStreaming = useConversationStore((s) => s.isStreaming);
  const currentConversation = useConversationStore((s) => s.currentConversation);
  const canEdit = isLastUserMessage && !isStreaming;
  const isGroup = !!currentConversation?.groupMeta?.isGroup;
  const isOwnMessage = message.senderId === currentUserId;
  const { t } = useModuleTranslation('conversation');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content || '');
      toast.success(t('toasts.message.copied'));
    } catch {
      toast.error(t('toasts.message.copyError'));
    }
  };

  const handleEdit = () => {
    if (!canEdit) return;
    setEditingMessage(message.id);
  };

  const handleReply = () => {
    setReplyingToMessage(message);
  };

  return (
    <div className={cn('mt-1 flex items-center gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover/msg:opacity-100 md:group-focus-within/msg:opacity-100', className)}>
      <TooltipProvider delayDuration={300}>
        {isGroup && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant='ghost' size='icon' className='size-11 md:size-7' onClick={handleReply} aria-label={t('messageActions.replyAria')}>
                <Reply className='h-3.5 w-3.5' />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('messageActions.reply')}</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant='ghost' size='icon' className='size-11 md:size-7' onClick={handleCopy} aria-label={t('userMessageActions.copyAria')}>
              <Copy className='h-3.5 w-3.5' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('userMessageActions.copy')}</TooltipContent>
        </Tooltip>
        {canEdit && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant='ghost' size='icon' className='size-11 md:size-7' onClick={handleEdit} aria-label={t('userMessageActions.editAria')}>
                <Pencil className='h-3.5 w-3.5' />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('userMessageActions.edit')}</TooltipContent>
          </Tooltip>
        )}
      </TooltipProvider>
    </div>
  );
});
