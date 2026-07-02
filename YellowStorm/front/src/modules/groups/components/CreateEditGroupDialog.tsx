import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useModuleTranslation } from '@/modules/localization';
import { useGroupsStore } from '../store';
import { GroupMemberInput } from './GroupMemberInput';
import type { GroupMember, UserGroup } from '../types';

interface CreateEditGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: UserGroup | null;
}

export function CreateEditGroupDialog({ open, onOpenChange, group }: Readonly<CreateEditGroupDialogProps>) {
  const { t } = useModuleTranslation('groups');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName(group?.name ?? '');
      setDescription(group?.description ?? '');
      setMembers(group?.members ?? []);
    }
  }, [open, group]);

  const canSubmit = name.trim().length >= 2 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const store = useGroupsStore.getState();
      if (group) {
        await store.updateGroup(group.id, { name: name.trim(), description });
        // Reconcile members against the original list.
        const originalIds = new Set(group.members.map((m) => m.id));
        const nextIds = new Set(members.map((m) => m.id));
        const toAdd = members.filter((m) => !originalIds.has(m.id)).map((m) => m.id);
        const toRemove = group.members.filter((m) => !nextIds.has(m.id)).map((m) => m.id);
        if (toAdd.length > 0) await store.addMembers(group.id, toAdd);
        for (const id of toRemove) await store.removeMember(group.id, id);
      } else {
        await store.createGroup({
          name: name.trim(),
          description,
          memberIds: members.map((m) => m.id),
        });
      }
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>{group ? t('dialog.editTitle') : t('dialog.createTitle')}</DialogTitle>
        </DialogHeader>
        <div className='space-y-4'>
          <div className='space-y-1'>
            <Label htmlFor='group-name'>{t('dialog.nameLabel')}</Label>
            <Input id='group-name' value={name} onChange={(e) => setName(e.target.value)} placeholder={t('dialog.namePlaceholder')} maxLength={100} />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='group-desc'>{t('dialog.descriptionLabel')}</Label>
            <Textarea id='group-desc' value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('dialog.descriptionPlaceholder')} maxLength={2000} rows={2} />
          </div>
          <div className='space-y-1'>
            <Label>{t('dialog.membersLabel')}</Label>
            <GroupMemberInput
              members={members}
              onAdd={(u) => setMembers((prev) => (prev.some((m) => m.id === u.id) ? prev : [...prev, u]))}
              onRemove={(id) => setMembers((prev) => prev.filter((m) => m.id !== id))}
              disabled={submitting}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>{t('dialog.cancel')}</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {group ? t('dialog.save') : t('dialog.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
