import { useEffect, useRef, useState } from 'react';
import { ChatConversation, ChatConversationContent, ChatConversationEmptyState } from '@/components/ai-elements/chat-conversation';
import Input from '@/components/ai-elements/input';
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { parseApiError } from '@/lib/api-error';
import { showError } from '@/lib/notifications';
import { ConversationContent } from '@/modules/conversation/components/ConversationContent';
import { useConversationStore } from '@/modules/conversation/store';
import { useModuleTranslation } from '@/modules/localization';
import { useCreateGovernanceDryRun } from '../query/hooks';
import type { GovernanceDryRun } from '../types';
import type { Agent } from '@/modules/agent';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deploymentId: string;
  conversationId?: string;
  agentId: string;
  scopedAgents: Agent[];
  scopedWorkspaces: Array<{ id: string; name: string; documentCount: number }>;
  onDryRunCreated: (dryRun: GovernanceDryRun) => void;
}

export function GovernanceDryRunConversationModal({ open, onOpenChange, deploymentId, conversationId, agentId, scopedAgents, scopedWorkspaces, onDryRunCreated }: Readonly<Props>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const createDryRun = useCreateGovernanceDryRun(deploymentId);
  const setCurrentConversation = useConversationStore((state) => state.setCurrentConversation);
  const fetchMessages = useConversationStore((state) => state.fetchMessages);
  const clearMessages = useConversationStore((state) => state.clearMessages);
  const currentConversationId = useConversationStore((state) => state.currentConversationId);
  const isStreaming = useConversationStore((state) => state.isStreaming);
  const streamingConversationId = useConversationStore((state) => state.streamingConversationId);
  const [activeConversationId, setActiveConversationId] = useState(conversationId ?? null);
  const loadTokenRef = useRef(0);
  const wasOpenRef = useRef(false);

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
      wasOpenRef.current = true;
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    resetConversationState();
  }, [open]);

  useEffect(() => () => {
    if (wasOpenRef.current) resetConversationState();
  }, []);

  const handleSubmit = (message: PromptInputMessage) => {
    const text = message.text?.trim() ?? '';
    if (!text || !agentId) return;
    createDryRun.mutate(
      { input: text, simulatedChannel: 'widget', conversationId: activeConversationId ?? undefined, agentId },
      {
        onSuccess: (dryRun) => {
          onDryRunCreated(dryRun);
          if (dryRun.conversationId) {
            setActiveConversationId(dryRun.conversationId);
          }
        },
        onError: (error) => showError(t('dryRun.error'), { description: parseApiError(error).message }),
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
            <Input onSubmit={handleSubmit} status={status} disabled={!agentId || isBusy} submitDisabled={!agentId || isBusy} placeholder={t('dryRun.inputPlaceholder')} mentionAgents={scopedAgents} enableTeamMentions={false} workspaceOptions={scopedWorkspaces} showWorkspaceSelect={true} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
