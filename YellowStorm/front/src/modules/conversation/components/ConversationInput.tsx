import { useCallback, useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { X, Reply } from 'lucide-react';
import Input from '@/components/ai-elements/input';
import { Button } from '@/components/ui/button';
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';
import { useConversationStore, useIsAwaitingFirstChunk, useInputDisabled, useReplyingToMessage, useSelectedWorkspaceIds, useSetSelectedWorkspaceIds, useSelectedSemanticModelId, useDeepSearchEnabled, useSelectedModelId, useSelectedReasoningEffort, useWebConnectorAccessEnabled } from '../store';
import { UsageLimitBanner } from '@/modules/usage';
import { useUsage } from '@/modules/usage/UsageContext';
import { useConversationFileUpload } from '../hooks/useConversationFileUpload';
import { useConversationSettings } from '../hooks/useConversationSettings';
import { useAllowedUploadExtensions } from '@/modules/workspace/hooks/useAllowedUploadExtensions';
import { useModuleTranslation } from '@/modules/localization';
import { useAuth } from '@/modules/auth/useAuth';
import { ComposerSuggestionChips } from './ComposerSuggestionChips';
import { AssetPromptBridge } from './AssetPromptBridge';
import { useConversationUiStore } from '../uiStore';
import { SelectedConnectorRepo } from './SelectedConnectorRepo';
import { ContextMeter } from './ContextMeter';
import { ReliabilityCheckToggle } from './ReasoningEffortSelect';
import { WebSearchConnectorToggle } from './WebSearchConnectorToggle';
import { useDefaultModel, useModels } from '@/modules/models';

interface ConversationInputProps {
  conversationId: string;
}

export function ConversationInput({ conversationId }: ConversationInputProps) {
  const sendMessage = useConversationStore((s) => s.sendMessage);
  const updateConversation = useConversationStore((s) => s.updateConversation);
  const { accept, maxFileSize } = useAllowedUploadExtensions();
  const conversationSettings = useConversationSettings();
  const attachmentsDisabled = conversationSettings?.attachmentIntelligence?.enabled !== true;
  const stopStream = useConversationStore((s) => s.stopStream);
  const replyingToMessage = useReplyingToMessage();
  const clearReplyingTo = useConversationStore((s) => s.clearReplyingTo);
  const isAwaitingFirstChunk = useIsAwaitingFirstChunk();
  const isStreaming = useConversationStore((s) => s.isStreaming);
  const runningCount = useConversationStore((s) => Object.values(s.liveAnswers ?? {}).filter((answer) => answer.conversationId === conversationId).length);
  const inputDisabled = useInputDisabled();
  const selectedWorkspaceIds = useSelectedWorkspaceIds();
  const selectedSemanticModelId = useSelectedSemanticModelId();
  const setSelectedWorkspaceIds = useSetSelectedWorkspaceIds();
  const currentConversation = useConversationStore((s) => s.currentConversation);
  const governedMode = currentConversation?.runtimeMode === 'governed';
  const platformCopilot = currentConversation?.runtimePurpose === 'platform_copilot';
  // Sticky tagged agents route untagged AI turns to that agent, so the backend
  // rejects reasoning effort on those turns even without a fresh mention.
  const hasStickyTaggedAgents = (currentConversation?.taggedAgentIds?.length ?? 0) > 0;
  const runtimeManaged = governedMode || platformCopilot;
  const { status: usageStatus } = useUsage();
  const { t } = useModuleTranslation('conversation');
  const { user } = useAuth();
  const assetSelection = useConversationUiStore(state => state.selectedAssets);
  const selectedAssets = assetSelection && assetSelection.actorId === user?.id && assetSelection.conversationId === conversationId ? assetSelection.items : [];
  const composerScope = useRef({ actorId: user?.id, conversationId });
  composerScope.current = { actorId: user?.id, conversationId };
  const deepSearchEnabled = useDeepSearchEnabled();
  const webConnectorAccessEnabled = useWebConnectorAccessEnabled();
  const selectedModelId = useSelectedModelId();
  const selectedReasoningEffort = useSelectedReasoningEffort();
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
    if (runtimeManaged) return;

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
  }, [conversationId, runtimeManaged, setSelectedWorkspaceIds, updateConversation]);

  const membersToTag = useMemo(() => {
    if (!currentConversation?.groupMeta?.isGroup || !user?.id) return undefined;

    const m = currentConversation.groupMeta.members
      .filter((m) => m.userId !== user.id)
      .map((m) => ({ id: m.userId, name: m.name || m.email?.split('@')[0] || 'Unknown' }));

    return m.length > 0 ? m : undefined;
  }, [currentConversation, user?.id]);

  const { files: uploadFiles, addFiles, removeFile, completedFileIds, isUploading, clearSubmitted } = useConversationFileUpload({ conversationId, onError: (msg) => toast.error(msg) });

  const concurrentReplies = currentConversation?.concurrentRepliesEnabled === true;
  const status = !concurrentReplies && (isAwaitingFirstChunk || isStreaming) ? ('streaming' as const) : ('ready' as const);

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
      const actorId = user?.id ?? '';
      const selection = useConversationUiStore.getState().selectedAssets;
      const submittedAssets = selection?.actorId === actorId && selection.conversationId === conversationId ? [...selection.items] : [];
      if (!message.text?.trim() && !completedFileIds.length && !submittedAssets.length) return false;
      const differentAgent = !!agentIds?.length && !(agentIds.length === 1 && agentIds[0] === currentConversation?.rootAgentId);
      if ((runningCount > 0 || isStreaming || isAwaitingFirstChunk) && (!concurrentReplies || differentAgent || teamIds?.length || memberIds?.length)) {
        toast.error(t('input.waitForReply'));
        return false;
      }
      const submittedSkillIds = [...useConversationStore.getState().selectedSkillIds];
      const submittedConnector = connectorRepo ?? useConversationStore.getState().selectedConnectorRepo ?? undefined;
      const submittedReplyId = replyingToMessage?.id;

      await workspacePersistenceQueue.current;
      const submittedWorkspaceIds = workspaceIds ?? selectedWorkspaceIds;
      const persistedIds = persistedWorkspaceIds.current;
      if (!runtimeManaged && !selectedSemanticModelId && (submittedWorkspaceIds.length !== persistedIds.length || submittedWorkspaceIds.some((id) => !persistedIds.includes(id)))) {
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

      if (composerScope.current.actorId !== actorId || composerScope.current.conversationId !== conversationId) return false;
      const assetContext = submittedAssets.map(asset => t('assets.promptReference', { name: asset.name, ref: asset.ref })).join('\n');
      await sendMessage(conversationId, {
        requestId: crypto.randomUUID(),
        content: [message.text || '', assetContext].filter(Boolean).join('\n\n'),
        attachedFileIds: completedFileIds.length ? completedFileIds : undefined,
        attachedFiles: attachedFiles.length ? attachedFiles : undefined,
        deepSearchEnabled: deepSearchEnabled || undefined,
        webConnectorAccessEnabled: runtimeManaged ? undefined : webConnectorAccessEnabled,
        modelId: runtimeManaged ? undefined : (modelId || undefined),
        semanticModelId: runtimeManaged ? undefined : (selectedSemanticModelId || undefined),
        agentIds: !runtimeManaged && agentIds?.length ? agentIds : undefined,
        memberIds: !runtimeManaged && memberIds?.length ? memberIds : undefined,
        teamIds: !runtimeManaged && teamIds?.length ? teamIds : undefined,
        ...(!runtimeManaged && !hasStickyTaggedAgents && !agentIds?.length && !memberIds?.length && !teamIds?.length && effectiveReasoningEffort
          ? { reasoningEffort: effectiveReasoningEffort }
          : {}),
        parentMessageId: replyingToMessage?.id,
        connectorRepo: runtimeManaged ? undefined : submittedConnector,
        skillIds: !runtimeManaged && submittedSkillIds.length
          ? submittedSkillIds
          : undefined,
      });

      useConversationUiStore.getState().clearSubmittedAssets(actorId, conversationId, submittedAssets.map(asset => asset.nonce));
      clearSubmitted(uploadFiles.filter((file) => file.status === 'completed').map((file) => file.localId));
      if (useConversationStore.getState().replyingToMessage?.id === submittedReplyId) clearReplyingTo();
      return true;
    },
    [completedFileIds, uploadFiles, sendMessage, conversationId, clearSubmitted, clearReplyingTo, replyingToMessage?.id, runtimeManaged, hasStickyTaggedAgents, selectedWorkspaceIds, selectedSemanticModelId, setSelectedWorkspaceIds, updateConversation, deepSearchEnabled, webConnectorAccessEnabled, effectiveReasoningEffort, isStreaming, isAwaitingFirstChunk, concurrentReplies, currentConversation?.rootAgentId, runningCount, t, user?.id],
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
    <div data-conversation-composer className='shrink-0 z-10 px-3 py-2 md:px-4 bg-background/80 [&_textarea]:min-h-10 [&_textarea]:max-h-40 backdrop-blur-xs border-t border-border/50'>
      {isLimitExceeded && <UsageLimitBanner />}
      {concurrentReplies && runningCount > 0 && <p className='mb-1 text-xs text-muted-foreground' role='status'>{t('input.runningReplies', { count: runningCount })}</p>}

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
        draftKey={`${user?.id ?? 'anonymous'}:conversation:${conversationId}`}
        onSubmit={handleSubmit}
        hasSelectedContext={selectedAssets.length > 0}
        onStop={stopStream}
        status={status}
        disabled={inputDisabled || isLimitExceeded}
        submitDisabled={isUploading || (!concurrentReplies && (isStreaming || isAwaitingFirstChunk))}
        placeholder={isLimitExceeded ? getLimitPlaceholder : undefined}
        onFilesAdded={handleFilesAdded}
        onFileRemoved={handleFileRemoved}
        uploadingFiles={uploadFiles}
        accept={accept}
        maxFileSize={maxFileSize}
        maxFiles={5}
        attachmentsDisabled={attachmentsDisabled}
        members={membersToTag}
        autoMention={autoMention}
        showWorkspaceSelect={!runtimeManaged}
        onWorkspaceSelectionChange={persistWorkspaceSelection}
        preserveWorkspaceSelectionOnSubmit
        showModelSelector={!runtimeManaged}
        showReasoningEffort={!runtimeManaged && !hasStickyTaggedAgents}
        governedMode={runtimeManaged}
        enableTeamMentions={!runtimeManaged}
        extraTools={
          <>
            {!runtimeManaged && <WebSearchConnectorToggle />}
            <ReliabilityCheckToggle />
          </>
        }
        belowTextarea={
          <>
          <AssetPromptBridge conversationId={conversationId} />
          <ComposerSuggestionChips
            fetchDisabled={
              inputDisabled || isLimitExceeded || isStreaming || isAwaitingFirstChunk || isUploading
            }
          />
          </>
        }
      />
      {(!runtimeManaged || latestContextTelemetry) && <div className='mt-1 flex min-h-0 items-center justify-between gap-3 px-1'>
        {!runtimeManaged && <SelectedConnectorRepo />}
        {latestContextTelemetry && <ContextMeter {...latestContextTelemetry} />}
      </div>}
    </div>
  );
}
