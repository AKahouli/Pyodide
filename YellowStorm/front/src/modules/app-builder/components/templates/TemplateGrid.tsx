import { AlertCircle, AppWindow, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useModuleTranslation } from '@/modules/localization';
import type { AppTemplate } from '../../types';
import { TemplateCard } from './TemplateCard';

interface TemplateGridProps {
  templates: AppTemplate[];
  loading: boolean;
  error: boolean;
  categoryName?: string;
  onRetry: () => void;
  onOpen: (template: AppTemplate) => void;
}

export function TemplateGrid({
  templates,
  loading,
  error,
  categoryName,
  onRetry,
  onOpen,
}: TemplateGridProps) {
  const { t } = useModuleTranslation('app-builder');

  if (loading) {
    return (
      <div
        className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'
        aria-busy='true'
        aria-label='Loading'
      >
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className='overflow-hidden rounded-2xl border border-border/60 bg-card'>
            <Skeleton className='aspect-[16/9] w-full rounded-none' />
            <div className='space-y-2 p-4'>
              <Skeleton className='h-3 w-16' />
              <Skeleton className='h-5 w-40' />
              <Skeleton className='h-4 w-full' />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className='flex flex-col items-center justify-center gap-4 rounded-2xl border border-fail/20 bg-fail-soft/30 px-6 py-16 text-center'>
        <AlertCircle className='size-6 text-fail' aria-hidden />
        <p className='text-sm text-muted-foreground'>{t('templates.error')}</p>
        <Button type='button' variant='outline' size='sm' className='gap-1.5' onClick={onRetry}>
          <RefreshCw className='size-3.5' aria-hidden />
          {t('page.retry')}
        </Button>
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className='flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border/80 bg-muted/15 px-6 py-16 text-center'>
        <div className='flex size-14 items-center justify-center rounded-2xl border border-border/60 bg-card shadow-sm'>
          <AppWindow className='size-6 text-muted-foreground' aria-hidden />
        </div>
        <div className='max-w-md space-y-1.5'>
          <p className='text-sm font-semibold text-foreground'>{t('templates.emptyTitle')}</p>
          <p className='text-sm leading-relaxed text-muted-foreground'>
            {categoryName
              ? t('templates.emptyNamed', { name: categoryName })
              : t('templates.empty')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'>
      {templates.map((template) => (
        <TemplateCard key={template.id} template={template} onOpen={onOpen} />
      ))}
    </div>
  );
}
