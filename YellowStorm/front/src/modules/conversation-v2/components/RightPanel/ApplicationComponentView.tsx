import { useEffect, useMemo, useState } from 'react';
import {
  EyeIcon,
  FileCodeIcon,
  Loader2Icon,
  RefreshCwIcon,
  SparklesIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useConversationV2Store } from '../../store';
import { useConversationV2Translation } from '../../translation';
import type { FilesTreeNode } from '../../types';
import { useNodepodPreview, type NodepodPreviewStatus } from '../../hooks/useNodepodPreview';
import { AppSourceFileTree } from './AppSourceFileTree';
import { AppSourceFileViewer } from './AppSourceFileViewer';

type MainPane = 'preview' | 'source';

interface ApplicationComponentViewProps {
  title?: string;
  cephPath?: string | null;
  filesTree?: FilesTreeNode | null;
  fileCount?: number;
  /** Changes when the agent pushes a new generation — remounts Nodepod. */
  revision: string;
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

/**
 * Dual-pane app viewer: read-only file tree + web preview (Nodepod).
 * Users can inspect generated sources but cannot edit them.
 */
export function ApplicationComponentView({
  title,
  cephPath,
  filesTree,
  fileCount,
  revision,
}: ApplicationComponentViewProps) {
  const { t } = useConversationV2Translation();
  const sessionId = useConversationV2Store((s) => s.sessionId);
  const { status, previewUrl, error, files, retry } = useNodepodPreview({
    sessionId,
    cephPath,
    filesTree,
    revision,
  });

  useEffect(() => {
    console.log('[Nodepod] [ui:ApplicationComponentView]', {
      sessionId,
      title,
      cephPath,
      fileCount,
      revision,
      status,
      previewUrl,
      error,
      hydratedFiles: files ? Object.keys(files).length : 0,
    });
  }, [sessionId, title, cephPath, fileCount, revision, status, previewUrl, error, files]);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [mainPane, setMainPane] = useState<MainPane>('preview');
  const [treeCollapsed, setTreeCollapsed] = useState(false);

  const badgeKey = statusBadgeKey(status);
  const badgeClass = statusBadgeClass(status);
  const badge = badgeKey && badgeClass ? { label: t(badgeKey), className: badgeClass } : null;
  const busy = status === 'loading' || status === 'installing' || status === 'starting';

  const selectedContent = useMemo(() => {
    if (!selectedPath || !files) return null;
    const key = selectedPath.startsWith('/') ? selectedPath : `/${selectedPath}`;
    return files[key] ?? files[selectedPath] ?? null;
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
    setMainPane('source');
  };

  const paneTab = (id: MainPane, active: boolean) =>
    cn(
      'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
      active
        ? 'bg-background text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground',
    );

  return (
    <div className='flex size-full min-h-0 flex-col bg-gradient-to-b from-muted/30 to-transparent'>
      {/* Toolbar */}
      <div className='flex shrink-0 flex-wrap items-center gap-2 border-b bg-card/60 px-3 py-2 backdrop-blur-sm'>
        <div className='flex min-w-0 flex-1 items-center gap-2'>
          <span className='flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary'>
            <SparklesIcon className='size-3.5' />
          </span>
          <div className='min-w-0'>
            <p className='truncate text-sm font-semibold leading-tight' title={title}>
              {title || t('nodepod.previewTitle')}
            </p>
            <p className='truncate text-[11px] text-muted-foreground'>
              {fileCount != null
                ? t('nodepod.fileCount', { count: fileCount })
                : t('nodepod.inBrowser')}
            </p>
          </div>
        </div>

        {badge && (
          <Badge variant='secondary' className={cn('gap-1.5 border-0 font-normal', badge.className)}>
            {busy && <Loader2Icon className='size-3 animate-spin' />}
            {badge.label}
          </Badge>
        )}

        <div className='inline-flex items-center rounded-lg border bg-muted/40 p-0.5'>
          <button
            type='button'
            onClick={() => setMainPane('preview')}
            className={paneTab('preview', mainPane === 'preview')}
          >
            <EyeIcon className='size-3.5' />
            {t('nodepod.tabPreview')}
          </button>
          <button
            type='button'
            onClick={() => setMainPane('source')}
            className={paneTab('source', mainPane === 'source')}
            disabled={!selectedPath}
          >
            <FileCodeIcon className='size-3.5' />
            {t('nodepod.tabSource')}
          </button>
        </div>

        <Button
          type='button'
          variant='ghost'
          size='icon-sm'
          onClick={() => setTreeCollapsed((v) => !v)}
          aria-label={treeCollapsed ? t('nodepod.showFiles') : t('nodepod.hideFiles')}
          title={treeCollapsed ? t('nodepod.showFiles') : t('nodepod.hideFiles')}
        >
          <FileCodeIcon className={cn('size-4', !treeCollapsed && 'text-primary')} />
        </Button>

        {(status === 'error' || status === 'idle' || status === 'ready') && (
          <Button type='button' variant='ghost' size='icon-sm' onClick={retry} aria-label={t('nodepod.retry')}>
            <RefreshCwIcon className='size-4' />
          </Button>
        )}
      </div>

      {/* Body: tree + main */}
      <div className='flex min-h-0 flex-1'>
        {!treeCollapsed && (
          <aside className='flex w-[min(42%,240px)] shrink-0 flex-col border-r bg-card/40'>
            <AppSourceFileTree
              tree={filesTree}
              selectedPath={selectedPath}
              onSelect={handleSelectFile}
              className='min-h-0 flex-1'
            />
          </aside>
        )}

        <section className='relative flex min-h-0 min-w-0 flex-1 flex-col'>
          {mainPane === 'source' ? (
            <AppSourceFileViewer path={selectedPath ?? ''} content={selectedContent} />
          ) : status === 'ready' && previewUrl ? (
            <iframe
              title={title || t('nodepod.previewTitle')}
              src={previewUrl}
              className='size-full border-0 bg-background'
              sandbox='allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts'
            />
          ) : (
            <div className='flex size-full flex-col items-center justify-center gap-3 bg-muted/20 px-6 text-center'>
              {busy && (
                <div className='relative'>
                  <div className='absolute inset-0 animate-ping rounded-full bg-primary/20' />
                  <div className='relative flex size-12 items-center justify-center rounded-full bg-primary/10'>
                    <Loader2Icon className='size-5 animate-spin text-primary' />
                  </div>
                </div>
              )}
              {!busy && status === 'error' && (
                <div className='flex size-12 items-center justify-center rounded-full bg-destructive/10'>
                  <RefreshCwIcon className='size-5 text-destructive' />
                </div>
              )}
              {!busy && status === 'idle' && (
                <div className='flex size-12 items-center justify-center rounded-full bg-muted'>
                  <SparklesIcon className='size-5 text-muted-foreground' />
                </div>
              )}
              <div className='space-y-1'>
                <p className='text-sm font-medium'>{statusLabel}</p>
                {error && <p className='max-w-sm text-xs text-destructive'>{error}</p>}
                {busy && (
                  <p className='max-w-sm text-xs text-muted-foreground'>{t('nodepod.bootHint')}</p>
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
        </section>
      </div>
    </div>
  );
}
