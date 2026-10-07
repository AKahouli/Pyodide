import type { JSX } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useModuleTranslation } from '@/modules/localization';
import { ChatMessageThread } from '../ChatMessageThread';
import { PromptBar } from '../PromptBar';
import type { WorkyTask } from '../../types';

/**
 * Near-fullscreen bottom sheet holding the manager chat thread + composer.
 * Hidden by default on mobile; opened from the nav's Chat tab or the voice
 * banner as the typed alternative to voice.
 */
export function ManagerChatSheet({
  streamId,
  open,
  onOpenChange,
  sessionStatus,
  contextTask,
}: {
  streamId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionStatus?: string | null;
  contextTask?: WorkyTask | null;
}): JSX.Element {
  const { t } = useModuleTranslation('worky');
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex h-[85vh] flex-col gap-0 rounded-t-2xl p-0">
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle>{t('executive.rail.title')}</SheetTitle>
          <SheetDescription className='sr-only'>{t('messages.description')}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ChatMessageThread streamId={streamId} />
        </div>
        <PromptBar streamId={streamId} sessionStatus={sessionStatus} contextTask={contextTask} />
      </SheetContent>
    </Sheet>
  );
}
