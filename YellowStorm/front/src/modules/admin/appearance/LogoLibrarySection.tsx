import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { parseApiError } from '@/lib/api-error';
import { showError, showSuccess } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { deleteAppearanceLogo } from '../api';
import type { AppearanceLogo } from '../types';
import { LogoMark } from './LogoMark';
import { LogoUploadDialog } from './LogoUploadDialog';

interface LogoLibrarySectionProps {
  logos: AppearanceLogo[];
  selectedLogoId: string;
  assigning: boolean;
  onSelectLogo: (id: string) => void;
  onLogosChange: (logos: AppearanceLogo[], assignId?: string) => void;
}

export function LogoLibrarySection({ logos, selectedLogoId, assigning, onSelectLogo, onLogosChange }: LogoLibrarySectionProps) {
  const { t } = useModuleTranslation('admin');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AppearanceLogo | null>(null);
  const [deleting, setDeleting] = useState<AppearanceLogo | null>(null);

  const customLogos = logos.filter((logo) => logo.kind === 'custom');

  const handleSaved = (saved: AppearanceLogo) => {
    const exists = logos.some((item) => item.id === saved.id);
    const next = exists ? logos.map((item) => (item.id === saved.id ? saved : item)) : [...logos, saved];
    onLogosChange(next, exists ? undefined : saved.id);
  };

  const confirmDelete = async () => {
    if (!deleting) {
      return;
    }
    try {
      await deleteAppearanceLogo(deleting.id);
      onLogosChange(logos.filter((item) => item.id !== deleting.id));
      showSuccess(t('appearance.logo.deleted'));
      setDeleting(null);
    } catch (error) {
      showError(parseApiError(error).message);
    }
  };

  return (
    <div className='space-y-3'>
      <div className='flex items-start justify-between gap-3'>
        <div>
          <p className='text-sm font-medium'>{t('appearance.logo.library')}</p>
          <p className='text-sm text-muted-foreground'>{t('appearance.logo.libraryHint')}</p>
        </div>
        <Button
          type='button'
          variant='outline'
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}>
          <Plus className='mr-2 h-4 w-4' />
          {t('appearance.logo.upload')}
        </Button>
      </div>

      <div role='radiogroup' aria-label={t('appearance.logo.library')} className='grid gap-3'>
        {logos.map((logo) => {
          const selected = logo.id === selectedLogoId;
          return (
            <div
              key={logo.id}
              className={cn(
                'flex items-center gap-3 rounded-xl border p-3 transition-all',
                selected ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-border',
              )}>
              <button
                type='button'
                role='radio'
                aria-checked={selected}
                aria-label={logo.name}
                disabled={assigning}
                onClick={() => onSelectLogo(logo.id)}
                className='flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'>
                <div className='flex h-12 w-56 shrink-0 items-center overflow-hidden rounded-md border bg-sidebar px-2'>
                  <LogoMark logo={logo} className='max-h-10 max-w-full' />
                </div>
                <div className='min-w-0 flex-1'>
                  <p className='truncate text-sm font-medium'>{logo.name}</p>
                  <div className='mt-1 flex flex-wrap items-center gap-1.5'>
                    <Badge variant='secondary' className='font-normal'>
                      {t(logo.kind === 'builtin' ? 'appearance.logo.builtin' : 'appearance.logo.custom')}
                    </Badge>
                    {selected ? (
                      <Badge className='font-normal'>{t('appearance.logo.inUse')}</Badge>
                    ) : null}
                    {logo.width && logo.height ? (
                      <span className='text-xs text-muted-foreground'>{t('appearance.logo.dimensions', { width: logo.width, height: logo.height })}</span>
                    ) : null}
                  </div>
                </div>
              </button>
              {logo.kind === 'custom' ? (
                <div className='flex shrink-0 gap-1'>
                  <Button
                    type='button'
                    size='icon'
                    variant='ghost'
                    aria-label={t('appearance.logo.edit')}
                    onClick={() => {
                      setEditing(logo);
                      setDialogOpen(true);
                    }}>
                    <Pencil className='h-4 w-4' />
                  </Button>
                  <Button type='button' size='icon' variant='ghost' aria-label={t('appearance.logo.delete')} onClick={() => setDeleting(logo)}>
                    <Trash2 className='h-4 w-4' />
                  </Button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {customLogos.length === 0 ? <p className='text-sm text-muted-foreground'>{t('appearance.logo.emptyCustom')}</p> : null}

      <LogoUploadDialog open={dialogOpen} onOpenChange={setDialogOpen} logo={editing} onSaved={handleSaved} />

      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('appearance.logo.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('appearance.logo.deleteDescription', { name: deleting?.name ?? '' })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('appearance.logo.cancel')}</AlertDialogCancel>
            <AlertDialogAction className='bg-destructive text-destructive-foreground hover:bg-destructive/90' onClick={() => void confirmDelete()}>
              {t('appearance.logo.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
