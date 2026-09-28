import { memo } from 'react';
import { AppWindow } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { AppTemplate } from '../../types';

interface TemplateCardProps {
  template: AppTemplate;
  onOpen: (template: AppTemplate) => void;
}

/**
 * Gallery card for a template. Whole surface is clickable (opens the detail
 * modal) — intentionally no inline action buttons.
 */
export const TemplateCard = memo(function TemplateCard({ template, onOpen }: TemplateCardProps) {
  const { t } = useModuleTranslation('app-builder');

  return (
    <button
      type='button'
      onClick={() => onOpen(template)}
      aria-label={t('templateModal.openAria', { title: template.title })}
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-2xl border border-border/60 bg-card text-left',
        'transition-[border-color,box-shadow,transform] duration-200',
        'hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
      )}
    >
      <div className='relative aspect-[16/9] w-full overflow-hidden bg-muted/40'>
        {template.coverImage ? (
          <img
            src={template.coverImage}
            alt=''
            loading='lazy'
            className='size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]'
          />
        ) : (
          <div className='flex size-full items-center justify-center'>
            <AppWindow className='size-8 text-muted-foreground' aria-hidden />
          </div>
        )}
      </div>
      <div className='flex flex-1 flex-col gap-1.5 p-4'>
        <p className='text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground'>
          {template.categoryName}
        </p>
        <h3 className='truncate text-base font-semibold leading-snug tracking-tight text-foreground'>
          {template.title}
        </h3>
        {template.description ? (
          <p className='line-clamp-2 text-sm leading-relaxed text-muted-foreground'>
            {template.description}
          </p>
        ) : null}
      </div>
    </button>
  );
});
