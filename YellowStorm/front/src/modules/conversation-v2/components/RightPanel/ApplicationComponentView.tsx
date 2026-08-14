import React, { useCallback, useMemo, useState } from 'react';
import {
  ColumnsIcon,
  EyeIcon,
  FileCodeIcon,
  Loader2Icon,
  Maximize2Icon,
  RefreshCwIcon,
  ExternalLinkIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import { cn } from '@/lib/utils';
import { useConversationV2Store } from '../../store';
import { useConversationV2Translation } from '../../translation';
import type { FilesTreeNode } from '../../types';
import { useNodepodPreview, type NodepodPreviewStatus } from '../../hooks/useNodepodPreview';
import { AppSourceFileTree } from './AppSourceFileTree';
import { AppSourceFileViewer } from './AppSourceFileViewer';
import { resolveSourceFilesTree } from '../../utils/files-tree';

// Vague 5 contract: this view NEVER boots Nodepod.
// BrowserRuntimeHost is started once in ConversationV2SessionPage; useNodepodPreview
// only subscribes. Props (filesTree, …) are display-only and must not trigger a second boot.
// Ticket / mcpToken must never be passed into the preview iframe (URL, props, postMessage).

type LayoutMode = 'preview-only' | 'split';
type ContentPane = 'preview' | 'source';

interface ApplicationComponentViewProps {
  title?: string;
  /** Kept for the file-tree sidebar display; no longer drives Nodepod boot. */
  filesTree?: FilesTreeNode | null;
  fileCount?: number;
  buildProgress?: import('../../types').AppBuildProgress | null;
}

function statusBadgeClass(status: NodepodPreviewStatus): string | null {
  switch (status) {
    case 'ready':
      return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400';
    case 'loading':
      return 'bg-sky-500/15 text-sky-700 dark:text-sky-400';
    case 'installing':
      return 'bg-violet-500/15 text-violet-700 dark:text-violet-400';
    case 'starting':
      return 'bg-amber-500/15 text-amber-700 dark:text-amber-400';
    case 'error':
      return 'bg-destructive/15 text-destructive';
    case 'idle':
      return 'bg-muted text-muted-foreground';
    default:
      return null;
  }
}

function statusBadgeKey(
  status: NodepodPreviewStatus,
):
  | 'nodepod.statusReady'
  | 'nodepod.statusLoading'
  | 'nodepod.statusInstalling'
  | 'nodepod.statusStarting'
  | 'nodepod.statusError'
  | 'nodepod.statusWaiting'
  | null {
  switch (status) {
    case 'ready':
      return 'nodepod.statusReady';
    case 'loading':
      return 'nodepod.statusLoading';
    case 'installing':
      return 'nodepod.statusInstalling';
    case 'starting':
      return 'nodepod.statusStarting';
    case 'error':
      return 'nodepod.statusError';
    case 'idle':
      return 'nodepod.statusWaiting';
    default:
      return null;
  }
}

export function ApplicationComponentView({
  title,
  filesTree,
  fileCount,
  buildProgress,
}: ApplicationComponentViewProps) {
  const { t } = useConversationV2Translation();
  const sessionId = useConversationV2Store((s) => s.sessionId);
  const appViewMode = useConversationV2Store((s) => s.appViewMode);
  const deployedUrl = useConversationV2Store((s) => s.deployedUrl);
  // The host is long-lived in ConversationV2SessionPage; this hook subscribes.
  const { status, previewUrl, error, files, retry, previewIframeRef } = useNodepodPreview({
    sessionId,
  });

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('preview-only');
  const [contentPane, setContentPane] = useState<ContentPane>('preview');

  const showDeployedApp = appViewMode === 'deployed' && !!deployedUrl;

  const canEmbedDeployed = useMemo(() => {
    if (!deployedUrl) return false;
    try {
      const parsed = new URL(deployedUrl, window.location.href);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
      if (parsed.origin === window.location.origin) return false;
      return true;
    } catch {
      return false;
    }
  }, [deployedUrl]);

  const handleOpenDeployed = useCallback(() => {
    if (!deployedUrl) return;
    window.open(deployedUrl, '_blank', 'noopener,noreferrer');
  }, [deployedUrl]);

  const badgeKey = statusBadgeKey(status);
  const badgeClass = statusBadgeClass(status);
  const badge = badgeKey && badgeClass ? { label: t(badgeKey), className: badgeClass } : null;
  const busy = status === 'loading' || status === 'installing' || status === 'starting';

  const sourceTree = useMemo(
    () => resolveSourceFilesTree(filesTree, files),
    [filesTree, files],
  );

  const selectedContent = useMemo(() => {
    if (!selectedPath || !files) return null;
    const rel = selectedPath.replace(/^\/+/, '');
    const candidates = [
      selectedPath,
      rel,
      `/${rel}`,
      rel.startsWith('/') ? rel : `/${rel}`,
    ];
    for (const key of candidates) {
      const hit = files[key];
      if (hit != null) return hit;
    }
    return null;
  }, [files, selectedPath]);

  const statusLabel =
    status === 'loading'
      ? t('nodepod.loading')
      : status === 'installing'
        ? t('nodepod.installing')
        : status === 'starting'
          ? t('nodepod.starting')
          : status === 'error'
            ? t('nodepod.error')
            : status === 'idle'
              ? t('nodepod.waitingSources')
              : null;

  const handleSelectFile = (path: string) => {
    setSelectedPath(path);
    setContentPane('source');
    if (layoutMode === 'preview-only') {
      setLayoutMode('split');
    }
  };

  const handleOpenExternal = useCallback(() => {
    if (!previewUrl) return;
    window.open(previewUrl, '_blank', 'noopener,noreferrer');
  }, [previewUrl]);

  const setPreviewOnly = () => {
    setLayoutMode('preview-only');
    setContentPane('preview');
  };

  const setSplitLayout = () => {
    setLayoutMode('split');
    setContentPane('preview');
  };

  const tabClass = (active: boolean, disabled?: boolean) =>
    cn(
      'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
      disabled && 'pointer-events-none opacity-40',
      active
        ? 'bg-background text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground',
    );

  const iconBtn = (
    icon: React.ReactNode,
    onClick: () => void,
    disabled: boolean,
    label: string,
  ) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type='button'
          onClick={onClick}
          disabled={disabled}
          className={cn(
            'inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors',
            disabled
              ? 'text-muted-foreground/40'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
          aria-label={label}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side='bottom' className='text-xs'>
        {label}
      </TooltipContent>
    </Tooltip>
  );

  const previewPane = (
    <>
      {status === 'ready' && previewUrl ? (
        <div className='relative h-full min-h-0 overflow-hidden bg-muted/20'>
          <iframe
            ref={previewIframeRef}
            title={title || t('nodepod.previewTitle')}
            src={previewUrl}
            className='absolute inset-0 size-full border-0 bg-white'
            // allow-same-origin required for preview_action + Nodepod SW (Vague 4).
            // Ticket/mcpToken must never appear in src, props, or postMessage.
            sandbox='allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts'
          />
        </div>
      ) : (
        <div className='flex h-full min-h-0 flex-col items-center justify-center gap-3 overflow-hidden bg-muted/15 px-4 text-center'>
          {busy && (
            <div className='relative'>
              <div className='absolute inset-0 animate-ping rounded-full bg-primary/20' />
              <div className='relative flex size-10 items-center justify-center rounded-full bg-primary/10'>
                <Loader2Icon className='size-4 animate-spin text-primary' />
              </div>
            </div>
          )}
          {!busy && status === 'error' && (
            <div className='flex size-10 items-center justify-center rounded-full bg-destructive/10'>
              <RefreshCwIcon className='size-4 text-destructive' />
            </div>
          )}
          <div className='space-y-1'>
            <p className='text-sm font-medium'>{statusLabel}</p>
            {error && (
              <p className='max-w-xs text-xs text-destructive leading-relaxed'>{error}</p>
            )}
            {busy && (
              <p className='max-w-xs text-xs text-muted-foreground'>{t('nodepod.bootHint')}</p>
            )}
          </div>
          {(status === 'error' || status === 'idle') && (
            <Button type='button' variant='outline' size='sm' onClick={retry}>
              <RefreshCwIcon className='mr-1.5 size-3.5' />
              {t('nodepod.retry')}
            </Button>
          )}
        </div>
      )}
    </>
  );

  const mainContent = (
    <div className='flex h-full min-h-0 min-w-0 flex-col overflow-hidden'>
      <div className='relative min-h-0 flex-1 overflow-hidden'>
        {layoutMode === 'split' && contentPane === 'source' ? (
          <AppSourceFileViewer path={selectedPath ?? ''} content={selectedContent} />
        ) : (
          previewPane
        )}
      </div>
    </div>
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div className='relative flex h-full min-h-0 flex-col overflow-hidden'>
        {/*
          Keep Nodepod chrome + preview iframe mounted while Deployed is shown
          so the SW/proxy stay warm for instant switch-back.
        */}
        <div
          className={cn(
            'flex h-full min-h-0 flex-col overflow-hidden',
            showDeployedApp && 'invisible pointer-events-none absolute inset-0',
          )}
          aria-hidden={showDeployedApp || undefined}
        >
          <div
            className='flex h-10 shrink-0 items-center gap-1.5 border-b bg-card/60 px-2'
            role='toolbar'
          >
            {badge && (
              <Badge
                variant='secondary'
                className={cn('shrink-0 gap-1 border-0 text-[10px] font-normal', badge.className)}
              >
                {busy && <Loader2Icon className='size-3 animate-spin' />}
                {badge.label}
              </Badge>
            )}

            {buildProgress && buildProgress.phase !== 'ready' && (
              <span className='hidden max-w-[12rem] truncate text-[10px] text-muted-foreground lg:inline'>
                {buildProgress.message}
              </span>
            )}

            {fileCount != null && (
              <span className='hidden shrink-0 text-[10px] text-muted-foreground sm:inline'>
                {t('nodepod.fileCount', { count: fileCount })}
              </span>
            )}

            <div className='ml-auto flex shrink-0 items-center gap-0.5'>
              {layoutMode === 'split' && (
                <div className='mr-1 inline-flex items-center rounded-md border bg-muted/30 p-0.5'>
                  <button
                    type='button'
                    onClick={() => setContentPane('preview')}
                    className={tabClass(contentPane === 'preview')}
                    aria-pressed={contentPane === 'preview'}
                  >
                    <EyeIcon className='size-3.5' />
                    <span className='hidden sm:inline'>{t('nodepod.tabPreview')}</span>
                  </button>
                  <button
                    type='button'
                    onClick={() => setContentPane('source')}
                    className={tabClass(contentPane === 'source', !selectedPath)}
                    disabled={!selectedPath}
                    aria-pressed={contentPane === 'source'}
                  >
                    <FileCodeIcon className='size-3.5' />
                    <span className='hidden sm:inline'>{t('nodepod.tabSource')}</span>
                  </button>
                </div>
              )}

              <div className='inline-flex items-center rounded-md border bg-muted/30 p-0.5'>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type='button'
                      onClick={setPreviewOnly}
                      className={tabClass(layoutMode === 'preview-only')}
                      aria-pressed={layoutMode === 'preview-only'}
                      aria-label={t('nodepod.layoutPreviewOnlyHint')}
                    >
                      <Maximize2Icon className='size-3.5' />
                      <span className='hidden md:inline'>{t('nodepod.layoutPreviewOnly')}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side='bottom' className='text-xs'>
                    {t('nodepod.layoutPreviewOnlyHint')}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type='button'
                      onClick={setSplitLayout}
                      className={tabClass(layoutMode === 'split')}
                      aria-pressed={layoutMode === 'split'}
                      aria-label={t('nodepod.layoutSplitHint')}
                    >
                      <ColumnsIcon className='size-3.5' />
                      <span className='hidden md:inline'>{t('nodepod.layoutSplit')}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side='bottom' className='text-xs'>
                    {t('nodepod.layoutSplitHint')}
                  </TooltipContent>
                </Tooltip>
              </div>

              {status === 'ready' &&
                previewUrl &&
                iconBtn(
                  <ExternalLinkIcon className='size-3.5' />,
                  handleOpenExternal,
                  false,
                  t('nodepod.openInNewTab'),
                )}

              {(status === 'error' || status === 'idle' || status === 'ready') &&
                iconBtn(
                  <RefreshCwIcon className='size-3.5' />,
                  retry,
                  false,
                  t('nodepod.retry'),
                )}
            </div>
          </div>

          <div className='min-h-0 flex-1 overflow-hidden'>
            {layoutMode === 'split' ? (
              <ResizablePanelGroup
                id='nodepod-app-split'
                orientation='horizontal'
                className='h-full min-h-0'
                defaultLayout={{ 'source-tree': 30, 'preview-pane': 56 }}
              >
                <ResizablePanel
                  id='source-tree'
                  defaultSize='30%'
                  minSize='25%'
                  maxSize='60%'
                  className='flex min-h-0 min-w-0 flex-col overflow-hidden'
                >
                  <AppSourceFileTree
                    tree={sourceTree}
                    selectedPath={selectedPath}
                    onSelect={handleSelectFile}
                    className='h-full min-h-0'
                  />
                </ResizablePanel>
                <ResizableHandle withHandle className='w-px shrink-0' />
                <ResizablePanel
                  id='preview-pane'
                  defaultSize='56%'
                  minSize='40%'
                  className='flex min-h-0 min-w-0 flex-col overflow-hidden'
                >
                  {mainContent}
                </ResizablePanel>
              </ResizablePanelGroup>
            ) : (
              mainContent
            )}
          </div>
        </div>

        {showDeployedApp && (
          <div className='absolute inset-0 z-10 flex h-full min-h-0 flex-col overflow-hidden bg-background'>
            {canEmbedDeployed ? (
              <div className='relative min-h-0 flex-1 overflow-hidden bg-muted/20'>
                {/*
                  No sandbox: published apps need full browser capabilities.
                  credentialless: parent uses COEP credentialless for Nodepod.
                */}
                <iframe
                  title={title || t('nodepod.previewTitle')}
                  src={deployedUrl}
                  className='absolute inset-0 size-full border-0 bg-white'
                  referrerPolicy='strict-origin-when-cross-origin'
                  allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
                  {...({ credentialless: '' } as React.IframeHTMLAttributes<HTMLIFrameElement>)}
                />
              </div>
            ) : (
              <div className='flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-muted/15 px-6 text-center'>
                <ExternalLinkIcon className='size-8 text-muted-foreground/50' />
                <div className='space-y-1'>
                  <p className='text-sm font-medium'>{t('deploy.embedUnavailable')}</p>
                </div>
                <Button type='button' size='sm' onClick={handleOpenDeployed} className='gap-1.5'>
                  <ExternalLinkIcon className='size-3.5' />
                  {t('deploy.open')}
                </Button>
              </div>
            )}
            <div className='flex h-9 shrink-0 items-center gap-2 border-t bg-card/60 px-2'>
              <a
                href={deployedUrl}
                target='_blank'
                rel='noreferrer'
                className='min-w-0 flex-1 truncate text-[11px] text-muted-foreground hover:text-foreground hover:underline'
                title={deployedUrl}
              >
                {deployedUrl}
              </a>
              <Button
                type='button'
                variant='outline'
                size='sm'
                className='h-7 shrink-0 gap-1.5 text-xs'
                onClick={handleOpenDeployed}
              >
                <ExternalLinkIcon className='size-3.5' />
                {t('deploy.open')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

