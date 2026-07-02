import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useModuleTranslation } from '@/modules/localization';
import { useGroups, useGroupsStore, type UserGroup } from '@/modules/groups';
import type { WorkspacePermission } from '../../types';

/**
 * Expand a group into pending-share entries, dropping the workspace owner and
 * any email already pending. Emails are lowercased so dedup is case-insensitive.
 * Pure + exported for testing.
 */
export function expandGroupToPending(
  group: UserGroup,
  permission: WorkspacePermission,
  existingEmails: string[],
  ownerEmail: string,
): { email: string; permission: WorkspacePermission }[] {
  const taken = new Set(existingEmails.map((e) => e.toLowerCase()));
  taken.add(ownerEmail.toLowerCase());
  const out: { email: string; permission: WorkspacePermission }[] = [];
  for (const m of group.members) {
    const email = m.email.toLowerCase().trim();
    if (!email || taken.has(email)) continue;
    taken.add(email);
    out.push({ email, permission });
  }
  return out;
}

interface GroupShareSelectorProps {
  existingEmails: string[];
  ownerEmail: string;
  onExpand: (shares: { email: string; permission: WorkspacePermission }[]) => void;
  disabled?: boolean;
}

export function GroupShareSelector({ existingEmails, ownerEmail, onExpand, disabled }: Readonly<GroupShareSelectorProps>) {
  const { t } = useModuleTranslation('workspace');
  const groups = useGroups();
  const [groupId, setGroupId] = useState('');
  const [permission, setPermission] = useState<WorkspacePermission>('read');

  useEffect(() => {
    useGroupsStore.getState().fetchGroups().catch(() => {});
  }, []);

  if (groups.length === 0) return null;

  const handleAdd = () => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    onExpand(expandGroupToPending(group, permission, existingEmails, ownerEmail));
    setGroupId('');
  };

  return (
    <div className='flex items-end gap-2 rounded-md border bg-muted/30 p-2'>
      <Users className='mt-2 h-4 w-4 shrink-0 text-muted-foreground' />
      <div className='flex-1'>
        <Select value={groupId} onValueChange={setGroupId} disabled={disabled}>
          <SelectTrigger className='h-8'>
            <SelectValue placeholder={t('sharing.groups.selectPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name} ({g.memberCount})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Select value={permission} onValueChange={(v) => setPermission(v as WorkspacePermission)} disabled={disabled}>
        <SelectTrigger className='h-8 w-28'><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value='read'>{t('sharing.permission.read')}</SelectItem>
          <SelectItem value='readwrite'>{t('sharing.permission.readwrite')}</SelectItem>
        </SelectContent>
      </Select>
      <Button type='button' size='sm' variant='secondary' onClick={handleAdd} disabled={disabled || !groupId}>
        {t('sharing.groups.add')}
      </Button>
    </div>
  );
}
