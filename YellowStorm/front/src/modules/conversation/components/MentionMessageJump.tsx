import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import { useConversationStore, useCurrentConversation } from '../store';
import { useAuth } from '@/modules/auth';

/** Center `element` vertically inside `container` scroll viewport; returns clamped scrollTop. */
function centeredScrollTop(container: HTMLElement, element: HTMLElement): number {
  const cRect = container.getBoundingClientRect();
  const eRect = element.getBoundingClientRect();
  const delta = eRect.top - cRect.top;
  const raw = container.scrollTop + delta - container.clientHeight / 2 + eRect.height / 2;
  const max = Math.max(0, container.scrollHeight - container.clientHeight);
  return Math.max(0, Math.min(raw, max));
}

const POSITION_LOCK_MS = 2200;
const LOCK_INTERVAL_MS = 100;
const NAV_LOCK_RELEASE_MS = 2600;

export function MentionMessageJump() {
  const { user } = useAuth();
  const conversation = useCurrentConversation();
  const { scrollRef, stopScroll } = useStickToBottomContext();
  const lockIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lockTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unlockTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollEndFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const unseenMentions = useMemo(() => {
    if (!conversation?.groupMeta?.isGroup || !user) return [];
    const member = conversation.groupMeta.members.find((m) => m.userId === user.id);
    return member?.mentions?.filter((m) => !m.seenAt) || [];
  }, [conversation, user]);

  useEffect(() => {
    return () => {
      if (lockIntervalRef.current) clearInterval(lockIntervalRef.current);
      if (lockTimeoutRef.current) clearTimeout(lockTimeoutRef.current);
      if (unlockTimeoutRef.current) clearTimeout(unlockTimeoutRef.current);
      if (scrollEndFallbackRef.current) clearTimeout(scrollEndFallbackRef.current);
    };
  }, []);

  const handleJumpToMention = useCallback(async () => {
    if (unseenMentions.length === 0) return;

    const mention = unseenMentions[0];
    const store = useConversationStore.getState();
    const container = scrollRef.current;
    if (!container) return;

    if (unlockTimeoutRef.current) clearTimeout(unlockTimeoutRef.current);
    if (scrollEndFallbackRef.current) clearTimeout(scrollEndFallbackRef.current);

    stopScroll();
    store.setMentionNavigationLock(true);

    const message = store.messages.find((m) => m.id === mention.messageId);
    if (message?.conversationType === 'ai' && message.questionMessageId) {
      const activeId = store.activeBranches.get(message.questionMessageId);
      if (activeId !== message.id) {
        store.setActiveBranch(message.questionMessageId, message.id);
        await new Promise((r) => setTimeout(r, 100));
        stopScroll();
      }
    }

    let element =
      document.getElementById(`message-${mention.messageId}`) || document.getElementById(mention.messageId);

    if (!element && store.messagesHasMore) {
      await store.loadMoreMessages();
      await new Promise((r) => setTimeout(r, 500));
      stopScroll();
      element =
        document.getElementById(`message-${mention.messageId}`) || document.getElementById(mention.messageId);
    }

    const releaseNavLock = () => {
      useConversationStore.getState().setMentionNavigationLock(false);
    };

    if (!element) {
      unlockTimeoutRef.current = setTimeout(releaseNavLock, NAV_LOCK_RELEASE_MS);
      return;
    }

    stopScroll();

    const startPositionLock = () => {
      if (lockIntervalRef.current) clearInterval(lockIntervalRef.current);
      if (lockTimeoutRef.current) clearTimeout(lockTimeoutRef.current);
      const enforce = () => {
        const el =
          document.getElementById(`message-${mention.messageId}`) || document.getElementById(mention.messageId);
        if (!el || !scrollRef.current) return;
        const next = centeredScrollTop(scrollRef.current, el);
        scrollRef.current.scrollTo({ top: next, behavior: 'auto' });
        stopScroll();
      };
      lockIntervalRef.current = setInterval(enforce, LOCK_INTERVAL_MS);
      lockTimeoutRef.current = setTimeout(() => {
        if (lockIntervalRef.current) {
          clearInterval(lockIntervalRef.current);
          lockIntervalRef.current = null;
        }
      }, POSITION_LOCK_MS);
    };

    const finalizeExactPosition = () => {
      const el =
        document.getElementById(`message-${mention.messageId}`) || document.getElementById(mention.messageId);
      if (!el || !scrollRef.current) {
        unlockTimeoutRef.current = setTimeout(releaseNavLock, NAV_LOCK_RELEASE_MS);
        return;
      }
      const exactTop = centeredScrollTop(scrollRef.current, el);
      scrollRef.current.scrollTo({ top: exactTop, behavior: 'auto' });
      stopScroll();
      startPositionLock();
      el.classList.add('ring-2', 'ring-primary', 'ring-offset-2', 'transition-all', 'duration-1000');
      setTimeout(() => {
        el.classList.remove('ring-2', 'ring-primary', 'ring-offset-2');
      }, 2000);
      unlockTimeoutRef.current = setTimeout(releaseNavLock, NAV_LOCK_RELEASE_MS);
    };

    const initialTop = centeredScrollTop(container, element);
    container.scrollTo({ top: initialTop, behavior: 'smooth' });

    let settled = false;
    const runSettle = () => {
      if (settled) return;
      settled = true;
      if (scrollEndFallbackRef.current) {
        clearTimeout(scrollEndFallbackRef.current);
        scrollEndFallbackRef.current = null;
      }
      container.removeEventListener('scrollend', onScrollEnd);
      requestAnimationFrame(() => requestAnimationFrame(finalizeExactPosition));
    };

    const onScrollEnd = () => runSettle();

    container.addEventListener('scrollend', onScrollEnd, { passive: true });
    scrollEndFallbackRef.current = setTimeout(runSettle, 1400);
  }, [unseenMentions, scrollRef, stopScroll]);

  if (unseenMentions.length === 0) return null;

  return (
    <Button
      className={cn(
        'absolute bottom-20 left-1/2 -translate-x-1/2 rounded-full shadow-lg border-primary bg-primary/10 hover:bg-primary/20 text-primary transition-all duration-300 z-50',
      )}
      onClick={handleJumpToMention}
      size="sm"
      variant="outline"
      type="button"
    >
      <ChevronUp className="mr-2 h-4 w-4" />
      <span>
        {unseenMentions.length} {unseenMentions.length > 1 ? 'mentions' : 'mention'}
      </span>
    </Button>
  );
}
