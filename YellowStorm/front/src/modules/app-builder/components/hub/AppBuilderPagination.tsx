import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';

interface AppBuilderPaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function AppBuilderPagination({ page, totalPages, onPageChange }: AppBuilderPaginationProps) {
  const { t } = useModuleTranslation('app-builder');

  if (totalPages <= 1) return null;

  return (
    <nav
      className='flex flex-col gap-2 border-t border-border/60 pt-3 sm:flex-row sm:items-center sm:justify-between'
      aria-label={t('hub.pagination.ariaLabel')}
    >
      <p className='text-xs text-muted-foreground'>
        {t('hub.pagination.summary', { page, total: totalPages })}
      </p>
      <div className='flex gap-2'>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className='h-4 w-4' aria-hidden />
          {t('hub.pagination.previous')}
        </Button>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          {t('hub.pagination.next')}
          <ChevronRight className='h-4 w-4' aria-hidden />
        </Button>
      </div>
    </nav>
  );
}
