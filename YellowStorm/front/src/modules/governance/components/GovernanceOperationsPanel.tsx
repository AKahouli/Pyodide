import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useModuleTranslation } from '@/modules/localization';
import {
  useCreateGovernanceDeployment,
  useCreateGovernanceDryRun,
  useCreateGovernanceMembership,
  useCreateGovernanceRevision,
  useDeleteGovernanceMembership,
  useGovernanceDeployments,
  useGovernanceDryRuns,
  useGovernanceMemberships,
  useGovernanceMetrics,
  useGovernanceReadiness,
  useGovernanceRevisions,
  useGovernanceUiStore,
  useMarkGovernanceDryRun,
  usePublishGovernanceDeployment,
  useSuspendGovernanceDeployment,
  type GovernanceScope,
} from '@/modules/governance';

interface Props {
  programId: string | null;
  scopes: GovernanceScope[];
}

const roles = ['program_admin', 'scope_admin', 'scope_editor', 'scope_reviewer', 'scope_viewer'] as const;

export function GovernanceOperationsPanel({ programId, scopes }: Readonly<Props>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const selectedDeploymentId = useGovernanceUiStore((state) => state.selectedDeploymentId);
  const setSelectedDeploymentId = useGovernanceUiStore((state) => state.setSelectedDeploymentId);
  const { data: memberships = [] } = useGovernanceMemberships(programId);
  const { data: deployments = [] } = useGovernanceDeployments(programId);
  const { data: revisions = [] } = useGovernanceRevisions(selectedDeploymentId);
  const { data: dryRuns = [] } = useGovernanceDryRuns(selectedDeploymentId);
  const { data: readiness } = useGovernanceReadiness(selectedDeploymentId);
  const { data: metrics = [] } = useGovernanceMetrics(programId);
  const createMembership = useCreateGovernanceMembership(programId);
  const deleteMembership = useDeleteGovernanceMembership(programId);
  const createDeployment = useCreateGovernanceDeployment(programId);
  const createRevision = useCreateGovernanceRevision(selectedDeploymentId);
  const createDryRun = useCreateGovernanceDryRun(selectedDeploymentId);
  const markDryRun = useMarkGovernanceDryRun(selectedDeploymentId);
  const publishDeployment = usePublishGovernanceDeployment(selectedDeploymentId);
  const suspendDeployment = useSuspendGovernanceDeployment(selectedDeploymentId);
  const [memberUserId, setMemberUserId] = useState('');
  const [memberScopeId, setMemberScopeId] = useState('');
  const [memberRole, setMemberRole] = useState<(typeof roles)[number]>('scope_viewer');
  const [deploymentName, setDeploymentName] = useState('');
  const [deploymentScopeId, setDeploymentScopeId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [workspaceIds, setWorkspaceIds] = useState('');
  const [dryRunInput, setDryRunInput] = useState('');

  useEffect(() => {
    if (!selectedDeploymentId && deployments[0]) setSelectedDeploymentId(deployments[0].id);
  }, [deployments, selectedDeploymentId, setSelectedDeploymentId]);

  const handleInvite = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!memberUserId.trim()) return;
    createMembership.mutate(
      { userId: memberUserId.trim(), scopeId: memberScopeId || undefined, role: memberRole, status: 'active' },
      { onSuccess: () => setMemberUserId('') },
    );
  };

  const handleCreateDeployment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!deploymentName.trim() || !deploymentScopeId) return;
    createDeployment.mutate(
      { name: deploymentName.trim(), scopeId: deploymentScopeId, channels: { widget: { enabled: true, status: 'not_configured', allowedOrigins: [] } } },
      { onSuccess: (deployment) => { setDeploymentName(''); setSelectedDeploymentId(deployment.id); } },
    );
  };

  const handleCreateRevision = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!agentId.trim()) return;
    const ids = workspaceIds.split(',').map((id) => id.trim()).filter(Boolean);
    createRevision.mutate({ agentId: agentId.trim(), workspaceIds: ids }, { onSuccess: () => setAgentId('') });
  };

  const handleDryRun = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dryRunInput.trim()) return;
    createDryRun.mutate({ input: dryRunInput.trim(), simulatedChannel: 'api' }, { onSuccess: () => setDryRunInput('') });
  };

  return (
    <div className='grid gap-4'>
      <section className='rounded-2xl border bg-card p-6 shadow-sm'>
        <h2 className='text-xl font-semibold'>{t('access.title')}</h2>
        <form className='mt-4 grid gap-3 md:grid-cols-4' onSubmit={handleInvite}>
          <Input id='governance-member-user-id' name='memberUserId' aria-label={t('access.userIdLabel')} value={memberUserId} onChange={(event) => setMemberUserId(event.target.value)} placeholder={t('access.userIdPlaceholder')} disabled={!programId} />
          <select id='governance-member-scope' name='memberScopeId' aria-label={t('access.scopeLabel')} className='h-10 rounded-md border bg-background px-3 text-sm' value={memberScopeId} onChange={(event) => setMemberScopeId(event.target.value)} disabled={!programId}>
            <option value=''>{t('access.programLevel')}</option>
            {scopes.map((scope) => <option key={scope.id} value={scope.id}>{scope.name}</option>)}
          </select>
          <select id='governance-member-role' name='memberRole' aria-label={t('access.roleLabel')} className='h-10 rounded-md border bg-background px-3 text-sm' value={memberRole} onChange={(event) => setMemberRole(event.target.value as (typeof roles)[number])} disabled={!programId}>
            {roles.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
          <Button type='submit' disabled={!programId || createMembership.isPending}>{t('access.invite')}</Button>
        </form>
        <div className='mt-4 grid gap-2 md:grid-cols-2'>
          {memberships.map((membership) => <div key={membership.id} className='rounded-lg border p-3'><div className='font-medium'>{membership.userId}</div><div className='text-xs text-muted-foreground'>{membership.role} · {membership.status}</div><Button className='mt-2' variant='outline' size='sm' onClick={() => deleteMembership.mutate(membership.id)}>{t('access.disable')}</Button></div>)}
          {memberships.length === 0 && <p className='text-sm text-muted-foreground'>{t('access.empty')}</p>}
        </div>
      </section>

      <section className='rounded-2xl border bg-card p-6 shadow-sm'>
        <h2 className='text-xl font-semibold'>{t('deployment.title')}</h2>
        <form className='mt-4 grid gap-3 md:grid-cols-3' onSubmit={handleCreateDeployment}>
          <Input id='governance-deployment-name' name='deploymentName' aria-label={t('deployment.nameLabel')} value={deploymentName} onChange={(event) => setDeploymentName(event.target.value)} placeholder={t('deployment.namePlaceholder')} disabled={!programId} />
          <select id='governance-deployment-scope' name='deploymentScopeId' aria-label={t('deployment.scopeLabel')} className='h-10 rounded-md border bg-background px-3 text-sm' value={deploymentScopeId} onChange={(event) => setDeploymentScopeId(event.target.value)} disabled={!programId}>
            <option value=''>{t('deployment.scopeLabel')}</option>
            {scopes.map((scope) => <option key={scope.id} value={scope.id}>{scope.name}</option>)}
          </select>
          <Button type='submit' disabled={!programId || createDeployment.isPending}>{t('deployment.create')}</Button>
        </form>
        <div className='mt-4 grid gap-2 md:grid-cols-2'>
          {deployments.map((deployment) => <button key={deployment.id} type='button' className='rounded-lg border p-3 text-left data-[selected=true]:border-primary' data-selected={deployment.id === selectedDeploymentId} onClick={() => setSelectedDeploymentId(deployment.id)}><div className='font-medium'>{deployment.name}</div><div className='text-xs text-muted-foreground'>{deployment.status} · {t('deployment.draft')}: {deployment.currentDraftRevisionId ?? '-'}</div><div className='text-xs text-muted-foreground'>{t('deployment.published')}: {deployment.currentPublishedRevisionId ?? '-'}</div></button>)}
          {deployments.length === 0 && <p className='text-sm text-muted-foreground'>{t('deployment.empty')}</p>}
        </div>
        <form className='mt-4 grid gap-3 md:grid-cols-3' onSubmit={handleCreateRevision}>
          <Input id='governance-revision-agent-id' name='agentId' aria-label={t('deployment.agentIdLabel')} value={agentId} onChange={(event) => setAgentId(event.target.value)} placeholder={t('deployment.agentIdPlaceholder')} disabled={!selectedDeploymentId} />
          <Input id='governance-revision-workspace-ids' name='workspaceIds' aria-label={t('deployment.workspaceIdsLabel')} value={workspaceIds} onChange={(event) => setWorkspaceIds(event.target.value)} placeholder={t('deployment.workspaceIdsPlaceholder')} disabled={!selectedDeploymentId} />
          <Button type='submit' disabled={!selectedDeploymentId || createRevision.isPending}>{t('deployment.createRevision')}</Button>
        </form>
        {revisions.map((revision) => <p key={revision.id} className='mt-2 text-sm text-muted-foreground'>#{revision.revisionNumber} · {revision.status} · {revision.agentId}</p>)}
      </section>

      <section className='grid gap-4 md:grid-cols-3'>
        <div className='rounded-2xl border bg-card p-6 shadow-sm'>
          <h2 className='text-xl font-semibold'>{t('dryRun.title')}</h2>
          <form className='mt-4 grid gap-3' onSubmit={handleDryRun}>
            <Input id='governance-dry-run-input' name='dryRunInput' aria-label={t('dryRun.inputLabel')} value={dryRunInput} onChange={(event) => setDryRunInput(event.target.value)} placeholder={t('dryRun.inputPlaceholder')} disabled={!selectedDeploymentId} />
            <Button type='submit' disabled={!selectedDeploymentId || createDryRun.isPending}>{t('dryRun.run')}</Button>
          </form>
          {dryRuns.map((dryRun) => <div key={dryRun.id} className='mt-3 rounded-lg border p-3'><div className='text-sm'>{dryRun.status}</div><div className='text-xs text-muted-foreground'>{dryRun.revisionId}</div><Button className='mt-2' variant='outline' size='sm' onClick={() => markDryRun.mutate({ dryRunId: dryRun.id, status: 'passed' })}>{t('dryRun.pass')}</Button></div>)}
          {dryRuns.length === 0 && <p className='mt-3 text-sm text-muted-foreground'>{t('dryRun.empty')}</p>}
        </div>
        <div className='rounded-2xl border bg-card p-6 shadow-sm'>
          <h2 className='text-xl font-semibold'>{t('publish.title')}</h2>
          {readiness ? <p className='mt-2 text-sm text-muted-foreground'>{t('publish.score')}: {readiness.score}</p> : <p className='mt-2 text-sm text-muted-foreground'>{t('publish.noDeployment')}</p>}
          {readiness?.checks.map((check) => <p key={check.key} className='mt-2 text-xs text-muted-foreground'>{check.label}: {check.status}</p>)}
          <div className='mt-4 flex gap-2'><Button disabled={!selectedDeploymentId || publishDeployment.isPending} onClick={() => publishDeployment.mutate()}>{t('publish.publish')}</Button><Button variant='outline' disabled={!selectedDeploymentId || suspendDeployment.isPending} onClick={() => suspendDeployment.mutate()}>{t('publish.suspend')}</Button></div>
        </div>
        <div className='rounded-2xl border bg-card p-6 shadow-sm'>
          <h2 className='text-xl font-semibold'>{t('monitor.title')}</h2>
          {metrics.map((metric) => <p key={metric.id} className='mt-2 text-sm text-muted-foreground'>{t('monitor.metric', { type: metric.type, value: metric.value })}</p>)}
          {metrics.length === 0 && <p className='mt-2 text-sm text-muted-foreground'>{t('monitor.empty')}</p>}
        </div>
      </section>
    </div>
  );
}
