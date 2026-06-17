import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { BotIcon, CheckIcon, MessageSquareIcon } from 'lucide-react';
import { StarsBackground } from '@/modules/conversation/effects/stars-background';
import Input from '@/components/ai-elements/input';
import { Shimmer } from '@/components/ai-elements/shimmer';
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input';
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorTrigger,
} from '@/components/ai-elements/model-selector';
import { cn } from '@/lib/utils';
import { useUsage } from '@/modules/usage/UsageContext';
import {
  useConversationStore,
  useInputDisabled,
  useSelectedWorkspaceIds,
  useResetSelectedWorkspaceIds,
} from './store';
import { useConversationFileUpload } from './hooks/useConversationFileUpload';
import { useAllowedUploadExtensions } from '@/modules/workspace/hooks/useAllowedUploadExtensions';
import { useModuleTranslation } from '@/modules/localization';
import { GroupChatButton } from './components/GroupChatButton';
import { SelectedConnectorRepo } from './components/SelectedConnectorRepo';
import { ComposerSuggestionChips } from './components/ComposerSuggestionChips';
import { PlaybooksCarousel } from '@/modules/playbook/components/playbook-swiper';
import { conversationV2Api } from '@/modules/conversation-v2/api';
import { useConversationV2PointersStore } from '@/modules/conversation-v2/store';
import { writeSelectedModelForSession } from '@/modules/conversation-v2/selectedModelStorage';
import { useChefs, useDefaultModel, useModels, useModelsStore } from '@/modules/models';
import { WorkspaceSelect } from '@/modules/workspace/components/WorkspaceSelect';

type Mode = 'chat' | 'agent';
export function NewConversationPage() {
  const [mode, setMode] = useState<Mode>('chat');
  const { accept } = useAllowedUploadExtensions();
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

  // Starting a brand-new conversation: no conversation is active yet, so clear
  // any skill selection (and stale conversation id) carried over from the
  // previously open conversation. Direct setState avoids PATCHing the old one.
  useEffect(() => {
    useConversationStore.setState({ currentConversationId: null, selectedSkillIds: [] });
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
      const { sessionId, workspaceIds: sessionWorkspaceIds } =
        await conversationV2Api.createSession(workspaceIds);

      // Surface the new v2 session in the sidebar history immediately, rather
      // than waiting for the next pointers refresh.
      useConversationV2PointersStore.getState().prepend({
        sessionId,
        title: '',
        status: 'active',
        lastEventAt: new Date().toISOString(),
        isShared: false,
        workspaceIds: sessionWorkspaceIds ?? workspaceIds,
      });

      // Persist + resolve the picked model BEFORE navigation, so:
      //   1. The session page's hydrateSelectedModelForSession finds it in
      //      localStorage and the composer reflects the right model.
      //   2. The initial-message send doesn't have to wait for the models
      //      cache to load — we already have the LiteLLM identifier here.
      let litellmModel: string | undefined;
      if (modelId) {
        writeSelectedModelForSession(sessionId, modelId);
        const model = useModelsStore.getState().models.find((m) => m.id === modelId);
        litellmModel = model?.litellmModel || undefined;
      }

      navigate(`/conversation-v2/${sessionId}`, {
        state: { initialMessage: text, model: litellmModel },
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
    _memberIds?: string[],
    workspaceIds?: string[],
    connectorRepo?: {
      connectorId: string;
      connectorName: string;
      repoId: string;
      repoName: string;
      repoUrl?: string;
    },
  ) => {
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
        connectorRepo: connectorRepo ?? useConversationStore.getState().selectedConnectorRepo ?? undefined,
        skillIds: useConversationStore.getState().selectedSkillIds.length
          ? useConversationStore.getState().selectedSkillIds
          : undefined,
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
          <ModeToggle mode={mode} onChange={setMode} />
          <div className='mt-3'>
            {mode === 'chat' ? (
              <>
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
              <AgentInput onSubmit={handleAgentSubmit} disabled={isSending} />
            )}
          </div>
        </div>
        <div className='w-full max-w-7xl px-4'>
          <PlaybooksCarousel />
        </div>
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

interface AgentInputProps {
  onSubmit: (message: PromptInputMessage, workspaceIds: string[], modelId: string | null) => void;
  disabled: boolean;
}

function AgentInput({ onSubmit, disabled }: AgentInputProps) {
  const { t } = useModuleTranslation('conversation');
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<string[]>([]);

  const models = useModels();
  const chefs = useChefs();
  const defaultModel = useDefaultModel();
  // New conversations always start at the admin default — the user can
  // override before submitting. We keep modelId null when it matches the
  // default so we don't write a stale snapshot if the admin rotates the
  // default later.
  const [pickedModelId, setPickedModelId] = useState<string | null>(null);
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);

  useEffect(() => {
    // Idempotent: 5-min cache in the models store, no-ops if already loaded.
    void useModelsStore.getState().fetchModels().catch(() => undefined);
  }, []);

  const activeModel = (pickedModelId && models.find((m) => m.id === pickedModelId)) || defaultModel || null;

  const handleSubmit = (message: PromptInputMessage) => {
    // Persist the actual model id we want to remember — either the user's
    // explicit pick or the current admin default. handleAgentSubmit needs a
    // concrete id to look up the LiteLLM identifier.
    onSubmit(message, selectedWorkspaceIds, activeModel?.id ?? null);
  };

  const handlePickModel = (modelId: string) => {
    setPickedModelId(modelId);
    setModelSelectorOpen(false);
  };

  return (
    <PromptInputProvider>
      <PromptInput onSubmit={handleSubmit}>
        <PromptInputBody>
          <PromptInputTextarea
            placeholder={t('newConversation.agentPlaceholder')}
            disabled={disabled}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <WorkspaceSelect
            selectedIds={selectedWorkspaceIds}
            onChange={setSelectedWorkspaceIds}
            disabled={disabled}
          />
          {models.length > 0 && (
            <ModelSelector open={modelSelectorOpen} onOpenChange={setModelSelectorOpen}>
              <ModelSelectorTrigger asChild>
                <PromptInputButton type='button' disabled={disabled}>
                  {activeModel?.chefSlug && <ModelSelectorLogo provider={activeModel.chefSlug} />}
                  <ModelSelectorName>
                    {activeModel?.name ?? t('newConversation.modelSelector.unset')}
                  </ModelSelectorName>
                </PromptInputButton>
              </ModelSelectorTrigger>
              <ModelSelectorContent>
                <ModelSelectorInput placeholder={t('newConversation.modelSelector.search')} />
                <ModelSelectorList>
                  <ModelSelectorEmpty>{t('newConversation.modelSelector.empty')}</ModelSelectorEmpty>
                  {chefs.map((chef) => (
                    <ModelSelectorGroup heading={chef.name} key={chef.slug}>
                      {models
                        .filter((m) => m.chefSlug === chef.slug)
                        .map((m) => (
                          <ModelSelectorItem
                            key={m.id}
                            value={`${m.name} ${m.chef}`}
                            onSelect={() => handlePickModel(m.id)}
                          >
                            <ModelSelectorLogo provider={m.chefSlug} />
                            <ModelSelectorName>{m.name}</ModelSelectorName>
                            {activeModel?.id === m.id && (
                              <CheckIcon className='ml-auto size-4 text-muted-foreground' />
                            )}
                          </ModelSelectorItem>
                        ))}
                    </ModelSelectorGroup>
                  ))}
                </ModelSelectorList>
              </ModelSelectorContent>
            </ModelSelector>
          )}
          <div className='flex-1' />
          <PromptInputSubmit status={disabled ? 'submitted' : 'ready'} />
        </PromptInputFooter>
      </PromptInput>
    </PromptInputProvider>
  );
}
