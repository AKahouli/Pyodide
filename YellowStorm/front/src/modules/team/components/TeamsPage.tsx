import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Plus, Pencil, Trash2, Users, Share2, LogOut, Network } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useModuleTranslation } from '@/modules/localization';
import { useTeamStore, useTeams, useTeamsLoading, useTeamsInitialized } from '../store';
import { CreateEditTeamDialog } from './CreateEditTeamDialog';
import { ShareTeamDialog } from './ShareTeamDialog';
import type { Team } from '../types';

export function TeamsPage() {
  const { t } = useModuleTranslation('team');
  const navigate = useNavigate();
  const teams = useTeams();
  const isLoading = useTeamsLoading();
  const isInitialized = useTeamsInitialized();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [deletingTeam, setDeletingTeam] = useState<Team | null>(null);
  const [sharingTeam, setSharingTeam] = useState<Team | null>(null);

  useEffect(() => {
    useTeamStore.getState().fetchTeams();
  }, []);

  const openCreate = () => {
    setEditingTeam(null);
    setDialogOpen(true);
  };

  const openEdit = (team: Team) => {
    setEditingTeam(team);
    setDialogOpen(true);
  };

  const handleSubmit = async (data: { name: string; description: string; agentIds: string[] }) => {
    if (editingTeam) {
      await useTeamStore.getState().updateTeam(editingTeam.id, data);
    } else {
      await useTeamStore.getState().createTeam(data);
    }
  };

  const handleDelete = async () => {
    if (!deletingTeam) return;
    await useTeamStore.getState().deleteTeam(deletingTeam.id);
    setDeletingTeam(null);
  };

  const handleUnshare = async (team: Team) => {
    await useTeamStore.getState().unshareTeam(team.id);
  };

  const showSpinner = isLoading && !isInitialized;

  return (
    <div className='mx-auto w-full max-w-5xl p-6'>
      <div className='mb-6 flex items-center justify-between'>
        <div>
          <h1 className='flex items-center gap-2 text-2xl font-semibold'>
            <Users className='size-6' /> {t('page.title')}
          </h1>
          <p className='text-sm text-muted-foreground'>
            {t('page.subtitle')}
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className='mr-2 size-4' /> {t('page.newTeam')}
        </Button>
      </div>

      {showSpinner ? (
        <div className='flex justify-center py-16'>
          <Loader2 className='size-6 animate-spin text-muted-foreground' />
        </div>
      ) : teams.length === 0 ? (
        <div className='rounded-lg border border-dashed py-16 text-center'>
          <Users className='mx-auto mb-3 size-8 text-muted-foreground' />
          <p className='text-sm text-muted-foreground'>{t('page.emptyState')}</p>
          <Button variant='outline' className='mt-4' onClick={openCreate}>
            <Plus className='mr-2 size-4' /> {t('page.createFirst')}
          </Button>
        </div>
      ) : (
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          {teams.map((team) => (
            <div key={team.id} className='flex flex-col rounded-lg border bg-card p-4 shadow-sm'>
              <div className='mb-2 flex items-start justify-between gap-2'>
                <button
                  type='button'
                  onClick={() => navigate(`/teams/${team.id}`)}
                  className='truncate text-left font-medium hover:underline'
                  title={t('card.openOrgChart')}>
                  {team.name}
                </button>
                <Badge variant='secondary' className='shrink-0'>
                  {team.agentCount === 1
                    ? t('card.agentCount.one', { count: team.agentCount })
                    : t('card.agentCount.other', { count: team.agentCount })}
                </Badge>
              </div>
              {team.shareInfo && (
                <Badge variant='outline' className='mb-2 w-fit text-[10px]'>
                  {t('card.sharedBy', {
                    name: team.shareInfo.sharedBy.firstName || team.shareInfo.sharedBy.email,
                  })}
                </Badge>
              )}
              <p className='mb-4 line-clamp-2 flex-1 text-sm text-muted-foreground'>
                {team.description || t('card.noDescription')}
              </p>
              <div className='flex justify-end gap-1'>
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={() => navigate(`/teams/${team.id}`)}
                  aria-label={t('card.openOrgChart')}>
                  <Network className='size-4' />
                </Button>
                {team.shareInfo ? (
                  <Button
                    variant='ghost'
                    size='icon'
                    onClick={() => handleUnshare(team)}
                    aria-label={t('card.removeShared')}>
                    <LogOut className='size-4' />
                  </Button>
                ) : (
                  <>
                    <Button
                      variant='ghost'
                      size='icon'
                      onClick={() => setSharingTeam(team)}
                      aria-label={t('card.shareTeam')}>
                      <Share2 className='size-4' />
                    </Button>
                    <Button variant='ghost' size='icon' onClick={() => openEdit(team)} aria-label={t('card.edit')}>
                      <Pencil className='size-4' />
                    </Button>
                    <Button
                      variant='ghost'
                      size='icon'
                      className='text-destructive hover:text-destructive'
                      onClick={() => setDeletingTeam(team)}
                      aria-label={t('card.delete')}>
                      <Trash2 className='size-4' />
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateEditTeamDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        team={editingTeam}
        onSubmit={handleSubmit}
      />

      {sharingTeam && (
        <ShareTeamDialog
          open={Boolean(sharingTeam)}
          onOpenChange={(o) => !o && setSharingTeam(null)}
          team={sharingTeam}
        />
      )}

      <AlertDialog open={Boolean(deletingTeam)} onOpenChange={(o) => !o && setDeletingTeam(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('page.deleteDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('page.deleteDialog.description', { name: deletingTeam?.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('page.deleteDialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'>
              {t('page.deleteDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
