import { useEffect, useState } from 'react';
import { Loader2, Plus, Pencil, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useModuleTranslation } from '@/modules/localization';
import { useGroupsStore, useGroups, useGroupsLoading, useGroupsInitialized } from '../store';
import { CreateEditGroupDialog } from './CreateEditGroupDialog';
import type { UserGroup } from '../types';

export function GroupsPage() {
  const { t } = useModuleTranslation('groups');
  const groups = useGroups();
  const isLoading = useGroupsLoading();
  const isInitialized = useGroupsInitialized();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<UserGroup | null>(null);
  const [deleting, setDeleting] = useState<UserGroup | null>(null);

  useEffect(() => {
    useGroupsStore.getState().fetchGroups().catch(() => {});
  }, []);

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (g: UserGroup) => { setEditing(g); setDialogOpen(true); };
  const handleDelete = async () => {
    if (!deleting) return;
    await useGroupsStore.getState().deleteGroup(deleting.id);
    setDeleting(null);
  };

  const showSpinner = isLoading && !isInitialized;

  return (
    <div className='mx-auto w-full max-w-5xl p-6'>
      <div className='mb-6 flex items-center justify-between'>
        <div>
          <h1 className='flex items-center gap-2 text-2xl font-semibold'>
            <Users className='size-6' /> {t('page.title')}
          </h1>
          <p className='text-sm text-muted-foreground'>{t('page.subtitle')}</p>
        </div>
        <Button onClick={openCreate}><Plus className='mr-2 size-4' /> {t('page.newGroup')}</Button>
      </div>

      {showSpinner ? (
        <div className='flex justify-center py-16'><Loader2 className='size-6 animate-spin text-muted-foreground' /></div>
      ) : groups.length === 0 ? (
        <div className='rounded-lg border border-dashed py-16 text-center'>
          <Users className='mx-auto mb-3 size-8 text-muted-foreground' />
          <p className='text-sm text-muted-foreground'>{t('page.emptyState')}</p>
          <Button variant='outline' className='mt-4' onClick={openCreate}>
            <Plus className='mr-2 size-4' /> {t('page.createFirst')}
          </Button>
        </div>
      ) : (
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          {groups.map((g) => (
            <div key={g.id} className='flex flex-col rounded-lg border bg-card p-4 shadow-sm'>
              <div className='mb-2 flex items-start justify-between gap-2'>
                <button type='button' onClick={() => openEdit(g)} className='truncate text-left font-medium hover:underline'>
                  {g.name}
                </button>
                <Badge variant='secondary' className='shrink-0'>
                  {g.memberCount === 1
                    ? t('page.memberCount_one', { count: g.memberCount })
                    : t('page.memberCount_other', { count: g.memberCount })}
                </Badge>
              </div>
              <p className='mb-4 line-clamp-2 flex-1 text-sm text-muted-foreground'>
                {g.description || t('page.noDescription')}
              </p>
              <div className='flex justify-end gap-1'>
                <Button variant='ghost' size='icon' onClick={() => openEdit(g)} aria-label={t('dialog.editTitle')}>
                  <Pencil className='size-4' />
                </Button>
                <Button variant='ghost' size='icon' className='text-destructive hover:text-destructive' onClick={() => setDeleting(g)} aria-label={t('page.deleteDialog.confirm')}>
                  <Trash2 className='size-4' />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateEditGroupDialog open={dialogOpen} onOpenChange={setDialogOpen} group={editing} />

      <AlertDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('page.deleteDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('page.deleteDialog.description', { name: deleting?.name })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('page.deleteDialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className='bg-destructive text-destructive-foreground hover:bg-destructive/90'>
              {t('page.deleteDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
