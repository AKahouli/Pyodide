import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { PlaybookCard } from './PlaybookCard';
import type { PlaybookSummary } from '@/modules/playbook/types';
import { usePlaybookStore, usePlaybooks, usePlaybooksLoading } from '@/modules/playbook/store';
import useEmblaCarousel from 'embla-carousel-react';
import { Header } from './Header';
import { VisibilityDots } from './VisibilityDots';

type PlaybooksCarouselProps = Readonly<{
  className?: string;
  onPlaybookSelect?: (playbook: PlaybookSummary) => void;
}>;

const ACCENT_GRADIENTS = ['from-indigo-500/20 via-indigo-400/10 to-transparent text-indigo-600', 'from-emerald-500/20 via-emerald-400/10 to-transparent text-emerald-600', 'from-rose-500/20 via-rose-400/10 to-transparent text-rose-600', 'from-amber-500/20 via-amber-400/10 to-transparent text-amber-600'];

export function PlaybooksCarousel({ className, onPlaybookSelect }: PlaybooksCarouselProps) {
  const playbooks = usePlaybooks();
  const playbooksLoading = usePlaybooksLoading();
  const fetchPlaybooks = usePlaybookStore((s) => s.fetchPlaybooks);
  const fetchMorePlaybooks = usePlaybookStore((s) => s.fetchMorePlaybooks);
  const pagination = usePlaybookStore((s) => s.playbooksPagination);
  const hasMore = pagination ? pagination.page < pagination.totalPages : false;
  const navigate = useNavigate();
  const [emblaRef, emblaApi] = useEmblaCarousel({ align: 'start', dragFree: true, containScroll: 'trimSnaps' });

  useEffect(() => {
    if (!playbooksLoading && playbooks.length === 0) {
      void fetchPlaybooks({ page: 1, limit: 5, sortBy: 'updatedAt', sortOrder: 'desc' });
    }
  }, [fetchPlaybooks, playbooks.length, playbooksLoading]);

  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);
  const [visibleIndices, setVisibleIndices] = useState<number[]>([0]);

  // Update buttons and visibility state
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
      for (let i = 0; filled.size < slidesPerView && i < slides.length; i++) {
        const candidate = startIndex + i;
        if (candidate >= 0 && candidate < slides.length) {
          filled.add(candidate);
        }
      }

      const nextVisible = Array.from(filled).sort((a, b) => a - b);
      setVisibleIndices(nextVisible);
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
  }, [emblaApi, hasMore, playbooks.length, playbooksLoading, fetchMorePlaybooks]);
  const handleScrollPrev = () => emblaApi?.scrollPrev();
  const maybeLoadMore = () => {
    if (hasMore && !playbooksLoading) {
      void fetchMorePlaybooks();
    }
  };

  const handleScrollNext = () => {
    if (!emblaApi) return;

    if (emblaApi.canScrollNext()) {
      emblaApi.scrollNext();
      requestAnimationFrame(() => {
        if (!emblaApi?.canScrollNext()) {
          maybeLoadMore();
        }
      });
    } else {
      maybeLoadMore();
    }
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [contentHeight, setContentHeight] = useState(0);

  useEffect(() => {
    if (!playbooks.length) {
      setIsVisible(false);
      setContentHeight(0);
      return;
    }

    const measure = () => {
      const height = containerRef.current?.scrollHeight ?? 0;
      setContentHeight(height);
    };

    measure();
    setIsVisible(true);
    window.addEventListener('resize', measure);

    return () => {
      window.removeEventListener('resize', measure);
    };
  }, [playbooks.length]);

  if (!playbooks.length && !playbooksLoading) {
    return null;
  }

  const shouldRender = playbooks.length > 0;

  return (
    <div className={cn('mt-8 overflow-hidden transition-all duration-500 ease-out', className)} style={{ maxHeight: isVisible ? contentHeight : 0, opacity: isVisible ? 1 : 0 }} aria-hidden={!shouldRender}>
      <div ref={containerRef} className='space-y-3'>
        {/* Header */}
        {shouldRender && <Header canScrollPrev={canScrollPrev} canScrollNext={canScrollNext} total={playbooks.length} loading={playbooksLoading} hasMore={hasMore} onPrev={handleScrollPrev} onNext={handleScrollNext} />}

        {/* Carousel */}
        <div className='relative'>
          <div ref={emblaRef} className='overflow-hidden'>
            <div className='flex gap-3 p-1'>
              {playbooks.map((playbook, index) => (
                <div key={playbook.id} className='shrink-0 w-[310px]'>
                  <PlaybookCard
                    playbook={playbook}
                    accentClass={ACCENT_GRADIENTS[index % ACCENT_GRADIENTS.length]}
                    isVisible={visibleIndices.includes(index)}
                    onClick={() => {
                      onPlaybookSelect?.(playbook);
                      navigate(`/playbooks/${playbook.id}`);
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Visibility dots */}
        {shouldRender && <VisibilityDots total={playbooks.length} visibleIndices={visibleIndices} />}
      </div>
    </div>
  );
}
