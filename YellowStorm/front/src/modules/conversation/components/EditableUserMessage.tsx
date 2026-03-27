import { useState, useCallback, useEffect, useRef, memo, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MentionPopup } from '@/components/ai-elements/mention-popup';
import { useConversationStore } from '../store';
import { useAuth } from '@/modules/auth/useAuth';
import { useAgents, useAgentStore } from '@/modules/agent';
import { fetchTaggedAgents } from '../api';
import type { Agent } from '@/modules/agent/types';
import type { Message } from '../types';
import { useModuleTranslation } from '@/modules/localization';

interface EditableUserMessageProps {
  message: Message;
  conversationId: string;
}

export const EditableUserMessage = memo(function EditableUserMessage({ message, conversationId }: EditableUserMessageProps) {
  const updateUserMessage = useConversationStore((s) => s.updateUserMessage);
  const setEditingMessage = useConversationStore((s) => s.setEditingMessage);
  const regenerateMessage = useConversationStore((s) => s.regenerateMessage);

  const [editContent, setEditContent] = useState(message.content || '');
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Mention state
  const [mentionPopupOpen, setMentionPopupOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionStartIndex, setMentionStartIndex] = useState<number | null>(null);
  const [mentionAnchorPos, setMentionAnchorPos] = useState({ top: 0, left: 0 });
  const [mentionMap, setMentionMap] = useState<Map<string, { id: string; type: 'member' | 'agent' }>>(new Map());

  // Fetch agents
  const agents = useAgents();
  const memoizedAgents = useMemo(() => agents, [agents]);
  const [sharedAgents, setSharedAgents] = useState<Agent[]>([]);

  const { user } = useAuth();
  const currentConversation = useConversationStore((s) => s.currentConversation);
  const membersToTag = useMemo(() => {
    if (!currentConversation?.groupMeta?.isGroup || !user?.id) return undefined;
    const m = currentConversation.groupMeta.members
      .filter((m) => m.userId !== user.id)
      .map((m) => ({ id: m.userId, name: m.name || m.email?.split('@')[0] || 'Unknown' }));
    return m.length > 0 ? m : undefined;
  }, [currentConversation, user?.id]);

  useEffect(() => {
    useAgentStore.getState().fetchAgents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch shared agents  
  useEffect(() => {
    if (currentConversation?.groupMeta?.isGroup) {
      fetchTaggedAgents(currentConversation.id)
        .then((fetched) => {
          setSharedAgents(fetched || []);
        })
        .catch((err) => {
          console.error('Failed to fetch tagged agents:', err);
        });
    } else {
      setSharedAgents([]);
    }
  }, [currentConversation?.id, currentConversation?.groupMeta?.isGroup]);

  const { t } = useModuleTranslation('conversation');
  const { t: tCommon } = useModuleTranslation('common');

  useEffect(() => {
    setEditContent(message.content || '');
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [message.content]);

  const handleCancel = useCallback(() => {
    setEditingMessage(null);
  }, [setEditingMessage]);

  // Compute anchor position from textarea
  const computeAnchorPosition = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return { top: 0, left: 0 };
    const rect = textarea.getBoundingClientRect();
    return { top: rect.top, left: rect.left + 16 };
  }, []);

  // Handle input changes for @ mention detection
  const handleInput = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const value = textarea.value;
    const cursorPos = textarea.selectionStart;

    if (mentionStartIndex !== null) {
      if (cursorPos <= mentionStartIndex) {
        setMentionPopupOpen(false);
        setMentionStartIndex(null);
        setMentionFilter('');
        return;
      }

      const textAfterAt = value.slice(mentionStartIndex + 1, cursorPos);
      if (textAfterAt.includes(' ') || textAfterAt.includes('\n')) {
        setMentionPopupOpen(false);
        setMentionStartIndex(null);
        setMentionFilter('');
        return;
      }

      setMentionFilter(textAfterAt);
      return;
    }

    if (cursorPos > 0 && value[cursorPos - 1] === '@') {
      if (cursorPos === 1 || /\s/.test(value[cursorPos - 2])) {
        setMentionStartIndex(cursorPos - 1);
        setMentionFilter('');
        setMentionAnchorPos(computeAnchorPosition());
        setMentionPopupOpen(true);
      }
    }
  }, [mentionStartIndex, computeAnchorPosition]);

  // Handle mention selection
  const handleMentionSelect = useCallback(
    (item: { id: string; name: string; isMember?: boolean }) => {
      const textarea = textareaRef.current;
      if (!textarea || mentionStartIndex === null) return;

      const value = textarea.value;
      const cursorPos = textarea.selectionStart;
      const before = value.slice(0, mentionStartIndex);
      const after = value.slice(cursorPos);
      const mentionText = `@${item.name} `;
      const newValue = before + mentionText + after;

      // Update via native setter to work with React controlled state
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(globalThis.HTMLTextAreaElement.prototype, 'value')?.set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(textarea, newValue);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }

      const newCursorPos = mentionStartIndex + mentionText.length;
      setTimeout(() => {
        textarea.setSelectionRange(newCursorPos, newCursorPos);
        textarea.focus();
      }, 0);

      setMentionMap((prev) => new Map(prev).set(item.name, { id: item.id, type: item.isMember ? 'member' : 'agent' }));
      setMentionPopupOpen(false);
      setMentionStartIndex(null);
      setMentionFilter('');
    },
    [mentionStartIndex],
  );

  // Block Enter/Escape when mention popup is open
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !mentionPopupOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setMentionPopupOpen(false);
        setMentionStartIndex(null);
        setMentionFilter('');
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    textarea.addEventListener('keydown', handleKeyDown, true);
    return () => textarea.removeEventListener('keydown', handleKeyDown, true);
  }, [mentionPopupOpen]);

  const handleSave = useCallback(async () => {
    const trimmed = editContent.trim();
    if (!trimmed || trimmed === message.content) {
      handleCancel();
      return;
    }

    // Extract agent and member IDs from mentions still present in the text
    // Checks both typed mentions (mentionMap) and pasted @AgentName patterns
    const agentIdSet = new Set<string>();
    const memberIdSet = new Set<string>();
    for (const [name, data] of mentionMap) {
      if (trimmed.includes(`@${name}`)) {
        if (data.type === 'agent') {
          agentIdSet.add(data.id);
        } else {
          memberIdSet.add(data.id);
        }
      }
    }
    // Pasted or untracked mentions — match against known agents
    for (const agent of memoizedAgents) {
      if (!agentIdSet.has(agent.id) && agent.isActive && trimmed.includes(`@${agent.name}`)) {
        agentIdSet.add(agent.id);
      }
    }
    // Pasted or untracked mentions — match against group members
    if (membersToTag) {
      for (const member of membersToTag) {
        if (!memberIdSet.has(member.id) && trimmed.includes(`@${member.name}`)) {
          memberIdSet.add(member.id);
        }
      }
    }

    const agentIds = [...agentIdSet];
    const memberIds = [...memberIdSet];

    setSaving(true);
    try {
      await updateUserMessage(conversationId, message.id, trimmed, agentIds.length > 0 ? agentIds : undefined, memberIds.length > 0 ? memberIds : undefined);

      if (memberIds.length > 0) {
        setEditingMessage(null);
        setSaving(false);
        return;
      }

      // After updating, get the latest message from store to find the correct answerMessageId
      // We need to read directly from store because the 'message' prop might be stale
      const store = useConversationStore.getState();
      const updatedMessage = store.messages.find((m) => m.id === message.id);

      // Try to get answerMessageId from the updated message in store
      let aiMessageIdToRegenerate = updatedMessage?.answerMessageId;

      // If no answerMessageId, find the last AI message after this user message (fallback)
      if (!aiMessageIdToRegenerate) {
        const messageIndex = store.messages.findIndex((m) => m.id === message.id);
        if (messageIndex >= 0) {
          const lastAiMessage = store.messages.slice(messageIndex + 1).reverse().find((m) => m.conversationType === 'ai');
          aiMessageIdToRegenerate = lastAiMessage?.id;
        }
      }

      setEditingMessage(null);

      // Regenerate if we found an AI message to regenerate
      if (aiMessageIdToRegenerate) {
        await regenerateMessage(conversationId, aiMessageIdToRegenerate);
      }
    } catch {
      // Error handled in store
    } finally {
      setSaving(false);
    }
  }, [editContent, message, conversationId, mentionMap, updateUserMessage, regenerateMessage, setEditingMessage, handleCancel, memoizedAgents]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
    },
    [handleCancel],
  );

  return (
    <div className='flex flex-col gap-2 w-full'>
      <Textarea ref={textareaRef} value={editContent} onChange={(e) => setEditContent(e.target.value)} onInput={handleInput} onKeyDown={handleKeyDown} className='min-h-15 resize-y' disabled={saving} />
      <div className='flex gap-2 justify-end'>
        <Button variant='ghost' size='sm' onClick={handleCancel} disabled={saving}>
          {tCommon('actionCancel')}
        </Button>
        <Button size='sm' onClick={handleSave} disabled={saving || !editContent.trim()}>
          {saving ? t('editableMessage.saving') : t('editableMessage.saveAndRegenerate')}
        </Button>
      </div>

      <MentionPopup
        open={mentionPopupOpen}
        onSelect={handleMentionSelect}
        onClose={() => {
          setMentionPopupOpen(false);
          setMentionStartIndex(null);
          setMentionFilter('');
        }}
        filter={mentionFilter}
        anchorPosition={mentionAnchorPos}
        agents={memoizedAgents}
        sharedAgents={sharedAgents}
        members={membersToTag}
      />
    </div>
  );
});

EditableUserMessage.displayName = 'EditableUserMessage';
