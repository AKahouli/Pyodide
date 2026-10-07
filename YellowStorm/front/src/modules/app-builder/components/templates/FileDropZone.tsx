import { useEffect, useRef, useState } from 'react';
import { FileArchive, ImageOff, UploadCloud, X } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';

interface FileDropZoneProps {
  id: string;
  label: string;
  hint?: string;
  accept: string;
  kind: 'image' | 'archive';
  value: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Accessible drag & drop + click-to-select field for a single file. */
export function FileDropZone({
  id,
  label,
  hint,
  accept,
  kind,
  value,
  onChange,
  disabled = false,
}: FileDropZoneProps) {
  const { t } = useModuleTranslation('app-builder');
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== 'image' || !value) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(value);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [kind, value]);

  const pick = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onChange(file);
  };

  return (
    <div className='space-y-1.5'>
      <Label htmlFor={id}>{label}</Label>
      <div
        role='button'
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) pick(e.dataTransfer.files);
        }}
        className={cn(
          'flex min-h-[92px] cursor-pointer items-center justify-center rounded-xl border-2 border-dashed p-3 text-center transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          dragging ? 'border-primary bg-primary/5' : 'border-border/70 hover:border-primary/40 hover:bg-accent/30',
          disabled && 'pointer-events-none opacity-60',
        )}
      >
        {previewUrl ? (
          <div className='relative w-full'>
            <img
              src={previewUrl}
              alt=''
              className='mx-auto max-h-28 w-auto rounded-lg object-contain'
            />
          </div>
        ) : value ? (
          <div className='flex items-center gap-3 text-left'>
            <span className='flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary'>
              {kind === 'image' ? <ImageOff className='size-5' aria-hidden /> : <FileArchive className='size-5' aria-hidden />}
            </span>
            <div className='min-w-0 flex-1'>
              <p className='truncate text-sm font-medium text-foreground'>{value.name}</p>
              <p className='text-xs text-muted-foreground'>{formatSize(value.size)}</p>
            </div>
            <button
              type='button'
              aria-label={t('dropZone.remove')}
              className='shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground'
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
            >
              <X className='size-4' />
            </button>
          </div>
        ) : (
          <div className='flex flex-col items-center gap-1 text-muted-foreground'>
            <UploadCloud className='size-6' aria-hidden />
            <p className='text-sm font-medium'>{t('dropZone.prompt')}</p>
            {hint ? <p className='text-xs'>{hint}</p> : null}
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        id={id}
        type='file'
        accept={accept}
        className='sr-only'
        disabled={disabled}
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
