import { useEffect, useState } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { governedConversationFeatures } from '@/config/governedConversationFeatures';
import { parseApiError } from '@/lib/api-error';
import { showError } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { createGovernedConversation } from '@/modules/conversation/api';
import { useAvailableGovernedScopes, type AvailableGovernedScope } from '@/modules/governance';
import { useModuleTranslation } from '@/modules/localization';
import { getInitials } from '@/utils/string';

const ACCENT_GRADIENTS = ['from-indigo-500/20 via-indigo-400/10 to-transparent text-indigo-600', 'from-emerald-500/20 via-emerald-400/10 to-transparent text-emerald-600', 'from-rose-500/20 via-rose-400/10 to-transparent text-rose-600', 'from-amber-500/20 via-amber-400/10 to-transparent text-amber-600'];

export function GovernedScopesCarousel(): JSX.Element | null {
  const { t } = useModuleTranslation('conversation');
  const { t: tCommon } = useModuleTranslation('common');
  const navigate = useNavigate();
  const { data: scopes = [], isLoading, isError, refetch } = useAvailableGovernedScopes(governedConversationFeatures.carouselEnabled);
  const [startingScopeId, setStartingScopeId] = useState<string | null>(null);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);
  const [visibleIndices, setVisibleIndices] = useState<number[]>([0]);
  const [emblaRef, emblaApi] = useEmblaCarousel({ align: 'start', dragFree: true, containScroll: 'trimSnaps' });

  useEffect(() => {
    if (!emblaApi) return;

    const update = () => {
      setCanScrollPrev(emblaApi.canScrollPrev());
      setCanScrollNext(emblaApi.canScrollNext());

      const slides = emblaApi.slideNodes();
      const viewportWidth = emblaApi.rootNode()?.getBoundingClientRect().width ?? 0;
      const slideWidth = slides[0]?.getBoundingClientRect().width ?? 0;
      const slidesPerView = slideWidth && viewportWidth ? Math.max(1, Math.floor(viewportWidth / slideWidth)) : 1;
      const rawVisible = emblaApi.slidesInView();

      if (rawVisible.length >= slidesPerView) {
        setVisibleIndices(rawVisible);
        return;
      }

      const startIndex = rawVisible.length ? Math.min(...rawVisible) : emblaApi.selectedScrollSnap();
      const filled = new Set(rawVisible);
      for (let index = 0; filled.size < slidesPerView && index < slides.length; index++) {
        const candidate = startIndex + index;
        if (candidate >= 0 && candidate < slides.length) filled.add(candidate);
      }
      setVisibleIndices(Array.from(filled).sort((a, b) => a - b));
    };

    emblaApi.on('select', update);
    emblaApi.on('scroll', update);
    emblaApi.on('resize', update);
    requestAnimationFrame(update);

    return () => {
      emblaApi.off('select', update);
      emblaApi.off('scroll', update);
      emblaApi.off('resize', update);
    };
  }, [emblaApi, scopes.length]);

  if (!governedConversationFeatures.carouselEnabled) return null;
  if (!isLoading && !isError && scopes.length === 0) return null;

  const start = async (scope: AvailableGovernedScope) => {
    setStartingScopeId(scope.scopeId);
    try {
      const conversation = await createGovernedConversation(scope.scopeId, crypto.randomUUID());
      navigate(`/conversation/${conversation.id}`);
    } catch (error) {
      showError(t('governedScopes.startError'), { description: parseApiError(error).message });
    } finally {
      setStartingScopeId(null);
    }
  };

  return (
    <section aria-labelledby='governed-scopes-heading' className='space-y-3'>
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-2'>
          <h2 id='governed-scopes-heading' className='text-sm font-semibold'>{t('governedScopes.headerTitle')}</h2>
          {!isLoading && <span className='rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary'>{scopes.length}</span>}
        </div>
        {!isError && (
          <div className='flex items-center gap-1'>
            <Button variant='ghost' size='icon-sm' className='h-7 w-7 rounded-full' disabled={!canScrollPrev} onClick={() => emblaApi?.scrollPrev()} aria-label={tCommon('carousel.previous')}>
              <ChevronLeft className='h-3.5 w-3.5' />
            </Button>
            <Button variant='ghost' size='icon-sm' className='h-7 w-7 rounded-full' disabled={!canScrollNext} onClick={() => emblaApi?.scrollNext()} aria-label={tCommon('carousel.next')}>
              <ChevronRight className='h-3.5 w-3.5' />
            </Button>
          </div>
        )}
      </div>

      {isError ? (
        <div className='flex items-center justify-between rounded-xl border border-dashed p-4 text-sm text-muted-foreground'>
          <span>{t('governedScopes.error')}</span>
          <Button variant='outline' size='sm' onClick={() => void refetch()}><RefreshCw className='mr-2 size-4' />{t('governedScopes.retry')}</Button>
        </div>
      ) : (
        <div ref={emblaRef} className='overflow-hidden'>
          <div className='flex gap-3 p-1'>
            {isLoading
              ? Array.from({ length: 3 }).map((_, index) => <div key={index} className='h-[218px] w-[310px] shrink-0 animate-pulse rounded-2xl border bg-muted/40' />)
              : scopes.map((scope, index) => (
                <button type='button' key={scope.scopeId} className={cn('flex min-h-[218px] w-[310px] shrink-0 flex-col gap-4 rounded-2xl border bg-card/80 p-4 text-left shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-xl', visibleIndices.includes(index) ? 'opacity-100' : 'opacity-70')} onClick={() => void start(scope)} disabled={startingScopeId === scope.scopeId} aria-label={t('governedScopes.openAria', { name: scope.name })}>
                  <div className='flex min-w-0 items-center gap-3'>
                    <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br text-sm font-semibold uppercase shadow-inner', ACCENT_GRADIENTS[index % ACCENT_GRADIENTS.length])}>{getInitials(scope.name)}</div>
                    <h3 className='truncate text-sm font-semibold' title={scope.name}>{scope.name}</h3>
                  </div>
                  <p className='line-clamp-3 min-h-10 text-sm text-muted-foreground'>{scope.description}</p>
                </button>
              ))}
          </div>
        </div>
      )}

      {!isLoading && !isError && (
        <div className='mt-3 flex justify-center gap-1.5' aria-hidden='true'>
          {scopes.map((scope, index) => <span key={scope.scopeId} className={cn('h-1.5 rounded-full transition-all duration-300', visibleIndices.includes(index) ? 'w-6 bg-primary' : 'w-1.5 bg-muted-foreground/30')} />)}
        </div>
      )}
    </section>
  );
}
