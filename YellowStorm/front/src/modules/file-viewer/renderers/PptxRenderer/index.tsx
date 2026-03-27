import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Loader2, Maximize2, Minimize2, Minus, Plus, RefreshCw, Search, X } from 'lucide-react';
import type { RendererProps } from '../../types';
import { ensurePptxAssets } from './asset-loader';
import { useFileViewerPendingNavigation } from '../../store';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { toast } from 'sonner';
import { clearPptxHighlights, downloadPptxFile, highlightPptxMatches, waitForPptxSlides } from '../../utils/pptx';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;
function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))));
}

export function PptxRenderer({ tab, isActive, onReady }: Readonly<RendererProps>) {
  const { t } = useModuleTranslation('file-viewer');
  const pendingNavigation = useFileViewerPendingNavigation();
  const reactId = useId();
  const sanitizedReactId = useMemo(() => reactId.replaceAll(/[^a-z0-9]/gi, ''), [reactId]);
  const containerId = useMemo(() => `pptx-${tab.id.replaceAll(/[^a-z0-9]/gi, '')}-${sanitizedReactId || 'node'}`, [sanitizedReactId, tab.id]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const originalMetricsCaptured = useRef(false);
  const pendingKeyRef = useRef<string | null>(null);
  const [renderVersion, setRenderVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [slideCount, setSlideCount] = useState(0);
  const [currentSlide, setCurrentSlide] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [zoom, setZoom] = useState(1);
  const [slidesReady, setSlidesReady] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [matches, setMatches] = useState<HTMLElement[]>([]);
  const [matchIndex, setMatchIndex] = useState(0);
  const [fitScale, setFitScale] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleFullscreenChange = useCallback(() => {
    if (typeof document === 'undefined') return;
    setIsFullscreen(document.fullscreenElement === fullscreenRef.current);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [handleFullscreenChange]);

  useEffect(() => {
    return () => {
      if (typeof document === 'undefined') return;
      if (document.fullscreenElement === fullscreenRef.current) {
        document.exitFullscreen().catch(() => undefined);
      }
    };
  }, []);

  const getSlides = useCallback(() => {
    return Array.from(containerRef.current?.querySelectorAll<HTMLElement>('.slide') ?? []);
  }, []);

  const recomputeFitScale = useCallback(() => {
    if (globalThis.window === undefined) return;
    const scrollEl = scrollRef.current;
    const slides = getSlides();
    if (!scrollEl || !slides.length) return;

    const style = globalThis.window.getComputedStyle(scrollEl);
    const paddingLeft = Number.parseFloat(style.paddingLeft || '0');
    const paddingRight = Number.parseFloat(style.paddingRight || '0');
    const availableWidth = scrollEl.clientWidth - paddingLeft - paddingRight;
    if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
      return;
    }

    const firstSlide = slides[0];
    let baseWidth = Number.parseFloat(firstSlide.dataset.originalWidth ?? '');
    if (!Number.isFinite(baseWidth) || baseWidth <= 0) {
      const rect = firstSlide.getBoundingClientRect();
      baseWidth = rect.width || 1;
      firstSlide.dataset.originalWidth = rect.width.toString();
    }

    if (!baseWidth) return;
    const nextScale = availableWidth / baseWidth;
    if (Number.isFinite(nextScale) && nextScale > 0) {
      setFitScale(nextScale);
    }
  }, [getSlides]);

  const resetHighlights = useCallback(() => {
    clearPptxHighlights(containerRef.current);
    setMatches([]);
    setMatchIndex(0);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setSlidesReady(false);
    setFitScale(1);
    setZoom(1);
    originalMetricsCaptured.current = false;
    resetHighlights();
    observerRef.current?.disconnect();
    if (typeof document !== 'undefined' && document.fullscreenElement === fullscreenRef.current) {
      document.exitFullscreen().catch(() => undefined);
    }
    setIsFullscreen(false);

    async function render() {
      const container = containerRef.current;
      if (!container) return;

      try {
        await ensurePptxAssets();
        if (cancelled) return;

        container.innerHTML = '';
        container.id = containerId;

        const jQuery = globalThis.window.jQuery || globalThis.window.$;
        if (!jQuery?.fn?.pptxToHtml) {
          throw new Error('pptxToHtml is not available in the current globalThis.window.');
        }

        jQuery(container).pptxToHtml({
          pptxFileUrl: tab.url,
          slideMode: false,
          keyBoardShortCut: false,
          mediaProcess: true,
        });

        const slides = await waitForPptxSlides(container);
        if (cancelled) return;

        setSlideCount(slides.length);
        setCurrentSlide(1);
        setPageInput('1');
        setSlidesReady(true);
        onReady?.();
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setIsLoading(false);
      }
    }

    render().then(() => {
      if (!cancelled) {
        setIsLoading(false);
      }
    });

    return () => {
      cancelled = true;
      observerRef.current?.disconnect();
      clearPptxHighlights(containerRef.current);
    };
  }, [containerId, onReady, resetHighlights, tab.url, renderVersion]);

  const applyZoom = useCallback(
    (value: number, zoomRatio: number) => {
      const slides = getSlides();
      if (!slides.length) return;
      slides.forEach((slide) => {
        if (!originalMetricsCaptured.current) {
          const rect = slide.getBoundingClientRect();
          slide.dataset.originalHeight = rect.height.toString();
          slide.dataset.originalWidth = rect.width.toString();
        }
        const baseHeight = Number(slide.dataset.originalHeight ?? slide.getBoundingClientRect().height);
        const baseWidth = Number(slide.dataset.originalWidth ?? slide.getBoundingClientRect().width);
        const parent = slide.parentElement;
        if (!parent) {
          return;
        }
        let wrapper: HTMLElement;
        if (parent.dataset.pptxWrapper === 'true') {
          wrapper = parent;
        } else {
          const shell = document.createElement('div');
          shell.dataset.pptxWrapper = 'true';
          shell.style.position = 'relative';
          shell.style.margin = '0 auto';
          shell.style.display = 'block';
          shell.style.alignSelf = 'center';
          shell.style.flex = '0 0 auto';
          slide.before(shell, slide);
          shell.appendChild(slide);
          wrapper = shell;
        }
        wrapper.style.display = 'block';
        wrapper.style.flex = '0 0 auto';
        wrapper.style.alignSelf = 'center';
        const scaledHeight = baseHeight * value;
        const scaledWidth = baseWidth * value;
        wrapper.style.width = `${scaledWidth}px`;
        wrapper.style.height = `${scaledHeight}px`;
        wrapper.style.marginBottom = `${50 * value}px`;
        wrapper.style.overflow = zoomRatio > 1 ? 'visible' : 'hidden';
        wrapper.style.maxWidth = zoomRatio > 1 ? 'none' : '100%';
        slide.style.transformOrigin = 'top left';
        slide.style.transform = `scale(${value})`;
        slide.style.minHeight = `${baseHeight}px`;
      });
      originalMetricsCaptured.current = true;
    },
    [getSlides],
  );

  useEffect(() => {
    if (slidesReady) {
      applyZoom(zoom * fitScale, zoom);
    }
  }, [applyZoom, fitScale, slidesReady, zoom]);

  const handleZoomChange = useCallback((direction: 1 | -1) => {
    setZoom((prev) => clampZoom(prev + direction * ZOOM_STEP));
  }, []);

  const scrollToSlide = useCallback(
    (target: number) => {
      const slides = getSlides();
      if (!slides.length) return;
      const clamped = Math.max(1, Math.min(slideCount || slides.length, target));
      const slide = slides[clamped - 1];
      slide?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    [getSlides, slideCount],
  );

  const updateActiveSlide = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      if (!visible.length) return;
      const target = visible[0].target as HTMLElement;
      const slides = getSlides();
      const index = slides.indexOf(target);
      if (index >= 0) {
        setCurrentSlide(index + 1);
      }
    },
    [getSlides],
  );

  useEffect(() => {
    observerRef.current?.disconnect();
    if (!slidesReady || !scrollRef.current) {
      return;
    }

    const observer = new IntersectionObserver(updateActiveSlide, {
      root: scrollRef.current,
      threshold: [0.3, 0.6, 0.9],
    });
    observerRef.current = observer;

    getSlides().forEach((slide) => observer.observe(slide));

    return () => {
      observer.disconnect();
    };
  }, [getSlides, slidesReady, updateActiveSlide]);

  useEffect(() => {
    setPageInput(String(currentSlide));
  }, [currentSlide]);

  useEffect(() => {
    if (!slidesReady) return;
    recomputeFitScale();
    if (globalThis.window === undefined) return;
    const handleResize = () => recomputeFitScale();
    globalThis.window.addEventListener('resize', handleResize);
    let observer: ResizeObserver | null = null;
    if ('ResizeObserver' in globalThis.window) {
      observer = new globalThis.window.ResizeObserver(() => recomputeFitScale());
      if (scrollRef.current) {
        observer.observe(scrollRef.current);
      }
    }
    return () => {
      globalThis.window.removeEventListener('resize', handleResize);
      observer?.disconnect();
    };
  }, [recomputeFitScale, slidesReady]);

  const performSearch = useCallback(
    (query: string, autoScroll = true) => {
      const normalized = query.trim();
      setSearchQuery(query);
      const root = containerRef.current;
      if (!root || !slidesReady) return;
      clearPptxHighlights(root);
      if (!normalized) {
        setMatches([]);
        setMatchIndex(0);
        return;
      }

      const highlights = highlightPptxMatches(root, normalized);
      setMatches(highlights);
      setMatchIndex(0);
      if (highlights.length && autoScroll) {
        highlights[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      if (!highlights.length) {
        toast.warning(t('pptx.search.noResults'));
      }
    },
    [slidesReady, t],
  );

  useEffect(() => {
    const container = containerRef.current;
    matches.forEach((node, index) => {
      const isActive = index === matchIndex;
      const groupId = node.dataset.pptxHighlightGroup;
      const targets = groupId && container ? Array.from(container.querySelectorAll<HTMLElement>(`[data-pptx-highlight-group="${groupId}"]`)) : [node];
      targets.forEach((fragment) => {
        fragment.classList.toggle('outline', isActive);
        fragment.classList.toggle('outline-2', isActive);
        fragment.classList.toggle('outline-primary/80', isActive);
        fragment.classList.toggle('dark:outline-primary/70', isActive);
      });
    });
  }, [matchIndex, matches]);

  const focusMatch = useCallback(
    (direction: 1 | -1) => {
      if (!matches.length) return;
      setMatchIndex((prev) => {
        const next = (prev + direction + matches.length) % matches.length;
        matches[next].scrollIntoView({ behavior: 'smooth', block: 'center' });
        return next;
      });
    },
    [matches],
  );

  useEffect(() => {
    const { tabId, page, highlightText } = pendingNavigation ?? {};
    if (!slidesReady || tabId !== tab.id || !isActive) {
      return;
    }
    const targetKey = `${tabId}:${page ?? ''}:${highlightText ?? ''}`;
    if (pendingKeyRef.current === targetKey) {
      return;
    }
    pendingKeyRef.current = targetKey;

    if (typeof page === 'number') {
      scrollToSlide(page);
    }
    if (highlightText) {
      setSearchOpen(true);
      performSearch(highlightText, true);
    }
  }, [isActive, pendingNavigation, performSearch, scrollToSlide, slidesReady, tab.id]);

  const handlePageSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = Number(pageInput);
    if (!Number.isFinite(target) || target < 1) return;
    scrollToSlide(target);
  };

  const handleDownload = () => {
    downloadPptxFile(tab.url, tab.fileName);
  };

  const toggleFullscreen = async () => {
    if (typeof document === 'undefined' || !fullscreenRef.current) return;
    try {
      if (document.fullscreenElement === fullscreenRef.current) {
        await document.exitFullscreen();
      } else {
        await fullscreenRef.current.requestFullscreen();
      }
    } catch {
      toast.error(t('pptx.fullscreen.error'));
    }
  };

  const handleRetry = () => {
    setRenderVersion((prev) => prev + 1);
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (event.ctrlKey) {
      event.preventDefault();
      handleZoomChange(event.deltaY > 0 ? -1 : 1);
    }
  };

  useEffect(() => {
    if (!searchOpen) {
      setSearchQuery('');
      resetHighlights();
    }
  }, [resetHighlights, searchOpen]);

  const showOverlay = isLoading && !error;

  if (error) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-4 rounded-lg border border-border bg-muted/30 p-6 text-center text-sm'>
        <div>
          <p className='font-semibold text-destructive'>{t('pptx.error.title')}</p>
          <p className='text-muted-foreground'>{t('pptx.error.description')}</p>
          <p className='text-muted-foreground'>{error}</p>
        </div>
        <Button variant='outline' onClick={handleRetry}>
          <RefreshCw className='mr-2 h-4 w-4' />
          {t('actions.retry')}
        </Button>
      </div>
    );
  }

  return (
    <div ref={fullscreenRef} className={cn('flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm', isFullscreen && 'h-screen rounded-none border-0')}>
      <div className='flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-3 py-2 text-xs'>
        <div className='flex items-center gap-2'>
          <button className='inline-flex h-7 w-7 items-center justify-center rounded-md bg-background text-foreground shadow-sm ring-1 ring-border transition hover:bg-muted disabled:opacity-50' onClick={() => scrollToSlide(currentSlide - 1)} disabled={currentSlide <= 1 || isLoading}>
            <ChevronLeft className='h-4 w-4' />
          </button>
          <form onSubmit={handlePageSubmit} className='flex items-center gap-1.5 text-[11px] uppercase tracking-wide'>
            <span>{t('pptx.toolbar.slideLabel')}</span>
            <input type='number' min={1} max={slideCount || 1} value={pageInput} onChange={(event) => setPageInput(event.target.value)} className='h-7 w-16 rounded border border-border bg-background text-center text-sm font-mono' />
            <span>/ {slideCount || 1}</span>
          </form>
          <button className='inline-flex h-7 w-7 items-center justify-center rounded-md bg-background text-foreground shadow-sm ring-1 ring-border transition hover:bg-muted disabled:opacity-50' onClick={() => scrollToSlide(currentSlide + 1)} disabled={currentSlide >= slideCount || isLoading}>
            <ChevronRight className='h-4 w-4' />
          </button>
        </div>

        <div className='flex items-center gap-2'>
          <div className='flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 shadow-sm'>
            <button className='inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted disabled:opacity-50' onClick={() => handleZoomChange(-1)} disabled={zoom <= MIN_ZOOM || isLoading}>
              <Minus className='h-4 w-4' />
            </button>
            <span className='w-16 text-center font-mono text-sm'>{Math.round(zoom * fitScale * 100)}%</span>
            <button className='inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted disabled:opacity-50' onClick={() => handleZoomChange(1)} disabled={zoom >= MAX_ZOOM || isLoading}>
              <Plus className='h-4 w-4' />
            </button>
          </div>

          <button className={cn('inline-flex h-8 items-center justify-center rounded-md bg-background px-3 text-[11px] font-medium uppercase tracking-wide shadow-sm ring-1 ring-border transition hover:bg-muted', searchOpen && 'bg-primary text-primary-foreground hover:bg-primary/90')} onClick={() => setSearchOpen((prev) => !prev)} disabled={isLoading}>
            <Search className='mr-1.5 h-4 w-4' />
            {t('pptx.toolbar.search')}
          </button>

          <button className='inline-flex h-8 items-center justify-center rounded-md bg-background px-3 text-[11px] font-medium uppercase tracking-wide shadow-sm ring-1 ring-border transition hover:bg-muted disabled:opacity-50' onClick={handleDownload} disabled={isLoading}>
            <Download className='mr-1.5 h-4 w-4' />
            {t('pptx.toolbar.download')}
          </button>
          <button className='inline-flex h-8 items-center justify-center rounded-md bg-background px-3 text-[11px] font-medium uppercase tracking-wide shadow-sm ring-1 ring-border transition hover:bg-muted' onClick={toggleFullscreen}>
            {isFullscreen ? <Minimize2 className='mr-1.5 h-4 w-4' /> : <Maximize2 className='mr-1.5 h-4 w-4' />}
            {isFullscreen ? t('pptx.toolbar.exitFullscreen') : t('pptx.toolbar.enterFullscreen')}
          </button>
        </div>
      </div>

      {searchOpen && (
        <div className='flex flex-wrap items-center gap-3 border-b border-border bg-background px-3 py-2 text-xs'>
          <form
            className='flex flex-1 items-center gap-2 rounded-md border border-border bg-muted/60 px-3 py-1.5'
            onSubmit={(event) => {
              event.preventDefault();
              performSearch(searchQuery);
            }}>
            <Search className='h-4 w-4 text-muted-foreground' />
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={t('pptx.search.placeholder')} className='flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground' />
            {searchQuery && (
              <button type='button' onClick={() => performSearch('')} className='text-muted-foreground hover:text-foreground'>
                <X className='h-4 w-4' />
              </button>
            )}
          </form>
          <div className='flex items-center gap-1 text-muted-foreground'>
            <span>{matches.length > 0 ? `${matchIndex + 1}/${matches.length}` : t('pptx.search.noResultsShort')}</span>
            <div className='flex items-center gap-1'>
              <button className='inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-foreground shadow-sm hover:bg-muted disabled:opacity-50' onClick={() => focusMatch(-1)} disabled={!matches.length}>
                <ChevronLeft className='h-4 w-4' />
              </button>
              <button className='inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-foreground shadow-sm hover:bg-muted disabled:opacity-50' onClick={() => focusMatch(1)} disabled={!matches.length}>
                <ChevronRight className='h-4 w-4' />
              </button>
            </div>
          </div>
        </div>
      )}

      <div ref={scrollRef} className='relative flex-1 overflow-auto bg-muted/30 px-6 py-8 dark:bg-muted/20' onWheel={handleWheel}>
        {showOverlay && (
          <div className='absolute inset-0 z-10 flex items-center justify-center bg-background/60'>
            <Loader2 className='mr-2 h-5 w-5 animate-spin text-muted-foreground' />
            <span className='text-sm text-muted-foreground'>{t('pptx.loading')}</span>
          </div>
        )}
        <div id={containerId} ref={containerRef} className={cn('mx-auto flex max-w-full flex-col gap-6 transition-opacity', showOverlay ? 'opacity-50' : 'opacity-100')} />
      </div>
    </div>
  );
}
