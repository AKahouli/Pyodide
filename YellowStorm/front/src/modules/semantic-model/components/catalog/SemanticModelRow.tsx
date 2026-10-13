import { useState } from 'react';
import { AlertTriangle, ArrowRight, Copy, MoreHorizontal, Pencil, Share2, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { TableCell, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useApiAction } from '@/lib/use-api-action';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import { semanticModelQueryKeys } from '../../query/queryKeys';
import type { SemanticModel } from '../../types';
import { CloneSemanticModelDialog } from './CloneSemanticModelDialog';
import { DeleteSemanticModelDialog } from './DeleteSemanticModelDialog';
import { ShareSemanticModelDialog } from './ShareSemanticModelDialog';

export function SemanticModelRow({ model }: Readonly<{ model: SemanticModel }>) {
  const { t } = useModuleTranslation('semantic-model');
  const automatic = model.kind === 'workspace_default';
  const attention = Boolean(model.brokenBindingCount);
  const isOwner = model.role === 'owner' || !model.role;
  const canEdit = model.role !== 'viewer';
  const ownerLabel = model.ownerName || model.ownerEmail;
  const [shareOpen, setShareOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameName, setRenameName] = useState(model.name);
  const queryClient = useQueryClient();
  const renameAction = useApiAction(
    (name: string) => semanticModelApi.update(model.id, { expectedRevision: model.revision, name }),
    {
      showSuccessToast: true,
      successMessage: t('catalog.rename.renamed'),
      onSuccess: () => {
        setRenameOpen(false);
        void queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.all });
      },
    },
  );
  return (
    <>
      <TableRow>
        <TableCell className='px-4 py-4'>
          <Link to={`/semantic-models/${model.id}`} className='block break-words font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring'>{model.name}</Link>
          <p className='mt-1 line-clamp-1 text-sm text-muted-foreground' title={model.description || undefined}>{model.description || t('catalog.noDescription')}</p>
          <div className='mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground'>
            <span>{t(automatic ? 'catalog.badge.automatic' : 'catalog.badge.designed')}</span>
            {!isOwner && <span title={ownerLabel ? t('catalog.sharedBy', { name: ownerLabel }) : undefined}>{t(model.role === 'editor' ? 'catalog.badge.shared.editor' : 'catalog.badge.shared.viewer')}</span>}
            <span className='sm:hidden'>{t(`status.${model.status}`)} · {t('catalog.recordCount', { count: model.recordCount ?? 0 })}</span>
            <span className='xl:hidden'>{t('catalog.workspaceCount', { count: model.workspaceCount ?? 0 })}</span>
            <span className='xl:hidden'>{t('catalog.structureSummary', { concepts: model.nodeCount ?? 0, links: model.relationCount ?? 0 })}</span>
          </div>
          {attention && <p className='mt-2 flex items-center gap-1.5 text-xs text-destructive'><AlertTriangle aria-hidden className='h-3.5 w-3.5 shrink-0' />{t('catalog.needsAttention', { count: model.brokenBindingCount ?? 0 })}</p>}
        </TableCell>
        <TableCell className='hidden sm:table-cell'><Badge variant={model.status === 'published' ? 'secondary' : 'outline'}>{t(`status.${model.status}`)}</Badge></TableCell>
        <TableCell className='hidden text-xs text-muted-foreground xl:table-cell'>
          <p>{t('catalog.workspaceCount', { count: model.workspaceCount ?? 0 })}</p>
          <p className='mt-1'>{t('catalog.structureSummary', { concepts: model.nodeCount ?? 0, links: model.relationCount ?? 0 })}</p>
        </TableCell>
        <TableCell className='hidden text-right tabular-nums sm:table-cell' title={t('catalog.recordsHint')}>{model.recordCount ?? 0}</TableCell>
        <TableCell className='pr-4'>
          <div className='flex items-center justify-end gap-1'>
            <Button asChild variant='ghost' size='icon'><Link to={`/semantic-models/${model.id}`} aria-label={t('catalog.openNamed', { name: model.name })} title={t('catalog.open')}><ArrowRight aria-hidden className='h-4 w-4' /></Link></Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant='ghost' size='icon' aria-label={t('catalog.actionsFor', { name: model.name })}><MoreHorizontal aria-hidden className='h-4 w-4' /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align='end' onCloseAutoFocus={(event) => { if (renameOpen || shareOpen || cloneOpen || deleteOpen) event.preventDefault(); }}>
                {canEdit && <DropdownMenuItem onSelect={() => { setRenameName(model.name); setRenameOpen(true); }}><Pencil aria-hidden />{t('catalog.rename.button')}</DropdownMenuItem>}
                {isOwner && <DropdownMenuItem onSelect={() => setShareOpen(true)}><Share2 aria-hidden />{t('share.action')}</DropdownMenuItem>}
                <DropdownMenuItem onSelect={() => setCloneOpen(true)}><Copy aria-hidden />{t('clone.button')}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={model.role !== 'owner'} title={model.role !== 'owner' ? t('deleteModel.ownerOnly') : undefined} className='text-destructive focus:text-destructive' onSelect={() => setDeleteOpen(true)}><Trash2 aria-hidden />{t('deleteModel.button')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TableCell>
      </TableRow>

      {model.role === 'owner' && <DeleteSemanticModelDialog model={model} open={deleteOpen} onOpenChange={setDeleteOpen} />}
      {isOwner && (
        <ShareSemanticModelDialog
          open={shareOpen}
          modelId={model.id}
          modelName={model.name}
          onOpenChange={setShareOpen}
        />
      )}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('catalog.rename.title')}</DialogTitle>
            <DialogDescription>{t('catalog.rename.description')}</DialogDescription>
          </DialogHeader>
          <Input
            value={renameName}
            onChange={(event) => setRenameName(event.target.value)}
            aria-label={t('catalog.rename.name')}
            autoFocus
            maxLength={160}
            onKeyDown={(event) => { if (event.key === 'Enter' && renameName.trim() && !renameAction.isLoading) void renameAction.execute(renameName.trim()); }}
          />
          <DialogFooter>
            <Button variant='outline' onClick={() => setRenameOpen(false)}>{t('action.cancel')}</Button>
            <Button
              onClick={() => void renameAction.execute(renameName.trim())}
              disabled={!renameName.trim() || renameName.trim() === model.name || renameAction.isLoading}
            >
              {renameAction.isLoading ? t('catalog.rename.saving') : t('catalog.rename.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <CloneSemanticModelDialog model={model} open={cloneOpen} onOpenChange={setCloneOpen} />
    </>
  );
}

