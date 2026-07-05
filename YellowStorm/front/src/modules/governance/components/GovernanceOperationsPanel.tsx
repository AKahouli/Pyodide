import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useModuleTranslation } from '@/modules/localization';
import { useCreateGovernanceMembership, useDeleteGovernanceMembership, useGovernanceMemberships, type GovernanceScope } from '@/modules/governance';

interface Props {
  programId: string | null;
  scopes: GovernanceScope[];
}

const roles = ['program_admin', 'scope_admin', 'scope_editor', 'scope_reviewer', 'scope_viewer'] as const;

export function GovernanceOperationsPanel({ programId, scopes }: Readonly<Props>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const { data: memberships = [] } = useGovernanceMemberships(programId);
  const createMembership = useCreateGovernanceMembership(programId);
  const deleteMembership = useDeleteGovernanceMembership(programId);
  const [memberUserId, setMemberUserId] = useState('');
  const [memberScopeId, setMemberScopeId] = useState('');
  const [memberRole, setMemberRole] = useState<(typeof roles)[number]>('scope_viewer');

  const handleInvite = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!memberUserId.trim()) return;
    createMembership.mutate(
      { userId: memberUserId.trim(), scopeId: memberScopeId || undefined, role: memberRole, status: 'active' },
      { onSuccess: () => setMemberUserId('') },
    );
  };

  return (
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
  );
}
