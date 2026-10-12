import { useEffect, useRef } from 'react';
import { ArrowUpRight, ListTodo } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { useRootWorkStore } from '../rootWorkStore';
import { useConversationUiStore } from '../uiStore';
import type { Message } from '../types';

export function BackgroundResultContext({ message, messages }: { message: Message; messages: Message[] }) {
  const { t } = useModuleTranslation('conversation');
  const ref = useRef<HTMLDivElement>(null);
  const job = useRootWorkStore((state) => state.snapshots[message.conversationId]?.jobs.find((item) => item.publicationMessageId === message.id));
  const unread = useRootWorkStore((state) => state.unreadPublicationIds[message.conversationId]?.includes(message.id) ?? false);
  const markRead = useRootWorkStore((state) => state.markResultRead);
  const userId = useRootWorkStore((state) => state.userId);
  const contextPanel = useConversationUiStore((state) => state.contextPanel);
  const metadata = message.components?.find((component) => component.type === 'text' && component.data.backgroundWork)?.data.backgroundWork as { task?: string; originQuestionMessageId?: string } | undefined;
  const isResult = Boolean(metadata || job);
  const origin = messages.find((candidate) => candidate.id === (metadata?.originQuestionMessageId ?? job?.originQuestionMessageId) && candidate.conversationType === 'user');

  useEffect(() => {
    if (metadata && userId) useRootWorkStore.getState().registerPublication(message.conversationId, message.id);
  }, [metadata, userId, message.conversationId, message.id]);

  useEffect(() => {
    if (!isResult || !unread || contextPanel || !ref.current || typeof IntersectionObserver === 'undefined') return;
    let visible = false;
    const acknowledge = () => {
      // IntersectionObserver cannot detect a sheet covering the timeline.
      if (visible && document.visibilityState === 'visible' && !useConversationUiStore.getState().contextPanel) markRead(message.conversationId, message.id);
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting && entry.intersectionRatio >= 0.5; acknowledge(); }, { threshold: 0.5 });
    observer.observe(ref.current);
    document.addEventListener('visibilitychange', acknowledge);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', acknowledge); };
  }, [isResult, unread, contextPanel, message.conversationId, message.id, markRead]);

  if (!isResult) return null;
  return <div ref={ref} className='mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground'>
    <span className='font-medium text-foreground'>{t('backgroundResult.label')}</span>
    {(metadata?.task || job?.task) && <span className='max-w-full truncate'>{metadata?.task || job?.task}</span>}
    {origin && <Button variant='link' size='sm' className='h-7 px-0 text-xs' onClick={() => useConversationUiStore.getState().requestOutlineScroll(`message-${origin.id}`)}><ArrowUpRight className='size-3' />{t('backgroundResult.originalRequest')}</Button>}
    <Button variant='link' size='sm' className='h-7 px-0 text-xs' onClick={() => useConversationUiStore.getState().setContextPanel('work')}><ListTodo className='size-3' />{t('backgroundResult.viewWork')}</Button>
  </div>;
}
