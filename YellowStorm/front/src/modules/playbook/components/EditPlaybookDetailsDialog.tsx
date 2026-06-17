import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { handleApiError } from '@/lib/api-error';
import { useModuleTranslation } from '@/modules/localization';
import { updatePlaybook } from '../api';
import type { PlaybookSummary } from '../types';

const NAME_MAX = 100;
const DESCRIPTION_MAX = 20000;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playbook: PlaybookSummary | null;
  onSaved: (updated: { name: string; description: string }) => void;
}

export function EditPlaybookDetailsDialog({ open, onOpenChange, playbook, onSaved }: Props) {
  const { t } = useModuleTranslation('playbook');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !playbook) return;
    setName(playbook.name);
    setDescription(playbook.description ?? '');
  }, [open, playbook]);

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const nameValid = trimmedName.length >= 2 && trimmedName.length <= NAME_MAX;
  const descriptionValid = trimmedDescription.length <= DESCRIPTION_MAX;
  const dirty = playbook !== null
    && (trimmedName !== playbook.name.trim()
      || trimmedDescription !== (playbook.description ?? '').trim());
  const canSave = playbook !== null && nameValid && descriptionValid && dirty && !saving;

  const handleSave = async () => {
    if (!playbook || !canSave) return;
    setSaving(true);
    try {
      const updated = await updatePlaybook(playbook.id, {
        name: trimmedName,
        description: trimmedDescription,
      });
      onSaved({ name: updated.name, description: updated.description ?? '' });
      toast.success(t('editDetails.saved'));
      onOpenChange(false);
    } catch (err) {
      handleApiError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('editDetails.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-playbook-name">{t('create.nameLabel')}</Label>
            <Input
              id="edit-playbook-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={NAME_MAX}
              autoFocus
            />
            {name.length > 0 && !nameValid ? (
              <p className="text-xs text-destructive">
                {t('editDetails.nameInvalid', { max: NAME_MAX })}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-playbook-desc">{t('create.descriptionLabel')}</Label>
            <Textarea
              id="edit-playbook-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={DESCRIPTION_MAX}
              rows={5}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('editDetails.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
            {t('editDetails.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
