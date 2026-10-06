import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { useApiAction } from '@/lib/use-api-action';
import { useModuleTranslation } from '@/modules/localization';
import { adminTemplateApi } from '../../api';
import { useCoverImageItems } from '../../hooks/useCoverImageItems';
import type { AppTemplate, TemplateCategory } from '../../types';
import { FileDropZone } from './FileDropZone';
import { TemplateStudio } from './TemplateStudio';
import { CoverFocusDialog } from './cover/CoverFocusDialog';
import { CoverImageGallery } from './cover/CoverImageGallery';
import { exportPrimaryCoverFile } from './cover/cover-focus';

interface TemplateFormDrawerProps {
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

export function TemplateFormDrawer({
  open,
  onOpenChange,
  template,
  categories,
  defaultCategoryId,
  onSaved,
}: TemplateFormDrawerProps) {
  const { t } = useModuleTranslation('app-builder');
  const isEdit = Boolean(template);

  const [categoryId, setCategoryId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [zipValidated, setZipValidated] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [exportingCover, setExportingCover] = useState(false);

  const {
    coverItems,
    primaryCover,
    focusItem,
    setFocusItemId,
    resetCoverItems,
    addCoverFiles,
    removeCover,
    setPrimaryCover,
    applyFocus,
    replaceWithValidatedCover,
  } = useCoverImageItems();

  useEffect(() => {
    if (!open) return;
    setTitle(template?.title ?? '');
    setDescription(template?.description ?? '');
    setCategoryId(template?.categoryId ?? defaultCategoryId ?? categories[0]?.id ?? '');
    setZipFile(null);
    resetCoverItems();
    setZipValidated(false);
    setStudioOpen(false);
  }, [open, template, defaultCategoryId, categories, resetCoverItems]);

  const create = useApiAction(adminTemplateApi.createTemplate, {
    showErrorToast: false,
    showSuccessToast: true,
    successMessage: t('templates.createSuccess'),
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
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

  const busy = create.isLoading || update.isLoading || exportingCover;
  const error = create.error ?? update.error;
  const canSubmitCreate = Boolean(
    categoryId && title.trim() && zipFile && primaryCover && zipValidated,
  );

  const handleZipChange = (file: File | null) => {
    setZipFile(file);
    setZipValidated(false);
    resetCoverItems();
  };

  const handleValidatedCover = (file: File) => {
    replaceWithValidatedCover(file);
    setZipValidated(true);
    setStudioOpen(false);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isEdit && template) {
      await update.execute(template.id, {
        categoryId,
        title: title.trim(),
        description: description.trim(),
      });
      return;
    }

    if (!zipFile || !primaryCover || !zipValidated) return;

    setExportingCover(true);
    try {
      const cover = await exportPrimaryCoverFile(primaryCover);
      await create.execute({
        categoryId,
        title: title.trim(),
        description: description.trim(),
        zip: zipFile,
        cover,
      });
    } finally {
      setExportingCover(false);
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
        <SheetContent
          side='right'
          closeLabel={t('templates.close')}
          className='flex w-full flex-col gap-0 p-0 sm:max-w-lg'
          onInteractOutside={(event) => event.preventDefault()}
        >
          <SheetHeader className='space-y-1.5 border-b p-5 text-left'>
            <SheetTitle className='text-base font-semibold'>
              {isEdit ? t('templates.editTitle') : t('templates.createTitle')}
            </SheetTitle>
            <SheetDescription className='leading-relaxed'>
              {t('templates.formDescription')}
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={handleSubmit} className='flex min-h-0 flex-1 flex-col'>
            <div className='min-h-0 flex-1 space-y-5 overflow-y-auto p-5'>
              <div className='space-y-2'>
                <Label htmlFor='template-category'>{t('templates.fieldCategory')}</Label>
                <Select
                  value={categoryId}
                  onValueChange={setCategoryId}
                  disabled={busy || categories.length === 0}
                >
                  <SelectTrigger id='template-category' className='w-full'>
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

              <div className='space-y-2'>
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

              <div className='space-y-2'>
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
                    onChange={handleZipChange}
                    disabled={busy}
                  />
                  {zipFile ? (
                    <Button
                      type='button'
                      variant={zipValidated ? 'outline' : 'secondary'}
                      className='w-full'
                      disabled={busy || zipValidated}
                      onClick={() => setStudioOpen(true)}
                    >
                      {zipValidated ? (
                        <>
                          <CheckCircle2 className='mr-2 size-4 text-ok' aria-hidden />
                          {t('templates.validationConfirmed')}
                        </>
                      ) : (
                        t('templates.validateTemplate')
                      )}
                    </Button>
                  ) : null}
                  <CoverImageGallery
                    id='template-cover'
                    label={t('templates.fieldCover')}
                    accept={ACCEPT_IMAGE}
                    items={coverItems}
                    onAddFiles={addCoverFiles}
                    onRemove={removeCover}
                    onSetPrimary={setPrimaryCover}
                    onEditFocus={setFocusItemId}
                    disabled={busy}
                    hint={zipValidated ? t('templates.coverFromValidation') : undefined}
                  />
                </>
              ) : null}

              {error ? (
                <p role='alert' className='rounded-lg bg-fail/10 px-3 py-2 text-sm text-fail'>
                  {error.message}
                </p>
              ) : null}
            </div>

            <SheetFooter className='gap-2 border-t p-4'>
              <Button type='button' variant='outline' onClick={() => onOpenChange(false)} disabled={busy}>
                {t('card.cancel')}
              </Button>
              <Button
                type='submit'
                disabled={busy || (isEdit ? !title.trim() || !categoryId : !canSubmitCreate)}
              >
                {busy ? <Loader2 className='mr-2 size-4 animate-spin' aria-hidden /> : null}
                {isEdit ? t('templates.save') : t('templates.create')}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      <TemplateStudio
        open={studioOpen}
        zipFile={zipFile}
        onOpenChange={setStudioOpen}
        onValidated={handleValidatedCover}
      />

      <CoverFocusDialog
        open={Boolean(focusItem)}
        item={focusItem}
        titlePreview={title}
        onOpenChange={(next) => {
          if (!next) setFocusItemId(null);
        }}
        onApply={applyFocus}
      />
    </>
  );
}
