import { PlayIcon, XIcon, CodeIcon, EyeIcon } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useConversationV2Store } from '../../store';
import { useConversationV2Translation } from '../../translation';
import { ToolDetailDispatch } from './tool-views/ToolDetailDispatch';
import { ApplicationComponentView } from './ApplicationComponentView';
import { DeployControls } from './DeployControls';

export function RightPanel() {
  const { t } = useConversationV2Translation();
  const {
    mode,
    close,
    selectedToolCallId,
    liveToolCallId,
    jumpToLive,
    streaming,
    applicationComponent,
    setRightPanelView,
  } = useConversationV2Store(
    useShallow((s) => ({
      mode: s.rightPanelMode,
      close: s.closeRightPanel,
      selectedToolCallId: s.selectedToolCallId,
      liveToolCallId: s.liveToolCallId,
      jumpToLive: s.jumpToLive,
      streaming: s.streaming,
      applicationComponent: s.applicationComponent,
      setRightPanelView: s.setRightPanelView,
    })),
  );

  if (mode === 'closed') return null;

  const hasCode = !!selectedToolCallId;
  const hasPreview = !!applicationComponent;
  if (!hasCode && !hasPreview) return null;

  // Which tab is active, clamped to what's actually available: prefer the
  // preview when we're in 'app' mode (or when there's no code to show).
  const showPreview = hasPreview && (mode === 'app' || !hasCode);
  // The Code/Preview toggle only makes sense once BOTH exist.
  const canToggle = hasCode && hasPreview;

  const realTime = selectedToolCallId === liveToolCallId;
  const showJumpToLive = !showPreview && streaming && !!liveToolCallId && !realTime;

  const tabClass = (active: boolean) =>
    cn(
      'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
      active
        ? 'bg-background text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground',
    );

  return (
    <aside className='flex h-full w-[44%] min-w-[28rem] max-w-[44rem] shrink-0 flex-col border-l bg-card/40'>
      <header className='flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3'>
        {canToggle ? (
          <div className='inline-flex items-center rounded-lg border bg-muted/40 p-0.5'>
            <button type='button' onClick={() => setRightPanelView('code')} className={tabClass(!showPreview)}>
              <CodeIcon className='size-3.5' />
              {t('rightPanel.tabCode')}
            </button>
            <button type='button' onClick={() => setRightPanelView('preview')} className={tabClass(showPreview)}>
              <EyeIcon className='size-3.5' />
              {t('rightPanel.tabPreview')}
            </button>
          </div>
        ) : (
          <span className='truncate text-sm font-semibold'>
            {showPreview ? applicationComponent!.title || t('rightPanel.title') : t('rightPanel.title')}
          </span>
        )}
        <div className='flex shrink-0 items-center gap-1'>
          {hasPreview && <DeployControls />}
          <Button variant='ghost' size='icon-sm' aria-label={t('rightPanel.close')} onClick={close}>
            <XIcon className='size-4' />
          </Button>
        </div>
      </header>
      <div className='relative flex min-h-0 flex-1 flex-col'>
        {showPreview ? (
          // Key on the URL so a newly-pushed preview remounts the iframe on the
          // new address (WebPreview reads defaultUrl only on mount).
          <ApplicationComponentView
            key={applicationComponent!.url}
            url={applicationComponent!.url}
            title={applicationComponent!.title}
          />
        ) : (
          <div className='relative flex min-h-0 flex-1 flex-col p-3'>
            <ToolDetailDispatch />
            {showJumpToLive && (
              <div className='pointer-events-none absolute inset-x-0 bottom-3 flex justify-center'>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={jumpToLive}
                  className='pointer-events-auto gap-1 rounded-full shadow-md'
                >
                  <PlayIcon className='size-4' />
                  {t('rightPanel.jumpToLive')}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
