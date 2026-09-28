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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useApiAction } from '@/lib/use-api-action';
import { useModuleTranslation } from '@/modules/localization';
import { adminTemplateApi } from '../../api';
import type { AppTemplate, TemplateCategory } from '../../types';
import { FileDropZone } from './FileDropZone';
import { TemplateValidationPanel } from './validation/TemplateValidationPanel';

interface TemplateFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create mode. */
  template: AppTemplate | null;
  categories: TemplateCategory[];
  defaultCategoryId?: string | null;
  onSaved: () => void;
}

const ACCEPT_IMAGE = 'image/png,image/jpeg,image/webp,image/svg+xml';
const ACCEPT_ZIP = '.zip,application/zip';

export function TemplateFormDialog({
  open,
  onOpenChange,
  template,
  categories,
  defaultCategoryId,
  onSaved,
}: TemplateFormDialogProps) {
  const { t } = useModuleTranslation('app-builder');
  const isEdit = Boolean(template);

  const [phase, setPhase] = useState<'form' | 'validating'>('form');
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);

  useEffect(() => {
    if (!open) return;
    setPhase('form');
    setCreatedId(null);
    setTitle(template?.title ?? '');
    setDescription(template?.description ?? '');
    setCategoryId(template?.categoryId ?? defaultCategoryId ?? categories[0]?.id ?? '');
    setZipFile(null);
    setCoverFile(null);
  }, [open, template, defaultCategoryId, categories]);

  const create = useApiAction(adminTemplateApi.createTemplate, {
    showErrorToast: false,
    onSuccess: (tpl) => {
      setCreatedId(tpl.id);
      setPhase('validating');
    },
  });
  const update = useApiAction(adminTemplateApi.updateTemplate, {
    showErrorToast: false,
    showSuccessToast: true,
    successMessage: t('templates.updateSuccess'),
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
  });

  const busy = create.isLoading || update.isLoading;
  const error = create.error ?? update.error;

  const canSubmitCreate = Boolean(categoryId && title.trim() && zipFile && coverFile);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isEdit && template) {
      await update.execute(template.id, {
        categoryId,
        title: title.trim(),
        description: description.trim(),
      });
    } else if (zipFile && coverFile) {
      await create.execute({
        categoryId,
        title: title.trim(),
        description: description.trim(),
        zip: zipFile,
        cover: coverFile,
      });
    }
  };

  if (phase === 'validating' && createdId) {
    return (
      <Dialog open={open} onOpenChange={(next) => (next ? undefined : onOpenChange(false))}>
        <DialogContent className='max-h-[92vh] max-w-3xl overflow-y-auto'>
          <DialogHeader>
            <DialogTitle>{t('validation.title')}</DialogTitle>
            <DialogDescription>{t('validation.description', { title })}</DialogDescription>
          </DialogHeader>
          <TemplateValidationPanel
            templateId={createdId}
            onConfirmed={() => {
              onSaved();
              onOpenChange(false);
            }}
          />
          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
              {t('dropZone.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent className='max-h-[90vh] max-w-lg overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>{isEdit ? t('templates.editTitle') : t('templates.createTitle')}</DialogTitle>
          <DialogDescription>{t('templates.formDescription')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className='space-y-4'>
          <div className='space-y-1.5'>
            <Label htmlFor='template-category'>{t('templates.fieldCategory')}</Label>
            <Select value={categoryId} onValueChange={setCategoryId} disabled={busy || categories.length === 0}>
              <SelectTrigger id='template-category'>
                <SelectValue placeholder={t('templates.categoryPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='template-title'>{t('templates.fieldTitle')}</Label>
            <Input
              id='template-title'
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              required
              disabled={busy}
            />
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='template-description'>{t('templates.fieldDescription')}</Label>
            <Textarea
              id='template-description'
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={5000}
              disabled={busy}
            />
          </div>

          {!isEdit ? (
            <>
              <FileDropZone
                id='template-zip'
                kind='archive'
                label={t('templates.fieldZip')}
                hint={t('templates.zipHint')}
                accept={ACCEPT_ZIP}
                value={zipFile}
                onChange={setZipFile}
                disabled={busy}
              />
              <FileDropZone
                id='template-cover'
                kind='image'
                label={t('templates.fieldCover')}
                accept={ACCEPT_IMAGE}
                value={coverFile}
                onChange={setCoverFile}
                disabled={busy}
              />
            </>
          ) : null}

          {error ? (
            <p role='alert' className='text-sm text-fail'>
              {error.message}
            </p>
          ) : null}

          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)} disabled={busy}>
              {t('card.cancel')}
            </Button>
            {isEdit && template?.status === 'draft' && template.revisionId ? (
              <Button
                type='button'
                variant='outline'
                disabled={busy}
                onClick={() => {
                  setCreatedId(template.id);
                  setPhase('validating');
                }}
              >
                {t('templates.validateDraft')}
              </Button>
            ) : null}
            <Button
              type='submit'
              disabled={busy || (isEdit ? !title.trim() || !categoryId : !canSubmitCreate)}
            >
              {busy ? <Loader2 className='mr-2 size-4 animate-spin' aria-hidden /> : null}
              {isEdit ? t('templates.save') : t('templates.createAndValidate')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
