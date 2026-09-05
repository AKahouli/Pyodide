'use client';

import { badgeVariants } from '@/components/ui/badge';
import { Carousel, type CarouselApi, CarouselContent, CarouselItem } from '@/components/ui/carousel';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { cn } from '@/lib/utils';
import { ArrowLeftIcon, ArrowRightIcon } from 'lucide-react';
import { type ComponentProps, createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

export type InlineCitationProps = ComponentProps<'span'>;

export const InlineCitation = ({ className, ...props }: InlineCitationProps) => <span className={cn('group inline-flex items-center gap-1', className)} {...props} />;

export type InlineCitationTextProps = ComponentProps<'span'>;

export const InlineCitationText = ({ className, ...props }: InlineCitationTextProps) => <span className={cn('transition-colors group-hover:bg-accent', className)} {...props} />;

export type InlineCitationCardProps = ComponentProps<typeof HoverCard>;

const InlineCitationCardContext = createContext({ open: false, setOpen: (_open: boolean) => {} });

export const InlineCitationCard = ({ open, onOpenChange, ...props }: InlineCitationCardProps) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const currentOpen = open ?? internalOpen;
  const setOpen = useCallback((nextOpen: boolean) => {
    if (open === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }, [onOpenChange, open]);

  return (
    <InlineCitationCardContext.Provider value={{ open: currentOpen, setOpen }}>
      <HoverCard closeDelay={0} open={currentOpen} onOpenChange={setOpen} openDelay={0} {...props} />
    </InlineCitationCardContext.Provider>
  );
};

export type InlineCitationCardTriggerProps = ComponentProps<'button'> & {
  sources: string[];
};

function getSourceLabel(source: string): string {
  try {
    return new URL(source).hostname;
  } catch {
    return source;
  }
}

export const InlineCitationCardTrigger = ({ sources, className, 'aria-label': ariaLabel, onClick, onPointerDown, ...props }: InlineCitationCardTriggerProps) => {
  const source = sources[0];
  const visibleLabel = source ? getSourceLabel(source) : '?';
  const fullLabel = sources.filter(Boolean).join(', ') || visibleLabel;
  const { open, setOpen } = useContext(InlineCitationCardContext);
  const openedByTouchRef = useRef(false);

  const handlePointerDown: InlineCitationCardTriggerProps['onPointerDown'] = (event) => {
    openedByTouchRef.current = event.pointerType === 'touch' && !open;
    if (openedByTouchRef.current) setOpen(true);
    onPointerDown?.(event);
  };

  const handleClick: InlineCitationCardTriggerProps['onClick'] = (event) => {
    if (openedByTouchRef.current) {
      openedByTouchRef.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event);
  };

  return (
    <HoverCardTrigger asChild>
      <button
        type='button'
        aria-label={ariaLabel ?? fullLabel}
        title={fullLabel}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        className={cn(
          'mx-0.5 -my-2.5 inline-flex min-h-11 min-w-11 max-w-36 items-center justify-center rounded-full border-0 bg-transparent p-0 align-middle text-[11px] font-semibold leading-none text-foreground shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          className,
        )}
        {...props}
      >
        <span className={cn(badgeVariants({ variant: 'outline' }), 'inline-flex h-6 min-w-6 max-w-32 items-center justify-center rounded-full border-primary/40 bg-background px-1.5 text-foreground transition-colors hover:bg-primary/10')}>
          <span className='truncate'>{visibleLabel}</span>
          {sources.length > 1 && <span className='ml-0.5 shrink-0'>+{sources.length - 1}</span>}
        </span>
      </button>
    </HoverCardTrigger>
  );
};

export type InlineCitationCardBodyProps = Omit<ComponentProps<'div'>, 'ref'>;

export const InlineCitationCardBody = ({ className, ...props }: InlineCitationCardBodyProps) => <HoverCardContent className={cn('relative w-96 max-w-[calc(100vw-2rem)] p-0', className)} {...props} />;

const CarouselApiContext = createContext<CarouselApi | undefined>(undefined);

const useCarouselApi = () => {
  const context = useContext(CarouselApiContext);
  return context;
};

export type InlineCitationCarouselProps = ComponentProps<typeof Carousel>;

export const InlineCitationCarousel = ({ className, children, ...props }: InlineCitationCarouselProps) => {
  const [api, setApi] = useState<CarouselApi>();

  return (
    <CarouselApiContext.Provider value={api}>
      <Carousel className={cn('w-full', className)} setApi={setApi} {...props}>
        {children}
      </Carousel>
    </CarouselApiContext.Provider>
  );
};

export type InlineCitationCarouselContentProps = Omit<ComponentProps<'div'>, 'ref'>;

export const InlineCitationCarouselContent = (props: InlineCitationCarouselContentProps) => <CarouselContent {...props} />;

export type InlineCitationCarouselItemProps = Omit<ComponentProps<'div'>, 'ref'>;

export const InlineCitationCarouselItem = ({ className, ...props }: InlineCitationCarouselItemProps) => <CarouselItem className={cn('w-full space-y-3 p-4', className)} {...props} />;

export type InlineCitationCarouselHeaderProps = ComponentProps<'div'>;

export const InlineCitationCarouselHeader = ({ className, ...props }: InlineCitationCarouselHeaderProps) => <div className={cn('flex items-center justify-between gap-2 rounded-t-md bg-secondary p-2', className)} {...props} />;

export type InlineCitationCarouselIndexProps = ComponentProps<'div'>;

export const InlineCitationCarouselIndex = ({ children, className, ...props }: InlineCitationCarouselIndexProps) => {
  const api = useCarouselApi();
  const [current, setCurrent] = useState(0);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!api) {
      return;
    }

    setCount(api.scrollSnapList().length);
    setCurrent(api.selectedScrollSnap() + 1);

    api.on('select', () => {
      setCurrent(api.selectedScrollSnap() + 1);
    });
  }, [api]);

  return (
    <div className={cn('flex flex-1 items-center justify-end px-3 py-1 text-muted-foreground text-xs', className)} {...props}>
      {children ?? `${current}/${count}`}
    </div>
  );
};

export type InlineCitationCarouselPrevProps = ComponentProps<'button'>;

export const InlineCitationCarouselPrev = ({ className, ...props }: InlineCitationCarouselPrevProps) => {
  const api = useCarouselApi();

  const handleClick = useCallback(() => {
    if (api) {
      api.scrollPrev();
    }
  }, [api]);

  return (
    <button aria-label='Previous' className={cn('shrink-0', className)} onClick={handleClick} type='button' {...props}>
      <ArrowLeftIcon className='size-4 text-muted-foreground' />
    </button>
  );
};

export type InlineCitationCarouselNextProps = ComponentProps<'button'>;

export const InlineCitationCarouselNext = ({ className, ...props }: InlineCitationCarouselNextProps) => {
  const api = useCarouselApi();

  const handleClick = useCallback(() => {
    if (api) {
      api.scrollNext();
    }
  }, [api]);

  return (
    <button aria-label='Next' className={cn('shrink-0', className)} onClick={handleClick} type='button' {...props}>
      <ArrowRightIcon className='size-4 text-muted-foreground' />
    </button>
  );
};

export type InlineCitationSourceProps = ComponentProps<'div'> & {
  title?: string;
  url?: string;
  description?: string;
};

export const InlineCitationSource = ({ title, url, description, className, children, ...props }: InlineCitationSourceProps) => (
  <div className={cn('space-y-1', className)} {...props}>
    {title && <h4 className='truncate font-medium text-sm leading-tight' title={title}>{title}</h4>}
    {url && <p className='truncate break-all text-muted-foreground text-xs'>{url}</p>}
    {description && <p className='line-clamp-3 text-muted-foreground text-sm leading-relaxed'>{description}</p>}
    {children}
  </div>
);

export type InlineCitationQuoteProps = ComponentProps<'blockquote'>;

export const InlineCitationQuote = ({ children, className, ...props }: InlineCitationQuoteProps) => (
  <blockquote className={cn('line-clamp-5 border-muted border-l-2 pl-3 text-muted-foreground text-sm italic leading-relaxed', className)} {...props}>
    {children}
  </blockquote>
);
