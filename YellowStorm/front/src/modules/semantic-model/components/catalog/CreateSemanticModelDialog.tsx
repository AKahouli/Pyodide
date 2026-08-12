import { useEffect, useState } from 'react';
import { Loader2, Network } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { showError } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { getWorkspaces } from '@/modules/workspace/api';
import type { Workspace } from '@/modules/workspace/types';
import { useCreateSemanticModel } from '../../query/hooks';

export function CreateSemanticModelDialog({ open, onOpenChange, onCreated }: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void; onCreated: (id: string) => void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const mutation = useCreateSemanticModel();
  const [name,setName] = useState('');
  const [description,setDescription] = useState('');
  const [workspaces,setWorkspaces] = useState<Workspace[]>([]);
  const [selected,setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    void getWorkspaces({ limit: 100 }).then((result) => setWorkspaces(result.workspaces)).catch(() => setWorkspaces([]));
  },[open]);

  const submit = async () => {
    if (!name.trim()) return;
    try {
      const created = await mutation.mutateAsync({ name: name.trim(), description: description.trim(), workspaceIds: selected });
      setName(''); setDescription(''); setSelected([]); onOpenChange(false); onCreated(created.id);
    } catch (error) {
      showError(t('create.error'), { description: error instanceof Error ? error.message : undefined });
    }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className='max-w-xl'>
    <DialogHeader><DialogTitle>{t('create.title')}</DialogTitle><DialogDescription>{t('create.description')}</DialogDescription></DialogHeader>
    <div className='space-y-5 py-2'>
      <div className='space-y-2'><Label htmlFor='semantic-model-name'>{t('create.name')}</Label><Input id='semantic-model-name' value={name} onChange={(event) => setName(event.target.value)} placeholder={t('create.namePlaceholder')} autoFocus /></div>
      <div className='space-y-2'><Label htmlFor='semantic-model-description'>{t('create.summary')}</Label><Textarea id='semantic-model-description' value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t('create.summaryPlaceholder')} /></div>
      <div className='space-y-2'><Label>{t('create.workspaces')}</Label><p className='text-xs text-muted-foreground'>{t('create.workspacesHelp')}</p>
        <div className='max-h-44 space-y-1 overflow-y-auto rounded-xl border p-2'>
          {workspaces.length ? workspaces.map((workspace) => <label key={workspace.id} className='flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted'>
            <Checkbox checked={selected.includes(workspace.id)} onCheckedChange={(checked) => setSelected((current) => checked ? [...current,workspace.id] : current.filter((id) => id !== workspace.id))} />
            <Network className='h-4 w-4 text-muted-foreground' /><span className='text-sm'>{workspace.name}</span>
          </label>) : <p className='p-3 text-sm text-muted-foreground'>{t('create.noWorkspaces')}</p>}
        </div>
      </div>
    </div>
    <DialogFooter><Button variant='outline' onClick={() => onOpenChange(false)}>{t('action.cancel')}</Button><Button onClick={() => void submit()} disabled={!name.trim() || mutation.isPending}>{mutation.isPending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}{t('create.submit')}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
