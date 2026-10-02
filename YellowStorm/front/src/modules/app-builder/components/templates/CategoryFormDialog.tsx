import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApiAction } from '@/lib/use-api-action';
import { useModuleTranslation } from '@/modules/localization';
import { adminTemplateApi } from '../../api';
import type { TemplateCategory } from '../../types';
import { CategoryIconPicker } from './CategoryIconPicker';

interface CategoryFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create mode. */
  category: TemplateCategory | null;
  onSaved: () => void;
}

export function CategoryFormDialog({
  open,
  onOpenChange,
  category,
  onSaved,
}: CategoryFormDialogProps) {
  const { t } = useModuleTranslation('app-builder');
  const isEdit = Boolean(category);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [icon, setIcon] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? '');
    setSlug(category?.slug ?? '');
    setIcon(category?.icon ?? '');
  }, [open, category]);

  const create = useApiAction(adminTemplateApi.createCategory, {
    showErrorToast: false,
    showSuccessToast: true,
    successMessage: t('categories.createSuccess'),
    onSuccess: onSaved,
  });
  const update = useApiAction(adminTemplateApi.updateCategory, {
    showErrorToast: false,
    showSuccessToast: true,
    successMessage: t('categories.updateSuccess'),
    onSuccess: onSaved,
  });

  const busy = create.isLoading || update.isLoading;
  const error = create.error ?? update.error;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const payload = {
      name: trimmedName,
      ...(slug.trim() ? { slug: slug.trim() } : {}),
      ...(icon.trim() ? { icon: icon.trim() } : {}),
    };
    if (isEdit && category) {
      await update.execute(category.id, payload);
    } else {
      await create.execute(payload);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>{isEdit ? t('categories.editTitle') : t('categories.createTitle')}</DialogTitle>
          <DialogDescription>{t('categories.formDescription')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className='space-y-4'>
          <div className='space-y-1.5'>
            <Label htmlFor='category-name'>{t('categories.fieldName')}</Label>
            <Input
              id='category-name'
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={128}
              required
              disabled={busy}
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='category-slug'>{t('categories.fieldSlug')}</Label>
            <Input
              id='category-slug'
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder={t('categories.slugPlaceholder')}
              maxLength={160}
              disabled={busy}
            />
            <p className='text-xs text-muted-foreground'>{t('categories.slugHint')}</p>
          </div>
          <div className='space-y-2'>
            <Label htmlFor='category-icon'>{t('categories.fieldIcon')}</Label>
            <CategoryIconPicker id='category-icon' value={icon} onChange={setIcon} disabled={busy} />
          </div>

          {error ? (
            <p role='alert' className='text-sm text-fail'>
              {error.message}
            </p>
          ) : null}

          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)} disabled={busy}>
              {t('card.cancel')}
            </Button>
            <Button type='submit' disabled={busy || !name.trim()}>
              {busy ? <Loader2 className='mr-2 size-4 animate-spin' aria-hidden /> : null}
              {isEdit ? t('categories.save') : t('categories.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
