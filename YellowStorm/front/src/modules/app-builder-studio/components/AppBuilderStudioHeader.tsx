import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  FolderKanban,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  AppBuilderStudioSessionPermissions,
  hasAppBuilderStudioSessionPermission,
  type AppBuilderStudioSessionPermission,
} from '../session-permissions';
import { useAppBuilderStudioStore } from '../store';
import { APP_MARKET_PATH } from '../studio-paths';
import { useTypewriter } from '../hooks/useTypewriter';
import { useAppBuilderStudioTranslation } from '../translation';
import { RenameDialog } from './RenameDialog';
import { DeleteConversationDialog } from './DeleteConversationDialog';
import { WorkspaceManagerSheet } from './WorkspaceManagerSheet';

interface AppBuilderStudioHeaderProps {
  readOnly?: boolean;
  permissions?: AppBuilderStudioSessionPermission[];
}

export function AppBuilderStudioHeader({
  readOnly = false,
  permissions = [],
}: AppBuilderStudioHeaderProps) {
  const navigate = useNavigate();
  const sessionId = useAppBuilderStudioStore((s) => s.sessionId);
  const title = useAppBuilderStudioStore((s) => s.title);
  const streaming = useAppBuilderStudioStore((s) => s.streaming);
  const streamError = useAppBuilderStudioStore((s) => s.streamError);
  const workspaceIds = useAppBuilderStudioStore((s) => s.workspaceIds);
  const systemWorkspaceId = useAppBuilderStudioStore((s) => s.systemWorkspaceId);
  const setFilesSheetOpen = useAppBuilderStudioStore((s) => s.setFilesSheetOpen);
  const renameCurrent = useAppBuilderStudioStore((s) => s.renameCurrent);
  const deleteCurrent = useAppBuilderStudioStore((s) => s.deleteCurrent);
  const typewriterSessionId = useAppBuilderStudioStore((s) => s.typewriterSessionId);
  const typewriterName = useAppBuilderStudioStore((s) => s.typewriterName);
  const clearTypewriter = useAppBuilderStudioStore((s) => s.clearTypewriter);

  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [workspaceSheetOpen, setWorkspaceSheetOpen] = useState(false);

  const { t } = useAppBuilderStudioTranslation();

  const isTypewriting = !!sessionId && typewriterSessionId === sessionId;
  const typed = useTypewriter(isTypewriting ? typewriterName : null, 30, clearTypewriter);

  const displayedTitle =
    isTypewriting && typed ? typed : title && title.length > 0 ? title : t('page.newChat');

  const canManageWorkspaces = hasAppBuilderStudioSessionPermission(
    permissions,
    AppBuilderStudioSessionPermissions.SESSION_WRITE,
  );
  const canBrowseFiles = hasAppBuilderStudioSessionPermission(
    permissions,
    AppBuilderStudioSessionPermissions.WORKSPACE_DOCUMENTS_READ,
  );
  const canRename = hasAppBuilderStudioSessionPermission(
    permissions,
    AppBuilderStudioSessionPermissions.SESSION_WRITE,
  );
  const canDelete = hasAppBuilderStudioSessionPermission(
    permissions,
    AppBuilderStudioSessionPermissions.SESSION_DELETE,
  );

  const handleRename = async (newTitle: string) => {
    try {
      await renameCurrent(newTitle);
    } catch {
      toast.error(t('toasts.rename.error'));
    }
  };

  const handleDelete = async () => {
    try {
      await deleteCurrent();
      navigate(APP_MARKET_PATH);
    } catch {
      toast.error(t('toasts.delete.error'));
    }
  };

  if (!sessionId) return null;

  return (
    <>
      <header
        className={cn(
          'sticky top-0 z-10 shrink-0 border-b border-border/60',
          'bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/70',
        )}
      >
        <div className='flex items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4'>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={() => navigate(APP_MARKET_PATH)}
                  className='size-9 shrink-0 rounded-lg'
                  aria-label={t('header.back')}
                >
                  <ArrowLeft className='size-4' />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t('header.backToMarket')}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
            <div className='flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground'>
              <Sparkles className='size-3 text-primary' aria-hidden />
              <span className='truncate'>{t('page.eyebrow')}</span>
            </div>
            <h1 className='truncate text-sm font-semibold tracking-tight sm:text-base'>
              {displayedTitle}
            </h1>
          </div>

          <div className='flex shrink-0 items-center gap-1.5'>
            {streaming && (
              <Badge
                variant='secondary'
                className='hidden gap-1.5 sm:inline-flex'
                data-testid='header-streaming'
              >
                <span
                  className='size-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none'
                  aria-hidden
                />
                {t('header.streaming')}
              </Badge>
            )}
            {streamError && !streaming && (
              <Badge
                variant='secondary'
                className='hidden border-fail/40 text-fail sm:inline-flex'
                data-testid='header-stream-error'
              >
                {t('header.streamError')}
              </Badge>
            )}
            {readOnly && (
              <Badge variant='secondary' className='hidden sm:inline-flex'>
                {t('header.readOnly')}
              </Badge>
            )}

            {canManageWorkspaces && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant='ghost'
                      size='icon'
                      onClick={() => setWorkspaceSheetOpen(true)}
                      className='size-9 shrink-0 rounded-lg'
                      aria-label={t('header.tooltips.workspaces')}
                    >
                      <FolderKanban className='size-4' />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t('header.tooltips.workspaces')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {canBrowseFiles && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant='ghost'
                      size='icon'
                      onClick={() => setFilesSheetOpen(true)}
                      disabled={!systemWorkspaceId}
                      className='size-9 shrink-0 rounded-lg'
                      aria-label={t('header.tooltips.files')}
                      title={!systemWorkspaceId ? t('files.unavailable') : undefined}
                    >
                      <FolderOpen className='size-4' />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t('header.tooltips.files')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {(canRename || canDelete) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='size-9 shrink-0 rounded-lg'
                    aria-label={t('header.actions.more')}
                  >
                    <MoreHorizontal className='size-4' />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end'>
                  {canRename && (
                    <DropdownMenuItem onClick={() => setRenameOpen(true)} className='cursor-pointer'>
                      <Pencil className='me-2 size-4' />
                      {t('header.actions.rename')}
                    </DropdownMenuItem>
                  )}
                  {canDelete && (
                    <DropdownMenuItem
                      onClick={() => setDeleteOpen(true)}
                      className='cursor-pointer text-destructive focus:text-destructive'
                    >
                      <Trash2 className='me-2 size-4' />
                      {t('header.actions.delete')}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </header>

      {canRename && (
        <RenameDialog
          open={renameOpen}
          onOpenChange={setRenameOpen}
          currentTitle={title ?? ''}
          onRename={handleRename}
        />
      )}

      {canDelete && (
        <DeleteConversationDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          onConfirm={handleDelete}
          title={title ?? undefined}
        />
      )}

      {canManageWorkspaces && (
        <WorkspaceManagerSheet
          open={workspaceSheetOpen}
          onOpenChange={setWorkspaceSheetOpen}
          sessionId={sessionId}
          workspaceIds={workspaceIds}
        />
      )}
    </>
  );
}
