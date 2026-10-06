import { useEffect, useMemo, useState } from 'react';
import { Loader2, Network, Search, Share2, Warehouse } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { showError } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { getSharedWorkspaces, getWorkspaces } from '@/modules/workspace/api';
import type { SharedWorkspaceResponse, Workspace } from '@/modules/workspace/types';
import { useCreateSemanticModel } from '../../query/hooks';
import { FormField, INPUT, INPUT_COMPACT, SectionHeader, TEXTAREA } from '../form/FormParts';

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
      getSharedWorkspaces({ limit: 100 }).catch(() => ({ workspaces: [] })),
    ]).then(([own, shared]) => {
      const ownIds = new Set(own.workspaces.map((w) => w.id));
      const filteredShared = shared.workspaces.filter((w) => !ownIds.has(w.id));
      setOwnWorkspaces(own.workspaces);
      setSharedWorkspaces(filteredShared);
    }).catch(() => { setOwnWorkspaces([]); setSharedWorkspaces([]); });
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
        <div className='space-y-6 py-2'>
          <div className='space-y-4'>
            <FormField label={t('create.name')} htmlFor='semantic-model-name'>
              <Input id='semantic-model-name' className={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('create.namePlaceholder')} autoFocus />
            </FormField>
            <FormField label={t('create.summary')} htmlFor='semantic-model-description'>
              <Textarea id='semantic-model-description' className={TEXTAREA} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('create.summaryPlaceholder')} />
            </FormField>
          </div>
          <section className='space-y-3'>
            <SectionHeader title={t('create.workspaces')} help={t('create.workspacesHelp')} count={selected.length || undefined} />
            <div className='relative'>
              <Search className='absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground' />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t('create.filterWorkspaces')}
                className={`${INPUT_COMPACT} pl-8`}
              />
            </div>
            <div className='max-h-52 overflow-y-auto rounded-lg border p-1'>
              {/* Shared workspaces first */}
              {filteredShared.length > 0 && (
                <>
                  <p className='flex items-center gap-1.5 px-2 pb-1 pt-1.5 text-[11px] font-medium text-muted-foreground'>
                    <Share2 className='h-3 w-3' />{t('knowledge.sharedWithMe')}
                    <span className='rounded-full bg-muted px-1.5 tabular-nums'>{filteredShared.length}</span>
                  </p>
                  {filteredShared.map((workspace) => (
                    <label key={workspace.id} className='flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted'>
                      <Checkbox checked={selected.includes(workspace.id)} onCheckedChange={(checked) => toggleSelect(workspace.id, checked)} />
                      <Warehouse className='h-4 w-4 shrink-0 text-blue-500 dark:text-blue-400' />
                      <span className='truncate text-sm'>{workspace.name}</span>
                      <span className='ml-auto shrink-0 rounded border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400'>
                        {t('knowledge.sharedBadge')}
                      </span>
                    </label>
                  ))}
                </>
              )}

              {/* Own workspaces after shared */}
              {filteredOwn.length > 0 && (
                <>
                  {filteredShared.length > 0 && (
                    <p className='px-2 pb-1 pt-2.5 text-[11px] font-medium text-muted-foreground'>{t('create.ownWorkspaces')}</p>
                  )}
                  {filteredOwn.map((workspace) => (
                    <label key={workspace.id} className='flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted'>
                      <Checkbox checked={selected.includes(workspace.id)} onCheckedChange={(checked) => toggleSelect(workspace.id, checked)} />
                      <Network className='h-4 w-4 shrink-0 text-muted-foreground' />
                      <span className='truncate text-sm'>{workspace.name}</span>
                    </label>
                  ))}
                </>
              )}

              {!hasAny && (
                <p className='p-3 text-sm text-muted-foreground'>
                  {filter.trim() ? t('create.noMatchingWorkspaces') : t('create.noWorkspaces')}
                </p>
              )}
            </div>
          </section>
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
