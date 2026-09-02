import { useEffect, useRef, useState, type DragEvent } from 'react';
import { ImagePlus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { parseApiError } from '@/lib/api-error';
import { showError, showSuccess } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { ModuleTranslationKey } from '@/modules/localization';
import { createAppearanceLogo, updateAppearanceLogo } from '../api';
import type { AppearanceLogo } from '../types';
import { APPEARANCE_LOGO_ACCEPT, APPEARANCE_LOGO_SLOT } from './constants';
import { prepareLogoUpload, type LogoFileIssue } from './utils';
import { LogoMark } from './LogoMark';

interface LogoUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  logo: AppearanceLogo | null;
  onSaved: (logo: AppearanceLogo) => void;
}

interface SizeHint {
  width: number;
  height: number;
}

export function LogoUploadDialog({ open, onOpenChange, logo, onSaved }: LogoUploadDialogProps) {
  const { t } = useModuleTranslation('admin');
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [originalSize, setOriginalSize] = useState<SizeHint | null>(null);
  const [outputSize, setOutputSize] = useState<SizeHint | null>(null);
  const [issue, setIssue] = useState<LogoFileIssue | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setName(logo?.name ?? '');
    resetFileState();
  }, [open, logo]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const resetFileState = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setFile(null);
    setPreviewUrl(null);
    setOriginalSize(null);
    setOutputSize(null);
    setIssue(null);
  };

  const handleFile = async (next: File | null) => {
    resetFileState();
    if (!next) {
      return;
    }
    const prepared = await prepareLogoUpload(next);
    if (!prepared.ok) {
      setIssue(prepared.issue);
      return;
    }
    setOriginalSize({ width: prepared.original.width, height: prepared.original.height });
    setOutputSize({ width: prepared.fitted.width, height: prepared.fitted.height });
    setFile(prepared.fitted.file);
    setPreviewUrl(URL.createObjectURL(prepared.fitted.file));
    if (!name.trim()) {
      setName(next.name.replace(/\.[^.]+$/, ''));
    }
  };

  const onDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    void handleFile(event.dataTransfer.files[0] ?? null);
  };

  const canSubmit = logo ? Boolean(name.trim()) && !issue : Boolean(file && name.trim() && !issue);

  const submit = async () => {
    if (!canSubmit) {
      return;
    }
    setSaving(true);
    try {
      const saved = logo
        ? await updateAppearanceLogo(logo.id, { name: name.trim(), file: file ?? undefined })
        : await createAppearanceLogo(file as File, name.trim());
      showSuccess(t(logo ? 'appearance.logo.updated' : 'appearance.logo.created'));
      onSaved(saved);
      onOpenChange(false);
    } catch (error) {
      showError(parseApiError(error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>{t(logo ? 'appearance.logo.editTitle' : 'appearance.logo.createTitle')}</DialogTitle>
          <DialogDescription>{t('appearance.logo.constraints')}</DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='appearance-logo-name'>{t('appearance.logo.name')}</Label>
            <Input id='appearance-logo-name' value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
          </div>

          <button
            type='button'
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
            className={cn(
              'flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition-colors',
              issue ? 'border-destructive/50 bg-destructive/5' : 'border-border hover:border-primary/40 hover:bg-muted/40',
            )}>
            <ImagePlus className='h-5 w-5 text-muted-foreground' />
            <span className='text-sm font-medium'>{t(logo ? 'appearance.logo.replaceFile' : 'appearance.logo.drop')}</span>
            <span className='text-xs text-muted-foreground'>{t('appearance.logo.constraints')}</span>
          </button>
          <input
            ref={inputRef}
            type='file'
            accept={APPEARANCE_LOGO_ACCEPT}
            className='sr-only'
            onChange={(event) => {
              void handleFile(event.target.files?.[0] ?? null);
              event.target.value = '';
            }}
          />
          {issue ? <p className='text-sm text-destructive'>{t(`appearance.logo.validation.${issue}` as ModuleTranslationKey<'admin'>)}</p> : null}

          <div className='space-y-2'>
            <p className='text-sm font-medium'>{t('appearance.logo.preview')}</p>
            <div className='rounded-lg border bg-sidebar p-3'>
              <div className='flex h-12 w-56 items-center justify-center overflow-hidden'>
                {previewUrl ? (
                  <img src={previewUrl} alt='' className='h-12 w-56 object-contain' />
                ) : logo ? (
                  <LogoMark logo={logo} className='max-h-12 max-w-56' />
                ) : (
                  <span className='text-xs text-muted-foreground'>
                    {APPEARANCE_LOGO_SLOT.widthPx}×{APPEARANCE_LOGO_SLOT.heightPx}px
                  </span>
                )}
              </div>
            </div>
            {originalSize && outputSize ? (
              <p className='text-xs text-muted-foreground'>
                {t('appearance.logo.originalSize', { width: originalSize.width, height: originalSize.height })}
                {' · '}
                {t('appearance.logo.outputSize', { width: outputSize.width, height: outputSize.height })}
              </p>
            ) : (
              <p className='text-xs text-muted-foreground'>{t('appearance.logo.resizeHint')}</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type='button' variant='outline' onClick={() => onOpenChange(false)} disabled={saving}>
            {t('appearance.logo.cancel')}
          </Button>
          <Button type='button' onClick={() => void submit()} disabled={!canSubmit || saving}>
            {saving ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : null}
            {saving ? t('appearance.logo.uploading') : t('appearance.logo.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
