import { useEffect, useRef, useState } from 'react';
import { ChatConversation, ChatConversationContent, ChatConversationEmptyState } from '@/components/ai-elements/chat-conversation';
import Input from '@/components/ai-elements/input';
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { parseApiError } from '@/lib/api-error';
import { showError } from '@/lib/notifications';
import { ConversationContent } from '@/modules/conversation/components/ConversationContent';
import { useConversationStore, useSelectedWorkspaceIds, useSetSelectedWorkspaceIds } from '@/modules/conversation/store';
import { useModuleTranslation } from '@/modules/localization';
import { useCreateGovernanceDryRun } from '../query/hooks';
import type { GovernanceDryRun } from '../types';
import type { MentionAgent } from '@/components/ai-elements/mention-popup';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deploymentId: string;
  programId: string | null;
  scopeId: string;
  conversationId?: string;
  agentId: string;
  scopedAgents: MentionAgent[];
  scopedWorkspaces: Array<{ id: string; name: string; documentCount: number }>;
  initialWorkspaceIds: string[];
  onDryRunCreated: (dryRun: GovernanceDryRun) => void;
}

export function GovernanceDryRunConversationModal({ open, onOpenChange, deploymentId, programId, scopeId, conversationId, agentId, scopedAgents, scopedWorkspaces, initialWorkspaceIds, onDryRunCreated }: Readonly<Props>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const createDryRun = useCreateGovernanceDryRun(deploymentId, programId, scopeId);
  const setCurrentConversation = useConversationStore((state) => state.setCurrentConversation);
  const fetchMessages = useConversationStore((state) => state.fetchMessages);
  const clearMessages = useConversationStore((state) => state.clearMessages);
  const currentConversationId = useConversationStore((state) => state.currentConversationId);
  const isStreaming = useConversationStore((state) => state.isStreaming);
  const streamingConversationId = useConversationStore((state) => state.streamingConversationId);
  const [activeConversationId, setActiveConversationId] = useState(conversationId ?? null);
  const loadTokenRef = useRef(0);
  const wasOpenRef = useRef(false);
  const activeWorkspaceKeyRef = useRef<string | null>(null);
  const previousWorkspaceIdsRef = useRef<string[]>([]);
  const selectedWorkspaceIds = useSelectedWorkspaceIds();
  const setSelectedWorkspaceIds = useSetSelectedWorkspaceIds();
  const initialWorkspaceKey = initialWorkspaceIds.join('|');

  const resetConversationState = () => {
    loadTokenRef.current += 1;
    clearMessages();
    useConversationStore.setState({ currentConversation: null, currentConversationId: null });
  };

  useEffect(() => {
    if (!open) return;
    setActiveConversationId(conversationId ?? null);
  }, [conversationId, open]);

  useEffect(() => {
    if (!open || !activeConversationId) return;
    const loadToken = ++loadTokenRef.current;
    void setCurrentConversation(activeConversationId).then(() => {
      if (loadTokenRef.current === loadToken) {
        void fetchMessages(activeConversationId);
      } else {
        useConversationStore.setState({ currentConversation: null, currentConversationId: null });
      }
    });
  }, [activeConversationId, fetchMessages, open, setCurrentConversation]);

  useEffect(() => {
    if (open) {
      if (!wasOpenRef.current) {
        previousWorkspaceIdsRef.current = selectedWorkspaceIds;
        wasOpenRef.current = true;
      }
      if (activeWorkspaceKeyRef.current !== initialWorkspaceKey) {
        activeWorkspaceKeyRef.current = initialWorkspaceKey;
        setSelectedWorkspaceIds(initialWorkspaceIds);
      }
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    activeWorkspaceKeyRef.current = null;
    setSelectedWorkspaceIds(previousWorkspaceIdsRef.current);
    resetConversationState();
  }, [initialWorkspaceIds, initialWorkspaceKey, open, selectedWorkspaceIds, setSelectedWorkspaceIds]);

  useEffect(() => () => {
    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      activeWorkspaceKeyRef.current = null;
      setSelectedWorkspaceIds(previousWorkspaceIdsRef.current);
      resetConversationState();
    }
  }, [setSelectedWorkspaceIds]);

  const handleSubmit = (message: PromptInputMessage, _modelId: string, mentionedAgentIds?: string[], _memberIds?: string[], selectedWorkspaceIds?: string[]) => {
    const text = message.text?.trim() ?? '';
    if (!text || !agentId) return;
    const selectedDraftWorkspaceIds = selectedWorkspaceIds?.filter((workspaceId) => initialWorkspaceIds.includes(workspaceId));
    const workspaceIds = selectedDraftWorkspaceIds?.length ? selectedDraftWorkspaceIds : initialWorkspaceIds;
    const requestedAgentId = mentionedAgentIds?.find((mentionedAgentId) => scopedAgents.some((agent) => agent.id === mentionedAgentId)) ?? agentId;
    createDryRun.mutate(
      { input: text, simulatedChannel: 'widget', conversationId: activeConversationId ?? undefined, agentId: requestedAgentId, ...(!activeConversationId && { workspaceIds }) },
      {
        onSuccess: (dryRun) => {
          setSelectedWorkspaceIds(workspaceIds);
          onDryRunCreated(dryRun);
          if (dryRun.conversationId) {
            setActiveConversationId(dryRun.conversationId);
          }
        },
        onError: (error) => {
          setSelectedWorkspaceIds(workspaceIds);
          showError(t('dryRun.error'), { description: parseApiError(error).message });
        },
      },
    );
  };

  const isDryRunStreaming = Boolean(activeConversationId && isStreaming && streamingConversationId === activeConversationId);
  const status = isDryRunStreaming || createDryRun.isPending ? 'streaming' : 'ready';
  const canShowConversation = activeConversationId && currentConversationId === activeConversationId;
  const isBusy = status === 'streaming';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='flex h-[min(760px,90vh)] max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:rounded-2xl'>
        <DialogHeader className='border-b px-5 py-4'>
          <DialogTitle>{t('dryRun.modalTitle')}</DialogTitle>
          <DialogDescription>{t('dryRun.modalDescription')}</DialogDescription>
        </DialogHeader>
        <div className='flex min-h-0 flex-1 flex-col bg-background'>
          {canShowConversation ? (
            <ConversationContent />
          ) : (
            <ChatConversation className='flex-1 min-h-0'>
              <ChatConversationContent className='py-6'>
                <ChatConversationEmptyState title={t('dryRun.empty')} description={t('dryRun.modalEmptyDescription')} />
              </ChatConversationContent>
            </ChatConversation>
          )}
          <div className='shrink-0 border-t bg-background/80 p-4 backdrop-blur-xs'>
            <Input governedMode onSubmit={handleSubmit} status={status} disabled={!agentId || isBusy} submitDisabled={!agentId || isBusy} placeholder={t('dryRun.inputPlaceholder')} mentionAgents={scopedAgents} enableTeamMentions={false} workspaceOptions={scopedWorkspaces} showWorkspaceSelect={!activeConversationId} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
