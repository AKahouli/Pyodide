import React, { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertCircleIcon,
  ColumnsIcon,
  EyeIcon,
  FileCodeIcon,
  Loader2Icon,
  Maximize2Icon,
  RefreshCwIcon,
  ExternalLinkIcon,
  SparklesIcon,
  PlaySquareIcon,
  LightbulbIcon,
} from 'lucide-react';
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
import { buildAppRegisterInviteUrl } from '../../utils/app-register-invite-url';
import { toUserFacingPreviewError } from '../../utils/preview-user-message';
import {
  buildPhaseTranslationKey,
} from '../../utils/app-build-phase';
import type { FilesTreeNode } from '../../types';
import { useNodepodPreview, type NodepodPreviewStatus } from '../../hooks/useNodepodPreview';
import { getOrCreateHost } from '../../runtime/BrowserRuntimeHost';
import { AppSourceFileTree } from './AppSourceFileTree';
import { AppSourceFileViewer } from './AppSourceFileViewer';
import { resolveSourceFilesTree } from '../../utils/files-tree';

const PRIMARY_BADGE_CLASS = 'bg-primary/15 text-primary';
const RUNNING_BADGE_CLASS = 'bg-blue-500/15 text-blue-500';
const SUCCESS_BADGE_CLASS = 'bg-green-500/15 text-green-500';
const ERROR_BADGE_CLASS = 'bg-red-500/15 text-red-500';
const IDLE_BADGE_CLASS = 'bg-zinc-500/15 text-zinc-500';

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
      return SUCCESS_BADGE_CLASS;
    case 'loading':
    case 'installing':
    case 'starting':
      return RUNNING_BADGE_CLASS;
    case 'error':
      return ERROR_BADGE_CLASS;
    case 'idle':
      return IDLE_BADGE_CLASS;
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

function ToolbarIconButton({
  icon,
  onClick,
  disabled,
  label,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type='button'
          variant='ghost'
          size='icon-lg'
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          className='size-9 shrink-0 text-muted-foreground hover:text-foreground'
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side='bottom' className='text-xs'>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function SegmentedControl({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-lg border border-border/70 bg-muted/50 p-1',
        className,
      )}
    >
      {children}
    </div>
  );
}

function segmentClass(active: boolean, disabled?: boolean) {
  return cn(
    'inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors',
    disabled && 'pointer-events-none opacity-40',
    active
      ? 'bg-background text-foreground shadow-sm'
      : 'text-muted-foreground hover:text-foreground',
  );
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
  const ownerInviteToken = useConversationV2Store((s) => s.ownerInviteToken);
  const workspaceRevisionId = useConversationV2Store(
    (s) => s.previewRevisionId ?? s.applicationComponent?.workspaceRevisionId,
  );
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

  const deployedSrc = useMemo(() => {
    if (!deployedUrl) return '';
    if (!ownerInviteToken) return deployedUrl;
    return buildAppRegisterInviteUrl(deployedUrl, ownerInviteToken);
  }, [deployedUrl, ownerInviteToken]);

  const handleOpenDeployed = useCallback(() => {
    if (!deployedSrc) return;
    window.open(deployedSrc, '_blank', 'noopener,noreferrer');
  }, [deployedSrc]);

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

  const statusHint = busy
    ? t('nodepod.bootHint')
    : status === 'idle'
      ? t('nodepod.waitingHint')
      : null;

  const safeError = useMemo(
    () => toUserFacingPreviewError(error, t('nodepod.errorDetail')),
    [error, t],
  );

  const buildPhaseLabel = useMemo(() => {
    if (!buildProgress || buildProgress.phase === 'ready') return null;
    if (buildProgress.phase === 'failed') return t('nodepod.statusError');
    const key = buildPhaseTranslationKey(buildProgress.phase);
    const translated = t(key);
    return translated === key ? null : translated;
  }, [buildProgress, t]);

  const handleSelectFile = (path: string) => {
    setSelectedPath(path);
    setContentPane('source');
    if (layoutMode === 'preview-only') {
      setLayoutMode('split');
    }
  };

  const handleOpenExternal = useCallback(() => {
    if (!previewUrl) return;
    const base = import.meta.env.BASE_URL || '/';
    const wrapper = new URL('preview-wrapper.html', `${window.location.origin}${base}`);
    wrapper.searchParams.set('src', previewUrl);
    // No noopener/noreferrer: preview-wrapper.html needs window.opener to relay
    // App Data through this tab's host. The host authenticates the popup by its
    // exact WindowProxy + origin before serving any ticket-backed request.
    const opened = window.open(wrapper.toString(), '_blank');
    if (opened && sessionId) {
      getOrCreateHost(sessionId).registerExternalPreviewRelayPeer(opened, window.location.origin);
      return;
    }
    window.open(previewUrl, '_blank', 'noopener,noreferrer');
  }, [previewUrl, sessionId]);

  const setPreviewOnly = () => {
    setLayoutMode('preview-only');
    setContentPane('preview');
  };

  const setSplitLayout = () => {
    setLayoutMode('split');
    setContentPane('preview');
  };

  const previewPane =
    status === 'ready' && previewUrl ? (
      <iframe
        key={`${workspaceRevisionId ?? 'preview'}-${previewUrl}`}
        ref={previewIframeRef}
        title={title || t('nodepod.previewTitle')}
        src={previewUrl}
        className='absolute inset-0 size-full border-0 bg-background'
        // allow-same-origin required for preview_action + Nodepod SW (Vague 4).
        // Ticket/mcpToken must never appear in src, props, or postMessage.
        sandbox='allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts'
      />
    ) : (
      <div className='flex size-full flex-col items-center justify-center gap-4 bg-gradient-to-b from-muted/30 to-background px-6 text-center'>
      <div className='flex size-20 items-center justify-center rounded-2xl border shadow-lg'>
        {busy && <Loader2Icon className='size-8 animate-spin text-primary' />}
        {!busy && status === 'error' && (
          <AlertCircleIcon className='size-8 text-fail' />
        )}
        {!busy && status === 'idle' && (
          <LightbulbIcon className='size-8 text-muted-foreground/70' />
        )}
      </div>
      <div className='max-w-sm space-y-2'>
        <p className='text-lg font-bold tracking-tight text-foreground'>
          {statusLabel || t('nodepod.previewTitle')}
        </p>
        {status === 'error' && safeError && (
          <p className='text-sm leading-relaxed text-fail'>{safeError}</p>
        )}
        {statusHint && (
          <p className='text-sm leading-relaxed text-muted-foreground'>{statusHint}</p>
        )}
      </div>
      {(status === 'error' || status === 'idle') && (
        <Button
          type='button'
          variant='outline'
          size='lg'
          onClick={retry}
          className='h-10 gap-2 px-6 text-sm font-medium
            transition-transform duration-200 hover:scale-[1.01] active:scale-[0.99]'
        >
          <PlaySquareIcon className='size-4' />
          {t('nodepod.retry')}
        </Button>
      )}
      </div>
    );

  const mainContent = (
    <div className='flex h-full min-h-0 flex-col overflow-hidden bg-background/50'>
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
    <TooltipProvider delayDuration={250}>
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
            className='flex h-12 shrink-0 items-center gap-2 border-b border-border/70 bg-card/70 px-4'
            role='toolbar'
            aria-label={t('nodepod.toolbarLabel')}
          >
            {badge && (
              <Badge
                variant='secondary'
                className={cn(
                  'h-7 shrink-0 gap-1.5 rounded-full border-0 px-3 text-xs font-medium',
                  badge.className,
                )}
              >
                {busy && <Loader2Icon className='size-3.5 animate-spin' />}
                {status === 'ready' && (
                  <span className='size-2 rounded-full bg-ok' aria-hidden />
                )}
                {badge.label}
              </Badge>
            )}

            {title ? (
              <h2 className='min-w-0 truncate text-sm font-semibold text-foreground'>
                {title}
              </h2>
            ) : buildPhaseLabel ? (
              <p className='hidden min-w-0 truncate text-xs text-muted-foreground lg:block'>
                {buildPhaseLabel}
              </p>
            ) : null}

            {fileCount != null && fileCount > 0 && (
              <span className='hidden shrink-0 text-xs tabular-nums text-muted-foreground md:inline'>
                {t('nodepod.fileCount', { count: fileCount })}
              </span>
            )}

            <div className='ml-auto flex shrink-0 items-center gap-2'>
              {layoutMode === 'split' && (
                <SegmentedControl className='mr-1'>
                  <button
                    type='button'
                    onClick={() => setContentPane('preview')}
                    className={segmentClass(contentPane === 'preview')}
                    aria-pressed={contentPane === 'preview'}
                  >
                    <EyeIcon className='size-4' />
                    <span className='hidden sm:inline'>{t('nodepod.tabPreview')}</span>
                  </button>
                  <button
                    type='button'
                    onClick={() => setContentPane('source')}
                    className={segmentClass(contentPane === 'source', !selectedPath)}
                    disabled={!selectedPath}
                    aria-pressed={contentPane === 'source'}
                  >
                    <FileCodeIcon className='size-4' />
                    <span className='hidden sm:inline'>{t('nodepod.tabSource')}</span>
                  </button>
                </SegmentedControl>
              )}

              <SegmentedControl>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type='button'
                      onClick={setPreviewOnly}
                      className={segmentClass(layoutMode === 'preview-only')}
                      aria-pressed={layoutMode === 'preview-only'}
                      aria-label={t('nodepod.layoutPreviewOnlyHint')}
                    >
                      <Maximize2Icon className='size-4' />
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
                      className={segmentClass(layoutMode === 'split')}
                      aria-pressed={layoutMode === 'split'}
                      aria-label={t('nodepod.layoutSplitHint')}
                    >
                      <ColumnsIcon className='size-4' />
                      <span className='hidden md:inline'>{t('nodepod.layoutSplit')}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side='bottom' className='text-xs'>
                    {t('nodepod.layoutSplitHint')}
                  </TooltipContent>
                </Tooltip>
              </SegmentedControl>

              {status === 'ready' && previewUrl && (
                <ToolbarIconButton
                  icon={<ExternalLinkIcon className='size-4' />}
                  onClick={handleOpenExternal}
                  label={t('nodepod.openInNewTab')}
                />
              )}

              {(status === 'error' || status === 'idle' || status === 'ready') && (
                <ToolbarIconButton
                  icon={<RefreshCwIcon className='size-4' />}
                  onClick={retry}
                  label={t('nodepod.retry')}
                />
              )}
            </div>
          </div>

          <div className='min-h-0 flex-1 overflow-hidden bg-background'>
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
                  minSize='22%'
                  maxSize='48%'
                  className='flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-border/60'
                >
                  <AppSourceFileTree
                    tree={sourceTree}
                    selectedPath={selectedPath}
                    onSelect={handleSelectFile}
                    className='h-full min-h-0'
                  />
                </ResizablePanel>
                <ResizableHandle withHandle className='w-px shrink-0 bg-border/60' />
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
            <div className='relative min-h-0 flex-1 overflow-hidden'>
              {canEmbedDeployed ? (
                /* No sandbox: published apps need full browser capabilities.
                   credentialless: parent uses COEP credentialless for Nodepod. */
                <iframe
                  title={title || t('nodepod.previewTitle')}
                  src={deployedSrc}
                  className='absolute inset-0 size-full border-0 bg-background'
                  referrerPolicy='strict-origin-when-cross-origin'
                  allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
                  {...({ credentialless: '' } as React.IframeHTMLAttributes<HTMLIFrameElement>)}
                />
              ) : (
                <div className='flex size-full flex-col items-center justify-center gap-4 bg-gradient-to-b from-muted/30 to-background px-6 text-center'>
                  <div className='flex size-14 items-center justify-center rounded-2xl border border-border/60 bg-card shadow-sm'>
                    <ExternalLinkIcon className='size-6 text-muted-foreground/70' />
                  </div>
                  <div className='max-w-sm space-y-1.5'>
                    <p className='text-sm font-semibold tracking-tight'>
                      {t('deploy.embedUnavailable')}
                    </p>
                    <p className='text-xs leading-relaxed text-muted-foreground'>
                      {t('deploy.embedUnavailableHint')}
                    </p>
                  </div>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={handleOpenDeployed}
                    className='h-8 gap-1.5'
                  >
                    <ExternalLinkIcon className='size-3.5' />
                    {t('deploy.open')}
                  </Button>
                </div>
              )}
            </div>
            <div className='flex h-10 shrink-0 items-center gap-2 border-t border-border/70 bg-card/80 px-3'>
              <Badge
                variant='secondary'
                className='h-6 shrink-0 gap-1.5 border-0 bg-ok-soft px-2 text-[11px] font-medium text-ok'
              >
                <span className='size-1.5 rounded-full bg-ok' aria-hidden />
                {t('deploy.liveBadge')}
              </Badge>
              <p className='min-w-0 flex-1 truncate text-xs text-muted-foreground'>
                {title || t('deploy.publishedApp')}
              </p>
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
