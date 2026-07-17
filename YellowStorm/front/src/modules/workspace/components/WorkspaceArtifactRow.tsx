import { useState } from 'react';
import { Copy, ExternalLink, GitBranch, Loader2, MoreVertical, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { showError, showSuccess } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { cloneWorkspaceArtifact, deleteWorkspaceArtifact, retryWorkspaceArtifact, updateWorkspaceArtifact } from '../artifact-api';
import type { WorkspaceArtifact } from '../types';

type Props = {
  artifact: WorkspaceArtifact;
  canWrite: boolean;
  onChanged: () => Promise<void>;
};

function errorMessage(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'message' in error ? String(error.message) : undefined;
}

export function WorkspaceArtifactRow({ artifact, canWrite, onChanged }: Props) {
  const navigate = useNavigate();
  const { t } = useModuleTranslation('workspace');
  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState(artifact.name);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const isActive = artifact.status === 'queued' || artifact.status === 'generating';

  const run = async (action: () => Promise<unknown>, successKey: 'artifacts.cloneSuccess' | 'artifacts.retrySuccess' | 'artifacts.deleteSuccess' | 'artifacts.renameSuccess') => {
    setBusy(true);
    try {
      await action();
      showSuccess(t(successKey));
      await onChanged();
    } catch (error) {
      showError(t('artifacts.actionFailed'), { description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const selection = artifact.primarySource.selection.mode === 'all'
    ? t('artifacts.allPages')
    : t('artifacts.selectedPages', { pages: artifact.primarySource.selection.pages.join(', ') });

  return (
    <div className='ml-10 flex items-center gap-3 rounded-md border-l-2 border-primary/20 py-2 pl-5 pr-1 hover:bg-accent/40'>
      {isActive ? <Loader2 className='h-4 w-4 shrink-0 animate-spin text-primary' /> : <GitBranch className='h-4 w-4 shrink-0 text-primary' />}
      <button type='button' className='min-w-0 flex-1 text-left' onClick={() => artifact.status === 'ready' && navigate(`/workspace/${artifact.workspaceId}/artifacts/${artifact.id}`)} disabled={artifact.status !== 'ready'}>
        <span className='block truncate text-sm font-medium'>{artifact.name}</span>
        <span className='block text-xs text-muted-foreground'>{t('artifacts.type')}{' · '}{selection}</span>
      </button>
      <span className='rounded-full bg-muted px-2 py-0.5 text-xs capitalize' title={artifact.generation.error}>{t(`artifacts.status.${artifact.status}`)}</span>
      {(artifact.status === 'ready' || (canWrite && !isActive)) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant='ghost' size='icon' disabled={busy} aria-label={t('artifacts.actions')}><MoreVertical className='h-4 w-4' /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            {artifact.status === 'ready' && <DropdownMenuItem onClick={() => navigate(`/workspace/${artifact.workspaceId}/artifacts/${artifact.id}`)}><ExternalLink className='mr-2 h-4 w-4' />{t('artifacts.open')}</DropdownMenuItem>}
            {canWrite && artifact.status === 'ready' && <DropdownMenuItem onClick={() => void run(() => cloneWorkspaceArtifact(artifact.workspaceId, artifact.id), 'artifacts.cloneSuccess')}><Copy className='mr-2 h-4 w-4' />{t('artifacts.clone')}</DropdownMenuItem>}
            {canWrite && artifact.status === 'failed' && <DropdownMenuItem onClick={() => void run(() => retryWorkspaceArtifact(artifact.workspaceId, artifact.id), 'artifacts.retrySuccess')}><RefreshCw className='mr-2 h-4 w-4' />{t('artifacts.retry')}</DropdownMenuItem>}
            {canWrite && <DropdownMenuItem onClick={() => { setName(artifact.name); setRenameOpen(true); }}><Pencil className='mr-2 h-4 w-4' />{t('artifacts.rename')}</DropdownMenuItem>}
            {canWrite && <DropdownMenuSeparator />}
            {canWrite && <DropdownMenuItem className='text-destructive focus:text-destructive' onClick={() => setDeleteOpen(true)}><Trash2 className='mr-2 h-4 w-4' />{t('artifacts.delete')}</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('artifacts.renameTitle')}</DialogTitle></DialogHeader>
          <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={150} />
          <DialogFooter>
            <Button variant='outline' onClick={() => setRenameOpen(false)}>{t('artifacts.cancel')}</Button>
            <Button disabled={busy || !name.trim()} onClick={() => void run(() => updateWorkspaceArtifact(artifact.workspaceId, artifact.id, { expectedRevision: artifact.revision, name: name.trim() }), 'artifacts.renameSuccess').then(() => setRenameOpen(false))}>{t('artifacts.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('artifacts.deleteConfirmTitle')}</DialogTitle><DialogDescription>{t('artifacts.deleteConfirmDescription', { name: artifact.name })}</DialogDescription></DialogHeader>
          <DialogFooter><Button variant='outline' onClick={() => setDeleteOpen(false)} disabled={busy}>{t('artifacts.cancel')}</Button><Button variant='destructive' disabled={busy} onClick={() => void run(() => deleteWorkspaceArtifact(artifact.workspaceId, artifact.id), 'artifacts.deleteSuccess').then(() => setDeleteOpen(false))}>{t('artifacts.delete')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
