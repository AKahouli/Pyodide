import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { BotIcon, BrainCircuit, ChevronDown, MessageSquareIcon } from 'lucide-react';
import { StarsBackground } from '@/modules/conversation/effects/stars-background';
import Input from '@/components/ai-elements/input';
import { Shimmer } from '@/components/ai-elements/shimmer';
import {
  PromptInputButton,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input';
import { cn } from '@/lib/utils';
import { UsageLimitBanner } from '@/modules/usage';
import { useUsage } from '@/modules/usage/UsageContext';
import {
  useConversationStore,
  useInputDisabled,
  useSelectedModelId,
  useSelectedReasoningEffort,
  useSelectedWorkspaceIds,
  useSetSelectedReasoningEffort,
} from './store';
import { useConversationFileUpload } from './hooks/useConversationFileUpload';
import { useAllowedUploadExtensions } from '@/modules/workspace/hooks/useAllowedUploadExtensions';
import { useModuleTranslation } from '@/modules/localization';
import { GroupChatButton } from './components/GroupChatButton';
import { SelectedConnectorRepo } from './components/SelectedConnectorRepo';
import { ComposerSuggestionChips } from './components/ComposerSuggestionChips';
import { PlaybooksCarousel } from '@/modules/playbook/components/playbook-swiper';
import { GovernedScopesCarousel } from '@/modules/governance/components/consumer/GovernedScopesCarousel';
import { AgentComposer } from '@/modules/conversation-v2/components/AgentComposer';
import { startConversationV2AgentSession } from '@/modules/conversation-v2/startAgentSession';
import { useConversationV2Store } from '@/modules/conversation-v2/store';
import { useDefaultModel, useModels } from '@/modules/models';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

type Mode = 'chat' | 'agent';
export function NewConversationPage() {
  const [mode, setMode] = useState<Mode>('chat');
  const { accept } = useAllowedUploadExtensions();
  const createConversation = useConversationStore((s) => s.createConversation);
  const updateConversation = useConversationStore((s) => s.updateConversation);
  const claimCurrentConversation = useConversationStore((s) => s.claimCurrentConversation);
  const sendMessage = useConversationStore((s) => s.sendMessage);
  const selectedWorkspaceIds = useSelectedWorkspaceIds();
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
    useConversationStore.setState({ currentConversationId: null, selectedSkillIds: [], selectedWorkspaceIds: [] });
    // The agent (v2) path keeps its own skill + connector selection in the
    // conv-v2 store; reset both so selections from a previous v2 session don't
    // leak into this new one.
    useConversationV2Store.getState().setSelectedSkillIds([]);
    useConversationV2Store.getState().setSelectedConnectorIds([]);
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

  const handleAgentSubmit = async (
    message: PromptInputMessage,
    workspaceIds: string[],
    modelId: string | null,
  ) => {
    const text = message.text?.trim() ?? '';
    if (!text) return;
    setIsSending(true);
    try {
      await startConversationV2AgentSession({
        text,
        workspaceIds,
        modelId,
        navigate,
        source: 'new-conversation',
      });
    } catch {
      toast.error(t('toasts.conversation.createError'));
    } finally {
      setIsSending(false);
    }
  };

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
        modelId: modelId || undefined,
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
          <ModeToggle mode={mode} onChange={setMode} />
          <div className='mt-3'>
            {mode === 'chat' ? (
              <>
                {isLimitExceeded ? <UsageLimitBanner /> : null}
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
                  extraTools={
                    reasoningEfforts.length > 0 ? (
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
                    ) : undefined
                  }
                  belowTextarea={
                    <ComposerSuggestionChips
                      fetchDisabled={inputDisabled || isLimitExceeded || isUploading || isSending}
                    />
                  }
                />
                <GroupChatButton />
                <SelectedConnectorRepo />
              </>
            ) : (
              <>
                {isLimitExceeded ? <UsageLimitBanner /> : null}
                <AgentComposer
                  onSubmit={handleAgentSubmit}
                  disabled={isSending || isLimitExceeded}
                  placeholder={limitPlaceholder ?? t('newConversation.agentPlaceholder')}
                />
              </>
            )}
          </div>
        </div>
        <div className='w-full max-w-7xl px-4'>
          <PlaybooksCarousel />
        </div>
        {mode === 'chat' && <div className='mt-6 w-full max-w-7xl px-4'><GovernedScopesCarousel /></div>}
      </div>
    </>
  );
}

interface ModeToggleProps {
  mode: Mode;
  onChange: (m: Mode) => void;
}

function ModeToggle({ mode, onChange }: ModeToggleProps) {
  const { t } = useModuleTranslation('conversation');
  const options: Array<{ value: Mode; label: string; hint: string; Icon: typeof BotIcon }> = [
    {
      value: 'chat',
      label: t('newConversation.mode.chat'),
      hint: t('newConversation.mode.chatHint'),
      Icon: MessageSquareIcon,
    },
    {
      value: 'agent',
      label: t('newConversation.mode.agent'),
      hint: t('newConversation.mode.agentHint'),
      Icon: BotIcon,
    },
  ];
  return (
    <div className='mx-auto flex w-fit gap-1 rounded-full border bg-card/70 p-1 backdrop-blur-sm'>
      {options.map(({ value, label, hint, Icon }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type='button'
            onClick={() => onChange(value)}
            title={hint}
            className={cn(
              'group inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors',
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className='size-4' />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
