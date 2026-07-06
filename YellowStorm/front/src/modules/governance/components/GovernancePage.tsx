import { useEffect, useState, type FormEvent } from 'react';
import { ChevronDown, ChevronLeft, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { parseApiError } from '@/lib/api-error';
import { showError } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { useCreateGovernanceProgram, useDeleteGovernanceProgram, useGovernancePrograms, useGovernanceUiStore } from '@/modules/governance';
import { GovernanceCockpit } from './GovernanceCockpit';
import { GovernanceScopeLifecycleShell } from './GovernanceScopeLifecycleShell';
import type { TabKey } from './GovernanceScopeWorkspace';
import { GovernanceScopeWizard } from './GovernanceScopeWizard';

export function GovernancePage(): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const { data: programs = [] } = useGovernancePrograms();
  const selectedProgramId = useGovernanceUiStore((state) => state.selectedProgramId);
  const setSelectedProgramId = useGovernanceUiStore((state) => state.setSelectedProgramId);
  const selectedScopeId = useGovernanceUiStore((state) => state.selectedScopeId);
  const setSelectedScopeId = useGovernanceUiStore((state) => state.setSelectedScopeId);
  const createProgram = useCreateGovernanceProgram();
  const deleteProgram = useDeleteGovernanceProgram();
  const [programDialogOpen, setProgramDialogOpen] = useState(false);
  const [scopeWizardOpen, setScopeWizardOpen] = useState(false);
  const [programName, setProgramName] = useState('');
  const [initialScopeTab, setInitialScopeTab] = useState<TabKey>('overview');

  useEffect(() => {
    if (!selectedProgramId && programs[0]) setSelectedProgramId(programs[0].id);
  }, [programs, selectedProgramId, setSelectedProgramId]);

  const selectedProgram = programs.find((program) => program.id === selectedProgramId);

  const handleCreateProgram = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = programName.trim();
    if (!name) return;
    createProgram.mutate({ name }, { onSuccess: (program) => { setProgramName(''); setProgramDialogOpen(false); setSelectedProgramId(program.id); setSelectedScopeId(null); } });
  };

  const handleSelectProgram = (programId: string) => {
    setSelectedProgramId(programId);
    setSelectedScopeId(null);
  };

  const handleSelectScope = (scopeId: string, tab: TabKey = 'overview') => {
    setInitialScopeTab(tab);
    setSelectedScopeId(scopeId);
  };

  const handleDeleteProgram = () => {
    if (!selectedProgramId) return;
    deleteProgram.mutate(selectedProgramId, {
      onSuccess: () => {
        const nextProgram = programs.find((program) => program.id !== selectedProgramId);
        setSelectedProgramId(nextProgram?.id ?? null);
        setSelectedScopeId(null);
      },
      onError: (error) => showError(t('programs.deleteError'), { description: parseApiError(error).message }),
    });
  };

  return (
    <main className='flex h-full w-full overflow-auto bg-background p-4 md:p-6'>
      <div className='mx-auto flex w-full max-w-7xl flex-col gap-5'>
        <header className='flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-3 shadow-sm'>
          <div className='flex items-center gap-2.5'>
            <span className='grid h-9 w-9 flex-none place-items-center rounded-xl bg-primary/10 text-primary'>
              <ShieldCheck className='h-5 w-5' />
            </span>
            <div>
              <h1 className='text-base font-semibold leading-tight'>{t('page.title')}</h1>
              <p className='text-xs text-muted-foreground'>{t('page.kicker')}</p>
            </div>
          </div>

          <div className='flex-1' />

          <Button type='button' variant='outline' size='sm' onClick={() => setProgramDialogOpen(true)}>{t('programs.create')}</Button>
          {selectedProgram && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type='button' variant='outline' size='sm' className='text-destructive hover:text-destructive' aria-label={t('programs.delete')}>
                  <Trash2 className='h-4 w-4' />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('programs.deleteConfirmTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>{t('programs.deleteConfirmBody', { name: selectedProgram.name })}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('scopeShell.settings.deleteCancel')}</AlertDialogCancel>
                  <AlertDialogAction className='bg-destructive text-destructive-foreground hover:bg-destructive/90' onClick={handleDeleteProgram} disabled={deleteProgram.isPending}>{t('programs.delete')}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type='button' className='inline-flex items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2 text-sm font-medium transition hover:bg-muted'>
                <span className='text-muted-foreground'>{t('programs.switcher')}</span>
                <span className='max-w-[220px] truncate'>{selectedProgram?.name ?? t('programs.empty')}</span>
                <ChevronDown className='h-4 w-4 text-muted-foreground' />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-64'>
              {programs.map((program) => (
                <DropdownMenuItem key={program.id} onSelect={() => handleSelectProgram(program.id)}>
                  {program.name}
                </DropdownMenuItem>
              ))}
              {programs.length === 0 && <p className='px-2 py-1.5 text-sm text-muted-foreground'>{t('programs.empty')}</p>}
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {selectedScopeId ? (
          <>
            <button type='button' onClick={() => setSelectedScopeId(null)} className='inline-flex w-fit items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-sm text-muted-foreground transition hover:text-foreground'>
              <ChevronLeft className='h-4 w-4' />{t('cockpit.back')}
            </button>
            <GovernanceScopeLifecycleShell programId={selectedProgramId} onCreateScope={() => setScopeWizardOpen(true)} initialTab={initialScopeTab} />
          </>
        ) : (
          <GovernanceCockpit programId={selectedProgramId} onSelectScope={handleSelectScope} />
        )}
      </div>

      <Dialog open={programDialogOpen} onOpenChange={setProgramDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('programs.create')}</DialogTitle>
          </DialogHeader>
          <form className='grid gap-3' onSubmit={handleCreateProgram}>
            <div className='grid gap-1.5'>
              <label className='text-sm font-medium' htmlFor='governance-program-name'>{t('programs.nameLabel')}</label>
              <Input id='governance-program-name' name='programName' autoFocus value={programName} onChange={(event) => setProgramName(event.target.value)} placeholder={t('programs.namePlaceholder')} />
            </div>
            <DialogFooter>
              <Button type='submit' disabled={createProgram.isPending}>{t('programs.create')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <GovernanceScopeWizard programId={selectedProgramId} open={scopeWizardOpen} onOpenChange={setScopeWizardOpen} onComplete={setSelectedScopeId} />
    </main>
  );
}
