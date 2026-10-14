import { useEffect, useRef, useState } from 'react';
import './conversation-context-panel.css';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useModuleTranslation } from '@/modules/localization';
import { useConversationUiStore } from '../uiStore';
import { ConversationOutlineRail } from './outline/ConversationOutlineRail';
import { RootWorkPanel } from './RootWorkPanel';
import { RootInputPanel } from './RootInputPanel';

export function ConversationContextPanel({ conversationId, creatorId }: Readonly<{ conversationId: string; creatorId: string }>) {
  const { t } = useModuleTranslation('conversation');
  const panel = useConversationUiStore((s) => s.contextPanel);
  const setPanel = useConversationUiStore((s) => s.setContextPanel);
  const width = useConversationUiStore((s) => s.contextPanelWidth);
  const setWidth = useConversationUiStore((s) => s.setContextPanelWidth);
  const anchor = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const opener = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);

  useEffect(() => useConversationUiStore.subscribe((next, previous) => {
    if (next.contextPanel && !previous.contextPanel) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
  }), []);

  const restoreOpener = () => {
    if (useConversationUiStore.getState().contextPanel) return;
    const focused = document.activeElement;
    if (focused && focused !== document.body && !focused.closest('#conversation-context-panel')) return;
    if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
  };
  const closeDesktop = () => {
    setPanel(null);
    restoreOpener();
  };

  useEffect(() => {
    const parent = anchor.current?.parentElement;
    if (!parent) return;
    const measure = () => setAvailableWidth(parent.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  // Use the actual conversation width: the application sidebar can be open too.
  const overlay = availableWidth < 820;
  const maxWidth = Math.max(260, Math.min(480, availableWidth - 560));
  const visibleWidth = Math.min(width, maxWidth);
  const content = (
    <Tabs value={panel || 'outline'} onValueChange={(value) => setPanel(value === 'work' ? 'work' : 'outline')} className='h-full min-h-0 gap-0'>
      <div className='flex h-14 shrink-0 items-center gap-2 border-b px-3 pe-12'>
        <TabsList aria-label={t('contextPanel.title')}>
          <TabsTrigger value='outline'>{t('outline.title')}</TabsTrigger>
          <TabsTrigger value='work'>{t('contextPanel.work')}</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value='outline' forceMount className='min-h-0 overflow-hidden pt-3 data-[state=inactive]:hidden'>
        <ConversationOutlineRail embedded onSelect={overlay ? () => setPanel(null) : undefined} />
      </TabsContent>
      <TabsContent value='work' forceMount className='custom-scrollbar min-h-0 overflow-y-auto data-[state=inactive]:hidden'>
        <RootInputPanel conversationId={conversationId} creatorId={creatorId} variant='details' />
        <RootWorkPanel conversationId={conversationId} creatorId={creatorId} variant='details' />
      </TabsContent>
    </Tabs>
  );

  return <>
    <div ref={anchor} className='hidden' />
    {panel && (overlay ? (
      <Sheet open onOpenChange={(open) => { if (!open) setPanel(null); }}>
        <SheetContent id='conversation-context-panel' side='right' className='flex w-[min(92vw,400px)] flex-col gap-0 p-0' closeLabel={t('contextPanel.close')} aria-describedby={undefined}
          onCloseAutoFocus={(event) => { event.preventDefault(); restoreOpener(); }}>
          <SheetTitle className='sr-only'>{t('contextPanel.title')}</SheetTitle>
          {content}
        </SheetContent>
      </Sheet>
    ) : (
      <aside id='conversation-context-panel' aria-label={t('contextPanel.title')} className='relative min-h-0 shrink-0 border-l bg-background' style={{ width: visibleWidth }} onKeyDown={(event) => { if (event.key === 'Escape') closeDesktop(); }}>
        <div role='separator' tabIndex={0} aria-label={t('contextPanel.resize')} aria-orientation='vertical' aria-valuemin={260} aria-valuemax={maxWidth} aria-valuenow={visibleWidth}
          className='absolute -left-1 top-0 z-20 h-full w-2 touch-none cursor-col-resize hover:bg-primary/20 focus-visible:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          onDoubleClick={() => setWidth(320)}
          onKeyDown={(event) => {
            const next = event.key === 'ArrowLeft' ? visibleWidth + 20 : event.key === 'ArrowRight' ? visibleWidth - 20 : event.key === 'Home' ? 260 : event.key === 'End' ? maxWidth : null;
            if (next !== null) { event.preventDefault(); setWidth(Math.min(maxWidth, next)); }
          }}
          onPointerDown={(event) => { drag.current = { x: event.clientX, width: visibleWidth }; event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={(event) => { if (drag.current) setWidth(Math.min(maxWidth, drag.current.width + drag.current.x - event.clientX)); }}
          onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
        />
        <Button variant='ghost' size='icon' className='absolute right-2 top-2 size-10' aria-label={t('contextPanel.close')} onClick={closeDesktop}><X className='size-4' /></Button>
        {content}
      </aside>
    ))}
  </>;
}
