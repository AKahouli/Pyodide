import { PlayIcon, XIcon, CodeIcon, EyeIcon, DatabaseIcon } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/button';
import { ResizablePanel } from '@/components/ui/resizable-panel';
import { cn } from '@/lib/utils';
import { useConversationV2Store } from '../../store';
import { useConversationV2Translation } from '../../translation';
import { isRuntimePreviewVisible } from '../../runtime/runtime.types';
import { ToolDetailDispatch } from './tool-views/ToolDetailDispatch';
import { ApplicationComponentView } from './ApplicationComponentView';
import { AppBuildProgressPanel } from './AppBuildProgressPanel';
import { AppViewModeToggle, DeployControls } from './DeployControls';
import { HistoricalPreviewBanner, VersionSwitcher } from './VersionHistoryPanel';
import { AppDataPanel } from './AppDataPanel';

const RIGHT_PANEL_STORAGE_KEY = 'conversation-v2-right-panel-width';
const RIGHT_PANEL_DEFAULT_WIDTH = 560;
const RIGHT_PANEL_MIN_WIDTH = 360;
const RIGHT_PANEL_MAX_WIDTH_RATIO = 0.75;

export function RightPanel() {
  const { t } = useConversationV2Translation();
  const {
    mode,
    appTab,
    sessionId,
    close,
    selectedToolCallId,
    liveToolCallId,
    jumpToLive,
    streaming,
    applicationComponent,
    appBuildProgress,
    runtimeStatus,
    setRightPanelView,
  } = useConversationV2Store(
    useShallow((s) => ({
      mode: s.rightPanelMode,
      appTab: s.rightPanelAppTab,
      sessionId: s.sessionId,
      close: s.closeRightPanel,
      selectedToolCallId: s.selectedToolCallId,
      liveToolCallId: s.liveToolCallId,
      jumpToLive: s.jumpToLive,
      streaming: s.streaming,
      applicationComponent: s.applicationComponent,
      appBuildProgress: s.appBuildProgress,
      runtimeStatus: s.runtimeStatus,
      setRightPanelView: s.setRightPanelView,
    })),
  );

  if (mode === 'closed') return null;

  const runtimePreview = isRuntimePreviewVisible(runtimeStatus);
  const hasCode = !!selectedToolCallId;
  const hasPreview =
    !!applicationComponent || !!appBuildProgress || runtimePreview;
  if (!hasCode && !hasPreview) return null;

  const showBuildProgress =
    !!appBuildProgress && !applicationComponent && !runtimePreview;
  const showNodepod = !!applicationComponent || runtimePreview;
  const showAppPanel = (showNodepod || showBuildProgress) && (mode === 'app' || !hasCode);
  const showDataTab = showAppPanel && appTab === 'data';
  const showPreviewTab = showAppPanel && appTab !== 'data';
  const canToggle = hasCode && hasPreview;

  const realTime = selectedToolCallId === liveToolCallId;
  const showJumpToLive = !showAppPanel && streaming && !!liveToolCallId && !realTime;

  const tabClass = (active: boolean) =>
    cn(
      'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
      '@max-[520px]/right-panel:gap-0 @max-[520px]/right-panel:px-2',
      active
        ? 'bg-background text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground',
    );

  const previewTitle = applicationComponent?.title || t('nodepod.previewTitle');

  return (
    <ResizablePanel
      storageKey={RIGHT_PANEL_STORAGE_KEY}
      defaultWidth={RIGHT_PANEL_DEFAULT_WIDTH}
      minWidth={RIGHT_PANEL_MIN_WIDTH}
      maxWidthRatio={RIGHT_PANEL_MAX_WIDTH_RATIO}
      handlePosition='left'
      withHandle
      resizeHandleLabel={t('rightPanel.resizeHandle')}
      className='border-l bg-card/40'
    >
      <aside className='@container/right-panel flex h-full min-w-0 flex-col overflow-hidden'>
        <header className='grid h-11 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b px-3 @max-[520px]/right-panel:gap-1 @max-[520px]/right-panel:px-2'>
          <div className='flex min-w-0 items-center justify-self-start overflow-hidden'>
            {canToggle || showAppPanel ? (
              <div className='inline-flex max-w-full items-center overflow-x-auto rounded-lg border bg-muted/40 p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
                {hasCode && (
                  <button
                    type='button'
                    onClick={() => setRightPanelView('code')}
                    className={tabClass(mode === 'tool')}
                    aria-label={t('rightPanel.tabCode')}
                    title={t('rightPanel.tabCode')}
                  >
                    <CodeIcon className='size-3.5 shrink-0' />
                    <span className='whitespace-nowrap @max-[520px]/right-panel:hidden'>
                      {t('rightPanel.tabCode')}
                    </span>
                  </button>
                )}
                {hasPreview && (
                  <>
                    <button
                      type='button'
                      onClick={() => setRightPanelView('preview')}
                      className={tabClass(showPreviewTab)}
                      aria-label={t('rightPanel.tabPreview')}
                      title={t('rightPanel.tabPreview')}
                    >
                      <EyeIcon className='size-3.5 shrink-0' />
                      <span className='whitespace-nowrap @max-[520px]/right-panel:hidden'>
                        {t('rightPanel.tabPreview')}
                      </span>
                    </button>
                    <button
                      type='button'
                      onClick={() => setRightPanelView('data')}
                      className={tabClass(showDataTab)}
                      aria-label={t('rightPanel.tabData')}
                      title={t('rightPanel.tabData')}
                    >
                      <DatabaseIcon className='size-3.5 shrink-0' />
                      <span className='whitespace-nowrap @max-[520px]/right-panel:hidden'>
                        {t('rightPanel.tabData')}
                      </span>
                    </button>
                  </>
                )}
              </div>
            ) : (
              <span className='truncate text-sm font-semibold'>
                {showAppPanel ? previewTitle : t('rightPanel.title')}
              </span>
            )}
          </div>
          <div className='min-w-0 max-w-[10rem] justify-self-center overflow-hidden px-0.5 @max-[480px]/right-panel:hidden'>
            {hasPreview && showNodepod && applicationComponent ? <AppViewModeToggle /> : null}
          </div>
          <div className='flex min-w-0 shrink-0 items-center justify-self-end gap-0.5'>
            {hasPreview && showNodepod && applicationComponent && (
              <>
                <VersionSwitcher />
                <DeployControls />
              </>
            )}
            <Button variant='ghost' size='icon-sm' aria-label={t('rightPanel.close')} onClick={close}>
              <XIcon className='size-4' />
            </Button>
          </div>
        </header>
        <div className='relative flex min-h-0 flex-1 flex-col overflow-hidden'>
          {showAppPanel ? (
            <>
              {showNodepod ? (
                <div
                  className={cn(
                    'flex min-h-0 flex-1 flex-col overflow-hidden',
                    showDataTab && 'invisible pointer-events-none absolute inset-0',
                  )}
                  aria-hidden={showDataTab || undefined}
                >
                  <HistoricalPreviewBanner />
                  <ApplicationComponentView
                    title={applicationComponent?.title}
                    filesTree={applicationComponent?.filesTree}
                    fileCount={applicationComponent?.fileCount}
                    buildProgress={appBuildProgress}
                  />
                </div>
              ) : (
                <AppBuildProgressPanel
                  key={appBuildProgress!.revision}
                  progress={appBuildProgress!}
                />
              )}
              {showDataTab && sessionId ? (
                <div className='relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden'>
                  <AppDataPanel sessionId={sessionId} />
                </div>
              ) : null}
            </>
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
    </ResizablePanel>
  );
}
