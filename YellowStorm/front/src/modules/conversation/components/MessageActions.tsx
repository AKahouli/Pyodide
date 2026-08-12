import { memo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ThumbsUp, ThumbsDown, Copy, RotateCcw, MoreHorizontal, FileText, Flag, GitBranch, Loader2, Wand2 } from 'lucide-react';
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
import { branchConversation } from '../api';
import { useModelById } from '@/modules/models';
import { useAuth } from '@/modules/auth';
import { buildPlaybookFromConversation } from '@/modules/playbook';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getAnswerComponents, getDefaultAnswerVersion } from '../utils/answer-version';

import { cn } from '@/lib/utils';

interface MessageActionsProps {
  message: Message;
  isLastAiMessage: boolean;
  conversationId: string;
  displayedVersion?: DisplayedAnswerVersion;
  className?: string;
}

export const MessageActions = memo(function MessageActions({ message, isLastAiMessage, conversationId, displayedVersion, className }: MessageActionsProps) {
  const updateFeedback = useConversationStore((s) => s.updateFeedback);
  const regenerateMessage = useConversationStore((s) => s.regenerateMessage);
  const setReplyingToMessage = useConversationStore((s) => s.setReplyingToMessage);
  const currentConversation = useConversationStore((s) => s.currentConversation);
  const messages = useConversationStore((s) => s.messages);
  const activeBranches = useConversationStore((s) => s.activeBranches);
  const fetchConversations = useConversationStore((s) => s.fetchConversations);
  const isGroup = !!currentConversation?.groupMeta?.isGroup;
  const [reportOpen, setReportOpen] = useState(false);
  const [buildDialogOpen, setBuildDialogOpen] = useState(false);
  const [playbookName, setPlaybookName] = useState('');
  const { t, language } = useModuleTranslation('conversation');
  const { user } = useAuth();
  const generationModelId = message.modelId
    || (message.questionMessageId ? messages.find((candidate) => candidate.id === message.questionMessageId)?.modelId : undefined);
  const model = useModelById(generationModelId || '');
  const navigate = useNavigate();
  const canBranch = !!currentConversation
    && message.isComplete
    && !message.isStreaming
    && !isGroup
    && currentConversation?.runtimeMode !== 'governed';
  const permissions = user?.permissions ?? [];
  const canCreatePlaybook = permissions.includes('*')
    || permissions.includes('playbook.*')
    || permissions.includes('playbook.create');
  const questionMessage = message.questionMessageId
    ? messages.find((candidate) => candidate.id === message.questionMessageId)
    : undefined;
  const selectedAnswerVersion = displayedVersion ?? getDefaultAnswerVersion(message);
  const canBuildPlaybook = !!currentConversation
    && currentConversation.createdBy === user?.id
    && canCreatePlaybook
    && message.isComplete
    && !message.isStreaming
    && message.conversationType === 'ai'
    && questionMessage?.conversationType === 'user'
    && !!questionMessage.content?.trim()
    && selectedAnswerVersion !== 'abstention';
  const { execute: createBranch, isLoading: isBranching } = useApiAction(branchConversation, {
    showSuccessToast: true,
    successMessage: t('toasts.branch.success'),
    onSuccess: (conversation) => {
      void fetchConversations({ reset: true });
      navigate(`/conversation/${conversation.id}`);
    },
  });
  const { execute: buildPlaybook, isLoading: isBuildingPlaybook } = useApiAction(buildPlaybookFromConversation, {
    showSuccessToast: true,
    successMessage: t('toasts.playbookBuilt'),
    onSuccess: ({ id }) => {
      setBuildDialogOpen(false);
      navigate(`/playbooks/${id}`);
    },
  });
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

  const handleBuildPlaybook = () => {
    if (!canBuildPlaybook) return;
    void buildPlaybook({
      conversationId,
      assistantMessageId: message.id,
      answerVersion: selectedAnswerVersion,
      ...(playbookName.trim() ? { name: playbookName.trim() } : {}),
    });
  };

  const answerPreview = componentsToMarkdown(
    getAnswerComponents(message, selectedAnswerVersion, ''),
  );

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
            {canBuildPlaybook && (
              <DropdownMenuItem onClick={() => setBuildDialogOpen(true)}>
                <Wand2 className='h-3.5 w-3.5 mr-2' />
                {t('messageActions.buildPlaybook')}
              </DropdownMenuItem>
            )}
            {canBranch && (
              <DropdownMenuItem onClick={handleBranch} disabled={isBranching}>
                {isBranching
                  ? <Loader2 className='h-3.5 w-3.5 mr-2 animate-spin' />
                  : <GitBranch className='h-3.5 w-3.5 mr-2' />}
                {isBranching ? t('messageActions.branching') : t('messageActions.branch')}
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
      <Dialog
        open={buildDialogOpen}
        onOpenChange={(open) => {
          if (isBuildingPlaybook) return;
          setBuildDialogOpen(open);
          if (!open) setPlaybookName('');
        }}
      >
        <DialogContent className='sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>{t('buildPlaybookDialog.title')}</DialogTitle>
            <DialogDescription>{t('buildPlaybookDialog.description')}</DialogDescription>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor={`playbook-name-${message.id}`}>{t('buildPlaybookDialog.nameLabel')}</Label>
              <Input
                id={`playbook-name-${message.id}`}
                value={playbookName}
                onChange={(event) => setPlaybookName(event.target.value)}
                maxLength={100}
                placeholder={t('buildPlaybookDialog.namePlaceholder')}
                disabled={isBuildingPlaybook}
              />
              <p className='text-xs text-muted-foreground'>{t('buildPlaybookDialog.nameHelp')}</p>
            </div>
            <div className='grid gap-3 md:grid-cols-2'>
              <div className='min-w-0 space-y-2'>
                <p className='text-sm font-medium'>{t('buildPlaybookDialog.userPrompt')}</p>
                <div className='max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm'>
                  {questionMessage?.content}
                </div>
              </div>
              <div className='min-w-0 space-y-2'>
                <p className='text-sm font-medium'>{t('buildPlaybookDialog.generatedAnswer')}</p>
                <div className='max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm'>
                  {answerPreview}
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setBuildDialogOpen(false)} disabled={isBuildingPlaybook}>
              {t('buildPlaybookDialog.cancel')}
            </Button>
            <Button onClick={handleBuildPlaybook} disabled={isBuildingPlaybook}>
              {isBuildingPlaybook && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
              {isBuildingPlaybook ? t('buildPlaybookDialog.building') : t('buildPlaybookDialog.build')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});
