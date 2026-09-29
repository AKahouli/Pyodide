import { useId, useRef } from 'react';
import { ImagePlus, Star, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { COVER_MAX_IMAGES, type CoverImageItem } from './cover-focus';

interface CoverImageGalleryProps {
  id?: string;
  label: string;
  hint?: string;
  accept: string;
  items: CoverImageItem[];
  disabled?: boolean;
  onAddFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  onSetPrimary: (id: string) => void;
  onEditFocus: (id: string) => void;
}

export function CoverImageGallery({
  id,
  label,
  hint,
  accept,
  items,
  disabled = false,
  onAddFiles,
  onRemove,
  onSetPrimary,
  onEditFocus,
}: CoverImageGalleryProps) {
  const { t } = useModuleTranslation('app-builder');
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const inputRef = useRef<HTMLInputElement>(null);
  const canAdd = !disabled && items.length < COVER_MAX_IMAGES;

  const pick = (list: FileList | null) => {
    if (!list?.length || !canAdd) return;
    const remaining = COVER_MAX_IMAGES - items.length;
    const files = Array.from(list)
      .filter((file) => file.type.startsWith('image/'))
      .slice(0, remaining);
    if (files.length) onAddFiles(files);
  };

  return (
    <div className='space-y-2'>
      <div className='flex items-baseline justify-between gap-2'>
        <Label htmlFor={inputId}>{label}</Label>
        <span className='text-xs tabular-nums text-muted-foreground'>
          {t('coverGallery.count', { count: items.length, max: COVER_MAX_IMAGES })}
        </span>
      </div>

      {hint ? <p className='text-xs text-muted-foreground'>{hint}</p> : null}

      <ul
        className='grid grid-cols-3 gap-2.5 sm:grid-cols-4'
        aria-label={t('coverGallery.listAria')}
      >
        {items.map((item) => (
          <li key={item.id} className='min-w-0'>
            <div
              className={cn(
                'group relative aspect-[16/10] overflow-hidden rounded-xl border bg-muted/30',
                item.isPrimary
                  ? 'border-primary ring-2 ring-primary/25'
                  : 'border-border/60 hover:border-primary/35',
              )}
            >
              <button
                type='button'
                disabled={disabled}
                onClick={() => onEditFocus(item.id)}
                className='absolute inset-0 block size-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40'
                aria-label={t('coverGallery.editFocusAria', { name: item.file.name })}
              >
                <img
                  src={item.previewUrl}
                  alt=''
                  className='size-full object-cover'
                  style={{
                    objectPosition: `${item.focus.cx * 100}% ${item.focus.cy * 100}%`,
                  }}
                />
              </button>

              {item.isPrimary ? (
                <Badge className='pointer-events-none absolute left-1.5 top-1.5 gap-1 border-0 bg-primary px-1.5 py-0 text-[10px] font-semibold text-primary-foreground shadow-sm'>
                  <Star className='size-2.5 fill-current' aria-hidden />
                  {t('coverGallery.primaryBadge')}
                </Badge>
              ) : (
                <Button
                  type='button'
                  size='sm'
                  variant='secondary'
                  disabled={disabled}
                  className='absolute left-1 top-1 h-7 px-2 text-[10px] opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100'
                  onClick={(event) => {
                    event.stopPropagation();
                    onSetPrimary(item.id);
                  }}
                >
                  {t('coverGallery.setPrimary')}
                </Button>
              )}

              <Button
                type='button'
                size='icon'
                variant='secondary'
                disabled={disabled}
                aria-label={t('coverGallery.removeAria', { name: item.file.name })}
                className='absolute right-1 top-1 size-7 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100'
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(item.id);
                }}
              >
                <Trash2 className='size-3.5' aria-hidden />
              </Button>
            </div>
          </li>
        ))}

        {canAdd ? (
          <li className='min-w-0'>
            <button
              type='button'
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (!disabled) pick(event.dataTransfer.files);
              }}
              className={cn(
                'flex aspect-[16/10] w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border/70',
                'text-muted-foreground transition-colors hover:border-primary/45 hover:bg-accent/30 hover:text-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                disabled && 'pointer-events-none opacity-60',
              )}
              aria-label={t('coverGallery.addAria')}
            >
              <ImagePlus className='size-5' aria-hidden />
              <span className='text-xs font-medium'>{t('coverGallery.add')}</span>
            </button>
          </li>
        ) : null}
      </ul>

      {items.length === 0 ? (
        <p className='rounded-lg border border-dashed border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground'>
          {t('coverGallery.empty')}
        </p>
      ) : (
        <p className='text-xs text-muted-foreground'>{t('coverGallery.tip')}</p>
      )}

      <input
        ref={inputRef}
        id={inputId}
        type='file'
        accept={accept}
        multiple
        className='sr-only'
        disabled={disabled || !canAdd}
        onChange={(event) => {
          pick(event.target.files);
          event.target.value = '';
        }}
      />
    </div>
  );
}
