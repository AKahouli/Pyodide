import { ArrowDown } from 'lucide-react';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { useRootWorkStore } from '../rootWorkStore';
import { useConversationUiStore } from '../uiStore';

const EMPTY_IDS: string[] = [];
export function BackgroundResultNotice({ conversationId }: { conversationId: string }) {
  const { isAtBottom } = useStickToBottomContext();
  const { t } = useModuleTranslation('conversation');
  const ids = useRootWorkStore((state) => state.unreadPublicationIds[conversationId] ?? EMPTY_IDS);
  if (isAtBottom || !ids.length) return null;
  return <Button size='sm' variant='secondary' className='absolute bottom-3 left-1/2 z-10 max-w-[75%] -translate-x-1/2 rounded-full shadow-sm' onClick={() => {
    const id = [...ids].reverse().find((candidate) => document.getElementById(`message-${candidate}`));
    if (id) useConversationUiStore.getState().requestOutlineScroll(`message-${id}`);
    else useConversationUiStore.getState().setContextPanel('work');
  }}><ArrowDown className='size-4' />{t('backgroundResult.newResults', { count: ids.length })}</Button>;
}
