import { useEffect, useMemo, useState } from 'react';
import { Loader2, Network, Search, Share2, Warehouse } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { showError } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { getSharedWorkspaces, getWorkspaces } from '@/modules/workspace/api';
import type { SharedWorkspaceResponse, Workspace } from '@/modules/workspace/types';
import { useCreateSemanticModel } from '../../query/hooks';

export function CreateSemanticModelDialog({ open, onOpenChange, onCreated }: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void; onCreated: (id: string) => void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const mutation = useCreateSemanticModel();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [ownWorkspaces, setOwnWorkspaces] = useState<Workspace[]>([]);
  const [sharedWorkspaces, setSharedWorkspaces] = useState<SharedWorkspaceResponse[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!open) return;
    void Promise.all([
      getWorkspaces({ limit: 100 }),
      getSharedWorkspaces({ limit: 100 }).catch((err) => { console.warn('[CreateDialog] getSharedWorkspaces failed:', err); return { workspaces: [] }; }),
    ]).then(([own, shared]) => {
      console.log('[CreateDialog] own:', own.workspaces.length, 'shared raw:', shared.workspaces.length);
      const ownIds = new Set(own.workspaces.map((w) => w.id));
      const filteredShared = shared.workspaces.filter((w) => !ownIds.has(w.id));
      console.log('[CreateDialog] shared after filter:', filteredShared.length);
      setOwnWorkspaces(own.workspaces);
      setSharedWorkspaces(filteredShared);
    }).catch((err) => { console.error('[CreateDialog] Promise.all failed:', err); setOwnWorkspaces([]); setSharedWorkspaces([]); });
  }, [open]);

  const filteredOwn = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? ownWorkspaces.filter((w) => w.name.toLowerCase().includes(q)) : ownWorkspaces;
  }, [ownWorkspaces, filter]);

  const filteredShared = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? sharedWorkspaces.filter((w) => w.name.toLowerCase().includes(q)) : sharedWorkspaces;
  }, [sharedWorkspaces, filter]);

  const toggleSelect = (id: string, checked: boolean | string) => {
    setSelected((current) => checked ? [...current, id] : current.filter((v) => v !== id));
  };

  const reset = () => { setName(''); setDescription(''); setSelected([]); setFilter(''); };

  const submit = async () => {
    if (!name.trim()) return;
    try {
      const created = await mutation.mutateAsync({ name: name.trim(), description: description.trim(), workspaceIds: selected });
      reset(); onOpenChange(false); onCreated(created.id);
    } catch (error) {
      showError(t('create.error'), { description: error instanceof Error ? error.message : undefined });
    }
  };

  const hasAny = filteredOwn.length > 0 || filteredShared.length > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className='max-w-xl'>
        <DialogHeader>
          <DialogTitle>{t('create.title')}</DialogTitle>
          <DialogDescription>{t('create.description')}</DialogDescription>
        </DialogHeader>
        <div className='space-y-5 py-2'>
          <div className='space-y-2'>
            <Label htmlFor='semantic-model-name'>{t('create.name')}</Label>
            <Input id='semantic-model-name' value={name} onChange={(e) => setName(e.target.value)} placeholder={t('create.namePlaceholder')} autoFocus />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='semantic-model-description'>{t('create.summary')}</Label>
            <Textarea id='semantic-model-description' value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('create.summaryPlaceholder')} />
          </div>
          <div className='space-y-2'>
            <Label>{t('create.workspaces')}</Label>
            <p className='text-xs text-muted-foreground'>{t('create.workspacesHelp')}</p>
            {/* Search filter */}
            <div className='relative'>
              <Search className='absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground' />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder='Filtrer par nom…'
                className='h-8 pl-8 text-sm'
              />
            </div>
            <div className='max-h-52 overflow-y-auto rounded-xl border p-2'>
              {/* Shared workspaces section — first */}
              {filteredShared.length > 0 && (
                <>
                  <div className='mb-2.5 flex items-center gap-2'>
                    <div className='h-px flex-1 bg-border' />
                    <div className='flex items-center gap-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-0.5'>
                      <Share2 className='h-3 w-3 text-blue-400' />
                      <span className='text-[10px] font-semibold text-blue-400'>Partagés avec moi</span>
                      <span className='flex h-3.5 w-3.5 items-center justify-center rounded-full bg-blue-500/20 text-[9px] font-bold text-blue-400'>
                        {filteredShared.length}
                      </span>
                    </div>
                    <div className='h-px flex-1 bg-border' />
                  </div>
                  {filteredShared.map((workspace) => (
                    <label key={workspace.id} className='flex cursor-pointer items-center gap-3 rounded-lg border border-blue-500/20 bg-blue-950/20 px-3 py-2 mb-1 hover:bg-blue-950/40'>
                      <Checkbox checked={selected.includes(workspace.id)} onCheckedChange={(checked) => toggleSelect(workspace.id, checked)} />
                      <Warehouse className='h-4 w-4 shrink-0 text-blue-400' />
                      <span className='truncate text-sm'>{workspace.name}</span>
                      <span className='ml-auto shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-400 border border-blue-500/30 bg-blue-500/10'>
                        partagé
                      </span>
                    </label>
                  ))}
                </>
              )}

              {/* Own workspaces — after shared */}
              {filteredOwn.length > 0 && (
                <>
                  {filteredShared.length > 0 && (
                    <div className='my-2.5 flex items-center gap-2'>
                      <div className='h-px flex-1 bg-border' />
                      <span className='text-[10px] text-muted-foreground'>Mes workspaces</span>
                      <div className='h-px flex-1 bg-border' />
                    </div>
                  )}
                  {filteredOwn.map((workspace) => (
                    <label key={workspace.id} className='flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted'>
                      <Checkbox checked={selected.includes(workspace.id)} onCheckedChange={(checked) => toggleSelect(workspace.id, checked)} />
                      <Network className='h-4 w-4 shrink-0 text-muted-foreground' />
                      <span className='truncate text-sm'>{workspace.name}</span>
                    </label>
                  ))}
                </>
              )}

              {!hasAny && (
                <p className='p-3 text-sm text-muted-foreground'>
                  {filter.trim() ? 'Aucun workspace ne correspond.' : t('create.noWorkspaces')}
                </p>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => { reset(); onOpenChange(false); }}>{t('action.cancel')}</Button>
          <Button onClick={() => void submit()} disabled={!name.trim() || mutation.isPending}>
            {mutation.isPending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            {t('create.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
