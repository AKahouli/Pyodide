import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { BotIcon, MessageSquareIcon } from 'lucide-react';
import { StarsBackground } from '@/modules/conversation/effects/stars-background';
import Input from '@/components/ai-elements/input';
import { Shimmer } from '@/components/ai-elements/shimmer';
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input';
import { cn } from '@/lib/utils';
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
import { conversationV2Api } from '@/modules/conversation-v2/api';

type Mode = 'chat' | 'agent';
export function NewConversationPage() {
  const [mode, setMode] = useState<Mode>('chat');
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

  const handleAgentSubmit = async (message: PromptInputMessage) => {
    const text = message.text?.trim() ?? '';
    if (!text) return;
    setIsSending(true);
    try {
      const { sessionId } = await conversationV2Api.createSession();
      navigate(`/conversation-v2/${sessionId}`, { state: { initialMessage: text } });
    } catch {
      toast.error(t('toasts.conversation.createError'));
    } finally {
      setIsSending(false);
    }
  };

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
  onSubmit: (message: PromptInputMessage) => void;
  disabled: boolean;
}

function AgentInput({ onSubmit, disabled }: AgentInputProps) {
  const { t } = useModuleTranslation('conversation');
  return (
    <PromptInputProvider>
      <PromptInput onSubmit={onSubmit}>
        <PromptInputBody>
          <PromptInputTextarea
            placeholder={t('newConversation.agentPlaceholder')}
            disabled={disabled}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <div className='flex-1' />
          <PromptInputSubmit status={disabled ? 'submitted' : 'ready'} />
        </PromptInputFooter>
      </PromptInput>
    </PromptInputProvider>
  );
}
