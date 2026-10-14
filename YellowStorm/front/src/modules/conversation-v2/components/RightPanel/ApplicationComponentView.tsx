import React, { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  CheckCircleIcon,
  CircleDotIcon,
  ColumnsIcon,
  EyeIcon,
  FileCodeIcon,
  Loader2Icon,
  Maximize2Icon,
  RefreshCwIcon,
  ExternalLinkIcon,
  TriangleIcon,
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
import { PreviewBrowserFrame } from './preview/PreviewBrowserFrame';
import { PreviewCenteredStatus } from './preview/PreviewCenteredStatus';
import { resolvePreviewPhase } from './preview/previewStateModel';
import { resolveSourceFilesTree } from '../../utils/files-tree';

// Semantic tokens only (never blue-500/green-500/red-500/zinc-500 literals):
// the preview status must stay readable across every COLOR_THEME.
const PRIMARY_BADGE_CLASS = 'bg-primary/15 text-primary';
const RUNNING_BADGE_CLASS = 'bg-primary/15 text-primary';
const SUCCESS_BADGE_CLASS = 'bg-ok/15 text-ok';
const ERROR_BADGE_CLASS = 'bg-fail/15 text-fail';
const IDLE_BADGE_CLASS = 'bg-idle/15 text-idle';

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
          size='icon'
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          className='size-8 shrink-0 rounded-lg text-muted-foreground hover:bg-background hover:text-foreground'
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
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 rounded-xl border border-border/60 bg-muted/40 p-0.5 shadow-sm',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function segmentClass(active: boolean, disabled?: boolean) {
  return cn(
    'inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-all',
    disabled && 'pointer-events-none opacity-40',
    active
      ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50'
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
  const { status, hostStatus, previewUrl, error, files, retry, previewIframeRef } = useNodepodPreview({
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

  const busy = status === 'loading' || status === 'installing' || status === 'starting';
  const previewPhase = useMemo(() => resolvePreviewPhase(hostStatus), [hostStatus]);

  const badgeKey = statusBadgeKey(status);
  const badgeClass = statusBadgeClass(status);
  // While booting, name the exact phase in the toolbar so it agrees with the
  // centred orb instead of showing a single generic "Preparing".
  const badgeLabel = busy
    ? t(previewPhase.labelKey as Parameters<typeof t>[0])
    : badgeKey
      ? t(badgeKey)
      : null;
  const badge = badgeLabel && badgeClass ? { label: badgeLabel, className: badgeClass } : null;

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

  const addressLabel = t('nodepod.addressLocal');

  const previewPane =
    status === 'ready' && previewUrl ? (
      <PreviewBrowserFrame
        addressLabel={addressLabel}
        live
        liveLabel={t('nodepod.statusReady')}
      >
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
      </PreviewBrowserFrame>
    ) : (
      <PreviewBrowserFrame addressLabel={addressLabel}>
        <PreviewCenteredStatus
          phase={previewPhase}
          errorDetail={safeError}
          onRetry={retry}
        />
      </PreviewBrowserFrame>
    );

  const mainContent = (
    <div className='flex h-full min-h-0 flex-col overflow-hidden'>
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
            className='flex h-11 shrink-0 items-center gap-2 border-b border-border/50 bg-background/90 px-3'
            role='toolbar'
            aria-label={t('nodepod.toolbarLabel')}
          >
            {badge && (
              <Badge
                variant='secondary'
                className={cn(
                  'h-6 shrink-0 gap-1.5 rounded-full border-0 px-2 text-[11px] font-medium',
                  badge.className,
                )}
              >
                {busy ? (
                  <Loader2Icon className='size-3 animate-spin motion-reduce:animate-none' aria-hidden />
                ) : status === 'ready' ? (
                  <CheckCircleIcon className='size-3' aria-hidden />
                ) : status === 'error' ? (
                  <TriangleIcon className='size-3' aria-hidden />
                ) : (
                  <CircleDotIcon className='size-3' aria-hidden />
                )}
                <span>{badge.label}</span>
              </Badge>
            )}

            <div className='min-w-0 flex-1'>
              <h2 className='truncate text-sm font-medium tracking-tight text-foreground'>
                {title || t('nodepod.previewTitle')}
              </h2>
              {(buildPhaseLabel || (fileCount != null && fileCount > 0)) && (
                <p className='hidden truncate text-[11px] text-muted-foreground sm:block'>
                  {buildPhaseLabel ?? t('nodepod.fileCount', { count: fileCount })}
                </p>
              )}
            </div>

            <div className='ms-auto flex shrink-0 items-center gap-1'>
              {layoutMode === 'split' && (
                <SegmentedControl>
                  <button
                    type='button'
                    onClick={() => setContentPane('preview')}
                    className={segmentClass(contentPane === 'preview')}
                    aria-pressed={contentPane === 'preview'}
                    aria-label={t('nodepod.tabPreview')}
                  >
                    <EyeIcon className='size-3.5' />
                    <span className='hidden sm:inline'>{t('nodepod.tabPreview')}</span>
                  </button>
                  <button
                    type='button'
                    onClick={() => setContentPane('source')}
                    className={segmentClass(contentPane === 'source', !selectedPath)}
                    disabled={!selectedPath}
                    aria-pressed={contentPane === 'source'}
                    aria-label={t('nodepod.tabSource')}
                  >
                    <FileCodeIcon className='size-3.5' />
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
                      aria-label={t('nodepod.layoutPreviewOnly')}
                    >
                      <Maximize2Icon className='size-3.5' />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side='bottom' className='text-xs'>
                    {t('nodepod.layoutPreviewOnly')}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type='button'
                      onClick={setSplitLayout}
                      className={segmentClass(layoutMode === 'split')}
                      aria-pressed={layoutMode === 'split'}
                      aria-label={t('nodepod.layoutSplit')}
                    >
                      <ColumnsIcon className='size-3.5' />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side='bottom' className='text-xs'>
                    {t('nodepod.layoutSplit')}
                  </TooltipContent>
                </Tooltip>
              </SegmentedControl>

              {status === 'ready' && previewUrl && (
                <ToolbarIconButton
                  icon={<ExternalLinkIcon className='size-3.5' />}
                  onClick={handleOpenExternal}
                  label={t('nodepod.openInNewTab')}
                />
              )}

              {(status === 'error' || status === 'idle' || status === 'ready') && (
                <ToolbarIconButton
                  icon={<RefreshCwIcon className='size-3.5' />}
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
                <PreviewBrowserFrame
                  addressLabel={t('nodepod.addressDeployed')}
                  live
                  liveLabel={t('deploy.liveBadge')}
                >
                  {/* No sandbox: published apps need full browser capabilities.
                     credentialless: parent uses COEP credentialless for Nodepod. */}
                  <iframe
                    title={title || t('nodepod.previewTitle')}
                    src={deployedSrc}
                    className='absolute inset-0 size-full border-0 bg-background'
                    referrerPolicy='strict-origin-when-cross-origin'
                    allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
                    {...({ credentialless: '' } as React.IframeHTMLAttributes<HTMLIFrameElement>)}
                  />
                </PreviewBrowserFrame>
              ) : (
                <PreviewBrowserFrame addressLabel={t('nodepod.addressDeployed')}>
                  <div className='flex size-full flex-col items-center justify-center gap-4 px-6 text-center'>
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
                </PreviewBrowserFrame>
              )}
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
