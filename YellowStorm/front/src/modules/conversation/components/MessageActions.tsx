import { memo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ThumbsUp, ThumbsDown, Copy, RotateCcw, MoreHorizontal, FileText, Flag, GitBranch, Loader2, Workflow } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { useModuleTranslation } from '@/modules/localization';
import { useConversationStore } from '../store';
import { componentsToMarkdown } from '../utils';
import type { DisplayedAnswerVersion, Message } from '../types';
import { ReportDialog } from './ReportDialog';
import { TimingIndicator } from './TimingIndicator';
import { useNavigate } from 'react-router-dom';
import { useApiAction } from '@/lib/use-api-action';
import { branchConversation, prepareConversationPlaybookHandoff } from '../api';
import { useModelById } from '@/modules/models';
import { playbookFeatures } from '@/modules/playbook/features';
import { usePlatformCopilotPanelStore } from '@/modules/platform-copilot/platformCopilotPanelStore';

import { cn } from '@/lib/utils';

interface MessageActionsProps {
  message: Message;
  isLastAiMessage: boolean;
  conversationId: string;
  displayedVersion?: DisplayedAnswerVersion;
  className?: string;
}

export const MessageActions = memo(function MessageActions({ message, isLastAiMessage, conversationId, displayedVersion = 'original', className }: MessageActionsProps) {
  const updateFeedback = useConversationStore((s) => s.updateFeedback);
  const regenerateMessage = useConversationStore((s) => s.regenerateMessage);
  const setReplyingToMessage = useConversationStore((s) => s.setReplyingToMessage);
  const currentConversation = useConversationStore((s) => s.currentConversation);
  const messages = useConversationStore((s) => s.messages);
  const activeBranches = useConversationStore((s) => s.activeBranches);
  const fetchConversations = useConversationStore((s) => s.fetchConversations);
  const isGroup = !!currentConversation?.groupMeta?.isGroup;
  const [reportOpen, setReportOpen] = useState(false);
  const handoffCreationRequest = useRef<{ fingerprint: string; requestId: string }>();
  const openHandoff = usePlatformCopilotPanelStore((state) => state.openHandoff);
  const { t, language } = useModuleTranslation('conversation');
  const generationModelId = message.modelId
    || (message.questionMessageId ? messages.find((candidate) => candidate.id === message.questionMessageId)?.modelId : undefined);
  const model = useModelById(generationModelId || '');
  const navigate = useNavigate();
  const canBranch = !!currentConversation
    && message.isComplete
    && !message.isStreaming
    && !isGroup
    && currentConversation?.runtimeMode !== 'governed';
  const { execute: createBranch, isLoading: isBranching } = useApiAction(branchConversation, {
    showSuccessToast: true,
    successMessage: t('toasts.branch.success'),
    onSuccess: (conversation) => {
      void fetchConversations({ reset: true });
      navigate(`/conversation/${conversation.id}`);
    },
  });
  const { execute: prepareHandoff, isLoading: isPreparingHandoff } = useApiAction(prepareConversationPlaybookHandoff, {
    onSuccess: (handoff) => {
      handoffCreationRequest.current = undefined;
      openHandoff(handoff);
    },
  });
  const canPrepareHandoff = playbookFeatures.mcpAssistantEnabled && message.isComplete && !message.isStreaming;
  const createdAt = new Date(message.createdAt);
  const formattedCreatedAt = Number.isNaN(createdAt.getTime())
    ? t('messageActions.dateUnavailable')
    : new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'medium' }).format(createdAt);
  const modelName = model?.name || generationModelId || t('messageActions.modelUnavailable');

  const handleLike = () => {
    // Don't allow removing feedback (clicking same button twice)
    if (message.feedback === 'like') return;
    updateFeedback(conversationId, message.id, 'like');
  };

  const handleDislike = () => {
    // Don't allow removing feedback (clicking same button twice)
    if (message.feedback === 'dislike') return;
    updateFeedback(conversationId, message.id, 'dislike');
  };

  const handleCopy = async () => {
    const markdown = componentsToMarkdown(message.components || []);
    try {
      await navigator.clipboard.writeText(markdown);
      toast.success(t('toasts.message.copied'));
    } catch {
      toast.error(t('toasts.message.copyError'));
    }
  };

  const handleRegenerate = () => {
    regenerateMessage(conversationId, message.id);
  };

  const handleReply = () => {
    setReplyingToMessage(message);
  };

  const handleBranch = () => {
    const targetIndex = messages.findIndex((item) => item.id === message.id);
    const prefixIds = new Set(messages.slice(0, targetIndex + 1).map((item) => item.id));
    const selected = Object.fromEntries(
      Array.from(activeBranches.entries()).filter(([questionId, answerId]) => (
        prefixIds.has(questionId) && prefixIds.has(answerId)
      )),
    );
    if (message.questionMessageId) selected[message.questionMessageId] = message.id;
    void createBranch(conversationId, {
      requestId: crypto.randomUUID(),
      targetMessageId: message.id,
      activeBranches: selected,
    });
  };

  const handlePlaybookHandoff = async () => {
    const targetIndex = messages.findIndex((item) => item.id === message.id);
    const prefixIds = new Set(messages.slice(0, targetIndex + 1).map((item) => item.id));
    const selected = Object.fromEntries(Array.from(activeBranches.entries()).filter(([questionId, answerId]) => (
      prefixIds.has(questionId) && prefixIds.has(answerId)
    )));
    if (message.questionMessageId) selected[message.questionMessageId] = message.id;
    const activeBranchEntries = Object.entries(selected).sort(([left], [right]) => left.localeCompare(right));
    const fingerprintSource = JSON.stringify({
      contractVersion: 1,
      targetMessageId: message.id,
      displayedAnswerVersion: displayedVersion,
      activeBranches: activeBranchEntries,
    });
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprintSource));
    const branchSelectionFingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (handoffCreationRequest.current?.fingerprint !== branchSelectionFingerprint) {
      handoffCreationRequest.current = {
        fingerprint: branchSelectionFingerprint,
        requestId: crypto.randomUUID(),
      };
    }
    void prepareHandoff(conversationId, {
      contractVersion: 1,
      targetMessageId: message.id,
      activeBranches: selected,
      branchSelectionFingerprint,
      displayedAnswerVersion: displayedVersion,
      creationRequestId: handoffCreationRequest.current.requestId,
    });
  };

  return (
    <>
      <div className={cn('mt-1 flex flex-wrap items-center gap-0.5', className)}>
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant='ghost' size='icon' className={`size-11 md:size-7 ${message.feedback === 'like' ? 'text-primary' : ''}`} onClick={handleLike} disabled={message.feedback === 'like'} aria-pressed={message.feedback === 'like'} aria-label={t('messageActions.likeAria')}>
                <ThumbsUp className={`h-3.5 w-3.5 ${message.feedback === 'like' ? 'fill-current' : ''}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{message.feedback === 'like' ? t('messageActions.liked') : t('messageActions.like')}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant='ghost' size='icon' className={`size-11 md:size-7 ${message.feedback === 'dislike' ? 'text-primary' : ''}`} onClick={handleDislike} disabled={message.feedback === 'dislike'} aria-pressed={message.feedback === 'dislike'} aria-label={t('messageActions.dislikeAria')}>
                <ThumbsDown className={`h-3.5 w-3.5 ${message.feedback === 'dislike' ? 'fill-current' : ''}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{message.feedback === 'dislike' ? t('messageActions.disliked') : t('messageActions.dislike')}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant='ghost' size='icon' className='size-11 md:size-7' onClick={handleCopy} aria-label={t('messageActions.copyAria')}>
                <Copy className='h-3.5 w-3.5' />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('messageActions.copy')}</TooltipContent>
          </Tooltip>

          {isLastAiMessage && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant='ghost' size='icon' className='size-11 md:size-7' onClick={handleRegenerate} aria-label={t('messageActions.regenerateAria')}>
                  <RotateCcw className='h-3.5 w-3.5' />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('messageActions.regenerate')}</TooltipContent>
            </Tooltip>
          )}
        </TooltipProvider>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant='ghost' size='icon' className='size-11 md:size-7' aria-label={t('messageActions.moreActions')}>
              <MoreHorizontal className='h-3.5 w-3.5' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='start'>
            {canBranch && (
              <DropdownMenuItem onClick={handleBranch} disabled={isBranching}>
                {isBranching
                  ? <Loader2 className='h-3.5 w-3.5 mr-2 animate-spin' />
                  : <GitBranch className='h-3.5 w-3.5 mr-2' />}
                {isBranching ? t('messageActions.branching') : t('messageActions.branch')}
              </DropdownMenuItem>
            )}
            {canPrepareHandoff && (
              <DropdownMenuItem onClick={() => { void handlePlaybookHandoff(); }} disabled={isPreparingHandoff}>
                {isPreparingHandoff
                  ? <Loader2 className='h-3.5 w-3.5 mr-2 animate-spin' />
                  : <Workflow className='h-3.5 w-3.5 mr-2' />}
                {isPreparingHandoff ? t('messageActions.playbookPreparing') : t('messageActions.playbookHandoff')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem disabled>
              <FileText className='h-3.5 w-3.5 mr-2' />
              {t('messageActions.export')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setReportOpen(true)}>
              <Flag className='h-3.5 w-3.5 mr-2' />
              {t('messageActions.report')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {message.isComplete && !message.isStreaming && <TimingIndicator timeToFirstChunk={message.timeToFirstChunk} timeToFirstToken={message.timeToFirstToken} durationMs={message.durationMs} inputTokens={message.inputTokens} outputTokens={message.outputTokens} />}
        <div className='ml-auto flex min-w-0 items-center gap-1.5 px-1 text-[11px] text-muted-foreground' aria-label={t('messageActions.generationMetadata', { date: formattedCreatedAt, model: modelName })}>
          <time dateTime={Number.isNaN(createdAt.getTime()) ? undefined : message.createdAt} className='whitespace-nowrap'>{formattedCreatedAt}</time>
          <span aria-hidden='true'>·</span>
          <span className='max-w-48 truncate' title={modelName}>{modelName}</span>
        </div>
      </div>

      <ReportDialog open={reportOpen} onOpenChange={setReportOpen} conversationId={conversationId} messageId={message.id} />
    </>
  );
});
