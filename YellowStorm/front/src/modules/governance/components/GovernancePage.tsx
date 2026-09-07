import { useEffect, useState, type FormEvent } from 'react';
import { AlertCircle, ChevronDown, ChevronLeft, Copy, Loader2, MoreHorizontal, Pencil, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { parseApiError } from '@/lib/api-error';
import { showError } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { useCreateGovernanceProgram, useCreateGovernanceScope, useDeleteGovernanceProgram, useGovernancePrograms, useGovernanceUiStore, useUpdateGovernanceProgram } from '@/modules/governance';
import { createGovernanceProgramClonePayload } from '../clone-payloads';
import { GovernanceCockpit } from './GovernanceCockpit';
import { GovernanceScopeLifecycleShell } from './GovernanceScopeLifecycleShell';
import type { TabKey } from './GovernanceScopeWorkspace';

export function GovernancePage(): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const programsQuery = useGovernancePrograms();
  const { data: programs = [], isLoading: programsLoading, isError: programsError, isSuccess: programsLoaded, isFetching: programsFetching, refetch: refetchPrograms } = programsQuery;
  const selectedProgramId = useGovernanceUiStore((state) => state.selectedProgramId);
  const setSelectedProgramId = useGovernanceUiStore((state) => state.setSelectedProgramId);
  const selectedScopeId = useGovernanceUiStore((state) => state.selectedScopeId);
  const setSelectedScopeId = useGovernanceUiStore((state) => state.setSelectedScopeId);
  const createProgram = useCreateGovernanceProgram();
  const deleteProgram = useDeleteGovernanceProgram();
  const [programDialogOpen, setProgramDialogOpen] = useState(false);
  const [programName, setProgramName] = useState('');
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameProgramName, setRenameProgramName] = useState('');
  const [scopeDialogOpen, setScopeDialogOpen] = useState(false);
  const [scopeName, setScopeName] = useState('');
  const [initialScopeTab, setInitialScopeTab] = useState<TabKey>('overview');
  const createScope = useCreateGovernanceScope(selectedProgramId);

  useEffect(() => {
    if (!programsLoaded) return;
    if (programs.length === 0) {
      if (selectedProgramId) {
        setSelectedProgramId(null);
        setSelectedScopeId(null);
      }
      return;
    }
    if (!selectedProgramId || !programs.some((program) => program.id === selectedProgramId)) {
      setSelectedProgramId(programs[0].id);
      setSelectedScopeId(null);
    }
  }, [programs, programsLoaded, selectedProgramId, setSelectedProgramId, setSelectedScopeId]);

  const selectedProgram = programs.find((program) => program.id === selectedProgramId);
  const updateProgram = useUpdateGovernanceProgram(selectedProgramId);

  const handleCreateProgram = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = programName.trim();
    if (!name) return;
    createProgram.mutate(
      { name },
      {
        onSuccess: (program) => { setProgramName(''); setProgramDialogOpen(false); setSelectedProgramId(program.id); setSelectedScopeId(null); },
        onError: (error) => showError(t('programs.createError'), { description: parseApiError(error).message }),
      },
    );
  };

  const openRenameDialog = () => {
    if (!selectedProgram) return;
    setRenameProgramName(selectedProgram.name);
    setRenameDialogOpen(true);
  };

  const handleRenameProgram = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = renameProgramName.trim();
    if (!name || name === selectedProgram?.name) return;
    updateProgram.mutate(
      { name },
      {
        onSuccess: () => setRenameDialogOpen(false),
        onError: (error) => showError(t('programs.renameError'), { description: parseApiError(error).message }),
      },
    );
  };

  const handleSelectProgram = (programId: string) => {
    setSelectedProgramId(programId);
    setSelectedScopeId(null);
  };

  const handleSelectScope = (scopeId: string, tab: TabKey = 'overview') => {
    setInitialScopeTab(tab);
    setSelectedScopeId(scopeId);
  };

  const handleCreateScope = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedProgramId) return;
    const name = scopeName.trim();
    if (!name) return;
    createScope.mutate(
      { name, type: 'municipality' },
      {
        onSuccess: (scope) => {
          setScopeName('');
          setScopeDialogOpen(false);
          handleSelectScope(scope.id, 'overview');
        },
        onError: (error) => showError(t('scopes.createError'), { description: parseApiError(error).message }),
      },
    );
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

  const handleCloneProgram = () => {
    if (!selectedProgram) return;
    createProgram.mutate(
      createGovernanceProgramClonePayload(selectedProgram, t('programs.copySuffix')),
      {
        onSuccess: (program) => {
          setSelectedProgramId(program.id);
          setSelectedScopeId(null);
        },
        onError: (error) => showError(t('programs.cloneError'), { description: parseApiError(error).message }),
      },
    );
  };

  return (
    <div className='flex h-full w-full overflow-auto bg-background p-4 md:p-6'>
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

          {!programsLoading && !programsError && <ProgramActionsMenu createLabel={t('programs.create')} renameLabel={t('programs.rename')} cloneLabel={t('programs.clone')} deleteLabel={t('programs.delete')} deleteConfirmTitle={t('programs.deleteConfirmTitle')} deleteConfirmBody={selectedProgram ? t('programs.deleteConfirmBody', { name: selectedProgram.name }) : ''} deleteCancel={t('scopeShell.settings.deleteCancel')} actionsLabel={t('programs.actions')} hasSelectedProgram={Boolean(selectedProgram)} isCloning={createProgram.isPending} isDeleting={deleteProgram.isPending} onCreate={() => setProgramDialogOpen(true)} onRename={openRenameDialog} onClone={handleCloneProgram} onDelete={handleDeleteProgram} />}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type='button' disabled={programsLoading || programsError} className='inline-flex min-h-11 items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2 text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-0'>
                <span className='text-muted-foreground'>{t('programs.switcher')}</span>
                <span className='max-w-[220px] truncate'>{selectedProgram?.name ?? t('programs.empty')}</span>
                <ChevronDown className='h-4 w-4 text-muted-foreground' />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-64'>
              {programs.map((program) => (
                <DropdownMenuItem key={program.id} className='min-h-11 sm:min-h-0' onSelect={() => handleSelectProgram(program.id)}>
                  {program.name}
                </DropdownMenuItem>
              ))}
              {programs.length === 0 && <p className='px-2 py-1.5 text-sm text-muted-foreground'>{t('programs.empty')}</p>}
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {programsLoading ? (
          <div className='flex min-h-72 items-center justify-center gap-3 text-sm text-muted-foreground' role='status'>
            <Loader2 className='h-5 w-5 animate-spin' />
            {t('page.loading')}
          </div>
        ) : programsError ? (
          <div className='flex min-h-72 flex-col items-center justify-center rounded-2xl border bg-card p-8 text-center' role='alert'>
            <AlertCircle className='h-8 w-8 text-destructive' />
            <h2 className='mt-4 text-lg font-semibold'>{t('page.error.title')}</h2>
            <p className='mt-1 max-w-md text-sm leading-6 text-muted-foreground'>{t('page.error.description')}</p>
            <Button className='mt-5' variant='outline' disabled={programsFetching} onClick={() => void refetchPrograms()}>
              <RefreshCw className='mr-2 h-4 w-4' />
              {programsFetching ? t('page.error.retrying') : t('page.error.retry')}
            </Button>
          </div>
        ) : programs.length === 0 ? (
          <div className='flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed bg-card p-8 text-center'>
            <ShieldCheck className='h-8 w-8 text-primary' />
            <h2 className='mt-4 text-lg font-semibold'>{t('page.emptyPrograms.title')}</h2>
            <p className='mt-1 max-w-md text-sm leading-6 text-muted-foreground'>{t('page.emptyPrograms.description')}</p>
            <Button className='mt-5' onClick={() => setProgramDialogOpen(true)}>
              <Plus className='mr-2 h-4 w-4' />
              {t('programs.create')}
            </Button>
          </div>
        ) : selectedScopeId ? (
          <>
            <button type='button' onClick={() => setSelectedScopeId(null)} className='inline-flex min-h-11 w-fit items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-sm text-muted-foreground transition hover:text-foreground sm:min-h-0'>
              <ChevronLeft className='h-4 w-4' />{t('cockpit.back')}
            </button>
            <GovernanceScopeLifecycleShell programId={selectedProgramId} initialTab={initialScopeTab} onActiveTabChange={setInitialScopeTab} />
          </>
        ) : selectedProgram ? (
          <GovernanceCockpit programId={selectedProgramId} onSelectScope={handleSelectScope} onCreateScope={() => setScopeDialogOpen(true)} />
        ) : null}
      </div>

      <Dialog open={programDialogOpen} onOpenChange={setProgramDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('programs.create')}</DialogTitle>
            <DialogDescription>{t('programs.createDescription')}</DialogDescription>
          </DialogHeader>
          <form className='grid gap-3' onSubmit={handleCreateProgram}>
            <div className='grid gap-1.5'>
              <label className='text-sm font-medium' htmlFor='governance-program-name'>{t('programs.nameLabel')}</label>
              <Input id='governance-program-name' name='programName' autoFocus value={programName} onChange={(event) => setProgramName(event.target.value)} placeholder={t('programs.namePlaceholder')} />
            </div>
            <DialogFooter>
              <Button type='submit' className='min-h-11 sm:min-h-0' disabled={!programName.trim() || createProgram.isPending}>{t('programs.create')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('programs.rename')}</DialogTitle>
            <DialogDescription>{t('programs.renameDescription')}</DialogDescription>
          </DialogHeader>
          <form className='grid gap-3' onSubmit={handleRenameProgram}>
            <div className='grid gap-1.5'>
              <label className='text-sm font-medium' htmlFor='governance-program-rename'>{t('programs.nameLabel')}</label>
              <Input id='governance-program-rename' name='renameProgramName' autoFocus value={renameProgramName} onChange={(event) => setRenameProgramName(event.target.value)} placeholder={t('programs.namePlaceholder')} />
            </div>
            <DialogFooter>
              <Button type='submit' className='min-h-11 sm:min-h-0' disabled={!renameProgramName.trim() || renameProgramName.trim() === selectedProgram?.name || updateProgram.isPending}>{t('programs.rename')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={scopeDialogOpen} onOpenChange={setScopeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('scopes.create')}</DialogTitle>
            <DialogDescription>{t('scopes.createDescription')}</DialogDescription>
          </DialogHeader>
          <form className='grid gap-3' onSubmit={handleCreateScope}>
            <div className='grid gap-1.5'>
              <label className='text-sm font-medium' htmlFor='governance-scope-name'>{t('scopes.nameLabel')}</label>
              <Input id='governance-scope-name' name='scopeName' autoFocus value={scopeName} onChange={(event) => setScopeName(event.target.value)} placeholder={t('scopes.namePlaceholder')} />
            </div>
            <DialogFooter>
              <Button type='submit' className='min-h-11 sm:min-h-0' disabled={!scopeName.trim() || createScope.isPending}>{t('scopes.create')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProgramActionsMenu({ createLabel, renameLabel, cloneLabel, deleteLabel, deleteConfirmTitle, deleteConfirmBody, deleteCancel, actionsLabel, hasSelectedProgram, isCloning, isDeleting, onCreate, onRename, onClone, onDelete }: Readonly<{ createLabel: string; renameLabel: string; cloneLabel: string; deleteLabel: string; deleteConfirmTitle: string; deleteConfirmBody: string; deleteCancel: string; actionsLabel: string; hasSelectedProgram: boolean; isCloning: boolean; isDeleting: boolean; onCreate: () => void; onRename: () => void; onClone: () => void; onDelete: () => void }>): JSX.Element {
  return (
    <AlertDialog>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type='button' variant='outline' size='icon' className='h-11 w-11 sm:h-9 sm:w-9' aria-label={actionsLabel}>
            <MoreHorizontal className='h-4 w-4' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuItem className='min-h-11 sm:min-h-0' onSelect={onCreate}>
            <Plus className='h-4 w-4' />{createLabel}
          </DropdownMenuItem>
          {hasSelectedProgram && (
            <>
              <DropdownMenuItem className='min-h-11 sm:min-h-0' onSelect={onRename}>
                <Pencil className='h-4 w-4' />{renameLabel}
              </DropdownMenuItem>
              <DropdownMenuItem className='min-h-11 sm:min-h-0' onSelect={onClone} disabled={isCloning}>
                <Copy className='h-4 w-4' />{cloneLabel}
              </DropdownMenuItem>
              <AlertDialogTrigger asChild>
                <DropdownMenuItem className='min-h-11 text-destructive focus:text-destructive sm:min-h-0' onSelect={(event) => event.preventDefault()}>
                  <Trash2 className='h-4 w-4' />{deleteLabel}
                </DropdownMenuItem>
              </AlertDialogTrigger>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{deleteConfirmTitle}</AlertDialogTitle>
          <AlertDialogDescription>{deleteConfirmBody}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{deleteCancel}</AlertDialogCancel>
          <AlertDialogAction className='bg-destructive text-destructive-foreground hover:bg-destructive/90' onClick={onDelete} disabled={isDeleting}>{deleteLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
