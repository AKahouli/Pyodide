import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { parseApiError } from '@/lib/api-error';
import { showError } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { Workspace } from '@/modules/workspace';
import {
  useCreateGovernanceScope,
  useCreateGovernanceSource,
  useGovernanceScopeOverview,
  useGovernanceScopes,
  useUpdateGovernanceScope,
  type GovernanceScope,
} from '@/modules/governance';
import { GovernanceAgentSelector } from './GovernanceAgentSelector';
import { GovernanceWorkspaceSelector } from './GovernanceWorkspaceSelector';

const wizardSteps = ['blueprint', 'knowledge', 'agents', 'publish'] as const;
type WizardStep = (typeof wizardSteps)[number];

const scopeTypes: GovernanceScope['type'][] = ['municipality', 'organization', 'department', 'business_unit', 'country', 'team', 'custom'];

interface Props {
  programId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: (scopeId: string) => void;
}

export function GovernanceScopeWizard({ programId, open, onOpenChange, onComplete }: Readonly<Props>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const { data: scopes = [] } = useGovernanceScopes(programId);
  const [stepIndex, setStepIndex] = useState(0);
  const [scopeId, setScopeId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<GovernanceScope['type']>('municipality');
  const [parentScopeId, setParentScopeId] = useState('');
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<Workspace[]>([]);
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [isSavingStep, setIsSavingStep] = useState(false);

  const { data: overview } = useGovernanceScopeOverview(programId, scopeId);
  const createScope = useCreateGovernanceScope(programId);
  const createSource = useCreateGovernanceSource(programId);
  const updateScope = useUpdateGovernanceScope(programId, scopeId);

  useEffect(() => {
    if (open) {
      setStepIndex(0);
      setScopeId(null);
      setName('');
      setType('municipality');
      setParentScopeId('');
      setSelectedWorkspaces([]);
      setAgentIds([]);
      setIsSavingStep(false);
    }
  }, [open]);

  useEffect(() => {
    if (overview) setAgentIds(overview.scope.agentIds);
  }, [overview]);

  const step = wizardSteps[stepIndex];
  const knowledgeCount = overview ? overview.knowledge.sharedSources.length + overview.knowledge.localSources.length + overview.knowledge.workspaceMappings.length : 0;

  const canAdvance: Record<WizardStep, boolean> = {
    blueprint: name.trim().length > 0,
    knowledge: true,
    agents: true,
    publish: true,
  };

  const handleSelectWorkspace = (workspace: Workspace) => {
    setSelectedWorkspaces((current) => current.some((item) => item.id === workspace.id) ? current.filter((item) => item.id !== workspace.id) : [...current, workspace]);
  };

  const handleNext = async () => {
    if (step === 'blueprint') {
      if (scopeId) {
        setStepIndex((index) => index + 1);
        return;
      }
      createScope.mutate({ name: name.trim(), type, parentScopeId: parentScopeId || undefined }, { onSuccess: (scope) => { setScopeId(scope.id); setStepIndex((index) => index + 1); } });
      return;
    }
    if (step === 'knowledge' && scopeId && selectedWorkspaces.length > 0) {
      setIsSavingStep(true);
      const results = await Promise.allSettled(selectedWorkspaces.map(async (workspace) => {
        await createSource.mutateAsync({ title: workspace.name, visibility: 'scope_specific', sourceType: 'manual_record', scopeIds: [scopeId], workspaceId: workspace.id });
        return workspace.id;
      }));
      const savedIds = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
      const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      setSelectedWorkspaces((current) => current.filter((workspace) => !savedIds.includes(workspace.id)));
      setIsSavingStep(false);
      if (failed) {
        showError(t('wizard.knowledge.createError'), { description: parseApiError(failed.reason).message });
        return;
      }
      setStepIndex((index) => index + 1);
      return;
    }
    if (step === 'agents' && scopeId && agentIds.length > 0) {
      setIsSavingStep(true);
      try {
        await updateScope.mutateAsync({ agentIds });
      } catch (error) {
        showError(t('wizard.agents.saveError'), { description: parseApiError(error).message });
        return;
      } finally {
        setIsSavingStep(false);
      }
      setStepIndex((index) => index + 1);
      return;
    }
    setStepIndex((index) => index + 1);
  };

  const handleBack = () => setStepIndex((index) => Math.max(0, index - 1));

  const handleFinish = () => {
    if (!scopeId) return;
    onComplete(scopeId);
    onOpenChange(false);
  };

  const isPending = createScope.isPending || createSource.isPending || updateScope.isPending || isSavingStep;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[85vh] max-w-2xl overflow-y-auto'>
        <DialogHeader>
          <p className='text-xs font-semibold uppercase tracking-wide text-primary'>{t('wizard.kicker')}</p>
          <DialogTitle>{t('wizard.title')}</DialogTitle>
        </DialogHeader>

        <div className='flex items-center gap-1 overflow-x-auto py-1'>
          {wizardSteps.map((key, index) => (
            <div key={key} className='flex flex-none items-center gap-1'>
              <div className={cn('grid h-7 w-7 place-items-center rounded-full border text-xs font-semibold', index < stepIndex && 'border-emerald-500 bg-emerald-500 text-white', index === stepIndex && 'border-primary bg-primary text-primary-foreground', index > stepIndex && 'border-muted-foreground/30 text-muted-foreground')}>
                {index < stepIndex ? <Check className='h-3.5 w-3.5' /> : index + 1}
              </div>
              <span className={cn('text-xs font-medium', index === stepIndex ? 'text-foreground' : 'text-muted-foreground')}>{t(`wizard.steps.${key}`)}</span>
              {index < wizardSteps.length - 1 && <div className={cn('mx-1.5 h-px w-6', index < stepIndex ? 'bg-emerald-500' : 'bg-border')} />}
            </div>
          ))}
        </div>

        <div className='grid gap-4'>
          {step === 'blueprint' && (
            <div className='grid gap-3'>
              <div>
                <h3 className='text-base font-semibold'>{t('wizard.blueprint.title')}</h3>
                <p className='mt-1 text-sm text-muted-foreground'>{t('wizard.blueprint.description')}</p>
              </div>
              <div className='grid gap-1.5'>
                <label className='text-sm font-medium' htmlFor='wizard-scope-name'>{t('scopes.nameLabel')}</label>
                <Input id='wizard-scope-name' autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={t('scopes.namePlaceholder')} disabled={Boolean(scopeId)} />
              </div>
              <div className='grid gap-1.5'>
                <label className='text-sm font-medium' htmlFor='wizard-scope-type'>{t('wizard.blueprint.typeLabel')}</label>
                <select id='wizard-scope-type' className='h-10 rounded-md border bg-background px-3 text-sm' value={type} onChange={(event) => setType(event.target.value as GovernanceScope['type'])} disabled={Boolean(scopeId)}>
                  {scopeTypes.map((scopeType) => <option key={scopeType} value={scopeType}>{t(`scopeShell.scopeTypes.${scopeType}`)}</option>)}
                </select>
              </div>
              <div className='grid gap-1.5'>
                <label className='text-sm font-medium' htmlFor='wizard-scope-parent'>{t('wizard.blueprint.parentLabel')}</label>
                <select id='wizard-scope-parent' className='h-10 rounded-md border bg-background px-3 text-sm' value={parentScopeId} onChange={(event) => setParentScopeId(event.target.value)} disabled={Boolean(scopeId)}>
                  <option value=''>{t('wizard.blueprint.parentNone')}</option>
                  {scopes.map((scope) => <option key={scope.id} value={scope.id}>{scope.name}</option>)}
                </select>
              </div>
            </div>
          )}

          {step === 'knowledge' && (
            <div className='grid gap-3'>
              <div>
                <h3 className='text-base font-semibold'>{t('wizard.knowledge.title')}</h3>
                <p className='mt-1 text-sm text-muted-foreground'>{t('wizard.knowledge.description')}</p>
              </div>
              <GovernanceWorkspaceSelector selectedWorkspaceIds={selectedWorkspaces.map((workspace) => workspace.id)} onChange={handleSelectWorkspace} />
              <div className='rounded-xl border border-dashed p-3 text-sm text-muted-foreground'>
                {knowledgeCount > 0 ? t('wizard.knowledge.mappedCount', { count: knowledgeCount }) : t('wizard.knowledge.empty')}
              </div>
            </div>
          )}

          {step === 'agents' && (
            <div className='grid gap-3'>
              <div>
                <h3 className='text-base font-semibold'>{t('wizard.agents.title')}</h3>
                <p className='mt-1 text-sm text-muted-foreground'>{t('wizard.agents.description')}</p>
              </div>
              <GovernanceAgentSelector selectedAgentIds={agentIds} onChange={setAgentIds} />
            </div>
          )}

          {step === 'publish' && overview && (
            <div className='grid gap-3'>
              <div>
                <h3 className='text-base font-semibold'>{t('wizard.publish.title')}</h3>
                <p className='mt-1 text-sm text-muted-foreground'>{t('wizard.publish.description')}</p>
              </div>
              <div className='grid gap-2 rounded-xl border bg-background p-4 text-sm'>
                <div className='flex items-center justify-between'><span className='text-muted-foreground'>{t('scopeShell.overview.knowledge')}</span><span className='font-medium'>{knowledgeCount}</span></div>
                <div className='flex items-center justify-between'><span className='text-muted-foreground'>{t('scopeShell.overview.agents')}</span><span className='font-medium'>{overview.agents.mappedAgents.length}</span></div>
                <div className='flex items-center justify-between'><span className='text-muted-foreground'>{t('scopeShell.readiness.title')}</span><span className='font-medium'>{t('scopeShell.readiness.scoreValue', { score: overview.readiness.score })}</span></div>
              </div>
            </div>
          )}
        </div>

        <div className='flex items-center gap-3 border-t pt-4'>
          <Button type='button' variant='outline' onClick={handleBack} disabled={stepIndex === 0 || isPending} className={cn(stepIndex === 0 && 'invisible')}>{t('wizard.back')}</Button>
          <span className='flex-1' />
          <span className='text-xs text-muted-foreground'>{t('wizard.stepLabel', { current: stepIndex + 1, total: wizardSteps.length })}</span>
          {step === 'publish' ? (
            <Button type='button' onClick={handleFinish}>{t('wizard.finish')}</Button>
          ) : (
            <Button type='button' onClick={handleNext} disabled={!canAdvance[step] || isPending}>{t('wizard.next')}</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
