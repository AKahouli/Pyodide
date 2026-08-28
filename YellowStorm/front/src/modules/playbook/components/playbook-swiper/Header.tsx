import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Loader } from '@/components/ai-elements/loader';
import { useModuleTranslation } from '@/modules/localization';

type HeaderProps = Readonly<{
  canScrollPrev: boolean;
  canScrollNext: boolean;
  total: number;
  loading?: boolean;
  hasMore?: boolean;
  onPrev: () => void;
  onNext: () => void;
}>;

export function Header({ canScrollPrev, canScrollNext, total, loading = false, hasMore = false, onPrev, onNext }: HeaderProps) {
  const { t } = useModuleTranslation('playbook');
  const { t: tCommon } = useModuleTranslation('common');

  return (
    <div className='flex items-center justify-between'>
      <div className='flex items-center gap-2'>
        <h3 className='font-semibold text-sm'>{t('swiper.headerTitle')}</h3>
        <span className='rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary'>{total}</span>
      </div>
      <div className='flex items-center gap-2'>
        <Button asChild variant='link' size='sm' className='h-7 px-1 text-xs font-semibold'>
          <Link to='/playbooks'>{t('swiper.viewAll')}</Link>
        </Button>
        {loading && (
          <div className='flex items-center gap-1 rounded-full border border-muted/60 px-2 py-0.5 text-xs font-medium text-muted-foreground'>
            <Loader size={12} className='text-muted-foreground' />
            <span>{tCommon('actionLoading')}</span>
          </div>
        )}
        <div className='flex items-center gap-1'>
          <Button aria-label={t('swiper.previous')} variant='ghost' size='icon-sm' className='h-7 w-7 rounded-full' disabled={!canScrollPrev} onClick={onPrev}>
            <ChevronLeft className='h-3.5 w-3.5' />
          </Button>
          <Button aria-label={t('swiper.next')} variant='ghost' size='icon-sm' className='h-7 w-7 rounded-full' disabled={!canScrollNext && !hasMore} onClick={onNext}>
            <ChevronRight className='h-3.5 w-3.5' />
          </Button>
        </div>
      </div>
    </div>
  );
}
