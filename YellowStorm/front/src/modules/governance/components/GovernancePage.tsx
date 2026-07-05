import { useEffect, useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { useCreateGovernanceProgram, useGovernancePrograms, useGovernanceUiStore } from '@/modules/governance';
import { GovernanceScopeLifecycleShell } from './GovernanceScopeLifecycleShell';

const lifecycleSteps = ['program', 'scopes', 'sources', 'access', 'deployment', 'dryRun', 'publish', 'monitor'] as const;

export function GovernancePage(): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const { data: programs = [] } = useGovernancePrograms();
  const selectedProgramId = useGovernanceUiStore((state) => state.selectedProgramId);
  const setSelectedProgramId = useGovernanceUiStore((state) => state.setSelectedProgramId);
  const setSelectedScopeId = useGovernanceUiStore((state) => state.setSelectedScopeId);
  const createProgram = useCreateGovernanceProgram();
  const [programName, setProgramName] = useState('');

  useEffect(() => {
    if (!selectedProgramId && programs[0]) setSelectedProgramId(programs[0].id);
  }, [programs, selectedProgramId, setSelectedProgramId]);

  const handleCreateProgram = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = programName.trim();
    if (!name) return;
    createProgram.mutate({ name }, { onSuccess: (program) => { setProgramName(''); setSelectedProgramId(program.id); setSelectedScopeId(null); } });
  };

  const handleSelectProgram = (programId: string) => {
    setSelectedProgramId(programId);
    setSelectedScopeId(null);
  };

  return (
    <main className='flex h-full w-full overflow-auto bg-background p-4 md:p-6'>
      <div className='mx-auto flex w-full max-w-7xl flex-col gap-5'>
        <header className='overflow-hidden rounded-3xl border bg-card shadow-sm'>
          <div className='grid gap-6 p-6 lg:grid-cols-[1fr_360px]'>
            <div className='flex items-start gap-4'>
              <div className='rounded-2xl bg-primary/10 p-3 text-primary'>
                <ShieldCheck className='h-7 w-7' />
              </div>
              <div>
                <p className='text-sm font-medium text-primary'>{t('page.kicker')}</p>
                <h1 className='mt-1 text-3xl font-semibold tracking-tight'>{t('page.title')}</h1>
                <p className='mt-3 max-w-3xl text-sm leading-6 text-muted-foreground'>{t('page.description')}</p>
              </div>
            </div>
            <form className='grid content-start gap-3' onSubmit={handleCreateProgram}>
              <label className='text-sm font-medium' htmlFor='governance-program-name'>{t('programs.nameLabel')}</label>
              <div className='flex gap-2'>
                <Input id='governance-program-name' name='programName' aria-label={t('programs.nameLabel')} value={programName} onChange={(event) => setProgramName(event.target.value)} placeholder={t('programs.namePlaceholder')} />
                <Button type='submit' disabled={createProgram.isPending}>{t('programs.create')}</Button>
              </div>
            </form>
          </div>
          <div className='flex gap-2 overflow-x-auto border-t bg-muted/20 p-3'>
            {programs.map((program) => (
              <button key={program.id} type='button' className={cn('rounded-full border bg-background px-4 py-2 text-sm transition hover:bg-muted', selectedProgramId === program.id && 'border-primary bg-primary text-primary-foreground hover:bg-primary')} onClick={() => handleSelectProgram(program.id)}>
                {program.name}
              </button>
            ))}
            {programs.length === 0 && <p className='px-2 py-1 text-sm text-muted-foreground'>{t('programs.empty')}</p>}
          </div>
        </header>

        <section className='grid gap-3 md:grid-cols-4 xl:grid-cols-8'>
          {lifecycleSteps.map((stepKey, index) => (
            <article key={stepKey} className='rounded-2xl border bg-card p-3 shadow-sm'>
              <div className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{t('steps.stepNumber', { number: index + 1 })}</div>
              <h2 className='mt-2 text-sm font-semibold'>{t(`steps.${stepKey}.title`)}</h2>
            </article>
          ))}
        </section>

        <GovernanceScopeLifecycleShell programId={selectedProgramId} />
      </div>
    </main>
  );
}
