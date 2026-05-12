import { useState, useRef, useEffect } from 'react';
import { Pencil, Trash2, Check, X } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { cn } from '@/lib/utils';

interface BaselineBadgePopoverProps {
  taskId: string;
  playbookId: string;
  replayId: string | null | undefined;
  label: string | null | undefined;
  toneClassName: string;
  badgeLabel: string;
  isBusy: boolean;
  onRemove: (playbookId: string, taskId: string, replayId: string) => Promise<void>;
  onRename: (playbookId: string, taskId: string, replayId: string, label: string | null) => Promise<void>;
}

export function BaselineBadgePopover({
  taskId,
  playbookId,
  replayId,
  label,
  toneClassName,
  badgeLabel,
  isBusy,
  onRemove,
  onRename,
}: BaselineBadgePopoverProps) {
  const { t } = useModuleTranslation('playbook');
  const [open, setOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [isRemoving, setIsRemoving] = useState(false);
  const [isSavingRename, setIsSavingRename] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  if (!replayId) {
    return <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium', toneClassName)}>{badgeLabel}</span>;
  }

  const handleStartRename = () => {
    setRenameValue(label || '');
    setIsRenaming(true);
  };

  const handleCancelRename = () => {
    setIsRenaming(false);
    setRenameValue('');
  };

  const handleSaveRename = async () => {
    if (!playbookId || !taskId || !replayId) return;
    const trimmed = renameValue.trim();
    if (trimmed === (label || '')) {
      setIsRenaming(false);
      return;
    }
    setIsSavingRename(true);
    try {
      await onRename(playbookId, taskId, replayId, trimmed || null);
      setIsRenaming(false);
      setOpen(false);
    } catch {
      // error already handled by store
    } finally {
      setIsSavingRename(false);
    }
  };

  const handleRemove = async () => {
    if (!playbookId || !taskId || !replayId) return;
    setIsRemoving(true);
    try {
      await onRemove(playbookId, taskId, replayId);
      setOpen(false);
    } catch {
      // error already handled by store
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={(next) => { if (!next) setIsRenaming(false); setOpen(next); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium',
            'cursor-pointer transition-opacity hover:opacity-90',
            toneClassName,
          )}
          onClick={(e) => { e.stopPropagation(); }}
        >
          {isBusy && <span className="h-2.5 w-2.5 animate-spin border-2 border-current border-t-transparent rounded-full" />}
          <span>{badgeLabel}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" side="bottom" align="start" onClick={(e) => e.stopPropagation()}>
        {isRenaming ? (
          <div className="flex items-center gap-1.5 px-1 py-1">
            <input
              ref={inputRef}
              type="text"
              className="flex-1 min-w-0 h-7 rounded-md border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveRename();
                if (e.key === 'Escape') handleCancelRename();
              }}
              placeholder={t('baselineBadge.renamePlaceholder')}
              maxLength={100}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              disabled={isSavingRename}
              onClick={handleSaveRename}
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={handleCancelRename}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            <button
              type="button"
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent transition-colors w-full text-left"
              onClick={handleStartRename}
            >
              <Pencil className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span>{t('baselineBadge.rename')}</span>
            </button>
            <button
              type="button"
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent transition-colors w-full text-left text-destructive"
              onClick={handleRemove}
              disabled={isRemoving}
            >
              <Trash2 className="h-3.5 w-3.5 shrink-0" />
              <span>{t('baselineBadge.remove')}</span>
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
