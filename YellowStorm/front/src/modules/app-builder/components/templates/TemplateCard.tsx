import { memo, type MouseEvent } from 'react';
import { Database, Layers, Pencil, Star, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { AppTemplate } from '../../types';
import { TemplatePreviewFrame } from './TemplatePreviewFrame';

interface TemplateCardProps {
  template: AppTemplate;
  onOpen: (template: AppTemplate) => void;
  onClone?: (template: AppTemplate) => void;
  cloning?: boolean;
  /** Super-admin: show edit/delete that call admin template endpoints. */
  isSuperAdmin?: boolean;
  onEdit?: (template: AppTemplate) => void;
  onDelete?: (template: AppTemplate) => void;
}

function templateInitial(title: string): string {
  const trimmed = title.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
}

function TemplateMeta({ template }: { template: AppTemplate }) {
  const { t } = useModuleTranslation('app-builder');
  const report = template.platformReport;
  const platformFiles = report?.injectedFiles?.length ?? 1;
  const kitVersion = report?.kitVersion ?? 1;

  return (
    <div
      className='mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground'
      aria-label={t('templates.metaAria')}
    >
      <span
        className='inline-flex items-center gap-1 tabular-nums'
        title={t('templates.metaPlatformFiles')}
      >
        <Database className='size-3.5 shrink-0 opacity-70' aria-hidden />
        {platformFiles}
      </span>
      <span
        className='inline-flex items-center gap-1 tabular-nums'
        title={t('templates.metaStarter')}
      >
        <Layers className='size-3.5 shrink-0 opacity-70' aria-hidden />
        1
      </span>
      <span
        className='inline-flex items-center gap-1 tabular-nums'
        title={
          template.status === 'published'
            ? t('templates.metaPublished')
            : t('templates.metaDraft')
        }
      >
        <Star className='size-3.5 shrink-0 opacity-70' aria-hidden />
        {kitVersion}
      </span>
    </div>
  );
}

/**
 * Marketplace-style card (preview badge + hover clone pill + footer meta).
 * Preview/title open the detail modal; Clone App opens Conversation V2 without auto-prompt.
 */
export const TemplateCard = memo(function TemplateCard({
  template,
  onOpen,
  onClone,
  cloning = false,
  isSuperAdmin = false,
  onEdit,
  onDelete,
}: TemplateCardProps) {
  const { t } = useModuleTranslation('app-builder');

  const handleClone = (e: MouseEvent) => {
    e.stopPropagation();
    if (cloning) return;
    onClone?.(template);
  };

  const handleEdit = (e: MouseEvent) => {
    e.stopPropagation();
    onEdit?.(template);
  };

  const handleDelete = (e: MouseEvent) => {
    e.stopPropagation();
    onDelete?.(template);
  };

  return (
    <article
      className={cn(
        'group flex h-full flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm',
        'transition-[border-color,box-shadow,transform] duration-200 ease-out',
        'hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-md',
        'focus-within:border-primary/25 focus-within:ring-2 focus-within:ring-primary/15',
      )}
    >
      <div className='relative'>
        {isSuperAdmin ? (
          <div className='absolute left-2 top-2 z-30 flex items-center gap-0.5 rounded-lg bg-background/90 p-0.5 opacity-100 shadow-sm backdrop-blur-sm transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100'>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className='size-8 rounded-md text-muted-foreground hover:text-foreground'
              aria-label={t('admin.editTemplate')}
              onClick={handleEdit}
            >
              <Pencil className='size-3.5' aria-hidden />
            </Button>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className='size-8 rounded-md text-muted-foreground hover:text-fail'
              aria-label={t('admin.deleteTemplate')}
              onClick={handleDelete}
            >
              <Trash2 className='size-3.5' aria-hidden />
            </Button>
          </div>
        ) : null}

        <TemplatePreviewFrame
          src={template.coverImage}
          title={template.title}
          chrome='dots'
          mediaClassName='transition-transform duration-300 ease-out group-hover:scale-[1.03]'
        >
          <button
            type='button'
            onClick={() => onOpen(template)}
            aria-label={t('templateModal.openAria', { title: template.title })}
            className='absolute inset-0 z-0 block size-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40'
          />

          {t('templates.freeBadge') ? (
            <span className='pointer-events-none absolute right-2.5 top-2.5 z-10 rounded-full bg-black/55 px-2.5 py-0.5 text-[11px] font-semibold tracking-wide text-white backdrop-blur-sm'>
              {t('templates.freeBadge')}
            </span>
          ) : null}

          <div
            aria-hidden
            className='pointer-events-none absolute inset-0 z-10 bg-black/45 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100'
          />

          <div className='absolute inset-0 z-20 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100'>
            <Button
              type='button'
              variant='outline'
              disabled={cloning || !onClone}
              aria-label={t('templates.cloneAria', { title: template.title })}
              onClick={handleClone}
              className='pointer-events-auto h-10 gap-2 rounded-full border-white/35 bg-black/50 px-5 text-sm font-medium text-white shadow-lg backdrop-blur-md hover:bg-black/60 hover:text-white disabled:opacity-60'
            >
              <Layers className='size-4' aria-hidden />
              {cloning ? t('templates.cloning') : t('templates.cloneFree')}
            </Button>
          </div>
        </TemplatePreviewFrame>
      </div>

      <div className='flex items-start gap-3 px-4 py-3.5'>
        <div className='size-9 shrink-0 overflow-hidden rounded-full border border-border/50 bg-muted'>
          {template.coverImage ? (
            <img
              src={template.coverImage}
              alt=''
              className='size-full object-cover object-[center_12%]'
              loading='lazy'
            />
          ) : (
            <span
              aria-hidden
              className='flex size-full items-center justify-center bg-primary/10 text-sm font-semibold text-primary'
            >
              {templateInitial(template.title)}
            </span>
          )}
        </div>
        <div className='min-w-0 flex-1'>
          <button
            type='button'
            onClick={() => onOpen(template)}
            className='block w-full truncate text-left text-[15px] font-semibold leading-snug tracking-tight text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 rounded-sm'
          >
            {template.title}
          </button>
          <TemplateMeta template={template} />
        </div>
      </div>

      <div className='border-t border-border/40 px-4 pb-3.5 pt-0 md:hidden'>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={cloning || !onClone}
          aria-label={t('templates.cloneAria', { title: template.title })}
          onClick={handleClone}
          className='mt-3 h-9 w-full gap-1.5 rounded-full'
        >
          <Layers className='size-4' aria-hidden />
          {cloning ? t('templates.cloning') : t('templates.cloneFree')}
        </Button>
      </div>
    </article>
  );
});
