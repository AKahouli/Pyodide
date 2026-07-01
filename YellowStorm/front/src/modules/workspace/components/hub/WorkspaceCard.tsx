import {
  FileText,
  HardDrive,
  Layers,
  Lock,
  Settings,
  Share2,
  Trash2,
  Users,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatFileSize } from '../../utils';
import type { WorkspaceHubItem, ViewMode } from '../../hooks/useWorkspaceHubFilters';

interface WorkspaceCardProps {
  workspace: WorkspaceHubItem;
  layout?: ViewMode;
  onOpen: (id: string) => void;
  onSettings?: (id: string) => void;
  onShare?: (id: string) => void;
  onDelete?: (workspace: WorkspaceHubItem) => void;
}

function accentColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash % 5) + 1;
  return `var(--chart-${idx})`;
}

export function WorkspaceCard({
  workspace,
  layout = 'grid',
  onOpen,
  onSettings,
  onShare,
  onDelete,
}: Readonly<WorkspaceCardProps>) {
  const color = accentColor(workspace.id);
  const docLabel = `${workspace.documentCount} doc${workspace.documentCount === 1 ? '' : 's'}`;
  const storageLabel = formatFileSize(workspace.usedStorage);

  const isOwned = !workspace.isShared && !workspace.isReadOnly;
  const canSettings = isOwned && !!onSettings;
  const canShare = isOwned && !workspace.isPersonal && !!onShare;
  const canDelete = isOwned && !workspace.isPersonal && !!onDelete;
  const hasActions = canSettings || canShare || canDelete;

  const sharedBadge = workspace.isShared ? (
    <span className="rounded-sm border border-border/80 px-1 py-0 text-[10px] text-muted-foreground">
      Partagé par {workspace.sharedByName}
    </span>
  ) : null;

  const publicBadge = workspace.isPublicItem ? (
    <span className="rounded-sm border border-border/80 px-1 py-0 text-[10px] text-muted-foreground">
      Public
    </span>
  ) : null;

  const actions = hasActions ? (
    <div
      className={cn(
        'flex items-center gap-0.5 opacity-60 transition group-hover:opacity-100',
        layout === 'list' && 'shrink-0',
      )}
    >
      {canSettings && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={(e) => {
            e.stopPropagation();
            onSettings?.(workspace.id);
          }}
          title="Paramètres"
        >
          <Settings className="h-3.5 w-3.5" />
        </Button>
      )}
      {canShare && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={(e) => {
            e.stopPropagation();
            onShare?.(workspace.id);
          }}
          title="Partager"
        >
          <Share2 className="h-3.5 w-3.5" />
        </Button>
      )}
      {canDelete && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete?.(workspace);
          }}
          title="Supprimer le workspace"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  ) : null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen(workspace.id);
    }
  };

  if (layout === 'list') {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(workspace.id)}
        onKeyDown={handleKeyDown}
        className="group relative flex w-full cursor-pointer items-center gap-4 rounded-lg border border-border/60 bg-card px-4 py-3 text-left transition hover:border-border hover:bg-accent/30"
      >
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium tracking-tight">{workspace.name}</span>
            {sharedBadge}
            {publicBadge}
            {workspace.isReadOnly && (
              <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />
            )}
          </div>
          {workspace.description && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {workspace.description}
            </p>
          )}
          <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <FileText className="h-3 w-3" />
              {docLabel}
            </span>
            <span className="inline-flex items-center gap-1">
              <HardDrive className="h-3 w-3" />
              {storageLabel}
            </span>
            {!workspace.isShared && (workspace.shareCount ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1">
                <Share2 className="h-3 w-3" />
                {workspace.shareCount}
              </span>
            )}
          </div>
        </div>
        {actions ?? (
          <Layers className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
        )}
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(workspace.id)}
      onKeyDown={handleKeyDown}
      className="group relative flex h-full cursor-pointer flex-col rounded-xl border border-border/60 bg-card p-5 text-left transition hover:border-border hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px]">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: color }}
            aria-hidden
          />
          <span className="inline-flex items-center gap-1 uppercase tracking-[0.08em] text-muted-foreground">
            {workspace.isShared ? <Users className="h-3 w-3" /> : <Layers className="h-3 w-3" />}
            {workspace.isShared ? 'Partagé' : 'Workspace'}
          </span>
          {sharedBadge}
          {publicBadge}
        </div>
        {workspace.isReadOnly && <Lock className="h-3 w-3 text-muted-foreground" />}
      </div>

      <div className="mt-4">
        <h3 className="text-[15px] font-semibold leading-snug tracking-tight">
          {workspace.name}
        </h3>
      </div>

      {workspace.description && (
        <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {workspace.description}
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-4 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5" />
          {docLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <HardDrive className="h-3.5 w-3.5" />
          {storageLabel}
        </span>
        {!workspace.isShared && (workspace.shareCount ?? 0) > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <Share2 className="h-3.5 w-3.5" />
            {workspace.shareCount} partage{(workspace.shareCount ?? 0) === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {actions && (
        <div className="-mx-5 -mb-5 mt-4 flex items-center justify-end border-t border-border/50 bg-accent/20 px-3 py-2">
          {actions}
        </div>
      )}
    </div>
  );
}
