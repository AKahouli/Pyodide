import { useCallback, useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { BrainCircuit, ChevronDown, X, Reply, Search } from 'lucide-react';
import Input from '@/components/ai-elements/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';
import { useConversationStore, useIsAwaitingFirstChunk, useInputDisabled, useReplyingToMessage, useSelectedWorkspaceIds, useSetSelectedWorkspaceIds, useDeepSearchEnabled, useSetDeepSearchEnabled, useSelectedModelId, useSelectedReasoningEffort, useSetSelectedReasoningEffort } from '../store';
import { UsageLimitBanner } from '@/modules/usage';
import { useUsage } from '@/modules/usage/UsageContext';
import { useConversationFileUpload } from '../hooks/useConversationFileUpload';
import { useAllowedUploadExtensions } from '@/modules/workspace/hooks/useAllowedUploadExtensions';
import { useModuleTranslation } from '@/modules/localization';
import { useAuth } from '@/modules/auth/useAuth';
import { ComposerSuggestionChips } from './ComposerSuggestionChips';
import { SelectedConnectorRepo } from './SelectedConnectorRepo';
import { ContextMeter } from './ContextMeter';
import { useDefaultModel, useModels } from '@/modules/models';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

interface ConversationInputProps {
  conversationId: string;
}

export function ConversationInput({ conversationId }: ConversationInputProps) {
  const sendMessage = useConversationStore((s) => s.sendMessage);
  const updateConversation = useConversationStore((s) => s.updateConversation);
  const { accept } = useAllowedUploadExtensions();
  const stopStream = useConversationStore((s) => s.stopStream);
  const replyingToMessage = useReplyingToMessage();
  const clearReplyingTo = useConversationStore((s) => s.clearReplyingTo);
  const isAwaitingFirstChunk = useIsAwaitingFirstChunk();
  const isStreaming = useConversationStore((s) => s.isStreaming);
  const inputDisabled = useInputDisabled();
  const selectedWorkspaceIds = useSelectedWorkspaceIds();
  const setSelectedWorkspaceIds = useSetSelectedWorkspaceIds();
  const currentConversation = useConversationStore((s) => s.currentConversation);
  const governedMode = currentConversation?.runtimeMode === 'governed';
  const platformCopilot = currentConversation?.runtimePurpose === 'platform_copilot';
  // Sticky tagged agents route untagged AI turns to that agent, so the backend
  // rejects reasoning effort on those turns even without a fresh mention.
  const hasStickyTaggedAgents = (currentConversation?.taggedAgentIds?.length ?? 0) > 0;
  const { status: usageStatus } = useUsage();
  const { t } = useModuleTranslation('conversation');
  const { user } = useAuth();
  const deepSearchEnabled = useDeepSearchEnabled();
  const setDeepSearchEnabled = useSetDeepSearchEnabled();
  const selectedModelId = useSelectedModelId();
  const selectedReasoningEffort = useSelectedReasoningEffort();
  const setSelectedReasoningEffort = useSetSelectedReasoningEffort();
  const models = useModels();
  const defaultModel = useDefaultModel();
  const selectedModel = models.find((model) => model.id === selectedModelId) ?? defaultModel ?? models[0];
  const reasoningEfforts = selectedModel?.supportsReasoning ? (selectedModel.reasoning?.efforts ?? []) : [];
  const effectiveReasoningEffort = reasoningEfforts.some((effort) => effort.id === selectedReasoningEffort)
    ? selectedReasoningEffort
    : selectedModel?.reasoning?.defaultEffort;
  const latestContextTelemetry = useConversationStore((state) => {
    for (let index = state.messages.length - 1; index >= 0; index -= 1) {
      const message = state.messages[index];
      if (message.conversationType === 'ai' && message.modelRequestTelemetry) return message.modelRequestTelemetry;
    }
    return undefined;
  });

  const isLimitExceeded = usageStatus?.isLimitExceeded ?? false;
  const workspacePersistenceQueue = useRef<Promise<void>>(Promise.resolve());
  const persistedWorkspaceIds = useRef<string[]>(currentConversation?.workspaces ?? []);
  const persistedWorkspaceConversationId = useRef<string | null>(currentConversation?.id === conversationId ? conversationId : null);

  useEffect(() => {
    if (currentConversation?.id === conversationId && persistedWorkspaceConversationId.current !== conversationId) {
      persistedWorkspaceIds.current = currentConversation.workspaces ?? [];
      persistedWorkspaceConversationId.current = conversationId;
    }
  }, [conversationId, currentConversation?.id, currentConversation?.workspaces]);

  const persistWorkspaceSelection = useCallback((workspaceIds: string[]) => {
    if (governedMode) return;

    workspacePersistenceQueue.current = workspacePersistenceQueue.current
      .then(async () => {
        const persistedIds = persistedWorkspaceIds.current;
        const selectionChanged = workspaceIds.length !== persistedIds.length
          || workspaceIds.some((id) => !persistedIds.includes(id));
        if (!selectionChanged) return;

        try {
          await updateConversation(conversationId, { workspaces: workspaceIds });
          persistedWorkspaceIds.current = workspaceIds;
        } catch (error) {
          const currentSelection = useConversationStore.getState().selectedWorkspaceIds;
          const failedSelectionIsCurrent = currentSelection.length === workspaceIds.length
            && currentSelection.every((id) => workspaceIds.includes(id));
          if (failedSelectionIsCurrent) {
            setSelectedWorkspaceIds(persistedIds);
          }
          throw error;
        }
      })
      .catch(() => undefined);
  }, [conversationId, governedMode, setSelectedWorkspaceIds, updateConversation]);

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
    async (message: PromptInputMessage, modelId: string, agentIds?: string[], memberIds?: string[], workspaceIds?: string[], connectorRepo?: { connectorId: string; connectorName: string; repoId: string; repoName: string; repoUrl?: string }, teamIds?: string[]) => {
      if (!message.text?.trim() && !completedFileIds.length) return;

      await workspacePersistenceQueue.current;
      const submittedWorkspaceIds = workspaceIds ?? selectedWorkspaceIds;
      const persistedIds = persistedWorkspaceIds.current;
      if (!governedMode && (submittedWorkspaceIds.length !== persistedIds.length || submittedWorkspaceIds.some((id) => !persistedIds.includes(id)))) {
        await updateConversation(conversationId, { workspaces: submittedWorkspaceIds });
        persistedWorkspaceIds.current = submittedWorkspaceIds;
        setSelectedWorkspaceIds(submittedWorkspaceIds);
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
        deepSearchEnabled: deepSearchEnabled || undefined,
        modelId: governedMode ? undefined : (modelId || undefined),
        agentIds: agentIds?.length ? agentIds : undefined,
        memberIds: memberIds?.length ? memberIds : undefined,
        teamIds: teamIds?.length ? teamIds : undefined,
        ...(!governedMode && !platformCopilot && !hasStickyTaggedAgents && !agentIds?.length && !memberIds?.length && !teamIds?.length && effectiveReasoningEffort
          ? { reasoningEffort: effectiveReasoningEffort }
          : {}),
        parentMessageId: replyingToMessage?.id,
        connectorRepo: governedMode ? undefined : (connectorRepo ?? useConversationStore.getState().selectedConnectorRepo ?? undefined),
        skillIds: !governedMode && useConversationStore.getState().selectedSkillIds.length
          ? useConversationStore.getState().selectedSkillIds
          : undefined,
      });

      clearAll();
      clearReplyingTo();
    },
    [completedFileIds, uploadFiles, sendMessage, conversationId, clearAll, clearReplyingTo, replyingToMessage?.id, governedMode, platformCopilot, hasStickyTaggedAgents, selectedWorkspaceIds, setSelectedWorkspaceIds, updateConversation, deepSearchEnabled, effectiveReasoningEffort],
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
            className='size-11 shrink-0 rounded-full md:size-8 hover:bg-muted-foreground/10'
            onClick={clearReplyingTo}
            aria-label={t('input.cancelReply')}
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
        accept={accept}
        maxFiles={5}
        members={membersToTag}
        autoMention={autoMention}
        showWorkspaceSelect={!governedMode}
        onWorkspaceSelectionChange={persistWorkspaceSelection}
        preserveWorkspaceSelectionOnSubmit
        showModelSelector
        governedMode={governedMode}
        enableTeamMentions={!governedMode}
        extraTools={
          <>
            <PromptInputButton
              type='button'
              onClick={() => setDeepSearchEnabled(!deepSearchEnabled)}
              className={cn(deepSearchEnabled && 'bg-primary/10 text-primary')}
              title={t('input.deepSearch')}
              aria-label={t('input.deepSearch')}
              aria-pressed={deepSearchEnabled}
            >
              <Search className='h-4 w-4' />
            </PromptInputButton>
            {!governedMode && !platformCopilot && !hasStickyTaggedAgents && reasoningEfforts.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <PromptInputButton type='button' aria-label={t('input.reasoning.label')}>
                    <BrainCircuit className='h-4 w-4' />
                    <span className='hidden sm:inline'>
                      {reasoningEfforts.find((effort) => effort.id === effectiveReasoningEffort)?.name ?? t('input.reasoning.label')}
                    </span>
                    <ChevronDown className='h-3 w-3 opacity-60' />
                  </PromptInputButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='start'>
                  <DropdownMenuLabel>{t('input.reasoning.label')}</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={effectiveReasoningEffort ?? undefined} onValueChange={setSelectedReasoningEffort}>
                    {reasoningEfforts.map((effort) => (
                      <DropdownMenuRadioItem key={effort.id} value={effort.id} title={effort.description}>
                        {effort.name}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
        belowTextarea={
          <ComposerSuggestionChips
            fetchDisabled={
              inputDisabled || isLimitExceeded || isStreaming || isAwaitingFirstChunk || isUploading
            }
          />
        }
      />
      <div className='mt-2 flex min-h-5 items-center justify-between gap-3 px-1'>
        {!governedMode && <SelectedConnectorRepo />}
        {latestContextTelemetry && <ContextMeter {...latestContextTelemetry} />}
      </div>
    </div>
  );
}
