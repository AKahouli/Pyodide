import { PlayIcon, XIcon } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/button';
import { useConversationV2Store } from '../../store';
import { useConversationV2Translation } from '../../translation';
import { ToolDetailDispatch } from './tool-views/ToolDetailDispatch';
import { DeployControls } from './DeployControls';

export function RightPanel() {
  const { t } = useConversationV2Translation();
  const { mode, close, selectedToolCallId, liveToolCallId, jumpToLive, streaming } =
    useConversationV2Store(
      useShallow((s) => ({
        mode: s.rightPanelMode,
        close: s.closeRightPanel,
        selectedToolCallId: s.selectedToolCallId,
        liveToolCallId: s.liveToolCallId,
        jumpToLive: s.jumpToLive,
        streaming: s.streaming,
      })),
    );

  if (mode === 'closed') return null;
  if (!selectedToolCallId) return null;

  const realTime = selectedToolCallId === liveToolCallId;
  const showJumpToLive = streaming && !!liveToolCallId && !realTime;

  return (
    <aside className='flex h-full w-[44%] min-w-[28rem] max-w-[44rem] shrink-0 flex-col border-l bg-card/40'>
      <header className='flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3'>
        <span className='truncate text-sm font-semibold'>{t('rightPanel.title')}</span>
        <div className='flex shrink-0 items-center gap-1'>
          <DeployControls />
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label={t('rightPanel.close')}
            onClick={close}
          >
            <XIcon className='size-4' />
          </Button>
        </div>
      </header>
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
    </aside>
  );
}
